/**
 * `reviseBrief`, `briefEditSlice` and the deadlines every writer carries
 * (pl-47): resizing a revision to new dates, re-packing under a new budget, and
 * naming what the new dates leave too little time to book.
 */

import { describe, expect, test } from "vitest";
import {
  planRevisionSchema,
  slot,
  type AppError,
  type Candidate,
  type CostEstimate,
  type PlanRevision,
  type TripBudget,
  type TripDates,
  type UncheckedConstraint,
} from "@planner/contract";
import { briefEditSlice, reviseBrief, type BriefChange } from "../src/brief-edit.ts";
import { diffRevisions } from "../src/diff.ts";
import { applyEdit } from "../src/edit.ts";
import { replan } from "../src/replan.ts";
import { restoreRevision } from "../src/restore.ts";
import { NOTHING_MEASURED } from "../src/travel.ts";
import { uncheckedForRevision } from "../src/unchecked.ts";
import { briefFor, candidate, NOW, placedIds } from "./helpers.ts";
import { appended, revisionOf, withoutIds } from "./revisions.ts";

const NEXT = { id: "rev-2", reason: "Changed the brief.", createdAt: "2027-01-02T00:00:00.000Z" };

/** `briefFor`'s default: four days, 2027-07-05 to 07-08. */
const FOUR: TripDates = { kind: "exact", departure: "2027-07-05", return: "2027-07-08" };
const SIX: TripDates = { kind: "exact", departure: "2027-07-05", return: "2027-07-10" };
const TWO: TripDates = { kind: "exact", departure: "2027-07-05", return: "2027-07-06" };
const FOUR_IN_AUGUST: TripDates = { kind: "exact", departure: "2027-08-05", return: "2027-08-08" };

function cad(low: number): CostEstimate {
  return {
    currency: "CAD",
    low,
    high: low,
    basis: "per-party",
    provenance: { kind: "model-asserted" },
  };
}

function activity(extra: Partial<Candidate> = {}): Candidate {
  return candidate({ specialist: "activities", durationMinutes: 60, ...extra });
}

function perDay(amount: number): TripBudget {
  return { kind: "amount", currency: "CAD", amount, basis: "per-day" };
}

function datesChange(to: TripDates, from: TripDates = FOUR): BriefChange {
  return { dates: { from, to }, budget: null };
}

/** The edited brief for a change, over `briefFor`'s with `budget` as the base's. */
function editedBrief(
  change: BriefChange,
  budget: PlanRevision["brief"]["budget"] = slot.unknown(),
) {
  return briefFor({
    ...(change.dates === null ? {} : { dates: change.dates.to }),
    budget: change.budget === null ? budget : slot.answered(change.budget.to),
  });
}

function revise(
  previous: PlanRevision,
  candidates: readonly Candidate[],
  change: BriefChange,
  budget: PlanRevision["brief"]["budget"] = slot.unknown(),
) {
  return reviseBrief({
    brief: editedBrief(change, budget),
    candidates,
    previous,
    change,
    travel: NOTHING_MEASURED,
    revision: NEXT,
    now: NOW,
  });
}

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  return expect.unreachable("expected a refusal");
}

function onDay(revision: { days: readonly { items: readonly { candidateId: string }[] }[] }) {
  return revision.days.map((day) => day.items.map((item) => item.candidateId));
}

describe("resizing", () => {
  test("a longer exact trip keeps days 0..n-1 as they were, ids aside, and packs only the added days", () => {
    const [a, b, c, d, e, f] = [
      activity(),
      activity(),
      activity(),
      activity(),
      activity(),
      activity(),
    ];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });
    const change = datesChange(SIX);

    const result = revise(previous, [a, b, c, d, e, f], change);
    const next = appended(previous, result.revision);

    expect(planRevisionSchema.safeParse(next).success).toBe(true);
    expect(next.days).toHaveLength(6);
    expect(withoutIds(next.days.slice(0, 4))).toEqual(withoutIds(previous.days));
    expect(result.revision.operation).toEqual({ kind: "brief", ...change, days: [4, 5] });
    // The two unplaced candidates are offered to the added days and nowhere else.
    const added = next.days.slice(4).flatMap((day) => day.items.map((item) => item.candidateId));
    expect(added.toSorted()).toEqual([e.id, f.id].toSorted());
    expect(next.days.map((day) => day.date)).toEqual([
      "2027-07-05",
      "2027-07-06",
      "2027-07-07",
      "2027-07-08",
      "2027-07-09",
      "2027-07-10",
    ]);
  });

  test("a shorter trip drops the trailing days and their unpinned items, which the diff reports removed", () => {
    const [a, b, c, d] = [activity(), activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });

    const result = revise(previous, [a, b, c, d], datesChange(TWO));
    const next = appended(previous, result.revision);

    expect(onDay(next)).toEqual([[a.id], [b.id]]);
    expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual(
      [],
    );
    expect(diffRevisions(previous, next).entries).toEqual([
      { kind: "removed", candidateId: c.id, from: { dayIndex: 2, position: 0 } },
      { kind: "removed", candidateId: d.id, from: { dayIndex: 3, position: 0 } },
    ]);
  });

  test("a pinned item on a dropped day throws PLAN_INFEASIBLE with the pin-on-dropped-day finding", () => {
    const [a, b, c] = [activity(), activity(), activity()];
    const d = activity({ title: "The ferry to the island" });
    const previous = revisionOf({
      id: "rev-1",
      days: [[a.id], [b.id], [c.id], [{ candidate: d.id, pinned: true }]],
    });

    const error = refusal(() => revise(previous, [a, b, c, d], datesChange(TWO)));

    expect(error.code).toBe("PLAN_INFEASIBLE");
    expect(error.details).toEqual({
      findings: [
        {
          kind: "pin-on-dropped-day",
          dayIndex: 3,
          detail:
            "“The ferry to the island” is pinned to day 4, which the new dates drop. Unpin it to shorten the trip.",
        },
      ],
    });
  });

  test("a same-length shift re-dates every day and moves no item", () => {
    const [a, b, c, d, spare] = [activity(), activity(), activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });

    const result = revise(previous, [a, b, c, d, spare], datesChange(FOUR_IN_AUGUST));
    const next = appended(previous, result.revision);

    expect(onDay(next)).toEqual(onDay(previous));
    expect(next.days.map((day) => day.date)).toEqual([
      "2027-08-05",
      "2027-08-06",
      "2027-08-07",
      "2027-08-08",
    ]);
    expect(diffRevisions(previous, next).entries).toEqual([]);
    expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual(
      [],
    );
  });

  test("an exact to open change nulls every date", () => {
    const [a, b, c, d] = [activity(), activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });

    const result = revise(previous, [a, b, c, d], datesChange({ kind: "open", nights: 3 }));

    expect(result.revision.days.map((day) => day.date)).toEqual([null, null, null, null]);
    expect(onDay(result.revision)).toEqual(onDay(previous));
  });

  test("the revision carries the edited brief, and the slice is what briefEditSlice says", () => {
    const [a, b, c, d] = [activity(), activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });
    const change = datesChange(SIX);
    const brief = editedBrief(change);

    const result = revise(previous, [a, b, c, d], change);
    const { slice, resized } = briefEditSlice({
      previous,
      brief,
      change,
      candidates: [a, b, c, d],
    });

    expect(result.revision.brief).toEqual(brief);
    expect(slice).toEqual([4, 5]);
    expect(resized.days).toHaveLength(6);
    expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual(
      slice,
    );
  });
});

describe("the budget", () => {
  const TOTAL: TripBudget = { kind: "amount", currency: "CAD", amount: 1000, basis: "total" };

  test("a lower budget re-packs every day, drops the dearest unpinned item wherever it is, and never a pin", () => {
    const cheap = activity({ cost: cad(100) });
    const pinned = activity({ cost: cad(500) });
    const dearest = activity({ cost: cad(900) });
    const other = activity({ cost: cad(50) });
    // The dearest sits on day 0, the first draft's, which no earlier slice touched.
    const previous = revisionOf({
      id: "rev-1",
      days: [[dearest.id], [{ candidate: pinned.id, pinned: true }], [cheap.id], [other.id]],
    });
    const change: BriefChange = { dates: null, budget: { from: slot.unknown(), to: TOTAL } };

    const result = revise(previous, [cheap, pinned, dearest, other], change);

    expect(result.revision.operation).toEqual({ kind: "brief", ...change, days: [0, 1, 2, 3] });
    const placed = placedIds(result.revision.days);
    expect(placed).not.toContain(dearest.id);
    expect(placed.toSorted()).toEqual([cheap.id, pinned.id, other.id].toSorted());
    // The pin stays where the user put it, pinned.
    expect(result.revision.days[1]?.items).toMatchObject([
      { candidateId: pinned.id, pinned: true },
    ]);
    expect(result.excluded).toContainEqual({
      candidateId: dearest.id,
      reason: "dropped-by-critic",
    });
  });

  describe("under a per-day budget", () => {
    const budget = slot.answered(perDay(400));

    function cheapPlan() {
      const things = Array.from({ length: 4 }, () => activity({ cost: cad(10) }));
      const previous = revisionOf({
        id: "rev-1",
        days: things.map((thing) => [thing.id]),
        brief: briefFor({ budget }),
      });
      return { things, previous };
    }

    test("a longer trip re-packs every day, because the ceiling moved", () => {
      const { things, previous } = cheapPlan();
      const result = revise(previous, things, datesChange(SIX), budget);
      expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual([
        0, 1, 2, 3, 4, 5,
      ]);
    });

    test("a shorter trip re-packs every day it keeps", () => {
      const { things, previous } = cheapPlan();
      const result = revise(previous, things, datesChange(TWO), budget);
      expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual([
        0, 1,
      ]);
    });

    test("a same-length shift moves no item, because the ceiling did not", () => {
      const { things, previous } = cheapPlan();
      const result = revise(previous, things, datesChange(FOUR_IN_AUGUST), budget);
      expect(result.revision.operation.kind === "brief" && result.revision.operation.days).toEqual(
        [],
      );
      expect(onDay(result.revision)).toEqual(onDay(previous));
    });

    test("a shorter trip whose pins alone cost more than the new ceiling refuses itself", () => {
      // Four days at 100 a day is 400, and the two pins cost 300. Two days is 200.
      const budgetOf100 = slot.answered(perDay(100));
      const [first, second] = [activity({ cost: cad(150) }), activity({ cost: cad(150) })];
      const previous = revisionOf({
        id: "rev-1",
        days: [
          [{ candidate: first.id, pinned: true }],
          [{ candidate: second.id, pinned: true }],
          [],
          [],
        ],
        brief: briefFor({ budget: budgetOf100 }),
      });

      const error = refusal(() => revise(previous, [first, second], datesChange(TWO), budgetOf100));

      expect(error.code).toBe("PLAN_INFEASIBLE");
      expect(error.details).toMatchObject({ findings: [{ kind: "over-budget", dayIndex: null }] });
    });
  });
});

/** The one entry a dates edit stores, naming `ids`. */
function late(ids: string[]): UncheckedConstraint[] {
  return [
    {
      kind: "booking-deadline-passed",
      detail:
        "These need booking further ahead than there was time for when the dates were last changed. They were kept on the plan, and may no longer be bookable.",
      candidateIds: ids,
    },
  ];
}

function replanning(days: number[]) {
  return { kind: "replan" as const, days, specialists: [], note: null };
}

describe("deadlines", () => {
  /** 31 days after `NOW`, and four days long. */
  const SOON: TripDates = { kind: "exact", departure: "2027-02-01", return: "2027-02-04" };

  function planWithAHut() {
    const hut = activity({ bookingLeadTimeDays: 90, title: "A hut" });
    const walk = activity({ bookingLeadTimeDays: 7 });
    const [b, c] = [activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[hut.id], [walk.id], [b.id], [c.id]] });
    return { hut, walk, candidates: [hut, walk, b, c], previous };
  }

  test("an earlier departure stores one entry naming a frozen item whose lead time no longer fits", () => {
    const { hut, candidates, previous } = planWithAHut();
    const result = revise(previous, candidates, datesChange(SOON));

    // The hut needs 90 days and there are 31; the walk needs 7 and fits.
    expect(result.revision.deadlines).toEqual(late([hut.id]));
    expect(onDay(result.revision)[0]).toEqual([hut.id]);
    expect(result.unchecked.at(-1)).toEqual(late([hut.id])[0]);
  });

  test("open dates store none", () => {
    const { candidates, previous } = planWithAHut();
    const result = revise(previous, candidates, datesChange({ kind: "open", nights: 3 }));
    expect(result.revision.deadlines).toEqual([]);
  });

  test("a later move keeps the entry while the item is placed, and a remove of it drops it", () => {
    const { hut, candidates, previous } = planWithAHut();
    const edited = appended(previous, revise(previous, candidates, datesChange(SOON)).revision);
    const brief = edited.brief;

    const moved = applyEdit({
      brief,
      candidates,
      previous: edited,
      operation: {
        kind: "move",
        candidateId: hut.id,
        fromDayIndex: 0,
        toDayIndex: 2,
        toPosition: 1,
      },
      travel: NOTHING_MEASURED,
      revision: { ...NEXT, id: "rev-3" },
    });
    expect(moved.revision.deadlines).toEqual(late([hut.id]));
    expect(moved.revision.brief).toEqual(brief);

    const third = appended(edited, moved.revision);
    const removed = applyEdit({
      brief,
      candidates,
      previous: third,
      operation: { kind: "remove", candidateId: hut.id, fromDayIndex: 2 },
      travel: NOTHING_MEASURED,
      revision: { ...NEXT, id: "rev-4" },
    });
    expect(removed.revision.deadlines).toEqual([]);
  });

  test("a re-plan carries the entry for items it froze, and drops it when the slice re-packed them away", () => {
    const { hut, candidates, previous } = planWithAHut();
    const edited = appended(previous, revise(previous, candidates, datesChange(SOON)).revision);
    const common = { brief: edited.brief, candidates, previous: edited, travel: NOTHING_MEASURED };

    const frozen = replan({ ...common, operation: replanning([3]), revision: NEXT, now: NOW });
    expect(frozen.revision.deadlines).toEqual(late([hut.id]));
    expect(frozen.revision.brief).toEqual(edited.brief);

    // Re-packed, the hut is refused by the packer for the same lead time.
    const repacked = replan({ ...common, operation: replanning([0]), revision: NEXT, now: NOW });
    expect(placedIds(repacked.revision.days)).not.toContain(hut.id);
    expect(repacked.revision.deadlines).toEqual([]);
  });

  test("a restore copies its target's, as stored, and its brief", () => {
    const { hut, candidates, previous } = planWithAHut();
    const edited = appended(previous, revise(previous, candidates, datesChange(SOON)).revision);

    const restored = restoreRevision(edited, { ...NEXT, id: "rev-3" });
    expect(restored.deadlines).toEqual(late([hut.id]));
    expect(restored.brief).toEqual(edited.brief);

    // And restoring the version before the edit brings its dates back.
    expect(restoreRevision(previous, { ...NEXT, id: "rev-4" }).brief).toEqual(previous.brief);
  });

  test("uncheckedForRevision returns it after coverage", () => {
    const { hut, candidates, previous } = planWithAHut();
    const thin: UncheckedConstraint = {
      kind: "coverage",
      detail: "There is very little on the map along this route.",
      candidateIds: [],
    };
    const edited = appended(previous, {
      ...revise(previous, candidates, datesChange(SOON)).revision,
      coverage: [thin],
    });

    const derived = uncheckedForRevision({ candidates, revision: edited });
    expect(derived.slice(-2)).toEqual([thin, ...late([hut.id])]);
  });

  test("uncheckedForRevision reads the revision's own brief, not one passed beside it", () => {
    const { candidates, previous } = planWithAHut();
    // `open` dates have no departure, which the derived list names; exact ones do not.
    const open = appended(
      previous,
      revise(previous, candidates, datesChange({ kind: "open", nights: 3 })).revision,
    );
    const kinds = (revision: PlanRevision) =>
      uncheckedForRevision({ candidates, revision }).map((each) => each.kind);

    expect(kinds(previous)).not.toContain("booking-no-departure");
    expect(kinds(open)).toContain("booking-no-departure");
    expect(kinds(open)).toContain("season-no-calendar");
  });
});

describe("an edit whose values equal the current ones", () => {
  test("is legal, and its dates give an empty diff", () => {
    const [a, b, c, d, spare] = [activity(), activity(), activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [c.id], [d.id]] });

    const result = revise(previous, [a, b, c, d, spare], datesChange(FOUR));
    const next = appended(previous, result.revision);

    expect(result.revision.operation).toEqual({
      kind: "brief",
      dates: { from: FOUR, to: FOUR },
      budget: null,
      days: [],
    });
    expect(diffRevisions(previous, next).entries).toEqual([]);
  });
});
