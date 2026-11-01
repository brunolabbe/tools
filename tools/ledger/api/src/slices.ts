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
  /** The items that stay shared, in the order printed: a person's are left out (lg-91). */
  items: ReceiptItem[];
  /**
   * What the charges to the pot filed from it stand at now (lg-91), in
   * spending's sign: the card lines that chart those items, which the row
   * therefore does not chart again. `0` when none was filed.
   */
  chargedCents: number;
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
  charge_line_id: number | null;
}

/**
 * The receipts filed on joint-account rows, by row (lg-27): each one's date, for
 * the rates, its shared items in the order printed, and what its charges to the
 * pot stand at. A receipt filed with no items has no entry here, so its row is
 * read whole.
 *
 * A charge to the pot is a period line, corrected and removed as any other is,
 * and the chart counts the line that stands (`spendingStats`). So the row gives
 * up what each charge's standing version holds — the filed line, or the newest
 * correction of it — and the row and its lines always chart the row's amount
 * between them. A charge since removed gives up nothing, and its items chart
 * with the row again, as shared ones.
 */
export function receiptsOnRows(db: Database): Map<number, ReceiptOnRow> {
  const found = db
    .prepare(
      `SELECT receipt_filings.row_id, receipt_filings.date, receipt_items.price_cents,
              receipt_items.taxable, receipt_items.deposit_cents, receipt_items.discount_cents,
              receipt_items.spending_category_id, receipt_items.share,
              receipt_items.charge_line_id
       FROM receipt_filings
       JOIN receipt_items ON receipt_items.filing_id = receipt_filings.id
       WHERE receipt_filings.row_id IS NOT NULL
       ORDER BY receipt_filings.id, receipt_items.position`,
    )
    .all() as ItemOfRow[];
  const standing = standingCharges(db);
  const byRow = new Map<number, ReceiptOnRow>();
  for (const item of found) {
    const held = byRow.get(item.row_id) ?? { date: item.date, items: [], chargedCents: 0 };
    byRow.set(item.row_id, held);
    // A person's item is charted by its charge's line while that stands, never
    // by the row (lg-91). One that came to nothing filed no line, and costs nothing.
    if (item.share === "theirs") {
      if (item.charge_line_id === null || standing.has(item.charge_line_id)) continue;
    }
    held.items.push({
      // The split does not read an item's words, and nothing here shows them.
      text: "",
      price: item.price_cents,
      taxable: item.taxable === 1,
      deposit: item.deposit_cents,
      // A rebate folded into the item comes off its category with it (lg-89).
      discount: item.discount_cents,
      spendingCategoryId: item.spending_category_id,
      // A charge removed: shared again, as far as the chart is concerned.
      share: "shared",
      chargedTo: null,
    });
  }
  const counted = new Set<number>();
  for (const item of found) {
    const held = byRow.get(item.row_id);
    if (held === undefined || item.charge_line_id === null || counted.has(item.charge_line_id)) {
      continue;
    }
    counted.add(item.charge_line_id);
    held.chargedCents += standing.get(item.charge_line_id) ?? 0;
  }
  return byRow;
}

/**
 * What each charge to the pot filed on a row stands at, by the line filed: that
 * line followed along its corrections to the version that stands, and none when
 * it has been removed. A line is superseded at most once
 * (`period_lines_supersedes`), so each chain is a path; the depth guard stops a
 * hand-edited cycle from running forever (lg-10 gate 2, N2).
 */
function standingCharges(db: Database): Map<number, number> {
  const found = db
    .prepare(
      `WITH RECURSIVE chain (filed, id, depth) AS (
         SELECT DISTINCT receipt_items.charge_line_id, receipt_items.charge_line_id, 0
         FROM receipt_filings
         JOIN receipt_items ON receipt_items.filing_id = receipt_filings.id
         WHERE receipt_filings.row_id IS NOT NULL AND receipt_items.charge_line_id IS NOT NULL
         UNION ALL
         SELECT chain.filed, newer.id, chain.depth + 1
         FROM period_lines newer JOIN chain ON newer.supersedes = chain.id
         WHERE chain.depth < 10000
       )
       SELECT chain.filed, standing.amount_cents AS cents
       FROM chain JOIN current_period_lines standing ON standing.id = chain.id`,
    )
    .all() as { filed: number; cents: number }[];
  return new Map(found.map(({ filed, cents }) => [filed, cents]));
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
 *
 * **Items charged to a person** (lg-91) are charted by their charge to the pot,
 * a card line, so the row leaves them out: it is split among its shared items
 * only, or kept whole, for its amount less what those charges stand at. A row
 * that gave anything up that way is `split`, so the list opened from the chart
 * carries the slice and not the row's whole amount.
 */
export function chartedAs(row: StoredRow, receipts: ReadonlyMap<number, ReceiptOnRow>): Charted {
  const documented = receipts.get(row.id);
  const charged = documented?.chargedCents ?? 0;
  const spent = -row.amountCents - charged;
  const slices =
    documented === undefined || row.spendingCategory?.source === "override"
      ? []
      : splitByCategory(spent, documented);
  if (slices.length === 0) {
    const whole = { categoryId: row.spendingCategory?.id ?? null, cents: spent };
    // Every item a person's, and nothing left over: the row charts nothing.
    return { slices: spent === 0 && charged !== 0 ? [] : [whole], split: charged !== 0 };
  }
  return { slices, split: true };
}
