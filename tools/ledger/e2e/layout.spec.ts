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
 * **A screen is a tab.** The shell has no router (`App.tsx`): the thirteen tabs
 * are the thirteen top-level screens, and the list below is the one
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

  // lg-71: the serve script makes the household with alex alone, under a UUID it
  // cannot name to a second command, so alex adds sam here, as a member can.
  // Asked first, since a hook run again finds sam already there.
  const me = (await (await api.get("/api/me")).json()) as { person: { household: string } };
  const members = `/api/households/${me.person.household}/members`;
  const read = async () =>
    (await (await api.get(`/api/households/${me.person.household}`)).json()) as {
      members: { address: string; person: string; name: string }[];
    };
  if (!(await read()).members.some((member) => member.address === "sam@example.test")) {
    await post(api, members, { address: "sam@example.test", person: "sam" });
  }
  // lg-76: alex and sam were added by name, so each has a generated id, which
  // the books store; the seed names each by the id the household answers.
  const shownAs = new Map((await read()).members.map((member) => [member.name, member.person]));
  const alex = shownAs.get("alex");
  const sam = shownAs.get("sam");
  if (alex === undefined || sam === undefined) throw new Error("alex and sam are not both members");

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
    personId: sam,
    bucket: "current-expenses",
    spendingCategoryId: null,
  });
  await post(api, "/api/rules", {
    descriptionPattern: "Virement - AccèsD Internet /Caisse du Lac",
    category: null,
    amountCents: null,
    personId: alex,
    bucket: "current-expenses",
    spendingCategoryId: null,
  });
  await post(api, "/api/statements", { text: PASTE });

  const { salaries } = (await post(api, "/api/salaries", {
    year: 2026,
    salaries: [
      { personId: alex, amountCents: 7_200_000 },
      { personId: sam, amountCents: 5_400_000 },
    ],
  })) as { salaries: { id: number }[] };
  await post(api, "/api/ratios", {
    effectiveFrom: "2026-01-01",
    salaryIds: salaries.map((salary) => salary.id),
  });

  // Charged on the 1st, so the month Stats shows last, today's, always has a
  // charge: from the 15th, the 1st to the 14th of every month read 0.00 (lg-85).
  await post(api, "/api/recurring", {
    personId: alex,
    monthlyCents: 8999,
    startDate: "2026-08-01",
    endDate: null,
    label: "Internet and phone",
  });
  const lines = [
    [alex, "2026-09-03", -12_345, 1, "Weekly groceries"],
    [sam, "2026-09-10", -4_550, 3, "Light bulbs and a mop"],
    [sam, "2026-09-21", -9_800, 4, "Pharmacy, the whole month"],
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
    personId: alex,
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
 * is about. What Admin and Household show is the household directory, which the
 * `e2e:ledger:serve` script makes with alex before the API boots and the seed
 * completes with sam (lg-71), so their entries are those, and Household passes
 * over empty books.
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
  ["Admin", [/Home: alex and sam/u, /sam@example\.test/u]],
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
    await expect(page.getByRole("main").getByRole("radio"), `${at}: the radios`).toHaveCount(count);
    const boxes = await page
      .getByRole("main")
      .getByRole("radio")
      .evaluateAll((radios) =>
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
  // lg-66: the date column, the bucket labels and the checks, once read.
  "Import (read)": 3,
  // lg-67: a CSV has no bucket label, so the date column and the checks.
  "Import CSV (read)": 2,
  // lg-80: the same Admin cards, over a stubbed directory.
  "Admin (long person name)": 3,
  "Admin (long household name)": 3,
  "Admin (spaced household name)": 3,
  // lg-77: the household page titled by a long name, and a rename open on each screen.
  "Household (long household name)": 2,
  "Household (renaming)": 2,
  "Admin (renaming)": 3,
  // lg-78: the date column, the bucket labels, the names to answer and the checks.
  "Import (names)": 4,
  // lg-75: the Admin cards with an email marked never signed in.
  "Admin (never signed in)": 3,
  // lg-74: the Admin cards with a person who has no email.
  "Admin (no email)": 3,
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

/**
 * lg-66: the import screen, before the samples are sent and after the read.
 * The e2e server has no key, so the describe request is answered here with
 * what the API answers for lg-38's `lg37` fixture (`web/test/fixtures/`), as if
 * every verification held, so the Confirm control is on the screen measured.
 * The bytes chosen are never read: nothing reaches the server but this route.
 */
const DESCRIBED = JSON.parse(
  fs.readFileSync(path.join(here, "../web/test/fixtures/lg37-describe.json"), "utf8"),
) as { ok: boolean; problems: string[] };

test("Import fits a phone and a desktop, before sending and once read", async ({
  page,
}, testInfo) => {
  await page.route("**/api/workbook/describe", async (route) => {
    await route.fulfill({ json: { ...DESCRIBED, ok: true, problems: [] } });
  });
  await openTab(page, "Import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "classeur.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("PK\u0003\u0004 a workbook's bytes"),
  });
  await expect(page.getByRole("note", { name: "What is sent" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Import (before sending)");

  await page.getByRole("button", { name: "Send the samples and describe" }).click();
  await expect(page.getByRole("button", { name: "Confirm and import" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/Paiement prêt/u);
  // The report open, its longest lines wrapping inside the card.
  await page.getByText("The dry run’s report").click();
  await fitsBothWidths(page, testInfo, "Import (read)");
});

/**
 * lg-74: a person held without an email, listed by name with "no email" where
 * an address would be. The seed adds nobody without one, since a third person in
 * the books would change every period's people; the household's answers are
 * taken from the server and given one here, with a long name to wrap.
 */
const WITHOUT_EMAIL = {
  person: "00000000-0000-4000-8000-0000000000ee",
  name: "Robin-Alexandrine de la Montagne-Verte",
};

test("Household and Admin fit a phone and a desktop with a person who has no email", async ({
  page,
}, testInfo) => {
  await page.route("**/api/households/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as {
      members: unknown[];
      history: unknown[];
    };
    const at = "2026-10-25T12:00:00.000Z";
    await route.fulfill({
      json: {
        ...body,
        members: [...body.members, { address: null, ...WITHOUT_EMAIL }],
        history: [
          ...body.history,
          { action: "add-person", person: WITHOUT_EMAIL.person, at, by: "alex@example.test" },
          { action: "name", ...WITHOUT_EMAIL, at, by: "alex@example.test" },
        ],
      },
    });
  });
  await page.route("**/api/admin/households", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as {
      households: { members: unknown[]; people: unknown[] }[];
    };
    await route.fulfill({
      json: {
        households: body.households.map((household) => ({
          ...household,
          members: [...household.members, { address: null, ...WITHOUT_EMAIL }],
          people: [...household.people, { ...WITHOUT_EMAIL, standing: "in" }],
        })),
      },
    });
  });

  await openTab(page, "Household");
  await expect(page.getByRole("main")).toContainText(`${WITHOUT_EMAIL.name} no email`);
  await expect(page.getByRole("main")).toContainText(
    `${WITHOUT_EMAIL.name} added without an email`,
  );
  await fitsBothWidths(page, testInfo, "Household (no email)");

  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: "Admin" })
    .click();
  await expect(page.getByRole("main")).toContainText(`${WITHOUT_EMAIL.name} no email`);
  await expect(page.getByRole("list", { name: "Emails to admit" })).not.toContainText(
    WITHOUT_EMAIL.name,
  );
  await fitsBothWidths(page, testInfo, "Admin (no email)");
});

/**
 * lg-67: the same screen once a bank CSV is read. The describe request is
 * answered with what the API answers for `csv-balance` into empty books
 * (`web/test/fixtures/csv-balance-describe.json`): the date column, the first
 * import's line and the checks, with no bucket section.
 */
const CSV_DESCRIBED: unknown = JSON.parse(
  fs.readFileSync(path.join(here, "../web/test/fixtures/csv-balance-describe.json"), "utf8"),
);

test("Import fits a phone and a desktop once a CSV is read", async ({ page }, testInfo) => {
  await page.route("**/api/workbook/describe", async (route) => {
    await route.fulfill({ json: CSV_DESCRIBED });
  });
  await openTab(page, "Import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "releve.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Montant,Solde\n2024-01-02,DEPOT PAIE,1823.45,4335.55\n"),
  });
  await page.getByRole("button", { name: "Send the samples and describe" }).click();
  await expect(page.getByText("First import: no history is stored.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and import" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Which bucket each label files in");
  await page.getByText("The dry run’s report").click();
  await fitsBothWidths(page, testInfo, "Import CSV (read)");
});

/**
 * lg-80: a name with no space in it, at the length the product allows (64 for a
 * person, 80 for a household), on the Admin screen. `scrollWidth` cannot tell a
 * name that wrapped or scrolls from one an ancestor clipped (`.card { overflow:
 * hidden }` turns it to 360 and the name stays cut), so `nameIsWhole` walks the
 * text nodes that hold the name, takes the box of the text itself, and climbs the
 * ancestors: one that clips (`hidden`, `clip`) must contain it, one that scrolls
 * (`auto`, `scroll`) is a box the name may scroll in, and the window holds what is
 * left. It proves the name is not cut sideways; whether it is hidden vertically or
 * visually (a line clamp, `visibility`, a tiny font) is for the screenshot.
 */
async function nameProblems(page: Page, name: string): Promise<string[]> {
  return page.locator("main").evaluate((main, needle) => {
    const problems: string[] = [];
    let drawn = 0;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!(node.nodeValue ?? "").includes(needle)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      // An <option> is in the page and has no box: it is not on the screen.
      if (text.width === 0) continue;
      drawn += 1;
      let { left, right } = text;
      for (let el = node.parentElement; el !== null; el = el.parentElement) {
        const overflow = getComputedStyle(el).overflowX;
        if (overflow === "visible") continue;
        const box = el.getBoundingClientRect();
        // hidden and clip cut what lies outside the box; auto and scroll let it be scrolled to.
        if (
          (overflow === "hidden" || overflow === "clip") &&
          (right > box.right + 0.5 || left < box.left - 0.5)
        ) {
          problems.push(
            `<${el.tagName.toLowerCase()}> cuts the name (it ends at ${String(Math.round(right))}, the box at ${String(Math.round(box.right))})`,
          );
        }
        // From here out only the box itself can be seen.
        ({ left, right } = box);
      }
      if (right > window.innerWidth + 0.5 || left < -0.5) {
        problems.push(
          `the name reaches ${String(Math.round(right))} px in a ${String(window.innerWidth)} px window`,
        );
      }
    }
    if (drawn === 0) problems.push("the name is not drawn on the screen");
    return problems;
  }, name);
}

function nameIsWhole(name: string, screen: string) {
  return async (page: Page, width: number): Promise<void> => {
    expect
      .soft(await nameProblems(page, name), `${screen} at ${String(width)} px: the name`)
      .toEqual([]);
  };
}

type AdminHouseholds = {
  households: {
    name: string;
    members: { address: string | null; person: string; name: string }[];
    people: { person: string; name: string; standing: string }[];
  }[];
};

/** Admin over the seeded books, with `change` applied to what the directory answers. */
async function openAdminWith(
  page: Page,
  change: (households: AdminHouseholds["households"]) => AdminHouseholds["households"],
): Promise<void> {
  await page.route("**/api/admin/households", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as AdminHouseholds;
    await route.fulfill({ json: { ...body, households: change(body.households) } });
  });
  await openTab(page, "Admin");
}

test("Admin fits a phone and a desktop with a 64-character unbroken person name", async ({
  page,
}, testInfo) => {
  const NAME = "R".repeat(64);
  expect(NAME).toHaveLength(64);
  await openAdminWith(page, (households) =>
    households.map((household) => {
      const first = household.members[0]?.person;
      return {
        ...household,
        members: household.members.map((one) =>
          one.person === first ? { ...one, name: NAME } : one,
        ),
        people: household.people.map((one) =>
          one.person === first ? { ...one, name: NAME } : one,
        ),
      };
    }),
  );
  await expect(page.getByRole("main")).toContainText(NAME);
  await fitsBothWidths(
    page,
    testInfo,
    "Admin (long person name)",
    nameIsWhole(NAME, "Admin (long person name)"),
  );
});

test("Admin fits a phone and a desktop with an 80-character unbroken household name", async ({
  page,
}, testInfo) => {
  const NAME = "H".repeat(80);
  expect(NAME).toHaveLength(80);
  await openAdminWith(page, (households) =>
    households.map((household) => ({ ...household, name: NAME })),
  );
  await expect(page.getByRole("main")).toContainText(NAME);
  await fitsBothWidths(
    page,
    testInfo,
    "Admin (long household name)",
    nameIsWhole(NAME, "Admin (long household name)"),
  );
});

test("Admin fits a phone and a desktop with an 80-character household name spaced every ten", async ({
  page,
}, testInfo) => {
  // Nine H's and a space, seven times, then ten H's: the control, which fits before the fix too.
  const NAME = `${"H".repeat(9)} `.repeat(7) + "H".repeat(10);
  expect(NAME).toHaveLength(80);
  await openAdminWith(page, (households) =>
    households.map((household) => ({ ...household, name: NAME })),
  );
  await expect(page.getByRole("main")).toContainText(NAME);
  await fitsBothWidths(
    page,
    testInfo,
    "Admin (spaced household name)",
    nameIsWhole(NAME, "Admin (spaced household name)"),
  );
});

/**
 * lg-77: the household page is titled by the household's name, with a Rename
 * beside it, and both screens open a field to rename it. The longest name the
 * API takes, 80 characters with no space to break at, is the one a title
 * overflows on (lg-80 measured it on the Admin card). The seed's household is
 * shared by the run, so the long name is the household answer's, given here,
 * and no rename is saved.
 */
const LONG_HOUSEHOLD_NAME = "H".repeat(80);

/**
 * The title holding `name` is drawn inside the window: `scrollWidth` reads a
 * title an ancestor cut at its edge as fitting, so the text's own box is read
 * (a `Range`, which counts text spilling out of its element).
 */
function titleInsideWindow(name: string, screen: string) {
  return async (page: Page, width: number): Promise<void> => {
    const boxes = await page.getByRole("heading", { name }).evaluateAll((headings) =>
      headings.map((heading) => {
        const range = document.createRange();
        range.selectNodeContents(heading);
        const { left, right } = range.getBoundingClientRect();
        return { left, right, inner: window.innerWidth };
      }),
    );
    const at = `${screen} at ${String(width)} px`;
    expect(boxes.length, `${at}: the title`).toBeGreaterThan(0);
    for (const box of boxes) {
      expect
        .soft(box.left, `${at}: the title starts at ${String(box.left)}`)
        .toBeGreaterThanOrEqual(0);
      expect
        .soft(box.right, `${at}: the title ends at ${String(box.right)} in ${String(box.inner)}`)
        .toBeLessThanOrEqual(box.inner);
    }
  };
}

test("Household fits a phone and a desktop titled by an 80-character household name, and renaming it", async ({
  page,
}, testInfo) => {
  expect(LONG_HOUSEHOLD_NAME).toHaveLength(80);
  await page.route("**/api/households/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as { household: { id: string } };
    await route.fulfill({
      json: { ...body, household: { ...body.household, name: LONG_HOUSEHOLD_NAME } },
    });
  });

  await openTab(page, "Household");
  await expect(page.getByRole("main")).toContainText(/sam@example\.test added as sam/u);
  await expect(page.getByRole("heading", { name: LONG_HOUSEHOLD_NAME, level: 2 })).toBeVisible();
  await fitsBothWidths(
    page,
    testInfo,
    "Household (long household name)",
    titleInsideWindow(LONG_HOUSEHOLD_NAME, "Household (long household name)"),
  );

  await page.getByRole("button", { name: `Rename ${LONG_HOUSEHOLD_NAME}` }).click();
  await expect(page.getByLabel(`New name for ${LONG_HOUSEHOLD_NAME}`)).toHaveValue(
    LONG_HOUSEHOLD_NAME,
  );
  await fitsBothWidths(
    page,
    testInfo,
    "Household (renaming)",
    titleInsideWindow(LONG_HOUSEHOLD_NAME, "Household (renaming)"),
  );
});

test("Admin fits a phone and a desktop with a household's rename open", async ({
  page,
}, testInfo) => {
  await openTab(page, "Admin");
  await expect(page.getByRole("main")).toContainText(/Home: alex and sam/u);
  await page.getByRole("button", { name: "Rename Home: alex and sam" }).click();
  await expect(page.getByLabel("New name for Home: alex and sam")).toHaveValue("Home");
  await fitsBothWidths(page, testInfo, "Admin (renaming)");
});

/**
 * lg-78: the same screen when the workbook names people the household lacks,
 * each with its choice. Two names, one long enough to wrap, the long one
 * answered as a new person so its name field is drawn too; Confirm is offered
 * once both are answered.
 */
test("Import fits a phone and a desktop with names to answer", async ({ page }, testInfo) => {
  const long = "Marie-Ève Bélanger-Lacroix de Saint-Jean-sur-Richelieu-et-Environs";
  await page.route("**/api/workbook/describe", async (route) => {
    await route.fulfill({
      json: {
        ...DESCRIBED,
        ok: true,
        problems: [],
        unresolved: [
          { name: "Sam", where: "2022!E6", rows: 5 },
          { name: long, where: "'$ (Avril-Août)'!E12", rows: 1 },
        ],
        held: [
          { person: "00000000-0000-4000-8000-0000000000aa", name: "alex" },
          { person: "00000000-0000-4000-8000-0000000000bb", name: long },
        ],
      },
    });
  });
  await openTab(page, "Import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "classeur.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("PK\u0003\u0004 a workbook's bytes"),
  });
  await page.getByRole("button", { name: "Send the samples and describe" }).click();
  await expect(
    page.getByRole("heading", { name: "Names the household does not have" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and import" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Who is “Sam”?" }).selectOption({ label: "alex" });
  await page
    .getByRole("combobox", { name: `Who is “${long}”?` })
    .selectOption({ label: "A new person" });
  await expect(page.getByRole("textbox", { name: "The new person’s name" })).toHaveValue(long);
  await expect(page.getByRole("button", { name: "Confirm and import" })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Import (names)");
});

/**
 * lg-75: the mark on an email nobody has signed in with, on the card and in the
 * list to admit. In the seed sam never makes a request, so the real answer
 * already marks sam; the listing is also given a member whose person name and
 * address are both long, the shape that made a row wider than a phone, so the
 * mark is measured wrapping beside them.
 */
test("Admin fits a phone and a desktop with an email marked never signed in, beside long names", async ({
  page,
}, testInfo) => {
  const longPerson = "Robin-Alexandrine de la Montagne-Verte-et-des-Vallees-Lointaines";
  const longAddress = `${"a-very-long-local-part-".repeat(3)}x@an-equally-long-domain-name.example.test`;
  await page.route("**/api/admin/households", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as {
      households: { members: unknown[] }[];
    };
    await route.fulfill({
      json: {
        households: body.households.map((household) => ({
          ...household,
          members: [
            ...household.members,
            {
              address: longAddress,
              person: "00000000-0000-4000-8000-0000000000ef",
              name: longPerson,
              firstSignIn: null,
            },
          ],
        })),
      },
    });
  });

  await openTab(page, "Admin");
  const admit = page.getByRole("list", { name: "Emails to admit" });
  await expect(admit).toContainText(longAddress);
  // sam (real) and the long address (given): two marks on the card and in the list.
  await expect(admit.getByText("Never signed in")).toHaveCount(2);
  await expect(page.getByText("Never signed in")).toHaveCount(4);
  await fitsBothWidths(page, testInfo, "Admin (never signed in)");
});

/**
 * lg-72: the shared header on each of its three screens, and the terms page.
 *
 * The header is `@webtools/ui`'s and is drawn once per screen the shell gives
 * it: the household's own, the page for an address in no household, and the
 * admin's alone. The seed's alex is a member and an admin both, so the last two
 * are reached by refusing `/api/me` as the API does for them (`App.tsx`), and,
 * for the second, refusing the admin list as well.
 *
 * Each theme segment is a tap target of at least 44 px both ways, the floor
 * repo-130 sets for every button and field, and the switch sits on the name's
 * line rather than wrapping under it, which at 360 px is the case that fails.
 */
async function headerFits(page: Page, width: number): Promise<void> {
  const at = `${String(width)} px`;
  const header = page.getByRole("banner");
  const segments = header.locator(".theme-toggle label");
  await expect(segments, `the theme segments at ${at}`).toHaveCount(3);
  for (const segment of await segments.all()) {
    const box = await segment.boundingBox();
    expect(box?.height ?? 0, `a theme segment's height at ${at}`).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, `a theme segment's width at ${at}`).toBeGreaterThanOrEqual(44);
  }

  const name = await header.getByRole("heading", { level: 1 }).boundingBox();
  const toggle = await header.getByRole("group", { name: "Colour theme" }).boundingBox();
  expect(name).not.toBeNull();
  expect(toggle).not.toBeNull();
  // On one line: the name's vertical middle falls inside the switch's height.
  const middle = (name?.y ?? 0) + (name?.height ?? 0) / 2;
  expect(middle, `the name's line at ${at}`).toBeGreaterThanOrEqual(toggle?.y ?? Infinity);
  expect(middle, `the name's line at ${at}`).toBeLessThanOrEqual(
    (toggle?.y ?? 0) + (toggle?.height ?? 0),
  );
}

const REFUSED = {
  status: 403,
  json: {
    error: { code: "FORBIDDEN", message: "This address is in no household.", retryable: false },
  },
};

test("the household's header fits a phone and a desktop", async ({ page }, testInfo) => {
  await openTab(page, "Home");
  await expect(page.getByRole("banner")).toContainText("The household\u2019s shared account.");

  await fitsBothWidths(page, testInfo, "Header (household)", (_page, width) =>
    headerFits(page, width),
  );
});

test("the header fits a phone and a desktop for an address in no household", async ({
  page,
}, testInfo) => {
  await page.route("**/api/me", (route) => route.fulfill(REFUSED));
  await page.route("**/api/admin/households", (route) => route.fulfill(REFUSED));
  await open(page);
  await expect(page.getByRole("heading", { name: "No household" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("The household\u2019s shared account.");

  await fitsBothWidths(page, testInfo, "Header (no household)", (_page, width) =>
    headerFits(page, width),
  );
});

test("the header fits a phone and a desktop on the admin's own screen", async ({
  page,
}, testInfo) => {
  await page.route("**/api/me", (route) => route.fulfill(REFUSED));
  await open(page);
  await expect(page.getByRole("heading", { name: "Households" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Admin");
  await expect(page.getByRole("navigation", { name: "Screens" })).toHaveCount(0);

  await fitsBothWidths(page, testInfo, "Header (admin)", (_page, width) => headerFits(page, width));
});

test("the terms page fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/terms.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the ledger" })).toBeVisible();

  await fitsBothWidths(page, testInfo, "Terms");
});
