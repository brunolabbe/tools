/**
 * `parseStatement` — an AccèsD transaction paste in, proven rows out.
 *
 * The shape is in `00-ANALYSIS.md` §2. Three things in it are traps for a
 * parser written from a guess, and each is handled here on purpose:
 *
 * - **The year is only in the month header**, so a row's date is built from the
 *   section it sits in.
 * - **Rows are listed newest first, same-day rows included**, so the order of a
 *   row's neighbours is the only thing that says which came first. `seq` is
 *   taken from that listed order and the parser never sorts by date.
 * - **The minus is U+2212**, which `Number()` reads as `NaN`.
 *
 * The paste carries up to four proofs of its own completeness — the running
 * balance, the month totals, the echo line and, when the page's footer is
 * pasted too, its count of months — and a paste that fails any one is
 * refused whole, with the row named. It is never imported "mostly". Nor is
 * anything skipped: a line this parser does not recognise is an error carrying
 * its line number, because a skipped line is a row that is simply absent from
 * the books.
 *
 * Pure: no database, no network, no clock.
 */

import { AppError, type ErrorCode } from "@ledger/contract";
import { formatCents, parseAmountCents } from "./amount.ts";
import { daysInMonth, fold, monthFromAbbreviation, monthFromName } from "./months.ts";

export interface StatementRow {
  /** `yyyy-mm-dd`, built from the month header's year. */
  date: string;
  /** Desjardins' own category, e.g. `Virements`. */
  category: string;
  description: string;
  /** Negative for money out. */
  amountCents: number;
  /** The account's balance after this row. */
  balanceCents: number;
  /**
   * Position in the paste's history, oldest = 0, taken from the listed order and
   * never from sorting by date. A caller chaining this paste onto stored rows
   * offsets it by what is already there; the parser cannot know that.
   */
  seq: number;
}

export interface ParsedStatement {
  /** Oldest first, so `rows[n].seq === n`. */
  rows: StatementRow[];
}

/** `12 SEP12 Septembre`: day, abbreviation glued to the day again, month name. */
const DATE_LINE = /^(\d{1,2})\s+(\p{L}+)(\d{1,2})\s+(\p{L}+)$/u;
/** Where a row can start; anything else at the top level must be a known line. */
const ROW_START = /^\d{1,2}\s/u;
const MONTH_HEADER = /^(\p{L}+)\s+(\d{4})$/u;
/**
 * One `\s`, not `\s+`: `.+` matches whitespace too, and two adjacent
 * quantifiers that can trade the same run make a failed match quadratic.
 * `parseAmountCents` trims whatever whitespace the capture keeps.
 */
const TOTAL_LINE = /^Total\s(.+)$/iu;
/**
 * `amount⇥balance⇥` — split on the `$` that ends each, never on the tab. No
 * `\s*` between the two: `[^$]*` already takes the tab, and the two together
 * made a failed match quadratic, as `TOTAL_LINE`'s would be.
 */
const AMOUNT_BALANCE_LINE = /^([^$]*\$)([^$]*\$)$/u;
const COLUMN_HEADER = ["DATE", "DESCRIPTION", "MONTANT", "SOLDE"];
/**
 * What a month with no rows says instead, directly under its header. It closes
 * the month the way a `Total` would, so nothing may follow it there.
 */
const NO_TRANSACTIONS = "AUCUNE TRANSACTION";
/** `3 mois sur 12`: how many months the page shows, out of how many it has. Folded. */
const FOOTER_LINE = /^(\d+) MOIS SUR (\d+)$/u;

/** A row as listed, with where it came from, until the chain has been proven. */
interface Listed {
  row: Omit<StatementRow, "seq">;
  line: number;
}

interface Month {
  year: number;
  month: number;
  headerLine: number;
  sumCents: number;
  rows: number;
  /** Set by its `Total` or by `Aucune transaction`: either closes the month. */
  totalSeen: boolean;
}

function fail(code: ErrorCode, message: string, details: Record<string, unknown>): never {
  throw new AppError(code, message, { details });
}

function unrecognised(line: number, text: string, why: string): never {
  const shown = text.trim().length > 80 ? `${text.trim().slice(0, 80)}…` : text.trim();
  return fail(
    "STATEMENT_UNRECOGNIZED_LINE",
    `Line ${line} of the paste was not recognised (${why}): "${shown}".`,
    { line, why },
  );
}

/** Any run of whitespace — NBSP and NNBSP included — as one space. */
function squash(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function isColumnHeader(line: string): boolean {
  const words = fold(line).split(/\s+/u);
  const head = words.slice(0, COLUMN_HEADER.length);
  return (
    head.join(" ") === COLUMN_HEADER.join(" ") &&
    (words.length === COLUMN_HEADER.length ||
      (words.length === COLUMN_HEADER.length + 1 && words[COLUMN_HEADER.length] === "LIEN"))
  );
}

function monthKey(month: Month): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

/** A month must end in a `Total` line; one that does not is a truncated paste. */
function requireTotal(month: Month | null): void {
  if (month === null || month.totalSeen) return;
  fail(
    "STATEMENT_TOTAL_MISMATCH",
    `The month ${monthKey(month)} (line ${month.headerLine}) has no Total line, so its rows cannot be checked.`,
    { line: month.headerLine, month: monthKey(month), totalCents: null, sumCents: month.sumCents },
  );
}

export function parseStatement(text: string): ParsedStatement {
  const lines = text.replace(/^﻿/u, "").split(/\r\n|\r|\n/u);
  // Past the end reads as an empty line, which no row accepts in a content slot.
  const at = (index: number): string => lines[index] ?? "";

  const listed: Listed[] = [];
  let month: Month | null = null;
  let months = 0;
  let index = 0;

  while (index < lines.length) {
    const line = at(index).trim();
    const lineNo = index + 1;

    if (line === "" || isColumnHeader(line)) {
      index += 1;
      continue;
    }

    const header = MONTH_HEADER.exec(line);
    if (header) {
      const number = monthFromName(header[1] ?? "");
      if (number === null) unrecognised(lineNo, line, "not a month name");
      requireTotal(month);
      month = {
        year: Number(header[2]),
        month: number,
        headerLine: lineNo,
        sumCents: 0,
        rows: 0,
        totalSeen: false,
      };
      months += 1;
      index += 1;
      continue;
    }

    const total = TOTAL_LINE.exec(line);
    if (total) {
      const totalCents = parseAmountCents(total[1] ?? "");
      if (totalCents === null) unrecognised(lineNo, line, "the Total is not an amount");
      if (month === null || month.totalSeen) unrecognised(lineNo, line, "a Total with no month");
      if (totalCents !== month.sumCents) {
        fail(
          "STATEMENT_TOTAL_MISMATCH",
          `The Total of ${monthKey(month)} on line ${lineNo} is ${formatCents(totalCents)}, but its rows add up to ${formatCents(month.sumCents)}.`,
          {
            line: lineNo,
            month: monthKey(month),
            totalCents,
            sumCents: month.sumCents,
            differenceCents: totalCents - month.sumCents,
          },
        );
      }
      month.totalSeen = true;
      index += 1;
      continue;
    }

    const folded = fold(squash(line));
    if (folded === NO_TRANSACTIONS) {
      if (month === null || month.totalSeen)
        unrecognised(lineNo, line, "a month with no rows, outside any month");
      if (month.rows > 0)
        unrecognised(lineNo, line, "a month with no rows, in a month that has some");
      month.totalSeen = true;
      index += 1;
      continue;
    }

    // Checked before a row, which also starts with a number.
    const footer = FOOTER_LINE.exec(folded);
    if (footer) {
      const shown = Number(footer[1]);
      const available = Number(footer[2]);
      if (lines.slice(index + 1).some((rest) => rest.trim() !== "")) {
        unrecognised(lineNo, line, "the month count is not the last line");
      }
      if (shown > available) unrecognised(lineNo, line, "more months shown than there are");
      requireTotal(month);
      if (shown !== months) {
        fail(
          "STATEMENT_MONTH_COUNT_MISMATCH",
          `Line ${lineNo} says the page shows ${shown} months, but the paste has ${months}: paste from the first month header to this line.`,
          { line: lineNo, shownMonths: shown, pastedMonths: months },
        );
      }
      break;
    }

    if (!ROW_START.test(line)) unrecognised(lineNo, line, "not a row, a header or a total");
    if (month === null || month.totalSeen) {
      unrecognised(lineNo, line, "a row outside any month");
    }
    if (index + 5 >= lines.length) {
      unrecognised(lineNo, line, "the paste ends before this row is complete");
    }

    // Line 1 of 6: the date.
    const date = DATE_LINE.exec(line);
    if (!date) unrecognised(lineNo, line, "not a date line");
    const day = Number(date[1]);
    const fromAbbreviation = monthFromAbbreviation(date[2] ?? "");
    const fromName = monthFromName(date[4] ?? "");
    if (fromAbbreviation === null) unrecognised(lineNo, line, "unknown month abbreviation");
    if (fromName === null) unrecognised(lineNo, line, "unknown month name");
    if (fromAbbreviation !== fromName || fromName !== month.month || Number(date[3]) !== day) {
      unrecognised(lineNo, line, "the date does not agree with itself or with its month header");
    }
    if (day < 1 || day > daysInMonth(month.year, month.month)) {
      unrecognised(lineNo, line, "no such day in that month");
    }
    const iso = `${monthKey(month)}-${String(day).padStart(2, "0")}`;

    // Lines 2 and 3: Desjardins' category, then the description.
    const category = at(index + 1).trim();
    if (category === "") unrecognised(lineNo + 1, at(index + 1), "an empty category");
    const description = at(index + 2).trim();
    if (description === "") unrecognised(lineNo + 2, at(index + 2), "an empty description");

    // Line 4: blank.
    if (at(index + 3).trim() !== "") {
      unrecognised(lineNo + 3, at(index + 3), "expected a blank line");
    }

    // Line 5: amount and balance.
    const money = AMOUNT_BALANCE_LINE.exec(at(index + 4).trim());
    const amountCents = money ? parseAmountCents(money[1] ?? "") : null;
    const balanceCents = money ? parseAmountCents(money[2] ?? "") : null;
    if (amountCents === null || balanceCents === null) {
      unrecognised(lineNo + 4, at(index + 4), "expected an amount and a balance");
    }

    // Line 6: the echo, which has to repeat this row's date, description and amount.
    const echoLine = at(index + 5);
    const echoPrefix = `${squash(`${date[1]} ${date[4]}`)} ${squash(description)} `;
    const echo = squash(echoLine);
    const echoedAmount = echo.startsWith(echoPrefix)
      ? parseAmountCents(echo.slice(echoPrefix.length))
      : null;
    if (echoedAmount !== amountCents) {
      fail(
        "STATEMENT_ECHO_MISMATCH",
        `The row of ${iso} "${description}" at line ${lineNo} is not repeated on line ${lineNo + 5}, where "${echo}" was found.`,
        { line: lineNo, echoLine: lineNo + 5, date: iso, description, amountCents },
      );
    }

    month.sumCents += amountCents;
    month.rows += 1;
    listed.push({
      row: { date: iso, category, description, amountCents, balanceCents },
      line: lineNo,
    });
    index += 6;
  }
  requireTotal(month);

  // The paste is newest first; the history is oldest first.
  const chronological = listed.toReversed();
  const rows: StatementRow[] = [];
  for (const [seq, { row, line }] of chronological.entries()) {
    const previous = rows[seq - 1];
    if (previous !== undefined) {
      const expected = previous.balanceCents + row.amountCents;
      if (row.balanceCents !== expected) {
        fail(
          "STATEMENT_CHAIN_BROKEN",
          `The balance of the row of ${row.date} "${row.description}" at line ${line} is ${formatCents(row.balanceCents)}, but the row before it left ${formatCents(previous.balanceCents)} and this one moves ${formatCents(row.amountCents)}: ${formatCents(row.balanceCents - expected)} is unexplained.`,
          {
            line,
            seq,
            date: row.date,
            description: row.description,
            amountCents: row.amountCents,
            balanceCents: row.balanceCents,
            previousBalanceCents: previous.balanceCents,
            expectedBalanceCents: expected,
            unexplainedCents: row.balanceCents - expected,
          },
        );
      }
    }
    rows.push({ ...row, seq });
  }
  return { rows };
}
