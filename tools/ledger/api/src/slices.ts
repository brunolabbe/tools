/**
 * How the spending chart files a joint-account row (lg-27), in one place so the
 * chart and the list opened from it cannot disagree (lg-28). `spendingStats` and
 * `listRows` both ask `chartedAs`; neither decides it again.
 */

import { splitByCategory } from "@ledger/books";
import type { CategoryAmount } from "@ledger/books";
import type { ReceiptItem, StoredRow } from "@ledger/contract";
import type { Database } from "better-sqlite3";

export interface ReceiptOnRow {
  date: string | null;
  items: ReceiptItem[];
}

interface ItemOfRow {
  row_id: number;
  date: string | null;
  price_cents: number;
  taxable: 0 | 1;
  deposit_cents: number | null;
  discount_cents: number | null;
  spending_category_id: number | null;
  share: ReceiptItem["share"];
}

/**
 * The receipts filed on joint-account rows, by row (lg-27): each one's date, for
 * the rates, and its items in the order printed. A receipt filed with no items
 * has no entry here, so its row is read whole.
 */
export function receiptsOnRows(db: Database): Map<number, ReceiptOnRow> {
  const found = db
    .prepare(
      `SELECT receipt_filings.row_id, receipt_filings.date, receipt_items.price_cents,
              receipt_items.taxable, receipt_items.deposit_cents, receipt_items.discount_cents,
              receipt_items.spending_category_id, receipt_items.share
       FROM receipt_filings
       JOIN receipt_items ON receipt_items.filing_id = receipt_filings.id
       WHERE receipt_filings.row_id IS NOT NULL
       ORDER BY receipt_filings.id, receipt_items.position`,
    )
    .all() as ItemOfRow[];
  const byRow = new Map<number, ReceiptOnRow>();
  for (const item of found) {
    const held = byRow.get(item.row_id) ?? { date: item.date, items: [] };
    held.items.push({
      // The split does not read an item's words, and nothing here shows them.
      text: "",
      price: item.price_cents,
      taxable: item.taxable === 1,
      deposit: item.deposit_cents,
      // A rebate folded into the item comes off its category with it (lg-89).
      discount: item.discount_cents,
      spendingCategoryId: item.spending_category_id,
      share: item.share,
      chargedTo: null,
    });
    byRow.set(item.row_id, held);
  }
  return byRow;
}

/** How one row is charted: the slices it makes, and whether a receipt divided it. */
export interface Charted {
  /** In spending's sign: money spent is positive, a refund negative. */
  slices: CategoryAmount[];
  split: boolean;
}

/**
 * How the spending chart files a row it counts. A row with a receipt filed on it
 * and at least one item is split by its items' categories: each category's cost
 * is its items' own, taxes and deposits included, and what the card was charged
 * beyond that — rounding, any tip — goes to the largest (`splitByCategory`). The
 * row's own category is then not counted. A row stays whole under its own
 * category when it has no receipt, when its receipt has no items, when a person
 * gave the row a category of its own (an override wins: the items are never
 * edited, so the override is the one way left to correct how the chart files a
 * receipted row, the owner's answer of 2026-10-17), and when the remainder would
 * turn the largest category the other way round (a partly paid basket, a refund
 * row).
 */
export function chartedAs(row: StoredRow, receipts: ReadonlyMap<number, ReceiptOnRow>): Charted {
  const documented = receipts.get(row.id);
  const slices =
    documented === undefined || row.spendingCategory?.source === "override"
      ? []
      : splitByCategory(-row.amountCents, documented);
  if (slices.length === 0) {
    return {
      slices: [{ categoryId: row.spendingCategory?.id ?? null, cents: -row.amountCents }],
      split: false,
    };
  }
  return { slices, split: true };
}
