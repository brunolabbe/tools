/**
 * `PlanRevision.reason` — the caption a diff is read under (pl-44).
 *
 * **Derived server-side from what happened, never taken from the client.** The
 * request carries no caption (pl-42), and a `note` is not one: a note is what
 * the traveller cares about, and the caption is a sentence about what the tool
 * did. So this function is told the operation's facts — which days, which
 * specialists actually **ran**, which item, which version — and nothing a user
 * typed except a candidate title, which is a model's.
 *
 * - **Day numbers are 1-based**, which is what a reader sees. A contiguous run
 *   is written with an en dash, a scattered set as `days 2, 4–5 and 7`.
 * - **Specialists** are their `SPECIALIST_DEFINITIONS` titles, in
 *   `SPECIALIST_ORDER`, joined `a, b and c`.
 * - **"Ran" is `FanOutResult.roster.ran`**, not what was named. A named
 *   specialist that was not applicable or was dropped for budget is left out,
 *   so the caption never says "with food" about a plan food did not touch; its
 *   gap says why, and the stored operation still says what was asked.
 * - **Say "version"**, matching `REVISION_NOT_FOUND`'s copy.
 *
 * A candidate title is model-written and bounded at `MAX_CANDIDATE_TITLE_CHARS`
 * (200). It is rendered as text, and every branch fits
 * `MAX_REVISION_REASON_CHARS` (500) by arithmetic: the longest is a move,
 * `Moved “<200>” from day 60 to day 60.`, at 227.
 */

import { SPECIALIST_DEFINITIONS, SPECIALIST_ORDER } from "@planner/agent";
import type { Specialist } from "@planner/contract";

export type ReasonInput =
  | {
      kind: "replan";
      /** 0-based day indexes, as the operation stores them. */
      days: readonly number[];
      /** `FanOutResult.roster.ran`'s specialists; empty when nothing ran. */
      ran: readonly Specialist[];
    }
  | { kind: "move"; title: string; fromDayIndex: number; toDayIndex: number }
  | { kind: "remove"; title: string; fromDayIndex: number }
  | { kind: "restore"; revision: number }
  | {
      kind: "brief";
      /** Which slots the edit changed. At least one. */
      dates: boolean;
      budget: boolean;
      /** The base revision's day count, and the edited one's. */
      before: number;
      after: number;
      /** The slice was every day: a budget change, or a new day count under a per-day budget. */
      everyDay: boolean;
    };

/** `a`, `a and b`, `a, b and c`. */
function joined(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** `day 3`, `days 3–4`, `days 2, 4–5 and 7`, from 0-based indexes. */
export function dayList(days: readonly number[]): string {
  const sorted = [...new Set(days)].toSorted((left, right) => left - right).map((day) => day + 1);

  const runs: string[] = [];
  let start = sorted[0];
  let end = start;
  for (const day of [...sorted.slice(1), undefined]) {
    if (start === undefined || end === undefined) break;
    if (day !== undefined && day === end + 1) {
      end = day;
      continue;
    }
    runs.push(start === end ? String(start) : `${String(start)}–${String(end)}`);
    start = day;
    end = day;
  }

  return `${sorted.length === 1 ? "day" : "days"} ${joined(runs)}`;
}

function specialistList(ran: readonly Specialist[]): string {
  const named = new Set(ran);
  return joined(
    SPECIALIST_ORDER.filter((specialist) => named.has(specialist)).map(
      (specialist) => SPECIALIST_DEFINITIONS[specialist].title,
    ),
  );
}

export function revisionReason(input: ReasonInput): string {
  switch (input.kind) {
    case "replan":
      return input.ran.length === 0
        ? `Re-packed ${dayList(input.days)} from what was already proposed.`
        : `Re-planned ${dayList(input.days)} with ${specialistList(input.ran)}.`;
    case "move":
      return input.fromDayIndex === input.toDayIndex
        ? `Moved “${input.title}” within day ${String(input.fromDayIndex + 1)}.`
        : `Moved “${input.title}” from day ${String(input.fromDayIndex + 1)} to day ${String(input.toDayIndex + 1)}.`;
    case "remove":
      return `Removed “${input.title}” from day ${String(input.fromDayIndex + 1)}.`;
    case "restore":
      return `Restored version ${String(input.revision)}.`;
    case "brief":
      return briefReason(input);
  }
}

/** Day indexes `from` to `to`, exclusive, for `dayList`. */
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

/**
 * A brief edit's caption (pl-47): what the user changed, then what the tool
 * did with it. No date and no amount — formatting either is the page's job,
 * and the operation carries both ends.
 *
 * The subject names only what was changed. A new day count under a `per-day`
 * budget re-packs every day although the budget slot did not move, and the
 * caption says "Changed the dates, and re-packed every day" for it rather than
 * claiming a budget change nobody made.
 */
function briefReason(input: Extract<ReasonInput, { kind: "brief" }>): string {
  const subject =
    input.dates && input.budget
      ? "the dates and the budget"
      : input.dates
        ? "the dates"
        : "the budget";
  const dropped = range(input.after, input.before);

  if (input.everyDay) {
    return dropped.length > 0
      ? `Changed ${subject}, dropped ${dayList(dropped)}, and re-packed the rest.`
      : `Changed ${subject}, and re-packed every day.`;
  }
  if (input.after > input.before) {
    return `Changed ${subject}, and planned ${dayList(range(input.before, input.after))}.`;
  }
  if (dropped.length > 0) return `Changed ${subject}, and dropped ${dayList(dropped)}.`;
  return `Changed ${subject}.`;
}
