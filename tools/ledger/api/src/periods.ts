/**
 * Periods of personal-card spending, their lines and recurring items, and
 * closing a period with the settlement it computes (lg-6).
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). A line is corrected by a
 * line that supersedes it and removed by a retirement that does; a recurring
 * item is corrected or ended by a version that supersedes it; and a period is a
 * row only once it is closed, so closing one is a single `INSERT`. The open
 * period is whatever follows the last closed one.
 *
 * **The arithmetic is the books'.** This file gathers what they need — every
 * line and generated monthly line, every buffer deposit filed to a person, and
 * each closed period with the ratio its settlement recorded — and stores what
 * a close computed: amount, payer, ratio and formula version (§5). A recorded
 * settlement is never recomputed: the next close is cumulative, so whatever an
 * earlier one got wrong is caught up there.
 */

import {
  cumulativeSettlement,
  dayAfter,
  matchDeposits,
  ratioInEffect,
  recurringDates,
} from "@ledger/books";
import type { CandidateRow, DepositInput, LineInput, WeighedPeriod } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  ClosePeriodRequest,
  ClosedPeriod,
  OpenPeriodLine,
  OpenPeriodResponse,
  PeriodLine,
  PeriodLineDraft,
  PeriodLineSource,
  RatioShare,
  RecurringItem,
  RecurringItemDraft,
  SettlementFigures,
  SettlementFormula,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { requireKnownPerson } from "./rules.ts";
import type { RuleContext } from "./rules.ts";
import { currentRatios } from "./salaries.ts";

/** Who is acting and when, and who the household is: the same as a rule's. */
export type PeriodContext = RuleContext;

interface LineColumns {
  id: number;
  person_id: string;
  date: string;
  amount_cents: number;
  category: string | null;
  note: string | null;
  source: PeriodLineSource;
  charged_to: string | null;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

interface RecurringColumns {
  id: number;
  person_id: string;
  monthly_cents: number;
  start_date: string;
  end_date: string | null;
  label: string;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

interface PeriodColumns {
  id: number;
  start_date: string | null;
  end_date: string;
  closed_at: string;
  closed_by: string;
  formula: SettlementFormula;
  ratio_id: number;
  payer_id: string | null;
  recipient_id: string | null;
  deposit_cents: number | null;
  net_cents: number;
}

function toLine(columns: LineColumns): PeriodLine {
  return {
    id: columns.id,
    personId: columns.person_id,
    date: columns.date,
    amountCents: columns.amount_cents,
    category: columns.category,
    note: columns.note,
    source: columns.source,
    chargedTo: columns.charged_to,
    supersedes: columns.supersedes,
    enteredAt: columns.entered_at,
    enteredBy: columns.entered_by,
  };
}

function toRecurring(columns: RecurringColumns): RecurringItem {
  return {
    id: columns.id,
    personId: columns.person_id,
    monthlyCents: columns.monthly_cents,
    startDate: columns.start_date,
    endDate: columns.end_date,
    label: columns.label,
    supersedes: columns.supersedes,
    enteredAt: columns.entered_at,
    enteredBy: columns.entered_by,
  };
}

function todayOf(context: Pick<PeriodContext, "now">): string {
  return context.now().toISOString().slice(0, 10);
}

// --- Lines ---

/** The lines that stand, oldest first. */
export function currentLines(db: Database): PeriodLine[] {
  return (
    db.prepare("SELECT * FROM current_period_lines ORDER BY date, id").all() as LineColumns[]
  ).map(toLine);
}

function requireLinePeople(context: PeriodContext, draft: PeriodLineDraft): void {
  requireKnownPerson(context.people, draft.personId);
  requireKnownPerson(context.people, draft.chargedTo);
  if (draft.chargedTo === draft.personId) {
    throw new AppError("BAD_REQUEST", "A charge is owed by the other person, not by whoever paid.");
  }
}

function insertLine(
  context: PeriodContext,
  draft: PeriodLineDraft,
  supersedes: number | null,
  retired: boolean,
): PeriodLine {
  const result = context.db
    .prepare(
      `INSERT INTO period_lines (person_id, date, amount_cents, category, note, source, charged_to, supersedes, retired, entered_at, entered_by)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.personId,
      draft.date,
      draft.amountCents,
      draft.category,
      draft.note,
      draft.chargedTo,
      supersedes,
      retired ? 1 : 0,
      context.now().toISOString(),
      context.personId,
    );
  return toLine(
    context.db
      .prepare("SELECT * FROM period_lines WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as LineColumns,
  );
}

function standingLine(db: Database, id: number): PeriodLine {
  const found = db.prepare("SELECT * FROM current_period_lines WHERE id = ?").get(id) as
    | LineColumns
    | undefined;
  if (found === undefined) throw new AppError("PERIOD_LINE_NOT_FOUND");
  return toLine(found);
}

export function addLine(context: PeriodContext, draft: PeriodLineDraft): PeriodLine {
  requireLinePeople(context, draft);
  return context.db.transaction(() => insertLine(context, draft, null, false)).immediate();
}

/** The line as corrected: a new line, under a new id, that supersedes `id`. */
export function correctLine(
  context: PeriodContext,
  id: number,
  draft: PeriodLineDraft,
): PeriodLine {
  requireLinePeople(context, draft);
  return context.db
    .transaction(() => {
      standingLine(context.db, id);
      return insertLine(context, draft, id, false);
    })
    .immediate();
}

/** The line as it stood when it was removed. Its record stays. */
export function retireLine(context: PeriodContext, id: number): PeriodLine {
  return context.db
    .transaction(() => {
      const line = standingLine(context.db, id);
      insertLine(context, line, id, true);
      return line;
    })
    .immediate();
}

// --- Recurring items ---

/** The recurring items that stand, oldest first. */
export function currentRecurring(db: Database): RecurringItem[] {
  return (
    db.prepare("SELECT * FROM current_recurring_items ORDER BY id").all() as RecurringColumns[]
  ).map(toRecurring);
}

function insertRecurring(
  context: PeriodContext,
  draft: RecurringItemDraft,
  supersedes: number | null,
): RecurringItem {
  const result = context.db
    .prepare(
      `INSERT INTO recurring_items (person_id, monthly_cents, start_date, end_date, label, supersedes, entered_at, entered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.personId,
      draft.monthlyCents,
      draft.startDate,
      draft.endDate,
      draft.label,
      supersedes,
      context.now().toISOString(),
      context.personId,
    );
  return toRecurring(
    context.db
      .prepare("SELECT * FROM recurring_items WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as RecurringColumns,
  );
}

export function addRecurring(context: PeriodContext, draft: RecurringItemDraft): RecurringItem {
  requireKnownPerson(context.people, draft.personId);
  return context.db.transaction(() => insertRecurring(context, draft, null)).immediate();
}

/**
 * The item as changed, under a new id, superseding `id`: a correction, or an
 * end date, which is how an item stops. A change of amount from some month on
 * is an end and a new item, so the months before keep the amount they had.
 */
export function changeRecurring(
  context: PeriodContext,
  id: number,
  draft: RecurringItemDraft,
): RecurringItem {
  requireKnownPerson(context.people, draft.personId);
  return context.db
    .transaction(() => {
      const found = context.db
        .prepare("SELECT id FROM current_recurring_items WHERE id = ?")
        .get(id);
      if (found === undefined) throw new AppError("RECURRING_ITEM_NOT_FOUND");
      return insertRecurring(context, draft, id);
    })
    .immediate();
}

// --- Periods and their settlement ---

function closedRows(db: Database): PeriodColumns[] {
  // A period's end is after every earlier period's, so this is oldest first.
  return db.prepare("SELECT * FROM periods ORDER BY end_date, id").all() as PeriodColumns[];
}

/** A ratio's shares by id, superseded or not: a settlement keeps the ratio it used. */
function sharesOf(db: Database, ratioId: number): RatioShare[] {
  return (
    db
      .prepare(
        "SELECT person_id, parts_per_million, salary_id FROM ratio_shares WHERE ratio_id = ? ORDER BY person_id",
      )
      .all(ratioId) as { person_id: string; parts_per_million: number; salary_id: number | null }[]
  ).map((share) => ({
    personId: share.person_id,
    partsPerMillion: share.parts_per_million,
    salaryId: share.salary_id,
  }));
}

/** Every line, stored or generated by a recurring item, dated on or before `through`. */
function linesThrough(db: Database, through: string): OpenPeriodLine[] {
  const stored = currentLines(db)
    .filter((line) => line.date <= through)
    .map((line): OpenPeriodLine => ({
      date: line.date,
      personId: line.personId,
      amountCents: line.amountCents,
      chargedTo: line.chargedTo,
      category: line.category,
      note: line.note,
      lineId: line.id,
      recurringItemId: null,
    }));
  const generated = currentRecurring(db).flatMap((item) =>
    recurringDates(item, through).map((date): OpenPeriodLine => ({
      date,
      personId: item.personId,
      amountCents: item.monthlyCents,
      chargedTo: null,
      category: item.label,
      note: null,
      lineId: null,
      recurringItemId: item.id,
    })),
  );
  return [...stored, ...generated].toSorted(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.lineId ?? Number.MAX_SAFE_INTEGER) - (b.lineId ?? Number.MAX_SAFE_INTEGER) ||
      (a.recurringItemId ?? 0) - (b.recurringItemId ?? 0),
  );
}

interface DepositColumns {
  id: number;
  date: string;
  amount_cents: number;
  person_id: string;
}

/**
 * The rows the buffer's current classification files to a person, in the
 * account's order: every deposit into it, and any money it returned to them,
 * which counts against what they put in (lg-5's contributions).
 */
function bufferRows(db: Database): CandidateRow[] {
  return (
    db
      .prepare(
        `SELECT statement_rows.id, statement_rows.date, statement_rows.amount_cents, current_classifications.person_id
         FROM statement_rows
         JOIN current_classifications ON current_classifications.row_id = statement_rows.id
         WHERE current_classifications.bucket = 'current-expenses'
           AND current_classifications.person_id IS NOT NULL
         ORDER BY statement_rows.seq`,
      )
      .all() as DepositColumns[]
  ).map((row) => ({
    id: row.id,
    date: row.date,
    amountCents: row.amount_cents,
    personId: row.person_id,
  }));
}

/**
 * What closing `[start, end]` after every closed period would settle, or `null`
 * when no ratio is in effect on `end`.
 */
function settlementFor(
  db: Database,
  closed: readonly PeriodColumns[],
  start: string | null,
  end: string,
): SettlementFigures | null {
  const ratio = ratioInEffect(currentRatios(db), end);
  if (ratio === null) return null;
  const periods: WeighedPeriod[] = [
    ...closed.map((period) => ({
      start: period.start_date,
      end: period.end_date,
      ratio: sharesOf(db, period.ratio_id),
    })),
    { start, end, ratio: ratio.shares },
  ];
  const lines: LineInput[] = linesThrough(db, end);
  const deposits: DepositInput[] = bufferRows(db);
  const result = cumulativeSettlement(periods, lines, deposits);
  return {
    formula: result.formula,
    ratioId: ratio.id,
    shares: ratio.shares,
    payerId: result.payerId,
    recipientId: result.recipientId,
    depositCents: result.depositCents,
    netCents: result.netCents,
  };
}

/** The open period's start: the day after the last closed period, or the first's to choose. */
function openStart(closed: readonly PeriodColumns[]): string | null {
  const last = closed.at(-1);
  return last === undefined ? null : dayAfter(last.end_date);
}

/**
 * The open period, as if it ended on `end`. `start` is honoured only for the
 * first period, whose start is the point the two were last even and is the
 * closer's to choose; after that the open period starts where the last closed
 * one ended.
 */
export function openPeriod(
  db: Database,
  request: { start?: string | undefined; end: string },
): OpenPeriodResponse {
  return db.transaction(() => {
    const closed = closedRows(db);
    const first = closed.length === 0;
    const start = first ? (request.start ?? null) : openStart(closed);
    if (start !== null && request.end < start) {
      throw new AppError("BAD_REQUEST", "A period cannot end before it starts.");
    }
    return {
      start,
      end: request.end,
      first,
      lines: linesThrough(db, request.end).filter((line) => start === null || line.date >= start),
      settlement: settlementFor(db, closed, start, request.end),
    };
  })();
}

function toClosed(
  db: Database,
  period: PeriodColumns,
  deposit: ClosedPeriod["deposit"],
): ClosedPeriod {
  return {
    id: period.id,
    start: period.start_date,
    end: period.end_date,
    closedAt: period.closed_at,
    closedBy: period.closed_by,
    settlement: {
      formula: period.formula,
      ratioId: period.ratio_id,
      shares: sharesOf(db, period.ratio_id),
      payerId: period.payer_id,
      recipientId: period.recipient_id,
      depositCents: period.deposit_cents,
      netCents: period.net_cents,
    },
    deposit,
  };
}

/** The closed periods, newest first, each with whether its deposit has been seen. */
export function closedPeriods(db: Database): ClosedPeriod[] {
  return db.transaction(() => {
    const closed = closedRows(db);
    const matches = matchDeposits(
      closed.map((period) => ({
        periodId: period.id,
        end: period.end_date,
        payerId: period.payer_id,
        depositCents: period.deposit_cents,
      })),
      bufferRows(db),
    );
    return closed
      .map((period, index) =>
        toClosed(db, period, {
          status: matches[index]?.status ?? "expected",
          rowId: matches[index]?.rowId ?? null,
        }),
      )
      .toReversed();
  })();
}

/**
 * Closes the open period on `request.end` and records the settlement it
 * computes. `request.start` is the open period's start as the closer saw it: a
 * period the other person closed meanwhile is `PERIOD_NOT_OPEN`, never closed
 * twice. For the first period it is the closer's choice of where the two were
 * last even.
 */
export function closePeriod(context: PeriodContext, request: ClosePeriodRequest): ClosedPeriod {
  if (request.end > todayOf(context)) {
    throw new AppError("BAD_REQUEST", "A period cannot end after today.");
  }
  const id = context.db
    .transaction(() => {
      const closed = closedRows(context.db);
      const start = closed.length === 0 ? request.start : openStart(closed);
      if (closed.length > 0 && request.start !== start) throw new AppError("PERIOD_NOT_OPEN");
      if (start !== null && request.end < start) {
        throw new AppError("BAD_REQUEST", "A period cannot end before it starts.");
      }
      const figures = settlementFor(context.db, closed, start, request.end);
      if (figures === null) throw new AppError("RATIO_NOT_IN_EFFECT");
      const result = context.db
        .prepare(
          `INSERT INTO periods (start_date, end_date, closed_at, closed_by, formula, ratio_id, payer_id, recipient_id, deposit_cents, net_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          start,
          request.end,
          context.now().toISOString(),
          context.personId,
          figures.formula,
          figures.ratioId,
          figures.payerId,
          figures.recipientId,
          figures.depositCents,
          figures.netCents,
        );
      return Number(result.lastInsertRowid);
    })
    .immediate();
  const stored = closedPeriods(context.db).find((period) => period.id === id);
  if (stored === undefined) throw new AppError("INTERNAL", "A closed period did not read back.");
  return stored;
}
