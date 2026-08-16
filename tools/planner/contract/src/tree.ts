/**
 * The question tree's vocabulary — nodes, conditions, and the answers that come
 * back.
 *
 * `00-ANALYSIS.md` §3's amendment: the intake asks **authored questions**, and
 * no model is in it. This file is the shape of that authoring. The tree itself,
 * and every function over it, live in `@planner/intake` — a tree is data and
 * walking one is logic, and the contract holds the first without the second.
 *
 * ## The tree is a flat, ordered list with conditions
 *
 * Not a nested tree, despite the name everyone uses for it. Nesting cannot
 * express a question that depends on two separate ancestors — "you are driving
 * **and** it is winter" — and this domain is full of those. A flat list also
 * reads better in review, which matters when the tree is content.
 *
 * **A condition may reference only questions appearing earlier in the list.**
 * That single rule is what makes reachability one forward pass with no cycle
 * detection and no fixpoint, and `validateTree` in `@planner/intake` enforces
 * it.
 *
 * ## What a node fills
 *
 * Every node fills exactly one `TripBrief` slot, named by `fills` as a target
 * rather than a bare id. The scope is not decoration: `nightsOut` exists only on
 * the backcountry extension and `context` exists on all six, so "which slot"
 * is not answerable without "on which shape". Typed this way, a node that fills
 * a slot the shape does not have is a compile error rather than an answer that
 * quietly lands nowhere.
 *
 * ## Two discriminants, on purpose
 *
 * A node's `kind` is the control the wizard renders, and an answer carries the
 * same `kind` — so "does this answer fit this question" starts as one string
 * comparison, and pl-7's UI gets a control per kind that the compiler checks is
 * exhaustive.
 */

import { z } from "zod";
import {
  MAX_CONTEXT_CHARS,
  MAX_LIST_ITEMS,
  REQUIRED_CORE_SLOTS,
  REQUIRED_SHAPE_SLOTS,
  tripBudgetSchema,
  tripDatesSchema,
  type CoreSlotId,
  type ShapeSlotKeys,
  type TripBudget,
  type TripDates,
  type TripShape,
  type TripShapeDetails,
} from "./brief.ts";

/**
 * A node's identity, and the primary key an answer is stored under. Stable
 * across tree versions: reusing an id for a different question silently
 * re-purposes everyone's saved answer.
 */
export type QuestionId = string;

// ---------------------------------------------------------------------------
// What a node fills
// ---------------------------------------------------------------------------

export type CoreSlotTarget = { scope: "core"; slot: CoreSlotId };

/**
 * Distributed over the shapes, so each row is keyed to that shape's own slots.
 * `{ shape: "resort", slot: "nightsOut" }` does not typecheck.
 */
export type ShapeSlotTarget = {
  [S in TripShape]: {
    scope: "shape";
    shape: S;
    slot: ShapeSlotKeys<Extract<TripShapeDetails, { shape: S }>>;
  };
}[TripShape];

export type SlotTarget = CoreSlotTarget | ShapeSlotTarget;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * When a question applies.
 *
 * `equals` and `includes` read the answer's **text**, so they branch on choices
 * and free text and not on numbers, dates or budgets. That is a deliberate
 * limit rather than an oversight: a numeric comparison is a condition kind with
 * its own edge cases (units, integers, open bounds) and no question in the tree
 * needs one yet. Add it when one does.
 *
 * `answered` means the question came back with a value. A **declined** question
 * is settled but has no value, so a branch behind `answered` does not open —
 * "they told us, so ask the follow-up" is the reading, and "they shrugged" is
 * not a reason to dig.
 */
export type Condition =
  /** The answer to `question` is exactly `value`. Single-choice or text. */
  | { kind: "equals"; question: QuestionId; value: string }
  /** The answer to `question` contains `value`. Multi-choice or text list. */
  | { kind: "includes"; question: QuestionId; value: string }
  | { kind: "answered"; question: QuestionId }
  | { kind: "all"; of: readonly Condition[] }
  | { kind: "any"; of: readonly Condition[] }
  | { kind: "not"; of: Condition };

// A `conditionSchema` is deliberately absent. Conditions never cross a wire —
// the tree is ours, authored in TypeScript and checked by `validateTree` — and
// a schema written for an imagined parser is a second definition to keep in
// step. Answers *do* cross a wire, which is why they have one below.

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * **`stage` is where a question is asked, not whether it is needed.** `core` is
 * before the checkpoint, `refine` after it — the point where the wizard says the
 * essentials are done and offers the draft (§3's "draft early, interview less",
 * decided 2026-08-14).
 *
 * Whether a question blocks that draft is `isRequiredSlot` below, and the two
 * are not the same question. Until pl-18 they were the same *set*, and the
 * engine read `stage` as a proxy for both; `destination` is what separated them,
 * because it is asked third and may be left blank.
 *
 * One direction of the old invariant survives and is load-bearing: **every
 * required slot must be filled by a `core` node**, or the wizard offers a draft
 * `missingRequiredSlots` will refuse. The other direction is gone on purpose — a
 * `core` node whose slot is not required is an early optional question, which is
 * a thing the tree is now allowed to have. `validateTree` checks the surviving
 * direction, and checks that no `core` node sits behind a `refine` one.
 */
export const QUESTION_STAGES = ["core", "refine"] as const;
export type QuestionStage = (typeof QUESTION_STAGES)[number];

/**
 * Does this slot block a first draft?
 *
 * The single answer to "may this question be declined" and "does the checkpoint
 * wait for it". It lives here rather than beside the tables in `brief.ts`
 * because `SlotTarget` is here and this file already imports that one — the
 * other direction is a cycle.
 */
export function isRequiredSlot(target: SlotTarget): boolean {
  const required: readonly string[] =
    target.scope === "core" ? REQUIRED_CORE_SLOTS : REQUIRED_SHAPE_SLOTS[target.shape];
  return required.includes(target.slot);
}

/** One option of a choice question. `value` is stored; `label` is shown. */
export type Choice = { value: string; label: string };

export const QUESTION_KINDS = [
  "single-choice",
  "multi-choice",
  "text",
  "text-list",
  "number",
  "number-list",
  "dates",
  "budget",
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

type QuestionBase = {
  id: QuestionId;
  /** What the user reads. The tree is content, and this is the content. */
  prompt: string;
  /** A sentence under the prompt, when the prompt alone would be ambiguous. */
  help: string | null;
  /** When this question applies. `null` is "always". */
  when: Condition | null;
  fills: SlotTarget;
  stage: QuestionStage;
};

/**
 * A question, discriminated on the control it needs.
 *
 * The bounds carried here (`min`, `max`, `maxLength`, `maxItems`) are the
 * wizard's input attributes and `validateAnswer`'s rules. They may be tighter
 * than the brief's schema for that slot — "how many hours will you drive in a
 * day" is 1–14 where the slot allows 24 — but never looser: `toBrief` parses
 * the assembled brief against the contract, so a looser bound is a tree bug
 * that surfaces as an assembly failure.
 */
export type QuestionNode =
  | (QuestionBase & { kind: "single-choice"; choices: readonly Choice[] })
  | (QuestionBase & { kind: "multi-choice"; choices: readonly Choice[] })
  | (QuestionBase & { kind: "text"; maxLength: number })
  | (QuestionBase & { kind: "text-list"; maxLength: number; maxItems: number })
  | (QuestionBase & {
      kind: "number";
      min: number;
      max: number;
      integer: boolean;
      /** Shown beside the input — "hours", "km", "nights". */
      unit: string | null;
    })
  | (QuestionBase & {
      kind: "number-list";
      min: number;
      max: number;
      integer: boolean;
      maxItems: number;
      unit: string | null;
    })
  | (QuestionBase & { kind: "dates" })
  | (QuestionBase & { kind: "budget" });

/**
 * The authored tree.
 *
 * `version` goes up whenever the nodes change. It is stored on an intake so a
 * tree that moved under a saved intake is visible rather than silent — what to
 * *do* about that is pl-7's decision.
 */
export type QuestionTree = {
  version: number;
  nodes: readonly QuestionNode[];
};

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/**
 * What came back for one question, carrying the kind of the question it answers.
 *
 * The bounds below are the outer ceilings — the widest any slot allows — and
 * they exist so an HTTP body cannot be unbounded. The node's own bounds are
 * tighter and are checked by `validateAnswer`, which is where a user-facing
 * message about *this* question comes from.
 */
export type AnswerValue =
  | { kind: "single-choice"; value: string }
  | { kind: "multi-choice"; values: string[] }
  | { kind: "text"; value: string }
  | { kind: "text-list"; values: string[] }
  | { kind: "number"; value: number }
  | { kind: "number-list"; values: number[] }
  | { kind: "dates"; value: TripDates }
  | { kind: "budget"; value: TripBudget };

/**
 * An answer, or the deliberate absence of one.
 *
 * There is no `unknown` state here the way there is on a `Slot`: an unanswered
 * question is a row that does not exist. `declined` is a stored answer because
 * "I do not care" is a thing the user said, and forgetting it re-asks the
 * question forever.
 */
export type Answer = { state: "declined" } | { state: "answered"; value: AnswerValue };

/** Every answer an intake holds, keyed by question id. */
export type Answers = Readonly<Record<QuestionId, Answer>>;

/** Trimmed, because a text answer's length bound should not count spaces. */
const answerText = z.string().trim().max(MAX_CONTEXT_CHARS);

export const answerValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single-choice"), value: z.string().min(1) }),
  z.object({
    kind: z.literal("multi-choice"),
    values: z.array(z.string().min(1)).max(MAX_LIST_ITEMS),
  }),
  z.object({ kind: z.literal("text"), value: answerText }),
  z.object({ kind: z.literal("text-list"), values: z.array(answerText).max(MAX_LIST_ITEMS) }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({
    kind: z.literal("number-list"),
    values: z.array(z.number().finite()).max(MAX_LIST_ITEMS),
  }),
  z.object({ kind: z.literal("dates"), value: tripDatesSchema }),
  z.object({ kind: z.literal("budget"), value: tripBudgetSchema }),
]) satisfies z.ZodType<AnswerValue>;

export const answerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("declined") }),
  z.object({ state: z.literal("answered"), value: answerValueSchema }),
]) satisfies z.ZodType<Answer>;
