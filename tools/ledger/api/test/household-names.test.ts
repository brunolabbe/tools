/**
 * A household renamed (lg-77): a record appended to `household_names`, never an
 * update of the `households` row, and the latest record is what the household
 * is called. Each rule is held twice, as in `person-names.test.ts`: by
 * `Directory`, with a sentence for whoever renamed, and by the schema, so a
 * writer that skips the class is refused too. The routes are in
 * `households.test.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import { Directory } from "../src/directory.ts";
import { directoryPeople } from "../src/import-command.ts";
import { ALEX, SAM } from "./helpers/access.ts";

const AT = new Date("2026-10-31T12:00:00Z");
const CHANGE = { by: "operator", at: AT };
const KIM = "kim@away.test";

/** home ("Home") holds alex; away ("Away") holds kim. */
function directoryWithHouseholds(): Directory {
  const directory = Directory.open(":memory:");
  directory.addHousehold({ id: "home", name: "Home", ...CHANGE });
  directory.addHousehold({ id: "away", name: "Away", ...CHANGE });
  directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
  directory.addMember({ household: "away", address: KIM, person: "kim", ...CHANGE });
  return directory;
}

/** A bare handle on a migrated directory holding home, to write past the class. */
function raw(): Database.Database {
  const db = new Database(":memory:");
  migrateDirectory(db);
  db.exec(
    "INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator')",
  );
  return db;
}

function rename(db: Database.Database, household: string, name: string): void {
  db.prepare(
    `INSERT INTO household_names (household_id, name, named_at, named_by)
     VALUES (?, ?, 'x', 'raw')`,
  ).run(household, name);
}

/** A value the signature does not allow, written as the caller would pass it. */
function untyped<T>(value: unknown): T {
  return value as T;
}

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

describe("a household rename", () => {
  test("appends one record, and the latest is what household() and households() call it", () => {
    const directory = directoryWithHouseholds();

    expect(
      directory.renameHousehold({ household: "home", name: "  Our place ", by: ALEX, at: AT }),
    ).toEqual({ id: "home", name: "Our place" });
    directory.renameHousehold({ household: "home", name: "Chez nous", by: SAM, at: AT });

    expect(directory.household("home")).toEqual({ id: "home", name: "Chez nous" });
    // A household never renamed is called by the name it was created with.
    expect(directory.households()).toEqual([
      { id: "away", name: "Away" },
      { id: "home", name: "Chez nous" },
    ]);
    expect(directory.history("home").slice(-2)).toEqual([
      { action: "rename-household", name: "Our place", at: AT.toISOString(), by: ALEX },
      { action: "rename-household", name: "Chez nous", at: AT.toISOString(), by: SAM },
    ]);
    expect(directory.history("away").map((record) => record.action)).toEqual(["add"]);
    directory.close();
  });

  test("the schema keeps every record and the households row: an UPDATE, a DELETE and a REPLACE are each refused", () => {
    const db = raw();
    rename(db, "home", "Our place");

    for (const statement of [
      "UPDATE household_names SET name = 'Someone'",
      "DELETE FROM household_names",
      `INSERT OR REPLACE INTO household_names (id, household_id, name, named_at, named_by)
       VALUES (1, 'home', 'Someone', 'x', 'raw')`,
      `REPLACE INTO household_names (id, household_id, name, named_at, named_by)
       VALUES (1, 'home', 'Someone', 'x', 'raw')`,
      // The households row keeps the name it was created with (migration 7's trigger).
      "UPDATE households SET name = 'Someone'",
    ]) {
      expect(() => db.exec(statement), statement).toThrow(/appended, never/u);
    }

    expect(db.prepare("SELECT id, household_id, name FROM household_names").all()).toEqual([
      { id: 1, household_id: "home", name: "Our place" },
    ]);
    expect(db.prepare("SELECT name FROM households").all()).toEqual([{ name: "Home" }]);
    expect(db.prepare("SELECT household_id, name FROM current_household_names").all()).toEqual([
      { household_id: "home", name: "Our place" },
    ]);
    db.close();
  });

  test("is a name of 1 to 80 characters, trimmed, by the code and by the schema", () => {
    const directory = directoryWithHouseholds();
    for (const name of ["", "   ", "H".repeat(81)]) {
      expect(
        code(() => directory.renameHousehold({ household: "home", name, ...CHANGE })),
        JSON.stringify(name),
      ).toBe("BAD_REQUEST");
    }
    expect(directory.household("home")?.name).toBe("Home");
    expect(
      directory.renameHousehold({ household: "home", name: "H".repeat(80), ...CHANGE }),
    ).toEqual({ id: "home", name: "H".repeat(80) });
    directory.close();

    const db = raw();
    for (const name of ["", " Ours", "Ours ", "H".repeat(81)]) {
      expect(() => rename(db, "home", name), JSON.stringify(name)).toThrow(/CHECK/u);
    }
    db.close();
  });

  test("of a household the directory does not hold is HOUSEHOLD_NOT_FOUND, by the code and by the schema", () => {
    const directory = directoryWithHouseholds();
    expect(
      code(() => directory.renameHousehold({ household: "nowhere", name: "Ours", ...CHANGE })),
    ).toBe("HOUSEHOLD_NOT_FOUND");
    directory.close();

    const db = raw();
    expect(() => rename(db, "nowhere", "Ours")).toThrow(/FOREIGN KEY/u);
    db.close();
  });

  test("a value that is not of its type is refused as BAD_REQUEST before any statement runs", () => {
    const directory = directoryWithHouseholds();
    for (const bad of [
      { household: untyped<string>(7), name: "Ours", ...CHANGE },
      { household: "home", name: untyped<string>(null), ...CHANGE },
      { household: "home", name: "Ours", by: untyped<string>(7), at: AT },
      { household: "home", name: "Ours", by: "operator", at: new Date("x") },
    ]) {
      expect(code(() => directory.renameHousehold(bad))).toBe("BAD_REQUEST");
    }
    expect(directory.household("home")?.name).toBe("Home");
    directory.close();
  });

  test("ADDRESS_ALREADY_A_MEMBER names the household by the name it is called now, never its id", () => {
    const directory = directoryWithHouseholds();
    directory.renameHousehold({ household: "away", name: "Le chalet", ...CHANGE });

    let message = "";
    try {
      directory.addMember({ household: "home", address: KIM, person: "kim", ...CHANGE });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toBe(
      `That email already belongs to the household "Le chalet", as kim. Remove it first.`,
    );
    directory.close();
  });
});

describe("migration 9", () => {
  test("a directory at migration 8 takes it on its next open, its records unchanged and every household called as it was", () => {
    const db = new Database(":memory:");
    migrateDirectory(db, 8);
    db.exec(`
      INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
      INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
        VALUES ('${ALEX}', 'home', 'alex', 'add', 'x', 'operator');
    `);
    const tables = ["households", "memberships", "person_names", "retirements", "people"];
    const read = () => tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const before = read();

    migrateDirectory(db);

    expect(db.pragma("user_version", { simple: true })).toBe(10);
    expect(read()).toEqual(before);
    const directory = new Directory(db);
    expect(directory.households()).toEqual([{ id: "home", name: "Home" }]);
    expect(directory.history("home")).toEqual([
      { address: ALEX, person: "alex", action: "add", at: "x", by: "operator" },
    ]);
    directory.close();
  });

  // lg-74's gate 1, F2: openReadOnly never migrates, so the import must not read
  // current_household_names on a directory the API has not opened since lg-77.
  test("the import still resolves its household in a directory at migration 8, opened read-only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lg-77-"));
    try {
      const file = path.join(dir, "directory.db");
      const db = new Database(file);
      migrateDirectory(db, 8);
      db.exec(`
        INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
        INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
          VALUES ('${ALEX}', 'home', 'alex', 'add', 'x', 'operator');
      `);
      db.close();

      expect(directoryPeople(file, "home").people).toEqual(["alex"]);
      expect(code(() => directoryPeople(file, "nowhere"))).toBe("BAD_REQUEST");

      const still = new Database(file, { readonly: true });
      expect(still.pragma("user_version", { simple: true })).toBe(8);
      still.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
