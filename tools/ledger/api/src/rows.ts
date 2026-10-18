/**
 * The stored rows with their spending category (lg-15), and a row's own override.
 *
 * Kept apart from `spending-categories.ts` because it reads the rules, and the
 * rules read the list: this file is the one that depends on both.
 */

import { classify } from "@ledger/books";
import type { SpendingRule } from "@ledger/books";
import { AppError, JOINT_PERSON_FILTER } from "@ledger/contract";
import type {
  Bucket,
  ClassificationSource,
  RowBucketFilter,
  RowOrder,
  RowSort,
  RowsResponse,
  SpendingCategoryOverrideRequest,
  SpendingCategoryOverrideResponse,
  StoredRow,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { currentRules } from "./rules.ts";
import type { RuleContext } from "./rules.ts";
import { chartedAs, receiptsOnRows } from "./slices.ts";
import { requireSpendingCategory, spendingReader } from "./spending-categories.ts";

interface StoredRowColumns {
  id: number;
  seq: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
  /** The classification columns are all `null` for a row nobody has filed. */
  bucket: Bucket | null;
  person_id: string | null;
  rule_id: number | null;
  source: ClassificationSource | null;
}

/**
 * Whether the spending chart counts this row: filed to the current expenses and
 * to nobody, so a joint row that took money out of the buffer. One definition for
 * which rows the chart's sums and the list opened from them take in. How much of
 * a row goes to which category is `chartedAs`, which both ask, so a list opened
 * from the chart sums to its slice less the card lines in that slice.
 */
export function countsAsSpending(row: StoredRow): boolean {
  const filed = row.classification;
  return filed !== null && filed.bucket === "current-expenses" && filed.personId === null;
}

/**
 * Stored rows, newest first, each with the classification that stands and the
 * spending category it now has. A row nobody has filed is read as the inbox
 * reads it: under the rule `classify` would file it by, if one does.
 *
 * The days are narrowed in SQL, so a list of one period reads that period's rows
 * and not the whole account; the category is only known once each row has been
 * read, so it narrows after, and so do the history screen's narrowing and order
 * (lg-41): they ask the classification that stands, which SQL does not hold, and
 * a description's accents, which SQLite's `LIKE` does not fold.
 */
export function listRows(
  db: Database,
  query: {
    uncategorised?: boolean;
    spendingCategoryId?: number;
    from?: string;
    to?: string;
    spendingOnly?: boolean;
    q?: string;
    bucket?: RowBucketFilter;
    person?: string;
    direction?: "in" | "out";
    minCents?: number;
    maxCents?: number;
    sort?: RowSort;
    order?: RowOrder;
    offset?: number;
    limit?: number;
    rowId?: number;
  },
): RowsResponse {
  const reader = spendingReader(db);
  const rules = currentRules(db);
  const found = db
    .prepare(
      `SELECT r.id, r.seq, r.date, r.category, r.description, r.amount_cents, r.balance_cents,
              c.bucket, c.person_id, c.rule_id, c.source
       FROM statement_rows r
       LEFT JOIN current_classifications c ON c.row_id = r.id
       WHERE (? IS NULL OR r.id = ?)
         AND (? IS NULL OR r.date >= ?)
         AND (? IS NULL OR r.date <= ?)
       ORDER BY r.seq DESC`,
    )
    .all(
      query.rowId ?? null,
      query.rowId ?? null,
      query.from ?? null,
      query.from ?? null,
      query.to ?? null,
      query.to ?? null,
    ) as StoredRowColumns[];
  const kept = found.map((row): SeqRow => {
    const classification =
      row.bucket === null || row.source === null
        ? null
        : { bucket: row.bucket, personId: row.person_id, source: row.source };
    let rule: SpendingRule | null = null;
    if (classification !== null) {
      rule = reader.citedRule(row.rule_id);
    } else {
      const match = classify(
        { category: row.category, description: row.description, amountCents: row.amount_cents },
        rules,
      );
      if (match.kind === "classified") rule = match.rule;
    }
    return {
      seq: row.seq,
      row: {
        id: row.id,
        date: row.date,
        category: row.category,
        description: row.description,
        amountCents: row.amount_cents,
        balanceCents: row.balance_cents,
        classification,
        spendingCategory: reader.of(row, rule),
      },
    };
  });
  const rows = orderRows(narrowRows(kept, query), query);
  const counted = rows.filter((row) => query.spendingOnly !== true || countsAsSpending(row));
  const inCategory = query.uncategorised === true || query.spendingCategoryId !== undefined;
  const matching =
    query.spendingOnly === true && inCategory
      ? sliceEntries(db, counted, query)
      : counted
          .filter((row) => query.uncategorised !== true || row.spendingCategory === null)
          .filter(
            (row) =>
              query.spendingCategoryId === undefined ||
              row.spendingCategory?.id === query.spendingCategoryId,
          );
  const first = query.offset ?? 0;
  return { rows: matching.slice(first, first + (query.limit ?? 100)), total: matching.length };
}

/** A row with its place in the statement, which no response carries. */
interface SeqRow {
  row: StoredRow;
  seq: number;
}

const MARKS = /\p{M}/gu;

/** Lower case with the accents taken off, so `epicerie` finds `ÉPICERIE`. */
function fold(text: string): string {
  return text.normalize("NFD").replace(MARKS, "").toLowerCase();
}

/** The history screen's narrowing (lg-41); every field absent keeps every row. */
function narrowRows(
  rows: readonly SeqRow[],
  query: {
    q?: string;
    bucket?: RowBucketFilter;
    person?: string;
    direction?: "in" | "out";
    minCents?: number;
    maxCents?: number;
  },
): SeqRow[] {
  const needle = query.q === undefined ? undefined : fold(query.q);
  return rows.filter(({ row }) => {
    const filed = row.classification;
    const size = Math.abs(row.amountCents);
    if (needle !== undefined && !fold(row.description).includes(needle)) return false;
    if (query.bucket !== undefined) {
      if (query.bucket === "unfiled" ? filed !== null : filed?.bucket !== query.bucket) {
        return false;
      }
    }
    if (query.person !== undefined) {
      const owner = query.person === JOINT_PERSON_FILTER ? null : query.person;
      if (filed === null || filed.personId !== owner) return false;
    }
    if (query.direction === "in" && row.amountCents <= 0) return false;
    if (query.direction === "out" && row.amountCents >= 0) return false;
    if (query.minCents !== undefined && size < query.minCents) return false;
    if (query.maxCents !== undefined && size > query.maxCents) return false;
    return true;
  });
}

/**
 * The order asked for, or newest first by `seq` as ever. Every sort ends on `seq`
 * in its own direction, which is unique, so two pages of one sorted list never
 * repeat or skip a row.
 */
function orderRows(
  rows: readonly SeqRow[],
  query: { sort?: RowSort; order?: RowOrder },
): StoredRow[] {
  if (query.sort === undefined && query.order === undefined) return rows.map(({ row }) => row);
  const sign = query.order === "asc" ? 1 : -1;
  const keyOf = {
    date: (entry: SeqRow) => entry.row.date,
    amount: (entry: SeqRow) => entry.row.amountCents,
    description: (entry: SeqRow) => fold(entry.row.description),
  }[query.sort ?? "date"];
  // Plain comparison and not `localeCompare`, whose answer depends on the host's ICU data.
  return rows
    .map((entry) => ({ entry, key: keyOf(entry) }))
    .toSorted((a, b) => {
      if (a.key !== b.key) return (a.key < b.key ? -1 : 1) * sign;
      return (a.entry.seq - b.entry.seq) * sign;
    })
    .map(({ entry }) => entry.row);
}

/**
 * What a list opened from the chart's slice holds (lg-28): each row under every
 * category the chart charts it under, the one `chartedAs` that `spendingStats`
 * asks too. A row charted whole is the row itself; one a receipt divided is a copy
 * carrying the slice in `sliceCents`, signed as `amountCents` is. Only the chart's
 * own list is read this way: the screen that works through the uncategorised rows
 * is about each row's own category, which a split row does not lose.
 */
function sliceEntries(
  db: Database,
  counted: readonly StoredRow[],
  query: { uncategorised?: boolean; spendingCategoryId?: number },
): StoredRow[] {
  const receipts = receiptsOnRows(db);
  const entries: StoredRow[] = [];
  for (const row of counted) {
    const charted = chartedAs(row, receipts);
    for (const slice of charted.slices) {
      if (query.uncategorised === true && slice.categoryId !== null) continue;
      if (query.spendingCategoryId !== undefined && slice.categoryId !== query.spendingCategoryId) {
        continue;
      }
      entries.push(charted.split ? { ...row, sliceCents: -slice.cents } : row);
    }
  }
  return entries;
}

/** Appends a row's own spending category; `null` withdraws it. */
export function setSpendingCategoryOverride(
  context: RuleContext,
  request: SpendingCategoryOverrideRequest,
): SpendingCategoryOverrideResponse {
  context.db
    .transaction(() => {
      const row = context.db
        .prepare("SELECT id FROM statement_rows WHERE id = ?")
        .get(request.rowId) as { id: number } | undefined;
      if (row === undefined) throw new AppError("ROW_NOT_FOUND");
      requireSpendingCategory(context.db, request.spendingCategoryId);
      context.db
        .prepare(
          `INSERT INTO spending_category_overrides (row_id, spending_category_id, set_at, set_by)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          request.rowId,
          request.spendingCategoryId,
          context.now().toISOString(),
          context.personId,
        );
    })
    .immediate();
  const [stored] = listRows(context.db, { rowId: request.rowId }).rows;
  return { rowId: request.rowId, spendingCategory: stored?.spendingCategory ?? null };
}
