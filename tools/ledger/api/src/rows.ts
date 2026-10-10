/**
 * The stored rows with their spending category (lg-15), and a row's own override.
 *
 * Kept apart from `spending-categories.ts` because it reads the rules, and the
 * rules read the list: this file is the one that depends on both.
 */

import { classify } from "@ledger/books";
import type { SpendingRule } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  Bucket,
  ClassificationSource,
  RowsResponse,
  SpendingCategoryOverrideRequest,
  SpendingCategoryOverrideResponse,
  StoredRow,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { currentRules } from "./rules.ts";
import type { RuleContext } from "./rules.ts";
import { requireSpendingCategory, spendingReader } from "./spending-categories.ts";

interface StoredRowColumns {
  id: number;
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
 * Stored rows, newest first, each with the classification that stands and the
 * spending category it now has. A row nobody has filed is read as the inbox
 * reads it: under the rule `classify` would file it by, if one does.
 */
export function listRows(
  db: Database,
  query: { uncategorised?: boolean; limit?: number; rowId?: number },
): RowsResponse {
  const reader = spendingReader(db);
  const rules = currentRules(db);
  const found = db
    .prepare(
      `SELECT r.id, r.date, r.category, r.description, r.amount_cents, r.balance_cents,
              c.bucket, c.person_id, c.rule_id, c.source
       FROM statement_rows r
       LEFT JOIN current_classifications c ON c.row_id = r.id
       WHERE ? IS NULL OR r.id = ?
       ORDER BY r.seq DESC`,
    )
    .all(query.rowId ?? null, query.rowId ?? null) as StoredRowColumns[];
  const rows = found.map((row): StoredRow => {
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
      id: row.id,
      date: row.date,
      category: row.category,
      description: row.description,
      amountCents: row.amount_cents,
      balanceCents: row.balance_cents,
      classification,
      spendingCategory: reader.of(row, rule),
    };
  });
  const matching =
    query.uncategorised === true ? rows.filter((row) => row.spendingCategory === null) : rows;
  return { rows: matching.slice(0, query.limit ?? 100), total: matching.length };
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
