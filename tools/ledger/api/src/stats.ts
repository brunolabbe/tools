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
  splitByCategory,
} from "@ledger/books";
import type { SpendingEntry, SpendingSpan, StatRow } from "@ledger/books";
import type {
  Bucket,
  BufferStatsResponse,
  ContributionsResponse,
  FixedItemsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
  ReceiptItem,
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

interface ItemOfRow {
  row_id: number;
  date: string | null;
  price_cents: number;
  taxable: 0 | 1;
  deposit_cents: number | null;
  spending_category_id: number | null;
  share: ReceiptItem["share"];
}

/**
 * The receipts filed on joint-account rows, by row (lg-27): each one's date, for
 * the rates, and its items in the order printed. A receipt filed with no items
 * has no entry here, so its row is read whole.
 */
function receiptsOnRows(db: Database): Map<number, { date: string | null; items: ReceiptItem[] }> {
  const found = db
    .prepare(
      `SELECT receipt_filings.row_id, receipt_filings.date, receipt_items.price_cents,
              receipt_items.taxable, receipt_items.deposit_cents,
              receipt_items.spending_category_id, receipt_items.share
       FROM receipt_filings
       JOIN receipt_items ON receipt_items.filing_id = receipt_filings.id
       WHERE receipt_filings.row_id IS NOT NULL
       ORDER BY receipt_filings.id, receipt_items.position`,
    )
    .all() as ItemOfRow[];
  const byRow = new Map<number, { date: string | null; items: ReceiptItem[] }>();
  for (const item of found) {
    const held = byRow.get(item.row_id) ?? { date: item.date, items: [] };
    held.items.push({
      // The split does not read an item's words, and nothing here shows them.
      text: "",
      price: item.price_cents,
      taxable: item.taxable === 1,
      deposit: item.deposit_cents,
      spendingCategoryId: item.spending_category_id,
      share: item.share,
    });
    byRow.set(item.row_id, held);
  }
  return byRow;
}

/**
 * Spending: the period lines the cards paid, and the joint rows that took money
 * out of the buffer (or put a refund back). A row nobody has filed is not yet
 * known to be spending, so it waits in the inbox and is not counted. The
 * category of a row is what `listRows` answers — read, not recomputed — and a
 * period line's is its own `spendingCategoryId`, with its free text left in the
 * uncategorised detail.
 *
 * A joint-account row with a receipt filed on it (`receipt_filings.row_id`) and
 * at least one item is split by its items' categories instead (lg-27): each
 * category's cost is its items' own, taxes and deposits included, and what the
 * card was charged beyond that — rounding, any tip — goes to the largest
 * (`splitByCategory`). The row's own category is then not counted. A row stays
 * whole under its own category when it has no receipt, when its receipt has no
 * items, when a person gave the row a category of its own (an override wins), and
 * when the remainder would turn the largest category the other way round (a
 * partly paid basket, a refund row).
 */
export function spendingStats(
  db: Database,
  range: StatsRange,
  today: string,
): SpendingStatsResponse {
  return db.transaction(() => {
    const entries: SpendingEntry[] = [];
    const receipts = receiptsOnRows(db);
    for (const row of listRows(db, { spendingOnly: true, limit: Number.MAX_SAFE_INTEGER }).rows) {
      const documented = receipts.get(row.id);
      // A person's own category for the row wins over the receipt's items (the
      // owner's answer of 2026-10-17): the items are never edited, so the override
      // is the one way left to correct how the chart files a receipted row.
      const split =
        documented === undefined || row.spendingCategory?.source === "override"
          ? []
          : splitByCategory(-row.amountCents, documented);
      if (split.length === 0) {
        entries.push({
          date: row.date,
          amountCents: -row.amountCents,
          categoryId: row.spendingCategory?.id ?? null,
          label: row.category,
          source: "account",
        });
        continue;
      }
      for (const slice of split) {
        entries.push({
          date: row.date,
          amountCents: slice.cents,
          categoryId: slice.categoryId,
          label: row.category,
          source: "account",
        });
      }
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
