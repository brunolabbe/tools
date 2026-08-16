// @vitest-environment jsdom

/**
 * The two rules from this tool's `CLAUDE.md` that are UI claims, held to.
 *
 * - **Never discard an answer silently.** Every write past the first is
 *   previewed, the user reads a list of prompts, and nothing is written until
 *   they say so. The assertion that matters is the negative one: `submitAnswer`
 *   was never called. Delete the `previewAnswer` call in `Wizard.tsx` and this
 *   file goes red.
 * - **The intake stops at the core questions.** `coreComplete` with a question
 *   still to ask is the checkpoint, not a reason to march on.
 *
 * **The fake is the API client module, never `fetch`.** `src/api/intake.ts` is
 * the seam and it is one module; stubbing `fetch` would mean re-implementing
 * route shapes here, which is a second copy of the server to keep in step.
 *
 * See `controls.test.tsx` for why the DOM arrives as a docblock rather than a
 * vitest project of its own.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionNode } from "@planner/contract";
import { fetchIntake, previewAnswer, submitAnswer } from "../src/api/intake.ts";
import { Wizard } from "../src/wizard/Wizard.tsx";
import { BASE, intakeState } from "./fixtures.ts";

// Hoisted above the imports by vitest, which is why the factory names no
// binding from this file. The seam is the whole client module — three functions
// — so nothing here has to know a route shape.
vi.mock("../src/api/intake.ts", () => ({
  fetchIntake: vi.fn(),
  previewAnswer: vi.fn(),
  submitAnswer: vi.fn(),
}));

const fetched = vi.mocked(fetchIntake);
const previewed = vi.mocked(previewAnswer);
const submitted = vi.mocked(submitAnswer);

beforeEach(() => {
  vi.clearAllMocks();
});

// The planner project runs with `globals: false`, so Testing Library registers
// no cleanup of its own and a second render would find two wizards mounted.
afterEach(cleanup);

const CHOICES = [
  { value: "mountains", label: "Mountains" },
  { value: "coast", label: "Coast" },
] as const;

/** A core question, which is the one a checkpoint and a decline both hinge on. */
const CORE: QuestionNode = {
  ...BASE,
  id: "core.where",
  prompt: "Where are you going?",
  kind: "single-choice",
  choices: CHOICES,
};

const REFINE: QuestionNode = {
  ...BASE,
  id: "refine.pace",
  prompt: "How fast do you want to move?",
  stage: "refine",
  kind: "single-choice",
  choices: CHOICES,
};

const ALREADY_ANSWERED: QuestionNode = {
  ...BASE,
  id: "core.shape",
  prompt: "What kind of trip is it?",
  kind: "single-choice",
  choices: CHOICES,
};

/** One answer on record, which is what puts the next write past the preview gate. */
const ANSWERS = {
  [ALREADY_ANSWERED.id]: { state: "answered", value: { kind: "single-choice", value: "coast" } },
} as const;

function mount(): void {
  render(<Wizard intakeId="intake-1" onExit={vi.fn()} onDraft={vi.fn()} />);
}

// ---------------------------------------------------------------------------
// A core question cannot be declined, so it must not offer the button
// ---------------------------------------------------------------------------

test("a core question offers no way to decline it", async () => {
  fetched.mockResolvedValue(intakeState({ questions: [CORE] }));
  mount();

  expect(await screen.findByRole("heading", { name: CORE.prompt })).toBeDefined();
  // The engine refuses a declined core answer, so the button would be a lie.
  expect(screen.queryByRole("button", { name: "Not important" })).toBeNull();
  expect(screen.getByRole("button", { name: "Next" })).toBeDefined();
});

test("a refine question does offer it, and declining is a write", async () => {
  fetched.mockResolvedValue(intakeState({ questions: [REFINE] }));
  submitted.mockResolvedValue(intakeState({ questions: [REFINE], progress: { question: null } }));
  mount();

  await screen.findByRole("heading", { name: REFINE.prompt });
  await userEvent.click(screen.getByRole("button", { name: "Not important" }));

  await waitFor(() => {
    expect(submitted).toHaveBeenCalledWith("intake-1", REFINE.id, { state: "declined" });
  });
  // Nothing was on record, so nothing could be stranded and nothing was previewed.
  expect(previewed).not.toHaveBeenCalled();
});

test("the Next button stays disabled until the field reports an answer", async () => {
  fetched.mockResolvedValue(intakeState({ questions: [CORE] }));
  mount();

  await screen.findByRole("heading", { name: CORE.prompt });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);

  await userEvent.click(screen.getByRole("radio", { name: "Coast" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(false);
});

// ---------------------------------------------------------------------------
// Never discard an answer silently
// ---------------------------------------------------------------------------

/** Answers a change would cost, as the server's `prune` would report them. */
const COST = [
  { question: "road-trip.drive-hours", prompt: "How many hours a day will you drive?" },
  { question: "road-trip.route-style", prompt: "Motorway or back roads?" },
] as const;

async function answerPastThePreviewGate(): Promise<void> {
  fetched.mockResolvedValue(
    intakeState({
      questions: [ALREADY_ANSWERED, CORE],
      answers: ANSWERS,
      progress: { question: CORE },
    }),
  );
  mount();
  await screen.findByRole("heading", { name: CORE.prompt });
  await userEvent.click(screen.getByRole("radio", { name: "Mountains" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

test("a costly change is previewed by prompt and written only once confirmed", async () => {
  previewed.mockResolvedValue(COST);
  submitted.mockResolvedValue(intakeState({ questions: [ALREADY_ANSWERED, CORE] }));

  await answerPastThePreviewGate();

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("That change costs 2 answers.");
  for (const entry of COST) {
    expect(screen.getByText(entry.prompt)).toBeDefined();
    // By prompt and never by id: "road-trip.drive-hours" is not a sentence
    // anyone said.
    expect(dialog.textContent).not.toContain(entry.question);
  }

  // The whole point: nothing has been written yet.
  expect(submitted).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Change it anyway" }));
  await waitFor(() => {
    expect(submitted).toHaveBeenCalledWith("intake-1", CORE.id, {
      state: "answered",
      value: { kind: "single-choice", value: "mountains" },
    });
  });
});

test("keeping what I had writes nothing and returns to the question", async () => {
  previewed.mockResolvedValue(COST);

  await answerPastThePreviewGate();
  await screen.findByRole("alertdialog");

  await userEvent.click(screen.getByRole("button", { name: "Keep what I had" }));

  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(await screen.findByRole("heading", { name: CORE.prompt })).toBeDefined();
  expect(submitted).not.toHaveBeenCalled();
});

test("an answer the tree no longer has is named as an answer, not as an id", async () => {
  previewed.mockResolvedValue([{ question: "road-trip.gone", prompt: null }]);

  await answerPastThePreviewGate();

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("That change costs 1 answer.");
  expect(screen.getByText("Some earlier answers no longer apply.")).toBeDefined();
  expect(dialog.textContent).not.toContain("road-trip.gone");
  expect(submitted).not.toHaveBeenCalled();
});

test("a load that discarded answers says so before anything else happens", async () => {
  fetched.mockResolvedValue(
    intakeState({
      questions: [CORE],
      discarded: [{ question: "gone.one", prompt: "How many nights out?" }],
    }),
  );
  mount();

  const notice = await screen.findByText(/No longer needed/);
  expect(notice.textContent).toContain("How many nights out?");
  expect(notice.textContent).not.toContain("gone.one");
});

// ---------------------------------------------------------------------------
// The intake stops at the core questions
// ---------------------------------------------------------------------------

test("core-complete with more to ask is a checkpoint, and both ways on are offered", async () => {
  fetched.mockResolvedValue(
    intakeState({
      questions: [ALREADY_ANSWERED, REFINE],
      answers: ANSWERS,
      progress: { question: REFINE, coreComplete: true },
    }),
  );
  mount();

  expect(await screen.findByRole("heading", { name: "The essentials are done." })).toBeDefined();
  // It stopped: the next question is not on screen.
  expect(screen.queryByRole("heading", { name: REFINE.prompt })).toBeNull();

  expect(screen.getByRole("button", { name: "Keep refining" })).toBeDefined();
  expect(screen.getByRole("button", { name: "That is enough for now" })).toBeDefined();

  await userEvent.click(screen.getByRole("button", { name: "Keep refining" }));
  expect(screen.getByRole("heading", { name: REFINE.prompt })).toBeDefined();
});

test("core-complete with nothing left to sharpen offers only the way out", async () => {
  fetched.mockResolvedValue(
    intakeState({
      questions: [ALREADY_ANSWERED],
      answers: ANSWERS,
      progress: { question: null, coreComplete: true },
    }),
  );
  const onExit = vi.fn();
  render(<Wizard intakeId="intake-1" onExit={onExit} onDraft={vi.fn()} />);

  const heading = await screen.findByRole("heading", { name: "The essentials are done." });
  expect(heading.parentElement?.textContent).toContain("nothing left to sharpen");
  expect(screen.queryByRole("button", { name: "Keep refining" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "That is enough for now" }));
  expect(onExit).toHaveBeenCalledOnce();
});

test("progress is what the tool can stand behind, and no more", async () => {
  fetched.mockResolvedValue(intakeState({ questions: [CORE] }));
  mount();

  expect(await screen.findByText("Nothing answered yet.")).toBeDefined();

  cleanup();
  fetched.mockResolvedValue(
    intakeState({
      questions: [ALREADY_ANSWERED, CORE],
      answers: ANSWERS,
      progress: { question: CORE },
    }),
  );
  mount();

  // A count and a milestone, never a percentage of a reachable set that moves.
  expect(await screen.findByText("1 answered, and more to come.")).toBeDefined();
});
