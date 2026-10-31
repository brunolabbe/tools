/**
 * A bank CSV's rows, stored as a statement's (lg-67): what the import screen
 * does with a CSV once its description is read, in place of `importWorkbook`,
 * which files every row it stores and so cannot take a CSV's, which have no
 * bucket.
 *
 * - **A description that names a part a CSV cannot have is refused**
 *   (`LAYOUT_NOT_FOR_CSV`, Build 4): a bucket mapping or column, a person
 *   column, a carry-over label, summary rows, periods, salaries, or a sheet per
 *   year. 0 of lg-56's 150 answers on the CSV fixtures named the first seven, 1
 *   the eighth.
 * - **Placed after the stored tail, or into an empty history; never
 *   overlapping** (Decision 2 (a)). The first CSV into an empty history is the
 *   anchor. Otherwise its oldest row must open from the newest stored row's
 *   balance, be dated no earlier than it, and not begin with the stored rows of
 *   that day: anything else is `CSV_NOT_AFTER_TAIL`, naming the tail's date
 *   and balance. A CSV's wording is another bank's, so a row is never found
 *   among the stored ones by its description, and an overlap is refused rather
 *   than compared: the person cuts the file where the refusal says.
 * - **Stored as a paste's rows are**, by the one insert `importStatement` uses
 *   (`insertRows`): oldest first after the highest stored position, source
 *   `paste`, `category` empty, `description` the detail, the note column's
 *   text in `note`. **Then the rules**, in the same transaction, as a paste's
 *   (Decision 7 (a), `classifyAdded`): what no rule and no history files waits
 *   in the inbox.
 *
 * A row whose bank wording a later AccèsD paste repeats differently is compared
 * as a paste's row, field for field, so that paste is refused where it
 * overlaps (Decision 2's cost, recorded in lg-67's Notes): paste only the rows
 * after the stored tail.
 */

import { formatCents } from "@ledger/books";
import type { WorkbookReading } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { CsvPlacement, WorkbookLayout } from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { classifyAdded, lastRowId } from "./classifications.ts";
import { immediately, insertRows, storedTail } from "./statements.ts";
import type { ImportContext, RowToStore } from "./statements.ts";

/** Each part of `layout` a bank CSV cannot have, in a person's words; empty when none. */
export function partsNotInCsv(layout: WorkbookLayout): string[] {
  const { account } = layout;
  const roles = new Set(account.columns.map((entry) => entry.role));
  const parts: string[] = [];
  if (account.buckets.length > 0) parts.push("a bucket mapping");
  if (roles.has("bucket")) parts.push("a bucket column");
  if (roles.has("person")) parts.push("a person column");
  if (account.carryOverLabel !== null) parts.push("a carry-over label");
  if (account.summary !== null) parts.push("summary rows");
  if (layout.periods !== null) parts.push("periods");
  if (layout.salaries !== null) parts.push("salaries");
  if (account.yearPerSheet) parts.push("a sheet per year");
  return parts;
}

/** `LAYOUT_NOT_FOR_CSV` when the description names any part a CSV cannot have. */
export function refuseNonCsvParts(layout: WorkbookLayout): void {
  const parts = partsNotInCsv(layout);
  if (parts.length === 0) return;
  throw new AppError(
    "LAYOUT_NOT_FOR_CSV",
    `The model described ${parts.join(", ")}, which a bank CSV cannot have, so the description is not of this file. Nothing was imported. Describing it again asks the model again.`,
    { details: { parts } },
  );
}

/** The rows a CSV's reading stores, oldest first: every row read, each with its balance. */
export function rowsToStore(reading: WorkbookReading): RowToStore[] {
  const rows: RowToStore[] = [];
  for (const row of [...reading.movements, ...reading.unfiled]) {
    // A row with no balance is read only when the description names no balance
    // column, which the reader reports as a problem, so nothing is placed.
    if (row.balanceCents === null) continue;
    rows.push({
      date: row.date,
      category: "",
      description: row.detail,
      amountCents: row.amountCents,
      balanceCents: row.balanceCents,
      note: row.note,
    });
  }
  return rows;
}

/**
 * Where `rows` go against the stored history: the same check on the dry run as
 * on Confirm, which runs it inside its transaction. `rows` is not empty: a
 * reading of no row is a problem of the reader's, and nothing is placed.
 */
export function placementOf(db: Database, rows: readonly RowToStore[]): CsvPlacement {
  const oldest = rows[0];
  const tail = storedTail(db);
  if (tail === undefined || oldest === undefined) return { kind: "first" };
  const at = { date: tail.date, balanceCents: tail.balanceCents };
  if (oldest.date < tail.date || beginsWithStoredDay(db, tail.date, rows)) {
    return { kind: "overlaps", ...at };
  }
  if (oldest.balanceCents - oldest.amountCents !== tail.balanceCents) return { kind: "gap", ...at };
  return { kind: "continues", ...at };
}

/**
 * Whether the CSV starts with stored rows of the tail's day, through its last:
 * the day's rows from some position on are the CSV's first rows, by date,
 * amount and balance. A row is never found by those fields alone elsewhere (a
 * transfer and its reversal repeat them), only as the stored day's end.
 */
function beginsWithStoredDay(db: Database, day: string, rows: readonly RowToStore[]): boolean {
  const stored = db
    .prepare(
      "SELECT date, amount_cents, balance_cents FROM statement_rows WHERE date = ? ORDER BY seq",
    )
    .all(day) as { date: string; amount_cents: number; balance_cents: number }[];
  for (let from = 0; from < stored.length; from++) {
    const end = stored.slice(from);
    if (end.length > rows.length) continue;
    const same = end.every((row, index) => {
      const csv = rows[index];
      return (
        csv !== undefined &&
        csv.date === row.date &&
        csv.amountCents === row.amount_cents &&
        csv.balanceCents === row.balance_cents
      );
    });
    if (same) return true;
  }
  return false;
}

function describeRow(row: RowToStore): string {
  return `${row.date} "${row.description}" ${formatCents(row.amountCents)} (balance ${formatCents(row.balanceCents)})`;
}

/**
 * What the placement says on the dry run's report (lg-67, Build 6.2): the
 * report line when it holds, or the refusal's sentence when it does not.
 */
export function placementLine(placement: CsvPlacement, oldest: RowToStore | undefined): string {
  switch (placement.kind) {
    case "first":
      return "first import: no history is stored";
    case "continues":
      return `continues from the stored balance of ${formatCents(placement.balanceCents)} on ${placement.date}`;
    case "overlaps":
    case "gap":
      return refusalOf(placement, oldest).message;
  }
}

/** Whether the rows can be stored where they fall. */
export function placementHolds(placement: CsvPlacement): boolean {
  return placement.kind === "first" || placement.kind === "continues";
}

function refusalOf(
  placement: Extract<CsvPlacement, { kind: "overlaps" | "gap" }>,
  oldest: RowToStore | undefined,
): AppError {
  const left = `the newest stored row, of ${placement.date}, which left ${formatCents(placement.balanceCents)}`;
  const first = oldest === undefined ? "its oldest row" : `its oldest row, ${describeRow(oldest)},`;
  const details = {
    placement: placement.kind,
    date: placement.date,
    balanceCents: placement.balanceCents,
  };
  if (placement.kind === "overlaps") {
    return new AppError(
      "CSV_NOT_AFTER_TAIL",
      `The file reaches back over rows already stored: ${first} is not after ${left}. A CSV is stored only after what is stored: take out of the file every row up to and including that one, and choose it again.`,
      { details },
    );
  }
  const opens = oldest === undefined ? 0 : oldest.balanceCents - oldest.amountCents;
  return new AppError(
    "CSV_NOT_AFTER_TAIL",
    `The file does not continue from the rows already stored: ${first} opens from ${formatCents(opens)}, but ${left}: ${formatCents(opens - placement.balanceCents)} is unexplained. A row is missing between the two: export a stretch that starts right after that row.`,
    { details },
  );
}

/** What storing a CSV's rows reports. */
export interface CsvStored {
  rowsAdded: number;
  rowsInInbox: number;
  tailBalanceCents: number;
}

/**
 * Stores `rows` after the stored tail, or into an empty history, and runs the
 * rules over them, all in one `IMMEDIATE` transaction with the tail read inside
 * it, so two confirmations at once cannot both extend the same tail. Refuses
 * with `CSV_NOT_AFTER_TAIL`, storing nothing, when the rows do not continue it.
 * `classify` is `classifyAdded`; a test hands in one that throws, to see that
 * nothing is stored without its classifications.
 */
export function storeCsvRows(
  context: ImportContext,
  rows: readonly RowToStore[],
  classify: typeof classifyAdded = classifyAdded,
): CsvStored & { placement: CsvPlacement } {
  return immediately(context.db, "Confirm again.", () => {
    const placement = placementOf(context.db, rows);
    if (placement.kind === "overlaps" || placement.kind === "gap") {
      throw refusalOf(placement, rows[0]);
    }
    const before = lastRowId(context.db);
    insertRows(context.db, context, rows);
    const filed = classify(context, before);
    return {
      placement,
      rowsAdded: rows.length,
      rowsInInbox: rows.length - filed,
      tailBalanceCents: storedTail(context.db)?.balanceCents ?? 0,
    };
  });
}
