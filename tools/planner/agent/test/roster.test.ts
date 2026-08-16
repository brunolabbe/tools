/**
 * The roster is data, so this suite reads like the table it asserts against.
 *
 * "Which agents ran, and why" is the first question anyone debugging a bad plan
 * asks (§4), and the answer has to be checkable per trip shape — including the
 * shapes where a specialist is deliberately absent, which is the half that
 * silently regresses when someone adds a row.
 */

import { describe, expect, test } from "vitest";
import { isAnswered, slot, TRIP_SHAPES, withShape } from "@planner/contract";
import type { Specialist, TripBrief } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { ROSTER, rosterFor, SPECIALIST_ORDER } from "../src/index.ts";

function ran(brief: TripBrief): Specialist[] {
  return rosterFor(brief).running.map((entry) => entry.specialist);
}

describe("the roster, per trip shape", () => {
  test("a road trip in your own car runs five, and no practicalities", () => {
    expect(ran(loadFixture("road-trip").brief)).toEqual([
      "route-and-logistics",
      "lodging",
      "activities",
      "food",
      "budget",
    ]);
  });

  test("a hut-to-hut week runs conditions and gear, and no food", () => {
    // Food is deliberately off: on a backcountry trip what you eat is what you
    // carried, and that is the gear specialist's answer rather than a meal to
    // propose.
    expect(ran(loadFixture("backcountry").brief)).toEqual([
      "route-and-logistics",
      "lodging",
      "activities",
      "conditions-and-gear",
      "practicalities",
      "budget",
    ]);
  });

  test("a snowmobile weekend runs conditions and gear — §4's own example", () => {
    expect(ran(loadFixture("motorised-touring").brief)).toContain("conditions-and-gear");
  });

  test("a week in one city runs no route specialist", () => {
    expect(ran(loadFixture("city-and-culture").brief)).toEqual([
      "lodging",
      "activities",
      "food",
      "practicalities",
      "budget",
    ]);
  });

  test("a resort week runs neither route nor conditions — §4, in a table", () => {
    expect(ran(loadFixture("resort").brief)).toEqual([
      "lodging",
      "activities",
      "practicalities",
      "budget",
    ]);
  });

  test("three cities and the trains between them run the route specialist", () => {
    expect(ran(loadFixture("multi-city").brief)).toEqual([
      "route-and-logistics",
      "lodging",
      "activities",
      "food",
      "practicalities",
      "budget",
    ]);
  });
});

describe("what the brief's contents change", () => {
  test("an all-inclusive resort gets no food specialist, and is told why", () => {
    const { brief } = loadFixture("resort");
    const decision = rosterFor(brief);

    expect(decision.running.map((entry) => entry.specialist)).not.toContain("food");
    const absent = decision.notApplicable.find((entry) => entry.specialist === "food");
    expect(absent?.because).toMatch(/board you asked for already covers the meals/);
  });

  test("a room-only resort gets one", () => {
    const { brief } = loadFixture("resort");
    const details = brief.details;
    if (details?.shape !== "resort") throw new Error("the resort fixture lost its shape");

    const roomOnly: TripBrief = {
      ...brief,
      details: { ...details, boardBasis: slot.answered("room-only") },
    };
    expect(ran(roomOnly)).toContain("food");
  });

  test("a rented camper earns a practicalities specialist that an owned car does not", () => {
    const { brief } = loadFixture("road-trip");
    const details = brief.details;
    if (details?.shape !== "road-trip") throw new Error("the road-trip fixture lost its shape");

    expect(ran(brief)).not.toContain("practicalities");
    const rented: TripBrief = {
      ...brief,
      details: { ...details, vehicleSource: slot.answered("rental") },
    };
    expect(ran(rented)).toContain("practicalities");
  });

  test("an unanswered condition reads as not met, never as maybe", () => {
    // The wizard stops at the core questions, so `vehicleSource` is routinely
    // unknown at the first draft. Running an extra specialist on a maybe is the
    // spend §9 says the roster exists to refuse.
    const { brief } = loadFixture("road-trip");
    const details = brief.details;
    if (details?.shape !== "road-trip") throw new Error("the road-trip fixture lost its shape");

    const unasked: TripBrief = {
      ...brief,
      details: { ...details, vehicleSource: slot.unknown() },
    };
    expect(ran(unasked)).not.toContain("practicalities");
  });
});

describe("the shape of the answer", () => {
  test("every specialist is either running or explained, for every shape", () => {
    for (const shape of TRIP_SHAPES) {
      const decision = rosterFor(withShape(loadFixture(shape).brief, shape));
      const named = [...decision.running, ...decision.notApplicable].map(
        (entry) => entry.specialist,
      );
      expect(named.toSorted()).toEqual([...SPECIALIST_ORDER].toSorted());
    }
  });

  test("nobody runs without a sentence saying why", () => {
    for (const shape of TRIP_SHAPES) {
      for (const entry of rosterFor(loadFixture(shape).brief).running) {
        expect(entry.because.length).toBeGreaterThan(0);
      }
    }
  });

  test("a brief with no shape rosters nothing rather than guessing", () => {
    const { brief } = loadFixture("road-trip");
    const shapeless: TripBrief = { ...brief, shape: slot.declined(), details: null };

    expect(isAnswered(shapeless.shape)).toBe(false);
    expect(rosterFor(shapeless).running).toEqual([]);
    expect(rosterFor(shapeless).notApplicable).toHaveLength(SPECIALIST_ORDER.length);
  });

  test("every row in the table names a shape that exists", () => {
    for (const rule of ROSTER) {
      expect(rule.shapes.length).toBeGreaterThan(0);
      for (const shape of rule.shapes) expect(TRIP_SHAPES).toContain(shape);
    }
  });
});
