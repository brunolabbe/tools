/**
 * `applyEdit` and `editTransitions` — a new revision without packing (pl-43
 * step 4).
 */

import { describe, expect, test } from "vitest";
import {
  MAX_ITEMS_PER_DAY,
  planRevisionSchema,
  type AppError,
  type Candidate,
  type PlanRevision,
} from "@planner/contract";
import { applyEdit, editTransitions, type EditInput, type EditOperation } from "../src/edit.ts";
import { ACTIVITY_MINUTES_PER_DAY } from "../src/limits.ts";
import { NOTHING_MEASURED, type TravelTable } from "../src/travel.ts";
import { briefFor, candidate, measuredBetween, measuredEverywhere, travelled } from "./helpers.ts";
import { appended, idsIn, revisionOf, spyTable } from "./revisions.ts";

const EDIT = { id: "rev-2", reason: "An edit.", createdAt: "2027-01-02T00:00:00.000Z" };
/** Four days, 2027-07-05 to 07-08, moderate effort, half-day drives. */
const BRIEF = briefFor({});

function activity(durationMinutes: number | null = 30): Candidate {
  return candidate({ specialist: "activities", durationMinutes });
}

function edit(
  previous: PlanRevision,
  candidates: readonly Candidate[],
  operation: EditOperation,
  travel: TravelTable = NOTHING_MEASURED,
): ReturnType<typeof applyEdit> {
  const input: EditInput = {
    brief: BRIEF,
    candidates,
    previous,
    operation,
    travel,
    revision: EDIT,
  };
  return applyEdit(input);
}

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  return expect.unreachable("expected the edit to be refused");
}

function candidateIds(revision: {
  days: readonly { items: readonly { candidateId: string }[] }[];
}) {
  return revision.days.map((day) => day.items.map((item) => item.candidateId));
}

describe("the operation, applied", () => {
  test("a move across days lands at the position after the item left, on dense positions", () => {
    const [a, b, c] = [activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id, b.id], [c.id], [], []] });
    const operation: EditOperation = {
      kind: "move",
      candidateId: a.id,
      fromDayIndex: 0,
      toDayIndex: 1,
      toPosition: 1,
    };

    const result = edit(previous, [a, b, c], operation);

    expect(candidateIds(result.revision)).toEqual([[b.id], [c.id, a.id], [], []]);
    expect(result.revision.days.map((day) => day.items.map((item) => item.position))).toEqual([
      [0],
      [0, 1],
      [],
      [],
    ]);
    expect(result.revision.operation).toEqual(operation);
    expect(idsIn(result.revision.days).every((id) => id.startsWith("rev-2-"))).toBe(true);
    expect(() => planRevisionSchema.parse(appended(previous, result.revision))).not.toThrow();
  });

  test("a move within a day counts its position after the item left", () => {
    const [a, b, c] = [activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id, b.id, c.id], [], [], []] });

    const result = edit(previous, [a, b, c], {
      kind: "move",
      candidateId: a.id,
      fromDayIndex: 0,
      toDayIndex: 0,
      toPosition: 2,
    });

    expect(candidateIds(result.revision)[0]).toEqual([b.id, c.id, a.id]);
  });

  test("a remove takes the item off its day", () => {
    const [a, b, c] = [activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id, b.id, c.id], [], [], []] });

    const result = edit(previous, [a, b, c], {
      kind: "remove",
      candidateId: b.id,
      fromDayIndex: 0,
    });

    expect(candidateIds(result.revision)[0]).toEqual([a.id, c.id]);
  });

  test("a moved pin stays pinned", () => {
    const [a, b] = [activity(), activity()];
    const previous = revisionOf({
      id: "rev-1",
      days: [[{ candidate: a.id, pinned: true }, b.id], [], [], []],
    });

    const result = edit(previous, [a, b], {
      kind: "move",
      candidateId: a.id,
      fromDayIndex: 0,
      toDayIndex: 2,
      toPosition: 0,
    });

    expect(result.revision.days[2]?.items[0]).toMatchObject({ candidateId: a.id, pinned: true });
  });

  test("an edit that empties the plan ships, with the empty day named", () => {
    // Decided by the owner, 2026-09-13: the user did it, restore undoes it, and
    // "cannot be planned as described" would be false about a deletion.
    const a = activity();
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [], [], []] });

    const result = edit(previous, [a], { kind: "remove", candidateId: a.id, fromDayIndex: 0 });

    expect(candidateIds(result.revision)).toEqual([[], [], [], []]);
    expect(result.findings).toEqual([expect.objectContaining({ kind: "empty-day", dayIndex: 0 })]);
  });

  test("a move onto a day outside the item's season is allowed and says nothing", () => {
    // Decided by the owner, 2026-09-13, as a pinned out-of-season item already
    // ships (pl-23). The only finding is the day it left, now empty.
    const winterOnly = candidate({
      specialist: "activities",
      durationMinutes: 60,
      season: { from: "12-01", to: "03-15" },
    });
    const previous = revisionOf({ id: "rev-1", days: [[winterOnly.id], [], [], []] });

    const result = edit(previous, [winterOnly], {
      kind: "move",
      candidateId: winterOnly.id,
      fromDayIndex: 0,
      toDayIndex: 2,
      toPosition: 0,
    });

    expect(candidateIds(result.revision)[2]).toEqual([winterOnly.id]);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["empty-day"]);
  });
});

describe("what an edit refuses", () => {
  test("a move onto a day that already holds MAX_ITEMS_PER_DAY is PLAN_INFEASIBLE", () => {
    const a = activity();
    const full = Array.from({ length: MAX_ITEMS_PER_DAY }, () => activity(null));
    const previous = revisionOf({
      id: "rev-1",
      days: [[a.id], full.map((each) => each.id), [], []],
    });

    // `toPosition` may be the end of a full day (pl-42 bounds it there), so the
    // refusal is the composer's and not a malformed request.
    const error = refusal(() =>
      edit(previous, [a, ...full], {
        kind: "move",
        candidateId: a.id,
        fromDayIndex: 0,
        toDayIndex: 1,
        toPosition: MAX_ITEMS_PER_DAY,
      }),
    );

    expect(error.code).toBe("PLAN_INFEASIBLE");
    expect(error.details).toEqual({
      findings: [expect.objectContaining({ kind: "day-over-items", dayIndex: 1 })],
    });
  });

  test("a move onto a day with too little effort left is PLAN_INFEASIBLE", () => {
    const moving = activity(60);
    const long = activity(ACTIVITY_MINUTES_PER_DAY.moderate - 50);
    const previous = revisionOf({ id: "rev-1", days: [[moving.id], [long.id], [], []] });

    const error = refusal(() =>
      edit(previous, [moving, long], {
        kind: "move",
        candidateId: moving.id,
        fromDayIndex: 0,
        toDayIndex: 1,
        toPosition: 1,
      }),
    );

    expect(error.code).toBe("PLAN_INFEASIBLE");
    expect(error.details).toEqual({
      findings: [expect.objectContaining({ kind: "day-over-effort", dayIndex: 1 })],
    });
  });

  test("a remove whose new transition over-fills its own day is PLAN_INFEASIBLE", () => {
    // 120 + 10 + 30 + 10 + 120 is 290 of 300. Take the middle out, and the ferry
    // from the first to the last is 90 minutes: 120 + 90 + 120 is 330.
    const first = activity(120);
    const middle = activity(30);
    const last = activity(120);
    const previous = revisionOf({
      id: "rev-1",
      days: [
        [
          first.id,
          { candidate: middle.id, travel: travelled({ durationMinutes: 10 }) },
          { candidate: last.id, travel: travelled({ durationMinutes: 10 }) },
        ],
        [],
        [],
        [],
      ],
    });
    const ferry = measuredBetween([[first.id, last.id, travelled({ durationMinutes: 90 })]]);
    const operation: EditOperation = { kind: "remove", candidateId: middle.id, fromDayIndex: 0 };

    const error = refusal(() => edit(previous, [first, middle, last], operation, ferry));
    expect(error.code).toBe("PLAN_INFEASIBLE");
    expect(error.details).toEqual({
      findings: [expect.objectContaining({ kind: "day-over-effort", dayIndex: 0 })],
    });

    // The transition is the cause: unmeasured, the same remove ships.
    expect(() => edit(previous, [first, middle, last], operation)).not.toThrow();
  });

  test("a broken precondition is INTERNAL, never a user-facing code", () => {
    const [a, b] = [activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[a.id], [b.id], [], []] });
    const internal = expect.objectContaining({ code: "INTERNAL" });

    // Not on the day the operation says.
    expect(() =>
      edit(previous, [a, b], { kind: "remove", candidateId: a.id, fromDayIndex: 1 }),
    ).toThrow(internal);
    // A source day the revision does not have, named as such: without the
    // guard, the same input fails as a TypeError from reading an absent day.
    const noSource = refusal(() =>
      edit(previous, [a, b], { kind: "remove", candidateId: a.id, fromDayIndex: 9 }),
    );
    expect({ code: noSource.code, precondition: noSource.details?.["precondition"] }).toEqual({
      code: "INTERNAL",
      precondition: "day-not-in-revision",
    });
    // A destination day the revision does not have.
    expect(() =>
      edit(previous, [a, b], {
        kind: "move",
        candidateId: a.id,
        fromDayIndex: 0,
        toDayIndex: 9,
        toPosition: 0,
      }),
    ).toThrow(internal);
    // Past the end of the destination: day 1 holds one item, so 0..1.
    expect(() =>
      edit(previous, [a, b], {
        kind: "move",
        candidateId: a.id,
        fromDayIndex: 0,
        toDayIndex: 1,
        toPosition: 2,
      }),
    ).toThrow(internal);
    // A candidate the plan holds no record of.
    expect(() =>
      edit(previous, [a], { kind: "remove", candidateId: a.id, fromDayIndex: 0 }),
    ).toThrow(internal);
  });
});

describe("what an edit carries", () => {
  test("unchanged transitions keep their stored value, on touched days and untouched ones", () => {
    const [a, b, c, d, e, f] = Array.from({ length: 6 }, () => activity(30));
    const stored = {
      b: travelled({ durationMinutes: 11 }),
      c: travelled({ durationMinutes: 12 }),
      d: travelled({ durationMinutes: 13 }),
      f: travelled({ durationMinutes: 14 }),
    };
    const previous = revisionOf({
      id: "rev-1",
      days: [
        [
          a?.id ?? "",
          { candidate: b?.id ?? "", travel: stored.b },
          { candidate: c?.id ?? "", travel: stored.c },
          { candidate: d?.id ?? "", travel: stored.d },
        ],
        [e?.id ?? "", { candidate: f?.id ?? "", travel: stored.f }],
        [],
        [],
      ],
    });
    const everything = [a, b, c, d, e, f].filter((each) => each !== undefined);

    const result = edit(
      previous,
      everything,
      { kind: "remove", candidateId: c?.id ?? "", fromDayIndex: 0 },
      measuredEverywhere(travelled({ durationMinutes: 99 })),
    );

    const day0 = result.revision.days[0]?.items ?? [];
    expect(day0.map((item) => item.travelFromPrevious)).toEqual([
      null,
      stored.b,
      travelled({ durationMinutes: 99 }),
    ]);
    expect(result.revision.days[1]?.items[1]?.travelFromPrevious).toEqual(stored.f);
  });

  test("gaps, coverage and reading are carried untouched, and as copies", () => {
    const [a, b] = [activity(), activity()];
    const previous = revisionOf({
      id: "rev-1",
      days: [[a.id, b.id], [], [], []],
      gaps: [
        { specialist: "food", reason: "specialist-failed", detail: "The food search failed." },
      ],
      coverage: [
        { kind: "coverage", detail: "There is very little on the map here.", candidateIds: [] },
      ],
      reading: [
        {
          url: "https://fixtures.invalid/planner/reading",
          title: "Checked-in fixture",
          fetchedAt: "2026-08-22T00:00:00.000Z",
        },
      ],
    });

    const result = edit(previous, [a, b], { kind: "remove", candidateId: a.id, fromDayIndex: 0 });

    expect(result.revision.gaps).toEqual(previous.gaps);
    expect(result.revision.coverage).toEqual(previous.coverage);
    expect(result.revision.reading).toEqual(previous.reading);
    expect(result.revision.gaps).not.toBe(previous.gaps);
    expect(result.unchecked).toContainEqual(previous.coverage[0]);
  });
});

describe("editTransitions", () => {
  const pool = Array.from({ length: 7 }, () => activity(null));
  const id = (index: number): string => pool[index]?.id ?? "";
  const previous = revisionOf({
    id: "rev-1",
    days: [[id(0), id(1), id(2), id(3)], [id(4), id(5), id(6)], [], []],
  });

  /** Every remove and every move this plan admits, positions counted after leaving. */
  function everyOperation(): EditOperation[] {
    const operations: EditOperation[] = [];
    for (const day of previous.days) {
      for (const item of day.items) {
        operations.push({
          kind: "remove",
          candidateId: item.candidateId,
          fromDayIndex: day.dayIndex,
        });
        for (const destination of previous.days) {
          const length = destination.items.length - (destination.dayIndex === day.dayIndex ? 1 : 0);
          for (let toPosition = 0; toPosition <= length; toPosition += 1) {
            operations.push({
              kind: "move",
              candidateId: item.candidateId,
              fromDayIndex: day.dayIndex,
              toDayIndex: destination.dayIndex,
              toPosition,
            });
          }
        }
      }
    }
    return operations;
  }

  test("a remove in the middle returns the one pair it creates", () => {
    expect(
      editTransitions(previous, { kind: "remove", candidateId: id(1), fromDayIndex: 0 }),
    ).toEqual([{ dayIndex: 0, fromCandidateId: id(0), toCandidateId: id(2) }]);
  });

  test("a move within a day returns the closed gap and both new neighbours", () => {
    // [0, 1, 2, 3] with 1 to position 2 is [0, 2, 1, 3].
    expect(
      editTransitions(previous, {
        kind: "move",
        candidateId: id(1),
        fromDayIndex: 0,
        toDayIndex: 0,
        toPosition: 2,
      }),
    ).toEqual([
      { dayIndex: 0, fromCandidateId: id(0), toCandidateId: id(2) },
      { dayIndex: 0, fromCandidateId: id(2), toCandidateId: id(1) },
      { dayIndex: 0, fromCandidateId: id(1), toCandidateId: id(3) },
    ]);
  });

  test("over every edit this plan admits: at most one pair for a remove, three for a move, and applyEdit asks for exactly those", () => {
    const operations = everyOperation();
    // 7 removes; each item on the four-item day has 4 + 4 + 1 + 1 moves and
    // each on the three-item day 5 + 3 + 1 + 1. A silently short list passes
    // every bound below.
    expect(operations).toHaveLength(7 + 4 * 10 + 3 * 10);

    const most = { remove: 0, move: 0 };
    for (const operation of operations) {
      const pairs = editTransitions(previous, operation);
      const spy = spyTable();
      edit(previous, pool, operation, spy.table);

      expect({ operation, calls: spy.calls }).toEqual({
        operation,
        calls: pairs.map((pair) => [pair.fromCandidateId, pair.toCandidateId]),
      });
      most[operation.kind] = Math.max(most[operation.kind], pairs.length);
    }

    // Reached, not only respected: a bound nothing comes near proves nothing.
    expect(most).toEqual({ remove: 1, move: 3 });
  });
});
