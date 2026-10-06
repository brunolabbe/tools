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
 * second job's link followed while the first is still streaming.
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

  // Two jobs from the one analysis. Each press waits for its card, so the
  // second cannot race the first one's creation.
  const cards = page.getByRole("listitem").filter({ hasText: slow.masterUrl });
  const press = page.getByRole("button", { name: "Download", exact: true });
  await press.click();
  await expect(cards).toHaveCount(1);
  await press.click();
  await expect(cards).toHaveCount(2);

  // Newest first: the older job is the one that holds the slot.
  const holder = cards.nth(1);
  const refused = cards.nth(0);
  const holderLink = holder.getByRole("link", { name: "Download", exact: true });
  const refusedLink = refused.getByRole("link", { name: "Download", exact: true });
  await expect(holderLink).toBeVisible();
  await expect(refusedLink).toBeVisible();

  await holderLink.click();
  // Inside the delayed first segment, so the slot is certainly still held.
  await page.waitForTimeout(1500);
  await refusedLink.click();

  // --- What the page says ------------------------------------------------
  const alert = refused.getByRole("alert");
  await expect(alert).toBeVisible();
  // The reason, in the server's own words, and when to try again.
  await expect(alert).toContainText(/as many downloads running or waiting as this server allows/iu);
  await expect(alert).toContainText("Wait 30 s before trying again.");
  // Not spent, and still on offer.
  await expect(refusedLink).toBeVisible();
  await expect(refused.getByText(/^works once · expires in/u)).toBeVisible();
  // The holder is untouched by its sibling's refusal.
  await expect(holder.getByRole("alert")).toHaveCount(0);

  // --- And it really was not spent ---------------------------------------
  // Once the first download finishes the slot is free, and the same link works.
  await expect(holder.getByText("Saved by your browser. The server kept no copy.")).toBeVisible({
    timeout: 120_000,
  });
  const [second] = await Promise.all([page.waitForEvent("download"), refusedLink.click()]);
  await second.path();
  expect(await second.failure()).toBeNull();
  await expect(refused.getByText("Saved by your browser. The server kept no copy.")).toBeVisible({
    timeout: 120_000,
  });
  // The refusal does not outlive the attempt it described.
  await expect(refused.getByRole("alert")).toHaveCount(0);
});
