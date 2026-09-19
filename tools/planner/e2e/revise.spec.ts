/**
 * Revising a plan, through a browser, across the reload.
 *
 * P4 reads "Pin, re-plan a slice, read the diff", and after pl-44 and pl-45
 * each half of it is proven only at a mocked seam:
 *
 *  - `web/test/plan-view.test.tsx` proves the **controls**. It fakes
 *    `src/api/plan.ts` wholesale — this tool's rule, not a shortcut — so it
 *    never learns whether a real `fetch` round-trips a `ReviseRequest` the way
 *    the client's own type promises.
 *  - `api/test/revisions.test.ts` proves the **writes**: the route, the run,
 *    the append and the diff, against `app.inject()` rather than a browser.
 *
 * The claim spans both halves, and they compose only if the client module does
 * what its type says. That is exactly the gap `e2e/pin.spec.ts` closed for
 * pinning (pl-19), and this spec is the same argument extended to revision,
 * which crosses more seams than pinning did: a re-plan answers 202 and
 * continues as a run over SSE, `RunView` hands back to the plan page, an edit
 * answers a `PlanView` synchronously, and every change appends a revision that
 * has to be read back with its diff derived on the server.
 *
 * **The reload is the assertion.** Everything before it could pass against
 * React state that never left the tab — reloading is what makes the claim
 * about SQLite. Nothing here reads the database: "a revision was appended" is
 * the crumb line, "it persisted" is the reload.
 *
 * One spec, one walk, on purpose — see `.claude/rules/planner-e2e.md` on why
 * branch coverage belongs in a component test and a spec earns its place by
 * crossing a seam no unit test reaches.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { draftAPlan, reopenFromTheList, RUN_TIMEOUT } from "./plan-walk.ts";

/** Every `<article class="day">` on the open plan, in document order. */
function dayArticles(page: Page): Locator {
  return page.locator("section.panel.plan article.day");
}

/**
 * Which day (0-based, matching `PlanDay.dayIndex`) currently holds an item
 * with this title.
 *
 * Read off the screen rather than assumed, because the item this spec is
 * about to move is only chosen *after* the re-plan — a zero-specialist re-pack
 * may legitimately reshuffle a day's own order (pl-46's own trap), so nothing
 * here may trust a day index computed before that run finished.
 */
async function dayIndexOf(page: Page, title: string): Promise<number> {
  const days = dayArticles(page);
  const count = await days.count();
  // A day count in the single digits, checked in document order until the one
  // holding the item is found; there is nothing to parallelise, and
  // Promise.all would run every check whether the answer was already known or
  // not.
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const holds = await days
      .nth(index)
      .locator("li.item")
      .filter({ has: page.getByRole("heading", { name: title }) })
      .count();
    if (holds > 0) return index;
  }
  throw new Error(`no day on the page holds an item titled "${title}"`);
}

/**
 * The emptiest day other than `exclude` — a destination the move is likeliest
 * to fit onto.
 *
 * `itinerary`'s own pace limit (`.claude/rules/planner-unchecked-constraints.md`)
 * refuses a move that overfills a day with `PLAN_INFEASIBLE`, so a fixed
 * "always the next day" target is not safe: the scripted provider's own road
 * trip already packs most days to that limit, and this spec is not the place
 * to re-derive it. The lightest day still on the plan is the one a real user
 * would reach for too.
 */
async function leastLoadedDayIndex(page: Page, exclude: number): Promise<number> {
  const days = dayArticles(page);
  const count = await days.count();
  let best = -1;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    if (index === exclude) continue;
    // oxlint-disable-next-line no-await-in-loop
    const items = await days.nth(index).locator("li.item").count();
    if (items <= bestCount) {
      best = index;
      bestCount = items;
    }
  }
  if (best === -1) throw new Error("no day on the page other than the source");
  return best;
}

test("re-plan, move, reload, restore, reload — the plan keeps every version", async ({ page }) => {
  const title = await draftAPlan(page);
  const plan = page.locator("section.panel.plan");

  await expect(plan.locator("p.crumb")).toContainText("Version 1 of 1");

  // --- Re-plan one day, no specialists named -------------------------------
  // Deterministic under the scripted provider: no model call, and a re-pack of
  // existing candidates (pl-44's zero-specialist path). Naming a specialist
  // would make the diff depend on model *content*, which the rules file
  // forbids asserting on — the move below is what earns the diff assertion.
  await page.getByRole("checkbox", { name: "Day 1" }).check();
  await page.getByRole("button", { name: "Re-plan these days" }).click();

  // Control left `PlanView` for the run screen (pl-45 Build step 5); wait for
  // its own finished state exactly as a draft's.
  await expect(page.getByRole("heading", { name: "Done", exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
  await page.getByRole("button", { name: "Read the plan" }).click();
  await expect(plan).toBeVisible();
  await expect(plan.locator("p.crumb")).toContainText("Version 2 of 2");

  // --- Move -----------------------------------------------------------------
  // Read the item, and its day, only now — after the re-pack, not before it.
  const moved = (
    await plan.locator("li.item").first().getByRole("heading").first().innerText()
  ).trim();
  const fromDayIndex = await dayIndexOf(page, moved);
  const dayCount = await dayArticles(page).count();
  expect(dayCount).toBeGreaterThan(1);
  const toDayIndex = await leastLoadedDayIndex(page, fromDayIndex);

  const item = plan.locator("li.item").filter({ has: page.getByRole("heading", { name: moved }) });
  await item.getByRole("button", { name: "Move", exact: true }).click();
  await item.locator("span.move-control select").first().selectOption(String(toDayIndex));
  await item.getByRole("button", { name: "Move here" }).click();

  await expect(plan.locator("p.crumb")).toContainText("Version 3 of 3");
  await expect(
    dayArticles(page).nth(toDayIndex).getByRole("heading", { name: moved }),
  ).toBeVisible();

  const diff = plan.locator("section.diff");
  await expect(diff.getByRole("heading", { level: 4, name: "Moved" })).toBeVisible();
  await expect(diff.locator("li", { hasText: moved })).toBeVisible();

  // --- The reload -------------------------------------------------------
  // What separates a revision that reached SQLite from one that only reached
  // React. Everything asserted above this line could pass against a tab that
  // never called the server.
  await reopenFromTheList(page, title);

  await expect(plan.locator("p.crumb")).toContainText("Version 3 of 3");
  await expect(
    dayArticles(page).nth(toDayIndex).getByRole("heading", { name: moved }),
  ).toBeVisible();
  await expect(
    plan.locator("section.diff").getByRole("heading", { level: 4, name: "Moved" }),
  ).toBeVisible();
  await expect(plan.locator("section.diff li", { hasText: moved })).toBeVisible();

  // --- Restore version 1 -----------------------------------------------------
  await plan.locator("#version-picker").selectOption("1");
  await expect(plan.locator("p.crumb")).toContainText("Version 1 of 3");
  await plan.getByRole("button", { name: "Restore this version" }).click();

  await expect(plan.locator("p.crumb")).toContainText("Version 4 of 4");
  await expect(
    dayArticles(page).nth(fromDayIndex).getByRole("heading", { name: moved }),
  ).toBeVisible();

  // --- Reload once more -------------------------------------------------
  await reopenFromTheList(page, title);

  await expect(plan.locator("p.crumb")).toContainText("Version 4 of 4");
  await expect(
    dayArticles(page).nth(fromDayIndex).getByRole("heading", { name: moved }),
  ).toBeVisible();
});
