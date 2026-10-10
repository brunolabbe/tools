/**
 * The history, as series (lg-9): everything the stats screen draws, computed
 * from rows that are already stored and stored nowhere itself.
 *
 * Pure like the rest of `books`: rows, salaries, ratios and periods in, points
 * out, no clock (a caller that wants "today" passes it) and no database. Money
 * is integer cents. The arithmetic that already exists is reused rather than
 * repeated — the mortgage bucket's own-money split is `splitCents`, the ratio in
 * effect is `ratioInEffect`, the fixed items' dates are `recurringDates`, the
 * period a date falls in is `periodIndexOf` — so a chart cannot disagree with
 * the home screen or with a settlement about the same figure.
 *
 * **A range trims what is shown, never what is counted.** A cumulative total
 * starts at the first row ever and a payment is compared with the one before it
 * wherever that was; `from` and `to` only choose which points are returned.
 * Both ends are inclusive and `null` is unbounded.
 */

import { BUCKETS } from "@ledger/contract";
import type {
  BufferDrop,
  BufferPoint,
  Bucket,
  ClosedPeriod,
  ContributionSeries,
  FixedItemSeries,
  MortgageOwnPoint,
  MortgagePaymentPoint,
  RatioChange,
  SalaryYear,
  SpendingByCategory,
  SpendingDetail,
  SpendingPeriod,
  StatsRange,
} from "@ledger/contract";
import { splitCents } from "./buckets.ts";
import { periodIndexOf, recurringDates } from "./periods.ts";
import type { PeriodSpan, RecurringInput } from "./periods.ts";
import { ratioInEffect } from "./ratio.ts";

/** A stored row as the series see it: filed under a bucket, and to a person or to nobody. */
export interface StatRow {
  id: number;
  /** `yyyy-mm-dd`. */
  date: string;
  description: string;
  amountCents: number;
  bucket: Bucket;
  /** `null` is joint. */
  personId: string | null;
}

export function inRange(date: string, range: StatsRange): boolean {
  return (range.from === null || date >= range.from) && (range.to === null || date <= range.to);
}

/** Stable, so rows of one day keep the account's order. */
function byDate<R extends { date: string }>(rows: readonly R[]): R[] {
  return rows.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function idsOf(people: readonly string[], rows: readonly StatRow[]): string[] {
  const ids = new Set(people);
  for (const row of rows) if (row.personId !== null) ids.add(row.personId);
  return [...ids].toSorted();
}

// --- The mortgage payment ---

/**
 * The payments out of the mortgage bucket: joint rows that take money out. A
 * payment is marked changed when its amount is not the one before it, and the
 * one before it is found over the whole history, so the first payment in a
 * range is still compared with the last payment ahead of it.
 */
export function mortgagePayments(
  rows: readonly StatRow[],
  range: StatsRange,
): MortgagePaymentPoint[] {
  const payments = byDate(
    rows.filter((row) => row.bucket === "mortgage" && row.personId === null && row.amountCents < 0),
  );
  const points: MortgagePaymentPoint[] = [];
  let previous: number | null = null;
  for (const row of payments) {
    const cents = -row.amountCents;
    if (inRange(row.date, range)) {
      points.push({
        date: row.date,
        cents,
        previousCents: previous,
        changed: previous !== null && previous !== cents,
      });
    }
    previous = cents;
  }
  return points;
}

// --- Salaries and the ratio ---

export interface SalaryRecord {
  personId: string;
  year: number;
  amountCents: number;
}

export interface RatioRecord {
  effectiveFrom: string;
  shares: readonly { personId: string; partsPerMillion: number }[];
}

function ratioChange(ratio: RatioRecord): RatioChange {
  return {
    effectiveFrom: ratio.effectiveFrom,
    shares: ratio.shares
      .map((share) => ({ personId: share.personId, partsPerMillion: share.partsPerMillion }))
      .toSorted((a, b) => (a.personId < b.personId ? -1 : 1)),
  };
}

/**
 * Each year that has a salary or a new ratio, with the salaries that stand, the
 * ratio in effect on its last day, and the ratios that took effect inside it.
 * The caller passes the records that stand: a corrected one is superseded.
 */
export function salariesByYear(
  salaries: readonly SalaryRecord[],
  ratios: readonly RatioRecord[],
  range: StatsRange,
): SalaryYear[] {
  const years = new Set<number>();
  for (const salary of salaries) years.add(salary.year);
  for (const ratio of ratios) years.add(Number(ratio.effectiveFrom.slice(0, 4)));
  const first = range.from === null ? -Infinity : Number(range.from.slice(0, 4));
  const last = range.to === null ? Infinity : Number(range.to.slice(0, 4));

  return [...years]
    .filter((year) => year >= first && year <= last)
    .toSorted((a, b) => a - b)
    .map((year): SalaryYear => {
      const atEnd = ratioInEffect(ratios, `${String(year).padStart(4, "0")}-12-31`);
      return {
        year,
        salaries: salaries
          .filter((salary) => salary.year === year)
          .map((salary) => ({ personId: salary.personId, amountCents: salary.amountCents }))
          .toSorted((a, b) => (a.personId < b.personId ? -1 : 1)),
        ratio: atEnd === null ? null : ratioChange(atEnd),
        changes: ratios
          .filter((ratio) => Number(ratio.effectiveFrom.slice(0, 4)) === year)
          .toSorted((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
          .map(ratioChange),
      };
    });
}

// --- What each person has put in ---

/** Every person any series names, in id order, so every point lists the same people. */
export function everyone(people: readonly string[], rows: readonly StatRow[]): string[] {
  return idsOf(people, rows);
}

/**
 * Each person's cumulative contributions to each bucket: the sum of the rows
 * filed to them, a return of money counting against them, as `bufferAsOf` has
 * it. A point is a day on which a row was filed to a person.
 */
export function contributionSeries(
  rows: readonly StatRow[],
  people: readonly string[],
  range: StatsRange,
): ContributionSeries[] {
  const ids = idsOf(people, rows);
  return BUCKETS.map((bucket): ContributionSeries => {
    const filed = byDate(rows.filter((row) => row.bucket === bucket));
    const totals = new Map<string, number>(ids.map((id) => [id, 0]));
    const points: ContributionSeries["points"] = [];
    for (let index = 0; index < filed.length;) {
      const date = filed[index]?.date ?? "";
      let touched = false;
      for (; filed[index]?.date === date; index++) {
        const row = filed[index];
        if (row === undefined || row.personId === null) continue;
        totals.set(row.personId, (totals.get(row.personId) ?? 0) + row.amountCents);
        touched = true;
      }
      if (touched && inRange(date, range)) {
        points.push({
          date,
          contributions: ids.map((personId) => ({
            personId,
            contributedCents: totals.get(personId) ?? 0,
          })),
        });
      }
    }
    return { bucket, points };
  });
}

/**
 * Each person's own money in the mortgage bucket at the end of each day it
 * moved: their deposits, and half of every joint row, with the odd cent split
 * once on the cumulative joint total — `mortgageAsOf`'s rule, kept running so a
 * long history is one pass instead of one pass per day.
 */
export function mortgageOwnSeries(
  rows: readonly StatRow[],
  people: readonly string[],
  range: StatsRange,
): MortgageOwnPoint[] {
  const filed = byDate(rows.filter((row) => row.bucket === "mortgage"));
  const known = new Set(people);
  const own = new Map<string, number>();
  let joint = 0;
  let balance = 0;
  const points: MortgageOwnPoint[] = [];
  for (let index = 0; index < filed.length;) {
    const date = filed[index]?.date ?? "";
    for (; filed[index]?.date === date; index++) {
      const row = filed[index];
      if (row === undefined) continue;
      balance += row.amountCents;
      if (row.personId === null) {
        joint += row.amountCents;
      } else {
        known.add(row.personId);
        own.set(row.personId, (own.get(row.personId) ?? 0) + row.amountCents);
      }
    }
    if (!inRange(date, range)) continue;
    const ids = [...known].toSorted();
    const halves = splitCents(joint, ids.length);
    points.push({
      date,
      balanceCents: balance,
      own: ids.map((personId, position) => ({
        personId,
        ownCents: (own.get(personId) ?? 0) + (halves[position] ?? 0),
      })),
    });
  }
  return points;
}

// --- The buffer ---

/**
 * The buffer's balance at the end of each day it moved, and the rows that took
 * `minDropCents` or more out of it in one go, each with the balance it left.
 */
export function bufferSeries(
  rows: readonly StatRow[],
  range: StatsRange,
  minDropCents: number,
): { points: BufferPoint[]; drops: BufferDrop[] } {
  const filed = byDate(rows.filter((row) => row.bucket === "current-expenses"));
  const points: BufferPoint[] = [];
  const drops: BufferDrop[] = [];
  let balance = 0;
  for (let index = 0; index < filed.length;) {
    const date = filed[index]?.date ?? "";
    for (; filed[index]?.date === date; index++) {
      const row = filed[index];
      if (row === undefined) continue;
      balance += row.amountCents;
      if (row.amountCents <= -minDropCents && inRange(date, range)) {
        drops.push({
          rowId: row.id,
          date,
          description: row.description,
          amountCents: row.amountCents,
          balanceAfterCents: balance,
        });
      }
    }
    if (inRange(date, range)) points.push({ date, balanceCents: balance });
  }
  return { points, drops };
}

// --- Spending ---

/**
 * One amount of spending. `categoryId` is the spending category (lg-15) as it was
 * read — a bank row's from `listRows`, a period line's own — and `null` charts as
 * uncategorised. `label` is what it came with, shown in the uncategorised detail.
 */
export interface SpendingEntry {
  date: string;
  /** Positive is money spent; a refund is negative. */
  amountCents: number;
  categoryId: number | null;
  label: string | null;
  source: "card" | "account";
}

export interface SpendingSpan extends PeriodSpan {
  open: boolean;
}

function overlaps(span: PeriodSpan, range: StatsRange): boolean {
  return (
    (range.to === null || span.start === null || span.start <= range.to) &&
    (range.from === null || span.end >= range.from)
  );
}

/**
 * Spending per period and per category. `spans` are the closed periods and then
 * the open one, oldest first; an entry belongs to the period `periodIndexOf`
 * puts its date in, so each is counted once, and one dated outside every period
 * is not counted. A period is returned when it overlaps the range, holding
 * everything dated inside it rather than trimmed at the range's edge. Its figure
 * is where the dates fall and not what its settlement counted: a line entered
 * after its period closed is here under its own date's period, while the
 * settlement counted it at the next close.
 *
 * Uncategorised carries its detail: what each amount was called where it came
 * from, because a line stored before lg-15 or imported by lg-7 has only that.
 */
export function spendingByPeriod(
  entries: readonly SpendingEntry[],
  spans: readonly SpendingSpan[],
  range: StatsRange,
): SpendingPeriod[] {
  interface Bucketed {
    cents: number;
    labels: Map<string | null, number>;
  }
  const perPeriod = spans.map(() => ({
    card: 0,
    account: 0,
    categories: new Map<number | null, Bucketed>(),
  }));
  for (const entry of entries) {
    const index = periodIndexOf(spans, entry.date);
    const slot = perPeriod[index];
    if (index < 0 || slot === undefined) continue;
    if (entry.source === "card") slot.card += entry.amountCents;
    else slot.account += entry.amountCents;
    const held = slot.categories.get(entry.categoryId) ?? { cents: 0, labels: new Map() };
    held.cents += entry.amountCents;
    held.labels.set(entry.label, (held.labels.get(entry.label) ?? 0) + entry.amountCents);
    slot.categories.set(entry.categoryId, held);
  }

  const result: SpendingPeriod[] = [];
  for (const [index, span] of spans.entries()) {
    const slot = perPeriod[index];
    if (slot === undefined || !overlaps(span, range)) continue;
    const categories = [...slot.categories.entries()]
      .toSorted(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
      .map(([categoryId, held]): SpendingByCategory => {
        if (categoryId !== null) return { categoryId, cents: held.cents };
        const detail: SpendingDetail[] = [...held.labels.entries()]
          .map(([label, cents]) => ({ label, cents }))
          .toSorted((a, b) => b.cents - a.cents || (a.label ?? "").localeCompare(b.label ?? ""));
        return { categoryId, cents: held.cents, detail };
      });
    result.push({
      start: span.start,
      end: span.end,
      open: span.open,
      totalCents: slot.card + slot.account,
      cardCents: slot.card,
      accountCents: slot.account,
      categories,
    });
  }
  return result;
}

// --- The fixed items ---

export interface FixedItemInput extends RecurringInput {
  label: string;
  monthlyCents: number;
}

/** `yyyy-mm` for each month from `first` through `last`, inclusive. */
function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const stop = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7));
  while (year * 12 + month <= stop) {
    months.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * What the recurring items generated, month by month, through `through` (the
 * range's end, or today). Versions of an item that share a label are one line,
 * so a payment that changed from some month on reads as a step in one series
 * rather than as two that never meet. Every label has a line, in the order the
 * labels first started, whatever the range: a label with nothing in the range is
 * a line of zeros, and a range with nothing at all is no months and no lines.
 */
export function fixedItemsByMonth(
  items: readonly FixedItemInput[],
  through: string,
  range: StatsRange,
): { months: string[]; series: FixedItemSeries[] } {
  // A label is one line, named as its earliest item names it and placed by the day
  // that item started — over every item given and not only the range, because a
  // chart colours a line by its place, so a range that leaves one out must not
  // move the others, and a new item comes after the old ones.
  const labels = new Map<string, { label: string; started: string }>();
  for (const item of items) {
    const key = item.label.trim().toLowerCase();
    const held = labels.get(key);
    if (held === undefined || item.startDate < held.started) {
      labels.set(key, { label: item.label.trim(), started: item.startDate });
    }
  }

  const generated = items.flatMap((item) =>
    recurringDates(item, through)
      .filter((date) => inRange(date, range))
      .map((date) => ({
        key: item.label.trim().toLowerCase(),
        month: date.slice(0, 7),
        cents: item.monthlyCents,
      })),
  );
  if (generated.length === 0) return { months: [], series: [] };
  const earliest = generated.reduce(
    (least, one) => (one.month < least ? one.month : least),
    "9999",
  );
  const months = monthsBetween(
    range.from === null ? earliest : range.from.slice(0, 7),
    through.slice(0, 7),
  );
  const position = new Map(months.map((month, index) => [month, index]));
  // Every label has a line, all zeros where the range holds nothing of it, so the
  // caller colours a line by its place in this whole list and a range that drops
  // an earlier item does not move the later ones up.
  const lines = new Map<string, FixedItemSeries>(
    [...labels.entries()].map(([key, held]) => [
      key,
      { label: held.label, cents: months.map(() => 0) },
    ]),
  );
  for (const one of generated) {
    const line = lines.get(one.key);
    const at = position.get(one.month);
    if (line !== undefined && at !== undefined) line.cents[at] = (line.cents[at] ?? 0) + one.cents;
  }
  return {
    months,
    series: [...lines.entries()]
      .toSorted(
        ([a], [b]) =>
          (labels.get(a)?.started ?? "").localeCompare(labels.get(b)?.started ?? "") ||
          a.localeCompare(b),
      )
      .map(([, line]) => line),
  };
}

// --- Settlements ---

/** The periods closed inside the range, oldest first, as they were recorded. */
export function settlementsInRange(
  periods: readonly ClosedPeriod[],
  range: StatsRange,
): ClosedPeriod[] {
  return periods
    .filter((period) => inRange(period.end, range))
    .toSorted((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.id - b.id));
}
