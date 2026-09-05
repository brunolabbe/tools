/**
 * Composes the resolver registry from configuration.
 *
 * `@downloader/resolvers` ships no default set on purpose — which tiers exist
 * is a deployment choice, not a library one — so this is the file that decides,
 * and it is the first code in the repo that assembles the whole chain. That
 * makes it where **M2** is finally demonstrable.
 *
 * The ordering rule from `tools/downloader/docs/02-ROADMAP.md`, restated because it is the one
 * thing here that is easy to get subtly wrong:
 *
 *   The browser sniffer is the *foundation*. yt-dlp is a latency optimisation
 *   layered on top of it. Removing yt-dlp must not remove coverage — with
 *   `ENABLE_YTDLP_RESOLVER=false`, or with the binary simply absent, every
 *   request falls through to the sniffer and still works. Any code path that
 *   turns a missing yt-dlp into an *error* rather than a fallthrough is a bug.
 *
 * Priorities come from the resolvers themselves (yt-dlp 20, browser 50, direct
 * 90) and the registry sorts by them, so this function only decides membership.
 */

import { AppError, redactUrl } from "@downloader/contract";
import {
  BrowserResolver,
  DirectUrlResolver,
  ResolverRegistry,
  YtDlpResolver,
} from "@downloader/resolvers";
import type { ProbeResult, ResolveOptions, Resolver } from "@downloader/contract";
import type { ApiConfig } from "./config.ts";
import type { GuardedFetch } from "./guarded-fetch.ts";
import type { AppLogger } from "./logger.ts";
import type { TlsRejectionLog } from "./tls-rejections.ts";

export interface BuildRegistryOptions {
  config: ApiConfig;
  logger: AppLogger;
  /**
   * Redirect-checking fetch. Handed to the direct resolver, which follows
   * redirects to manifests and would otherwise be an SSRF hole, and to the
   * yt-dlp resolver, which uses it only to weigh a rendition (dl-30) — a
   * request to a URL an extractor produced, which is exactly the kind the guard
   * exists for.
   */
  fetchImpl: GuardedFetch;
  /**
   * Set when — and only when — the proxy the tiers are given terminates TLS.
   * Absent, both tiers behave exactly as they did before dl-37: they meet the
   * origin's own certificate through a tunnel and verify it themselves.
   */
  tierEgress?: TierEgress;
}

/**
 * The half of the tiers' egress that is not the proxy URL.
 *
 * **It travels as one object because it is one decision**, which `server.ts`
 * says at length about ffmpeg's equivalent: a terminating proxy whose client
 * was not given the generated root fails every origin, and a tunnel whose
 * client *was* given it is a trust anchor handed to a client that never meets
 * it. Splitting the pair across two settings is how they drift.
 */
export interface TierEgress {
  /** Chromium's `--ignore-certificate-errors-spki-list`. */
  rootSpkiSha256: string;
  /** yt-dlp's `SSL_CERT_FILE`. */
  trustBundlePath: string;
  /**
   * Where that proxy files the certificates it refused, so a tier that only saw
   * "the tunnel failed" can still be told which. See `tls-rejections.ts`.
   */
  rejections: TlsRejectionLog;
}

/**
 * The operator-facing half of a verdict this process reached on a tier's
 * behalf.
 *
 * Distinct from `TIER_TRUST_STORE_HINT` in `@downloader/resolvers`, which is
 * for the other configuration — that one explains a tier that met an origin
 * certificate and could not verify it against a store nothing writes to. This
 * one is the opposite situation and needs opposite advice: the anchor did reach
 * the party that verified, so `EGRESS_CA_FILE` is the setting to reach for and
 * `details.reason` is a real OpenSSL verify code rather than a Chromium token.
 */
export const PROXY_REFUSED_ORIGIN_HINT =
  "The egress proxy verified this origin on the tier's behalf and refused its certificate; details.reason is the OpenSSL verify code. The tier itself only saw a tunnel it could not open, so this verdict was reattached here. If the origin chains to a private root, EGRESS_CA_FILE is the setting — it reaches this proxy. See tools/downloader/docs/work/dl-37-tiers-move-onto-the-terminating-proxy.md.";

/**
 * The only raw verdicts a reattached certificate cause is allowed to replace.
 *
 * Both mean "the connection did not happen" or "this tier learned nothing
 * about the source" — `UNREACHABLE` is the browser tier's and the yt-dlp
 * tier's shared bucket for a `CONNECT` that failed for any reason their own
 * classifier does not have a more specific answer for, and `NO_MEDIA_FOUND` is
 * yt-dlp's default fallthrough for the same shape of failure. Neither is a
 * fact the tier established about the *source*.
 *
 * A gate on this ticket is why this is an allowlist rather than the single
 * exclusion (`!== "TLS_VERIFICATION_FAILED"`) it started as: that version
 * would have overwritten `DRM_PROTECTED`, `CANCELED`, `TIMEOUT`,
 * `AUTH_REQUIRED` and `GEO_BLOCKED` too, on the same host-and-window
 * coincidence a certificate refusal happens to match. Those five *are* facts
 * the tier established — a positive result, not an absence of one — and
 * overwriting one with an inference is the wrong direction regardless of how
 * plausible the inference is. A relabelled `CANCELED` would be nonsense to a
 * user who pressed cancel; a relabelled `DRM_PROTECTED` would be a worse
 * misdiagnosis than the one dl-34 exists to have fixed.
 */
const REATTACHABLE_CODES = new Set(["UNREACHABLE", "NO_MEDIA_FOUND"]);

/**
 * Restores the verdict a terminating proxy takes away from a tier.
 *
 * dl-34 taught both tiers to say `TLS_VERIFICATION_FAILED` when they met a
 * certificate they could not verify. dl-37 moved them behind a proxy that meets
 * the certificate for them, so neither tier can see one any more: yt-dlp is
 * told `Tunnel connection failed: 502 …` and Chromium is told
 * `net::ERR_TUNNEL_CONNECTION_FAILED` and nothing else. Without this the tiers
 * report `UNREACHABLE` — retryable, "The site could not be reached" — and
 * `NO_MEDIA_FOUND` for a trust problem, which is the pair of sentences dl-34
 * exists to have deleted.
 *
 * **Only for the tiers behind the proxy.** The direct tier fetches through
 * undici in this process, meets the origin certificate itself and already
 * raises the right code from `guarded-fetch.ts`, so wrapping it would be a
 * second answer to a question already answered.
 *
 * A verdict the tier reached on its own is left alone in two ways now, not
 * one: an error that is already `TLS_VERIFICATION_FAILED` carries the tier's
 * own `reason`, which is more specific than anything reattached here, and an
 * error whose code is not in `REATTACHABLE_CODES` is a fact rather than an
 * absence and must not be overwritten by an inference at all.
 *
 * Exported so both rules can be pinned directly, against a resolver that
 * throws whatever code a test names — `buildRegistry` gives no way to inject
 * one in place of the real `YtDlpResolver` / `BrowserResolver`, and driving a
 * real `DRM_PROTECTED` verdict through a live tier would test Chromium or
 * yt-dlp, not this wrapper.
 */
export function namingRefusedOrigins(resolver: Resolver, rejections: TlsRejectionLog): Resolver {
  return {
    name: resolver.name,
    priority: resolver.priority,
    canHandle: (url: URL) => resolver.canHandle(url),
    ...(resolver.dispose === undefined
      ? {}
      : { dispose: async (): Promise<void> => await resolver.dispose?.() }),
    async resolve(url: URL, options: ResolveOptions): Promise<ProbeResult> {
      // Read before the attempt, not after: `since` asks whether a refusal
      // happened inside this call's own window, and a start time taken
      // afterwards would be a window of zero width.
      const startedAt = Date.now();
      try {
        return await resolver.resolve(url, options);
      } catch (cause) {
        const error = AppError.from(cause);
        if (!REATTACHABLE_CODES.has(error.code)) throw error;
        const reason = rejections.since(url.hostname, startedAt);
        if (reason === undefined) throw error;
        throw new AppError("TLS_VERIFICATION_FAILED", undefined, {
          cause,
          details: { url: redactUrl(url.href), reason, hint: PROXY_REFUSED_ORIGIN_HINT },
        });
      }
    },
  };
}

export interface RegistryBuild {
  registry: ResolverRegistry;
  /** What actually got registered, for `/api/health` and for the boot log. */
  resolverNames: string[];
  /**
   * The two tiers with runtime state worth reporting, kept as their concrete
   * types rather than as `Resolver`. `/api/health` needs the browser pool's
   * occupancy and whether yt-dlp's binary was actually found, and neither is on
   * the `Resolver` interface — nor should be, since it is the *registry* that
   * is general and these two that happen to own a process pool and a binary.
   * Null means the tier is not registered at all.
   */
  ytdlp: YtDlpResolver | null;
  browser: BrowserResolver | null;
}

export function buildRegistry(options: BuildRegistryOptions): RegistryBuild {
  const { config, logger, tierEgress } = options;
  const resolvers: Resolver[] = [];
  let ytdlp: YtDlpResolver | null = null;
  let browser: BrowserResolver | null = null;
  /** Behind a terminating proxy, so the tier cannot name a refused origin itself. */
  const named = (resolver: Resolver): Resolver =>
    tierEgress === undefined ? resolver : namingRefusedOrigins(resolver, tierEgress.rejections);

  if (config.enableYtdlpResolver) {
    // No `binaryPath` key at all when unset: the resolver falls back to
    // `YTDLP_PATH` and then to `yt-dlp` on `PATH`, and passing an explicit
    // undefined would defeat that.
    ytdlp = new YtDlpResolver({
      fetch: options.fetchImpl,
      ...(config.ytdlpPath === undefined ? {} : { binaryPath: config.ytdlpPath }),
      ...(tierEgress === undefined ? {} : { proxyTrustBundlePath: tierEgress.trustBundlePath }),
    });
    resolvers.push(named(ytdlp));
  }

  if (config.enableBrowserResolver) {
    // No proxy here: `ResolveOptions.proxyUrl` carries it per call, because the
    // resolver contract makes the proxy a property of the request rather than
    // of the resolver. Its trust anchor cannot follow it — Chromium binds
    // `--ignore-certificate-errors-spki-list` per process exactly as it binds
    // `--proxy-server`, and the pool keys its shared browser on the URL alone.
    browser = new BrowserResolver({
      maxConcurrentBrowsers: config.maxConcurrentBrowsers,
      ...(tierEgress === undefined ? {} : { proxyRootSpkiSha256: tierEgress.rootSpkiSha256 }),
    });
    resolvers.push(named(browser));
  }

  if (config.enableDirectResolver) {
    resolvers.push(new DirectUrlResolver({ fetch: options.fetchImpl }));
  }

  const registry = new ResolverRegistry(resolvers);
  const resolverNames = registry.resolvers.map((resolver) => resolver.name);

  logger.info("resolver chain composed", {
    resolvers: resolverNames,
    // Logged explicitly because "why did this site stop working" is almost
    // always answered by which tiers were enabled at the time.
    ytdlpEnabled: config.enableYtdlpResolver,
    browserEnabled: config.enableBrowserResolver,
    // Enabled and *present* are different things, and only the second one
    // affects behaviour.
    ytdlpAvailable: ytdlp?.available ?? false,
  });

  if (!config.enableBrowserResolver) {
    logger.warn(
      "the browser sniffer is disabled; coverage is limited to sites with an extractor or a direct media URL",
    );
  }

  return { registry, resolverNames, ytdlp, browser };
}
