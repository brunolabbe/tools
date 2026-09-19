/**
 * The run store.
 *
 * Small on purpose: a run is a status, a count and two timestamps. What is
 * deliberately *not* here is the transition rule — whether `composing` may
 * follow `queued` is `RUN_TRANSITIONS` in `@planner/contract`, checked by the
 * orchestrator before it calls `updateRunStatus`. A CHECK constraint or an
 * `if` here would be a second half-copy of a table that `web` also reads, and
 * it is the copy that would go stale.
 *
 * The run survives the process that ran it, which is what makes a restart
 * visible rather than silent: a row still sitting in `fanning-out` with nothing
 * in the queue is a run whose server went away, and it reads as exactly that
 * instead of as a run still working.
 */

import {
  AppError,
  errorPayloadSchema,
  type AppErrorPayload,
  type Run,
  type RunKind,
  type RunStatus,
} from "@planner/contract";
import type { RunUsage } from "@planner/agent";
import type { Database } from "better-sqlite3";

interface RunRow {
  id: string;
  plan_id: string;
  kind: string;
  status: string;
  roster_size: number | null;
  specialists_done: number;
  error_json: string | null;
  started_at: string;
  finished_at: string | null;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    planId: row.plan_id,
    // Cast rather than validated, for `status`'s reason just below: the only
    // writer is `insertRun`, which takes a `RunKind`, and migration 10's
    // DEFAULT is `draft`, which every row written before it was.
    kind: row.kind as RunKind,
    // Cast rather than validated: the only writer is `updateRunStatus` below,
    // which takes a `RunStatus`, and a row that somehow held something else
    // would be a corruption no read path could sensibly recover from.
    status: row.status as RunStatus,
    rosterSize: row.roster_size,
    specialistsDone: row.specialists_done,
    error: readError(row.error_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** A payload that no longer parses reads as no payload; `status` is the authority. */
function readError(raw: string | null): AppErrorPayload | null {
  if (raw === null) return null;
  try {
    const parsed = errorPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Write a new run, which is live until `updateRunStatus` finishes it.
 *
 * `kind` is written explicitly rather than left to migration 10's DEFAULT: a
 * writer relying on the DEFAULT would store `draft` on a re-plan, and nothing
 * would say so.
 *
 * **A second live run for one plan is refused by the database** —
 * `plan_runs_one_live`, migration 10 — and that refusal is `PLAN_BUSY`, never
 * `INTERNAL`. It is the backstop under `api`'s own check, so it holds against
 * a writer that forgot to make one.
 */
export function insertRun(
  db: Database,
  run: { id: string; planId: string; kind: RunKind; status: RunStatus; now: string },
): Run {
  try {
    db.prepare(
      `INSERT INTO plan_runs
         (id, plan_id, kind, status, roster_size, specialists_done, error_json, started_at, finished_at)
       VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, NULL)`,
    ).run(run.id, run.planId, run.kind, run.status, run.now);
  } catch (error: unknown) {
    if (isOneLiveViolation(error)) {
      const live = selectLiveRun(db, run.planId);
      throw new AppError("PLAN_BUSY", undefined, {
        details: live === undefined ? {} : { run: live.id },
        cause: error,
      });
    }
    throw error;
  }

  return {
    id: run.id,
    planId: run.planId,
    kind: run.kind,
    status: run.status,
    rosterSize: null,
    specialistsDone: 0,
    error: null,
    startedAt: run.now,
    finishedAt: null,
  };
}

export function selectRun(db: Database, id: string): Run | undefined {
  const row = db.prepare("SELECT * FROM plan_runs WHERE id = ?").get(id) as RunRow | undefined;
  return row === undefined ? undefined : toRun(row);
}

/**
 * The plan's unfinished run, if it has one.
 *
 * "Unfinished" is `finished_at IS NULL`, the same predicate
 * `plan_runs_one_live` is written over, so there is at most one row to find —
 * and the busy check and the index cannot disagree about what live means.
 */
export function selectLiveRun(db: Database, planId: string): Run | undefined {
  const row = db
    .prepare("SELECT * FROM plan_runs WHERE plan_id = ? AND finished_at IS NULL")
    .get(planId) as RunRow | undefined;
  return row === undefined ? undefined : toRun(row);
}

/**
 * Whether an insert failed on `plan_runs_one_live` rather than on anything
 * else. A partial unique index reports the column it covers, so the message is
 * `plan_runs.plan_id`; the primary key reports `plan_runs.id`, which is a bug
 * and stays one.
 */
function isOneLiveViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes("plan_runs.plan_id");
}

/**
 * Move a run to a new status, and record what came with it.
 *
 * `finishedAt` is set here rather than by the caller, from the same clock read,
 * so a terminal run without one is not representable.
 */
export function updateRunStatus(
  db: Database,
  update: {
    id: string;
    status: RunStatus;
    now: string;
    terminal: boolean;
    error?: AppErrorPayload | null;
  },
): void {
  db.prepare(
    `UPDATE plan_runs
        SET status = ?,
            error_json = COALESCE(?, error_json),
            finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END
      WHERE id = ?`,
  ).run(
    update.status,
    update.error === undefined || update.error === null ? null : JSON.stringify(update.error),
    update.terminal ? 1 : 0,
    update.now,
    update.id,
  );
}

/**
 * What the roster turned out to be, once the fan-out has decided it.
 *
 * Written as one statement with the count reset, because the two only ever move
 * together: the roster is decided before the first request goes out, and nothing
 * has finished at that moment.
 */
export function updateRunRoster(db: Database, id: string, rosterSize: number): void {
  db.prepare("UPDATE plan_runs SET roster_size = ?, specialists_done = 0 WHERE id = ?").run(
    rosterSize,
    id,
  );
}

/** Set rather than incremented: the fan-out already counts, and it is the authority. */
export function updateRunProgress(db: Database, id: string, specialistsDone: number): void {
  db.prepare("UPDATE plan_runs SET specialists_done = ? WHERE id = ?").run(specialistsDone, id);
}

/**
 * What the run spent, written once as it ends (pl-49).
 *
 * Set rather than added to, for `updateRunProgress`'s reason: the fan-out keeps
 * the running total and is the authority on it. Numbers and the configured
 * model's name only — nothing a traveller wrote reaches these columns.
 *
 * Not part of `Run` and not read back by any route: the plan view has no use
 * for a token count, and `@planner/contract`'s `Run` is not widened for a
 * reader that is an operator's report. `cost-report.ts` reads the columns
 * directly.
 */
export function updateRunUsage(
  db: Database,
  record: { id: string; model: string; usage: RunUsage },
): void {
  db.prepare(
    `UPDATE plan_runs
        SET model = ?,
            model_calls = ?,
            input_tokens = ?,
            cache_read_tokens = ?,
            cache_write_tokens = ?,
            output_tokens = ?,
            fallback_calls = ?
      WHERE id = ?`,
  ).run(
    record.model,
    record.usage.calls,
    record.usage.inputTokens,
    record.usage.cacheReadTokens,
    record.usage.cacheWriteTokens,
    record.usage.outputTokens,
    record.usage.fallbackCalls,
    record.id,
  );
}
