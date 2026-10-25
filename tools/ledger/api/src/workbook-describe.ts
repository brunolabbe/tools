/**
 * A workbook the reader does not know, imported through a layout a model
 * describes and the person confirms (lg-66). The routes are in
 * `routes/workbook.ts`; what each request may do is here.
 *
 * **Describe** takes the file and the person's agreement, makes **one** model
 * call, validates the answer against `workbookLayoutSchema`, reads the file
 * through it and runs `importWorkbook` as a dry run, so the report the person
 * reads is what Confirm would store. It writes nothing. An answer that is not
 * a layout is `LAYOUT_UNREADABLE`, with no retry: the model is called only by
 * the person's explicit action.
 *
 * **Confirm** takes the file and the description again, checks and reads them
 * again, and imports in the one transaction only when every verification
 * holds. It calls no model. The server keeps nothing of the upload between the
 * two.
 *
 * **The bounds**, each where it can first be known, in this order: the bytes
 * (before anything is parsed); the zip's own structure (`workbook-zip.ts`); the
 * inflated size, declared and then counted, before `exceljs` sees the file;
 * the sheets, then the rows and cells, once parsed; and the request's size, an
 * estimate, before the call. A cell's text is never refused: the view cuts it
 * at `MAX_CELL_TEXT`, and the file is still read in full.
 *
 * Nothing here logs: no key, no cell text, no file name (the requests carry
 * none). The route logs the call's token counts and the number of sheets.
 */

import { Buffer } from "node:buffer";
import type { Sheet, WorkbookReading } from "@ledger/books";
import { NO_CORRECTIONS } from "@ledger/books";
import {
  AppError,
  MAX_WORKBOOK_BYTES,
  confirmWorkbookRequestSchema,
  describeWorkbookRequestSchema,
  readerFolded,
  workbookLayoutSchema,
} from "@ledger/contract";
import type {
  BucketLabelConfirmation,
  ConfirmWorkbookResponse,
  DescribeWorkbookResponse,
  WorkbookConfirmation,
  WorkbookLayout,
  WorkbookSampleRow,
} from "@ledger/contract";
import { layoutOutputFormat } from "@ledger/receipts";
import type { LayoutAsk } from "@ledger/receipts";
import type { Database } from "better-sqlite3";
import { estimateTokens, layoutRequest } from "./layout-view.ts";
import { importWorkbook } from "./workbook-import.ts";
import {
  MAX_WORKBOOK_INFLATED_BYTES,
  countInflated,
  declaredInflatedSize,
  workbookEntries,
} from "./workbook-zip.ts";
import type { InflateSpy } from "./workbook-zip.ts";

/** Sheets a workbook may hold. The measured workbooks hold 2 to 9. */
export const MAX_WORKBOOK_SHEETS = 40;

/** Rows over every sheet, as `exceljs` reads them: `lg37`, the largest measured, holds 320. */
export const MAX_WORKBOOK_ROWS = 20_000;

/** Cells holding a value or a formula, over every sheet. */
export const MAX_WORKBOOK_CELLS = 200_000;

/**
 * The request's size, in the API's tokens, estimated: the four-characters
 * estimate of the request and of the answer's schema, times
 * `REQUEST_TOKEN_RATIO`. The API counts tokens only by a call, so this is an
 * estimate and is said to be one. 24 000 is two and a half times the largest
 * measured request (`lg37`, 9 468 tokens as the API counted them).
 */
export const MAX_REQUEST_TOKENS = 24_000;

/**
 * The API's count over the four-characters estimate: at most 2.317 over
 * lg-56's 300 records (`lg37`), rounded up so the largest request is not
 * under-counted (lg-66's Build 3.3).
 */
export const REQUEST_TOKEN_RATIO = 2.32;

/** What a request's size is taken to be in the API's tokens: an estimate. */
export function estimatedRequestTokens(request: string): number {
  const schema = JSON.stringify(layoutOutputFormat().schema);
  return Math.ceil((estimateTokens(request) + estimateTokens(schema)) * REQUEST_TOKEN_RATIO);
}

/** What the two requests need besides the caller: the model, and the sheet reader. */
export interface WorkbookImportDeps {
  /** `undefined` when no key is configured: Describe is refused and nothing is sent. */
  ask: LayoutAsk | undefined;
  /** `xlsx.ts`'s `readSheets`; a test hands in a spy. */
  readSheets: (bytes: Buffer) => Promise<Sheet[]>;
  /** Told each chunk the counted inflate produces; a test reads it. */
  inflateSpy?: InflateSpy | undefined;
}

/** Whose books, and who is asking. */
export interface WorkbookCaller {
  db: Database;
  personId: string;
  /** The household's current members' names (lg-20). */
  members: readonly string[];
  now: () => Date;
}

function tooLarge(bound: string, message: string): AppError {
  return new AppError("WORKBOOK_TOO_LARGE", message, { details: { bound } });
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

/** What a file over the byte bound is told, by this check and by the body's cap alike. */
export const WORKBOOK_BYTES_MESSAGE = `A workbook is ${String(MAX_WORKBOOK_BYTES / 1024 / 1024)} MB at most.`;

/** The file's bytes, or a refusal over the byte bound before anything reads them. */
function bytesOf(file: string): Buffer {
  if (file.length % 4 !== 0 || !BASE64.test(file)) {
    throw new AppError("BAD_REQUEST", "The file did not arrive whole. Choose it again.");
  }
  // Three bytes for every four characters, less the padding: known before decoding.
  const size = (file.length / 4) * 3 - (file.endsWith("==") ? 2 : file.endsWith("=") ? 1 : 0);
  if (size > MAX_WORKBOOK_BYTES) {
    throw new AppError("SIZE_LIMIT_EXCEEDED", WORKBOOK_BYTES_MESSAGE, {
      details: { bound: "bytes" },
    });
  }
  return Buffer.from(file, "base64");
}

/** The file's sheets, once every bound before the model has held. */
async function sheetsOf(file: string, deps: WorkbookImportDeps): Promise<Sheet[]> {
  const bytes = bytesOf(file);
  const entries = workbookEntries(bytes);
  const inflated = `That workbook inflates to more than ${String(MAX_WORKBOOK_INFLATED_BYTES / 1024 / 1024)} MB, more than this import reads.`;
  if (declaredInflatedSize(entries) > MAX_WORKBOOK_INFLATED_BYTES) {
    throw tooLarge("inflated", inflated);
  }
  try {
    await countInflated(bytes, entries, MAX_WORKBOOK_INFLATED_BYTES, deps.inflateSpy);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "WORKBOOK_TOO_LARGE") {
      throw tooLarge("inflated", inflated);
    }
    throw error;
  }
  let sheets: Sheet[];
  try {
    sheets = await deps.readSheets(bytes);
  } catch (cause: unknown) {
    // The parser's reason is not the person's to read: the one plain message.
    throw new AppError("WORKBOOK_NOT_XLSX", undefined, { cause });
  }
  if (sheets.length === 0) throw new AppError("WORKBOOK_NO_SHEETS");
  if (sheets.length > MAX_WORKBOOK_SHEETS) {
    throw tooLarge(
      "sheets",
      `That workbook has ${String(sheets.length)} sheets; this import reads ${String(MAX_WORKBOOK_SHEETS)} at most.`,
    );
  }
  const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  if (rows > MAX_WORKBOOK_ROWS) {
    throw tooLarge(
      "rows",
      `That workbook has ${String(rows)} rows; this import reads ${String(MAX_WORKBOOK_ROWS)} at most.`,
    );
  }
  const cells = sheets.reduce(
    (sum, sheet) =>
      sum +
      sheet.rows.reduce((inRow, row) => inRow + row.filter((cell) => cell !== null).length, 0),
    0,
  );
  if (cells > MAX_WORKBOOK_CELLS) {
    throw tooLarge(
      "cells",
      `That workbook has ${String(cells)} cells; this import reads ${String(MAX_WORKBOOK_CELLS)} at most.`,
    );
  }
  return sheets;
}

/** The model's answer as a layout, or `LAYOUT_UNREADABLE`. */
function layoutOf(answer: { text: string | null; stopReason: string | null }): WorkbookLayout {
  // `max_tokens` and `refusal` can leave text that is half a description.
  if (answer.stopReason !== "end_turn" || answer.text === null) {
    throw new AppError("LAYOUT_UNREADABLE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.text);
  } catch (cause: unknown) {
    throw new AppError("LAYOUT_UNREADABLE", undefined, { cause });
  }
  const checked = workbookLayoutSchema.safeParse(parsed);
  if (!checked.success) throw new AppError("LAYOUT_UNREADABLE");
  return checked.data;
}

export async function describeWorkbook(
  caller: WorkbookCaller,
  body: unknown,
  deps: WorkbookImportDeps,
  signal?: AbortSignal,
): Promise<DescribeWorkbookResponse> {
  const consent = (body as { consent?: unknown } | null)?.consent;
  if (consent !== true) {
    throw new AppError(
      "BAD_REQUEST",
      "The workbook's samples are sent only when you agree to send them. Nothing was sent.",
    );
  }
  const parsed = describeWorkbookRequestSchema.safeParse(body);
  if (!parsed.success) throw new AppError("BAD_REQUEST", "Choose a workbook to send.");
  const { ask } = deps;
  if (ask === undefined) throw new AppError("LAYOUT_READER_UNCONFIGURED");

  const sheets = await sheetsOf(parsed.data.file, deps);
  const request = layoutRequest(sheets);
  const estimate = estimatedRequestTokens(request);
  if (estimate > MAX_REQUEST_TOKENS) {
    throw tooLarge(
      "request",
      `What would be sent is about ${String(estimate)} tokens, an estimate; this import sends ${String(MAX_REQUEST_TOKENS)} at most.`,
    );
  }

  const answer = await ask(request, signal);
  const layout = layoutOf(answer);
  const result = importWorkbook(caller.db, sheets, {
    personId: caller.personId,
    members: caller.members,
    corrections: NO_CORRECTIONS,
    write: false,
    commit: false,
    now: caller.now,
    layout,
    via: "screen",
  });
  return {
    layout,
    ok: result.ok,
    problems: result.problems,
    report: result.report,
    confirmation: confirmationOf(sheets, layout, result.reading),
    usage: { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens },
  };
}

export async function confirmWorkbook(
  caller: WorkbookCaller,
  body: unknown,
  deps: WorkbookImportDeps,
): Promise<ConfirmWorkbookResponse> {
  const parsed = confirmWorkbookRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "BAD_REQUEST",
      "The workbook and the description it was read through are both needed. Read it again.",
    );
  }
  const sheets = await sheetsOf(parsed.data.file, deps);
  const result = importWorkbook(caller.db, sheets, {
    personId: caller.personId,
    members: caller.members,
    corrections: NO_CORRECTIONS,
    write: true,
    commit: true,
    now: caller.now,
    layout: parsed.data.layout,
    via: "screen",
  });
  if (!result.written) {
    throw new AppError("WORKBOOK_IMPORT_REFUSED", undefined, {
      details: { problems: result.problems },
    });
  }
  return { report: result.report };
}

// --- What the confirmation shows (Build 4.2) ---

function columnNumber(letters: string): number {
  let number = 0;
  for (const letter of letters) number = number * 26 + (letter.codePointAt(0) ?? 64) - 64;
  return number;
}

function textAt(sheet: Sheet | undefined, row: number, column: number): string | null {
  const value = sheet?.rows[row - 1]?.[column - 1]?.value ?? null;
  if (value === null) return null;
  if (value.kind === "text") return value.text;
  if (value.kind === "number") return String(value.number);
  return null;
}

interface ReadRow {
  sheet: string;
  row: number;
  date: string;
  detail: string;
  amountCents: number;
}

function sample(row: ReadRow): WorkbookSampleRow {
  return {
    sheet: row.sheet,
    row: row.row,
    date: row.date,
    detail: row.detail,
    amountCents: row.amountCents,
  };
}

/**
 * Up to 3 rows filed under one label: the newest row of each of its 3 most
 * frequent details, most frequent first (a tie to the detail seen latest), then
 * the newest rows not shown. A label's character is its recurring rows: on
 * `swapped-labels` the monthly loan payment is what tells the mortgage's label.
 */
function labelSample(rows: readonly ReadRow[]): WorkbookSampleRow[] {
  const newestFirst = rows.toReversed();
  const byDetail = new Map<string, ReadRow[]>();
  for (const row of newestFirst)
    byDetail.set(row.detail, [...(byDetail.get(row.detail) ?? []), row]);
  const details = [...byDetail.values()].toSorted((a, b) => b.length - a.length);
  const chosen: ReadRow[] = details.slice(0, 3).flatMap((group) => group.slice(0, 1));
  for (const row of newestFirst) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(row)) chosen.push(row);
  }
  return chosen.map(sample);
}

/**
 * The date column the description chose, with the header the file has over it
 * and the oldest and newest rows read; and each bucket label with what it
 * files. Read from the reading and the sheets, never from the model's answer
 * alone.
 */
export function confirmationOf(
  sheets: readonly Sheet[],
  layout: WorkbookLayout,
  reading: WorkbookReading,
): WorkbookConfirmation {
  const read: ReadRow[] = [...reading.movements, ...reading.unfiled]
    .map((row) => ({
      sheet: row.sheet,
      row: row.row,
      date: row.date,
      detail: row.detail,
      amountCents: row.amountCents,
    }))
    .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const columnOf = (role: string): string | undefined =>
    layout.account.columns.find((entry) => entry.role === role)?.column;

  const dateLetter = columnOf("date") ?? "A";
  const date = columnNumber(dateLetter);
  // The header over the first row read, on the first sheet that has one: the
  // nearest text above it in the date column.
  let header: string | null = null;
  const first = sheets.find((sheet) => read.some((row) => row.sheet === sheet.name));
  if (first !== undefined) {
    const top = Math.min(...read.filter((row) => row.sheet === first.name).map((row) => row.row));
    for (let row = top - 1; row >= 1 && header === null; row--) {
      const value = first.rows[row - 1]?.[date - 1]?.value ?? null;
      if (value?.kind === "text") header = value.text;
    }
  }

  const buckets: BucketLabelConfirmation[] = [];
  const bucketLetter = columnOf("bucket");
  if (bucketLetter !== undefined) {
    const column = columnNumber(bucketLetter);
    const labelOf = new Map(
      read.map((row) => [row, readerFolded(textAt(byName.get(row.sheet), row.row, column) ?? "")]),
    );
    for (const entry of layout.account.buckets) {
      for (const label of entry.labels) {
        const key = readerFolded(label);
        const under = read.filter((row) => labelOf.get(row) === key);
        buckets.push({
          label,
          bucket: entry.bucket,
          rows: under.length,
          examples: labelSample(under),
        });
      }
    }
  }

  return {
    dateColumn: {
      column: dateLetter,
      header,
      oldest: read.slice(0, 3).map(sample),
      newest: read.slice(-3).map(sample),
    },
    buckets,
  };
}
