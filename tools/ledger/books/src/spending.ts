/**
 * `spendingCategory` — which spending category a bank row has (lg-15).
 *
 * Not Desjardins' own `category`, which is the bank's word on the row (`Virements`,
 * `Hypothèque`): a spending category is the household's (groceries, pharmacy),
 * from one shared list, and it feeds the stats and nothing else. It never changes
 * who owes what, and a row without one is filed exactly as before.
 *
 * **Four steps, first one that has an answer wins** (`00-ANALYSIS.md` §6):
 *
 * 1. the row's own override — a person said so about this row;
 * 2. the rule that classified it, when that rule names one;
 * 3. the map's entry for the row's Desjardins category, folded the way `classify`
 *    folds a category (case, accents and runs of spaces do not matter);
 * 4. none.
 *
 * It is computed whenever it is read and stored nowhere, so fixing a map entry
 * recategorises every row it covers. The history of the map is its own versions.
 *
 * Pure. Categories are ids (the list's), and this does not know the list: whether
 * one is retired is the caller's to decide.
 */

import { normalize } from "./classify.ts";

export type SpendingSource = "override" | "rule" | "map";

/** A row's spending category and which step gave it. */
export interface SpendingChoice {
  category: number;
  source: SpendingSource;
}

/** One version of a map line. `spendingCategory: null` is a line cleared. */
export interface SpendingMapVersion {
  /** Larger is later, which is what "latest" means. */
  id: number;
  desjardinsCategory: string;
  spendingCategory: number | null;
}

/** The standing map, by folded Desjardins category. */
export type SpendingMap = ReadonlyMap<string, number>;

/**
 * The map as it now stands, from its versions in any order: for each Desjardins
 * category, the latest version, and none at all where the latest is a clearing.
 */
export function spendingMap(versions: readonly SpendingMapVersion[]): SpendingMap {
  const latest = new Map<string, SpendingMapVersion>();
  for (const version of versions) {
    const key = normalize(version.desjardinsCategory);
    const held = latest.get(key);
    if (held === undefined || version.id > held.id) latest.set(key, version);
  }
  const standing = new Map<string, number>();
  for (const [key, version] of latest) {
    if (version.spendingCategory !== null) standing.set(key, version.spendingCategory);
  }
  return standing;
}

/** The part of a rule this reads: whatever else the caller keeps on it is none of its business. */
export interface SpendingRule {
  spendingCategoryId?: number | null;
}

/**
 * `classifyingRule` is the rule that classified the row — the version its
 * classification cites, or the one `classify` returned for a row not yet filed —
 * and `null` for a row nobody filed by a rule. `override` is the row's latest
 * override, or `null` for none.
 */
export function spendingCategory(
  row: { category: string },
  classifyingRule: SpendingRule | null,
  map: SpendingMap,
  override: number | null,
): SpendingChoice | null {
  if (override !== null) return { category: override, source: "override" };
  const fromRule = classifyingRule?.spendingCategoryId ?? null;
  if (fromRule !== null) return { category: fromRule, source: "rule" };
  const fromMap = map.get(normalize(row.category));
  if (fromMap !== undefined) return { category: fromMap, source: "map" };
  return null;
}
