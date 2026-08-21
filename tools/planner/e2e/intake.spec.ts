/**
 * P1, through a browser: describe a trip, be told the essentials are done, come
 * back to it, and be told what changing your mind costs.
 *
 * What this proves that no unit test can:
 *
 *  - the bundle the API serves talks to that same API on one origin, which is
 *    how the container runs it — and until pl-13 the container served no bundle
 *    at all, because `WEB_DIR` was parsed and never read;
 *  - a real `fetch` round-trips an `Answer` through `answerSchema` and back,
 *    rather than a faked client agreeing with itself;
 *  - the reload resumes. It needs `localStorage` and a live server at once, and
 *    it is the claim pl-7 was written for;
 *  - the discard warning a user sees is the server's own `prune`, and refusing
 *    it keeps the answers.
 *
 * Two specs, deliberately: one flow and one refusal. Branch coverage over six
 * trip shapes and three date modes belongs in pl-12, where it costs
 * milliseconds instead of a browser.
 *
 * The walk to the checkpoint moved to `intake-walk.ts` with pl-19, which needs
 * the same one to reach something to draft. Nothing about it changed — see the
 * note at the top of that file for why it is shared rather than copied.
 */

import { expect, test } from "@playwright/test";
import { answeredPrompts, answerThroughCore, CHECKPOINT, startATrip } from "./intake-walk.ts";

test("describe a trip, be told the essentials are done, and come back to it", async ({ page }) => {
  await startATrip(page);

  const answered = await answerThroughCore(page);
  // Not a count: the tree decides how long its core is. That there was a core
  // at all, and that every question came with a prompt, is what this can say.
  expect(answered.length).toBeGreaterThan(0);
  expect(answered.every((prompt) => prompt.length > 0)).toBe(true);

  // The checkpoint is a screen, and the wizard stopped at it rather than
  // marching to the end of the tree.
  await expect(page.getByRole("heading", { name: CHECKPOINT })).toBeVisible();
  await expect(page.locator("p.progress")).toContainText("the essentials are done");
  await expect(answeredPrompts(page)).toHaveText([...answered]);

  // --- The reload ---------------------------------------------------------
  // The answers live on the server; *which* intake was open is a browser-local
  // preference in `localStorage`. Remove that and this lands on the trip list
  // instead — which is what the second assertion is here to catch, since the
  // trip would still be listed and a laxer check would pass.
  await page.reload();

  await expect(page.getByRole("heading", { name: CHECKPOINT })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your trips" })).toHaveCount(0);
  await expect(answeredPrompts(page)).toHaveText([...answered]);
});

test("changing an early answer names what it costs, and refusing keeps them", async ({ page }) => {
  await startATrip(page);
  const answered = await answerThroughCore(page);

  const before = await answeredPrompts(page).allInnerTexts();

  // Go back to the first question through the answered list, the way a user
  // does. Its prompt is whatever the tree's first node asks — read, not named.
  const first = answered[0];
  if (first === undefined) throw new Error("the intake asked nothing");
  await page.locator("aside .answers button").filter({ hasText: first }).first().click();

  const card = page.locator("section.panel.question");
  await expect(card.getByRole("heading", { name: first })).toBeVisible();

  // A different answer to the same question — whichever one is not already
  // chosen. Changing the trip's shape is what abandons a branch.
  //
  // `:not(:checked)` rather than a `hasNot` filter: `hasNot` searches
  // descendants, an `<input>` has none, so it matches every radio including the
  // chosen one — and re-checking that fires no `change`, leaving the button
  // disabled and the failure 120 seconds away from its cause.
  await card.locator('fieldset.choices input[type="radio"]:not(:checked)').first().check();
  await card.getByRole("button", { name: "Save the change" }).click();

  // --- The warning --------------------------------------------------------
  const warning = page.locator("section.panel.warn");
  await expect(warning).toBeVisible();

  const doomed = await warning.locator("li").allInnerTexts();
  expect(doomed.length).toBeGreaterThan(0);
  // Named by prompt and never by id. Asserted against the prompts this run
  // actually saw rather than against a literal, so a content edit moves both
  // sides at once — and "road-trip.drive-hours" fails it, which is the point.
  for (const entry of doomed) {
    expect(answered).toContain(entry);
  }

  // --- The refusal --------------------------------------------------------
  // A warning that costs the user their answers whether or not they agree is
  // worse than no warning at all.
  await warning.getByRole("button", { name: "Keep what I had" }).click();
  await expect(warning).toHaveCount(0);

  await expect(answeredPrompts(page)).toHaveText(before);
  // The prompts the warning threatened are specifically still on record, not
  // merely a list of the same length.
  for (const entry of doomed) {
    expect(before).toContain(entry);
  }
});
