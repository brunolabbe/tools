/**
 * Classifying stored rows, and the inbox of those nobody has (lg-4).
 *
 * **A classification is a record about a row, never a column on it.** Every
 * answer is an `INSERT`; reclassifying appends another and the earlier ones
 * stay, so what was once believed about a row is still there. The latest
 * stands, by `id`, which is the `current_classifications` view.
 *
 * - **On paste**, each row the paste added is run through `classify` against the
 *   rules in force, in the same transaction that stored it. A row the most
 *   specific matching rules agree on is classified by them; every other row has
 *   no record, and *no record is what the inbox is*.
 * - **On paste, history files** a row no rule's pattern matches, when the
 *   latest three person-given answers for its description agree and its amount
 *   fits theirs (`autoFile`, lg-17). That record is `auto`, names the three it
 *   rests on and no person, and leaves the row out of the inbox and in the
 *   review list (`autoFiled`) until a person's answer supersedes it.
 * - **A person** accepts a suggested rule or answers with a person and a bucket.
 *   Either is a new record, for any row, classified or not.
 *
 * Nothing here reclassifies a row on its own after the paste: a rule added later
 * is offered as a suggestion on the rows it now matches, and a person takes it,
 * and an answer given later files no row that is already waiting.
 */

import { autoFile, classify, fromHistory, normalizeDescription } from "@ledger/books";
import type { AutoFiling, HistoryAnswer } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  AutoFiledRow,
  AutoFilingGround,
  Bucket,
  ClassificationRecord,
  ClassifyRequest,
  InboxRow,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { currentRules, requireKnownPerson } from "./rules.ts";
import type { RuleContext } from "./rules.ts";
import { spendingReader } from "./spending-categories.ts";

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
  /** Only ever a person's: `append` is the only writer this type reads back. */
  source: ClassificationRecord["source"];
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

/**
 * Appends one record by a person or by a rule. With `appendAutomatic`, the only
 * writes to `classifications` in this tool.
 */
function append(
  context: Pick<RuleContext, "db" | "personId" | "now">,
  rowId: number,
  answer: { bucket: Bucket; personId: string | null; ruleId: number | null },
  source: ClassificationRecord["source"],
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

/**
 * Appends history's own filing (lg-17): no rule, no person as its author, and the
 * three answers it rests on. The database refuses an `auto` record without all
 * three, or with a person named as having made it.
 */
function appendAutomatic(
  context: Pick<RuleContext, "db" | "now">,
  rowId: number,
  filing: Extract<AutoFiling<Bucket>, { kind: "filed" }>,
): void {
  const [first, second, third] = filing.restsOn;
  context.db
    .prepare(
      `INSERT INTO classifications
         (row_id, bucket, person_id, rule_id, source, classified_at, classified_by, rests_on_1, rests_on_2, rests_on_3)
       VALUES (?, ?, ?, NULL, 'auto', ?, NULL, ?, ?, ?)`,
    )
    .run(rowId, filing.bucket, filing.personId, context.now().toISOString(), first, second, third);
}

/** The highest stored row id, or 0 for an empty history. Taken before a paste stores. */
export function lastRowId(db: Database): number {
  return (
    db.prepare("SELECT coalesce(max(id), 0) AS id FROM statement_rows").get() as { id: number }
  ).id;
}

/**
 * Classifies the rows stored after `afterRowId` — a paste's own — by the rules in
 * force, taking a rule only on an exact match, and files by history the rows no
 * rule's pattern matches, within `autoFile`'s limits. Runs inside the paste's
 * transaction. Returns how many rows were filed either way; the rest are the
 * inbox.
 *
 * A row a rule matches but does not take (`differs`, `ambiguous`) is a question
 * a rule asked, and history does not answer it. History is read once, before
 * any of the paste's rows is filed, and never holds an `auto` record, so a paste
 * cannot file a row on another it has just filed.
 */
export function classifyAdded(
  context: Pick<RuleContext, "db" | "personId" | "now">,
  afterRowId: number,
): number {
  const rules = currentRules(context.db);
  const answers = answersByDescription(context.db);
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
    if (match.kind === "classified") {
      const { bucket, personId, id } = match.rule;
      append(context, row.id, { bucket, personId, ruleId: id }, "rule");
      classified += 1;
    } else if (match.reason === "no-rule") {
      const filing = autoFile(
        { category: row.category, description: row.description, amountCents: row.amount_cents },
        answers.get(normalizeDescription(row.description)) ?? [],
      );
      if (filing.kind !== "filed") continue;
      appendAutomatic(context, row.id, filing);
      classified += 1;
    }
  }
  return classified;
}

/**
 * What people have answered, by description. Only the classification that stands
 * for each row, and only a person's — `manual` or `accepted`, never `rule`: a
 * rule's own answer is already the rule's suggestion, and never `auto`
 * (lg-17): history's own filing is not an answer, so it cannot reinforce
 * itself, and a row it filed counts again only once a person has answered it.
 * Grouped by the folded description so the inbox looks each one up rather than
 * folding them all again for every waiting row.
 */
function answersByDescription(db: Database): Map<string, HistoryAnswer<Bucket>[]> {
  const answered = db
    .prepare(
      `SELECT c.id, r.description, r.amount_cents, c.bucket, c.person_id
       FROM current_classifications c
       JOIN statement_rows r ON r.id = c.row_id
       WHERE c.source IN ('manual', 'accepted')`,
    )
    .all() as {
    id: number;
    description: string;
    amount_cents: number;
    bucket: Bucket;
    person_id: string | null;
  }[];
  const grouped = new Map<string, HistoryAnswer<Bucket>[]>();
  for (const found of answered) {
    const key = normalizeDescription(found.description);
    const answer = {
      id: found.id,
      description: found.description,
      bucket: found.bucket,
      personId: found.person_id,
      amountCents: found.amount_cents,
    };
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [answer]);
    else list.push(answer);
  }
  return grouped;
}

/**
 * Every stored row with no classification, newest first, each with its nearest
 * rule and what a person last answered for the same description.
 */
export function inbox(db: Database): InboxRow[] {
  const rules = currentRules(db);
  const answers = answersByDescription(db);
  const spending = spendingReader(db);
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
    const history = fromHistory(row, answers.get(normalizeDescription(row.description)) ?? []);
    // The rule `classify` returned is the classifying one, filed yet or not
    // (lg-15): a suggestion that is only nearest says nothing about the category.
    const spendingCategory = spending.of(row, match.kind === "classified" ? match.rule : null);
    // A row can be here while a rule takes it exactly only if the rule came
    // after the paste, which is its own reason: the suggestion is a sure one.
    return match.kind === "classified"
      ? {
          ...shown,
          reason: "matches",
          suggestion: match.rule,
          history,
          matching: [match.rule],
          spendingCategory,
        }
      : {
          ...shown,
          reason: match.reason,
          suggestion: match.suggestion,
          history,
          matching: match.matching,
          spendingCategory,
        };
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

interface AutoFiledColumns extends RowColumns {
  classification_id: number;
  bucket: Bucket;
  person_id: string | null;
  classified_at: string;
  rests_on_1: number;
  rests_on_2: number;
  rests_on_3: number;
}

interface GroundColumns {
  id: number;
  row_id: number;
  date: string;
  description: string;
  amount_cents: number;
  bucket: Bucket;
  person_id: string | null;
  source: AutoFilingGround["source"];
  classified_at: string;
  classified_by: string;
}

/**
 * The rows history filed and nobody has answered since (lg-17), newest first,
 * each with the three answers it rests on. A person's answer appended after the
 * filing stands instead, so confirming or changing a row takes it off this list.
 */
export function autoFiled(db: Database): AutoFiledRow[] {
  const spending = spendingReader(db);
  const ground = db.prepare(
    `SELECT c.id, c.row_id, r.date, r.description, r.amount_cents, c.bucket, c.person_id,
            c.source, c.classified_at, c.classified_by
     FROM classifications c
     JOIN statement_rows r ON r.id = c.row_id
     WHERE c.id = ?`,
  );
  const rows = db
    .prepare(
      `SELECT r.id, r.date, r.category, r.description, r.amount_cents, r.balance_cents,
              c.id AS classification_id, c.bucket, c.person_id, c.classified_at,
              c.rests_on_1, c.rests_on_2, c.rests_on_3
       FROM statement_rows r
       JOIN current_classifications c ON c.row_id = r.id
       WHERE c.source = 'auto'
       ORDER BY r.seq DESC`,
    )
    .all() as AutoFiledColumns[];
  return rows.map((row): AutoFiledRow => ({
    id: row.id,
    date: row.date,
    category: row.category,
    description: row.description,
    amountCents: row.amount_cents,
    balanceCents: row.balance_cents,
    classification: {
      id: row.classification_id,
      bucket: row.bucket,
      personId: row.person_id,
      classifiedAt: row.classified_at,
    },
    restsOn: [row.rests_on_1, row.rests_on_2, row.rests_on_3].map((id): AutoFilingGround => {
      const found = ground.get(id) as GroundColumns;
      return {
        classificationId: found.id,
        rowId: found.row_id,
        date: found.date,
        description: found.description,
        amountCents: found.amount_cents,
        bucket: found.bucket,
        personId: found.person_id,
        source: found.source,
        classifiedAt: found.classified_at,
        classifiedBy: found.classified_by,
      };
    }),
    // No rule gave it, so its category is the row's override or the map's
    // (lg-15's order with the rule's step empty), as on every other reader.
    spendingCategory: spending.of(row, null),
  }));
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
