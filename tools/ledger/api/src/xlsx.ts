/**
 * An `.xlsx` file as plain cell grids, for `@ledger/books` to read (lg-7).
 *
 * The only file in the tool that opens a spreadsheet. It reads each cell's
 * **cached** value — what Excel last computed and saved — and never evaluates a
 * formula; a computed cell keeps its formula text beside the value, because a
 * period's settlement formula is told apart by it. SheetJS from its own CDN, not
 * the registry's `xlsx`: that copy is stale and carries known advisories, and the
 * fixed builds ship only off the registry. `exceljs`, which this replaced, pulled
 * in a chain no release of it would clear (lg-84).
 */

import * as XLSX from "xlsx";
import type { Cell, CellValue, Sheet } from "@ledger/books";
import { AppError } from "@ledger/contract";

/** The two `SSF` calls this file makes; SheetJS types the whole namespace `any`. */
const SSF = XLSX.SSF as {
  is_date: (format: string) => boolean;
  parse_date_code: (
    serial: number,
    options: { date1904: boolean },
  ) => { y: number; m: number; d: number } | null;
};

/** What `XLSX.read` reports for the two zip formats `exceljs` read: plain and macro-enabled. */
const WORKBOOK_TYPES = new Set(["xlsx", "xlsm"]);

/** A calendar day, `YYYY-MM-DD`, from a date serial in a date-formatted cell. */
function dayOf(serial: number, date1904: boolean): string | null {
  const parts = SSF.parse_date_code(serial, { date1904 });
  if (parts === null) return null;
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return `${pad(parts.y, 4)}-${pad(parts.m, 2)}-${pad(parts.d, 2)}`;
}

/** A cached value as the books see it, or `null` for an empty one. */
function valueOf(cell: XLSX.CellObject, date1904: boolean): CellValue | null {
  const raw = cell.v;
  switch (cell.t) {
    case "n": {
      if (typeof raw !== "number") return null;
      if (cell.z !== undefined && SSF.is_date(String(cell.z))) {
        const date = dayOf(raw, date1904);
        return date === null ? null : { kind: "date", date };
      }
      return { kind: "number", number: raw };
    }
    case "s":
      // Rich text arrives joined, and a hyperlink as its shown text.
      return typeof raw === "string" && raw.trim() !== "" ? { kind: "text", text: raw } : null;
    case "b":
      return typeof raw === "boolean" ? { kind: "text", text: raw ? "TRUE" : "FALSE" } : null;
    case "e":
      // A formula with no saved result reads as an error with no code: no value.
      return raw === undefined || cell.w === undefined ? null : { kind: "text", text: cell.w };
    case "d":
      return raw instanceof Date && !Number.isNaN(raw.getTime())
        ? { kind: "date", date: raw.toISOString().slice(0, 10) }
        : null;
    default:
      return null;
  }
}

function cellOf(cell: XLSX.CellObject | undefined, date1904: boolean): Cell | null {
  if (cell === undefined) return null;
  const value = valueOf(cell, date1904);
  // A shared formula arrives with its text shifted to this cell, as Excel shows it.
  const formula = cell.f ?? null;
  if (value === null && formula === null) return null;
  return { value, formula };
}

/** One sheet's rows, each a row of cells with gaps kept as `null`. */
function rowsOf(sheet: XLSX.DenseSheet, date1904: boolean): (Cell | null)[][] {
  // A merged cell's other parts are not cells: only the first part is read, and
  // the rest hold a place, as they did under `exceljs`.
  const covered = new Map<number, Set<number>>();
  for (const range of sheet["!merges"] ?? []) {
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        if (r === range.s.r && c === range.s.c) continue;
        const row = covered.get(r) ?? new Set<number>();
        row.add(c);
        covered.set(r, row);
      }
    }
  }
  const data = sheet["!data"] ?? [];
  const rows: (Cell | null)[][] = [];
  const last = Math.max(data.length, ...Array.from(covered.keys(), (r) => r + 1));
  for (let r = 0; r < last; r += 1) {
    const source = data[r] ?? [];
    const placed = covered.get(r) ?? new Set<number>();
    const width = Math.max(source.length, ...Array.from(placed, (c) => c + 1));
    const cells: (Cell | null)[] = [];
    for (let c = 0; c < width; c += 1) {
      cells.push(placed.has(c) ? null : cellOf(source[c], date1904));
    }
    // A row with nothing stored in it is a gap, as an absent row is.
    const stored = placed.size > 0 || source.some((cell) => cell !== undefined);
    rows.push(stored ? cells : []);
  }
  // Rows past the last stored one are not part of the sheet.
  while (rows.length > 0 && rows.at(-1)?.length === 0) rows.pop();
  return rows;
}

/** Every sheet of the workbook in `data`, in the workbook's order. */
export async function readSheets(data: Buffer): Promise<Sheet[]> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "buffer", dense: true, cellFormula: true, cellNF: true });
  } catch (error: unknown) {
    // SheetJS's own reason is the only clue to which part of the file it
    // choked on. It goes to the owner's terminal, the only place this prints.
    throw unreadable(error instanceof Error ? error.message : "", error);
  }
  // SheetJS reads anything that is not a zip as text, a CSV of one sheet; and a
  // zip in another spreadsheet format is not the household's workbook.
  if (!WORKBOOK_TYPES.has(workbook.bookType ?? "")) {
    throw unreadable(workbook.bookType === undefined ? "not a zip" : `a ${workbook.bookType} file`);
  }
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const sheets: Sheet[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name] as XLSX.DenseSheet | undefined;
    // A chartsheet or a dialog sheet holds no cells.
    if (sheet === undefined || (sheet["!type"] !== undefined && sheet["!type"] !== "sheet")) {
      continue;
    }
    sheets.push({ name, rows: rowsOf(sheet, date1904) });
  }
  return sheets;
}

function unreadable(reason: string, cause?: unknown): AppError {
  return new AppError(
    "BAD_REQUEST",
    `The file could not be read as an .xlsx workbook${reason === "" ? "" : ` (${reason})`}.`,
    { cause },
  );
}
