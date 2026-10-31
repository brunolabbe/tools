/**
 * The workbooks lg-38 measures a model against, each with the layout that is
 * correct for it, written by hand. **Every name, description and amount is
 * invented**; the rows come from a seeded generator, so a fixture is the same
 * on every run and on every machine, and none was copied from a real file.
 *
 * 1. `lg7`: lg-7's synthetic workbook, through the `.xlsx` round trip.
 * 2. `lg37`: the household's own layout as lg-37 found it (§8): year
 *    summaries above the movements, period summaries in rows 2 to 4.
 * 3. `moved`: French, with every column moved and renamed, listed oldest
 *    first, its periods summed below their lines.
 * 4. `english`: English labels and sheet names, amount and balance swapped.
 * 5. `csv-balance`: a bank CSV, withdrawals and deposits apart, with a balance.
 * 6. `csv-no-balance`: a bank CSV with one signed amount and no balance.
 *
 * lg-56 adds seven harder ones, after those six so their order holds:
 *
 * 7. `swapped-labels`: bucket labels that do not say which bucket is which.
 * 8. `empty-columns-carry`: a workbook with an empty column beside the amount.
 * 9. `empty-columns-csv`: a bank CSV with empty columns among the figures.
 * 10. `bank-preamble`: a bank CSV with title lines above the header.
 * 11. `bank-two-dates`: a bank CSV with a posted date and a transaction date.
 * 12. `bank-footer`: a bank CSV with closing-balance and total lines at the end.
 * 13. `bank-wide`: a bank CSV of eleven columns, most of them not needed.
 *
 * Every bank shape is invented: it stands for a kind of export, not for any
 * bank's, and stays within what `api/src/csv.ts` reads (lg-67 moved the reader
 * there; the fixtures' text is as lg-56 measured it).
 */

import { readSheets } from "../../src/xlsx.ts";
import { HOUSEHOLD_LAYOUT } from "@ledger/books";
import type { Cell, Sheet } from "@ledger/books";
import type { Bucket, WorkbookLayout } from "@ledger/contract";
import { history, render } from "../helpers/workbook.ts";
import { csvSheet } from "../../src/csv.ts";

export interface LayoutFixture {
  name: string;
  /** What it stands for, in a phrase. */
  shape: string;
  sheets: Sheet[];
  /** The person ids the books hold, which the workbook's names fold to. */
  people: string[];
  /** The correct description, written by hand. */
  layout: WorkbookLayout;
  /** A bank CSV's text, as a file holds it (lg-67): its one sheet is this, read. */
  text?: string;
}

// --- Cells ---

type Input = string | number | { date: string } | { formula: string; result: number } | null;

function cell(input: Input): Cell | null {
  if (input === null) return null;
  if (typeof input === "string") return { value: { kind: "text", text: input }, formula: null };
  if (typeof input === "number") return { value: { kind: "number", number: input }, formula: null };
  if ("date" in input) return { value: { kind: "date", date: input.date }, formula: null };
  return { value: { kind: "number", number: input.result }, formula: input.formula };
}

/** A sheet written cell by cell, `set(row, column)` both from 1. */
class Grid {
  readonly #rows: (Cell | null)[][] = [];

  set(row: number, column: number, input: Input): void {
    const cells = (this.#rows[row - 1] ??= []);
    cells[column - 1] = cell(input);
  }

  sheet(name: string): Sheet {
    return {
      name,
      rows: Array.from(this.#rows, (row) => Array.from(row ?? [], (entry) => entry ?? null)),
    };
  }
}

function letter(column: number): string {
  return String.fromCodePoint(64 + column);
}

const dollars = (cents: number): number => cents / 100;

// --- Invented history ---

/** mulberry32: a few lines, and the same numbers everywhere. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Row {
  /** As typed; a typo'd year is typed wrong here and dated right in `date`. */
  written: string;
  date: string;
  bucket: Bucket;
  detail: string;
  /** Index into the two people, or `null` for joint. */
  person: 0 | 1 | null;
  /** `null` on a placeholder. */
  cents: number | null;
  note: string | null;
}

interface History {
  years: { year: number; rows: Row[] }[];
  opening: Record<Bucket, number>;
}

const EXPENSES = [
  "Électricité",
  "Assurance habitation",
  "Déneigement",
  "Quincaillerie",
  "Entretien chauffage",
  "Internet",
];

function day(year: number, month: number, date: number): string {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/**
 * Each month: both people put money in each bucket, the loan is paid from the
 * mortgage, and one or two shared bills come out of the buffer. One row in the
 * second year has its year typed wrong, and one is a placeholder.
 */
function invent(seed: number, years: readonly number[], months: number): History {
  const next = random(seed);
  const cents = (low: number, high: number): number =>
    Math.round((low + next() * (high - low)) * 100);
  const out: History["years"] = [];
  for (const [index, year] of years.entries()) {
    const rows: Row[] = [];
    const add = (row: Omit<Row, "written" | "note"> & { note?: string }): void => {
      rows.push({ ...row, written: row.date, note: row.note ?? null });
    };
    for (let month = 1; month <= months; month++) {
      add({
        date: day(year, month, 1),
        bucket: "current-expenses",
        detail: "Dépôt",
        person: 0,
        cents: 30_000,
      });
      add({
        date: day(year, month, 1),
        bucket: "current-expenses",
        detail: "Dépôt",
        person: 1,
        cents: 20_000,
      });
      add({
        date: day(year, month, 5),
        bucket: "mortgage",
        detail: "Versement",
        person: 0,
        cents: 65_000,
      });
      add({
        date: day(year, month, 5),
        bucket: "mortgage",
        detail: "Versement",
        person: 1,
        cents: 45_000,
      });
      const bills = 1 + Math.floor(next() * 2);
      for (let bill = 0; bill < bills; bill++) {
        add({
          date: day(year, month, 10 + bill * 6),
          bucket: "current-expenses",
          detail: EXPENSES[Math.floor(next() * EXPENSES.length)] ?? "Facture",
          person: null,
          cents: -cents(40, 380),
        });
      }
      add({
        date: day(year, month, 20),
        bucket: "mortgage",
        detail: "Paiement prêt",
        person: null,
        cents: -104_987,
      });
    }
    if (index === 1) {
      // The typo'd year: May's loan payment, typed ten years early.
      const typo = rows.find((row) => row.date === day(year, 5, 20));
      if (typo !== undefined) typo.written = day(year - 10, 5, 20);
      add({
        date: day(year, months, 28),
        bucket: "current-expenses",
        detail: "À venir",
        person: null,
        cents: null,
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    // A note on a few rows, so the note column holds something.
    for (const [position, row] of rows.entries()) {
      if (position % 9 === 4 && row.cents !== null) row.note = "voir la facture";
    }
    out.push({ year, rows });
  }
  return { years: out, opening: { mortgage: 120_000, "current-expenses": 30_000 } };
}

// --- Account sheets ---

type AccountColumn = "date" | "bucket" | "detail" | "person" | "balance" | "amount" | "note";

interface AccountStyle {
  columns: Record<AccountColumn, number>;
  headers: Record<AccountColumn, string>;
  order: "newest-first" | "oldest-first";
  bucketText: Record<Bucket, string>;
  names: readonly [string, string];
  carryOverLabel: string;
  /** Rows above the header that sum the year up, or none. */
  summary?: (year: number) => { column: number; figure: number; labels: string[] } | null;
  /** A line of text above the header, in the detail column, on every sheet. */
  heading?: string;
}

/** One sheet per year, its running balance a formula over the row before, as a workbook keeps it. */
function accountSheets(record: History, style: AccountStyle): Sheet[] {
  const { columns } = style;
  const sheets: Sheet[] = [];
  let balance = record.opening.mortgage + record.opening["current-expenses"];
  let carry = { ...record.opening };
  for (const { year, rows } of record.years) {
    const grid = new Grid();
    let at = 1;
    const summary = style.summary?.(year) ?? null;
    if (summary !== null) {
      // What the year closes each bucket at, then both: the sheet's own sums.
      const closes = { ...carry };
      for (const row of rows) if (row.cents !== null) closes[row.bucket] += row.cents;
      const figures = [
        closes["current-expenses"],
        closes.mortgage,
        closes["current-expenses"] + closes.mortgage,
      ].slice(-summary.labels.length);
      for (const [index, label] of summary.labels.entries()) {
        const f = letter(summary.figure);
        grid.set(at, summary.column, label);
        grid.set(at, summary.figure, {
          formula: `SUMIF(${f}5:${f}400,">0")`,
          result: dollars(figures[index] ?? 0),
        });
        at += 1;
      }
    }
    if (style.heading !== undefined) {
      grid.set(at, columns.detail, style.heading);
      at += 1;
    }
    for (const [key, column] of Object.entries(columns) as [AccountColumn, number][]) {
      grid.set(at, column, style.headers[key]);
    }
    at += 1;

    // Oldest first, with balances; the carry-overs open the year.
    type Line =
      | { kind: "carry"; bucket: Bucket; cents: number }
      | { kind: "row"; row: Row; balance: number | null };
    const lines: Line[] = [
      { kind: "carry", bucket: "current-expenses", cents: carry["current-expenses"] },
      { kind: "carry", bucket: "mortgage", cents: carry.mortgage },
    ];
    const closing = { ...carry };
    for (const row of rows) {
      if (row.cents === null) {
        lines.push({ kind: "row", row, balance: null });
        continue;
      }
      balance += row.cents;
      closing[row.bucket] += row.cents;
      lines.push({ kind: "row", row, balance });
    }
    carry = closing;
    const listed = style.order === "newest-first" ? lines.toReversed() : lines;
    // In the sheet's own order, so a balance formula names the row it follows from.
    const placed = listed.map((line, index) => ({ line, sheetRow: at + index }));
    const older = (index: number): number | null => {
      const step = style.order === "newest-first" ? 1 : -1;
      for (let other = index + step; other >= 0 && other < placed.length; other += step) {
        const candidate = placed[other]?.line;
        if (candidate?.kind === "row" && candidate.balance !== null)
          return placed[other]?.sheetRow ?? null;
      }
      return null;
    };
    for (const [index, { line, sheetRow }] of placed.entries()) {
      if (line.kind === "carry") {
        grid.set(sheetRow, columns.date, { date: day(year, 1, 1) });
        grid.set(sheetRow, columns.bucket, style.bucketText[line.bucket]);
        grid.set(sheetRow, columns.detail, style.carryOverLabel);
        grid.set(sheetRow, columns.amount, dollars(line.cents));
        continue;
      }
      const { row } = line;
      grid.set(sheetRow, columns.date, { date: row.written });
      grid.set(sheetRow, columns.bucket, style.bucketText[row.bucket]);
      grid.set(sheetRow, columns.detail, row.detail);
      grid.set(sheetRow, columns.person, row.person === null ? null : style.names[row.person]);
      if (row.cents !== null) grid.set(sheetRow, columns.amount, dollars(row.cents));
      if (line.balance !== null) {
        const from = older(index);
        const b = letter(columns.balance);
        grid.set(
          sheetRow,
          columns.balance,
          from === null
            ? dollars(line.balance)
            : {
                formula: `${b}${String(from)}+${letter(columns.amount)}${String(sheetRow)}`,
                result: dollars(line.balance),
              },
        );
      }
      if (row.note !== null) grid.set(sheetRow, columns.note, row.note);
    }
    sheets.push(grid.sheet(String(year)));
  }
  return sheets;
}

// --- Period sheets ---

interface PeriodSpec {
  name: string;
  start: string;
  end: string | null;
  version: "v1" | "v2";
  lines: { label: string; cents: readonly [number | null, number | null]; note?: string }[];
}

interface PeriodStyle {
  names: readonly [string, string];
  namesRow: number;
  datesRow: number;
  firstLine: number;
  labelColumn: number;
  /** The two people's amount columns; the note is the one after them. */
  amountColumns: readonly [number, number];
  totalLabel: string;
  depositLabel: string;
  /** Where the summary sits: rows above the lines, or right below them. */
  summary: { at: "above"; total: number; equivalence: number; deposit: number } | { at: "below" };
  dateLabel: string | null;
  /** The cell the deposit formula takes the ratio from, on the salaries sheet. */
  ratioCell: string;
  share: number;
}

function periodSheet(spec: PeriodSpec, style: PeriodStyle): Sheet {
  const grid = new Grid();
  const [first, second] = style.amountColumns;
  const [a, b] = [letter(first), letter(second)];
  grid.set(style.namesRow, first, style.names[0]);
  grid.set(style.namesRow, second, style.names[1]);
  if (style.dateLabel !== null) grid.set(style.datesRow, style.labelColumn, style.dateLabel);
  grid.set(style.datesRow, first, { date: spec.start });
  if (spec.end !== null) grid.set(style.datesRow, second, { date: spec.end });

  let row = style.firstLine;
  const totals: [number, number] = [0, 0];
  for (const line of spec.lines) {
    grid.set(row, style.labelColumn, line.label);
    for (const [who, cents] of line.cents.entries()) {
      if (cents === null) continue;
      grid.set(row, style.amountColumns[who] ?? first, dollars(cents));
      totals[who] = (totals[who] ?? 0) + cents;
    }
    if (line.note !== undefined) grid.set(row, second + 1, line.note);
    row += 1;
  }
  const last = row - 1;

  // What each owes at the ratio, and who deposits the difference.
  const sum = totals[0] + totals[1];
  const owed = Math.round(sum * style.share) - totals[0];
  const deposit: [number, number] = owed > 0 ? [owed, 0] : [0, -owed];

  const range = (column: string): string =>
    `SUM(${column}${String(style.firstLine)}:${column}${String(last + 40)})`;
  const summary = style.summary;
  const totalRow = summary.at === "above" ? summary.total : last + 1;
  grid.set(totalRow, style.labelColumn, style.totalLabel);
  grid.set(totalRow, first, { formula: range(a), result: dollars(totals[0]) });
  grid.set(totalRow, second, { formula: range(b), result: dollars(totals[1]) });
  const depositRow = summary.at === "above" ? summary.deposit : last + 2;
  grid.set(depositRow, style.labelColumn, style.depositLabel);
  const t = String(totalRow);
  if (spec.version === "v1" && summary.at === "above") {
    const e = String(summary.equivalence);
    grid.set(summary.equivalence, style.labelColumn, "Équivalence");
    grid.set(summary.equivalence, first, {
      formula: `IF(${a}${t}<${b}${t},${a}${t}*${style.ratioCell},${a}${t})`,
      result: dollars(totals[0]),
    });
    grid.set(summary.equivalence, second, {
      formula: `IF(${b}${t}<${a}${t},${b}${t}/${style.ratioCell},${b}${t})`,
      result: dollars(totals[1]),
    });
    grid.set(depositRow, first, {
      formula: `IF(${a}${e}<${b}${e},${b}${e}-${a}${e},0)`,
      result: dollars(deposit[0]),
    });
    grid.set(depositRow, second, {
      formula: `IF(${b}${e}<${a}${e},${a}${e}-${b}${e},0)`,
      result: dollars(deposit[1]),
    });
  } else {
    grid.set(depositRow, first, {
      formula: `MAX(0,(${a}${t}+${b}${t})*${style.ratioCell}-${a}${t})`,
      result: dollars(deposit[0]),
    });
    grid.set(depositRow, second, {
      formula: `MAX(0,(${a}${t}+${b}${t})*(1-${style.ratioCell})-${b}${t})`,
      result: dollars(deposit[1]),
    });
  }
  return grid.sheet(spec.name);
}

/** Three periods: two closed, one open; lines invented from the seed. */
function periods(
  seed: number,
  names: readonly string[],
  dates: readonly [string, string, string],
): PeriodSpec[] {
  const next = random(seed);
  const items = ["Épicerie", "Pharmacie", "Restaurant", "Quincaillerie", "Essence", "Cadeau"];
  const lines = (count: number): PeriodSpec["lines"] =>
    Array.from({ length: count }, (_, index) => {
      const who = next() < 0.5 ? 0 : 1;
      const cents = Math.round((15 + next() * 220) * 100);
      return {
        label: items[index % items.length] ?? "Achat",
        cents: who === 0 ? [cents, null] : [null, cents],
        ...(index % 5 === 2 ? { note: "à partager" } : {}),
      };
    });
  return [
    { name: names[0] ?? "", start: dates[0], end: dates[1], version: "v1", lines: lines(14) },
    { name: names[1] ?? "", start: dates[1], end: dates[2], version: "v2", lines: lines(17) },
    { name: names[2] ?? "", start: dates[2], end: null, version: "v2", lines: lines(6) },
  ];
}

// --- Salaries ---

function salariesSheet(
  name: string,
  names: readonly [string, string],
  label: string,
  salaries: readonly [number, number],
): Sheet {
  const grid = new Grid();
  grid.set(2, 3, names[0]);
  grid.set(2, 4, names[1]);
  grid.set(4, 2, label);
  grid.set(4, 3, salaries[0]);
  grid.set(4, 4, salaries[1]);
  grid.set(5, 2, "Facteur");
  grid.set(5, 3, { formula: "C4/(C4+D4)", result: salaries[0] / (salaries[0] + salaries[1]) });
  // The names again, over a calculator whose figures are not salaries.
  grid.set(8, 3, names[0]);
  grid.set(8, 4, names[1]);
  grid.set(9, 2, "Calculatrice");
  grid.set(9, 3, 900);
  grid.set(9, 4, 600);
  return grid.sheet(name);
}

function listSheet(name: string, rows: readonly (readonly string[])[]): Sheet {
  const grid = new Grid();
  for (const [index, row] of rows.entries()) {
    for (const [column, text] of row.entries()) grid.set(index + 1, column + 1, text);
  }
  return grid.sheet(name);
}

// --- The fixtures ---

const HOUSEHOLD_COLUMNS: Record<AccountColumn, number> = {
  date: 2,
  bucket: 3,
  detail: 4,
  person: 5,
  balance: 6,
  amount: 7,
  note: 8,
};

function lg37(): LayoutFixture {
  const names = ["Alex", "Sam"] as const;
  const account = accountSheets(recorded("lg37"), {
    columns: HOUSEHOLD_COLUMNS,
    headers: {
      date: "Date",
      bucket: "Compte",
      detail: "Détail",
      person: "Personne",
      balance: "Solde",
      amount: "Montant",
      note: "Note",
    },
    order: "newest-first",
    bucketText: { mortgage: "Hypothèque", "current-expenses": "Dép. Courantes" },
    names,
    carryOverLabel: "Solde reporté",
    // 2022 and 2023 open with the bucket summary in C; 2024 keeps a label in D and a figure in F (lg-37).
    summary: (year) =>
      year < 2024
        ? { column: 3, figure: 7, labels: ["Solde Dép. Courantes", "Solde Hypothèque", "Total"] }
        : { column: 4, figure: 6, labels: ["Solde"] },
  });
  const style: PeriodStyle = {
    names,
    namesRow: 1,
    datesRow: 6,
    firstLine: 8,
    labelColumn: 2,
    amountColumns: [3, 4],
    totalLabel: "Total",
    depositLabel: "Montant à déposer",
    summary: { at: "above", total: 2, equivalence: 3, deposit: 4 },
    dateLabel: "Période de facturation",
    ratioCell: "Accueil!C5",
    share: 0.6,
  };
  const specs = periods(
    370,
    ["$ (Avril-Août)", "$ (Sept-Mars)", "$ (Avril - …)"],
    ["2022-04-01", "2022-08-31", "2023-03-31"],
  );
  return {
    name: "lg37",
    shape: "the household's layout as lg-37 found it: summaries above, labels in B",
    sheets: [
      ...account.toReversed(),
      ...specs.map((spec) => periodSheet(spec, style)),
      salariesSheet("Accueil", names, "Salaires bruts", [60_000, 40_000]),
      listSheet("Labels", [
        ["Personnes", "Comptes", "Détails"],
        ["Alex", "Hypothèque", "Versement"],
      ]),
      listSheet("Budget", [["Épicerie", "400"]]),
    ],
    people: ["alex", "sam"],
    layout: {
      ...HOUSEHOLD_LAYOUT,
      account: {
        ...HOUSEHOLD_LAYOUT.account,
        buckets: [
          { bucket: "mortgage", labels: ["Hypothèque"] },
          { bucket: "current-expenses", labels: ["Dép. Courantes"] },
        ],
        summary: { column: "C", labels: ["Solde", "Total"] },
      },
      salaries: { sheet: "Accueil", label: "Salaires bruts" },
      ignored: ["Labels", "Budget"],
    },
  };
}

function moved(): LayoutFixture {
  const names = ["Camille", "Dominique"] as const;
  const account = accountSheets(recorded("moved"), {
    columns: { date: 1, detail: 2, amount: 3, balance: 4, bucket: 5, person: 6, note: 7 },
    headers: {
      date: "Jour",
      detail: "Libellé",
      amount: "Mouvement",
      balance: "Cumul",
      bucket: "Enveloppe",
      person: "Qui",
      note: "Remarque",
    },
    order: "oldest-first",
    bucketText: { mortgage: "Maison", "current-expenses": "Courant" },
    names,
    carryOverLabel: "Report de l'an passé",
  });
  const style: PeriodStyle = {
    names,
    namesRow: 2,
    datesRow: 3,
    firstLine: 5,
    labelColumn: 1,
    amountColumns: [4, 5],
    totalLabel: "Sous-total",
    depositLabel: "À verser",
    summary: { at: "below" },
    dateLabel: "Du / au",
    ratioCell: "Paramètres!C5",
    share: 0.55,
  };
  const specs = periods(
    380,
    ["Période 1", "Période 2", "Période 3"],
    ["2023-01-01", "2023-06-30", "2024-01-31"],
  );
  return {
    name: "moved",
    shape: "French, every column moved and renamed, oldest first, period totals below the lines",
    sheets: [
      ...account,
      ...specs.map((spec) => periodSheet(spec, { ...style })),
      salariesSheet("Paramètres", names, "Salaire annuel", [52_000, 43_000]),
      listSheet("Notes", [["Rien ici"]]),
    ],
    people: ["camille", "dominique"],
    layout: {
      account: {
        sheets: { by: "year" },
        yearPerSheet: true,
        order: "oldest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "detail", column: "B" },
          { role: "amount", column: "C" },
          { role: "balance", column: "D" },
          { role: "bucket", column: "E" },
          { role: "person", column: "F" },
          { role: "note", column: "G" },
        ],
        buckets: [
          { bucket: "mortgage", labels: ["Maison"] },
          { bucket: "current-expenses", labels: ["Courant"] },
        ],
        carryOverLabel: "Report de l'an passé",
        summary: null,
      },
      periods: {
        sheets: { by: "prefix", prefix: "Période" },
        namesRow: 2,
        datesRow: 3,
        firstLine: 5,
        totalLabel: "Sous-total",
        depositLabel: "À verser",
      },
      salaries: { sheet: "Paramètres", label: "Salaire annuel" },
      ignored: ["Notes"],
    },
  };
}

/** The invented history's French details and notes, in English. */
function inEnglish(record: History): void {
  for (const year of record.years) {
    for (const row of year.rows) {
      row.detail =
        {
          Dépôt: "Transfer in",
          Versement: "Payment in",
          "Paiement prêt": "Loan payment",
          "À venir": "Upcoming",
        }[row.detail] ?? "Bill";
      if (row.note !== null) row.note = "see invoice";
    }
  }
}

type RecordedName = "lg37" | "moved" | "english" | "swapped-labels" | "empty-columns-carry";

/** The history a workbook fixture was written from: one place for the fixture and for a test that reads it back. */
function recorded(name: RecordedName): History {
  switch (name) {
    case "lg37":
      return invent(37, [2022, 2023, 2024], 12);
    case "moved":
      return invent(38, [2023, 2024], 10);
    case "english": {
      const record = invent(39, [2023, 2024], 9);
      inEnglish(record);
      return record;
    }
    case "swapped-labels":
      return invent(56, [2023, 2024], 6);
    case "empty-columns-carry": {
      const record = invent(57, [2023, 2024], 7);
      inEnglish(record);
      return record;
    }
  }
}

function english(): LayoutFixture {
  const names = ["Jordan", "Riley"] as const;
  const record = recorded("english");
  const account = accountSheets(record, {
    columns: { date: 1, bucket: 2, detail: 3, person: 4, amount: 5, balance: 6, note: 7 },
    headers: {
      date: "Date",
      bucket: "Account",
      detail: "Description",
      person: "Who",
      amount: "Amount",
      balance: "Balance",
      note: "Note",
    },
    order: "newest-first",
    bucketText: { mortgage: "Mortgage", "current-expenses": "Household" },
    names,
    carryOverLabel: "Balance carried forward",
  });
  const style: PeriodStyle = {
    names,
    namesRow: 1,
    datesRow: 3,
    firstLine: 6,
    labelColumn: 1,
    amountColumns: [3, 4],
    totalLabel: "Total",
    depositLabel: "Amount to deposit",
    summary: { at: "above", total: 2, equivalence: 5, deposit: 4 },
    dateLabel: "From / to",
    ratioCell: "Home!C5",
    share: 0.5,
  };
  const specs = periods(
    390,
    ["Period Jan-Jun", "Period Jul-Dec", "Period 2024"],
    ["2023-01-01", "2023-06-30", "2023-12-31"],
  ).map((spec): PeriodSpec => ({
    ...spec,
    version: "v2",
    lines: spec.lines.map((line) => ({
      ...line,
      label: `Item ${line.label.length}`,
      ...(line.note === undefined ? {} : { note: "split" }),
    })),
  }));
  return {
    name: "english",
    shape: "English labels and sheet names, the amount left of the balance",
    sheets: [
      ...account.toReversed(),
      ...specs.map((spec) => periodSheet(spec, style)),
      salariesSheet("Home", names, "Salaries", [70_000, 70_000]),
      listSheet("Lists", [
        ["People", "Accounts"],
        ["Jordan", "Mortgage"],
      ]),
    ],
    people: ["jordan", "riley"],
    layout: {
      account: {
        sheets: { by: "year" },
        yearPerSheet: true,
        order: "newest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "bucket", column: "B" },
          { role: "detail", column: "C" },
          { role: "person", column: "D" },
          { role: "amount", column: "E" },
          { role: "balance", column: "F" },
          { role: "note", column: "G" },
        ],
        buckets: [
          { bucket: "mortgage", labels: ["Mortgage"] },
          { bucket: "current-expenses", labels: ["Household"] },
        ],
        carryOverLabel: "Balance carried forward",
        summary: null,
      },
      periods: {
        sheets: { by: "prefix", prefix: "Period" },
        namesRow: 1,
        datesRow: 3,
        firstLine: 6,
        totalLabel: "Total",
        depositLabel: "Amount to deposit",
      },
      salaries: { sheet: "Home", label: "Salaries" },
      ignored: ["Lists"],
    },
  };
}

/** A bank's export: a few months of one account, oldest first. */
function statement(
  seed: number,
  months: number,
): { date: string; detail: string; cents: number }[] {
  const next = random(seed);
  const out: { date: string; detail: string; cents: number }[] = [];
  const shops = [
    "EPICERIE DU COIN",
    "PHARMACIE CENTRALE",
    "QUINCAILLERIE BOIS",
    "RESTO LE MIDI",
    "STATION ESSENCE",
  ];
  for (let month = 1; month <= months; month++) {
    out.push({ date: day(2024, month, 2), detail: "DEPOT PAIE", cents: 182_345 });
    for (let index = 0; index < 6; index++) {
      out.push({
        date: day(2024, month, 4 + index * 4),
        detail: shops[Math.floor(next() * shops.length)] ?? "ACHAT",
        cents: -Math.round((8 + next() * 140) * 100),
      });
    }
    out.push({ date: day(2024, month, 28), detail: "HYPOTHEQUE", cents: -104_987 });
  }
  return out;
}

/** A bank CSV fixture's file: its text, and the one sheet the reader makes of it. */
function csvFile(name: string, lines: readonly string[]): { sheets: Sheet[]; text: string } {
  const text = `${lines.join("\n")}\n`;
  return { sheets: [csvSheet(name, text)], text };
}

function quoted(text: string): string {
  return /[",]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvBalance(): LayoutFixture {
  const lines = ["Date,Description,Retrait,Dépôt,Solde"];
  for (const row of banked("csv-balance")) {
    const amount = dollars(Math.abs(row.cents)).toFixed(2);
    lines.push(
      [
        row.date,
        quoted(row.detail),
        row.cents < 0 ? amount : "",
        row.cents > 0 ? amount : "",
        money(row.balance),
      ].join(","),
    );
  }
  return {
    name: "csv-balance",
    shape: "a bank CSV, oldest first, withdrawals and deposits apart, with a balance",
    ...csvFile("releve-2024.csv", lines),
    people: [],
    layout: {
      account: {
        sheets: { by: "name", names: ["releve-2024.csv"] },
        yearPerSheet: false,
        order: "oldest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "detail", column: "B" },
          { role: "withdrawal", column: "C" },
          { role: "deposit", column: "D" },
          { role: "balance", column: "E" },
        ],
        buckets: [],
        carryOverLabel: null,
        summary: null,
      },
      periods: null,
      salaries: null,
      ignored: [],
    },
  };
}

function csvNoBalance(): LayoutFixture {
  const lines = ["Date,Montant,Description"];
  for (const row of banked("csv-no-balance").toReversed()) {
    lines.push([row.date, dollars(row.cents).toFixed(2), quoted(row.detail)].join(","));
  }
  return {
    name: "csv-no-balance",
    shape: "a bank CSV, newest first, one signed amount, no balance",
    ...csvFile("transactions.csv", lines),
    people: [],
    layout: {
      account: {
        sheets: { by: "name", names: ["transactions.csv"] },
        yearPerSheet: false,
        order: "newest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "amount", column: "B" },
          { role: "detail", column: "C" },
        ],
        buckets: [],
        carryOverLabel: null,
        summary: null,
      },
      periods: null,
      salaries: null,
      ignored: [],
    },
  };
}

// --- lg-56's harder fixtures ---

const money = (cents: number): string => dollars(cents).toFixed(2);

/** A bank's rows with the balance each leaves, from `opening`. */
function running(
  rows: readonly { date: string; detail: string; cents: number }[],
  opening: number,
): { date: string; detail: string; cents: number; balance: number }[] {
  let balance = opening;
  return rows.map((row) => {
    balance += row.cents;
    return { ...row, balance };
  });
}

type BankName =
  | "csv-balance"
  | "csv-no-balance"
  | "empty-columns-csv"
  | "bank-preamble"
  | "bank-two-dates"
  | "bank-footer"
  | "bank-wide";

/**
 * The rows a bank CSV fixture was written from, oldest first, with the balance
 * each leaves: one place for the fixture and for a test that reads it back.
 * `csv-no-balance` has no balance column, and its opening here is only a place
 * to start from.
 */
function banked(
  name: BankName,
): { date: string; detail: string; cents: number; balance: number }[] {
  switch (name) {
    case "csv-balance":
      return running(statement(40, 5), 251_210);
    case "csv-no-balance":
      return running(statement(41, 4), 0);
    case "empty-columns-csv":
      return running(statement(58, 4), 408_200);
    case "bank-preamble":
      return running(statement(59, 4), 276_450);
    case "bank-two-dates":
      return running(statement(61, 4), 189_730);
    case "bank-footer":
      return running(statement(62, 4), 95_320);
    case "bank-wide":
      return running(statement(64, 4), 351_080);
  }
}

/** A movement as the generator wrote it, before any layout reads the file. */
export interface WrittenRow {
  date: string;
  bucket: Bucket | null;
  /** Index into the fixture's `people`, or `null`. */
  person: number | null;
  cents: number;
  /** `null` where the fixture has no balance column. */
  balance: number | null;
  detail: string;
  note: string | null;
}

/**
 * What the generator wrote into a fixture, oldest first, so a test can hold the
 * correct description's reading to it: a description that picks the wrong
 * column is still a valid layout and still `matched` against itself (lg-56
 * gate 1). `lg7` is not generated here and has none.
 */
export function writtenRows(name: string): WrittenRow[] | undefined {
  switch (name) {
    case "lg37":
    case "moved":
    case "english":
    case "swapped-labels":
    case "empty-columns-carry": {
      const record = recorded(name);
      let balance = record.opening.mortgage + record.opening["current-expenses"];
      const out: WrittenRow[] = [];
      for (const { rows } of record.years) {
        for (const row of rows) {
          if (row.cents === null) continue;
          balance += row.cents;
          out.push({
            date: row.date,
            bucket: row.bucket,
            person: row.person,
            cents: row.cents,
            balance,
            detail: row.detail,
            note: row.note,
          });
        }
      }
      return out;
    }
    case "csv-balance":
    case "csv-no-balance":
    case "empty-columns-csv":
    case "bank-preamble":
    case "bank-two-dates":
    case "bank-footer":
    case "bank-wide":
      return banked(name).map((row) => ({
        date: row.date,
        bucket: null,
        person: null,
        cents: row.cents,
        balance: name === "csv-no-balance" ? null : row.balance,
        detail: row.detail,
        note: null,
      }));
    default:
      return undefined;
  }
}

/** `date` (yyyy-mm-dd) `days` earlier, as a calendar says. */
function daysEarlier(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/** A bank CSV's description: one sheet read by its file name, no buckets, carry-overs or periods. */
function csvLayout(
  name: string,
  order: "newest-first" | "oldest-first",
  columns: WorkbookLayout["account"]["columns"],
): WorkbookLayout {
  return {
    account: {
      sheets: { by: "name", names: [name] },
      yearPerSheet: false,
      order,
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

function swappedLabels(): LayoutFixture {
  const names = ["Maxime", "Léa"] as const;
  const account = accountSheets(recorded("swapped-labels"), {
    columns: { date: 1, detail: 2, bucket: 3, person: 4, amount: 5, balance: 6, note: 7 },
    headers: {
      date: "Date",
      detail: "Description",
      bucket: "Compte",
      person: "Qui",
      amount: "Montant",
      balance: "Solde",
      note: "Note",
    },
    order: "oldest-first",
    // The first-listed bucket is the one a reader would call the mortgage, and it is not.
    bucketText: { mortgage: "Compte 2", "current-expenses": "Compte 1" },
    names,
    carryOverLabel: "Report annuel",
    heading: "Compte 1 : courant · Compte 2 : maison",
  });
  return {
    name: "swapped-labels",
    shape: "bucket labels that do not say which bucket is which; the rows and a heading do",
    sheets: [...account, listSheet("Notes", [["Rien ici"]])],
    people: ["maxime", "lea"],
    layout: {
      account: {
        sheets: { by: "year" },
        yearPerSheet: true,
        order: "oldest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "detail", column: "B" },
          { role: "bucket", column: "C" },
          { role: "person", column: "D" },
          { role: "amount", column: "E" },
          { role: "balance", column: "F" },
          { role: "note", column: "G" },
        ],
        buckets: [
          { bucket: "mortgage", labels: ["Compte 2"] },
          { bucket: "current-expenses", labels: ["Compte 1"] },
        ],
        carryOverLabel: "Report annuel",
        summary: null,
      },
      periods: null,
      salaries: null,
      ignored: ["Notes"],
    },
  };
}

function emptyColumnsCarry(): LayoutFixture {
  const names = ["Noah", "Emma"] as const;
  const record = recorded("empty-columns-carry");
  const account = accountSheets(record, {
    // Column E is empty: the amount is the column after it.
    columns: { date: 1, bucket: 2, detail: 3, person: 4, amount: 6, balance: 7, note: 8 },
    headers: {
      date: "Date",
      bucket: "Account",
      detail: "Description",
      person: "Who",
      amount: "Amount",
      balance: "Balance",
      note: "Note",
    },
    order: "newest-first",
    bucketText: { mortgage: "Home loan", "current-expenses": "Running costs" },
    names,
    carryOverLabel: "Carried over from last year",
  });
  return {
    name: "empty-columns-carry",
    shape: "year sheets with a carry-over label and an empty column left of the amount",
    sheets: account.toReversed(),
    people: ["noah", "emma"],
    layout: {
      account: {
        sheets: { by: "year" },
        yearPerSheet: true,
        order: "newest-first",
        columns: [
          { role: "date", column: "A" },
          { role: "bucket", column: "B" },
          { role: "detail", column: "C" },
          { role: "person", column: "D" },
          { role: "amount", column: "F" },
          { role: "balance", column: "G" },
          { role: "note", column: "H" },
        ],
        buckets: [
          { bucket: "mortgage", labels: ["Home loan"] },
          { bucket: "current-expenses", labels: ["Running costs"] },
        ],
        carryOverLabel: "Carried over from last year",
        summary: null,
      },
      periods: null,
      salaries: null,
      ignored: [],
    },
  };
}

function emptyColumnsCsv(): LayoutFixture {
  // Withdrawals, an empty spacer, deposits, the balance, and the empty column
  // after the last comma that some exports end every line with.
  const lines = ["Date,Description,Withdrawals,,Deposits,Balance,"];
  for (const row of banked("empty-columns-csv")) {
    lines.push(
      [
        row.date,
        quoted(row.detail),
        row.cents < 0 ? money(-row.cents) : "",
        "",
        row.cents > 0 ? money(row.cents) : "",
        money(row.balance),
        "",
      ].join(","),
    );
  }
  return {
    name: "empty-columns-csv",
    shape: "a bank CSV, oldest first, withdrawals and deposits apart with an empty column between",
    ...csvFile("chequing-activity.csv", lines),
    people: [],
    layout: csvLayout("chequing-activity.csv", "oldest-first", [
      { role: "date", column: "A" },
      { role: "detail", column: "B" },
      { role: "withdrawal", column: "C" },
      { role: "deposit", column: "E" },
      { role: "balance", column: "F" },
    ]),
  };
}

function bankPreamble(): LayoutFixture {
  const lines = [
    "Account statement",
    "Account,Everyday chequing",
    "Period,2024-01-01 to 2024-04-30",
    "",
    "Date,Description,Amount,Balance",
  ];
  for (const row of banked("bank-preamble")) {
    lines.push([row.date, quoted(row.detail), money(row.cents), money(row.balance)].join(","));
  }
  return {
    name: "bank-preamble",
    shape: "a bank CSV with a title, an account line and a period line above the header",
    ...csvFile("statement-q1.csv", lines),
    people: [],
    layout: csvLayout("statement-q1.csv", "oldest-first", [
      { role: "date", column: "A" },
      { role: "detail", column: "B" },
      { role: "amount", column: "C" },
      { role: "balance", column: "D" },
    ]),
  };
}

function bankTwoDates(): LayoutFixture {
  const next = random(60);
  const lines = ["Date posted,Date of transaction,Reference,Description,Amount,Balance"];
  for (const [index, row] of banked("bank-two-dates").entries()) {
    // A purchase can post days after it was made; a deposit and the loan post the day they happen.
    const earlier = row.cents < 0 && row.detail !== "HYPOTHEQUE" && next() < 0.5;
    const made = earlier ? daysEarlier(row.date, 1 + Math.floor(next() * 5)) : row.date;
    lines.push(
      [
        row.date,
        made,
        `R-${String(40_100 + index * 7)}`,
        quoted(row.detail),
        money(row.cents),
        money(row.balance),
      ].join(","),
    );
  }
  return {
    name: "bank-two-dates",
    shape: "a bank CSV with the date a movement posted and the date it was made, and a reference",
    ...csvFile("activity.csv", lines),
    people: [],
    layout: csvLayout("activity.csv", "oldest-first", [
      { role: "date", column: "A" },
      { role: "detail", column: "D" },
      { role: "amount", column: "E" },
      { role: "balance", column: "F" },
    ]),
  };
}

function bankFooter(): LayoutFixture {
  const lines = ["Booking date,Details,Amount,Running balance"];
  const rows = banked("bank-footer");
  for (const row of rows) {
    lines.push([row.date, quoted(row.detail), money(row.cents), money(row.balance)].join(","));
  }
  const out = rows.filter((row) => row.cents < 0).reduce((sum, row) => sum - row.cents, 0);
  const into = rows.filter((row) => row.cents > 0).reduce((sum, row) => sum + row.cents, 0);
  // The figures sit in the balance column: one in the amount column of a row
  // with no date is "an amount with no date", which every description of this
  // file reads as a problem (lg-56's Log).
  lines.push(`,Total withdrawals,,${money(out)}`);
  lines.push(`,Total deposits,,${money(into)}`);
  lines.push(`,Closing balance,,${money(rows.at(-1)?.balance ?? 0)}`);
  return {
    name: "bank-footer",
    shape: "a bank CSV, oldest first, with total and closing-balance lines after the last movement",
    ...csvFile("month-end.csv", lines),
    people: [],
    layout: csvLayout("month-end.csv", "oldest-first", [
      { role: "date", column: "A" },
      { role: "detail", column: "B" },
      { role: "amount", column: "C" },
      { role: "balance", column: "D" },
    ]),
  };
}

/** The merchant category codes of the shops `statement` invents. */
const CATEGORY_CODES: Record<string, number> = {
  "EPICERIE DU COIN": 5411,
  "PHARMACIE CENTRALE": 5912,
  "QUINCAILLERIE BOIS": 5251,
  "RESTO LE MIDI": 5812,
  "STATION ESSENCE": 5541,
  "DEPOT PAIE": 6012,
  HYPOTHEQUE: 6513,
};

function bankWide(): LayoutFixture {
  const next = random(63);
  const lines = [
    "Date,Branch,Teller,Currency,Description,Category code,Channel,Amount,Balance,Status,Batch",
  ];
  const rows = banked("bank-wide");
  for (const [index, row] of rows.toReversed().entries()) {
    const channel =
      row.cents > 0 ? "DIRECT" : (["POS", "ONLINE", "ATM"][Math.floor(next() * 3)] ?? "POS");
    lines.push(
      [
        row.date,
        "QC-014",
        `T${String(1 + (index % 9)).padStart(2, "0")}`,
        "CAD",
        quoted(row.detail),
        String(CATEGORY_CODES[row.detail] ?? 5999),
        channel,
        money(row.cents),
        money(row.balance),
        "POSTED",
        `B${row.date.replaceAll("-", "")}`,
      ].join(","),
    );
  }
  return {
    name: "bank-wide",
    shape: "a bank CSV, newest first, of eleven columns of which a description needs four",
    ...csvFile("full-export.csv", lines),
    people: [],
    layout: csvLayout("full-export.csv", "newest-first", [
      { role: "date", column: "A" },
      { role: "detail", column: "E" },
      { role: "amount", column: "H" },
      { role: "balance", column: "I" },
    ]),
  };
}

async function lg7(): Promise<LayoutFixture> {
  return {
    name: "lg7",
    shape: "lg-7's synthetic workbook, through the .xlsx round trip",
    sheets: await readSheets(await render(history())),
    people: ["alex", "sam"],
    layout: {
      ...HOUSEHOLD_LAYOUT,
      account: {
        ...HOUSEHOLD_LAYOUT.account,
        buckets: [
          { bucket: "mortgage", labels: ["Hypothèque"] },
          { bucket: "current-expenses", labels: ["Dép. Courantes"] },
        ],
        summary: null,
      },
      salaries: { sheet: "Accueil", label: "Salaires bruts" },
      ignored: ["Labels", "Budget"],
    },
  };
}

/** Every fixture's name, in the order the measurement runs them. */
export const LAYOUT_FIXTURE_NAMES: readonly string[] = [
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
];

/** Every fixture, in the order the measurement runs them. */
export async function layoutFixtures(): Promise<LayoutFixture[]> {
  return [
    await lg7(),
    lg37(),
    moved(),
    english(),
    csvBalance(),
    csvNoBalance(),
    swappedLabels(),
    emptyColumnsCarry(),
    emptyColumnsCsv(),
    bankPreamble(),
    bankTwoDates(),
    bankFooter(),
    bankWide(),
  ];
}
