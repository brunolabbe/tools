/**
 * The rule a paste and the workbook import share for the workbook's rows
 * (lg-40): day by day, never by wording, the order within a day free. Every
 * amount and balance here is invented.
 */

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import type { ImportStatementReport } from "@ledger/contract";
import { migrate } from "../src/db/schema.ts";
import { importStatement } from "../src/statements.ts";
import {
  LONGEST_SEARCHED_DAY,
  RIVAL_DAYS_OFF,
  RIVAL_TOLERANCE,
  STORED_TOLERANCE,
  WIDEST_BLOCK_DAYS,
  alignDays,
  dayBefore,
  dayRuns,
  matchBlock,
  matchDay,
  matchPart,
  matchStretch,
} from "../src/workbook-days.ts";
import type { DayEntry, StretchRow } from "../src/workbook-days.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";
import type { PasteRow } from "./helpers/paste.ts";

/** Rows on one date from an opening balance, each with the balance after it. */
function day(date: string, opening: number, amounts: readonly number[]): DayEntry[] {
  let balance = opening;
  return amounts.map((amountCents) => {
    balance += amountCents;
    return { date, amountCents, balanceCents: balance };
  });
}

describe("dayBefore", () => {
  test.each([
    ["2026-03-10", "2026-03-09"],
    ["2026-03-01", "2026-02-28"],
    ["2024-03-01", "2024-02-29"],
    ["2026-01-01", "2025-12-31"],
  ])("the day before %s is %s", (date, before) => {
    expect(dayBefore(date)).toBe(before);
  });
});

describe("dayRuns", () => {
  test("cuts rows into stretches of one date, wherever a date returns", () => {
    const dates = ["2026-03-01", "2026-03-01", "2026-03-02", "2026-03-01"].map((date) => ({
      date,
    }));

    expect(dayRuns(dates)).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(dayRuns([])).toEqual([]);
  });
});

describe("matchDay: a whole day against the bank's rows in its place", () => {
  const workbook = day("2026-03-01", 100_000, [10_000, 5_000, -20_000]);
  const bank = day("2026-03-01", 100_000, [-20_000, 10_000, 5_000]);

  test("the same amounts in another order, ending on the same balance, pair each row with its own", () => {
    expect(matchDay(workbook, bank, "a day either side")).toEqual([1, 2, 0]);
  });

  test("amounts that differ by one row are refused, though the day ends on the same balance", () => {
    const other = day("2026-03-01", 100_000, [-20_000, 9_000, 6_000]);

    expect(matchDay(workbook, other, "a day either side")).toBeNull();
  });

  test("a day ending elsewhere is refused", () => {
    expect(
      matchDay(workbook, day("2026-03-01", 100_100, [-20_000, 10_000, 5_000]), "any"),
    ).toBeNull();
  });

  test("a paste allows a day either side and no more; the import allows any", () => {
    const later = bank.map((row) => ({ ...row, date: "2026-03-02" }));
    const twoDays = bank.map((row) => ({ ...row, date: "2026-03-03" }));

    expect(matchDay(workbook, later, "a day either side")).not.toBeNull();
    expect(matchDay(workbook, twoDays, "a day either side")).toBeNull();
    expect(matchDay(workbook, twoDays, "any")).not.toBeNull();
  });
});

describe("matchPart: some of a day's rows, as the bank lists them, against the whole day", () => {
  // The workbook lists the day +10.00, +0.50, −3.00, +0.70; the bank, −3.00,
  // +10.00, +0.70, +0.50. Both open from 1 000.00 and close on 1 008.20.
  const run = day("2026-03-05", 100_000, [1_000, 50, -300, 70]);
  const bank = day("2026-03-05", 100_000, [-300, 1_000, 70, 50]);

  test("the bank's first rows open from the day's opening balance", () => {
    expect(matchPart(run, 0, bank.slice(0, 2), "a day either side")).toBe(true);
    expect(matchPart(run, 0, bank.slice(1, 3), "a day either side")).toBe(false);
  });

  test("the bank's last rows close on the day's closing balance", () => {
    expect(matchPart(run, 2, bank.slice(2), "a day either side")).toBe(true);
    expect(matchPart(run, 1, bank.slice(1), "a day either side")).toBe(true);
    // Taken as the last two when they are the middle two: they close elsewhere.
    expect(matchPart(run, 2, bank.slice(1, 3), "a day either side")).toBe(false);
  });

  test("rows from the middle open where some of the day's other amounts, as many as came before, reach", () => {
    // One row came first, and 997.00, where these open, is 1 000.00 and −3.00.
    expect(matchPart(run, 1, bank.slice(1, 3), "a day either side")).toBe(true);
    // The same rows said to come after two others: no two of the rest reach 997.00.
    expect(matchPart(run, 2, bank.slice(1, 2), "a day either side")).toBe(false);
  });

  test("a pasted amount the day does not hold is refused wherever it is placed", () => {
    const stranger = day("2026-03-05", 99_700, [999]);

    for (const before of [0, 1, 2, 3]) {
      expect(matchPart(run, before, stranger, "any")).toBe(false);
    }
  });

  test("the part must fit inside the day, and is dated within the window", () => {
    expect(matchPart(run, 3, bank.slice(2), "any")).toBe(false);
    const late = bank.slice(2).map((row) => ({ ...row, date: "2026-03-07" }));
    expect(matchPart(run, 2, late, "a day either side")).toBe(false);
    expect(matchPart(run, 2, late, "any")).toBe(true);
  });

  test("a day longer than the search allows admits no part that starts and ends inside it", () => {
    const amounts = Array.from({ length: LONGEST_SEARCHED_DAY + 1 }, (_, index) => 100 + index);
    const long = day("2026-03-05", 100_000, amounts);
    const middle = long.slice(1, 2);

    expect(matchPart(long, 1, middle, "any")).toBe(false);
    // Its first and last rows are still weighed, since they need no search.
    expect(matchPart(long, 0, long.slice(0, 1), "any")).toBe(true);
    expect(matchPart(long, amounts.length - 1, long.slice(-1), "any")).toBe(true);
  });
});

describe("alignDays: a stretch of whole days, as the workbook import compares", () => {
  test("pairs each workbook row with its bank row, day by day", () => {
    const workbook = [
      ...day("2026-03-01", 100_000, [10_000, 5_000, -20_000]),
      ...day("2026-03-02", 95_000, [-1_000]),
    ];
    const bank = [
      ...day("2026-03-01", 100_000, [-20_000, 10_000, 5_000]),
      ...day("2026-03-02", 95_000, [-1_000]),
    ];

    expect(alignDays(workbook, bank, "any")).toEqual([1, 2, 0, 3]);
    expect(alignDays(workbook, bank.slice(1), "any")).toBeNull();
  });
});

describe("matchPart: the longest day that is searched (F7)", () => {
  test("a day of exactly the longest the search allows admits a part that starts and ends inside it", () => {
    const amounts = Array.from({ length: LONGEST_SEARCHED_DAY }, (_, index) => 100 + index);
    const exact = day("2026-03-05", 100_000, amounts);

    // The same part as the one a day a row longer refuses, above.
    expect(matchPart(exact, 1, exact.slice(1, 2), "any")).toBe(true);
    expect(matchPart(exact, 5, exact.slice(5, 9), "any")).toBe(true);
  });
});

// lg-59: a paste reads the workbook's day as a block whose dates are up to two
// days apart, so a day the workbook both re-dated and reordered matches.

/** Rows with their own dates from an opening balance, each with the balance after it. */
function dated(opening: number, rows: readonly [string, number][]): DayEntry[] {
  let balance = opening;
  return rows.map(([date, amountCents]) => {
    balance += amountCents;
    return { date, amountCents, balanceCents: balance };
  });
}

// The reduced case of lg-59's Build step 1: the bank's 21 February is −5.00,
// −10.00, +10.00, and the workbook lists it −10.00 on the 21st, −5.00 on the
// 20th, +10.00 on the 21st. Both open from 1 000.00 and close on 995.00.
const REDATED: [string, number][] = [
  ["2026-02-21", -1_000],
  ["2026-02-20", -500],
  ["2026-02-21", 1_000],
];
const BANKS_DAY: [string, number][] = [
  ["2026-02-21", -500],
  ["2026-02-21", -1_000],
  ["2026-02-21", 1_000],
];

describe("matchBlock: a block of the workbook's rows a paste reads as one day (lg-59)", () => {
  const block = dated(100_000, REDATED);
  const bank = dated(100_000, BANKS_DAY);

  test("a day the workbook both re-dated and reordered is the bank's day, though cut on its dates it is three", () => {
    expect(dayRuns(block)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(matchBlock(block, 0, bank)).toBe(true);
    expect(matchBlock(block, 1, bank.slice(1))).toBe(true);
  });

  test("each bank row is dated within a day of the block's dates, and no further", () => {
    const early = bank.map((row) => ({ ...row, date: "2026-02-19" }));
    const late = bank.map((row) => ({ ...row, date: "2026-02-22" }));
    const twoDaysLate = bank.map((row) => ({ ...row, date: "2026-02-23" }));

    expect(matchBlock(block, 0, early)).toBe(true);
    expect(matchBlock(block, 0, late)).toBe(true);
    expect(matchBlock(block, 0, twoDaysLate)).toBe(false);
  });

  test(`a block's dates are at most ${String(WIDEST_BLOCK_DAYS)} days apart`, () => {
    const widest = dated(100_000, [
      ["2026-02-20", -500],
      ["2026-02-22", -1_000],
      ["2026-02-21", 1_000],
    ]);
    const wider = dated(100_000, [
      ["2026-02-20", -500],
      ["2026-02-23", -1_000],
      ["2026-02-21", 1_000],
    ]);
    const anyDay = bank.map((row) => ({ ...row, date: "2026-02-21" }));

    expect(matchBlock(widest, 0, anyDay)).toBe(true);
    expect(matchBlock(wider, 0, anyDay)).toBe(false);
  });
});

describe("matchStretch: stored rows against pasted rows, a block at a time (lg-59)", () => {
  const workbook: StretchRow[] = dated(100_000, REDATED).map((row) => ({
    ...row,
    fromWorkbook: true,
  }));
  const bank = dated(100_000, BANKS_DAY);

  test("a stretch starting partway through the block is weighed against the whole block", () => {
    expect(matchStretch(workbook, 1, bank.slice(1), () => true)).toBe(true);
    expect(matchStretch(workbook, 0, bank, () => true)).toBe(true);
    // The same rows said to be the stretch's first two: they open elsewhere.
    expect(matchStretch(workbook, 0, bank.slice(1).concat(bank[0] as DayEntry), () => true)).toBe(
      false,
    );
  });

  test("a row a paste stored is its own block, compared by the caller", () => {
    const pasteRow: StretchRow = {
      date: "2026-02-22",
      amountCents: -500,
      balanceCents: 99_000,
      fromWorkbook: false,
    };
    const rows = [...workbook, pasteRow];
    const pasted = [
      ...bank.slice(1),
      { date: "2026-02-22", amountCents: -500, balanceCents: 99_000 },
    ];

    expect(matchStretch(rows, 1, pasted, (offset) => offset === 2)).toBe(true);
    expect(matchStretch(rows, 1, pasted, () => false)).toBe(false);
  });
});

/** A database holding these rows as the workbook import stores them, from 1 000.00. */
function workbookDb(rows: readonly [string, number][]): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  const batch = db
    .prepare(
      "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
    )
    .run("2026-10-01T09:00:00Z", "alex");
  const insert = db.prepare(
    `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
     VALUES (?, ?, '', ?, ?, ?, ?)`,
  );
  for (const [seq, row] of dated(100_000, rows).entries()) {
    insert.run(
      seq,
      row.date,
      `Ligne ${String(seq)}`,
      row.amountCents,
      row.balanceCents,
      batch.lastInsertRowid,
    );
  }
  return db;
}

function storedRows(db: Database.Database): unknown[] {
  return db.prepare("SELECT * FROM statement_rows ORDER BY seq").all();
}

function paste(
  db: Database.Database,
  rows: readonly PasteRow[],
  opening: number,
): ImportStatementReport {
  return importStatement(
    { db, personId: "alex", now: () => new Date("2026-10-18T09:00:00Z") },
    renderPaste(withBalances(rows, opening)),
  );
}

function bankRows(rows: readonly [string, number][]): PasteRow[] {
  return rows.map(([date, amountCents], index) => ({
    date,
    description: `Virement /Caisse ${String(index)}`,
    amountCents,
  }));
}

/** What a paste came to: its report, or the refusal's code, message and details. */
function outcome(run: () => unknown): unknown {
  try {
    return run();
  } catch (error: unknown) {
    if (!(error instanceof AppError)) throw error;
    return { code: error.code, message: error.message, details: error.details };
  }
}

describe("a paste meeting a day the workbook both re-dated and reordered (lg-59)", () => {
  test("the reduced case: the true reading, or refused as two ways, and the workbook's rows as they were", () => {
    const db = workbookDb(REDATED);
    const before = storedRows(db);
    // The bank's last two rows of the day and one new row, opening from 995.00.
    // The truth is two rows already stored and one new.
    const rows = bankRows([...BANKS_DAY.slice(1), ["2026-02-22", -500]]);

    const result = outcome(() => paste(db, rows, 99_500));

    const truth = { rowsAdded: 1, rowsAlreadyPresent: 2, tailBalanceCents: 99_000, rowsInInbox: 1 };
    if ("rowsAdded" in (result as object)) {
      expect(result).toEqual(truth);
      expect(storedRows(db).slice(0, 3)).toEqual(before);
    } else {
      expect(result).toMatchObject({ code: "STATEMENT_ROW_CONFLICT" });
      expect((result as { message: string }).message).toContain("two ways");
      expect(storedRows(db)).toEqual(before);
    }
  });

  test("a reading only the block makes possible counts like any other, so two readings are refused", () => {
    const db = workbookDb(REDATED);
    const before = storedRows(db);
    const rows = bankRows([...BANKS_DAY.slice(1), ["2026-02-22", -500]]);

    const result = outcome(() => paste(db, rows, 99_500));

    // Two stored is the block's reading: cut on the workbook's dates, the day is
    // three runs and the last, +10.00, cannot be −10.00 and +10.00. None stored is
    // the continuation, since −10.00 and +10.00 leave the tail's 995.00 where it was.
    expect(result).toMatchObject({
      code: "STATEMENT_ROW_CONFLICT",
      details: {
        readings: [
          { rowsAdded: 1, rowsAlreadyPresent: 2 },
          { rowsAdded: 3, rowsAlreadyPresent: 0 },
        ],
      },
    });
    expect((result as { message: string }).message).toContain("two ways");
    expect(storedRows(db)).toEqual(before);
  });

  test("with amounts that do not cancel, the one reading is the true one: the new row stored, the workbook's kept", () => {
    // The bank's 21st is −12.34, +56.00, −7.77; the workbook lists −7.77 on the
    // 21st, −12.34 on the 20th, +56.00 on the 21st. Then the bank's +25.00 on the 22nd.
    const db = workbookDb([
      ["2026-02-21", -777],
      ["2026-02-20", -1_234],
      ["2026-02-21", 5_600],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-21", -1_234],
      ["2026-02-21", 5_600],
      ["2026-02-21", -777],
      ["2026-02-22", 2_500],
    ]);

    expect(paste(db, rows, 100_000)).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 3,
      tailBalanceCents: 106_089,
      rowsInInbox: 1,
    });
    const after = storedRows(db);
    expect(after.slice(0, 3)).toEqual(before);
    expect(after[3]).toMatchObject({
      seq: 3,
      date: "2026-02-22",
      description: "Virement /Caisse 3",
      amount_cents: 2_500,
      balance_cents: 106_089,
    });
  });

  test("a pasted row two days from every date of its block is refused, and nothing is stored", () => {
    const db = workbookDb([
      ["2026-02-21", -777],
      ["2026-02-20", -1_234],
      ["2026-02-21", 5_600],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-21", -1_234],
      ["2026-02-21", 5_600],
      ["2026-02-23", -777],
      ["2026-02-24", 2_500],
    ]);

    expect(outcome(() => paste(db, rows, 100_000))).toMatchObject({
      code: "STATEMENT_CHAIN_BROKEN",
    });
    expect(storedRows(db)).toEqual(before);
  });
});

// lg-59 gate 1. F1: two of the bank's days the workbook dates alike where they
// meet, so no change of the workbook's date cuts them apart. F3: what no test
// reached before.

/** Workbook rows for `matchStretch`, from 1 000.00. */
function stretchRows(rows: readonly [string, number][]): StretchRow[] {
  return dated(100_000, rows).map((row) => ({ ...row, fromWorkbook: true }));
}

describe("matchStretch: a cut where the bank's day ends (lg-59, gate 1 F1)", () => {
  // The workbook lists +10.00 on the 20th, −5.00 and +3.00 on the 22nd, −1.00 on
  // the 24th. The bank lists −5.00, +10.00, then −1.00, +3.00: each pair is one
  // of its days, and the workbook dates the rows where the two meet the 22nd.
  const workbook = stretchRows([
    ["2026-02-20", 1_000],
    ["2026-02-22", -500],
    ["2026-02-22", 300],
    ["2026-02-24", -100],
  ]);
  const bank = (first: string, second: string): DayEntry[] =>
    dated(100_000, [
      [first, -500],
      [first, 1_000],
      [second, -100],
      [second, 300],
    ]);

  test("between two rows of one date, a block may end where the bank's date changes", () => {
    expect(matchStretch(workbook, 0, bank("2026-02-21", "2026-02-23"), () => true)).toBe(true);
  });

  test("and nowhere else inside a run of one date", () => {
    // The bank's rows all on the 22nd: none of its days ends between them.
    expect(matchStretch(workbook, 0, bank("2026-02-22", "2026-02-22"), () => true)).toBe(false);
  });
});

describe("matchStretch: blocks wholly outside the stretch are not weighed (lg-59, gate 1 F3)", () => {
  test("a row next to the stretch that no block holding the stretch can take in is left out", () => {
    // The 19th and the 23rd are four days apart, so no block holds both, and the
    // 19th cannot join the stretch's block without the 23rd between them.
    const rows = stretchRows([
      ["2026-02-19", 100],
      ["2026-02-23", 200],
      ["2026-02-21", 300],
    ]);
    const pasted = dated(100_300, [["2026-02-21", 300]]);

    expect(matchStretch(rows, 2, pasted, () => true)).toBe(true);
  });
});

describe("a paste meeting the workbook's days, at the edges of the rule (lg-59, gate 1)", () => {
  test("R7: two bank days the workbook dates alike where they meet are not stored twice", () => {
    // The bank: 20th −10.00, +10.00; 21st −10.00, +10.00; 22nd +10.00. The
    // workbook holds the first four, listed +10.00 on the 19th, −10.00 on the
    // 20th, +10.00 on the 20th, −10.00 on the 22nd. The paste is the bank's last
    // four rows from 990.00: three already stored, one new.
    const db = workbookDb([
      ["2026-02-19", 1_000],
      ["2026-02-20", -1_000],
      ["2026-02-20", 1_000],
      ["2026-02-22", -1_000],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-20", 1_000],
      ["2026-02-21", -1_000],
      ["2026-02-21", 1_000],
      ["2026-02-22", 1_000],
    ]);

    const result = outcome(() => paste(db, rows, 99_000));

    if ("rowsAdded" in (result as object)) {
      expect(result).toEqual({
        rowsAdded: 1,
        rowsAlreadyPresent: 3,
        tailBalanceCents: 101_000,
        rowsInInbox: 1,
      });
      expect(storedRows(db).slice(0, 4)).toEqual(before);
    } else {
      expect(result).toMatchObject({ code: "STATEMENT_ROW_CONFLICT" });
      expect((result as { message: string }).message).toContain("two ways");
      expect(storedRows(db)).toEqual(before);
    }
  });

  test("R5: a paste whose true reading needs that cut is accepted with it", () => {
    // The bank: 20th +25.00; 21st −7.77, +0.31; 22nd −7.77, +99.00; 25th +56.00.
    // The workbook lists +0.31 on the 22nd, +25.00 on the 20th, −7.77 on the 22nd,
    // +99.00 on the 22nd, −7.77 on the 23rd. The paste starts at the bank's +0.31.
    const db = workbookDb([
      ["2026-02-22", 31],
      ["2026-02-20", 2_500],
      ["2026-02-22", -777],
      ["2026-02-22", 9_900],
      ["2026-02-23", -777],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-21", 31],
      ["2026-02-22", -777],
      ["2026-02-22", 9_900],
      ["2026-02-25", 5_600],
    ]);

    expect(paste(db, rows, 101_723)).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 3,
      tailBalanceCents: 116_477,
      rowsInInbox: 1,
    });
    expect(storedRows(db).slice(0, 5)).toEqual(before);
  });

  test("a paste wholly inside the history may start three days from the workbook row it starts on", () => {
    // The workbook: −12.34 on the 20th, +56.00 on the 22nd, −7.77 on the 26th.
    // The bank dates the first two the 23rd: a block from the 20th to the 22nd
    // admits the 23rd, three days after its first row.
    const db = workbookDb([
      ["2026-02-20", -1_234],
      ["2026-02-22", 5_600],
      ["2026-02-26", -777],
    ]);
    const rows = bankRows([
      ["2026-02-23", -1_234],
      ["2026-02-23", 5_600],
    ]);

    expect(paste(db, rows, 100_000)).toEqual({
      rowsAdded: 0,
      rowsAlreadyPresent: 2,
      tailBalanceCents: 103_589,
      rowsInInbox: 0,
    });
  });

  test("a stretch's first block takes in a workbook row two days before it", () => {
    // The bank's 21st is +56.00, −12.34; the workbook lists −12.34 on the 20th,
    // +56.00 on the 22nd. The paste starts at the bank's −12.34.
    const db = workbookDb([
      ["2026-02-20", -1_234],
      ["2026-02-22", 5_600],
    ]);
    const rows = bankRows([
      ["2026-02-21", -1_234],
      ["2026-02-22", 2_500],
    ]);

    expect(paste(db, rows, 105_600)).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 1,
      tailBalanceCents: 106_866,
      rowsInInbox: 1,
    });
  });

  test("a stretch's last block takes in a workbook row two days after it", () => {
    // The bank's 21st is +56.00, −12.34; the workbook lists −12.34 on the 20th,
    // +56.00 on the 22nd, then +3.00 on 2 March. The paste is the bank's +56.00
    // alone, wholly inside the history.
    const db = workbookDb([
      ["2026-02-20", -1_234],
      ["2026-02-22", 5_600],
      ["2026-03-02", 300],
    ]);
    const rows = bankRows([["2026-02-21", 5_600]]);

    expect(paste(db, rows, 100_000)).toEqual({
      rowsAdded: 0,
      rowsAlreadyPresent: 1,
      tailBalanceCents: 104_666,
      rowsInInbox: 0,
    });
  });
});

// lg-61: a workbook row dated two or three days off the bank's puts the true
// reading outside the tolerance, and a false reading must not be stored in its place.

/**
 * A paste's outcome is its true reading, or a refusal that stores nothing:
 * never a wrong split. Either way the workbook's rows are as they were.
 */
function expectTrueOrRefused(
  db: Database.Database,
  before: unknown[],
  result: unknown,
  truth: ImportStatementReport,
): void {
  if ("rowsAdded" in (result as object)) {
    expect(result).toEqual(truth);
    expect(storedRows(db).slice(0, before.length)).toEqual(before);
    return;
  }
  const { code, message } = result as { code: string; message: string };
  if (code === "STATEMENT_ROW_CONFLICT") expect(message).toContain("two ways");
  else expect(code).toBe("STATEMENT_CHAIN_BROKEN");
  expect(storedRows(db)).toEqual(before);
}

describe("a paste meeting a workbook row dated two or three days off (lg-61)", () => {
  test("R1: a row three days early is not read as a shorter overlap that stores rows twice", () => {
    // The bank: 20th −5.00, −5.00; 21st +5.00, +10.00. The workbook holds the
    // first three in the bank's order, the first dated the 17th. Pasting all
    // four is three already stored and one new; read as one stored and three
    // new, the block of the 20th and 21st takes the pasted −5.00 as its last.
    const db = workbookDb([
      ["2026-02-17", -500],
      ["2026-02-20", -500],
      ["2026-02-21", 500],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-20", -500],
      ["2026-02-20", -500],
      ["2026-02-21", 500],
      ["2026-02-21", 1_000],
    ]);

    const result = outcome(() => paste(db, rows, 100_000));

    expectTrueOrRefused(db, before, result, {
      rowsAdded: 1,
      rowsAlreadyPresent: 3,
      tailBalanceCents: 100_500,
      rowsInInbox: 1,
    });
    // As built, the false reading's rival is the true one, three days off.
    expect(result).toMatchObject({
      code: "STATEMENT_ROW_CONFLICT",
      details: {
        readings: [
          { rowsAdded: 1, rowsAlreadyPresent: 3 },
          { rowsAdded: 3, rowsAlreadyPresent: 1 },
        ],
      },
    });
    expect((result as { message: string }).message).toContain("up to 3 days");
  });

  test("R8: a block spanning a row two days off does not swallow a new bank row", () => {
    // The bank: 20th +10.00, −10.00; 22nd −10.00; 23rd +10.00 (new). The
    // workbook holds the first three, listed +10.00 on the 22nd, −10.00 on the
    // 20th, −10.00 on the 24th. The paste is the bank's last two rows from
    // 1 000.00: one already stored, one new. Read as wholly inside the history,
    // the 23rd's +10.00 would never be stored.
    const db = workbookDb([
      ["2026-02-22", 1_000],
      ["2026-02-20", -1_000],
      ["2026-02-24", -1_000],
    ]);
    const before = storedRows(db);
    const rows = bankRows([
      ["2026-02-22", -1_000],
      ["2026-02-23", 1_000],
    ]);

    const result = outcome(() => paste(db, rows, 100_000));

    expectTrueOrRefused(db, before, result, {
      rowsAdded: 1,
      rowsAlreadyPresent: 1,
      tailBalanceCents: 100_000,
      rowsInInbox: 1,
    });
    expect(result).toMatchObject({ code: "STATEMENT_ROW_CONFLICT" });
  });

  test("a rival reading is weighed with rows three days off and no further", () => {
    const block = dated(100_000, [["2026-02-20", -500]]);
    const threeOff = dated(100_000, [["2026-02-23", -500]]);
    const fourOff = dated(100_000, [["2026-02-24", -500]]);

    expect(matchBlock(block, 0, threeOff)).toBe(false);
    expect(matchBlock(block, 0, threeOff, RIVAL_TOLERANCE)).toBe(true);
    expect(matchBlock(block, 0, fourOff, RIVAL_TOLERANCE)).toBe(false);
    expect(RIVAL_TOLERANCE).toEqual({
      widestBlockDays: STORED_TOLERANCE.widestBlockDays,
      daysOff: RIVAL_DAYS_OFF,
    });
    expect(RIVAL_DAYS_OFF).toBe(3);
  });

  test("a paste starting on the first row the workbook does not hold is stored, past the rival check", () => {
    // R1's workbook, and the bank's one new row alone: the advice the refusal gives.
    const db = workbookDb([
      ["2026-02-17", -500],
      ["2026-02-20", -500],
      ["2026-02-21", 500],
    ]);
    const before = storedRows(db);

    expect(paste(db, bankRows([["2026-02-21", 1_000]]), 99_500)).toEqual({
      rowsAdded: 1,
      rowsAlreadyPresent: 0,
      tailBalanceCents: 100_500,
      rowsInInbox: 1,
    });
    expect(storedRows(db).slice(0, 3)).toEqual(before);
  });
});
