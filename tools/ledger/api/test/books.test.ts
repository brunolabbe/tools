/**
 * Each household's books, a file of its own (lg-21): where the file is, how a
 * household added while the app runs gets one, and what lg-20's gate left on
 * the boot and enrol path (step 9: F4, F5 and F8).
 *
 * Real files throughout, in a private temp directory: the point is which file
 * a household's records land in, which `:memory:` cannot show.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, PeopleResponse } from "@ledger/contract";
import { householdBooksPath } from "../src/books.ts";
import { configure, migrate } from "../src/db/schema.ts";
import { Directory } from "../src/directory.ts";
import { runHouseholdCommand } from "../src/household-command.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import {
  ALEX,
  HOUSEHOLD,
  SAM,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-10-12T12:00:00Z");
const CHANGE = { by: "operator", at: NOW };
const KIM = "kim@away.test";

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ledger-books-"));
});

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** The directory as a file in the temp directory, as the image keeps it. */
function directoryFile(): string {
  return path.join(dir, "directory.db");
}

async function start(directory: Directory, lines: string[] = []): Promise<App> {
  app = await createApp({
    directory,
    config: { dataDir: dir, access: accessConfig() },
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
  });
  return app;
}

async function send(target: App, email: string, url: string) {
  const token = signToken({
    key: KEY,
    nowSec: Math.floor(NOW.getTime() / 1000),
    claims: { email },
  });
  return await target.server.inject({
    method: "GET",
    url,
    headers: { "cf-access-jwt-assertion": token },
  });
}

function people(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT id FROM people ORDER BY id").all() as { id: string }[]).map(
      (row) => row.id,
    );
  } finally {
    db.close();
  }
}

function version(file: string): number {
  const db = new Database(file, { readonly: true });
  try {
    return Number(db.pragma("user_version", { simple: true }));
  } finally {
    db.close();
  }
}

/** The boot's warnings that the directory has no members, out of a captured log. */
function warned(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["level"] === "warn" && String(line["msg"]).includes("no members"));
}

/** The away household, with kim and an alex of its own, written into `directory`. */
function addAway(directory: Directory): void {
  directory.addHousehold({ id: "away", name: "The other household", ...CHANGE });
  directory.addMember({ household: "away", address: KIM, person: "kim", ...CHANGE });
  directory.addMember({ household: "away", address: "alex@away.test", person: "alex", ...CHANGE });
}

describe("a household's books", () => {
  test("are households/<id>.db in the data directory, one file each, opened at boot", async () => {
    const directory = memberDirectory();
    addAway(directory);

    await start(directory);

    const home = householdBooksPath(dir, HOUSEHOLD);
    const away = householdBooksPath(dir, "away");
    expect(home).toBe(path.join(dir, "households", "home.db"));
    expect(existsSync(home)).toBe(true);
    expect(existsSync(away)).toBe(true);
    expect(people(home)).toEqual(["alex", "sam"]);
    expect(people(away)).toEqual(["alex", "kim"]);
    expect(version(away)).toBe(version(home));
    expect(version(home)).toBeGreaterThan(0);
  });

  test("a household added while the app runs gets a migrated file and its people on first use", async () => {
    const directory = memberDirectory();
    const target = await start(directory);
    const away = householdBooksPath(dir, "away");
    addAway(directory);
    expect(existsSync(away)).toBe(false);

    const response = await send(target, KIM, ROUTES.people);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<PeopleResponse>()).toMatchObject({ people: ["alex", "kim"] });
    expect(existsSync(away)).toBe(true);
    expect(version(away)).toBe(version(householdBooksPath(dir, HOUSEHOLD)));
    expect(people(away)).toEqual(["alex", "kim"]);
    // And the first household's books are as they were.
    expect(people(householdBooksPath(dir, HOUSEHOLD))).toEqual(["alex", "sam"]);
  });

  test("a household id that would land anywhere but households/ names no file", () => {
    for (const id of [
      "../x",
      "a/b",
      "a\\b",
      "..",
      ".",
      "",
      "Home",
      "con",
      "home.db",
      "h\u0000me",
    ]) {
      expect(() => householdBooksPath(dir, id), JSON.stringify(id)).toThrow(/households/u);
    }
    expect(householdBooksPath(dir, "away")).toBe(path.join(dir, "households", "away.db"));
  });

  test("a data directory that is a file is refused at boot, naming DATABASE_PATH", async () => {
    // What a stale DATABASE_PATH from before lg-21 would name.
    const file = path.join(dir, "ledger.db");
    writeFileSync(file, "");

    await expect(
      createApp({
        directory: memberDirectory(),
        config: { dataDir: file, logLevel: "silent", access: accessConfig() },
      }),
    ).rejects.toThrow(/DATABASE_PATH names a file/u);
  });

  test("shutdown closes every household's books", async () => {
    const directory = memberDirectory();
    addAway(directory);
    const target = await start(directory);
    const handles = [target.books.of(HOUSEHOLD), target.books.of("away")];

    await target.shutdown();
    app = undefined;

    expect(handles.map((handle) => handle.open)).toEqual([false, false]);
  });
});

// lg-21 step 9: what lg-20's gate 1 left on the boot and enrol path, fixed here
// because this ticket rewrites both.
describe("the boot and enrol path (lg-20's gate, F4, F5, F8)", () => {
  test("F4: boot warns when the directory has no members, and not when it has", async () => {
    const empty: string[] = [];
    await start(Directory.open(":memory:"), empty);
    await app?.shutdown();
    const filled: string[] = [];
    await start(memberDirectory(), filled);

    expect(warned(empty)).toHaveLength(1);
    expect(warned(filled)).toHaveLength(0);
  });

  test("F5: a write-locked books file refuses only the person it could not enrol", async () => {
    const directory = memberDirectory([[ALEX, "alex"]]);
    const target = await start(directory);
    directory.addMember({ household: HOUSEHOLD, address: SAM, person: "sam", ...CHANGE });
    // The import command, mid-import: another connection holds the write lock.
    const other = new Database(householdBooksPath(dir, HOUSEHOLD));
    try {
      other.prepare("BEGIN IMMEDIATE").run();

      const startedAt = Date.now();
      const alex = await send(target, ALEX, ROUTES.people);
      const sam = await send(target, SAM, ROUTES.me);
      const elapsedMs = Date.now() - startedAt;

      // alex is served, without sam, and nobody waited out the 5 s busy timeout.
      expect(alex.statusCode, alex.body).toBe(200);
      expect(alex.json<PeopleResponse>()).toMatchObject({ people: ["alex"] });
      expect(sam.statusCode).toBe(504);
      expect(sam.json<ErrorResponse>().error).toMatchObject({ code: "TIMEOUT", retryable: true });
      expect(elapsedMs).toBeLessThan(2000);

      other.prepare("ROLLBACK").run();

      expect((await send(target, SAM, ROUTES.me)).statusCode).toBe(200);
      expect((await send(target, ALEX, ROUTES.people)).json<PeopleResponse>()).toMatchObject({
        people: ["alex", "sam"],
      });
    } finally {
      other.close();
    }
  });

  test("F8: the household command, a second connection, removes and adds, and the next request sees each", async () => {
    const file = directoryFile();
    const target = await start(memberDirectory(undefined, file));
    const run = (...args: string[]) =>
      runHouseholdCommand(args, {
        stdout: () => undefined,
        stderr: () => undefined,
        env: { DIRECTORY_PATH: file },
        cwd: dir,
        now: () => NOW,
      });
    expect((await send(target, SAM, ROUTES.me)).statusCode).toBe(200);

    expect(run("remove", SAM)).toBe(0);
    expect((await send(target, SAM, ROUTES.me)).statusCode).toBe(403);
    expect((await send(target, ALEX, ROUTES.me)).statusCode).toBe(200);

    expect(run("member", HOUSEHOLD, SAM, "sam")).toBe(0);
    expect((await send(target, SAM, ROUTES.me)).statusCode).toBe(200);

    // And a household the command adds gets its books on its first request.
    expect(run("add", "away", "Away")).toBe(0);
    expect(run("member", "away", KIM, "kim")).toBe(0);
    const kim = await send(target, KIM, ROUTES.people);
    expect(kim.statusCode, kim.body).toBe(200);
    expect(kim.json<PeopleResponse>()).toMatchObject({ people: ["kim"] });
    expect(existsSync(householdBooksPath(dir, "away"))).toBe(true);
  });
});

/** A request's status, and how long it took to answer. */
async function timed(run: () => Promise<{ statusCode: number }>) {
  const startedAt = Date.now();
  const response = await run();
  return { status: response.statusCode, ms: Date.now() - startedAt };
}

// lg-21's gate 1, F3: F5's refusal held only for a household already open. The
// first open of a household added since boot waited out the lock and answered
// 500, and so did a health probe, each for 5 s on the event loop.
describe("the first open of a household whose books another process holds locked", () => {
  /** Boots with home only, then adds away, whose file `prepare` makes and locks. */
  async function lockedAway(prepare: (db: Database.Database) => void) {
    const directory = memberDirectory([[ALEX, "alex"]]);
    const target = await start(directory);
    addAway(directory);
    const file = householdBooksPath(dir, "away");
    mkdirSync(path.dirname(file), { recursive: true });
    const other = new Database(file);
    prepare(other);
    other.prepare("BEGIN IMMEDIATE").run();
    return { target, other };
  }

  test.each([
    // The import --write, which made and migrated the file and is writing it.
    // Its books are kept open with only a name missing, so the probe is 200.
    ["migrated", (db: Database.Database) => migrate(db), 200],
    // The import --write into new books: configured, its migration still in
    // its own transaction. Not open, so the probe only has to not be a 500.
    ["not yet migrated", (db: Database.Database) => configure(db), null],
  ])(
    "%s: refuses its member at once, keeps the others served, and opens once unlocked",
    async (_name, prepare, healthStatus) => {
      const { target, other } = await lockedAway(prepare);
      try {
        const kim = await timed(async () => await send(target, KIM, ROUTES.me));
        const health = await timed(
          async () => await target.server.inject({ method: "GET", url: ROUTES.health }),
        );
        const alex = await timed(async () => await send(target, ALEX, ROUTES.people));

        expect(kim.status).toBe(504);
        expect(alex.status).toBe(200);
        expect(health.status).not.toBe(500);
        // (gate 2, N2) The migrated handle was kept: a refusal that closed the
        // file would answer 503 here and still not be a 500.
        if (healthStatus !== null) expect(health.status).toBe(healthStatus);
        expect(Math.max(kim.ms, health.ms, alex.ms)).toBeLessThan(1000);

        other.prepare("ROLLBACK").run();

        const after = await send(target, KIM, ROUTES.people);
        expect(after.statusCode, after.body).toBe(200);
        expect(after.json<PeopleResponse>()).toMatchObject({ people: ["alex", "kim"] });
        expect((await target.server.inject({ method: "GET", url: ROUTES.health })).statusCode).toBe(
          200,
        );
      } finally {
        other.close();
      }
    },
  );
});
