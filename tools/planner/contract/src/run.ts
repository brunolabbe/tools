/**
 * The plan run: a job, what it says about itself while it happens, and what it
 * answers with when asked to start one.
 *
 * A fan-out over a roster takes tens of seconds to minutes, which is too long
 * for a request — so `01-ARCHITECTURE.md`'s _A plan run is a job_ is literal.
 * The states below are that section's diagram, on `@webtools/core`'s transition
 * machinery, which is the same machinery the downloader's job FSM uses and the
 * second real consumer of it.
 *
 * ## Why the states are here rather than in `api`
 *
 * `web` renders the state and `api` enforces it, so neither should own it —
 * exactly the argument that keeps `JOB_TRANSITIONS` in the downloader's
 * contract. A UI that hard-codes "fanning-out means show the roster" against a
 * table it cannot see is a UI that silently stops being right.
 *
 * ## Why the *payload* is here and the *envelope* is not
 *
 * `RunProgress` is what the fan-out knows: which specialists are running, which
 * one just finished, how many are left. `@planner/agent` emits it — it imports
 * this type rather than keeping a parallel one, because two names for one event
 * is how a frame gains a field on one side only.
 *
 * What the agent cannot fill is the clock. It has none, deliberately, the same
 * prohibition `@planner/itinerary` carries: the same inputs must produce the
 * same output twice. So `api` wraps the payload in a `RunEvent` with the run's
 * id and an `at`, and that is the one place a timestamp is read. The types for
 * both live here because `web` parses the frames and `api` writes them.
 */

import { isLegalTransition, terminalStatuses, type TransitionTable } from "@webtools/core";
import { z } from "zod";
import { SPECIALISTS } from "./candidate.ts";
import type { Specialist } from "./candidate.ts";
import { ERROR_CODES } from "./errors.ts";
import type { AppErrorPayload, ErrorCode } from "./errors.ts";

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Written as a const tuple with the union derived from it, matching
 * `ERROR_CODES` and the downloader's `JOB_STATUSES`: one list, so a schema
 * cannot fall out of step with the type.
 *
 * **There is no `interviewing`.** The intake completes before a run is created —
 * it is synchronous, deterministic and fast, because nothing in it calls
 * anything — which is also why the first state can already report a roster size.
 */
export const RUN_STATUSES = [
  /** Accepted, waiting for a slot. `MAX_CONCURRENT_RUNS` is why this state exists. */
  "queued",
  /** The specialists are working. Almost all wall-clock time goes here. */
  "fanning-out",
  /** Every specialist has answered; the composer is packing days. */
  "composing",
  /** The critic is reading the draft. See the note on `RUN_TRANSITIONS`. */
  "reviewing",
  /** A revision is on the plan. */
  "done",
  /** Terminal failure; `error` is populated. */
  "failed",
  /** The user stopped it. No revision was written — see `PlanGap`. */
  "canceled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Legal transitions, exported so the orchestrator and its tests share one
 * definition rather than each encoding the rules.
 *
 * **`composing → done` is legal without passing through `reviewing`**, and that
 * is not an oversight. pl-9 built the critic *inside* `compose()`: it packs,
 * critiques, feeds droppable findings back and packs again, for a bounded number
 * of rounds, and returns once. There is no callback and therefore no moment `api`
 * could honestly observe the changeover at. Emitting `reviewing` around a call
 * that is already half review would be the repo's _never fake progress_ rule
 * broken to make a diagram come true.
 *
 * So the state is kept — it is the architecture's, and a critic pass with its own
 * rounds and its own cost is a thing this tool will want to show — and the edge
 * that skips it is legal so that nothing has to lie in the meantime.
 */
export const RUN_TRANSITIONS: TransitionTable<RunStatus> = {
  queued: ["fanning-out", "failed", "canceled"],
  "fanning-out": ["composing", "failed", "canceled"],
  composing: ["reviewing", "done", "failed", "canceled"],
  reviewing: ["done", "failed", "canceled"],
  done: [],
  failed: [],
  canceled: [],
};

/** Derived from the table above — a status with nowhere to go is terminal. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = terminalStatuses(RUN_TRANSITIONS);

export function canRunTransition(from: RunStatus, to: RunStatus): boolean {
  return isLegalTransition(RUN_TRANSITIONS, from, to);
}

// ---------------------------------------------------------------------------
// What a run can say about itself
// ---------------------------------------------------------------------------

/**
 * What a run can honestly say about itself while it is happening.
 *
 * **The total is known before the first request goes out**, because the roster's
 * size is decided by the budget and not discovered — which is what lets a UI say
 * "4 of 7 specialists done" rather than show a spinner. Nothing here reports a
 * fraction of one specialist's work: a model call has no progress inside it, and
 * inventing one would be _never fake progress_ broken in the one place it is
 * easiest to break.
 *
 * This was `FanOutProgress` in `@planner/agent` until pl-16. It moved rather
 * than being mirrored: the agent still emits it, `api` still forwards it and
 * `web` now renders it, and one type is what keeps a field from being added to
 * only one of those three.
 */
export type RunProgress =
  | { type: "roster"; running: Specialist[]; droppedForBudget: Specialist[]; total: number }
  | { type: "specialist-started"; specialist: Specialist; total: number }
  | {
      type: "specialist-finished";
      specialist: Specialist;
      candidates: number;
      done: number;
      total: number;
    }
  | {
      type: "specialist-failed";
      specialist: Specialist;
      code: ErrorCode;
      done: number;
      total: number;
    };

const specialistSchema = z.enum(SPECIALISTS);

export const runProgressSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("roster"),
    running: z.array(specialistSchema),
    droppedForBudget: z.array(specialistSchema),
    total: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("specialist-started"),
    specialist: specialistSchema,
    total: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("specialist-finished"),
    specialist: specialistSchema,
    candidates: z.number().int().min(0),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("specialist-failed"),
    specialist: specialistSchema,
    code: z.enum(ERROR_CODES),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
]) satisfies z.ZodType<RunProgress>;

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * A run, as `POST /api/plans` answers and as the plan page polls.
 *
 * **`planId` is populated from the first moment**, because the plan row is
 * written *before* the fan-out so the run has somewhere to report to. That is
 * the state `latestRevision` returns `null` for, and it is reachable for as long
 * as the run takes.
 *
 * **`status` is authoritative for cancellation**, the way the downloader's `Job`
 * says: a `canceled` run also carries a `JOB_CANCELED` payload in `error` so a
 * client has copy to render, but a client deciding *whether* it was canceled
 * reads `status` and nothing else.
 */
export interface Run {
  id: string;
  /** The plan this run is drafting. Written before the fan-out starts. */
  planId: string;
  status: RunStatus;
  /**
   * How many specialists this run will pay for.
   *
   * `null` while `queued`, and a real number from `fanning-out` onward — the
   * roster is decided before the first request goes out. Null rather than zero:
   * "not decided yet" and "nobody is running" are different sentences, and only
   * one of them is a bug.
   */
  rosterSize: number | null;
  /** How many of them have answered, failed included. Never exceeds `rosterSize`. */
  specialistsDone: number;
  error: AppErrorPayload | null;
  startedAt: string;
  /** Set when the run reaches a terminal state. */
  finishedAt: string | null;
}

const errorPayloadShape = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<AppErrorPayload>;

export const runSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  status: z.enum(RUN_STATUSES),
  rosterSize: z.number().int().min(0).nullable(),
  specialistsDone: z.number().int().min(0),
  error: errorPayloadShape.nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<Run>;

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/**
 * Server-Sent Events pushed on a run's channel.
 *
 * The envelope `api` adds to `RunProgress`: the run's id, so a frame identifies
 * itself, and an `at`, which is the one field the agent could not fill.
 *
 * Each terminal status gets its own frame carrying the payload that explains it,
 * so a client that only listens never has to synthesise the reason a run ended.
 * A `status` frame is emitted alongside each, so a client that only tracks state
 * can ignore the payload frames entirely — the downloader's `JobEvent` shape,
 * for the same reason.
 */
export type RunEvent =
  /**
   * The whole run, sent once when a client connects.
   *
   * A client that attached after the roster was decided would otherwise be
   * staring at `queued` until the next specialist finished, and there is no
   * honest `RunProgress` to replay for it: every variant but `roster` names a
   * specialist, and inventing one to carry a count would be a fabricated frame.
   * The `Run` already carries the count, so it is sent as itself.
   */
  | { type: "snapshot"; runId: string; run: Run; at: string }
  | { type: "status"; runId: string; status: RunStatus; at: string }
  | { type: "progress"; runId: string; progress: RunProgress; at: string }
  /** The revision is on the plan and readable at `GET /api/plans/:planId`. */
  | { type: "done"; runId: string; planId: string; revisionId: string; at: string }
  | { type: "failed"; runId: string; error: AppErrorPayload; at: string }
  /** Carries the `JOB_CANCELED` payload; `status` remains the authority. */
  | { type: "canceled"; runId: string; error: AppErrorPayload; at: string }
  /** Periodic no-op so intermediaries do not close an idle connection. */
  | { type: "heartbeat"; at: string };

export const runEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    runId: z.string().min(1),
    run: runSchema,
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("status"),
    runId: z.string().min(1),
    status: z.enum(RUN_STATUSES),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("progress"),
    runId: z.string().min(1),
    progress: runProgressSchema,
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("done"),
    runId: z.string().min(1),
    planId: z.string().min(1),
    revisionId: z.string().min(1),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("failed"),
    runId: z.string().min(1),
    error: errorPayloadShape,
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("canceled"),
    runId: z.string().min(1),
    error: errorPayloadShape,
    at: z.iso.datetime(),
  }),
  z.object({ type: z.literal("heartbeat"), at: z.iso.datetime() }),
]) satisfies z.ZodType<RunEvent>;

/** A frame after which there is nothing more to say, and the stream ends. */
export function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === "done" || event.type === "failed" || event.type === "canceled";
}
