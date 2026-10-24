/**
 * lg-65: a paste against a workbook whose dates change at almost every row is
 * read in well under the time it held the write lock before. The shape is the
 * ticket's reproduction at 250 rows: 100 rows a date, each odd row dated a day
 * later, amounts alternating +10.00 and −10.00, and three rows from the middle
 * pasted as the bank dates them. Every amount is invented.
 *
 * On `main` at `8a6dcf9a` this paste took 14.8, 15.7 and 17.5 s here; lg-65's
 * search takes about 0.55 s. The ceiling is 5 s: three times under `main`'s fastest
 * run, nine times over lg-65's, and inside the ledger project's 20 s per test, so
 * the search it replaced fails here rather than at the timeout.
 */

import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { migrate } from "../src/db/schema.ts";
import { importStatement } from "../src/statements.ts";
import { renderPaste, withBalances } from "./helpers/paste.ts";

const OPENING = 1_000_000;
const ROWS = 250;
const A_DATE = 100;

const dateOf = (day: number): string =>
  new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
const amountAt = (row: number): number => (row % 2 === 0 ? 1000 : -1000);

test("a three-row paste into 250 rows whose dates alternate by a day is read in under 5 s (lg-65)", () => {
  const db = new Database(":memory:");
  migrate(db);
  const imported = db
    .prepare(
      "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
    )
    .run("2026-10-01T00:00:00Z", "alex").lastInsertRowid;
  const insert = db.prepare(
    "INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id) VALUES (?, ?, '', ?, ?, ?, ?)",
  );
  let balance = OPENING;
  db.transaction(() => {
    for (let row = 0; row < ROWS; row++) {
      balance += amountAt(row);
      const day = Math.floor(row / A_DATE) + (row % 2);
      insert.run(row, dateOf(day), `W${row}`, amountAt(row), balance, imported);
    }
  })();
  const from = Math.floor(ROWS / 2) - 1;
  let opening = OPENING;
  for (let row = 0; row < from; row++) opening += amountAt(row);
  const pasted = [from, from + 1, from + 2].map((row) => ({
    date: dateOf(Math.floor(row / A_DATE)),
    description: `Op ${amountAt(row)}`,
    amountCents: amountAt(row),
  }));
  const text = renderPaste(withBalances(pasted, opening));

  const started = performance.now();
  let caught: unknown;
  try {
    importStatement({ db, personId: "alex", now: () => new Date("2026-10-18T00:00:00Z") }, text);
  } catch (error: unknown) {
    caught = error;
  }
  const elapsed = performance.now() - started;
  db.close();

  // The outcome `main` gives: the balances alternate, so the paste fits three
  // numbers of stored rows, and it is refused as ambiguous.
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe("STATEMENT_ROW_CONFLICT");
  expect((caught as AppError).details?.["readings"]).toEqual([
    { rowsAdded: 0, rowsAlreadyPresent: 3 },
    { rowsAdded: 1, rowsAlreadyPresent: 2 },
    { rowsAdded: 3, rowsAlreadyPresent: 0 },
  ]);
  expect(elapsed).toBeLessThan(5000);
});
