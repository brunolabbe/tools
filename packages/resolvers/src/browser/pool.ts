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

import { AppError } from "@downloader/shared";
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
}

export interface BrowserLeaseOptions {
  /** When set, a dedicated browser is launched: Chromium binds proxies per process. */
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
  #closed = false;

  constructor(options: BrowserPoolOptions = {}) {
    this.#semaphore = new Semaphore(options.maxConcurrent ?? envMaxConcurrent());
    this.#headless = options.headless ?? true;
    this.#args = [...BASE_ARGS, ...(options.extraArgs ?? [])];
    // Containers without a user namespace need this; a developer laptop must not.
    if (process.env["BROWSER_NO_SANDBOX"] === "true") this.#args.push("--no-sandbox");
  }

  get maxConcurrent(): number {
    return this.#semaphore.max;
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
      let browser: Browser;
      if (options.proxyUrl) {
        dedicated = await this.#launch(options.proxyUrl);
        browser = dedicated;
      } else {
        browser = await this.#shareBrowser();
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
    if (!browser) return;
    try {
      await browser.close();
    } catch {
      // Best effort: nothing useful remains to do if teardown itself fails.
    }
  }

  async #shareBrowser(): Promise<Browser> {
    if (this.#shared?.isConnected()) return this.#shared;
    this.#shared = undefined;
    this.#launching ??= this.#launch().then(
      (browser) => {
        this.#shared = browser;
        this.#launching = undefined;
        return browser;
      },
      (error: unknown) => {
        this.#launching = undefined;
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
        ...(proxyUrl === undefined ? {} : { proxy: { server: proxyUrl } }),
      });
    } catch (error) {
      throw new AppError("INTERNAL", "The analysis browser could not be started.", {
        cause: error,
      });
    }
  }
}
