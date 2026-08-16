/**
 * The acceptance test the ticket exists for: **the candidates a specialist
 * returns are placeable.**
 *
 * [pl-9](../../docs/work/pl-9-composer-and-critic.md) composed pl-4's six
 * checked-in candidate sets on 2026-08-16 and found that the route candidates
 * are routinely over the day's drive budget — the road-trip set proposes a
 * 5½-hour leg to a party who answered `half-day` — so the composer drops every
 * one of them and a road trip comes out with no drives in it and a
 * `no-candidates-found` gap where its route should be.
 *
 * The composer is right to refuse them. The fix is upstream, and this is the
 * assertion that says whether it landed: for every checked-in brief, running the
 * real fan-out and composing its output must put **at least one candidate from
 * every rostered schedulable specialist onto a day** — or the test names the one
 * it dropped and why.
 *
 * It is cheap because both halves are pure: the scripted provider answers from a
 * table and the composer has no clock, so this is arithmetic over checked-in
 * content and nothing here waits on a network.
 *
 * `@planner/itinerary` is a devDependency for this file and `helpers.ts` alone.
 * No production file in this package imports it — the fan-out takes its ceilings
 * as an argument, which is what keeps the day's length decided in exactly one
 * place.
 */

import { describe, expect, test } from "vitest";
import { TRIP_SHAPES } from "@planner/contract";
import type { Specialist } from "@planner/contract";
import { BUCKET_OF, compose } from "@planner/itinerary";
import { loadFixture } from "../../contract/test/fixtures.ts";
import {
  CANDIDATE_LIMIT_OF,
  DEFAULT_RUN_BUDGET,
  runFanOut,
  ScriptedProvider,
} from "../src/index.ts";
import { capacityOf } from "./helpers.ts";

/**
 * Well before the earliest departure in the fixture set, so nothing is dropped
 * for a booking deadline that has already passed. A fixed date rather than a
 * clock: this package has none, and neither does the composer.
 */
const NOW = new Date("2026-09-01T00:00:00.000Z");

async function planFor(shape: (typeof TRIP_SHAPES)[number]) {
  const { brief } = loadFixture(shape);
  const fanOut = await runFanOut({
    brief,
    capacity: capacityOf(brief),
    provider: new ScriptedProvider(),
    budget: DEFAULT_RUN_BUDGET,
    runId: `run-${shape}`,
  });

  const composed = compose({
    brief,
    candidates: fanOut.candidates,
    gaps: fanOut.gaps,
    revision: { id: `rev-${shape}`, reason: "First draft", createdAt: NOW.toISOString() },
    now: NOW,
  });

  return { brief, fanOut, composed };
}

/** The specialists on this roster whose output the packer puts on a day at all. */
function schedulable(ran: readonly { specialist: Specialist }[]): Specialist[] {
  return ran
    .map((entry) => entry.specialist)
    .filter((specialist) => BUCKET_OF[specialist] !== "unscheduled");
}

describe.each(TRIP_SHAPES)("the %s fan-out, composed", (shape) => {
  test("places at least one candidate from every rostered schedulable specialist", async () => {
    const { fanOut, composed } = await planFor(shape);

    const placed = new Set(
      composed.revision.days.flatMap((day) =>
        day.items.map(
          (item) =>
            fanOut.candidates.find((candidate) => candidate.id === item.candidateId)?.specialist,
        ),
      ),
    );

    for (const specialist of schedulable(fanOut.roster.ran)) {
      expect(placed, `${shape}: nothing from ${specialist} reached a day`).toContain(specialist);
    }
  });

  test("nothing the fan-out proposed was refused for being over the day", async () => {
    // The scripted answers are content, and this is the content review: a leg
    // written longer than the party's own answer allows is a leg to split, not
    // a number to work around.
    const { fanOut } = await planFor(shape);
    expect(fanOut.rejected).toEqual([]);
  });

  test("the plan ships, with the roster's gaps carried onto it untouched", async () => {
    const { fanOut, composed } = await planFor(shape);

    for (const gap of fanOut.gaps) expect(composed.revision.gaps).toContainEqual(gap);
    // Travel time is unchecked on every plan in Phase 2, and the fan-out does
    // not change that: a leg carries both its ends now and still has no
    // measured length.
    expect(composed.unchecked.map((entry) => entry.kind)).toContain("travel-time");
  });

  test("a route specialist that ran returned legs with both ends", async () => {
    const { fanOut } = await planFor(shape);
    const legs = fanOut.candidates.filter(
      (candidate) => candidate.specialist === "route-and-logistics",
    );

    if (!fanOut.roster.ran.some((entry) => entry.specialist === "route-and-logistics")) {
      expect(legs).toEqual([]);
      return;
    }
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) expect(leg.location.kind).toBe("between");
  });
});

describe("the two tables that must agree", () => {
  test("what a specialist may propose is bounded by the budget it is packed under", () => {
    // `CANDIDATE_LIMIT_OF` is `@planner/itinerary`'s `BUCKET_OF` seen from the
    // proposing side. They are separate so that `agent` does not depend on
    // `itinerary` in production, and this is the test that makes the drift loud.
    const expected: Record<string, "drive" | "activity" | "none"> = {
      drive: "drive",
      activity: "activity",
      anchor: "none",
      unscheduled: "none",
    };

    for (const [specialist, bucket] of Object.entries(BUCKET_OF)) {
      expect(CANDIDATE_LIMIT_OF[specialist as Specialist]).toBe(expected[bucket]);
    }
  });
});
