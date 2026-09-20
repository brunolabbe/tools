/**
 * Edit a version's dates or budget, and re-pack what that reaches (pl-47).
 *
 * §6's amendment leads with "we cannot afford the second hotel" and "add a day
 * in Trieste". The first is a lower budget and a re-plan; the second is longer
 * dates and a re-plan of the days that opens. Both change the brief a version
 * was built from, which is why every revision now carries its own.
 *
 * ## The day count, decided by the owner on 2026-09-13
 *
 * - **Day numbers are kept.** Day 3 stays day 3, re-dated when the start moves.
 * - **A longer trip appends days at the end**, and those days are planned.
 * - **A shorter trip drops days from the end**, with everything on them.
 * - **A shorter trip that would drop a pin is refused**, so the user unpins
 *   first: `droppedPins` and `droppedPinsRefusal`, which `api` calls before
 *   starting a run and `briefEditSlice` calls again, because a pin can be set
 *   while the run is queued.
 * - **An item now out of season stays, silently**, as it does after a move.
 *
 * ## What is re-packed
 *
 * **Every day when the budget changes**, because a budget cut is plan-wide and
 * the critic's `over-budget` drops the dearest unpinned item wherever it is.
 * **Every day when the day count changes under a `per-day` budget**, because
 * `budgetCeiling` multiplies by the day count, so the ceiling moved although
 * the slot did not. Otherwise **the added days**, which may be none: a
 * same-length shift re-dates every day and moves no item.
 *
 * Kept days keep their stored `travelFromPrevious`. Re-dating a day changes no
 * distance, so only the slice is measured.
 *
 * ## One packing path
 *
 * `reviseBrief` goes through `repack`, `replan`'s body, and never a fork of it.
 * `api` calls `briefEditSlice` to decide what to measure and `reviseBrief`
 * calls it to pack, so the measured table and the packed days agree by
 * construction, as `replanPool` makes them agree for a re-plan.
 */

import {
  AppError,
  isAnswered,
  type Candidate,
  type PlanDay,
  type PlanGap,
  type PlanRevision,
  type RevisionOperation,
  type Source,
  type TripBrief,
  type UncheckedConstraint,
} from "@planner/contract";
import { draftableDates, pinnedPlacements, type ComposeResult } from "./compose.ts";
import { tripSpan } from "./dates.ts";
import { deadlinesFor } from "./deadlines.ts";
import type { PinnedPlacement } from "./pack.ts";
import { candidateOf } from "./preconditions.ts";
import { repack } from "./replan.ts";
import type { TravelTable } from "./travel.ts";

/** Both ends of each change, as the operation stores them; the days are derived. */
export type BriefChange = Pick<Extract<RevisionOperation, { kind: "brief" }>, "dates" | "budget">;

/** The finding kind a dropped pin refuses with. Not a `CriticFindingKind`: no critic produced it. */
export const PIN_ON_DROPPED_DAY = "pin-on-dropped-day";

/**
 * The pinned items on days at or above `dayCount` — what a trip shortened to
 * that many days would drop. In day and position order.
 */
export function droppedPins(previous: PlanRevision, dayCount: number): PinnedPlacement[] {
  return pinnedPlacements(previous).filter((placement) => placement.dayIndex >= dayCount);
}

/**
 * `PLAN_INFEASIBLE` for a shorter trip that would drop `dropped`, in the shape
 * `compose` refuses with, `details.findings` of `{ kind, dayIndex, detail }`,
 * so a reader that renders one renders the other.
 *
 * The copy is `PLAN_INFEASIBLE`'s own. "Something has to give" is true of it:
 * the pin or the shorter trip. Each finding names its item, because "unpin it
 * first" is advice only when it says which.
 */
export function droppedPinsRefusal(
  dropped: readonly PinnedPlacement[],
  candidates: readonly Candidate[],
): AppError {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return new AppError("PLAN_INFEASIBLE", undefined, {
    details: {
      findings: dropped.map((placement) => ({
        kind: PIN_ON_DROPPED_DAY,
        dayIndex: placement.dayIndex,
        detail: `“${candidateOf(byId, placement.candidateId).title}” is pinned to day ${String(placement.dayIndex + 1)}, which the new dates drop. Unpin it to shorten the trip.`,
      })),
    },
  });
}

export interface BriefEditSlice {
  /**
   * `previous` resized to the new span: kept days re-dated with their items,
   * pins and stored travel untouched; dropped days gone; added days empty. Its
   * day ids are placeholders — `reviseBrief` re-keys every day — and it is
   * never stored.
   */
  resized: PlanRevision;
  /** The days to re-pack, ascending. Possibly empty. */
  slice: number[];
}

/**
 * Resize `previous` to the edited dates and work out which days to re-pack.
 *
 * `brief` is the **edited** brief: its budget decides whether a change in day
 * count moved the ceiling. `candidates` names a dropped pin in the refusal.
 *
 * Throws `PLAN_INFEASIBLE` when a dropped day holds a pinned item. `api` has
 * already refused that request, so reaching this throw means a pin was set
 * while the run was queued.
 */
export function briefEditSlice(input: {
  previous: PlanRevision;
  brief: TripBrief;
  change: BriefChange;
  candidates: readonly Candidate[];
}): BriefEditSlice {
  const { previous, brief, change } = input;
  const before = previous.days.length;

  // The plan's own span unless the dates change: pl-43's rule that a plan does
  // not reshape itself behind a re-plan holds for a budget edit too.
  const span =
    change.dates === null
      ? { dayCount: before, dates: previous.days.map((day) => day.date) }
      : tripSpan(change.dates.to);
  const after = span.dayCount;

  const dropped = droppedPins(previous, after);
  if (dropped.length > 0) throw droppedPinsRefusal(dropped, input.candidates);

  const days = Array.from({ length: after }, (_, dayIndex): PlanDay => {
    const date = span.dates[dayIndex] ?? null;
    const kept = previous.days[dayIndex];
    return kept === undefined
      ? { id: `${previous.id}-added-${String(dayIndex)}`, dayIndex, date, items: [] }
      : { ...kept, date };
  });

  const perDay =
    isAnswered(brief.budget) &&
    brief.budget.value.kind === "amount" &&
    brief.budget.value.basis === "per-day";
  const everyDay = change.budget !== null || (after !== before && perDay);

  const slice = everyDay
    ? days.map((day) => day.dayIndex)
    : days.filter((day) => day.dayIndex >= before).map((day) => day.dayIndex);

  return { resized: { ...previous, days }, slice };
}

export interface ReviseBriefInput {
  /** The edited brief: the base revision's, with the changed slots answered. */
  brief: TripBrief;
  /** The plan's whole pool, in stored order — `ReplanInput.candidates`' rule. */
  candidates: readonly Candidate[];
  /** The latest revision, which the edit builds on. */
  previous: PlanRevision;
  change: BriefChange;
  /** Must answer ordered pairs among `replanPool` over `briefEditSlice`'s resized revision and slice. */
  travel: TravelTable;
  revision: { id: string; reason: string; createdAt: string };
  /** Today. What the new dates leave too little time to book is counted back to here. */
  now: Date;
  /** Default to `previous`'s: a brief edit names no specialist and discovers nothing. */
  gaps?: readonly PlanGap[];
  coverage?: readonly UncheckedConstraint[];
  reading?: readonly Source[];
  maxCriticRounds?: number;
}

/**
 * A new revision with the edited brief: resized, the slice re-packed, and what
 * the new dates leave too little time to book named in `deadlines`.
 *
 * The critic reads the edited brief, so the ceiling is the new budget over the
 * new day count, and every candidate on a day outside the slice is fixed.
 *
 * Throws `PLAN_INFEASIBLE` for a pin on a dropped day (see `briefEditSlice`),
 * or when a hard finding survives the critic — a shorter `per-day` trip whose
 * pins alone cost more than the new ceiling, say. `BRIEF_INCOMPLETE` for a
 * brief `compose` would refuse.
 */
export function reviseBrief(input: ReviseBriefInput): ComposeResult {
  const { brief, previous, change } = input;
  const dates = draftableDates(brief);
  const { resized, slice } = briefEditSlice({
    previous,
    brief,
    change,
    candidates: input.candidates,
  });

  return repack({
    brief,
    candidates: input.candidates,
    previous: resized,
    slice,
    operation: {
      kind: "brief",
      dates: structuredClone(change.dates),
      budget: structuredClone(change.budget),
      days: [...slice],
    },
    travel: input.travel,
    gaps: input.gaps ?? previous.gaps,
    coverage: input.coverage ?? previous.coverage,
    reading: input.reading ?? previous.reading,
    revision: input.revision,
    now: input.now,
    // Frozen days are where this finds something: the packer already keeps
    // such a candidate off a re-packed day unless it is pinned.
    deadlines: (days) =>
      deadlinesFor({ dates, candidates: input.candidates, days, now: input.now }),
    ...(input.maxCriticRounds === undefined ? {} : { maxCriticRounds: input.maxCriticRounds }),
  });
}
