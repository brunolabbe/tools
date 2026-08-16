/**
 * The plan run, end to end over HTTP.
 *
 * pl-5 built the fan-out and pl-9 built the composer, and until pl-16 **the only
 * place the two met was a unit test**. So the assertions that matter here are
 * the ones about the join: a run started over HTTP leaves a `PlanDetail` in the
 * database that `GET` returns, and a plan that came out with a hole in it says
 * so *out of the database* rather than only in memory.
 *
 * Everything runs against the scripted provider, with no key and no network —
 * which is the point of the seam and the reason CI has something deterministic
 * to assert against.
 */

import { describe, expect, test } from "vitest";
import {
  latestRevision,
  planDetailSchema,
  runSchema,
  ROUTES,
  planUrl,
  runCancelUrl,
  type PlanDetail,
  type Run,
} from "@planner/contract";
import { AppError } from "@planner/contract";
import type { ModelProvider, ModelReply, ModelRequest } from "@planner/agent";
import { readMarkers } from "@planner/agent";
import {
  createRunHarness,
  deferred,
  intakeReadyToDraft,
  OVER_CAP_SHAPE,
  readRunRow,
  runToCompletion,
  startRunOver,
  type RunHarness,
} from "./helpers/runs.ts";

async function readPlan(harness: RunHarness, planId: string): Promise<PlanDetail> {
  const response = await harness.app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanDetail>();
}

describe("starting a run", () => {
  test("answers with a run, and the plan it is drafting already reads", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      expect(runSchema.safeParse(run).success).toBe(true);
      expect(run.status).toBe("queued");
      // Knowable only once the roster is decided, which is as the fan-out
      // starts. Null rather than zero: "not decided" is not "nobody is running".
      expect(run.rosterSize).toBeNull();

      // The plan row is written *before* the fan-out so the run has somewhere to
      // report to, which makes a revision-less plan a real and reachable state.
      const plan = await readPlan(harness, run.planId);
      expect(plan.revisions).toEqual([]);
      expect(latestRevision(plan)).toBeNull();
      expect(plan.brief).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  test("refuses a brief too thin to draft from, before anything is written", async () => {
    const harness = await createRunHarness();
    try {
      // An intake with no answers at all: every required slot is empty.
      const started = await harness.app.server.inject({ method: "POST", url: ROUTES.intakes });
      const intakeId = started.json<{ intake: { id: string } }>().intake.id;

      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("BRIEF_INCOMPLETE");
      // Nothing was created on the way to refusing.
      const plans = harness.app.context.db.prepare("SELECT COUNT(*) AS n FROM plans").get() as {
        n: number;
      };
      expect(plans.n).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("an unknown intake is a 404 about the intake, not about a plan", async () => {
    const harness = await createRunHarness();
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId: "nope" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("INTAKE_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });
});

describe("a run that finishes", () => {
  test("fans out, composes, and leaves a plan the GET returns", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.status).toBe("done");
      expect(finished.finishedAt).not.toBeNull();
      expect(finished.rosterSize).not.toBeNull();
      expect(finished.specialistsDone).toBe(finished.rosterSize);

      const plan = await readPlan(harness, run.planId);
      // Out of the database and over the wire, not out of memory.
      expect(planDetailSchema.safeParse(plan).success).toBe(true);
      expect(plan.candidates.length).toBeGreaterThan(0);

      const revision = latestRevision(plan);
      expect(revision).not.toBeNull();
      expect(revision?.revision).toBe(1);
      expect(revision?.parentRevisionId).toBeNull();
      expect(revision?.days.length).toBeGreaterThan(0);
      expect(plan.latestRevision).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test("every placed item points at a candidate the run actually stored", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      const plan = await readPlan(harness, run.planId);
      const known = new Set(plan.candidates.map((candidate) => candidate.id));
      const placed = (latestRevision(plan)?.days ?? []).flatMap((day) => day.items);

      expect(placed.length).toBeGreaterThan(0);
      for (const item of placed) expect(known).toContain(item.candidateId);
    } finally {
      await harness.close();
    }
  });

  test("records which run minted each candidate", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      // Migration 2 anticipated this column and migration 4 added it: "which
      // agents ran, and why" is the first question anyone debugging a bad plan
      // asks, and it should not cost a parse of every candidate to answer.
      const rows = harness.app.context.db
        .prepare("SELECT DISTINCT run_id FROM plan_candidates")
        .all() as { run_id: string | null }[];
      expect(rows).toEqual([{ run_id: run.id }]);
    } finally {
      await harness.close();
    }
  });
});

/**
 * A provider that fails one specialist and answers normally for the rest.
 *
 * §7 and the repo's _never fake progress_ rule: one specialist failing must not
 * fail the run, and the plan must **say** that part was not checked rather than
 * quietly lacking a section.
 */
class OneSpecialistFails implements ModelProvider {
  readonly name = "fails-one";
  readonly model = "fails-one";
  readonly #failing: string;
  readonly #inner: ModelProvider;

  constructor(failing: string, inner: ModelProvider) {
    this.#failing = failing;
    this.#inner = inner;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    const markers = readMarkers(request.system);
    if (markers?.specialist === this.#failing) {
      throw new AppError("AGENT_UNAVAILABLE");
    }
    return await this.#inner.send(request);
  }
}

describe("a run with a hole in it", () => {
  test("ships the plan and names the gap, out of the database", async () => {
    const { ScriptedProvider } = await import("@planner/agent");
    const harness = await createRunHarness({
      model: new OneSpecialistFails("lodging", new ScriptedProvider()),
    });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      // The run ships. One specialist failing is a gap, not a failure.
      expect(finished.status).toBe("done");

      const plan = await readPlan(harness, run.planId);
      const gaps = latestRevision(plan)?.gaps ?? [];
      const lodging = gaps.find((gap) => gap.specialist === "lodging");
      expect(lodging?.reason).toBe("specialist-failed");
      // Told in the user's terms — never a stack trace and never a code.
      expect(lodging?.detail).not.toContain("AGENT_UNAVAILABLE");
    } finally {
      await harness.close();
    }
  });

  test("degrades a roster over MAX_SPECIALISTS, and the drop is on the stored revision", async () => {
    const harness = await createRunHarness();
    try {
      // `multi-city` rosters six; the cap is five, so the last out of
      // `SPECIALIST_ORDER` is dropped before a single request goes out.
      const intakeId = await intakeReadyToDraft(harness.app, OVER_CAP_SHAPE);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);

      expect(finished.rosterSize).toBe(harness.app.config.maxSpecialists);

      const plan = await readPlan(harness, run.planId);
      const dropped = (latestRevision(plan)?.gaps ?? []).filter(
        (gap) => gap.reason === "specialist-dropped-for-budget",
      );
      // The cap is a real constraint rather than a number nothing reaches, and
      // the plan admits the cost rather than hiding it. `budget` is last in
      // `SPECIALIST_ORDER` because the composer sums the cost bands in code.
      expect(dropped.map((gap) => gap.specialist)).toEqual(["budget"]);
    } finally {
      await harness.close();
    }
  });
});

/** Blocks in the provider until released, so a run can be canceled mid-fan-out. */
class BlockingProvider implements ModelProvider {
  readonly name = "blocking";
  readonly model = "blocking";
  readonly #entered = deferred();
  #inFlight = 0;
  aborted = 0;

  /** Resolves once at least one specialist is inside `send` and waiting. */
  get entered(): Promise<void> {
    return this.#entered.promise;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  async send(request: ModelRequest): Promise<ModelReply> {
    this.#inFlight += 1;
    this.#entered.resolve();
    return await new Promise<ModelReply>((_resolve, reject) => {
      const stop = (): void => {
        this.aborted += 1;
        reject(new AppError("JOB_CANCELED"));
      };
      // Already aborted means the listener would never fire, and this promise
      // would never settle — which is a hang rather than a failed assertion.
      if (request.signal?.aborted === true) stop();
      else request.signal?.addEventListener("abort", stop);
    });
  }
}

describe("cancelling a run", () => {
  test("stops the provider calls, ends as canceled, and writes no revision", async () => {
    const provider = new BlockingProvider();
    const harness = await createRunHarness({ model: provider });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      // Wait until the fan-out is genuinely in flight, or "canceled" would only
      // prove that a queued run can be dropped.
      await provider.entered;
      expect(provider.inFlight).toBeGreaterThan(0);

      const response = await harness.app.server.inject({
        method: "POST",
        url: runCancelUrl(run.id),
      });
      expect(response.statusCode).toBe(200);

      const finished = await runToCompletion(harness.app, run.id);
      expect(finished.status).toBe("canceled");

      // The trap the brief names first: a cancel that only moved a row leaves
      // the fan-out running and the bill accruing. Every in-flight request saw
      // the abort.
      expect(provider.aborted).toBe(provider.inFlight);

      const plan = await readPlan(harness, run.planId);
      expect(plan.revisions).toEqual([]);
      expect(latestRevision(plan)).toBeNull();
      // A cancellation is not a `PlanGap`: a canceled draft must not look like a
      // completed one with holes, so there is no revision to carry one.
      expect(plan.latestRevision).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("cancelling a finished run is a no-op, not an error", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      const response = await harness.app.server.inject({
        method: "POST",
        url: runCancelUrl(run.id),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Run>().status).toBe("done");
    } finally {
      await harness.close();
    }
  });

  test("cancelling an unknown run is a 404", async () => {
    const harness = await createRunHarness();
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: runCancelUrl("nope"),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("JOB_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });
});

describe("run creation is rate-limited per client", () => {
  test("refuses past the burst with a 429 a client can act on", async () => {
    const harness = await createRunHarness({ config: { rateLimitRunsPerMinute: 2 } });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);

      const first = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId },
      });
      const second = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId },
      });
      const third = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.plans,
        payload: { intakeId },
      });

      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);
      // A plan run is a roster of model calls; without this, one endpoint is a
      // stranger spending the deployment's budget.
      expect(third.statusCode).toBe(429);
      expect(third.json<{ error: { code: string } }>().error.code).toBe("RATE_LIMITED");
      expect(third.headers["retry-after"]).toBeDefined();

      await runToCompletion(harness.app, first.json<Run>().id);
      await runToCompletion(harness.app, second.json<Run>().id);
    } finally {
      await harness.close();
    }
  });

  test("is off when the limit is zero", async () => {
    const harness = await createRunHarness({ config: { rateLimitRunsPerMinute: 0 } });
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const runs: Run[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await harness.app.server.inject({
          method: "POST",
          url: ROUTES.plans,
          payload: { intakeId },
        });
        expect(response.statusCode).toBe(202);
        runs.push(response.json<Run>());
      }
      for (const run of runs) await runToCompletion(harness.app, run.id);
    } finally {
      await harness.close();
    }
  });
});

describe("the run row", () => {
  test("counts the specialists as they answer", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      await runToCompletion(harness.app, run.id);

      const stored = readRunRow(harness.app, run.id);
      expect(stored.rosterSize).toBeGreaterThan(0);
      // Never more than the roster: the count comes from the fan-out, which is
      // the authority, rather than from an increment here.
      expect(stored.specialistsDone).toBe(stored.rosterSize);
    } finally {
      await harness.close();
    }
  });
});
