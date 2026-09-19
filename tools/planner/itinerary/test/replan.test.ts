/**
 * `replan` and `replanPool` — re-pack only the named days (pl-43 step 3), with
 * a test for each of the brief's Traps.
 */

import { describe, expect, test } from "vitest";
import {
  planRevisionSchema,
  slot,
  type AppError,
  type Candidate,
  type CostEstimate,
  type PlanGap,
  type PlanRevision,
} from "@planner/contract";
import { compose, type ComposeResult } from "../src/compose.ts";
import { diffRevisions } from "../src/diff.ts";
import { applyEdit } from "../src/edit.ts";
import { replan, replanPool, type ReplanInput } from "../src/replan.ts";
import { restoreRevision } from "../src/restore.ts";
import { NOTHING_MEASURED } from "../src/travel.ts";
import { uncheckedForRevision } from "../src/unchecked.ts";
import { firstDraftCases } from "./first-draft-cases.ts";
import {
  briefFor,
  candidate,
  measuredBetween,
  measuredEverywhere,
  NOW,
  placedIds,
  REVISION,
  travelled,
} from "./helpers.ts";
import { appended, revisionOf, spyTable, withoutIds } from "./revisions.ts";

const NEXT = { id: "rev-2", reason: "Re-planned.", createdAt: "2027-01-02T00:00:00.000Z" };
/** Four days, 2027-07-05 to 07-08, moderate effort, half-day drives. */
const BRIEF = briefFor({});

function activity(durationMinutes: number | null = 60, extra: Partial<Candidate> = {}): Candidate {
  return candidate({ specialist: "activities", durationMinutes, ...extra });
}

function cad(low: number): CostEstimate {
  return {
    currency: "CAD",
    low,
    high: low,
    basis: "per-party",
    provenance: { kind: "model-asserted" },
  };
}

function replanDays(
  previous: PlanRevision,
  candidates: readonly Candidate[],
  days: number[],
  overrides: Partial<Omit<ReplanInput, "previous" | "candidates">> = {},
): ComposeResult {
  return replan({
    brief: BRIEF,
    candidates,
    previous,
    operation: { kind: "replan", days, specialists: [], note: null },
    travel: NOTHING_MEASURED,
    revision: NEXT,
    now: NOW,
    ...overrides,
  });
}

function asFirstRevision(result: ComposeResult): PlanRevision {
  return { ...result.revision, planId: "plan-1", revision: 1, parentRevisionId: null };
}

function refusal(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  return expect.unreachable("expected a refusal");
}

describe("naming every day of a pin-free plan is compose over the same pool", () => {
  // The thirteen inputs of the first-draft baseline, the transition case among
  // them — the one that fills a day, so the slice machinery is exercised on a
  // day where the order of charging matters.
  for (const [name, input] of Object.entries(firstDraftCases())) {
    test(name, () => {
      const first = compose(input);
      const previous = asFirstRevision(first);
      const again = replan({
        brief: input.brief,
        candidates: input.candidates,
        previous,
        operation: {
          kind: "replan",
          days: previous.days.map((day) => day.dayIndex),
          specialists: [],
          note: null,
        },
        travel: input.travel,
        revision: NEXT,
        now: input.now,
      });

      expect(withoutIds(again.revision.days)).toEqual(withoutIds(first.revision.days));
      expect(again.excluded).toEqual(first.excluded);
      expect(again.findings).toEqual(first.findings);
      expect(again.unchecked).toEqual(first.unchecked);
    });
  }
});

describe("frozen days", () => {
  test("come back as previous holds them, ids aside, stored travelFromPrevious included", () => {
    const [a, b, c, d] = [activity(), activity(), activity(), activity()];
    const stored = travelled({ durationMinutes: 25 });
    const previous = revisionOf({
      id: "rev-1",
      days: [
        [
          { candidate: a.id, note: "Kept as the user left it.", startsAt: "09:00" },
          { candidate: b.id, travel: stored },
        ],
        [c.id],
        [{ candidate: d.id, pinned: true }],
        [],
      ],
    });
    const candidates = [a, b, c, d];

    // The table would answer 5 minutes for anything. Nothing on a frozen day is
    // asked, so the stored 25 stands.
    const result = replanDays(previous, candidates, [1], {
      travel: measuredEverywhere(travelled({ durationMinutes: 5 })),
    });

    const after = withoutIds(result.revision.days);
    const before = withoutIds(previous.days);
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
    expect(result.revision.days[0]?.items[1]?.travelFromPrevious).toEqual(stored);
    expect(result.revision.days.map((day) => day.id)).toEqual([
      "rev-2-day-0",
      "rev-2-day-1",
      "rev-2-day-2",
      "rev-2-day-3",
    ]);

    const revision = appended(previous, result.revision);
    expect(() => planRevisionSchema.parse(revision)).not.toThrow();
    expect(result.unchecked).toEqual(uncheckedForRevision({ candidates, revision }));
  });

  test("a per-day finding on a frozen day is discarded, even a hard one", () => {
    // `limits.ts` is content and gets edited: a frozen day that met yesterday's
    // numbers can fail today's, and this revision was never allowed to fix it.
    const first = activity(200);
    const second = activity(200);
    const other = activity();
    const previous = revisionOf({
      id: "rev-1",
      days: [[first.id, second.id], [other.id], [], []],
    });

    const result = replanDays(previous, [first, second, other], [1]);

    expect(result.findings.filter((finding) => finding.dayIndex !== 1)).toEqual([]);
    expect(withoutIds(result.revision.days)[0]).toEqual(withoutIds(previous.days)[0]);
  });
});

describe("the pool", () => {
  test("a candidate on a frozen day that would fit an empty named day is not placed again, nor excluded", () => {
    const placed = activity();
    const previous = revisionOf({ id: "rev-1", days: [[placed.id], [], [], []] });

    const result = replanDays(previous, [placed], [2]);

    expect(placedIds(result.revision.days)).toEqual([placed.id]);
    expect(result.revision.days[2]?.items).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(replanPool({ candidates: [placed], previous, days: [2] })).toEqual([]);
  });

  test("keeps pins and released items on named days, in stored order, and the table is asked about nothing else", () => {
    const lodge = candidate({ specialist: "lodging" });
    const frozenHike = activity(30);
    const [released, alsoReleased, newcomer] = [activity(30), activity(30), activity(30)];
    const pin = activity(30);
    const previous = revisionOf({
      id: "rev-1",
      days: [
        [frozenHike.id, lodge.id],
        [released.id, alsoReleased.id],
        [{ candidate: pin.id, pinned: true }],
        [],
      ],
    });
    const candidates = [lodge, frozenHike, released, alsoReleased, pin, newcomer];

    const pool = replanPool({ candidates, previous, days: [1, 2] }).map((each) => each.id);
    expect(pool).toEqual([released.id, alsoReleased.id, pin.id, newcomer.id]);

    const spy = spyTable(measuredEverywhere(travelled({ durationMinutes: 5 })));
    replanDays(previous, candidates, [1, 2], { travel: spy.table });

    expect(spy.calls.length).toBeGreaterThan(0);
    expect(spy.calls.filter(([from, to]) => !pool.includes(from) || !pool.includes(to))).toEqual(
      [],
    );
  });
});

describe("the critic on a re-plan", () => {
  test("never drops a frozen or a pinned item, even when each is dearer than what it drops", () => {
    const lodge = candidate({ specialist: "lodging", cost: cad(600) });
    const pin = activity(60, { cost: cad(300) });
    const extra = activity(60, { cost: cad(250) });
    const brief = briefFor({
      budget: slot.answered({ kind: "amount", currency: "CAD", amount: 1_000, basis: "total" }),
    });
    const previous = revisionOf({
      id: "rev-1",
      days: [[lodge.id], [{ candidate: pin.id, pinned: true }], [], []],
    });

    // 600 + 300 + 250 is 1,150 against 1,000. The dearest line overall is the
    // frozen lodging and the next is the pin; the one this re-plan may drop is
    // the 250, and that brings the plan to 900.
    const result = replanDays(previous, [lodge, pin, extra], [1], { brief });

    expect(withoutIds(result.revision.days)[0]).toEqual(withoutIds(previous.days)[0]);
    expect(placedIds(result.revision.days)).toEqual([lodge.id, pin.id]);
    expect(result.excluded).toContainEqual({ candidateId: extra.id, reason: "dropped-by-critic" });
  });

  test("adjacent pins whose new transition over-fills the day are PLAN_INFEASIBLE", () => {
    // Releasing the item between two pins makes them adjacent, and their hop
    // comes from this run's table: 150 + 60 + 150 is 360 of a moderate 300, and
    // nothing on the day is droppable. The user unpins something.
    const brief = briefFor({
      dates: { kind: "exact", departure: "2027-07-05", return: "2027-07-05" },
    });
    const first = activity(150);
    const between = activity(30);
    const last = activity(150);
    const previous = revisionOf({
      id: "rev-1",
      days: [
        [{ candidate: first.id, pinned: true }, between.id, { candidate: last.id, pinned: true }],
      ],
    });
    const candidates = [first, between, last];
    const hop = measuredBetween([[first.id, last.id, travelled({ durationMinutes: 60 })]]);

    const error = refusal(() => replanDays(previous, candidates, [0], { brief, travel: hop }));
    expect(error.code).toBe("PLAN_INFEASIBLE");
    expect(error.details).toEqual({
      findings: [expect.objectContaining({ kind: "day-over-effort", dayIndex: 0 })],
    });

    // Unmeasured, the two pins are 300 of 300 and ship: the hop is the cause.
    const shipped = replanDays(previous, candidates, [0], { brief });
    expect(placedIds(shipped.revision.days)).toEqual([first.id, last.id]);
  });
});

describe("pins on a named day", () => {
  test("keep their day and lead it", () => {
    const released = activity();
    const pin = activity();
    const previous = revisionOf({
      id: "rev-1",
      days: [[], [released.id, { candidate: pin.id, pinned: true }], [], []],
    });

    const result = replanDays(previous, [released, pin], [1]);

    expect(result.revision.days[1]?.items.map((item) => [item.candidateId, item.pinned])).toEqual([
      [pin.id, true],
      [released.id, false],
    ]);
  });

  test("count against the day, so a pool candidate is excluded rather than sent to a frozen day with room", () => {
    const pin = activity(240);
    const newcomer = activity(120);
    const previous = revisionOf({
      id: "rev-1",
      days: [[], [{ candidate: pin.id, pinned: true }], [], []],
    });

    const result = replanDays(previous, [pin, newcomer], [1]);

    expect(placedIds(result.revision.days)).toEqual([pin.id]);
    expect(result.excluded).toEqual([{ candidateId: newcomer.id, reason: "no-day-had-room" }]);
  });
});

describe("when nothing fits", () => {
  test("an empty named day ships with empty-day, and an empty frozen day says nothing", () => {
    const placed = activity();
    const previous = revisionOf({ id: "rev-1", days: [[placed.id], [], [], []] });

    const result = replanDays(previous, [placed], [1]);

    expect(result.findings).toEqual([expect.objectContaining({ kind: "empty-day", dayIndex: 1 })]);
  });

  test("a booking deadline that passed since the draft keeps a released item off, and names the gap", () => {
    // Correct, and the one way re-planning a day can lose something with nothing
    // new competing for the room. Nobody should "fix" it.
    const lodge = candidate({ specialist: "lodging" });
    const tour = activity(60, { bookingLeadTimeDays: 30 });
    const previous = revisionOf({ id: "rev-1", days: [[lodge.id], [tour.id], [], []] });

    const result = replanDays(previous, [lodge, tour], [1], {
      now: new Date("2027-06-30T12:00:00.000Z"),
    });

    expect(result.excluded).toEqual([{ candidateId: tour.id, reason: "booking-deadline-passed" }]);
    expect(result.revision.gaps).toEqual([
      {
        specialist: "activities",
        reason: "no-candidates-found",
        detail: expect.stringContaining("booked further ahead"),
      },
    ]);
  });
});

describe("gaps", () => {
  test("at most one per specialist, incoming before derived, and none the days contradict", () => {
    const lodge = candidate({ specialist: "lodging" });
    const outing = activity();
    const unbookable = candidate({
      specialist: "food",
      durationMinutes: 60,
      bookingLeadTimeDays: 700,
    });
    const previous = revisionOf({ id: "rev-1", days: [[lodge.id], [outing.id], [], []] });
    const candidates = [lodge, outing, unbookable];

    // Derived alone, food gets a gap of its own, so the rule below has
    // something to deduplicate.
    expect(
      replanDays(previous, candidates, [1]).revision.gaps.map((gap) => gap.specialist),
    ).toEqual(["food"]);

    const incoming: PlanGap[] = [
      { specialist: "lodging", reason: "specialist-failed", detail: "The lodging search failed." },
      { specialist: "food", reason: "specialist-failed", detail: "The food search failed." },
      {
        specialist: "food",
        reason: "no-candidates-found",
        detail: "The food search found nothing.",
      },
    ];
    const result = replanDays(previous, candidates, [1], { gaps: incoming });

    expect(result.revision.gaps).toEqual([incoming[1]]);
    expect(() => planRevisionSchema.parse(appended(previous, result.revision))).not.toThrow();
  });
});

describe("what a re-plan does not read", () => {
  test("note and specialists change nothing the composer produces", () => {
    const lodge = candidate({ specialist: "lodging" });
    const [a, b, c] = [activity(), activity(), activity()];
    const previous = revisionOf({ id: "rev-1", days: [[lodge.id], [a.id, b.id], [c.id], []] });
    const candidates = [lodge, a, b, c];

    const plain = replanDays(previous, candidates, [1, 2]);
    const noted = replanDays(previous, candidates, [1, 2], {
      operation: {
        kind: "replan",
        days: [1, 2],
        specialists: ["food", "lodging"],
        note: "Somewhere quieter, please.",
      },
    });

    expect(noted.revision.days).toEqual(plain.revision.days);
    expect(noted.excluded).toEqual(plain.excluded);
    expect(noted.findings).toEqual(plain.findings);
    expect(noted.unchecked).toEqual(plain.unchecked);
    expect(noted.revision.gaps).toEqual(plain.revision.gaps);
    expect(noted.revision.operation).toEqual({
      kind: "replan",
      days: [1, 2],
      specialists: ["food", "lodging"],
      note: "Somewhere quieter, please.",
    });
  });

  test("a re-plan with nothing new can change nothing, and its diff is empty", () => {
    const [a, b] = [activity(), activity()];
    const first = compose({
      brief: BRIEF,
      candidates: [a, b],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });
    const previous = asFirstRevision(first);

    const result = replanDays(previous, [a, b], [0]);

    expect(result.revision.days[0]?.items.map((item) => item.candidateId)).toEqual([a.id]);
    expect(diffRevisions(previous, appended(previous, result.revision)).entries).toEqual([]);
  });
});

test("replan, applyEdit and restoreRevision never hand back an object previous still holds", () => {
  // `Object.freeze` is shallow (pl-24): a caller that adjusts a returned
  // measurement must not be adjusting the stored revision.
  const [a, b, c] = [activity(30), activity(30), activity(30)];
  const previous = revisionOf({
    id: "rev-1",
    days: [[a.id, { candidate: b.id, travel: travelled({ durationMinutes: 20 }) }], [c.id], [], []],
    coverage: [
      { kind: "coverage", detail: "There is very little on the map here.", candidateIds: [] },
    ],
  });
  const snapshot = structuredClone(previous);
  const candidates = [a, b, c];

  const outputs = [
    replanDays(previous, candidates, [1]).revision,
    applyEdit({
      brief: BRIEF,
      candidates,
      previous,
      operation: { kind: "remove", candidateId: c.id, fromDayIndex: 1 },
      travel: NOTHING_MEASURED,
      revision: NEXT,
    }).revision,
    restoreRevision(previous, NEXT),
  ];

  for (const output of outputs) {
    const travel = output.days[0]?.items[1]?.travelFromPrevious;
    expect(travel).toMatchObject({ kind: "measured", durationMinutes: 20 });
    Object.assign(travel ?? {}, { durationMinutes: 999 });
    expect(output.days[0]?.items[1]?.travelFromPrevious).toMatchObject({ durationMinutes: 999 });
    output.coverage.push({
      kind: "coverage",
      detail: "Added by a careless caller.",
      candidateIds: [],
    });
    output.days[0]?.items.pop();
  }

  expect(previous).toEqual(snapshot);
});

describe("preconditions api should have checked", () => {
  test("each is INTERNAL naming the precondition, from replan and replanPool alike", () => {
    const x = activity();
    const y = activity();
    const previous = revisionOf({ id: "rev-1", days: [[x.id], [y.id], [], []] });
    const twice = revisionOf({ id: "rev-1", days: [[x.id], [x.id], [], []] });

    const cases = [
      {
        precondition: "day-not-in-revision",
        replanning: () => replanDays(previous, [x, y], [7]),
        pooling: () => replanPool({ candidates: [x, y], previous, days: [7] }),
      },
      {
        precondition: "candidate-missing",
        replanning: () => replanDays(previous, [x], [1]),
        pooling: () => replanPool({ candidates: [x], previous, days: [1] }),
      },
      {
        precondition: "candidate-placed-twice",
        replanning: () => replanDays(twice, [x], [1]),
        pooling: () => replanPool({ candidates: [x], previous: twice, days: [1] }),
      },
    ];

    for (const each of cases) {
      for (const run of [each.replanning, each.pooling]) {
        const error = refusal(run);
        expect({ code: error.code, precondition: error.details?.["precondition"] }).toEqual({
          code: "INTERNAL",
          precondition: each.precondition,
        });
      }
    }
  });
});
