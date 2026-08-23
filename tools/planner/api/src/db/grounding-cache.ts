/**
 * The grounding cache's rows.
 *
 * Deliberately only rows: what a `kind` means, how a `key` is normalised and
 * how long an answer is good for are decisions about grounding, and they live
 * in `../grounding/cache.ts` beside the provider that makes them. This file
 * knows a primary key, two JSON columns and two timestamps.
 *
 * **The deadline is stored, never computed on read.** `expires_at` arrives with
 * the row, so a later change to a TTL neither resurrects what had already aged
 * out nor kills what was still good — and "how much of this cache is still
 * good" is one `SELECT` by somebody who has never heard of the TTL table. That
 * is the answerable half of `01-ARCHITECTURE.md`'s "a table, not a service".
 *
 * The half it is not: **`key` does not read back by eye.** It joins its parts
 * with a NUL, which most database browsers and SQLite's own `substr` and `LIKE`
 * truncate at. Lookups by equality are exact — see migration 5's note on the
 * column — but "which question is this row about" is a question for the code
 * that built the key, not for a screen.
 */

import { sourceSchema } from "@planner/contract";
import type { Source } from "@planner/contract";
import type { Database } from "better-sqlite3";

/**
 * One answer, as it sits in the table.
 *
 * `payload` is opaque here and is validated by the caller against the shape its
 * `kind` promises — this file would otherwise have to know what a `locate`
 * answer looks like, which is the knowledge it exists not to hold.
 */
export interface CachedGrounding {
  payload: unknown;
  source: Source;
}

interface CacheRow {
  payload_json: string;
  source_json: string;
  fetched_at: string;
}

/**
 * The still-good answer for one question, or `undefined`.
 *
 * Expiry is part of the read rather than left to eviction: a sweep runs on boot
 * and after a run, so between the two there is always a window in which an
 * expired row is still sitting there, and serving it would make the TTL a
 * decoration. `expires_at > now` is what "still good" means.
 */
export function selectGrounding(
  db: Database,
  { kind, key, now }: { kind: string; key: string; now: string },
): CachedGrounding | undefined {
  const row = db
    .prepare<[string, string, string], CacheRow>(
      "SELECT payload_json, source_json, fetched_at FROM grounding_cache WHERE kind = ? AND key = ? AND expires_at > ?",
    )
    .get(kind, key, now);
  if (row === undefined) return undefined;

  const source = readSource(row);
  if (source === null) return undefined;

  try {
    return { payload: JSON.parse(row.payload_json), source };
  } catch {
    // A row that no longer parses is a miss, not a failure: the answer is
    // re-fetchable, and the alternative is a poisoned row that fails every run
    // touching that question until somebody opens the database by hand.
    return undefined;
  }
}

/**
 * The `Source`, with `fetched_at` as the authority on when the fact was read.
 *
 * The column and the JSON hold the same instant when the row is written, and
 * the column is the one a `SELECT` can filter and sort on — so if they ever
 * disagree, the column wins rather than the two drifting quietly apart.
 * A source that no longer validates makes the row a miss: `provenanceSchema`
 * would refuse the fact downstream anyway, and a grounded fact with no source
 * is the one thing this seam must never hand out.
 */
function readSource(row: CacheRow): Source | null {
  try {
    const parsed = sourceSchema.safeParse(JSON.parse(row.source_json));
    return parsed.success ? { ...parsed.data, fetchedAt: row.fetched_at } : null;
  } catch {
    return null;
  }
}

/**
 * Write one answer, replacing whatever was under that key.
 *
 * `INSERT OR REPLACE` rather than an insert that fails: a re-fetch of a
 * question whose row had expired is the ordinary path, and two runs racing on
 * the same question should end with the newer answer rather than with an error
 * neither of them can do anything about.
 */
export function upsertGrounding(
  db: Database,
  entry: {
    kind: string;
    key: string;
    payload: unknown;
    source: Source;
    fetchedAt: string;
    expiresAt: string;
  },
): void {
  db.prepare<[string, string, string, string, string, string]>(
    `INSERT OR REPLACE INTO grounding_cache (kind, key, payload_json, source_json, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.kind,
    entry.key,
    JSON.stringify(entry.payload),
    JSON.stringify(entry.source),
    entry.fetchedAt,
    entry.expiresAt,
  );
}

/**
 * Drop everything that has aged out. Returns how many rows went.
 *
 * A `DELETE` on boot and after a run, and deliberately not a background timer:
 * this process already has a queue and a shutdown path, and a timer is a thing
 * to leak in tests and to keep a handle alive at exit.
 */
export function deleteExpiredGrounding(db: Database, now: string): number {
  return db.prepare<[string]>("DELETE FROM grounding_cache WHERE expires_at <= ?").run(now).changes;
}

/** Rows currently in the table, expired ones included. For tests and inspection. */
export function countGrounding(db: Database): number {
  const row = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM grounding_cache").get();
  return row?.n ?? 0;
}
