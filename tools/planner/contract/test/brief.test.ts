import { describe, expect, test } from "vitest";
import {
  emptyBrief,
  emptyShapeDetails,
  isSettled,
  missingRequiredSlots,
  REQUIRED_CORE_SLOTS,
  REQUIRED_SHAPE_SLOTS,
  slot,
  TRIP_SHAPES,
  tripBriefSchema,
  tripDatesSchema,
  withShape,
  type BriefSlotId,
  type TripBrief,
  type TripShape,
  type TripShapeDetails,
} from "../src/index.ts";

/** Every core slot a first draft needs, answered. Shape is set by `withShape`. */
const CORE_ANSWERS = {
  origin: slot.answered("Montréal"),
  dates: slot.answered({
    kind: "window" as const,
    earliest: "2027-02-01",
    latest: "2027-02-28",
    nights: 3,
  }),
  travellers: slot.answered(2),
  effort: slot.answered("moderate" as const),
} satisfies Partial<TripBrief>;

/** The required extension slots per shape, answered. */
const SHAPE_ANSWERS: { [S in TripShape]: Partial<Extract<TripShapeDetails, { shape: S }>> } = {
  "road-trip": { driveAppetite: slot.answered("half-day"), vehicleKind: slot.answered("car") },
  backcountry: { nightsOut: slot.answered(2), shelter: slot.answered("hut") },
  "motorised-touring": {
    machine: slot.answered("snowmobile"),
    machineSource: slot.answered("rental"),
  },
  "city-and-culture": { pace: slot.answered("slow"), interests: slot.answered(["ruins", "food"]) },
  resort: { boardBasis: slot.answered("all-inclusive") },
  "multi-city": {
    cities: slot.answered(["Trieste", "Ljubljana"]),
    interCityTransport: slot.answered("train"),
  },
};

/** A brief with exactly its required slots answered and nothing else. */
function draftable(shape: TripShape): TripBrief {
  const brief = withShape({ ...emptyBrief(), ...CORE_ANSWERS }, shape);
  return {
    ...brief,
    details: { ...emptyShapeDetails(shape), ...SHAPE_ANSWERS[shape] } as TripShapeDetails,
  };
}

/** Set one slot to a state that carries no value, wherever on the brief it lives. */
function setSlot(
  brief: TripBrief,
  id: BriefSlotId,
  state: { state: "unknown" } | { state: "declined" },
): TripBrief {
  if (id in brief) return { ...brief, [id]: state } as TripBrief;
  return { ...brief, details: { ...brief.details, [id]: state } as TripShapeDetails };
}

const forget = (brief: TripBrief, id: BriefSlotId) => setSlot(brief, id, slot.unknown());
const decline = (brief: TripBrief, id: BriefSlotId) => setSlot(brief, id, slot.declined());

describe("the required-slot tables", () => {
  test("name slots that exist, so a rename cannot leave a phantom requirement", () => {
    const brief = emptyBrief();
    for (const id of REQUIRED_CORE_SLOTS) expect(brief).toHaveProperty(id);

    for (const shape of TRIP_SHAPES) {
      const details: Record<string, unknown> = emptyShapeDetails(shape);
      for (const id of REQUIRED_SHAPE_SLOTS[shape]) {
        expect(details, `${shape}.${id}`).toHaveProperty(id);
      }
    }
  });

  test("keep a draftable brief inside the eight-to-ten answers §3 asks for", () => {
    for (const shape of TRIP_SHAPES) {
      const answers = REQUIRED_CORE_SLOTS.length + REQUIRED_SHAPE_SLOTS[shape].length;
      expect(answers, shape).toBeLessThanOrEqual(10);
    }
  });
});

describe("missingRequiredSlots", () => {
  test("names every core slot, and no extension slot, before a shape is known", () => {
    expect(missingRequiredSlots(emptyBrief())).toEqual([...REQUIRED_CORE_SLOTS]);
  });

  test("is empty once each shape's required slots are answered", () => {
    for (const shape of TRIP_SHAPES) {
      expect(missingRequiredSlots(draftable(shape)), shape).toEqual([]);
    }
  });

  test("names exactly the one slot a draftable brief is missing", () => {
    for (const shape of TRIP_SHAPES) {
      const required: BriefSlotId[] = [...REQUIRED_CORE_SLOTS, ...REQUIRED_SHAPE_SLOTS[shape]];
      for (const id of required) {
        // Forgetting `shape` takes the extension with it, so it is checked on
        // its own below rather than here.
        if (id === "shape") continue;
        expect(missingRequiredSlots(forget(draftable(shape), id)), `${shape}.${id}`).toEqual([id]);
      }
    }
  });

  test("does not count a declined slot as missing, in the core or the extension", () => {
    const declined = decline(decline(draftable("backcountry"), "origin"), "shelter");
    expect(missingRequiredSlots(declined)).toEqual([]);
  });

  test("does not count a refine slot as missing, however empty", () => {
    const brief = draftable("city-and-culture");
    expect(isSettled(brief.destination)).toBe(false);
    expect(isSettled(brief.comfort)).toBe(false);
    // Budget joined them on 2026-08-16: a draft is possible from a moderate
    // default, so an unanswered budget must not hold the checkpoint shut.
    expect(isSettled(brief.budget)).toBe(false);
    expect(missingRequiredSlots(brief)).toEqual([]);
  });
});

describe("the road trip's vehicle", () => {
  test("holds what it is and whose it is as two facts", () => {
    // The case the old single enum could not express: a rented camper van, which
    // in most markets is the commonest camper trip there is.
    const brief = draftable("road-trip");
    const details = {
      ...brief.details,
      vehicleKind: slot.answered("camper-van" as const),
      vehicleSource: slot.answered("rental" as const),
    } as TripShapeDetails;

    const rented = { ...brief, details };
    expect(tripBriefSchema.safeParse(rented).success).toBe(true);
    // And only the kind is required — renting moves a pickup point and a fee.
    expect(
      missingRequiredSlots({
        ...rented,
        details: { ...details, vehicleSource: slot.unknown() } as TripShapeDetails,
      }),
    ).toEqual([]);
  });
});

describe("changing the trip's shape", () => {
  test("keeps every core slot and swaps only the extension", () => {
    const road = draftable("road-trip");
    const hike = withShape(road, "backcountry");

    const { details: _road, ...roadCore } = road;
    const { details: hikeDetails, ...hikeCore } = hike;
    expect({ ...hikeCore, shape: road.shape }).toEqual(roadCore);

    expect(hikeDetails).toEqual(emptyShapeDetails("backcountry"));
    expect(hike.shape).toEqual(slot.answered("backcountry"));
    // The road-trip answers are gone: they answer questions nobody would ask a
    // hiker. Core survives, so nothing is re-asked.
    expect(missingRequiredSlots(hike)).toEqual(["nightsOut", "shelter"]);
  });

  test("is a no-op when the shape did not change", () => {
    const road = draftable("road-trip");
    expect(withShape(road, "road-trip")).toBe(road);
  });

  test("fills the extension when the shape is answered for the first time", () => {
    const fresh = withShape(emptyBrief(), "resort");
    expect(fresh.details).toEqual(emptyShapeDetails("resort"));
    expect(missingRequiredSlots(fresh)).toEqual([
      "origin",
      "dates",
      "travellers",
      "effort",
      "boardBasis",
    ]);
  });
});

describe("the brief's schema", () => {
  test("accepts a draftable brief of every shape", () => {
    for (const shape of TRIP_SHAPES) {
      expect(tripBriefSchema.safeParse(draftable(shape)).success, shape).toBe(true);
    }
  });

  test("rejects an extension that belongs to another shape", () => {
    const mismatched = { ...draftable("resort"), details: emptyShapeDetails("backcountry") };
    const result = tripBriefSchema.safeParse(mismatched);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["details"]);
  });

  test("rejects an answered slot carrying no value", () => {
    const brief = { ...emptyBrief(), travellers: { state: "answered" } };
    expect(tripBriefSchema.safeParse(brief).success).toBe(false);
  });

  test("accepts a declined slot, which carries no value on purpose", () => {
    const brief = { ...emptyBrief(), travellers: slot.declined() };
    expect(tripBriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe("trip dates", () => {
  test("take a flexible window, which is an answer and not a missing date", () => {
    const result = tripDatesSchema.safeParse({
      kind: "window",
      earliest: "2027-02-01",
      latest: "2027-02-28",
      nights: 2,
    });
    expect(result.success).toBe(true);
  });

  test("take a duration with no window at all", () => {
    expect(tripDatesSchema.safeParse({ kind: "open", nights: 14 }).success).toBe(true);
  });

  test("reject a return before its departure, and a window that ends before it starts", () => {
    expect(
      tripDatesSchema.safeParse({ kind: "exact", departure: "2027-09-10", return: "2027-09-02" })
        .success,
    ).toBe(false);
    expect(
      tripDatesSchema.safeParse({
        kind: "window",
        earliest: "2027-05-30",
        latest: "2027-05-01",
        nights: 3,
      }).success,
    ).toBe(false);
  });

  test("reject a trip longer than this tool plans", () => {
    expect(tripDatesSchema.safeParse({ kind: "open", nights: 365 }).success).toBe(false);
  });
});
