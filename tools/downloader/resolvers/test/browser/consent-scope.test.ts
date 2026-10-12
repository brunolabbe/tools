/**
 * Which fixed bars the consent-container rule presses (dl-93), through the real
 * `BrowserResolver`. A file of its own so the rows can be measured alone.
 *
 * Every row is one fixed bar labelled with a phrasing dl-82 added, so only the
 * consent-container rule can press it; pressing it mounts the player.
 *
 * Two kinds of row (dl-113). The `r` rows assert the stream, so they go through
 * the whole resolver. The `c` rows assert only which controls were pressed, never
 * a stream, so they drive `provokePlayback` on the page directly, as
 * `provoke.test.ts` does, and skip the settle and the quiet wait the resolver
 * adds around it.
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { provokePlayback } from "../../src/browser/provoke.ts";
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
  // r3..r9 resolved at dl-82's head and must keep doing so; r7 is the compound
  // word dl-82's word start had given up. r3, r3b, r4, r6 and r8 were rows of
  // their own until dl-113: r3b was r5's markup without the reveal, and the rest
  // differ from r7 only in the sentence and the label, which are strings in
  // `provoke.test.ts` (`CONSENT_WORDING`'s SPEAKS rows, `CONSENT_TEXT`'s ADDED
  // rows). r7 stays as the one wording that goes end to end.
  test.each([
    ["r5", "a bar hidden until 1.2 s"],
    ["r7", "Statistikcookies and Marketingcookies, then Ich stimme zu"],
    ["r9", "a CMP whose text and button sit in separate blocks"],
  ])("%s (%s) is pressed and its stream found", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).toContain("/beacon/consent-accepted");
    expect((outcome as ProbeResult).variants[0]?.url).toBe(server.url(MASTER));
  });
});

describe("a fixed bar whose cookie wording sits in a link or a hidden node stays lost (dl-93)", () => {
  // The owner's decision of 2026-10-10: the link-in-a-sentence signal is
  // withdrawn. r1, r1b and r2b have the shape of c1 and c4 below, a checkout bar
  // and a newsletter popup that link a cookie policy, and no local signal tells
  // them apart; so a link's text is not prose, and these stay lost. r2's only
  // wording is an aria-label, and r5b's sentence is visibility:hidden through
  // both provocation passes.
  test.each([
    ["r1", "Read our <a>cookie policy</a>. [Ho capito]"],
    ["r1b", "We use <a>cookies</a> to improve the site. [Accetto e continua]"],
    ["r2", "wording only in aria-label"],
    ["r2b", "Leggi la <span role=link>cookie policy</span>. [Ho capito]"],
    ["r5b", "the sentence shown at 6 s"],
  ])("%s (%s) is not pressed", { timeout: TEST_TIMEOUT_MS }, async (row) => {
    const { outcome, requests } = await visit(`/consent-bar-rows.html?row=${row}`);

    expect(requests).not.toContain("/beacon/consent-accepted");
    expect((outcome as AppError).code).toBe("NO_MEDIA_FOUND");
  });
});

/**
 * How many times the page beaconed `name` while `provokePlayback` ran on case `c`:
 * both its passes, with the viewport and locale the resolver gives a probe, and
 * nothing else of the resolver's.
 */
async function presses(c: string, name: "bad" | "other"): Promise<number> {
  server.requests.length = 0;
  await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });
    try {
      const page = await context.newPage();
      await page.goto(server.url(`/consent-scope-cases.html?case=${c}`), {
        waitUntil: "domcontentloaded",
      });
      await provokePlayback(page, {
        deadline: Date.now() + 15_000,
        signal: new AbortController().signal,
        confirmAge: false,
      });
      // A beacon fired by the last press is a request still in flight.
      await page.waitForTimeout(200);
    } finally {
      await context.close();
    }
  });
  return server.requests.filter((r) => r === `/beacon/${name}`).length;
}

describe("layers that base left alone are still left alone (dl-93 gate 1)", () => {
  // Every one of these was 0 presses at base. The first six went to 2 when a
  // link in a sentence made a layer a container, and c8 and c9 when "cookie"
  // matched inside any word; the controls c3 and c6 never moved.
  //
  // c7 is also dl-82 gate 3's a3: a sticky header with a cookie link in its nav,
  // which `browser-resolver.test.ts` probed through the whole resolver, shown and
  // in a hidden menu, until dl-113. c15 pins what the hidden-menu probe never
  // did, that a node that is not rendered is not prose.
  test.each([
    ["c1", "an SPA checkout bar that links a cookie policy, a type=button order button"],
    ["c2", "a form bar: a link, a Back button, and a submit"],
    ["c3", "control: c2 without Back, the submit untyped"],
    ["c4", "a newsletter popup that links a cookie policy"],
    ["c5", "a footer line with a Back-to-top button, and a notice"],
    ["c6", "control: c5 with its links in a list"],
    ["c7", "a sticky header's flat nav with a Search button, and a notice"],
    ["c8", "a fixed app root titled Schokocookies, with a newsletter"],
    ["c9", "a cart bar: 3 Schokocookies, a submit"],
    ["c10", "a submit bound by form= from outside its form"],
    ["c15", "a fixed layer whose only cookie text is an inline script's"],
  ])("%s (%s) presses nothing", { timeout: TEST_TIMEOUT_MS }, async (c) => {
    expect(await presses(c, "bad")).toBe(0);
  });
});

describe("what the form and page-content rule does to the cases it was weighed on (dl-93, the owner's decision of 2026-10-10)", () => {
  // The rule: a fixed layer that holds an h1, main, article, video, audio or
  // [role=main], or is itself a <form>, is no consent container through its
  // wording. Pinned both ways, with its costs named as accepted in the ticket.
  test(
    "c11, accepted: a checkout <form> nested inside the fixed layer still has its submit pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      expect(await presses("c11", "bad")).toBeGreaterThan(0);
    },
  );

  test(
    "c12, accepted: a fixed app root with an h2 and no landmark still has its newsletter pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      expect(await presses("c12", "bad")).toBeGreaterThan(0);
    },
  );

  // c13 is dl-82 gate 3's a1, and c14 its a2: the two accepted costs dl-82 pinned,
  // which the owner flipped to "press nothing" on 2026-10-10. `browser-resolver.test.ts`
  // probed each through the whole resolver (a fixed app root with a footer that says
  // "cookie", and a docked checkout form whose prose says "cookie") until dl-113.
  test(
    "c13, accepted cost: a consent notice in the flow of a fixed root that holds an h1 is no longer pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      expect(await presses("c13", "other")).toBe(0);
    },
  );

  test(
    "c14, accepted cost: a consent bar that is itself a <form> is no longer pressed",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      expect(await presses("c14", "other")).toBe(0);
    },
  );
});
