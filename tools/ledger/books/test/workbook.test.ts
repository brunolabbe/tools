/**
 * Reading the old workbook from plain cell grids (lg-7). The grids are built
 * here, by hand; the `.xlsx` round trip is `api`'s and is tested there. Every
 * name and amount is invented.
 */

import { describe, expect, test } from "vitest";
import { HOUSEHOLD_LAYOUT, readCorrections, readWorkbook, toCents } from "../src/index.ts";
import type { Cell, ReadOptions, Sheet } from "../src/index.ts";

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

/** As the household's Accueil has it: names heading columns, salaries in a labelled row under them. */
const ACCUEIL = sheet("Accueil", [
  [null, "Alex", "Sam"],
  ["Salaires bruts", 60000, 40000],
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

/** A corrections file holding one ratio. */
function one(shares: unknown, name: unknown = "$ (A)"): unknown {
  return { ratios: [{ sheet: name, shares }] };
}

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

  test("a ratio in the corrections file is refused whole when it is malformed", () => {
    expect(() => readCorrections(one({ Alex: 60, Sam: 30 }))).toThrow(
      "ratio 1's shares add up to 90 %, not 100 %.",
    );
    expect(() => readCorrections(one({ Alex: 60 }))).toThrow("ratio 1's shares name two people");
    expect(() => readCorrections(one({ Alex: 60.00001, Sam: 39.99999 }))).toThrow(
      "finer than a part per million",
    );
    expect(() => readCorrections(one({ Alex: 120, Sam: -20 }))).toThrow("not a percentage");
    expect(() => readCorrections(one({ Alex: 60, Sam: 40 }, ""))).toThrow(
      "ratio 1 names no period sheet",
    );
    expect(readCorrections(one({ Alex: 55.5, Sam: 44.5 })).ratios).toEqual([
      {
        sheet: "$ (A)",
        shares: new Map([
          ["Alex", 555_000],
          ["Sam", 445_000],
        ]),
      },
    ]);
  });

  test("a ratio is given to the closed period it names, and refused for any other", () => {
    const corrections = readCorrections({
      ratios: [
        { sheet: "$ (A)", shares: { Sam: 45, Alex: 55 } },
        { sheet: "$ (B)", shares: { Alex: 50, Sam: 50 } },
      ],
    });
    const reading = readWorkbook(
      [period("$ (A)", [{ formula: "D12/B1-C12", result: 380 }]), ACCUEIL],
      {
        people,
        corrections,
      },
    );

    expect(reading.periods[0]?.ratio).toEqual([
      { personId: "alex", partsPerMillion: 550_000 },
      { personId: "sam", partsPerMillion: 450_000 },
    ]);
    // This grid has no year sheet, which is its own problem; of the ratios, only the second is one.
    expect(reading.problems.filter((problem) => problem.includes("ratio"))).toEqual([
      `The corrections file's ratio 2, for "$ (B)", names no closed period sheet of the workbook.`,
    ]);
  });

  test("an amount that is text, a formula with no saved value, or finer than a cent is refused at its cell", () => {
    const reading = readWorkbook(
      [
        {
          name: "2022",
          rows: [
            [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant"].map(cell),
            [null, d("2022-03-01"), "Hypothèque", "Versement", "Alex", 1_000.005, 500.005].map(
              cell,
            ),
            [null, d("2022-02-01"), "Hypothèque", "Versement", "Alex", 500, "9,99 $"].map(cell),
            [
              ...[null, d("2022-01-01"), "Hypothèque", "Versement", "Alex", 500].map(cell),
              { value: null, formula: "SUM(Z1:Z9)" },
            ],
          ],
        },
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.problems).toEqual([
      "2022!G2: 500.005 is not a whole number of cents.",
      "2022!G3: the amount is not a number.",
      "2022!G4: the amount is a formula with no readable value; open the workbook in Excel and save it.",
    ]);
    expect(reading.skipped).toEqual([]);
  });

  test("a repaired year the row order contradicts is refused at its cell", () => {
    const reading = readWorkbook(
      [
        year("2024", [
          ["2024-01-20", "Hypothèque", "Versement", "Alex", 1_000, 500],
          // Typed 2023-12-30, between January rows: the sheet's year would
          // put it in December 2024, after the row above it.
          ["2023-12-30", "Hypothèque", "Versement", "Alex", 500, 250],
          ["2024-01-05", "Hypothèque", "Versement", "Alex", 250, 250],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.repairs).toEqual([
      { sheet: "2024", row: 3, from: "2023-12-30", to: "2024-12-30" },
    ]);
    expect(reading.problems).toEqual([
      "2024!B3: typed 2023-12-30 and repaired to 2024-12-30, the sheet's year, but row 2 (2024-01-20) is listed above row 3 (2024-12-30); newest first, the order does not prove the repair.",
    ]);
  });

  test("a date typed a few days off, with no year repaired, is reported and imported as typed", () => {
    const reading = readWorkbook(
      [
        year("2024", [
          ["2024-01-20", "Hypothèque", "Versement", "Alex", 1_000, 500],
          ["2024-01-25", "Hypothèque", "Versement", "Alex", 500, 250],
          ["2024-01-05", "Hypothèque", "Versement", "Alex", 250, 250],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.problems).toEqual([]);
    expect(reading.outOfOrder).toEqual([
      { sheet: "2024", row: 2, date: "2024-01-20", belowRow: 3, belowDate: "2024-01-25" },
    ]);
    expect(reading.movements.map((movement) => movement.date)).toEqual([
      "2024-01-05",
      "2024-01-25",
      "2024-01-20",
    ]);
  });
});

// lg-37: the layout the household's own workbook has, which lg-7's fixtures did not.
describe("reading the workbook's own layout", () => {
  /** A period sheet with its summary in rows 2 to 4, above the lines, as the household keeps it. */
  function summarised(name: string, start: string, end: string, summary: Input[][]): Sheet {
    return sheet(name, [
      [null, null, "Alex", "Sam"],
      ...summary,
      [],
      [null, "Période de facturation", d(start), d(end)],
      [],
      [null, "Épicerie", null, 300],
      [null, "Quincaillerie", 120, null],
    ]);
  }

  /** v1: the division is in the Équivalence row, and Montant à déposer only subtracts. */
  const V1_SUMMARY: Input[][] = [
    [
      null,
      "Total",
      { formula: "SUM(C8:C202)", result: 120 },
      { formula: "SUM(D8:D202)", result: 300 },
    ],
    [
      null,
      "Équivalence",
      { formula: "IF(C2<D2,C2*Accueil!B2,C2)", result: 120 },
      { formula: "IF(D2<C2,D2/Accueil!B2,D2)", result: 300 },
    ],
    [
      null,
      "Montant à déposer",
      { formula: "IF(C3<D3,D3-C3,0)", result: 180 },
      { formula: "IF(D3<C3,C3-D3,0)", result: 0 },
    ],
  ];

  /** v2: the product is in Montant à déposer itself. */
  const V2_SUMMARY: Input[][] = [
    [
      null,
      "Total",
      { formula: "SUM(C8:C202)", result: 120 },
      { formula: "SUM(D8:D202)", result: 300 },
    ],
    [],
    [
      null,
      "Montant à déposer",
      { formula: "IF(C2-(C2+D2)*Accueil!B2<0,ABS(C2-(C2+D2)*Accueil!B2),0)", result: 132 },
      { formula: "IF(D2-(D2+C2)*Accueil!C2<0,ABS(D2-(D2+C2)*Accueil!C2),0)", result: 0 },
    ],
  ];

  test("a period's summary above its lines is read: its total checked, its deposit's version told", () => {
    const reading = readWorkbook(
      [
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        summarised("$ (B)", "2022-08-31", "2023-01-31", V2_SUMMARY),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.problems).toEqual(["The workbook has no year sheet (2022, 2023, …)."]);
    expect(reading.periods.map((read) => [read.sheet, read.settlement])).toEqual([
      ["$ (A)", { formula: "v1", payerId: "alex", recipientId: "sam", depositCents: 18_000 }],
      ["$ (B)", { formula: "v2", payerId: "alex", recipientId: "sam", depositCents: 13_200 }],
    ]);
    // Only rows 8 onward are lines; the summary's figures are not.
    expect(reading.periods[0]?.lines.map((line) => [line.row, line.amountCents])).toEqual([
      [8, 30_000],
      [9, 12_000],
    ]);
    expect(reading.checks).toContain("$ (A): alex's lines add up to the sheet's total, 120.00.");
  });

  test("a summary total the lines do not make is refused", () => {
    const wrong: Input[][] = [
      [null, "Total", 125, { formula: "SUM(D8:D202)", result: 300 }],
      ...V1_SUMMARY.slice(1),
    ];
    const reading = readWorkbook(
      [summarised("$ (A)", "2022-04-01", "2022-08-31", wrong), ACCUEIL],
      { people },
    );

    expect(reading.problems).toContain(
      "'$ (A)'!C2: alex's lines add up to 120.00, but the sheet's total says 125.00.",
    );
  });

  test("a year's summary above its movements is not money; the same figure below one is", () => {
    const rows: Input[][] = [
      [
        null,
        null,
        "Solde Dép. Courantes",
        null,
        null,
        null,
        { formula: "SUMIF(C6:C9,1)", result: 0 },
      ],
      [
        null,
        null,
        "Solde Hypothèque",
        null,
        null,
        null,
        { formula: "SUMIF(C6:C9,2)", result: 500 },
      ],
      [null, null, "Total", null, null, null, { formula: "SUM(G1,G2)", result: 500 }],
      [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant"],
      [null, d("2022-03-01"), "Hypothèque", "Versement", "Alex", 500, 500],
      [null, null, "Total", null, null, null, 500],
    ];
    const reading = readWorkbook([sheet("2022", rows), ACCUEIL], { people });

    expect(reading.problems).toEqual(["2022!B6: an amount with no date."]);
    expect(reading.movements.map((movement) => movement.row)).toEqual([5]);
  });

  test("Accueil's salaries are the labelled row, never the figures under its calculators' headings", () => {
    const reading = readWorkbook(
      [
        sheet("Accueil", [
          [null, "Alex", "Sam"],
          ["Salaires bruts (2022)", 60000, 40000],
          ["Facteur équivalence (2022)", 0.6, 0.4],
          [],
          [null, "Alex", "Sam"],
          ["Équivalence avec un total", 900, 600],
        ]),
      ],
      { people },
    );

    expect(reading.salaries).toEqual([
      { personId: "alex", amountCents: 6_000_000 },
      { personId: "sam", amountCents: 4_000_000 },
    ]);
    expect(reading.problems).not.toContainEqual(expect.stringContaining("salar"));
  });

  test("a second Salaires row, or none, is refused", () => {
    const twice = readWorkbook(
      [
        sheet("Accueil", [
          [null, "Alex", "Sam"],
          ["Salaires (2022)", 60000, 40000],
          ["Salaires (2024)", 65000, 45000],
        ]),
      ],
      { people },
    );
    const none = readWorkbook(
      [
        sheet("Accueil", [
          ["Alex", 60000],
          ["Sam", 40000],
        ]),
      ],
      { people },
    );

    expect(twice.problems).toContain("Accueil!B3: a second salary for alex.");
    expect(none.problems).toContain(
      "Accueil: 0 salaries were found; the ratio needs one for each of two people, in a row labelled Salaires, under a column each one's name heads.",
    );
  });

  test("periods that overlap are refused; one may start the day the last ends", () => {
    const touching = readWorkbook(
      [
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        summarised("$ (B)", "2022-08-31", "2023-01-31", V2_SUMMARY),
        ACCUEIL,
      ],
      { people },
    );
    const overlapping = readWorkbook(
      [
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        summarised("$ (B)", "2022-06-15", "2023-01-31", V2_SUMMARY),
        ACCUEIL,
      ],
      { people },
    );
    const openInside = readWorkbook(
      [
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        sheet("$ (B)", [
          [null, null, "Alex", "Sam"],
          [],
          [],
          [],
          [],
          [null, null, d("2022-06-15")],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    const openTouching = readWorkbook(
      [
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        sheet("$ (B)", [
          [null, null, "Alex", "Sam"],
          [],
          [],
          [],
          [],
          [null, null, d("2022-08-31")],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    expect(touching.problems).not.toContainEqual(expect.stringContaining("overlap"));
    expect(openTouching.problems).not.toContainEqual(expect.stringContaining("overlap"));
    expect(overlapping.problems).toContain(
      "'$ (B)'!A6: $ (B) starts on 2022-06-15, before $ (A) ends on 2022-08-31; periods do not overlap.",
    );
    expect(openInside.problems).toContain(
      "'$ (B)'!A6: $ (B) starts on 2022-06-15, before $ (A) ends on 2022-08-31; periods do not overlap.",
    );
  });

  test("a deposit's own formula is followed only to cells of its own sheet", () => {
    // C2 divides, so a formula that reads it is v1; one that only names another
    // sheet's C2, alone or as a range's far end, reads nothing here.
    const grid = (formula: string): Sheet =>
      sheet("$ (A)", [
        [null, null, "Alex", "Sam"],
        [null, "Équivalence", { formula: "D5/2", result: 1 }],
        [],
        [],
        [],
        [null, null, d("2022-04-01"), d("2022-08-31")],
        [],
        [null, "Épicerie", null, 300],
        [null, "Montant à déposer", { formula, result: 380 }],
      ]);
    const read = (formula: string): string | undefined =>
      readWorkbook([grid(formula), ACCUEIL], { people }).periods[0]?.settlement?.formula;

    expect(read("C2-D8")).toBe("v1");
    expect(read("Accueil!C2-D8")).toBeUndefined();
    expect(read("SUM(Accueil!B2:C2)-D8")).toBeUndefined();
  });

  test("a summary row below the lines ends them: nothing under it is a line", () => {
    const below = sheet("$ (A)", [
      [null, null, "Alex", "Sam"],
      [],
      [],
      [],
      [],
      [null, null, d("2022-04-01"), d("2022-08-31")],
      [],
      [null, "Épicerie", null, 300],
      [null, "Montant à déposer", { formula: "D8/Accueil!B2-C8", result: 500 }],
      [null, "Calcul", 999, 999],
    ]);
    const reading = readWorkbook([below, ACCUEIL], { people });

    expect(reading.periods[0]?.lines.map((line) => line.row)).toEqual([8]);
  });

  test("a detail that starts like a summary, on a row with no readable date, is still money", () => {
    const rows: Input[][] = [
      [null, "2022-03-09", "Hypothèque", "Solde de tout compte", "Sam", 800, 300],
      [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant"],
      [null, d("2022-03-01"), "Hypothèque", "Versement", "Alex", 500, 500],
    ];
    const reading = readWorkbook([sheet("2022", rows), ACCUEIL], { people });

    expect(reading.problems).toContain("2022!B1: an amount with no date.");
  });

  test("a closed period's deposit is found by payer and amount, from two weeks before its end", () => {
    const reading = readWorkbook(
      [
        year("2022", [
          // Fifteen days before $ (B) ends: one day too early to be its deposit.
          ["2022-12-16", "Dép. Courantes", "Dépôt", "Alex", 312, 132],
          ["2022-09-05", "Dép. Courantes", "Dépôt", "Alex", 180, 180],
        ]),
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        summarised("$ (B)", "2022-08-31", "2022-12-31", V2_SUMMARY),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.deposits).toEqual([
      {
        sheet: "$ (A)",
        payerId: "alex",
        askedCents: 18_000,
        from: "2022-08-17",
        paid: { sheet: "2022", row: 3, date: "2022-09-05" },
      },
      { sheet: "$ (B)", payerId: "alex", askedCents: 13_200, from: "2022-12-17", paid: null },
    ]);
  });

  test("the right amount from the other person does not pay a period's deposit", () => {
    const reading = readWorkbook(
      [
        year("2022", [["2022-09-05", "Dép. Courantes", "Dépôt", "Sam", 180, 180]]),
        summarised("$ (A)", "2022-04-01", "2022-08-31", V1_SUMMARY),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.deposits.map((deposit) => deposit.paid)).toEqual([null]);
  });
});

// lg-38: a description drives the reading, the household's being one.
type Layout = NonNullable<ReadOptions["layout"]>;

/** A bank export's description: one sheet, oldest first, no buckets. */
function statement(columns: Layout["account"]["columns"]): Layout {
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

describe("reading the workbook through a layout", () => {
  const SPLIT = statement([
    { role: "date", column: "A" },
    { role: "detail", column: "B" },
    { role: "withdrawal", column: "C" },
    { role: "deposit", column: "D" },
    { role: "balance", column: "E" },
  ]);

  test("a layout the schema refuses is a problem, not a throw, and nothing is read", () => {
    const twice = statement([
      { role: "date", column: "A" },
      { role: "amount", column: "B" },
      { role: "amount", column: "C" },
    ]);
    const reading = readWorkbook([sheet("releve.csv", [[d("2024-01-02"), 5, 5]])], {
      people,
      layout: twice,
    });

    expect(reading.problems).toEqual([
      'The layout, at account.columns.2.role: The role "amount" is named twice; each role is one column.',
    ]);
    expect(reading.unfiled).toEqual([]);
  });

  test("withdrawals and deposits are proven by the balance from where the first row stood, and left unfiled with no bucket", () => {
    const rows: Input[][] = [
      ["Date", "Description", "Retrait", "Dépôt", "Solde"],
      [d("2024-01-02"), "PAIE", null, 1_000, 1_500],
      [d("2024-01-05"), "EPICERIE", 120.5, null, 1_379.5],
      [d("2024-01-09"), "REMBOURSEMENT", null, 20.5, 1_400],
    ];
    const reading = readWorkbook([sheet("releve.csv", rows)], { people, layout: SPLIT });

    expect(reading.problems).toEqual([]);
    expect(reading.movements).toEqual([]);
    expect(
      reading.unfiled.map((row) => [row.row, row.amountCents, row.bucket, row.detail]),
    ).toEqual([
      [2, 100_000, null, "PAIE"],
      [3, -12_050, null, "EPICERIE"],
      [4, 2_050, null, "REMBOURSEMENT"],
    ]);
    expect(reading.checks).toEqual([
      "The running balance follows from row to row through all 3 movements, from the 500.00 the first row implies.",
    ]);

    const broken = rows.map((row) => [...row]);
    broken[3] = [d("2024-01-09"), "REMBOURSEMENT", 20.5, null, 1_400];
    expect(readWorkbook([sheet("releve.csv", broken)], { people, layout: SPLIT }).problems).toEqual(
      [
        "'releve.csv'!E4: the running balance is 1400.00, but the row before it left 1379.50 and this one moves -20.50 (41.00 unexplained).",
      ],
    );
  });

  test("with no balance column nothing proves the rows, which is a problem", () => {
    const layout = statement([
      { role: "date", column: "A" },
      { role: "amount", column: "B" },
    ]);
    const reading = readWorkbook([sheet("releve.csv", [[d("2024-01-02"), -5]])], {
      people,
      layout,
    });

    expect(reading.problems).toEqual([
      "The layout names no balance column, so nothing proves the 1 rows read are all of them or that their amounts are right. Match them one for one against a statement paste of the same dates first (docs/00-ANALYSIS.md §8).",
    ]);
    expect(reading.unfiled.map((row) => [row.amountCents, row.balanceCents])).toEqual([
      [-500, null],
    ]);
  });

  test("a split amount finer than a cent is named at its own cell", () => {
    const reading = readWorkbook(
      [sheet("releve.csv", [[d("2024-01-02"), "X", null, 10.005, 10.005]])],
      { people, layout: SPLIT },
    );

    expect(reading.problems).toEqual(["'releve.csv'!D1: 10.005 is not a whole number of cents."]);
  });

  test("an oldest-first year sheet, with its own columns and labels, reads as the household's does", () => {
    const layout: Layout = {
      ...HOUSEHOLD_LAYOUT,
      account: {
        sheets: { by: "year" },
        yearPerSheet: true,
        order: "oldest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "amount", column: "B" },
          { role: "balance", column: "C" },
          { role: "bucket", column: "D" },
          { role: "person", column: "E" },
        ],
        buckets: [
          { bucket: "mortgage", labels: ["Maison"] },
          { bucket: "current-expenses", labels: ["Courant"] },
        ],
        carryOverLabel: "Report",
        summary: null,
      },
    };
    const reading = readWorkbook(
      [
        sheet("2024", [
          ["Jour", "Mouvement", "Cumul", "Enveloppe", "Qui"],
          [d("2024-01-01"), 0, null, "Maison", "Report"],
          [d("2024-01-01"), 0, null, "Courant", "Report"],
          [d("2024-01-20"), 500, 500, "Maison", "Alex"],
          // Typed in 2014; the sheet's year repairs it, and the order bears it out.
          [d("2014-02-03"), -100, 400, "Courant", null],
          [d("2024-01-25"), 50, 450, "Courant", "Sam"],
        ]),
        ACCUEIL,
      ],
      { people, layout },
    );

    expect(reading.repairs).toEqual([
      { sheet: "2024", row: 5, from: "2014-02-03", to: "2024-02-03" },
    ]);
    expect(reading.problems).toEqual([
      "2024!A5: typed 2014-02-03 and repaired to 2024-02-03, the sheet's year, but row 5 (2024-02-03) is listed above row 6 (2024-01-25); oldest first, the order does not prove the repair.",
    ]);
    expect(reading.movements.map((movement) => [movement.row, movement.bucket])).toEqual([
      [4, "mortgage"],
      [5, "current-expenses"],
      [6, "current-expenses"],
    ]);
  });
});

describe("a detail cell that holds a number (lg-68)", () => {
  /** One movement per detail, listed newest first as the household's sheets are. */
  function details(...cells: Input[]): Sheet {
    const rows: Input[][] = cells.map((detail, index) => [
      null,
      d(`2022-03-${String(cells.length - index).padStart(2, "0")}`),
      "Dép. Courantes",
      detail,
      "Alex",
      (cells.length - index) * 10,
      10,
    ]);
    return sheet("2022", [
      [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant"],
      ...rows,
    ]);
  }

  test("is read as the number's text, never as an empty detail", () => {
    // `007` typed in Excel is saved as the number 7: the cell keeps no zeros.
    const reading = readWorkbook([details(42, 7, -3.5, 0.1 + 0.2, "Versement"), ACCUEIL], {
      people,
    });

    expect(reading.problems).toEqual([]);
    expect(reading.movements.map((movement) => movement.detail)).toEqual([
      "Versement",
      "0.3",
      "-3.5",
      "7",
      "42",
    ]);
  });
});

/** One movement per entry, newest first, each cell as given: the household's `D`, `E` and `H`. */
function movementRows(entries: { detail?: Input; person?: Input; note?: Input }[]): Sheet {
  const rows: Input[][] = entries.map((entry, index) => [
    null,
    d(`2022-03-${String(entries.length - index).padStart(2, "0")}`),
    "Dép. Courantes",
    entry.detail ?? "Versement",
    entry.person ?? "Alex",
    (entries.length - index) * 10,
    10,
    entry.note ?? null,
  ]);
  return sheet("2022", [
    [null, "Date", "Compte", "Détail", "Personne", "Solde", "Montant", "Note"],
    ...rows,
  ]);
}

describe("a free-text cell that holds a number or a date (lg-68, round 1)", () => {
  test("a detail holding a date is read as its ISO day", () => {
    const reading = readWorkbook(
      [movementRows([{ detail: d("2022-01-05") }, { detail: "Versement" }]), ACCUEIL],
      { people },
    );

    expect(reading.problems).toEqual([]);
    expect(reading.movements.map((movement) => movement.detail)).toEqual([
      "Versement",
      "2022-01-05",
    ]);
  });

  test("a detail holding a formula is read as its cached number", () => {
    const reading = readWorkbook(
      [movementRows([{ detail: { formula: "1+1", result: 2 } }]), ACCUEIL],
      { people },
    );

    expect(reading.problems).toEqual([]);
    expect(reading.movements.map((movement) => movement.detail)).toEqual(["2"]);
  });

  test("a movement's note holding a number or a date is read as its text", () => {
    const reading = readWorkbook(
      [movementRows([{ note: 42 }, { note: d("2022-01-05") }, { note: "marché" }, {}]), ACCUEIL],
      { people },
    );

    expect(reading.problems).toEqual([]);
    expect(reading.movements.map((movement) => movement.note)).toEqual([
      null,
      "marché",
      "2022-01-05",
      "42",
    ]);
  });

  test("a period line's note holding a number or a date is read as its text", () => {
    const reading = readWorkbook(
      [
        sheet("$ (A)", [
          ["Période", null, "Alex", "Sam"],
          [],
          [],
          [],
          [],
          ["Du", d("2022-04-01"), "au", d("2022-08-31")],
          ["Item", null, null, null, "Note"],
          ["Épicerie", null, null, 300, 42],
          ["Quincaillerie", null, 120, null, d("2022-05-03")],
          ["Montant à déposer", null, { formula: "D10/Accueil!B1-C10", result: 380 }],
        ]),
        ACCUEIL,
      ],
      { people },
    );

    expect(reading.periods[0]?.lines.map((line) => [line.label, line.note])).toEqual([
      ["Épicerie", "42"],
      ["Quincaillerie", "2022-05-03"],
    ]);
  });

  test("a number or a date in the person column is refused, naming the cell", () => {
    const reading = readWorkbook(
      [movementRows([{ person: 42 }, { person: d("2022-01-05") }, {}]), ACCUEIL],
      { people },
    );

    expect(reading.problems).toEqual(
      expect.arrayContaining([
        `2022!E2 names "42", who is not one of the household (alex, sam). Map the name to a person in the corrections file's "people".`,
        `2022!E3 names "2022-01-05", who is not one of the household (alex, sam). Map the name to a person in the corrections file's "people".`,
      ]),
    );
    expect(reading.movements.map((movement) => movement.row)).toEqual([4]);
  });
});
