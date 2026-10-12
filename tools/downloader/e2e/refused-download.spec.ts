/**
 * dl-77: a download the server refuses says why, in the page.
 *
 * The job card's Download button is a plain `<a href download>` (dl-53), so the
 * browser follows it and the page never hears the answer. When the server
 * refuses before the link is spent - a client at its cap, a full wait line -
 * the browser saves a failed file named after the token, and the card kept
 * saying "Starts when you open the download link", which is exactly what the
 * visitor had just done. The API now publishes the refusal on the job's event
 * stream, and the card reads it from there.
 *
 * The run: `MAX_JOBS_PER_CLIENT=1` (see `playwright.config.ts`), a proxy that
 * holds every segment back so the first download stays open, two jobs, and the
 * second job's link followed while the first is still streaming. The panel's
 * Download opens each job's link itself, so the second press is the attempt
 * that is refused.
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
  await page.getByLabel("Page address").fill(slow.masterUrl);
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("table")).toBeVisible();

  // Two jobs from the one analysis, each press opening its own job's link.
  // Every card on the page is from this analysis; the card shows the page's
  // title and host rather than the address (dl-109).
  const cards = page.getByRole("list", { name: "Downloads" }).locator(":scope > li");
  const press = page.getByRole("button", { name: "Download", exact: true });
  await press.click();
  await expect(cards).toHaveCount(1);
  // The first link is spent once the server has taken it, which is also when it
  // takes the slot — so the second press cannot race the first one's opening.
  await expect(cards.getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
  await press.click();
  await expect(cards).toHaveCount(2);

  // Newest first: the older job is the one that holds the slot.
  const holder = cards.nth(1);
  const refused = cards.nth(0);
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
