/**
 * Browser lifecycle and concurrency.
 *
 * One Chromium is launched lazily and reused across probes — launching costs
 * ~1 s and ~150 MB of fixed overhead. Isolation comes from a fresh
 * BrowserContext per probe, never a shared one: contexts share cookies, and
 * cookie bleed between probes produces wrong and occasionally cross-user
 * results.
 *
 * Each context costs roughly 300 MB, so `MAX_CONCURRENT_BROWSERS` is enforced
 * with a real semaphore rather than hoped for.
 */

import { AppError } from "@downloader/contract";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { throwIfAborted, toAbortError } from "./abort.ts";

const DEFAULT_MAX_CONCURRENT = 2;

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

/** Counting semaphore with an abort-aware queue. */
export class Semaphore {
  readonly #max: number;
  readonly #waiting: Waiter[] = [];
  #active = 0;

  constructor(max: number) {
    this.#max = Math.max(1, Math.floor(max));
  }

  get active(): number {
    return this.#active;
  }

  get max(): number {
    return this.#max;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.#active < this.#max) {
      this.#active += 1;
      return this.#makeRelease();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, cleanup: () => {} };
      if (signal) {
        const onAbort = () => {
          const index = this.#waiting.indexOf(waiter);
          if (index >= 0) this.#waiting.splice(index, 1);
          reject(toAbortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.cleanup = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }
      this.#waiting.push(waiter);
    });
    return this.#makeRelease();
  }

  #makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) {
        // Hand the slot straight over; #active stays where it is.
        next.cleanup();
        next.resolve();
      } else {
        this.#active -= 1;
      }
    };
  }
}

export interface BrowserPoolOptions {
  /** Defaults to `MAX_CONCURRENT_BROWSERS`, then to 2. */
  maxConcurrent?: number;
  headless?: boolean;
  extraArgs?: readonly string[];
  /**
   * Base64 SHA-256 of the SPKI of the root the egress proxy mints leaves from,
   * when that proxy terminates TLS rather than tunnelling it (dl-37).
   *
   * **A launch flag, so it belongs here rather than on a per-request option**,
   * and that is a constraint rather than a preference: this pool keys its
   * shared browser on `proxyUrl` alone, so a trust anchor that could vary per
   * lease would be silently ignored by every lease after the first. Chromium
   * binds it per process for the same reason it binds `--proxy-server` per
   * process.
   *
   * The mechanism is `--ignore-certificate-errors-spki-list`, and it was chosen
   * by measurement rather than preference. Chromium on Linux takes its
   * locally-added anchors from NSS, and dl-34 established this image has no
   * reachable NSS store to write to without `certutil`, which it does not ship;
   * `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` reach Chromium not at all.
   * `ignoreHTTPSErrors` on the context is the other thing that would work and
   * is strictly worse — it accepts *every* certificate, including in the
   * configuration where this proxy tunnels and Chromium is meeting real
   * origins.
   *
   * What it grants is bounded by the key, not by the origin: chains carrying
   * that SPKI stop failing, everything else verifies exactly as before. The key
   * is generated per API process and never leaves its memory, so nothing off
   * this machine can present one. `api/src/tls-interception.ts` holds the other
   * half of that argument.
   */
  proxyRootSpkiSha256?: string | undefined;
}

export interface BrowserPoolStats {
  /** Probes holding a slot right now. */
  active: number;
  maxConcurrent: number;
  /** Whether a shared Chromium is up. False before the first probe. */
  launched: boolean;
  closed: boolean;
}

export interface BrowserLeaseOptions {
  /**
   * Chromium binds `--proxy-server` per process, so the shared browser is keyed
   * on this: leases asking for the same proxy share it, and only a lease asking
   * for a *different* one pays for a dedicated launch.
   *
   * Since dl-12 the API sets this on every probe — its loopback egress proxy is
   * how a page's own fetches are made to pass the SSRF guard — so treating a
   * proxy as the exception would have meant a fresh Chromium, ~1 s and ~150 MB,
   * on every single probe.
   */
  proxyUrl?: string | undefined;
  signal?: AbortSignal | undefined;
}

const BASE_ARGS: readonly string[] = [
  // Players that gate on a user gesture would otherwise never request a segment.
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--disable-features=IsolateOrigins,site-per-process,Translate",
  "--no-first-run",
  "--no-default-browser-check",
];

function envMaxConcurrent(): number {
  const parsed = Number(process.env["MAX_CONCURRENT_BROWSERS"]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MAX_CONCURRENT;
}

export class BrowserPool {
  readonly #semaphore: Semaphore;
  readonly #headless: boolean;
  readonly #args: string[];
  #shared: Browser | undefined;
  #launching: Promise<Browser> | undefined;
  /** The proxy the shared browser is bound to; `undefined` until one is claimed. */
  #sharedProxyUrl: string | undefined;
  #sharedClaimed = false;
  #closed = false;

  constructor(options: BrowserPoolOptions = {}) {
    this.#semaphore = new Semaphore(options.maxConcurrent ?? envMaxConcurrent());
    this.#headless = options.headless ?? true;
    this.#args = [...BASE_ARGS, ...(options.extraArgs ?? [])];
    if (options.proxyRootSpkiSha256 !== undefined && options.proxyRootSpkiSha256 !== "") {
      this.#args.push(`--ignore-certificate-errors-spki-list=${options.proxyRootSpkiSha256}`);
    }
    // Containers without a user namespace need this; a developer laptop must not.
    if (process.env["BROWSER_NO_SANDBOX"] === "true") this.#args.push("--no-sandbox");
  }

  get maxConcurrent(): number {
    return this.#semaphore.max;
  }

  /**
   * What the pool is doing right now, for `/api/health`.
   *
   * Read-only and allocation-free, because a container health check asks for
   * it every few seconds forever. `launched` distinguishes "idle" from "has
   * never started a browser", which is the difference between a healthy
   * service and one whose Chromium cannot start at all — a container missing
   * its shared libraries looks identical to an unused one until the first
   * probe fails.
   */
  get stats(): BrowserPoolStats {
    return {
      active: this.#semaphore.active,
      maxConcurrent: this.#semaphore.max,
      launched: this.#shared?.isConnected() ?? false,
      closed: this.#closed,
    };
  }

  /**
   * Runs `fn` with a browser, holding one concurrency slot for its duration.
   * The slot and any dedicated browser are always released.
   */
  async withBrowser<T>(
    options: BrowserLeaseOptions,
    fn: (browser: Browser) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) {
      throw new AppError("INTERNAL", "The browser pool has already been shut down.");
    }
    const release = await this.#semaphore.acquire(options.signal);
    let dedicated: Browser | undefined;
    try {
      throwIfAborted(options.signal);
      const proxyUrl = options.proxyUrl === "" ? undefined : options.proxyUrl;
      let browser: Browser;
      if (this.#sharedClaimed && this.#sharedProxyUrl !== proxyUrl) {
        // A second proxy in one process. Rare enough not to be worth a second
        // pooled browser, and a dedicated one is closed as soon as it is done.
        dedicated = await this.#launch(proxyUrl);
        browser = dedicated;
      } else {
        browser = await this.#shareBrowser(proxyUrl);
      }
      return await fn(browser);
    } finally {
      if (dedicated) {
        try {
          await dedicated.close();
        } catch {
          // A browser that already died is still closed enough.
        }
      }
      release();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const browser = this.#shared ?? (await this.#launching?.catch(() => undefined));
    this.#shared = undefined;
    this.#launching = undefined;
    this.#sharedClaimed = false;
    this.#sharedProxyUrl = undefined;
    if (!browser) return;
    try {
      await browser.close();
    } catch {
      // Best effort: nothing useful remains to do if teardown itself fails.
    }
  }

  async #shareBrowser(proxyUrl: string | undefined): Promise<Browser> {
    // The first lease claims the shared browser's proxy; every later one either
    // matches it or was sent down the dedicated path before getting here.
    this.#sharedClaimed = true;
    this.#sharedProxyUrl = proxyUrl;
    if (this.#shared?.isConnected()) return this.#shared;
    this.#shared = undefined;
    this.#launching ??= this.#launch(proxyUrl).then(
      (browser) => {
        this.#shared = browser;
        this.#launching = undefined;
        return browser;
      },
      (error: unknown) => {
        this.#launching = undefined;
        // Nothing got bound, so the claim goes back: a later probe with a
        // different proxy should get the shared slot rather than be exiled to a
        // dedicated browser by a launch that never happened.
        this.#sharedClaimed = false;
        this.#sharedProxyUrl = undefined;
        throw error;
      },
    );
    return await this.#launching;
  }

  async #launch(proxyUrl?: string): Promise<Browser> {
    try {
      return await chromium.launch({
        headless: this.#headless,
        args: this.#args,
        // No `bypass`: Playwright adds `--proxy-bypass-list=<-loopback>` of its
        // own accord whenever a proxy is set, and passing a bypass list that
        // mentions a loopback host is what would *undo* it. That default is
        // load-bearing — Chromium otherwise refuses to proxy `127.0.0.1`, which
        // would leave a page free to reach the deployment's own loopback
        // services with nothing checking. The API's `tiers-behind-the-proxy`
        // suite asserts against it, so a Playwright upgrade that changed the
        // default fails a test rather than quietly reopening the hole.
        ...(proxyUrl === undefined ? {} : { proxy: { server: proxyUrl } }),
      });
    } catch (error) {
      throw new AppError("INTERNAL", "The analysis browser could not be started.", {
        cause: error,
      });
    }
  }
}
