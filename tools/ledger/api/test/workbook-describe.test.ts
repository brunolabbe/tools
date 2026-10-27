/**
 * A workbook the reader does not know, imported through a layout a model
 * describes (lg-66), through its two routes. **No test calls a model**: the
 * describer is a fake that answers what the test gives it and counts its calls,
 * and the ledger's vitest project clears the host's `ANTHROPIC_*` variables.
 * The workbooks are lg-38's and lg-56's synthetic fixtures, written as real
 * `.xlsx` files; every name and amount in them is invented.
 */

import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Sheet } from "@ledger/books";
import { MAX_WORKBOOK_BYTES, ROUTES } from "@ledger/contract";
import type {
  ConfirmWorkbookResponse,
  DescribeWorkbookResponse,
  ErrorResponse,
  WorkbookLayout,
} from "@ledger/contract";
import type { LayoutAnswer, LayoutAsk } from "@ledger/receipts";
import { householdBooksPath } from "../src/books.ts";
import { Directory } from "../src/directory.ts";
import { runImportCommand } from "../src/import-command.ts";
import { MAX_CELL_TEXT, layoutRequest } from "../src/layout-view.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import {
  MAX_REQUEST_TOKENS,
  MAX_WORKBOOK_CELLS,
  MAX_WORKBOOK_ROWS,
  MAX_WORKBOOK_SHEETS,
  estimatedRequestTokens,
} from "../src/workbook-describe.ts";
import {
  INFLATE_CHUNK_BYTES,
  MAX_WORKBOOK_ENTRIES,
  MAX_WORKBOOK_INFLATED_BYTES,
} from "../src/workbook-zip.ts";
import { readSheets } from "../src/xlsx.ts";
import {
  HOUSEHOLD,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
  writeMemberDirectory,
} from "./helpers/access.ts";
import { entriesOf, paddedDeflate, rawZip, reEnded, xlsxOf, zipOf } from "./helpers/xlsx-file.ts";
import { layoutFixtures } from "./layout/fixtures.ts";
import type { LayoutFixture } from "./layout/fixtures.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-10-07T12:00:00.000Z");
/** A key the server is configured with, so a test can look for it in the log. Never sent. */
const API_KEY = "sk-ant-test-lg66-never-sent";

/** The six workbook fixtures, the ones this ticket imports (Decision 2, split). */
const WORKBOOKS = ["lg7", "lg37", "moved", "english", "swapped-labels", "empty-columns-carry"];

let fixtures: LayoutFixture[];
/** Each fixture's `.xlsx`, written once. */
const files = new Map<string, Buffer>();

beforeAll(async () => {
  fixtures = await layoutFixtures();
  for (const name of WORKBOOKS) files.set(name, await xlsxOf(fixture(name).sheets));
});

function fixture(name: string): LayoutFixture {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
}

function fileOf(name: string): Buffer {
  const found = files.get(name);
  if (found === undefined) throw new Error(`no file ${name}`);
  return found;
}

/** A describer that answers `answers` in turn, and keeps what it was asked. */
interface FakeAsk {
  ask: LayoutAsk;
  requests: string[];
}

function fake(...answers: LayoutAnswer[]): FakeAsk {
  const made: FakeAsk = {
    requests: [],
    ask: async (request) => {
      made.requests.push(request);
      const answer = answers[Math.min(made.requests.length, answers.length) - 1];
      if (answer === undefined) throw new Error("the fake has no answer");
      return answer;
    },
  };
  return made;
}

function answering(layout: unknown): LayoutAnswer {
  return {
    text: JSON.stringify(layout),
    stopReason: "end_turn",
    inputTokens: 4_100,
    outputTokens: 420,
  };
}

/** A sheet reader that counts its calls and reads as `xlsx.ts` does, or as `instead` says. */
interface SpyReader {
  read: (bytes: Buffer) => Promise<Sheet[]>;
  calls: number;
}

function spyReader(instead?: Sheet[]): SpyReader {
  const spy: SpyReader = {
    calls: 0,
    read: async (bytes) => {
      spy.calls += 1;
      return instead ?? (await readSheets(bytes));
    },
  };
  return spy;
}

let app: App | undefined;
/** Every line any app of this file logged, for the test that reads them all. */
const LOGGED: string[] = [];

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

interface Started {
  app: App;
  /** The address the caller signs in with. */
  caller: string;
  reader: SpyReader;
  inflated: number[];
}

/**
 * An app whose household holds `people` (the fixture's), the first of them the
 * caller. The key is configured, so only the fake stands between a request and
 * a model.
 */
async function start(
  options: {
    people?: readonly string[];
    /** A directory of the test's own, in place of one under `people`'s readable ids. */
    directory?: Directory;
    ask?: LayoutAsk | null;
    sheets?: Sheet[];
  } = {},
): Promise<Started> {
  const people = options.people ?? ["alex", "sam"];
  const reader = spyReader(options.sheets);
  const inflated: number[] = [];
  app = await createApp({
    directory:
      options.directory ??
      memberDirectory(people.map((person) => [`${person}@example.test`, person])),
    config: {
      dataDir: ":memory:",
      access: accessConfig(),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
      rateLimitWorkbookDescribesPerMinute: 0,
      receiptReader: { apiKey: API_KEY, model: "claude-haiku-5-5" },
    },
    logger: createLogger({ level: "debug", write: (line: string) => LOGGED.push(line) }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
    receiptReader: null,
    layoutAsk: options.ask === undefined ? fake().ask : options.ask,
    workbookSheets: reader.read,
    inflateSpy: (bytes) => inflated.push(bytes),
  });
  return { app, caller: `${people[0] ?? "alex"}@example.test`, reader, inflated };
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

/** `OMIT` leaves the consent field out of the body. */
const OMIT = Symbol("omit");

async function describeFile(started: Started, file: Buffer | string, consent: unknown = true) {
  const body: Record<string, unknown> = {
    file: typeof file === "string" ? file : file.toString("base64"),
  };
  if (consent !== OMIT) body["consent"] = consent;
  return await started.app.server.inject({
    method: "POST",
    url: ROUTES.workbookDescribe,
    headers: as(started.caller),
    payload: body,
  });
}

async function confirmFile(started: Started, file: Buffer, layout: unknown) {
  return await started.app.server.inject({
    method: "POST",
    url: ROUTES.workbookConfirm,
    headers: as(started.caller),
    payload: { file: file.toString("base64"), layout },
  });
}

/** How many rows each table of the household's books holds. */
function counts(started: Started): Record<string, number> {
  const db = started.app.books.of(HOUSEHOLD);
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

function errorOf(response: { json: <T>() => T }): ErrorResponse["error"] {
  return response.json<ErrorResponse>().error;
}

describe("describing a workbook (Done when 5)", () => {
  test.each(WORKBOOKS)(
    "%s: a fake answering its correct description gives back that description, the confirmation and a report, and writes nothing",
    async (name) => {
      const each = fixture(name);
      const model = fake(answering(each.layout));
      const started = await start({ people: each.people, ask: model.ask });
      const before = counts(started);

      const response = await describeFile(started, fileOf(name));

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<DescribeWorkbookResponse>();
      expect(body.layout).toEqual(each.layout);
      expect(body.report).toContain("Verifications");
      // lg7 imports into empty books. The five generated workbooks carry money
      // into their first year (lg-38's generator opens at 1 200.00 and 300.00),
      // which `importWorkbook` refuses into books that count nothing before
      // their first row, through the command as on the screen (lg-66's Log).
      if (name === "lg7") {
        expect(body.ok, body.problems.join("\n")).toBe(true);
        expect(body.report).toContain("Confirm to import.");
      } else {
        expect(body.ok).toBe(false);
        expect(body.problems).toContainEqual(
          expect.stringMatching(/^The first year carries in .* from before the workbook/u),
        );
      }
      const date = each.layout.account.columns.find((entry) => entry.role === "date");
      expect(body.confirmation.dateColumn.column).toBe(date?.column);
      expect(body.confirmation.dateColumn.oldest).toHaveLength(3);
      expect(body.confirmation.dateColumn.newest).toHaveLength(3);
      expect(body.confirmation.buckets.map((entry) => entry.label)).toEqual(
        each.layout.account.buckets.flatMap((entry) => entry.labels),
      );
      expect(body.usage).toEqual({ inputTokens: 4_100, outputTokens: 420 });
      expect(model.requests).toHaveLength(1);
      expect(counts(started)).toEqual(before);
    },
  );

  // Functions, because the fixtures are read in `beforeAll`, after the table is.
  test.each([
    ["text that is not JSON", () => ({ text: "Here is the layout:", stopReason: "end_turn" })],
    [
      "an object the schema refuses",
      () => ({ text: '{"account":{"sheets":{"by":"year"}}}', stopReason: "end_turn" }),
    ],
    [
      "a valid description after max_tokens",
      () => ({ text: JSON.stringify(validLayout()), stopReason: "max_tokens" }),
    ],
  ])(
    "%s is LAYOUT_UNREADABLE, the model asked once, and nothing written",
    async (_what, answer) => {
      const model = fake({ ...answer(), inputTokens: 4_000, outputTokens: 16_000 });
      const started = await start({ ask: model.ask });
      const before = counts(started);

      const response = await describeFile(started, fileOf("lg7"));

      expect(response.statusCode).toBe(422);
      expect(errorOf(response).code).toBe("LAYOUT_UNREADABLE");
      expect(model.requests).toHaveLength(1);
      expect(counts(started)).toEqual(before);
    },
  );
});

/** lg7's correct description: a valid one, for the answer cut short. */
function validLayout(): WorkbookLayout {
  return fixture("lg7").layout;
}

/** A one-sheet workbook, small and real. */
async function smallWorkbook(): Promise<Buffer> {
  return await xlsxOf([
    {
      name: "Compte",
      rows: [
        [
          { value: { kind: "text", text: "Date" }, formula: null },
          { value: { kind: "text", text: "Montant" }, formula: null },
        ],
        [
          { value: { kind: "date", date: "2026-01-05" }, formula: null },
          { value: { kind: "number", number: 12.5 }, formula: null },
        ],
      ],
    },
  ]);
}

/** `count` sheets of one row each. */
function sheetsOf(count: number, rows = 1, cells = 1, text = "x"): Sheet[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `S${String(index + 1)}`,
    rows: Array.from({ length: rows }, () =>
      Array.from({ length: cells }, () => ({
        value: { kind: "text" as const, text },
        formula: null,
      })),
    ),
  }));
}

describe("what is refused before the model is asked (Done when 6 and 8)", () => {
  test("a request without the consent field", async () => {
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });
    for (const consent of [OMIT, false, "yes", null]) {
      const response = await describeFile(started, fileOf("lg7"), consent);
      expect(response.statusCode).toBe(400);
      // The consent sentence, not the schema's "Choose a workbook to send.":
      // the person is told why, and that nothing left (gate 1's F5).
      expect(errorOf(response)).toMatchObject({
        code: "BAD_REQUEST",
        message:
          "The workbook's samples are sent only when you agree to send them. Nothing was sent.",
      });
    }
    expect(model.requests).toHaveLength(0);
    expect(started.reader.calls).toBe(0);
  });

  test("a request with no key configured", async () => {
    const started = await start({ ask: null });
    const response = await describeFile(started, fileOf("lg7"));
    expect(response.statusCode).toBe(503);
    expect(errorOf(response).code).toBe("LAYOUT_READER_UNCONFIGURED");
    expect(started.reader.calls).toBe(0);
  });

  test("an upload over the byte bound, before the workbook is parsed", async () => {
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });
    const over = Buffer.alloc(MAX_WORKBOOK_BYTES + 1, 0x50);
    const response = await describeFile(started, over);
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({
      code: "SIZE_LIMIT_EXCEEDED",
      details: { bound: "bytes" },
    });
    expect(started.reader.calls).toBe(0);
    expect(started.inflated).toEqual([]);
    expect(model.requests).toHaveLength(0);
  });

  test.each([
    ["sheets", sheetsOf(MAX_WORKBOOK_SHEETS + 1)],
    ["rows", sheetsOf(1, MAX_WORKBOOK_ROWS + 1)],
    ["cells", sheetsOf(1, 2_001, Math.ceil(MAX_WORKBOOK_CELLS / 2_000))],
  ])("a workbook over the %s bound, once parsed", async (bound, sheets) => {
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask, sheets });
    const response = await describeFile(started, await smallWorkbook());
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({ code: "WORKBOOK_TOO_LARGE", details: { bound } });
    expect(started.reader.calls).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  test("a workbook whose request is over the estimate's bound", async () => {
    // 40 sheets, each showing 21 rows of 40 cells cut to 40 characters: under
    // every other bound, and far over this one.
    const sheets = sheetsOf(MAX_WORKBOOK_SHEETS, 21, 40, "y".repeat(80));
    expect(estimatedRequestTokens(layoutRequest(sheets))).toBeGreaterThan(MAX_REQUEST_TOKENS);
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask, sheets });
    const response = await describeFile(started, await smallWorkbook());
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({
      code: "WORKBOOK_TOO_LARGE",
      details: { bound: "request" },
    });
    expect(errorOf(response).message).toContain("an estimate");
    expect(model.requests).toHaveLength(0);
  });

  test("the estimate is the four-characters estimate of the request and the schema, times 2.32", () => {
    const request = layoutRequest(fixture("lg37").sheets);
    // 10 518 characters, 2 630 by four; the schema's 5 963 are 1 491.
    expect(request.length).toBe(10_518);
    expect(estimatedRequestTokens(request)).toBe(Math.ceil((2_630 + 1_491) * 2.32));
  });

  test("a confirm request never asks the model", async () => {
    const model = fake(answering(fixture("lg7").layout));
    const each = fixture("lg7");
    const started = await start({ people: each.people, ask: model.ask });
    const response = await confirmFile(started, fileOf("lg7"), each.layout);
    expect(response.statusCode, response.body).toBe(200);
    expect(model.requests).toHaveLength(0);
  });

  test("a cell longer than the cell-text bound is sent cut, and the file is still read in full", async () => {
    const each = fixture("lg7");
    const long = `Épicerie du marché ${"très ".repeat(20)}longue`;
    expect(long.length).toBeGreaterThan(MAX_CELL_TEXT);
    // The detail of the newest row of 2022, its sheet's second row: one the view shows.
    const was = each.sheets.find((sheet) => sheet.name === "2022")?.rows[1]?.[3];
    expect(was?.value?.kind).toBe("text");
    const sheets: Sheet[] = each.sheets.map((sheet) =>
      sheet.name !== "2022"
        ? sheet
        : {
            name: sheet.name,
            rows: sheet.rows.map((cells, index) =>
              index !== 1
                ? cells
                : cells.map((cell, column) =>
                    column === 3 ? { value: { kind: "text", text: long }, formula: null } : cell,
                  ),
            ),
          },
    );
    const file = await xlsxOf(sheets);
    const model = fake(answering(each.layout));
    const started = await start({ people: each.people, ask: model.ask });

    const response = await describeFile(started, file);

    expect(response.statusCode, response.body).toBe(200);
    const [request = ""] = model.requests;
    expect(request).toContain(JSON.stringify(`${long.slice(0, MAX_CELL_TEXT)}…`));
    expect(request).not.toContain(long.slice(0, MAX_CELL_TEXT + 1));
    // Read in full: the import stores the whole text.
    expect((await confirmFile(started, file, each.layout)).statusCode).toBe(200);
    const stored = started.app.books
      .of(HOUSEHOLD)
      .prepare("SELECT description FROM statement_rows WHERE description = ?")
      .all(long);
    expect(stored).toHaveLength(1);
  });
});

describe("the inflated size, bounded before exceljs inflates anything (Done when 8)", () => {
  /** A real one-sheet workbook with its sheet's XML replaced. */
  async function withSheet(
    sheet: (xml: Buffer) => Promise<{ bytes: Buffer; crc: number; size: number }>,
    declare?: (xml: Buffer) => number,
  ): Promise<Buffer> {
    const entries = entriesOf(await smallWorkbook());
    return zipOf(
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name !== "xl/worksheets/sheet1.xml" || entry.data === undefined) return entry;
          const xml = entry.data;
          return {
            name: entry.name,
            deflated: await sheet(xml),
            ...(declare === undefined ? {} : { declaredSize: declare(xml) }),
          };
        }),
      ),
    );
  }

  test("the bound is under the smaller padding, and over the largest workbook fixture", () => {
    expect(MAX_WORKBOOK_INFLATED_BYTES).toBeLessThan(40 * 1024 * 1024);
    for (const name of WORKBOOKS) {
      const total = entriesOf(fileOf(name)).reduce(
        (sum, entry) => sum + (entry.data?.length ?? 0),
        0,
      );
      // lg37, the largest, is 90 542 bytes: 46 times under the bound (round 1, F2).
      expect(total, name).toBeLessThan(MAX_WORKBOOK_INFLATED_BYTES / 40);
    }
  });

  test.each([40, 200])(
    "a workbook padded with %i MiB of whitespace is refused from its declared sizes, nothing inflated",
    async (mebibytes) => {
      const padded = await withSheet((xml) => paddedDeflate(xml, mebibytes * 1024 * 1024));
      expect(padded.length).toBeLessThan(MAX_WORKBOOK_BYTES);
      const model = fake(answering(fixture("lg7").layout));
      const started = await start({ ask: model.ask });

      const response = await describeFile(started, padded);

      expect(response.statusCode).toBe(413);
      expect(errorOf(response)).toMatchObject({
        code: "WORKBOOK_TOO_LARGE",
        details: { bound: "inflated" },
      });
      expect(started.inflated.reduce((sum, bytes) => sum + bytes, 0)).toBe(0);
      expect(started.reader.calls).toBe(0);
      expect(model.requests).toHaveLength(0);
    },
  );

  test("a zip that declares less than it holds is stopped at the bound, before the sheet reader", async () => {
    const lying = await withSheet(
      (xml) => paddedDeflate(xml, MAX_WORKBOOK_INFLATED_BYTES + 4 * 1024 * 1024),
      (xml) => xml.length,
    );
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });

    const response = await describeFile(started, lying);

    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({
      code: "WORKBOOK_TOO_LARGE",
      details: { bound: "inflated" },
    });
    const inflated = started.inflated.reduce((sum, bytes) => sum + bytes, 0);
    expect(inflated).toBeGreaterThan(MAX_WORKBOOK_INFLATED_BYTES);
    expect(inflated).toBeLessThanOrEqual(MAX_WORKBOOK_INFLATED_BYTES + INFLATE_CHUNK_BYTES);
    expect(started.reader.calls).toBe(0);
    expect(model.requests).toHaveLength(0);
  });
});

describe("confirming (Done when 7)", () => {
  /** `name`'s workbook through `import:ledger --write`, into books of its own. */
  async function throughCommand(
    name: string,
    read: (db: Database.Database) => void,
  ): Promise<{ code: number; out: string }> {
    const each = fixture(name);
    const dir = mkdtempSync(path.join(tmpdir(), "ledger-lg66-"));
    try {
      const dataDir = path.join(dir, "books");
      const directoryPath = path.join(dir, "directory.db");
      writeMemberDirectory(
        directoryPath,
        each.people.map((person) => [`${person}@example.test`, person]),
      );
      writeFileSync(path.join(dir, "classeur.xlsx"), fileOf(name));
      let out = "";
      const code = await runImportCommand(
        ["classeur.xlsx", "--as", each.people[0] ?? "alex", "--write", "--household", HOUSEHOLD],
        {
          stdout: (text) => {
            out += text;
          },
          stderr: (text) => {
            out += text;
          },
          env: { DATABASE_PATH: dataDir, DIRECTORY_PATH: directoryPath },
          cwd: dir,
          now: () => NOW,
        },
      );
      if (code === 0) {
        const db = new Database(householdBooksPath(dataDir, HOUSEHOLD), { readonly: true });
        try {
          read(db);
        } finally {
          db.close();
        }
      }
      return { code, out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const MOVEMENTS =
    "SELECT seq, date, description, amount_cents, balance_cents FROM statement_rows ORDER BY seq";
  const FILED =
    "SELECT r.seq, c.bucket, c.person_id FROM classifications c JOIN statement_rows r ON r.id = c.row_id ORDER BY r.seq, c.id";

  /** The report's figures, line for line. */
  function figures(report: string): string {
    return report.slice(report.indexOf("Figures over"), report.indexOf("Verifications"));
  }

  test("lg7 with its correct description leaves the books as import:ledger --write leaves them", async () => {
    const each = fixture("lg7");
    const started = await start({ people: each.people });
    const response = await confirmFile(started, fileOf("lg7"), each.layout);
    expect(response.statusCode, response.body).toBe(200);
    const screen = response.json<ConfirmWorkbookResponse>().report;
    const ours = started.app.books.of(HOUSEHOLD);

    let compared = 0;
    const command = await throughCommand("lg7", (db) => {
      expect(ours.prepare(MOVEMENTS).all()).toEqual(db.prepare(MOVEMENTS).all());
      expect(ours.prepare(FILED).all()).toEqual(db.prepare(FILED).all());
      compared = (db.prepare(MOVEMENTS).all() as unknown[]).length;
    });

    expect(command.code, command.out).toBe(0);
    expect(compared).toBe(17);
    expect(figures(screen).length).toBeGreaterThan(20);
    expect(figures(screen)).toBe(figures(command.out));
  });

  // lg37 is the brief's fixture, and neither way imports it: it carries money
  // into its first year, which the books cannot count (lg-66's Log). The screen
  // refuses it as the command does, for the same reasons, and keeps nothing.
  test("lg37 with its correct description is refused as import:ledger --write refuses it, and nothing is written", async () => {
    const each = fixture("lg37");
    const started = await start({ people: each.people });
    const before = counts(started);

    const response = await confirmFile(started, fileOf("lg37"), each.layout);
    const command = await throughCommand("lg37", () => undefined);

    expect(response.statusCode).toBe(422);
    const problems = errorOf(response).details?.["problems"] as string[];
    expect(command.code).toBe(1);
    const failed = command.out
      .split("\n")
      .filter((line) => line.startsWith("  FAILED  "))
      .map((line) => line.slice("  FAILED  ".length));
    expect(problems).toEqual(failed);
    expect(problems.length).toBeGreaterThan(0);
    expect(counts(started)).toEqual(before);
  });

  test("lg37 with amount and balance swapped is refused for the description, and nothing is written", async () => {
    const each = fixture("lg37");
    const wrong = structuredClone(each.layout);
    for (const entry of wrong.account.columns) {
      if (entry.role === "amount") entry.role = "balance";
      else if (entry.role === "balance") entry.role = "amount";
    }
    const started = await start({ people: each.people });
    const before = counts(started);

    const right = errorOf(await confirmFile(started, fileOf("lg37"), each.layout));
    const response = await confirmFile(started, fileOf("lg37"), wrong);

    expect(response.statusCode).toBe(422);
    const error = errorOf(response);
    expect(error.code).toBe("WORKBOOK_IMPORT_REFUSED");
    // Problems of its own, not only the ones the correct description meets.
    const problemsOf = (refusal: ErrorResponse["error"]): string[] =>
      (refusal.details?.["problems"] as string[] | undefined) ?? [];
    const own = problemsOf(error).filter((problem) => !problemsOf(right).includes(problem));
    expect(own.length).toBeGreaterThan(0);
    expect(counts(started)).toEqual(before);
  });
});

describe("only an .xlsx is read, judged from the bytes (Done when 13)", () => {
  const MINIMAL_TYPES =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
  const NO_SHEETS =
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>';

  async function csvText(): Promise<Buffer> {
    const csv = fixtures.find((candidate) => candidate.name === "csv-balance");
    // The fixture's sheet back as the text it was read from.
    const lines = (csv?.sheets[0]?.rows ?? []).map((row) =>
      row
        .map((cell) => {
          const value = cell?.value ?? null;
          if (value === null) return "";
          if (value.kind === "number") return String(value.number);
          if (value.kind === "date") return value.date;
          return value.text.includes(",") ? `"${value.text}"` : value.text;
        })
        .join(","),
    );
    return Buffer.from(`${lines.join("\n")}\n`);
  }

  test("a bank CSV, a CSV whose first header is PK ID, and a zip that is not a workbook get one refusal", async () => {
    const uploads = [
      await csvText(),
      Buffer.from("PK ID,Date,Amount\n1,2026-01-05,12.50\n"),
      zipOf([{ name: "notes.txt", data: Buffer.from("Rien ici") }]),
    ];
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });
    const before = counts(started);
    const refusals = [];
    for (const upload of uploads) {
      for (const response of [
        await describeFile(started, upload),
        await confirmFile(started, upload, fixture("lg7").layout),
      ]) {
        expect(response.statusCode).toBe(415);
        refusals.push(errorOf(response));
      }
    }
    expect(new Set(refusals.map((error) => `${error.code}: ${error.message}`))).toEqual(
      new Set([
        "WORKBOOK_NOT_XLSX: Only an .xlsx workbook can be imported here. Save the file as an Excel workbook (.xlsx) and choose it again.",
      ]),
    );
    expect(model.requests).toHaveLength(0);
    expect(started.reader.calls).toBe(0);
    expect(counts(started)).toEqual(before);
  });

  test("a zip with the workbook's two entries and no sheet reads as 0 sheets, a refusal of its own", async () => {
    const empty = zipOf([
      { name: "[Content_Types].xml", data: Buffer.from(MINIMAL_TYPES) },
      { name: "xl/workbook.xml", data: Buffer.from(NO_SHEETS) },
    ]);
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });

    const response = await describeFile(started, empty);

    expect(response.statusCode).toBe(422);
    expect(errorOf(response)).toMatchObject({
      code: "WORKBOOK_NO_SHEETS",
      message: "That workbook has no sheet to read.",
    });
    expect(started.reader.calls).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  test("the file's name never reaches the server, so only its bytes decide", async () => {
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });
    const response = await started.app.server.inject({
      method: "POST",
      url: ROUTES.workbookDescribe,
      headers: as(started.caller),
      payload: { file: fileOf("lg7").toString("base64"), consent: true, name: "releve.csv" },
    });
    expect(response.statusCode).toBe(400);
    expect(model.requests).toHaveLength(0);
  });
});

describe("the confirmation's bucket labels (Done when 10)", () => {
  test("swapped-labels with the mapping swapped lists Compte 2 under current-expenses, its sample holding the loan payments", async () => {
    const each = fixture("swapped-labels");
    const swapped = structuredClone(each.layout);
    for (const entry of swapped.account.buckets) {
      entry.bucket = entry.bucket === "mortgage" ? "current-expenses" : "mortgage";
    }
    const started = await start({ people: each.people, ask: fake(answering(swapped)).ask });

    const response = await describeFile(started, fileOf("swapped-labels"));

    expect(response.statusCode, response.body).toBe(200);
    const { buckets } = response.json<DescribeWorkbookResponse>().confirmation;
    const compte2 = buckets.find((entry) => entry.label === "Compte 2");
    expect(compte2?.bucket).toBe("current-expenses");
    expect(compte2?.rows).toBeGreaterThan(10);
    expect(compte2?.examples).toHaveLength(3);
    expect(compte2?.examples.map((row) => row.detail)).toContain("Paiement prêt");
    expect(
      buckets.find((entry) => entry.label === "Compte 1")?.examples.map((row) => row.detail),
    ).not.toContain("Paiement prêt");
  });
});

describe("the log (Done when 8)", () => {
  test("no line of any request above holds the upload's content, a name or the key", () => {
    // Read after every test above has run in this file: vitest runs a file's
    // tests in order, and LOGGED holds every app's lines.
    expect(LOGGED.length).toBeGreaterThan(20);
    const secrets = [
      API_KEY,
      fileOf("lg37").toString("base64").slice(0, 40),
      "classeur",
      "releve",
      ".xlsx",
      ".csv",
      "Paiement prêt",
      "Compte 2",
      "Solde reporté",
      "Hypothèque",
    ];
    const leaking = LOGGED.filter((line) => secrets.some((secret) => line.includes(secret)));
    expect(leaking).toEqual([]);
    // And it did log the requests, so the search read something.
    expect(LOGGED.some((line) => line.includes("a workbook was described"))).toBe(true);
    expect(LOGGED.some((line) => line.includes("a described workbook was imported"))).toBe(true);
  });
});

describe("the web's fixture (Done when 9)", () => {
  test("web/test/fixtures/lg37-describe.json is what Describe answers for lg37", async () => {
    const each = fixture("lg37");
    const model = fake({ ...answering(each.layout), inputTokens: 9_468, outputTokens: 512 });
    const started = await start({ people: each.people, ask: model.ask });

    const response = await describeFile(started, fileOf("lg37"));

    expect(response.statusCode, response.body).toBe(200);
    const kept: unknown = JSON.parse(
      readFileSync(new URL("../../web/test/fixtures/lg37-describe.json", import.meta.url), "utf8"),
    );
    expect(response.json()).toEqual(kept);
  });
});

describe("stored entries, counted before the sheet reader (lg-66 gate 1, F1)", () => {
  test("forty directory entries over one stored block, each declaring 0, are refused before the sheet reader", async () => {
    // Nothing inflates a stored entry, so only the count stands between these
    // forty names over one block and a reader that reads each of them whole.
    // Three tenths of the bound: a stop on a whole entry would overshoot by a fifth.
    const block = Buffer.alloc(Math.floor(MAX_WORKBOOK_INFLATED_BYTES * 0.3), 0x20);
    const zip = rawZip([
      {
        name: "[Content_Types].xml",
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
        ),
      },
      {
        name: "xl/workbook.xml",
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
        ),
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        name: `xl/worksheets/sheet${String(index + 1)}.xml`,
        data: block,
        method: 0,
        declaredSize: 0,
        ...(index === 0 ? {} : { sameAs: 2 }),
      })),
    ]);
    expect(zip.length).toBeLessThan(MAX_WORKBOOK_BYTES);
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });

    for (const response of [
      await describeFile(started, zip),
      await confirmFile(started, zip, fixture("lg7").layout),
    ]) {
      expect(response.statusCode).toBe(413);
      expect(errorOf(response)).toMatchObject({
        code: "WORKBOOK_TOO_LARGE",
        details: { bound: "inflated" },
      });
    }
    // Two requests, each stopped past the bound by one chunk at most.
    const counted = started.inflated.reduce((sum, bytes) => sum + bytes, 0);
    expect(counted).toBeGreaterThan(2 * MAX_WORKBOOK_INFLATED_BYTES);
    expect(counted).toBeLessThanOrEqual(2 * (MAX_WORKBOOK_INFLATED_BYTES + INFLATE_CHUNK_BYTES));
    expect(started.reader.calls).toBe(0);
    expect(model.requests).toHaveLength(0);
  });
});

describe("the zip's entries, counted before anything is inflated (lg-66 gate 1, F2)", () => {
  test("a workbook of more entries than the bound is refused before the inflate and the sheet reader", async () => {
    const tiny = Buffer.from("x");
    const over = zipOf([
      ...entriesOf(await smallWorkbook()),
      ...Array.from({ length: MAX_WORKBOOK_ENTRIES }, (_, index) => ({
        name: `xl/media/part${String(index)}.bin`,
        data: tiny,
      })),
    ]);
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });

    for (const response of [
      await describeFile(started, over),
      await confirmFile(started, over, fixture("lg7").layout),
    ]) {
      expect(response.statusCode).toBe(413);
      expect(errorOf(response)).toMatchObject({
        code: "WORKBOOK_TOO_LARGE",
        details: { bound: "entries" },
      });
    }
    expect(started.inflated).toEqual([]);
    expect(started.reader.calls).toBe(0);
    expect(model.requests).toHaveLength(0);
  });
});

describe("an end record and a directory that disagree (lg-66 gate 2, F2)", () => {
  // `jszip`, which exceljs calls, reads every header that follows while its
  // signature matches, whatever the end record counts, and shifts its offsets
  // when the directory ends short of the record. These are each refused before
  // the sheet reader, so neither parser reads what the other does not.
  const TYPES =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
  const NO_SHEETS =
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>';

  async function refusedBeforeTheReader(file: Buffer): Promise<void> {
    expect(file.length).toBeLessThan(MAX_WORKBOOK_BYTES);
    const model = fake(answering(fixture("lg7").layout));
    const started = await start({ ask: model.ask });
    for (const response of [
      await describeFile(started, file),
      await confirmFile(started, file, fixture("lg7").layout),
    ]) {
      expect(response.statusCode).toBe(415);
      expect(errorOf(response).code).toBe("WORKBOOK_NOT_XLSX");
    }
    expect(started.reader.calls).toBe(0);
    expect(model.requests).toHaveLength(0);
  }

  test("a sheet padded past the inflated bound, left out of the end record's count, is refused", async () => {
    // Gate 2's D1 at twice the bound rather than 200 MiB: the sheet is last,
    // and the record counts every entry but it.
    const entries = entriesOf(await smallWorkbook());
    const sheet = entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml");
    const others = entries.filter((entry) => entry !== sheet);
    const padded = await paddedDeflate(
      sheet?.data ?? Buffer.alloc(0),
      2 * MAX_WORKBOOK_INFLATED_BYTES,
    );
    const zip = zipOf([...others, { name: "xl/worksheets/sheet1.xml", deflated: padded }]);
    await refusedBeforeTheReader(reEnded(zip, { count: -1 }));
  });

  test("44,000 entries under an end record that counts 2 are refused", async () => {
    // Gate 2's D2: stored and empty, so the file stays under the byte bound.
    const zip = rawZip([
      { name: "[Content_Types].xml", data: Buffer.from(TYPES) },
      { name: "xl/workbook.xml", data: Buffer.from(NO_SHEETS) },
      ...Array.from({ length: 44_000 }, (_, index) => ({
        name: `p/${String(index)}`,
        data: Buffer.alloc(0),
        method: 0,
      })),
    ]);
    await refusedBeforeTheReader(reEnded(zip, { count: 2 - 44_002 }));
  });

  test("a directory that ends before the end record's stated position is refused", async () => {
    // Sixteen bytes between the directory and the record: `jszip` would read
    // every offset sixteen bytes on from where this parse reads it.
    await refusedBeforeTheReader(
      reEnded(await smallWorkbook(), { insert: Buffer.alloc(16, 0x20) }),
    );
  });
});

describe("a household whose people have generated ids (lg-79)", () => {
  const ALEX_ID = "4f9c2d8e-1b3a-4c5d-9e6f-7a8b9c0d1e2f";
  const SAM_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

  /** alex and sam as lg-76 adds them: a UUID each, the name typed only shown. */
  function generatedDirectory(
    people: readonly (readonly [string, string])[] = [
      ["alex", ALEX_ID],
      ["sam", SAM_ID],
    ],
  ): Directory {
    const directory = Directory.open(":memory:");
    const change = { by: "operator", at: NOW };
    directory.addHousehold({ id: HOUSEHOLD, name: "Home", ...change });
    for (const [person, id] of people) {
      directory.addMemberByName({
        household: HOUSEHOLD,
        address: `${person}@example.test`,
        person,
        ...change,
        newId: () => id,
      });
    }
    return directory;
  }

  test("the workbook's names reach them by their shown names, on describe and on confirm", async () => {
    const started = await start({
      directory: generatedDirectory(),
      ask: fake(answering(validLayout())).ask,
    });

    const described = await describeFile(started, fileOf("lg7"));

    expect(described.statusCode, described.body).toBe(200);
    const body = described.json<DescribeWorkbookResponse>();
    expect(body.ok, body.problems.join("\n")).toBe(true);

    const confirmed = await confirmFile(started, fileOf("lg7"), body.layout);

    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const db = started.app.books.of(HOUSEHOLD);
    expect(db.prepare("SELECT DISTINCT person_id FROM salaries ORDER BY person_id").all()).toEqual([
      { person_id: ALEX_ID },
      { person_id: SAM_ID },
    ]);
    expect(
      db
        .prepare(
          "SELECT DISTINCT person_id FROM classifications WHERE person_id IS NOT NULL ORDER BY person_id",
        )
        .all(),
    ).toEqual([{ person_id: ALEX_ID }, { person_id: SAM_ID }]);
  });

  test("a name the household lacks is refused naming the household as shown, never by a generated id", async () => {
    const started = await start({
      directory: generatedDirectory([["alex", ALEX_ID]]),
      ask: fake(answering(validLayout())).ask,
    });

    const described = await describeFile(started, fileOf("lg7"));

    expect(described.statusCode, described.body).toBe(200);
    const body = described.json<DescribeWorkbookResponse>();
    expect(body.ok).toBe(false);
    expect(body.problems).toContain(
      `2022!E6 names "Sam", who is not one of the household (alex). Map the name to a person in the corrections file's "people".`,
    );
    expect(body.problems.join("\n")).not.toContain(ALEX_ID);
  });
});
