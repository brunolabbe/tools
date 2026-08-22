/**
 * The default grounding provider.
 *
 * The point of these assertions is mostly what the provider *refuses* to do. A
 * fixture that answered plausibly for anything it was asked would make pl-27's
 * pass testable against arithmetic and would make a misconfigured deployment
 * look like a working one, so "returns `null` and does not throw" is the
 * behaviour under test as much as any answer is.
 */

import { describe, expect, test } from "vitest";
import { AppError, sourceSchema, type Place } from "@planner/contract";
import { travelCell } from "@planner/agent";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import { FIXTURE_FETCHED_AT } from "../src/grounding/fixture-data.ts";

const grounding = new FixtureGroundingProvider();

/** As a candidate names one. Coordinates null — that is what `locate` is for. */
function place(name: string, locality: string | null = null): Place {
  return { name, locality, coordinates: null };
}

describe("the fixture grounding provider", () => {
  test("reports itself by name, so health cannot pass it off as a backend", () => {
    expect(grounding.name).toBe("fixtures");
  });

  describe("locate", () => {
    test("finds a place the checked-in candidate sets name, with a source", async () => {
      const located = await grounding.locate({ place: place("Rimouski", "Québec, Canada") });

      expect(located).not.toBeNull();
      expect(located?.coordinates.latitude).toBeCloseTo(48.4489, 3);
      expect(located?.coordinates.longitude).toBeCloseTo(-68.5236, 3);
      // A grounded fact with no source is refused by `provenanceSchema`, so the
      // seam must not be able to produce one.
      expect(sourceSchema.safeParse(located?.source).success).toBe(true);
      expect(located?.source.fetchedAt).toBe(FIXTURE_FETCHED_AT);
    });

    test("its source is visibly not a citation", async () => {
      const located = await grounding.locate({ place: place("Percé") });

      // RFC 2606 reserves `.invalid`, so this can never resolve. A plausible
      // URL at a real gazetteer that nothing ever fetched is exactly the thing
      // the provenance mechanism exists to make visible.
      expect(new URL(located?.source.url ?? "").hostname).toBe("fixtures.invalid");
    });

    test("matches across accents and case, because a model writes both", async () => {
      const withAccent = await grounding.locate({ place: place("Montréal") });
      const without = await grounding.locate({ place: place("montreal") });

      expect(withAccent?.coordinates).toEqual(without?.coordinates);
      expect(withAccent).not.toBeNull();
    });

    test("answers null — not a guess, not a throw — for a place it does not hold", async () => {
      // The failure this whole file is about. A great-circle fallback would
      // return a plausible pair of numbers here and nothing downstream could
      // tell them from a measurement.
      await expect(grounding.locate({ place: place("Chibougamau") })).resolves.toBeNull();
    });

    test("has nothing to say about a region that is a scope rather than a place", async () => {
      // A candidate really is proposed "across Central Europe". Where that *is*
      // has no answer, and inventing a centroid for it would be the same lie in
      // a politer form.
      await expect(grounding.locate({ place: place("Central Europe") })).resolves.toBeNull();
    });
  });

  describe("travel", () => {
    test("measures a leg the candidate sets actually propose, in both directions", async () => {
      const montreal = place("Montréal", "Québec, Canada");
      const quebec = place("Québec City", "Québec, Canada");

      const matrix = await grounding.travel({
        origins: [montreal, quebec],
        destinations: [montreal, quebec],
        mode: "driving",
      });

      const there = travelCell(matrix, 0, 1);
      const back = travelCell(matrix, 1, 0);
      expect(there?.distanceMeters).toBe(255_000);
      expect(there?.durationMinutes).toBe(165);
      // The fixture asserts driving is symmetric. Stated in `fixture-data.ts`
      // as an assumption a real backend must not make — ferries and one-way
      // systems are why — and pinned here so it cannot change unnoticed.
      //
      // The *measurement* is what is symmetric. Each cell's source names the
      // direction it answers, so the two are not the same object.
      expect(back?.distanceMeters).toBe(there?.distanceMeters);
      expect(back?.durationMinutes).toBe(there?.durationMinutes);
      expect(sourceSchema.safeParse(there?.source).success).toBe(true);
    });

    test("is zero from a place to itself, and null from an unknown one to itself", async () => {
      const matrix = await grounding.travel({
        origins: [place("Alma"), place("Chibougamau")],
        destinations: [place("Alma"), place("Chibougamau")],
        mode: "driving",
      });

      expect(travelCell(matrix, 0, 0)?.durationMinutes).toBe(0);
      expect(travelCell(matrix, 0, 0)?.distanceMeters).toBe(0);
      // Zero from itself is a fact about identity. Answering it for a name
      // nobody has heard of would invent the place and measure it at once.
      expect(travelCell(matrix, 1, 1)).toBeNull();
    });

    test("has no driving answer for a walking leg, and says so with null", async () => {
      // Seven hours over the Mont-Albert plateau, with no road. Both ends are
      // in the gazetteer and the pair is deliberately absent from the leg
      // table: a cell that is asked for, exists, and has no answer.
      const matrix = await grounding.travel({
        origins: [place("Gîte du Mont-Albert", "Parc national de la Gaspésie, Québec")],
        destinations: [place("Refuge Le Carouge", "Parc national de la Gaspésie, Québec")],
        mode: "driving",
      });

      expect(travelCell(matrix, 0, 0)).toBeNull();
    });

    test("keeps rows on origins and columns on destinations", async () => {
      // A transposed matrix is the failure `travelCell` exists to prevent, and
      // it is invisible on a square one — so this asks a 1×2.
      const matrix = await grounding.travel({
        origins: [place("Saguenay")],
        destinations: [place("Alma"), place("Saint-Félicien")],
        mode: "driving",
      });

      expect(matrix).toHaveLength(1);
      expect(matrix[0]).toHaveLength(2);
      // Two different legs of the Lac-Saint-Jean loop, so a transposed read
      // would return the wrong one rather than the same one.
      expect(travelCell(matrix, 0, 0)?.durationMinutes).toBe(50);
      expect(travelCell(matrix, 0, 1)?.durationMinutes).toBe(95);
    });

    test("cannot have one pair's key forged out of another's names", async () => {
      // `"quebec city"` + `"rimouski"` and `"quebec"` + `"city rimouski"` are
      // the same string if the separator is a space. Neither of the halves
      // below is a place, so both cells must be empty.
      const matrix = await grounding.travel({
        origins: [place("Québec")],
        destinations: [place("City Rimouski")],
        mode: "driving",
      });

      expect(travelCell(matrix, 0, 0)).toBeNull();
    });

    test("an empty list is an empty matrix, not a failure", async () => {
      const matrix = await grounding.travel({ origins: [], destinations: [], mode: "driving" });
      expect(matrix).toEqual([]);
    });
  });

  describe("cancellation", () => {
    test("stops rather than filling a matrix nobody will read", async () => {
      const aborted = AbortSignal.abort();

      // `CANCELED`, not `JOB_CANCELED`: a library has no business naming a
      // concept from the layer above it.
      await expect(
        grounding.travel({
          origins: [place("Alma")],
          destinations: [place("Saguenay")],
          mode: "driving",
          signal: aborted,
        }),
      ).rejects.toMatchObject({ code: "CANCELED" });

      await expect(
        grounding.locate({ place: place("Alma"), signal: aborted }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });
});
