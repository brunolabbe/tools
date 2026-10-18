/**
 * The one-off backfill of spending categories from text (lg-53).
 *
 * Every bank row the workbook import brought in has an empty Desjardins category
 * and was filed by hand, so neither the map nor a rule can give it a spending
 * category; its description often says what it was all the same (`Taxes`,
 * `Épicerie`). A period line from the workbook keeps the workbook's word in its
 * free `category` text (`Hydro Québec`, `Netflix`). This reads those texts with
 * `spendingNameForText` and records what they say, through the same writes a
 * person makes: a row's override, and a line corrected.
 *
 * **It only fills what is empty, and only what the chart counts.** A row with any
 * category — a person's, a rule's, the map's — or a line with one is left as it
 * is. A row is filled only when it counts as spending (`countsAsSpending`: joint,
 * current expenses), of either sign, since money back on a shared expense is
 * that expense's: Desjardins' `Ristourne` nets against its fees. A deposit filed
 * to a person, like a share of the taxes paid in, is not spending and keeps none.
 * Running it again therefore writes nothing.
 */

import { spendingNameForText, normalizeDescription } from "@ledger/books";
import type { RuleContext } from "./rules.ts";
import { correctLine, currentLines } from "./periods.ts";
import { countsAsSpending, listRows, setSpendingCategoryOverride } from "./rows.ts";
import { spendingCategories } from "./spending-categories.ts";

/** What one text matched, and how many rows or lines it was on. */
export interface BackfillCount {
  kind: "row" | "line";
  text: string;
  category: string;
  count: number;
}

export interface BackfillResult {
  filled: BackfillCount[];
  /** Texts on uncategorised rows and lines that name nothing the table knows. */
  left: { kind: "row" | "line"; text: string; count: number }[];
  /** Lines with no text at all, which nothing here can place. */
  bareLines: number;
  report: string;
}

function tally<T extends { count: number }>(
  into: Map<string, T>,
  key: string,
  make: () => Omit<T, "count">,
): void {
  const held = into.get(key);
  if (held === undefined) into.set(key, { ...make(), count: 1 } as T);
  else held.count += 1;
}

/** Fills what the texts say, in one transaction, and reports it. */
export function backfillSpending(context: RuleContext): BackfillResult {
  return context.db
    .transaction(() => {
      // A retired name is not offered, so a text naming one is left as it is.
      const ids = new Map(
        spendingCategories(context.db)
          .filter((category) => !category.retired)
          .map((category) => [normalizeDescription(category.name), category.id]),
      );
      const idFor = (text: string): { name: string; id: number } | null => {
        const name = spendingNameForText(text);
        const id = name === null ? undefined : ids.get(normalizeDescription(name));
        return name === null || id === undefined ? null : { name, id };
      };
      const filled = new Map<string, BackfillCount>();
      const left = new Map<string, BackfillResult["left"][number]>();
      let bareLines = 0;

      const rows = listRows(context.db, { limit: Number.MAX_SAFE_INTEGER }).rows;
      for (const row of rows) {
        if (!countsAsSpending(row) || row.spendingCategory !== null) continue;
        const found = idFor(row.description);
        if (found === null) {
          tally(left, `row:${row.description}`, () => ({
            kind: "row" as const,
            text: row.description,
          }));
          continue;
        }
        setSpendingCategoryOverride(context, { rowId: row.id, spendingCategoryId: found.id });
        tally(filled, `row:${row.description}`, () => ({
          kind: "row" as const,
          text: row.description,
          category: found.name,
        }));
      }

      for (const line of currentLines(context.db)) {
        if (line.spendingCategoryId !== null) continue;
        const text = line.category ?? "";
        if (text.trim() === "") {
          bareLines += 1;
          continue;
        }
        const found = idFor(text);
        if (found === null) {
          tally(left, `line:${text}`, () => ({ kind: "line" as const, text }));
          continue;
        }
        correctLine(context, line.id, {
          personId: line.personId,
          date: line.date,
          amountCents: line.amountCents,
          category: line.category,
          spendingCategoryId: found.id,
          note: line.note,
          chargedTo: line.chargedTo,
        });
        tally(filled, `line:${text}`, () => ({
          kind: "line" as const,
          text,
          category: found.name,
        }));
      }

      const result = {
        filled: [...filled.values()],
        left: [...left.values()],
        bareLines,
      };
      return { ...result, report: reportOf(result) };
    })
    .immediate();
}

function where(kind: "row" | "line"): string {
  return kind === "row" ? "bank rows" : "card lines";
}

function reportOf(result: Omit<BackfillResult, "report">): string {
  const lines: string[] = [];
  const total = result.filled.reduce((sum, one) => sum + one.count, 0);
  lines.push(`Filled: ${String(total)}`);
  for (const one of result.filled) {
    lines.push(`  ${String(one.count)} ${where(one.kind)} "${one.text}" -> ${one.category}`);
  }
  lines.push("", "Left uncategorised, for a person to place:");
  for (const one of result.left) {
    lines.push(`  ${String(one.count)} ${where(one.kind)} "${one.text}"`);
  }
  lines.push(`  ${String(result.bareLines)} card lines with no text`);
  return `${lines.join("\n")}\n`;
}
