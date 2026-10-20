/**
 * repo-109: every screen of the downloader fits a 360 px phone and a 1280 px
 * desktop, with something on the page.
 *
 * The rule is `.claude/rules/responsive-layout.md`: the page never scrolls
 * sideways. For each screen this reaches it once, then measures it at both
 * widths on the same page, so a layout that only reflows at a breakpoint is
 * read on both sides of it, and attaches a full-page screenshot of each — a
 * passing assertion over an empty page is the failure to avoid, so look at them.
 *
 * **The screens are the page's view states** (`web/src/App.tsx`, no router),
 * the ones `docs/work/repo-109-…` lists: the address form, the analysing panel,
 * the renditions table, a finished download's card, and the terms page that sits
 * beside the bundle. A new one is a new test here, in the pull request that
 * adds it.
 *
 * Two of them carry a long address on purpose. A URL is the one piece of
 * content here that has no break points, which is how a narrow column ends up
 * wider than the window.
 *
 * This is not a second run of every spec at a phone width, which would double
 * e2e time to prove the same seams twice: the journey is walked at the
 * desktop's default size, and only the measuring is done twice.
 */

// oxlint-disable no-await-in-loop -- one page is resized and read in turn: the screenshot is of the width just set.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { startHlsOrigin } from "./fixtures/hls-origin.ts";
import type { HlsOrigin } from "./fixtures/hls-origin.ts";

/** A phone at its narrowest worth supporting, and a desktop window. */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
/** Where the screenshots are kept: under `.artifacts/`, which is ignored. */
const SHOTS = path.join(here, ".artifacts/layout");

/**
 * Measure the page at each width and attach what it looked like.
 *
 * `scrollWidth` is the width of everything the page lays out, `innerWidth` the
 * window's: a document wider than the window is a page that scrolls sideways.
 * `expect.soft`, so one screen failing at both widths says so twice rather than
 * hiding the second.
 */
async function fitsBothWidths(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  for (const { width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    // A frame for the layout to settle after the resize.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${screen} at ${String(width)}px`, {
      body: shot,
      contentType: "image/png",
    });
    // Also on disk, because a passing test's attachments are deleted with its
    // output directory, and a screenshot nobody can open proves nothing. CI
    // uploads this directory (`downloader.yml`, e2e job).
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${screen}-${String(width)}.png`), shot);
    expect
      .soft(
        measured.scrollWidth,
        `${screen} is ${String(measured.scrollWidth)} px wide in a ${String(measured.innerWidth)} px window`,
      )
      .toBeLessThanOrEqual(measured.innerWidth);
  }
}

let hls: HlsOrigin;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
});

test.afterAll(async () => {
  await hls.close();
});

/**
 * The fixture's own master playlist behind a long, unbroken query string: a
 * real address (the origin ignores the query) of the length a tracking link
 * or a signed one has.
 */
function longUrl(): string {
  return `${hls.masterUrl}?session=${"0123456789abcdef".repeat(12)}`;
}

test("the address form fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByLabel("Page address")).toBeVisible();
  // A long address typed into it: the field is where one first lands.
  await page.getByLabel("Page address").fill(longUrl());
  await fitsBothWidths(page, testInfo, "Address form");
});

test("the analysing panel fits a phone and a desktop, over a long address", async ({
  page,
}, testInfo) => {
  // The probe is held rather than answered, so the panel is on screen for as
  // long as it takes to measure it twice. Released at the end so the request is
  // not left dangling when the page closes.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/probe", async (route) => {
    await held;
    await route.abort();
  });

  await page.goto("/");
  await page.getByLabel("Page address").fill(longUrl());
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Analysing");
  release?.();
});

test("the renditions table fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Page address").fill(longUrl());
  await page.getByRole("button", { name: "Analyse" }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  // Both renditions of the master playlist are rows, so it is the full table.
  await expect(table.getByRole("radio")).toHaveCount(2);
  await fitsBothWidths(page, testInfo, "Renditions");
});

test("a finished download's card fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Page address").fill(longUrl());
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("table")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  await download.path();
  const card = page.getByRole("list", { name: "Downloads" }).locator(":scope > li").first();
  await expect(card.getByText(/^Saved by your browser — /u)).toBeVisible({ timeout: 120_000 });
  // The renditions are still above it: this is the page as a person leaves it.
  await fitsBothWidths(page, testInfo, "Finished download");
});

test("the terms page fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/terms.html");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await fitsBothWidths(page, testInfo, "Terms");
});
