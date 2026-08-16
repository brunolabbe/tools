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
 */

// oxlint-disable no-await-in-loop -- the walk is sequential by definition: the
// server decides the next question from the answer to the last one, so there is
// nothing to run in parallel and `Promise.all` would be answering questions
// nobody has been asked yet.

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** A bound on the walk, not a claim about the tree. See the note in `answerThroughCore`. */
const MAX_QUESTIONS = 64;

const CHECKPOINT = "The essentials are done.";

/**
 * Fill whatever control this question is asking with, without naming the
 * question.
 *
 * The tree is authored content and is expected to change, so a spec that types
 * into `#field-road-trip.drive-hours` is a spec that breaks on a content edit.
 * What it may lean on is the *kinds* — those come from the contract's
 * discriminated union, and `controls.tsx` switches over it with no default
 * case, so a new one is a compile error there before it is a mystery here.
 *
 * The two composites go first. Each contains a radio group **and** a second
 * control, so the generic "check the first radio" below would half-answer them
 * and leave the button disabled — which is exactly the state a user would be
 * stuck in, and a much worse thing to debug from a timeout.
 */
async function fillField(card: Locator): Promise<void> {
  // Dates: the open mode, which is the one that needs no invented date.
  const whenever = card.getByRole("radio", { name: "However long, whenever" });
  if ((await whenever.count()) > 0) {
    await whenever.check();
    await card.getByLabel("Nights").fill("5");
    return;
  }

  // Budget: a feeling rather than a figure, so no currency to get wrong.
  const feeling = card.getByRole("radio", { name: "A feeling" });
  if ((await feeling.count()) > 0) {
    await feeling.check();
    await card.getByRole("radio", { name: "Moderate", exact: true }).check();
    return;
  }

  const textarea = card.locator("textarea");
  if ((await textarea.count()) > 0) {
    // Serves `text` and `text-list` alike: one line is one item.
    await textarea.fill("Montréal");
    return;
  }

  const number = card.locator('input[type="number"]');
  if ((await number.count()) > 0) {
    // The bound is read off the control, which reads it off the node. A literal
    // here would be the tree's content written down a third time.
    await number.fill((await number.getAttribute("min")) ?? "1");
    return;
  }

  const radios = card.locator('fieldset.choices input[type="radio"]');
  if ((await radios.count()) > 0) {
    await radios.first().check();
    return;
  }

  const boxes = card.locator('fieldset.choices input[type="checkbox"]');
  if ((await boxes.count()) > 0) {
    await boxes.first().check();
    return;
  }

  // `number-list`: a text input taking commas.
  const text = card.locator('input[type="text"]');
  if ((await text.count()) > 0) {
    await text.fill("2");
    return;
  }

  throw new Error("no control on this question was recognised");
}

/**
 * Answer whatever is on screen, and return the prompt it asked.
 *
 * The prompt is what the later assertions are made of: the discard warning
 * names answers by prompt and never by id, so the only honest way to check it
 * is against the prompts this walk actually saw.
 */
async function answerCurrent(page: Page): Promise<string> {
  const card = page.locator("section.panel.question");
  await expect(card).toBeVisible();

  const prompt = (await card.getByRole("heading").first().innerText()).trim();
  await fillField(card);
  await card.getByRole("button", { name: "Next", exact: true }).click();
  return prompt;
}

/**
 * Walk to the checkpoint, taking whichever question the server offers next.
 *
 * The loop bound is not an assertion about the tree — "eight questions" is a
 * number the tree is allowed to change, and pinning it would make a content
 * edit look like a regression. What is asserted is that the checkpoint arrives,
 * not when.
 *
 * The progress line is the synchronisation point. It is `aria-live` and counts
 * answers the server accepted, so waiting for it to tick means the next
 * iteration is looking at the next question rather than at the last one.
 */
async function answerThroughCore(page: Page): Promise<readonly string[]> {
  const prompts: string[] = [];
  const checkpoint = page.getByRole("heading", { name: CHECKPOINT });
  const progress = page.locator("p.progress");

  await expect(progress).toHaveText("Nothing answered yet.");

  while ((await checkpoint.count()) === 0) {
    if (prompts.length >= MAX_QUESTIONS) {
      throw new Error(
        `the intake never reached the checkpoint in ${String(MAX_QUESTIONS)} answers`,
      );
    }
    prompts.push(await answerCurrent(page));
    // Nothing is stranded on the way down a fresh intake, so every write lands
    // and the count is exactly the number of questions answered so far.
    await expect(progress).toHaveText(
      new RegExp(`^${String(prompts.length)} answered\\b`, "u"),
      // A wrong count here means a write was rejected or silently dropped —
      // worth waiting for the real answer rather than failing on the first poll.
      { timeout: 15_000 },
    );
  }

  return prompts;
}

/** Every prompt in the "Your answers" panel, in the order it lists them. */
function answeredPrompts(page: Page): Locator {
  return page.locator("aside .answers .prompt");
}

async function startATrip(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Planner", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Describe a new trip" }).click();
  await expect(page.locator("section.panel.question")).toBeVisible();
}

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
