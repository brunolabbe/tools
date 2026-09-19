/**
 * `PlanRevision.deadlines`: placed items whose booking lead time no longer fits
 * before departure, as of the last dates edit (pl-47).
 *
 * **Worked out once, by the edit, with the `now` it was given**, and stored.
 * Everything else `unchecked.ts` produces is derived on read with no clock, and
 * this cannot be: "is there still time to book it" depends on the day it is
 * asked. So a brief edit asks it, and every later writer carries the answer —
 * `replan` and `applyEdit` through `carriedDeadlines`, `restoreRevision` by
 * copying its target's, and `compose` writes `[]`, because the packer never
 * places such a candidate unless it is pinned, and a first draft has no pins.
 *
 * No clock here either: `now` is an argument, as it is everywhere in this
 * package.
 */

import type { Candidate, PlanDay, TripDates, UncheckedConstraint } from "@planner/contract";
import { daysUntilDeparture } from "./dates.ts";
import { unchecked } from "./unchecked.ts";

const DETAIL =
  "These need booking further ahead than there was time for when the dates were last changed. They were kept on the plan, and may no longer be bookable.";

function placedIn(days: readonly PlanDay[]): string[] {
  return days.flatMap((day) => day.items.map((item) => item.candidateId));
}

/**
 * One entry naming every placed item whose `bookingLeadTimeDays` exceeds the
 * days left before departure, or `[]` when none does.
 *
 * `open` dates give `[]`: there is no departure to count back from, and the
 * derived `booking-no-departure` already says so.
 */
export function deadlinesFor(input: {
  dates: TripDates;
  candidates: readonly Candidate[];
  days: readonly PlanDay[];
  now: Date;
}): UncheckedConstraint[] {
  const left = daysUntilDeparture(input.dates, input.now);
  if (left === null) return [];

  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const late = placedIn(input.days).filter((id) => {
    const lead = byId.get(id)?.bookingLeadTimeDays ?? null;
    return lead !== null && lead > left;
  });
  return late.length === 0 ? [] : [unchecked("booking-deadline-passed", DETAIL, late)];
}

/**
 * `previous`'s entries, narrowed to the candidates `days` still places, and
 * dropped when nothing is left. A later move keeps an entry while its item is
 * on the plan; a remove of the last one it names takes it away.
 */
export function carriedDeadlines(
  previous: readonly UncheckedConstraint[],
  days: readonly PlanDay[],
): UncheckedConstraint[] {
  const placed = new Set(placedIn(days));
  return previous.flatMap((entry) => {
    const still = entry.candidateIds.filter((id) => placed.has(id));
    return still.length === 0 ? [] : [{ ...entry, candidateIds: still }];
  });
}
