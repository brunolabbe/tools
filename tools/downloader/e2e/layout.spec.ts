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
 * beside the bundle — and, since dl-133, two boxes on the page at once. A new
 * one is a new test here, in the pull request that adds it.
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
import type { Locator, Page, TestInfo } from "@playwright/test";
import { startDelayingProxy, startHlsOrigin } from "./fixtures/hls-origin.ts";
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
  const card = page.getByRole("list", { name: "Analyses" }).locator(":scope > li").first();
  await expect(card.getByText(/^Saved by your browser — /u)).toBeVisible({ timeout: 120_000 });
  // The saved box, with its Dismiss: this is the page as a person leaves it.
  // The renditions left the box when Download was pressed (dl-133).
  await fitsBothWidths(page, testInfo, "Finished download");
});

test("the terms page fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/terms.html");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await fitsBothWidths(page, testInfo, "Terms");
});

/**
 * repo-131: the shared header at 360 px. Each theme segment is a tap target of
 * at least 44 px both ways, the floor repo-130 sets for every button and field,
 * and the switch sits on the same line as the glyph and the name rather than
 * wrapping under them.
 *
 * **The name is measured twice, once as rendered and once widened**, because
 * whether it fits depends on the font the machine has. This spec passed locally
 * with a 120 px name and failed in CI, where the name was about 159 px and the
 * switch wrapped onto a second row (gate 1, F1). Widening it by CSSOM (a
 * `style` write, which the policy does not govern, where an injected `<style>`
 * would be refused) makes every machine see the wide case.
 */
async function nameBesideSwitch(page: Page): Promise<void> {
  const header = page.getByRole("banner");
  const name = await header.getByRole("heading", { level: 1 }).boundingBox();
  const toggle = await header.getByRole("group", { name: "Colour theme" }).boundingBox();
  expect(name).not.toBeNull();
  expect(toggle).not.toBeNull();
  // On one line: the name's vertical middle falls inside the switch's height.
  const middle = (name?.y ?? 0) + (name?.height ?? 0) / 2;
  expect(middle, "the name's middle against the switch's top").toBeGreaterThanOrEqual(
    toggle?.y ?? Infinity,
  );
  expect(middle, "the name's middle against the switch's bottom").toBeLessThanOrEqual(
    (toggle?.y ?? 0) + (toggle?.height ?? 0),
  );
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.innerWidth);
}

test("the theme switch's segments are 44 px tall at 360 px, beside the name", async ({ page }) => {
  await page.setViewportSize(WIDTHS[0]);
  await page.goto("/");
  const header = page.getByRole("banner");
  const segments = header.locator(".theme-toggle label");
  await expect(segments).toHaveCount(3);

  for (const segment of await segments.all()) {
    const box = await segment.boundingBox();
    expect(box?.height ?? 0, "a theme segment's height").toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, "a theme segment's width").toBeGreaterThanOrEqual(44);
  }

  await nameBesideSwitch(page);

  // The name as wide as CI's font made it, or wider: its width on one line,
  // read from an unconstrained copy, since the heading itself may now wrap.
  const natural = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>("header h1");
    if (heading === null) return 0;
    heading.style.letterSpacing = "0.2em";
    const computed = getComputedStyle(heading);
    const copy = document.createElement("span");
    copy.textContent = heading.textContent;
    copy.style.font = computed.font;
    copy.style.letterSpacing = computed.letterSpacing;
    copy.style.whiteSpace = "nowrap";
    copy.style.position = "absolute";
    copy.style.visibility = "hidden";
    document.body.append(copy);
    const width = copy.getBoundingClientRect().width;
    copy.remove();
    return width;
  });
  expect(natural, "the widened name's width on one line").toBeGreaterThanOrEqual(158.7);
  await nameBesideSwitch(page);
});

test("two boxes analysing side by side fit a phone and a desktop (dl-133)", async ({
  page,
}, testInfo) => {
  // Both probes are held, as the analysing panel's case holds its one, so the
  // two boxes are running for as long as it takes to measure them.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/probe", async (route) => {
    await held;
    await route.abort();
  });

  await page.goto("/");
  const field = page.getByLabel("Page address");
  const analyse = page.getByRole("button", { name: "Analyse" });
  // Two long addresses, one after the other without waiting: the field keeps
  // its value after Analyse, so the second is typed over the first.
  await field.fill(longUrl());
  await analyse.click();
  await field.fill(`${longUrl()}&second=${"fedcba9876543210".repeat(4)}`);
  await analyse.click();

  const boxes = page.getByRole("list", { name: "Analyses" }).locator(":scope > li");
  await expect(boxes).toHaveCount(2);
  for (const box of await boxes.all()) {
    await expect(box.getByRole("heading", { name: "Analysing" })).toBeVisible();
    await expect(box.locator(".stage")).toHaveText(/\S/u);
  }
  await fitsBothWidths(page, testInfo, "Two boxes");
  release?.();
});

test("a box waiting for a probe slot beside two analysing fits a phone and a desktop (dl-133)", async ({
  page,
}, testInfo) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/probe", async (route) => {
    await held;
    await route.abort();
  });

  await page.goto("/");
  const field = page.getByLabel("Page address");
  const analyse = page.getByRole("button", { name: "Analyse" });
  for (const index of [1, 2, 3]) {
    await field.fill(`${longUrl()}&box=${String(index)}`);
    await analyse.click();
  }

  const boxes = page.getByRole("list", { name: "Analyses" }).locator(":scope > li");
  await expect(boxes).toHaveCount(3);
  // Newest first: the third waits, with no request sent, above the two running.
  await expect(boxes.nth(0).getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(boxes.nth(1).getByRole("heading", { name: "Analysing" })).toBeVisible();
  await expect(boxes.nth(2).getByRole("heading", { name: "Analysing" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Waiting analysis");
  release?.();
});

/**
 * A page title of the length some sites give, with spaces: the job's title is
 * the analysis's, and it heads the box through the download. An unbroken one
 * is dl-137's, below.
 */
const LONG_TITLE = Array.from(
  { length: 12 },
  (_, index) => `A rather long page title, part ${String(index + 1)} of twelve`,
).join(" · ");

test("a waiting Download beside a running job and a refused one, under a long title, fits a phone and a desktop (dl-133)", async ({
  page,
}, testInfo) => {
  // Segments held back, so the first job is still streaming while the page is
  // measured; the server's one job per client (`playwright.config.ts`) refuses
  // the second, which stays queued and counted; the page holds the third.
  const slow = await startDelayingProxy(hls, 2500);
  try {
    await page.route("**/api/probe", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { probe: { title: string } };
      body.probe.title = LONG_TITLE;
      await route.fulfill({ response, json: body });
    });

    await page.goto("/");
    await page.getByLabel("Page address").fill(slow.masterUrl);
    const analyse = page.getByRole("button", { name: "Analyse" });
    for (let index = 0; index < 3; index++) await analyse.click();

    const boxes = page.getByRole("list", { name: "Analyses" }).locator(":scope > li");
    await expect(boxes).toHaveCount(3);
    await expect(boxes.getByRole("table")).toHaveCount(3);
    const download = (index: number) =>
      boxes.nth(index).getByRole("button", { name: "Download", exact: true });

    // The oldest first: it takes the server's slot once its link is spent.
    await download(2).click();
    await expect(boxes.nth(2).getByRole("progressbar")).toBeVisible();
    await expect(boxes.nth(2).getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
    await download(1).click();
    await expect(boxes.nth(1).getByRole("alert")).toBeVisible();
    await download(0).click();
    await expect(boxes.nth(0).locator(".stage")).toHaveText(
      "Waiting for one of your other downloads to finish",
    );
    await expect(boxes.getByRole("heading", { name: LONG_TITLE })).toHaveCount(3);

    await fitsBothWidths(page, testInfo, "Waiting download");

    // Left as found for the specs after this one, which need the server's one
    // job slot: the wait is put back, then both jobs are stopped.
    await boxes.nth(0).getByRole("button", { name: "Stop waiting" }).click();
    for (const index of [1, 2]) {
      await boxes.nth(index).getByRole("button", { name: "Stop", exact: true }).click();
      await expect(boxes.nth(index).getByRole("button", { name: "Dismiss" })).toBeVisible();
    }
  } finally {
    await slow.close();
  }
});

/**
 * dl-137: a string with no break points in a heading or a notice. A page's own
 * `<title>`, an address a restored job falls back to, and a stored error
 * message are text this page does not write, and one with no spaces is as wide
 * as it is long unless the element is allowed to break it. 200 characters is
 * wider than a desktop column as well as a phone, so both widths are read.
 */
const UNBROKEN = "T".repeat(200);
const UNBROKEN_MESSAGE = "M".repeat(200);
const UNBROKEN_ADDRESS = `https://example.test/${"u".repeat(210)}`;

/**
 * The string is wrapped, not cut: its text is the whole string, its box is
 * taller than one and a half lines, and the text does not run past the box's
 * own edge. A heading clipped to a letter would pass `fitsBothWidths` alone.
 * The box alone is not the proof either: an element that cannot break its text
 * stays narrow and one line tall while the text spills out of it, so the
 * overflow is read too. The height is measured against the computed
 * `line-height`, which is a pixel value here (the shared base sets 1.55) and
 * falls back to the font size if a stylesheet ever sets `normal`.
 */
async function wrapsWhole(page: Page, locator: Locator, text: string): Promise<void> {
  for (const { width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await expect(locator).toHaveText(text);
    const box = await locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      const lineHeight = Number.parseFloat(computed.lineHeight);
      return {
        height: element.getBoundingClientRect().height,
        right: element.getBoundingClientRect().right,
        innerWidth: window.innerWidth,
        line: Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(computed.fontSize),
        spill: element.scrollWidth - element.clientWidth,
      };
    });
    const at = `at ${String(width)} px`;
    expect
      .soft(box.height, `taller than one and a half lines ${at}`)
      .toBeGreaterThan(box.line * 1.5);
    expect
      .soft(box.right, `right edge inside the window ${at}`)
      .toBeLessThanOrEqual(box.innerWidth);
    expect.soft(box.spill, `the text runs past its box ${at}`).toBeLessThanOrEqual(0);
  }
}

/** The probe's answer, with the page's title swapped for `title`. */
async function answerWithTitle(page: Page, title: string): Promise<void> {
  await page.route("**/api/probe", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { probe: { title: string } };
    body.probe.title = title;
    await route.fulfill({ response, json: body });
  });
}

/**
 * A failed job as `downloader:jobs:v1` holds it, with no title stored beside it.
 * `variant: null` is what sends the heading to the address; a variant sends it
 * to its label, which is short.
 */
async function seedFailedJob(
  page: Page,
  options: { sourceUrl: string; message: string; label: string | null },
): Promise<void> {
  await page.addInitScript((seed) => {
    const now = new Date().toISOString();
    const job = {
      id: "restored-1",
      sourceUrl: seed.sourceUrl,
      variantId: seed.label === null ? null : "v1",
      variant:
        seed.label === null
          ? null
          : {
              id: "v1",
              protocol: "hls",
              url: "https://example.test/v1.m3u8",
              hasVideo: true,
              label: seed.label,
            },
      status: "failed",
      progress: {
        stage: "failed",
        percent: null,
        downloadedBytes: 0,
        totalBytes: null,
        segmentsDone: null,
        segmentsTotal: null,
        speedBps: null,
        etaSec: null,
        processedSec: null,
        originConnections: null,
      },
      result: null,
      error: { code: "VARIANT_GONE", message: seed.message, retryable: false },
      attempts: 1,
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
    };
    globalThis.localStorage.setItem("downloader:jobs:v1", JSON.stringify([job]));
  }, options);
}

test("an unbroken page title in the analysis box's heading wraps (dl-137)", async ({
  page,
}, testInfo) => {
  await answerWithTitle(page, UNBROKEN);
  await page.goto("/");
  await page.getByLabel("Page address").fill(longUrl());
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  const heading = page.getByRole("heading", { name: UNBROKEN, exact: true });
  await wrapsWhole(page, heading, UNBROKEN);
  await fitsBothWidths(page, testInfo, "Unbroken title, analysis");
});

test("an unbroken page title in a running job's heading wraps (dl-137)", async ({
  page,
}, testInfo) => {
  // Segments held back, so the job is still downloading while it is measured.
  const slow = await startDelayingProxy(hls, 2500);
  try {
    await answerWithTitle(page, UNBROKEN);
    await page.goto("/");
    await page.getByLabel("Page address").fill(slow.masterUrl);
    await page.getByRole("button", { name: "Analyse" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const box = page.getByRole("list", { name: "Analyses" }).locator(":scope > li").first();
    await expect(box.getByRole("progressbar")).toBeVisible();
    const heading = box.getByRole("heading", { name: UNBROKEN, exact: true });
    await wrapsWhole(page, heading, UNBROKEN);
    await fitsBothWidths(page, testInfo, "Unbroken title, running job");

    // Left as found for the specs after this one, which need the server's one
    // job slot.
    await box.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(box.getByRole("button", { name: "Dismiss" })).toBeVisible();
  } finally {
    await slow.close();
  }
});

test("a restored job's address as its heading wraps (dl-137)", async ({ page }, testInfo) => {
  await seedFailedJob(page, { sourceUrl: UNBROKEN_ADDRESS, message: "It failed.", label: null });
  await page.goto("/");
  const heading = page.getByRole("heading", { name: UNBROKEN_ADDRESS, exact: true });
  await wrapsWhole(page, heading, UNBROKEN_ADDRESS);
  await fitsBothWidths(page, testInfo, "Unbroken address, restored job");
});

test("a restored job's unbroken error message wraps (dl-137)", async ({ page }, testInfo) => {
  await seedFailedJob(page, {
    sourceUrl: "https://example.test/page",
    message: UNBROKEN_MESSAGE,
    label: "720p",
  });
  await page.goto("/");
  const message = page.locator("p.notice__message");
  await wrapsWhole(page, message, UNBROKEN_MESSAGE);
  await fitsBothWidths(page, testInfo, "Unbroken message, restored job");
});

test("a title with spaces still wraps at them (dl-137)", async ({ page }, testInfo) => {
  const words = Array.from({ length: 40 }, () => "abcde").join(" ");
  await answerWithTitle(page, words);
  await page.goto("/");
  await page.getByLabel("Page address").fill(longUrl());
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  const heading = page.getByRole("heading", { name: words, exact: true });
  await wrapsWhole(page, heading, words);
  await fitsBothWidths(page, testInfo, "Spaced title");
});
