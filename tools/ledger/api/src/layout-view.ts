/**
 * What a model is shown of a workbook (lg-38, Build 2): each sheet's name and
 * size, its first rows, a sample of rows further down and its last rows, each
 * cell with the formula text beside it when it was computed. Never the whole
 * account: a sheet of two hundred rows shows at most `firstRows + sampleRows +
 * lastRows` of them.
 *
 * Figures are shown by default, because a running balance is told from an
 * amount by how the figures follow one another, and in a CSV nothing else
 * tells them apart. `figures: "masked"` replaces every number with `#`, so the
 * measurement can say what that costs; dates and text are never masked.
 *
 * **Moved here from `api/test/layout/view.ts` by lg-66**, so the product sends
 * what lg-38 and lg-56 measured and there is one copy: the measurement harness
 * imports it back. What it makes is pinned by sha256, fixture by fixture, in
 * `api/test/layout-pins.test.ts`; a change to what is sent is a deliberate
 * edit of a pin. It lives in `api` rather than beside the model call in
 * `@ledger/receipts` because it reads the books' cell grids, which `receipts`
 * has no reason to know: that package is handed the text and nothing else.
 */

import type { Cell, Sheet } from "@ledger/books";
import { LAYOUT_SAMPLE_ROWS } from "@ledger/contract";

export interface ViewOptions {
  firstRows: number;
  sampleRows: number;
  lastRows: number;
  /** A longer text is cut there, with `…`. */
  maxText: number;
  figures: "shown" | "masked";
}

/**
 * The longest text of a cell that is sent (lg-66, Build 3.3): a longer one is
 * cut there, with `…`, and the file is still read in full. The 40 the
 * measurement ran with.
 */
export const MAX_CELL_TEXT = 40;

/** What was measured; the screen states the same numbers from the contract. */
export const DEFAULT_VIEW: ViewOptions = {
  firstRows: LAYOUT_SAMPLE_ROWS.first,
  sampleRows: LAYOUT_SAMPLE_ROWS.middle,
  lastRows: LAYOUT_SAMPLE_ROWS.last,
  maxText: MAX_CELL_TEXT,
  figures: "shown",
};

function columnName(column: number): string {
  let name = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCodePoint(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

function shown(cell: Cell, options: ViewOptions): string {
  const value = cell.value;
  let text: string;
  if (value === null) text = "(no value)";
  else if (value.kind === "date") text = value.date;
  else if (value.kind === "number")
    text = options.figures === "masked" ? "#" : String(value.number);
  else {
    const cut =
      value.text.length > options.maxText ? `${value.text.slice(0, options.maxText)}…` : value.text;
    text = JSON.stringify(cut);
  }
  return cell.formula === null ? text : `${text} {=${cell.formula}}`;
}

/** The rows shown of a sheet of `count` rows: the first, an even sample of the middle, the last. */
export function shownRows(count: number, options: ViewOptions): number[] {
  const rows = new Set<number>();
  for (let row = 1; row <= Math.min(count, options.firstRows); row++) rows.add(row);
  for (let row = Math.max(1, count - options.lastRows + 1); row <= count; row++) rows.add(row);
  const from = options.firstRows + 1;
  const to = count - options.lastRows;
  const middle = to - from + 1;
  if (middle > 0 && options.sampleRows > 0) {
    const step = middle / options.sampleRows;
    for (let index = 0; index < Math.min(options.sampleRows, middle); index++) {
      rows.add(from + Math.floor(step * index + step / 2));
    }
  }
  return [...rows].toSorted((a, b) => a - b);
}

function rowLine(sheet: Sheet, row: number, options: ViewOptions): string | null {
  const cells = sheet.rows[row - 1] ?? [];
  const parts: string[] = [];
  for (const [index, cell] of cells.entries()) {
    if (cell !== null) parts.push(`${columnName(index + 1)}=${shown(cell, options)}`);
  }
  return parts.length === 0 ? null : `row ${String(row)}: ${parts.join(" | ")}`;
}

/** Every sheet, as the text the model reads. */
export function layoutView(sheets: readonly Sheet[], options: ViewOptions = DEFAULT_VIEW): string {
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const count = sheet.rows.length;
    const width = Math.max(0, ...sheet.rows.map((row) => row.length));
    const lines = [
      `## Sheet ${JSON.stringify(sheet.name)}: ${String(count)} rows, columns A to ${width === 0 ? "A" : columnName(width)}`,
    ];
    let last = 0;
    for (const row of shownRows(count, options)) {
      if (row > last + 1) lines.push(`(rows ${String(last + 1)} to ${String(row - 1)} not shown)`);
      last = row;
      const line = rowLine(sheet, row, options);
      if (line !== null) lines.push(line);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * What the model is asked, before the sheets. The answer's schema, sent as
 * the structured output's format, carries each field's meaning (the
 * `.describe()` texts in `@ledger/contract`'s `layout.ts`).
 */
export const LAYOUT_PROMPT = `Below are samples of every sheet of a household's spreadsheet or bank export: each sheet's first rows, a few rows further down, and its last rows. A cell is written COLUMN=value, text in quotes, and {=...} after a value is the formula that computed it.
Describe the file's layout so that a program can read it. Do not return any rows or amounts: return only where things are.
- The account: the sheets that hold one row per movement of the bank account, which column holds each role (date, amount or withdrawal and deposit, running balance, bucket, person, detail, note), whether the rows are listed newest or oldest first, and whether each sheet is one calendar year named by its year.
- Buckets: if a column files each row in a bucket, the text it uses for the mortgage and for current expenses (the shared buffer).
- Carry-overs: the text of rows that carry a bucket's balance from the year before, if there are any. Summary rows above the first movement, if there are any: the column of their label, and what the labels start with.
- Periods: sheets of a period's shared expenses, if there are any: the row naming the people over their amount columns, the row holding the dates, the first line item's row, and the labels of the total and of the amount to deposit.
- Salaries: the sheet and the label of the row holding each person's salary, if there is one.
- Every other sheet, by name, as ignored.
Leave out a role or a part the file does not have. Use the spreadsheet's own column letters and row numbers.`;

/** The whole text sent: the prompt, then the sheets. */
export function layoutRequest(
  sheets: readonly Sheet[],
  options: ViewOptions = DEFAULT_VIEW,
): string {
  return `${LAYOUT_PROMPT}\n\n${layoutView(sheets, options)}`;
}

/**
 * A rough count, four characters a token, for the size of what is sent before
 * anything is sent. The measurement records the API's own count beside it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
