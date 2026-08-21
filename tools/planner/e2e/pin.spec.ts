/**
 * Pinning, through a browser, across the seam the unit suites cannot cross.
 *
 * pl-10's acceptance said "pinning from the UI persists and creates no
 * revision", and its review gate marked that line `unproven (gate)`. Not because
 * the code was suspected of being wrong — each half is real and each half is
 * tested:
 *
 *  - `web/test/plan-view.test.tsx` proves the **button**: a click calls
 *    `pinItem(planId, itemId, true)` and the view re-renders from what comes
 *    back. It mocks `src/api/plan.ts` wholesale, and that is this tool's rule
 *    rather than a shortcut — the fake is the API client module, never `fetch`.
 *  - `api/test/plan-view.test.ts` proves the **write**: it persists, it appends
 *    no revision, and the database's own trigger refuses anything else.
 *
 * The sentence spans both, and nothing crossed between them, so the two compose
 * into the claim only if the client module does what its type says. Removing
 * that assumption is what an e2e suite is for.
 *
 * Pinning is also the **only write in this API that mutates a stored
 * revision** — permitted by exactly one column of one table, guarded by
 * `plan_items_only_pinned_is_mutable`. A regression there is silent: the button
 * still depresses, and the pin is gone on the next read.
 *
 * **The reload is the assertion.** Everything else here could pass against React
 * state that never left the tab. Reloading is what makes the claim about SQLite.
 *
 * Nothing in this spec reads the database. The point of the suite is that it
 * sees what a user sees, so "no revision was appended" is read off the page's
 * own "Version 1 of 1" line — a spec that queried SQLite would be an integration
 * test wearing a browser.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { answerThroughCore, CHECKPOINT, startATrip } from "./intake-walk.ts";

/**
 * A run against the scripted provider is fast, and it is not instant: seven
 * specialists, a compose and a critic pass. Waiting on the finished state to
 * render is the browser's equivalent of the API suite's `runToCompletion`, which
 * polls the store because the SSE hub is not a replay log.
 */
const RUN_TIMEOUT = 60_000;

/** The item's pin button, found by the item's own title rather than by index. */
function pinButton(page: Page, title: string): Locator {
  return page
    .locator("li.item")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .locator("button.pin");
}

/**
 * Draft a plan from a fresh intake and open it, returning what the page called
 * it.
 *
 * The title is read rather than named: it is derived from the brief, so writing
 * it down here would be the tree's content copied into a spec — the mistake
 * `intake-walk.ts` exists to avoid.
 */
async function draftAPlan(page: Page): Promise<string> {
  await startATrip(page);
  await answerThroughCore(page);
  await expect(page.getByRole("heading", { name: CHECKPOINT })).toBeVisible();

  await page.getByRole("button", { name: "Draft a plan" }).click();

  // The run's own screen, and then its finished state. Not a fixed duration:
  // "Done" is rendered when the run says so, and a sleep would be either flaky
  // or slow depending on the runner.
  await expect(page.getByRole("heading", { name: "Done", exact: true })).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
  await page.getByRole("button", { name: "Read the plan" }).click();

  const plan = page.locator("section.panel.plan");
  await expect(plan).toBeVisible();
  return (await plan.getByRole("heading").first().innerText()).trim();
}

/**
 * Get back to a plan after a reload.
 *
 * A reload does not land on the plan: which plan is being read is component
 * state and deliberately not remembered — pl-10 stops at the list and the
 * document, and restoring one would only be guessing at what someone wanted to
 * see. Which *intake* was open is remembered, so a reload mid-wizard comes back
 * to the wizard, and the way out to the list is the crumb a user would click.
 */
async function reopenFromTheList(page: Page, title: string): Promise<void> {
  await page.reload();

  const crumb = page.getByRole("button", { name: "← All trips" });
  if ((await crumb.count()) > 0) await crumb.click();

  await page.locator("ul.plans button.link").filter({ hasText: title }).first().click();
  await expect(page.locator("section.panel.plan")).toBeVisible();
}

test("a pin survives a reload, and appends no revision", async ({ page }) => {
  const title = await draftAPlan(page);

  const plan = page.locator("section.panel.plan");
  // The run placed something. Every rostered schedulable specialist gets a
  // candidate onto a day for all six briefs (`agent/test/placeable.test.ts`), so
  // an empty plan here is a real failure and not a shape this spec tolerates.
  const items = plan.locator("li.item");
  expect(await items.count()).toBeGreaterThan(0);

  const pinned = (await items.first().getByRole("heading").first().innerText()).trim();
  const version = (await plan.locator("p.crumb").innerText()).trim();
  // Version 1 of 1 — this is the first draft, so a second revision would be
  // visible in this line and nowhere else the user can see.
  expect(version).toContain("Version 1 of 1");

  // --- Pin ----------------------------------------------------------------
  const button = pinButton(page, pinned);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveText("Pinned");

  // --- The reload ---------------------------------------------------------
  // What separates a pin that reached SQLite from one that only reached React.
  await reopenFromTheList(page, title);

  await expect(pinButton(page, pinned)).toHaveAttribute("aria-pressed", "true");
  // Read from the page rather than from the database: pinning is the one write
  // that must not append a revision, and this line is where a user would see it
  // if it had.
  await expect(plan.locator("p.crumb")).toHaveText(version);

  // Only the item that was pinned. A write that set the column on every row of
  // the revision would pass every assertion above.
  const others = plan
    .locator("li.item")
    .filter({ hasNot: page.getByRole("heading", { name: pinned }) });
  for (const each of await others.locator("button.pin").all()) {
    await expect(each).toHaveAttribute("aria-pressed", "false");
  }
});

test("unpinning survives a reload too", async ({ page }) => {
  const title = await draftAPlan(page);

  const plan = page.locator("section.panel.plan");
  const pinned = (
    await plan.locator("li.item").first().getByRole("heading").first().innerText()
  ).trim();

  await pinButton(page, pinned).click();
  await expect(pinButton(page, pinned)).toHaveAttribute("aria-pressed", "true");

  await reopenFromTheList(page, title);

  // --- Unpin --------------------------------------------------------------
  // A pin that cannot be undone is a different bug, and the column is written
  // through the same one route either way — so `false` is as worth reloading on
  // as `true`, and a route that only ever wrote `1` would pass without this.
  const button = pinButton(page, pinned);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveText("Pin");

  await reopenFromTheList(page, title);

  await expect(pinButton(page, pinned)).toHaveAttribute("aria-pressed", "false");
  await expect(plan.locator("p.crumb")).toContainText("Version 1 of 1");
});
