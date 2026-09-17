/**
 * `POST /api/plans/:id/revisions`, end to end over HTTP (pl-44).
 *
 * Everything reads back over HTTP or out of the store, never off the call that
 * produced it, for `plan-view.test.ts`'s reason: a revision that exists only in
 * the response is not a revision anyone will see tomorrow.
 *
 * `@planner/itinerary`'s three revision writers are wrapped in spies that call
 * through, so a refused request can be proved never to have reached them — the
 * checks are `api`'s, and `itinerary` answers `INTERNAL` to a value that got
 * past them.
 */

import { describe, expect, test, vi } from "vitest";
import type * as Itinerary from "@planner/itinerary";

vi.mock("@planner/itinerary", async (importOriginal) => {
  const actual = await importOriginal<typeof Itinerary>();
  return {
    ...actual,
    replan: vi.fn(actual.replan),
    applyEdit: vi.fn(actual.applyEdit),
    restoreRevision: vi.fn(actual.restoreRevision),
  };
});

import {
  AppError,
  latestRevision,
  planItemPinUrl,
  planRevisionsUrl,
  planUrl,
  ROUTES,
  runCancelUrl,
  type ErrorResponse,
  type NewRevision,
  type PlanDetail,
  type PlanItem,
  type PlanRevision,
  type PlanView,
  type ReviseResponse,
  type Run,
  type RunEvent,
  type Source,
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
import { readMarkers, ScriptedProvider, SPECIALIST_ORDER } from "@planner/agent";
import {
  applyEdit,
  editTransitions,
  replan,
  replanPool,
  restoreRevision,
  revisionDiffs,
} from "@planner/itinerary";
import { insertRun, selectRun, updateRunStatus } from "../src/db/runs.ts";
import { selectPlan } from "../src/db/plans.ts";
import { FixtureGroundingProvider } from "../src/grounding/fixtures.ts";
import { revisePlan } from "../src/runs/revise.ts";
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

/** A `fetchedAt` for what these doubles answer. */
const FETCHED = NOW.toISOString();

function source(url: string, title: string): Source {
  return { url, title, fetchedAt: FETCHED };
}

/**
 * The fixture grounding, recording what reached it, with three switches.
 *
 * - `corridor`: the intake's `somewhere` locates, and a corridor query finds
 *   one place with an article behind it — so discovery produces evidence a
 *   draft that could not locate its ends did not have.
 * - `unknownTravel`: every matrix cell is `null` — asked, and nobody knows.
 * - `travelGate`: a matrix call waits here until it is opened.
 *
 * Wrapped by the app's cache like any provider. The suites that assert what
 * reached it run with a zero TTL, so a draft's answers are not served to an
 * edit from the table and the recording sees every question.
 */
class RecordingGrounding implements GroundingProvider {
  readonly name = "recording";
  readonly #inner = new FixtureGroundingProvider(() => NOW);
  corridor = false;
  unknownTravel = false;
  travelGate: { open: Deferred; entered: number; arrived: Deferred[] } | null = null;
  readonly located: string[] = [];
  readonly travelled: string[][] = [];
  nearbyCalls = 0;
  articleCalls = 0;

  get calls(): number {
    return this.located.length + this.travelled.length + this.nearbyCalls + this.articleCalls;
  }

  forget(): void {
    this.located.length = 0;
    this.travelled.length = 0;
    this.nearbyCalls = 0;
    this.articleCalls = 0;
  }

  async locate(request: LocateRequest): Promise<LocatedPlace | null> {
    this.located.push(request.place.name);
    if (this.corridor && request.place.name === "somewhere") {
      return {
        coordinates: { latitude: 48.45, longitude: -68.52 },
        source: source("https://fixtures.invalid/somewhere", "A corridor end"),
      };
    }
    return await this.#inner.locate(request);
  }

  async travel(request: TravelRequest): Promise<TravelMatrix> {
    this.travelled.push(request.origins.map((place) => place.name));
    const gate = this.travelGate;
    if (gate !== null) {
      gate.entered += 1;
      gate.arrived[gate.entered - 1]?.resolve();
      await gate.open.promise;
    }
    if (this.unknownTravel) {
      return request.origins.map(() => request.destinations.map(() => null));
    }
    return await this.#inner.travel(request);
  }

  async nearby(request: NearbyRequest): Promise<Find[]> {
    this.nearbyCalls += 1;
    if (!this.corridor) return await this.#inner.nearby(request);
    return [
      {
        name: "Phare de Pointe-au-Père",
        coordinates: { latitude: 48.45, longitude: -68.52 },
        kind: "viewpoint",
        tags: new Map([["tourism", "viewpoint"]]),
        sources: [source("https://www.openstreetmap.org/node/1", "OpenStreetMap")],
        notability: [source("https://en.wikipedia.org/wiki/Pointe-au-P%C3%A8re", "Pointe-au-Père")],
        detourMinutes: null,
      },
    ];
  }

  async articlesNear(request: NotabilityRequest): Promise<NearbyArticle[]> {
    this.articleCalls += 1;
    if (!this.corridor) return await this.#inner.articlesNear(request);
    return [
      {
        source: source("https://en.wikivoyage.org/wiki/Bas-Saint-Laurent", "Bas-Saint-Laurent"),
        coordinates: request.coordinates,
      },
    ];
  }
}

/**
 * The scripted provider, recording who was asked, and able to hold every
 * request at the door (`hold()`) until released — or until the run is
 * canceled, in which case the request rejects the way a real one does.
 */
class RecordingModel implements ModelProvider {
  readonly name = "recording";
  readonly model = "recording";
  readonly #inner = new ScriptedProvider();
  readonly asked: string[] = [];
  readonly requests: ModelRequest[] = [];
  /** When set, only these specialists answer; everyone else proposes nothing. */
  answering: ReadonlySet<string> | null = null;
  #gate: { entered: Deferred; open: Deferred } | null = null;
  inFlight = 0;
  aborted = 0;

  hold(): { entered: Promise<void>; release: () => void } {
    const gate = { entered: deferred(), open: deferred() };
    this.#gate = gate;
    return {
      entered: gate.entered.promise,
      release: () => {
        this.#gate = null;
        gate.open.resolve();
      },
    };
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    const specialist = readMarkers(request.system)?.specialist ?? "unknown";
    this.asked.push(specialist);
    this.requests.push(request);

    const gate = this.#gate;
    if (gate !== null) {
      this.inFlight += 1;
      gate.entered.resolve();
      await new Promise<void>((resolve, reject) => {
        const stop = (): void => {
          this.aborted += 1;
          reject(new AppError("JOB_CANCELED"));
        };
        if (request.signal?.aborted === true) stop();
        request.signal?.addEventListener("abort", stop);
        void gate.open.promise.finally(() => {
          request.signal?.removeEventListener("abort", stop);
          resolve();
        });
      });
    }

    const reply = await this.#inner.send(request);
    if (this.answering !== null && !this.answering.has(specialist)) {
      return { ...reply, content: '{"candidates":[]}' };
    }
    return reply;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Fixture {
  harness: RunHarness;
  model: RecordingModel;
  grounding: RecordingGrounding;
  close(): Promise<void>;
}

async function fixture(
  config: Parameters<typeof createRunHarness>[0] extends infer O
    ? O extends { config?: infer C }
      ? C
      : never
    : never = {},
): Promise<Fixture> {
  const model = new RecordingModel();
  const grounding = new RecordingGrounding();
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

/** A finished first draft, and the plan it made. */
async function draft(f: Fixture, shape = "road-trip"): Promise<PlanView> {
  const intakeId = await intakeReadyToDraft(f.harness.app, shape);
  const run = await startRunOver(f.harness.app, intakeId);
  const finished = await runToCompletion(f.harness.app, run.id);
  expect(finished.status).toBe("done");
  const view = await readView(f.harness, run.planId);
  vi.clearAllMocks();
  f.model.asked.length = 0;
  f.model.requests.length = 0;
  f.grounding.forget();
  return view;
}

async function revise(
  harness: RunHarness,
  planId: string,
  body: unknown,
): Promise<{
  statusCode: number;
  json: ReviseResponse & ErrorResponse;
  headers: Record<string, unknown>;
}> {
  const response = await harness.app.server.inject({
    method: "POST",
    url: planRevisionsUrl(planId),
    payload: body as Record<string, unknown>,
  });
  return {
    statusCode: response.statusCode,
    json: response.json<ReviseResponse & ErrorResponse>(),
    headers: response.headers,
  };
}

function itemOn(revision: PlanRevision, dayIndex: number, position: number): PlanItem {
  const item = revision.days[dayIndex]?.items[position];
  if (item === undefined) throw new Error(`no item at day ${String(dayIndex)}:${String(position)}`);
  return item;
}

function namesOf(plan: PlanDetail, candidateIds: Iterable<string>): string[] {
  const wanted = new Set(candidateIds);
  return [
    ...new Set(
      plan.candidates
        .filter((candidate) => wanted.has(candidate.id))
        .flatMap((candidate) =>
          candidate.location.kind === "at"
            ? [candidate.location.place.name]
            : [candidate.location.from.name, candidate.location.to.name],
        ),
    ),
  ].toSorted();
}

/** The number a candidate id ends with: its place in its specialist's reply. */
function suffix(id: string): number {
  return Number(id.slice(id.lastIndexOf("-") + 1));
}

function askedPlaces(grounding: RecordingGrounding): string[] {
  return [...new Set([...grounding.located, ...grounding.travelled.flat()])].toSorted();
}

function expectNothingReachedItinerary(): void {
  expect(vi.mocked(replan)).not.toHaveBeenCalled();
  expect(vi.mocked(applyEdit)).not.toHaveBeenCalled();
  expect(vi.mocked(restoreRevision)).not.toHaveBeenCalled();
}

type RunFrame = Exclude<RunEvent, { type: "heartbeat" }>;

/** Every frame the hub emitted for any run, captured at the source. */
function captureFrames(harness: RunHarness): RunFrame[] {
  const frames: RunFrame[] = [];
  const { events } = harness.app.context;
  const emit = events.emit.bind(events);
  vi.spyOn(events, "emit").mockImplementation((event: RunEvent) => {
    if (event.type !== "heartbeat") frames.push(event);
    emit(event);
  });
  return frames;
}

async function replanRun(
  f: Fixture,
  planId: string,
  body: { days: number[]; specialists: string[]; note?: string | null; baseRevisionId: string },
): Promise<Run> {
  const response = await revise(f.harness, planId, {
    kind: "replan",
    note: null,
    ...body,
  });
  expect(response.statusCode).toBe(202);
  if (response.json.kind !== "run") throw new Error("a re-plan answered without a run");
  return response.json.run;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("route refusals", () => {
  test("an unparseable body is INVALID_ANSWER, and nothing reaches itinerary", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const response = await revise(f.harness, view.plan.id, { kind: "teleport" });
      expect(response.statusCode).toBe(400);
      expect(response.json.error.code).toBe("INVALID_ANSWER");
      expectNothingReachedItinerary();
    } finally {
      await f.close();
    }
  });

  test("a plan that does not exist is PLAN_NOT_FOUND", async () => {
    const f = await fixture();
    try {
      const response = await revise(f.harness, "nope", {
        kind: "restore",
        baseRevisionId: "r",
        revision: 1,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json.error.code).toBe("PLAN_NOT_FOUND");
      expectNothingReachedItinerary();
    } finally {
      await f.close();
    }
  });

  test("a live run on the plan is PLAN_BUSY naming that run, and it outranks a stale base", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const held = f.model.hold();
      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: ["food"],
        baseRevisionId: base.id,
      });
      await held.entered;

      for (const body of [
        { kind: "restore", baseRevisionId: base.id, revision: 1 },
        // Busy before stale: this base is wrong too, and the advice is still "wait".
        { kind: "remove", baseRevisionId: "not-the-latest", itemId: itemOn(base, 0, 0).id },
      ]) {
        const response = await revise(f.harness, view.plan.id, body);
        expect(response.statusCode).toBe(409);
        expect(response.json.error.code).toBe("PLAN_BUSY");
        expect(response.json.error.details).toEqual({ run: run.id });
        expect(response.json.error.retryable).toBe(true);
      }
      expect(vi.mocked(applyEdit)).not.toHaveBeenCalled();
      expect(vi.mocked(restoreRevision)).not.toHaveBeenCalled();

      held.release();
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
    } finally {
      await f.close();
    }
  });

  test("a plan whose first draft is still running is PLAN_BUSY", async () => {
    const f = await fixture();
    try {
      const held = f.model.hold();
      const intakeId = await intakeReadyToDraft(f.harness.app);
      const run = await startRunOver(f.harness.app, intakeId);
      await held.entered;

      const response = await revise(f.harness, run.planId, {
        kind: "restore",
        baseRevisionId: "anything",
        revision: 1,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json.error.code).toBe("PLAN_BUSY");
      expect(response.json.error.details).toEqual({ run: run.id });

      held.release();
      await runToCompletion(f.harness.app, run.id);
    } finally {
      await f.close();
    }
  });

  test("a base that is not the latest is REVISION_STALE, and never retryable", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const first = latestOf(view.plan);
      expect(
        (
          await revise(f.harness, view.plan.id, {
            kind: "restore",
            baseRevisionId: first.id,
            revision: 1,
          })
        ).statusCode,
      ).toBe(200);
      vi.clearAllMocks();

      for (const baseRevisionId of [first.id, "never-a-revision"]) {
        const response = await revise(f.harness, view.plan.id, {
          kind: "replan",
          baseRevisionId,
          days: [0],
          specialists: [],
          note: null,
        });
        expect(response.statusCode).toBe(409);
        expect(response.json.error.code).toBe("REVISION_STALE");
        expect(response.json.error.retryable).toBe(false);
      }
      expectNothingReachedItinerary();
    } finally {
      await f.close();
    }
  });

  test("a day past the plan's count, and an out-of-range toDayIndex or toPosition, are INVALID_ANSWER", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const dayCount = base.days.length;
      // Day 0 holds two items, day 1 two: the same-day bound is one fewer than
      // the day holds now, because the item has left before it lands.
      const moving = itemOn(base, 0, 0);
      const sameDayLength = base.days[0]?.items.length ?? 0;
      const otherDayLength = base.days[1]?.items.length ?? 0;
      expect(sameDayLength).toBe(2);

      const refused = [
        {
          kind: "replan",
          baseRevisionId: base.id,
          days: [0, dayCount],
          specialists: [],
          note: null,
        },
        {
          kind: "move",
          baseRevisionId: base.id,
          itemId: moving.id,
          toDayIndex: dayCount,
          toPosition: 0,
        },
        {
          kind: "move",
          baseRevisionId: base.id,
          itemId: moving.id,
          toDayIndex: 1,
          toPosition: otherDayLength + 1,
        },
        {
          kind: "move",
          baseRevisionId: base.id,
          itemId: moving.id,
          toDayIndex: 0,
          toPosition: sameDayLength,
        },
      ];
      for (const body of refused) {
        const response = await revise(f.harness, view.plan.id, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
        expect(response.json.error.code).toBe("INVALID_ANSWER");
      }
      expectNothingReachedItinerary();
      expect(selectRun(f.harness.app.context.db, "none")).toBeUndefined();
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);

      // The bounds are bounds, not refusals of everything: the last legal place
      // on each day is accepted.
      const sameDayEnd = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: moving.id,
        toDayIndex: 0,
        toPosition: sameDayLength - 1,
      });
      expect(sameDayEnd.statusCode).toBe(200);
    } finally {
      await f.close();
    }
  });

  test("an unknown item, and an item from a superseded revision, are ITEM_NOT_FOUND", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const first = latestOf(view.plan);
      const stale = itemOn(first, 0, 0);
      const restored = await revise(f.harness, view.plan.id, {
        kind: "restore",
        baseRevisionId: first.id,
        revision: 1,
      });
      expect(restored.statusCode).toBe(200);
      const second = latestOf(
        (restored.json as Extract<ReviseResponse, { kind: "revision" }>).view.plan,
      );
      vi.clearAllMocks();

      for (const body of [
        { kind: "remove", baseRevisionId: second.id, itemId: "no-such-item" },
        { kind: "remove", baseRevisionId: second.id, itemId: stale.id },
        { kind: "move", baseRevisionId: second.id, itemId: stale.id, toDayIndex: 1, toPosition: 0 },
      ]) {
        const response = await revise(f.harness, view.plan.id, body);
        expect(response.statusCode).toBe(404);
        expect(response.json.error.code).toBe("ITEM_NOT_FOUND");
      }
      expectNothingReachedItinerary();
    } finally {
      await f.close();
    }
  });

  test("a restore of a version the plan does not have is REVISION_NOT_FOUND", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const response = await revise(f.harness, view.plan.id, {
        kind: "restore",
        baseRevisionId: base.id,
        revision: 2,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json.error.code).toBe("REVISION_NOT_FOUND");
      // From the check against the latest, not from the restore's own
      // defensive lookup behind it, which names no latest.
      expect(response.json.error.details).toEqual({ revision: 2, latest: 1 });
      expectNothingReachedItinerary();
    } finally {
      await f.close();
    }
  });

  test("the revision ceiling is REVISION_LIMIT_REACHED, 409, for an edit and a re-plan alike", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      let base = latestOf(view.plan);
      // 49 restores make 50 revisions, the first draft included.
      for (let count = 1; count < 50; count += 1) {
        const response = await revise(f.harness, view.plan.id, {
          kind: "restore",
          baseRevisionId: base.id,
          revision: 1,
        });
        expect(response.statusCode).toBe(200);
        base = latestOf((response.json as Extract<ReviseResponse, { kind: "revision" }>).view.plan);
      }
      expect(base.revision).toBe(50);
      vi.clearAllMocks();

      for (const body of [
        { kind: "restore", baseRevisionId: base.id, revision: 1 },
        { kind: "replan", baseRevisionId: base.id, days: [0], specialists: [], note: null },
      ]) {
        const response = await revise(f.harness, view.plan.id, body);
        expect(response.statusCode).toBe(409);
        expect(response.json.error.code).toBe("REVISION_LIMIT_REACHED");
        expect(response.json.error.retryable).toBe(false);
      }
      expectNothingReachedItinerary();
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(50);
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Busy
// ---------------------------------------------------------------------------

describe("busy is race-free and cannot wedge", () => {
  test("two re-plans issued together land one 202 and one PLAN_BUSY", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const held = f.model.hold();

      const body = {
        kind: "replan",
        baseRevisionId: base.id,
        days: [0],
        specialists: ["food"],
        note: null,
      };
      const [left, right] = await Promise.all([
        revise(f.harness, view.plan.id, body),
        revise(f.harness, view.plan.id, body),
      ]);
      const statuses = [left.statusCode, right.statusCode].toSorted();
      expect(statuses).toEqual([202, 409]);
      const busy = left.statusCode === 409 ? left : right;
      const accepted = left.statusCode === 202 ? left : right;
      expect(busy.json.error.code).toBe("PLAN_BUSY");
      if (accepted.json.kind !== "run") throw new Error("no run");
      expect(busy.json.error.details).toEqual({ run: accepted.json.run.id });

      held.release();
      await runToCompletion(f.harness.app, accepted.json.run.id);
      const runs = f.harness.app.context.db
        .prepare("SELECT COUNT(*) AS n FROM plan_runs WHERE plan_id = ? AND kind = 'replan'")
        .get(view.plan.id) as { n: number };
      expect(runs.n).toBe(1);
    } finally {
      await f.close();
    }
  });

  test("a live-by-status run the queue does not know is closed out, and the request proceeds", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      // What a restart leaves: a row still fanning out, and no process running it.
      const { db } = f.harness.app.context;
      insertRun(db, {
        id: "orphan",
        planId: view.plan.id,
        kind: "replan",
        status: "queued",
        now: FETCHED,
      });
      updateRunStatus(db, { id: "orphan", status: "fanning-out", now: FETCHED, terminal: false });

      const response = await revise(f.harness, view.plan.id, {
        kind: "restore",
        baseRevisionId: base.id,
        revision: 1,
      });
      expect(response.statusCode).toBe(200);
      const orphan = readRunRow(f.harness.app, "orphan");
      expect(orphan.status).toBe("canceled");
      expect(orphan.error?.code).toBe("JOB_CANCELED");
      expect(orphan.finishedAt).not.toBeNull();
    } finally {
      await f.close();
    }
  });

  test("two concurrent moves land one revision and one REVISION_STALE", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const arrived = [deferred(), deferred()];
      const gate = { open: deferred(), entered: 0, arrived };
      f.grounding.travelGate = gate;

      // Two different moves, each creating a transition to measure, so both
      // are inside their lookup — past their checks — before either writes.
      const first = revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 0, 1).id,
        toDayIndex: 3,
        toPosition: 1,
      });
      const second = revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 1, 1).id,
        toDayIndex: 3,
        toPosition: 1,
      });
      await Promise.all(arrived.map((each) => each.promise));
      gate.open.resolve();

      const statuses = (await Promise.all([first, second])).map((each) => [
        each.statusCode,
        each.statusCode === 200 ? null : each.json.error.code,
      ]);
      expect(statuses.toSorted()).toEqual([
        [200, null],
        [409, "REVISION_STALE"],
      ]);
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The re-plan run
// ---------------------------------------------------------------------------

describe("a re-plan with named specialists", () => {
  test("asks only them, stores their candidates under its run, appends them to the pool, and records asked and ran", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const stored = selectPlan(f.harness.app.context.db, view.plan.id);
      if (stored === undefined) throw new Error("no plan");

      const run = await replanRun(f, view.plan.id, {
        days: [0, 1],
        specialists: ["food", "lodging"],
        note: "Somewhere quieter to sleep.",
        baseRevisionId: base.id,
      });
      expect(run.kind).toBe("replan");
      const finished = await runToCompletion(f.harness.app, run.id);
      expect(finished.status).toBe("done");
      expect(finished.kind).toBe("replan");

      expect([...f.model.asked].toSorted()).toEqual(["food", "lodging"]);

      const after = await readView(f.harness, view.plan.id);
      const fresh = after.plan.candidates.filter((each) => each.id.startsWith(`${run.id}-`));
      expect(fresh.length).toBeGreaterThan(0);
      const rows = f.harness.app.context.db
        .prepare("SELECT id FROM plan_candidates WHERE run_id = ? ORDER BY id")
        .all(run.id) as { id: string }[];
      expect(rows.map((row) => row.id)).toEqual(fresh.map((each) => each.id).toSorted());

      // The stored pool in stored order, this run's candidates appended in
      // fan-out order — roster order, then the order each proposed them. Not
      // the pool read back after inserting: `selectPlan` orders by id, which
      // would put `food` before `lodging` and could put the whole new block
      // before the old one.
      expect(vi.mocked(replan)).toHaveBeenCalledTimes(1);
      const input = vi.mocked(replan).mock.calls[0]?.[0];
      const fanOutOrder = fresh.toSorted(
        (left, right) =>
          SPECIALIST_ORDER.indexOf(left.specialist) - SPECIALIST_ORDER.indexOf(right.specialist) ||
          suffix(left.id) - suffix(right.id),
      );
      expect(new Set(fresh.map((each) => each.specialist))).toEqual(new Set(["food", "lodging"]));
      expect(input?.candidates.map((each) => each.id)).toEqual([
        ...stored.candidates.map((each) => each.id),
        ...fanOutOrder.map((each) => each.id),
      ]);

      const revision = latestOf(after.plan);
      expect(revision.revision).toBe(2);
      expect(revision.parentRevisionId).toBe(base.id);
      expect(revision.operation).toEqual({
        kind: "replan",
        days: [0, 1],
        specialists: ["food", "lodging"],
        note: "Somewhere quieter to sleep.",
      });
      expect(revision.reason).toBe("Re-planned days 1–2 with lodging and food.");
    } finally {
      await f.close();
    }
  });

  test("a named specialist that is not applicable, or over budget, keeps its gap and leaves the caption; unnamed gaps carry", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const carried = base.gaps.find((gap) => gap.specialist === "conditions-and-gear");
      expect(carried?.reason).toBe("specialist-not-applicable");
      // One specialist's worth of budget: of the two applicable names, the one
      // further back in SPECIALIST_ORDER is dropped. `budget`, because nothing
      // of its is placed — a gap for a specialist with an item on a frozen day
      // is one the days contradict, and `replan` drops it.
      f.harness.app.context.config.maxSpecialists = 1;

      const run = await replanRun(f, view.plan.id, {
        days: [2],
        specialists: ["practicalities", "lodging", "budget"],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
      expect(f.model.asked).toEqual(["lodging"]);

      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      const gap = (specialist: string) =>
        revision.gaps.find((each) => each.specialist === specialist);
      expect(gap("practicalities")?.reason).toBe("specialist-not-applicable");
      expect(gap("budget")?.reason).toBe("specialist-dropped-for-budget");
      expect(gap("conditions-and-gear")).toEqual(carried);
      expect(revision.reason).toBe("Re-planned day 3 with lodging.");
      expect(revision.operation).toEqual({
        kind: "replan",
        days: [2],
        specialists: ["practicalities", "lodging", "budget"],
        note: null,
      });
    } finally {
      await f.close();
    }
  });
});

describe("a re-plan with no specialists", () => {
  /**
   * A draft whose every candidate is placed: only lodging proposes, and the
   * road trip places all three. So a slice of an empty day has nothing to
   * measure, and a slice of a lodging's day has one place.
   */
  async function lodgingOnly(f: Fixture): Promise<PlanView> {
    f.model.answering = new Set(["lodging"]);
    const view = await draft(f);
    const placed = new Set(
      latestOf(view.plan).days.flatMap((day) => day.items.map((item) => item.candidateId)),
    );
    expect(view.plan.candidates.every((each) => placed.has(each.id))).toBe(true);
    return view;
  }

  test("asks no model, reports a roster of 0 that reads back as 0, and goes queued → composing with nothing to measure", async () => {
    const f = await fixture();
    try {
      const view = await lodgingOnly(f);
      const base = latestOf(view.plan);
      const empty = base.days.findIndex((day) => day.items.length === 0);
      expect(empty).toBeGreaterThan(-1);
      const frames = captureFrames(f.harness);

      const run = await replanRun(f, view.plan.id, {
        days: [empty],
        specialists: [],
        baseRevisionId: base.id,
      });
      const finished = await runToCompletion(f.harness.app, run.id);
      expect(finished.status).toBe("done");

      expect(f.model.asked).toEqual([]);
      expect(finished.rosterSize).toBe(0);
      const mine = frames.filter((frame) => frame.runId === run.id);
      expect(
        mine.filter((frame) => frame.type === "progress").map((frame) => frame.progress),
      ).toEqual([{ type: "roster", running: [], droppedForBudget: [], total: 0 }]);
      expect(mine.flatMap((frame) => (frame.type === "status" ? [frame.status] : []))).toEqual([
        "composing",
        "done",
      ]);
      expect(f.grounding.calls).toBe(0);

      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      expect(revision.reason).toBe(
        `Re-packed day ${String(empty + 1)} from what was already proposed.`,
      );
      expect(revision.gaps).toEqual(base.gaps);
    } finally {
      await f.close();
    }
  });

  test("goes queued → grounding → composing when the slice has something to measure", async () => {
    const f = await fixture();
    try {
      const view = await lodgingOnly(f);
      const base = latestOf(view.plan);
      const frames = captureFrames(f.harness);

      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: [],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      expect(f.model.asked).toEqual([]);
      expect(
        frames.flatMap((frame) =>
          frame.runId === run.id && frame.type === "status" ? [frame.status] : [],
        ),
      ).toEqual(["grounding", "composing", "done"]);
      expect(readRunRow(f.harness.app, run.id).rosterSize).toBe(0);
    } finally {
      await f.close();
    }
  });
});

describe("a pin set while a re-plan is running", () => {
  // Two moments, because the run reads the plan twice: once after the fan-out
  // for its pool, and again just before composing. A pin set during the
  // fan-out is already in the first read; one set while grounding measures is
  // only in the second.
  for (const moment of ["while the specialists run", "while grounding measures"] as const) {
    test(`is honoured by the revision it writes, pinned ${moment}`, async () => {
      const f = await fixture();
      try {
        const view = await draft(f);
        const base = latestOf(view.plan);
        const pinned = itemOn(base, 0, 0);

        let release: () => void;
        let entered: Promise<void>;
        if (moment === "while the specialists run") {
          const held = f.model.hold();
          entered = held.entered;
          release = held.release;
        } else {
          const gate = { open: deferred(), entered: 0, arrived: [deferred()] };
          f.grounding.travelGate = gate;
          entered = gate.arrived[0]?.promise ?? Promise.resolve();
          release = () => gate.open.resolve();
        }

        const run = await replanRun(f, view.plan.id, {
          days: [0, 1],
          specialists: ["food"],
          baseRevisionId: base.id,
        });
        await entered;
        expect(readRunRow(f.harness.app, run.id).status).toBe(
          moment === "while the specialists run" ? "fanning-out" : "grounding",
        );
        const pin = await f.harness.app.server.inject({
          method: "POST",
          url: planItemPinUrl(view.plan.id, pinned.id),
          payload: { pinned: true },
        });
        expect(pin.statusCode).toBe(200);
        release();
        expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

        const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
        expect(revision.revision).toBe(2);
        const kept = revision.days[0]?.items.find(
          (item) => item.candidateId === pinned.candidateId,
        );
        expect(kept?.pinned).toBe(true);
      } finally {
        await f.close();
      }
    });
  }
});

describe("discovery on a re-plan", () => {
  test("naming food on a corridor brief re-runs it, and the revision carries what it found", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      f.grounding.corridor = true;

      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: ["food"],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      expect(f.grounding.nearbyCalls).toBe(1);
      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      // What this run's discovery found, not what the draft's did.
      expect(revision.reading).toEqual([
        source("https://en.wikivoyage.org/wiki/Bas-Saint-Laurent", "Bas-Saint-Laurent"),
      ]);
      expect(revision.coverage).toEqual([]);
      expect(base.coverage).not.toEqual([]);
      expect(base.reading).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test("naming only lodging never asks, and the revision's coverage and reading are the base's", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      f.grounding.corridor = true;

      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: ["lodging"],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      expect(f.grounding.nearbyCalls).toBe(0);
      const revision = latestOf((await readView(f.harness, view.plan.id)).plan);
      expect(revision.coverage).toEqual(base.coverage);
      expect(revision.reading).toEqual(base.reading);
    } finally {
      await f.close();
    }
  });
});

describe("the re-plan's measuring pass", () => {
  test("is asked only about the places replanPool offers, never a frozen day's", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);

      const run = await replanRun(f, view.plan.id, {
        days: [3],
        specialists: [],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");

      const pool = replanPool({ candidates: view.plan.candidates, previous: base, days: [3] });
      const expected = namesOf(
        view.plan,
        pool.map((each) => each.id),
      );
      expect(askedPlaces(f.grounding)).toEqual(expected);
      const frozen = namesOf(view.plan, base.days[0]?.items.map((item) => item.candidateId) ?? []);
      expect(frozen.length).toBeGreaterThan(0);
      for (const name of frozen) expect(expected).not.toContain(name);
    } finally {
      await f.close();
    }
  });
});

describe("a canceled re-plan", () => {
  test("writes no revision, ends canceled, and its in-flight requests saw the abort", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const held = f.model.hold();

      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: ["food", "lodging"],
        baseRevisionId: base.id,
      });
      await held.entered;
      expect(f.model.inFlight).toBeGreaterThan(0);

      const cancel = await f.harness.app.server.inject({
        method: "POST",
        url: runCancelUrl(run.id),
      });
      expect(cancel.statusCode).toBe(200);
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("canceled");
      expect(f.model.aborted).toBe(f.model.inFlight);

      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);
      expect(vi.mocked(replan)).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The edits
// ---------------------------------------------------------------------------

describe("a move and a remove", () => {
  test("a move answers 200 with the view, names its candidate and day, and grounding hears only its pairs", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      // A lodging to the end of a day holding one food stop: one new transition.
      const moving = itemOn(base, 0, 1);
      const operation = {
        kind: "move",
        candidateId: moving.candidateId,
        fromDayIndex: 0,
        toDayIndex: 3,
        toPosition: 1,
      } as const;
      const pairs = editTransitions(base, operation);
      expect(pairs.length).toBeGreaterThan(0);

      const response = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: moving.id,
        toDayIndex: 3,
        toPosition: 1,
      });
      expect(response.statusCode).toBe(200);
      if (response.json.kind !== "revision") throw new Error("an edit answered without a view");
      const revision = latestOf(response.json.view.plan);
      expect(revision.operation).toEqual(operation);
      expect(revision.parentRevisionId).toBe(base.id);
      expect(response.json.view).toEqual(await readView(f.harness, view.plan.id));

      const named = pairs.flatMap((pair) => [pair.fromCandidateId, pair.toCandidateId]);
      expect(askedPlaces(f.grounding)).toEqual(namesOf(view.plan, named));
      // No run, and no frame.
      const runs = f.harness.app.context.db
        .prepare("SELECT COUNT(*) AS n FROM plan_runs WHERE plan_id = ?")
        .get(view.plan.id) as { n: number };
      expect(runs.n).toBe(1);
    } finally {
      await f.close();
    }
  });

  test("a remove answers 200, names its candidate and day, and grounding hears only its pair", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      // Put an item between two, so removing it closes a gap worth measuring.
      const moved = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 3, 0).id,
        toDayIndex: 2,
        toPosition: 1,
      });
      expect(moved.statusCode).toBe(200);
      if (moved.json.kind !== "revision") throw new Error("no view");
      const middle = latestOf(moved.json.view.plan);
      const removing = itemOn(middle, 2, 1);
      const operation = {
        kind: "remove",
        candidateId: removing.candidateId,
        fromDayIndex: 2,
      } as const;
      const pairs = editTransitions(middle, operation);
      expect(pairs).toHaveLength(1);
      f.grounding.forget();

      const response = await revise(f.harness, view.plan.id, {
        kind: "remove",
        baseRevisionId: middle.id,
        itemId: removing.id,
      });
      expect(response.statusCode).toBe(200);
      if (response.json.kind !== "revision") throw new Error("no view");
      expect(latestOf(response.json.view.plan).operation).toEqual(operation);
      expect(askedPlaces(f.grounding)).toEqual(
        namesOf(
          view.plan,
          pairs.flatMap((pair) => [pair.fromCandidateId, pair.toCandidateId]),
        ),
      );
    } finally {
      await f.close();
    }
  });

  test("a lookup the budget refused records over-budget", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      f.harness.app.context.config.maxGroundingCalls = 0;

      const moving = itemOn(base, 0, 1);
      const response = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: moving.id,
        toDayIndex: 3,
        toPosition: 1,
      });
      expect(response.statusCode).toBe(200);
      if (response.json.kind !== "revision") throw new Error("no view");
      const landed = latestOf(response.json.view.plan).days[3]?.items[1];
      expect(landed?.candidateId).toBe(moving.candidateId);
      expect(landed?.travelFromPrevious?.kind).toBe("over-budget");
      expect(f.grounding.calls).toBe(0);
    } finally {
      await f.close();
    }
  });

  test("a lookup made and answered unknown records not-established", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      f.grounding.unknownTravel = true;

      const moving = itemOn(base, 0, 1);
      const response = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: moving.id,
        toDayIndex: 3,
        toPosition: 1,
      });
      expect(response.statusCode).toBe(200);
      if (response.json.kind !== "revision") throw new Error("no view");
      const landed = latestOf(response.json.view.plan).days[3]?.items[1];
      expect(landed?.candidateId).toBe(moving.candidateId);
      expect(landed?.travelFromPrevious?.kind).toBe("not-established");
      expect(f.grounding.travelled).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test("a move that breaks a day answers PLAN_INFEASIBLE with compose's findings, and writes nothing", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);

      const response = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 1, 0).id,
        toDayIndex: 0,
        toPosition: 0,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json.error.code).toBe("PLAN_INFEASIBLE");
      const findings = (response.json.error.details as { findings: unknown[] }).findings;
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(Object.keys(finding as object).toSorted()).toEqual(["dayIndex", "detail", "kind"]);
      }
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  test("a restore answers 200 with no grounding call, and its revision is restoreRevision's", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);

      const response = await revise(f.harness, view.plan.id, {
        kind: "restore",
        baseRevisionId: base.id,
        revision: 1,
      });
      expect(response.statusCode).toBe(200);
      expect(f.grounding.calls).toBe(0);

      expect(vi.mocked(restoreRevision)).toHaveBeenCalledTimes(1);
      const made = vi.mocked(restoreRevision).mock.results[0]?.value as NewRevision;
      const stored = latestOf((await readView(f.harness, view.plan.id)).plan);
      const { planId: _planId, revision: _number, parentRevisionId, ...rest } = stored;
      expect(rest).toEqual(made);
      expect(parentRevisionId).toBe(base.id);
      expect(stored.reason).toBe("Restored version 1.");
      expect(stored.operation).toEqual({ kind: "restore", revision: 1 });
    } finally {
      await f.close();
    }
  });
});

describe("PlanView.diffs", () => {
  test("is revisionDiffs over the stored revisions with three of them, and empty with one", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      expect(view.diffs).toEqual([]);

      let base = latestOf(view.plan);
      const moved = await revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 0, 1).id,
        toDayIndex: 3,
        toPosition: 0,
      });
      expect(moved.statusCode).toBe(200);
      if (moved.json.kind !== "revision") throw new Error("no view");
      base = latestOf(moved.json.view.plan);
      expect(
        (
          await revise(f.harness, view.plan.id, {
            kind: "restore",
            baseRevisionId: base.id,
            revision: 1,
          })
        ).statusCode,
      ).toBe(200);

      const after = await readView(f.harness, view.plan.id);
      expect(after.plan.revisions).toHaveLength(3);
      expect(after.diffs).toHaveLength(2);
      expect(after.diffs).toEqual(revisionDiffs(after.plan.revisions));
      expect(after.diffs[0]?.entries.length).toBeGreaterThan(0);
    } finally {
      await f.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("rate limiting revisions", () => {
  test("re-plans, with and without specialists, spend the bucket POST /api/plans spends", async () => {
    const f = await fixture({ rateLimitRunsPerMinute: 3 });
    try {
      const view = await draft(f); // one
      let base = latestOf(view.plan);
      for (const specialists of [["food"], []]) {
        // two, three
        const run = await replanRun(f, view.plan.id, {
          days: [0],
          specialists,
          baseRevisionId: base.id,
        });
        expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
        base = latestOf((await readView(f.harness, view.plan.id)).plan);
      }

      const replanned = await revise(f.harness, view.plan.id, {
        kind: "replan",
        baseRevisionId: base.id,
        days: [0],
        specialists: [],
        note: null,
      });
      expect(replanned.statusCode).toBe(429);
      expect(replanned.json.error.code).toBe("RATE_LIMITED");
      expect(replanned.headers["retry-after"]).toBeDefined();

      // The same bucket, not a sibling of it: a first draft is refused too.
      const intakeId = await intakeReadyToDraft(f.harness.app);
      const drafted = await f.harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId },
      });
      expect(drafted.statusCode).toBe(429);

      // And before any database read: a plan that does not exist is refused
      // for the rate, not reported missing.
      const missing = await revise(f.harness, "nope", {
        kind: "replan",
        baseRevisionId: "r",
        days: [0],
        specialists: [],
        note: null,
      });
      expect(missing.statusCode).toBe(429);
    } finally {
      await f.close();
    }
  });

  test("edits spend the edits bucket and leave the runs bucket untouched", async () => {
    const f = await fixture({ rateLimitRunsPerMinute: 2, rateLimitEditsPerMinute: 2 });
    try {
      const view = await draft(f); // runs: one of two
      let base = latestOf(view.plan);
      for (let edit = 0; edit < 2; edit += 1) {
        const response = await revise(f.harness, view.plan.id, {
          kind: "restore",
          baseRevisionId: base.id,
          revision: 1,
        });
        expect(response.statusCode).toBe(200);
        if (response.json.kind !== "revision") throw new Error("no view");
        base = latestOf(response.json.view.plan);
      }

      const refused = await revise(f.harness, view.plan.id, {
        kind: "remove",
        baseRevisionId: base.id,
        itemId: itemOn(base, 0, 0).id,
      });
      expect(refused.statusCode).toBe(429);
      expect(refused.json.error.code).toBe("RATE_LIMITED");
      expect(refused.headers["retry-after"]).toBeDefined();

      // Two edits spent nothing from the runs bucket: its second run is still there.
      const run = await replanRun(f, view.plan.id, {
        days: [0],
        specialists: [],
        baseRevisionId: base.id,
      });
      expect((await runToCompletion(f.harness.app, run.id)).status).toBe("done");
    } finally {
      await f.close();
    }
  });
});

describe("an edit whose client went away", () => {
  test("writes nothing when its signal aborts during the lookup", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const controller = new AbortController();
      controller.abort(new AppError("CANCELED"));

      await expect(
        revisePlan(f.harness.app.context, {
          planId: view.plan.id,
          request: {
            kind: "move",
            baseRevisionId: base.id,
            itemId: itemOn(base, 0, 0).id,
            toDayIndex: 1,
            toPosition: 1,
          },
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "CANCELED" });
      expect((await readView(f.harness, view.plan.id)).plan.revisions).toHaveLength(1);
      expect(vi.mocked(applyEdit)).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});

describe("a pin set during an edit's lookup", () => {
  test("is carried by the revision the edit writes", async () => {
    const f = await fixture();
    try {
      const view = await draft(f);
      const base = latestOf(view.plan);
      const pinned = itemOn(base, 0, 0);
      const gate = { open: deferred(), entered: 0, arrived: [deferred()] };
      f.grounding.travelGate = gate;

      // A lodging to the end of day 3: one transition, so the edit awaits a
      // lookup between its checks and its write.
      const edited = revise(f.harness, view.plan.id, {
        kind: "move",
        baseRevisionId: base.id,
        itemId: itemOn(base, 0, 1).id,
        toDayIndex: 3,
        toPosition: 1,
      });
      await gate.arrived[0]?.promise;
      const pin = await f.harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(view.plan.id, pinned.id),
        payload: { pinned: true },
      });
      expect(pin.statusCode).toBe(200);
      gate.open.resolve();

      const response = await edited;
      expect(response.statusCode).toBe(200);
      if (response.json.kind !== "revision") throw new Error("no view");
      const revision = latestOf(response.json.view.plan);
      expect(revision.revision).toBe(2);
      const kept = revision.days[0]?.items.find((item) => item.candidateId === pinned.candidateId);
      expect(kept?.pinned).toBe(true);
    } finally {
      await f.close();
    }
  });
});
