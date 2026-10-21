/**
 * repo-109: every screen of the planner fits a 360 px phone and a 1280 px
 * desktop, with a trip and a plan on the page.
 *
 * The rule is `.claude/rules/responsive-layout.md`: the page never scrolls
 * sideways. For each screen this reaches it once, then measures it at both
 * widths on the same page, so a layout that only reflows at a breakpoint is
 * read on both sides of it, and attaches a full-page screenshot of each — a
 * passing assertion over an empty page is the failure to avoid, so look at them.
 *
 * **The screens are the shell's view states** (`web/src/App.tsx`, no router),
 * the ones `docs/work/repo-109-…` lists: the trips and plans list, a question,
 * the checkpoint, a finished run, and a plan. A new one is a new test here, in
 * the pull request that adds it.
 *
 * It reaches them with the walks the other specs share (`intake-walk.ts`,
 * `plan-walk.ts`), so it names no question and no plan, as
 * `.claude/rules/planner-e2e.md` asks. This is not a second run of every spec
 * at a phone width, which would double e2e time to prove the same seams twice:
 * the walk is done at the desktop's default size, and only the measuring is
 * done twice.
 */

// oxlint-disable no-await-in-loop -- one page is resized and read in turn: the screenshot is of the width just set.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { answerThroughCore, CHECKPOINT, startATrip } from "./intake-walk.ts";
import { draftAPlan, RUN_TIMEOUT } from "./plan-walk.ts";

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
    // uploads this directory (`planner.yml`, e2e job).
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

/** The title of the plan `beforeAll` drafted, read off the page. */
let title = "";

test.beforeAll(async ({ browser }) => {
  // A plan for the list and the plan screen to show. Drafted once, in a page of
  // its own, because the walk is the slow part and every test below wants one.
  const baseURL = test.info().project.use.baseURL;
  expect(baseURL).toBeDefined();
  const page = await browser.newPage({ baseURL: baseURL ?? "" });
  title = await draftAPlan(page);
  await page.close();
});

test("the trips and plans list fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
  await expect(page.locator("ul.plans button.link").filter({ hasText: title })).toBeVisible();
  // The health line is the last thing to arrive and is on every screen.
  await expect(page.locator("footer.health")).toContainText("Server v");
  await fitsBothWidths(page, testInfo, "Trips and plans");
});

test("a question fits a phone and a desktop", async ({ page }, testInfo) => {
  await startATrip(page);
  await fitsBothWidths(page, testInfo, "Question");
});

test("the checkpoint fits a phone and a desktop, with the answers beside it", async ({
  page,
}, testInfo) => {
  await startATrip(page);
  await answerThroughCore(page);
  await expect(page.getByRole("heading", { name: CHECKPOINT })).toBeVisible();
  await fitsBothWidths(page, testInfo, "Checkpoint");
});

test("a finished run fits a phone and a desktop", async ({ page }, testInfo) => {
  await startATrip(page);
  await answerThroughCore(page);
  await page.getByRole("button", { name: "Draft a plan" }).click();
  await expect(page.getByRole("heading", { name: "Done", exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
  await fitsBothWidths(page, testInfo, "Run");
});

test("a plan fits a phone and a desktop", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator("ul.plans button.link").filter({ hasText: title }).first().click();
  await expect(page.locator("section.panel.plan")).toBeVisible();
  await expect(page.locator("li.item").first()).toBeVisible();
  await fitsBothWidths(page, testInfo, "Plan");
});
