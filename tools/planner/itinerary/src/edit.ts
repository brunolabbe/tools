/**
 * An edit: a new revision without packing (pl-43).
 *
 * `move` and `remove` are the user's hand on the document. Nothing is re-packed,
 * no season or booking check runs, and nothing but the transitions the edit
 * creates is measured. The critic is the only check an edit gets, because an
 * edit never goes through `fits` — which is why it charges transitions.
 *
 * ## Which transitions change, as one rule
 *
 * An item's `travelFromPrevious` is re-derived if and only if **its predecessor
 * on its day differs from its predecessor in `previous`**, or it changed day.
 * The first item of a day becomes `null` with no lookup, and every other item
 * keeps its stored value. So a `remove` needs at most one lookup (old
 * predecessor → old successor), and a `move` at most three (the closed gap, new
 * predecessor → item, item → new successor). The anchor is not special: its
 * arrival is recorded (pl-27), so a pair into one is returned like any other.
 *
 * `editTransitions` and `applyEdit` share `applyOperation`, and the pairs one
 * returns are the lookups the other makes. That is what makes "what `api`
 * measures" and "what this function asks" one list rather than two careful
 * implementations.
 *
 * ## Decided by the owner, 2026-09-13
 *
 * - **A pinned item may be moved or removed, and a moved pin stays pinned.** A
 *   pin constrains what a re-plan may touch, not what the user may do by hand.
 * - **A move onto a day outside the item's season window is allowed, and
 *   silent** — a user's own placement outranks a window for the reason a pin
 *   does (pl-9, pl-23).
 * - **An edit that empties the whole plan ships.** Restore undoes it, and
 *   `PLAN_INFEASIBLE`'s copy would be false about a deletion. Plan-wide
 *   findings are never grounds for refusing an edit: a move leaves the total
 *   alone and a remove lowers it.
 */

import {
  AppError,
  isAnswered,
  type Candidate,
  type NewRevision,
  type PlanItem,
  type PlanRevision,
  type RevisionOperation,
  type TripBrief,
} from "@planner/contract";
import { packedDayOf, refuseHardFindings } from "./compose.ts";
import { critique, isHard, type CriticFinding } from "./critic.ts";
import { rekeyDays, type UnkeyedDay } from "./ids.ts";
import {
  assertCandidatesKnown,
  assertPlacedOnce,
  brokenPrecondition,
  candidateOf,
} from "./preconditions.ts";
import type { TravelTable } from "./travel.ts";
import { uncheckedFor, type UncheckedConstraint } from "./unchecked.ts";

export type EditOperation = Extract<RevisionOperation, { kind: "move" } | { kind: "remove" }>;

/** A transition this edit creates, which the caller must measure before `applyEdit`. */
export interface TransitionPair {
  dayIndex: number;
  fromCandidateId: string;
  toCandidateId: string;
}

export interface EditInput {
  brief: TripBrief;
  /** Every candidate the plan holds. Each one `previous` places must be here. */
  candidates: readonly Candidate[];
  previous: PlanRevision;
  operation: EditOperation;
  /** Asked about exactly the pairs `editTransitions` returned, and nothing else. */
  travel: TravelTable;
  revision: { id: string; reason: string; createdAt: string };
}

export interface EditResult {
  revision: NewRevision;
  /** What the edited plan did not check, derived from its days as `compose` derives it. */
  unchecked: UncheckedConstraint[];
  /** The soft findings on the days the edit touched — an `empty-day` left behind, say. */
  findings: CriticFinding[];
}

type Transition = { kind: "stored" } | { kind: "first" } | { kind: "lookup"; pair: TransitionPair };

interface AppliedItem {
  item: PlanItem;
  position: number;
  transition: Transition;
}

interface AppliedDay {
  dayIndex: number;
  date: string | null;
  items: AppliedItem[];
}

interface Applied {
  days: AppliedDay[];
  pairs: TransitionPair[];
  touched: ReadonlySet<number>;
}

/**
 * The operation, applied to the days, and nothing measured yet.
 *
 * `toPosition` is the index in the destination day's list **after** the item
 * has left its source (pl-42 defines it on the contract), so `0..length` of
 * that list inclusive. Positions are then dense on both touched days.
 */
function applyOperation(previous: PlanRevision, operation: EditOperation): Applied {
  assertPlacedOnce(previous);

  const lists = new Map(
    previous.days.map((day) => [
      day.dayIndex,
      day.items.toSorted((left, right) => left.position - right.position),
    ]),
  );

  const before = new Map<string, { dayIndex: number; predecessor: string | null }>();
  for (const [dayIndex, items] of lists) {
    items.forEach((item, index) => {
      before.set(item.candidateId, {
        dayIndex,
        predecessor: items[index - 1]?.candidateId ?? null,
      });
    });
  }

  const source = lists.get(operation.fromDayIndex);
  if (source === undefined) {
    throw brokenPrecondition("day-not-in-revision", {
      revisionId: previous.id,
      dayIndex: operation.fromDayIndex,
    });
  }
  const at = source.findIndex((item) => item.candidateId === operation.candidateId);
  const moving = source[at];
  if (moving === undefined) {
    throw brokenPrecondition("candidate-not-on-day", {
      revisionId: previous.id,
      candidateId: operation.candidateId,
      dayIndex: operation.fromDayIndex,
    });
  }

  lists.set(operation.fromDayIndex, source.toSpliced(at, 1));
  const touched = new Set([operation.fromDayIndex]);

  if (operation.kind === "move") {
    const destination = lists.get(operation.toDayIndex);
    if (destination === undefined) {
      throw brokenPrecondition("day-not-in-revision", {
        revisionId: previous.id,
        dayIndex: operation.toDayIndex,
      });
    }
    if (
      !Number.isInteger(operation.toPosition) ||
      operation.toPosition < 0 ||
      operation.toPosition > destination.length
    ) {
      throw brokenPrecondition("position-out-of-range", {
        revisionId: previous.id,
        dayIndex: operation.toDayIndex,
        toPosition: operation.toPosition,
        length: destination.length,
      });
    }
    lists.set(operation.toDayIndex, destination.toSpliced(operation.toPosition, 0, moving));
    touched.add(operation.toDayIndex);
  }

  const pairs: TransitionPair[] = [];
  const days = previous.days.map((day): AppliedDay => {
    const items = lists.get(day.dayIndex) ?? [];
    return {
      dayIndex: day.dayIndex,
      date: day.date,
      items: items.map((item, index): AppliedItem => {
        if (!touched.has(day.dayIndex)) {
          return { item, position: item.position, transition: { kind: "stored" } };
        }

        const predecessor = items[index - 1]?.candidateId ?? null;
        const was = before.get(item.candidateId);
        if (was?.dayIndex === day.dayIndex && was.predecessor === predecessor) {
          return { item, position: index, transition: { kind: "stored" } };
        }
        if (predecessor === null) {
          return { item, position: index, transition: { kind: "first" } };
        }

        const pair = {
          dayIndex: day.dayIndex,
          fromCandidateId: predecessor,
          toCandidateId: item.candidateId,
        };
        pairs.push(pair);
        return { item, position: index, transition: { kind: "lookup", pair } };
      }),
    };
  });

  return { days, pairs, touched };
}

/**
 * The transitions an edit creates, in day and position order — exactly the
 * pairs `applyEdit` will ask `travel` about, so `api` measures those and no
 * others. At most one for a `remove`, at most three for a `move`.
 *
 * Throws `INTERNAL` for a candidate not on `fromDayIndex`, a day the revision
 * does not have, or a `toPosition` out of range.
 */
export function editTransitions(
  previous: PlanRevision,
  operation: EditOperation,
): TransitionPair[] {
  return applyOperation(previous, operation).pairs;
}

/**
 * Apply one edit to `previous` as a new revision.
 *
 * Throws `PLAN_INFEASIBLE` when a day the edit touched — the source and the
 * destination both — carries a hard per-day finding afterwards, with the
 * findings in `details` as `compose` puts them. A remove can over-fill its own
 * day: a ferry or a one-way road can make A → C longer than A → B → C.
 *
 * `gaps`, `coverage` and `reading` are carried from `previous` untouched, and
 * `gapsFor` does not run: a specialist whose last item the user removed has not
 * "found nothing that fitted".
 */
export function applyEdit(input: EditInput): EditResult {
  const { brief, previous, operation } = input;

  // The guard `uncheckedForRevision` makes, before anything is measured.
  if (!isAnswered(brief.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }
  const dates = brief.dates.value;

  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  assertCandidatesKnown(previous, byId);

  const applied = applyOperation(previous, operation);

  const unkeyed = applied.days.map((day): UnkeyedDay => ({
    dayIndex: day.dayIndex,
    date: day.date,
    items: day.items.map(({ item, position, transition }) => ({
      candidateId: item.candidateId,
      position,
      startsAt: item.startsAt,
      pinned: item.pinned,
      note: item.note,
      travelFromPrevious: travelFor(item, transition, input.travel, byId),
    })),
  }));
  const days = rekeyDays(unkeyed, input.revision.id);

  // Every placed id is fixed: an edit drops nothing, so a finding may name no
  // candidate as the thing to drop.
  const fixed = new Set(days.flatMap((day) => day.items.map((item) => item.candidateId)));
  const findings = critique({
    brief,
    candidates: input.candidates,
    packed: { days: days.map((day) => packedDayOf(day, byId)) },
    fixed,
  }).filter((finding) => finding.dayIndex !== null && applied.touched.has(finding.dayIndex));

  refuseHardFindings(findings);

  const coverage = [...structuredClone(previous.coverage)];

  return {
    revision: {
      id: input.revision.id,
      reason: input.revision.reason,
      operation: { ...operation },
      createdAt: input.revision.createdAt,
      days,
      gaps: [...structuredClone(previous.gaps)],
      coverage,
      reading: [...structuredClone(previous.reading)],
    },
    unchecked: [...uncheckedFor({ brief, dates, candidates: input.candidates, days }), ...coverage],
    findings: findings.filter((finding) => !isHard(finding)),
  };
}

function travelFor(
  item: PlanItem,
  transition: Transition,
  travel: TravelTable,
  byId: ReadonlyMap<string, Candidate>,
): PlanItem["travelFromPrevious"] {
  if (transition.kind === "stored") return item.travelFromPrevious;
  if (transition.kind === "first") return null;
  return travel.between(
    candidateOf(byId, transition.pair.fromCandidateId),
    candidateOf(byId, transition.pair.toCandidateId),
  );
}
