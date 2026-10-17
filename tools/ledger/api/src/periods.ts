/**
 * Periods of personal-card spending, their lines and recurring items, and
 * closing a period with the settlement it computes (lg-6).
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). A line is corrected by a
 * line that supersedes it and removed by a retirement that does; a recurring
 * item is corrected or ended by a version that supersedes it; and a period is a
 * row only once it is closed, so closing one is a single `INSERT` — with a row
 * per deposit and transfer when it settles between more than two people
 * (lg-23), in the same transaction. The open period is whatever follows the
 * last closed one.
 *
 * **The arithmetic is the books'.** This file gathers what they need — every
 * line and generated monthly line, every buffer deposit filed to a person with
 * the closed period it settles if it matched one, and each closed period with
 * the ratio its settlement recorded — and stores what
 * a close computed: amounts, who pays, ratio and formula version (§5). A recorded
 * settlement is never recomputed: the next close is cumulative, so whatever an
 * earlier one got wrong is caught up there.
 */

import {
  asPair,
  cumulativeHouseholdSettlement,
  dayAfter,
  enteredLate,
  matchDeposits,
  ratioInEffect,
  recurringDates,
} from "@ledger/books";
import type {
  CandidateRow,
  ClosedSpan,
  DepositInput,
  DepositMatch,
  HouseholdSettlement,
  LineInput,
  WeighedPeriod,
} from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  ClosePeriodRequest,
  ClosedPeriod,
  OpenPeriodLine,
  OpenPeriodResponse,
  PeriodLine,
  PeriodLineDraft,
  PeriodLineSource,
  PeriodLinesResponse,
  RatioShare,
  RecurringItem,
  RecurringItemDraft,
  SettlementDeposit,
  SettlementFigures,
  SettlementFormula,
  SettlementTransfer,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { requireKnownPerson } from "./rules.ts";
import type { RuleContext } from "./rules.ts";
import { currentRatios } from "./salaries.ts";
import { requireSpendingCategory } from "./spending-categories.ts";

/** Who is acting and when, and who the household is: the same as a rule's. */
export type PeriodContext = RuleContext;

interface LineColumns {
  id: number;
  person_id: string;
  date: string;
  amount_cents: number;
  category: string | null;
  spending_category_id: number | null;
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
    spendingCategoryId: columns.spending_category_id,
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

/**
 * The lines that stand and are dated in a span, newest first, with how many
 * match before the page (lg-19). The span, the category and the page are all
 * narrowed in SQL: a line's category is its own column, unlike a row's.
 */
export function listLines(
  db: Database,
  query: {
    from?: string | undefined;
    to?: string | undefined;
    /** `"none"` keeps the uncategorised; a number keeps that category's. */
    spendingCategory?: number | "none" | undefined;
    offset?: number | undefined;
    limit?: number | undefined;
  },
): PeriodLinesResponse {
  const filter = query.spendingCategory;
  const kind = filter === undefined ? 0 : filter === "none" ? 1 : 2;
  const where = `(? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?)
    AND (? = 0 OR (? = 1 AND spending_category_id IS NULL) OR spending_category_id = ?)`;
  const bound = [
    query.from ?? null,
    query.from ?? null,
    query.to ?? null,
    query.to ?? null,
    kind,
    kind,
    typeof filter === "number" ? filter : null,
  ];
  const counted = db
    .prepare(`SELECT COUNT(*) AS n FROM current_period_lines WHERE ${where}`)
    .get(...bound) as { n: number };
  const found = db
    .prepare(
      `SELECT * FROM current_period_lines WHERE ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...bound, query.limit ?? 100, query.offset ?? 0) as LineColumns[];
  return { lines: found.map(toLine), total: counted.n };
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
  source: PeriodLineSource = "manual",
): PeriodLine {
  const result = context.db
    .prepare(
      `INSERT INTO period_lines (person_id, date, amount_cents, category, spending_category_id, note, source, charged_to, supersedes, retired, entered_at, entered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.personId,
      draft.date,
      draft.amountCents,
      draft.category,
      draft.spendingCategoryId,
      draft.note,
      source,
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

/**
 * A new line. `source` is `manual` for a person's own entry; a receipt filed on
 * confirmation adds its line as `receipt` (lg-8), inside the filing's own
 * transaction, where this one is a savepoint.
 */
export function addLine(
  context: PeriodContext,
  draft: PeriodLineDraft,
  source: PeriodLineSource = "manual",
): PeriodLine {
  requireLinePeople(context, draft);
  return context.db
    .transaction(() => {
      requireSpendingCategory(context.db, draft.spendingCategoryId);
      return insertLine(context, draft, null, false, source);
    })
    .immediate();
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
      const current = standingLine(context.db, id);
      // The category it already has stays acceptable if it has since been retired.
      requireSpendingCategory(context.db, draft.spendingCategoryId, current.spendingCategoryId);
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

/** A settlement's deposits and transfers: what a close records, between any number of people. */
type Settled = Pick<SettlementFigures, "deposits" | "transfers">;

/**
 * A closed period's deposits and transfers. A settlement between more than two
 * people is in rows of its own (lg-23, migration 10); one between two, and every
 * period closed before, is the periods row's payer, recipient, deposit and net.
 */
function settledOf(db: Database, period: PeriodColumns): Settled {
  const deposits = (
    db
      .prepare(
        "SELECT person_id, deposit_cents FROM settlement_deposits WHERE period_id = ? ORDER BY person_id",
      )
      .all(period.id) as { person_id: string; deposit_cents: number }[]
  ).map((row): SettlementDeposit => ({ personId: row.person_id, depositCents: row.deposit_cents }));
  const transfers = (
    db
      .prepare(
        "SELECT from_id, to_id, cents FROM settlement_transfers WHERE period_id = ? ORDER BY id",
      )
      .all(period.id) as { from_id: string; to_id: string; cents: number }[]
  ).map((row): SettlementTransfer => ({ fromId: row.from_id, toId: row.to_id, cents: row.cents }));
  if (deposits.length > 0 || transfers.length > 0) {
    return { deposits: period.deposit_cents === null ? null : deposits, transfers };
  }
  const { payer_id: payer, recipient_id: recipient, deposit_cents: deposit } = period;
  if (payer === null || recipient === null) return { deposits: [], transfers: [] };
  const transfer = { fromId: payer, toId: recipient, cents: period.net_cents };
  const direct = period.net_cents > 0 ? [transfer] : [];
  // Settled only directly, the one transfer stands even at 0.00: it names who
  // owed whom, as lg-6 recorded it (lg-23 gate 1, F1).
  if (deposit === null) return { deposits: null, transfers: [transfer] };
  return {
    deposits: deposit > 0 ? [{ personId: payer, depositCents: deposit }] : [],
    transfers: direct,
  };
}

/**
 * When each record of `table` was first entered: the start of its chain of
 * corrections. `table` is one of two names written here, never input.
 */
function firstEntered(
  db: Database,
  table: "period_lines" | "recurring_items",
): Map<number, string> {
  const rows = db.prepare(`SELECT id, supersedes, entered_at FROM ${table}`).all() as {
    id: number;
    supersedes: number | null;
    entered_at: string;
  }[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const first = new Map<number, string>();
  for (const row of rows) {
    let earliest = row;
    for (let step = byId.get(row.supersedes ?? 0); step !== undefined;) {
      earliest = step;
      step = byId.get(step.supersedes ?? 0);
    }
    first.set(row.id, earliest.entered_at);
  }
  return first;
}

/**
 * Every line, stored or generated by a recurring item, dated on or before
 * `through`, each marked late if it was first entered after the closed period
 * holding its date had closed.
 */
function linesThrough(
  db: Database,
  through: string,
  closed: readonly PeriodColumns[] = [],
): OpenPeriodLine[] {
  const spans: ClosedSpan[] = closed.map((period) => ({
    start: period.start_date,
    end: period.end_date,
    closedAt: period.closed_at,
  }));
  const lineEntered = firstEntered(db, "period_lines");
  const itemEntered = firstEntered(db, "recurring_items");
  const late = (date: string, entered: string | undefined): boolean =>
    entered !== undefined && enteredLate(spans, date, entered);
  const stored = currentLines(db)
    .filter((line) => line.date <= through)
    .map((line): OpenPeriodLine => ({
      date: line.date,
      personId: line.personId,
      amountCents: line.amountCents,
      chargedTo: line.chargedTo,
      category: line.category,
      spendingCategoryId: line.spendingCategoryId,
      note: line.note,
      lineId: line.id,
      recurringItemId: null,
      late: late(line.date, lineEntered.get(line.id)),
    }));
  const generated = currentRecurring(db).flatMap((item) =>
    recurringDates(item, through).map((date): OpenPeriodLine => ({
      date,
      personId: item.personId,
      amountCents: item.monthlyCents,
      chargedTo: null,
      category: item.label,
      spendingCategoryId: null,
      note: null,
      lineId: null,
      recurringItemId: item.id,
      late: late(date, itemEntered.get(item.id)),
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
 * What became of each closed period's expected deposit (`closed` oldest first),
 * recomputed from the buffer rows' current classification on every read, so a
 * reclassified row moves with it.
 */
function depositMatches(
  db: Database,
  closed: readonly PeriodColumns[],
  rows: readonly CandidateRow[],
): DepositMatch[] {
  return matchDeposits(
    closed.map((period) => ({
      periodId: period.id,
      end: period.end_date,
      deposits: settledOf(db, period).deposits,
    })),
    rows,
  );
}

/** What closing a period would compute: the figures, and the books' own settlement they come from. */
interface Computed {
  figures: SettlementFigures;
  household: HouseholdSettlement;
}

/**
 * What closing `[start, end]` after every closed period would settle, or `null`
 * when no ratio is in effect on `end`. A buffer row matched to a closed
 * period's settlement is weighed at that period's ratio (lg-13).
 */
function settlementFor(
  db: Database,
  closed: readonly PeriodColumns[],
  start: string | null,
  end: string,
): Computed | null {
  const ratio = ratioInEffect(currentRatios(db), end);
  if (ratio === null) return null;
  const rows = bufferRows(db);
  const settles = new Map<number, string>();
  for (const [index, match] of depositMatches(db, closed, rows).entries()) {
    const period = closed[index];
    if (period === undefined) continue;
    for (const { rowId } of match.deposits) {
      if (rowId !== null) settles.set(rowId, period.end_date);
    }
  }
  const periods: WeighedPeriod[] = [
    ...closed.map((period) => ({
      start: period.start_date,
      end: period.end_date,
      ratio: sharesOf(db, period.ratio_id),
    })),
    { start, end, ratio: ratio.shares },
  ];
  const lines: LineInput[] = linesThrough(db, end);
  const deposits: DepositInput[] = rows.map((row) => ({
    personId: row.personId,
    date: row.date,
    amountCents: row.amountCents,
    settles: settles.get(row.id) ?? null,
  }));
  const household = cumulativeHouseholdSettlement(periods, lines, deposits);
  return {
    figures: {
      formula: household.formula,
      ratioId: ratio.id,
      shares: ratio.shares,
      deposits: household.deposits,
      transfers: household.transfers,
    },
    household,
  };
}

/** The open period's start: the day after the last closed period, or the first's to choose. */
function openStart(closed: readonly PeriodColumns[]): string | null {
  const last = closed.at(-1);
  return last === undefined ? null : dayAfter(last.end_date);
}

/**
 * The open period, as if it ended on `end`, which may be the day before it
 * starts: the period after one closed today is empty. `start` is honoured only for the
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
    // On the day a period is closed the next one starts tomorrow, so as of today
    // it is empty: shown, with what is still owed, but not closable.
    if (start !== null && dayAfter(request.end) < start) {
      throw new AppError("BAD_REQUEST", "A period cannot end before it starts.");
    }
    return {
      start,
      end: request.end,
      first,
      // Its own days, and whatever was entered late into a period already
      // closed: the next close counts both, so the list shows both.
      lines: linesThrough(db, request.end, closed).filter(
        (line) => start === null || line.date >= start || line.late,
      ),
      settlement: settlementFor(db, closed, start, request.end)?.figures ?? null,
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
      ...settledOf(db, period),
    },
    deposit,
  };
}

/** The closed periods, newest first, each with whether its deposits have been seen. */
export function closedPeriods(db: Database): ClosedPeriod[] {
  return db.transaction(() => {
    const closed = closedRows(db);
    const matches = depositMatches(db, closed, bufferRows(db));
    return closed
      .map((period, index) =>
        toClosed(db, period, {
          status: matches[index]?.status ?? "expected",
          deposits: matches[index]?.deposits ?? [],
        }),
      )
      .toReversed();
  })();
}

/**
 * Records a close's settlement. Between two people it is the periods row's
 * payer, recipient, deposit and net, as every close before lg-23 recorded it;
 * between more, those say nobody and the figures are rows of their own.
 */
function insertPeriod(
  context: PeriodContext,
  span: { start: string | null; end: string },
  computed: Computed,
): number {
  const { figures, household } = computed;
  const pair = asPair(household);
  const result = context.db
    .prepare(
      `INSERT INTO periods (start_date, end_date, closed_at, closed_by, formula, ratio_id, payer_id, recipient_id, deposit_cents, net_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      span.start,
      span.end,
      context.now().toISOString(),
      context.personId,
      figures.formula,
      figures.ratioId,
      pair?.payerId ?? null,
      pair?.recipientId ?? null,
      pair === null ? (household.deposits === null ? null : 0) : pair.depositCents,
      pair?.netCents ?? 0,
    );
  const periodId = Number(result.lastInsertRowid);
  if (pair !== null) return periodId;
  const deposit = context.db.prepare(
    "INSERT INTO settlement_deposits (period_id, person_id, deposit_cents) VALUES (?, ?, ?)",
  );
  for (const { personId, depositCents } of household.deposits ?? []) {
    deposit.run(periodId, personId, depositCents);
  }
  const transfer = context.db.prepare(
    "INSERT INTO settlement_transfers (period_id, from_id, to_id, cents) VALUES (?, ?, ?, ?)",
  );
  for (const { fromId, toId, cents } of household.transfers) {
    transfer.run(periodId, fromId, toId, cents);
  }
  return periodId;
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
      const computed = settlementFor(context.db, closed, start, request.end);
      if (computed === null) throw new AppError("RATIO_NOT_IN_EFFECT");
      return insertPeriod(context, { start, end: request.end }, computed);
    })
    .immediate();
  const stored = closedPeriods(context.db).find((period) => period.id === id);
  if (stored === undefined) throw new AppError("INTERNAL", "A closed period did not read back.");
  return stored;
}
