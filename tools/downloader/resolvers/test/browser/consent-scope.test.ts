/**
 * Which fixed bars the consent-container rule presses (dl-93), through the real
 * `BrowserResolver`. A file of its own so the rows can be measured alone.
 *
 * Every row is one fixed bar labelled with a phrasing dl-82 added, so only the
 * consent-container rule can press it; pressing it mounts the player.
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import { recordingHlsParser } from "./helpers/fake-parsers.ts";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import type { FixtureServer } from "./helpers/fixture-server.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;
const MASTER = "/media/mse/master.m3u8";

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

async function visit(
  pathname: string,
): Promise<{ outcome: ProbeResult | AppError; requests: string[] }> {
  const hls = recordingHlsParser();
  const resolver = new BrowserResolver({
    pool,
    hlsParser: hls.parser,
    quietMs: 1200,
    emptyMinWaitMs: 1200,
  });
  server.requests.length = 0;
  let outcome: ProbeResult | AppError;
  try {
    outcome = await resolver.resolve(new URL(server.url(pathname)), {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal: new AbortController().signal,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    outcome = error as AppError;
  }
  return { outcome, requests: [...server.requests] };
}

describe("a fixed bar whose cookie wording is a compound word or a kept word (dl-93)", () => {
  // r3..r9 resolved at dl-82's head and must keep doing so; r7 and r8 are the
  // compound words dl-82's word start had given up.
  test.each([
    ["r3", "Cookie-Einstellungen, then Ich stimme zu"],
    ["r3b", "We use cookies, then Ho capito"],
    ["r4", "Polish plików cookie, then Akceptuję"],
    ["r5", "a bar hidden until 1.2 s"],
    ["r6", "Wir verwenden Cookies, then Ich stimme zu"],
    ["r7", "Statistikcookies and Marketingcookies, then Ich stimme zu"],
    ["r8", "Swedish kakorna, then Jag godkänner"],
    ["r9", "a CMP whose text and button sit in separate blocks"],
  ])("%s (%s) is pressed and its stream found", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).toContain("/beacon/consent-accepted");
    expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
  });
});

describe("a fixed bar whose cookie wording sits in a link or a hidden node (dl-93)", () => {
  // A link inside a sentence, beside the button: "We use <a>cookies</a> ...".
  test.each([
    ["r1", "Read our <a>cookie policy</a>. [Ho capito]"],
    ["r1b", "We use <a>cookies</a> to improve the site. [Accetto e continua]"],
    ["r2b", "Leggi la <span role=link>cookie policy</span>. [Ho capito]"],
  ])("%s (%s) is pressed and its stream found", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).toContain("/beacon/consent-accepted");
    expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
  });

  // What the link rule must not take in: a submit beside the sentence, a nav
  // link in a block of its own, and a sentence apart from the button.
  test.each([
    ["n1", "a checkout form's submit beside a cookie-policy link"],
    ["n2", "a nav link ahead of a notice"],
    ["n3", "the link's sentence and the button in separate blocks"],
  ])("%s (%s) is not pressed", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).not.toContain("/beacon/consent-accepted");
    expect((outcome as AppError).code).toBe("NO_MEDIA_FOUND");
  });

  // Still lost, and measured: r2's only wording is an aria-label, which is not
  // prose; r5b's sentence is hidden through both provocation passes.
  test.each([
    ["r2", "wording only in aria-label"],
    ["r5b", "the sentence shown at 6 s"],
  ])("%s (%s) is not pressed", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).not.toContain("/beacon/consent-accepted");
    expect((outcome as AppError).code).toBe("NO_MEDIA_FOUND");
  });
});
