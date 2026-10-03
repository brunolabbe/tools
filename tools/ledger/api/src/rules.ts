/**
 * The rules, kept in the database and never in the repository (lg-4).
 *
 * Caisse names identify a household, so no rule is seeded from here and the
 * tables start empty. **A rule is never edited in place**
 * (`docs/00-ANALYSIS.md` §9): editing files a new version that supersedes the
 * old one, retiring files a retirement that does, and a classification cites the
 * version it used. What is "in force" is the `current_rules` view.
 *
 * Who a rule may name is configuration, not a table: `people` is the set of
 * person ids the Access mapping yields. lg-5 gives people a table of their own.
 */

import { AppError } from "@ledger/contract";
import type { Bucket, Rule, RuleDraft } from "@ledger/contract";
import type { Database } from "better-sqlite3";

export interface RuleContext {
  db: Database;
  /** The configured name of whoever is acting, never the address. */
  personId: string;
  now: () => Date;
  /** Every person id a rule or a classification may name. */
  people: ReadonlySet<string>;
}

interface Columns {
  id: number;
  description_pattern: string;
  category: string | null;
  amount_cents: number | null;
  person_id: string | null;
  bucket: Bucket;
  created_at: string;
  created_by: string;
}

const SELECT = `SELECT id, description_pattern, category, amount_cents, person_id, bucket, created_at, created_by`;

function toRule(columns: Columns): Rule {
  return {
    id: columns.id,
    descriptionPattern: columns.description_pattern,
    category: columns.category,
    amountCents: columns.amount_cents,
    personId: columns.person_id,
    bucket: columns.bucket,
    createdAt: columns.created_at,
    createdBy: columns.created_by,
  };
}

/** The rules in force, oldest first. */
export function currentRules(db: Database): Rule[] {
  return (db.prepare(`${SELECT} FROM current_rules ORDER BY id`).all() as Columns[]).map(toRule);
}

function currentRule(db: Database, id: number): Rule {
  const found = db.prepare(`${SELECT} FROM current_rules WHERE id = ?`).get(id) as
    | Columns
    | undefined;
  if (found === undefined) throw new AppError("RULE_NOT_FOUND");
  return toRule(found);
}

/** A person id the configuration does not know is a typo, and is never stored. */
export function requireKnownPerson(people: ReadonlySet<string>, personId: string | null): void {
  if (personId !== null && !people.has(personId)) {
    throw new AppError("BAD_REQUEST", "That person is not one of the household.");
  }
}

function insert(
  context: RuleContext,
  draft: RuleDraft,
  supersedes: number | null,
  retired: boolean,
): number {
  const result = context.db
    .prepare(
      `INSERT INTO rules (description_pattern, category, amount_cents, person_id, bucket, supersedes, retired, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.descriptionPattern,
      draft.category,
      draft.amountCents,
      draft.personId,
      draft.bucket,
      supersedes,
      retired ? 1 : 0,
      context.now().toISOString(),
      context.personId,
    );
  return Number(result.lastInsertRowid);
}

function read(db: Database, id: number): Rule {
  return toRule(db.prepare(`${SELECT} FROM rules WHERE id = ?`).get(id) as Columns);
}

export function createRule(context: RuleContext, draft: RuleDraft): Rule {
  requireKnownPerson(context.people, draft.personId);
  return context.db
    .transaction(() => read(context.db, insert(context, draft, null, false)))
    .immediate();
}

/** The rule as edited: a new version, under a new id, that supersedes `id`. */
export function editRule(context: RuleContext, id: number, draft: RuleDraft): Rule {
  requireKnownPerson(context.people, draft.personId);
  return context.db
    .transaction(() => {
      currentRule(context.db, id);
      return read(context.db, insert(context, draft, id, false));
    })
    .immediate();
}

/** The rule as it stood when it was retired. Rows it classified keep their records. */
export function retireRule(context: RuleContext, id: number): Rule {
  return context.db
    .transaction(() => {
      const rule = currentRule(context.db, id);
      insert(context, rule, id, true);
      return rule;
    })
    .immediate();
}
