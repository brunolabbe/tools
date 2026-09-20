/**
 * Editing a plan's dates and budget over HTTP (pl-47): the route's refusals,
 * the run, and every read of "the brief" following the edited one.
 *
 * Its own file rather than more of `revisions.test.ts`: that suite's lines are
 * cited by merged gate records, and a block inserted into it would move them.
 * The doubles are smaller for the same reason — this suite needs a count of
 * model requests, a record of what grounding heard, and a gate, and nothing
 * else of theirs.
 */

import { describe, expect, test, vi } from "vitest";
import type * as Itinerary from "@planner/itinerary";

vi.mock("@planner/itinerary", async (importOriginal) => {
  const actual = await importOriginal<typeof Itinerary>();
  return { ...actual, reviseBrief: vi.fn(actual.reviseBrief) };
});

import {
  latestRevision,
  planItemPinUrl,
  planRevisionsUrl,
  planUrl,
  slot,
  type Candidate,
  type ErrorResponse,
  type PlanDetail,
  type PlanRevision,
  type PlanView,
  type ReviseResponse,
  type Run,
  type TripBudget,
  type TripDates,
} from "@planner/contract";
import type {
  Find,
  GroundingProvider,
  LocatedPlace,
  LocateRequest,
  ModelProvider,
  ModelReply,
  ModelRequest,
  NearbyArticle,
  NearbyRequest,
  NotabilityRequest,
  TravelMatrix,
  TravelRequest,
} from "@planner/agent";
import { ScriptedProvider } from "@planner/agent";
import { briefEditSlice, replanPool, reviseBrief } from "@planner/itinerary";
import { selectPlan } from "../src/db/plans.ts";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import {
  createRunHarness,
  deferred,
  intakeReadyToDraft,
  NOW,
  readRunRow,
  runToCompletion,
  startRunOver,
  type Deferred,
  type RunHarness,
} from "./helpers/runs.ts";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** The fixture backend, recording every place it was asked about, with a gate. */
class GatedGrounding implements GroundingProvider {
  readonly name = "gated";
  readonly #inner = new FixtureGroundingProvider(() => NOW);
  readonly asked: string[] = [];
  gate: { open: Deferred; arrived: Deferred } | null = null;

  async #wait(): Promise<void> {
    const gate = this.gate;
    if (gate === null) return;
    gate.arrived.resolve();
    await gate.open.promise;
  }

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    this.asked.push(request.place.name);
    await this.#wait();
    return await this.#inner.locate(request);
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    this.asked.push(...request.origins.map((place) => place.name));
    this.asked.push(...request.destinations.map((place) => place.name));
    await this.#wait();
    return await this.#inner.travel(request);
  }

  async nearby(request: NearbyRequest): Promise<Find[]> {
    return await this.#inner.nearby(request);
  }

  async articlesNear(request: NotabilityRequest): Promise<NearbyArticle[]> {
    return await this.#inner.articlesNear(request);
  }
}

/** The scripted model, counting what it was sent. */
class CountingModel implements ModelProvider {
  readonly name = "counting";
  readonly model = "counting";
  readonly #inner = new ScriptedProvider();
  sent = 0;

  async send(request: ModelRequest): Promise<ModelReply> {
    this.sent += 1;
    return await this.#inner.send(request);
  }
}

interface Fixture {
  harness: RunHarness;
  model: CountingModel;
  grounding: GatedGrounding;
  close(): Promise<void>;
}

async function fixture(config: { rateLimitRunsPerMinute?: number } = {}): Promise<Fixture> {
  const model = new CountingModel();
  const grounding = new GatedGrounding();
  const harness = await createRunHarness({
    model,
    grounding,
    config: {
      rateLimitRunsPerMinute: 0,
      rateLimitEditsPerMinute: 0,
      groundingCacheTtlHours: { locate: 0, travel: 0 },
      ...config,
    },
  });
  return { harness, model, grounding, close: () => harness.close() };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** What `answerFor` answers the dates question with: `open`, five nights. */
const DRAFTED: TripDates = { kind: "open", nights: 5 };
/** A band, which the draft does not have: its budget question is not asked before a draft. */
const BAND: TripBudget = { kind: "band", band: "moderate" };
const AMOUNT: TripBudget = { kind: "amount", currency: "CAD", amount: 100_000, basis: "total" };

async function readView(harness: RunHarness, planId: string): Promise<PlanView> {
  const response = await harness.app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanView>();
}

function latestOf(plan: PlanDetail): PlanRevision {
  const revision = latestRevision(plan);
  if (revision === null) throw new Error("the plan has no revision");
  return revision;
}

/** A finished first draft, with every record of it cleared. */
async function draft(f: Fixture): Promise<PlanView> {
  const intakeId = await intakeReadyToDraft(f.harness.app);
  const run = await startRunOver(f.harness.app, intakeId);
  expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
  const view = await readView(f.harness, run.planId);
  expect(latestOf(view.plan).brief.dates).toEqual(slot.answered(DRAFTED));
  expect(latestOf(view.plan).brief.budget).toEqual(slot.unknown());
  vi.clearAllMocks();
  f.model.sent = 0;
  f.grounding.asked.length = 0;
  return view;
}

async function edit(
  harness: RunHarness,
  planId: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; json: ReviseResponse & ErrorResponse }> {
  const response = await harness.app.server.inject({
    method: "POST",
    url: planRevisionsUrl(planId),
    payload: { kind: "brief", ...body },
  });
  return { statusCode: response.statusCode, json: response.json<ReviseResponse & ErrorResponse>() };
}

async function editRun(f: Fixture, planId: string, body: Record<string, unknown>): Promise<Run> {
  const response = await edit(f.harness, planId, body);
  expect(response.statusCode).toBe(202);
  if (response.json.kind !== "run") throw new Error("a brief edit answered without a run");
  return response.json.run;
}

function runCount(harness: RunHarness, planId: string): number {
  const row = harness.app.context.db
    .prepare("SELECT COUNT(*) AS count FROM plan_runs WHERE plan_id = ?")
    .get(planId) as { count: number };
  return row.count;
}

function namesOf(candidates: readonly Candidate[]): string[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.location.kind === "at"
          ? [candidate.location.place.name]
          : [candidate.location.from.name, candidate.location.to.name],
      ),
    ),
  ].toSorted();
}

/** The last day of `revision` that holds an item, and its first item. */
function lastFilledDay(revision: PlanRevision): { dayIndex: number; itemId: string } {
  const day = revision.days.findLast((each) => each.items.length > 0);
  const item = day?.items[0];
  if (day === undefined || item === undefined) throw new Error("the draft placed nothing");
  return { dayIndex: day.dayIndex, itemId: item.id };
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

describe("the route", () => {
  test("answers 202 with a replan run", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: base.id,
        dates: { kind: "open", nights: 6 },
      });
      expect(run.kind).toBe("replan");
      expect(run.planId).toBe(view.plan.id);
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
    } finally {
      await f.close();
    }
  });

  const refusals = [
    {
      name: "a past departure is INVALID_DATES",
      dates: { kind: "exact", departure: "2026-08-01", return: "2026-08-05" },
      status: 400,
      code: "INVALID_DATES",
    },
    {
      name: "a window too short for its nights is INVALID_DATES",
      dates: { kind: "window", earliest: "2026-10-01", latest: "2026-10-03", nights: 5 },
      status: 400,
      code: "INVALID_DATES",
    },
    {
      name: "a trip past MAX_TRIP_NIGHTS is INVALID_DATES",
      dates: { kind: "exact", departure: "2026-10-01", return: "2026-12-31" },
      status: 400,
      code: "INVALID_DATES",
    },
  ] as const;

  for (const refusal of refusals) {
    test(`${refusal.name}, and starts no run`, async () => {
      const f = await fixture();
      try {
        const view = await draft(f);
        const enqueue = vi.spyOn(f.harness.app.context.runs, "enqueue");
        const response = await edit(f.harness, view.plan.id, {
          baseRevisionId: latestOf(view.plan).id,
          dates: refusal.dates,
        });
        expect(response.statusCode).toBe(refusal.status);
        expect(response.json.error.code).toBe(refusal.code);
        expect(enqueue).not.toHaveBeenCalled();
        expect(runCount(f.harness, view.plan.id)).toBe(1);
        expect(vi.mocked(reviseBrief)).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    });
  }

  test("a shorter trip that would drop a pinned item is PLAN_INFEASIBLE, 409, before any run", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const { dayIndex, itemId } = lastFilledDay(base);
      expect(dayIndex).toBeGreaterThan(0);
      const pin = await f.harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(view.plan.id, itemId),
        payload: { pinned: true },
      });
      expect(pin.statusCode).toBe(200);
      const enqueue = vi.spyOn(f.harness.app.context.runs, "enqueue");

      // `dayIndex` days is `dayIndex - 1` nights, and drops the pinned day.
      const response = await edit(f.harness, view.plan.id, {
        baseRevisionId: base.id,
        dates: { kind: "open", nights: dayIndex - 1 },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json.error.code).toBe("PLAN_INFEASIBLE");
      expect(response.json.error.details).toMatchObject({
        findings: [{ kind: "pin-on-dropped-day", dayIndex }],
      });
      expect(enqueue).not.toHaveBeenCalled();
      expect(runCount(f.harness, view.plan.id)).toBe(1);
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test("an unparseable brief edit is INVALID_ANSWER, and names both kinds of change", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const response = await edit(f.harness, view.plan.id, {
        baseRevisionId: latestOf(view.plan).id,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json.error.code).toBe("INVALID_ANSWER");
      expect(response.json.error.message).toContain("change the dates or budget");
    } finally {
      await f.close();
    }
  });

  test("spends the bucket a re-plan spends", async () => {
    // One for the draft, one for the edit, and the third is refused.
    const f = await fixture({ rateLimitRunsPerMinute: 2 });
    try {
      const view = await draft(f);
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: latestOf(view.plan).id,
        budget: AMOUNT,
      });
      await runToCompletion(f.harness.app, run.id);

      const refused = await edit(f.harness, view.plan.id, {
        baseRevisionId: latestOf((await readView(f.harness, view.plan.id)).plan).id,
        budget: BAND,
      });
      expect(refused.statusCode).toBe(429);
      expect(refused.json.error.code).toBe("RATE_LIMITED");
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

describe("the run", () => {
  test("a longer trip asks no model, asks grounding only about the slice's pool, and writes what step 3.5 says", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const longer: TripDates = { kind: "open", nights: 8 };
      const brief = { ...base.brief, dates: slot.answered(longer) };
      const change = { dates: { from: DRAFTED, to: longer }, budget: null };

      // What the run should measure, worked out the way the run does.
      const { resized, slice } = briefEditSlice({
        previous: base,
        brief,
        change,
        candidates: view.plan.candidates,
      });
      expect(slice).toEqual([6, 7, 8]);
      const pool = replanPool({ candidates: view.plan.candidates, previous: resized, days: slice });
      // The premise: something to measure, and fewer places than the whole plan has.
      expect(namesOf(pool).length).toBeGreaterThan(0);
      expect(namesOf(pool).length).toBeLessThan(namesOf(view.plan.candidates).length);

      const run = await editRun(f, view.plan.id, { baseRevisionId: base.id, dates: longer });
      const finished = await runToCompletion(f.harness.app, run.id);
      expect(finished.status).toBe("done");
      expect(finished.rosterSize).toBe(0);

      expect(f.model.sent).toBe(0);
      expect([...new Set(f.grounding.asked)].toSorted()).toEqual(namesOf(pool));

      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      expect(revision.revision).toBe(2);
      expect(revision.brief).toEqual(brief);
      expect(revision.operation).toEqual({ kind: "brief", ...change, days: [6, 7, 8] });
      expect(revision.reason).toBe("Changed the dates, and planned days 7–9.");
      expect(revision.days).toHaveLength(9);
      // And it is what the store holds, not only what the view said.
      expect(
        latestOf(selectPlan(f.harness.app.context.db, view.plan.id) as PlanDetail).brief,
      ).toEqual(brief);
    } finally {
      await f.close();
    }
  });

  test("a budget edit re-packs every day, and measures the whole pool with no model call", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);

      const run = await editRun(f, view.plan.id, { baseRevisionId: base.id, budget: AMOUNT });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      expect(f.model.sent).toBe(0);
      expect([...new Set(f.grounding.asked)].toSorted()).toEqual(namesOf(view.plan.candidates));
      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      expect(revision.operation).toEqual({
        kind: "brief",
        dates: null,
        budget: { from: slot.unknown(), to: AMOUNT },
        days: [0, 1, 2, 3, 4, 5],
      });
      expect(revision.reason).toBe("Changed the budget, and re-packed every day.");
      expect(revision.brief.budget).toEqual(slot.answered(AMOUNT));
      expect(revision.brief.dates).toEqual(base.brief.dates);
    } finally {
      await f.close();
    }
  });

  test("a pin set on a dropped day while grounding measures fails the run with PLAN_INFEASIBLE", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const { dayIndex, itemId } = lastFilledDay(base);
      const gate = { open: deferred(), arrived: deferred() };
      f.grounding.gate = gate;

      // The budget change makes the slice every kept day, so the run measures,
      // and the route's own check has passed: nothing is pinned yet.
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: base.id,
        dates: { kind: "open", nights: dayIndex - 1 },
        budget: AMOUNT,
      });
      await gate.arrived.promise;
      expect(readRunRow(f.harness.app, run.id).status).toBe("grounding");

      const pin = await f.harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(view.plan.id, itemId),
        payload: { pinned: true },
      });
      expect(pin.statusCode).toBe(200);
      gate.open.resolve();

      const finished = await runToCompletion(f.harness.app, run.id);
      expect(finished.status).toBe("failed");
      expect(finished.error?.code).toBe("PLAN_INFEASIBLE");
      expect(finished.error?.details).toMatchObject({
        findings: [{ kind: "pin-on-dropped-day", dayIndex }],
      });
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Every read of "the brief"
// ---------------------------------------------------------------------------

describe("after an edit, the brief everything reads is the edited one", () => {
  test("the view's unchecked list follows the edited dates and budget, not plan.brief", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const kindsBefore = view.unchecked.map((each) => each.kind);
      // The premise: `open` dates and no budget, so two of these are there to
      // go and two are not there yet.
      expect(kindsBefore).toEqual(
        expect.arrayContaining(["season-no-calendar", "booking-no-departure"]),
      );
      expect(kindsBefore).not.toContain("trip-truncated");
      expect(kindsBefore).not.toContain("budget-band");

      // Sixty nights of exact dates is sixty-one days, one past the plan's cap.
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: base.id,
        dates: { kind: "exact", departure: "2026-10-01", return: "2026-11-30" },
        budget: BAND,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      const after = await readView(f.harness, view.plan.id);
      const kinds = after.unchecked.map((each) => each.kind);
      // `plan.brief` did not move: it is the first draft's, and reading it
      // here would have produced the list from before.
      expect(after.plan.brief).toEqual(view.plan.brief);
      expect(kinds).toContain("trip-truncated");
      expect(kinds).toContain("budget-band");
      expect(kinds).not.toContain("season-no-calendar");
      expect(kinds).not.toContain("booking-no-departure");
    } finally {
      await f.close();
    }
  });

  test("a re-plan after an edit builds on the edited brief", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const longer: TripDates = { kind: "open", nights: 7 };
      const edited = await editRun(f, view.plan.id, {
        baseRevisionId: latestOf(view.plan).id,
        dates: longer,
      });
      await runToCompletion(f.harness.app, edited.id);
      const second = latestOf((await readView(f.harness, view.plan.id)).plan);

      const response = await f.harness.app.server.inject({
        method: "POST",
        url: planRevisionsUrl(view.plan.id),
        payload: {
          kind: "replan",
          baseRevisionId: second.id,
          days: [7],
          specialists: [],
          note: null,
        },
      });
      expect(response.statusCode).toBe(202);
      await runToCompletion(f.harness.app, response.json<{ run: Run }>().run.id);

      const third = latestOf((await readView(f.harness, view.plan.id)).plan);
      expect(third.revision).toBe(3);
      expect(third.brief.dates).toEqual(slot.answered(longer));
      expect(third.days).toHaveLength(8);
    } finally {
      await f.close();
    }
  });

  test("a restore of the first draft brings its dates back", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: latestOf(view.plan).id,
        dates: { kind: "open", nights: 7 },
      });
      await runToCompletion(f.harness.app, run.id);
      const second = latestOf((await readView(f.harness, view.plan.id)).plan);

      const restored = await f.harness.app.server.inject({
        method: "POST",
        url: planRevisionsUrl(view.plan.id),
        payload: { kind: "restore", baseRevisionId: second.id, revision: 1 },
      });
      expect(restored.statusCode).toBe(200);
      const third = latestOf(restored.json<{ view: PlanView }>().view.plan);
      expect(third.brief.dates).toEqual(slot.answered(DRAFTED));
      expect(third.days).toHaveLength(6);
    } finally {
      await f.close();
    }
  });

  test("a remove after an edit keeps the edited brief", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const longer: TripDates = { kind: "open", nights: 7 };
      const run = await editRun(f, view.plan.id, {
        baseRevisionId: latestOf(view.plan).id,
        dates: longer,
      });
      await runToCompletion(f.harness.app, run.id);
      const second = latestOf((await readView(f.harness, view.plan.id)).plan);

      const removed = await f.harness.app.server.inject({
        method: "POST",
        url: planRevisionsUrl(view.plan.id),
        payload: {
          kind: "remove",
          baseRevisionId: second.id,
          itemId: lastFilledDay(second).itemId,
        },
      });
      expect(removed.statusCode).toBe(200);
      const third = latestOf(removed.json<{ view: PlanView }>().view.plan);
      expect(third.operation.kind).toBe("remove");
      expect(third.brief).toEqual(second.brief);
      expect(third.brief.dates).toEqual(slot.answered(longer));
    } finally {
      await f.close();
    }
  });
});
