/**
 * `npm run household:ledger` (lg-20): the directory from the host. It creates a
 * household, adds a member, removes one and lists them, against the file
 * `DIRECTORY_PATH` names. Since lg-21 gave each household books of its own, it
 * makes as many households as it is asked for.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Directory } from "../src/directory.ts";
import { runHouseholdCommand } from "../src/household-command.ts";
import { ALEX, SAM } from "./helpers/access.ts";

const NOW = new Date("2026-10-12T12:00:00.000Z");

let dir: string;
let directoryPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ledger-household-"));
  directoryPath = path.join(dir, "data", "directory.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Ran {
  code: number;
  out: string;
  err: string;
}

function run(...args: string[]): Ran {
  let out = "";
  let err = "";
  const code = runHouseholdCommand(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { DIRECTORY_PATH: directoryPath },
    cwd: dir,
    now: () => NOW,
  });
  return { code, out, err };
}

/** What the file holds, read the way the API reads it. */
function read<T>(look: (directory: Directory) => T): T {
  const directory = Directory.open(directoryPath);
  try {
    return look(directory);
  } finally {
    directory.close();
  }
}

/**
 * A household under a one-word id, as the command made them before lg-71 and
 * no longer can: the verbs other than `add` still take one.
 */
function legacy(id: string): void {
  const directory = Directory.open(directoryPath);
  try {
    directory.addHousehold({ id, name: "Home", by: "operator", at: NOW });
  } finally {
    directory.close();
  }
}

/** A lowercase UUID as `crypto.randomUUID()` prints it (lg-71). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/u;

describe("the household command", () => {
  // lg-71: `add <address> <person>` makes the household and its first member at once.
  test("creates a household by adding its first person, named Home under a UUID it prints", () => {
    const ran = run("add", "Alex@Example.TEST", "alex");

    expect(ran.code, ran.err).toBe(0);
    const households = read((directory) => directory.households());
    expect(households).toHaveLength(1);
    const [household] = households;
    expect(household?.id).toMatch(new RegExp(`^${UUID.source}$`, "u"));
    expect(household?.name).toBe("Home");
    expect(read((directory) => directory.members())).toEqual([
      { address: ALEX, household: household?.id, person: "alex" },
    ]);
    expect(ran.out).toContain(
      `Created the household ${household?.id ?? ""}, "Home", with ${ALEX} as alex.`,
    );
    expect(ran.out).toMatch(/Access policy/u);
  });

  test("adds a member, and reminds the operator of the Access policy", () => {
    legacy("home");

    const ran = run("member", "home", ALEX, "alex");

    expect(ran.code, ran.err).toBe(0);
    expect(ran.out).toMatch(/Access policy/u);
    expect(read((directory) => directory.membershipOf(ALEX))).toEqual({
      household: "home",
      person: "alex",
    });
  });

  test("removes a member", () => {
    legacy("home");
    run("member", "home", ALEX, "alex");
    run("member", "home", SAM, "sam");

    const ran = run("remove", ALEX);

    expect(ran.code, ran.err).toBe(0);
    expect(read((directory) => directory.membershipOf(ALEX))).toBeUndefined();
    expect(read((directory) => directory.membershipOf(SAM))).toEqual({
      household: "home",
      person: "sam",
    });
  });

  test("lists every household and its members", () => {
    expect(run("list").out).toContain("No households yet.");
    legacy("home");
    run("member", "home", ALEX, "alex");
    run("member", "home", SAM, "sam");

    const ran = run("list");

    expect(ran.code).toBe(0);
    expect(ran.out).toContain("home  Home");
    expect(ran.out).toContain(`  alex  ${ALEX}`);
    expect(ran.out).toContain(`  sam  ${SAM}`);
  });

  // lg-21: each household has books of its own, so a second one is allowed. What
  // keeps them apart is `isolation.test.ts`.
  test("creates a second household beside the first", () => {
    legacy("home");

    const ran = run("add", SAM, "sam");

    expect(ran.code, ran.err).toBe(0);
    const households = read((directory) => directory.households());
    expect(households).toHaveLength(2);
    expect(households).toContainEqual({ id: "home", name: "Home" });
    const other = households.find((household) => household.id !== "home");
    expect(other?.id).toMatch(UUID);
    expect(read((directory) => directory.membershipOf(SAM))).toEqual({
      household: other?.id,
      person: "sam",
    });
  });

  // lg-23: lg-20 refused a third person here; a household now holds any number.
  test("adds a third person to a household, and says a household holds any number", () => {
    legacy("home");
    run("member", "home", ALEX, "alex");
    run("member", "home", SAM, "sam");

    const ran = run("member", "home", "casey@example.test", "casey");

    expect(ran.code, ran.err).toBe(0);
    expect(read((directory) => directory.membershipOf("casey@example.test"))).toEqual({
      household: "home",
      person: "casey",
    });
    expect(run().err).toMatch(/any number of people/u);
  });

  test("refuses what the directory refuses with exit 1, and a malformed command with 2", () => {
    expect(run("add", "not an email", "alex").code).toBe(1);
    expect(run("member", "nowhere", ALEX, "alex").code).toBe(1);
    expect(run("remove", ALEX).code).toBe(1);

    expect(run().code).toBe(2);
    expect(run("rename", "home").code).toBe(2);
    expect(run("member", "home", ALEX).code).toBe(2);
    expect(run("list", "extra").code).toBe(2);
    // lg-71: `add` takes an address and a person, and nothing else.
    expect(run("add", ALEX).code).toBe(2);
    expect(run("add", "home", "The", "Test", "Household").code).toBe(2);
    expect(read((directory) => directory.households())).toEqual([]);
  });

  // lg-71: one transaction, so a refused first address leaves no household.
  test("makes no household when the first address is refused", () => {
    legacy("home");
    run("member", "home", ALEX, "alex");

    const ran = run("add", ALEX, "alex");

    expect(ran.code).toBe(1);
    expect(ran.err).toContain(`That email already belongs to the household "home", as alex.`);
    expect(read((directory) => directory.households())).toEqual([{ id: "home", name: "Home" }]);
  });

  test("names what it needs before it creates anything", () => {
    expect(run("member", "home").code).toBe(2);
    expect(existsSync(directoryPath)).toBe(false);
  });

  test("refuses a directory nothing outlives, and the retired ACCESS_PEOPLE", () => {
    let err = "";
    const io = {
      stdout: () => undefined,
      stderr: (text: string) => {
        err += text;
      },
      cwd: dir,
      now: () => NOW,
    };

    expect(runHouseholdCommand(["list"], { ...io, env: { DIRECTORY_PATH: ":memory:" } })).toBe(2);
    expect(err).toContain(":memory:");
    expect(
      runHouseholdCommand(["list"], {
        ...io,
        env: { DIRECTORY_PATH: directoryPath, ACCESS_PEOPLE: `${ALEX}=alex` },
      }),
    ).toBe(2);
    expect(err).toContain("ACCESS_PEOPLE is retired");
  });
});

// lg-52: a NUL cannot travel in a real `argv`, so it is passed to the function as
// a string; an ESC can be typed in a shell.
describe("the household command and a control character", () => {
  test.each([
    ["a NUL", "sam@b\u0000c"],
    ["an ESC", "sam@b\u001bc.test"],
    ["a DEL", "sam\u007f@b.test"],
  ])(
    "refuses an address with %s on the member verb, exits non-zero and writes no row",
    (_label, address) => {
      legacy("home");

      const ran = run("member", "home", address, "sam");

      expect(ran.code).toBe(1);
      expect(ran.err).toContain("That is not an email address.");
      expect(read((directory) => directory.members())).toEqual([]);
      expect(run("member", "home", "sam@b.test", "sam").code, "the clean address").toBe(0);
    },
  );

  test("still removes a row that already holds a NUL, which the schema let in", () => {
    legacy("home");
    const db = new Database(directoryPath);
    db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, 'home', 'sam', 'add', 'x', 'operator')`,
    ).run("sam@b\u0000c");
    db.close();
    expect(read((directory) => directory.members().length)).toBe(1);

    const ran = run("remove", "sam@b\u0000c");

    expect(ran.code, ran.err).toBe(0);
    expect(read((directory) => directory.members())).toEqual([]);
  });
});

// lg-57: the C1 controls and the zero-width characters. Neither can be typed with
// certainty in a shell, so they are passed to the function as strings.
describe("the household command and a C1 control or a zero-width character", () => {
  test.each([
    ["a U+0085", "sam@b\u0085c"],
    ["a U+009F", "sam\u009f@b.test"],
    ["a U+200B", "sam@b\u200bc.test"],
    ["a U+200D", "sam\u200d@b.test"],
  ])(
    "refuses an address with %s on the member verb, exits non-zero and writes no row",
    (_label, address) => {
      legacy("home");

      const ran = run("member", "home", address, "sam");

      expect(ran.code).toBe(1);
      expect(ran.err).toContain("That is not an email address.");
      expect(read((directory) => directory.members())).toEqual([]);
      expect(run("member", "home", "sam@b.test", "sam").code, "the clean address").toBe(0);
    },
  );

  test("still removes a row that already holds a U+0085 or a U+200B, which the schema let in", () => {
    legacy("home");
    const db = new Database(directoryPath);
    const insert = db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, 'home', ?, 'add', 'x', 'operator')`,
    );
    insert.run("sam@b\u0085c", "sam");
    insert.run("kim@b\u200bc", "kim");
    db.close();
    expect(read((directory) => directory.members().length)).toBe(2);

    const first = run("remove", "sam@b\u0085c");
    const second = run("remove", "kim@b\u200bc");

    expect(first.code, first.err).toBe(0);
    expect(second.code, second.err).toBe(0);
    expect(read((directory) => directory.members())).toEqual([]);
  });
});
