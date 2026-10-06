/**
 * Migration 4: the periods, their lines and the recurring items (lg-6). What the
 * database itself refuses, each beside a row it accepts, so a refusal is the
 * constraint's and not a typo in the fixture's. Invented people and amounts.
 */

import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrate } from "../src/db/schema.ts";

const AT = "2026-10-03T12:00:00.000Z";

function open(): Database.Database {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO people (id, added_at) VALUES ('alex', ?), ('sam', ?)").run(AT, AT);
  db.prepare(
    "INSERT INTO ratios (id, effective_from, supersedes, entered_at, entered_by) VALUES (1, '2026-01-01', NULL, ?, 'alex')",
  ).run(AT);
  return db;
}

interface Line {
  person_id: string;
  amount_cents: number;
  charged_to: string | null;
  supersedes: number | null;
}

function addLine(db: Database.Database, fields: Partial<Line> = {}): number {
  const line: Line = {
    person_id: "alex",
    amount_cents: 4_500,
    charged_to: null,
    supersedes: null,
    ...fields,
  };
  const result = db
    .prepare(
      `INSERT INTO period_lines (person_id, date, amount_cents, category, note, source, charged_to, supersedes, retired, entered_at, entered_by)
       VALUES (?, '2026-09-03', ?, NULL, NULL, 'manual', ?, ?, 0, ?, 'alex')`,
    )
    .run(line.person_id, line.amount_cents, line.charged_to, line.supersedes, AT);
  return Number(result.lastInsertRowid);
}

interface Item {
  monthly_cents: number;
  start_date: string;
  end_date: string | null;
  supersedes: number | null;
}

function addItem(db: Database.Database, fields: Partial<Item> = {}): number {
  const item: Item = {
    monthly_cents: 8_000,
    start_date: "2026-01-10",
    end_date: null,
    supersedes: null,
    ...fields,
  };
  const result = db
    .prepare(
      `INSERT INTO recurring_items (person_id, monthly_cents, start_date, end_date, label, supersedes, entered_at, entered_by)
       VALUES ('sam', ?, ?, ?, 'Internet', ?, ?, 'sam')`,
    )
    .run(item.monthly_cents, item.start_date, item.end_date, item.supersedes, AT);
  return Number(result.lastInsertRowid);
}

interface Period {
  start_date: string | null;
  end_date: string;
  formula: string;
  payer_id: string | null;
  recipient_id: string | null;
  deposit_cents: number | null;
  net_cents: number;
}

function addPeriod(db: Database.Database, fields: Partial<Period> = {}): void {
  const period: Period = {
    start_date: null,
    end_date: "2026-09-30",
    formula: "v3",
    payer_id: "alex",
    recipient_id: "sam",
    deposit_cents: 15_000,
    net_cents: 6_000,
    ...fields,
  };
  db.prepare(
    `INSERT INTO periods (start_date, end_date, closed_at, closed_by, formula, ratio_id, payer_id, recipient_id, deposit_cents, net_cents)
     VALUES (?, ?, ?, 'alex', ?, 1, ?, ?, ?, ?)`,
  ).run(
    period.start_date,
    period.end_date,
    AT,
    period.formula,
    period.payer_id,
    period.recipient_id,
    period.deposit_cents,
    period.net_cents,
  );
}

describe("period_lines", () => {
  test("refuses a line of nothing", () => {
    const db = open();
    expect(() => addLine(db)).not.toThrow();
    expect(() => addLine(db, { amount_cents: 0 })).toThrow(/CHECK/u);
  });

  test("refuses a charge to whoever paid", () => {
    const db = open();
    expect(() => addLine(db, { charged_to: "sam" })).not.toThrow();
    expect(() => addLine(db, { charged_to: "alex" })).toThrow(/CHECK/u);
  });

  test("lets a line be superseded once, so two corrections cannot both win", () => {
    const db = open();
    const first = addLine(db);
    expect(() => addLine(db, { supersedes: first })).not.toThrow();
    expect(() => addLine(db, { supersedes: first })).toThrow(/UNIQUE/u);
  });
});

describe("recurring_items", () => {
  test("refuses a monthly amount of nothing or less", () => {
    const db = open();
    expect(() => addItem(db)).not.toThrow();
    expect(() => addItem(db, { monthly_cents: 0 })).toThrow(/CHECK/u);
  });

  test("refuses an end before the start, and takes one on it", () => {
    const db = open();
    expect(() => addItem(db, { end_date: "2026-01-10" })).not.toThrow();
    expect(() => addItem(db, { end_date: "2026-01-09" })).toThrow(/CHECK/u);
  });

  test("lets an item be superseded once", () => {
    const db = open();
    const first = addItem(db);
    expect(() => addItem(db, { supersedes: first })).not.toThrow();
    expect(() => addItem(db, { supersedes: first })).toThrow(/UNIQUE/u);
  });
});

/**
 * The period after the first, which the database accepts as it is: so a refusal
 * of it with one field changed is that field's constraint.
 */
const LATER: Partial<Period> = { start_date: "2026-10-01", end_date: "2026-12-31" };

describe("periods", () => {
  test("holds one period from the beginning, and one per start day", () => {
    const db = open();
    addPeriod(db);
    expect(() => addPeriod(db, { end_date: "2026-10-02" })).toThrow(/UNIQUE/u);
    addPeriod(db, { start_date: "2026-10-01", end_date: "2026-10-02" });
    expect(() => addPeriod(db, { start_date: "2026-10-01", end_date: "2026-10-03" })).toThrow(
      /UNIQUE/u,
    );
  });

  test("refuses a formula it does not know", () => {
    const db = open();
    expect(() => addPeriod(db, { formula: "v2" })).not.toThrow();
    expect(() => addPeriod(db, { ...LATER, formula: "v4" })).toThrow(/CHECK/u);
    expect(() => addPeriod(db, LATER)).not.toThrow();
  });

  test("refuses a payer without a recipient, or a recipient without a payer", () => {
    const db = open();
    expect(() =>
      addPeriod(db, { payer_id: null, recipient_id: null, deposit_cents: 0, net_cents: 0 }),
    ).not.toThrow();
    expect(() => addPeriod(db, { ...LATER, recipient_id: null })).toThrow(/CHECK/u);
    expect(() => addPeriod(db, { ...LATER, payer_id: null })).toThrow(/CHECK/u);
    expect(() => addPeriod(db, LATER)).not.toThrow();
  });

  test("refuses a negative deposit or net, and takes a deposit only a transfer can settle", () => {
    const db = open();
    expect(() => addPeriod(db, { deposit_cents: null })).not.toThrow();
    expect(() => addPeriod(db, { ...LATER, deposit_cents: -1 })).toThrow(/CHECK/u);
    expect(() => addPeriod(db, { ...LATER, net_cents: -1 })).toThrow(/CHECK/u);
    expect(() => addPeriod(db, LATER)).not.toThrow();
  });

  test("refuses a period that ends before it starts", () => {
    const db = open();
    expect(() => addPeriod(db, { start_date: "2026-09-30", end_date: "2026-09-30" })).not.toThrow();
    expect(() => addPeriod(db, { start_date: "2026-10-01", end_date: "2026-09-30" })).toThrow(
      /CHECK/u,
    );
  });
});
