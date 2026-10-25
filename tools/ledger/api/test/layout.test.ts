/**
 * lg-38's fixtures and scoring, offline: every fixture reads cleanly through
 * the layout written for it, and the scoring tells a wrong layout the
 * verifications catch from one they would let through. No model is called;
 * the live run is `test/live/layout-run.ts`, by hand. Every name and amount
 * is invented.
 */

import { layoutOutputFormat } from "@ledger/receipts";
import { beforeAll, describe, expect, test } from "vitest";
import { HOUSEHOLD_LAYOUT, readWorkbook } from "@ledger/books";
import type { WorkbookLayout } from "@ledger/contract";
import { LAYOUT_FIXTURE_NAMES, layoutFixtures, writtenRows } from "./layout/fixtures.ts";
import type { LayoutFixture } from "./layout/fixtures.ts";
import { scoreLayout } from "./layout/score.ts";
import type { Outcome } from "./layout/score.ts";
import {
  DEFAULT_VIEW,
  estimateTokens,
  layoutRequest,
  layoutView,
  shownRows,
} from "../src/layout-view.ts";

let fixtures: LayoutFixture[];

beforeAll(async () => {
  fixtures = await layoutFixtures();
});

function fixture(name: string): LayoutFixture {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
}

/** How an account is laid out: its columns, and its order. */
function columns(layout: WorkbookLayout): string {
  return JSON.stringify([layout.account.columns, layout.account.order]);
}

/** A copy of `layout` with `change` applied: a wrong description, made on purpose. */
function wrong(layout: WorkbookLayout, change: (copy: WorkbookLayout) => void): WorkbookLayout {
  const copy = structuredClone(layout);
  change(copy);
  return copy;
}

function swapColumns(layout: WorkbookLayout, a: string, b: string): void {
  for (const entry of layout.account.columns) {
    if (entry.role === a) entry.role = b as typeof entry.role;
    else if (entry.role === b) entry.role = a as typeof entry.role;
  }
}

/** The column `role` is read from, changed to `column`. */
function moveColumn(layout: WorkbookLayout, role: string, column: string): void {
  for (const entry of layout.account.columns) if (entry.role === role) entry.column = column;
}

describe("lg-38's fixtures", () => {
  test("there are thirteen, and each reads through its own layout with no problem but the unprovable CSV's", () => {
    expect(fixtures.map((each) => each.name)).toEqual([
      "lg7",
      "lg37",
      "moved",
      "english",
      "csv-balance",
      "csv-no-balance",
      "swapped-labels",
      "empty-columns-carry",
      "empty-columns-csv",
      "bank-preamble",
      "bank-two-dates",
      "bank-footer",
      "bank-wide",
    ]);
    for (const each of fixtures) {
      const reading = readWorkbook(each.sheets, { people: each.people, layout: each.layout });
      const expected =
        each.name === "csv-no-balance"
          ? [expect.stringContaining("The layout names no balance column")]
          : [];
      expect(reading.problems, each.name).toEqual(expected);
      expect(reading.movements.length + reading.unfiled.length, each.name).toBeGreaterThan(15);
    }
  });

  test("lg-7's and lg-37's workbooks read the same through their own descriptions as through the household's", () => {
    for (const name of ["lg7", "lg37"]) {
      const each = fixture(name);
      const own = readWorkbook(each.sheets, { people: each.people, layout: each.layout });
      const household = readWorkbook(each.sheets, { people: each.people });
      expect(own, name).toEqual(household);
      expect(readWorkbook(each.sheets, { people: each.people, layout: HOUSEHOLD_LAYOUT })).toEqual(
        household,
      );
    }
    // lg-7's figures, as its import's dry run reports them.
    const lg7 = readWorkbook(fixture("lg7").sheets, { people: ["alex", "sam"] });
    expect([lg7.movements.length, lg7.repairs.length, lg7.skipped.length]).toEqual([17, 1, 1]);
    expect(lg7.periods.map((period) => period.settlement?.formula)).toEqual(["v1", "v2"]);
  });

  test("the workbooks' layouts are told apart only by their descriptions: an account read through another's columns fails", () => {
    for (const each of fixtures.filter((candidate) => candidate.name !== "csv-no-balance")) {
      for (const other of fixtures.filter((candidate) => candidate.layout !== each.layout)) {
        // lg-7's and lg-37's accounts are laid out alike, and read alike either way.
        if (columns(other.layout) === columns(each.layout)) continue;
        const reading = readWorkbook(each.sheets, { people: each.people, layout: other.layout });
        expect(
          reading.problems.length,
          `${each.name} through ${other.name}'s layout`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("scoring a proposed layout", () => {
  test("the correct description matches, and so does the same one spelled another way", () => {
    for (const each of fixtures)
      expect(scoreLayout(each, each.layout).outcome, each.name).toBe("matched");
    const respelled = wrong(fixture("lg37").layout, (copy) => {
      copy.account.sheets = { by: "name", names: ["2022", "2023", "2024"] };
      copy.account.columns.reverse();
      copy.account.carryOverLabel = "SOLDE REPORTE";
    });
    expect(scoreLayout(fixture("lg37"), respelled).outcome).toBe("matched");
  });

  test("an answer that is not a layout is invalid, and says where", () => {
    const score = scoreLayout(fixture("lg7"), { account: { sheets: { by: "year" } } });
    expect(score.outcome).toBe("invalid");
    expect(score.issues.length).toBeGreaterThan(0);
  });

  /**
   * Which wrong descriptions the verifications catch, and which they let
   * through: the table lg-38's Log reports, pinned. `let-through` is a wrong
   * import the books would have taken.
   */
  const MISTAKES: [
    fixture: string,
    mistake: string,
    change: (copy: WorkbookLayout) => void,
    Outcome,
  ][] = [
    [
      "lg37",
      "amount and balance swapped",
      (copy) => swapColumns(copy, "amount", "balance"),
      "refused",
    ],
    ["lg37", "order flipped", (copy) => void (copy.account.order = "oldest-first"), "refused"],
    [
      "lg37",
      "person and detail swapped",
      (copy) => swapColumns(copy, "person", "detail"),
      "refused",
    ],
    ["lg37", "no summary rows", (copy) => void (copy.account.summary = null), "refused"],
    [
      "lg37",
      "no carry-overs, no year per sheet",
      (copy) => {
        copy.account.carryOverLabel = null;
        copy.account.yearPerSheet = false;
      },
      "refused",
    ],
    [
      "lg37",
      "periods' first line one row low",
      (copy) => {
        if (copy.periods !== null) copy.periods.firstLine += 1;
      },
      "refused",
    ],
    [
      "lg37",
      "periods' names row wrong",
      (copy) => {
        if (copy.periods !== null) copy.periods.namesRow = 2;
      },
      "refused",
    ],
    [
      "lg37",
      "the two buckets' labels swapped",
      (copy) => {
        for (const entry of copy.account.buckets) {
          entry.bucket = entry.bucket === "mortgage" ? "current-expenses" : "mortgage";
        }
      },
      "let-through",
    ],
    [
      "lg37",
      "detail and note swapped",
      (copy) => swapColumns(copy, "detail", "note"),
      "let-through",
    ],
    [
      "lg37",
      "no person column",
      (copy) => {
        copy.account.columns = copy.account.columns.filter((entry) => entry.role !== "person");
      },
      "let-through",
    ],
    ["lg37", "the period sheets missed", (copy) => void (copy.periods = null), "let-through"],
    ["lg37", "the salaries missed", (copy) => void (copy.salaries = null), "let-through"],
    [
      "lg37",
      "a sheet left out of ignored",
      (copy) => void (copy.ignored = ["Labels"]),
      "same-import",
    ],
    ["moved", "order flipped", (copy) => void (copy.account.order = "newest-first"), "refused"],
    [
      "english",
      "amount and balance swapped",
      (copy) => swapColumns(copy, "amount", "balance"),
      "refused",
    ],
    [
      "english",
      "deposit label wrong",
      (copy) => {
        if (copy.periods !== null) copy.periods.depositLabel = "Total";
      },
      "refused",
    ],
    [
      "csv-balance",
      "withdrawal and deposit swapped",
      (copy) => swapColumns(copy, "withdrawal", "deposit"),
      "refused",
    ],
    [
      "csv-balance",
      "order flipped",
      (copy) => void (copy.account.order = "newest-first"),
      "refused",
    ],
    [
      "csv-no-balance",
      "order flipped",
      (copy) => void (copy.account.order = "oldest-first"),
      "let-through",
    ],
    [
      "csv-no-balance",
      "amount and detail swapped",
      (copy) => swapColumns(copy, "amount", "detail"),
      "refused",
    ],
  ];

  test.each(MISTAKES)("%s, %s: %s", (name, _mistake, change, outcome) => {
    const each = fixture(name);
    expect(scoreLayout(each, wrong(each.layout, change)).outcome).toBe(outcome);
  });
});

describe("what the model is shown", () => {
  test("a sheet shows its first rows, a sample and its last rows, never the whole account", () => {
    expect(shownRows(85, DEFAULT_VIEW)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 30, 42, 53, 65, 77, 83, 84, 85,
    ]);
    expect(shownRows(5, DEFAULT_VIEW)).toEqual([1, 2, 3, 4, 5]);
    const lg37 = fixture("lg37");
    const view = layoutView(lg37.sheets);
    const movements = readWorkbook(lg37.sheets, { people: lg37.people }).movements;
    const shownMovements = movements.filter((movement) =>
      view.includes(`row ${String(movement.row)}: B=${movement.date}`),
    );
    expect(movements.length).toBe(233);
    expect(shownMovements.length).toBeLessThanOrEqual(3 * 21);
    expect(shownMovements.length).toBeLessThan(movements.length / 3);
  });

  test("a formula is shown beside its value, and masked figures show none", () => {
    const view = layoutView(fixture("lg37").sheets);
    expect(view).toContain("F=10401.25 {=F4+G3} | G=-1049.87");
    const masked = layoutView(fixture("lg37").sheets, { ...DEFAULT_VIEW, figures: "masked" });
    expect(masked).toContain("F=# {=F4+G3} | G=#");
    expect(masked).not.toContain("1049.87");
  });

  test("what is sent stays under 3 000 tokens for every fixture, by four characters a token", () => {
    const sizes = Object.fromEntries(
      fixtures.map((each) => [each.name, estimateTokens(layoutRequest(each.sheets))]),
    );
    for (const [name, tokens] of Object.entries(sizes)) expect(tokens, name).toBeLessThan(3_000);
  });

  test("the layout's schema can be sent as a structured output's format", () => {
    const format = layoutOutputFormat();
    expect(format.type).toBe("json_schema");
    expect(format.schema["additionalProperties"]).toBe(false);
    expect(JSON.stringify(format.schema)).toContain("withdrawal");
  });
});

describe("lg-56's harder fixtures", () => {
  const HARDER = [
    "swapped-labels",
    "empty-columns-carry",
    "empty-columns-csv",
    "bank-preamble",
    "bank-two-dates",
    "bank-footer",
    "bank-wide",
  ];

  test("the names the measurement runs are the fixtures there are, in the same order", () => {
    expect(LAYOUT_FIXTURE_NAMES).toEqual(fixtures.map((each) => each.name));
    expect(new Set(LAYOUT_FIXTURE_NAMES).size).toBe(LAYOUT_FIXTURE_NAMES.length);
  });

  test.each(HARDER)("%s: its correct description matches, and reads with no problem", (name) => {
    const each = fixture(name);
    expect(scoreLayout(each, each.layout).outcome).toBe("matched");
    expect(
      readWorkbook(each.sheets, { people: each.people, layout: each.layout }).problems,
    ).toEqual([]);
  });

  /**
   * One wrong description for each, and what the verifications make of it.
   * `let-through` is the harness telling the failure apart when a model makes it.
   */
  const MISTAKES: [
    fixture: string,
    mistake: string,
    change: (copy: WorkbookLayout) => void,
    Outcome,
  ][] = [
    [
      "swapped-labels",
      "the two buckets' labels swapped",
      (copy) => {
        for (const entry of copy.account.buckets) {
          entry.bucket = entry.bucket === "mortgage" ? "current-expenses" : "mortgage";
        }
      },
      "let-through",
    ],
    [
      "empty-columns-carry",
      "the amount column pointing at the empty one",
      (copy) => moveColumn(copy, "amount", "E"),
      "refused",
    ],
    [
      "empty-columns-csv",
      "withdrawal and deposit pointing at empty columns",
      (copy) => {
        moveColumn(copy, "withdrawal", "D");
        moveColumn(copy, "deposit", "G");
      },
      // lg-66, Build 2.2: reading no row is a problem, so this is refused. It was
      // let through until then.
      "refused",
    ],
    [
      "bank-preamble",
      "order flipped",
      (copy) => void (copy.account.order = "newest-first"),
      "refused",
    ],
    [
      "bank-two-dates",
      "the date read from the transaction date's column",
      (copy) => moveColumn(copy, "date", "B"),
      "let-through",
    ],
    [
      "bank-footer",
      "amount and balance swapped",
      (copy) => swapColumns(copy, "amount", "balance"),
      "refused",
    ],
    [
      "bank-wide",
      "the detail read from the currency column",
      (copy) => moveColumn(copy, "detail", "D"),
      "let-through",
    ],
  ];

  test.each(
    MISTAKES.map(([name, mistake, change, outcome]) => ({ name, mistake, change, outcome })),
  )("$name, $mistake: $outcome", ({ name, change, outcome }) => {
    const each = fixture(name);
    expect(scoreLayout(each, wrong(each.layout, change)).outcome).toBe(outcome);
  });

  // `scoreLayout(each, each.layout)` compares a layout with itself, so "matched"
  // above holds for any valid layout. These hold the correct description to what
  // the generator wrote: a detail read from the wrong column fails here, and
  // nowhere else, if the reader has nothing to refuse (lg-56 gate 1).
  const GENERATED = LAYOUT_FIXTURE_NAMES.filter((name) => name !== "lg7");

  test("lg7 is the one fixture not generated here, so the only one without written rows", () => {
    expect(LAYOUT_FIXTURE_NAMES.filter((name) => writtenRows(name) === undefined)).toEqual(["lg7"]);
  });

  test.each(GENERATED)("%s: its correct description reads what the generator wrote", (name) => {
    const each = fixture(name);
    const written = writtenRows(name);
    expect(written?.length, name).toBeGreaterThan(15);
    const reading = readWorkbook(each.sheets, { people: each.people, layout: each.layout });
    const read = [...reading.movements, ...reading.unfiled].map((row) => ({
      date: row.date,
      bucket: row.bucket,
      person: row.personId,
      cents: row.amountCents,
      balance: row.balanceCents,
      detail: row.detail,
      note: row.note,
    }));
    expect(read).toEqual(
      (written ?? []).map((row) => ({
        ...row,
        person: row.person === null ? null : (each.people[row.person] ?? null),
      })),
    );
  });

  test("swapped-labels: the buckets' labels do not say which is which, the rows and the heading do", () => {
    const each = fixture("swapped-labels");
    const view = layoutView(each.sheets);
    expect(view).toContain('B="Compte 1 : courant · Compte 2 : maison"');
    const reading = readWorkbook(each.sheets, { people: each.people, layout: each.layout });
    const loan = reading.movements.filter((movement) => movement.detail === "Paiement prêt");
    expect(loan.length).toBeGreaterThanOrEqual(6);
    // The same amount every month, and only ever in the bucket that is the mortgage.
    expect(
      new Set(loan.map((movement) => `${movement.bucket}:${String(movement.amountCents)}`)),
    ).toEqual(new Set(["mortgage:-104987"]));
    expect(reading.carryOvers.length).toBeGreaterThan(0);
  });

  test("empty-columns-carry: the column left of the amount holds nothing on any row", () => {
    const each = fixture("empty-columns-carry");
    for (const sheet of each.sheets) {
      expect(
        sheet.rows.every((row) => row[4] === undefined || row[4] === null),
        sheet.name,
      ).toBe(true);
      expect(sheet.rows.some((row) => row[5] !== undefined && row[5] !== null)).toBe(true);
    }
  });

  test("empty-columns-csv: a layout that reads empty columns reads no row, and that is a problem naming the sheet and the rows skipped", () => {
    const each = fixture("empty-columns-csv");
    const gap = wrong(each.layout, (copy) => {
      moveColumn(copy, "withdrawal", "D");
      moveColumn(copy, "deposit", "G");
    });
    const reading = readWorkbook(each.sheets, { people: each.people, layout: gap });
    expect([reading.movements.length + reading.unfiled.length, reading.skipped.length]).toEqual([
      0, 32,
    ]);
    // The gap lg-38's gate 1 named and lg-56 measured, closed by lg-66 (Build 2.2).
    expect(reading.problems).toEqual([
      'The layout reads no row of the account from "chequing-activity.csv": 32 dated rows were skipped for having no amount, and none was read.',
    ]);
  });

  test("bank-preamble: the lines above the header are text and are read as no movement", () => {
    const each = fixture("bank-preamble");
    const [sheet] = each.sheets;
    expect(sheet?.rows.slice(0, 4).map((row) => row.length)).toEqual([1, 2, 2, 1]);
    expect(sheet?.rows[4]?.[0]).toEqual({ value: { kind: "text", text: "Date" }, formula: null });
  });

  test("bank-two-dates: the dates differ on some rows and not all, and only the posted one is in order", () => {
    const each = fixture("bank-two-dates");
    const rows = (each.sheets[0]?.rows ?? []).slice(1);
    const dates = rows.map((row) => [row[0]?.value, row[1]?.value] as const);
    const differing = dates.filter(
      ([posted, made]) => JSON.stringify(posted) !== JSON.stringify(made),
    );
    expect(differing.length).toBeGreaterThan(3);
    expect(differing.length).toBeLessThan(dates.length / 2);
    const wrongly = readWorkbook(each.sheets, {
      people: each.people,
      layout: wrong(each.layout, (copy) => moveColumn(copy, "date", "B")),
    });
    // The reader notices the order is off, and calls it no problem.
    expect(wrongly.outOfOrder.length).toBeGreaterThan(0);
    expect(wrongly.problems).toEqual([]);
    // And the posted date is in order on every row.
    const rightly = readWorkbook(each.sheets, { people: each.people, layout: each.layout });
    expect(rightly.outOfOrder).toEqual([]);
  });

  test("bank-footer: the lines after the last movement hold no date, and their figures sit in the balance column", () => {
    const each = fixture("bank-footer");
    const rows = each.sheets[0]?.rows ?? [];
    const footer = rows.slice(-3);
    expect(footer.map((row) => row[1]?.value)).toEqual([
      { kind: "text", text: "Total withdrawals" },
      { kind: "text", text: "Total deposits" },
      { kind: "text", text: "Closing balance" },
    ]);
    expect(footer.every((row) => row[0] === null && row[2] === null)).toBe(true);
    // A figure in the amount column of a row with no date is a problem under any description,
    // so a footer written that way could not be read cleanly and is not a fixture.
    const sheets = each.sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows.map((row, index) =>
        index < sheet.rows.length - 3 ? row : [row[0] ?? null, row[1] ?? null, row[3] ?? null],
      ),
    }));
    const reading = readWorkbook(sheets, { people: each.people, layout: each.layout });
    expect(reading.problems.length).toBeGreaterThanOrEqual(3);
    expect(reading.problems[0]).toContain("an amount with no date");
  });

  test("bank-wide: at least ten columns, and the four a description needs are among them", () => {
    const each = fixture("bank-wide");
    const width = Math.max(...(each.sheets[0]?.rows ?? []).map((row) => row.length));
    expect(width).toBeGreaterThanOrEqual(10);
    expect(each.layout.account.columns).toHaveLength(4);
  });
});
