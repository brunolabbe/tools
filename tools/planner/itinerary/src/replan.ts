/**
 * Re-plan the named days of a revision, and leave every other day alone (pl-43).
 *
 * §6's first mechanism in full: a revision names the days it may touch. Every
 * day outside `operation.days` is **frozen**, every item on it included, pinned
 * or not, and comes back exactly as `previous` holds it with fresh ids. The
 * named days are re-packed from the plan's pool, around their pins.
 *
 * ## Why a function of its own, and not a `slice` on `compose`
 *
 * - **An optional slice makes invalid inputs typeable**: a slice with no
 *   `previous`, or a `previous` with no slice that still has to stamp a
 *   `replan` operation.
 * - **`compose` can only stamp `first-draft`**, and `planRevisionSchema` accepts
 *   that on revision 1 alone, so a re-pack through `compose` was a revision 2
 *   the contract rejects.
 *
 * It shares `compose`'s internals — the guards, the season filter, the packer
 * and the critic rounds — rather than copying them.
 *
 * ## Three ways to ship a wrong plan with no failing test
 *
 * - **A candidate on a frozen day placed a second time.** The packer knows
 *   nothing about frozen ids; `replanPool` is what keeps them out of its input.
 * - **The critic dropping a frozen item.** `over-budget` picks the dearest
 *   unpinned line anywhere, usually a lodging, usually on a frozen day. Every
 *   frozen id goes to the critic as `fixed`.
 * - **Transitions the critic could not see.** Releasing the item between two
 *   pins makes them adjacent, and their new transition comes from this run's
 *   table; the critic charges it the way the packer does.
 */

import {
  type Candidate,
  type PlanDay,
  type PlanGap,
  type PlanRevision,
  type RevisionOperation,
  type Source,
  type Specialist,
  type TripBrief,
} from "@planner/contract";
import {
  draftableDates,
  gapsFor,
  packedDayOf,
  packWithCritic,
  pinnedPlacements,
  planDaysOf,
  refuseHardFindings,
  type ComposeResult,
} from "./compose.ts";
import { isHard } from "./critic.ts";
import { tripSpan, type TripSpan } from "./dates.ts";
import { carriedDeadlines } from "./deadlines.ts";
import { rekeyDays } from "./ids.ts";
import { MAX_CRITIC_ROUNDS } from "./limits.ts";
import type { PackedItem } from "./pack.ts";
import { assertCandidatesKnown, assertDaysExist, assertPlacedOnce } from "./preconditions.ts";
import type { TravelTable } from "./travel.ts";
import { uncheckedFor, type UncheckedConstraint } from "./unchecked.ts";

export interface ReplanInput {
  brief: TripBrief;
  /**
   * The plan's whole pool: every stored candidate, plus this run's new ones, in
   * a stable order.
   *
   * **Order is placement order.** The packer walks candidates in input order
   * within a bucket, and with one named day that order decides what gets on it.
   * Pass `PlanDetail.candidates` in stored order with new ones appended, or two
   * re-plans of one plan disagree for no reason a reader can see.
   */
  candidates: readonly Candidate[];
  /** The latest revision. Its day count and dates are the span; the brief's are not re-derived. */
  previous: PlanRevision;
  /**
   * Stamped onto the revision as given. `days` is the slice; `specialists` and
   * `note` are never read — a note "is never an instruction to the composer"
   * (roadmap, Phase 4), and which specialists re-ran is the fan-out's business.
   */
  operation: Extract<RevisionOperation, { kind: "replan" }>;
  /** Must answer ordered pairs among `replanPool(...)`. Nothing else is ever asked of it. */
  travel: TravelTable;
  /**
   * What the run knows about specialists this time. A gap for a specialist with
   * an item placed in the result is dropped, since the days contradict it; and
   * a specialist gets at most one gap, these before any this function derives.
   * Which of `previous.gaps` to carry forward is the caller's decision.
   */
  gaps?: readonly PlanGap[];
  /** Defaults to `previous.coverage`: evidence persists until something re-asks. */
  coverage?: readonly UncheckedConstraint[];
  /** Defaults to `previous.reading`, for the same reason. */
  reading?: readonly Source[];
  revision: { id: string; reason: string; createdAt: string };
  /** Today. A released item whose booking lead time has passed since the draft does not come back. */
  now: Date;
  maxCriticRounds?: number;
}

/** The days of `previous` that `days` does not name. */
function frozenDaysOf(previous: PlanRevision, days: readonly number[]): PlanDay[] {
  const named = new Set(days);
  return previous.days.filter((day) => !named.has(day.dayIndex));
}

/**
 * Every candidate that may appear on a named day: the pool minus everything on
 * a frozen day.
 *
 * Pinned and unpinned items on named days stay in it — pins go to the packer as
 * fixed placements, and everything else is released beside what was never
 * placed. **`api` calls this too**, to decide which candidates' places to
 * measure, so the measured table and the packed days agree by construction.
 *
 * Throws `INTERNAL` when `previous` places a candidate twice, names a candidate
 * missing from `candidates`, or does not have one of `days`.
 */
export function replanPool(input: {
  candidates: readonly Candidate[];
  previous: PlanRevision;
  days: readonly number[];
}): Candidate[] {
  const { previous } = input;
  assertPlacedOnce(previous);
  assertDaysExist(previous, input.days);
  assertCandidatesKnown(previous, new Map(input.candidates.map((each) => [each.id, each])));

  const frozen = new Set(
    frozenDaysOf(previous, input.days).flatMap((day) => day.items.map((item) => item.candidateId)),
  );
  return input.candidates.filter((candidate) => !frozen.has(candidate.id));
}

/**
 * Re-pack the named days of `previous` and freeze the rest.
 *
 * Throws `BRIEF_INCOMPLETE` for the brief `compose` refuses, `PLAN_INFEASIBLE`
 * when a hard finding survives the critic rounds on a named day or plan-wide,
 * and `INTERNAL` for a precondition `api` should have checked (see
 * `replanPool`).
 */
export function replan(input: ReplanInput): ComposeResult {
  const { operation, ...rest } = input;
  return repack({
    ...rest,
    slice: operation.days,
    operation: {
      kind: "replan",
      days: [...operation.days],
      specialists: [...operation.specialists],
      note: operation.note,
    },
    // What the last dates edit found stays true of the items still placed:
    // nothing here moved the departure (pl-47).
    deadlines: (days) => carriedDeadlines(input.previous.deadlines, days),
  });
}

/**
 * What `repack` is told: a re-plan's input with the slice taken apart from the
 * operation it stamps (pl-47).
 *
 * A re-plan's slice is its operation's `days`; a brief edit's is derived from
 * the change, and its operation is a different member. One packing path for
 * both is the point — two that agree today are how two views of one plan start
 * disagreeing.
 */
export interface RepackInput extends Omit<ReplanInput, "operation"> {
  /** The days to re-pack, ascending. Possibly empty: then every day is frozen. */
  slice: readonly number[];
  /** Stamped onto the revision as given. Never read. */
  operation: Exclude<RevisionOperation, { kind: "first-draft" | "move" | "remove" | "restore" }>;
  /** The revision's `deadlines`, from its final days. */
  deadlines: (days: readonly PlanDay[]) => UncheckedConstraint[];
}

/**
 * Re-pack `slice` of `previous` and freeze the rest — `replan`'s body, shared
 * with `reviseBrief`. Not exported from the package.
 */
export function repack(input: RepackInput): ComposeResult {
  const { brief, previous } = input;
  const dates = draftableDates(brief);
  const days = input.slice;
  const named = new Set(days);

  const pool = replanPool({ candidates: input.candidates, previous, days });
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));

  // Frozen days reach the packer as they are stored, with their stored
  // transitions: nothing on them is re-packed, so nothing on them is measured.
  const frozen = new Map<number, readonly PackedItem[]>(
    frozenDaysOf(previous, days).map((day) => [day.dayIndex, packedDayOf(day, byId).items]),
  );

  // The span is the plan's as it stands, not the brief's re-derived: a plan
  // whose `tripSpan` would now compute differently does not reshape itself
  // behind a re-plan, and a named day keeps the date it was drafted against.
  const span: TripSpan = {
    ...tripSpan(dates),
    dayCount: previous.days.length,
    dates: previous.days.map((day) => day.date),
  };

  const packing = packWithCritic({
    brief,
    dates,
    candidates: input.candidates,
    pool,
    span,
    pinned: pinnedPlacements(previous).filter((placement) => named.has(placement.dayIndex)),
    frozen,
    travel: input.travel,
    now: input.now,
    rounds: input.maxCriticRounds ?? MAX_CRITIC_ROUNDS,
  });

  refuseHardFindings(packing.findings);

  const packedDays = planDaysOf(packing.packed.days);
  const merged = previous.days.map((day) =>
    // `pack` emits one day per span day, in order, so the fallback is never
    // taken; it is there so a missing day reads as empty rather than as frozen.
    named.has(day.dayIndex) ? (packedDays[day.dayIndex] ?? { ...day, items: [] }) : day,
  );
  const planDays = rekeyDays(merged, input.revision.id);

  const coverage = [...structuredClone(input.coverage ?? previous.coverage)];
  const reading = [...structuredClone(input.reading ?? previous.reading)];
  const deadlines = input.deadlines(planDays);

  return {
    revision: {
      id: input.revision.id,
      reason: input.revision.reason,
      operation: structuredClone(input.operation),
      brief: structuredClone(brief),
      createdAt: input.revision.createdAt,
      days: planDays,
      gaps: mergeGaps(input.gaps ?? [], gapsFor(input.candidates, packing.packed), planDays, byId),
      coverage,
      deadlines,
      reading,
    },
    // Over the whole days: the list is a derivation of what the revision holds,
    // and the overnight hops into and out of the slice are part of that.
    unchecked: [
      ...uncheckedFor({ brief, dates, candidates: input.candidates, days: planDays }),
      ...coverage,
      ...deadlines,
    ],
    findings: packing.findings.filter((finding) => !isHard(finding)),
    excluded: packing.excluded,
  };
}

/**
 * At most one gap per specialist, and none the days contradict.
 *
 * The fan-out itself emits `no-candidates-found` for a specialist that returned
 * nothing, so the incoming list cannot simply be stripped of that reason: a
 * re-run that found nothing new does not un-place yesterday's lodging. And
 * `planRevisionSchema` bounds `gaps` at one per specialist, which a
 * carried-forward gap beside a re-derived one would overflow.
 */
function mergeGaps(
  incoming: readonly PlanGap[],
  derived: readonly PlanGap[],
  days: readonly PlanDay[],
  byId: ReadonlyMap<string, Candidate>,
): PlanGap[] {
  const placed = new Set<Specialist>();
  for (const day of days) {
    for (const item of day.items) {
      const specialist = byId.get(item.candidateId)?.specialist;
      if (specialist !== undefined) placed.add(specialist);
    }
  }

  const seen = new Set<Specialist>();
  const gaps: PlanGap[] = [];
  for (const gap of [...incoming, ...derived]) {
    if (placed.has(gap.specialist) || seen.has(gap.specialist)) continue;
    seen.add(gap.specialist);
    gaps.push({ ...gap });
  }
  return gaps;
}
