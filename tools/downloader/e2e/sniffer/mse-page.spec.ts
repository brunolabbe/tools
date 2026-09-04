/**
 * The headline capability, in one piece: a page whose `<video>` carries a
 * `blob:` URL, the stream found at the network layer by a real Chromium inside
 * the API, and a playable file at the end of it (dl-16).
 *
 * Every part of this has coverage already, and none of it in one piece:
 * `resolvers/test/browser/` drives a real browser with **fake** parsers,
 * `engine/test/hls-e2e.test.ts` downloads from a `ProbeResult` handed to it,
 * and `e2e/download.spec.ts` runs the whole stack with the sniffer switched
 * off. Nothing else takes a blob-only page all the way to a file.
 *
 * It is also the only test anywhere that exercises sniffer, egress proxy, SSRF
 * guard and a loopback fixture origin together. Since dl-12 the browser tier
 * egresses through the loopback proxy, and Playwright launches Chromium with
 * `--proxy-bypass-list=<-loopback>`, so even `127.0.0.1` goes *through* it —
 * this page therefore loads only because `SSRF_ALLOW_HOSTS` opened the guard
 * for both the direct fetches and everything the page itself requests.
 *
 * The server this runs against is `playwright.sniffer.config.ts`; the suite is
 * `npm run e2e:downloader:sniffer` and it is deliberately one spec, because the
 * API is holding a browser open while Playwright holds another.
 */

import { expect, test } from "@playwright/test";
import { collectCspViolations, cspViolationsOn } from "../csp-violations.ts";
import {
  PLAYER_ERROR_PATH,
  PREVIEW_PATH,
  PREVIEW_WIDTH,
  startHlsOrigin,
} from "../fixtures/hls-origin.ts";
import type { HlsOrigin } from "../fixtures/hls-origin.ts";

/** A browser probe is 10-20 s of page load, provocation and network quiet. */
const PROBE_TIMEOUT_MS = 120_000;

let hls: HlsOrigin;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
});

test.afterAll(async () => {
  await hls.close();
});

/** Anything the fixture player could not fetch, in the order it gave up. */
function playerErrors(): string[] {
  return hls.requests.filter((url) => url.startsWith(PLAYER_ERROR_PATH));
}

// The page runs inside the API's Chromium, so a fixture-side fetch failure is
// invisible from here: the probe simply finds nothing and the assertion below
// times out with no cause. The beacon lands in the origin's request log, and
// this puts it in the report next to the failure it explains.
test.afterEach(async () => {
  const failures = playerErrors();
  if (failures.length > 0) {
    // `test.info()` rather than the hook's second argument: Playwright rejects a
    // first parameter that is not a destructuring pattern, and `{}` to get at
    // the second is a worse sentence than this.
    await test.info().attach("fixture-player-errors", {
      body: failures.join("\n"),
      contentType: "text/plain",
    });
  }
});

test("finds a blob-only stream through the sniffer and downloads it", async ({ page, request }) => {
  // dl-35, and this suite is not an arbitrary home for it. The preview is only
  // ever rendered when a probe produced a `thumbnailPath`, and the browser tier
  // is the only resolver that reads an `og:image` at all — so this is the one
  // e2e configuration where dl-29's pipeline runs end to end, and therefore the
  // only place `img-src 'self'` can be shown not to have broken it.
  await collectCspViolations(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /downloader/iu })).toBeVisible();
  // The bundle bakes its transport in at build time, so a mock build would
  // sail through everything below against fake data.
  await expect(page.getByText(/mock/iu)).toHaveCount(0);

  await page.getByLabel("Page address").fill(hls.watchUrl);
  await page.getByRole("button", { name: "Analyse" }).click();

  // --- The wait the user actually sees ------------------------------------
  // A sniffer probe is the longest thing this product does, and this is the
  // only test that watches it happen. If the analysing panel were a blank
  // screen for twenty seconds, nothing else would notice.
  //
  // **This block only holds while a probe is genuinely in flight, so it is
  // where the suite goes red first if the sniffer is off.** Measured: with
  // `ENABLE_BROWSER_RESOLVER=false` the direct tier refuses this HTML page in
  // well under a second, the panel is replaced by "No video found" before the
  // count below resolves, and the failure reads "expected 5, got 0". If that
  // is what you are looking at, check which tiers the server was started with
  // before suspecting the panel.
  const analysing = page.getByRole("region", { name: "Analysing" });
  await expect(analysing).toBeVisible();
  await expect(analysing.getByText(hls.watchUrl)).toBeVisible();
  await expect(analysing.getByRole("listitem")).toHaveCount(5);
  // The elapsed counter reaching a second is what separates a live panel from
  // a static one; a browser launch alone takes longer than that.
  await expect(analysing.getByText(/^[1-9]\d*s$/u)).toBeVisible();

  // --- The probe ----------------------------------------------------------
  // The page writes the scheme of `video.src` into its own title, the probe
  // reads the title, and the UI renders it as this heading. So the assertion
  // that DOM scraping had nothing to find survives all the way to the screen.
  await expect(page.getByRole("heading", { name: /\[blob\]/u })).toBeVisible({
    timeout: PROBE_TIMEOUT_MS,
  });

  // Half of "this is a sniffer test": the origin was asked for the *page*.
  // Asserted here, against traffic this run produced on its own, before the
  // check at the end adds a request of its own.
  expect(hls.requests).toContain("/watch");

  const variants = page.getByRole("table");
  await expect(variants).toBeVisible();
  // Scoped to the table: the theme toggle is a radio group too.
  const renditions = variants.getByRole("radio");
  // Two renditions, which only exist because a real parser read the master
  // playlist the sniffer captured off the wire.
  await expect(renditions).toHaveCount(2);
  await expect(variants.getByText("HLS").first()).toBeVisible();

  // --- The preview, rendering under the policy (dl-35) --------------------
  // Located by its `src` rather than by a class: `Preview` renders `alt=""`,
  // so the element is presentational and has no role to select on, and the
  // path is the part that is load-bearing anyway.
  const preview = page.locator('img[src^="/api/thumbnail/"]');
  // The probe produced a preview at all — this is the assertion that fails if
  // the `og:image` never reached `thumbnailPath`.
  await expect(preview).toBeVisible();
  // **This is the one that catches a wrong `img-src`, and the line above is
  // not.** Measured, by serving `img-src 'none'` and running this spec: the
  // element stayed in the DOM and stayed visible — `Preview`'s `onError` did
  // not remove it — and only `naturalWidth` moved, from 64 to 0. So "the
  // preview is on the page" and "the preview rendered" really are different
  // claims here, exactly as dl-35 predicted, and only the second one is worth
  // asserting. 64 rather than "greater than 0" because the fixture's own width
  // says these are the fixture's bytes: fetched by the API through the SSRF
  // guard from the page's `og:image`, and re-served same-origin.
  await expect
    .poll(async () => await preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(PREVIEW_WIDTH);
  // The other end of the same claim: the origin was asked for the image, by
  // this service. The browser never sees that address — which is the whole of
  // dl-29 and the reason `img-src` can be `'self'` alone.
  expect(hls.requests).toContain(PREVIEW_PATH);

  const chosen = renditions.last();
  await chosen.check();
  await expect(chosen).toBeChecked();

  // --- Download -----------------------------------------------------------
  // Everything before this line was the probe, including the one segment the
  // fixture player fetches for itself. Requests from here on are the download
  // — plus the re-probe the API runs first, which replays the page and so
  // fetches that same one segment again.
  const beforeDownload = hls.requests.length;

  await page.getByRole("button", { name: "Download", exact: true }).click();

  const job = page.getByRole("listitem").filter({ hasText: hls.watchUrl }).first();
  await expect(job).toBeVisible();

  const link = job.getByRole("link", { name: "Download file" });
  await expect(link).toBeVisible({ timeout: PROBE_TIMEOUT_MS });
  await expect(job.getByText("Ready", { exact: true }).first()).toBeVisible();

  // --- The file -----------------------------------------------------------
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/files\//u);

  const response = await request.get(href ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");

  const body = await response.body();
  // A real MP4 and not an error page: bytes 4-8 of an MP4 are the `ftyp` box.
  expect(body.subarray(4, 8).toString("latin1")).toBe("ftyp");
  expect(body.byteLength).toBeGreaterThan(10_000);

  // ffmpeg pulled the ladder itself. **Distinct** names, not a count: the
  // fixture player fetches one segment on every page load, so a plain count
  // would be satisfied by the re-probe alone.
  const segments = hls.requests.slice(beforeDownload).filter((url) => url.endsWith(".ts"));
  expect(new Set(segments).size).toBeGreaterThan(1);

  // The fixture player got everything it asked for. Without this a page that
  // half-worked — master fetched, segment 404 — could still satisfy everything
  // above and leave the suite passing over a broken fixture.
  expect(playerErrors()).toEqual([]);

  // --- The other half of "this is a sniffer test" -------------------------
  // Without this the suite would still pass against a fixture that simply
  // linked to its own manifest — which is the case the direct tier covers and
  // this one is supposed to be unable to fall back to.
  const html = await (await request.get(hls.watchUrl)).text();
  expect(html).not.toContain(hls.masterUrl);
  expect(html).not.toContain("/master.m3u8");
  // Not the master, not the media playlist, not even the extension: the markup
  // names no playlist at all, so nothing short of watching the network finds
  // one.
  expect(html).not.toContain(".m3u8");

  // dl-35. Last, so it covers the probe, the preview and the download alike:
  // nothing on this journey was refused by the policy. The preview assertions
  // above prove the image arrived; this proves nothing *else* was quietly
  // dropped on the way.
  expect(await cspViolationsOn(page)).toEqual([]);
});
