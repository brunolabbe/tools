/**
 * A CSV file as the cell grid `@ledger/books` reads (lg-38), for the bank-CSV
 * fixtures only: a CSV holds text, so a field that is a plain number becomes a
 * number and one written `yyyy-mm-dd` a date, as a spreadsheet would show them.
 * Quoted fields may hold commas and doubled quotes. Nothing else a bank's
 * export might do (a decimal comma, a thousands space) is handled: no real
 * export is read here, and the build of a CSV import is its own ticket.
 */

import type { Cell, Sheet } from "@ledger/books";

function fields(line: string): string[] {
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

const NUMBER = /^-?\d+(\.\d+)?$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function cellOf(text: string): Cell | null {
  const value = text.trim();
  if (value === "") return null;
  if (NUMBER.test(value))
    return { value: { kind: "number", number: Number(value) }, formula: null };
  if (DATE.test(value)) return { value: { kind: "date", date: value }, formula: null };
  return { value: { kind: "text", text: value }, formula: null };
}

/** `text` as one sheet named `name`: row 1 is the file's first line. */
export function csvSheet(name: string, text: string): Sheet {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return { name, rows: lines.map((line) => fields(line).map(cellOf)) };
}
