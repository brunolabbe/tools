/**
 * The shapes the server hands the wizard, built here rather than asserted.
 *
 * Two rules from pl-12's brief are load-bearing in this file:
 *
 * - **Do not assert the tree.** Which questions exist, what each one opens and
 *   what an edit discards are `@planner/intake`'s answers, and a component test
 *   that reached for the real `QUESTION_TREE` would be asserting a fixture — a
 *   content edit would then turn these tests red for no defect. So the nodes
 *   these suites build are invented, minimal and named for what the test is
 *   about.
 * - **They are still the server's shapes.** Every node and every state is typed
 *   against `@planner/contract`, so a change to `IntakeState`, `QuestionNode` or
 *   `AnswerValue` breaks the suite at `npm run check` rather than letting it go
 *   on rendering a state the server can no longer produce.
 *
 * `brief` comes from the contract's own `emptyBrief()` for the same reason: the
 * slot inventory is not this suite's to restate.
 */

import {
  emptyBrief,
  type Answers,
  type DiscardedAnswer,
  type IntakeProgressView,
  type IntakeState,
  type QuestionNode,
} from "@planner/contract";

/**
 * Everything a node carries that is not its control, to spread into a literal:
 * `{ ...BASE, id: "q", kind: "text", maxLength: 200 }`. Spelling the control's
 * own half out at each call site is what keeps these checked against the union
 * with no cast in the middle.
 *
 * `fills` has to name a real slot — the target type is distributed over the trip
 * shapes — and since pl-18 it names `origin` because something **does** read it:
 * the wizard offers its skip button on `!isRequiredSlot(question.fills)`. This
 * used to name `destination`, which is now the one core slot a draft does not
 * need, so every question built from `BASE` would come out skippable.
 */
export const BASE = {
  prompt: "Where are you leaving from?",
  help: null,
  when: null,
  stage: "core",
  fills: { scope: "core", slot: "origin" },
} as const satisfies Omit<Extract<QuestionNode, { kind: "dates" }>, "id" | "kind">;

export interface IntakeStateOverrides {
  questions?: readonly QuestionNode[];
  answers?: Answers;
  progress?: Partial<IntakeProgressView>;
  discarded?: readonly DiscardedAnswer[];
}

/**
 * An `IntakeState` in the shape a read or a write would return.
 *
 * `progress.question` defaults to the first question, which is what an intake
 * with nothing answered looks like; a test that is about the checkpoint or the
 * exhausted tree says so by overriding it.
 */
export function intakeState(overrides: IntakeStateOverrides = {}): IntakeState {
  const questions = overrides.questions ?? [];
  return {
    intake: {
      id: "intake-1",
      title: null,
      treeVersion: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    questions,
    answers: overrides.answers ?? {},
    progress: {
      question: questions[0] ?? null,
      coreComplete: false,
      ...overrides.progress,
    },
    brief: emptyBrief(),
    discarded: overrides.discarded ?? [],
  };
}
