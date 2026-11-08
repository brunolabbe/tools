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
import { MAX_WORKBOOK_ROWS, MAX_WORKBOOK_SLOTS } from "./workbook-bounds.ts";
import { sheetPartsOf } from "./workbook-parts.ts";
import { workbookEntries } from "./workbook-zip.ts";

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
 * The indices `array` defines, in order, found without walking its holes. A formatting
 * stub at `A1048576` leaves `!data` a million long with two rows in it, and every walk
 * of the length visits the million: measured on one such sheet, `entries()` took 42.6 ms,
 * `forEach` 37.8 ms (the holes are still visited) and the keys 0.01 ms (lg-96, gate 2's
 * F3). A row stubbed at `XFD` is the same on the column axis.
 */
function definedIndices(array: readonly unknown[]): number[] {
  return Object.keys(array)
    .map(Number)
    .filter((index) => Number.isInteger(index));
}

/**
 * How wide a stored row is: up to its last cell that holds a value. Only the
 * indices the row defines are visited, so a row whose one stored cell is a
 * formatting stub at `XFD` is not walked across 16 384 places (lg-96, gate 1's
 * F3: 5 000 such rows took 6.4 s, the walk made twice).
 */
function widthOf(source: readonly (XLSX.CellObject | undefined)[] | undefined): number {
  let width = 0;
  if (source === undefined) return width;
  for (const c of definedIndices(source)) if (holds(source[c])) width = c + 1;
  return width;
}

function tooLarge(bound: "rows" | "slots", message: string): AppError {
  return new AppError("WORKBOOK_TOO_LARGE", message, { details: { bound } });
}

/** What `placesOf` found out about a sheet: the places it spent and the width of each row to build. */
export interface Extent {
  /** The workbook's places so far, this sheet's included. */
  places: number;
  /**
   * The width of each row up to the last that holds a value, a gap row 0. **This is
   * the whole of what `rowsOf` builds**: rows past the last stored one, which a
   * formatting stub can make `!data` hold by the million (lg-96, gate 1's F1), are
   * not in it, and so are never built.
   */
  widths: number[];
}

/**
 * What a sheet's grid will hold, found from the stored cells before `rowsOf`
 * builds it, and added to `spent`, the places the workbook's earlier sheets took
 * (lg-96). `rowsOf` makes a row for every row up to the last stored one and each
 * row as wide as its own last cell, so a sheet with one cell at `A1048576` pays for
 * 1 048 576 rows and one with a cell at `XFD` in each row pays 16 384 a row, from a
 * file of a few kilobytes: neither follows the file's size, which `workbook-zip.ts`
 * bounds, but the address.
 *
 * A row is a place of its own, so a gap row counts one, and a stored row counts
 * its width. The total runs across the sheets, so that a workbook of many sheets is
 * bounded as one; the sheets are not charged one by one against the same cap. What it
 * does not bound is SheetJS's own parse of each sheet, which happens before this runs
 * (gate 1's F2): a part listed under many sheets is refused before that, by
 * `refuseUnlessEachSheetIsItsOwn`. Refused past `MAX_WORKBOOK_ROWS` rows in one
 * sheet and `MAX_WORKBOOK_SLOTS` places in the workbook, each as
 * `WORKBOOK_TOO_LARGE` with the bound named, and the refusal is thrown as soon as
 * it is known, with the rest of the sheet unread.
 */
export function placesOf(sheet: XLSX.DenseSheet, spent: number): Extent {
  let places = spent;
  const widths: number[] = [];
  const data = sheet["!data"] ?? [];
  for (const r of definedIndices(data)) {
    const width = widthOf(data[r]);
    if (width === 0) continue;
    if (r + 1 > MAX_WORKBOOK_ROWS) {
      throw tooLarge(
        "rows",
        `A sheet of that workbook has a cell in row ${String(r + 1)}; this import reads ${String(MAX_WORKBOOK_ROWS)} rows at most.`,
      );
    }
    // The gap rows since the last stored one, each a place, then this row's width.
    places += r - widths.length + width;
    while (widths.length < r) widths.push(0);
    widths.push(width);
    if (places > MAX_WORKBOOK_SLOTS) {
      throw tooLarge(
        "slots",
        `That workbook's sheets lay out more than ${String(MAX_WORKBOOK_SLOTS)} places, a row and each cell along it counted; this import reads ${String(MAX_WORKBOOK_SLOTS)} at most.`,
      );
    }
  }
  return { places, widths };
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
 *
 * Builds `widths.length` rows of those widths and looks at no row of `!data` past the
 * last, so what it costs is what `placesOf` charged. Rows past the last stored one are
 * not part of the sheet.
 */
export function rowsOf(
  sheet: XLSX.DenseSheet,
  widths: readonly number[],
  date1904: boolean,
): (Cell | null)[][] {
  const data = sheet["!data"] ?? [];
  return widths.map((width, r) => {
    const source = data[r];
    const cells: (Cell | null)[] = [];
    for (let c = 0; c < width; c += 1) cells.push(cellOf(source?.[c], date1904));
    // A row with nothing stored in it is a gap, as an absent row is.
    return cells;
  });
}

/**
 * Refuses, before SheetJS parses any sheet, a workbook that does not give every sheet
 * a part of its own (lg-96, gate 1's F2 and gate 2's F2): SheetJS parses a part once
 * for every sheet that names it, so a file of a few kilobytes can cost its biggest
 * part many times over.
 *
 * The shape of the zip comes first, whatever the caller: whatever `workbookEntries`
 * refuses is refused here, so the import command meets the refusal the route does
 * (gate 2). Then the sheets are counted by SheetJS itself, with `bookSheets`, which
 * reads the workbook part and parses no sheet, and the workbook is refused unless
 * `workbook-parts.ts` finds the same number, each in a part that exists, no two in
 * one.
 *
 * **The count is fail-closed; the distinctness of the parts is not.** A difference
 * between the copy and SheetJS in the sheet count or in whether a part exists is a
 * refusal. Whether two sheets share a part is judged by a copy of SheetJS's rules, and
 * gate 3 (lg-96) found two ways past it, both read through `readSheets` (lg-104 owns
 * them): a zip entry whose local-header name differs from its central-directory name
 * (`workbookEntries` and `compressedOf` read the central one, SheetJS's CFB the local
 * one), which read one 1 400 by 100 part 14 times, +367.5 MB (peak 448.9 MB); and a part,
 * such as comments, that several sheets' `.rels` name, parsed once per sheet, +352.5 MB.
 */
function refuseUnlessEachSheetIsItsOwn(data: Buffer): void {
  const entries = workbookEntries(data);
  let listed: unknown;
  try {
    listed = XLSX.read(data, { type: "buffer", bookSheets: true }).SheetNames;
  } catch (error: unknown) {
    throw unreadable(error instanceof Error ? error.message : "", error);
  }
  const parts = sheetPartsOf(data, entries);
  if (
    !Array.isArray(listed) ||
    parts === undefined ||
    parts.length !== listed.length ||
    new Set(parts).size !== parts.length
  ) {
    throw new AppError(
      "WORKBOOK_NOT_XLSX",
      "That workbook does not give each of its sheets a part of its own; this import reads a workbook that does.",
    );
  }
}

/** Every sheet of the workbook in `data`, in the workbook's order. */
export async function readSheets(data: Buffer): Promise<Sheet[]> {
  refuseUnlessEachSheetIsItsOwn(data);
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
  let places = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name] as XLSX.DenseSheet | undefined;
    // A chartsheet or a dialog sheet holds no cells.
    if (sheet === undefined || (sheet["!type"] !== undefined && sheet["!type"] !== "sheet")) {
      continue;
    }
    const extent = placesOf(sheet, places);
    places = extent.places;
    sheets.push({ name, rows: rowsOf(sheet, extent.widths, date1904) });
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
