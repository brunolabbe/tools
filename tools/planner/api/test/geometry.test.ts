/**
 * The geometric filter — pure arithmetic, and the one piece of pl-29 that
 * needed no network to build or to test. See the header of `geometry.ts` for
 * why the projection it uses is trustworthy at these distances.
 */

import { describe, expect, test } from "vitest";
import type { Coordinates } from "@planner/contract";
import { distanceToCorridorMetres, haversineMetres } from "../src/grounding/geometry.ts";

/** Montréal and Québec City, roughly — a real, well-known distance to check against. */
const MONTREAL: Coordinates = { latitude: 45.5019, longitude: -73.5674 };
const QUEBEC_CITY: Coordinates = { latitude: 46.8139, longitude: -71.208 };

describe("haversineMetres", () => {
  test("a point is zero from itself", () => {
    expect(haversineMetres(MONTREAL, MONTREAL)).toBe(0);
  });

  test("Montréal to Québec City is roughly 230 km, not roughly anything else", () => {
    // The real road distance is about 250 km; a straight line is a little
    // shorter. This is a sanity bound, not a claim to the metre.
    const metres = haversineMetres(MONTREAL, QUEBEC_CITY);
    expect(metres).toBeGreaterThan(220_000);
    expect(metres).toBeLessThan(240_000);
  });

  test("is symmetric", () => {
    expect(haversineMetres(MONTREAL, QUEBEC_CITY)).toBeCloseTo(
      haversineMetres(QUEBEC_CITY, MONTREAL),
      6,
    );
  });
});

describe("distanceToCorridorMetres", () => {
  test("refuses an empty corridor rather than answering Infinity", () => {
    // Infinity would pass every point through a radius filter meant to reject
    // almost everything — a silent way for this filter to stop filtering.
    expect(() => distanceToCorridorMetres(MONTREAL, [])).toThrow(RangeError);
  });

  test("a one-point corridor is the distance to that point", () => {
    const near: Coordinates = { latitude: 45.51, longitude: -73.57 };
    expect(distanceToCorridorMetres(near, [MONTREAL])).toBeCloseTo(
      haversineMetres(near, MONTREAL),
      -1, // within ~30 m, which the projection's own error budget covers
    );
  });

  test("a point exactly on the line between the two ends is ~0", () => {
    const midpoint: Coordinates = {
      latitude: (MONTREAL.latitude + QUEBEC_CITY.latitude) / 2,
      longitude: (MONTREAL.longitude + QUEBEC_CITY.longitude) / 2,
    };
    expect(distanceToCorridorMetres(midpoint, [MONTREAL, QUEBEC_CITY])).toBeLessThan(1);
  });

  test("a point past either end is measured to that end, not extrapolated", () => {
    // Well beyond Québec City, roughly along the same bearing. The clamp in
    // `distanceToSegmentMetres` is what is under test: without it, a point
    // "past" the segment would be measured against the infinite line through
    // it rather than against the segment's own end.
    const beyond: Coordinates = { latitude: 48.0, longitude: -69.0 };
    const toCorridor = distanceToCorridorMetres(beyond, [MONTREAL, QUEBEC_CITY]);
    const toFarEnd = haversineMetres(beyond, QUEBEC_CITY);
    // Within 5 km: "beyond" is only roughly along the corridor's bearing, so
    // this checks the clamp actually fired (measuring to the far end, not the
    // infinite line) rather than pinning the exact metre.
    expect(Math.abs(toCorridor - toFarEnd)).toBeLessThan(5_000);
  });

  test("a point before either end is measured to that end too — the symmetric clamp", () => {
    // Gate B, 2026-08-29: the "past the far end" case above pins `t <= 1`
    // (`Math.min(1, t)`) but nothing pinned `t >= 0` (`Math.max(0, ...)`) —
    // an asymmetric pair of assertions is exactly the shape where a later
    // edit breaks the untested half silently. Well before Montréal, roughly
    // along the corridor's reverse bearing.
    const before: Coordinates = { latitude: 44.3158, longitude: -75.7754 };
    const toCorridor = distanceToCorridorMetres(before, [MONTREAL, QUEBEC_CITY]);
    const toNearEnd = haversineMetres(before, MONTREAL);
    expect(Math.abs(toCorridor - toNearEnd)).toBeLessThan(5_000);
  });

  test("picks the nearer of several segments, not the first", () => {
    // A three-point corridor bent through Trois-Rivières; a point near the far
    // leg must not be measured against the near one just because it comes
    // first in the array.
    const troisRivieres: Coordinates = { latitude: 46.3432, longitude: -72.5432 };
    const corridor = [MONTREAL, troisRivieres, QUEBEC_CITY];
    const nearFarLeg: Coordinates = { latitude: 46.6, longitude: -71.9 };

    const viaCorridor = distanceToCorridorMetres(nearFarLeg, corridor);
    const viaFirstSegmentOnly = distanceToCorridorMetres(nearFarLeg, [MONTREAL, troisRivieres]);
    expect(viaCorridor).toBeLessThan(viaFirstSegmentOnly);
  });

  test("a degenerate corridor — both ends the same point — is a point distance, not a crash", () => {
    const point: Coordinates = { latitude: 45.6, longitude: -73.5 };
    expect(() => distanceToCorridorMetres(point, [MONTREAL, MONTREAL])).not.toThrow();
    expect(distanceToCorridorMetres(point, [MONTREAL, MONTREAL])).toBeCloseTo(
      haversineMetres(point, MONTREAL),
      -2,
    );
  });
});
