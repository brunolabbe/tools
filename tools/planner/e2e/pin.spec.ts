/**
 * Pinning, through a browser, because the claim spans a seam no unit test
 * crosses.
 *
 * pl-10 proved both halves and neither join. `web/test/plan-view.test.tsx`
 * proves the **button** — a click calls `pinItem(planId, itemId, true)` and the
 * view re-renders from what comes back — and it cannot prove more, because it
 * fakes `src/api/plan.ts` wholesale, which is this tool's rule and not a
 * shortcut. `api/test/plan-view.test.ts` proves the **write** — it persists, it
 * appends no revision, and the database's trigger refuses anything else. The
 * sentence "pinning from the UI persists and creates no revision" needs both,
 * so pl-10's gate said `unproven (gate)`. This is the gate.
 *
 * **The reload is the assertion that matters.** It is what distinguishes a pin
 * that reached SQLite from one that only reached React state; everything before
 * it is setup.
 *
 * Worth a browser beyond closing a row: pinning is the only write in this API
 * that mutates a stored revision, allowed by exactly one column of one table
 * (`plan_items_only_pinned_is_mutable`). A regression there is silent — the
 * button still depresses.
 *
 * Nothing here queries the database. A spec that did would be an integration
 * test wearing a browser: what it must see is what a reader sees, so the
 * revision count is read off the "Version 1 of 1" line and never off a row.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { answerThroughCore, CHECKPOINT, startATrip } from "./intake-walk.ts";

/** The plan document, wherever the reader arrived at it from. */
function planPanel(page: Page): Locator {
  return page.locator("section.panel.plan");
}

/**
 * The plan's title, which is the only handle there is on it.
 *
 * There is no routing — pl-10 stopped at the list and the document — so a plan
 * is re-found by the name the list calls it. It is read off the page rather
 * than predicted from the answers: `intakeTitle` composes it from the shape,
 * the dates and the destination, all three of which are tree content.
 */
async function planTitle(page: Page): Promise<string> {
  return (await planPanel(page).getByRole("heading", { level: 2 }).innerText()).trim();
}

/** The "Version n of m · reason" line, which is where a new revision would show up. */
function versionLine(page: Page): Locator {
  return planPanel(page).locator("p.crumb");
}

/** The first item on the first day, and its pin. */
function firstItem(page: Page): Locator {
  return planPanel(page).locator("li.item").first();
}

/**
 * Reload, and come back to the same plan the way a reader would.
 *
 * A plan being open is deliberately **not** remembered across a reload — see
 * `App.tsx`, where the reasoning is that a plan is addressable and the list is
 * one click away. So the way back to the document is through the plan list,
 * which is two or three real screens away from the write — rather more than
 * this needed, and exactly why it is a good test of whether the pin was stored.
 *
 * Which of the two it is depends on the reload before it. The browser *does*
 * remember the open intake, so the first reload lands on the wizard at its
 * checkpoint; leaving the wizard is what forgets it, so the next one lands on
 * the trip list already. Asserting either would be asserting the last thing
 * this helper did rather than anything about pinning — hence the branch, and
 * hence reading it off the page instead of counting the calls.
 *
 * The heading is the wait: it is the first thing React renders, in both states
 * and in the same pass as the crumb, so counting after it is not a race.
 */
async function reloadAndReopen(page: Page, title: string): Promise<void> {
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planner", exact: true })).toBeVisible();

  const leaveTheWizard = page.getByRole("button", { name: "All trips" });
  if ((await leaveTheWizard.count()) > 0) await leaveTheWizard.click();

  // Scoped to the plans, because the trip it came from is listed above under
  // exactly the same name — both are `intakeTitle` over the same brief.
  await page.locator("ul.plans").getByRole("button", { name: title, exact: true }).click();

  await expect(planPanel(page).getByRole("heading", { level: 2, name: title })).toBeVisible();
}

test("a pin survives a reload, appends no revision, and can be taken back", async ({ page }) => {
  // Longer than the file's 120 seconds: this walks the whole core of the tree
  // *and* runs a fan-out *and* reloads twice, where the intake specs do the
  // first of those only. A generous bound on a slow shared runner, not a claim
  // about how long any of it should take.
  test.setTimeout(240_000);

  await startATrip(page);
  await answerThroughCore(page);
  await expect(page.getByRole("heading", { name: CHECKPOINT })).toBeVisible();

  // --- The run ------------------------------------------------------------
  // Against the scripted provider, which is the default and is what makes a
  // real run affordable here: no key, no bill, the same candidates every time.
  await page.getByRole("button", { name: "Draft a plan" }).click();

  // Waiting for the finished state to render, never for a duration. The button
  // appears only once the run reported `done` *and* the plan was read back, so
  // it is the one signal that means the document is there to open.
  const readThePlan = page.getByRole("button", { name: "Read the plan" });
  await expect(readThePlan).toBeVisible({ timeout: 120_000 });
  await readThePlan.click();

  const title = await planTitle(page);
  expect(title.length).toBeGreaterThan(0);

  // A first draft, and there is something on it to pin. Both would be a plan
  // bug rather than a pinning one, and finding out here beats a timeout on a
  // locator that never had a chance.
  await expect(versionLine(page)).toHaveText(/^Version 1 of 1\b/u);
  const version = (await versionLine(page).innerText()).trim();
  await expect(planPanel(page).locator("li.item")).not.toHaveCount(0);

  // Read off the page and re-checked after every reload, so that "still
  // pinned" is a statement about *this* item rather than about whichever one
  // the days happen to start with afterwards.
  const item = (await firstItem(page).getByRole("heading", { level: 4 }).innerText()).trim();

  const pin = firstItem(page).locator("button.pin");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(pin).toHaveText("Pin");

  // --- The pin ------------------------------------------------------------
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveText("Pinned");
  // Nothing was appended. The view came back from the server, so this is the
  // stored count and not the one the browser had a moment ago.
  await expect(versionLine(page)).toHaveText(version);

  // --- The reload ---------------------------------------------------------
  await reloadAndReopen(page, title);

  await expect(firstItem(page).getByRole("heading", { level: 4 })).toHaveText(item);
  await expect(firstItem(page).locator("button.pin")).toHaveAttribute("aria-pressed", "true");
  await expect(firstItem(page).locator("button.pin")).toHaveText("Pinned");
  // Still one version after a round trip through SQLite — a pin that quietly
  // drafted a revision would show up here and nowhere else on this screen.
  await expect(versionLine(page)).toHaveText(version);

  // --- Taking it back -----------------------------------------------------
  // A pin that cannot be undone is a different bug, and one the "Pinned" label
  // above would happily keep reporting.
  await firstItem(page).locator("button.pin").click();
  await expect(firstItem(page).locator("button.pin")).toHaveAttribute("aria-pressed", "false");
  await expect(firstItem(page).locator("button.pin")).toHaveText("Pin");

  await reloadAndReopen(page, title);

  await expect(firstItem(page).getByRole("heading", { level: 4 })).toHaveText(item);
  await expect(firstItem(page).locator("button.pin")).toHaveAttribute("aria-pressed", "false");
  await expect(firstItem(page).locator("button.pin")).toHaveText("Pin");
  await expect(versionLine(page)).toHaveText(version);
});
