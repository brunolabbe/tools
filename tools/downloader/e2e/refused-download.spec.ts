/**
 * dl-77: a download the server refuses says why, in the page.
 *
 * The job's Download link is a plain `<a href download>` (dl-53), so the
 * browser follows it and the page never hears the answer. When the server
 * refuses before the link is spent - a client at its cap, a full wait line -
 * the browser saves a failed file named after the token, and the card kept
 * saying "Starts when you open the download link", which is exactly what the
 * visitor had just done. The API now publishes the refusal on the job's event
 * stream, and the box reads it from there.
 *
 * **Rewritten around dl-133's wait.** The page now holds a third Download back
 * itself, in the browser, until one of the two before it ends — so the page
 * never sends the request that production's cap refuses. What is left to prove
 * is the case the page cannot see: a server that refuses anyway (another tab on
 * the same address, CGNAT). `MAX_JOBS_PER_CLIENT=1` (see `playwright.config.ts`)
 * is that server here: the page counts one job in flight, under its own two, and
 * starts the second; the server, at one, refuses it.
 *
 * The run: a proxy that holds every segment back so the first download stays
 * open, two boxes analysing the same address — one analysis, one job each — and
 * the second box's Download pressed while the first is still streaming. The
 * box's Download opens its job's link itself, so that press is the attempt that
 * is refused.
 */

import { expect, test } from "@playwright/test";
import { startDelayingProxy, startHlsOrigin } from "./fixtures/hls-origin.ts";
import type { DelayingProxy, HlsOrigin } from "./fixtures/hls-origin.ts";

/** Per segment; the fixture clip has three, so the first download stays open for ~7 s. */
const SEGMENT_DELAY_MS = 2500;

let hls: HlsOrigin;
let slow: DelayingProxy;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
  slow = await startDelayingProxy(hls, SEGMENT_DELAY_MS);
});

test.afterAll(async () => {
  await slow.close();
  await hls.close();
});

test("a download refused at the per-client cap says why and stays usable", async ({ page }) => {
  await page.goto("/");
  // Two boxes from the same address; the field keeps it after Analyse.
  await page.getByLabel("Page address").fill(slow.masterUrl);
  await page.getByRole("button", { name: "Analyse" }).click();
  await page.getByRole("button", { name: "Analyse" }).click();

  const boxes = page.getByRole("list", { name: "Analyses" }).locator(":scope > li");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.getByRole("table")).toHaveCount(2);

  // Newest first: the older box, below, is the one that will hold the slot.
  const holder = boxes.nth(1);
  const refused = boxes.nth(0);
  await holder.getByRole("button", { name: "Download", exact: true }).click();
  // The first link is spent once the server has taken it, which is also when it
  // takes the slot — so the second press cannot race the first one's opening.
  await expect(holder.getByRole("progressbar")).toBeVisible();
  await expect(holder.getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
  await refused.getByRole("button", { name: "Download", exact: true }).click();

  // Still two boxes: each job is the box its analysis was, with no list of its own.
  await expect(boxes).toHaveCount(2);
  const refusedLink = refused.getByRole("link", { name: "Download", exact: true });

  // --- What the page says ------------------------------------------------
  const alert = refused.getByRole("alert");
  await expect(alert).toBeVisible();
  // The reason, in the server's own words, and when to try again.
  await expect(alert).toContainText(/as many downloads running or waiting as this server allows/iu);
  await expect(alert).toContainText("Wait 30 s before trying again.");
  // Not spent, and still on offer.
  await expect(refusedLink).toBeVisible();
  await expect(refused.getByText(/the link works once · expires in/u)).toBeVisible();
  // The holder is untouched by its sibling's refusal.
  await expect(holder.getByRole("alert")).toHaveCount(0);

  // --- And it really was not spent ---------------------------------------
  // Once the first download finishes the slot is free, and the same link works.
  await expect(holder.getByText(/^Saved by your browser — /u)).toBeVisible({
    timeout: 120_000,
  });
  const [second] = await Promise.all([page.waitForEvent("download"), refusedLink.click()]);
  await second.path();
  expect(await second.failure()).toBeNull();
  await expect(refused.getByText(/^Saved by your browser — /u)).toBeVisible({
    timeout: 120_000,
  });
  // The refusal does not outlive the attempt it described.
  await expect(refused.getByRole("alert")).toHaveCount(0);
});
