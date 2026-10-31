/**
 * A bank CSV read through a layout a model describes, into the inbox (lg-67),
 * through the import screen's two routes. **No test calls a model**: the
 * describer is a fake that answers what the test gives it and counts its
 * calls. The CSVs are lg-38's and lg-56's seven synthetic fixtures, their text
 * as measured; every description and amount in them is invented, and so is the
 * one non-UTF-8 file written here.
 */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { readWorkbook } from "@ledger/books";
import type { Sheet } from "@ledger/books";
import { CSV_SHEET_NAME, ROUTES } from "@ledger/contract";
import type {
  ConfirmWorkbookResponse,
  DescribeWorkbookResponse,
  ErrorResponse,
  WorkbookLayout,
} from "@ledger/contract";
import type { LayoutAnswer, LayoutAsk } from "@ledger/receipts";
import type { classifyAdded } from "../src/classifications.ts";
import { csvSheet, refuseUnreadShapes, unreadShapes } from "../src/csv.ts";
import { placementOf, storeCsvRows } from "../src/csv-statement.ts";
import { layoutRequest } from "../src/layout-view.ts";
import { createLogger } from "../src/logger.ts";
import { createRule } from "../src/rules.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { insertRows } from "../src/statements.ts";
import type { RowToStore } from "../src/statements.ts";
import {
  HOUSEHOLD,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";
import { dump } from "./helpers/dump.ts";
import { xlsxOf } from "./helpers/xlsx-file.ts";
import { layoutFixtures, writtenRows } from "./layout/fixtures.ts";
import type { LayoutFixture } from "./layout/fixtures.ts";

const KEY = testKey("key-1");
const NOW = new Date("2026-10-07T12:00:00.000Z");
const API_KEY = "sk-ant-test-lg67-never-sent";

/** The seven bank CSV fixtures, in the measurement's order. */
const CSVS = [
  "csv-balance",
  "csv-no-balance",
  "empty-columns-csv",
  "bank-preamble",
  "bank-two-dates",
  "bank-footer",
  "bank-wide",
];
/** The six with a balance column, which the import serves (Decision 1 (a)). */
const SERVED = CSVS.filter((name) => name !== "csv-no-balance");

let fixtures: LayoutFixture[];

beforeAll(async () => {
  fixtures = await layoutFixtures();
});

function fixture(name: string): LayoutFixture {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
}

function textOf(name: string): string {
  const text = fixture(name).text;
  if (text === undefined) throw new Error(`${name} has no text`);
  return text;
}

function bytesOf(name: string): Buffer {
  return Buffer.from(textOf(name), "utf8");
}

/** The fixture's correct description, selecting the sheet by the name the upload is read under. */
function uploaded(name: string): WorkbookLayout {
  const layout = structuredClone(fixture(name).layout);
  layout.account.sheets = { by: "name", names: [CSV_SHEET_NAME] };
  return layout;
}

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
    inputTokens: 2_100,
    outputTokens: 310,
  };
}

let app: App | undefined;
const LOGGED: string[] = [];

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

interface Started {
  app: App;
  model: FakeAsk;
  sheetReads: number;
}

async function start(model: FakeAsk = fake()): Promise<Started> {
  const started: Started = { app: undefined as unknown as App, model, sheetReads: 0 };
  app = await createApp({
    directory: memberDirectory([
      ["alex@example.test", "alex"],
      ["sam@example.test", "sam"],
    ]),
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
    layoutAsk: model.ask,
    workbookSheets: async (): Promise<Sheet[]> => {
      started.sheetReads += 1;
      throw new Error("a CSV never reaches the workbook reader");
    },
  });
  started.app = app;
  return started;
}

function headers(): Record<string, string> {
  return {
    "cf-access-jwt-assertion": signToken({
      key: KEY,
      nowSec: Math.floor(NOW.getTime() / 1000),
      claims: { email: "alex@example.test" },
    }),
  };
}

async function describeFile(started: Started, file: Buffer, extra: Record<string, unknown> = {}) {
  return await started.app.server.inject({
    method: "POST",
    url: ROUTES.workbookDescribe,
    headers: headers(),
    payload: { file: file.toString("base64"), consent: true, ...extra },
  });
}

async function confirmFile(started: Started, file: Buffer, layout: unknown) {
  return await started.app.server.inject({
    method: "POST",
    url: ROUTES.workbookConfirm,
    headers: headers(),
    payload: { file: file.toString("base64"), layout },
  });
}

function booksOf(started: Started) {
  return started.app.books.of(HOUSEHOLD);
}

/** The books read once, so a test's `dump` compares two states of the same file. */
async function warmed(started: Started): Promise<void> {
  // Any request enrols the caller; done first so "unchanged" is about the CSV.
  await started.app.server.inject({ method: "GET", url: ROUTES.me, headers: headers() });
}

function errorOf(response: { json: <T>() => T }): ErrorResponse["error"] {
  return response.json<ErrorResponse>().error;
}

const STORED =
  "SELECT seq, date, category, description, amount_cents, balance_cents, note FROM statement_rows ORDER BY seq";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("Done when 1: a CSV is read as a CSV, from its bytes", () => {
  test("csv-balance's text: the fake is called once on describe and never on confirm", async () => {
    const model = fake(answering(uploaded("csv-balance")));
    const started = await start(model);

    const described = await describeFile(started, bytesOf("csv-balance"));
    expect(described.statusCode, described.body).toBe(200);
    expect(described.json<DescribeWorkbookResponse>().kind).toBe("csv");
    expect(model.requests).toHaveLength(1);

    const confirmed = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json<ConfirmWorkbookResponse>().kind).toBe("csv");
    expect(model.requests).toHaveLength(1);
    expect(started.sheetReads).toBe(0);
  });

  test("a CSV whose first header is PK ID is a CSV, not a refused zip", async () => {
    const file = Buffer.from("PK ID,Date,Amount,Balance\n1,2026-01-05,12.50,112.50\n");
    const layout: WorkbookLayout = {
      ...uploaded("csv-balance"),
      account: {
        ...uploaded("csv-balance").account,
        columns: [
          { role: "detail", column: "A" },
          { role: "date", column: "B" },
          { role: "amount", column: "C" },
          { role: "balance", column: "D" },
        ],
      },
    };
    const model = fake(answering(layout));
    const started = await start(model);

    const described = await describeFile(started, file);
    expect(described.statusCode, described.body).toBe(200);
    expect(described.json<DescribeWorkbookResponse>()).toMatchObject({ kind: "csv", ok: true });
    expect(model.requests).toHaveLength(1);

    const confirmed = await confirmFile(started, file, layout);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json<ConfirmWorkbookResponse>()).toMatchObject({ kind: "csv", rowsAdded: 1 });
    expect(model.requests).toHaveLength(1);
    expect(started.sheetReads).toBe(0);
  });

  test("a workbook's bytes take the workbook's path, never the CSV's", async () => {
    const lg7 = fixture("lg7");
    const model = fake(answering(lg7.layout));
    const started = await start(model);
    const file = await xlsxOf(lg7.sheets);
    // The sheet reader is the test's spy, which refuses: so the workbook path took it.
    const response = await describeFile(started, file);
    expect(started.sheetReads).toBe(1);
    expect(response.statusCode).toBe(415);
    expect(errorOf(response).code).toBe("WORKBOOK_NOT_XLSX");
    expect(model.requests).toHaveLength(0);
  });
});

describe("Done when 4 and 5: the moved reader", () => {
  test.each(CSVS)(
    "%s with a UTF-8 byte-order mark in front reads as the same sheet, and sends the same request",
    (name) => {
      const plain = csvSheet(CSV_SHEET_NAME, bytesOf(name));
      const marked = csvSheet(
        CSV_SHEET_NAME,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytesOf(name)]),
      );
      expect(marked).toEqual(plain);
      expect(csvSheet(CSV_SHEET_NAME, `${String.fromCharCode(0xfeff)}${textOf(name)}`)).toEqual(
        plain,
      );
      expect(sha256(layoutRequest([marked]))).toBe(sha256(layoutRequest([plain])));
      // And it is the sheet the fixture was measured with, under the fixed name.
      expect(plain.rows).toEqual(fixture(name).sheets[0]?.rows);
    },
  );

  const DIGITS = [
    "Date,Detail,Amount,Balance",
    "2024-01-01,007,0.50,100.50",
    "2024-01-02,42,-1.00,99.50",
    "2024-01-03,Cheque 0042,007.50,107.00",
  ].join("\n");
  const FOUR: WorkbookLayout = {
    account: {
      sheets: { by: "name", names: [CSV_SHEET_NAME] },
      yearPerSheet: false,
      order: "oldest-first",
      columns: [
        { role: "date", column: "A" },
        { role: "detail", column: "B" },
        { role: "amount", column: "C" },
        { role: "balance", column: "D" },
      ],
      buckets: [],
      carryOverLabel: null,
      summary: null,
    },
    periods: null,
    salaries: null,
    ignored: [],
  };

  test("007 reads as the detail 007, 0.50 as 0.5, 007.50 as a problem, and 42 as the detail 42", () => {
    const sheet = csvSheet(CSV_SHEET_NAME, DIGITS);
    expect(sheet.rows[1]?.[1]?.value).toEqual({ kind: "text", text: "007" });
    expect(sheet.rows[1]?.[2]?.value).toEqual({ kind: "number", number: 0.5 });
    expect(sheet.rows[3]?.[2]?.value).toEqual({ kind: "text", text: "007.50" });
    const reading = readWorkbook([sheet], { people: [], layout: FOUR });
    expect(reading.unfiled.map((row) => [row.detail, row.amountCents])).toEqual([
      ["007", 50],
      // A plain-digits detail is a number cell, read as its digits since lg-68.
      ["42", -100],
    ]);
    expect(reading.problems).toContainEqual(
      expect.stringMatching(/C4: the amount is not a number/u),
    );
  });

  test("a signed leading zero stays text too: -007.50 is a problem, -007 a detail, -0.50 a number", () => {
    const signed = [
      "Date,Detail,Amount,Balance",
      "2024-01-01,-007,-0.50,100.50",
      "2024-01-02,Cheque,-007.50,93.00",
    ].join("\n");
    const sheet = csvSheet(CSV_SHEET_NAME, signed);
    expect(sheet.rows[1]?.[1]?.value).toEqual({ kind: "text", text: "-007" });
    expect(sheet.rows[1]?.[2]?.value).toEqual({ kind: "number", number: -0.5 });
    expect(sheet.rows[2]?.[2]?.value).toEqual({ kind: "text", text: "-007.50" });
    const reading = readWorkbook([sheet], { people: [], layout: FOUR });
    expect(reading.unfiled.map((row) => [row.detail, row.amountCents])).toEqual([["-007", -50]]);
    expect(reading.problems).toContainEqual(
      expect.stringMatching(/C3: the amount is not a number/u),
    );
  });

  test("the seven files as written hold no shape the reader refuses", () => {
    for (const name of CSVS) {
      expect(unreadShapes(textOf(name)), name).toEqual([]);
      expect(() => refuseUnreadShapes(textOf(name))).not.toThrow();
    }
  });
});

// --- Done when 3: the shapes the reader does not read ---

function splitLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out;
}

function quote(field: string, delimiter: string): string {
  return field.includes(delimiter) || field.includes('"')
    ? `"${field.replaceAll('"', '""')}"`
    : field;
}

const DECIMAL = /^-?\d+\.\d+$/u;

/** `1823.45` as `1,823.45`. */
function withThousands(field: string): string {
  const [whole = "", cents] = field.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${sign}${grouped}${cents === undefined ? "" : `.${cents}`}`;
}

/** Each fixture's text re-serialised one way: every line's fields mapped, then joined. */
function reserialised(
  text: string,
  delimiter: string,
  map: (field: string) => { text: string; quote?: boolean },
): string {
  return `${text
    .split("\n")
    .filter((line, index, all) => index < all.length - 1 || line !== "")
    .map((line) =>
      splitLine(line)
        .map((field) => {
          const mapped = map(field);
          return mapped.quote === true
            ? `"${mapped.text}"`
            : quote(mapped.text, delimiter === "\t" ? "\t" : delimiter);
        })
        .join(delimiter),
    )
    .join("\n")}\n`;
}

const SHAPES: readonly {
  way: string;
  shapes: string[];
  said: RegExp;
  make: (text: string) => string;
}[] = [
  {
    way: "a semicolon delimiter",
    shapes: ["semicolon"],
    said: /separated by semicolons/u,
    make: (text) => reserialised(text, ";", (field) => ({ text: field })),
  },
  {
    way: "quoted decimal commas",
    shapes: ["decimal-comma"],
    said: /a comma before its cents/u,
    make: (text) =>
      reserialised(text, ",", (field) =>
        DECIMAL.test(field) ? { text: field.replace(".", ","), quote: true } : { text: field },
      ),
  },
  {
    way: "a semicolon and decimal commas",
    shapes: ["semicolon", "decimal-comma"],
    said: /separated by semicolons.*a comma before its cents/u,
    make: (text) =>
      reserialised(text, ";", (field) => ({
        text: DECIMAL.test(field) ? field.replace(".", ",") : field,
      })),
  },
  {
    way: "quoted thousands commas",
    shapes: ["thousands"],
    said: /a thousands separator/u,
    make: (text) =>
      reserialised(text, ",", (field) =>
        /^-?\d{4,}(\.\d+)?$/u.test(field)
          ? { text: withThousands(field), quote: true }
          : { text: field },
      ),
  },
  {
    way: "dd/mm/yyyy dates",
    shapes: ["date"],
    said: /a date is not written year-month-day/u,
    make: (text) =>
      reserialised(text, ",", (field) => {
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(field);
        return { text: iso === null ? field : `${iso[3]}/${iso[2]}/${iso[1]}` };
      }),
  },
  {
    way: "a tab delimiter",
    shapes: ["tab"],
    said: /separated by tabs/u,
    make: (text) => reserialised(text, "\t", (field) => ({ text: field })),
  },
];

/**
 * The seventh shape's synthetic file: two invented lines in Windows-1252, where
 * `É` is the byte 0xC9 and the dash 0x96, neither of which UTF-8 allows there.
 */
function windows1252(): Buffer {
  const ascii = (text: string): Buffer => Buffer.from(text, "ascii");
  return Buffer.concat([
    ascii("Date,Description,Montant,Solde\n2024-02-01,CAF"),
    Buffer.from([0xc9]),
    ascii(" DU PARC "),
    Buffer.from([0x96]),
    ascii(" TERRASSE,-4.50,95.50\n"),
  ]);
}

describe("Done when 3: seven unread shapes, in 44 files, are refused naming their shape", () => {
  test("each of the six ways changes every one of the seven fixtures", () => {
    for (const { way, make } of SHAPES) {
      for (const name of CSVS) expect(make(textOf(name)), `${name}, ${way}`).not.toBe(textOf(name));
    }
  });

  test.each(SHAPES.map((shape) => ({ ...shape })))(
    "$way: the seven fixtures so written are refused on describe and on confirm, the fake uncalled",
    async ({ shapes, said, make }) => {
      const model = fake(answering(uploaded("csv-balance")));
      const started = await start(model);
      await warmed(started);
      const before = dump(booksOf(started));
      for (const name of CSVS) {
        const file = Buffer.from(make(textOf(name)), "utf8");
        for (const response of [
          await describeFile(started, file),
          await confirmFile(started, file, uploaded(name)),
        ]) {
          expect(response.statusCode, `${name}: ${response.body}`).toBe(415);
          const error = errorOf(response);
          expect(error.code).toBe("CSV_SHAPE_UNREAD");
          expect(error.details?.["shapes"]).toEqual(shapes);
          expect(error.message).toMatch(said);
        }
      }
      expect(model.requests).toHaveLength(0);
      expect(started.sheetReads).toBe(0);
      expect(dump(booksOf(started))).toEqual(before);
    },
  );

  test.each([
    ["csv-balance re-encoded as Latin-1", () => Buffer.from(textOf("csv-balance"), "latin1")],
    ["the synthetic Windows-1252 file", windows1252],
  ])(
    "%s: not its UTF-8 bytes, not valid UTF-8, and refused naming the encoding",
    async (_what, make) => {
      const file = make();
      // Not a vacuous case: these bytes are not the text's UTF-8 bytes, and a
      // strict UTF-8 decode refuses them.
      const asText = file.toString("latin1");
      expect(file.equals(Buffer.from(asText, "utf8"))).toBe(false);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(file)).toThrow();

      const model = fake(answering(uploaded("csv-balance")));
      const started = await start(model);
      await warmed(started);
      const before = dump(booksOf(started));
      for (const response of [
        await describeFile(started, file),
        await confirmFile(started, file, uploaded("csv-balance")),
      ]) {
        expect(response.statusCode, response.body).toBe(415);
        expect(errorOf(response)).toMatchObject({
          code: "CSV_SHAPE_UNREAD",
          details: { shapes: ["encoding"] },
        });
        expect(errorOf(response).message).toMatch(/not in UTF-8/u);
      }
      expect(model.requests).toHaveLength(0);
      expect(dump(booksOf(started))).toEqual(before);
    },
  );
});

describe("Done when 6: a CSV with no balance column is refused", () => {
  test("csv-no-balance: the describe request says the balance column is missing, and confirm stores nothing", async () => {
    const model = fake(answering(uploaded("csv-no-balance")));
    const started = await start(model);
    await warmed(started);
    const before = dump(booksOf(started));

    const described = await describeFile(started, bytesOf("csv-no-balance"));
    expect(described.statusCode, described.body).toBe(200);
    const body = described.json<DescribeWorkbookResponse>();
    expect(body.ok).toBe(false);
    expect(body.problems).toEqual([
      expect.stringMatching(
        /^The layout names no balance column, so nothing proves the 32 rows read are all of them/u,
      ),
    ]);
    expect(body.kind === "csv" ? body.placement : "xlsx").toBeNull();
    expect(model.requests).toHaveLength(1);
    expect(dump(booksOf(started))).toEqual(before);

    const confirmed = await confirmFile(
      started,
      bytesOf("csv-no-balance"),
      uploaded("csv-no-balance"),
    );
    expect(confirmed.statusCode).toBe(422);
    expect(errorOf(confirmed).code).toBe("WORKBOOK_IMPORT_REFUSED");
    expect(errorOf(confirmed).details?.["problems"]).toEqual(body.problems);
    expect(model.requests).toHaveLength(1);
    expect(dump(booksOf(started))).toEqual(before);
  });
});

describe("Done when 7: the describe request on the six served CSVs", () => {
  test.each(SERVED)(
    "%s: the description, the date column with its header and 3 + 3 rows, a report, and the books unchanged",
    async (name) => {
      const model = fake(answering(uploaded(name)));
      const started = await start(model);
      await warmed(started);
      const before = dump(booksOf(started));

      const response = await describeFile(started, bytesOf(name));

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<DescribeWorkbookResponse>();
      expect(body.kind).toBe("csv");
      expect(body.layout).toEqual(uploaded(name));
      expect(body.ok, body.problems.join("\n")).toBe(true);
      expect(body.kind === "csv" ? body.placement : null).toEqual({ kind: "first" });
      const date = uploaded(name).account.columns.find((entry) => entry.role === "date");
      const { dateColumn, buckets } = body.confirmation;
      expect(dateColumn.column).toBe(date?.column);
      expect(dateColumn.header).toMatch(/date/iu);
      // Held to what the generator wrote, so a date or detail from the wrong column fails here.
      const written = writtenRows(name) ?? [];
      const sample = (rows: typeof written) =>
        rows.map((row) => ({ date: row.date, detail: row.detail, amountCents: row.cents }));
      const shown = (rows: typeof dateColumn.oldest) =>
        rows.map((row) => ({ date: row.date, detail: row.detail, amountCents: row.amountCents }));
      expect(shown(dateColumn.oldest)).toEqual(sample(written.slice(0, 3)));
      expect(shown(dateColumn.newest)).toEqual(sample(written.slice(-3)));
      expect(buckets).toEqual([]);
      expect(body.report).toContain("first import: no history is stored");
      expect(body.report).toContain("Confirm to store the rows.");
      expect(model.requests).toHaveLength(1);
      expect(dump(booksOf(started))).toEqual(before);
    },
  );

  const PARTS: [part: string, change: (layout: WorkbookLayout) => void][] = [
    [
      "a bucket mapping",
      (layout) => {
        layout.account.columns.push({ role: "bucket", column: "Z" });
        layout.account.buckets = [{ bucket: "mortgage", labels: ["Maison"] }];
      },
    ],
    [
      "a bucket column",
      (layout) => {
        layout.account.columns.push({ role: "bucket", column: "Z" });
        layout.account.buckets = [{ bucket: "current-expenses", labels: ["Courant"] }];
      },
    ],
    [
      "a person column",
      (layout) => void layout.account.columns.push({ role: "person", column: "Z" }),
    ],
    [
      "a carry-over label",
      (layout) => {
        layout.account.yearPerSheet = true;
        layout.account.carryOverLabel = "Report";
      },
    ],
    [
      "summary rows",
      (layout) => void (layout.account.summary = { column: "A", labels: ["Total"] }),
    ],
    [
      "periods",
      (layout) =>
        void (layout.periods = {
          sheets: { by: "prefix", prefix: "$" },
          namesRow: 1,
          datesRow: 2,
          firstLine: 3,
          totalLabel: "Total",
          depositLabel: "Dépôt",
        }),
    ],
    ["salaries", (layout) => void (layout.salaries = { sheet: "Accueil", label: "Salaires" })],
    ["a sheet per year", (layout) => void (layout.account.yearPerSheet = true)],
  ];

  test.each(PARTS)(
    "a description naming %s is refused, the fake called once",
    async (part, change) => {
      const layout = uploaded("csv-balance");
      change(layout);
      const model = fake(answering(layout));
      const started = await start(model);
      await warmed(started);
      const before = dump(booksOf(started));

      const response = await describeFile(started, bytesOf("csv-balance"));

      expect(response.statusCode, response.body).toBe(422);
      const error = errorOf(response);
      expect(error.code).toBe("LAYOUT_NOT_FOR_CSV");
      expect(error.details?.["parts"]).toContain(part);
      expect(error.message).toContain(part);
      expect(model.requests).toHaveLength(1);
      // Confirm refuses the same description, asking nothing.
      const confirmed = await confirmFile(started, bytesOf("csv-balance"), layout);
      expect(errorOf(confirmed).code).toBe("LAYOUT_NOT_FOR_CSV");
      expect(model.requests).toHaveLength(1);
      expect(dump(booksOf(started))).toEqual(before);
    },
  );
});

// --- Done when 8: placement against a real in-memory database ---

/** One row, stored as a paste would: the history the CSV meets. */
function storeRow(started: Started, row: Omit<RowToStore, "category" | "note">): void {
  insertRows(booksOf(started), { personId: "alex", now: () => NOW }, [
    { ...row, category: "Divers", note: null },
  ]);
}

interface StoredColumns {
  seq: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
  note: string | null;
}

function stored(started: Started): StoredColumns[] {
  return booksOf(started).prepare(STORED).all() as StoredColumns[];
}

/** csv-balance's rows as written, oldest first, with what opens the first. */
function balanceRows() {
  return writtenRows("csv-balance") ?? [];
}

describe("Done when 8: placed after the stored tail, or into an empty history; never overlapping", () => {
  test("(i) into an empty history: stored with seq from 0 and the file's balances", async () => {
    const started = await start();
    const response = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));
    expect(response.statusCode, response.body).toBe(200);
    const rows = stored(started);
    const written = balanceRows();
    expect(rows.map((row) => row.seq)).toEqual(written.map((_, index) => index));
    expect(rows.map((row) => row.balance_cents)).toEqual(written.map((row) => row.balance));
    expect(rows.map((row) => row.description)).toEqual(written.map((row) => row.detail));
    expect(new Set(rows.map((row) => row.category))).toEqual(new Set([""]));
    const imports = booksOf(started)
      .prepare("SELECT source, imported_by FROM statement_imports")
      .all();
    expect(imports).toEqual([{ source: "paste", imported_by: "alex" }]);
    expect(response.json<ConfirmWorkbookResponse>()).toMatchObject({
      kind: "csv",
      rowsAdded: 40,
      tailBalanceCents: written.at(-1)?.balance,
    });
  });

  test("(ii) opening from the stored tail's balance: stored after the tail", async () => {
    const started = await start();
    const [first] = balanceRows();
    const opening = (first?.balance ?? 0) - (first?.cents ?? 0);
    storeRow(started, {
      date: "2023-12-29",
      description: "VIREMENT",
      amountCents: 10_000,
      balanceCents: opening,
    });

    const response = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));

    expect(response.statusCode, response.body).toBe(200);
    const rows = stored(started);
    expect(rows).toHaveLength(41);
    expect(rows[0]?.description).toBe("VIREMENT");
    expect(rows.slice(1).map((row) => row.seq)).toEqual(balanceRows().map((_, index) => index + 1));
  });

  test("the dry run reports the continuation from the stored balance and its date", async () => {
    const model = fake(answering(uploaded("csv-balance")));
    const started = await start(model);
    const [first] = balanceRows();
    const opening = (first?.balance ?? 0) - (first?.cents ?? 0);
    storeRow(started, {
      date: "2023-12-29",
      description: "VIREMENT",
      amountCents: 10_000,
      balanceCents: opening,
    });

    const body = (
      await describeFile(started, bytesOf("csv-balance"))
    ).json<DescribeWorkbookResponse>();

    expect(body.ok, body.problems.join("\n")).toBe(true);
    expect(body.kind === "csv" ? body.placement : null).toEqual({
      kind: "continues",
      date: "2023-12-29",
      balanceCents: opening,
    });
    expect(body.report).toContain("continues from the stored balance of 2512.10 $ on 2023-12-29");
  });

  test("(iii) a CSV that overlaps one stored row is refused, naming the tail's date and balance", async () => {
    const started = await start();
    const [first] = balanceRows();
    storeRow(started, {
      date: first?.date ?? "",
      description: first?.detail ?? "",
      amountCents: first?.cents ?? 0,
      balanceCents: first?.balance ?? 0,
    });
    const before = stored(started);

    const response = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));

    expect(response.statusCode).toBe(422);
    expect(errorOf(response)).toMatchObject({
      code: "CSV_NOT_AFTER_TAIL",
      details: { placement: "overlaps", date: first?.date, balanceCents: first?.balance },
    });
    expect(errorOf(response).message).toContain(`of ${first?.date ?? ""}, which left`);
    expect(stored(started)).toEqual(before);
  });

  test("(iv) a CSV that leaves a gap is refused, naming the tail's date and balance", async () => {
    const started = await start();
    storeRow(started, {
      date: "2023-12-29",
      description: "VIREMENT",
      amountCents: 10_000,
      balanceCents: 99_999,
    });
    const before = stored(started);

    const response = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));

    expect(response.statusCode).toBe(422);
    expect(errorOf(response)).toMatchObject({
      code: "CSV_NOT_AFTER_TAIL",
      details: { placement: "gap", date: "2023-12-29", balanceCents: 99_999 },
    });
    expect(errorOf(response).message).toContain("of 2023-12-29, which left 999.99 $");
    expect(errorOf(response).message).toContain("is unexplained");
    expect(stored(started)).toEqual(before);
  });

  test("(v) bank-wide, listed newest first, is stored oldest first", async () => {
    const started = await start();
    const response = await confirmFile(started, bytesOf("bank-wide"), uploaded("bank-wide"));
    expect(response.statusCode, response.body).toBe(200);
    const rows = stored(started);
    expect(rows.map((row) => row.date)).toEqual(
      (writtenRows("bank-wide") ?? []).map((row) => row.date),
    );
    expect(rows.map((row) => row.date)).toEqual(rows.map((row) => row.date).toSorted());
  });

  test("(vi) two confirm requests on one file store its rows once, and refuse the second as an overlap", async () => {
    const started = await start();
    const first = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));
    expect(first.statusCode, first.body).toBe(200);
    const once = stored(started);

    const second = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));

    expect(second.statusCode).toBe(422);
    const last = balanceRows().at(-1);
    expect(errorOf(second)).toMatchObject({
      code: "CSV_NOT_AFTER_TAIL",
      details: { placement: "overlaps", date: last?.date, balanceCents: last?.balance },
    });
    expect(stored(started)).toEqual(once);
    expect(once).toHaveLength(40);
  });

  /** A one-day row as the placement compares it: date, amount and balance. */
  function day(amountCents: number, balanceCents: number): RowToStore {
    return {
      date: "2024-06-03",
      category: "",
      description: "VIREMENT",
      amountCents,
      balanceCents,
      note: null,
    };
  }

  test("a file of one day whose rows sum to nothing, stored, is an overlap the second time", async () => {
    const started = await start();
    const db = booksOf(started);
    const rows = [day(10_000, 110_000), day(-10_000, 100_000)];
    insertRows(db, { personId: "alex", now: () => NOW }, [{ ...day(0, 100_000), amountCents: 5 }]);
    // Opens from the tail's 1 000.00 both times: the balance alone would take it twice.
    expect(placementOf(db, rows)).toMatchObject({ kind: "continues" });
    storeCsvRows({ db, personId: "alex", now: () => NOW }, rows);
    expect(placementOf(db, rows)).toMatchObject({ kind: "overlaps", balanceCents: 100_000 });
  });

  test("a transfer, its reversal and the transfer again on one day: the third continues the first two", async () => {
    const started = await start();
    const db = booksOf(started);
    insertRows(db, { personId: "alex", now: () => NOW }, [
      day(-10_000, 90_000),
      day(10_000, 100_000),
    ]);
    // Its date, amount and balance repeat the first stored row's, which is not the day's end.
    expect(placementOf(db, [day(-10_000, 90_000)])).toEqual({
      kind: "continues",
      date: "2024-06-03",
      balanceCents: 100_000,
    });
  });
});

describe("Done when 9: the stored rows pass through the rules, in the same transaction", () => {
  test("csv-balance has 7 distinct details over 40 rows, each repeated", () => {
    const details = balanceRows().map((row) => row.detail);
    const counts = new Map<string, number>();
    for (const detail of details) counts.set(detail, (counts.get(detail) ?? 0) + 1);
    expect(details).toHaveLength(40);
    expect(counts.size).toBe(7);
    expect([...counts.values()].every((count) => count > 1)).toBe(true);
  });

  test("a rule keyed on one detail files exactly the rows that carry it, and the rest wait", async () => {
    const started = await start();
    const db = booksOf(started);
    const keyed = "HYPOTHEQUE";
    const carrying = balanceRows().filter((row) => row.detail === keyed).length;
    expect(carrying).toBeGreaterThan(1);
    createRule(
      { db, personId: "alex", now: () => NOW, people: new Set(["alex", "sam"]) },
      {
        descriptionPattern: keyed,
        category: null,
        amountCents: null,
        personId: null,
        bucket: "mortgage",
        spendingCategoryId: null,
      },
    );

    const response = await confirmFile(started, bytesOf("csv-balance"), uploaded("csv-balance"));

    expect(response.statusCode, response.body).toBe(200);
    const filed = db
      .prepare(
        "SELECT r.description FROM classifications c JOIN statement_rows r ON r.id = c.row_id",
      )
      .all() as { description: string }[];
    expect(filed).toHaveLength(carrying);
    expect(new Set(filed.map((row) => row.description))).toEqual(new Set([keyed]));
    expect(response.json<ConfirmWorkbookResponse>()).toMatchObject({
      rowsAdded: 40,
      rowsInInbox: 40 - carrying,
    });
  });

  test("a classification that throws leaves no statement row stored", async () => {
    const started = await start();
    await warmed(started);
    const db = booksOf(started);
    const before = dump(db);
    const rows = readWorkbook([csvSheet(CSV_SHEET_NAME, textOf("csv-balance"))], {
      people: [],
      layout: uploaded("csv-balance"),
    }).unfiled.map((row) => ({
      date: row.date,
      category: "",
      description: row.detail,
      amountCents: row.amountCents,
      balanceCents: row.balanceCents ?? 0,
      note: row.note,
    }));
    expect(rows).toHaveLength(40);
    const throwing: typeof classifyAdded = () => {
      throw new Error("the rules failed");
    };

    expect(() => storeCsvRows({ db, personId: "alex", now: () => NOW }, rows, throwing)).toThrow(
      "the rules failed",
    );
    expect(dump(db)).toEqual(before);
    // And the same rows store with the real classification.
    expect(storeCsvRows({ db, personId: "alex", now: () => NOW }, rows).rowsAdded).toBe(40);
  });
});

describe("Done when 10: what is sent carries statement.csv, never the file's name", () => {
  test.each(CSVS)(
    "%s: the request names statement.csv, and a name in the body is refused",
    async (name) => {
      const token = `zq7tok-${name}`;
      const model = fake(answering(uploaded(name)));
      const started = await start(model);

      // The body has no field for a name: one sent is refused, the fake uncalled.
      const named = await describeFile(started, bytesOf(name), { name: `${token}.csv` });
      expect(named.statusCode).toBe(400);
      expect(model.requests).toHaveLength(0);

      const response = await describeFile(started, bytesOf(name));
      expect(response.statusCode, response.body).toBe(200);
      const [request = ""] = model.requests;
      expect(request).toContain(`## Sheet "${CSV_SHEET_NAME}":`);
      expect(request).toBe(layoutRequest([csvSheet(CSV_SHEET_NAME, textOf(name))]));
      expect(request).not.toContain(token);
      // Nor the name the fixture was measured under, which stands for a bank file's.
      expect(request).not.toContain(fixture(name).sheets[0]?.name ?? "?");
      expect(LOGGED.filter((line) => line.includes(token))).toEqual([]);
    },
  );
});

describe("Done when 12: the date column guards bank-two-dates' let-through", () => {
  test("the description reading column B shows its header and dates differing in 3 of the 6 positions", async () => {
    const right = uploaded("bank-two-dates");
    const wrong = structuredClone(right);
    for (const entry of wrong.account.columns) if (entry.role === "date") entry.column = "B";
    const model = fake(answering(right), answering(wrong));
    const started = await start(model);

    const rightly = (
      await describeFile(started, bytesOf("bank-two-dates"))
    ).json<DescribeWorkbookResponse>();
    const wrongly = (
      await describeFile(started, bytesOf("bank-two-dates"))
    ).json<DescribeWorkbookResponse>();

    expect(rightly.confirmation.dateColumn.header).toBe("Date posted");
    expect(wrongly.confirmation.dateColumn.header).toBe("Date of transaction");
    // The verifications let it through: it would be stored but for the person.
    expect(wrongly.ok).toBe(true);
    const dates = (body: DescribeWorkbookResponse): string[] => [
      ...body.confirmation.dateColumn.oldest.map((row) => row.date),
      ...body.confirmation.dateColumn.newest.map((row) => row.date),
    ];
    const differing = dates(rightly).filter((date, index) => date !== dates(wrongly)[index]);
    expect(dates(rightly)).toHaveLength(6);
    expect(differing).toHaveLength(3);
  });
});

describe("Build 3: lg-66's bounds, for a CSV", () => {
  test("a CSV over the rows bound is refused before the model", async () => {
    const model = fake(answering(uploaded("csv-balance")));
    const started = await start(model);
    const file = Buffer.from(`Date,Detail,Amount\n${"2024-01-01,x,1\n".repeat(20_000)}`);
    const response = await describeFile(started, file);
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({
      code: "WORKBOOK_TOO_LARGE",
      details: { bound: "rows" },
    });
    expect(errorOf(response).message).toMatch(/^That CSV has 20001 rows/u);
    expect(model.requests).toHaveLength(0);
  });

  test("a CSV over the cells bound is refused before the model", async () => {
    const model = fake(answering(uploaded("csv-balance")));
    const started = await start(model);
    const line = `${Array.from({ length: 101 }, () => "x").join(",")}\n`;
    const response = await describeFile(started, Buffer.from(line.repeat(2_000)));
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({ details: { bound: "cells" } });
    expect(model.requests).toHaveLength(0);
  });

  test("a CSV whose request is over the estimate's bound is refused before the model", async () => {
    const model = fake(answering(uploaded("csv-balance")));
    const started = await start(model);
    const line = `${Array.from({ length: 80 }, () => "y".repeat(60)).join(",")}\n`;
    const response = await describeFile(started, Buffer.from(line.repeat(30)));
    expect(response.statusCode).toBe(413);
    expect(errorOf(response)).toMatchObject({ details: { bound: "request" } });
    expect(model.requests).toHaveLength(0);
  });

  test("a long detail is sent cut, and stored whole", async () => {
    const long = `EPICERIE ${"TRES ".repeat(20)}LONGUE`;
    const file = Buffer.from(`Date,Detail,Amount,Balance\n2024-01-02,${long},-5.00,95.00\n`);
    const layout = uploaded("bank-preamble");
    layout.account.columns = [
      { role: "date", column: "A" },
      { role: "detail", column: "B" },
      { role: "amount", column: "C" },
      { role: "balance", column: "D" },
    ];
    const model = fake(answering(layout));
    const started = await start(model);
    expect((await describeFile(started, file)).statusCode).toBe(200);
    expect(model.requests[0]).not.toContain(long);
    expect((await confirmFile(started, file, layout)).statusCode).toBe(200);
    expect(stored(started).map((row) => row.description)).toEqual([long]);
  });
});

describe("the web's CSV fixture (Done when 11)", () => {
  test("web/test/fixtures/csv-balance-describe.json is what Describe answers for csv-balance into empty books", async () => {
    const started = await start(fake(answering(uploaded("csv-balance"))));

    const response = await describeFile(started, bytesOf("csv-balance"));

    expect(response.statusCode, response.body).toBe(200);
    const kept: unknown = JSON.parse(
      readFileSync(
        new URL("../../web/test/fixtures/csv-balance-describe.json", import.meta.url),
        "utf8",
      ),
    );
    expect(response.json()).toEqual(kept);
  });
});

// Last: it reads what every test above logged.
describe("the log (lg-66's rule, for a CSV)", () => {
  test("no line of any request above holds a CSV's content, a file name or the key", () => {
    expect(LOGGED.length).toBeGreaterThan(20);
    const secrets = [
      API_KEY,
      "EPICERIE",
      "HYPOTHEQUE",
      "DEPOT PAIE",
      "releve-2024",
      "full-export",
      "zq7tok",
      "CAF",
      "TERRASSE",
    ];
    expect(LOGGED.filter((line) => secrets.some((secret) => line.includes(secret)))).toEqual([]);
    expect(LOGGED.some((line) => line.includes("a workbook was described"))).toBe(true);
    expect(LOGGED.some((line) => line.includes("a described CSV was stored"))).toBe(true);
  });
});
