/**
 * Reading the household's old workbook (lg-7), from plain cell grids.
 *
 * The `.xlsx` file is opened in `api`, which hands this file each sheet as a
 * grid of cached values — never a formula evaluated here — with the formula
 * text kept beside any cell that had one, because a period's formula version is
 * told apart by it (`docs/00-ANALYSIS.md` §5, §8). Everything below is pure:
 * it reads, repairs, verifies and reports, and it writes nothing.
 *
 * **A description drives the reading** (lg-38): a `WorkbookLayout` from
 * `@ledger/contract` says which sheets are the account, the periods and the
 * salaries, and where in them each figure is. The household's own workbook is
 * `HOUSEHOLD_LAYOUT`, §8's layout and the default, and what it says is:
 *
 * - **Year sheets** (`2022` … `2026`), newest first: `B` date, `C` bucket, `D`
 *   detail, `E` person, `F` the account's running balance, `G` amount, `H`
 *   note. A row whose `B` is a date is a movement; a row with `Solde reporté`
 *   in it is a carry-over, one per bucket, and is verified, never imported.
 *   Above the first movement, a row labelled `Solde …` or `Total` in `C` is
 *   the sheet's own summary of its buckets, and is not read (lg-37).
 *   Anything else (a header, a blank) is not a row of the account.
 * - **Period sheets** (`$ (…)`): row 1 names the two people, each over the
 *   column that holds their amounts; row 6 holds the start and, once closed,
 *   the end; rows 8 onward are the lines, with the item to the left of the
 *   amount columns and the note just right of them. The `Total` and
 *   `Montant à déposer` rows are read wherever they are: the household's
 *   sheets hold them in rows 2 to 4, above the lines (lg-37); below the lines,
 *   they end them. In the `Montant à déposer` row, the column holding a
 *   positive amount is who deposits it, and the arithmetic it is computed from
 *   tells `v1` (a division by the ratio) from `v2` (a product, no division).
 *   A sheet with no end is open, and no two periods overlap.
 * - **`Accueil`**: row heads name the people over their columns, and the row
 *   labelled `Salaires…` holds each one's salary under their name (lg-37).
 *
 * Another description moves those columns, rows, names and labels; the
 * verifications are the same whichever it is. Two things only a description
 * can take away: with no balance column nothing proves the rows, which is a
 * problem; with no bucket column the rows are read and proven but cannot be
 * filed, so they are `unfiled`, never guessed into a bucket.
 *
 * **Every problem is collected, not thrown.** A workbook with three typos
 * reports three, so the owner fixes them in one pass; `api` refuses to write
 * while any is left.
 */

import type {
  AccountLayout,
  Bucket,
  LayoutColumnRole,
  PeriodsLayout,
  SettlementFormula,
  SheetSelector,
  WorkbookLayout,
} from "@ledger/contract";
import { AppError, readerFolded, workbookLayoutSchema } from "@ledger/contract";
import { bufferAsOf, mortgageAsOf } from "./buckets.ts";
import type { FiledRow, MortgagePosition } from "./buckets.ts";
import { daysInMonth } from "./months.ts";
import { PARTS_PER_MILLION } from "./ratio.ts";
import type { Share } from "./ratio.ts";

/** A cell's cached value. A date is a calendar day, `yyyy-mm-dd`. */
export type CellValue =
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "date"; date: string };

export interface Cell {
  value: CellValue | null;
  /** The formula text, without its `=`, when the cell was computed. */
  formula: string | null;
}

/** One sheet: `rows[0]` is row 1 and `rows[r][0]` is column A. */
export interface Sheet {
  name: string;
  rows: readonly (readonly (Cell | null)[])[];
}

/** A correction from the owner's side file: a year-sheet row filed otherwise. */
export interface Correction {
  sheet: string;
  /** The spreadsheet's own row number, 1-based. */
  row: number;
  /** `undefined` leaves the bucket as the workbook has it. */
  bucket?: Bucket;
  /** `undefined` leaves the person; `null` is joint; text is a workbook name or a person id. */
  person?: string | null;
  note: string;
}

/**
 * The ratio a closed period was settled at, when it was not Accueil's: the
 * workbook keeps only today's salaries, so an earlier ratio is the owner's to
 * say (decided 2026-10-08).
 */
export interface PeriodRatio {
  /** The period sheet's name. */
  sheet: string;
  /** Workbook name or person id → share, in parts per million; the two sum to 1 000 000. */
  shares: ReadonlyMap<string, number>;
}

export interface Corrections {
  /** Workbook name → person id, for names that are not already a person's id. */
  people: ReadonlyMap<string, string>;
  corrections: readonly Correction[];
  ratios: readonly PeriodRatio[];
}

export const NO_CORRECTIONS: Corrections = { people: new Map(), corrections: [], ratios: [] };

/** A row of the account, as it will be stored, oldest first. */
export interface Movement {
  sheet: string;
  row: number;
  date: string;
  /** How the row is filed: the workbook's, or the correction's when there is one. */
  bucket: Bucket;
  personId: string | null;
  amountCents: number;
  balanceCents: number;
  detail: string;
  /** The workbook's own note, from the note column (`H` in the household's). */
  note: string | null;
  /** How the workbook filed it, when a correction files it otherwise. */
  workbook: { bucket: Bucket; personId: string | null } | null;
  /** The owner's note on the correction, when there is one. */
  correction: string | null;
}

/**
 * A row of the account the layout reads but this import cannot store: it has
 * no bucket, because the layout names no bucket column, or no balance, because
 * it names no balance column. Rows like these are a statement's, filed through
 * the inbox once proven, never by guessing a bucket here.
 */
export interface UnfiledRow {
  sheet: string;
  row: number;
  date: string;
  bucket: Bucket | null;
  personId: string | null;
  amountCents: number;
  balanceCents: number | null;
  detail: string;
  note: string | null;
}

export interface CarryOver {
  sheet: string;
  row: number;
  year: number;
  bucket: Bucket;
  amountCents: number;
}

export interface Repair {
  sheet: string;
  row: number;
  from: string;
  to: string;
}

export interface Skip {
  sheet: string;
  row: number;
}

/** A row listed as newer than a row dated after it: reported, and imported as typed. */
export interface OutOfOrder {
  sheet: string;
  row: number;
  date: string;
  /**
   * The row the sheet's order puts just before it, which is dated later: the
   * row below it in a sheet listed newest first, as the household's is.
   */
  belowRow: number;
  belowDate: string;
}

export interface WorkbookLine {
  sheet: string;
  row: number;
  personId: string;
  amountCents: number;
  label: string;
  note: string | null;
}

export interface WorkbookSettlement {
  formula: Extract<SettlementFormula, "v1" | "v2">;
  /** `null` when the sheet asked nobody for anything. */
  payerId: string | null;
  recipientId: string | null;
  depositCents: number;
}

export interface WorkbookPeriod {
  sheet: string;
  start: string;
  /** `null` for the open period. */
  end: string | null;
  lines: WorkbookLine[];
  /** What the sheet's `Montant à déposer` asked; `null` when it has none. */
  settlement: WorkbookSettlement | null;
  /** The ratio the corrections file gives it, in id order; `null` is Accueil's. */
  ratio: Share[] | null;
}

/**
 * What a closed period asked, and the deposit in the year sheets that paid
 * it: the payer's movement of exactly that amount, from two weeks before the
 * period's end up to the next period's end. Reported, never refused (lg-37):
 * a deposit can be paid net of a correction, or not reach the workbook at all.
 */
export interface PeriodDeposit {
  sheet: string;
  payerId: string;
  askedCents: number;
  /** The first day searched. */
  from: string;
  /** The movement that paid it, or `null` when none of that amount was found. */
  paid: { sheet: string; row: number; date: string } | null;
}

export interface WorkbookReading {
  /** Every movement, oldest first, each filed as it will be stored. */
  movements: Movement[];
  /** Rows read and checked that this import cannot file, oldest first; none under the household's layout. */
  unfiled: UnfiledRow[];
  carryOvers: CarryOver[];
  /** What the first year carried in from before the workbook, per bucket. */
  opening: Record<Bucket, number>;
  repairs: Repair[];
  skipped: Skip[];
  outOfOrder: OutOfOrder[];
  /** Closed periods, oldest first. */
  periods: WorkbookPeriod[];
  open: WorkbookPeriod | null;
  /** One per closed period that asked somebody for money, oldest first. */
  deposits: PeriodDeposit[];
  salaries: { personId: string; amountCents: number }[];
  /** Sheets read as none of the above, and so not imported. */
  ignored: string[];
  /** Each verification that held, in a sentence. */
  checks: string[];
  /** Each one that did not, or anything unreadable, naming its cell. Nothing is written while any is left. */
  problems: string[];
}

// --- The household's layout ---

/** §8's layout: the household's own workbook, and what `readWorkbook` reads when given no other. */
export const HOUSEHOLD_LAYOUT: WorkbookLayout = {
  account: {
    sheets: { by: "year" },
    yearPerSheet: true,
    order: "newest-first",
    columns: [
      { role: "date", column: "B" },
      { role: "bucket", column: "C" },
      { role: "detail", column: "D" },
      { role: "person", column: "E" },
      { role: "balance", column: "F" },
      { role: "amount", column: "G" },
      { role: "note", column: "H" },
    ],
    buckets: [
      { bucket: "mortgage", labels: ["Hypothèque"] },
      { bucket: "current-expenses", labels: ["Dép. Courantes", "Dépenses courantes"] },
    ],
    carryOverLabel: "Solde reporté",
    summary: { column: "C", labels: ["Solde", "Total"] },
  },
  periods: {
    sheets: { by: "prefix", prefix: "$" },
    namesRow: 1,
    datesRow: 6,
    firstLine: 8,
    totalLabel: "Total",
    depositLabel: "Montant à déposer",
  },
  salaries: { sheet: "Accueil", label: "Salaires" },
  ignored: ["Labels", "Budget"],
};

// --- Cells ---

function columnName(column: number): string {
  let name = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCodePoint(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

/** `2024!B14`, or `'$ (Avril-Août)'!F40` when the name needs quoting. */
export function cellRef(sheet: string, row: number, column: number): string {
  const name = /^[A-Za-z0-9_]+$/u.test(sheet) ? sheet : `'${sheet}'`;
  return `${name}!${columnName(column)}${String(row)}`;
}

function columnNumber(name: string): number {
  let column = 0;
  for (const letter of name) column = column * 26 + (letter.codePointAt(0) ?? 64) - 64;
  return column;
}

function cellAt(sheet: Sheet, row: number, column: number): Cell | null {
  return sheet.rows[row - 1]?.[column - 1] ?? null;
}

function textOf(cell: Cell | null): string | null {
  if (cell?.value?.kind !== "text") return null;
  const text = cell.value.text.trim();
  return text === "" ? null : text;
}

/**
 * A cell the household types freely — a movement's detail and note, a period
 * line's note — and the person column, whatever it holds (lg-68). `42`, or
 * `007`, which Excel saves as the number 7, is text, not an empty cell; a
 * number reads as the 15 significant digits Excel keeps of what was typed, so
 * a float's noise (`0.30000000000000004`) never reaches the books. A date,
 * which Excel makes of `5 janv` typed in French, reads as its ISO day. Kept
 * apart from `textOf`, which also reads the cells matched against words (a
 * bucket, a sheet's labels), where a number's text would be read as one; a
 * person's name is matched too, but there a number read as nothing filed the
 * row joint, and read as a name it is refused, naming the cell.
 */
function freeTextOf(cell: Cell | null): string | null {
  if (cell?.value?.kind === "number") return String(Number(cell.value.number.toPrecision(15)));
  if (cell?.value?.kind === "date") return cell.value.date;
  return textOf(cell);
}

function numberOf(cell: Cell | null): number | null {
  return cell?.value?.kind === "number" ? cell.value.number : null;
}

function dateOf(cell: Cell | null): string | null {
  return cell?.value?.kind === "date" ? cell.value.date : null;
}

/** Lower case, accents, dots and repeated spaces folded away: `Dép. Courantes` is `dep courantes`. */
function folded(text: string): string {
  return readerFolded(text);
}

/**
 * A cached amount in cents. Excel holds a computed figure unrounded, and a
 * float's `x × 100` can land a hair under the half cent, so it is fixed to six
 * places before it is rounded, half away from zero.
 */
export function toCents(value: number): number {
  const scaled = Number((Math.abs(value) * 100).toFixed(6));
  const cents = Math.round(scaled);
  return value < 0 ? 0 - cents : cents;
}

function formatCentsPlain(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

// --- People ---

/**
 * A workbook name to the person id the books use: the corrections file's map
 * first, then a person id that equals the name once case and accents are
 * folded, then a person whose shown name does (lg-76: a person added since has
 * a generated id, which no workbook names). Anything else is a problem the
 * owner settles in the map.
 */
class People {
  readonly #ids: ReadonlyMap<string, string>;
  readonly #names: ReadonlyMap<string, string>;
  readonly #shown: ReadonlyMap<string, string>;
  /** Everyone, as the problems name them: by shown name, never a generated id. */
  readonly #listed: string;
  readonly problems: string[] = [];
  readonly #reported = new Set<string>();

  constructor(
    people: readonly string[],
    names: ReadonlyMap<string, string>,
    shown: ReadonlyMap<string, string>,
  ) {
    this.#ids = new Map(people.map((id) => [folded(id), id]));
    const byShown = new Map<string, string>();
    for (const id of people) {
      const name = shown.get(id);
      if (name !== undefined && !byShown.has(folded(name))) byShown.set(folded(name), id);
    }
    this.#shown = byShown;
    this.#listed = people.map((id) => shown.get(id) ?? id).join(", ");
    const mapped = new Map<string, string>();
    for (const [name, id] of names) {
      if (!people.includes(id)) {
        this.problems.push(
          `The corrections file maps "${name}" to "${id}", who is not one of the household (${this.#listed || "nobody is configured"}).`,
        );
        continue;
      }
      mapped.set(folded(name), id);
    }
    this.#names = mapped;
  }

  /** The person id for `name`, or `undefined`, reported once per name, when there is none. */
  resolve(name: string, where: string): string | undefined {
    const key = folded(name);
    const id = this.peek(name);
    if (id === undefined && !this.#reported.has(key)) {
      this.#reported.add(key);
      this.problems.push(
        `${where} names "${name}", who is not one of the household (${this.#listed || "nobody is configured"}). Map the name to a person in the corrections file's "people".`,
      );
    }
    return id;
  }

  /** Like `resolve`, without reporting: for cells that may hold a name or anything else. */
  peek(name: string): string | undefined {
    const key = folded(name);
    return this.#names.get(key) ?? this.#ids.get(key) ?? this.#shown.get(key);
  }
}

// --- Year sheets ---

/** The account's layout as the reader uses it: column numbers, folded labels. */
interface AccountPlan {
  layout: AccountLayout;
  columns: Partial<Record<LayoutColumnRole, number>>;
  /** The date column, which every account has. */
  date: number;
  /** Where an amount's problem is named: the amount column, or the deposit one. */
  amountAt: number;
  /** The span of the columns the layout names, where a carry-over's label is looked for. */
  first: number;
  last: number;
  bucketNames: ReadonlyMap<string, Bucket>;
  /** The first label of each bucket, for a message: `Hypothèque or Dép. Courantes`. */
  bucketHint: string;
  carryOver: string | null;
  summary: { column: number; labels: string[] } | null;
}

function accountPlan(layout: AccountLayout): AccountPlan {
  const columns: Partial<Record<LayoutColumnRole, number>> = {};
  for (const entry of layout.columns) columns[entry.role] = columnNumber(entry.column);
  const numbers = Object.values(columns);
  const date = columns.date ?? 1;
  return {
    layout,
    columns,
    date,
    amountAt: columns.amount ?? columns.deposit ?? date,
    first: Math.min(...numbers),
    last: Math.max(...numbers),
    bucketNames: new Map(
      layout.buckets.flatMap((entry) =>
        entry.labels.map((text): [string, Bucket] => [folded(text), entry.bucket]),
      ),
    ),
    bucketHint: layout.buckets.flatMap((entry) => entry.labels.slice(0, 1)).join(" or "),
    carryOver: layout.carryOverLabel === null ? null : folded(layout.carryOverLabel),
    summary:
      layout.summary === null
        ? null
        : {
            column: columnNumber(layout.summary.column),
            labels: layout.summary.labels.map(folded),
          },
  };
}

function bucketOf(plan: AccountPlan, text: string | null): Bucket | undefined {
  return text === null ? undefined : plan.bucketNames.get(folded(text));
}

function isCarryOver(plan: AccountPlan, sheet: Sheet, row: number): boolean {
  if (plan.carryOver === null) return false;
  for (let column = plan.first; column <= plan.last; column++) {
    const text = textOf(cellAt(sheet, row, column));
    if (text !== null && folded(text).includes(plan.carryOver)) return true;
  }
  return false;
}

/**
 * A row of the summary the older year sheets keep above their movements:
 * `Solde Dép. Courantes`, `Solde Hypothèque` and `Total`, each a formula over
 * the sheet. It restates the rows, so it is neither imported nor a problem.
 */
function isSummary(plan: AccountPlan, sheet: Sheet, row: number): boolean {
  // One column only (`C` in the household's): `D` is a movement's free-text
  // detail, and a detail that starts with "Solde" on a row whose date is
  // unreadable is money, not a summary.
  if (plan.summary === null) return false;
  const text = textOf(cellAt(sheet, row, plan.summary.column));
  if (text === null) return false;
  const key = folded(text);
  return plan.summary.labels.some((start) => key.startsWith(start));
}

/** An amount as the layout gives it: one signed column, or a withdrawal and a deposit. */
type AmountRead =
  | { kind: "none" }
  | { kind: "bad"; column: number; problem: string }
  | {
      kind: "amount";
      /** Signed, as the books keep it. */
      value: number;
      /** Each figure it was read from, so one finer than a cent is named at its own cell. */
      figures: { column: number; value: number }[];
    };

function amountOf(plan: AccountPlan, sheet: Sheet, row: number): AmountRead {
  const read = (column: number): AmountRead => {
    const cell = cellAt(sheet, row, column);
    const value = numberOf(cell);
    if (value !== null) return { kind: "amount", value, figures: [{ column, value }] };
    if (cell === null) return { kind: "none" };
    return {
      kind: "bad",
      column,
      problem:
        cell.value === null
          ? "the amount is a formula with no readable value; open the workbook in Excel and save it."
          : "the amount is not a number.",
    };
  };
  const { amount, withdrawal, deposit } = plan.columns;
  if (amount !== undefined) return read(amount);
  if (withdrawal === undefined || deposit === undefined) return { kind: "none" };
  const out = read(withdrawal);
  const into = read(deposit);
  if (out.kind === "bad") return out;
  if (into.kind === "bad") return into;
  if (out.kind === "none" && into.kind === "none") return { kind: "none" };
  // Unsigned columns, though a bank may still print a withdrawal with its minus.
  const outValue = out.kind === "amount" ? Math.abs(out.value) : 0;
  const inValue = into.kind === "amount" ? Math.abs(into.value) : 0;
  return {
    kind: "amount",
    value: inValue - outValue,
    figures: [
      ...(out.kind === "amount" ? out.figures : []),
      ...(into.kind === "amount" ? into.figures : []),
    ],
  };
}

/** An amount's cents: each figure rounded on its own, so a split row's float noise never adds. */
function centsOf(read: Extract<AmountRead, { kind: "amount" }>, plan: AccountPlan): number {
  if (plan.columns.amount !== undefined) return toCents(read.value);
  const [first, second] = read.figures;
  const signed = (figure: { column: number; value: number } | undefined): number =>
    figure === undefined
      ? 0
      : (figure.column === plan.columns.deposit ? 1 : -1) * Math.abs(toCents(figure.value));
  return signed(first) + signed(second);
}

/** `date` with its year replaced by `year`, or `null` when that day does not exist (29 February). */
function inYear(date: string, year: number): string | null {
  const [, month, day] = date.split("-").map(Number);
  if (month === undefined || day === undefined || day > daysInMonth(year, month)) return null;
  return `${String(year)}${date.slice(4)}`;
}

/** One account sheet, read. */
interface YearRead {
  /** The sheet's name, which names it in a message: its year, in the household's. */
  label: string;
  /** `null` when the layout does not hold a year per sheet. */
  year: number | null;
  /** Oldest first, filed or not. */
  rows: UnfiledRow[];
  carryOvers: CarryOver[];
}

function readYear(
  sheet: Sheet,
  year: number | null,
  plan: AccountPlan,
  people: People,
  out: Pick<WorkbookReading, "repairs" | "skipped" | "outOfOrder" | "problems">,
): YearRead {
  const rows: UnfiledRow[] = [];
  const carryOvers: CarryOver[] = [];
  const { columns } = plan;
  let dated = false;
  for (let row = 1; row <= sheet.rows.length; row++) {
    const at = (column: number): string => cellRef(sheet.name, row, column);
    const bucketText =
      columns.bucket === undefined ? null : textOf(cellAt(sheet, row, columns.bucket));
    const read = amountOf(plan, sheet, row);
    const amount = read.kind === "amount" ? read.value : null;

    if (isCarryOver(plan, sheet, row)) {
      const bucket = bucketOf(plan, bucketText);
      if (bucket === undefined) {
        out.problems.push(
          `${at(columns.bucket ?? plan.date)}: a carry-over names no bucket the books know.`,
        );
      } else if (read.kind !== "amount") {
        out.problems.push(`${at(plan.amountAt)}: a carry-over has no amount.`);
      } else {
        carryOvers.push({
          sheet: sheet.name,
          row,
          year: year ?? 0,
          bucket,
          amountCents: centsOf(read, plan),
        });
      }
      continue;
    }

    const written = dateOf(cellAt(sheet, row, plan.date));
    if (written === null) {
      // A header, a title, a blank, or the summary above the movements. An
      // amount with no date anywhere else would be money nobody can place,
      // which is never skipped quietly.
      if (amount !== null && amount !== 0 && !(!dated && isSummary(plan, sheet, row))) {
        out.problems.push(`${at(plan.date)}: an amount with no date.`);
      }
      continue;
    }
    dated = true;
    // A placeholder's amount is empty. One that holds text, or a formula Excel
    // never saved a value for, is an amount the books cannot read, and on the
    // newest rows nothing after it would show the money missing.
    if (read.kind === "bad") {
      out.problems.push(`${at(read.column)}: ${read.problem}`);
      continue;
    }
    if (read.kind === "none" || centsOf(read, plan) === 0) {
      out.skipped.push({ sheet: sheet.name, row });
      continue;
    }
    const fine = read.figures.find((figure) => !wholeCents(figure.value));
    if (fine !== undefined) {
      out.problems.push(
        `${at(fine.column)}: ${String(fine.value)} is not a whole number of cents.`,
      );
      continue;
    }

    let date = written;
    if (year !== null && Number(written.slice(0, 4)) !== year) {
      const repaired = inYear(written, year);
      if (repaired === null) {
        out.problems.push(
          `${at(plan.date)}: ${written} is not in ${String(year)}, and that day does not exist in ${String(year)}.`,
        );
        continue;
      }
      out.repairs.push({ sheet: sheet.name, row, from: written, to: repaired });
      date = repaired;
    }

    let bucket: Bucket | null = null;
    if (columns.bucket !== undefined) {
      const found = bucketOf(plan, bucketText);
      if (found === undefined) {
        out.problems.push(
          `${at(columns.bucket)}: "${bucketText ?? ""}" is not a bucket (${plan.bucketHint}).`,
        );
        continue;
      }
      bucket = found;
    }
    let balanceCents: number | null = null;
    if (columns.balance !== undefined) {
      const balance = numberOf(cellAt(sheet, row, columns.balance));
      if (balance === null) {
        out.problems.push(`${at(columns.balance)}: a movement has no running balance.`);
        continue;
      }
      if (!wholeCents(balance)) {
        out.problems.push(
          `${at(columns.balance)}: ${String(balance)} is not a whole number of cents.`,
        );
        continue;
      }
      balanceCents = toCents(balance);
    }
    const name =
      columns.person === undefined ? null : freeTextOf(cellAt(sheet, row, columns.person));
    let personId: string | null = null;
    if (name !== null && columns.person !== undefined) {
      const found = people.resolve(name, at(columns.person));
      if (found === undefined) continue;
      personId = found;
    }
    rows.push({
      sheet: sheet.name,
      row,
      date,
      bucket,
      personId,
      amountCents: centsOf(read, plan),
      balanceCents,
      detail:
        (columns.detail === undefined ? null : freeTextOf(cellAt(sheet, row, columns.detail))) ??
        "",
      note: columns.note === undefined ? null : freeTextOf(cellAt(sheet, row, columns.note)),
    });
  }
  // The household's sheets list the newest first; the books keep the oldest first.
  const newestFirst = plan.layout.order === "newest-first";
  const oldestFirst = newestFirst ? rows.toReversed() : rows;
  // The row order is what proves a repaired year, so it is checked: no row is
  // older than the one the order puts before it. Where a repaired row breaks
  // that order the repair is unproven, and it is refused at that row's cell.
  // Any other inversion is a date typed a few days off; the figures are read
  // by position, so it is reported and imported as typed (decided 2026-10-08).
  const repaired = new Map(
    out.repairs
      .filter((repair) => repair.sheet === sheet.name)
      .map((repair) => [repair.row, repair.from]),
  );
  for (const [index, movement] of oldestFirst.entries()) {
    const below = oldestFirst[index - 1];
    if (below === undefined || movement.date >= below.date) continue;
    const suspect = repaired.has(movement.row) ? movement : repaired.has(below.row) ? below : null;
    if (suspect === null) {
      out.outOfOrder.push({
        sheet: sheet.name,
        row: movement.row,
        date: movement.date,
        belowRow: below.row,
        belowDate: below.date,
      });
      continue;
    }
    const [upper, lower] = newestFirst ? [movement, below] : [below, movement];
    out.problems.push(
      `${cellRef(sheet.name, suspect.row, plan.date)}: typed ${repaired.get(suspect.row) ?? ""} and repaired to ${suspect.date}, the sheet's year, but row ${String(upper.row)} (${upper.date}) is listed above row ${String(lower.row)} (${lower.date}); ${newestFirst ? "newest" : "oldest"} first, the order does not prove the repair.`,
    );
  }
  return { label: year === null ? sheet.name : String(year), year, rows: oldestFirst, carryOvers };
}

/** Whether a cached figure is a whole number of cents, to within a float's noise. */
function wholeCents(value: number): boolean {
  const scaled = Math.abs(value) * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

const BUCKETS_IN_ORDER: readonly Bucket[] = ["mortgage", "current-expenses"];

/**
 * Every `Solde reporté` against the year before it, bucket by bucket, and the
 * running balance from one row to the next. Both are checked on the workbook's
 * own filing, before any correction: the workbook computed its carry-overs from
 * what it said then.
 *
 * A layout with no carry-overs starts the balance where its first row says it
 * stood before that row; one with no balance column proves nothing, and says so.
 */
function verifyYears(years: readonly YearRead[], plan: AccountPlan, out: WorkbookReading): void {
  let previous: { label: string; closing: Record<Bucket, number> } | null = null;
  let balance: number | null = null;
  let chained = 0;
  let breaks = 0;
  const balanceAt = plan.columns.balance;
  for (const year of years) {
    const carried: Record<Bucket, number> = { mortgage: 0, "current-expenses": 0 };
    if (plan.carryOver !== null) {
      for (const bucket of BUCKETS_IN_ORDER) {
        const found = year.carryOvers.filter((carry) => carry.bucket === bucket);
        const [carry] = found;
        if (found.length > 1) {
          out.problems.push(
            `${year.label}: ${String(found.length)} carry-overs for the ${bucket} bucket; a year has one.`,
          );
        }
        carried[bucket] = carry?.amountCents ?? 0;
        if (previous === null) continue;
        const closing = previous.closing[bucket];
        if (carry === undefined) {
          out.problems.push(
            `${year.label}: no carry-over for the ${bucket} bucket, which closed ${previous.label} at ${formatCentsPlain(closing)}.`,
          );
        } else if (carry.amountCents !== closing) {
          out.problems.push(
            `${cellRef(carry.sheet, carry.row, plan.amountAt)}: carries ${formatCentsPlain(carry.amountCents)} into the ${bucket} bucket, but ${previous.label} closed it at ${formatCentsPlain(closing)} (${formatCentsPlain(carry.amountCents - closing)} unexplained).`,
          );
        } else {
          out.checks.push(
            `${year.label} carries ${formatCentsPlain(closing)} into the ${bucket} bucket, as ${previous.label} closed it.`,
          );
        }
      }
      if (previous === null) out.opening = { ...carried };
      if (balance === null) balance = carried.mortgage + carried["current-expenses"];
    }

    for (const movement of year.rows) {
      if (balanceAt === undefined || movement.balanceCents === null) continue;
      // With no carry-over to start from, the first row says what stood before it.
      balance ??= movement.balanceCents - movement.amountCents;
      const expected: number = balance + movement.amountCents;
      chained += 1;
      if (movement.balanceCents !== expected) {
        breaks += 1;
        out.problems.push(
          `${cellRef(movement.sheet, movement.row, balanceAt)}: the running balance is ${formatCentsPlain(movement.balanceCents)}, but the row before it left ${formatCentsPlain(balance)} and this one moves ${formatCentsPlain(movement.amountCents)} (${formatCentsPlain(movement.balanceCents - expected)} unexplained).`,
        );
      }
      // From the row's own balance on, so one break is reported once.
      balance = movement.balanceCents;
    }

    const closing = { ...carried };
    for (const movement of year.rows) {
      if (movement.bucket !== null) closing[movement.bucket] += movement.amountCents;
    }
    previous = { label: year.label, closing };
  }
  const rows = years.reduce((sum, year) => sum + year.rows.length, 0);
  if (balanceAt === undefined) {
    if (rows > 0) {
      out.problems.push(
        `The layout names no balance column, so nothing proves the ${String(rows)} rows read are all of them or that their amounts are right. Match them one for one against a statement paste of the same dates first (docs/00-ANALYSIS.md §8).`,
      );
    }
    return;
  }
  if (chained > 0 && breaks === 0) {
    const [first] = years.flatMap((year) => year.rows);
    const inferred = plan.carryOver === null;
    const start = inferred
      ? (first?.balanceCents ?? 0) - (first?.amountCents ?? 0)
      : out.opening.mortgage + out.opening["current-expenses"];
    out.checks.push(
      `The running balance follows from row to row through all ${String(chained)} movements, from the ${formatCentsPlain(start)} ${inferred ? "the first row implies" : "the first year carried in"}.`,
    );
  }
}

// --- Corrections ---

function applyCorrections(
  movements: readonly Movement[],
  corrections: readonly Correction[],
  people: People,
  sheets: ReadonlySet<string>,
  dateColumn: number,
  out: WorkbookReading,
): Movement[] {
  const byPlace = new Map(
    movements.map((movement) => [`${movement.sheet}!${String(movement.row)}`, movement]),
  );
  const corrected = new Map<string, Movement>();
  for (const correction of corrections) {
    const place = `${correction.sheet}!${String(correction.row)}`;
    const where = `The correction for ${cellRef(correction.sheet, correction.row, dateColumn)}`;
    const movement = byPlace.get(place);
    if (movement === undefined) {
      out.problems.push(
        sheets.has(correction.sheet)
          ? `${where} names a row that is not a movement of the account.`
          : `${where} names a sheet the workbook does not have.`,
      );
      continue;
    }
    if (corrected.has(place)) {
      out.problems.push(`${where} is the second correction of that row; give it one.`);
      continue;
    }
    let personId = movement.personId;
    if (correction.person !== undefined) {
      if (correction.person === null) personId = null;
      else {
        const found = people.resolve(correction.person, where);
        if (found === undefined) continue;
        personId = found;
      }
    }
    const bucket = correction.bucket ?? movement.bucket;
    if (bucket === movement.bucket && personId === movement.personId) {
      out.problems.push(`${where} files the row as the workbook already does.`);
      continue;
    }
    corrected.set(place, {
      ...movement,
      bucket,
      personId,
      workbook: { bucket: movement.bucket, personId: movement.personId },
      correction: correction.note,
    });
  }
  return movements.map(
    (movement) => corrected.get(`${movement.sheet}!${String(movement.row)}`) ?? movement,
  );
}

/** What the stored row's note says: the workbook's, then the correction's. */
export function noteOf(movement: Movement): string | null {
  const notes: string[] = [];
  if (movement.note !== null) notes.push(movement.note);
  if (movement.workbook !== null && movement.correction !== null) {
    const was = `${movement.workbook.bucket}, ${movement.workbook.personId ?? "joint"}`;
    notes.push(`Corrected on import from ${was}: ${movement.correction}`);
  }
  return notes.length === 0 ? null : notes.join("\n");
}

// --- Period sheets ---

function rowTexts(sheet: Sheet, row: number): string[] {
  const texts: string[] = [];
  for (const cell of sheet.rows[row - 1] ?? []) {
    const text = textOf(cell);
    if (text !== null) texts.push(text);
  }
  return texts;
}

/** A reference to a cell of the same sheet: not after a `!` or a range's `:`, and not a function's name. */
const SAME_SHEET_CELL = /(?<![\w$!.':])\$?([A-Z]{1,3})\$?(\d+)(?![\w(!])/gu;

/**
 * The arithmetic a deposit is computed from: its own formula, and when that
 * neither divides nor multiplies, the formulas of the cells on its sheet it
 * reads. The v1 sheets compute it in an `Équivalence` row and only subtract
 * in `Montant à déposer` (`=IF(D3<E3,E3-D3,0)`), so the division is a row up.
 */
function arithmeticOf(sheet: Sheet, formula: string): string {
  if (/[/*]/u.test(formula)) return formula;
  const read = [...formula.matchAll(SAME_SHEET_CELL)].map(
    ([, column = "", row = ""]) => cellAt(sheet, Number(row), columnNumber(column))?.formula ?? "",
  );
  return [formula, ...read].join(" ");
}

function readSettlement(
  sheet: Sheet,
  row: number,
  columns: readonly { column: number; personId: string }[],
  depositLabel: string,
  out: WorkbookReading,
): WorkbookSettlement | null {
  const asked = columns.map(({ column, personId }) => ({
    column,
    personId,
    cents: toCents(numberOf(cellAt(sheet, row, column)) ?? 0),
    formula: cellAt(sheet, row, column)?.formula ?? null,
  }));
  // The person whose column holds a positive figure deposits it. Failing that,
  // a negative figure in one column is what the other person owes, which is
  // how a formula written once, in the first person's column, reads.
  const positive = asked.filter((entry) => entry.cents > 0);
  const negative = asked.filter((entry) => entry.cents < 0);
  const chosen = positive.length > 0 ? positive : negative;
  if (chosen.length > 1) {
    out.problems.push(
      `${cellRef(sheet.name, row, columns[0]?.column ?? 1)}: the ${depositLabel} asks both people for money; it asks one.`,
    );
    return null;
  }
  const [asking] = chosen;
  const formulaText =
    asking?.formula ?? asked.find((entry) => entry.formula !== null)?.formula ?? null;
  const at = cellRef(sheet.name, row, asking?.column ?? columns[0]?.column ?? 1);
  if (formulaText === null) {
    out.problems.push(`${at}: the ${depositLabel} has no formula, so its version cannot be told.`);
    return null;
  }
  const arithmetic = arithmeticOf(sheet, formulaText);
  let formula: "v1" | "v2";
  if (arithmetic.includes("/")) formula = "v1";
  else if (arithmetic.includes("*")) formula = "v2";
  else {
    out.problems.push(
      `${at}: the formula =${formulaText} is neither v1 (a division by the ratio) nor v2 (a product with it).`,
    );
    return null;
  }
  if (asking === undefined) return { formula, payerId: null, recipientId: null, depositCents: 0 };
  const other = columns.find((entry) => entry.personId !== asking.personId)?.personId ?? null;
  const payerId = asking.cents > 0 ? asking.personId : other;
  const recipientId = asking.cents > 0 ? other : asking.personId;
  return { formula, payerId, recipientId, depositCents: Math.abs(asking.cents) };
}

function readPeriod(
  sheet: Sheet,
  layout: PeriodsLayout,
  people: People,
  out: WorkbookReading,
): WorkbookPeriod | null {
  // Rows 1 to 7 are the household's heading, and its first line is row 8.
  const { namesRow, datesRow, firstLine } = layout;
  const totalLabel = folded(layout.totalLabel);
  const depositLabel = folded(layout.depositLabel);
  const columns: { column: number; personId: string }[] = [];
  for (const [index, cell] of (sheet.rows[namesRow - 1] ?? []).entries()) {
    const text = textOf(cell);
    const personId = text === null ? undefined : people.peek(text);
    if (personId !== undefined && !columns.some((entry) => entry.personId === personId)) {
      columns.push({ column: index + 1, personId });
    }
  }
  if (columns.length !== 2) {
    out.problems.push(
      `${cellRef(sheet.name, namesRow, 1)}: row ${String(namesRow)} names ${String(columns.length)} of the household (${rowTexts(sheet, namesRow).join(", ") || "nothing"}); a period sheet names two. Map a name in the corrections file's "people".`,
    );
    return null;
  }
  const first = Math.min(...columns.map((entry) => entry.column));
  const last = Math.max(...columns.map((entry) => entry.column));

  const dates = (sheet.rows[datesRow - 1] ?? []).flatMap((cell) => {
    const date = dateOf(cell);
    return date === null ? [] : [date];
  });
  const [start, end] = dates;
  if (start === undefined) {
    out.problems.push(
      `${cellRef(sheet.name, datesRow, 1)}: row ${String(datesRow)} holds no start date.`,
    );
    return null;
  }
  if (end !== undefined && end < start) {
    out.problems.push(
      `${cellRef(sheet.name, datesRow, 1)}: the period ends (${end}) before it starts (${start}).`,
    );
    return null;
  }

  const lines: WorkbookLine[] = [];
  const totals = new Map<string, number>();
  let totalRow = firstLine;
  let settlement: WorkbookSettlement | null = null;
  let ended = false;
  // The summary rows are read from the row under the names, since the
  // household's sheets keep them above the lines; a line is read only from the
  // first line on.
  for (let row = namesRow + 1; row <= sheet.rows.length; row++) {
    const texts = rowTexts(sheet, row).map(folded);
    if (texts.some((text) => text.startsWith(depositLabel))) {
      settlement = readSettlement(sheet, row, columns, layout.depositLabel, out);
      if (row >= firstLine) ended = true;
      continue;
    }
    const labels: string[] = [];
    for (let column = 1; column < first; column++) {
      const text = textOf(cellAt(sheet, row, column));
      if (text !== null) labels.push(text);
    }
    const label = labels.join(" ");
    if (folded(label).startsWith(totalLabel)) {
      for (const { column, personId } of columns) {
        const total = numberOf(cellAt(sheet, row, column));
        if (total !== null) totals.set(personId, toCents(total));
      }
      totalRow = row;
      if (row >= firstLine) ended = true;
      continue;
    }
    if (ended || row < firstLine) continue;
    const note = freeTextOf(cellAt(sheet, row, last + 1));
    for (const { column, personId } of columns) {
      const cell = cellAt(sheet, row, column);
      if (cell === null || cell.value === null) continue;
      const amount = numberOf(cell);
      if (amount === null) {
        out.problems.push(
          `${cellRef(sheet.name, row, column)}: an amount column holds something that is not an amount.`,
        );
        continue;
      }
      const cents = toCents(amount);
      if (cents !== 0)
        lines.push({ sheet: sheet.name, row, personId, amountCents: cents, label, note });
    }
  }

  for (const { column, personId } of columns) {
    const total = totals.get(personId);
    if (total === undefined) continue;
    const sum = lines
      .filter((line) => line.personId === personId)
      .reduce((s, line) => s + line.amountCents, 0);
    if (sum === total) {
      out.checks.push(
        `${sheet.name}: ${personId}'s lines add up to the sheet's total, ${formatCentsPlain(total)}.`,
      );
    } else {
      out.problems.push(
        `${cellRef(sheet.name, totalRow, column)}: ${personId}'s lines add up to ${formatCentsPlain(sum)}, but the sheet's total says ${formatCentsPlain(total)}.`,
      );
    }
  }
  return { sheet: sheet.name, start, end: end ?? null, lines, settlement, ratio: null };
}

function overlap(
  period: WorkbookPeriod,
  before: WorkbookPeriod & { end: string },
  datesRow: number,
): string {
  return `${cellRef(period.sheet, datesRow, 1)}: ${period.sheet} starts on ${period.start}, before ${before.sheet} ends on ${before.end}; periods do not overlap.`;
}

function orderPeriods(
  read: readonly WorkbookPeriod[],
  layout: PeriodsLayout,
  out: WorkbookReading,
): void {
  const open = read.filter((period) => period.end === null);
  const closed = read
    .filter((period): period is WorkbookPeriod & { end: string } => period.end !== null)
    .toSorted((a, b) => a.end.localeCompare(b.end));
  if (open.length > 1) {
    out.problems.push(
      `${open.map((period) => period.sheet).join(", ")} have no end date; only the open period has none.`,
    );
  }
  const [current] = open;
  const newest = closed.at(-1);
  if (current !== undefined && newest !== undefined && current.start <= newest.start) {
    out.problems.push(`${current.sheet} has no end date, but it is not the newest period.`);
  } else if (current !== undefined && newest !== undefined && current.start < newest.end) {
    out.problems.push(overlap(current, newest, layout.datesRow));
  }
  for (const [index, period] of closed.entries()) {
    const before = closed[index - 1];
    // A period may start the day the one before it ends; it may not start sooner.
    if (before !== undefined && period.start < before.end)
      out.problems.push(overlap(period, before, layout.datesRow));
    if (period.settlement === null) {
      out.problems.push(
        `${period.sheet} is closed, but no ${layout.depositLabel} was read from it.`,
      );
    }
    if (closed[index - 1]?.end === period.end) {
      out.problems.push(
        `${closed[index - 1]?.sheet ?? ""} and ${period.sheet} end on the same day.`,
      );
    }
  }
  // The books keep one period per start (`periods_start`).
  const starts = new Map<string, string>();
  for (const period of read) {
    const other = starts.get(period.start);
    if (other !== undefined)
      out.problems.push(`${other} and ${period.sheet} start on the same day.`);
    starts.set(period.start, period.sheet);
  }
  out.periods = closed;
  out.open = current ?? null;
}

/**
 * Two weeks before the end: the household has paid a day early, and nothing
 * measured needed more. Up to the next period's end, since a late deposit is
 * still this period's until the next one closes.
 */
const DEPOSIT_LEAD_DAYS = 14;

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

function findDeposits(out: WorkbookReading): void {
  for (const [index, period] of out.periods.entries()) {
    const settlement = period.settlement;
    if (settlement === null || settlement.payerId === null || settlement.depositCents === 0)
      continue;
    const payerId = settlement.payerId;
    const from = daysBefore(period.end ?? period.start, DEPOSIT_LEAD_DAYS);
    const until = out.periods[index + 1]?.end ?? null;
    const paid = out.movements.find(
      (movement) =>
        movement.personId === payerId &&
        movement.amountCents === settlement.depositCents &&
        movement.date >= from &&
        (until === null || movement.date <= until),
    );
    out.deposits.push({
      sheet: period.sheet,
      payerId,
      askedCents: settlement.depositCents,
      from,
      paid: paid === undefined ? null : { sheet: paid.sheet, row: paid.row, date: paid.date },
    });
  }
}

// --- Accueil ---

/**
 * A salary is a number in a row labelled `Salaires…`, under the column the
 * nearest name above it heads. Accueil names the people again further down,
 * over its calculators, and only the labelled row is read, so those figures
 * are never taken for salaries.
 */
function readSalaries(sheet: Sheet, label: string, people: People, out: WorkbookReading): void {
  const start = folded(label);
  const found = new Map<string, number>();
  const heads = new Map<number, string>();
  for (const [index, cells] of sheet.rows.entries()) {
    const salaries = cells.some((cell) => {
      const text = textOf(cell);
      return text !== null && folded(text).startsWith(start);
    });
    for (const [column, cell] of cells.entries()) {
      const text = textOf(cell);
      const personId = text === null ? undefined : people.peek(text);
      if (personId !== undefined) {
        heads.set(column, personId);
        continue;
      }
      const salary = numberOf(cell);
      const head = heads.get(column);
      if (!salaries || salary === null || head === undefined) continue;
      if (found.has(head)) {
        out.problems.push(
          `${cellRef(sheet.name, index + 1, column + 1)}: a second salary for ${head}.`,
        );
      }
      found.set(head, toCents(salary));
    }
  }
  if (found.size !== 2) {
    out.problems.push(
      `${sheet.name}: ${String(found.size)} salaries were found; the ratio needs one for each of two people, in a row labelled ${label}, under a column each one's name heads.`,
    );
  }
  out.salaries = [...found].map(([personId, amountCents]) => ({ personId, amountCents }));
}

// --- The whole workbook ---

export interface ReadOptions {
  /** Every person id the books may name. */
  people: readonly string[];
  /**
   * How the household shows each of them, by id, as the directory names them
   * (lg-76): a workbook name is matched against these as well as the ids.
   */
  names?: ReadonlyMap<string, string>;
  corrections?: Corrections;
  /** How the workbook is laid out; the household's own when absent (lg-38). */
  layout?: WorkbookLayout;
}

const YEAR_SHEET = /^\d{4}$/u;

function selects(selector: SheetSelector, sheet: Sheet): boolean {
  const name = sheet.name.trim();
  switch (selector.by) {
    case "year":
      return YEAR_SHEET.test(name);
    case "prefix":
      return name.startsWith(selector.prefix);
    case "name":
      return selector.names.some((wanted) => folded(wanted) === folded(name));
  }
}

function emptyReading(): WorkbookReading {
  return {
    movements: [],
    unfiled: [],
    carryOvers: [],
    opening: { mortgage: 0, "current-expenses": 0 },
    repairs: [],
    skipped: [],
    outOfOrder: [],
    periods: [],
    open: null,
    deposits: [],
    salaries: [],
    ignored: [],
    checks: [],
    problems: [],
  };
}

export function readWorkbook(sheets: readonly Sheet[], options: ReadOptions): WorkbookReading {
  const out = emptyReading();
  // A layout is checked as the contract has it, not only as its type does: a
  // role named twice is a well-typed description that cannot be read.
  const checked = workbookLayoutSchema.safeParse(options.layout ?? HOUSEHOLD_LAYOUT);
  if (!checked.success) {
    out.problems.push(
      ...checked.error.issues.map(
        (issue) => `The layout, at ${issue.path.join(".") || "its top"}: ${issue.message}`,
      ),
    );
    return out;
  }
  const layout = checked.data;
  const plan = accountPlan(layout.account);
  const corrections = options.corrections ?? NO_CORRECTIONS;
  const people = new People(options.people, corrections.people, options.names ?? new Map());

  const years: YearRead[] = [];
  const periods: WorkbookPeriod[] = [];
  let home: Sheet | undefined;
  for (const sheet of sheets) {
    const name = sheet.name.trim();
    if (selects(layout.account.sheets, sheet)) {
      if (!layout.account.yearPerSheet) years.push(readYear(sheet, null, plan, people, out));
      else if (YEAR_SHEET.test(name)) years.push(readYear(sheet, Number(name), plan, people, out));
      else
        out.problems.push(`The layout reads "${sheet.name}" as a year, but its name is not one.`);
    } else if (layout.periods !== null && selects(layout.periods.sheets, sheet)) {
      const period = readPeriod(sheet, layout.periods, people, out);
      if (period !== null) periods.push(period);
    } else if (layout.salaries !== null && folded(name) === folded(layout.salaries.sheet)) {
      home = sheet;
    } else out.ignored.push(sheet.name);
  }

  // Year sheets in their years' order; any other account sheets as the workbook orders them.
  years.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  if (years.length === 0) {
    out.problems.push(
      layout.account.sheets.by === "year"
        ? "The workbook has no year sheet (2022, 2023, …)."
        : "The workbook has no sheet the layout reads as the account.",
    );
  }
  for (const [index, year] of years.entries()) {
    const before = years[index - 1];
    if (
      before !== undefined &&
      before.year !== null &&
      year.year !== null &&
      year.year !== before.year + 1
    ) {
      out.problems.push(
        `The workbook has ${String(before.year)} and ${String(year.year)}, and nothing between them.`,
      );
    }
  }
  // A description that reads not one row of the account proves nothing: every
  // check below passes over nothing, and a model's answer pointing the amount
  // at empty columns would import an empty account cleanly (lg-66, Build 2.2;
  // lg-38's gate 1 measured it on `csv-balance`, lg-56 on `empty-columns-csv`).
  // Only when nothing has refused the reading already: a row refused at its
  // cell is a row the description did reach, and its problem says why.
  if (
    years.length > 0 &&
    years.every((year) => year.rows.length === 0) &&
    out.problems.length === 0 &&
    people.problems.length === 0
  ) {
    const names = years.map((year) => `"${year.label}"`).join(", ");
    out.problems.push(
      `The layout reads no row of the account from ${names}: ${String(out.skipped.length)} dated rows were skipped for having no amount, and none was read.`,
    );
  }
  verifyYears(years, plan, out);
  out.carryOvers = years.flatMap((year) => year.carryOvers);

  const movements: Movement[] = [];
  for (const row of years.flatMap((year) => year.rows)) {
    const { bucket, balanceCents } = row;
    if (bucket === null || balanceCents === null) out.unfiled.push(row);
    else movements.push({ ...row, bucket, balanceCents, workbook: null, correction: null });
  }
  out.movements = applyCorrections(
    movements,
    corrections.corrections,
    people,
    new Set(sheets.map((sheet) => sheet.name)),
    plan.date,
    out,
  );

  if (layout.periods !== null) orderPeriods(periods, layout.periods, out);
  findDeposits(out);
  if (layout.salaries !== null) {
    if (home === undefined) {
      out.problems.push(`The workbook has no ${layout.salaries.sheet} sheet, so no salaries.`);
    } else readSalaries(home, layout.salaries.label, people, out);
  }
  applyRatios(corrections.ratios, people, out);

  out.problems.unshift(...people.problems);
  return out;
}

/**
 * Each closed period the corrections file gives its own ratio. A ratio names
 * the same two people Accueil does; the open period takes Accueil's, which is
 * today's, so it cannot be given another.
 */
function applyRatios(ratios: readonly PeriodRatio[], people: People, out: WorkbookReading): void {
  const household = out.salaries.map((salary) => salary.personId).toSorted();
  for (const [index, ratio] of ratios.entries()) {
    const where = `The corrections file's ratio ${String(index + 1)}, for "${ratio.sheet}",`;
    if (out.open?.sheet === ratio.sheet) {
      out.problems.push(
        `${where} names the open period, which is settled at Accueil's ratio, today's.`,
      );
      continue;
    }
    const period = out.periods.find((candidate) => candidate.sheet === ratio.sheet);
    if (period === undefined) {
      out.problems.push(`${where} names no closed period sheet of the workbook.`);
      continue;
    }
    const shares: Share[] = [];
    for (const [name, partsPerMillion] of ratio.shares) {
      const personId = people.resolve(name, where);
      if (personId !== undefined) shares.push({ personId, partsPerMillion });
    }
    if (shares.length !== 2) continue;
    const named = shares.map((share) => share.personId).toSorted();
    if (named[0] === named[1] || (household.length === 2 && named.join() !== household.join())) {
      out.problems.push(
        `${where} names ${named.join(" and ")}; a ratio is between the two people Accueil names (${household.join(" and ")}).`,
      );
      continue;
    }
    period.ratio = shares.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  }
}

// --- What the workbook says the buckets hold ---

export interface WorkbookFigures {
  /** The day of the last movement. */
  asOf: string;
  mortgage: MortgagePosition;
  bufferBalanceCents: number;
}

/**
 * The two buckets as the workbook's rows file them, corrections applied, with
 * what the first year carried in. The carry-in belongs to nobody the rows can
 * name, so it counts in each balance and in no person's own money.
 */
export function workbookFigures(
  reading: WorkbookReading,
  people: readonly string[],
): WorkbookFigures {
  const rows: FiledRow[] = reading.movements.map((movement) => ({
    date: movement.date,
    amountCents: movement.amountCents,
    bucket: movement.bucket,
    personId: movement.personId,
  }));
  // The latest day among them, not the newest row's: every row the workbook
  // holds counts, whatever its date says.
  const asOf = reading.movements.reduce(
    (latest, movement) => (movement.date > latest ? movement.date : latest),
    "0000-01-01",
  );
  const mortgage = mortgageAsOf(rows, people, asOf);
  return {
    asOf,
    mortgage: { ...mortgage, balanceCents: mortgage.balanceCents + reading.opening.mortgage },
    bufferBalanceCents:
      bufferAsOf(rows, people, asOf).balanceCents + reading.opening["current-expenses"],
  };
}

// --- The corrections file ---

function refuse(message: string): never {
  throw new AppError("BAD_REQUEST", `The corrections file: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The owner's corrections file, already parsed from JSON:
 *
 * ```json
 * {
 *   "people": { "Alex B.": "alex" },
 *   "corrections": [
 *     { "sheet": "2024", "row": 14, "bucket": "current-expenses", "note": "Filed under the mortgage by mistake." }
 *   ],
 *   "ratios": [
 *     { "sheet": "$ (Avril-Août)", "shares": { "Alex": 55, "Sam": 45 } }
 *   ]
 * }
 * ```
 *
 * `person` may also be given: a workbook name or a person id, or `null` for
 * joint. Every correction needs a note, because each lands on its row, and so
 * it names a row the import adds, never one a paste already holds. A ratio is
 * the one a closed period was settled at, as percentages summing to 100; a
 * period given none is settled at Accueil's.
 */
export function readCorrections(json: unknown): Corrections {
  if (!isRecord(json)) refuse("it is not a JSON object.");
  for (const key of Object.keys(json)) {
    if (key !== "people" && key !== "corrections" && key !== "ratios") {
      refuse(`"${key}" is not a field it has.`);
    }
  }
  const people = new Map<string, string>();
  const names = json["people"] ?? {};
  if (!isRecord(names)) refuse(`"people" is not an object of name to person.`);
  for (const [name, id] of Object.entries(names)) {
    if (typeof id !== "string" || id.trim() === "") refuse(`"people" maps "${name}" to no person.`);
    people.set(name, id.trim());
  }
  const list = json["corrections"] ?? [];
  if (!Array.isArray(list)) refuse(`"corrections" is not a list.`);
  const corrections = list.map((entry: unknown, index): Correction => {
    const where = `correction ${String(index + 1)}`;
    if (!isRecord(entry)) refuse(`${where} is not an object.`);
    for (const key of Object.keys(entry)) {
      if (!["sheet", "row", "bucket", "person", "note"].includes(key)) {
        refuse(`${where} has "${key}", which is not a field a correction has.`);
      }
    }
    const { sheet, row, bucket, person, note } = entry;
    if (typeof sheet !== "string" || sheet === "") refuse(`${where} names no sheet.`);
    if (typeof row !== "number" || !Number.isInteger(row) || row < 1) {
      refuse(`${where} names no row (the spreadsheet's own number, from 1).`);
    }
    if (bucket !== undefined && bucket !== "mortgage" && bucket !== "current-expenses") {
      refuse(`${where}'s bucket is "mortgage" or "current-expenses".`);
    }
    if (
      person !== undefined &&
      person !== null &&
      (typeof person !== "string" || person.trim() === "")
    ) {
      refuse(`${where}'s person is a name, or null for joint.`);
    }
    if (bucket === undefined && person === undefined)
      refuse(`${where} changes neither bucket nor person.`);
    if (typeof note !== "string" || note.trim() === "") {
      refuse(`${where} has no note; each correction lands with one on its row.`);
    }
    return {
      sheet,
      row,
      ...(bucket === undefined ? {} : { bucket }),
      ...(person === undefined ? {} : { person: person === null ? null : person.trim() }),
      note: note.trim(),
    };
  });
  return { people, corrections, ratios: readRatios(json["ratios"]) };
}

/**
 * `"ratios": [{ "sheet": "$ (Avril-Août)", "shares": { "Alex": 55, "Sam": 45 } }]`:
 * each share a percentage, the two summing to 100, to the part per million.
 */
function readRatios(raw: unknown): PeriodRatio[] {
  const list = raw ?? [];
  if (!Array.isArray(list)) refuse(`"ratios" is not a list.`);
  const seen = new Set<string>();
  return list.map((entry: unknown, index): PeriodRatio => {
    const where = `ratio ${String(index + 1)}`;
    if (!isRecord(entry)) refuse(`${where} is not an object.`);
    for (const key of Object.keys(entry)) {
      if (key !== "sheet" && key !== "shares") {
        refuse(`${where} has "${key}", which is not a field a ratio has.`);
      }
    }
    const { sheet, shares } = entry;
    if (typeof sheet !== "string" || sheet.trim() === "") refuse(`${where} names no period sheet.`);
    if (seen.has(sheet)) refuse(`${where} gives "${sheet}" a second ratio; a period has one.`);
    seen.add(sheet);
    if (!isRecord(shares) || Object.keys(shares).length !== 2) {
      refuse(`${where}'s shares name two people, each with a percentage.`);
    }
    const parts = new Map<string, number>();
    for (const [name, percent] of Object.entries(shares)) {
      if (
        typeof percent !== "number" ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        refuse(
          `${where} gives "${name}" ${String(percent)}, which is not a percentage from 0 to 100.`,
        );
      }
      const ppm = percent * (PARTS_PER_MILLION / 100);
      if (Math.abs(ppm - Math.round(ppm)) > 1e-6) {
        refuse(
          `${where} gives "${name}" ${String(percent)} %, finer than a part per million (four decimals).`,
        );
      }
      parts.set(name, Math.round(ppm));
    }
    const total = [...parts.values()].reduce((sum, value) => sum + value, 0);
    if (total !== PARTS_PER_MILLION)
      refuse(`${where}'s shares add up to ${String(total / 10_000)} %, not 100 %.`);
    return { sheet, shares: parts };
  });
}
