/**
 * An `.xlsx` file as plain cell grids, for `@ledger/books` to read (lg-7).
 *
 * The only file in the tool that opens a spreadsheet. It reads each cell's
 * **cached** value — what Excel last computed and saved — and never evaluates a
 * formula; a computed cell keeps its formula text beside the value, because a
 * period's settlement formula is told apart by it. `exceljs`, not the `xlsx`
 * package: the registry's copy of that one is stale and carries known
 * advisories, and its fixes ship only off the registry.
 */

import ExcelJS from "exceljs";
import type { Cell, CellValue, Sheet } from "@ledger/books";
import { AppError } from "@ledger/contract";

/** A calendar day from the `Date` exceljs builds for a date cell, which is UTC midnight. */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A cached value as the books see it, or `null` for an empty one. */
function valueOf(raw: unknown): CellValue | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return { kind: "number", number: raw };
  if (typeof raw === "string") return raw.trim() === "" ? null : { kind: "text", text: raw };
  if (typeof raw === "boolean") return { kind: "text", text: raw ? "TRUE" : "FALSE" };
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : { kind: "date", date: dayOf(raw) };
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record["richText"])) {
      const text = (record["richText"] as { text?: unknown }[])
        .map((run) => (typeof run.text === "string" ? run.text : ""))
        .join("");
      return valueOf(text);
    }
    // A formula, shared or not: the cached result is the value.
    if ("formula" in record || "sharedFormula" in record) return valueOf(record["result"]);
    if (typeof record["error"] === "string") return { kind: "text", text: record["error"] };
    if (typeof record["text"] === "string") return valueOf(record["text"]);
  }
  return null;
}

function cellOf(cell: ExcelJS.Cell): Cell | null {
  // A merged cell's other parts repeat the first part's value; only the first
  // part is the cell.
  if (cell.type === ExcelJS.ValueType.Merge) return null;
  const value = valueOf(cell.value);
  const formula = cell.type === ExcelJS.ValueType.Formula ? (cell.formula ?? null) : null;
  if (value === null && formula === null) return null;
  return { value, formula };
}

/** Every sheet of the workbook in `data`, in the workbook's order. */
export async function readSheets(data: Buffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's declared parameter type predates Node's generic Buffer.
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch (error: unknown) {
    throw new AppError("BAD_REQUEST", "The file could not be read as an .xlsx workbook.", {
      cause: error,
    });
  }
  return workbook.worksheets.map((worksheet) => {
    const rows: (Cell | null)[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: (Cell | null)[] = [];
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        cells[columnNumber - 1] = cellOf(cell);
      });
      rows[rowNumber - 1] = Array.from(cells, (cell) => cell ?? null);
    });
    return { name: worksheet.name, rows: Array.from(rows, (row) => row ?? []) };
  });
}
