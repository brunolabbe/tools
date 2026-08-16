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
  errorPayloadSchema,
  type AppErrorPayload,
  type Run,
  type RunStatus,
} from "@planner/contract";
import type { Database } from "better-sqlite3";

interface RunRow {
  id: string;
  plan_id: string;
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

export function insertRun(
  db: Database,
  run: { id: string; planId: string; status: RunStatus; now: string },
): Run {
  db.prepare(
    `INSERT INTO plan_runs
       (id, plan_id, status, roster_size, specialists_done, error_json, started_at, finished_at)
     VALUES (?, ?, ?, NULL, 0, NULL, ?, NULL)`,
  ).run(run.id, run.planId, run.status, run.now);

  return {
    id: run.id,
    planId: run.planId,
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
