/**
 * lg-78: the import screen's answer to a name the household does not have.
 * Describe lists each name the workbook uses that resolves to no one; Confirm
 * takes an answer for each — someone held, or a new person without an email —
 * runs every verification with the answers applied, and only then adds the new
 * people to the directory and imports.
 *
 * The workbook is lg-7's synthetic one (`helpers/workbook.ts`), which names
 * Alex and Sam; every name and amount in it is invented. **No test calls a
 * model**: the describer is a fake answering lg-7's correct description.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  ConfirmWorkbookResponse,
  DescribeWorkbookResponse,
  ErrorResponse,
  NameAnswer,
  WorkbookLayout,
} from "@ledger/contract";
import { Directory } from "../src/directory.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { HOUSEHOLD, accessConfig, jwksFetch, signToken, testKey } from "./helpers/access.ts";
import { migratedBooks } from "./helpers/template.ts";
import { history, render } from "./helpers/workbook.ts";
import { layoutFixtures } from "./layout/fixtures.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-10-25T12:00:00.000Z");
const ALEX = "alex@example.test";
const ALEX_ID = "4f9c2d8e-1b3a-4c5d-9e6f-7a8b9c0d1e2f";
const SAMANTHA_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
/** The id the app gives the next person it adds, in turn. */
const NEW_IDS = ["0b6c7a1e-3f2d-4e5a-9b8c-7d6e5f4a3b2c", "1c7d8b2f-4a3e-4f6b-8c9d-8e7f6a5b4c3d"];

let workbook: Buffer;
let layout: WorkbookLayout;

beforeAll(async () => {
  workbook = await render(history());
  const lg7 = (await layoutFixtures()).find((each) => each.name === "lg7");
  if (lg7 === undefined) throw new Error("no lg7 fixture");
  layout = lg7.layout;
});

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** A household of alex alone, as lg-76 adds a person, or with the extra people given. */
function directoryOf(
  extra: readonly { address: string; person: string; id: string }[] = [],
): Directory {
  const directory = Directory.open(":memory:");
  const change = { by: "operator", at: new Date("2026-10-01T00:00:00Z") };
  directory.addHousehold({ id: HOUSEHOLD, name: "Home", ...change });
  for (const member of [{ address: ALEX, person: "alex", id: ALEX_ID }, ...extra]) {
    directory.addMemberByName({
      household: HOUSEHOLD,
      address: member.address,
      person: member.person,
      ...change,
      newId: () => member.id,
    });
  }
  return directory;
}

async function start(directory: Directory): Promise<App> {
  const ids = [...NEW_IDS];
  app = await createApp({
    booksTemplate: migratedBooks(),
    directory,
    config: {
      dataDir: ":memory:",
      access: accessConfig(),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      rateLimitWorkbookDescribesPerMinute: 0,
      receiptReader: { apiKey: "sk-ant-test-lg78-never-sent", model: "claude-haiku-5-5" },
    },
    logger: createLogger({ level: "silent", write: () => undefined }),
    now: () => NOW,
    newId: () => {
      const id = ids.shift();
      if (id === undefined) throw new Error("the test has no id left to give");
      return id;
    },
    fetch: jwksFetch(() => [KEY]).fetch,
    receiptReader: null,
    layoutAsk: async () => ({
      text: JSON.stringify(layout),
      stopReason: "end_turn",
      inputTokens: 4_100,
      outputTokens: 420,
    }),
  });
  return app;
}

function as(address: string): Record<string, string> {
  return {
    "cf-access-jwt-assertion": signToken({
      key: KEY,
      nowSec: Math.floor(NOW.getTime() / 1000),
      claims: { email: address },
    }),
  };
}

async function describeIt(started: App) {
  return await started.server.inject({
    method: "POST",
    url: ROUTES.workbookDescribe,
    headers: as(ALEX),
    payload: { file: workbook.toString("base64"), consent: true },
  });
}

async function confirm(started: App, names?: NameAnswer[]) {
  return await started.server.inject({
    method: "POST",
    url: ROUTES.workbookConfirm,
    headers: as(ALEX),
    payload: {
      file: workbook.toString("base64"),
      layout,
      ...(names === undefined ? {} : { names }),
    },
  });
}

/** How many rows each table of the household's books holds. */
function counts(started: App): Record<string, number> {
  const db = started.books.of(HOUSEHOLD);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n,
    ]),
  );
}

/** Everything the directory says of the household's people. */
function people(directory: Directory): unknown {
  return {
    held: directory.heldPeople(HOUSEHOLD),
    names: [...directory.names(HOUSEHOLD)],
    history: directory.history(HOUSEHOLD),
  };
}

/** Who each stored row naming a person is filed under, by id. */
function filedUnder(started: App): unknown[] {
  return started.books
    .of(HOUSEHOLD)
    .prepare(
      "SELECT person_id, COUNT(*) AS rows FROM current_classifications WHERE person_id IS NOT NULL GROUP BY person_id ORDER BY person_id",
    )
    .all();
}

function errorOf(response: { json: <T>() => T }): ErrorResponse["error"] {
  return response.json<ErrorResponse>().error;
}

describe("a workbook naming a person the household lacks (lg-78)", () => {
  test("reads with that name listed, where it first appears and how many rows name it, and writes nothing", async () => {
    const directory = directoryOf();
    const started = await start(directory);
    const before = { books: counts(started), directory: people(directory) };

    const response = await describeIt(started);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DescribeWorkbookResponse>();
    if (body.kind !== "xlsx") throw new Error("not a workbook's answer");
    expect(body.unresolved).toEqual([{ name: "Sam", where: "2022!E6", rows: 5 }]);
    expect(body.held).toEqual([{ person: ALEX_ID, name: "alex" }]);
    // Read with Sam as a new person, everything else holds: the name is the
    // list's to ask about, not a problem in the text.
    expect(body.ok, body.problems.join("\n")).toBe(true);
    expect(body.problems.join("\n")).not.toContain("Sam");
    expect(body.report).toContain("salaries (Accueil): alex ");
    expect(body.report).not.toContain(ALEX_ID);
    expect(counts(started)).toEqual(before.books);
    expect(people(directory)).toEqual(before.directory);
  });

  test("a name that resolves is not listed", async () => {
    const started = await start(
      directoryOf([{ address: "sam@example.test", person: "sam", id: SAMANTHA_ID }]),
    );

    const body = (await describeIt(started)).json<DescribeWorkbookResponse>();

    if (body.kind !== "xlsx") throw new Error("not a workbook's answer");
    expect(body.unresolved).toEqual([]);
    expect(body.ok, body.problems.join("\n")).toBe(true);
  });

  test("mapped to a person held, a member who has left, it imports its rows under that person", async () => {
    const directory = directoryOf([
      { address: "samantha@example.test", person: "Samantha", id: SAMANTHA_ID },
    ]);
    const started = await start(directory);
    // Samantha is in the books from her first request, then leaves.
    expect(
      (await started.server.inject({ url: ROUTES.me, headers: as("samantha@example.test") }))
        .statusCode,
    ).toBe(200);
    directory.removeMember({ address: "samantha@example.test", by: "operator", at: NOW });

    const described = (await describeIt(started)).json<DescribeWorkbookResponse>();
    if (described.kind !== "xlsx") throw new Error("not a workbook's answer");
    expect(described.held).toEqual([
      { person: ALEX_ID, name: "alex" },
      { person: SAMANTHA_ID, name: "Samantha" },
    ]);
    const held = people(directory);

    const response = await confirm(started, [{ name: "Sam", as: "held", person: SAMANTHA_ID }]);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ConfirmWorkbookResponse>().report).toContain("Written.");
    expect(filedUnder(started)).toEqual([
      { person_id: ALEX_ID, rows: 6 },
      { person_id: SAMANTHA_ID, rows: 5 },
    ]);
    expect(people(directory)).toEqual(held);
  });

  test("added as a new person on a household of one, they join the directory without an email, signed by the caller, and their rows import under them", async () => {
    const directory = directoryOf();
    const started = await start(directory);
    const [sam] = NEW_IDS;

    const response = await confirm(started, [{ name: "Sam", as: "new", shownAs: "Sam" }]);

    expect(response.statusCode, response.body).toBe(200);
    expect(directory.heldPeople(HOUSEHOLD)).toEqual([sam, ALEX_ID].toSorted());
    expect(directory.withoutEmail(HOUSEHOLD)).toEqual([sam]);
    expect(directory.members(HOUSEHOLD).map((member) => member.person)).toEqual([ALEX_ID]);
    expect(directory.names(HOUSEHOLD).get(sam ?? "")).toBe("Sam");
    expect(directory.history(HOUSEHOLD).slice(-2)).toEqual([
      { action: "add-person", person: sam, at: NOW.toISOString(), by: ALEX },
      { action: "name", person: sam, name: "Sam", at: NOW.toISOString(), by: ALEX },
    ]);
    // Enrolled before any row naming them was written, and counted as one of two
    // by the period sheets and Accueil (Build 5).
    const db = started.books.of(HOUSEHOLD);
    expect(db.prepare("SELECT id FROM people ORDER BY id").all()).toEqual(
      [ALEX_ID, sam].toSorted().map((id) => ({ id })),
    );
    expect(filedUnder(started)).toEqual(
      [
        { person_id: ALEX_ID, rows: 6 },
        { person_id: sam, rows: 5 },
      ].toSorted((a, b) => ((a.person_id ?? "") < (b.person_id ?? "") ? -1 : 1)),
    );
    expect(db.prepare("SELECT DISTINCT person_id FROM salaries ORDER BY person_id").all()).toEqual(
      [ALEX_ID, sam].toSorted().map((person_id) => ({ person_id })),
    );
    expect((db.prepare("SELECT COUNT(*) AS n FROM periods").get() as { n: number }).n).toBe(2);
  });

  test("a new person may be shown under another name typed", async () => {
    const directory = directoryOf();
    const started = await start(directory);

    const response = await confirm(started, [{ name: "Sam", as: "new", shownAs: " Samuel " }]);

    expect(response.statusCode, response.body).toBe(200);
    expect(directory.names(HOUSEHOLD).get(NEW_IDS[0] ?? "")).toBe("Samuel");
    expect(response.json<ConfirmWorkbookResponse>().report).toContain("Samuel");
  });
});

describe("what Confirm refuses, adding no one (lg-78)", () => {
  test("a verification that fails with the answers applied adds no one and writes nothing", async () => {
    const directory = directoryOf();
    const started = await start(directory);
    const before = { books: counts(started), directory: people(directory) };

    // Sam answered as alex: every period sheet then names one of the household.
    const response = await confirm(started, [{ name: "Sam", as: "held", person: ALEX_ID }]);

    expect(response.statusCode).toBe(422);
    expect(errorOf(response).code).toBe("WORKBOOK_IMPORT_REFUSED");
    expect(JSON.stringify(errorOf(response).details)).toContain("a period sheet names two");
    expect(people(directory)).toEqual(before.directory);
    expect(counts(started)).toEqual(before.books);
  });

  test.each([
    ["no answers", undefined],
    ["an answer for another name", [{ name: "Robin", as: "new", shownAs: "Robin" }]],
  ] as const)("a name left unanswered (%s) is refused, adding no one", async (_what, names) => {
    const directory = directoryOf();
    const started = await start(directory);
    const before = { books: counts(started), directory: people(directory) };

    const response = await confirm(started, names === undefined ? undefined : [...names]);

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).message).toContain('"Sam"');
    expect(people(directory)).toEqual(before.directory);
    expect(counts(started)).toEqual(before.books);
  });

  test.each([
    ["a person the household does not hold", { as: "held", person: SAMANTHA_ID }],
    ["a new person under a name the household shows", { as: "new", shownAs: "ALEX" }],
    ["a new person under no name", { as: "new", shownAs: "  " }],
    // lg-82: the directory refuses a character in a name, and the screen says so first.
    [
      "a new person under a name with a control character",
      { as: "new", shownAs: `Sa${String.fromCharCode(0x1b)}m` },
    ],
  ] as const)("an answer as %s is refused, adding no one", async (_what, answer) => {
    const directory = directoryOf();
    const started = await start(directory);
    const before = { books: counts(started), directory: people(directory) };

    const response = await confirm(started, [{ name: "Sam", ...answer }]);

    expect(response.statusCode).toBe(422);
    expect(errorOf(response).code).toBe("WORKBOOK_IMPORT_REFUSED");
    expect(people(directory)).toEqual(before.directory);
    expect(counts(started)).toEqual(before.books);
  });

  test("a second Confirm after the people were added finds them held, and adds no one again", async () => {
    const directory = directoryOf();
    const started = await start(directory);
    // As a first Confirm leaves it when the books' commit fails after the add.
    directory.addPerson({
      household: HOUSEHOLD,
      person: "Sam",
      by: ALEX,
      at: NOW,
      newId: () => SAMANTHA_ID,
    });
    const held = people(directory);

    const response = await confirm(started, [{ name: "Sam", as: "new", shownAs: "Sam" }]);

    expect(response.statusCode, response.body).toBe(200);
    expect(people(directory)).toEqual(held);
    expect(filedUnder(started)).toContainEqual({ person_id: SAMANTHA_ID, rows: 5 });
  });

  test("the directory adds a Confirm's new people all or none", () => {
    const directory = directoryOf();
    const before = people(directory);

    expect(() =>
      directory.addPeople(
        [
          { household: HOUSEHOLD, person: "Sam", newId: () => NEW_IDS[0] ?? "" },
          { household: HOUSEHOLD, person: "alex", newId: () => NEW_IDS[1] ?? "" },
        ],
        { by: ALEX, at: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "PERSON_NAME_TAKEN" }));
    expect(people(directory)).toEqual(before);
  });

  test("a verification that fails with a new person answered adds no one and writes nothing", async () => {
    const directory = directoryOf();
    const started = await start(directory);
    const before = { books: counts(started), directory: people(directory) };
    // 2023 carries in a cent more than 2022 left, so its carry-over check fails.
    const broken = history();
    const second = broken.years[1];
    if (second === undefined) throw new Error("no second year");
    second.carry.mortgage += 0.01;

    const response = await started.server.inject({
      method: "POST",
      url: ROUTES.workbookConfirm,
      headers: as(ALEX),
      payload: {
        file: (await render(broken)).toString("base64"),
        layout,
        names: [{ name: "Sam", as: "new", shownAs: "Sam" }],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(errorOf(response).code).toBe("WORKBOOK_IMPORT_REFUSED");
    expect(people(directory)).toEqual(before.directory);
    expect(counts(started)).toEqual(before.books);
  });
});
