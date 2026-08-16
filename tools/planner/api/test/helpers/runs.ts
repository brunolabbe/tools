/**
 * Driving a plan run the way a browser does: an intake answered to the
 * checkpoint, a `POST /api/plans`, and a wait for the job to land.
 *
 * Not a test file — vitest collects `*.test.ts` only.
 *
 * Everything here goes through HTTP or through the app's own context. Nothing
 * reaches into the orchestrator to call `compose` directly: the whole point of
 * pl-16 is that the two halves meet somewhere other than a unit test, so a suite
 * that called them itself would assert the exact thing that was already true.
 */

import { TERMINAL_RUN_STATUSES, type Answer, type Run, type RunEvent } from "@planner/contract";
import { ROUTES, runEventsUrl } from "@planner/contract";
import type { App } from "../../src/index.ts";
import { createApp } from "../../src/index.ts";
import { selectRun } from "../../src/db/runs.ts";
import { answerThroughCore, answered, startIntake, NOW } from "./intakes.ts";

export { NOW };

/** A shape whose roster is six specialists, so the cap of five has to drop one. */
export const OVER_CAP_SHAPE = "multi-city";

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/**
 * A promise somebody else settles.
 *
 * Here rather than inline in each suite because the inline form is a closure
 * that captures nothing from its enclosing function, which the linter correctly
 * objects to — and because every provider that has to be held at the door needs
 * exactly two of these.
 */
export function deferred(): Deferred {
  // Definitely assigned: a promise executor runs synchronously, so `settle`
  // holds a function before this line returns.
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle() };
}

export interface RunHarness {
  app: App;
  close(): Promise<void>;
}

export async function createRunHarness(
  options: Parameters<typeof createApp>[0] = {},
): Promise<RunHarness> {
  const app = await createApp({
    ...options,
    config: { databasePath: ":memory:", logLevel: "silent", ...options.config },
    now: options.now ?? (() => NOW),
  });
  return { app, close: () => app.shutdown() };
}

/**
 * An intake answered as far as the wizard invites, with a shape of the caller's
 * choosing.
 *
 * The shape is preset by id because it is the one answer these suites actually
 * care about — it decides the roster — and everything else takes whatever the
 * tree offers, so a content edit does not turn into a red build here either.
 */
export async function intakeReadyToDraft(app: App, shape = "road-trip"): Promise<string> {
  const started = await startIntake(app.server);
  const preset: Record<string, Answer> = {
    shape: answered({ kind: "single-choice", value: shape }),
  };
  await answerThroughCore(app.server, started.intake.id, preset);
  return started.intake.id;
}

export async function startRunOver(app: App, intakeId: string): Promise<Run> {
  const response = await app.server.inject({
    method: "POST",
    url: ROUTES.plans,
    payload: { intakeId },
  });
  if (response.statusCode !== 202) {
    throw new Error(`starting a run answered ${String(response.statusCode)}: ${response.body}`);
  }
  return response.json<Run>();
}

/**
 * Wait for the run to reach a terminal state.
 *
 * Polled rather than subscribed, which looks like the worse choice and is not:
 * the hub is **not a replay log**, so a run that finished before the subscribe
 * landed emits its terminal frame to nobody and the wait never ends. Against the
 * scripted provider that race is not rare, it is the common case. The store is
 * the authority a real client also reconciles against, so this reads it.
 */
export async function runToCompletion(app: App, runId: string): Promise<Run> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const run = readRunRow(app, runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
    if (Date.now() > deadline) {
      throw new Error(`run ${runId} was still ${run.status} after 10s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The run as it sits on disk — the authority, unlike a frame in flight. */
export function readRunRow(app: App, runId: string): Run {
  const run = selectRun(app.context.db, runId);
  if (run === undefined) throw new Error(`no run ${runId}`);
  return run;
}

export function isTerminal(status: Run["status"]): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/** Every SSE frame the stream produced, parsed. Used after a run has settled. */
export async function readEventStream(app: App, runId: string): Promise<RunEvent[]> {
  const response = await app.server.inject({ method: "GET", url: runEventsUrl(runId) });
  return response.body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as RunEvent);
}
