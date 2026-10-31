/**
 * A bank CSV as the cell grid `@ledger/books` reads (lg-38's reader, moved
 * here from the measurement harness under `test/` by lg-67 so the import
 * screen reads a CSV as the measurement did, and there is one copy: the
 * fixtures import it back).
 *
 * **What it reads is what was measured**: fields separated by commas, a quoted
 * field holding commas and doubled quotes, a field of plain digits (with a dot
 * before any decimals) as a number, one written `yyyy-mm-dd` as a date, and
 * the rest as text. One change from lg-38's reader (lg-67, Decision 6 (a)): a
 * field that starts with a zero followed by a digit stays text, so `007` is
 * the detail `007` and not the number 7. `0.50` is still a number, and an
 * amount written `007.50` is text, which the books report as a problem rather
 * than read as a figure.
 *
 * **What it does not read is refused before anything is sent** (Decision 3
 * (a)), by `refuseUnreadShapes` over whole fields: a semicolon or a tab where a
 * comma delimits, a decimal comma, a thousands separator, a date not written
 * `yyyy-mm-dd`, and bytes that are not UTF-8. Each is `CSV_SHAPE_UNREAD`,
 * naming the shape, never guessed at: lg-66's rule for shapes the measurement
 * did not cover.
 */

import type { Cell, Sheet } from "@ledger/books";
import { AppError } from "@ledger/contract";

function fields(line: string, delimiter = ","): string[] {
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
    else if (char === delimiter) {
      out.push(field);
      field = "";
    } else field += char;
  }
  out.push(field);
  return out;
}

const NUMBER = /^-?\d+(\.\d+)?$/u;
/** Decision 6 (a): `007` stays text; `0.50` does not start with a zero followed by a digit. */
const LEADING_ZERO = /^-?0\d/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function cellOf(text: string): Cell | null {
  const value = text.trim();
  if (value === "") return null;
  if (NUMBER.test(value) && !LEADING_ZERO.test(value))
    return { value: { kind: "number", number: Number(value) }, formula: null };
  if (DATE.test(value)) return { value: { kind: "date", date: value }, formula: null };
  return { value: { kind: "text", text: value }, formula: null };
}

/** The file's lines, row 1 first, without the empty one after a final newline. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * A CSV's bytes as text: a leading byte-order mark dropped, and decoded as
 * UTF-8 only when they are valid UTF-8. Bytes that are not are
 * `CSV_SHAPE_UNREAD`, never decoded as something else: Latin-1 would read any
 * byte, and a guess is how `é` becomes `Ã©` in the books.
 */
export function csvText(bytes: Uint8Array): string {
  try {
    // `ignoreBOM: false` is what drops a leading byte-order mark.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (cause: unknown) {
    throw notUtf8(cause);
  }
}

function notUtf8(cause?: unknown): AppError {
  return new AppError(
    "CSV_SHAPE_UNREAD",
    "That CSV is not in UTF-8: its letters are in another encoding (Latin-1, Windows-1252 or UTF-16, say), and this import reads only UTF-8. Export it again in UTF-8, or save it as an Excel workbook (.xlsx), and choose it again. Nothing was sent.",
    { details: { shapes: ["encoding"] }, ...(cause === undefined ? {} : { cause }) },
  );
}

/**
 * `text`, or a CSV's bytes, as one sheet named `name`: row 1 is the file's
 * first line. A leading byte-order mark is dropped either way, so a file saved
 * with one reads as the same sheet as without it.
 */
export function csvSheet(name: string, input: string | Uint8Array): Sheet {
  const text = typeof input === "string" ? input.replace(/^\uFEFF/u, "") : csvText(input);
  return { name, rows: linesOf(text).map((line) => fields(line).map(cellOf)) };
}

/**
 * Whether bytes that are not a workbook could be a CSV (lg-67, Build 2): no
 * NUL byte, and a line holding a comma, a semicolon or a tab. Any line rather
 * than the first: `bank-preamble`, one of the seven measured CSVs, opens with
 * a title line holding none. A UTF-16 file, which holds NUL bytes, is told by
 * its byte-order mark and refused as the encoding it is, not as "not a CSV".
 */
export function isCsvCandidate(bytes: Uint8Array): boolean {
  const [first, second] = bytes;
  if ((first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff)) {
    throw notUtf8();
  }
  if (bytes.includes(0)) return false;
  return bytes.includes(0x2c) || bytes.includes(0x3b) || bytes.includes(0x09);
}

// --- The shapes the reader does not read (Decision 3 (a)) ---

/** A shape the reader does not read, as `details.shapes` names it. */
export type CsvShape = "semicolon" | "tab" | "decimal-comma" | "thousands" | "date" | "encoding";

const MONTH =
  "(?:jan|janv|feb|fev|fév|févr|mar|mars|apr|avr|may|mai|jun|juin|jul|juil|aug|aou|aoû|sep|sept|oct|nov|dec|déc)[a-zéû]*\\.?";

/** Whole-field patterns, each tested on a field's trimmed text. */
const UNREAD: readonly { shape: CsvShape; pattern: RegExp }[] = [
  // 31/01/2024, 01-31-24, 31.01.2024; 2024/01/31; 2024-1-31; a date with a time.
  { shape: "date", pattern: /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/u },
  { shape: "date", pattern: /^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/u },
  { shape: "date", pattern: /^\d{4}-(?:\d-\d{1,2}|\d{2}-\d)$/u },
  { shape: "date", pattern: /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/u },
  // 31 janv. 2024, 31-Jan-24; Jan 31, 2024.
  { shape: "date", pattern: new RegExp(`^\\d{1,2}[ -]${MONTH}[ -]\\d{2,4}$`, "iu") },
  { shape: "date", pattern: new RegExp(`^${MONTH} \\d{1,2},? \\d{4}$`, "iu") },
  // 1,823.45; 1 823,45 (a space, a no-break space or a narrow one); 1'823.45; 1.823,45.
  { shape: "thousands", pattern: /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u },
  { shape: "thousands", pattern: /^[-+]?\d{1,3}(?:[ \u00a0\u202f'’]\d{3})+(?:[.,]\d+)?$/u },
  { shape: "thousands", pattern: /^[-+]?\d{1,3}(?:\.\d{3})+,\d+$/u },
  // 1823,45; 1.823,45 is a decimal comma too.
  { shape: "decimal-comma", pattern: /^[-+]?\d+,\d{1,2}$/u },
  { shape: "decimal-comma", pattern: /^[-+]?\d{1,3}(?:\.\d{3})+,\d+$/u },
];

const DELIMITERS = [",", ";", "\t"] as const;

/** How many times each delimiter appears in `line` outside quotes. */
function delimiterCounts(line: string): Record<(typeof DELIMITERS)[number], number> {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "," || char === ";" || char === "\t")) counts[char] += 1;
  }
  return counts;
}

/**
 * The delimiter most of the file's lines split on: each line votes for the one
 * it holds most of outside quotes, a comma winning a tie. A semicolon file with
 * decimal commas holds commas on every row too, and still more semicolons.
 */
function delimiterOf(lines: readonly string[]): (typeof DELIMITERS)[number] {
  const votes = { ",": 0, ";": 0, "\t": 0 };
  for (const line of lines) {
    const counts = delimiterCounts(line);
    const most = Math.max(counts[","], counts[";"], counts["\t"]);
    if (most === 0) continue;
    const winner = DELIMITERS.find((delimiter) => counts[delimiter] === most) ?? ",";
    votes[winner] += 1;
  }
  return DELIMITERS.reduce((best, delimiter) =>
    votes[delimiter] > votes[best] ? delimiter : best,
  );
}

/** One shape found: where first, and the field that showed it. */
export interface UnreadShape {
  shape: CsvShape;
  /** The line it was first found on, the first being 1; 0 for the delimiter, which is the file's. */
  line: number;
  field: string;
}

/** Every shape `text` is written in that the reader does not read, each where it is first found. */
export function unreadShapes(text: string): UnreadShape[] {
  const lines = linesOf(text.replace(/^\uFEFF/u, ""));
  const found: UnreadShape[] = [];
  const delimiter = delimiterOf(lines);
  if (delimiter === ";") found.push({ shape: "semicolon", line: 0, field: ";" });
  if (delimiter === "\t") found.push({ shape: "tab", line: 0, field: "\t" });
  for (const [index, line] of lines.entries()) {
    for (const raw of fields(line, delimiter)) {
      const field = raw.trim();
      for (const { shape, pattern } of UNREAD) {
        if (found.some((entry) => entry.shape === shape) || !pattern.test(field)) continue;
        found.push({ shape, line: index + 1, field });
      }
    }
  }
  return found;
}

/** A field as the message quotes it: cut, so a long detail does not fill the sentence. */
function quotedField(field: string): string {
  return JSON.stringify(field.length > 24 ? `${field.slice(0, 24)}…` : field);
}

function said(entry: UnreadShape): string {
  const at = `line ${String(entry.line)} holds ${quotedField(entry.field)}`;
  switch (entry.shape) {
    case "semicolon":
      return "its fields are separated by semicolons, not commas";
    case "tab":
      return "its fields are separated by tabs, not commas";
    case "decimal-comma":
      return `a figure has a comma before its cents (${at})`;
    case "thousands":
      return `a figure has a thousands separator (${at})`;
    case "date":
      return `a date is not written year-month-day, as 2024-01-31 (${at})`;
    case "encoding":
      return "it is not in UTF-8";
  }
}

/**
 * `CSV_SHAPE_UNREAD`, naming every shape found, when `text` holds any. The
 * patterns look at whole fields, so a field that only looks like one (a
 * detail that is `12,50` and means something else) refuses a good file, and
 * the message says that too.
 */
export function refuseUnreadShapes(text: string): void {
  const found = unreadShapes(text);
  if (found.length === 0) return;
  const listed = found.map(said);
  const quoted = found.find((entry) => entry.line > 0);
  throw new AppError(
    "CSV_SHAPE_UNREAD",
    `That CSV is written in a way this import does not read: ${listed.join("; ")}. It reads a file with its fields separated by commas, a dot before the cents, no thousands separator, and dates written 2024-01-31, in UTF-8. Export it again that way, or save it as an Excel workbook (.xlsx), and choose it again. Nothing was sent.${quoted === undefined ? "" : ` The check reads each field whole: if ${quotedField(quoted.field)} is not what it was taken for, the check has refused a good file, and saving it as an .xlsx workbook goes around it.`}`,
    {
      details: {
        shapes: found.map((entry) => entry.shape),
        lines: found.map((entry) => entry.line),
      },
    },
  );
}
