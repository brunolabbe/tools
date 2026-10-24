/**
 * The town pass (pl-60), in a real run, for each of pl-58's six set A briefs.
 *
 * A run starts from an intake and an intake's brief is whatever its answers
 * build, so `readIntake` is mocked to hand `startRun` the checked-in brief —
 * `helpers/fixture-briefs.ts` says why — and everything after it is real: the
 * queue, both discovery passes, the scripted fan-out, measuring, composing and
 * the stored revision, read back over HTTP.
 *
 * Two of pl-60's `Done when` lines are here:
 *
 * - **The days do not move.** With the fixture grounding default, whose town
 *   query finds nothing, each shape's draft days are byte-identical to the ones
 *   the base commit drafted (`fixtures/pl60-base-days.json`, written at
 *   `8a6dcf9a`'s source before anything under `src` changed), and the plan
 *   carries the coverage note the owner's fallback answer relies on.
 * - **The calls are counted.** Each shape spends the grounding calls pl-60's
 *   Log asserts, by seam method, so a town query is told apart from a corridor
 *   query by the method it went through — the shape the owner chose for Build 2.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import {
  latestRevision,
  planUrl,
  TRIP_SHAPES,
  type PlanRevision,
  type PlanView,
  type TripShape,
} from "@planner/contract";
import type {
  Find,
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  NearbyArticle,
  NearbyPointRequest,
  NearbyRequest,
  NotabilityRequest,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import type * as IntakeState from "../src/intakes/state.ts";
import { FIXTURE_BRIEFS } from "./helpers/fixture-briefs.ts";
import {
  createRunHarness,
  intakeReadyToDraft,
  NOW,
  runToCompletion,
  startRunOver,
} from "./helpers/runs.ts";

vi.mock("../src/intakes/state.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof IntakeState>();
  const { withFixtureBrief } = await import("./helpers/fixture-briefs.ts");
  return { ...actual, readIntake: withFixtureBrief(actual.readIntake) };
});

const BASE = JSON.parse(
  readFileSync(new URL("./fixtures/pl60-base-days.json", import.meta.url), "utf8"),
) as { sha: string; shapes: Record<TripShape, { days: unknown }> };

/** The fixture default, with every call that reaches it counted by method. */
class CountingGrounding implements GroundingProvider {
  readonly name = "counting";
  readonly #inner = new FixtureGroundingProvider(() => NOW);
  readonly calls = { locate: 0, travel: 0, nearby: 0, nearbyPoint: 0, articlesNear: 0 };
  /** Every name `locate` was asked, in order, so the Log can say which pass asked which. */
  readonly located: string[] = [];

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    this.calls.locate += 1;
    this.located.push(request.place.name);
    return await this.#inner.locate(request);
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    this.calls.travel += 1;
    return await this.#inner.travel(request);
  }

  async nearby(request: NearbyRequest): Promise<Find[]> {
    this.calls.nearby += 1;
    return await this.#inner.nearby(request);
  }

  async nearbyPoint(request: NearbyPointRequest): Promise<Find[]> {
    this.calls.nearbyPoint += 1;
    return await this.#inner.nearbyPoint(request);
  }

  async articlesNear(request: NotabilityRequest): Promise<NearbyArticle[]> {
    this.calls.articlesNear += 1;
    return await this.#inner.articlesNear(request);
  }
}

/** Draft one checked-in brief through a real run and read its revision back. */
async function draftShape(
  shape: TripShape,
  grounding?: GroundingProvider,
): Promise<{ revision: PlanRevision; runId: string; planId: string }> {
  const harness = await createRunHarness(grounding === undefined ? {} : { grounding });
  try {
    const intakeId = await intakeReadyToDraft(harness.app, shape);
    FIXTURE_BRIEFS.set(intakeId, loadFixture(shape).brief);
    const run = await startRunOver(harness.app, intakeId);
    expect((await runToCompletion(harness.app, run.id)).status).toBe("done");
    const response = await harness.app.server.inject({ method: "GET", url: planUrl(run.planId) });
    const revision = latestRevision(response.json<PlanView>().plan);
    if (revision === null) throw new Error(`${shape}: the run left no revision`);
    return { revision, runId: run.id, planId: run.planId };
  } finally {
    await harness.close();
  }
}

const UNLOCATED_ENDS =
  "Where this trip starts or ends could not be found on the map, so nothing nearby along the way could be checked.";
const THIN_CORRIDOR =
  "There is very little on the map along this route. Something worth stopping for may exist without this plan ever finding it.";
const NO_TOWN =
  "This trip names no town to stay in, so the map was not checked for places to stay.";

/**
 * Each shape's whole `coverage` list on the fixture default: the corridor
 * pass's entry as the base commit wrote it, then the town pass's. The fixture
 * gazetteer knows `Gaspésie`, `Forillon National Park`, `Parc national de la
 * Gaspésie`, `Rome`, `Vienna`, `Ljubljana` and `Trieste`, and not `Percé Rock`
 * or `Central Europe`; its town query finds nothing anywhere.
 */
const COVERAGE: Record<TripShape, string[]> = {
  "road-trip": [
    UNLOCATED_ENDS,
    "Where Percé Rock is could not be found on the map, so places to stay there were not checked.",
    "No places to stay around Forillon National Park and Gaspésie are on the map. Somewhere to stay there may exist without this plan having found it.",
  ],
  backcountry: [
    THIN_CORRIDOR,
    "No places to stay around Parc national de la Gaspésie are on the map. Somewhere to stay there may exist without this plan having found it.",
  ],
  "motorised-touring": [NO_TOWN],
  "city-and-culture": [
    THIN_CORRIDOR,
    "No places to stay around Rome are on the map. Somewhere to stay there may exist without this plan having found it.",
  ],
  resort: [NO_TOWN],
  "multi-city": [
    UNLOCATED_ENDS,
    "Where Central Europe is could not be found on the map, so places to stay there were not checked.",
    "No places to stay around Vienna, Ljubljana and Trieste are on the map. Somewhere to stay there may exist without this plan having found it.",
  ],
};

describe("the six set A drafts with the town pass, on the fixture default (pl-60)", () => {
  test.each(TRIP_SHAPES)(
    "%s: the days are byte-identical to the base commit's, and the plan names the towns it could not check",
    async (shape) => {
      const { revision, runId, planId } = await draftShape(shape);
      const days = JSON.stringify(revision.days)
        .replaceAll(runId, "<run>")
        .replaceAll(planId, "<plan>");

      expect(days).toBe(JSON.stringify(BASE.shapes[shape].days));
      expect(revision.coverage.map((entry) => entry.detail)).toEqual(COVERAGE[shape]);
    },
  );
});

/**
 * Calls by method for each shape's draft, on the fixture default, and the
 * names the town pass itself asked `locate` — pl-60's Log argues each row.
 *
 * The town pass's own calls are its `nearbyPoint`s plus the `locate`s in
 * `town`: a name the corridor pass already located is a cache hit and reaches
 * nothing (`Gaspésie`, `Parc national de la Gaspésie`, `Rome`), and a name
 * nobody could locate is not cached, so asking it again is a call
 * (`Central Europe`). Everything else is the base commit's spending.
 */
const CALLS: Record<
  TripShape,
  {
    calls: {
      locate: number;
      travel: number;
      nearby: number;
      nearbyPoint: number;
      articlesNear: number;
    };
    town: string[];
  }
> = {
  "road-trip": {
    calls: { locate: 15, travel: 1, nearby: 0, nearbyPoint: 2, articlesNear: 0 },
    town: ["Percé Rock", "Forillon National Park"],
  },
  backcountry: {
    calls: { locate: 9, travel: 1, nearby: 1, nearbyPoint: 1, articlesNear: 0 },
    town: [],
  },
  "motorised-touring": {
    calls: { locate: 5, travel: 1, nearby: 0, nearbyPoint: 0, articlesNear: 0 },
    town: [],
  },
  "city-and-culture": {
    calls: { locate: 11, travel: 1, nearby: 1, nearbyPoint: 1, articlesNear: 0 },
    town: [],
  },
  resort: {
    calls: { locate: 3, travel: 1, nearby: 0, nearbyPoint: 0, articlesNear: 0 },
    town: [],
  },
  "multi-city": {
    calls: { locate: 19, travel: 1, nearby: 0, nearbyPoint: 3, articlesNear: 0 },
    town: ["Vienna", "Ljubljana", "Trieste", "Central Europe"],
  },
};

describe("grounding calls per set A shape, with the town pass (pl-60)", () => {
  test.each(TRIP_SHAPES)("%s spends the calls pl-60's Log asserts", async (shape) => {
    const grounding = new CountingGrounding();
    await draftShape(shape, grounding);

    expect(grounding.calls).toEqual(CALLS[shape].calls);
    // The town pass's `locate`s come right after the corridor pass's, before
    // anything the fan-out proposed is measured: the brief's own two ends
    // first, when it has a corridor, then the towns that missed the cache.
    const ends = shape === "motorised-touring" || shape === "resort" ? 0 : 2;
    expect(grounding.located.slice(ends, ends + CALLS[shape].town.length)).toEqual(
      CALLS[shape].town,
    );
  });
});
