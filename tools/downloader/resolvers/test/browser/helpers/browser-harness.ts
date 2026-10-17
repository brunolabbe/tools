/**
 * The setup the browser-resolver spec files share (dl-117).
 *
 * The resolver's spec was one 2,153-line file that ran serially, and CI's
 * `npm test` waited on it alone. Each file split from it starts its own fixture
 * server and its own pooled Chromium in `beforeAll` and closes both in
 * `afterAll`, so a file that fails cannot leave another file's browser behind.
 */

import { AppError } from "@downloader/contract";
import type { ErrorCode, ProbeResult, ResolveOptions } from "@downloader/contract";
import { expect } from "vitest";
import { BrowserPool } from "../../../src/browser/pool.ts";
import type { BrowserResolver, BrowserResolverOptions } from "../../../src/resolvers/browser.ts";
import { startFixtureServer } from "./fixture-server.ts";
import type { FixtureServer } from "./fixture-server.ts";

export const PROBE_TIMEOUT_MS = 25_000;
export const TEST_TIMEOUT_MS = 90_000;
/**
 * The floor the no-media tests pass as `emptyMinWaitMs` (dl-80): equal to the
 * resolver's own `MIN_WAIT_MS`, so the extended floor adds nothing and they run
 * for what they did before it existed. Their verdicts come from the page,
 * not from how long the probe waited. A smaller value would not be "off" — it
 * would shorten the wait below the base rule's.
 */
export const NO_EMPTY_FLOOR_MS = 1200;
/**
 * The quiet rule a builder uses unless its caller says the test expects a stream
 * (dl-115): only those take `STREAM_WAITS`. A shorter wait in a test that expects
 * no media, or an error, would make it pass more easily. A test that expects a
 * stream and also asserts that something was not pressed or not requested may
 * take it: the presses happen during provocation, before the quiet wait, and
 * every request these fixtures make on a press is made on the click itself.
 */
export type Waits = Pick<BrowserResolverOptions, "quietMs" | "minWaitMs">;
export const BASE_WAITS: Waits = { quietMs: 1200 };

export interface BrowserHarness {
  server: FixtureServer;
  pool: BrowserPool;
}

/** One fixture server and one pooled Chromium, for one spec file. */
export async function startBrowserHarness(): Promise<BrowserHarness> {
  const server = await startFixtureServer();
  // One pooled Chromium for the whole file, closed by `closeBrowserHarness` no
  // matter what happens, so a failing test can never leave an orphan behind.
  const pool = new BrowserPool({ maxConcurrent: 1, headless: true });
  return { server, pool };
}

export async function closeBrowserHarness({ server, pool }: BrowserHarness): Promise<void> {
  await pool.close();
  await server.close();
}

export function options(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return {
    timeoutMs: PROBE_TIMEOUT_MS,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * `probe` and `probeError` for one spec file. The server is read at call time,
 * because the file's `beforeAll` assigns it after this module-level call.
 */
export function probes(server: () => FixtureServer): {
  probe: (
    pathname: string,
    resolver: BrowserResolver,
    resolveOptions?: ResolveOptions,
  ) => Promise<ProbeResult>;
  probeError: (
    pathname: string,
    resolver: BrowserResolver,
    resolveOptions?: ResolveOptions,
  ) => Promise<AppError>;
} {
  async function probe(
    pathname: string,
    resolver: BrowserResolver,
    resolveOptions: ResolveOptions = options(),
  ): Promise<ProbeResult> {
    return await resolver.resolve(new URL(server().url(pathname)), resolveOptions);
  }

  async function probeError(
    pathname: string,
    resolver: BrowserResolver,
    resolveOptions: ResolveOptions = options(),
  ): Promise<AppError> {
    let caught: unknown;
    try {
      await probe(pathname, resolver, resolveOptions);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    return caught as AppError;
  }

  return { probe, probeError };
}

export function expectCode(error: AppError, code: ErrorCode): void {
  expect(error.code).toBe(code);
}
