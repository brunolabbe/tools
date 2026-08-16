import { describe, expect, test } from "vitest";
import {
  ALL_YEAR,
  candidateLocationSchema,
  candidateSchema,
  costEstimateSchema,
  location,
  MODEL_ASSERTED,
  provenanceSchema,
  seasonWindowSchema,
  sourceSchema,
  SPECIALISTS,
  type Candidate,
  type Place,
  type Source,
} from "../src/index.ts";

const SOURCE: Source = {
  url: "https://example.org/opening-hours",
  title: "Opening hours",
  fetchedAt: "2026-08-14T18:12:04.000Z",
};

const SOMEWHERE: Place = { name: "Somewhere", locality: null, coordinates: null };
const ELSEWHERE: Place = { name: "Elsewhere", locality: null, coordinates: null };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    specialist: "activities",
    title: "A thing to do",
    summary: "Why it is worth doing.",
    location: location.at(SOMEWHERE),
    durationMinutes: 90,
    cost: null,
    season: null,
    bookingLeadTimeDays: null,
    provenance: MODEL_ASSERTED,
    ...overrides,
  };
}

describe("provenance", () => {
  test("a grounded fact must carry at least one source", () => {
    // The property the type cannot express and the whole point of the union: a
    // grounded provenance with nothing behind it claims we checked something we
    // did not, which is worse than admitting the model said it.
    expect(provenanceSchema.safeParse({ kind: "grounded", sources: [] }).success).toBe(false);
    expect(provenanceSchema.safeParse({ kind: "grounded", sources: [SOURCE] }).success).toBe(true);
  });

  test("model-asserted needs nothing, and MODEL_ASSERTED is it", () => {
    expect(provenanceSchema.parse(MODEL_ASSERTED)).toEqual({ kind: "model-asserted" });
  });

  test("a source url must be a web address", () => {
    // This value reaches the UI as a link. A `javascript:` string passing as a
    // source is the obvious way that becomes a bug, and it is rejected here
    // rather than by every renderer.
    expect(sourceSchema.safeParse({ ...SOURCE, url: "javascript:alert(1)" }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...SOURCE, url: "file:///etc/passwd" }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...SOURCE, url: "not a url" }).success).toBe(false);
  });
});

describe("cost", () => {
  const cost = {
    currency: "EUR",
    low: 10,
    high: 25,
    basis: "per-person" as const,
    provenance: MODEL_ASSERTED,
  };

  test("a band whose high is below its low is rejected", () => {
    expect(costEstimateSchema.safeParse({ ...cost, low: 25, high: 10 }).success).toBe(false);
  });

  test("a fixed price is low equal to high, and is a different claim from unknown", () => {
    expect(costEstimateSchema.safeParse({ ...cost, low: 18, high: 18 }).success).toBe(true);
    // Free is a cost, not an absence of one. `null` is how absence is said, and
    // the two must stay distinguishable.
    expect(costEstimateSchema.safeParse({ ...cost, low: 0, high: 0 }).success).toBe(true);
    expect(candidateSchema.parse(candidate({ cost: null })).cost).toBeNull();
  });

  test("the currency is ISO-4217, matching the brief's", () => {
    expect(costEstimateSchema.safeParse({ ...cost, currency: "eur" }).success).toBe(false);
    expect(costEstimateSchema.safeParse({ ...cost, currency: "Euro" }).success).toBe(false);
  });
});

describe("season", () => {
  test("a window that wraps the new year is valid, not an error", () => {
    // A ski season is December to April. A schema that ordered the pair would
    // make winter unrepresentable, so the wrap is deliberately allowed and
    // every reader has to handle it.
    expect(seasonWindowSchema.safeParse({ from: "12-01", to: "04-15" }).success).toBe(true);
  });

  test("impossible days are rejected", () => {
    expect(seasonWindowSchema.safeParse({ from: "02-30", to: "03-01" }).success).toBe(false);
    expect(seasonWindowSchema.safeParse({ from: "13-01", to: "03-01" }).success).toBe(false);
    expect(seasonWindowSchema.safeParse({ from: "04-31", to: "05-01" }).success).toBe(false);
    expect(seasonWindowSchema.safeParse({ from: "1-1", to: "3-1" }).success).toBe(false);
  });

  test("29 February is a real day", () => {
    expect(seasonWindowSchema.safeParse({ from: "02-29", to: "03-01" }).success).toBe(true);
  });

  test("ALL_YEAR is a season, and null is not", () => {
    // The distinction the composer depends on: a known all-year window is
    // filtered against and passes; an unknown one is left to the critic. If
    // they collapsed, a hut nobody checked would read as open in February.
    expect(seasonWindowSchema.parse(ALL_YEAR)).toEqual({ from: "01-01", to: "12-31" });
    expect(candidateSchema.parse(candidate({ season: null })).season).toBeNull();
  });
});

describe("location", () => {
  test("a leg carries both ends, and one end is not a leg", () => {
    // The property the union exists for. A drive's endpoints used to live in
    // its title — "Montréal to Rimouski via the 132" — where nothing could read
    // them, and travel time, a detour and conditions along a corridor all need
    // two points before they mean anything.
    expect(candidateLocationSchema.safeParse(location.between(SOMEWHERE, ELSEWHERE)).success).toBe(
      true,
    );
    expect(candidateLocationSchema.safeParse({ kind: "between", from: SOMEWHERE }).success).toBe(
      false,
    );
    expect(candidateLocationSchema.safeParse({ kind: "between", to: ELSEWHERE }).success).toBe(
      false,
    );
  });

  test("a leg that starts and ends in the same place is legal", () => {
    // A scenic loop out of a town and back. Rejecting it would make the loop
    // unrepresentable, the way ordering a SeasonWindow would make winter one.
    expect(candidateLocationSchema.safeParse(location.between(SOMEWHERE, SOMEWHERE)).success).toBe(
      true,
    );
  });

  test("the two kinds do not accept each other's fields", () => {
    expect(candidateLocationSchema.safeParse({ kind: "at", from: SOMEWHERE }).success).toBe(false);
    expect(candidateLocationSchema.safeParse({ place: SOMEWHERE }).success).toBe(false);
  });

  test("every specialist may be at a place or run between two", () => {
    // Which of the two makes sense for a given specialist is the packer's
    // business — `BUCKET_OF` in `@planner/itinerary` — and deliberately not
    // this schema's. The contract says what is representable.
    for (const specialist of SPECIALISTS) {
      const leg = candidate({ specialist, location: location.between(SOMEWHERE, ELSEWHERE) });
      expect(candidateSchema.safeParse(leg).success).toBe(true);
    }
  });
});

describe("candidate", () => {
  test("a well-formed candidate round-trips", () => {
    const full = candidate({
      specialist: "lodging",
      location: location.at({
        name: "A hut",
        locality: "Québec",
        coordinates: { latitude: 48.9, longitude: -66.1 },
      }),
      cost: {
        currency: "CAD",
        low: 30,
        high: 45,
        basis: "per-person",
        provenance: { kind: "grounded", sources: [SOURCE] },
      },
      season: { from: "06-15", to: "10-01" },
      bookingLeadTimeDays: 150,
      provenance: { kind: "grounded", sources: [SOURCE] },
    });
    expect(candidateSchema.parse(full)).toEqual(full);
  });

  test("it carries nothing about which day it falls on", () => {
    // §4's seam, asserted rather than left to review. A specialist that could
    // name a day would be writing the schedule, and two of them would produce
    // two itineraries to reconcile.
    const parsed: Record<string, unknown> = candidateSchema.parse(candidate());
    for (const key of ["day", "dayIndex", "date", "startsAt", "position"]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  test("every specialist in the roster is a legal author", () => {
    for (const specialist of SPECIALISTS) {
      expect(candidateSchema.safeParse(candidate({ specialist })).success).toBe(true);
    }
    expect(candidateSchema.safeParse(candidate({ specialist: "concierge" as never })).success).toBe(
      false,
    );
  });

  test("unbounded text is rejected, because a reply is untrusted input", () => {
    // Every bound on this type exists because a specialist reads hostile pages
    // and its output is validated before anything acts on it. A field with no
    // ceiling is an unbounded row and an unbounded bill.
    expect(candidateSchema.safeParse(candidate({ title: "x".repeat(201) })).success).toBe(false);
    expect(candidateSchema.safeParse(candidate({ summary: "x".repeat(1_001) })).success).toBe(
      false,
    );
    expect(candidateSchema.safeParse(candidate({ durationMinutes: 1_441 })).success).toBe(false);
    expect(candidateSchema.safeParse(candidate({ bookingLeadTimeDays: 731 })).success).toBe(false);
  });

  test("a duration of zero is not a duration", () => {
    expect(candidateSchema.safeParse(candidate({ durationMinutes: 0 })).success).toBe(false);
    // But a lead time of zero is real: walk up on the day.
    expect(candidateSchema.safeParse(candidate({ bookingLeadTimeDays: 0 })).success).toBe(true);
  });
});
