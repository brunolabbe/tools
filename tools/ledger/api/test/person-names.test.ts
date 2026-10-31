/**
 * A person's shown name (lg-33): an admin renames a person in the household
 * directory, and the id the books store never changes. Each rule is held twice,
 * as in `directory.test.ts` — by `Directory`, with a sentence for the admin, and
 * by the schema, so a writer that skips the class is refused too.
 */

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import { Directory } from "../src/directory.ts";
import { ALEX, SAM } from "./helpers/access.ts";

const AT = new Date("2026-10-17T12:00:00Z");
const CHANGE = { by: "operator", at: AT };
const ADMIN = "admin@example.test";
const RENAME = { by: ADMIN, at: AT };
const KIM = "kim@away.test";

/** home holds bruno and sam; away holds kim. */
function directoryWithPeople(): Directory {
  const directory = Directory.open(":memory:");
  directory.addHousehold({ id: "home", name: "Home", ...CHANGE });
  directory.addHousehold({ id: "away", name: "Away", ...CHANGE });
  directory.addMember({ household: "home", address: ALEX, person: "bruno", ...CHANGE });
  directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
  directory.addMember({ household: "away", address: KIM, person: "kim", ...CHANGE });
  return directory;
}

/** A bare handle on a migrated directory holding the same, to write past the class. */
function raw(): Database.Database {
  const db = new Database(":memory:");
  migrateDirectory(db);
  db.exec(`
    INSERT INTO households (id, name, created_at, created_by) VALUES
      ('home', 'Home', 'x', 'operator'), ('away', 'Away', 'x', 'operator');
    INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by) VALUES
      ('${ALEX}', 'home', 'bruno', 'add', 'x', 'operator'),
      ('${SAM}', 'home', 'sam', 'add', 'x', 'operator'),
      ('${KIM}', 'away', 'kim', 'add', 'x', 'operator');
  `);
  return db;
}

function name(db: Database.Database, household: string, person: string, shown: string): void {
  db.prepare(
    `INSERT INTO person_names (household_id, person, name, named_at, named_by)
     VALUES (?, ?, ?, 'x', 'raw')`,
  ).run(household, person, shown);
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

describe("a rename", () => {
  test("appends one record, keeps the id, and the latest record is how the person is shown", () => {
    const directory = directoryWithPeople();

    expect(
      directory.renamePerson({ household: "home", person: "bruno", name: " Bruno ", ...RENAME }),
    ).toEqual({ person: "bruno", name: "Bruno" });

    expect(directory.names("home")).toEqual(new Map([["bruno", "Bruno"]]));
    expect(directory.members("home").map((member) => member.person)).toEqual(["bruno", "sam"]);
    expect(directory.history("home").at(-1)).toEqual({
      action: "rename",
      person: "bruno",
      name: "Bruno",
      at: AT.toISOString(),
      by: ADMIN,
    });

    directory.renamePerson({ household: "home", person: "bruno", name: "Bru", ...RENAME });
    expect(directory.names("home")).toEqual(new Map([["bruno", "Bru"]]));
    // Back to the id is a rename like any other: it is the person's own.
    directory.renamePerson({ household: "home", person: "bruno", name: "bruno", ...RENAME });
    expect(directory.names("home")).toEqual(new Map([["bruno", "bruno"]]));
    expect(
      directory
        .history("home")
        .filter((record) => record.action === "rename")
        .map((record) => (record.action === "rename" ? record.name : "")),
    ).toEqual(["Bruno", "Bru", "bruno"]);
    directory.close();
  });

  test("the schema keeps every record: an UPDATE, a DELETE and an INSERT OR REPLACE are each refused", () => {
    const db = raw();
    name(db, "home", "bruno", "Bruno");
    expect(db.prepare("SELECT count(*) AS n FROM person_names").get()).toEqual({ n: 1 });

    for (const statement of [
      "UPDATE person_names SET name = 'Someone'",
      "DELETE FROM person_names",
      `INSERT OR REPLACE INTO person_names (id, household_id, person, name, named_at, named_by)
       VALUES (1, 'home', 'bruno', 'Someone', 'x', 'raw')`,
      `REPLACE INTO person_names (id, household_id, person, name, named_at, named_by)
       VALUES (1, 'home', 'bruno', 'Someone', 'x', 'raw')`,
    ]) {
      expect(() => db.exec(statement), statement).toThrow(/appended, never/u);
    }

    expect(db.prepare("SELECT id, person, name FROM person_names").all()).toEqual([
      { id: 1, person: "bruno", name: "Bruno" },
    ]);
    db.close();
  });

  test("is a name of 1 to 64 characters, trimmed, by the code and by the schema", () => {
    const directory = directoryWithPeople();
    for (const shown of ["", "   ", "x".repeat(65)]) {
      expect(
        code(() =>
          directory.renamePerson({ household: "home", person: "bruno", name: shown, ...RENAME }),
        ),
        JSON.stringify(shown),
      ).toBe("BAD_REQUEST");
    }
    expect(directory.names("home").size).toBe(0);
    directory.close();

    const db = raw();
    for (const shown of ["", " Bruno", "Bruno ", "x".repeat(65)]) {
      expect(() => name(db, "home", "bruno", shown), JSON.stringify(shown)).toThrow(/CHECK/u);
    }
    db.close();
  });
});

describe("a shown name is unique in its household", () => {
  test("renaming to a name another person is shown under, or to another person's id, is refused", () => {
    const directory = directoryWithPeople();
    directory.renamePerson({ household: "home", person: "sam", name: "Sam", ...RENAME });
    const before = directory.history("home");

    for (const shown of ["Sam", "sam"]) {
      expect(
        code(() =>
          directory.renamePerson({ household: "home", person: "bruno", name: shown, ...RENAME }),
        ),
        shown,
      ).toBe("PERSON_NAME_TAKEN");
    }
    // sam's old id stays theirs, after a rename too.
    expect(directory.history("home")).toEqual(before);
    expect(directory.names("home")).toEqual(new Map([["sam", "Sam"]]));
    directory.close();

    const db = raw();
    name(db, "home", "sam", "Sam");
    expect(() => name(db, "home", "bruno", "Sam")).toThrow(/unique in its household/u);
    expect(() => name(db, "home", "bruno", "sam")).toThrow(/unique in its household/u);
    expect(db.prepare("SELECT count(*) AS n FROM person_names").get()).toEqual({ n: 1 });
    db.close();
  });

  test("the same name in a different household is accepted", () => {
    const directory = directoryWithPeople();
    directory.renamePerson({ household: "home", person: "bruno", name: "Robin", ...RENAME });

    expect(
      directory.renamePerson({ household: "away", person: "kim", name: "Robin", ...RENAME }),
    ).toEqual({ person: "kim", name: "Robin" });
    expect(directory.names("away")).toEqual(new Map([["kim", "Robin"]]));
    // away's kim is no id in home, so home may be shown under it too.
    expect(
      directory.renamePerson({ household: "home", person: "sam", name: "kim", ...RENAME }),
    ).toEqual({ person: "sam", name: "kim" });
    directory.close();

    const db = raw();
    name(db, "home", "bruno", "Robin");
    name(db, "away", "kim", "Robin");
    expect(db.prepare("SELECT count(*) AS n FROM current_person_names").get()).toEqual({ n: 2 });
    db.close();
  });

  test("a new person is not added under a name another person is shown as, by the code and by the schema", () => {
    const directory = directoryWithPeople();
    directory.renamePerson({ household: "home", person: "bruno", name: "Bruno", ...RENAME });

    expect(
      code(() =>
        directory.addMember({
          household: "home",
          address: "casey@example.test",
          person: "Bruno",
          ...CHANGE,
        }),
      ),
    ).toBe("PERSON_NAME_TAKEN");
    // An address for bruno themself still goes in, and so does a name nobody is shown as.
    directory.addMember({
      household: "home",
      address: "bruno.phone@example.test",
      person: "bruno",
      ...CHANGE,
    });
    directory.addMember({
      household: "home",
      address: "casey@example.test",
      person: "casey",
      ...CHANGE,
    });
    expect(directory.people("home")).toEqual(["bruno", "casey", "sam"]);
    directory.close();

    const db = raw();
    name(db, "home", "bruno", "Bruno");
    expect(() =>
      db.exec(
        `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
         VALUES ('casey@example.test', 'home', 'Bruno', 'add', 'x', 'raw')`,
      ),
    ).toThrow(/unique in its household/u);
    db.close();
  });
});

describe("who can be renamed", () => {
  test("only a person a membership of the household has named, a member who has left included", () => {
    const directory = directoryWithPeople();
    directory.removeMember({ address: SAM, ...RENAME });

    expect(directory.people("home")).toEqual(["bruno"]);
    expect(directory.heldPeople("home")).toEqual(["bruno", "sam"]);
    expect(
      directory.renamePerson({ household: "home", person: "sam", name: "Sam", ...RENAME }),
    ).toEqual({ person: "sam", name: "Sam" });

    for (const [household, person] of [
      ["home", "casey"],
      ["home", "kim"],
      ["away", "bruno"],
    ] as const) {
      expect(
        code(() => directory.renamePerson({ household, person, name: "Someone", ...RENAME })),
        `${household} ${person}`,
      ).toBe("PERSON_NOT_FOUND");
    }
    expect(
      code(() =>
        directory.renamePerson({ household: "nowhere", person: "bruno", name: "B", ...RENAME }),
      ),
    ).toBe("HOUSEHOLD_NOT_FOUND");
    directory.close();

    const db = raw();
    expect(() => name(db, "home", "casey", "Casey")).toThrow(/a person the household has held/u);
    expect(() => name(db, "away", "bruno", "Bruno")).toThrow(/a person the household has held/u);
    db.close();
  });

  test("the refusal for an id no membership named says why", () => {
    const directory = directoryWithPeople();
    try {
      directory.renamePerson({ household: "home", person: "casey", name: "Casey", ...RENAME });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toContain("old rule or classification");
    }
    directory.close();
  });

  test("a value that is not of its type is refused as BAD_REQUEST before the schema", () => {
    const directory = directoryWithPeople();
    const base = { household: "home", person: "bruno", name: "Bruno", ...RENAME };
    for (const fields of [
      { household: untyped<string>(7) },
      { person: untyped<string>(null) },
      { name: untyped<string>(7) },
      { by: untyped<string>(null) },
      { at: untyped<Date>("2026-10-17") },
    ]) {
      expect(
        code(() => directory.renamePerson({ ...base, ...fields })),
        JSON.stringify(fields),
      ).toBe("BAD_REQUEST");
    }
    expect(directory.names("home").size).toBe(0);
    directory.close();
  });
});

describe("migration 5", () => {
  test("a directory at migration 4 takes it on its next open, its records unchanged and nobody renamed", () => {
    const db = new Database(":memory:");
    migrateDirectory(db, 4);
    db.exec(`
      INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
      INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
        VALUES ('${ALEX}', 'home', 'bruno', 'add', 'x', 'operator');
    `);
    const before = db.prepare("SELECT * FROM memberships ORDER BY id").all();

    migrateDirectory(db);

    expect(db.pragma("user_version", { simple: true })).toBe(10);
    expect(db.prepare("SELECT * FROM memberships ORDER BY id").all()).toEqual(before);
    const directory = new Directory(db);
    expect(directory.names("home").size).toBe(0);
    expect(directory.history("home")).toEqual([
      { address: ALEX, person: "bruno", action: "add", at: "x", by: "operator" },
    ]);
    directory.close();
  });
});

/** An instant on 2026-10-17, as hh:mm. */
function atTime(time: string): Date {
  return new Date(`2026-10-17T${time}:00Z`);
}

// lg-33's gate 1, F2: merging renames into the history must not re-sort a
// table's own records, which migration 1 orders by id, never by a timestamp.
describe("the history with renames in it", () => {
  test("keeps each table's records in the order they were written, a clock that stepped back included", () => {
    const directory = Directory.open(":memory:");
    directory.addHousehold({ id: "home", name: "Home", ...CHANGE });
    directory.addMember({
      household: "home",
      address: ALEX,
      person: "bruno",
      by: "operator",
      at: atTime("12:00"),
    });
    // Written second, stamped a minute earlier: the clock stepped back.
    directory.removeMember({ address: ALEX, by: ADMIN, at: atTime("11:59") });
    directory.renamePerson({
      household: "home",
      person: "bruno",
      name: "Bruno",
      by: ADMIN,
      at: atTime("12:30"),
    });
    directory.addMember({
      household: "home",
      address: SAM,
      person: "sam",
      by: "operator",
      at: atTime("13:00"),
    });

    expect(
      directory.history("home").map((record) => `${record.action}@${record.at.slice(11, 16)}`),
    ).toEqual(["add@12:00", "remove@11:59", "rename@12:30", "add@13:00"]);
    directory.close();
  });
});
