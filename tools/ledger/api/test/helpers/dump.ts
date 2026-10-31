/**
 * Every row of every table, for "nothing changed": lifted out of
 * `workbook-import.test.ts` when lg-67's CSV tests needed the same comparison
 * (its Done when 7 names this one).
 */

import type Database from "better-sqlite3";

/** Every row of every table `sqlite_master` lists, by table name. */
export function dump(db: Database.Database): Record<string, unknown[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
  );
}
