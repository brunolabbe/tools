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

/** The one `SSF` call this file makes; SheetJS types the whole namespace `any`. */
const SSF = XLSX.SSF as { is_date: (format: string) => boolean };

const DAY_MS = 86_400_000;

/** 9999-12-31, Excel's last day, as a serial in each date system. */
const LAST_DAY_1900 = 2_958_465;
const LAST_DAY_1904 = 2_957_003;

/**
 * A calendar day, `YYYY-MM-DD`, from a date serial in a date-formatted cell, or
 * `null` for a serial that names no day. Computed in UTC rather than through
 * SheetJS's `parse_date_code`, which goes through local time and was measured
 * off by a day in two Pacific zones (lg-87).
 */
function dayOf(serial: number, date1904: boolean): string | null {
  // Rounded to the millisecond first, so a serial a float's error under a whole
  // day is that day: 44621.9999999999 is 2022-03-02 00:00:00, as Excel shows it.
  const day = Math.floor(Math.round(serial * DAY_MS) / DAY_MS);
  // Below 1 is no day: a formula that returns an empty cell's 0 is not 1899-12-30
  // nor SheetJS's 1900-01-00. Serial 60 is the 1900-02-29 Excel invents. Above
  // 9999-12-31, Excel's last day, is none either, and written negated so that
  // NaN is refused too rather than thrown as a RangeError (lg-87 gate 1).
  if (!(day >= 1 && day <= (date1904 ? LAST_DAY_1904 : LAST_DAY_1900))) return null;
  if (!date1904 && day === 60) return null;
  // Excel's day 1 is 1900-01-01, and its fictitious 29 February shifts every
  // later serial by one; the 1904 system counts from 1904-01-01 as day 0.
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : day < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  return new Date(epoch + day * DAY_MS).toISOString().slice(0, 10);
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
      // A formula SheetJS itself wrote with no saved result: an error with no code.
      return raw === undefined || cell.w === undefined ? null : { kind: "text", text: cell.w };
    default:
      // `z`, a stub: a formula saved with no value as Excel and `exceljs` write it.
      return null;
  }
}

/**
 * Whether a stored cell holds anything a row is shaped by. A stub with no formula
 * is formatting on an empty cell, and an empty string or an error with no code is
 * nothing either: `exceljs` read none of them as a cell.
 */
function holds(cell: XLSX.CellObject | undefined): cell is XLSX.CellObject {
  if (cell === undefined) return false;
  if (cell.f !== undefined) return true;
  if (cell.t === "z") return false;
  if (cell.t === "s" && cell.v === "") return false;
  return !(cell.t === "e" && cell.v === undefined);
}

function cellOf(cell: XLSX.CellObject | undefined, date1904: boolean): Cell | null {
  if (!holds(cell)) return null;
  const value = valueOf(cell, date1904);
  // A shared formula arrives with its text shifted to this cell, as Excel shows it.
  const formula = cell.f ?? null;
  if (value === null && formula === null) return null;
  return { value, formula };
}

/**
 * One sheet's rows, each a row of cells with gaps kept as `null`.
 *
 * A merged range's other parts that store nothing are given no place: a reader
 * indexes a row as `rows[r]?.[c] ?? null`, so an absent place reads as the `null`
 * a gap does. A value stored inside a merge (LibreOffice's "keep the contents of
 * the hidden cells" writes one) is read as an ordinary cell. Giving each part its
 * own `null`, as `exceljs` did, cost memory in
 * proportion to the merge's area (+76 MB at A1:XFD100, +227 MB at A1:XFD400)
 * past every size bound, a 2.5 KB file (lg-88).
 */
function rowsOf(sheet: XLSX.DenseSheet, date1904: boolean): (Cell | null)[][] {
  const data = sheet["!data"] ?? [];
  const rows: (Cell | null)[][] = [];
  for (const source of data) {
    let width = 0;
    for (const [c, cell] of (source ?? []).entries()) if (holds(cell)) width = c + 1;
    const cells: (Cell | null)[] = [];
    for (let c = 0; c < width; c += 1) cells.push(cellOf(source?.[c], date1904));
    // A row with nothing stored in it is a gap, as an absent row is.
    rows.push(cells);
  }
  // Rows past the last stored one are not part of the sheet.
  while (rows.length > 0 && rows.at(-1)?.length === 0) rows.pop();
  return rows;
}

/** Every sheet of the workbook in `data`, in the workbook's order. */
export async function readSheets(data: Buffer): Promise<Sheet[]> {
  let workbook: XLSX.WorkBook;
  try {
    // `sheetStubs`, or a formula saved with no value is dropped, formula and all:
    // SheetJS reads its empty value as 0, and skips it as `0 == ""` (lg-87).
    workbook = XLSX.read(data, {
      type: "buffer",
      dense: true,
      cellFormula: true,
      cellNF: true,
      sheetStubs: true,
    });
  } catch (error: unknown) {
    // SheetJS's own reason is the only clue to which part of the file it
    // choked on. It goes to the owner's terminal, the only place this prints.
    throw unreadable(error instanceof Error ? error.message : "", error);
  }
  // SheetJS reads anything that is not a zip as text, a CSV of one sheet; and a
  // zip in another spreadsheet format is not the household's workbook.
  // `bookType` is `xlsx` for every OOXML workbook, macro-enabled included.
  if (workbook.bookType !== "xlsx") {
    throw unreadable(
      workbook.bookType === undefined ? "not a zip" : `${workbook.bookType}, not xlsx`,
    );
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
