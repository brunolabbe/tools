/**
 * The history, gathered (lg-9): what the stats screen draws, read from what is
 * already stored and stored nowhere itself.
 *
 * The arithmetic is `books/src/stats.ts`; this file only gathers its input and
 * attaches the names a chart needs. Every series is recomputed on each read, in
 * one read transaction, so a paste landing between two queries cannot make a
 * series disagree with itself. A row counts under the classification that
 * **currently** stands, as `bucketsAsOf` has it, so reclassifying a row moves it
 * through the whole history at once.
 */

import {
  bufferSeries,
  contributionSeries,
  dayAfter,
  everyone,
  fixedItemsByMonth,
  mortgageOwnSeries,
  mortgagePayments,
  salariesByYear,
  settlementsInRange,
  spendingByPeriod,
} from "@ledger/books";
import type { SpendingEntry, SpendingSpan, StatRow } from "@ledger/books";
import type {
  Bucket,
  BufferStatsResponse,
  ContributionsResponse,
  FixedItemsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
  SalariesStatsResponse,
  SettlementsStatsResponse,
  SpendingStatsResponse,
  StatsRange,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { closedPeriods, currentLines, currentRecurring } from "./periods.ts";
import { knownPeople } from "./people.ts";
import { listRows } from "./rows.ts";
import { currentRatios, currentSalaries } from "./salaries.ts";
import { spendingCategories } from "./spending-categories.ts";

interface FiledColumns {
  id: number;
  date: string;
  description: string;
  amount_cents: number;
  bucket: Bucket;
  person_id: string | null;
}

/** Every classified row, in the account's order. A row nobody has filed is in no bucket yet. */
function filedRows(db: Database): StatRow[] {
  return (
    db
      .prepare(
        `SELECT statement_rows.id, statement_rows.date, statement_rows.description,
                statement_rows.amount_cents, current_classifications.bucket, current_classifications.person_id
         FROM statement_rows
         JOIN current_classifications ON current_classifications.row_id = statement_rows.id
         ORDER BY statement_rows.seq`,
      )
      .all() as FiledColumns[]
  ).map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description,
    amountCents: row.amount_cents,
    bucket: row.bucket,
    personId: row.person_id,
  }));
}

export function mortgagePaymentsStats(db: Database, range: StatsRange): MortgagePaymentsResponse {
  return db.transaction(() => ({ range, payments: mortgagePayments(filedRows(db), range) }))();
}

export function salariesStats(db: Database, range: StatsRange): SalariesStatsResponse {
  return db.transaction(() => ({
    range,
    people: knownPeople(db),
    years: salariesByYear(currentSalaries(db), currentRatios(db), range),
  }))();
}

export function contributionsStats(db: Database, range: StatsRange): ContributionsResponse {
  return db.transaction(() => {
    const rows = filedRows(db);
    const people = knownPeople(db);
    return {
      range,
      people: everyone(people, rows),
      series: contributionSeries(rows, people, range),
    };
  })();
}

export function mortgageOwnStats(db: Database, range: StatsRange): MortgageOwnResponse {
  return db.transaction(() => {
    const rows = filedRows(db);
    const people = knownPeople(db);
    return {
      range,
      people: everyone(people, rows),
      points: mortgageOwnSeries(rows, people, range),
    };
  })();
}

export function bufferStats(
  db: Database,
  range: StatsRange,
  minDropCents: number,
): BufferStatsResponse {
  return db.transaction(() => ({
    range,
    minDropCents,
    ...bufferSeries(filedRows(db), range, minDropCents),
  }))();
}

/**
 * Spending: the period lines the cards paid, and the joint rows that took money
 * out of the buffer (or put a refund back). A row nobody has filed is not yet
 * known to be spending, so it waits in the inbox and is not counted. The
 * category of a row is what `listRows` answers — read, not recomputed — and a
 * period line's is its own `spendingCategoryId`, with its free text left in the
 * uncategorised detail.
 *
 * A joint-account row with a receipt attached is split by its receipt items'
 * categories once lg-10 lands, and its own category is then not counted; no
 * receipt is stored yet, so every row here is whole.
 */
export function spendingStats(
  db: Database,
  range: StatsRange,
  today: string,
): SpendingStatsResponse {
  return db.transaction(() => {
    const entries: SpendingEntry[] = [];
    for (const row of listRows(db, { limit: Number.MAX_SAFE_INTEGER }).rows) {
      const filed = row.classification;
      if (filed === null || filed.bucket !== "current-expenses" || filed.personId !== null)
        continue;
      entries.push({
        date: row.date,
        amountCents: -row.amountCents,
        categoryId: row.spendingCategory?.id ?? null,
        label: row.category,
        source: "account",
      });
    }
    for (const line of currentLines(db)) {
      entries.push({
        date: line.date,
        amountCents: line.amountCents,
        categoryId: line.spendingCategoryId,
        label: line.category,
        source: "card",
      });
    }

    const closed = closedPeriods(db).toReversed();
    const last = closed.at(-1);
    const through = range.to ?? today;
    const spans: SpendingSpan[] = closed.map((period) => ({
      start: period.start,
      end: period.end,
      open: false,
    }));
    // The open period starts the day after the last close; before it has begun
    // there is nothing to show, and an end before its start would catch nothing.
    const openStart = last === undefined ? null : dayAfter(last.end);
    if (openStart === null || through >= openStart) {
      spans.push({ start: openStart, end: through, open: true });
    }

    const periods = spendingByPeriod(entries, spans, range);
    // The whole list, not only the categories with an amount in this range: a
    // chart colours a category by its place in the list, so a range that leaves
    // one out must not move the others up.
    return {
      range,
      categories: spendingCategories(db).map((category) => ({
        id: category.id,
        name: category.name,
        retired: category.retired,
      })),
      periods,
    };
  })();
}

export function fixedItemsStats(
  db: Database,
  range: StatsRange,
  today: string,
): FixedItemsResponse {
  return db.transaction(() => ({
    range,
    ...fixedItemsByMonth(currentRecurring(db), range.to ?? today, range),
  }))();
}

export function settlementsStats(db: Database, range: StatsRange): SettlementsStatsResponse {
  return db.transaction(() => ({ range, periods: settlementsInRange(closedPeriods(db), range) }))();
}
