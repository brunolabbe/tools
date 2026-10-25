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
import type {
  APIRequestContext,
  Locator,
  Page,
  PlaywrightWorkerArgs,
  TestInfo,
} from "@playwright/test";

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
async function fitsBothWidths(
  page: Page,
  testInfo: TestInfo,
  screen: string,
  /** What else is true of the screen at this width: a measure `scrollWidth` cannot make (lg-64). */
  also?: (page: Page, width: number) => Promise<void>,
): Promise<void> {
  for (const { width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    // A frame for the layout to settle after the resize, and for a chart that
    // measures its container to draw at the new width.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await also?.(page, width);
    await cardsStandApart(page, screen, `${screen} at ${String(width)} px`);
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

/**
 * lg-70: no two cards touch. `main` spaces its children with a grid gap, which
 * reaches only its own children, so Admin's cards, kept in one section of their
 * own, stacked flush, and `scrollWidth` cannot see a gap that is missing. Each
 * card that is not inside another is read against the one before it, and the
 * space between them must be at least `main`'s gap. `CARDS` says how many a
 * screen draws at least, so a screen whose cards lost their class compares
 * nothing and fails rather than passing.
 */
async function cardsStandApart(page: Page, screen: string, at: string): Promise<void> {
  const { gap, spaces } = await page.locator("main").evaluate((main) => {
    const cards = [...main.querySelectorAll(".card")]
      .filter((card) => card.parentElement?.closest(".card") === null)
      .map((card) => card.getBoundingClientRect())
      .filter((box) => box.height > 0);
    return {
      gap: Number.parseFloat(getComputedStyle(main).rowGap),
      spaces: cards.slice(1).map((box, index) => box.top - (cards[index]?.bottom ?? 0)),
    };
  });
  expect.soft(spaces.length + 1, `${at}: the cards`).toBeGreaterThanOrEqual(CARDS[screen] ?? 0);
  spaces.forEach((space, index) => {
    expect
      .soft(
        space,
        `${at}: card ${String(index + 2)} is ${String(space)} px below card ${String(index + 1)}`,
      )
      .toBeGreaterThanOrEqual(gap - 0.5);
  });
}

/**
 * lg-70: a chart's gridlines are drawn. A `<line>` has no stroke unless a rule
 * gives it one, and from #539 to lg-70 none did: a rule put inside the gridlines'
 * selector list took their stroke away, and the charts lost every gridline but the
 * baseline. Chromium's computed stroke is read, so it is the rule that applies
 * which is held, not the text of the stylesheet.
 */
async function gridlinesDrawn(page: Page, width: number): Promise<void> {
  const strokes = await page
    .locator("svg.chart line.grid")
    .evaluateAll((lines) => lines.map((line) => getComputedStyle(line).stroke));
  expect(strokes.length, `Stats at ${String(width)} px: the gridlines`).toBeGreaterThan(0);
  expect(
    strokes.filter((stroke) => stroke === "none"),
    `Stats at ${String(width)} px: gridlines with no stroke`,
  ).toEqual([]);
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
 * The tabs that need nothing beyond being opened, each with what must be on the
 * screen before it is measured. Receipt and Paste are below: they are forms, and
 * a form with nothing in it is the state that proves least.
 *
 * **Every entry is a row or a figure, never a heading.** A heading is rendered
 * while the screen is still loading, when its request has failed, and over empty
 * books, and a screen measured in any of those states is not the screen this spec
 * is about. Admin and Household have no seed of the spec's own: what they show is
 * the household directory, which the `e2e:ledger:serve` script fills before the
 * API boots, so their entries are those, and Household passes over empty books.
 * Stats renders 10 cards and the patterns cover 9 of them: "Put into the
 * mortgage" shows "Nothing was filed to a person in this range." over the seed,
 * and its series, `contributions`, is already covered by "Put into the buffer".
 * Each of the 8 series that Stats draws is asserted, so one that did not arrive
 * fails the case rather than going unmeasured.
 */
const TABS: readonly (readonly [tab: string, arrived: readonly RegExp[]])[] = [
  ["Home", [/1550\.50/u]],
  [
    "Stats",
    [
      /700\.00 \$/u, // mortgage payment
      /-1050\.00 \$/u, // own money in the mortgage
      /750\.50 \$/u, // put into the buffer
      /1550\.50 \$/u, // buffer balance
      /72000\.00 \$/u, // salaries
      /57\.1429 %/u, // ratio
      /-60\.25 \$/u, // spending, the open period
      /89\.99 \$/u, // fixed items
      /29\.27 \$/u, // settlements
    ],
  ],
  ["Period", [/Groceries since the close/u]],
  ["History", [/12 rows match/u]],
  ["Inbox", [/Frais mensuels/u]],
  ["Rules", [/Hypothèque \/Prêteur Exemple/u]],
  ["Categories", [/12 rows, newest first/u, /Frais mensuels/u]],
  ["Salaries", [/Ratio in effect: alex 57\.1429/u]],
  ["Household", [/sam@example\.test added as sam/u]],
  ["Admin", [/Test household/u, /sam@example\.test/u]],
];

/**
 * lg-64: a radio sits beside its own label, and is the size of a radio.
 *
 * `scrollWidth` cannot see either failure: the global `input` rule gave a radio
 * `width: 100%`, so it drew a box a row wide (Household, where the label was
 * squeezed beside it) or a box with its label on the line below (Salaries,
 * where `.choice` is not a flex row). Each radio is read for three things:
 * its box is no wider than it is tall, its label's text starts on the radio's
 * own line and to its right, and the labels of its group are one to a row.
 * `count` is how many the screen draws, so a screen that rendered none does
 * not pass for one with the right layout.
 */
function radiosBesideTheirLabels(count: number, screen: string) {
  return async (page: Page, width: number): Promise<void> => {
    const at = `${screen} at ${String(width)} px`;
    await expect(page.getByRole("radio"), `${at}: the radios`).toHaveCount(count);
    const boxes = await page.getByRole("radio").evaluateAll((radios) =>
      radios.map((radio) => {
        const own = radio.getBoundingClientRect();
        const label = radio.closest("label");
        const text = [...(label?.childNodes ?? [])].find(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
        );
        const range = document.createRange();
        if (text !== undefined) range.selectNodeContents(text);
        const first = range.getClientRects()[0];
        const row = label?.getBoundingClientRect();
        return {
          width: own.width,
          height: own.height,
          right: own.right,
          bottom: own.bottom,
          textLeft: first?.left ?? null,
          textTop: first?.top ?? null,
          rowTop: row?.top ?? null,
          rowBottom: row?.bottom ?? null,
        };
      }),
    );
    boxes.forEach((box, index) => {
      const one = `${at}: radio ${String(index + 1)}`;
      expect
        .soft(box.width, `${one} is ${String(box.width)} px wide, ${String(box.height)} tall`)
        .toBeLessThanOrEqual(box.height);
      // Beside it: the text starts to the right of the radio and above its bottom edge.
      expect.soft(box.textLeft, `${one} has a label`).not.toBeNull();
      expect
        .soft(
          box.textLeft ?? 0,
          `${one}'s label starts at ${String(box.textLeft)}, the radio ends at ${String(box.right)}`,
        )
        .toBeGreaterThanOrEqual(box.right);
      expect
        .soft(box.textTop ?? Infinity, `${one}'s label starts on a line below the radio`)
        .toBeLessThan(box.bottom);
      // One to a row: this label starts where the one before it ended.
      const before = boxes[index - 1];
      if (before !== undefined) {
        expect
          .soft(box.rowTop ?? 0, `${one}'s label shares a row with the one before it`)
          .toBeGreaterThanOrEqual(before.rowBottom ?? 0);
      }
    });
  };
}

/**
 * The screens that draw more than one card over the seed, with how many at
 * least: the ones `cardsStandApart` has a pair to read on. Counted at lg-70.
 */
const CARDS: Readonly<Record<string, number>> = {
  Home: 2,
  Stats: 11,
  Period: 4,
  Categories: 3,
  Salaries: 2,
  Household: 2,
  Admin: 3,
};

/** The tabs whose screens carry a radio group, with how many radios each draws. */
const RADIOS: Readonly<Record<string, number>> = {
  // MORTGAGE_STATES: live, ended, none.
  Household: 3,
  // MORTGAGE_SPLIT_MODES: shares, equal, ratio.
  Salaries: 3,
};

for (const [tab, arrived] of TABS) {
  test(`${tab} fits a phone and a desktop`, async ({ page }, testInfo) => {
    await openTab(page, tab);
    for (const text of arrived) {
      await expect(page.getByRole("main")).toContainText(text);
    }
    const radios = RADIOS[tab];
    await fitsBothWidths(
      page,
      testInfo,
      tab,
      tab === "Stats"
        ? gridlinesDrawn
        : radios === undefined
          ? undefined
          : radiosBesideTheirLabels(radios, tab),
    );
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
  await fitsBothWidths(page, testInfo, "Receipt", async (_page, width) => {
    const at = `Receipt at ${String(width)} px`;
    // lg-64: a field that shows the start of its entry and cuts the rest off
    // overflows nothing, so `scrollWidth` passes it. The text is set in the
    // field's own font and compared with its content box, in the browser.
    const name = await fits(items.getByRole("textbox").nth(0), "Organic rolled oats");
    expect
      .soft(
        name.text,
        `${at}: the item's name field is ${String(name.box)} px for ${String(name.text)} px of text`,
      )
      .toBeLessThanOrEqual(name.box);
    const price = await fits(items.getByRole("textbox").nth(1), "12.99");
    expect
      .soft(
        price.text,
        `${at}: the item's price field is ${String(price.box)} px for ${String(price.text)} px of text`,
      )
      .toBeLessThanOrEqual(price.box);
    // Every control of the row can be reached without scrolling the page sideways.
    const controls = [
      items.getByRole("button", { name: /, Shared$/u }),
      items.getByRole("checkbox"),
      items.getByRole("button", { name: /^Remove /u }),
    ];
    for (const control of controls) {
      await expect(control, `${at}: one control`).toHaveCount(1);
      const edge = await control.evaluate((element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right, inner: window.innerWidth };
      });
      expect
        .soft(edge.left, `${at}: a control starts at ${String(edge.left)}`)
        .toBeGreaterThanOrEqual(0);
      expect
        .soft(edge.right, `${at}: a control ends at ${String(edge.right)} in ${String(edge.inner)}`)
        .toBeLessThanOrEqual(edge.inner);
    }
  });
});

/**
 * How wide `text` is when set in the field's own font, beside the width of the
 * field's content box (its width less padding and border), both in the browser.
 */
async function fits(field: Locator, text: string): Promise<{ text: number; box: number }> {
  return field.evaluate((element, sample) => {
    const style = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("no canvas");
    context.font = style.font;
    const sides = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
    const spent = sides.reduce((sum, side) => sum + Number.parseFloat(style[side]), 0);
    return {
      text: context.measureText(sample).width,
      box: element.getBoundingClientRect().width - spent,
    };
  }, text);
}
