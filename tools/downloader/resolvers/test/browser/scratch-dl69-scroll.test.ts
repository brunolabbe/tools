/**
 * SCRATCH for dl-69, not part of the suite, reverted after the measurement
 * run. Measures whether a click-only shadow-root player pushed 6000px below
 * the initial viewport is still reached by `clickChosenVideo` when
 * `SCROLL_SCRIPT` cannot find it (light-DOM only, before the fix) versus
 * after.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import { recordingHlsParser } from "./helpers/fake-parsers.ts";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";

let server: FixtureServer;
let pool: BrowserPool;

beforeAll(async () => {
  server = await startFixtureServer();
  pool = new BrowserPool({ maxConcurrent: 1, headless: true });
});

afterAll(async () => {
  await pool.close();
  await server.close();
});

describe("dl-69 SCRATCH: off-screen shadow-root click-only player", () => {
  test("clickChosenVideo still lands the click", { timeout: 90_000 }, async () => {
    const hls = recordingHlsParser();
    const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
    server.requests.length = 0;
    const result = await resolver.resolve(new URL(server.url("/shadow-player-offscreen.html")), {
      timeoutMs: 25_000,
      signal: new AbortController().signal,
    });
    console.log("GATE_MEASUREMENT_VARIANT:", result.variants[0]?.url);
    console.log("GATE_MEASUREMENT_REQUESTS:", JSON.stringify(server.requests));
    expect(result.variants[0]?.url).toBe(server.url("/media/related/master.m3u8"));
  });
});
