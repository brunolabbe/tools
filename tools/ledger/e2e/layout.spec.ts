/**
 * repo-109: every screen of the ledger fits a 360 px phone and a 1280 px
 * desktop, with the books full.
 *
 * The rule is `.claude/rules/responsive-layout.md`: the page never scrolls
 * sideways. This spec is how that stays true. For each screen it reaches the
 * screen once, then measures it at both widths on the same page, so a layout
 * that only reflows at a breakpoint is read on both sides of it, and attaches a
 * full-page screenshot of each — a passing assertion over an empty page is the
 * failure to avoid, so look at them.
 *
 * **A screen is a tab.** The shell has no router (`App.tsx`): the twelve tabs
 * are the twelve top-level screens, and the list below is the one
 * `docs/work/repo-109-…` names. A new tab is a new line here, in the pull
 * request that adds it.
 *
 * **The books are seeded through the API**, not through the screens, so each
 * screen opens onto rows: a statement pasted, rules, salaries and their ratio, a
 * closed period and an open one, lines and a recurring item. An empty screen
 * does not prove a full one fits.
 *
 * The suite is not a second run of every other spec at a phone width, which
 * would double e2e time to prove the same seams twice. This is the only file
 * that needs both widths.
 */

// oxlint-disable no-await-in-loop -- one page is resized and read in turn, and the seed's writes are ordered: a period closes over the lines before it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page, PlaywrightWorkerArgs, TestInfo } from "@playwright/test";

/** A phone at its narrowest worth supporting, and a desktop window. */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
] as const;

/**
 * The project is a Pixel 7 (`playwright.config.ts`), which emulates a phone's
 * touch and viewport rules. This spec sets the width itself, at both ends, so
 * it takes those off: one device model for both widths, and the width the only
 * thing that differs.
 */
test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

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
    // A frame for the layout to settle after the resize, and for a chart that
    // measures its container to draw at the new width.
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
    // uploads this directory (`ledger.yml`, e2e job).
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

const here = path.dirname(fileURLToPath(import.meta.url));
/** Where the screenshots are kept: under `.artifacts/`, which is ignored. */
const SHOTS = path.join(here, ".artifacts/layout");
/** The synthetic three-month paste the parser's own tests use: invented rows, shaped like the bank's. */
const PASTE = fs.readFileSync(path.join(here, "../books/test/fixtures/three-months.txt"), "utf8");

/** A 1×1 PNG: the bytes say it is an image, which is all the upload checks. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

async function post(api: APIRequestContext, route: string, data: unknown): Promise<unknown> {
  const response = await api.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBe(true);
  return response.json();
}

/**
 * Fill the household's books through the API, as alex.
 *
 * The rules go in before the paste so the paste files what they match and
 * leaves the rest in the inbox, which is the state a household lives in. The
 * period closes on the last day of the pasted statement, so the next one is
 * open with lines of its own.
 */
async function seed(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string,
): Promise<void> {
  const api = await playwright.request.newContext({ baseURL });

  // Playwright starts a new worker after a failed test and runs this hook in
  // it again, against the same server: the books are already full.
  const closed = (await (await api.get("/api/periods")).json()) as { periods: unknown[] };
  if (closed.periods.length > 0) {
    await api.dispose();
    return;
  }

  await post(api, "/api/rules", {
    descriptionPattern: "Hypothèque /Prêteur Exemple",
    category: null,
    amountCents: null,
    personId: null,
    bucket: "mortgage",
    spendingCategoryId: null,
  });
  await post(api, "/api/rules", {
    descriptionPattern: "Virement entre folios /Caisse du Lac",
    category: null,
    amountCents: 40000,
    personId: "sam",
    bucket: "current-expenses",
    spendingCategoryId: null,
  });
  await post(api, "/api/rules", {
    descriptionPattern: "Virement - AccèsD Internet /Caisse du Lac",
    category: null,
    amountCents: null,
    personId: "alex",
    bucket: "current-expenses",
    spendingCategoryId: null,
  });
  await post(api, "/api/statements", { text: PASTE });

  const { salaries } = (await post(api, "/api/salaries", {
    year: 2026,
    salaries: [
      { personId: "alex", amountCents: 7_200_000 },
      { personId: "sam", amountCents: 5_400_000 },
    ],
  })) as { salaries: { id: number }[] };
  await post(api, "/api/ratios", {
    effectiveFrom: "2026-01-01",
    salaryIds: salaries.map((salary) => salary.id),
  });

  await post(api, "/api/recurring", {
    personId: "alex",
    monthlyCents: 8999,
    startDate: "2026-08-15",
    endDate: null,
    label: "Internet and phone",
  });
  const lines = [
    ["alex", "2026-09-03", -12_345, 1, "Weekly groceries"],
    ["sam", "2026-09-10", -4_550, 3, "Light bulbs and a mop"],
    ["sam", "2026-09-21", -9_800, 4, "Pharmacy, the whole month"],
  ] as const;
  for (const [personId, date, amountCents, spendingCategoryId, note] of lines) {
    await post(api, "/api/period-lines", {
      personId,
      date,
      amountCents,
      category: null,
      spendingCategoryId,
      note,
      chargedTo: null,
    });
  }
  await post(api, "/api/periods/close", { start: null, end: "2026-09-30" });
  await post(api, "/api/period-lines", {
    personId: "alex",
    date: "2026-10-04",
    amountCents: -6_025,
    category: null,
    spendingCategoryId: 1,
    note: "Groceries since the close",
    chargedTo: null,
  });

  await api.dispose();
}

test.beforeAll(async ({ playwright }) => {
  // The project's own base URL: a `beforeAll` has no `baseURL` fixture.
  const baseURL = test.info().project.use.baseURL;
  expect(baseURL).toBeDefined();
  await seed(playwright, baseURL ?? "");
});

/** Open the shell on the Home tab, with the books loaded. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
}

/** Press a tab and wait for its screen to have asked for what it shows. */
async function openTab(page: Page, name: string): Promise<void> {
  await open(page);
  await page.getByRole("navigation", { name: "Screens" }).getByRole("button", { name }).click();
  await expect(
    page.getByRole("navigation", { name: "Screens" }).getByRole("button", { name }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForLoadState("networkidle");
}

/**
 * The tabs that need nothing beyond being opened, each with the text that says
 * its books arrived. Receipt and Paste are below: they are forms, and a form
 * with nothing in it is the state that proves least.
 */
const TABS: readonly (readonly [tab: string, arrived: RegExp])[] = [
  // What each says is a row or a figure from the seed, so a screen is not
  // measured while it is still asking for its books.
  ["Home", /1550\.50/u],
  ["Stats", /Settlements/u],
  ["Period", /Groceries since the close/u],
  ["History", /12 rows match/u],
  ["Inbox", /Frais mensuels/u],
  ["Rules", /Hypothèque \/Prêteur Exemple/u],
  ["Categories", /Rows with no spending category/u],
  ["Salaries", /Ratio in effect: alex 57\.1429/u],
  ["Household", /sam@example\.test added as sam/u],
  ["Admin", /Addresses to admit/u],
];

for (const [tab, arrived] of TABS) {
  test(`${tab} fits a phone and a desktop`, async ({ page }, testInfo) => {
    await openTab(page, tab);
    await expect(page.getByRole("main")).toContainText(arrived);
    await fitsBothWidths(page, testInfo, tab);
  });
}

test("Paste fits a phone and a desktop, previewed and stored", async ({ page }, testInfo) => {
  await openTab(page, "Paste");
  await page.getByRole("textbox").fill(PASTE);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("button", { name: "Confirm and store" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Paste (preview)");

  // The statement the seed stored, so every row is one the books already hold.
  await page.getByRole("button", { name: "Confirm and store" }).click();
  await expect(page.getByRole("button", { name: "Paste another" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Paste (stored)");
});

test("Receipt fits a phone and a desktop, with a photo kept and an item typed", async ({
  page,
}, testInfo) => {
  await openTab(page, "Receipt");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO });
  await page.getByRole("button", { name: "Type it in" }).click();
  // Long enough to wrap in a phone's column: a form with a long entry in it is
  // the case a narrow screen breaks on, and the empty form is the one it does not.
  await page.getByLabel("Merchant").fill("Épicerie du Marché Central, rue Sainte-Catherine Est");
  await page.getByRole("button", { name: "Add an item" }).click();
  const items = page.getByRole("list", { name: "The items" });
  await items.getByRole("textbox").nth(0).fill("Organic rolled oats, the large two-kilogram bag");
  await items.getByRole("textbox").nth(1).fill("12.99");
  await fitsBothWidths(page, testInfo, "Receipt");
});
