/**
 * The household directory (lg-20): its schema and the class that writes it.
 * Each rule is held twice — by `Directory`, with a sentence for the operator,
 * and by the schema, so that a writer which skips the class is refused too.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import { Directory, isHouseholdId } from "../src/directory.ts";
import { ALEX, SAM } from "./helpers/access.ts";
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
    expect(
      db.prepare("SELECT count(DISTINCT person) AS n FROM current_members").get(),
    ).toEqual({ n: 5 });
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

    expect(db.pragma("user_version", { simple: true })).toBe(4);
    expect(db.prepare("SELECT * FROM memberships ORDER BY id").all()).toEqual(before);
    insert(db, { address: CASEY, person: "casey" });
    expect(
      db.prepare("SELECT person FROM current_members ORDER BY person").all(),
    ).toEqual([{ person: "alex" }, { person: "casey" }, { person: "sam" }]);
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
    expect(db.pragma("user_version", { simple: true })).toBe(4);
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
      expect(after.pragma("user_version", { simple: true })).toBe(4);
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
