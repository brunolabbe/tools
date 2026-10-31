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
 * **A name the household lacks** (lg-78): Describe lists each name the file
 * uses that resolves to no one, and reads the file with each taken as a new
 * person, so what it reports failing is what no answer removes. Confirm takes
 * an answer for every such name — someone held, or a new person without an
 * email — runs every verification with them applied, and only then adds the
 * new people to the directory, signed by the caller, before the books commit.
 *
 * **The bounds**, each where it can first be known, in this order: the bytes
 * (before anything is parsed); the zip's own structure and its number of
 * entries (`workbook-zip.ts`); the inflated size, declared and then counted,
 * before `exceljs` sees the file;
 * the sheets, then the rows and cells, once parsed; and the request's size, an
 * estimate, before the call. A cell's text is never refused: the view cuts it
 * at `MAX_CELL_TEXT`, and the file is still read in full.
 *
 * **A bank CSV comes through the same two requests** (lg-67). Bytes that are
 * not a workbook and could be a CSV are read as one sheet named
 * `statement.csv` (`csv.ts`), after the shapes the reader does not read are
 * refused; the description is checked for parts a CSV cannot have, and the
 * rows are stored as a statement's, after the stored tail or into an empty
 * history, rather than through `importWorkbook` (`csv-statement.ts`).
 *
 * Nothing here logs: no key, no cell text, no file name (the requests carry
 * none). The route logs the call's token counts and the number of sheets.
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Corrections, Sheet, WorkbookReading } from "@ledger/books";
import { NO_CORRECTIONS, formatCents, hasUnseen, readWorkbook } from "@ledger/books";
import {
  AppError,
  CSV_SHEET_NAME,
  MAX_WORKBOOK_BYTES,
  confirmWorkbookRequestSchema,
  describeWorkbookRequestSchema,
  readerFolded,
  workbookLayoutSchema,
} from "@ledger/contract";
import type {
  BucketLabelConfirmation,
  ConfirmWorkbookResponse,
  CsvPlacement,
  DescribeWorkbookResponse,
  HeldName,
  NameAnswer,
  UnresolvedName,
  WorkbookConfirmation,
  WorkbookLayout,
  WorkbookSampleRow,
} from "@ledger/contract";
import { layoutOutputFormat } from "@ledger/receipts";
import type { LayoutAsk } from "@ledger/receipts";
import type { Database } from "better-sqlite3";
import { csvSheet, csvText, isCsvCandidate, refuseUnreadShapes } from "./csv.ts";
import {
  placementHolds,
  placementLine,
  placementOf,
  refuseNonCsvParts,
  rowsToStore,
  storeCsvRows,
} from "./csv-statement.ts";
import type { CsvStored } from "./csv-statement.ts";
import { byShownName, distinctNames, shownName } from "./directory.ts";
import { estimateTokens, layoutRequest } from "./layout-view.ts";
import { knownPeople } from "./people.ts";
import type { RowToStore } from "./statements.ts";
import { importWorkbook } from "./workbook-import.ts";
import {
  MAX_WORKBOOK_INFLATED_BYTES,
  countInflated,
  declaredInflatedSize,
  workbookEntries,
} from "./workbook-zip.ts";
import type { InflateSpy, ZipEntry } from "./workbook-zip.ts";

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
  /**
   * How the directory shows each person, by id (lg-76): a person added since
   * has a UUID for an id, so the workbook's names reach them only through this,
   * as the host import's do (lg-79).
   */
  names: ReadonlyMap<string, string>;
  now: () => Date;
  /** A new person's id, as the directory makes one (lg-76); a test hands in its own. */
  newId: () => string;
  /**
   * Adds the new people a Confirm's answers name to the household's directory,
   * all or none, each under the id given and with no email, signed by the
   * caller (lg-78). Run just before the books commit.
   */
  addPeople: (people: readonly NewPerson[]) => void;
}

/** A person a Confirm adds (lg-78): the id the books will store, and the name shown. */
export interface NewPerson {
  id: string;
  name: string;
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

/** A file read: a workbook's sheets, or a CSV's one (lg-67). */
interface ReadFile {
  kind: "xlsx" | "csv";
  sheets: Sheet[];
}

/**
 * The file's sheets, once every bound before the model has held. A workbook by
 * lg-66's zip test is read as one; bytes that fail it and could be a CSV are
 * read as a CSV (lg-67, Build 2), whatever the file was named, since its name
 * never reaches the server.
 */
async function fileOf(file: string, deps: WorkbookImportDeps): Promise<ReadFile> {
  const bytes = bytesOf(file);
  let entries: ZipEntry[];
  try {
    entries = workbookEntries(bytes);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === "WORKBOOK_NOT_XLSX" && isCsvCandidate(bytes)) {
      return { kind: "csv", sheets: [csvOf(bytes)] };
    }
    throw error;
  }
  return { kind: "xlsx", sheets: await workbookSheetsOf(bytes, entries, deps) };
}

/**
 * A CSV as its one sheet, named `CSV_SHEET_NAME` (Decision 5 (a)): the shapes
 * the reader does not read are refused before it is parsed, then lg-66's
 * bounds on rows and cells apply. A CSV has nothing to inflate and one sheet,
 * so those two bounds are moot.
 */
function csvOf(bytes: Buffer): Sheet {
  const text = csvText(bytes);
  refuseUnreadShapes(text);
  const sheet = csvSheet(CSV_SHEET_NAME, text);
  boundRowsAndCells([sheet], "That CSV");
  return sheet;
}

/** lg-66's bounds on what a file parses to, over every sheet: its rows, then its cells. */
function boundRowsAndCells(sheets: readonly Sheet[], what: string): void {
  const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
  if (rows > MAX_WORKBOOK_ROWS) {
    throw tooLarge(
      "rows",
      `${what} has ${String(rows)} rows; this import reads ${String(MAX_WORKBOOK_ROWS)} at most.`,
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
      `${what} has ${String(cells)} cells; this import reads ${String(MAX_WORKBOOK_CELLS)} at most.`,
    );
  }
}

/** A workbook's sheets, once its inflated size, its sheets, rows and cells are within bounds. */
async function workbookSheetsOf(
  bytes: Buffer,
  entries: ZipEntry[],
  deps: WorkbookImportDeps,
): Promise<Sheet[]> {
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
  boundRowsAndCells(sheets, "That workbook");
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

  const { kind, sheets } = await fileOf(parsed.data.file, deps);
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
  const usage = { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
  if (kind === "csv") return describeCsv(caller, sheets, layout, usage);
  const held = heldIds(caller);
  const unresolved = unresolvedNames(caller, sheets, layout, held);
  // Each name no one answers to, taken as a new person for the dry run: what
  // still fails is what no answer removes. The ids are never stored.
  const provisional: Answered = { map: new Map(), added: [] };
  for (const entry of unresolved) {
    const id = randomUUID();
    provisional.map.set(entry.name, id);
    provisional.added.push({ id, name: entry.name });
  }
  const result = importWorkbook(caller.db, sheets, {
    personId: caller.personId,
    ...withAnswers(caller, provisional),
    write: false,
    commit: false,
    now: caller.now,
    layout,
    via: "screen",
  });
  return {
    kind: "xlsx",
    layout,
    ok: result.ok,
    problems: result.problems,
    report: result.report,
    confirmation: confirmationOf(sheets, layout, result.reading),
    usage,
    unresolved,
    held: heldNames(caller, held),
  };
}

// --- A name the household lacks (lg-78) ---

/**
 * Everyone the reader may resolve a name to, as `importWorkbook` gives it: the
 * people the books hold, a member who has left included, and the members it
 * enrols before it reads.
 */
function heldIds(caller: WorkbookCaller): string[] {
  return [...new Set([...knownPeople(caller.db), ...caller.members])].toSorted();
}

/** `held`, each as the household shows them with no two alike, in the order a person reads them. */
function heldNames(caller: WorkbookCaller, held: readonly string[]): HeldName[] {
  const shown = distinctNames(held, caller.names);
  return held
    .toSorted(byShownName(new Map(Object.entries(shown))))
    .map((person) => ({ person, name: shown[person] ?? person }));
}

/**
 * Each name the file uses that resolves to no one in `held`, by the reader's
 * own match (`People`, through `readWorkbook`): no second matcher to disagree
 * with the one the import runs.
 */
function unresolvedNames(
  caller: WorkbookCaller,
  sheets: readonly Sheet[],
  layout: WorkbookLayout,
  held: readonly string[],
): UnresolvedName[] {
  return readWorkbook(sheets, { people: held, names: caller.names, layout }).unresolved;
}

/** The answers as the reader takes them: each name to its person, and who is new. */
interface Answered {
  /** A name as the file spells it, to the person it is answered as; the reader folds it. */
  map: Map<string, string>;
  added: NewPerson[];
}

/** The import's people with `answered` applied: the new ones held, each name mapped. */
function withAnswers(
  caller: WorkbookCaller,
  answered: Answered,
): { members: string[]; names: Map<string, string>; corrections: Corrections } {
  return {
    members: [...caller.members, ...answered.added.map((person) => person.id)],
    names: new Map([
      ...caller.names,
      ...answered.added.map((person): [string, string] => [person.id, person.name]),
    ]),
    corrections: { ...NO_CORRECTIONS, people: answered.map },
  };
}

/** What a new person's name holds, as the directory checks it (`addPerson`). */
const NEW_NAME_LENGTH = 64;

/**
 * The answers for `unresolved`, checked against who the household holds: an
 * unanswered name is a request the screen should not have sent; an answer that
 * cannot stand is a problem, and nothing is written. Answers for names that
 * resolve are not used. Two new people under names that fold alike are one.
 */
function answersFor(
  caller: WorkbookCaller,
  unresolved: readonly UnresolvedName[],
  answers: readonly NameAnswer[],
  held: readonly string[],
): Answered & { problems: string[] } {
  const byName = new Map<string, NameAnswer>();
  for (const answer of answers) {
    const key = readerFolded(answer.name);
    if (!byName.has(key)) byName.set(key, answer);
  }
  const missing = unresolved.filter((entry) => !byName.has(readerFolded(entry.name)));
  if (missing.length > 0) {
    throw new AppError(
      "BAD_REQUEST",
      `Say who ${missing.map((entry) => `"${entry.name}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} before confirming: someone the household holds, or a new person. Nothing was imported.`,
    );
  }
  const holds = new Set(held);
  const taken = new Set(
    held.flatMap((id) => [readerFolded(id), readerFolded(shownName(caller.names, id))]),
  );
  const fresh = new Map<string, NewPerson>();
  const answered: Answered & { problems: string[] } = { map: new Map(), added: [], problems: [] };
  for (const entry of unresolved) {
    const answer = byName.get(readerFolded(entry.name));
    if (answer === undefined) continue;
    if (answer.as === "held") {
      if (holds.has(answer.person)) answered.map.set(entry.name, answer.person);
      else {
        answered.problems.push(
          `"${entry.name}" is answered as someone the household does not hold. Read the file again.`,
        );
      }
      continue;
    }
    const name = answer.shownAs.trim();
    if (name === "" || name.length > NEW_NAME_LENGTH) {
      answered.problems.push(
        `The new person for "${entry.name}" needs a name of 1 to ${String(NEW_NAME_LENGTH)} characters.`,
      );
      continue;
    }
    // lg-82: what `addPerson` refuses, said here with the others so nothing is written.
    if (hasUnseen(name)) {
      answered.problems.push(
        `The new person for "${entry.name}" needs a name without a control character or a zero-width one.`,
      );
      continue;
    }
    const key = readerFolded(name);
    if (taken.has(key)) {
      answered.problems.push(
        `Someone in the household is already shown as "${name}": answer "${entry.name}" as them, or give the new person another name.`,
      );
      continue;
    }
    let person = fresh.get(key);
    if (person === undefined) {
      person = { id: caller.newId(), name };
      fresh.set(key, person);
      answered.added.push(person);
    }
    answered.map.set(entry.name, person.id);
  }
  return answered;
}

/** A CSV through its description, read as the books read a sheet: no person or bucket to resolve. */
function readCsv(sheets: readonly Sheet[], layout: WorkbookLayout): WorkbookReading {
  return readWorkbook(sheets, { people: [], layout });
}

/**
 * The dry run for a CSV (lg-67, Build 4): a description naming a part a CSV
 * cannot have is refused; a reading with a problem, the missing balance column
 * among them, or a placement that would be refused, is answered with Confirm
 * withheld and the reason in `problems`. Nothing is written either way.
 */
function describeCsv(
  caller: WorkbookCaller,
  sheets: readonly Sheet[],
  layout: WorkbookLayout,
  usage: { inputTokens: number; outputTokens: number },
): DescribeWorkbookResponse {
  refuseNonCsvParts(layout);
  const reading = readCsv(sheets, layout);
  const rows = rowsToStore(reading);
  const problems = [...reading.problems];
  let placement: CsvPlacement | null = null;
  if (problems.length === 0) {
    placement = placementOf(caller.db, rows);
    if (!placementHolds(placement)) problems.push(placementLine(placement, rows[0]));
  }
  return {
    kind: "csv",
    layout,
    ok: problems.length === 0,
    problems,
    report: csvReport({ reading, rows, placement, problems, stored: null }),
    confirmation: confirmationOf(sheets, layout, reading),
    placement,
    usage,
  };
}

/** The CSV's report, laid out as the workbook's (`importWorkbook`) is. */
function csvReport(input: {
  reading: WorkbookReading;
  rows: readonly RowToStore[];
  placement: CsvPlacement | null;
  problems: readonly string[];
  stored: CsvStored | null;
}): string {
  const { reading, rows, placement, problems, stored } = input;
  const out: string[] = [
    stored === null ? "Dry run: nothing will be written." : "Storing the CSV's rows.",
    "",
    "Rows",
    `  movements read  ${String(rows.length)}`,
    `  skipped         ${String(reading.skipped.length)}`,
  ];
  for (const skip of reading.skipped) {
    out.push(`  skipped: ${skip.sheet} row ${String(skip.row)}, no amount`);
  }
  for (const late of reading.outOfOrder) {
    out.push(
      `  dated out of order: ${late.sheet} row ${String(late.row)}, ${late.date}, is listed above row ${String(late.belowRow)}, ${late.belowDate}; stored as typed`,
    );
  }
  if (placement !== null && placementHolds(placement)) {
    out.push("", "Placement", `  ${placementLine(placement, rows[0])}`);
  }
  if (stored !== null) {
    out.push(
      `  stored          ${String(stored.rowsAdded)}`,
      `  in the inbox    ${String(stored.rowsInInbox)}`,
      `  stored balance  ${formatCents(stored.tailBalanceCents)}`,
    );
  }
  out.push("", "Verifications");
  for (const check of reading.checks) out.push(`  ok      ${check}`);
  for (const problem of problems) out.push(`  FAILED  ${problem}`);
  const outcome =
    stored !== null
      ? "Written."
      : problems.length === 0
        ? "Every verification held. This was a dry run: nothing was written. Confirm to store the rows."
        : "Refused: nothing was written.";
  return `${out.join("\n")}\n\n${outcome}\n`;
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
  const { kind, sheets } = await fileOf(parsed.data.file, deps);
  const { layout } = parsed.data;
  if (kind === "csv") return confirmCsv(caller, sheets, layout);
  const held = heldIds(caller);
  const unresolved = unresolvedNames(caller, sheets, layout, held);
  const answered = answersFor(caller, unresolved, parsed.data.names ?? [], held);
  if (answered.problems.length > 0) {
    throw new AppError("WORKBOOK_IMPORT_REFUSED", undefined, {
      details: { problems: answered.problems },
    });
  }
  // Every verification runs with the answers applied, inside the books'
  // transaction; only once all hold are the new people added to the
  // directory, and the books commit after. The two are separate files, so the
  // one window left is that commit failing once the people are in: a second
  // Confirm then finds them held.
  const { added } = answered;
  const result = importWorkbook(caller.db, sheets, {
    personId: caller.personId,
    ...withAnswers(caller, answered),
    write: true,
    commit: true,
    now: caller.now,
    layout,
    via: "screen",
    beforeCommit: added.length === 0 ? undefined : () => caller.addPeople(added),
  });
  if (!result.written) {
    throw new AppError("WORKBOOK_IMPORT_REFUSED", undefined, {
      details: { problems: result.problems },
    });
  }
  return { kind: "xlsx", report: result.report };
}

/**
 * A CSV's confirmation (lg-67, Build 5): the description checked and the file
 * read again, every verification run, and the rows stored only when all hold,
 * after the stored tail or into an empty history, with the rules run over them.
 */
function confirmCsv(
  caller: WorkbookCaller,
  sheets: readonly Sheet[],
  layout: WorkbookLayout,
): ConfirmWorkbookResponse {
  refuseNonCsvParts(layout);
  const reading = readCsv(sheets, layout);
  if (reading.problems.length > 0) {
    throw new AppError(
      "WORKBOOK_IMPORT_REFUSED",
      "The CSV, read through that description, does not pass every check, so nothing was stored.",
      { details: { problems: reading.problems } },
    );
  }
  const rows = rowsToStore(reading);
  const { placement, ...stored } = storeCsvRows(
    { db: caller.db, personId: caller.personId, now: caller.now },
    rows,
  );
  return {
    kind: "csv",
    report: csvReport({ reading, rows, placement, problems: [], stored }),
    ...stored,
  };
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
