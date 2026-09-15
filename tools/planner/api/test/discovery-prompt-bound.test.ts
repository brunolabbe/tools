/**
 * The `activities` prompt, rendered over what the discovery pass actually
 * hands it — pl-41's own "Done when": a stated character ceiling, derived
 * from `MAX_DISCOVERY_FINDS`, never a number copied out of a reproduction
 * script.
 *
 * **The ceiling is measured from the real corpus, not from the per-field
 * caps `agent/src/grounding.ts` enforces.** The first version of this test
 * used `MAX_FIND_NAME_CHARS` × `MAX_FIND_TAGS` × `MAX_FIND_TAG_CHARS` to build
 * a theoretical worst case, and the gate found it budgeted ≈20,880 chars a
 * find against a real one's ≈174–281 — a ceiling 120x too loose to move when
 * the cap did, which the gate showed three ways: deleting the cap only broke
 * an unrelated length assertion earlier in the test, restoring that assertion
 * and setting the cap to 400 still passed, and only a second, separately
 * typed magic number (`* 1_000`) ever went red. The ceiling below is instead
 * `MAX_DISCOVERY_FINDS` times the single largest per-find contribution
 * actually measured across all 276 real finds — smaller than any theoretical
 * per-field bound, and it moves with the cap because it is multiplied by the
 * same constant the cap is, so removing the cap (rendering all 276) exceeds
 * it: see the test's own final assertion.
 *
 * Everything here is offline: the real Overpass capture
 * `grounding-valhalla.test.ts` also uses, parsed through the real adapter with
 * a stubbed `fetch`, then handed through the real discovery pass, then handed
 * to the real `systemPrompt`. No socket, no model.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { emptyBrief, isAnswered, slot } from "@planner/contract";
import type { TripBrief } from "@planner/contract";
import { dayCapacity, tripSpan } from "@planner/itinerary";
import { systemPrompt } from "@planner/agent";
import type { Find, TripCapacity } from "@planner/agent";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { answered, UNKNOWN, type RunGrounding } from "../src/grounding/cache.ts";
import { ValhallaGroundingProvider } from "../src/grounding/valhalla.ts";
import { createLogger } from "../src/logger.ts";
import { discoverAlongCorridor, MAX_DISCOVERY_FINDS } from "../src/runs/discovery.ts";

const logger = createLogger({ level: "silent" });
const MONTREAL = { latitude: 45.5019, longitude: -73.5674 };
const QUEBEC_CITY = { latitude: 46.8139, longitude: -71.208 };

function overpassFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

/** The real Montréal→Québec City capture, parsed through the real adapter — every find, uncapped. */
async function realFinds(): Promise<Find[]> {
  const body = overpassFixture("overpass-nearby.json");
  const fetchStub = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;

  const realProvider = new ValhallaGroundingProvider({
    routingUrl: "http://valhalla.internal:8002",
    geocoderUrl: "http://nominatim.internal:8080",
    overpassUrl: "http://overpass.internal:8090",
    timeoutMs: 5_000,
    now: () => new Date("2027-01-01T00:00:00.000Z"),
    fetch: fetchStub,
  });

  return realProvider.nearby({
    corridor: [MONTREAL, QUEBEC_CITY],
    radiusMetres: 6_000,
    kinds: ["viewpoint", "waterfall", "attraction", "historic-site"],
  });
}

/**
 * The discovery pass's own answer over a given find list, run end to end —
 * notability, rank, cap, detour — so what this file measures is exactly what
 * `runFanOut` would have received. Takes the finds rather than re-parsing the
 * capture, so the same list can be handed through both capped and uncapped.
 */
async function discovered(finds: readonly Find[]) {
  const grounding: RunGrounding = {
    name: "test",
    refused: 0,
    locate: async (request) =>
      answered({
        coordinates: request.place.name === "Montréal" ? MONTREAL : QUEBEC_CITY,
        source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
      }),
    nearby: async () => answered([...finds]),
    articlesNear: async () => answered([]),
    travel: async (request) => request.origins.map(() => request.destinations.map(() => UNKNOWN)),
  };

  const result = await discoverAlongCorridor({
    brief: {
      ...emptyBrief(),
      origin: slot.answered("Montréal"),
      destination: slot.answered("Québec City"),
    },
    provider: grounding,
    logger,
    signal: new AbortController().signal,
    onProgress: () => {},
  });

  return result.finds;
}

function capacityOf(brief: TripBrief): TripCapacity {
  if (!isAnswered(brief.dates)) throw new Error("this fixture has no dates");
  return { dayCount: tripSpan(brief.dates.value).dayCount, ...dayCapacity(brief) };
}

describe("the activities prompt, over the real corridor capped to MAX_DISCOVERY_FINDS (pl-41)", () => {
  test("stays under a ceiling measured from the real corpus and derived from the cap, and an uncapped render exceeds it", async () => {
    const rawFinds = await realFinds();
    const capped = await discovered(rawFinds);
    expect(capped).toHaveLength(MAX_DISCOVERY_FINDS);

    const roadTrip = loadFixture("road-trip").brief;
    const capacity = capacityOf(roadTrip);
    const promptWith = (finds: readonly Find[]): string =>
      systemPrompt({
        specialist: "activities",
        brief: roadTrip,
        shape: "road-trip",
        capacity,
        finds,
      });

    const baseline = promptWith([]).length;

    // The largest whole one-find discovery block measured anywhere in the
    // real 276-find corpus — not a theoretical per-field maximum, which the
    // gate found was 120x too loose to ever move when the cap did. This is
    // not one find's own line: it is the header, the footer and the joining
    // newlines that render once around it too (measured ≈388 of the ≈1,028
    // chars this budgets per find on the current capture), so multiplying it
    // by the cap is looser than the tightest possible bound — a real 41-find
    // render would not add another full header and footer. It is still tight
    // enough to move when the cap does: this ceiling fails when the cap is
    // removed, and again if the cap is raised past the point (≈46 on this
    // capture) where 40 of these blocks would have covered the real growth.
    let maxSingleFindChars = 0;
    for (const find of rawFinds) {
      const solo = promptWith([find]).length - baseline;
      if (solo > maxSingleFindChars) maxSingleFindChars = solo;
    }
    expect(maxSingleFindChars).toBeGreaterThan(0);

    const ceiling = baseline + MAX_DISCOVERY_FINDS * maxSingleFindChars;
    const cappedPrompt = promptWith(capped);

    expect(cappedPrompt.length).toBeGreaterThan(baseline);
    expect(cappedPrompt.length).toBeLessThanOrEqual(ceiling);

    // The ceiling moves with the cap rather than sitting so far above real
    // growth that nothing could ever reach it: rendering every one of the
    // 276 raw finds — the corridor with the cap effectively removed — must
    // exceed it. This is the assertion the gate's reproduction showed the
    // previous ceiling could not fail even with the cap deleted; this one
    // must.
    const uncappedPrompt = promptWith(rawFinds);
    expect(uncappedPrompt.length).toBeGreaterThan(ceiling);
  });
});
