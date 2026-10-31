/**
 * An already-migrated books database to boot from (lg-69).
 *
 * Every `createApp` migrates an empty `:memory:` database per household, which
 * costs 9.7 to 17 ms; deserialising a migrated one costs 0.45 ms, and the api
 * suite boots about 550 apps. A test passes `booksTemplate: migratedBooks()` to
 * `createApp`, nothing else changes, and the template is built from the same
 * `configure` and `applyMigrations` the app runs, so it cannot drift from them.
 *
 * Built once per test file: vitest gives each file its own module registry, so
 * the cache below lives as long as the file does. With `isolate: false`
 * (repo-129) it would be once per worker.
 */

import Database from "better-sqlite3";
import { applyMigrations, configure } from "../../src/db/schema.ts";

let template: Buffer | undefined;

/** The migrated, empty books as bytes. The same buffer every call; never mutate it. */
export function migratedBooks(): Buffer {
  if (template === undefined) {
    const db = new Database(":memory:");
    try {
      configure(db);
      applyMigrations(db);
      template = db.serialize();
    } finally {
      db.close();
    }
  }
  return template;
}
