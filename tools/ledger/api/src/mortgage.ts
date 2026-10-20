/**
 * What the household says about its mortgage (lg-55): live, ended on a day, or
 * none.
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). Saying something new files a
 * record that supersedes the one that stood, and `current_mortgage_record` is
 * the one that does. No record reads as live, so a household that never says
 * anything sees exactly what it saw before.
 *
 * The record decides nothing about the arithmetic: the bucket's balance and
 * each person's own money are `books`' and are read as ever. This adds the
 * close — the later of the end date and the last joint payment out of the
 * bucket — and whether anything is left, for the screens to read.
 */

import { mortgagePayments } from "@ledger/books";
import type {
  MortgageRecord,
  MortgageRecordRequest,
  MortgageResponse,
  MortgageState,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { bucketsAsOf } from "./buckets.ts";
import { filedRows } from "./stats.ts";

interface RecordColumns {
  id: number;
  state: MortgageState;
  ended_on: string | null;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

function toRecord(columns: RecordColumns): MortgageRecord {
  return {
    id: columns.id,
    state: columns.state,
    endedOn: columns.ended_on,
    supersedes: columns.supersedes,
    enteredAt: columns.entered_at,
    enteredBy: columns.entered_by,
  };
}

function currentRecord(db: Database): MortgageRecord | null {
  const found = db.prepare("SELECT * FROM current_mortgage_record").get() as
    | RecordColumns
    | undefined;
  return found === undefined ? null : toRecord(found);
}

/** The record that stands, what follows from it, and what the bucket holds, as of `today`. */
export function mortgageStatus(db: Database, today: string): MortgageResponse {
  return db.transaction((): MortgageResponse => {
    const record = currentRecord(db);
    const state = record?.state ?? "live";
    const endedOn = state === "ended" ? (record?.endedOn ?? null) : null;
    const payments = mortgagePayments(filedRows(db), { from: null, to: null });
    // Oldest first, so the last point is the latest payment.
    const lastPaymentOn = payments.at(-1)?.date ?? null;
    const closedOn =
      endedOn === null
        ? null
        : lastPaymentOn !== null && lastPaymentOn > endedOn
          ? lastPaymentOn
          : endedOn;
    const { mortgage } = bucketsAsOf(db, today);
    return {
      asOf: today,
      record,
      state,
      endedOn,
      lastPaymentOn,
      closedOn,
      left: mortgage.own.some((person) => person.ownCents !== 0),
      balanceCents: mortgage.balanceCents,
      own: mortgage.own,
    };
  })();
}

/**
 * Files what the household now says. Saying what already stands, or `live` when
 * nothing has been said, files nothing: the answer is the same either way.
 */
export function recordMortgage(
  db: Database,
  request: MortgageRecordRequest,
  by: string,
  now: Date,
): MortgageResponse {
  const today = now.toISOString().slice(0, 10);
  db.transaction(() => {
    const standing = currentRecord(db);
    const endedOn = request.state === "ended" ? request.endedOn : null;
    const state = standing?.state ?? "live";
    if (state === request.state && (standing?.endedOn ?? null) === endedOn) return;
    db.prepare(
      `INSERT INTO mortgage_records (state, ended_on, supersedes, entered_at, entered_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(request.state, endedOn, standing?.id ?? null, now.toISOString(), by);
  }).immediate();
  return mortgageStatus(db, today);
}
