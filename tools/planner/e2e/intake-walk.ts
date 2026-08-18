/**
 * Getting a browser to the checkpoint, without naming a question.
 *
 * Every spec in this suite that wants a plan has to describe a trip first, and
 * the walk that does it is the part of an e2e that is most tempting to write
 * twice. It is also the part with a rule attached: **the tree is authored
 * content and is reviewed as content**, so a spec that types into
 * `#field-road-trip.drive-appetite` or counts eight questions turns a content
 * edit into a red build. That rule is easy to hold in one file and easy to lose
 * in the second copy, which is why there is no second copy.
 *
 * Nothing here is exported to the app: it drives the DOM and reads every prompt
 * off the screen, which is also why `e2e/tsconfig.json` has no `references`.
 *
 * It is not a `.spec.ts`, so the runner never collects it as a test —
 * `testMatch` is `**\/*.spec.ts` — while `tsconfig.json`'s `**\/*.ts` still
 * type-checks it.
 */

// oxlint-disable no-await-in-loop -- the walk is sequential by definition: the
// server decides the next question from the answer to the last one, so there is
// nothing to run in parallel and `Promise.all` would be answering questions
// nobody has been asked yet.

import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** A bound on the walk, not a claim about the tree. See the note in `answerThroughCore`. */
const MAX_QUESTIONS = 64;

export const CHECKPOINT = "The essentials are done.";

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
export async function answerThroughCore(page: Page): Promise<readonly string[]> {
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
export function answeredPrompts(page: Page): Locator {
  return page.locator("aside .answers .prompt");
}

/**
 * Wait for the app shell, which is what "the page is ready" means here.
 *
 * The `h1` is the first thing React renders in every state, so it is the wait
 * after any `goto` or `reload`. It lives here rather than in the spec that
 * reloads because two files asserting the same heading text is the same second
 * copy this module exists to prevent — a rename would fix one and leave the
 * other timing out on a string nothing renders.
 */
export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Planner", exact: true })).toBeVisible();
}

export async function startATrip(page: Page): Promise<void> {
  await page.goto("/");
  await waitForShell(page);

  await page.getByRole("button", { name: "Describe a new trip" }).click();
  await expect(page.locator("section.panel.question")).toBeVisible();
}
