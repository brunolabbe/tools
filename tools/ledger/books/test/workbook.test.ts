/**
 * Reading the old workbook from plain cell grids (lg-7). The grids are built
 * here, by hand; the `.xlsx` round trip is `api`'s and is tested there. Every
 * name and amount is invented.
 */

import { describe, expect, test } from "vitest";
import { readCorrections, readWorkbook, toCents } from "../src/index.ts";
import type { Cell, Sheet } from "../src/index.ts";

type Input = string | number | { date: string } | { formula: string; result: number } | null;

function cell(input: Input): Cell | null {
  if (input === null) return null;
  if (typeof input === "string") return { value: { kind: "text", text: input }, formula: null };
  if (typeof input === "number") return { value: { kind: "number", number: input }, formula: null };
  if ("date" in input) return { value: { kind: "date", date: input.date }, formula: null };
  return { value: { kind: "number", number: input.result }, formula: input.formula };
}

function sheet(name: string, rows: Input[][]): Sheet {
  return { name, rows: rows.map((row) => row.map(cell)) };
}

const d = (date: string): { date: string } => ({ date });

/** A year sheet, newest first: [date, bucket, detail, person, balance, amount]. */
function year(
  name: string,
  rows: [string, string, string, string | null, number, number][],
): Sheet {
  return sheet(name, [
    [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant", "Note"],
    ...rows.map(([date, bucket, detail, person, balance, amount]): Input[] => [
      null,
      d(date),
      bucket,
      detail,
      person,
      balance,
      amount,
    ]),
  ]);
}

const ACCUEIL = sheet("Accueil", [
  ["Alex", 60000],
  ["Sam", 40000],
]);

function period(name: string, deposit: Input[]): Sheet {
  return sheet(name, [
    ["Période", null, "Alex", "Sam"],
    [],
    [],
    [],
    [],
    ["Du", d("2022-04-01"), "au", d("2022-08-31")],
    ["Item", null, null, null, "Note"],
    ["Épicerie", null, null, 300],
    ["Quincaillerie", null, 120, null],
    ["Montant à déposer", null, ...deposit],
  ]);
}

const people = ["alex", "sam"];

describe("reading the workbook", () => {
  test("a cached figure is rounded to the cent once, half away from zero", () => {
    expect(toCents(380)).toBe(38_000);
    expect(toCents(0.1 + 0.2)).toBe(30);
    // 1.005 × 100 is 100.49999999999999 as a float.
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(-0.004)).toBe(0);
  });

  test("a running balance that does not follow names its cell and the money unexplained", () => {
    const reading = readWorkbook(
      [
        year("2022", [
          ["2022-03-01", "Hypothèque", "Versement", "Alex", 1_000, 500],
          ["2022-02-01", "Hypothèque", "Versement", "Sam", 499, 500],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.problems).toEqual([
      "2022!F3: the running balance is 499.00, but the row before it left 0.00 and this one moves 500.00 (-1.00 unexplained).",
      "2022!F2: the running balance is 1000.00, but the row before it left 499.00 and this one moves 500.00 (1.00 unexplained).",
    ]);
  });

  test("a period's formula version is told by its text: a division is v1, a product v2", () => {
    const v1 = readWorkbook(
      [period("$ (A)", [{ formula: "D12/Accueil!B1-C12", result: 380 }]), ACCUEIL],
      {
        people,
      },
    );
    const v2 = readWorkbook(
      [period("$ (A)", [null, { formula: "(1-Accueil!C1)*(C12+D12)-D12", result: 12 }]), ACCUEIL],
      {
        people,
      },
    );

    expect(v1.periods[0]?.settlement).toEqual({
      formula: "v1",
      payerId: "alex",
      recipientId: "sam",
      depositCents: 38_000,
    });
    expect(v2.periods[0]?.settlement).toEqual({
      formula: "v2",
      payerId: "sam",
      recipientId: "alex",
      depositCents: 1_200,
    });
  });

  test("a Montant à déposer with no formula, or one that is neither version, is refused", () => {
    const typed = readWorkbook([period("$ (A)", [380]), ACCUEIL], { people });
    const other = readWorkbook([period("$ (A)", [{ formula: "E40", result: 380 }]), ACCUEIL], {
      people,
    });

    expect(typed.problems).toContain(
      "'$ (A)'!C10: the Montant à déposer has no formula, so its version cannot be told.",
    );
    expect(other.problems).toContain(
      "'$ (A)'!C10: the formula =E40 is neither v1 (a division by the ratio) nor v2 (a product with it).",
    );
  });

  test("a name nobody configured is a problem until the corrections file maps it", () => {
    const sheets = [
      year("2022", [["2022-02-01", "Hypothèque", "Versement", "Alexandre", 500, 500]]),
      ACCUEIL,
    ];

    const unmapped = readWorkbook(sheets, { people });
    const mapped = readWorkbook(sheets, {
      people,
      corrections: readCorrections({ people: { Alexandre: "alex" } }),
    });

    expect(unmapped.problems).toEqual([
      '2022!E2 names "Alexandre", who is not one of the household (alex, sam). Map the name to a person in the corrections file\'s "people".',
    ]);
    expect(mapped.problems).toEqual([]);
    expect(mapped.movements.map((movement) => movement.personId)).toEqual(["alex"]);
  });

  test("a correction must name a movement, and must change it", () => {
    const sheets = [
      year("2022", [["2022-02-01", "Hypothèque", "Versement", "Alex", 500, 500]]),
      ACCUEIL,
    ];
    const reading = readWorkbook(sheets, {
      people,
      corrections: readCorrections({
        corrections: [
          { sheet: "2022", row: 1, bucket: "current-expenses", note: "the header" },
          { sheet: "2021", row: 2, bucket: "current-expenses", note: "no such year" },
          { sheet: "2022", row: 2, bucket: "mortgage", note: "already so" },
        ],
      }),
    });

    expect(reading.problems).toEqual([
      "The correction for 2022!B1 names a row that is not a movement of the account.",
      "The correction for 2021!B2 names a sheet the workbook does not have.",
      "The correction for 2022!B2 files the row as the workbook already does.",
    ]);
  });

  test("the corrections file is refused whole when an entry is malformed", () => {
    expect(() =>
      readCorrections({ corrections: [{ sheet: "2022", row: 3, bucket: "mortgage" }] }),
    ).toThrow("correction 1 has no note");
    expect(() => readCorrections({ corrections: [{ sheet: "2022", row: 3, note: "x" }] })).toThrow(
      "changes neither bucket nor person",
    );
    expect(() => readCorrections({ fixes: [] })).toThrow('"fixes" is not a field it has');
    expect(() => readCorrections([])).toThrow("not a JSON object");
  });
});
