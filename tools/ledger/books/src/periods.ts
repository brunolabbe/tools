/**
 * Periods of shared spending on personal cards, and what closing one settles
 * (lg-6, `docs/00-ANALYSIS.md` §5 and §6).
 *
 * **A period holds what is dated inside it.** Nothing is filed *into* a period:
 * a line, a deposit and a charge each carry a date, and a period is a stretch of
 * days. So a recurring item generates one dated line per month, and a period
 * spanning a new year holds exactly the months it covers, which is the month
 * arithmetic the workbook got wrong two ways (§6).
 *
 * **Cumulative.** Closing a period settles everything since the two were last
 * even, which is the start of the first period: every shared line, every charge
 * and every deposit into the buffer from then to the end of the period being
 * closed. Each is weighed at the ratio of the period it falls in — for a closed
 * period, the ratio its settlement recorded; for the one being closed, the
 * ratio in effect on its last day (§5, a ratio change takes effect at a period
 * boundary). An earlier settlement that asked too little, or a deposit never
 * made, is therefore caught up by the next close with no special case.
 *
 * **Except a settlement's own deposit** (lg-13). A deposit `matchDeposits` has
 * matched to a closed period is counted when its date says, like any other, but
 * it is weighed in **that period's stretch**, at the ratio its settlement
 * recorded. The deposit was asked for as that period's debt divided by that
 * ratio's share, so weighed at the same ratio it cancels the debt exactly; weighed
 * at the ratio of the period its date falls in — nearly always a later one, since
 * it is dated on or after the period's last day — it would leave a difference
 * whenever the ratio changed at the boundary.
 */

import type { DepositStatus } from "@ledger/contract";
import { daysInMonth } from "./months.ts";
import type { Share } from "./ratio.ts";
import { CURRENT_FORMULA, settleStretches } from "./settlement.ts";
import type { Charge, PersonCents, Settlement, Stretch } from "./settlement.ts";

/** A period's days, `yyyy-mm-dd`. `start: null` is the first period, from the beginning. */
export interface PeriodSpan {
  start: string | null;
  end: string;
}

/** A period and the ratio its stretch is weighed at. */
export interface WeighedPeriod extends PeriodSpan {
  ratio: readonly Share[];
}

/** A line paid on someone's own card: shared, or charged in full to the other. */
export interface LineInput {
  personId: string;
  date: string;
  amountCents: number;
  /** `null` is shared at the ratio; a person is who owes the whole of it. */
  chargedTo: string | null;
}

/** Money a person put into the buffer: a current-expenses row filed to them. */
export interface DepositInput {
  personId: string;
  date: string;
  amountCents: number;
  /**
   * The last day of the closed period whose settlement this deposit was
   * matched to (`matchDeposits`), which weighs it at that period's ratio.
   * Absent or `null` for every other deposit, weighed by its date.
   */
  settles?: string | null;
}

/** A fixed monthly item, as it stands. */
export interface RecurringInput {
  startDate: string;
  endDate: string | null;
}

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The next calendar day. */
export function dayAfter(date: string): string {
  const [year, month, day] = parts(date);
  if (day < daysInMonth(year, month)) return format(year, month, day + 1);
  return month === 12 ? format(year + 1, 1, 1) : format(year, month + 1, 1);
}

/**
 * The dates a recurring item generates a line on, through `through`: one a
 * month from its start, on the start's day of the month, or on the month's last
 * day when the month is shorter, and none after its end date.
 */
export function recurringDates(item: RecurringInput, through: string): string[] {
  const last = item.endDate !== null && item.endDate < through ? item.endDate : through;
  const [startYear, startMonth, day] = parts(item.startDate);
  const dates: string[] = [];
  for (let index = 0; ; index++) {
    const months = startMonth - 1 + index;
    const year = startYear + Math.floor(months / 12);
    const month = (months % 12) + 1;
    const date = format(year, month, Math.min(day, daysInMonth(year, month)));
    if (date > last) return dates;
    dates.push(date);
  }
}

/**
 * Which of `periods` (oldest first) a date falls in: the first whose end is on
 * or after it. `-1` before the first period's start, or after the last's end.
 * A date in a gap between two periods goes to the later one, and one in an
 * overlap to the earlier, so every dated amount is counted exactly once.
 */
export function periodIndexOf(periods: readonly PeriodSpan[], date: string): number {
  const first = periods[0];
  if (first === undefined || (first.start !== null && date < first.start)) return -1;
  return periods.findIndex((period) => date <= period.end);
}

/** A closed period, and the instant it was closed. */
export interface ClosedSpan extends PeriodSpan {
  /** ISO instant. */
  closedAt: string;
}

/**
 * Whether an amount dated `date` inside a closed period was first entered
 * after the **last** close: no settlement has counted it yet, so the next close
 * does, and the open period lists it as late. Once a later close has counted
 * it, it is late no longer, though it arrived after its own period closed.
 * "First entered" is the start of its chain of corrections: a correction of
 * something that was on time is not late, though it is entered later.
 */
export function enteredLate(
  closed: readonly ClosedSpan[],
  date: string,
  firstEnteredAt: string,
): boolean {
  if (closed[periodIndexOf(closed, date)] === undefined) return false;
  const lastClose = closed.reduce(
    (latest, period) => (period.closedAt > latest ? period.closedAt : latest),
    "",
  );
  return firstEnteredAt > lastClose;
}

/**
 * The settlement closing the last of `periods` (oldest first, the first one
 * being where the two were last even) computes: every line and deposit dated in
 * any of them, each weighed at its own period's ratio — a deposit that `settles`
 * a period at that period's — and the total divided by the recipient's share at
 * the last period's ratio.
 */
export function cumulativeSettlement(
  periods: readonly WeighedPeriod[],
  lines: readonly LineInput[],
  deposits: readonly DepositInput[],
): Settlement {
  const closing = periods.at(-1);
  if (closing === undefined) {
    return {
      formula: CURRENT_FORMULA,
      payerId: null,
      recipientId: null,
      depositCents: 0,
      netCents: 0,
    };
  }
  const contributions: PersonCents[][] = periods.map(() => []);
  const charges: Charge[][] = periods.map(() => []);
  for (const line of lines) {
    const index = periodIndexOf(periods, line.date);
    if (index < 0) continue;
    if (line.chargedTo === null) {
      contributions[index]?.push({ personId: line.personId, cents: line.amountCents });
    } else {
      charges[index]?.push({
        owedBy: line.chargedTo,
        owedTo: line.personId,
        cents: line.amountCents,
      });
    }
  }
  for (const deposit of deposits) {
    // Whether it counts at all is its date's to say, matched or not: the open
    // period as of a day leaves out what is dated after it.
    const dated = periodIndexOf(periods, deposit.date);
    if (dated < 0) continue;
    const settled =
      deposit.settles === undefined || deposit.settles === null
        ? -1
        : periodIndexOf(periods, deposit.settles);
    const index = settled >= 0 ? settled : dated;
    contributions[index]?.push({ personId: deposit.personId, cents: deposit.amountCents });
  }
  const stretches: Stretch[] = periods.map((period, index) => ({
    ratio: period.ratio,
    contributions: contributions[index] ?? [],
    charges: charges[index] ?? [],
  }));
  return settleStretches(stretches, closing.ratio);
}

/** A closed period's recorded settlement, as the matcher needs it. */
export interface Expectation {
  periodId: number;
  /** The period's last day: the deposit is dated on or after it. */
  end: string;
  payerId: string | null;
  depositCents: number | null;
}

/** A current-expenses row filed to a person, which could be a settlement's deposit. */
export interface CandidateRow {
  id: number;
  date: string;
  amountCents: number;
  personId: string;
}

export interface DepositMatch {
  periodId: number;
  status: DepositStatus;
  /** The row that brought the deposit in, when `status` is `matched`. */
  rowId: number | null;
}

/**
 * What became of each closed period's expected deposit (`expectations` oldest
 * first; `rows` in the account's order).
 *
 * A deposit is **matched** by a row filed to the payer in the buffer, dated on
 * or after the period's end, for the expected amount within a cent. Each row
 * matches one deposit at most, and **the newest expectation chooses first**:
 * a close is cumulative, so when an earlier deposit was never made the later
 * close asks for it again, and the one payment that follows settles the later
 * close, not the earlier. A deposit made on time is dated before the later
 * period ends, where the later close cannot take it.
 *
 * One not matched is **expected** while its period is the last closed, and
 * **folded** once a later period has closed, since that close asked for it
 * again. `none` is a period that settled at nothing, and `direct` one whose
 * recipient's share was zero, which no deposit into shared money can settle.
 */
export function matchDeposits(
  expectations: readonly Expectation[],
  rows: readonly CandidateRow[],
): DepositMatch[] {
  const taken = new Set<number>();
  const matches = expectations.map((expectation, index): DepositMatch => {
    const { periodId, payerId, depositCents } = expectation;
    if (payerId === null) return { periodId, status: "none", rowId: null };
    if (depositCents === null) return { periodId, status: "direct", rowId: null };
    const last = index === expectations.length - 1;
    return { periodId, status: last ? "expected" : "folded", rowId: null };
  });
  for (let index = expectations.length - 1; index >= 0; index--) {
    const expectation = expectations[index];
    const match = matches[index];
    if (expectation === undefined || match === undefined) continue;
    if (match.status !== "expected" && match.status !== "folded") continue;
    const { payerId, depositCents, end } = expectation;
    const row = rows.find(
      (candidate) =>
        !taken.has(candidate.id) &&
        candidate.personId === payerId &&
        candidate.date >= end &&
        depositCents !== null &&
        Math.abs(candidate.amountCents - depositCents) <= 1,
    );
    if (row === undefined) continue;
    taken.add(row.id);
    matches[index] = { ...match, status: "matched", rowId: row.id };
  }
  return matches;
}
