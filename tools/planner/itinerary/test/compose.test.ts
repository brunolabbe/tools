/**
 * The composer, against the six checked-in candidate sets and against the cases
 * a realistic fixture cannot be bent into.
 *
 * The fixtures come from `@planner/contract`'s `test/fixtures/`, which pl-4
 * wrote as a deliverable to this package and to pl-5 rather than as its own
 * private test data — one brief and one plausible fan-out per `TripShape`. They
 * are the reason this suite exists before pl-5 does: no orchestrator, no model,
 * no run, and still real input.
 */

import { describe, expect, test } from "vitest";
import {
  planRevisionSchema,
  slot,
  TRIP_SHAPES,
  type AppError,
  type PlanRevision,
} from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { compose, pinnedPlacements, type ComposeResult } from "../src/compose.ts";
import { ACTIVITY_MINUTES_PER_DAY, DRIVE_MINUTES_PER_DAY } from "../src/limits.ts";
import { BUCKET_OF } from "../src/pack.ts";
import { NOTHING_MEASURED } from "../src/travel.ts";
import { briefFor, candidate, NOW, placedIds, REVISION } from "./helpers.ts";

/** Every id a revision claims — the days' and the items'. */
function idsOf(result: ComposeResult): string[] {
  return result.revision.days.flatMap((day) => [day.id, ...day.items.map((item) => item.id)]);
}

/** What `appendRevision` would produce, so the result can go through the schema. */
function asRevision(days: PlanRevision["days"], gaps: PlanRevision["gaps"]): PlanRevision {
  return {
    id: REVISION.id,
    planId: "plan-1",
    revision: 1,
    parentRevisionId: null,
    reason: REVISION.reason,
    createdAt: REVISION.createdAt,
    days,
    gaps,
  };
}

/**
 * Why the end-to-end additivity assertion is arithmetic, asserted rather than
 * assumed.
 *
 * pl-27's Done-when asked for a checked-in candidate set whose days "respect
 * measured transition times". **No checked-in set can show that**, and this is
 * the reason rather than an excuse: the six sets are two to four candidates
 * over four to thirteen days, so the packer — which fills days evenly, not
 * front to back — never puts two *chargeable* items on one day. What shares a
 * day is an activity and its anchor, and an anchor is where the day ends rather
 * than something the day fits around, so its arrival is recorded and never
 * charged (pl-9, and `transitionTo`).
 *
 * A transition therefore cannot change what these sets pack, whatever it
 * measures. The proof that a non-zero transition *does* change a day is in
 * `pack.test.ts`, on the one-constraint-at-a-time candidates `helpers.ts`
 * exists to build — three things fit a day with nothing between them and two
 * fit once getting between them costs 45 minutes.
 *
 * This test is the guard on that explanation. The day a fixture grows enough to
 * fill a day, it goes red and says so, instead of the end-to-end assertion
 * quietly continuing to pass for a reason nobody rechecked.
 */
test("no checked-in set puts two chargeable items on one day", () => {
  for (const shape of TRIP_SHAPES) {
    const fixture = loadFixture(shape);
    const byId = new Map(fixture.candidates.map((each) => [each.id, each]));
    const packed = compose({
      brief: fixture.brief,
      candidates: fixture.candidates,
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    for (const day of packed.revision.days) {
      const chargeable = day.items.filter(
        (item) => BUCKET_OF[byId.get(item.candidateId)?.specialist ?? "activities"] !== "anchor",
      );
      expect({ shape, day: day.dayIndex, chargeable: chargeable.length }).toEqual({
        shape,
        day: day.dayIndex,
        chargeable: Math.min(chargeable.length, 1),
      });
    }
  }
});

describe.each(TRIP_SHAPES)("the %s fixture", (shape) => {
  const fixture = loadFixture(shape);
  const result = compose({
    brief: fixture.brief,
    candidates: fixture.candidates,
    travel: NOTHING_MEASURED,
    revision: REVISION,
    now: NOW,
  });

  test("produces a revision the contract accepts", () => {
    expect(() =>
      planRevisionSchema.parse(asRevision(result.revision.days, result.revision.gaps)),
    ).not.toThrow();
  });

  test("every day satisfies the constraints that built it", () => {
    const byId = new Map(fixture.candidates.map((each) => [each.id, each]));
    const effort = fixture.brief.effort;
    const activityBudget =
      ACTIVITY_MINUTES_PER_DAY[effort.state === "answered" ? effort.value : "moderate"];
    const details = fixture.brief.details;
    const driveBudget =
      details?.shape === "road-trip" && details.driveAppetite.state === "answered"
        ? DRIVE_MINUTES_PER_DAY[details.driveAppetite.value]
        : null;

    for (const day of result.revision.days) {
      let activity = 0;
      let drive = 0;
      let anchors = 0;

      for (const item of day.items) {
        const found = byId.get(item.candidateId);
        expect(found).toBeDefined();
        const bucket = BUCKET_OF[found?.specialist ?? "activities"];
        const minutes = found?.durationMinutes ?? 0;

        if (bucket === "anchor") anchors += 1;
        else if (bucket === "drive" && driveBudget !== null) drive += minutes;
        else activity += minutes;

        // Nothing outside the plan fixes a start time in Phase 2.
        expect(item.startsAt).toBeNull();
      }

      expect(activity).toBeLessThanOrEqual(activityBudget);
      if (driveBudget !== null) expect(drive).toBeLessThanOrEqual(driveBudget);
      expect(anchors).toBeLessThanOrEqual(1);
    }
  });

  test("nothing out of season for these dates reached a day", () => {
    const byId = new Map(fixture.candidates.map((each) => [each.id, each]));
    for (const day of result.revision.days) {
      for (const item of day.items) {
        const season = byId.get(item.candidateId)?.season;
        if (season === null || season === undefined || day.date === null) continue;
        const monthDay = day.date.slice(5);
        const inside =
          season.from <= season.to
            ? monthDay >= season.from && monthDay <= season.to
            : monthDay >= season.from || monthDay <= season.to;
        expect(inside).toBe(true);
      }
    }
  });

  test("says travel time was not checked, on every plan without exception", () => {
    // Phase 2 has no coordinates, so no leg between two items was measured.
    // Decided 2026-08-16: pack without it and name the gap. A plan that looks
    // finished while having skipped §2's first failure is the lie this list
    // exists to prevent.
    expect(result.unchecked.map((entry) => entry.kind)).toContain("travel-time");
  });

  test("places no candidate twice, and no advice on a day at all", () => {
    const placed = placedIds(result.revision.days);
    expect(new Set(placed).size).toBe(placed.length);

    const byId = new Map(fixture.candidates.map((each) => [each.id, each]));
    for (const id of placed) {
      expect(BUCKET_OF[byId.get(id)?.specialist ?? "activities"]).not.toBe("unscheduled");
    }
  });
});

describe("what it refuses to build", () => {
  test("a brief too thin to draft from is BRIEF_INCOMPLETE, and names the slots", () => {
    const thin = { ...briefFor({}), travellers: slot.unknown() };

    expect(() =>
      compose({
        brief: thin,
        candidates: [],
        travel: NOTHING_MEASURED,
        revision: REVISION,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "BRIEF_INCOMPLETE" }));

    try {
      compose({
        brief: thin,
        candidates: [],
        travel: NOTHING_MEASURED,
        revision: REVISION,
        now: NOW,
      });
    } catch (error) {
      expect((error as AppError).details).toEqual({ missing: ["travellers"] });
    }
  });

  test("nothing placeable at all is PLAN_INFEASIBLE, not a plan full of holes", () => {
    // The distinction is the promise: a plan with a gap ships and says what it
    // could not cover; a plan that could not be built at all does not ship.
    const impossible = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle + 1,
    });

    expect(() =>
      compose({
        brief: briefFor({ effort: slot.answered("gentle") }),
        candidates: [impossible],
        travel: NOTHING_MEASURED,
        revision: REVISION,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "PLAN_INFEASIBLE" }));
  });

  test("a budget nothing fits inside is PLAN_INFEASIBLE once there is nothing left to drop", () => {
    const expensive = candidate({
      specialist: "lodging",
      cost: {
        currency: "CAD",
        low: 4_000,
        high: 4_000,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });

    const brief = briefFor({
      budget: slot.answered({ kind: "amount", currency: "CAD", amount: 100, basis: "total" }),
    });

    expect(() =>
      compose({
        brief,
        candidates: [expensive],
        travel: NOTHING_MEASURED,
        revision: REVISION,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "PLAN_INFEASIBLE" }));
  });

  test("a plan that merely has holes ships, with the hole named", () => {
    const bed = candidate({ specialist: "lodging" });
    const unbookable = candidate({ specialist: "activities", bookingLeadTimeDays: 700 });

    const result = compose({
      brief: briefFor({}),
      candidates: [bed, unbookable],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(placedIds(result.revision.days)).toEqual([bed.id]);
    expect(result.revision.gaps).toEqual([
      {
        specialist: "activities",
        reason: "no-candidates-found",
        detail: expect.stringContaining("booked further ahead"),
      },
    ]);
  });

  test("the orchestrator's own gaps are carried through untouched", () => {
    const result = compose({
      brief: briefFor({}),
      candidates: [candidate({ specialist: "lodging" })],
      gaps: [
        {
          specialist: "food",
          reason: "specialist-not-applicable",
          detail: "You are all-inclusive.",
        },
      ],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(result.revision.gaps).toContainEqual({
      specialist: "food",
      reason: "specialist-not-applicable",
      detail: "You are all-inclusive.",
    });
  });
});

describe("the critic", () => {
  test("drops what it can to bring a plan back inside its budget", () => {
    const cheap = candidate({
      specialist: "activities",
      durationMinutes: 60,
      cost: {
        currency: "CAD",
        low: 10,
        high: 10,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });
    const dear = candidate({
      specialist: "activities",
      durationMinutes: 60,
      cost: {
        currency: "CAD",
        low: 500,
        high: 500,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });

    const result = compose({
      brief: briefFor({
        budget: slot.answered({ kind: "amount", currency: "CAD", amount: 100, basis: "total" }),
      }),
      candidates: [cheap, dear],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(placedIds(result.revision.days)).toEqual([cheap.id]);
  });

  test("terminates in bounded rounds on a case it cannot fix, and names it", () => {
    // Two pinned days' worth of activity on one day. Nothing droppable is on
    // it, so every round finds the same thing and none of them fixes it — the
    // loop must stop rather than argue with the packer on the clock.
    const one = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle,
    });
    const two = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle,
    });

    const previous: PlanRevision = asRevision(
      [
        {
          id: "day-0",
          dayIndex: 0,
          date: "2027-07-05",
          items: [
            {
              id: "i1",
              candidateId: one.id,
              position: 0,
              startsAt: null,
              travelFromPrevious: null,
              pinned: true,
              note: null,
            },
            {
              id: "i2",
              candidateId: two.id,
              position: 1,
              startsAt: null,
              travelFromPrevious: null,
              pinned: true,
              note: null,
            },
          ],
        },
      ],
      [],
    );

    expect(() =>
      compose({
        brief: briefFor({ effort: slot.answered("gentle") }),
        candidates: [one, two],
        previous,
        travel: NOTHING_MEASURED,
        revision: { ...REVISION, id: "rev-2" },
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "PLAN_INFEASIBLE" }));
  });

  test("an empty day ships as a finding rather than as a failure", () => {
    const result = compose({
      brief: briefFor({}),
      candidates: [candidate({ specialist: "activities", durationMinutes: 60 })],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(result.findings.filter((finding) => finding.kind === "empty-day")).toHaveLength(3);
    expect(result.findings.every((finding) => finding.kind === "empty-day")).toBe(true);
  });
});

describe("re-planning", () => {
  const pinned = candidate({ specialist: "activities", durationMinutes: 120 });
  const others = Array.from({ length: 3 }, () =>
    candidate({ specialist: "activities", durationMinutes: 120 }),
  );

  const previous: PlanRevision = asRevision(
    [
      { id: "day-0", dayIndex: 0, date: "2027-07-05", items: [] },
      { id: "day-1", dayIndex: 1, date: "2027-07-06", items: [] },
      {
        id: "day-2",
        dayIndex: 2,
        date: "2027-07-07",
        items: [
          {
            id: "i1",
            candidateId: pinned.id,
            position: 0,
            startsAt: null,
            travelFromPrevious: null,
            pinned: true,
            note: null,
          },
        ],
      },
      { id: "day-3", dayIndex: 3, date: "2027-07-08", items: [] },
    ],
    [],
  );

  test("pinnedPlacements reads the day and the position out of a revision", () => {
    expect(pinnedPlacements(previous)).toEqual([
      { candidateId: pinned.id, dayIndex: 2, position: 0 },
    ]);
  });

  test("a re-pack does not move a pinned item", () => {
    const result = compose({
      brief: briefFor({}),
      candidates: [...others, pinned],
      previous,
      travel: NOTHING_MEASURED,
      revision: { ...REVISION, id: "rev-2" },
      now: NOW,
    });

    const day = result.revision.days.find((each) =>
      each.items.some((item) => item.candidateId === pinned.id),
    );

    expect(day?.dayIndex).toBe(2);
    expect(day?.items[0]).toMatchObject({ candidateId: pinned.id, position: 0, pinned: true });
  });

  test("item ids are derived, so composing the same inputs twice is the same plan", () => {
    const twice = [0, 1].map(() =>
      compose({
        brief: briefFor({}),
        candidates: [...others, pinned],
        previous,
        travel: NOTHING_MEASURED,
        revision: { ...REVISION, id: "rev-2" },
        now: NOW,
      }),
    );

    expect(twice[0]?.revision.days).toEqual(twice[1]?.revision.days);
  });

  test("ids are scoped to the revision, so two revisions never collide on one", () => {
    const first = compose({
      brief: briefFor({}),
      candidates: [pinned],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });
    const second = compose({
      brief: briefFor({}),
      candidates: [pinned],
      travel: NOTHING_MEASURED,
      revision: { ...REVISION, id: "rev-2" },
      now: NOW,
    });

    expect(idsOf(first).some((id) => idsOf(second).includes(id))).toBe(false);
  });
});

describe("what it says it did not check", () => {
  test("deal-breakers are free text, and it does not pretend to have read them", () => {
    // §7 puts the deal-breaker check "in code", and in code is exactly where it
    // cannot happen: a keyword match against a sentence fails both ways while
    // looking like a check. Stated as unchecked instead.
    const result = compose({
      brief: briefFor({ dealBreakers: ["No campground without showers"] }),
      candidates: [candidate({ specialist: "lodging" })],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(result.unchecked.map((entry) => entry.kind)).toContain("deal-breakers");
  });

  test("a band budget is not turned into a figure to sum against", () => {
    const result = compose({
      brief: briefFor({ budget: slot.answered({ kind: "band", band: "moderate" }) }),
      candidates: [candidate({ specialist: "lodging" })],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(result.unchecked.map((entry) => entry.kind)).toContain("budget-band");
  });

  test("an unknown season on a placed item is reported, never read as all-year", () => {
    const vague = candidate({ specialist: "lodging", season: null });

    const result = compose({
      brief: briefFor({}),
      candidates: [vague],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    const entry = result.unchecked.find((each) => each.kind === "season-unknown");
    expect(entry?.candidateIds).toEqual([vague.id]);
  });

  test("open dates mean no season and no booking deadline could be checked", () => {
    const result = compose({
      brief: briefFor({ dates: { kind: "open", nights: 3 } }),
      candidates: [candidate({ specialist: "lodging" })],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    const kinds = result.unchecked.map((entry) => entry.kind);
    expect(kinds).toContain("season-no-calendar");
    expect(kinds).toContain("booking-no-departure");
  });

  test("mixed currencies mean the total was not summed, and it says which", () => {
    const inCad = candidate({
      specialist: "lodging",
      cost: {
        currency: "CAD",
        low: 100,
        high: 100,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });
    const inEur = candidate({
      specialist: "activities",
      durationMinutes: 60,
      cost: {
        currency: "EUR",
        low: 80,
        high: 80,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });

    const result = compose({
      brief: briefFor({}),
      candidates: [inCad, inEur],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    const entry = result.unchecked.find((each) => each.kind === "budget-currency");
    expect(entry?.detail).toContain("CAD and EUR");
  });

  test("a pinned out-of-season item is placed, and its currency counts", () => {
    // The one candidate that can be placed and filtered out at once: a pin
    // outranks the season filter (see `compose.ts`), so this is on a day and
    // absent from `season.kept`. Its currency is the only second one on the
    // plan, so a currency check that read the kept set rather than every
    // candidate would drop the note for an item the plan is really carrying.
    const inCad = candidate({
      specialist: "lodging",
      cost: {
        currency: "CAD",
        low: 100,
        high: 100,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });
    // A ski season, wrapping the new year — and the trip is in July.
    const winterOnly = candidate({
      specialist: "activities",
      durationMinutes: 60,
      season: { from: "12-01", to: "03-15" },
      cost: {
        currency: "EUR",
        low: 80,
        high: 80,
        basis: "per-party",
        provenance: { kind: "model-asserted" },
      },
    });

    const previous: PlanRevision = asRevision(
      [
        {
          id: "day-0",
          dayIndex: 0,
          date: "2027-07-05",
          items: [
            {
              id: "i1",
              candidateId: winterOnly.id,
              position: 0,
              startsAt: null,
              travelFromPrevious: null,
              pinned: true,
              note: null,
            },
          ],
        },
      ],
      [],
    );

    const result = compose({
      brief: briefFor({}),
      candidates: [inCad, winterOnly],
      previous,
      travel: NOTHING_MEASURED,
      revision: { ...REVISION, id: "rev-2" },
      now: NOW,
    });

    // Assert the placement too: if the pin stopped outranking the season
    // filter the note would disappear for an unrelated reason, and a test that
    // only read the note would report the wrong cause.
    expect(placedIds(result.revision.days)).toContain(winterOnly.id);

    const entry = result.unchecked.find((each) => each.kind === "budget-currency");
    expect(entry?.detail).toContain("CAD and EUR");
  });

  test("an assumed effort appetite is stated rather than presented as an answer", () => {
    const result = compose({
      brief: { ...briefFor({}), effort: slot.declined() },
      candidates: [candidate({ specialist: "lodging" })],
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    expect(result.unchecked.map((entry) => entry.kind)).toContain("effort-assumed");
  });
});
