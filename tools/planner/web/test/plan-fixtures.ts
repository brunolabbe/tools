/**
 * The shapes the server hands the plan view, built here rather than asserted.
 *
 * A separate file from `fixtures.ts` on purpose: that one serves the wizard and
 * is built around `QuestionNode`, and a plan has nothing to do with the tree.
 *
 * Same rule as its sibling, though — **these are still the server's shapes.**
 * Everything is typed against `@planner/contract`, so a change to `PlanView`,
 * `Candidate` or `Provenance` breaks this suite at `npm run check` rather than
 * letting it go on rendering a document the server can no longer produce.
 */

import {
  emptyBrief,
  emptyShapeDetails,
  location,
  MODEL_ASSERTED,
  slot,
  type Candidate,
  type DiffEntry,
  type DiffPlacement,
  type PlanDay,
  type PlanDetail,
  type PlanGap,
  type PlanItem,
  type PlanRevision,
  type PlanView,
  type RevisionDiff,
  type RevisionOperation,
  type Source,
  type TripBrief,
  type TripDates,
  type TripShape,
  type UncheckedConstraint,
} from "@planner/contract";

const CREATED = "2027-01-01T00:00:00.000Z";

export function brief(overrides: { shape?: TripShape; dates?: TripDates } = {}): TripBrief {
  const shape = overrides.shape ?? "road-trip";
  return {
    ...emptyBrief(),
    shape: slot.answered(shape),
    dates: slot.answered(
      overrides.dates ?? { kind: "exact", departure: "2027-07-05", return: "2027-07-06" },
    ),
    details: emptyShapeDetails(shape),
  };
}

let sequence = 0;

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  sequence += 1;
  return {
    id: `cand-${String(sequence)}`,
    specialist: "activities",
    title: "Something to do",
    summary: "A thing a specialist proposed.",
    location: location.at({ name: "Somewhere", locality: null, coordinates: null }),
    durationMinutes: null,
    cost: null,
    season: null,
    bookingLeadTimeDays: null,
    provenance: MODEL_ASSERTED,
    ...overrides,
  };
}

export function item(overrides: Partial<PlanItem> & { candidateId: string }): PlanItem {
  return {
    id: `item-${overrides.candidateId}`,
    position: 0,
    startsAt: null,
    pinned: false,
    note: null,
    travelFromPrevious: null,
    ...overrides,
  };
}

/** A day with a date, or without one — which is every flexible-dates trip. */
export function day(dayIndex: number, items: PlanItem[], date: string | null = null): PlanDay {
  return { id: `day-${String(dayIndex)}`, dayIndex, date, items };
}

export interface RevisionOverrides {
  id?: string;
  /** 1-based. Defaults to 1 — the first draft — for every existing caller. */
  revision?: number;
  parentRevisionId?: string | null;
  reason?: string;
  /** Defaults to `first-draft` for revision 1 and `restore` of 1 otherwise. */
  operation?: RevisionOperation;
}

/**
 * `PlanRevision`'s own field gained `operation` under pl-42, which this
 * builder's default already carried. pl-45 adds the ability to build a
 * *later* revision — a version picker, a restore or a diff needs at least
 * two — without every one of this suite's thirty-odd `revision(...)` calls
 * having to say so: `revision` defaults to 1, exactly the shape they already
 * pass.
 */
export function revision(
  days: PlanDay[],
  gaps: PlanGap[] = [],
  coverage: UncheckedConstraint[] = [],
  /** pl-33's editorial context about the route. Rendered since pl-36. */
  reading: Source[] = [],
  overrides: RevisionOverrides = {},
): PlanRevision {
  const number = overrides.revision ?? 1;
  return {
    id: overrides.id ?? `rev-${String(number)}`,
    planId: "plan-1",
    revision: number,
    parentRevisionId:
      overrides.parentRevisionId ?? (number === 1 ? null : `rev-${String(number - 1)}`),
    reason: overrides.reason ?? (number === 1 ? "The first draft." : "A change was made."),
    operation:
      overrides.operation ??
      (number === 1 ? { kind: "first-draft" } : { kind: "restore", revision: 1 }),
    createdAt: CREATED,
    days,
    gaps,
    coverage,
    reading,
  };
}

/** One placement in a diff: a candidate's day and its spot on it. */
export function diffPlacement(dayIndex: number, position = 0): DiffPlacement {
  return { dayIndex, position };
}

export function addedEntry(candidateId: string, to: DiffPlacement): DiffEntry {
  return { kind: "added", candidateId, to };
}

export function removedEntry(candidateId: string, from: DiffPlacement): DiffEntry {
  return { kind: "removed", candidateId, from };
}

export function movedEntry(candidateId: string, from: DiffPlacement, to: DiffPlacement): DiffEntry {
  return { kind: "moved", candidateId, from, to };
}

/**
 * What a revision changed against its parent (pl-42). Never stored — see
 * `RevisionDiff`'s own comment — so a fixture builds one directly rather than
 * deriving it from two revisions the way `@planner/itinerary`'s `diffRevisions`
 * does; this package only ever renders one.
 */
export function revisionDiff(
  revisionId: string,
  parentRevisionId: string,
  entries: DiffEntry[] = [],
): RevisionDiff {
  return { revisionId, parentRevisionId, entries };
}

export interface ViewOverrides {
  brief?: TripBrief;
  candidates?: Candidate[];
  revisions?: PlanRevision[];
  unchecked?: UncheckedConstraint[];
  diffs?: RevisionDiff[];
  title?: string;
}

/**
 * A `PlanView` as the read route returns one.
 *
 * `unchecked` defaults to the travel-time entry every Phase 2 plan carries,
 * because a fixture without it would be a plan the server cannot produce.
 */
export function planView(overrides: ViewOverrides = {}): PlanView {
  const revisions = overrides.revisions ?? [];
  const plan: PlanDetail = {
    id: "plan-1",
    title: overrides.title ?? "A trip",
    createdAt: CREATED,
    updatedAt: CREATED,
    latestRevision: revisions.at(-1)?.revision ?? 0,
    brief: overrides.brief ?? brief(),
    candidates: overrides.candidates ?? [],
    revisions,
  };

  return {
    plan,
    unchecked: overrides.unchecked ?? [
      {
        kind: "travel-time",
        detail:
          "How long it takes to get from one of these to the next was not checked. Nothing here measured a distance.",
        candidateIds: [],
      },
    ],
    diffs: overrides.diffs ?? [],
  };
}
