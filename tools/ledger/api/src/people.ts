/**
 * The household's people, as the books name them (lg-5).
 *
 * Who may sign in, and under which name, is the household directory (lg-20).
 * Who the books may name is this table, and a person's id in it **is that
 * name** — the same text lg-4 already stores on rules and classifications — so
 * every row stored before the table existed still names someone in it.
 *
 * Two writers, both of names the household already uses. Migration 3 enrols
 * every person id lg-4 had stored on a rule or a classification; then each name
 * the household's current members stand under that the table does not hold is
 * added — at boot, and whenever a request shows one the table lacks, which is how
 * a member added since boot arrives. Nothing is ever removed, because a person a
 * stored row names stays named after they stop being able to sign in (a name is
 * permanent: `docs/00-ANALYSIS.md` §7). No name is seeded from the repository: a
 * fresh database with an empty directory has no people.
 */

import type { Database } from "better-sqlite3";

/** Adds every name the table does not hold yet. Returns how many were added. */
export function enrollPeople(db: Database, ids: readonly string[], now: Date): number {
  const insert = db.prepare("INSERT OR IGNORE INTO people (id, added_at) VALUES (?, ?)");
  const at = now.toISOString();
  return db
    .transaction(() => ids.reduce((added, id) => added + insert.run(id, at).changes, 0))
    .immediate();
}

/** Every person the books may name, in id order. */
export function knownPeople(db: Database): string[] {
  return (db.prepare("SELECT id FROM people ORDER BY id").all() as { id: string }[]).map(
    (row) => row.id,
  );
}

/**
 * `enrollPeople`, remembering what the table already holds so that the request
 * that finds nothing new — every request but the first after a member is added
 * — writes nothing. The memory only ever lags the table: nothing removes a
 * person, so a name it lacks costs one `INSERT OR IGNORE`, never a wrong answer.
 */
export function createEnroller(db: Database, now: () => Date): (ids: readonly string[]) => number {
  const known = new Set(knownPeople(db));
  return (ids) => {
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length === 0) return 0;
    const added = enrollPeople(db, missing, now());
    for (const id of missing) known.add(id);
    return added;
  };
}
