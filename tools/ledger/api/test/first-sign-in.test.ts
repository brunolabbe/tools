/**
 * The first time an address signed in (lg-75).
 *
 * The identity hook records a member's address once, the first time a request
 * from it is seen, so the admin's screen can mark an email that has never been
 * used. Only the first is kept: a request after it writes nothing, and a
 * directory another connection holds costs that request nothing. The admin's
 * listing is in `households.test.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ROUTES } from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import { Directory } from "../src/directory.ts";
import { directoryPeople } from "../src/import-command.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { migratedBooks } from "./helpers/template.ts";
import {
  ADMIN,
  ALEX,
  SAM,
  STRANGER,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";

const KEY = testKey("key-1");
const HEADER = "cf-access-jwt-assertion";
const NOW = new Date("2026-10-31T12:00:00Z");
const LATER = new Date("2026-10-31T12:10:00Z");

let app: App | undefined;
let dir: string | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

interface Harness {
  app: App;
  directory: Directory;
  lines: string[];
}

async function start(directory: Directory, now: () => Date = () => NOW): Promise<Harness> {
  const lines: string[] = [];
  app = await createApp({
    booksTemplate: migratedBooks(),
    directory,
    config: { dataDir: ":memory:", access: accessConfig() },
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    now,
    fetch: jwksFetch(() => [KEY]).fetch,
  });
  return { app, directory, lines };
}

async function me(target: App, email: string, url: string = ROUTES.me) {
  const token = signToken({
    key: KEY,
    nowSec: Math.floor(NOW.getTime() / 1000),
    claims: { email },
  });
  return await target.server.inject({
    method: "GET",
    url,
    headers: { [HEADER]: token },
  });
}

/** A directory file in a directory of its own, holding the test household. */
function fileDirectory(): { file: string; directory: Directory } {
  dir = mkdtempSync(path.join(tmpdir(), "lg-75-"));
  const file = path.join(dir, "directory.db");
  return { file, directory: memberDirectory(undefined, file) };
}

/** The recorded instants, read through a handle of its own. */
function recorded(file: string): [string, string][] {
  const db = new Database(file, { readonly: true });
  try {
    return db
      .prepare("SELECT address, first_seen_at FROM first_sign_ins ORDER BY address")
      .raw()
      .all() as [string, string][];
  } finally {
    db.close();
  }
}

const warnings = (lines: string[]) =>
  lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["msg"] === "first sign-in not recorded");

describe("a member's first request", () => {
  test("records its address with the instant, and later requests write nothing", async () => {
    const { file, directory } = fileDirectory();
    const record = vi.spyOn(directory, "recordFirstSignIn");
    const { app: target } = await start(directory);

    expect((await me(target, ALEX)).statusCode).toBe(200);
    expect(recorded(file)).toEqual([[ALEX, NOW.toISOString()]]);
    expect((await me(target, ALEX)).statusCode).toBe(200);
    expect((await me(target, ALEX)).statusCode).toBe(200);

    // One write attempt for three requests: the hook remembers.
    expect(record).toHaveBeenCalledTimes(1);
    expect(recorded(file)).toEqual([[ALEX, NOW.toISOString()]]);

    // Another member is their own first.
    expect((await me(target, SAM)).statusCode).toBe(200);
    expect(record).toHaveBeenCalledTimes(2);
    expect(recorded(file).map(([address]) => address)).toEqual([ALEX, SAM]);
  });

  test("after a restart keeps the instant it first had, and takes no write lock to find it there", async () => {
    const { file, directory } = fileDirectory();
    const first = await start(directory);
    await me(first.app, ALEX);
    await first.app.shutdown();
    app = undefined;

    const reopened = Directory.open(file);
    const second = await start(reopened, () => LATER);
    // Another connection holds the write lock for the whole second run: a
    // write, even one that changes nothing, would be refused and logged.
    const holder = new Database(file);
    holder.exec("BEGIN IMMEDIATE");
    try {
      expect((await me(second.app, ALEX)).statusCode).toBe(200);
      expect(warnings(second.lines)).toEqual([]);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }

    expect(recorded(file)).toEqual([[ALEX, NOW.toISOString()]]);
  });

  test("is not an admin's or a stranger's: only a member's address is recorded", async () => {
    const { file, directory } = fileDirectory();
    const { app: target } = await start(directory);

    // An admin in no household is identified, and reads the admin's routes.
    expect((await me(target, ADMIN, ROUTES.adminHouseholds)).statusCode).toBe(200);
    expect((await me(target, STRANGER)).statusCode).toBe(403);

    expect(recorded(file)).toEqual([]);
  });

  test("is not failed by a busy directory, which is tried again on the next request", async () => {
    const { file, directory } = fileDirectory();
    const record = vi.spyOn(directory, "recordFirstSignIn");
    const { app: target, lines } = await start(directory);
    const holder = new Database(file);
    holder.exec("BEGIN IMMEDIATE");
    try {
      const started = Date.now();
      const response = await me(target, ALEX);

      expect(response.statusCode).toBe(200);
      // Not the connection's 5 s busy timeout, which the event loop would spend.
      expect(Date.now() - started).toBeLessThan(2000);
      expect(warnings(lines)).toEqual([
        expect.objectContaining({ level: "warn", code: "SQLITE_BUSY" }),
      ]);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(recorded(file)).toEqual([]);

    expect((await me(target, ALEX)).statusCode).toBe(200);

    expect(record).toHaveBeenCalledTimes(2);
    expect(recorded(file)).toEqual([[ALEX, NOW.toISOString()]]);
    expect((await me(target, ALEX)).statusCode).toBe(200);
    expect(record).toHaveBeenCalledTimes(2);
  });
});

describe("migration 10", () => {
  test("a directory at migration 9 takes it, its records unchanged, and the import still reads it read-only", () => {
    dir = mkdtempSync(path.join(tmpdir(), "lg-75-"));
    const file = path.join(dir, "directory.db");
    const db = new Database(file);
    migrateDirectory(db, 9);
    db.exec(`
      INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
      INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
        VALUES ('${ALEX}', 'home', 'alex', 'add', 'x', 'operator');
    `);
    db.close();

    // The import opens the directory read-only and never migrates it, and reads
    // nothing lg-75 added.
    expect(directoryPeople(file, "home").people).toEqual(["alex"]);
    const still = new Database(file, { readonly: true });
    expect(still.pragma("user_version", { simple: true })).toBe(9);
    still.close();

    const directory = Directory.open(file);
    directory.close();
    const migrated = new Database(file);
    expect(migrated.pragma("user_version", { simple: true })).toBe(10);
    expect(migrated.prepare("SELECT count(*) FROM memberships").pluck().get()).toBe(1);
    expect(migrated.prepare("SELECT count(*) FROM first_sign_ins").pluck().get()).toBe(0);
    migrated.close();
  });

  test("keeps the first row: a second write for an address is skipped, in any spelling, and no row is edited or removed", () => {
    const db = new Database(":memory:");
    migrateDirectory(db);
    const insert = (verb: string, at: string) =>
      db.exec(`${verb} INTO first_sign_ins (address, first_seen_at) VALUES ('${ALEX}', '${at}')`);
    insert("INSERT", "first");

    insert("INSERT OR IGNORE", "second");
    insert("INSERT", "third");
    insert("INSERT OR REPLACE", "fourth");
    expect(db.prepare("SELECT first_seen_at FROM first_sign_ins").pluck().all()).toEqual(["first"]);

    expect(() => db.exec("UPDATE first_sign_ins SET first_seen_at = 'edited'")).toThrow(
      /recorded once, never edited/u,
    );
    expect(() => db.exec("DELETE FROM first_sign_ins")).toThrow(/recorded once, never deleted/u);
    expect(() =>
      db.exec(
        "INSERT INTO first_sign_ins (address, first_seen_at) VALUES ('Not-Lower@Case.test', 'x')",
      ),
    ).toThrow(/CHECK/u);
    db.close();
  });
});
