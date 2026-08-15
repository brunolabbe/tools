/**
 * Where answers stop being answers and become the document specialists read.
 *
 * Nothing downstream of here sees a question, a condition or a tree — only the
 * `TripBrief`. That indirection is what makes the fan-out testable from a
 * fixture, and it is what let the intake stop being a model interview without
 * anything below noticing (§3's amendment).
 */

import {
  AppError,
  emptyBrief,
  slot,
  TRIP_SHAPES,
  tripBriefSchema,
  withShape,
  type Answer,
  type Answers,
  type QuestionNode,
  type QuestionTree,
  type Slot,
  type TripBrief,
  type TripShape,
  type TripShapeDetails,
} from "@planner/contract";
import { reachable } from "./engine.ts";

/**
 * Set one slot by name.
 *
 * The compiler cannot check an assignment through a computed key across slots
 * of different value types, and the honest options are a cast here or a writer
 * function per slot — thirty-odd of them, restating what the tree already says.
 * The cast is the smaller lie, and it is not the last word: `toBrief` parses
 * the assembled brief against the contract's own schema before returning it, so
 * a node whose kind does not fit its slot fails loudly rather than quietly
 * producing a brief with a number where a date belongs.
 */
function withSlot<T extends object>(target: T, name: string, value: Slot<unknown>): T {
  return { ...target, [name]: value } as T;
}

/** An answer as the slot it fills. `declined` survives the trip; it is an answer. */
function asSlot(answer: Answer): Slot<unknown> {
  if (answer.state === "declined") return slot.declined();

  const { value } = answer;
  switch (value.kind) {
    case "single-choice":
    case "text":
    case "number":
    case "dates":
    case "budget":
      return slot.answered(value.value);
    case "multi-choice":
    case "text-list":
    case "number-list":
      return slot.answered(value.values);
  }
}

function asTripShape(value: string): TripShape | null {
  return (TRIP_SHAPES as readonly string[]).includes(value) ? (value as TripShape) : null;
}

function write(brief: TripBrief, node: QuestionNode, answer: Answer): TripBrief {
  const target = node.fills;

  // `shape` is the one slot with a consequence: it decides which extension the
  // brief carries. `withShape` is the contract's own operation for that, and it
  // keeps every core answer while swapping only `details`.
  if (target.scope === "core" && target.slot === "shape") {
    if (answer.state === "declined") return withSlot(brief, "shape", slot.declined());

    const value = answer.value;
    const shape = value.kind === "single-choice" ? asTripShape(value.value) : null;
    if (shape === null) {
      throw new AppError("INTERNAL", undefined, {
        details: { question: node.id, reason: "not a trip shape" },
      });
    }
    return withShape(brief, shape);
  }

  if (target.scope === "core") return withSlot(brief, target.slot, asSlot(answer));

  const { details } = brief;
  // Unreachable against a tree `validateTree` accepts: a shape question is
  // gated on its own shape, so it cannot be reachable while `details` is
  // something else. Loud rather than silent, because the alternative is
  // dropping an answer the user gave.
  if (details === null || details.shape !== target.shape) {
    throw new AppError("INTERNAL", undefined, {
      details: { question: node.id, reason: "shape question reached under another shape" },
    });
  }

  return { ...brief, details: withSlot<TripShapeDetails>(details, target.slot, asSlot(answer)) };
}

/**
 * Assemble the brief these answers describe.
 *
 * Only reachable answers are read: an answer stranded on an abandoned branch is
 * not part of the trip being described, whatever the store still holds. Callers
 * that write also `prune`, so the two agree — this function does not need them
 * to.
 */
export function toBrief(tree: QuestionTree, answers: Answers): TripBrief {
  let brief = emptyBrief();

  for (const node of reachable(tree, answers)) {
    const answer = answers[node.id];
    if (answer !== undefined) brief = write(brief, node, answer);
  }

  const parsed = tripBriefSchema.safeParse(brief);
  if (!parsed.success) {
    // The tree and the brief disagree — a bug in one of them, not something a
    // user did. Paths and codes only: the values are the user's own text.
    throw new AppError("INTERNAL", undefined, {
      details: {
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
      },
    });
  }

  return parsed.data;
}
