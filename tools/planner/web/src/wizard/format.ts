/**
 * Turning what the tool holds into what a user reads.
 *
 * Presentation only: nothing here decides anything, and nothing here parses a
 * value back. It exists so the brief and the answer list say the same thing
 * about the same value.
 */

import type { Answer, QuestionNode, TripBudget, TripDates } from "@planner/contract";

/** Enum members are kebab-case on the wire and prose on the page. */
export function humanise(value: string): string {
  return value.replaceAll("-", " ");
}

export function describeDates(dates: TripDates): string {
  switch (dates.kind) {
    case "exact":
      return `${dates.departure} to ${dates.return}`;
    case "window":
      return `${String(dates.nights)} nights between ${dates.earliest} and ${dates.latest}`;
    case "open":
      return `${String(dates.nights)} nights, whenever is best`;
  }
}

export function describeBudget(budget: TripBudget): string {
  return budget.kind === "band"
    ? humanise(budget.band)
    : `${budget.amount.toLocaleString()} ${budget.currency} ${humanise(budget.basis)}`;
}

/** A list, or the honest word for an empty one. */
function list(values: readonly (string | number)[]): string {
  return values.map((value) => (typeof value === "number" ? String(value) : value)).join(", ");
}

/** The label a choice was offered under, so nobody reads back a raw value. */
function labelOf(node: QuestionNode, value: string): string {
  if (node.kind !== "single-choice" && node.kind !== "multi-choice") return value;
  return node.choices.find((choice) => choice.value === value)?.label ?? humanise(value);
}

/**
 * What was said, for the list a user edits from.
 *
 * A **declined** question reads as a decision rather than a blank: the user was
 * asked and said it does not matter, and showing that as an empty row invites
 * re-answering something already settled.
 */
export function describeAnswer(node: QuestionNode, answer: Answer): string {
  if (answer.state === "declined") return "Not important";

  const { value } = answer;
  switch (value.kind) {
    case "single-choice":
      return labelOf(node, value.value);
    case "multi-choice":
      return value.values.map((each) => labelOf(node, each)).join(", ");
    case "text":
      return value.value;
    case "text-list":
      return list(value.values);
    case "number":
      return node.kind === "number" && node.unit !== null
        ? `${String(value.value)} ${node.unit}`
        : String(value.value);
    case "number-list":
      return list(value.values);
    case "dates":
      return describeDates(value.value);
    case "budget":
      return describeBudget(value.value);
  }
}
