/**
 * A synthetic workbook shaped like the household's old one (`00-ANALYSIS.md`
 * §8), built by the test and never copied from the real file. Every name,
 * description and amount is invented.
 *
 * `history()` is the whole fixture as data, oldest first; a test changes what
 * it needs and renders it with `render()`. It carries what lg-7's brief asks
 * for: a typo'd year, a placeholder row, a joint row, carry-overs, a v1 period,
 * a v2 period, and an open one.
 *
 * The figures, worked by hand from the rows below, which is what the tests
 * hold the import to:
 *
 * - mortgage: alex deposited 2 000.00, sam 1 300.00, and the three payments
 *   (−700.00, −700.01, −700.00) are joint: −2 100.01, whose odd cent alex bears
 *   (`splitCents`). alex owns 949.99, sam 250.00; the gap is 699.99 and the
 *   balance 1 199.99.
 * - buffer: 580.00 at the end of 2022, 705.00 at the end of 2023, 405.00 now.
 * - period 1 (v1, 2022-04-01 to 2022-08-31): sam 300.00, alex 120.00, so alex
 *   deposits 300 / 0.6 − 120 = 380.00, which he did on 2022-09-10.
 * - period 2 (v2, 2022-09-01 to 2023-03-31): alex 400.00, sam 100.00, so sam
 *   deposits 0.4 × 500 − 100 = 100.00, which she did on 2023-04-10.
 */

import ExcelJS from "exceljs";

export interface YearRow {
  /** As written in the cell, `yyyy-mm-dd`: a typo'd year is written wrong here. */
  written: string;
  bucket: "Hypothèque" | "Dép. Courantes";
  detail: string;
  person?: string;
  /** In dollars; absent on a placeholder. */
  amount?: number;
  note?: string;
}

export interface YearSheet {
  year: number;
  /** The `Solde reporté` rows at the bottom of the sheet, in dollars. */
  carry: { mortgage: number; buffer: number };
  /** Oldest first. The sheet lists them newest first. */
  rows: YearRow[];
}

export interface PeriodLineSpec {
  label: string;
  alex?: number | { formula: string; result: number };
  sam?: number | { formula: string; result: number };
  note?: string;
}

export interface PeriodSheet {
  name: string;
  start: string;
  end?: string;
  lines: PeriodLineSpec[];
  /** The `Montant à déposer` row: a formula and its cached result, per person. */
  deposit: {
    alex?: { formula: string; result: number };
    sam?: { formula: string; result: number };
  };
}

export interface Fixture {
  years: YearSheet[];
  periods: PeriodSheet[];
  salaries: { alex: number; sam: number };
}

export function history(): Fixture {
  return {
    years: [
      {
        year: 2022,
        carry: { mortgage: 0, buffer: 0 },
        rows: [
          {
            written: "2022-01-05",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Alex",
            amount: 500,
          },
          {
            written: "2022-01-12",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Sam",
            amount: 500,
          },
          { written: "2022-01-20", bucket: "Hypothèque", detail: "Paiement prêt", amount: -700 },
          {
            written: "2022-02-01",
            bucket: "Dép. Courantes",
            detail: "Taxes",
            person: "Alex",
            amount: 600,
          },
          {
            written: "2022-02-01",
            bucket: "Dép. Courantes",
            detail: "Taxes",
            person: "Sam",
            amount: 400,
          },
          {
            written: "2022-03-10",
            bucket: "Dép. Courantes",
            detail: "Taxes municipales",
            amount: -800,
          },
          // A placeholder: no amount.
          { written: "2022-04-01", bucket: "Dép. Courantes", detail: "À venir" },
          // The typo'd year.
          {
            written: "2012-06-15",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Alex",
            amount: 500,
          },
          {
            written: "2022-09-10",
            bucket: "Dép. Courantes",
            detail: "Équivalence",
            person: "Alex",
            amount: 380,
            note: "Équivalence avril - août",
          },
        ],
      },
      {
        year: 2023,
        carry: { mortgage: 800, buffer: 580 },
        rows: [
          {
            written: "2023-01-05",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Alex",
            amount: 500,
          },
          {
            written: "2023-01-12",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Sam",
            amount: 500,
          },
          { written: "2023-01-20", bucket: "Hypothèque", detail: "Paiement prêt", amount: -700.01 },
          // Joint: a rebate.
          { written: "2023-02-14", bucket: "Dép. Courantes", detail: "Remise", amount: 25 },
          {
            written: "2023-03-01",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Sam",
            amount: 300,
          },
          {
            written: "2023-04-10",
            bucket: "Dép. Courantes",
            detail: "Équivalence",
            person: "Sam",
            amount: 100,
            note: "Équivalence sept - mars",
          },
        ],
      },
      {
        year: 2024,
        carry: { mortgage: 1399.99, buffer: 705 },
        rows: [
          {
            written: "2024-01-05",
            bucket: "Hypothèque",
            detail: "Versement",
            person: "Alex",
            amount: 500,
          },
          { written: "2024-01-20", bucket: "Hypothèque", detail: "Paiement prêt", amount: -700 },
          { written: "2024-02-02", bucket: "Dép. Courantes", detail: "Souffleuse", amount: -300 },
        ],
      },
    ],
    periods: [
      {
        name: "$ (Avril-Août)",
        start: "2022-04-01",
        end: "2022-08-31",
        lines: [
          { label: "Épicerie", sam: 100, note: "marché" },
          { label: "Internet", sam: { formula: "50*4", result: 200 } },
          { label: "Quincaillerie", alex: 120 },
        ],
        deposit: { alex: { formula: "D12/Accueil!C4-C12", result: 380 } },
      },
      {
        name: "$ (Sept-Mars)",
        start: "2022-09-01",
        end: "2023-03-31",
        lines: [
          { label: "Épicerie", alex: 400 },
          { label: "Pharmacie", sam: 100 },
        ],
        deposit: { sam: { formula: "Accueil!C5*(C12+D12)-D12", result: 100 } },
      },
      {
        name: "$ (Avril - …)",
        start: "2023-04-01",
        lines: [
          { label: "Épicerie", alex: 90 },
          { label: "Restaurant", sam: 30 },
        ],
        // Written once, in alex's column: negative is what sam owes.
        deposit: { alex: { formula: "Accueil!C4*(C12+D12)-C12", result: -18 } },
      },
    ],
    salaries: { alex: 60000, sam: 40000 },
  };
}

function day(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

const DATE_FORMAT = "yyyy-mm-dd";

/** The fixture as an `.xlsx` file. */
export async function render(fixture: Fixture): Promise<Buffer> {
  const book = new ExcelJS.Workbook();

  // The running balance is the account's, from what the first year carried in.
  const first = fixture.years[0];
  let balance = first === undefined ? 0 : first.carry.mortgage + first.carry.buffer;
  for (const year of fixture.years) {
    const sheet = book.addWorksheet(String(year.year));
    sheet.addRow(["", "Date", "Compte", "Détail", "Personne", "Solde", "Montant", "Note"]);
    const lines: (string | number | Date | null)[][] = [];
    for (const row of year.rows) {
      if (row.amount !== undefined) balance = Math.round((balance + row.amount) * 100) / 100;
      lines.push([
        null,
        day(row.written),
        row.bucket,
        row.detail,
        row.person ?? null,
        row.amount === undefined ? null : balance,
        row.amount ?? null,
        row.note ?? null,
      ]);
    }
    for (const line of lines.toReversed()) sheet.addRow(line);
    sheet.addRow([
      null,
      day(`${String(year.year)}-01-01`),
      "Dép. Courantes",
      "Solde reporté",
      null,
      null,
      year.carry.buffer,
    ]);
    sheet.addRow([
      null,
      day(`${String(year.year)}-01-01`),
      "Hypothèque",
      "Solde reporté",
      null,
      null,
      year.carry.mortgage,
    ]);
    sheet.getColumn(2).numFmt = DATE_FORMAT;
  }

  for (const period of fixture.periods) {
    const sheet = book.addWorksheet(period.name);
    sheet.getCell("A1").value = "Période";
    sheet.getCell("C1").value = "Alex";
    sheet.getCell("D1").value = "Sam";
    sheet.getCell("A6").value = "Du";
    sheet.getCell("B6").value = day(period.start);
    sheet.getCell("B6").numFmt = DATE_FORMAT;
    if (period.end !== undefined) {
      sheet.getCell("C6").value = "au";
      sheet.getCell("D6").value = day(period.end);
      sheet.getCell("D6").numFmt = DATE_FORMAT;
    }
    sheet.getCell("A7").value = "Item";
    sheet.getCell("E7").value = "Note";
    let row = 8;
    const totals = { alex: 0, sam: 0 };
    for (const line of period.lines) {
      sheet.getCell(`A${String(row)}`).value = line.label;
      for (const [who, column] of [
        ["alex", "C"],
        ["sam", "D"],
      ] as const) {
        const amount = line[who];
        if (amount === undefined) continue;
        sheet.getCell(`${column}${String(row)}`).value = amount;
        totals[who] += typeof amount === "number" ? amount : amount.result;
      }
      if (line.note !== undefined) sheet.getCell(`E${String(row)}`).value = line.note;
      row += 1;
    }
    const last = row - 1;
    sheet.getCell(`A${String(row)}`).value = "Total";
    sheet.getCell(`C${String(row)}`).value = {
      formula: `SUM(C8:C${String(last)})`,
      result: totals.alex,
    };
    sheet.getCell(`D${String(row)}`).value = {
      formula: `SUM(D8:D${String(last)})`,
      result: totals.sam,
    };
    row += 1;
    sheet.getCell(`A${String(row)}`).value = "Montant à déposer";
    if (period.deposit.alex !== undefined)
      sheet.getCell(`C${String(row)}`).value = period.deposit.alex;
    if (period.deposit.sam !== undefined)
      sheet.getCell(`D${String(row)}`).value = period.deposit.sam;
  }

  const home = book.addWorksheet("Accueil");
  home.getCell("A3").value = "Salaires";
  home.getCell("A4").value = "Alex";
  home.getCell("B4").value = fixture.salaries.alex;
  home.getCell("A5").value = "Sam";
  home.getCell("B5").value = fixture.salaries.sam;
  home.getCell("C4").value = {
    formula: "B4/(B4+B5)",
    result: fixture.salaries.alex / (fixture.salaries.alex + fixture.salaries.sam),
  };

  const labels = book.addWorksheet("Labels");
  labels.addRow(["Personnes", "Comptes", "Détails"]);
  labels.addRow(["Alex", "Hypothèque", "Versement"]);
  book.addWorksheet("Budget").addRow(["Épicerie", 400]);

  return Buffer.from(await book.xlsx.writeBuffer());
}
