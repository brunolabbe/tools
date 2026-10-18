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
 */

import { readSheets } from "../../src/xlsx.ts";
import { HOUSEHOLD_LAYOUT } from "@ledger/books";
import type { Cell, Sheet } from "@ledger/books";
import type { Bucket, WorkbookLayout } from "@ledger/contract";
import { history, render } from "../helpers/workbook.ts";
import { csvSheet } from "./csv.ts";

export interface LayoutFixture {
  name: string;
  /** What it stands for, in a phrase. */
  shape: string;
  sheets: Sheet[];
  /** The person ids the books hold, which the workbook's names fold to. */
  people: string[];
  /** The correct description, written by hand. */
  layout: WorkbookLayout;
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
  const account = accountSheets(invent(37, [2022, 2023, 2024], 12), {
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
  const account = accountSheets(invent(38, [2023, 2024], 10), {
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

function english(): LayoutFixture {
  const names = ["Jordan", "Riley"] as const;
  const record = invent(39, [2023, 2024], 9);
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

function quoted(text: string): string {
  return /[",]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvBalance(): LayoutFixture {
  let balance = 251_210;
  const lines = ["Date,Description,Retrait,Dépôt,Solde"];
  for (const row of statement(40, 5)) {
    balance += row.cents;
    const amount = dollars(Math.abs(row.cents)).toFixed(2);
    lines.push(
      [
        row.date,
        quoted(row.detail),
        row.cents < 0 ? amount : "",
        row.cents > 0 ? amount : "",
        dollars(balance).toFixed(2),
      ].join(","),
    );
  }
  return {
    name: "csv-balance",
    shape: "a bank CSV, oldest first, withdrawals and deposits apart, with a balance",
    sheets: [csvSheet("releve-2024.csv", `${lines.join("\n")}\n`)],
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
  for (const row of statement(41, 4).toReversed()) {
    lines.push([row.date, dollars(row.cents).toFixed(2), quoted(row.detail)].join(","));
  }
  return {
    name: "csv-no-balance",
    shape: "a bank CSV, newest first, one signed amount, no balance",
    sheets: [csvSheet("transactions.csv", `${lines.join("\n")}\n`)],
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
];

/** Every fixture, in the order the measurement runs them. */
export async function layoutFixtures(): Promise<LayoutFixture[]> {
  return [await lg7(), lg37(), moved(), english(), csvBalance(), csvNoBalance()];
}
