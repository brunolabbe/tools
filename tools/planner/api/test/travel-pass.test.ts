/**
 * The grounding pass, from the run that drives it to the plan it leaves behind.
 *
 * The claim pl-27 makes is not "a matrix was fetched" — it is that **a plan
 * says what it was packed against**, and keeps saying it. So everything below
 * reads the plan back over HTTP, out of the database, rather than off the
 * `compose` call that produced it: a measurement that lives only in the run
 * that made it is a measurement a reader never sees.
 *
 * The four states a deployment can actually be in each get a case: a backend
 * that answers, one that answers `null` for everything, one that throws, and
 * none at all.
 */

import { describe, expect, test } from "vitest";
import {
  latestRevision,
  measuredOrNull,
  planUrl,
  revisionItems,
  type Candidate,
  type PlanItem,
  type PlanView,
  type Place,
  type RunEvent,
} from "@planner/contract";
import { AppError } from "@planner/contract";
import type { GroundingProvider, TravelMatrix } from "@planner/agent";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import {
  createRunHarness,
  intakeReadyToDraft,
  NOW,
  runToCompletion,
  readEventStream,
  startRunOver,
  type RunHarness,
} from "./helpers/runs.ts";

async function readView(harness: RunHarness, planId: string): Promise<PlanView> {
  const response = await harness.app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanView>();
}

function itemsOf(view: PlanView): PlanItem[] {
  const revision = latestRevision(view.plan);
  if (revision === null) throw new Error("the plan has no revision");
  return revisionItems(revision);
}

function placesOf(candidate: Candidate): Place[] {
  const { location } = candidate;
  return location.kind === "at" ? [location.place] : [location.from, location.to];
}

/**
 * A shape whose plan has a transition the checked-in leg table can answer.
 *
 * It has to be named rather than assumed. The fixture leg table holds the legs
 * the six candidate sets *propose* — Montréal to Québec, Québec to Rimouski —
 * and a transition is a different question: from the end of one placed item to
 * the start of the next. `multi-city` is the shape whose days pair a route leg
 * with the lodging at its far end, so the pair is a place measured from itself
 * and the table has it. See pl-27's log: most fixture runs still name travel
 * time, honestly, because this backend genuinely does not hold those pairs.
 */
const MEASURABLE = "multi-city";

/**
 * A clock a test can move, so that "after the cache row expires" is a thing a
 * test can actually reach rather than a sentence in a comment.
 */
function movableClock(from: Date = NOW): {
  now: () => Date;
  advanceHours: (hours: number) => void;
} {
  let at = from;
  return {
    now: () => at,
    advanceHours: (hours) => {
      at = new Date(at.getTime() + hours * 3_600_000);
    },
  };
}

/**
 * A run driven to completion against whatever grounding the caller wants.
 *
 * `undefined` means **do not inject one**, which is not the same as "no
 * grounding": it takes the boot path a real deployment takes, so `createApp`
 * builds the default provider and wraps it in the cache. That is the branch
 * worth having a caller for — nothing else in the suite exercises it.
 */
async function draft(
  grounding?: GroundingProvider,
  shape = "road-trip",
  clock?: () => Date,
): Promise<{ harness: RunHarness; planId: string; runId: string }> {
  const harness = await createRunHarness({
    ...(grounding === undefined ? {} : { grounding }),
    ...(clock === undefined ? {} : { now: clock }),
  });
  const intakeId = await intakeReadyToDraft(harness.app, shape);
  const run = await startRunOver(harness.app, intakeId);
  const finished = await runToCompletion(harness.app, run.id);
  expect(finished.status).toBe("done");
  return { harness, planId: run.planId, runId: run.id };
}

/**
 * A plan's shape, as a comparison between two runs can actually use it.
 *
 * Day index, position **and** which candidate — the whole placement, not just
 * the order of the ids. The run's id prefixes every candidate id, so what is
 * compared is what each id says after it: the specialist that proposed the
 * thing, and its ordinal.
 */
function placementOf(view: PlanView): string[] {
  const revision = latestRevision(view.plan);
  if (revision === null) throw new Error("the plan has no revision");
  return revision.days.flatMap((day) =>
    day.items.map(
      (item) => `${String(day.dayIndex)}/${String(item.position)}/${item.candidateId.slice(37)}`,
    ),
  );
}

/** A backend that is up and knows nothing — the honest `null`, not a failure. */
class SilentGrounding implements GroundingProvider {
  readonly name = "silent";
  async locate(): Promise<null> {
    return null;
  }
  async travel(request: { origins: readonly Place[] }): Promise<TravelMatrix> {
    return request.origins.map(() => request.origins.map(() => null));
  }
}

/** A backend that is down. Every call throws, and the plan still has to ship. */
class BrokenGrounding implements GroundingProvider {
  readonly name = "broken";
  async locate(): Promise<never> {
    throw new AppError("UNREACHABLE", "the routing service refused the connection");
  }
  async travel(): Promise<never> {
    throw new AppError("UNREACHABLE", "the routing service refused the connection");
  }
}

describe("a run that grounds", () => {
  test("packs the days under measured transitions and stores what it measured", async () => {
    const { harness, planId } = await draft(new FixtureGroundingProvider(), MEASURABLE);
    try {
      const view = await readView(harness, planId);
      const items = itemsOf(view);

      const measured = items.flatMap((item) => {
        const travel = measuredOrNull(item.travelFromPrevious);
        return travel === null ? [] : [travel];
      });
      expect(measured.length).toBeGreaterThan(0);

      for (const travel of measured) {
        // A measurement with nothing behind it is the one thing `Provenance`
        // exists to make impossible.
        expect(travel.provenance.kind).toBe("grounded");
        expect(travel.distanceMeters).toBeGreaterThanOrEqual(0);
      }

      // And the rest are named facts rather than a bare absence: this run had
      // budget to spare, so nothing it could not measure is `over-budget`.
      const unanswered = items.filter((item) => measuredOrNull(item.travelFromPrevious) === null);
      for (const item of unanswered) {
        expect(item.travelFromPrevious?.kind ?? "not-established").toBe("not-established");
      }
    } finally {
      await harness.close();
    }
  });

  test("fills the coordinates that have been null since pl-4", async () => {
    const { harness, planId } = await draft(new FixtureGroundingProvider(), MEASURABLE);
    try {
      const view = await readView(harness, planId);
      const located = view.plan.candidates
        .flatMap(placesOf)
        .filter((place) => place.coordinates !== null);

      expect(located.length).toBeGreaterThan(0);
    } finally {
      await harness.close();
    }
  });

  test("moves through grounding and counts its lookups", async () => {
    const { harness, planId, runId } = await draft(new FixtureGroundingProvider(), MEASURABLE);
    try {
      expect(planId).not.toBe("");
      const frames = await readEventStream(harness.app, runId);
      const grounding = frames.filter(
        (frame): frame is Extract<RunEvent, { type: "progress" }> =>
          frame.type === "progress" && frame.progress.type === "grounding",
      );

      // The stream is not a replay log, so a run that finished before the
      // subscribe landed emits nothing — which is the common case against the
      // scripted provider. What must hold is that every frame it *did* emit
      // counts honestly.
      for (const frame of grounding) {
        if (frame.progress.type !== "grounding") continue;
        expect(frame.progress.done).toBeGreaterThan(0);
        expect(frame.progress.total).not.toBe(0);
      }
    } finally {
      await harness.close();
    }
  });

  /**
   * The storage decision from pl-27's step 1, proven rather than asserted.
   *
   * A cache row expires (pl-25) and a backend's numbers move. The plan's do
   * not: they are read back off the revision, and the `fetchedAt` they carry is
   * the moment they were actually read.
   */
  test("shows the same distances and the same fetchedAt after the cache row expires", async () => {
    const clock = movableClock();
    const ttlHours = 4_320;
    // No provider injected: `createGroundingProvider` builds the fixture one
    // and hands it this clock (pl-25), so the provider that stamps a `Source`
    // and the cache that ages it read the same time. Injecting one here would
    // have been a second clock to keep in step, and the whole point of this
    // case is that the plan does not depend on either of them.
    const { harness, planId } = await draft(undefined, MEASURABLE, clock.now);
    try {
      const first = itemsOf(await readView(harness, planId));
      const sources = first.flatMap((item) => {
        const provenance = measuredOrNull(item.travelFromPrevious)?.provenance;
        return provenance?.kind === "grounded" ? provenance.sources : [];
      });
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) expect(source.fetchedAt).toBe(NOW.toISOString());

      // Past the travel lifetime, so every row this run wrote has aged out and
      // a fresh lookup would now stamp a different `fetchedAt`. The plan does
      // not care, and that is the whole of pl-27's storage decision: the days
      // still follow from the numbers they were packed under.
      clock.advanceHours(ttlHours + 1);
      // And swept, which is what eviction does to a row past its deadline. The
      // strongest form of the claim: there is now nothing behind these numbers
      // except the revision itself.
      harness.app.context.db.exec("DELETE FROM grounding_cache");

      // The clock really did move as far as a lookup is concerned — without
      // this the case could pass against a provider whose timestamp never
      // changes, which is exactly what pl-24 shipped and pl-25 had to defuse.
      const fresh = await new FixtureGroundingProvider(clock.now).locate({
        place: { name: "Rimouski", locality: "Québec, Canada", coordinates: null },
      });
      // `not.toBe` passes for `null`, so the guard needs its own guard: rename
      // Rimouski in the gazetteer and the line below would silently stop
      // checking anything at all.
      expect(fresh).not.toBeNull();
      expect(fresh?.source.fetchedAt).not.toBe(NOW.toISOString());

      const second = itemsOf(await readView(harness, planId));
      expect(second.map((item) => item.travelFromPrevious)).toEqual(
        first.map((item) => item.travelFromPrevious),
      );
    } finally {
      await harness.close();
    }
  });
});

describe("a run that cannot ground", () => {
  test("a backend that knows nothing leaves the plan it would have had", async () => {
    const silent = await draft(new SilentGrounding(), MEASURABLE);
    // The boot default, wrapped in the cache, exactly as a deployment runs it.
    const answering = await draft(undefined, MEASURABLE);
    try {
      const measured = itemsOf(await readView(silent.harness, silent.planId));
      // Not one measurement, and not one refusal either: the backend was up and
      // simply had nothing to say, which is a fact with its own name.
      expect(measured.every((item) => measuredOrNull(item.travelFromPrevious) === null)).toBe(true);
      expect(measured.some((item) => item.travelFromPrevious?.kind === "over-budget")).toBe(false);

      // And the days are the same days a backend that *does* answer produced —
      // day index, position and candidate, not merely the order of the ids.
      const answeringView = await readView(answering.harness, answering.planId);
      expect(placementOf(await readView(silent.harness, silent.planId))).toEqual(
        placementOf(answeringView),
      );

      // **The premise, asserted, because without it the line above is
      // arithmetic rather than evidence.** Every transition this backend can
      // measure on a checked-in set is a place measured from *itself*: zero
      // minutes, into an anchor the day is not charged for either. So the two
      // plans agree because nothing was ever billed, not because the packer
      // handled a real number correctly — and the packer could double-charge or
      // invert the sign and this case would still pass. What proves a non-zero
      // transition changes a day is `itinerary/test/pack.test.ts`.
      //
      // The day a fixture leg makes a real transition reachable here, this goes
      // red and says the assumption moved.
      const billed = itemsOf(answeringView)
        .map((item) => measuredOrNull(item.travelFromPrevious))
        .filter((travel) => travel !== null);
      expect(billed.length).toBeGreaterThan(0);
      expect(billed.every((travel) => travel.durationMinutes === 0)).toBe(true);

      const view = await readView(silent.harness, silent.planId);
      expect(view.unchecked.map((each) => each.kind)).toContain("travel-time");
    } finally {
      await silent.harness.close();
      await answering.harness.close();
    }
  });

  /**
   * §9's ceiling, and the distinction pl-25's budget forces.
   *
   * A run that never asked must not tell a reader that nobody knows. With a
   * ceiling of zero the cache reaches its budgeted inner provider on the first
   * miss, is refused, and every transition on the plan is `over-budget` — a
   * different fact, a different sentence, and one whoever set the ceiling can
   * act on.
   */
  test("a spent budget says the lookups ran out, not that nobody knew", async () => {
    const harness = await createRunHarness({
      grounding: new FixtureGroundingProvider(),
      config: { maxGroundingCalls: 0 },
    });
    try {
      const intakeId = await intakeReadyToDraft(harness.app, MEASURABLE);
      const run = await startRunOver(harness.app, intakeId);
      expect((await runToCompletion(harness.app, run.id)).status).toBe("done");

      const view = await readView(harness, run.planId);
      const transitions = itemsOf(view).filter((item) => item.position > 0);
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions.every((item) => item.travelFromPrevious?.kind === "over-budget")).toBe(
        true,
      );

      const travel = view.unchecked.filter((each) => each.kind === "travel-time");
      const refused = travel.filter((each) =>
        each.detail.includes("number of lookups it is allowed"),
      );
      expect(refused).toHaveLength(1);
      expect(refused[0]?.candidateIds.length).toBeGreaterThan(0);
      // Nothing on this plan claims a distance was found and was not there.
      expect(travel.some((each) => each.detail.includes("Nothing could measure"))).toBe(false);
    } finally {
      await harness.close();
    }
  });

  /**
   * §7 and the repo's rule in one case: a backend being down is not an error
   * page. It is the Phase 2 plan, with the gap named.
   */
  test("a backend that throws still writes a revision, and the plan says so", async () => {
    const { harness, planId } = await draft(new BrokenGrounding());
    try {
      const view = await readView(harness, planId);
      expect(latestRevision(view.plan)).not.toBeNull();
      expect(itemsOf(view).length).toBeGreaterThan(0);

      const travel = view.unchecked.find((each) => each.kind === "travel-time");
      expect(travel?.detail).toContain("Nothing here measured a distance");
    } finally {
      await harness.close();
    }
  });
});
