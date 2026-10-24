/**
 * The offline town-capture stub `api/test/live/run.ts` answers the town pass
 * from (pl-62, Build 9, `Done when` 13).
 *
 * pl-60's stub picked a reply by the query's point alone and answered
 * `{ elements: [] }` for a point it did not know, so the food query pl-62 adds,
 * at the same point, would have been answered with the lodging reply and handed
 * `food` nothing, without an error, in every set B to D record of the paid run.
 * The stub now routes by the query's kinds as well as its point, and throws on a
 * query no capture answers. Offline: nothing here reaches a network.
 */

import { describe, expect, test } from "vitest";
import { FOOD_KINDS, LODGING_KINDS } from "@planner/agent";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { overpassPointQuery } from "../src/grounding/valhalla.ts";
import type { AppLogger } from "../src/logger.ts";
import { readTownCapture, townCaptureFetch, townFinds } from "./live/run.ts";

const silent: AppLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

const LODGING = readTownCapture("overpass-lodging-towns.json");
const FOOD = readTownCapture("overpass-food-towns.json");

function town(capture: typeof LODGING, locality: string): (typeof LODGING.towns)[number] {
  const found = capture.towns.find((each) => each.locality === locality);
  if (found === undefined) throw new Error(`no capture for ${locality}`);
  return found;
}

/** POST `query` to the stub the way the adapter does, and read the reply back. */
async function ask(fetch: typeof globalThis.fetch, query: string): Promise<unknown> {
  const response = await fetch("http://overpass.invalid/interpreter", {
    method: "POST",
    body: query,
  });
  return await response.json();
}

describe("the offline town-capture stub (pl-62, Done when 13)", () => {
  test("a lodging query is answered with the lodging capture's reply for that town", async () => {
    const { fetch, unmatched } = townCaptureFetch({ lodging: LODGING, food: FOOD });
    const perce = town(LODGING, "Percé");

    expect(await ask(fetch, overpassPointQuery(perce.point, 10_000, LODGING_KINDS, 28))).toEqual(
      perce.reply,
    );
    expect(unmatched).toEqual([]);
  });

  test("a food query at the same point is answered with the food capture's reply", async () => {
    const { fetch, unmatched } = townCaptureFetch({ lodging: LODGING, food: FOOD });
    const perce = town(FOOD, "Percé");
    expect(perce.point).toEqual(town(LODGING, "Percé").point);

    const reply = await ask(fetch, overpassPointQuery(perce.point, 10_000, FOOD_KINDS, 28));

    expect(reply).toEqual(perce.reply);
    expect(reply).not.toEqual(town(LODGING, "Percé").reply);
    expect(unmatched).toEqual([]);
  });

  test("a query matching neither capture throws, and is recorded, rather than answering an empty reply", async () => {
    const { fetch, unmatched } = townCaptureFetch({ lodging: LODGING, food: FOOD });
    const nowhere = overpassPointQuery(
      { latitude: 45.5, longitude: -73.57 },
      10_000,
      FOOD_KINDS,
      28,
    );
    // A query with both categories is not one either capture answers (Decision 3 (a)).
    const both = overpassPointQuery(
      town(FOOD, "Percé").point,
      10_000,
      [...LODGING_KINDS, ...FOOD_KINDS],
      28,
    );

    await expect(ask(fetch, nowhere)).rejects.toThrow(/no reply for this query/);
    await expect(ask(fetch, both)).rejects.toThrow(/no reply for this query/);
    expect(unmatched).toEqual([nowhere, both]);
  });

  test("road-trip's offline town finds hand food its places to eat and lodging its places to stay", async () => {
    const finds = await townFinds(loadFixture("road-trip").brief, silent);
    const food = finds.filter((find) => (FOOD_KINDS as readonly string[]).includes(find.kind));
    const lodging = finds.filter((find) =>
      (LODGING_KINDS as readonly string[]).includes(find.kind),
    );

    // Percé Rock stands in Percé (23 within 10 km, the closest ten kept) and
    // Forillon National Park has 2; Gaspésie, the peninsula, has none.
    expect(food).toHaveLength(12);
    // pl-60's twenty: ten each for Percé and Forillon National Park.
    expect(lodging).toHaveLength(20);
    expect(food.length + lodging.length).toBe(finds.length);
  });

  test("townFinds throws after the pass when a town query had no reply, rather than handing food an empty list", async () => {
    // Percé's food reply missing: the adapter turns the stub's throw into a
    // failed query and the pass into "nothing on the map", so only the check
    // after the pass makes the run fail (pl-62's gate 1, finding 1).
    const food = { towns: FOOD.towns.filter((each) => each.locality !== "Percé") };

    await expect(
      townFinds(loadFixture("road-trip").brief, silent, { lodging: LODGING, food }),
    ).rejects.toThrow("the offline town capture had no reply for 1 town query");
  });
});
