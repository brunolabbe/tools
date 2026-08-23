/**
 * What the fixture grounding provider knows, as checked-in content.
 *
 * The counterpart of `SCRIPTED_FAN_OUT` and written for the same reason: a
 * fresh clone must plan a trip with no key, no account and no bill, and CI
 * needs something deterministic to assert against. That claim is only worth
 * anything if it covers **the whole pipeline**, so the places and legs below
 * are exactly the ones the six checked-in candidate sets name.
 *
 * ## Why this is a `.ts` table under `src` and not JSON under `test/fixtures/`
 *
 * pl-24's brief said `api/test/fixtures/`. It cannot be: the runtime stage of
 * `Dockerfile` copies each workspace's `package.json` and `dist` and nothing
 * else, so a provider reading from `test/` works in the suite and throws in the
 * shipped image — and it is the *default* provider, so that is every container
 * that has not been given a real backend. `scripted-fan-out.ts` is the
 * precedent and it is exact: the scripted model provider's content is a table
 * in `src` for this same reason.
 *
 * ## Nothing here is interpolated, and that is the point
 *
 * A pair with no entry has no answer. A fixture that computed a great-circle
 * distance for an unknown pair would be grounding wearing a costume: pl-27's
 * tests would pass against arithmetic, and a deployment that had misconfigured
 * its real backend would look like one that was working. The gazetteer is a
 * lookup and the leg table is a lookup, and both answer `null` off the end of
 * themselves.
 *
 * The one thing derived rather than stated is a **place from itself**, which is
 * zero. That is arithmetic about identity, not an estimate of anything.
 */

import type { Coordinates, Source } from "@planner/contract";

// ---------------------------------------------------------------------------
// Saying where this came from
// ---------------------------------------------------------------------------

/**
 * Every fixture answer carries a source, because `provenanceSchema` refuses a
 * grounded fact without one and because the plan view renders it as "we checked
 * this, here is where".
 *
 * ## Why there is no `FIXTURE_FETCHED_AT` any more
 *
 * pl-24 stamped every answer with a constant dated the day this table was
 * typed, on the argument that a checked-in table must not claim to have just
 * read something. pl-25's review found what that costs once grounding has a
 * TTL: the travel lifetime is 4,320 hours, so **from 2027-02-18 every fixture
 * `travel` answer would have arrived already expired** — nothing cached, every
 * lookup a miss, every miss spending budget, and nothing red to say so.
 * `locate` would have followed on 2027-08-22. A dated constant plus a lifetime
 * is a time bomb whichever pair of numbers you pick, so there is no date here
 * to go stale.
 *
 * **The host is `.invalid` on purpose.** RFC 2606 reserves that TLD so it can
 * never resolve, which makes the link visibly not a citation. The alternative
 * was a plausible URL at a real gazetteer that nothing ever fetched, and that
 * is precisely the failure the whole provenance mechanism exists to make
 * visible — the same argument that makes the scripted model provider report
 * itself as `scripted` in `/api/health`.
 *
 * **`fetchedAt` is when this answer was handed over, not when the table was
 * typed.** It is the honest reading of the field — the fixture provider really
 * did consult its table just now — and it is what keeps the provider from
 * ageing into a permanently disabled cache. Nothing here pretends to be a
 * measurement: the host cannot resolve and the title says what it is.
 *
 * The clock is the caller's so the provider stays deterministic under a test,
 * which is the half of pl-24's argument that was actually load-bearing.
 */
export function fixtureSource(what: string, fetchedAt: Date): Source {
  return {
    url: `https://fixtures.invalid/planner/${what}`,
    title: "Checked-in fixture, not a measurement",
    fetchedAt: fetchedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Matching a name
// ---------------------------------------------------------------------------

/**
 * Lower-cased, accents stripped, whitespace collapsed.
 *
 * So `Montréal` and `Montreal` are the same key. This is key matching and not
 * interpolation: it decides whether we hold an answer, never what the answer
 * is.
 *
 * **It keys on the name alone**, and that is a licence this table earns by
 * being small — no two places in the six candidate sets share a name. A real
 * backend must use the locality too, which is why `LocateRequest` carries the
 * whole `Place`: without it there is nothing to separate Sainte-Anne-des-Monts
 * in Québec from anywhere else with that name.
 */
export function placeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// The gazetteer
// ---------------------------------------------------------------------------

/**
 * Where the candidate sets' places are.
 *
 * Regions are here at the point a map would label them — `Gaspésie`, `Lac Saint-Jean` —
 * because a candidate really is proposed "in the Gaspésie" and a caller asking
 * for it deserves an answer rather than a `null` that means "we have no table".
 * `Central Europe` is deliberately absent: it is a candidate's *scope*, not a
 * place, and the honest answer to "where is Central Europe" is nothing.
 *
 * Written as a literal and served as a `Map`, like `FIXTURE_DRIVING` below.
 * **A plain object would answer for names it does not hold**: the key comes from
 * a candidate a model wrote, and `{}["constructor"]` is a function rather than
 * `undefined`, so a place called "Constructor" would come back located and a leg
 * to it would come back measured at zero. A `Map` has no prototype chain to
 * walk, so "not in the table" is the only thing a miss can mean.
 */
const FIXTURE_PLACE_TABLE: Readonly<Record<string, Coordinates>> = Object.freeze({
  // --- The road trip and the Gaspésie ---
  montreal: { latitude: 45.5019, longitude: -73.5674 },
  "quebec city": { latitude: 46.8139, longitude: -71.208 },
  rimouski: { latitude: 48.4489, longitude: -68.5236 },
  "sainte-flavie": { latitude: 48.6167, longitude: -68.0167 },
  "sainte-anne-des-monts": { latitude: 49.1258, longitude: -66.4931 },
  perce: { latitude: 48.5236, longitude: -64.2131 },
  "sainte-therese-de-gaspe": { latitude: 48.3833, longitude: -64.4667 },
  "ile bonaventure": { latitude: 48.4931, longitude: -64.16 },
  "forillon national park": { latitude: 48.85, longitude: -64.35 },
  gaspesie: { latitude: 48.8, longitude: -65.5 },

  // --- The backcountry set, inside the park ---
  "parc national de la gaspesie": { latitude: 48.9333, longitude: -66.1667 },
  "gite du mont-albert": { latitude: 48.9264, longitude: -66.1806 },
  "mont-albert plateau": { latitude: 48.9333, longitude: -66.1889 },
  "mont xalibu": { latitude: 48.9214, longitude: -66.1553 },
  "refuge le carouge": { latitude: 48.9667, longitude: -66.05 },
  "refuge du lac-cascapedia": { latitude: 48.9, longitude: -66.2333 },

  // --- Saguenay–Lac-Saint-Jean ---
  saguenay: { latitude: 48.4281, longitude: -71.0683 },
  alma: { latitude: 48.55, longitude: -71.65 },
  "saint-felicien": { latitude: 48.65, longitude: -72.45 },
  "lac saint-jean": { latitude: 48.5833, longitude: -72.0 },
  "saguenay–lac-saint-jean": { latitude: 48.5, longitude: -71.5 },

  // --- Rome ---
  rome: { latitude: 41.9028, longitude: 12.4964 },
  "campo marzio": { latitude: 41.905, longitude: 12.476 },
  "piazza navona": { latitude: 41.8992, longitude: 12.4731 },
  "palazzo massimo alle terme": { latitude: 41.902, longitude: 12.498 },
  "galleria borghese": { latitude: 41.9142, longitude: 12.4922 },
  "capitoline museums": { latitude: 41.8931, longitude: 12.4828 },
  "ostia antica": { latitude: 41.755, longitude: 12.2919 },
  testaccio: { latitude: 41.8764, longitude: 12.475 },

  // --- Vienna to Trieste ---
  vienna: { latitude: 48.2082, longitude: 16.3738 },
  "wien hauptbahnhof": { latitude: 48.1852, longitude: 16.3766 },
  "innere stadt": { latitude: 48.2083, longitude: 16.3731 },
  "kunsthistorisches museum": { latitude: 48.2035, longitude: 16.3614 },
  naschmarkt: { latitude: 48.1986, longitude: 16.3625 },
  "graz hauptbahnhof": { latitude: 47.0725, longitude: 15.4161 },
  ljubljana: { latitude: 46.0569, longitude: 14.5058 },
  "ljubljana bus station": { latitude: 46.0583, longitude: 14.5108 },
  "lake bled": { latitude: 46.3625, longitude: 14.0936 },
  trieste: { latitude: 45.6495, longitude: 13.7768 },
  "castello di miramare": { latitude: 45.7022, longitude: 13.7122 },
  carso: { latitude: 45.7167, longitude: 13.75 },

  // --- Where the parties start from, and the beach week ---
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  ottawa: { latitude: 45.4215, longitude: -75.6972 },
  halifax: { latitude: 44.6488, longitude: -63.5752 },
  "riviera maya": { latitude: 20.6296, longitude: -87.0739 },
  "punta cana": { latitude: 18.582, longitude: -68.4055 },
});

export const FIXTURE_PLACES: ReadonlyMap<string, Coordinates> = new Map(
  Object.entries(FIXTURE_PLACE_TABLE),
);

// ---------------------------------------------------------------------------
// The legs
// ---------------------------------------------------------------------------

export interface FixtureLeg {
  distanceMeters: number;
  durationMinutes: number;
}

/**
 * Driving figures for the legs the candidate sets actually propose.
 *
 * **Declared once per pair and expanded both ways** by `FIXTURE_DRIVING` below.
 * That is an assumption — the fixture asserts driving is symmetric — and it is
 * stated here rather than hidden because *a real backend must not make it*:
 * one-way systems, ferries with a timetable in one direction, and seasonal
 * road closures are all reasons A→B and B→A differ. It holds well enough for
 * eleven highway legs on a table nobody is measuring anything against.
 *
 * The park's walking legs are **absent on purpose**. `Gîte du Mont-Albert` to
 * `Refuge Le Carouge` is seven hours over a plateau and there is no road; the
 * only mode this seam has today is `driving`, and the honest answer for a
 * driving distance along a hiking trail is `null`. That pair is the worked
 * example of a cell that exists, is asked for, and has no answer.
 */
const FIXTURE_LEG_PAIRS: readonly (readonly [string, string, FixtureLeg])[] = [
  // The road trip, split as the specialist split it.
  ["montreal", "quebec city", { distanceMeters: 255_000, durationMinutes: 165 }],
  ["quebec city", "rimouski", { distanceMeters: 315_000, durationMinutes: 200 }],
  ["rimouski", "sainte-anne-des-monts", { distanceMeters: 230_000, durationMinutes: 175 }],
  ["sainte-anne-des-monts", "perce", { distanceMeters: 240_000, durationMinutes: 185 }],

  // The drive in to the backcountry set's trailhead.
  ["quebec city", "gite du mont-albert", { distanceMeters: 430_000, durationMinutes: 300 }],

  // The Lac-Saint-Jean loop.
  ["saguenay", "alma", { distanceMeters: 65_000, durationMinutes: 50 }],
  ["alma", "saint-felicien", { distanceMeters: 82_000, durationMinutes: 60 }],
  ["saint-felicien", "saguenay", { distanceMeters: 125_000, durationMinutes: 95 }],

  // Vienna to Trieste. Proposed as rail and bus legs; these are the road
  // figures for the same pairs, which is what a `driving` matrix is asked for.
  ["wien hauptbahnhof", "graz hauptbahnhof", { distanceMeters: 200_000, durationMinutes: 145 }],
  ["graz hauptbahnhof", "ljubljana", { distanceMeters: 190_000, durationMinutes: 140 }],
  ["ljubljana bus station", "trieste", { distanceMeters: 95_000, durationMinutes: 85 }],
];

/**
 * An escaped NUL between the ends, because a normalised place key may contain
 * spaces and hyphens and either would let one pair collide with another —
 * `"quebec city"` + `"rimouski"` and `"quebec"` + `"city rimouski"` are the
 * same string once a space joins them. Nothing that survives `placeKey` can
 * contain a NUL, so nothing can forge a key.
 */
export function legKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** Both directions of every pair above, built once at load. */
export const FIXTURE_DRIVING: ReadonlyMap<string, FixtureLeg> = new Map(
  FIXTURE_LEG_PAIRS.flatMap(([from, to, leg]) => [
    [legKey(from, to), leg] as const,
    [legKey(to, from), leg] as const,
  ]),
);
