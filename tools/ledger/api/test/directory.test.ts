/**
 * The household directory (lg-20): its schema and the class that writes it.
 * Each rule is held by `Directory`, with a sentence for the operator, and
 * most of them again by the schema, so that a writer which skips the class is
 * refused too. An address's character set is held by `Directory` alone: the
 * schema checks its case, its trim and its `@`, not a control character (lg-52).
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import {
  Directory,
  NEW_HOUSEHOLD_NAME,
  isHouseholdId,
  nameFromAddress,
  readAddress,
} from "../src/directory.ts";
import { ALEX, SAM, STRANGER } from "./helpers/access.ts";
import { WRITES_IN_PLACE } from "./helpers/append-only.ts";

const AT = new Date("2026-10-12T12:00:00Z");
const CHANGE = { by: "operator", at: AT };
const CASEY = "casey@example.test";

function withHousehold(): Directory {
  const directory = Directory.open(":memory:");
  directory.addHousehold({ id: "home", name: "Home", ...CHANGE });
  return directory;
}

/** A bare handle on a migrated directory, to write past the class. */
function raw(): Database.Database {
  const db = new Database(":memory:");
  migrateDirectory(db);
  db.prepare(
    "INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator')",
  ).run();
  return db;
}

function insert(
  db: Database.Database,
  fields: { address: string; person: string; action?: "add" | "remove"; household?: string },
): void {
  db.prepare(
    `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
     VALUES (?, ?, ?, ?, 'x', 'operator')`,
  ).run(fields.address, fields.household ?? "home", fields.person, fields.action ?? "add");
}

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

describe("a household", () => {
  test("has an id that is one plain lowercase word, refused otherwise by the code and the schema", () => {
    for (const id of ["home", "dupont", "a"]) expect(isHouseholdId(id), id).toBe(true);
    const refused = ["", "Home", "home2", "two words", "../etc", "a-b", "é", "con", "nul"];
    refused.push("x".repeat(33));

    const directory = Directory.open(":memory:");
    const db = raw();
    for (const id of refused) {
      expect(isHouseholdId(id), id).toBe(false);
      expect(
        code(() => directory.addHousehold({ id, name: "Somewhere", ...CHANGE })),
        id,
      ).toBe("BAD_REQUEST");
      expect(
        () =>
          db
            .prepare(
              "INSERT INTO households (id, name, created_at, created_by) VALUES (?, 'n', 'x', 'operator')",
            )
            .run(id),
        id,
      ).toThrow(/CHECK/u);
    }
    expect(directory.households()).toEqual([]);
    directory.close();
    db.close();
  });

  test("is created once", () => {
    const directory = withHousehold();

    expect(code(() => directory.addHousehold({ id: "home", name: "Again", ...CHANGE }))).toBe(
      "BAD_REQUEST",
    );
    expect(directory.households()).toEqual([{ id: "home", name: "Home" }]);
    directory.close();
  });
});

describe("membership", () => {
  test("puts an address in a household under a person's name, lower-cased", () => {
    const directory = withHousehold();

    directory.addMember({
      household: "home",
      address: " Alex@Example.TEST ",
      person: "alex",
      ...CHANGE,
    });

    expect(directory.membershipOf(ALEX)).toEqual({ household: "home", person: "alex" });
    expect(directory.membershipOf("ALEX@example.test")).toEqual({
      household: "home",
      person: "alex",
    });
    expect(directory.members()).toEqual([{ address: ALEX, household: "home", person: "alex" }]);
    directory.close();
  });

  test("an address belongs to at most one household, this one included", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.addHousehold({ id: "other", name: "Other", ...CHANGE });

    expect(
      code(() =>
        directory.addMember({ household: "other", address: ALEX, person: "x", ...CHANGE }),
      ),
    ).toBe("ADDRESS_ALREADY_A_MEMBER");
    expect(
      code(() => directory.addMember({ household: "home", address: ALEX, person: "a", ...CHANGE })),
    ).toBe("ADDRESS_ALREADY_A_MEMBER");

    const db = raw();
    insert(db, { address: ALEX, person: "alex" });
    expect(() => insert(db, { address: ALEX, person: "alex" })).toThrow(/already belongs/u);
    directory.close();
    db.close();
  });

  test("names a household that exists", () => {
    const directory = withHousehold();

    expect(
      code(() =>
        directory.addMember({ household: "nowhere", address: ALEX, person: "alex", ...CHANGE }),
      ),
    ).toBe("HOUSEHOLD_NOT_FOUND");
    expect(() => insert(raw(), { address: ALEX, person: "alex", household: "nowhere" })).toThrow(
      /FOREIGN KEY/u,
    );
    directory.close();
  });

  test("a second address for a name already in the household is not a third person", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });

    directory.addMember({
      household: "home",
      address: "sam.work@example.test",
      person: "sam",
      ...CHANGE,
    });

    expect(directory.people("home")).toEqual(["alex", "sam"]);
    expect(directory.members("home")).toHaveLength(3);
    directory.close();
  });

  // lg-23 replaced lg-20's two tests that refused a third person name: the books
  // settle between any number of people, so the directory holds any number.
  test("a third, a fourth and a fifth person name are taken, by the code and by the schema", () => {
    const directory = withHousehold();
    const db = raw();
    const people = ["alex", "sam", "casey", "dana", "eli"];
    for (const person of people) {
      const address = `${person}@example.test`;
      directory.addMember({ household: "home", address, person, ...CHANGE });
      insert(db, { address, person });
    }

    expect(directory.people("home")).toEqual(people.toSorted());
    expect(directory.membershipOf(CASEY)).toEqual({ household: "home", person: "casey" });
    expect(db.prepare("SELECT count(DISTINCT person) AS n FROM current_members").get()).toEqual({
      n: 5,
    });
    directory.close();
    db.close();
  });

  test("with sam removed, casey is added as a third name, and sam stays a name the household held", () => {
    // The books keep every name they have held (a name is permanent): sam's
    // records outlive sam's removal, and casey joins beside them.
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
    directory.removeMember({ address: SAM, ...CHANGE });

    directory.addMember({ household: "home", address: CASEY, person: "casey", ...CHANGE });

    expect(directory.membershipOf(CASEY)).toEqual({ household: "home", person: "casey" });
    expect(directory.history("home").map((change) => change.person)).toEqual([
      "alex",
      "sam",
      "sam",
      "casey",
    ]);
    directory.close();
  });

  test("migration 4 drops the cap a directory at migration 3 still holds, its records unchanged", () => {
    const db = new Database(":memory:");
    migrateDirectory(db, 3);
    db.prepare(
      "INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator')",
    ).run();
    insert(db, { address: ALEX, person: "alex" });
    insert(db, { address: SAM, person: "sam" });
    // At migration 3 the third name is lg-20's refusal; the test would pass
    // without migration 4 only if the cap had never been there.
    expect(() => insert(db, { address: CASEY, person: "casey" })).toThrow(/HOUSEHOLD_FULL/u);
    const before = db.prepare("SELECT * FROM memberships ORDER BY id").all();

    migrateDirectory(db);

    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(db.prepare("SELECT * FROM memberships ORDER BY id").all()).toEqual(before);
    insert(db, { address: CASEY, person: "casey" });
    expect(db.prepare("SELECT person FROM current_members ORDER BY person").all()).toEqual([
      { person: "alex" },
      { person: "casey" },
      { person: "sam" },
    ]);
    db.close();
  });

  test("a removal ends the membership and copies what it ended; the address may then be added again", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });

    expect(directory.removeMember({ address: ALEX, ...CHANGE })).toEqual({
      address: ALEX,
      household: "home",
      person: "alex",
    });
    expect(directory.membershipOf(ALEX)).toBeUndefined();
    expect(code(() => directory.removeMember({ address: ALEX, ...CHANGE }))).toBe(
      "MEMBER_NOT_FOUND",
    );

    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    expect(directory.membershipOf(ALEX)).toEqual({ household: "home", person: "alex" });

    const db = raw();
    expect(() => insert(db, { address: ALEX, person: "alex", action: "remove" })).toThrow(
      /does not name a membership/u,
    );
    insert(db, { address: ALEX, person: "alex" });
    expect(() => insert(db, { address: ALEX, person: "someone", action: "remove" })).toThrow(
      /does not name a membership/u,
    );
    directory.close();
    db.close();
  });
});

describe("the directory is only ever appended to", () => {
  test("every change is a record naming who made it and when, and the records stay", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.removeMember({ address: ALEX, by: "admin@example.test", at: AT });
    directory.close();

    const db = raw();
    insert(db, { address: ALEX, person: "alex" });
    insert(db, { address: ALEX, person: "alex", action: "remove" });
    expect(db.prepare("SELECT action FROM memberships ORDER BY id").all()).toEqual([
      { action: "add" },
      { action: "remove" },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM current_members").get()).toEqual({ n: 0 });
    db.close();
  });

  test("the schema refuses an UPDATE or a DELETE of a membership or a household", () => {
    const db = raw();
    insert(db, { address: ALEX, person: "alex" });

    for (const statement of [
      "UPDATE memberships SET person = 'someone'",
      "DELETE FROM memberships",
      "UPDATE households SET name = 'Elsewhere'",
      "DELETE FROM households",
    ]) {
      expect(() => db.exec(statement), statement).toThrow(/appended, never/u);
    }
    expect(db.prepare("SELECT count(*) AS n FROM memberships").get()).toEqual({ n: 1 });
    db.close();
  });

  test("no source file that writes the directory issues an UPDATE or a DELETE", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.join(here, "../src");
    const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map(
        (file) =>
          [file.split(path.sep).join("/"), readFileSync(path.join(src, file), "utf8")] as const,
      )
      .filter(([, text]) => /\b(memberships|households)\b/u.test(text));

    // The scan has something to read: the schema, the class and the command.
    expect(sources.map(([file]) => file).toSorted()).toEqual(
      expect.arrayContaining(["db/directory-schema.ts", "directory.ts", "household-command.ts"]),
    );
    const offenders = sources
      .filter(([, text]) => WRITES_IN_PLACE.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe("a household id and a NUL byte", () => {
  test("the schema refuses an id with a NUL in it, at the start, the middle or the end", () => {
    const db = raw();

    // SQLite's `length` and `GLOB` read a text value to its first NUL, so a
    // check written over the text alone passes `ho\0me` and `a\0` as the plain
    // words `ho` and `a`. The class refuses them first; this is the writer that
    // skips the class.
    for (const id of ["\0home", "ho\0me", "a\0", "\0"]) {
      expect(
        () =>
          db
            .prepare(
              "INSERT INTO households (id, name, created_at, created_by) VALUES (?, 'n', 'x', 'operator')",
            )
            .run(id),
        JSON.stringify(id),
      ).toThrow(/CHECK/u);
    }
    expect(db.prepare("SELECT count(*) AS n FROM households").get()).toEqual({ n: 1 });
    db.close();
  });
});

// lg-20's gate, F2, fixed in lg-22: SQLite's REPLACE deletes the row it
// conflicts with without firing a DELETE trigger, so the UPDATE and DELETE
// triggers alone let an add become a removal and a household be renamed.
describe("a record is never replaced", () => {
  test("the schema refuses an INSERT OR REPLACE over an existing membership or household", () => {
    const db = raw();
    insert(db, { address: ALEX, person: "alex" });
    insert(db, { address: SAM, person: "sam" });

    for (const statement of [
      `INSERT OR REPLACE INTO memberships (id, address, household_id, person, action, changed_at, changed_by)
       VALUES (1, '${ALEX}', 'home', 'alex', 'remove', 'x', 'raw')`,
      `REPLACE INTO memberships (id, address, household_id, person, action, changed_at, changed_by)
       VALUES (2, '${SAM}', 'home', 'someone', 'add', 'x', 'raw')`,
      `INSERT OR REPLACE INTO households (id, name, created_at, created_by)
       VALUES ('home', 'Elsewhere', 'x', 'raw')`,
      `INSERT INTO households (id, name, created_at, created_by)
       VALUES ('home', 'Elsewhere', 'x', 'raw') ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
    ]) {
      expect(() => db.exec(statement), statement).toThrow(/appended, never replaced/u);
    }

    expect(db.prepare("SELECT id, action, person FROM memberships ORDER BY id").all()).toEqual([
      { id: 1, action: "add", person: "alex" },
      { id: 2, action: "add", person: "sam" },
    ]);
    expect(db.prepare("SELECT id, name FROM households").all()).toEqual([
      { id: "home", name: "Home" },
    ]);
    // A new record still goes in.
    insert(db, { address: ALEX, person: "alex", action: "remove" });
    db.close();
  });

  test("a directory made before the trigger takes it on its next open", () => {
    const db = new Database(":memory:");
    migrateDirectory(db, 1);
    db.exec(
      "INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator')",
    );

    migrateDirectory(db);

    expect(() =>
      db.exec(
        "INSERT OR REPLACE INTO households (id, name, created_at, created_by) VALUES ('home', 'Elsewhere', 'x', 'raw')",
      ),
    ).toThrow(/appended, never replaced/u);
    expect(db.pragma("user_version", { simple: true })).toBe(7);
    db.close();
  });

  test("the source scan sees a REPLACE and a table quoted or behind its schema", () => {
    for (const planted of [
      "INSERT OR REPLACE INTO memberships (id) VALUES (1)",
      "insert or replace into households (id) values ('home')",
      "REPLACE INTO memberships (id) VALUES (1)",
      'UPDATE "memberships" SET person = 1',
      "UPDATE `households` SET name = 1",
      "UPDATE [memberships] SET person = 1",
      "UPDATE main.memberships SET person = 1",
      'UPDATE "main"."households" SET name = 1',
      "UPDATE OR ROLLBACK memberships SET person = 1",
      "UPDATE memberships SET person = 1",
      'DELETE FROM "memberships"',
      // lg-22's gate 1, F3: what SQLite reads that a table-shaped pattern missed.
      "UPDATE 'memberships' SET person = 1",
      "UPDATE memberships AS m SET person = 1",
      "UPDATE memberships INDEXED BY memberships_address SET person = 1",
      "INSERT INTO households (id, name) VALUES ('home', 'x') ON CONFLICT (id) DO UPDATE SET name = 1",
      "INSERT INTO households (id) VALUES ('home') ON CONFLICT DO UPDATE SET name = 1",
      "DELETE /* c */ FROM memberships",
      "UPDATE\n  memberships\n  SET person = 1",
      // lg-22's gate 2, N1: a comment inside the REPLACE, as inside the DELETE.
      "REPLACE /* c */ INTO memberships (id) VALUES (1)",
      "INSERT OR /* c */ REPLACE /* c */ INTO memberships (id) VALUES (1)",
      "INSERT OR -- c\n REPLACE INTO memberships (id) VALUES (1)",
    ]) {
      expect(WRITES_IN_PLACE.test(planted), planted).toBe(true);
    }
    for (const innocent of [
      "INSERT INTO memberships (address) VALUES (?)",
      "a household is appended, never replaced",
      "the schema refusing an `UPDATE` or a `DELETE`",
    ]) {
      expect(WRITES_IN_PLACE.test(innocent), innocent).toBe(false);
    }
  });
});

// lg-24: `households.id` is a TEXT PRIMARY KEY, which SQLite lets hold NULL, and
// its CHECK passes on a NULL. No route writes one — the request schema wants a
// string — so these are the writers that skip the class.
describe("a household id is never NULL", () => {
  const NULL_ID_INSERTS = [
    "INSERT INTO households (id, name, created_at, created_by) VALUES (NULL, 'Nobody', 'x', 'raw')",
    "INSERT INTO households (name, created_at, created_by) VALUES ('Nobody', 'x', 'raw')",
    "INSERT OR REPLACE INTO households (id, name, created_at, created_by) VALUES (NULL, 'Nobody', 'x', 'raw')",
    "REPLACE INTO households (id, name, created_at, created_by) VALUES (NULL, 'Nobody', 'x', 'raw')",
  ];

  function refusesNullIds(db: Database.Database): void {
    const count = () => db.prepare("SELECT count(*) AS n FROM households").get();
    const before = count();
    for (const statement of NULL_ID_INSERTS) {
      expect(() => db.exec(statement), statement).toThrow(/a household has an id/u);
    }
    expect(count()).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM households WHERE id IS NULL").get()).toEqual({
      n: 0,
    });
  }

  test("the schema refuses an INSERT and an INSERT OR REPLACE with a NULL id", () => {
    const db = raw();
    refusesNullIds(db);
    // A household with an id still goes in.
    db.exec(
      "INSERT INTO households (id, name, created_at, created_by) VALUES ('away', 'Away', 'x', 'raw')",
    );
    expect(db.prepare("SELECT id FROM households ORDER BY id").all()).toEqual([
      { id: "away" },
      { id: "home" },
    ]);
    db.close();
  });

  test("a directory at the previous migration takes the refusal on its next open, its records unchanged", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-directory-"));
    try {
      const file = path.join(dir, "directory.sqlite");
      const before = new Database(file);
      migrateDirectory(before, 2);
      before.exec(
        "INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', '2026-10-12T12:00:00.000Z', 'operator')",
      );
      insert(before, { address: ALEX, person: "alex" });
      const households = before.prepare("SELECT * FROM households ORDER BY id").all();
      const memberships = before.prepare("SELECT * FROM memberships ORDER BY id").all();
      expect(households).toHaveLength(1);
      expect(memberships).toHaveLength(1);
      expect(before.pragma("user_version", { simple: true })).toBe(2);
      before.close();

      const directory = Directory.open(file);
      expect(directory.households()).toEqual([{ id: "home", name: "Home" }]);
      expect(directory.history("home")).toEqual([
        { address: ALEX, person: "alex", action: "add", at: "x", by: "operator" },
      ]);
      directory.close();

      const after = new Database(file);
      expect(after.pragma("user_version", { simple: true })).toBe(7);
      expect(after.prepare("SELECT * FROM households ORDER BY id").all()).toEqual(households);
      expect(after.prepare("SELECT * FROM memberships ORDER BY id").all()).toEqual(memberships);
      refusesNullIds(after);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the class refuses an id or a name that is not a string as BAD_REQUEST, before the schema", () => {
    const directory = Directory.open(":memory:");
    const refusalOf = (input: { id: unknown; name: unknown }): unknown => {
      try {
        directory.addHousehold({ ...input, ...CHANGE } as Parameters<Directory["addHousehold"]>[0]);
      } catch (error) {
        return error;
      }
      return undefined;
    };
    // Echoed as its type, never stringified: String() throws on the last two.
    const ids: [label: string, value: unknown, shown: string][] = [
      ["null", null, "object"],
      ["undefined", undefined, "undefined"],
      ["7", 7, "number"],
      ["['home']", ["home"], "object"],
      ["Object.create(null)", Object.create(null), "object"],
      [
        "an object whose toString throws",
        {
          toString() {
            throw new Error("boom");
          },
        },
        "object",
      ],
    ];
    for (const [label, value, shown] of ids) {
      const refusal = refusalOf({ id: value, name: "Nobody" });
      expect(refusal, label).toBeInstanceOf(AppError);
      expect(refusal, label).toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining(`; ${shown} is not.`),
      });
    }
    // The name beside it reached `.trim()` the same way.
    for (const [label, value] of [
      ["null", null],
      ["undefined", undefined],
      ["7", 7],
    ] as const) {
      const refusal = refusalOf({ id: "home", name: value });
      expect(refusal, `${label} name`).toBeInstanceOf(AppError);
      expect(refusal, `${label} name`).toMatchObject({
        code: "BAD_REQUEST",
        message: "A household's name is 1 to 80 characters.",
      });
    }
    expect(directory.households()).toEqual([]);
    directory.close();
  });
});

/** A value the signature does not allow, written as the caller would pass it. */
function untyped<T>(value: unknown): T {
  return value as T;
}

/** What a refusal must leave alone: the membership, its history and the households. */
function stateOf(directory: Directory) {
  return {
    members: directory.members(),
    history: directory.history("home"),
    households: directory.households(),
  };
}

/** The error a call threw, or `undefined` when it returned. */
function thrown(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Its text is this marker, so a refusal that echoed the value would contain it. */
const ECHO = "ECHO-MARKER-lg25";
const INVALID_DATE = new Date("x");

// lg-25: a method given a value that is not the type its signature names threw an
// untyped error (a TypeError from a string method, a RangeError or a SqliteError
// from the driver), or stored a coerced value. Each refusal is BAD_REQUEST, nothing
// it was given is stored, and the message does not echo the value.
describe("a directory method given a value that is not of its type", () => {
  /** A household with one member, so a refusal that stored anything would show. */
  function withMember(): Directory {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    return directory;
  }

  /** Each row: the call's text, the offending value, and the call with that value in its place. */
  type Refusal = [
    call: string,
    value: unknown,
    run: (directory: Directory, value: unknown) => unknown,
  ];

  const addMemberAs = (
    fields: Partial<{ household: string; address: string; person: string; by: string; at: Date }>,
  ) => ({ household: "home", address: SAM, person: "sam", by: "operator", at: AT, ...fields });

  const REFUSALS: Refusal[] = [
    [
      "addMember({ address: null })",
      null,
      (d, v) => d.addMember(addMemberAs({ address: untyped<string>(v) })),
    ],
    [
      "addMember({ address: undefined })",
      undefined,
      (d, v) => d.addMember(addMemberAs({ address: untyped<string>(v) })),
    ],
    [
      "addMember({ person: null })",
      null,
      (d, v) => d.addMember(addMemberAs({ person: untyped<string>(v) })),
    ],
    [
      "addMember({ person: 7 })",
      7,
      (d, v) => d.addMember(addMemberAs({ person: untyped<string>(v) })),
    ],
    [
      "addMember({ household: {} })",
      {},
      (d, v) => d.addMember(addMemberAs({ household: untyped<string>(v) })),
    ],
    [
      "addMember({ household: 7 })",
      7,
      (d, v) => d.addMember(addMemberAs({ household: untyped<string>(v) })),
    ],
    ["addMember({ at: null })", null, (d, v) => d.addMember(addMemberAs({ at: untyped<Date>(v) }))],
    [
      'addMember({ at: new Date("x") })',
      INVALID_DATE,
      (d, v) => d.addMember(addMemberAs({ at: untyped<Date>(v) })),
    ],
    [
      "addMember({ by: null })",
      null,
      (d, v) => d.addMember(addMemberAs({ by: untyped<string>(v) })),
    ],
    [
      "addMember({ by: undefined })",
      undefined,
      (d, v) => d.addMember(addMemberAs({ by: untyped<string>(v) })),
    ],
    ["addMember({ by: 7 })", 7, (d, v) => d.addMember(addMemberAs({ by: untyped<string>(v) }))],
    [
      "removeMember({ address: null })",
      null,
      (d, v) => d.removeMember({ address: untyped<string>(v), ...CHANGE }),
    ],
    [
      "removeMember({ at: null })",
      null,
      (d, v) => d.removeMember({ address: ALEX, by: "operator", at: untyped<Date>(v) }),
    ],
    [
      'removeMember({ at: new Date("x") })',
      INVALID_DATE,
      (d, v) => d.removeMember({ address: ALEX, by: "operator", at: untyped<Date>(v) }),
    ],
    [
      "removeMember({ by: null })",
      null,
      (d, v) => d.removeMember({ address: ALEX, by: untyped<string>(v), at: AT }),
    ],
    [
      "removeMember({ by: 7 })",
      7,
      (d, v) => d.removeMember({ address: ALEX, by: untyped<string>(v), at: AT }),
    ],
    ["membershipOf(null)", null, (d, v) => d.membershipOf(untyped<string>(v))],
    ["membershipOf(undefined)", undefined, (d, v) => d.membershipOf(untyped<string>(v))],
    [
      "addHousehold({ at: null })",
      null,
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: "operator", at: untyped<Date>(v) }),
    ],
    [
      'addHousehold({ at: "2026-10-12" })',
      "2026-10-12",
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: "operator", at: untyped<Date>(v) }),
    ],
    [
      'addHousehold({ at: new Date("x") })',
      INVALID_DATE,
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: "operator", at: untyped<Date>(v) }),
    ],
    [
      "addHousehold({ by: null })",
      null,
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: untyped<string>(v), at: AT }),
    ],
    [
      "addHousehold({ by: undefined })",
      undefined,
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: untyped<string>(v), at: AT }),
    ],
    [
      "addHousehold({ by: 7 })",
      7,
      (d, v) => d.addHousehold({ id: "away", name: "Away", by: untyped<string>(v), at: AT }),
    ],
  ];

  test.each(REFUSALS)(
    "%s is refused as BAD_REQUEST, changes nothing, and does not echo the value",
    (_call, value, run) => {
      const directory = withMember();
      const before = stateOf(directory);

      expect(code(() => run(directory, value))).toBe("BAD_REQUEST");
      expect(stateOf(directory)).toEqual(before);

      const refusal = thrown(() => run(directory, [ECHO]));
      expect(refusal).toBeInstanceOf(AppError);
      const message = refusal instanceof AppError ? refusal.message : "";
      expect(message).not.toBe("");
      expect(message).not.toContain(ECHO);
      expect(stateOf(directory)).toEqual(before);
      directory.close();
    },
  );

  // The schema and the lookup already answer a household that names none, and the
  // ticket keeps that answer: only a value of the wrong type is a refusal.
  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "addMember({ household: %s }) still names no household, as HOUSEHOLD_NOT_FOUND",
    (_label, value) => {
      const directory = withMember();
      const before = stateOf(directory);

      expect(
        code(() =>
          directory.addMember({
            household: untyped<string>(value),
            address: SAM,
            person: "sam",
            ...CHANGE,
          }),
        ),
      ).toBe("HOUSEHOLD_NOT_FOUND");
      expect(stateOf(directory)).toEqual(before);
      directory.close();
    },
  );
});

// lg-34: an address changed in one transaction, so the person is never without
// one between the remove and the add.
describe("changing a member's address", () => {
  const LATER = new Date("2026-10-18T09:00:00Z");
  const KIM = "kim@away.test";

  function withTwo(): Directory {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
    directory.addHousehold({ id: "away", name: "Away", ...CHANGE });
    directory.addMember({ household: "away", address: KIM, person: "kim", ...CHANGE });
    return directory;
  }

  test("leaves the new address standing under the same person, the old in no household, and records remove then add", () => {
    const directory = withTwo();

    const moved = directory.changeAddress({
      household: "home",
      from: ` ${SAM.toUpperCase()} `,
      to: " Casey@Example.TEST ",
      by: ALEX,
      at: LATER,
    });

    expect(moved).toEqual({ address: CASEY, household: "home", person: "sam" });
    expect(directory.membershipOf(CASEY)).toEqual({ household: "home", person: "sam" });
    expect(directory.membershipOf(SAM)).toBeUndefined();
    expect(directory.members("home")).toEqual([
      { address: ALEX, household: "home", person: "alex" },
      { address: CASEY, household: "home", person: "sam" },
    ]);
    expect(directory.history("home").slice(-2)).toEqual([
      { address: SAM, person: "sam", action: "remove", at: LATER.toISOString(), by: ALEX },
      { address: CASEY, person: "sam", action: "add", at: LATER.toISOString(), by: ALEX },
    ]);
    directory.close();
  });

  test("with the new address in another household is refused, and the old one still stands", () => {
    const directory = withTwo();
    const before = { members: directory.members(), history: directory.history("home") };

    expect(
      code(() => directory.changeAddress({ household: "home", from: SAM, to: KIM, ...CHANGE })),
    ).toBe("ADDRESS_ALREADY_A_MEMBER");

    expect(directory.members()).toEqual(before.members);
    expect(directory.history("home")).toEqual(before.history);
    expect(directory.membershipOf(SAM)).toEqual({ household: "home", person: "sam" });
    directory.close();
  });

  test("rolls the remove back when the add fails after it, past every check the class makes", () => {
    const db = raw();
    insert(db, { address: SAM, person: "sam" });
    // A writer's own refusal of the second statement: the schema's triggers are
    // what refuses in earnest, and this stands in for one.
    db.exec(
      `CREATE TRIGGER refuse_casey BEFORE INSERT ON memberships
       WHEN NEW.action = 'add' AND NEW.address = '${CASEY}'
       BEGIN SELECT RAISE(ABORT, 'refused after the remove'); END`,
    );
    const directory = new Directory(db);

    expect(() =>
      directory.changeAddress({ household: "home", from: SAM, to: CASEY, ...CHANGE }),
    ).toThrow(/refused after the remove/u);

    expect(directory.members()).toEqual([{ address: SAM, household: "home", person: "sam" }]);
    expect(directory.history("home").map((record) => record.action)).toEqual(["add"]);
    directory.close();
  });

  test.each([
    ["an address that stands in another household", "home", KIM, CASEY, "MEMBER_NOT_FOUND"],
    ["an address that belongs to nobody", "home", STRANGER, CASEY, "MEMBER_NOT_FOUND"],
    ["a household that does not exist", "nowhere", SAM, CASEY, "HOUSEHOLD_NOT_FOUND"],
    ["a new address already in this household", "home", SAM, ALEX, "ADDRESS_ALREADY_A_MEMBER"],
    [
      "a new address that is the old one in other letters",
      "home",
      SAM,
      ` ${SAM.toUpperCase()}`,
      "BAD_REQUEST",
    ],
    ["a new address that is not one", "home", SAM, "not an address", "BAD_REQUEST"],
    ["an old address that is not one", "home", "not an address", CASEY, "BAD_REQUEST"],
  ])("refuses %s, and changes nothing", (_label, household, from, to, expected) => {
    const directory = withTwo();
    const before = { ...stateOf(directory), away: directory.history("away") };

    expect(code(() => directory.changeAddress({ household, from, to, ...CHANGE }))).toBe(expected);

    expect({ ...stateOf(directory), away: directory.history("away") }).toEqual(before);
    directory.close();
  });

  test.each([
    ["household", { household: 7 }],
    ["from", { from: null }],
    ["to", { to: undefined }],
    ["by", { by: 7 }],
    ["at", { at: INVALID_DATE }],
  ])("refuses a %s of the wrong type as BAD_REQUEST, and changes nothing", (_field, wrong) => {
    const directory = withTwo();
    const before = stateOf(directory);
    const call = { household: "home", from: SAM, to: CASEY, ...CHANGE, ...wrong };

    expect(code(() => directory.changeAddress(untyped(call)))).toBe("BAD_REQUEST");

    expect(stateOf(directory)).toEqual(before);
    directory.close();
  });
});

// lg-52: `\s` covers tab and newline and not the other C0 controls or DEL, so an
// address carrying one was stored and then no Access token could name it.
/** A character as `\uXXXX`, so a failure names a control a terminal would swallow. */
const shown = (text: string) =>
  text.replace(/[^ -~]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

describe("an address with a control character", () => {
  /** The C0 controls and DEL, which the class refuses wherever they sit. */
  const CONTROLS = [...Array.from({ length: 32 }, (_, i) => i), 0x7f].map((point) =>
    String.fromCodePoint(point),
  );

  test("is not an address to readAddress, in the local part, the domain or at the end, while a clean one is", () => {
    // The clean address first, so a pattern that refuses everything cannot pass.
    expect(readAddress("a@b.test")).toBe("a@b.test");
    expect(readAddress(" A@B.Test ")).toBe("a@b.test");
    for (const control of CONTROLS) {
      expect(readAddress(`a${control}x@b.test`), shown(control)).toBeUndefined();
      expect(readAddress(`a@b${control}c`), shown(control)).toBeUndefined();
      // A control that is whitespace at the end is trimmed off, as it always was.
      const trailing = readAddress(`a@b.test${control}`);
      expect(trailing, shown(control)).toBe(control.trim() === "" ? "a@b.test" : undefined);
    }
  });

  test("keeps returning undefined for what it refused before", () => {
    for (const text of ["no-at-sign", "a b@c", "a@@c", "", "a@b,c"]) {
      expect(readAddress(text), text).toBeUndefined();
    }
  });

  test.each([
    ["a NUL", "casey@b\u0000c"],
    ["a SOH", "casey\u0001@example.test"],
    ["an ESC", "casey@example.test\u001b"],
    ["a DEL", "casey\u007f@example.test"],
  ])(
    "is refused by addMember with %s as BAD_REQUEST, in the operator's sentence, and no row is written",
    (_label, address) => {
      const directory = withHousehold();
      const before = stateOf(directory);

      expect(
        code(() => directory.addMember({ household: "home", address, person: "casey", ...CHANGE })),
      ).toBe("BAD_REQUEST");
      expect(() =>
        directory.addMember({ household: "home", address, person: "casey", ...CHANGE }),
      ).toThrow("That is not an email address.");

      expect(stateOf(directory)).toEqual(before);
      // The same call with a clean address is added, so the refusal is the character's.
      expect(
        directory.addMember({ household: "home", address: CASEY, person: "casey", ...CHANGE })
          .address,
      ).toBe(CASEY);
      directory.close();
    },
  );

  test("is refused by changeAddress as the new address, and nothing changes", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
    const before = stateOf(directory);

    expect(
      code(() =>
        directory.changeAddress({ household: "home", from: SAM, to: "a@b\u0000c", ...CHANGE }),
      ),
    ).toBe("BAD_REQUEST");

    expect(stateOf(directory)).toEqual(before);
    directory.close();
  });

  test("is no obstacle to removing a row that already stands with one, which the schema let in", () => {
    const db = raw();
    // Past `Directory`, as a directory made before lg-52 holds it.
    insert(db, { address: "sam@b\u0000c", person: "sam" });
    insert(db, { address: "kim@b\u007f.test", person: "kim" });
    const directory = new Directory(db);
    expect(directory.members().map((member) => member.address)).toEqual([
      "kim@b\u007f.test",
      "sam@b\u0000c",
    ]);

    const removed = directory.removeMember({ address: "sam@b\u0000c", ...CHANGE });
    const removedDel = directory.removeMember({
      address: " KIM@b\u007f.test",
      household: "home",
      ...CHANGE,
    });

    expect(removed).toEqual({ address: "sam@b\u0000c", household: "home", person: "sam" });
    expect(removedDel).toEqual({ address: "kim@b\u007f.test", household: "home", person: "kim" });
    expect(directory.members()).toEqual([]);
    expect(directory.history("home").map((record) => record.action)).toEqual([
      "add",
      "add",
      "remove",
      "remove",
    ]);
    directory.close();
  });

  test.each([["no-at-sign"], ["a b@c"], ["a@@c"], [""], ["a@b,c"]])(
    "removal still refuses %j as BAD_REQUEST",
    (address) => {
      const directory = withHousehold();
      directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
      const before = stateOf(directory);

      expect(code(() => directory.removeMember({ address, ...CHANGE }))).toBe("BAD_REQUEST");

      expect(stateOf(directory)).toEqual(before);
      directory.close();
    },
  );
});

// lg-57: the C1 controls and the zero-width characters, which lg-52 left out.
// None shows in a member list or an email client, so an address that holds one
// is a row nobody can sign in as. Each is written as an escape.
describe("an address with a C1 control or a zero-width character", () => {
  /** The ends of the C1 range and the one the ticket names, then the zero-width set. */
  const INVISIBLE = [
    ["U+0080", "\u0080"],
    ["U+0085", "\u0085"],
    ["U+009F", "\u009f"],
    ["U+200B", "\u200b"],
    ["U+200C", "\u200c"],
    ["U+200D", "\u200d"],
  ] as const;

  test("is not an address to readAddress, while a clean one and a non-ASCII letter are", () => {
    // The clean addresses first, so a pattern that refuses everything outside ASCII cannot pass.
    expect(readAddress("a@b.test")).toBe("a@b.test");
    expect(readAddress("é@b.test")).toBe("é@b.test");
    expect(readAddress("a@é.test")).toBe("a@é.test");
    for (const [name, character] of INVISIBLE) {
      expect(readAddress(`a${character}x@b.test`), name).toBeUndefined();
      expect(readAddress(`a@b${character}c`), name).toBeUndefined();
      expect(readAddress(`a@b.test${character}`), name).toBeUndefined();
    }
  });

  // The BOM is White_Space to JavaScript's `\s`, so `ADDRESS_SHAPE` already refused it
  // and this one cannot fail first: it is a guard. At the very ends `trim` removes it,
  // as it removes any whitespace.
  test("refuses U+FEFF inside an address, as it already did", () => {
    expect(readAddress("a\ufeff@b.test")).toBeUndefined();
    expect(readAddress("a@b\ufeffc")).toBeUndefined();
    expect(readAddress("\ufeffa@b.test")).toBe("a@b.test");
    expect(readAddress("a@b.test\ufeff")).toBe("a@b.test");
  });

  test.each([
    ["a U+0085", "casey\u0085@example.test"],
    ["a U+009F", "casey@example.test\u009f"],
    ["a U+200B", "casey@b\u200bc.test"],
    ["a U+200D", "casey\u200d@example.test"],
    ["a U+FEFF", "ca\ufeffsey@example.test"],
  ])(
    "is refused by addMember with %s as BAD_REQUEST, in the operator's sentence, and no row is written",
    (_label, address) => {
      const directory = withHousehold();
      const before = stateOf(directory);

      expect(
        code(() => directory.addMember({ household: "home", address, person: "casey", ...CHANGE })),
      ).toBe("BAD_REQUEST");
      expect(() =>
        directory.addMember({ household: "home", address, person: "casey", ...CHANGE }),
      ).toThrow("That is not an email address.");

      expect(stateOf(directory)).toEqual(before);
      expect(
        directory.addMember({ household: "home", address: CASEY, person: "casey", ...CHANGE })
          .address,
      ).toBe(CASEY);
      directory.close();
    },
  );

  test("is refused by changeAddress as the new address, and nothing changes", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: SAM, person: "sam", ...CHANGE });
    const before = stateOf(directory);

    for (const to of ["a@b\u0085c", "a\u200b@b.test"]) {
      expect(
        code(() => directory.changeAddress({ household: "home", from: SAM, to, ...CHANGE })),
      ).toBe("BAD_REQUEST");
    }

    expect(stateOf(directory)).toEqual(before);
    directory.close();
  });

  test("is no obstacle to removing a row that already stands with one, which the schema let in", () => {
    const db = raw();
    // Past `Directory`, as a directory made before lg-57 holds it.
    insert(db, { address: "sam@b\u0085c", person: "sam" });
    insert(db, { address: "kim@b\u200b.test", person: "kim" });
    const directory = new Directory(db);

    const removed = directory.removeMember({ address: "sam@b\u0085c", ...CHANGE });
    const removedZeroWidth = directory.removeMember({
      address: " KIM@b\u200b.test",
      household: "home",
      ...CHANGE,
    });

    expect(removed).toEqual({ address: "sam@b\u0085c", household: "home", person: "sam" });
    expect(removedZeroWidth).toEqual({
      address: "kim@b\u200b.test",
      household: "home",
      person: "kim",
    });
    expect(directory.members()).toEqual([]);
    directory.close();
  });
});

// lg-57: `from` names a row that already stands, so it is read as removal reads it.
describe("changeAddress and a stored row holding a C1 control or a zero-width character", () => {
  test("moves the row to a clean address, which the schema let it be stored without", () => {
    const db = raw();
    // Past `Directory`, as a directory made before lg-57 holds it.
    insert(db, { address: "sam@b\u0085c", person: "sam" });
    insert(db, { address: "kim@b\u200b.test", person: "kim" });
    const directory = new Directory(db);

    const moved = directory.changeAddress({
      household: "home",
      from: "sam@b\u0085c",
      to: SAM,
      ...CHANGE,
    });
    const movedZeroWidth = directory.changeAddress({
      household: "home",
      from: " KIM@b\u200b.test",
      to: CASEY,
      ...CHANGE,
    });

    expect(moved).toEqual({ address: SAM, household: "home", person: "sam" });
    expect(movedZeroWidth).toEqual({ address: CASEY, household: "home", person: "kim" });
    expect(directory.members()).toEqual([
      { address: CASEY, household: "home", person: "kim" },
      { address: SAM, household: "home", person: "sam" },
    ]);
    directory.close();
  });

  test("still refuses one as the new address, and nothing changes", () => {
    const db = raw();
    insert(db, { address: "sam@b\u0085c", person: "sam" });
    const directory = new Directory(db);
    const before = stateOf(directory);

    for (const to of ["a@b\u0085c", "a\u009f@b.test", "a@b\u200bc"]) {
      expect(
        code(() =>
          directory.changeAddress({ household: "home", from: "sam@b\u0085c", to, ...CHANGE }),
        ),
        to,
      ).toBe("BAD_REQUEST");
    }

    expect(stateOf(directory)).toEqual(before);
    directory.close();
  });
});

// lg-71: a household made since is given a UUID and made by adding its first
// person; every word id made before stays valid.
describe("a household id that is a UUID", () => {
  const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  test("is a household id to the code and the schema, in lowercase only, beside the words", () => {
    expect(isHouseholdId(UUID)).toBe(true);
    expect(isHouseholdId("home")).toBe(true);
    const refused = [
      UUID.toUpperCase(),
      `${UUID}.db`,
      UUID.replaceAll("-", ""),
      `{${UUID}}`,
      UUID.replace("-", ":"),
      UUID.replace("-", "/"),
    ];
    for (const id of refused) expect(isHouseholdId(id), id).toBe(false);

    const directory = Directory.open(":memory:");
    expect(directory.addHousehold({ id: UUID, name: "Home", ...CHANGE })).toEqual({
      id: UUID,
      name: "Home",
    });
    // The legacy refusals hold: a reserved word is still no id.
    expect(code(() => directory.addHousehold({ id: "con", name: "Home", ...CHANGE }))).toBe(
      "BAD_REQUEST",
    );
    directory.close();

    const db = raw();
    const insertHousehold = db.prepare(
      "INSERT INTO households (id, name, created_at, created_by) VALUES (?, 'n', 'x', 'operator')",
    );
    insertHousehold.run("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    for (const id of [...refused, "con", `${UUID.slice(0, 35)}g`, `${UUID}\u0000`]) {
      expect(() => insertHousehold.run(id), id).toThrow(/CHECK/u);
    }
    db.close();
  });

  test("createHousehold makes the household Home and its first member in one step", () => {
    const directory = Directory.open(":memory:");

    // lg-76: the first person is a new one, under a generated id of their own.
    const PERSON = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b";
    const made = directory.createHousehold({
      id: UUID,
      address: " Alex@Example.TEST ",
      person: "alex",
      ...CHANGE,
      newId: () => PERSON,
    });

    expect(made).toEqual({
      household: { id: UUID, name: NEW_HOUSEHOLD_NAME },
      member: { address: ALEX, household: UUID, person: PERSON },
    });
    expect(NEW_HOUSEHOLD_NAME).toBe("Home");
    expect(directory.households()).toEqual([{ id: UUID, name: "Home" }]);
    expect(directory.membershipOf(ALEX)).toEqual({ household: UUID, person: PERSON });
    expect(directory.names(UUID)).toEqual(new Map([[PERSON, "alex"]]));
    expect(directory.history(UUID)).toEqual([
      { address: ALEX, person: PERSON, action: "add", at: AT.toISOString(), by: "operator" },
      { action: "name", person: PERSON, name: "alex", at: AT.toISOString(), by: "operator" },
    ]);
    directory.close();
  });

  test("createHousehold leaves no household behind when the first address is refused", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    const before = directory.households();

    const refusals = [
      // In a household already: refused inside the transaction, after the insert.
      { address: ALEX, expected: "ADDRESS_ALREADY_A_MEMBER" },
      { address: "not an email", expected: "BAD_REQUEST" },
      { address: "sam@b\u200bc.test", expected: "BAD_REQUEST" },
    ];
    for (const { address, expected } of refusals) {
      expect(
        code(() => directory.createHousehold({ id: UUID, address, person: "sam", ...CHANGE })),
        address,
      ).toBe(expected);
    }
    expect(
      code(() => directory.createHousehold({ id: UUID, address: SAM, person: " ", ...CHANGE })),
    ).toBe("BAD_REQUEST");
    // A word is an older household's id, never a new one's.
    expect(
      code(() =>
        directory.createHousehold({ id: "cabin", address: SAM, person: "sam", ...CHANGE }),
      ),
    ).toBe("BAD_REQUEST");

    expect(directory.households()).toEqual(before);
    expect(directory.household(UUID)).toBeUndefined();
    expect(directory.history(UUID)).toEqual([]);
    directory.close();
  });

  test("migration 7 takes a directory at migration 6 with its records unchanged, and its refusals kept", () => {
    const db = new Database(":memory:");
    migrateDirectory(db, 6);
    db.exec(`
      INSERT INTO households (id, name, created_at, created_by) VALUES ('home', 'Home', 'x', 'operator');
      INSERT INTO households (id, name, created_at, created_by) VALUES ('away', 'Away', 'y', 'operator');
      INSERT INTO households (id, name, created_at, created_by) VALUES ('cabin', 'Cabin', 'z', 'operator');
    `);
    insert(db, { address: ALEX, person: "alex" });
    insert(db, { address: SAM, person: "sam", household: "away" });
    db.exec(`
      INSERT INTO person_names (household_id, person, name, named_at, named_by)
        VALUES ('home', 'alex', 'Alex', 'x', 'operator');
    `);
    insert(db, { address: CASEY, person: "casey" });
    insert(db, { address: CASEY, person: "casey", action: "remove" });
    db.exec(`
      INSERT INTO retirements (household_id, person, action, recorded_at, recorded_by)
        VALUES ('home', 'casey', 'retire', 'x', 'operator');
      INSERT INTO retirements_applied (retirement_id, from_date, applied_at)
        VALUES (1, '2026-10-01', 'x');
    `);
    const tables = [
      "households",
      "memberships",
      "person_names",
      "retirements",
      "retirements_applied",
    ];
    const read = () => tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const before = read();
    const addUuid = `INSERT INTO households VALUES ('${UUID}', 'Home', 'x', 'operator')`;
    expect(() => db.exec(addUuid)).toThrow(/CHECK/u);

    migrateDirectory(db);

    expect(db.pragma("user_version", { simple: true })).toBe(7);
    expect(read()).toEqual(before);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.exec(addUuid);
    // Migrations 1 to 3's triggers, made again on the new table.
    expect(() => db.exec("UPDATE households SET name = 'Elsewhere' WHERE id = 'home'")).toThrow(
      /never edited/u,
    );
    expect(() => db.exec("DELETE FROM households WHERE id = 'cabin'")).toThrow(/never deleted/u);
    expect(() =>
      db.exec("INSERT OR REPLACE INTO households VALUES ('home', 'Again', 'x', 'operator')"),
    ).toThrow(/never replaced/u);
    expect(() =>
      db.exec("INSERT INTO households VALUES (NULL, 'Nobody', 'x', 'operator')"),
    ).toThrow(/a household has an id/u);
    // The references still reach the table: a membership of no household is refused.
    expect(() =>
      insert(db, { address: "kim@example.test", person: "kim", household: "nowhere" }),
    ).toThrow(/FOREIGN KEY/u);
    db.close();
  });
});

// lg-76: a person added under a name nobody has is a new person, under a
// generated id, and the name typed is only how they are shown.
describe("a new person gets a generated id (lg-76)", () => {
  const FIRST = "11111111-1111-4111-8111-111111111111";
  const SECOND = "22222222-2222-4222-8222-222222222222";
  const THIRD = "33333333-3333-4333-8333-333333333333";
  const GENERATED = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

  /** A `newId` that hands these out in order, and fails a test that asks for more. */
  function ids(...given: string[]): () => string {
    return () => {
      const next = given.shift();
      if (next === undefined) throw new Error("no generated id was expected here");
      return next;
    };
  }

  test("a name nobody has is a person under a generated id, shown under that name", () => {
    const directory = withHousehold();

    const added = directory.addMemberByName({
      household: "home",
      address: " Casey@Example.TEST ",
      person: " Casey ",
      ...CHANGE,
      newId: ids(FIRST),
    });

    expect(added).toEqual({ address: CASEY, household: "home", person: FIRST });
    expect(directory.membershipOf(CASEY)).toEqual({ household: "home", person: FIRST });
    expect(directory.names("home")).toEqual(new Map([[FIRST, "Casey"]]));
    expect(directory.history("home")).toEqual([
      { address: CASEY, person: FIRST, action: "add", at: AT.toISOString(), by: "operator" },
      { action: "name", person: FIRST, name: "Casey", at: AT.toISOString(), by: "operator" },
    ]);
    directory.close();
  });

  test("by default the id is a fresh randomUUID", () => {
    const directory = withHousehold();

    const one = directory.addMemberByName({ household: "home", address: CASEY, ...CHANGE });
    const two = directory.addMemberByName({ household: "home", address: ALEX, ...CHANGE });

    expect(one.person).toMatch(GENERATED);
    expect(two.person).toMatch(GENERATED);
    expect(one.person).not.toBe(two.person);
    directory.close();
  });

  test("the membership and the first shown name are written in one transaction", () => {
    // A trigger planted to refuse the name, so the membership written before it
    // in the same call must roll back with it.
    const db = raw();
    db.exec(`CREATE TRIGGER refuse_names BEFORE INSERT ON person_names
             BEGIN SELECT RAISE(ABORT, 'planted'); END`);
    const directory = new Directory(db);
    const add = () =>
      directory.addMemberByName({
        household: "home",
        address: CASEY,
        person: "casey",
        ...CHANGE,
        newId: ids(FIRST),
      });

    expect(add).toThrow(/planted/u);
    expect(directory.members()).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM memberships").get()).toEqual({ n: 0 });

    db.exec("DROP TRIGGER refuse_names");
    add();
    expect(directory.membershipOf(CASEY)).toEqual({ household: "home", person: FIRST });
    directory.close();
  });

  test("an id from the generator that is not a fresh UUID writes nothing", () => {
    const directory = withHousehold();
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });

    for (const id of ["alex", "not-a-uuid", "0F8FAD5B-D9CB-469F-A165-70867728950E"]) {
      expect(
        code(() =>
          directory.addMemberByName({
            household: "home",
            address: CASEY,
            person: "casey",
            ...CHANGE,
            newId: ids(id),
          }),
        ),
        id,
      ).toBe("INTERNAL");
    }
    expect(directory.membershipOf(CASEY)).toBeUndefined();
    directory.close();
  });

  test("an existing person is named by their shown name, or by the id they were added under", () => {
    const directory = withHousehold();
    // A person from before lg-76, under the name typed, then renamed.
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    directory.renamePerson({ household: "home", person: "alex", name: "Alexandre", ...CHANGE });
    directory.addMemberByName({
      household: "home",
      address: CASEY,
      person: "casey",
      ...CHANGE,
      newId: ids(FIRST),
    });
    const add = (address: string, person: string) =>
      directory.addMemberByName({ household: "home", address, person, ...CHANGE, newId: ids() })
        .person;

    expect(add("alex@work.test", "Alexandre")).toBe("alex");
    expect(add("alex@phone.test", "alex")).toBe("alex");
    expect(add("casey@work.test", "casey")).toBe(FIRST);
    // The id itself still names a person with a generated id, as the form sent it before lg-76.
    expect(add("casey@phone.test", FIRST)).toBe(FIRST);
    expect(directory.heldPeople("home")).toEqual([FIRST, "alex"]);
    // The first shown name is not written again for an email added later.
    expect(directory.history("home").filter((record) => record.action === "name")).toHaveLength(1);
    directory.close();
  });

  test("with no name, a new person is shown under the email's part before the @, numbered when taken", () => {
    const directory = withHousehold();
    // A person from before lg-76 whose id is "alex".
    directory.addMember({ household: "home", address: ALEX, person: "alex", ...CHANGE });
    const add = (address: string, newId: string) =>
      directory.addMemberByName({ household: "home", address, ...CHANGE, newId: ids(newId) });

    add("alex@other.test", FIRST);
    add("sam@one.test", SECOND);
    add("sam@two.test", THIRD);

    expect(directory.names("home")).toEqual(
      new Map([
        [FIRST, "alex 2"],
        [SECOND, "sam"],
        [THIRD, "sam 2"],
      ]),
    );
    directory.close();
  });

  test("a name from a long email is cut to the 64 a name holds, the number included", () => {
    const long = `${"a".repeat(70)}@example.test`;
    expect(nameFromAddress(long, () => false)).toBe("a".repeat(64));
    const taken = new Set(["a".repeat(64), `${"a".repeat(62)} 2`]);
    expect(nameFromAddress(long, (name) => taken.has(name))).toBe(`${"a".repeat(62)} 3`);
  });

  test("createHousehold with no name shows its first person under the email's part before the @", () => {
    const directory = Directory.open(":memory:");

    const made = directory.createHousehold({
      id: FIRST,
      address: "Robin@Cabin.TEST",
      ...CHANGE,
      newId: ids(SECOND),
    });

    expect(made.member).toEqual({ address: "robin@cabin.test", household: FIRST, person: SECOND });
    expect(directory.names(FIRST)).toEqual(new Map([[SECOND, "robin"]]));
    directory.close();
  });

  test("an email in a household already is refused naming its person as shown, never the id", () => {
    const directory = withHousehold();
    directory.addMemberByName({
      household: "home",
      address: CASEY,
      person: "casey",
      ...CHANGE,
      newId: ids(FIRST),
    });

    let message = "";
    try {
      directory.addMemberByName({ household: "home", address: CASEY, person: "kim", ...CHANGE });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toBe(
      `That email already belongs to the household "home", as casey. Remove it first.`,
    );
    directory.close();
  });

  test("a person with a generated id renamed later reads as a rename after their first name", () => {
    const directory = withHousehold();
    directory.addMemberByName({
      household: "home",
      address: CASEY,
      person: "casey",
      ...CHANGE,
      newId: ids(FIRST),
    });
    directory.renamePerson({ household: "home", person: FIRST, name: "Case", ...CHANGE });

    expect(
      directory
        .history("home")
        .flatMap((record) =>
          record.action === "name" || record.action === "rename" ? [record.action] : [],
        ),
    ).toEqual(["name", "rename"]);
    expect(directory.names("home").get(FIRST)).toBe("Case");
    directory.close();
  });
});
