/**
 * Revisions built by hand, for the suites that start from one: a re-plan, an
 * edit, a restore and a diff all take a stored revision as input, and writing
 * one out field by field buries the one thing a test is about.
 */

import {
  NOT_ESTABLISHED,
  type ItemTravel,
  type NewRevision,
  type PlanDay,
  type PlanGap,
  type PlanRevision,
  type RevisionOperation,
  type Source,
  type TripBrief,
  type UncheckedConstraint,
} from "@planner/contract";
import { NOTHING_MEASURED, type TravelTable } from "../src/travel.ts";
import { briefFor } from "./helpers.ts";

/** One item on a hand-built day. A bare string is a candidate id with every default. */
export interface ItemSpec {
  candidate: string;
  pinned?: boolean;
  /** Defaults to `null` for a day's first item and `not-established` after it. */
  travel?: ItemTravel | null;
  note?: string | null;
  startsAt?: string | null;
}

/** `2027-07-05` plus `dayIndex` days — `briefFor`'s default departure. */
export function dateOf(dayIndex: number): string {
  return new Date(Date.UTC(2027, 6, 5 + dayIndex)).toISOString().slice(0, 10);
}

export function revisionOf(spec: {
  id: string;
  parentRevisionId?: string | null;
  revision?: number;
  operation?: RevisionOperation;
  days: readonly (readonly (string | ItemSpec)[])[];
  gaps?: PlanGap[];
  coverage?: UncheckedConstraint[];
  reading?: Source[];
  /** Defaults to `briefFor({})`, whose four days `dateOf` dates. */
  brief?: TripBrief;
  deadlines?: UncheckedConstraint[];
}): PlanRevision {
  const parentRevisionId = spec.parentRevisionId ?? null;
  const revision = spec.revision ?? (parentRevisionId === null ? 1 : 2);
  const operation: RevisionOperation =
    spec.operation ?? (revision === 1 ? { kind: "first-draft" } : { kind: "restore", revision: 1 });

  return {
    id: spec.id,
    planId: "plan-1",
    revision,
    parentRevisionId,
    reason: "A revision built by hand for a test.",
    operation,
    brief: spec.brief ?? briefFor({}),
    createdAt: "2027-01-01T00:00:00.000Z",
    days: spec.days.map((items, dayIndex): PlanDay => ({
      id: `${spec.id}-day-${dayIndex}`,
      dayIndex,
      date: dateOf(dayIndex),
      items: items.map((entry, position) => {
        const item = typeof entry === "string" ? { candidate: entry } : entry;
        const defaultTravel = position === 0 ? null : NOT_ESTABLISHED;
        return {
          id: `${spec.id}-item-${item.candidate}`,
          candidateId: item.candidate,
          position,
          startsAt: item.startsAt ?? null,
          pinned: item.pinned ?? false,
          note: item.note ?? null,
          travelFromPrevious: item.travel === undefined ? defaultTravel : item.travel,
        };
      }),
    })),
    gaps: spec.gaps ?? [],
    coverage: spec.coverage ?? [],
    deadlines: spec.deadlines ?? [],
    reading: spec.reading ?? [],
  };
}

/** What `appendRevision` makes of `next` on top of `previous`, without a whole plan. */
export function appended(previous: PlanRevision, next: NewRevision): PlanRevision {
  return {
    ...next,
    planId: previous.planId,
    revision: previous.revision + 1,
    parentRevisionId: previous.id,
  };
}

/** A revision's days with every id left out, for comparing two revisions of one plan. */
export function withoutIds(days: readonly PlanDay[]): unknown[] {
  return days.map((day) => ({
    dayIndex: day.dayIndex,
    date: day.date,
    items: day.items.map((item) => ({
      candidateId: item.candidateId,
      position: item.position,
      startsAt: item.startsAt,
      pinned: item.pinned,
      note: item.note,
      travelFromPrevious: item.travelFromPrevious,
    })),
  }));
}

/** Every day and item id a set of days claims. */
export function idsIn(days: readonly PlanDay[]): string[] {
  return days.flatMap((day) => [day.id, ...day.items.map((item) => item.id)]);
}

/** A table that records every ordered pair it is asked about, by candidate id. */
export function spyTable(inner: TravelTable = NOTHING_MEASURED): {
  table: TravelTable;
  calls: [string, string][];
} {
  const calls: [string, string][] = [];
  return {
    calls,
    table: {
      between: (from, to) => {
        calls.push([from.id, to.id]);
        return inner.between(from, to);
      },
    },
  };
}
