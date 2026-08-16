import { describe, expect, test } from "vitest";
import { MODEL_ASSERTED, slot } from "@planner/contract";
import { tripSpan } from "../src/dates.ts";
import {
  ACTIVITY_MINUTES_PER_DAY,
  DRIVE_MINUTES_PER_DAY,
  ITEMS_PER_CITY_DAY,
} from "../src/limits.ts";
import { pack } from "../src/pack.ts";
import { briefFor, candidate, detailsFor, placedIds } from "./helpers.ts";

const FOUR_DAYS = tripSpan({ kind: "exact", departure: "2027-07-05", return: "2027-07-08" });

function reasonFor(result: ReturnType<typeof pack>, id: string): string | undefined {
  return result.excluded.find((entry) => entry.candidateId === id)?.reason;
}

describe("buckets", () => {
  test("advice is not put on a day", () => {
    // "Bring crampons" and "the park pass is €30" are true of the trip and not
    // of Tuesday. They stay on the plan as candidates and are read from there.
    const gear = candidate({ specialist: "conditions-and-gear" });
    const money = candidate({ specialist: "budget" });
    const admin = candidate({ specialist: "practicalities" });
    const thing = candidate({ specialist: "activities", durationMinutes: 60 });

    const result = pack({
      brief: briefFor({}),
      candidates: [gear, money, admin, thing],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(placedIds(result.days)).toEqual([thing.id]);
    for (const unscheduled of [gear, money, admin]) {
      expect(reasonFor(result, unscheduled.id)).toBe("not-schedulable");
    }
  });

  test("lodging anchors a day and consumes none of it", () => {
    const bed = candidate({ specialist: "lodging" });
    const other = candidate({ specialist: "lodging" });
    const full = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.moderate,
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [bed, other, full],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    // One bed per day, and the full day of activity still fits beside it.
    expect(result.days[0]?.items.map((item) => item.candidateId).toSorted()).toEqual(
      [bed.id, full.id].toSorted(),
    );
    expect(placedIds(result.days)).toContain(other.id);
    expect(result.days[1]?.items.map((item) => item.candidateId)).toEqual([other.id]);
  });
});

describe("the day's budgets", () => {
  test("days fill evenly rather than front to back", () => {
    // First-fit would pack day one to its ceiling and leave the rest empty,
    // which is a worse plan from the same candidates.
    const each = Array.from({ length: 4 }, () =>
      candidate({ specialist: "activities", durationMinutes: 60 }),
    );

    const result = pack({
      brief: briefFor({}),
      candidates: each,
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(result.days.map((day) => day.items.length)).toEqual([1, 1, 1, 1]);
  });

  test("an activity that fits nowhere is excluded rather than squeezed in", () => {
    const enormous = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle + 1,
    });

    const result = pack({
      brief: briefFor({ effort: slot.answered("gentle") }),
      candidates: [enormous],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(placedIds(result.days)).toEqual([]);
    expect(reasonFor(result, enormous.id)).toBe("no-day-had-room");
  });

  test("the drive budget is separate from the effort budget", () => {
    // A day can be long in one and short in the other, which is why the brief
    // asks two questions and this asserts two budgets.
    const leg = candidate({
      specialist: "route-and-logistics",
      durationMinutes: DRIVE_MINUTES_PER_DAY["half-day"],
    });
    const outing = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.moderate,
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [leg, outing],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(result.days[0]?.items.map((item) => item.candidateId).toSorted()).toEqual(
      [leg.id, outing.id].toSorted(),
    );
  });

  test("a drive on a shape with no drive appetite is charged to the day", () => {
    const transfer = candidate({
      specialist: "route-and-logistics",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.moderate,
    });
    const outing = candidate({ specialist: "activities", durationMinutes: 60 });

    const result = pack({
      brief: briefFor({
        details: detailsFor("city-and-culture", {
          pace: slot.answered("packed"),
          interests: slot.answered(["museums"]),
        }),
      }),
      candidates: [transfer, outing],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    // The transfer used the whole of day one, so the outing went elsewhere.
    expect(result.days[0]?.items.map((item) => item.candidateId)).toEqual([transfer.id]);
    expect(result.days[1]?.items.map((item) => item.candidateId)).toEqual([outing.id]);
  });

  test("a city pace caps the count of things even when the minutes fit", () => {
    const brief = briefFor({
      details: detailsFor("city-and-culture", {
        pace: slot.answered("slow"),
        interests: slot.answered(["food"]),
      }),
    });
    const many = Array.from({ length: 8 }, () =>
      candidate({ specialist: "activities", durationMinutes: 30 }),
    );

    const result = pack({ brief, candidates: many, span: FOUR_DAYS, daysUntilDeparture: 100 });

    for (const day of result.days) {
      expect(day.items.length).toBeLessThanOrEqual(ITEMS_PER_CITY_DAY.slow);
    }
  });
});

describe("what the packer refuses", () => {
  test("a booking whose deadline has passed is never proposed", () => {
    const hut = candidate({ specialist: "lodging", bookingLeadTimeDays: 120 });
    const motel = candidate({ specialist: "lodging", bookingLeadTimeDays: 1 });

    const result = pack({
      brief: briefFor({}),
      candidates: [hut, motel],
      span: FOUR_DAYS,
      daysUntilDeparture: 30,
    });

    expect(placedIds(result.days)).toEqual([motel.id]);
    expect(reasonFor(result, hut.id)).toBe("booking-deadline-passed");
  });

  test("no departure means no deadline can be checked, so nothing is dropped for one", () => {
    const hut = candidate({ specialist: "lodging", bookingLeadTimeDays: 300 });

    const result = pack({
      brief: briefFor({ dates: { kind: "open", nights: 3 } }),
      candidates: [hut],
      span: tripSpan({ kind: "open", nights: 3 }),
      daysUntilDeparture: null,
    });

    expect(placedIds(result.days)).toEqual([hut.id]);
  });

  test("a candidate is kept off the days it is shut", () => {
    // In season for the trip, out of season for the first two days of it.
    const late = candidate({
      specialist: "activities",
      durationMinutes: 60,
      season: { from: "07-07", to: "09-30" },
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [late],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(result.days[0]?.items).toEqual([]);
    expect(result.days[2]?.items.map((item) => item.candidateId)).toEqual([late.id]);
  });

  test("out of season on every day is a different exclusion from a full day", () => {
    const never = candidate({
      specialist: "activities",
      durationMinutes: 60,
      season: { from: "12-01", to: "04-15" },
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [never],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(reasonFor(result, never.id)).toBe("no-day-in-season");
  });
});

describe("unknown durations", () => {
  test("consume no minutes, take a slot, and say so on the item", () => {
    // A plausible ninety minutes is the exact thing `durationMinutes: null`
    // exists to prevent, one layer down.
    const vague = candidate({ specialist: "activities", durationMinutes: null });
    const measured = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.moderate,
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [vague, measured],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
    });

    expect(result.durationUnknown).toEqual([vague.id]);
    const placed = result.days
      .flatMap((day) => day.items)
      .find((item) => item.candidateId === vague.id);
    expect(placed?.note).toMatch(/not established/u);
  });
});

describe("pins", () => {
  const pinnedThing = candidate({ specialist: "activities", durationMinutes: 120 });
  const filler = candidate({ specialist: "activities", durationMinutes: 60 });

  test("a pinned item keeps its day when everything is re-packed around it", () => {
    const result = pack({
      brief: briefFor({}),
      candidates: [pinnedThing, filler],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
      pinned: [{ candidateId: pinnedThing.id, dayIndex: 2, position: 0 }],
    });

    const day = result.days.find((each) =>
      each.items.some((item) => item.candidateId === pinnedThing.id),
    );
    expect(day?.dayIndex).toBe(2);
    expect(day?.items[0]).toMatchObject({ candidateId: pinnedThing.id, pinned: true });
  });

  test("a pin outranks a full day, and the day goes over rather than the pin being dropped", () => {
    // The user's decision is the packer's input, so a pin that makes a day
    // impossible produces an over-full day for the critic to find — never a
    // silently discarded pin.
    const huge = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle,
    });
    const alsoHuge = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.gentle,
    });

    const result = pack({
      brief: briefFor({ effort: slot.answered("gentle") }),
      candidates: [huge, alsoHuge],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
      pinned: [
        { candidateId: huge.id, dayIndex: 0, position: 0 },
        { candidateId: alsoHuge.id, dayIndex: 0, position: 1 },
      ],
    });

    expect(result.days[0]?.items.map((item) => item.candidateId)).toEqual([huge.id, alsoHuge.id]);
  });

  test("a pin outranks the season filter too", () => {
    // A user who pinned it may know something the window does not say, and a
    // re-plan that silently deleted a pin is the worst answer to a pin.
    const winterOnly = candidate({
      specialist: "activities",
      durationMinutes: 60,
      season: { from: "12-01", to: "04-15" },
    });

    const result = pack({
      brief: briefFor({}),
      candidates: [winterOnly],
      span: FOUR_DAYS,
      daysUntilDeparture: 100,
      pinned: [{ candidateId: winterOnly.id, dayIndex: 1, position: 0 }],
    });

    expect(result.days[1]?.items.map((item) => item.candidateId)).toEqual([winterOnly.id]);
  });

  test("pins keep their relative order and lead the day", () => {
    const first = candidate({ specialist: "activities", durationMinutes: 30 });
    const second = candidate({ specialist: "activities", durationMinutes: 30 });
    const newcomer = candidate({ specialist: "activities", durationMinutes: 30 });

    const result = pack({
      brief: briefFor({}),
      candidates: [newcomer, second, first],
      span: tripSpan({ kind: "exact", departure: "2027-07-05", return: "2027-07-05" }),
      daysUntilDeparture: 100,
      pinned: [
        { candidateId: first.id, dayIndex: 0, position: 0 },
        { candidateId: second.id, dayIndex: 0, position: 1 },
      ],
    });

    expect(result.days[0]?.items.map((item) => item.candidateId)).toEqual([
      first.id,
      second.id,
      newcomer.id,
    ]);
  });
});

test("a candidate the critic dropped is excluded with that reason and no other", () => {
  const dropped = candidate({
    specialist: "activities",
    durationMinutes: 60,
    cost: {
      currency: "CAD",
      low: 1,
      high: 1,
      basis: "per-party",
      provenance: MODEL_ASSERTED,
    },
  });

  const result = pack({
    brief: briefFor({}),
    candidates: [dropped],
    span: FOUR_DAYS,
    daysUntilDeparture: 100,
    excluded: new Set([dropped.id]),
  });

  expect(placedIds(result.days)).toEqual([]);
  expect(reasonFor(result, dropped.id)).toBe("dropped-by-critic");
});
