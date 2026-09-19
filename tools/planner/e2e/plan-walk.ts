/**
 * From a fresh intake to an open plan, and back to one after a reload.
 *
 * Extracted from `pin.spec.ts` by pl-46, which needs the same walk to reach a
 * plan to revise. Shared rather than copied for the reason `intake-walk.ts`'s
 * own module comment gives: the tree is authored content and is expected to
 * change, so two copies of "how do we get from nothing to an open plan" is one
 * copy nobody reads before the next edit changes what the checkpoint or the
 * finished screen looks like.
 *
 * A `.ts` rather than a `.spec.ts`, so Playwright's `testMatch` does not try to
 * run it as a suite with no tests in it.
 */

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { answerThroughCore, CHECKPOINT, startATrip } from "./intake-walk.ts";

/**
 * A run against the scripted provider is fast, and it is not instant: seven
 * specialists, a compose and a critic pass. Waiting on the finished state to
 * render is the browser's equivalent of the API suite's `runToCompletion`,
 * which polls the store because the SSE hub is not a replay log.
 *
 * A zero-specialist re-plan is faster than a draft — pl-46 spends no model
 * call on it — so this one timeout, shared rather than restated, is not too
 * short for either caller.
 */
export const RUN_TIMEOUT = 60_000;

/**
 * Draft a plan from a fresh intake and open it, returning what the page called
 * it.
 *
 * The title is read rather than named: it is derived from the brief, so
 * writing it down here would be the tree's content copied into a spec — the
 * mistake `intake-walk.ts` exists to avoid.
 */
export async function draftAPlan(page: Page): Promise<string> {
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
export async function reopenFromTheList(page: Page, title: string): Promise<void> {
  await page.reload();

  const crumb = page.getByRole("button", { name: "← All trips" });
  if ((await crumb.count()) > 0) await crumb.click();

  await page.locator("ul.plans button.link").filter({ hasText: title }).first().click();
  await expect(page.locator("section.panel.plan")).toBeVisible();
}
