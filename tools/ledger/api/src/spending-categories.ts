/**
 * Spending categories (lg-15): the one list, the map from Desjardins' own
 * categories to it, and a row's own override.
 *
 * **Not Desjardins' category.** That is the `category` text on a statement row and
 * on a rule; a spending category is the household's word (groceries, pharmacy)
 * for the stats. Every name here says "spending" so the two are never read for
 * each other.
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). A rename files a new version
 * of the category that supersedes the old; a retirement is a version that does.
 * Everything that picks a category stores the id of its *first* version, which a
 * rename therefore never changes — `SpendingCategory.id` is that id. A map line
 * and an override are appended, and the latest stands.
 *
 * **A row's spending category is computed whenever it is read**, never stored
 * (`spendingCategory` in `@ledger/books`): fixing a map entry recategorises every
 * row it covers, and the earlier map versions are still there. `rows.ts` lists
 * rows with theirs and writes a row's override.
 */

import { normalizeDescription, spendingCategory, spendingMap } from "@ledger/books";
import type { SpendingMap, SpendingRule } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  RowSpendingCategory,
  SetSpendingCategoryMapRequest,
  SpendingCategory,
  SpendingCategoryDraft,
  SpendingCategoryMapEntry,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import type { RuleContext } from "./rules.ts";

interface CategoryColumns {
  category_id: number;
  name: string;
  retired: number;
  created_at: string;
  created_by: string;
}

function toCategory(columns: CategoryColumns): SpendingCategory {
  return {
    id: columns.category_id,
    name: columns.name,
    retired: columns.retired === 1,
    createdAt: columns.created_at,
    createdBy: columns.created_by,
  };
}

// --- The list ---

/** Every category as it now stands, retired ones too, in the order they were first made. */
export function spendingCategories(db: Database): SpendingCategory[] {
  return (
    db
      .prepare(
        "SELECT category_id, name, retired, created_at, created_by FROM current_spending_categories ORDER BY category_id",
      )
      .all() as CategoryColumns[]
  ).map(toCategory);
}

function standing(db: Database, id: number): CategoryColumns & { version_id: number } {
  const found = db
    .prepare(
      "SELECT category_id, version_id, name, retired, created_at, created_by FROM current_spending_categories WHERE category_id = ?",
    )
    .get(id) as (CategoryColumns & { version_id: number }) | undefined;
  if (found === undefined) throw new AppError("SPENDING_CATEGORY_NOT_FOUND");
  return found;
}

/**
 * A category a person may pick: in the list and not retired. `keeping` is the id
 * the thing being edited already has, which stays acceptable after a retirement —
 * saving a rule again must not need its category un-retired first.
 */
export function requireSpendingCategory(
  db: Database,
  id: number | null,
  keeping: number | null = null,
): void {
  if (id === null || id === keeping) return;
  if (standing(db, id).retired === 1) throw new AppError("SPENDING_CATEGORY_NOT_FOUND");
}

function requireFreeName(db: Database, name: string, except: number | null): void {
  const wanted = normalizeDescription(name);
  const taken = spendingCategories(db).some(
    (category) =>
      category.retired === false &&
      category.id !== except &&
      normalizeDescription(category.name) === wanted,
  );
  if (taken) throw new AppError("BAD_REQUEST", "There is already a spending category by that name.");
}

function insertVersion(
  context: RuleContext,
  version: { root: number | null; name: string; supersedes: number | null; retired: boolean },
): number {
  const result = context.db
    .prepare(
      `INSERT INTO spending_categories (root_id, name, supersedes, retired, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      version.root,
      version.name,
      version.supersedes,
      version.retired ? 1 : 0,
      context.now().toISOString(),
      context.personId,
    );
  return Number(result.lastInsertRowid);
}

export function createSpendingCategory(
  context: RuleContext,
  draft: SpendingCategoryDraft,
): SpendingCategory {
  return context.db
    .transaction(() => {
      requireFreeName(context.db, draft.name, null);
      const id = insertVersion(context, {
        root: null,
        name: draft.name,
        supersedes: null,
        retired: false,
      });
      return toCategory(standing(context.db, id));
    })
    .immediate();
}

/** The category renamed: a new version of it, under the same id. */
export function renameSpendingCategory(
  context: RuleContext,
  id: number,
  draft: SpendingCategoryDraft,
): SpendingCategory {
  return context.db
    .transaction(() => {
      const current = standing(context.db, id);
      if (current.retired === 1) throw new AppError("SPENDING_CATEGORY_NOT_FOUND");
      requireFreeName(context.db, draft.name, id);
      insertVersion(context, {
        root: id,
        name: draft.name,
        supersedes: current.version_id,
        retired: false,
      });
      return toCategory(standing(context.db, id));
    })
    .immediate();
}

/** The category as it stood, retired. What picked it keeps it. */
export function retireSpendingCategory(context: RuleContext, id: number): SpendingCategory {
  return context.db
    .transaction(() => {
      const current = standing(context.db, id);
      if (current.retired === 1) throw new AppError("SPENDING_CATEGORY_NOT_FOUND");
      insertVersion(context, {
        root: id,
        name: current.name,
        supersedes: current.version_id,
        retired: true,
      });
      return toCategory(standing(context.db, id));
    })
    .immediate();
}

// --- The map ---

interface MapColumns {
  id: number;
  desjardins_key: string;
  desjardins_category: string;
  spending_category_id: number | null;
}

/** The map as it stands, for `spendingCategory`. */
function standingMap(db: Database): SpendingMap {
  const versions = db
    .prepare(
      "SELECT id, desjardins_category, spending_category_id FROM current_spending_category_map",
    )
    .all() as Pick<MapColumns, "id" | "desjardins_category" | "spending_category_id">[];
  return spendingMap(
    versions.map((version) => ({
      id: version.id,
      desjardinsCategory: version.desjardins_category,
      spendingCategory: version.spending_category_id,
    })),
  );
}

/**
 * One entry per Desjardins category seen in the stored rows, folded so that
 * `Épicerie` and `EPICERIE` are one line, shown as the most recent row wrote it.
 */
export function spendingCategoryMap(db: Database): SpendingCategoryMapEntry[] {
  const seen = db
    .prepare("SELECT category, count(*) AS n FROM statement_rows GROUP BY category ORDER BY max(seq)")
    .all() as { category: string; n: number }[];
  const map = standingMap(db);
  const entries = new Map<string, SpendingCategoryMapEntry>();
  for (const found of seen) {
    const key = normalizeDescription(found.category);
    const held = entries.get(key);
    if (held !== undefined) {
      held.rows += found.n;
      // Ordered oldest first, so the last text written is the most recent row's.
      held.desjardinsCategory = found.category;
    } else {
      entries.set(key, {
        desjardinsCategory: found.category,
        spendingCategoryId: map.get(key) ?? null,
        rows: found.n,
      });
    }
  }
  return [...entries.values()].toSorted((a, b) =>
    normalizeDescription(a.desjardinsCategory).localeCompare(
      normalizeDescription(b.desjardinsCategory),
    ),
  );
}

/** Files a version of one map line. `null` is the line cleared; the earlier versions stay. */
export function setSpendingCategoryMap(
  context: RuleContext,
  request: SetSpendingCategoryMapRequest,
): SpendingCategoryMapEntry {
  context.db
    .transaction(() => {
      requireSpendingCategory(context.db, request.spendingCategoryId);
      context.db
        .prepare(
          `INSERT INTO spending_category_map (desjardins_key, desjardins_category, spending_category_id, entered_at, entered_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          normalizeDescription(request.desjardinsCategory),
          request.desjardinsCategory,
          request.spendingCategoryId,
          context.now().toISOString(),
          context.personId,
        );
    })
    .immediate();
  const key = normalizeDescription(request.desjardinsCategory);
  return (
    spendingCategoryMap(context.db).find(
      (entry) => normalizeDescription(entry.desjardinsCategory) === key,
    ) ?? {
      // Not seen in any stored row: the line is kept, and shown once a row has it.
      desjardinsCategory: request.desjardinsCategory,
      spendingCategoryId: request.spendingCategoryId,
      rows: 0,
    }
  );
}

// --- A row's spending category ---

/** What it takes to give any number of rows their spending category, read once. */
export interface SpendingReader {
  /** The rule version a stored classification cites, as `spendingCategory` reads a rule. */
  citedRule: (ruleId: number | null) => SpendingRule | null;
  of: (row: { id: number; category: string }, rule: SpendingRule | null) => RowSpendingCategory | null;
}

export function spendingReader(db: Database): SpendingReader {
  const map = standingMap(db);
  const overrides = new Map(
    (
      db
        .prepare(
          "SELECT row_id, spending_category_id FROM current_spending_category_overrides WHERE spending_category_id IS NOT NULL",
        )
        .all() as { row_id: number; spending_category_id: number }[]
    ).map((override) => [override.row_id, override.spending_category_id]),
  );
  // Every version of every rule: a classification cites the version it was
  // filed by, whatever has been done to the rule since.
  const ruleCategories = new Map(
    (
      db
        .prepare("SELECT id, spending_category_id FROM rules WHERE spending_category_id IS NOT NULL")
        .all() as { id: number; spending_category_id: number }[]
    ).map((rule) => [rule.id, rule.spending_category_id]),
  );
  return {
    citedRule: (ruleId) =>
      ruleId === null ? null : { spendingCategoryId: ruleCategories.get(ruleId) ?? null },
    of: (row, rule) => {
      const choice = spendingCategory(row, rule, map, overrides.get(row.id) ?? null);
      return choice === null ? null : { id: choice.category, source: choice.source };
    },
  };
}
