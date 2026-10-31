/**
 * The test-only books template (lg-69): `createApp({ booksTemplate })` starts
 * every in-memory household from a migrated database instead of migrating an
 * empty one. These pin that it is used when given, that it is the only way to
 * reach it, and that households and apps never share what they start from.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { HOUSEHOLD, accessConfig, memberDirectory } from "./helpers/access.ts";
import { AWAY, twoHouseholds } from "./helpers/households.ts";
import { migratedBooks } from "./helpers/template.ts";

const apps: App[] = [];
let dataDir: string | undefined;

afterEach(async () => {
  for (const app of apps.splice(0)) await app.shutdown();
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function start(options: { template?: Buffer; files?: boolean; two?: boolean }): Promise<App> {
  if (options.files === true) dataDir = mkdtempSync(path.join(tmpdir(), "ledger-template-"));
  const app = await createApp({
    directory: options.two === true ? twoHouseholds() : memberDirectory(),
    config: { dataDir: dataDir ?? ":memory:", access: accessConfig() },
    logger: createLogger({ level: "silent" }),
    now: () => new Date("2026-10-13T12:00:00Z"),
    ...(options.template === undefined ? {} : { booksTemplate: options.template }),
  });
  apps.push(app);
  return app;
}

/** The migrated books with one table the migrations do not make, so a boot from it shows. */
function marked(): Buffer {
  const db = new Database(migratedBooks());
  db.exec("CREATE TABLE lg69_marker (id INTEGER PRIMARY KEY)");
  const bytes = db.serialize();
  db.close();
  return bytes;
}

function hasMarker(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'lg69_marker'").get() !== undefined;
}

describe("the books template (lg-69)", () => {
  test("starts an in-memory household from the template it is given", async () => {
    const app = await start({ template: marked() });

    expect(hasMarker(app.books.of(HOUSEHOLD))).toBe(true);
  });

  test("a boot from the migrated template is the boot migrating would give", async () => {
    const from = await start({ template: migratedBooks() });
    const scratch = await start({});

    const state = (app: App): unknown => {
      const db = app.books.of(HOUSEHOLD);
      return {
        version: db.pragma("user_version", { simple: true }),
        schema: db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all(),
        people: db.prepare("SELECT * FROM people ORDER BY id").all(),
      };
    };
    expect(state(from)).toEqual(state(scratch));
    expect((state(from) as { people: unknown[] }).people).toHaveLength(2);
  });

  test("is reachable only through the option: not given, not used, and not a config key", async () => {
    const app = await start({});

    expect(hasMarker(app.books.of(HOUSEHOLD))).toBe(false);
    expect(Object.keys(loadApiConfig({})).filter((key) => /template/iu.test(key))).toEqual([]);
  });

  test("is ignored for books kept in files", async () => {
    const app = await start({ template: marked(), files: true });

    expect(hasMarker(app.books.of(HOUSEHOLD))).toBe(false);
  });

  test("gives each household, and each app, a copy of its own", async () => {
    const template = migratedBooks();
    const first = await start({ template, two: true });
    const has = (db: Database.Database): boolean =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'only_in_home'").get() !== undefined;

    first.books.of(HOUSEHOLD).exec("CREATE TABLE only_in_home (id INTEGER)");
    const second = await start({ template });

    expect(has(first.books.of(HOUSEHOLD))).toBe(true);
    // Another household of the same app, and the same household of another.
    expect(has(first.books.of(AWAY))).toBe(false);
    expect(has(second.books.of(HOUSEHOLD))).toBe(false);
  });
});
