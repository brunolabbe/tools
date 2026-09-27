/**
 * M3, through a browser: paste a URL, pick a quality, watch progress, get a
 * file. The user's whole journey, with nothing stubbed between the click and
 * the bytes.
 *
 * What this proves that no unit test can:
 *
 *  - the built bundle talks to the real API rather than to its own mock;
 *  - SSE actually reaches a browser, so the progress a user sees is progress
 *    that happened, not a timer;
 *  - the link the job hands out streams a playable file to the browser, once
 *    (dl-53), and the card follows it to the end;
 *  - the API and the UI coexist on one origin, which is how the container
 *    serves them.
 */

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { collectCspViolations, cspViolationsOn } from "./csp-violations.ts";
import { startHlsOrigin } from "./fixtures/hls-origin.ts";
import type { HlsOrigin } from "./fixtures/hls-origin.ts";

let hls: HlsOrigin;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
});

test.afterAll(async () => {
  await hls.close();
});

test("paste a URL, pick a quality, and download the file", async ({ page, request }) => {
  // dl-35. Attached before the first navigation, because a subresource the
  // policy refuses is refused while the document is still coming up. This
  // journey is the widest happy path there is — bundle, stylesheet, `fetch`
  // and the SSE stream — so it is the cheapest place to notice a policy that
  // is too strict, and it costs nothing when nothing is wrong.
  await collectCspViolations(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /downloader/iu })).toBeVisible();
  // The bundle bakes its transport in at build time, so a mock build would
  // sail through everything below against fake data. This banner is the UI's
  // own admission that it is mocked, and it must not be here.
  await expect(page.getByText(/mock/iu)).toHaveCount(0);

  await page.getByLabel("Page address").fill(hls.masterUrl);
  await page.getByRole("button", { name: "Analyse" }).click();

  // --- Probe -------------------------------------------------------------
  const variants = page.getByRole("table");
  await expect(variants).toBeVisible();
  // Scoped to the table: the theme toggle is a radio group too.
  const renditions = variants.getByRole("radio");
  // Both renditions from the master playlist, really parsed out of it.
  await expect(renditions).toHaveCount(2);
  await expect(variants.getByText("HLS").first()).toBeVisible();

  // The lower rendition, chosen explicitly: a UI that ignored the selection
  // would otherwise pass on the default.
  const chosen = renditions.last();
  await chosen.check();
  await expect(chosen).toBeChecked();

  // --- Download ----------------------------------------------------------
  await page.getByRole("button", { name: "Download", exact: true }).click();

  const job = page.getByRole("listitem").filter({ hasText: hls.masterUrl }).first();
  await expect(job).toBeVisible();

  // dl-53: creating the job does nothing but hand out a single-use link. The
  // card offers it; following it is what re-probes, runs ffmpeg and streams the
  // file to this browser as it is produced.
  const link = job.getByRole("link", { name: "Download", exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/api\/files\//u);

  // --- The file ----------------------------------------------------------
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const saved = await download.path();
  expect(await download.failure()).toBeNull();
  const body = await readFile(saved);
  // A real MP4 and not an error page: bytes 4-8 of an MP4 are the `ftyp` box,
  // and the box after it is the empty `moov` of a fragmented one.
  expect(body.subarray(4, 8).toString("latin1")).toBe("ftyp");
  expect(body.byteLength).toBeGreaterThan(10_000);
  expect(download.suggestedFilename()).toMatch(/\.mp4$/u);

  // The card followed the stream to its end over SSE, and the link is spent.
  await expect(job.getByText("Saved by your browser. The server kept no copy.")).toBeVisible({
    timeout: 120_000,
  });
  await expect(job.getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
  const again = await request.get(href ?? "");
  expect(again.status()).toBe(410);

  // ffmpeg pulled the segments itself rather than just the playlist — the
  // failure mode where a "download" is a manifest saved to disk.
  const segments = hls.requests.filter((url) => url.endsWith(".ts"));
  expect(segments.length).toBeGreaterThan(1);

  // Last, so it covers everything above: the whole journey ran under the CSP
  // and the browser refused none of it. Most of the directives already have a
  // louder witness here — a refused bundle is a blank page and a refused
  // `EventSource` is a job that never reaches "Downloaded" — so what this adds is
  // the quiet case: something the policy stopped that the UI shrugged off.
  expect(await cspViolationsOn(page)).toEqual([]);
});

test("a URL with no media fails visibly instead of hanging", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Page address").fill(`${hls.origin}/not-a-stream`);
  await page.getByRole("button", { name: "Analyse" }).click();

  // The point is that the user is told. A probe that cannot find a stream is
  // the single most common outcome in the wild, and a UI that just sits there
  // is the difference between "this site is unsupported" and "this is broken".
  await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("the API and the UI share one origin", async ({ request }) => {
  // Same-origin is not a detail: it is why there is no CORS to configure and
  // why EventSource — which cannot send headers and is fussy about origins —
  // works at all. If these ever split, SSE breaks first and cryptically.
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect((await health.json()).ok).toBe(true);

  const page = await request.get("/");
  expect(page.headers()["content-type"]).toContain("text/html");
});
