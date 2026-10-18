/**
 * A workbook's layout, described (lg-38): which sheets hold the account, the
 * periods and the salaries, and where in them each figure is.
 *
 * `books` reads a workbook through one of these (`readWorkbook`'s `layout`),
 * and the household's own workbook is one description among others
 * (`HOUSEHOLD_LAYOUT` in `books`). It is also what a model would be asked to
 * propose for a workbook nobody has described: **a description, never rows**.
 * The reader then reads the cells through it and runs the same verifications
 * it always does, so a wrong description fails a check instead of being
 * imported. Whether a model can write one well enough is what lg-38 measures.
 *
 * A file of its own, beside `api.ts`, because it is one seam that `books` reads
 * and a model's answer is parsed against; nothing in `api.ts` refers to it.
 *
 * Every `.describe()` below is sent to a model as part of the answer's schema,
 * so each one says what the field means to someone who has only the sheets.
 */

import { z } from "zod";
import { BUCKETS } from "./api.ts";

/** What a column of the account can hold. */
export const LAYOUT_COLUMN_ROLES = [
  "date",
  "amount",
  "withdrawal",
  "deposit",
  "balance",
  "bucket",
  "person",
  "detail",
  "note",
] as const;
export type LayoutColumnRole = (typeof LAYOUT_COLUMN_ROLES)[number];

const columnLetter = z
  .string()
  .regex(/^[A-Z]{1,3}$/u)
  .describe("A spreadsheet column letter: A, B, …, Z, AA.");

const rowNumber = z.number().int().min(1).describe("A spreadsheet row number, the first being 1.");

const label = z.string().trim().min(1);

/** Which sheets a part of the workbook is read from. */
export const sheetSelectorSchema = z
  .discriminatedUnion("by", [
    z
      .object({
        by: z.literal("name"),
        names: z.array(z.string().min(1)).min(1).describe("Each sheet's name, exactly."),
      })
      .strict(),
    z
      .object({
        by: z.literal("prefix"),
        prefix: z.string().min(1).describe("Every sheet whose name starts with this text."),
      })
      .strict(),
    z
      .object({ by: z.literal("year") })
      .strict()
      .describe("Every sheet whose name is a four-digit year."),
  ])
  .describe(
    "Which sheets: by their names, by what their names start with, or every year-named sheet.",
  );
export type SheetSelector = z.infer<typeof sheetSelectorSchema>;

export const layoutColumnSchema = z
  .object({
    role: z
      .enum(LAYOUT_COLUMN_ROLES)
      .describe(
        "date: the day of the movement. amount: signed, negative for money out. withdrawal and deposit: two unsigned columns used instead of amount. balance: the account's running balance after the row. bucket: which of the household's buckets the row is filed in. person: who the row is. detail: the description. note: a free-text note.",
      ),
    column: columnLetter,
  })
  .strict();
export type LayoutColumn = z.infer<typeof layoutColumnSchema>;

export const bucketLabelsSchema = z
  .object({
    bucket: z.enum(BUCKETS),
    labels: z
      .array(label)
      .min(1)
      .describe("The text the bucket column holds for this bucket, as written in the sheet."),
  })
  .strict();

/**
 * The account: one row per movement, a row being a movement when its date
 * column holds a date. Every check in it is made against this description:
 * each role names one column, and either `amount` or the pair `withdrawal`
 * and `deposit` says how much moved.
 */
export const accountLayoutSchema = z
  .object({
    sheets: sheetSelectorSchema,
    yearPerSheet: z
      .boolean()
      .describe(
        "Each sheet holds one calendar year and is named by it, so a date typed in another year is repaired to the sheet's, and each year's carry-overs are checked against the year before.",
      ),
    order: z
      .enum(["newest-first", "oldest-first"])
      .describe("How the movements are listed, top to bottom."),
    columns: z
      .array(layoutColumnSchema)
      .min(1)
      .describe("Each role the account has, with its column; a role the sheets lack is left out."),
    buckets: z
      .array(bucketLabelsSchema)
      .describe(
        "How the bucket column's text names each bucket: mortgage, or current-expenses (the shared buffer). Empty when there is no bucket column.",
      ),
    carryOverLabel: label
      .nullable()
      .describe(
        "The text in a row that carries a bucket's balance over from the previous year (one such row per bucket), or null when the sheets have none.",
      ),
    summary: z
      .object({
        column: columnLetter,
        labels: z.array(label).min(1).describe("What each summary row's label starts with."),
      })
      .strict()
      .nullable()
      .describe(
        "Rows above the first movement that sum the sheet up, told by the label in this column; null when there are none.",
      ),
  })
  .strict()
  .superRefine((account, context) => {
    const roles = new Set<string>();
    const columns = new Set<string>();
    for (const [index, entry] of account.columns.entries()) {
      if (roles.has(entry.role)) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "role"],
          message: `The role "${entry.role}" is named twice; each role is one column.`,
        });
      }
      if (columns.has(entry.column)) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "column"],
          message: `Column ${entry.column} is given two roles.`,
        });
      }
      roles.add(entry.role);
      columns.add(entry.column);
    }
    if (!roles.has("date")) {
      context.addIssue({ code: "custom", path: ["columns"], message: "No column is the date." });
    }
    const signed = roles.has("amount");
    const split = roles.has("withdrawal") || roles.has("deposit");
    if (!signed && !split) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "No column is the amount: name an amount, or a withdrawal and a deposit.",
      });
    } else if (signed && split) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "An amount, and a withdrawal or deposit besides: the amount is one or the other.",
      });
    } else if (split && !(roles.has("withdrawal") && roles.has("deposit"))) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "A withdrawal column needs a deposit column, and a deposit one a withdrawal.",
      });
    }
    if (roles.has("bucket") !== account.buckets.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["buckets"],
        message: roles.has("bucket")
          ? "A bucket column, and no text saying which bucket it names."
          : "Bucket labels, and no bucket column to find them in.",
      });
    }
    const named = new Set<string>();
    const labelled = new Map<string, string>();
    for (const [index, entry] of account.buckets.entries()) {
      if (named.has(entry.bucket)) {
        context.addIssue({
          code: "custom",
          path: ["buckets", index, "bucket"],
          message: `The bucket "${entry.bucket}" is labelled twice.`,
        });
      }
      named.add(entry.bucket);
      for (const text of entry.labels) {
        const key = text.toLowerCase();
        const other = labelled.get(key);
        if (other !== undefined && other !== entry.bucket) {
          context.addIssue({
            code: "custom",
            path: ["buckets", index, "labels"],
            message: `"${text}" names both ${other} and ${entry.bucket}.`,
          });
        }
        labelled.set(key, entry.bucket);
      }
    }
    if (account.carryOverLabel !== null && !account.yearPerSheet) {
      context.addIssue({
        code: "custom",
        path: ["carryOverLabel"],
        message: "A carry-over carries one year into the next, so it needs a sheet per year.",
      });
    }
  });
export type AccountLayout = z.infer<typeof accountLayoutSchema>;

/**
 * A period sheet: the people named over their amount columns, the period's
 * dates, and one line per item from `firstLine` on. The total and the deposit
 * asked are rows told by their labels, above the lines or below them.
 */
export const periodsLayoutSchema = z
  .object({
    sheets: sheetSelectorSchema,
    namesRow: rowNumber.describe(
      "The row naming the people, each over the column that holds their amounts.",
    ),
    datesRow: rowNumber.describe(
      "The row holding the period's start date and, once closed, its end.",
    ),
    firstLine: rowNumber.describe("The row of the first line item."),
    totalLabel: label.describe("What the row of each person's total is labelled with."),
    depositLabel: label.describe("What the row of the amount someone deposits is labelled with."),
  })
  .strict()
  .superRefine((periods, context) => {
    for (const key of ["namesRow", "datesRow"] as const) {
      if (periods[key] >= periods.firstLine) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is at or below the first line; the heading is above the lines.`,
        });
      }
    }
  });
export type PeriodsLayout = z.infer<typeof periodsLayoutSchema>;

/** Where the salaries the ratio comes from are: a labelled row, under columns the people's names head. */
export const salariesLayoutSchema = z
  .object({
    sheet: z.string().min(1).describe("The sheet's name."),
    label: label.describe("What the row of salaries is labelled with."),
  })
  .strict();
export type SalariesLayout = z.infer<typeof salariesLayoutSchema>;

export const workbookLayoutSchema = z
  .object({
    account: accountLayoutSchema,
    periods: periodsLayoutSchema
      .nullable()
      .describe("The sheets of a shared period's expenses; null when there are none."),
    salaries: salariesLayoutSchema
      .nullable()
      .describe("The sheet holding each person's salary; null when there is none."),
    ignored: z
      .array(z.string().min(1))
      .describe("Every other sheet, by name: read as none of the above."),
  })
  .strict();
export type WorkbookLayout = z.infer<typeof workbookLayoutSchema>;
