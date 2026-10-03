/**
 * Classifying stored rows, and the inbox of those nobody has (lg-4).
 *
 * **A classification is a record about a row, never a column on it.** Every
 * answer is an `INSERT`; reclassifying appends another and the earlier ones
 * stay, so what was once believed about a row is still there. The latest
 * stands, by `id`, which is the `current_classifications` view.
 *
 * - **On paste**, each row the paste added is run through `classify` against the
 *   rules in force, in the same transaction that stored it. A row with exactly
 *   one matching rule is classified by it; every other row has no record, and
 *   *no record is what the inbox is*.
 * - **A person** accepts a suggested rule or answers with a person and a bucket.
 *   Either is a new record, for any row, classified or not.
 *
 * Nothing here reclassifies a row on its own after the paste: a rule added later
 * is offered as a suggestion on the rows it now matches, and a person takes it.
 */

import { classify } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  Bucket,
  ClassificationRecord,
  ClassificationSource,
  ClassifyRequest,
  InboxRow,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { currentRules, requireKnownPerson } from "./rules.ts";
import type { RuleContext } from "./rules.ts";

interface RowColumns {
  id: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
}

interface RecordColumns {
  id: number;
  row_id: number;
  bucket: Bucket;
  person_id: string | null;
  rule_id: number | null;
  source: ClassificationSource;
  classified_at: string;
  classified_by: string;
}

function toRecord(columns: RecordColumns): ClassificationRecord {
  return {
    id: columns.id,
    rowId: columns.row_id,
    bucket: columns.bucket,
    personId: columns.person_id,
    ruleId: columns.rule_id,
    source: columns.source,
    classifiedAt: columns.classified_at,
    classifiedBy: columns.classified_by,
  };
}

/** Appends one record. The only write to `classifications` in this tool. */
function append(
  context: Pick<RuleContext, "db" | "personId" | "now">,
  rowId: number,
  answer: { bucket: Bucket; personId: string | null; ruleId: number | null },
  source: ClassificationSource,
): ClassificationRecord {
  const result = context.db
    .prepare(
      `INSERT INTO classifications (row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      answer.bucket,
      answer.personId,
      answer.ruleId,
      source,
      context.now().toISOString(),
      context.personId,
    );
  return toRecord(
    context.db
      .prepare("SELECT * FROM classifications WHERE id = ?")
      .get(result.lastInsertRowid) as RecordColumns,
  );
}

/** The highest stored row id, or 0 for an empty history. Taken before a paste stores. */
export function lastRowId(db: Database): number {
  return (
    db.prepare("SELECT coalesce(max(id), 0) AS id FROM statement_rows").get() as { id: number }
  ).id;
}

/**
 * Classifies the rows stored after `afterRowId` — a paste's own — by the rules in
 * force, taking a rule only on an exact match. Runs inside the paste's
 * transaction. Returns how many rows took a rule; the rest are the inbox.
 */
export function classifyAdded(
  context: Pick<RuleContext, "db" | "personId" | "now">,
  afterRowId: number,
): number {
  const rules = currentRules(context.db);
  if (rules.length === 0) return 0;
  const rows = context.db
    .prepare(
      "SELECT id, category, description, amount_cents FROM statement_rows WHERE id > ? ORDER BY seq",
    )
    .all(afterRowId) as RowColumns[];
  let classified = 0;
  for (const row of rows) {
    const match = classify(
      { category: row.category, description: row.description, amountCents: row.amount_cents },
      rules,
    );
    if (match.kind !== "classified") continue;
    const { bucket, personId, id } = match.rule;
    append(context, row.id, { bucket, personId, ruleId: id }, "rule");
    classified += 1;
  }
  return classified;
}

/** Every stored row with no classification, newest first, each with its nearest rule. */
export function inbox(db: Database): InboxRow[] {
  const rules = currentRules(db);
  const rows = db
    .prepare(
      `SELECT id, date, category, description, amount_cents, balance_cents
       FROM statement_rows
       WHERE NOT EXISTS (SELECT 1 FROM classifications WHERE classifications.row_id = statement_rows.id)
       ORDER BY seq DESC`,
    )
    .all() as RowColumns[];
  return rows.map((row): InboxRow => {
    const match = classify(
      { category: row.category, description: row.description, amountCents: row.amount_cents },
      rules,
    );
    const shown = {
      id: row.id,
      date: row.date,
      category: row.category,
      description: row.description,
      amountCents: row.amount_cents,
      balanceCents: row.balance_cents,
    };
    // A row can be here while one rule matches it exactly only if the rule came
    // after the paste, which is its own reason: the suggestion is a sure one.
    return match.kind === "classified"
      ? { ...shown, reason: "matches", suggestion: match.rule, matching: [match.rule] }
      : { ...shown, reason: match.reason, suggestion: match.suggestion, matching: match.matching };
  });
}

/** How many rows are waiting, for the number beside the inbox. */
export function inboxCount(db: Database): number {
  return (
    db
      .prepare(
        `SELECT count(*) AS n FROM statement_rows
         WHERE NOT EXISTS (SELECT 1 FROM classifications WHERE classifications.row_id = statement_rows.id)`,
      )
      .get() as { n: number }
  ).n;
}

/** A person's answer: classify a row, or classify it again. */
export function classifyRow(context: RuleContext, request: ClassifyRequest): ClassificationRecord {
  return context.db
    .transaction(() => {
      const row = context.db
        .prepare("SELECT id FROM statement_rows WHERE id = ?")
        .get(request.rowId) as { id: number } | undefined;
      if (row === undefined) throw new AppError("ROW_NOT_FOUND");

      if ("ruleId" in request) {
        const rule = context.db
          .prepare("SELECT id, bucket, person_id FROM current_rules WHERE id = ?")
          .get(request.ruleId) as Pick<RecordColumns, "id" | "bucket" | "person_id"> | undefined;
        if (rule === undefined) throw new AppError("RULE_NOT_FOUND");
        return append(
          context,
          row.id,
          { bucket: rule.bucket, personId: rule.person_id, ruleId: rule.id },
          "accepted",
        );
      }
      requireKnownPerson(context.people, request.personId);
      return append(
        context,
        row.id,
        { bucket: request.bucket, personId: request.personId, ruleId: null },
        "manual",
      );
    })
    .immediate();
}
