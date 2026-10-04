/**
 * The household's people, as the books name them (lg-5).
 *
 * Who may sign in is configuration: `ACCESS_PEOPLE` maps an Access address to a
 * person's name (lg-3). Who the books may name is this table, and a person's id
 * in it **is that configured name** — the same text lg-4 already stores on rules
 * and classifications — so every row stored before the table existed still names
 * someone in it.
 *
 * The configuration is the only writer. At boot, each name it holds that the
 * table does not is added; nothing is ever removed, because a person a stored
 * row names stays named after the configuration stops letting them in. No name
 * is seeded from the repository: a fresh database with no configuration has no
 * people.
 */

import type { Database } from "better-sqlite3";

/** The configured names, once each. Several addresses may map to one person. */
export function configuredPeople(people: ReadonlyMap<string, string>): string[] {
  return [...new Set(people.values())].toSorted();
}

/** Adds every configured person the table does not hold yet. Returns how many were added. */
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
