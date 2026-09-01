/**
 * The one identity the grounding seam uses for a place.
 *
 * This file exists because pl-27 got it wrong first. The travel pass
 * deduplicated its place list with the fixture provider's own table-lookup key,
 * which is name-only, and two different places that share a name therefore
 * became one row — with the survivor's coordinates written onto both candidates
 * and persisted, and both ends indexing the same matrix cell. The plan then
 * reported a `measured`, `grounded` transition to somewhere nobody was going.
 *
 * A fabricated fact carrying a source is the worst failure this tool has, so
 * the collision case is asserted rather than argued.
 */

import { describe, expect, test } from "vitest";
import type { Place } from "@planner/contract";
import { locateKey, travelKey } from "../src/grounding/cache.ts";
import { placeIdentity } from "../src/grounding/place-key.ts";
import { placeKey } from "../src/grounding/fixture-data.ts";

function place(name: string, locality: string | null = null): Place {
  return { name, locality, coordinates: null };
}

describe("placeIdentity", () => {
  test("keeps two places that share a name and differ in locality apart", () => {
    const quebec = place("Saint-Jean", "Québec, Canada");
    const newBrunswick = place("Saint-Jean", "New Brunswick, Canada");

    expect(placeIdentity(quebec)).not.toBe(placeIdentity(newBrunswick));

    // And the fixture provider's own table lookup does not, which is the whole
    // reason the seam owns an identity separately. Asserted against `placeKey`
    // itself — the function `locate` and `estimate` actually call — rather than
    // against the wrapper pl-27 was invited to use and pl-27 deleted.
    expect(placeKey(quebec.name)).toBe(placeKey(newBrunswick.name));
  });

  test("a place with no locality is not the same question as one with an empty one", () => {
    expect(placeIdentity(place("Alma"))).not.toBe(placeIdentity(place("Alma", "   ")));
  });

  test("collapses case and repeated whitespace, because a model writes both", () => {
    expect(placeIdentity(place("Québec  City", "QC"))).toBe(
      placeIdentity(place("québec city", " qc ")),
    );
  });

  test("keeps accents, because two spellings may be two answers", () => {
    expect(placeIdentity(place("Montréal"))).not.toBe(placeIdentity(place("Montreal")));
  });

  test("is the string the cache keys by, so the pass and the lookup agree", () => {
    // The failure this rules out is subtle and expensive: a pass that
    // deduplicates by one identity and a cache that stores by another will
    // send a place it already holds an answer for, every run.
    const one = place("Rimouski", "Québec, Canada");
    // `toContain` and no longer `toBe` — pl-37 gave the locate key a second
    // part, the trip context the answer may depend on, exactly as `travelKey`
    // has always had a mode and a second end. What must hold is that the
    // identity the pass deduplicates by is *in* the key, not that it is the
    // whole of it.
    expect(locateKey(one, undefined)).toContain(placeIdentity(one));
    expect(travelKey(one, place("Percé"), "driving")).toContain(placeIdentity(one));
  });
});
