/**
 * The workbook layout's schema (lg-38): what a description may say, and the
 * descriptions it refuses because no reader could follow them.
 */

import { describe, expect, test } from "vitest";
import { workbookLayoutSchema } from "../src/index.ts";
import type { WorkbookLayout } from "../src/index.ts";

/** A bank CSV's description: the smallest valid one. */
function csv(columns: WorkbookLayout["account"]["columns"]): unknown {
  return {
    account: {
      sheets: { by: "name", names: ["releve.csv"] },
      yearPerSheet: false,
      order: "oldest-first",
      columns,
      buckets: [],
      carryOverLabel: null,
      summary: null,
    },
    periods: null,
    salaries: null,
    ignored: [],
  };
}

function messages(value: unknown): string[] {
  const parsed = workbookLayoutSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("the workbook layout schema", () => {
  test("takes an amount, or a withdrawal and a deposit", () => {
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "amount", column: "B" },
        ]),
      ),
    ).toEqual([]);
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "withdrawal", column: "B" },
          { role: "deposit", column: "C" },
          { role: "balance", column: "D" },
        ]),
      ),
    ).toEqual([]);
  });

  test("refuses a role named twice", () => {
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "amount", column: "B" },
          { role: "amount", column: "C" },
        ]),
      ),
    ).toEqual(['The role "amount" is named twice; each role is one column.']);
  });

  test("refuses a description with no amount column", () => {
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "balance", column: "B" },
        ]),
      ),
    ).toEqual(["No column is the amount: name an amount, or a withdrawal and a deposit."]);
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "withdrawal", column: "B" },
        ]),
      ),
    ).toEqual(["A withdrawal column needs a deposit column, and a deposit one a withdrawal."]);
  });

  test("refuses two roles in one column, no date, and an amount beside a withdrawal", () => {
    expect(
      messages(
        csv([
          { role: "amount", column: "A" },
          { role: "detail", column: "A" },
          { role: "deposit", column: "B" },
          { role: "withdrawal", column: "C" },
        ]),
      ),
    ).toEqual([
      "Column A is given two roles.",
      "No column is the date.",
      "An amount, and a withdrawal or deposit besides: the amount is one or the other.",
    ]);
  });

  test("refuses bucket labels with no bucket column, and a bucket column with none", () => {
    const labelled = csv([
      { role: "date", column: "A" },
      { role: "amount", column: "B" },
    ]) as { account: { buckets: unknown[] } };
    labelled.account.buckets = [{ bucket: "mortgage", labels: ["Maison"] }];
    expect(messages(labelled)).toEqual(["Bucket labels, and no bucket column to find them in."]);
    expect(
      messages(
        csv([
          { role: "date", column: "A" },
          { role: "amount", column: "B" },
          { role: "bucket", column: "C" },
        ]),
      ),
    ).toEqual(["A bucket column, and no text saying which bucket it names."]);
  });

  test("refuses a carry-over without a sheet per year, and a period heading below its lines", () => {
    const carried = csv([
      { role: "date", column: "A" },
      { role: "amount", column: "B" },
    ]) as { account: { carryOverLabel: string }; periods: unknown };
    carried.account.carryOverLabel = "Report";
    carried.periods = {
      sheets: { by: "prefix", prefix: "$" },
      namesRow: 1,
      datesRow: 9,
      firstLine: 8,
      totalLabel: "Total",
      depositLabel: "Montant à déposer",
    };
    expect(messages(carried)).toEqual([
      "A carry-over carries one year into the next, so it needs a sheet per year.",
      "datesRow is at or below the first line; the heading is above the lines.",
    ]);
  });

  test("refuses a field it does not have and a column that is not a letter", () => {
    const extra = csv([
      { role: "date", column: "a1" },
      { role: "amount", column: "B" },
    ]) as Record<string, unknown>;
    extra["rows"] = [];
    const issues = workbookLayoutSchema.safeParse(extra);
    expect(issues.success).toBe(false);
    expect(issues.error?.issues.map((issue) => [issue.code, issue.path.join(".")])).toEqual([
      ["invalid_format", "account.columns.0.column"],
      ["unrecognized_keys", ""],
    ]);
  });
});

/** A description with a bucket column, its two buckets labelled as given. */
function bucketed(mortgage: string[], expenses: string[]): unknown {
  return {
    account: {
      sheets: { by: "year" },
      yearPerSheet: true,
      order: "newest-first",
      columns: [
        { role: "date", column: "B" },
        { role: "bucket", column: "C" },
        { role: "balance", column: "F" },
        { role: "amount", column: "G" },
      ],
      buckets: [
        { bucket: "mortgage", labels: mortgage },
        { bucket: "current-expenses", labels: expenses },
      ],
      carryOverLabel: null,
      summary: null,
    },
    periods: null,
    salaries: null,
    ignored: [],
  };
}

// lg-66, Build 2.3: the reader files a row by its bucket text folded for
// accents as well as case, so two labels it cannot tell apart are refused.
describe("bucket labels the reader cannot tell apart (lg-66)", () => {
  test("refuses Hypothèque and Hypotheque named for two different buckets", () => {
    expect(messages(bucketed(["Hypothèque"], ["Hypotheque"]))).toEqual([
      '"Hypotheque" names both mortgage and current-expenses.',
    ]);
  });

  test("still refuses two labels that differ only in case", () => {
    expect(messages(bucketed(["Maison"], ["MAISON"]))).toEqual([
      '"MAISON" names both mortgage and current-expenses.',
    ]);
    // And takes two that differ by more than the folding.
    expect(messages(bucketed(["Hypothèque"], ["Dép. Courantes"]))).toEqual([]);
  });
});
