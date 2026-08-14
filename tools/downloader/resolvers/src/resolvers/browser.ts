/**
 * The browser sniffer — priority 50, the generic path, and the reason this
 * project can claim "any website".
 *
 * Modern players use MSE, so the `<video>` element carries a `blob:` URL that
 * means nothing outside the tab. The bytes still have to cross the network, so
 * that is where the stream is caught: drive a real Chromium, let the page's own
 * player do the work, and record what it asks for (analysis §1, §4).
 *
 * Everything site-specific above this resolver is a latency optimisation.
 * Coverage is a property of this file alone.
 */

import { AppError, redactUrl } from "@downloader/contract";
import type {
  MediaVariant,
  ProbeResult,
  RequestContext,
  ResolveOptions,
  Resolver,
  SubtitleTrack,
} from "@downloader/contract";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { budget, remaining, throwIfAborted, withTimeout } from "../browser/abort.ts";
import { classifyFailure, classifyNavigationError } from "../browser/classify.ts";
import { DRM_BINDING_NAME, DrmObserver, drmInitScript, drmReadbackScript } from "../browser/drm.ts";
import { HitCollector } from "../browser/intercept.ts";
import { BrowserPool } from "../browser/pool.ts";
import type { BrowserPoolStats } from "../browser/pool.ts";
import { provokePlayback, readMetadata, readSignals, waitForQuiet } from "../browser/provoke.ts";
import { rankHits } from "../browser/rank.ts";
import { buildRequestContext } from "../browser/request-context.ts";
import type { NetworkHit } from "../browser/types.ts";
import { opaqueManifestVariant, progressiveVariants } from "../browser/variants.ts";
import { parseDash } from "../manifest/dash.ts";
import { parseHls } from "../manifest/hls.ts";
import type { DashParser, HlsParser, ParsedManifest } from "../manifest/types.ts";

export const BROWSER_RESOLVER_NAME = "browser";
export const BROWSER_RESOLVER_PRIORITY = 50;

const DEFAULT_VIEWPORT = { width: 1366, height: 768 } as const;
const DEFAULT_LOCALE = "en-US";
const FALLBACK_CHROME_MAJOR = "141";

/** Network silence that counts as "the player has settled". */
const DEFAULT_QUIET_MS = 2500;
/** Never conclude "no media" before the page has had a fair chance to ask. */
const MIN_WAIT_MS = 1200;
/** Kept back from the deadline for the manifest fetch, metadata read and teardown. */
const TEARDOWN_RESERVE_MS = 4000;
/** Manifests to try parsing before falling back to an opaque variant. */
const MAX_MANIFEST_ATTEMPTS = 2;
/** Longest we wait for in-flight header and body reads to land. */
const SETTLE_TIMEOUT_MS = 3000;
/** Slack past the internal deadline before the hard cap fires. */
const HARD_TIMEOUT_GRACE_MS = 3000;
const CONTEXT_CLOSE_TIMEOUT_MS = 5000;

export interface BrowserResolverOptions {
  /** Defaults to `MAX_CONCURRENT_BROWSERS`, then 2. Each context costs ~300 MB. */
  maxConcurrentBrowsers?: number;
  headless?: boolean;
  /** Injected so tests can share one pool, and so a caller can cap it globally. */
  pool?: BrowserPool;
  /**
   * dl-1 owns the parsers. They are injected rather than imported-and-called so
   * this resolver is testable before they land, and so a parser that throws on
   * an exotic manifest degrades to an opaque variant instead of failing a probe.
   */
  hlsParser?: HlsParser;
  dashParser?: DashParser;
  quietMs?: number;
}

interface ProbeOutcome {
  variants: MediaVariant[];
  subtitles: SubtitleTrack[];
  isLive: boolean;
  durationSec?: number | undefined;
  chosen: NetworkHit;
}

export class BrowserResolver implements Resolver {
  readonly name = BROWSER_RESOLVER_NAME;
  readonly priority = BROWSER_RESOLVER_PRIORITY;

  readonly #pool: BrowserPool;
  readonly #ownsPool: boolean;
  readonly #hlsParser: HlsParser;
  readonly #dashParser: DashParser;
  readonly #quietMs: number;

  constructor(options: BrowserResolverOptions = {}) {
    this.#ownsPool = options.pool === undefined;
    this.#pool =
      options.pool ??
      new BrowserPool({
        ...(options.maxConcurrentBrowsers === undefined
          ? {}
          : { maxConcurrent: options.maxConcurrentBrowsers }),
        ...(options.headless === undefined ? {} : { headless: options.headless }),
      });
    this.#hlsParser = options.hlsParser ?? parseHls;
    this.#dashParser = options.dashParser ?? parseDash;
    this.#quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  }

  /** Anything fetchable over HTTP. This is the fallback for everything. */
  canHandle(url: URL): boolean {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  /** Pool occupancy, for `/api/health`. */
  get stats(): BrowserPoolStats {
    return this.#pool.stats;
  }

  async resolve(url: URL, options: ResolveOptions): Promise<ProbeResult> {
    throwIfAborted(options.signal);
    const deadline = Date.now() + Math.max(5000, options.timeoutMs);

    return await this.#pool.withBrowser(
      { proxyUrl: options.proxyUrl, signal: options.signal },
      async (browser) => await this.#probe(browser, url, options, deadline),
    );
  }

  async dispose(): Promise<void> {
    // A pool handed in by the caller belongs to the caller.
    if (this.#ownsPool) await this.#pool.close();
  }

  async #probe(
    browser: Browser,
    url: URL,
    options: ResolveOptions,
    deadline: number,
  ): Promise<ProbeResult> {
    const userAgent = userAgentFor(browser);
    const locale = options.locale ?? DEFAULT_LOCALE;
    const acceptLanguage = acceptLanguageFor(locale);

    // One fresh context per probe. Never shared: contexts share cookies, and
    // cookie bleed between probes causes wrong and cross-user results.
    const context = await browser.newContext({
      userAgent,
      viewport: { ...DEFAULT_VIEWPORT },
      locale,
      extraHTTPHeaders: { "accept-language": acceptLanguage },
      // Service workers can serve media from cache, which would hide the very
      // requests this resolver exists to observe.
      serviceWorkers: "block",
    });

    try {
      // Belt to the internal deadline's braces. Several Playwright calls have no
      // timeout of their own, and one stuck call would hold a concurrency slot
      // for the lifetime of the process.
      return await withTimeout(
        this.#run(context, url, options, deadline, { userAgent, acceptLanguage }),
        remaining(deadline) + HARD_TIMEOUT_GRACE_MS,
        () => new AppError("TIMEOUT", "The page analysis exceeded its time budget."),
      );
    } finally {
      // Leaked contexts exhaust memory within an hour of real use.
      try {
        await withTimeout(
          context.close(),
          CONTEXT_CLOSE_TIMEOUT_MS,
          () => new AppError("INTERNAL", "Browser context did not close."),
        );
      } catch {
        // Nothing useful remains if teardown itself fails; the pooled browser is
        // closed on dispose() either way.
      }
    }
  }

  async #run(
    context: BrowserContext,
    url: URL,
    options: ResolveOptions,
    deadline: number,
    identity: { userAgent: string; acceptLanguage: string },
  ): Promise<ProbeResult> {
    const { userAgent, acceptLanguage } = identity;
    const drm = new DrmObserver();
    await context.exposeBinding(DRM_BINDING_NAME, (_source, keySystem) => {
      drm.record(keySystem);
    });
    await context.addInitScript({ content: drmInitScript() });

    if (options.cookieHeader) await applyCookieHeader(context, url, options.cookieHeader);

    const collector = new HitCollector();
    collector.attach(context);

    const page = await context.newPage();
    const navigation = await navigate(page, url, deadline, options);

    // Checked as early as possible: DRM is a fact about the source, and there
    // is nothing worth waiting for once it is established.
    if (drm.detected) throw drm.toError();

    await provokePlayback(page, {
      deadline: deadline - TEARDOWN_RESERVE_MS,
      signal: options.signal,
    });

    const quietReached = await waitForQuiet({
      collector,
      deadline: deadline - TEARDOWN_RESERVE_MS,
      quietMs: this.#quietMs,
      minWaitMs: MIN_WAIT_MS,
      signal: options.signal,
      stop: () => drm.detected,
    });

    await collector.settle(Math.min(SETTLE_TIMEOUT_MS, remaining(deadline)));
    await readBackDrm(page, drm);
    if (drm.detected) throw drm.toError();
    throwIfAborted(options.signal);

    const finalUrl = page.url();
    const ranked = rankHits(collector.hits, finalUrl);
    const outcome = await this.#buildOutcome(context, collector, ranked, deadline);

    if (!outcome) {
      const signals = await readSignals(page);
      throw classifyFailure({
        ...signals,
        finalUrl,
        status: navigation?.status(),
        quietReached,
      });
    }

    const metadata = await readMetadata(page);
    const requestContext: RequestContext = buildRequestContext({
      hit: outcome.chosen,
      pageUrl: finalUrl,
      userAgent,
      acceptLanguage,
      proxyUrl: options.proxyUrl,
    });

    const durationSec = outcome.durationSec ?? metadata.durationSec ?? undefined;
    const thumbnailUrl = absoluteUrl(metadata.ogImage, finalUrl);

    return {
      sourceUrl: url.toString(),
      resolver: this.name,
      title: pickTitle(metadata.ogTitle, metadata.docTitle, url),
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
      variants: outcome.variants,
      subtitles: outcome.subtitles,
      requestContext,
      drm: { protected: false, systems: [] },
      isLive: outcome.isLive,
      probedAt: new Date().toISOString(),
    };
  }

  /** `undefined` means nothing playable was observed. */
  async #buildOutcome(
    context: BrowserContext,
    collector: HitCollector,
    ranked: readonly NetworkHit[],
    deadline: number,
  ): Promise<ProbeOutcome | undefined> {
    const manifests = ranked.filter((hit) => hit.kind === "hls" || hit.kind === "dash");
    const files = ranked.filter((hit) => hit.kind === "progressive");

    for (const hit of manifests.slice(0, MAX_MANIFEST_ATTEMPTS)) {
      // Sequential on purpose: the first manifest that parses wins, and probing
      // the runner-up costs a request against a CDN that may rate-limit us.
      // oxlint-disable-next-line no-await-in-loop
      const text = await this.#loadManifest(context, collector, hit, deadline);
      if (text === undefined) continue;
      const parsed = this.#parseManifest(hit, text);
      if (!parsed) continue;

      // The parsers are the manifest-level DRM detectors (analysis §3). Their
      // verdict is as terminal as the EME hook's.
      if (parsed.drm.protected) {
        throw new AppError("DRM_PROTECTED", undefined, {
          details: {
            systems: parsed.drm.systems,
            ...(parsed.drm.evidence === undefined ? {} : { evidence: parsed.drm.evidence }),
            url: redactUrl(hit.url),
          },
        });
      }
      if (parsed.variants.length === 0) continue;

      return {
        variants: parsed.variants,
        subtitles: parsed.subtitles,
        isLive: parsed.isLive,
        durationSec: parsed.durationSec,
        chosen: hit,
      };
    }

    const best = manifests[0];
    if (best) {
      // Could not fetch or parse it, but ffmpeg reads playlists natively, so an
      // opaque variant is still a usable answer.
      return {
        variants: [
          opaqueManifestVariant(best, "browser-manifest-0"),
          ...progressiveVariants(files),
        ],
        subtitles: [],
        isLive: false,
        chosen: best,
      };
    }

    const firstFile = files[0];
    if (firstFile) {
      return {
        variants: progressiveVariants(files),
        subtitles: [],
        isLive: false,
        chosen: firstFile,
      };
    }
    return undefined;
  }

  /**
   * Re-fetches the manifest with the captured headers replayed, which is both
   * how the parsers get their input and a live check that the context we are
   * about to hand the engine actually works. Falls back to the body captured at
   * interception time when the replay fails.
   */
  async #loadManifest(
    context: BrowserContext,
    collector: HitCollector,
    hit: NetworkHit,
    deadline: number,
  ): Promise<string | undefined> {
    const timeout = budget(deadline, 8000);
    if (timeout > 500) {
      try {
        const response = await context.request.get(hit.url, {
          headers: replayHeaders(hit),
          timeout,
          failOnStatusCode: false,
        });
        if (response.ok()) {
          const text = await response.text();
          if (text.trim().length > 0) return text;
        }
      } catch {
        // Expired signature, network hiccup or a CDN that dislikes us twice.
      }
    }
    return collector.bodyFor(hit.key);
  }

  #parseManifest(hit: NetworkHit, text: string): ParsedManifest | undefined {
    try {
      return hit.kind === "dash" ? this.#dashParser(text, hit.url) : this.#hlsParser(text, hit.url);
    } catch {
      // A stub, an unsupported shape, or a body that was not the manifest we
      // thought. The opaque fallback handles it; failing the probe would not.
      return undefined;
    }
  }
}

/** Convenience factory mirroring the other resolvers' construction style. */
export function createBrowserResolver(options: BrowserResolverOptions = {}): BrowserResolver {
  return new BrowserResolver(options);
}

async function navigate(
  page: Page,
  url: URL,
  deadline: number,
  options: ResolveOptions,
): Promise<Response | null> {
  const timeout = budget(deadline, Math.max(5000, remaining(deadline) * 0.6));
  try {
    return await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout });
  } catch (error) {
    // A navigation timeout is not fatal: the player may already have requested
    // its manifest while some third-party script kept the load event pending.
    if (error instanceof Error && /timeout/i.test(error.message) && page.url() !== "about:blank") {
      return null;
    }
    throwIfAborted(options.signal);
    throw classifyNavigationError(error, url.toString());
  }
}

async function readBackDrm(page: Page, drm: DrmObserver): Promise<void> {
  const script = drmReadbackScript();
  const results = await Promise.allSettled(
    page.frames().map(async (frame) => await frame.evaluate<string[]>(script)),
  );
  for (const result of results) {
    // A rejected read means the frame detached or is cross-origin; the live
    // binding already covered those.
    if (result.status === "fulfilled") drm.recordAll(result.value);
  }
}

/**
 * Operator-supplied cookies are scoped to the target URL rather than sprayed as
 * a blanket `Cookie` header, so session credentials never leak to a third-party
 * CDN the page happens to talk to.
 */
async function applyCookieHeader(
  context: BrowserContext,
  url: URL,
  cookieHeader: string,
): Promise<void> {
  const cookies = cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .flatMap((pair) => {
      const separator = pair.indexOf("=");
      if (separator <= 0) return [];
      return [
        {
          name: pair.slice(0, separator).trim(),
          value: pair.slice(separator + 1).trim(),
          url: url.toString(),
        },
      ];
    });
  if (cookies.length === 0) return;
  try {
    await context.addCookies(cookies);
  } catch {
    // A malformed jar must not take down an otherwise workable probe.
  }
}

function replayHeaders(hit: NetworkHit): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(hit.headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":")) continue;
    if (lower === "host" || lower === "content-length" || lower === "accept-encoding") continue;
    headers[name] = value;
  }
  return headers;
}

/**
 * Derived from the browser that is actually running: a UA claiming a Chrome
 * version that does not match the TLS and header fingerprint is a bot signal.
 */
function userAgentFor(browser: Browser): string {
  const major = browser.version().split(".")[0] ?? FALLBACK_CHROME_MAJOR;
  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
}

function acceptLanguageFor(locale: string): string {
  const base = locale.split("-")[0] ?? locale;
  return base === locale ? `${locale},en;q=0.8` : `${locale},${base};q=0.9,en;q=0.8`;
}

function pickTitle(ogTitle: string | null, docTitle: string | null, url: URL): string {
  const candidate = (ogTitle ?? docTitle ?? "").replace(/\s+/g, " ").trim();
  if (candidate.length > 0) return candidate.slice(0, 300);
  return url.hostname;
}

function absoluteUrl(candidate: string | null, base: string): string | undefined {
  if (!candidate) return undefined;
  try {
    const resolved = new URL(candidate, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}
