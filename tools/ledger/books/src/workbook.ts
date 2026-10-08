/**
 * Reading the household's old workbook (lg-7), from plain cell grids.
 *
 * The `.xlsx` file is opened in `api`, which hands this file each sheet as a
 * grid of cached values — never a formula evaluated here — with the formula
 * text kept beside any cell that had one, because a period's formula version is
 * told apart by it (`docs/00-ANALYSIS.md` §5, §8). Everything below is pure:
 * it reads, repairs, verifies and reports, and it writes nothing.
 *
 * **The layout is §8's.** Where §8 says nothing, the reading below is this
 * ticket's, and it refuses what it does not recognise rather than guessing:
 *
 * - **Year sheets** (`2022` … `2026`), newest first: `B` date, `C` bucket, `D`
 *   detail, `E` person, `F` the account's running balance, `G` amount, `H`
 *   note. A row whose `B` is a date is a movement; a row with `Solde reporté`
 *   in it is a carry-over, one per bucket, and is verified, never imported.
 *   Anything else (a header, a blank) is not a row of the account.
 * - **Period sheets** (`$ (…)`): row 1 names the two people, each over the
 *   column that holds their amounts; row 6 holds the start and, once closed,
 *   the end; rows 8 onward are the lines, with the item to the left of the
 *   amount columns and the note just right of them, down to a `Total` row or
 *   the `Montant à déposer` row. In that row, the column holding a positive
 *   amount is who deposits it, and its formula tells `v1` (a division by the
 *   ratio) from `v2` (a product, no division). A sheet with no end is open.
 * - **`Accueil`**: a row naming a person, with a number to its right, is that
 *   person's salary.
 *
 * **Every problem is collected, not thrown.** A workbook with three typos
 * reports three, so the owner fixes them in one pass; `api` refuses to write
 * while any is left.
 */

import type { Bucket, SettlementFormula } from "@ledger/contract";
import { AppError } from "@ledger/contract";
import { bufferAsOf, mortgageAsOf } from "./buckets.ts";
import type { FiledRow, MortgagePosition } from "./buckets.ts";
import { daysInMonth, fold } from "./months.ts";
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
  /** The workbook's own note, `H`. */
  note: string | null;
  /** How the workbook filed it, when a correction files it otherwise. */
  workbook: { bucket: Bucket; personId: string | null } | null;
  /** The owner's note on the correction, when there is one. */
  correction: string | null;
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

export interface WorkbookReading {
  /** Every movement, oldest first, each filed as it will be stored. */
  movements: Movement[];
  carryOvers: CarryOver[];
  /** What the first year carried in from before the workbook, per bucket. */
  opening: Record<Bucket, number>;
  repairs: Repair[];
  skipped: Skip[];
  /** Closed periods, oldest first. */
  periods: WorkbookPeriod[];
  open: WorkbookPeriod | null;
  salaries: { personId: string; amountCents: number }[];
  /** Sheets read as none of the above, and so not imported. */
  ignored: string[];
  /** Each verification that held, in a sentence. */
  checks: string[];
  /** Each one that did not, or anything unreadable, naming its cell. Nothing is written while any is left. */
  problems: string[];
}

// --- Cells ---

const COLUMN = { B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8 } as const;

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

function cellAt(sheet: Sheet, row: number, column: number): Cell | null {
  return sheet.rows[row - 1]?.[column - 1] ?? null;
}

function textOf(cell: Cell | null): string | null {
  if (cell?.value?.kind !== "text") return null;
  const text = cell.value.text.trim();
  return text === "" ? null : text;
}

function numberOf(cell: Cell | null): number | null {
  return cell?.value?.kind === "number" ? cell.value.number : null;
}

function dateOf(cell: Cell | null): string | null {
  return cell?.value?.kind === "date" ? cell.value.date : null;
}

/** Lower case, accents, dots and repeated spaces folded away: `Dép. Courantes` is `dep courantes`. */
function folded(text: string): string {
  return fold(text).toLowerCase().replace(/[.]/gu, " ").replace(/\s+/gu, " ").trim();
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
 * folded. Anything else is a problem the owner settles in the map.
 */
class People {
  readonly #ids: ReadonlyMap<string, string>;
  readonly #names: ReadonlyMap<string, string>;
  readonly problems: string[] = [];
  readonly #reported = new Set<string>();

  constructor(people: readonly string[], names: ReadonlyMap<string, string>) {
    this.#ids = new Map(people.map((id) => [folded(id), id]));
    const mapped = new Map<string, string>();
    for (const [name, id] of names) {
      if (!people.includes(id)) {
        this.problems.push(
          `The corrections file maps "${name}" to "${id}", who is not one of the household (${people.join(", ") || "nobody is configured"}).`,
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
    const id = this.#names.get(key) ?? this.#ids.get(key);
    if (id === undefined && !this.#reported.has(key)) {
      this.#reported.add(key);
      this.problems.push(
        `${where} names "${name}", who is not one of the household (${[...this.#ids.values()].join(", ") || "nobody is configured"}). Map the name to a person in the corrections file's "people".`,
      );
    }
    return id;
  }

  /** Like `resolve`, without reporting: for cells that may hold a name or anything else. */
  peek(name: string): string | undefined {
    const key = folded(name);
    return this.#names.get(key) ?? this.#ids.get(key);
  }
}

// --- Year sheets ---

const BUCKET_NAMES: ReadonlyMap<string, Bucket> = new Map([
  ["hypotheque", "mortgage"],
  ["dep courantes", "current-expenses"],
  ["depenses courantes", "current-expenses"],
]);

function bucketOf(text: string | null): Bucket | undefined {
  return text === null ? undefined : BUCKET_NAMES.get(folded(text));
}

function isCarryOver(sheet: Sheet, row: number): boolean {
  for (let column = COLUMN.B; column <= COLUMN.H; column++) {
    const text = textOf(cellAt(sheet, row, column));
    if (text !== null && folded(text).includes("solde reporte")) return true;
  }
  return false;
}

/** `date` with its year replaced by `year`, or `null` when that day does not exist (29 February). */
function inYear(date: string, year: number): string | null {
  const [, month, day] = date.split("-").map(Number);
  if (month === undefined || day === undefined || day > daysInMonth(year, month)) return null;
  return `${String(year)}${date.slice(4)}`;
}

interface YearRead {
  year: number;
  /** Oldest first. */
  movements: Movement[];
  carryOvers: CarryOver[];
}

function readYear(
  sheet: Sheet,
  year: number,
  people: People,
  out: Pick<WorkbookReading, "repairs" | "skipped" | "problems">,
): YearRead {
  const movements: Movement[] = [];
  const carryOvers: CarryOver[] = [];
  for (let row = 1; row <= sheet.rows.length; row++) {
    const at = (column: number): string => cellRef(sheet.name, row, column);
    const bucketText = textOf(cellAt(sheet, row, COLUMN.C));
    const amount = numberOf(cellAt(sheet, row, COLUMN.G));

    if (isCarryOver(sheet, row)) {
      const bucket = bucketOf(bucketText);
      if (bucket === undefined) {
        out.problems.push(`${at(COLUMN.C)}: a carry-over names no bucket the books know.`);
      } else if (amount === null) {
        out.problems.push(`${at(COLUMN.G)}: a carry-over has no amount.`);
      } else {
        carryOvers.push({ sheet: sheet.name, row, year, bucket, amountCents: toCents(amount) });
      }
      continue;
    }

    const written = dateOf(cellAt(sheet, row, COLUMN.B));
    if (written === null) {
      // A header, a title or a blank. An amount with no date would be money
      // nobody can place, which is never skipped quietly.
      if (amount !== null && amount !== 0) {
        out.problems.push(`${at(COLUMN.B)}: an amount with no date.`);
      }
      continue;
    }
    // A placeholder's amount is empty. One that holds text, or a formula Excel
    // never saved a value for, is an amount the books cannot read, and on the
    // newest rows nothing after it would show the money missing.
    const amountCell = cellAt(sheet, row, COLUMN.G);
    if (amount === null && amountCell !== null) {
      out.problems.push(
        amountCell.value === null
          ? `${at(COLUMN.G)}: the amount is a formula with no saved value; open the workbook in Excel and save it.`
          : `${at(COLUMN.G)}: the amount is not a number.`,
      );
      continue;
    }
    if (amount === null || toCents(amount) === 0) {
      out.skipped.push({ sheet: sheet.name, row });
      continue;
    }
    if (!wholeCents(amount)) {
      out.problems.push(`${at(COLUMN.G)}: ${String(amount)} is not a whole number of cents.`);
      continue;
    }

    let date = written;
    if (Number(written.slice(0, 4)) !== year) {
      const repaired = inYear(written, year);
      if (repaired === null) {
        out.problems.push(
          `${at(COLUMN.B)}: ${written} is not in ${String(year)}, and that day does not exist in ${String(year)}.`,
        );
        continue;
      }
      out.repairs.push({ sheet: sheet.name, row, from: written, to: repaired });
      date = repaired;
    }

    const bucket = bucketOf(bucketText);
    if (bucket === undefined) {
      out.problems.push(
        `${at(COLUMN.C)}: "${bucketText ?? ""}" is not a bucket (Hypothèque or Dép. Courantes).`,
      );
      continue;
    }
    const balance = numberOf(cellAt(sheet, row, COLUMN.F));
    if (balance === null) {
      out.problems.push(`${at(COLUMN.F)}: a movement has no running balance.`);
      continue;
    }
    if (!wholeCents(balance)) {
      out.problems.push(`${at(COLUMN.F)}: ${String(balance)} is not a whole number of cents.`);
      continue;
    }
    const name = textOf(cellAt(sheet, row, COLUMN.E));
    let personId: string | null = null;
    if (name !== null) {
      const found = people.resolve(name, at(COLUMN.E));
      if (found === undefined) continue;
      personId = found;
    }
    movements.push({
      sheet: sheet.name,
      row,
      date,
      bucket,
      personId,
      amountCents: toCents(amount),
      balanceCents: toCents(balance),
      detail: textOf(cellAt(sheet, row, COLUMN.D)) ?? "",
      note: textOf(cellAt(sheet, row, COLUMN.H)),
      workbook: null,
      correction: null,
    });
  }
  // The sheet lists the newest first; the books keep the oldest first.
  const oldestFirst = movements.toReversed();
  // The row order is what proves a repaired year, so it is checked: newest
  // first, no row is older than the one below it. A row the order contradicts
  // would count on the wrong day in every figure read as of a date.
  const repaired = new Map(
    out.repairs
      .filter((repair) => repair.sheet === sheet.name)
      .map((repair) => [repair.row, repair.from]),
  );
  for (const [index, movement] of oldestFirst.entries()) {
    const below = oldestFirst[index - 1];
    if (below === undefined || movement.date >= below.date) continue;
    const typed = repaired.get(movement.row) ?? repaired.get(below.row);
    out.problems.push(
      `${cellRef(sheet.name, movement.row, COLUMN.B)}: dated ${movement.date}, but the row below it, row ${String(below.row)}, is dated ${below.date}; newest first, no row is older than the one below it${typed === undefined ? "" : ` (a year was repaired here, from ${typed})`}.`,
    );
  }
  return { year, movements: oldestFirst, carryOvers };
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
 */
function verifyYears(years: readonly YearRead[], out: WorkbookReading): void {
  let previous: { year: number; closing: Record<Bucket, number> } | null = null;
  let balance: number | null = null;
  let chained = 0;
  let breaks = 0;
  for (const year of years) {
    const carried: Record<Bucket, number> = { mortgage: 0, "current-expenses": 0 };
    for (const bucket of BUCKETS_IN_ORDER) {
      const found = year.carryOvers.filter((carry) => carry.bucket === bucket);
      const [carry] = found;
      if (found.length > 1) {
        out.problems.push(
          `${String(year.year)}: ${String(found.length)} carry-overs for the ${bucket} bucket; a year has one.`,
        );
      }
      carried[bucket] = carry?.amountCents ?? 0;
      if (previous === null) continue;
      const closing = previous.closing[bucket];
      if (carry === undefined) {
        out.problems.push(
          `${String(year.year)}: no carry-over for the ${bucket} bucket, which closed ${String(previous.year)} at ${formatCentsPlain(closing)}.`,
        );
      } else if (carry.amountCents !== closing) {
        out.problems.push(
          `${cellRef(carry.sheet, carry.row, COLUMN.G)}: carries ${formatCentsPlain(carry.amountCents)} into the ${bucket} bucket, but ${String(previous.year)} closed it at ${formatCentsPlain(closing)} (${formatCentsPlain(carry.amountCents - closing)} unexplained).`,
        );
      } else {
        out.checks.push(
          `${String(year.year)} carries ${formatCentsPlain(closing)} into the ${bucket} bucket, as ${String(previous.year)} closed it.`,
        );
      }
    }
    if (previous === null) out.opening = { ...carried };
    if (balance === null) balance = carried.mortgage + carried["current-expenses"];

    for (const movement of year.movements) {
      const expected: number = balance + movement.amountCents;
      chained += 1;
      if (movement.balanceCents !== expected) {
        breaks += 1;
        out.problems.push(
          `${cellRef(movement.sheet, movement.row, COLUMN.F)}: the running balance is ${formatCentsPlain(movement.balanceCents)}, but the row before it left ${formatCentsPlain(balance)} and this one moves ${formatCentsPlain(movement.amountCents)} (${formatCentsPlain(movement.balanceCents - expected)} unexplained).`,
        );
      }
      // From the row's own balance on, so one break is reported once.
      balance = movement.balanceCents;
    }

    const closing = { ...carried };
    for (const movement of year.movements) closing[movement.bucket] += movement.amountCents;
    previous = { year: year.year, closing };
  }
  if (chained > 0 && breaks === 0) {
    out.checks.push(
      `The running balance follows from row to row through all ${String(chained)} movements, from the ${formatCentsPlain(out.opening.mortgage + out.opening["current-expenses"])} the first year carried in.`,
    );
  }
}

// --- Corrections ---

function applyCorrections(
  movements: readonly Movement[],
  corrections: readonly Correction[],
  people: People,
  sheets: ReadonlySet<string>,
  out: WorkbookReading,
): Movement[] {
  const byPlace = new Map(
    movements.map((movement) => [`${movement.sheet}!${String(movement.row)}`, movement]),
  );
  const corrected = new Map<string, Movement>();
  for (const correction of corrections) {
    const place = `${correction.sheet}!${String(correction.row)}`;
    const where = `The correction for ${cellRef(correction.sheet, correction.row, COLUMN.B)}`;
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

function readSettlement(
  sheet: Sheet,
  row: number,
  columns: readonly { column: number; personId: string }[],
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
      `${cellRef(sheet.name, row, columns[0]?.column ?? 1)}: the Montant à déposer asks both people for money; it asks one.`,
    );
    return null;
  }
  const [asking] = chosen;
  const formulaText =
    asking?.formula ?? asked.find((entry) => entry.formula !== null)?.formula ?? null;
  const at = cellRef(sheet.name, row, asking?.column ?? columns[0]?.column ?? 1);
  if (formulaText === null) {
    out.problems.push(
      `${at}: the Montant à déposer has no formula, so its version cannot be told.`,
    );
    return null;
  }
  let formula: "v1" | "v2";
  if (formulaText.includes("/")) formula = "v1";
  else if (formulaText.includes("*")) formula = "v2";
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

function readPeriod(sheet: Sheet, people: People, out: WorkbookReading): WorkbookPeriod | null {
  const columns: { column: number; personId: string }[] = [];
  for (const [index, cell] of (sheet.rows[0] ?? []).entries()) {
    const text = textOf(cell);
    const personId = text === null ? undefined : people.peek(text);
    if (personId !== undefined && !columns.some((entry) => entry.personId === personId)) {
      columns.push({ column: index + 1, personId });
    }
  }
  if (columns.length !== 2) {
    out.problems.push(
      `${cellRef(sheet.name, 1, 1)}: row 1 names ${String(columns.length)} of the household (${rowTexts(sheet, 1).join(", ") || "nothing"}); a period sheet names two. Map a name in the corrections file's "people".`,
    );
    return null;
  }
  const first = Math.min(...columns.map((entry) => entry.column));
  const last = Math.max(...columns.map((entry) => entry.column));

  const dates = (sheet.rows[5] ?? []).flatMap((cell) => {
    const date = dateOf(cell);
    return date === null ? [] : [date];
  });
  const [start, end] = dates;
  if (start === undefined) {
    out.problems.push(`${cellRef(sheet.name, 6, 1)}: row 6 holds no start date.`);
    return null;
  }
  if (end !== undefined && end < start) {
    out.problems.push(
      `${cellRef(sheet.name, 6, 1)}: the period ends (${end}) before it starts (${start}).`,
    );
    return null;
  }

  const lines: WorkbookLine[] = [];
  const totals = new Map<string, number>();
  let settlement: WorkbookSettlement | null = null;
  let ended = false;
  for (let row = 8; row <= sheet.rows.length; row++) {
    const texts = rowTexts(sheet, row).map(folded);
    if (texts.some((text) => text.startsWith("montant a deposer"))) {
      settlement = readSettlement(sheet, row, columns, out);
      ended = true;
      continue;
    }
    const labels: string[] = [];
    for (let column = 1; column < first; column++) {
      const text = textOf(cellAt(sheet, row, column));
      if (text !== null) labels.push(text);
    }
    const label = labels.join(" ");
    if (folded(label).startsWith("total")) {
      for (const { column, personId } of columns) {
        const total = numberOf(cellAt(sheet, row, column));
        if (total !== null) totals.set(personId, toCents(total));
      }
      ended = true;
      continue;
    }
    if (ended) continue;
    const note = textOf(cellAt(sheet, row, last + 1));
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
        `${cellRef(sheet.name, 8, column)}: ${personId}'s lines add up to ${formatCentsPlain(sum)}, but the sheet's total says ${formatCentsPlain(total)}.`,
      );
    }
  }
  return { sheet: sheet.name, start, end: end ?? null, lines, settlement, ratio: null };
}

function orderPeriods(read: readonly WorkbookPeriod[], out: WorkbookReading): void {
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
  }
  for (const [index, period] of closed.entries()) {
    if (period.settlement === null) {
      out.problems.push(`${period.sheet} is closed, but no Montant à déposer was read from it.`);
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

// --- Accueil ---

function readSalaries(sheet: Sheet, people: People, out: WorkbookReading): void {
  const found = new Map<string, number>();
  for (const [index, cells] of sheet.rows.entries()) {
    for (const [column, cell] of cells.entries()) {
      const text = textOf(cell);
      const personId = text === null ? undefined : people.peek(text);
      if (personId === undefined) continue;
      const salary = cells
        .slice(column + 1)
        .map(numberOf)
        .find((value) => value !== null);
      if (salary === undefined || salary === null) continue;
      if (found.has(personId)) {
        out.problems.push(
          `${cellRef(sheet.name, index + 1, column + 1)}: a second salary for ${personId}.`,
        );
      }
      found.set(personId, toCents(salary));
      break;
    }
  }
  if (found.size !== 2) {
    out.problems.push(
      `${sheet.name}: ${String(found.size)} salaries were found; the ratio needs one for each of two people.`,
    );
  }
  out.salaries = [...found].map(([personId, amountCents]) => ({ personId, amountCents }));
}

// --- The whole workbook ---

export interface ReadOptions {
  /** Every person id the books may name. */
  people: readonly string[];
  corrections?: Corrections;
}

const YEAR_SHEET = /^\d{4}$/u;

export function readWorkbook(sheets: readonly Sheet[], options: ReadOptions): WorkbookReading {
  const corrections = options.corrections ?? NO_CORRECTIONS;
  const people = new People(options.people, corrections.people);
  const out: WorkbookReading = {
    movements: [],
    carryOvers: [],
    opening: { mortgage: 0, "current-expenses": 0 },
    repairs: [],
    skipped: [],
    periods: [],
    open: null,
    salaries: [],
    ignored: [],
    checks: [],
    problems: [],
  };

  const years: YearRead[] = [];
  const periods: WorkbookPeriod[] = [];
  let accueil: Sheet | undefined;
  for (const sheet of sheets) {
    const name = sheet.name.trim();
    if (YEAR_SHEET.test(name)) years.push(readYear(sheet, Number(name), people, out));
    else if (name.startsWith("$")) {
      const period = readPeriod(sheet, people, out);
      if (period !== null) periods.push(period);
    } else if (folded(name) === "accueil") accueil = sheet;
    else out.ignored.push(sheet.name);
  }

  years.sort((a, b) => a.year - b.year);
  if (years.length === 0) out.problems.push("The workbook has no year sheet (2022, 2023, …).");
  for (const [index, year] of years.entries()) {
    const before = years[index - 1];
    if (before !== undefined && year.year !== before.year + 1) {
      out.problems.push(
        `The workbook has ${String(before.year)} and ${String(year.year)}, and nothing between them.`,
      );
    }
  }
  verifyYears(years, out);
  out.carryOvers = years.flatMap((year) => year.carryOvers);

  const movements = years.flatMap((year) => year.movements);
  out.movements = applyCorrections(
    movements,
    corrections.corrections,
    people,
    new Set(sheets.map((sheet) => sheet.name)),
    out,
  );

  orderPeriods(periods, out);
  if (accueil === undefined)
    out.problems.push("The workbook has no Accueil sheet, so no salaries.");
  else readSalaries(accueil, people, out);
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
 *   ]
 * }
 * ```
 *
 * `person` may also be given: a workbook name or a person id, or `null` for
 * joint. Every entry needs a note, because each lands on its row.
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
