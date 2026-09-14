/**
 * The `activities` prompt, rendered over what the discovery pass actually
 * hands it — pl-41's own "Done when": a stated character ceiling, derived
 * from `MAX_DISCOVERY_FINDS` and the per-find field limits
 * `agent/src/grounding.ts` already enforces, never a number copied out of a
 * reproduction script.
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
import {
  MAX_FIND_NAME_CHARS,
  MAX_FIND_TAGS,
  MAX_FIND_TAG_CHARS,
  systemPrompt,
} from "@planner/agent";
import type { TripCapacity } from "@planner/agent";
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

/**
 * The discovery pass's own answer for the real Montréal→Québec City capture,
 * run end to end — parse, notability, rank, cap, detour — so what this file
 * measures is exactly what `runFanOut` would have received.
 */
async function realCappedFinds() {
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

  const finds = await realProvider.nearby({
    corridor: [MONTREAL, QUEBEC_CITY],
    radiusMetres: 6_000,
    kinds: ["viewpoint", "waterfall", "attraction", "historic-site"],
  });

  const grounding: RunGrounding = {
    name: "test",
    refused: 0,
    locate: async (request) =>
      answered({
        coordinates: request.place.name === "Montréal" ? MONTREAL : QUEBEC_CITY,
        source: { url: "x", title: null, fetchedAt: "2027-01-01T00:00:00.000Z" },
      }),
    nearby: async () => answered(finds),
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
  test("stays under a ceiling derived from the cap and the field limits, never a copied character count", async () => {
    const finds = await realCappedFinds();
    expect(finds).toHaveLength(MAX_DISCOVERY_FINDS);

    const roadTrip = loadFixture("road-trip").brief;
    const capacity = capacityOf(roadTrip);

    const prompt = systemPrompt({
      specialist: "activities",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
      finds,
    });

    // The longest one line of the discovery block can be, from documented
    // per-field caps rather than measured content — this is a ceiling, not a
    // prediction, so it is deliberately generous:
    //   - a name up to `MAX_FIND_NAME_CHARS`;
    //   - up to `MAX_FIND_TAGS` tags, each up to `MAX_FIND_TAG_CHARS` for its
    //     key and again for its value, joined by `=` and `, `;
    //   - a fixed budget for the kind, the two coordinates and the
    //     surrounding connective text (`- "…" (…) at …, … — tags: …`) and the
    //     "has independent editorial coverage" suffix — none of these is
    //     bounded by a named constant, so 200 is a round, generous stand-in
    //     for all of them together rather than a measurement of any one.
    const worstCaseTagsChars = MAX_FIND_TAGS * (MAX_FIND_TAG_CHARS * 2 + 2);
    const worstCasePerFindChars = MAX_FIND_NAME_CHARS + worstCaseTagsChars + 200;

    const baseline = systemPrompt({
      specialist: "activities",
      brief: roadTrip,
      shape: "road-trip",
      capacity,
      finds: [],
    });
    const ceiling = baseline.length + MAX_DISCOVERY_FINDS * worstCasePerFindChars;

    expect(prompt.length).toBeLessThanOrEqual(ceiling);
    // The ceiling is not vacuous: a real corridor's actual growth is nowhere
    // near this worst case (pl-41's reproduction measured ≈43 tokens, ≈172
    // chars, per find), so this also checks the bound is not so loose it
    // could never fail — it is orders of magnitude below the worst case and
    // still clearly attributable to the cap rather than to nothing at all.
    expect(prompt.length).toBeGreaterThan(baseline.length);
    expect(prompt.length).toBeLessThan(baseline.length + MAX_DISCOVERY_FINDS * 1_000);
  });
});
