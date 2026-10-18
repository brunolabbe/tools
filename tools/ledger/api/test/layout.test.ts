/**
 * lg-38's fixtures and scoring, offline: every fixture reads cleanly through
 * the layout written for it, and the scoring tells a wrong layout the
 * verifications catch from one they would let through. No model is called;
 * the live run is `test/live/layout-run.ts`, by hand. Every name and amount
 * is invented.
 */

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { beforeAll, describe, expect, test } from "vitest";
import { HOUSEHOLD_LAYOUT, readWorkbook } from "@ledger/books";
import { workbookLayoutSchema } from "@ledger/contract";
import type { WorkbookLayout } from "@ledger/contract";
import { layoutFixtures } from "./layout/fixtures.ts";
import type { LayoutFixture } from "./layout/fixtures.ts";
import { scoreLayout } from "./layout/score.ts";
import type { Outcome } from "./layout/score.ts";
import {
  DEFAULT_VIEW,
  estimateTokens,
  layoutRequest,
  layoutView,
  shownRows,
} from "./layout/view.ts";

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

describe("lg-38's fixtures", () => {
  test("there are six, and each reads through its own layout with no problem but the unprovable CSV's", () => {
    expect(fixtures.map((each) => each.name)).toEqual([
      "lg7",
      "lg37",
      "moved",
      "english",
      "csv-balance",
      "csv-no-balance",
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
    const format = zodOutputFormat(workbookLayoutSchema);
    expect(format.type).toBe("json_schema");
    expect(format.schema["additionalProperties"]).toBe(false);
    expect(JSON.stringify(format.schema)).toContain("withdrawal");
  });
});
