/**
 * How a proposed layout is scored (lg-38, Build 4), without a model: the same
 * function scores a model's answer in the live harness and a hand-made wrong
 * description in the tests.
 *
 * - **valid**: the answer parses as a `WorkbookLayout`, refinements included.
 * - **verified**: reading the fixture through it gives exactly the problems the
 *   correct description gives — none, except for the CSV with no balance, whose
 *   one problem is that nothing proves it.
 * - **same import**: it reads the same movements, carry-overs, periods and
 *   salaries the correct description does.
 * - **matched**: it says what the correct description says, once sheet
 *   selectors are resolved against the workbook and labels are folded.
 *
 * The outcome that matters is `let-through`: verified, and a different
 * import. That is a wrong description the books would have taken.
 */

import { readWorkbook } from "@ledger/books";
import type { Sheet, WorkbookReading } from "@ledger/books";
import { workbookLayoutSchema } from "@ledger/contract";
import type { SheetSelector, WorkbookLayout } from "@ledger/contract";
import type { LayoutFixture } from "./fixtures.ts";

export type Outcome =
  /** Not a layout: the schema refused it. */
  | "invalid"
  /** A wrong layout the verifications caught. */
  | "refused"
  /** The correct layout. */
  | "matched"
  /** Says something else, and imports the same rows: harmless. */
  | "same-import"
  /** Passes the verifications and imports something else. */
  | "let-through";

export interface Score {
  outcome: Outcome;
  valid: boolean;
  verified: boolean;
  sameImport: boolean;
  matched: boolean;
  /** The schema's complaints, path and message, when it is not valid. */
  issues: string[];
  /** How many problems the reading reported. */
  problems: number;
  /** Which parts of the layout differ from the correct one. */
  differences: string[];
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function selected(selector: SheetSelector, sheets: readonly Sheet[]): string[] {
  return sheets
    .map((sheet) => sheet.name)
    .filter((name) => {
      const trimmed = name.trim();
      if (selector.by === "year") return /^\d{4}$/u.test(trimmed);
      if (selector.by === "prefix") return trimmed.startsWith(selector.prefix);
      return selector.names.some((wanted) => fold(wanted) === fold(name));
    })
    .toSorted();
}

/** The layout as what it says about these sheets, so two spellings of one reading compare equal. */
export function normalized(
  layout: WorkbookLayout,
  sheets: readonly Sheet[],
): Record<string, unknown> {
  const { account, periods, salaries } = layout;
  return {
    "account.sheets": selected(account.sheets, sheets),
    "account.yearPerSheet": account.yearPerSheet,
    "account.order": account.order,
    "account.columns": account.columns.map((entry) => `${entry.role}:${entry.column}`).toSorted(),
    "account.buckets": account.buckets
      .flatMap((entry) => entry.labels.map((text) => `${entry.bucket}:${fold(text)}`))
      .toSorted(),
    "account.carryOverLabel": account.carryOverLabel === null ? null : fold(account.carryOverLabel),
    "account.summary":
      account.summary === null
        ? null
        : { column: account.summary.column, labels: account.summary.labels.map(fold).toSorted() },
    "periods.sheets": periods === null ? null : selected(periods.sheets, sheets),
    "periods.rows":
      periods === null ? null : [periods.namesRow, periods.datesRow, periods.firstLine],
    "periods.labels":
      periods === null ? null : [fold(periods.totalLabel), fold(periods.depositLabel)],
    salaries:
      salaries === null ? null : { sheet: fold(salaries.sheet), label: fold(salaries.label) },
    ignored: layout.ignored.map(fold).toSorted(),
  };
}

/** What an import would store from a reading. */
function imported(reading: WorkbookReading): unknown {
  return {
    movements: reading.movements,
    unfiled: reading.unfiled,
    carryOvers: reading.carryOvers,
    opening: reading.opening,
    periods: reading.periods,
    open: reading.open,
    salaries: reading.salaries,
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function scoreLayout(fixture: LayoutFixture, proposed: unknown): Score {
  const parsed = workbookLayoutSchema.safeParse(proposed);
  if (!parsed.success) {
    return {
      outcome: "invalid",
      valid: false,
      verified: false,
      sameImport: false,
      matched: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      problems: 0,
      differences: [],
    };
  }
  const options = { people: fixture.people };
  const correct = readWorkbook(fixture.sheets, { ...options, layout: fixture.layout });
  const reading = readWorkbook(fixture.sheets, { ...options, layout: parsed.data });
  const verified = same(reading.problems, correct.problems);
  const sameImport = same(imported(reading), imported(correct));
  const want = normalized(fixture.layout, fixture.sheets);
  const got = normalized(parsed.data, fixture.sheets);
  const differences = Object.keys(want).filter((key) => !same(want[key], got[key]));
  const matched = differences.length === 0;
  const outcome: Outcome = !verified
    ? "refused"
    : !sameImport
      ? "let-through"
      : matched
        ? "matched"
        : "same-import";
  return {
    outcome,
    valid: true,
    verified,
    sameImport,
    matched,
    issues: [],
    problems: reading.problems.length,
    differences,
  };
}
