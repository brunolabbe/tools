/**
 * Does this answer fit this question?
 *
 * The layer above parses the body with the contract's `answerSchema` — that is
 * where `unknown` becomes a typed `Answer`, and this file assumes it happened.
 * What is left is everything the schema cannot know: the question's own bounds,
 * its list of choices, and the rules that need today's date.
 *
 * **`now` is an argument.** A `Date.now()` inside a pure engine is a test that
 * fails at midnight, and it is the reason this package has no clock.
 */

import {
  AppError,
  isRequiredSlot,
  MAX_TRIP_NIGHTS,
  type Answer,
  type AnswerValue,
  type QuestionKind,
  type QuestionNode,
  type TripDates,
} from "@planner/contract";

function invalid(node: QuestionNode, message: string): AppError {
  return new AppError("INVALID_ANSWER", message, { details: { question: node.id } });
}

function invalidDates(node: QuestionNode, message: string): AppError {
  return new AppError("INVALID_DATES", message, { details: { question: node.id } });
}

/**
 * A node and an answer of the same kind, tied together.
 *
 * The compiler cannot correlate two unions through an `===` between their
 * discriminants, so the pairing is checked once at runtime here and typed once
 * for everything below.
 */
type KindedPair = {
  [K in QuestionKind]: {
    kind: K;
    node: Extract<QuestionNode, { kind: K }>;
    value: Extract<AnswerValue, { kind: K }>;
  };
}[QuestionKind];

function pair(node: QuestionNode, value: AnswerValue): KindedPair | null {
  return node.kind === value.kind ? ({ kind: node.kind, node, value } as KindedPair) : null;
}

/** Days from one ISO date to another. Both are UTC midnight, so no clock and no zone. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * The date rules that need to know what day it is.
 *
 * Compared in UTC. The server does not know the traveller's timezone, so the
 * boundary can be a few hours off for someone booking near midnight — the
 * alternative is inventing a zone, and being wrong about a departure by one day
 * is worse than being strict by a few hours.
 *
 * Ordering — a return before its departure, a window that ends before it starts
 * — is already the contract schema's job and is not repeated here.
 */
function checkDates(node: QuestionNode, dates: TripDates, now: Date): void {
  const today = now.toISOString().slice(0, 10);

  switch (dates.kind) {
    case "exact": {
      if (dates.departure < today) {
        throw invalidDates(node, "That departure date has already passed.");
      }
      if (daysBetween(dates.departure, dates.return) > MAX_TRIP_NIGHTS) {
        throw invalidDates(node, `This tool plans trips of up to ${MAX_TRIP_NIGHTS} nights.`);
      }
      return;
    }
    case "window": {
      if (dates.earliest < today) {
        throw invalidDates(node, "That window has already started.");
      }
      // "Two weeks between the 1st and the 7th" — the same cause as every other
      // date failure (these dates contradict each other), which is why it is
      // the same code with different details rather than a code of its own.
      if (daysBetween(dates.earliest, dates.latest) < dates.nights) {
        throw invalidDates(node, "That window is too short to hold a trip that long.");
      }
      return;
    }
    case "open":
      // Duration only, and `nights` is bounded by the schema. Nothing here
      // needs a date at all, which is the honest state for "whenever is best".
      return;
  }
}

function checkText(node: QuestionNode, text: string, maxLength: number): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw invalid(node, "That answer is empty.");
  if (trimmed.length > maxLength) {
    throw invalid(node, `Keep that under ${maxLength} characters.`);
  }
}

function checkNumber(
  node: QuestionNode,
  value: number,
  bounds: { min: number; max: number; integer: boolean; unit: string | null },
): void {
  if (bounds.integer && !Number.isInteger(value)) {
    throw invalid(node, "That needs to be a whole number.");
  }
  if (value < bounds.min || value > bounds.max) {
    const unit = bounds.unit === null ? "" : ` ${bounds.unit}`;
    throw invalid(node, `That needs to be between ${bounds.min} and ${bounds.max}${unit}.`);
  }
}

function checkItemCount(node: QuestionNode, count: number, maxItems: number): void {
  if (count === 0) throw invalid(node, "That answer is empty.");
  if (count > maxItems) throw invalid(node, `Keep that to ${maxItems} or fewer.`);
}

/**
 * Throws unless the answer fits the question.
 *
 * Takes the whole `Answer` rather than only its value, because declining is one
 * of the things that can be wrong: **a question filling a required slot cannot
 * be declined.** A declined slot counts as settled, so allowing it would let
 * someone shrug their way past the checkpoint and be told the essentials are
 * done over an empty brief.
 *
 * The test is `isRequiredSlot`, not `stage === "core"`. Those picked out the
 * same questions until pl-18 and no longer do: `destination` is asked third and
 * may be declined, which is the whole reason it could move up the tree. What
 * makes a question undeclinable is that a draft is impossible without it, which
 * is a fact about its slot rather than about its position.
 */
export function validateAnswer(node: QuestionNode, answer: Answer, now: Date): void {
  if (answer.state === "declined") {
    if (isRequiredSlot(node.fills)) {
      throw invalid(node, "This one is needed before a plan can be drafted.");
    }
    return;
  }

  const matched = pair(node, answer.value);
  if (matched === null) {
    throw invalid(node, "That answer is not the kind this question asks for.");
  }

  switch (matched.kind) {
    case "single-choice": {
      const { value } = matched.value;
      if (!matched.node.choices.some((choice) => choice.value === value)) {
        throw invalid(node, "That is not one of the options.");
      }
      return;
    }
    case "multi-choice": {
      const { values } = matched.value;
      const { choices } = matched.node;
      checkItemCount(node, values.length, choices.length);
      if (new Set(values).size !== values.length) {
        throw invalid(node, "That answer repeats an option.");
      }
      if (!values.every((value) => choices.some((choice) => choice.value === value))) {
        throw invalid(node, "That is not one of the options.");
      }
      return;
    }
    case "text":
      checkText(node, matched.value.value, matched.node.maxLength);
      return;
    case "text-list": {
      const { values } = matched.value;
      checkItemCount(node, values.length, matched.node.maxItems);
      for (const value of values) checkText(node, value, matched.node.maxLength);
      return;
    }
    case "number":
      checkNumber(node, matched.value.value, matched.node);
      return;
    case "number-list": {
      const { values } = matched.value;
      checkItemCount(node, values.length, matched.node.maxItems);
      for (const value of values) checkNumber(node, value, matched.node);
      return;
    }
    case "dates":
      checkDates(node, matched.value.value, now);
      return;
    case "budget":
      // A currency, a positive finite amount, a basis — or a band. All of it is
      // true without a clock and without the question, so the schema has
      // already said so.
      return;
  }
}
