/**
 * Importing the household's old workbook into the books, once (lg-7).
 *
 * `@ledger/books` reads the workbook and verifies it against itself (its
 * carry-overs, its running balance, its period totals). This file does what
 * needs the database: it places the workbook's rows against the statement rows
 * already stored, writes the history, and then **reads the books back** — the
 * mortgage, the buffer and the open period, through the same code the API
 * answers with — and sets those figures beside the workbook's own.
 *
 * **One transaction, and nothing kept unless everything holds.** The schema's
 * migrations and every write happen inside it, the report is built from what
 * the writes produced, and only then is it committed — and only with `commit`
 * and no problem left. A dry run, and any import that fails a verification, is
 * rolled back, so the report a dry run prints is exactly what `--write` would
 * store.
 *
 * **Placing the rows.** A statement row has no identity of its own (lg-2), so
 * the workbook is matched to the stored rows by **position**: its newest rows
 * must be the oldest stored ones, day by day — each run of its rows on one date
 * holding the same amounts as the stored rows in their places and ending on the
 * same balance, in any order within the day (`workbook-days.ts`, lg-40) — or its
 * newest row must leave the balance the oldest stored row opened from.
 * The rows before that are added, numbered below the oldest stored position;
 * the rows the pastes already hold are checked, never added again. The
 * workbook's description of a row is its own vocabulary, not the bank's, so the
 * two are not compared, and a date that differs is reported, not refused (the
 * analysis found one a day off). More than one placement is refused, as a paste
 * is, and so is a workbook that runs past the newest stored row: those rows
 * belong to a paste.
 */

import {
  bufferAsOf,
  dayAfter,
  formatCents,
  mortgageAsOf,
  noteOf,
  ratioFromSalaries,
  readWorkbook,
  workbookFigures,
} from "@ledger/books";
import type {
  Corrections,
  FiledRow,
  Movement,
  Share,
  Sheet,
  WorkbookFigures,
  WorkbookReading,
} from "@ledger/books";
import type { Bucket, OwnMoney, SettlementFigures, WorkbookLayout } from "@ledger/contract";
import { applyMigrations } from "./db/schema.ts";
import type { Database } from "better-sqlite3";
import { classifyRow } from "./classifications.ts";
import { shownName } from "./directory.ts";
import { enrollPeople, knownPeople } from "./people.ts";
import { openPeriod } from "./periods.ts";
import type { RuleContext } from "./rules.ts";
import { confirmRatio, enterSalaries } from "./salaries.ts";
import { alignDays } from "./workbook-days.ts";
import type { DayEntry } from "./workbook-days.ts";

export interface WorkbookImportOptions {
  /** Whoever runs the import: the name in the directory everything it writes is recorded under. */
  personId: string;
  /** The household's current members' names (lg-20), enrolled as a boot would enrol them. */
  members: readonly string[];
  /**
   * How the directory shows each person, by id (lg-76), so a workbook's names
   * reach a person whose id is generated. None by default.
   */
  names?: ReadonlyMap<string, string>;
  corrections: Corrections;
  /** Whether this is meant as the import itself, which only changes what the report says. */
  write: boolean;
  /** Whether to keep it, once every verification holds. Without it, all is rolled back. */
  commit: boolean;
  now: () => Date;
  /**
   * How the workbook is laid out: the household's own (`HOUSEHOLD_LAYOUT`)
   * when absent, which is what `import:ledger` reads; a described one from the
   * import screen (lg-66).
   */
  layout?: WorkbookLayout | undefined;
  /** Who reads the report: the command's terminal (the default) or the import screen (lg-66). */
  via?: "command" | "screen" | undefined;
  /**
   * Run once every verification has held and the writes are made, just before
   * the books commit, and only with `commit` (lg-78: the import screen adds its
   * new people to the directory here). If it throws, nothing is committed.
   */
  beforeCommit?: (() => void) | undefined;
}

export interface WorkbookImportResult {
  /** Whether every verification held. */
  ok: boolean;
  /** Whether the import was committed. */
  written: boolean;
  /** What to print, before anything is kept. */
  report: string;
  /** Each verification that failed, as the report lists it (lg-66). */
  problems: string[];
  /** What the workbook read as, through the layout (lg-66). */
  reading: WorkbookReading;
}

interface StoredColumns {
  id: number;
  seq: number;
  date: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
  bucket: Bucket | null;
  person_id: string | null;
}

/** Where the workbook's rows go against what is stored. */
interface Placement {
  /** The rows to add, oldest first. */
  added: Movement[];
  /** The position the first added row takes. */
  firstSeq: number;
  /** The workbook's rows the pastes already hold, each with the stored row in its place. */
  overlap: { movement: Movement; stored: StoredColumns }[];
  /** The position of the workbook's newest row once placed: what the figures are read through. */
  lastSeq: number;
}

function storedRows(db: Database): StoredColumns[] {
  return db
    .prepare(
      `SELECT r.id, r.seq, r.date, r.description, r.amount_cents, r.balance_cents, c.bucket, c.person_id
       FROM statement_rows r
       LEFT JOIN current_classifications c ON c.row_id = r.id
       ORDER BY r.seq`,
    )
    .all() as StoredColumns[];
}

function entryOf(row: StoredColumns): DayEntry {
  return { date: row.date, amountCents: row.amount_cents, balanceCents: row.balance_cents };
}

/**
 * The workbook's rows against the stored ones in their places, day by day
 * (`workbook-days.ts`): for each movement, the index in `stored` of its row, or
 * `null` when they are not the same movements. Every date is allowed, since a
 * differing one is reported rather than refused.
 */
function align(movements: readonly Movement[], stored: readonly StoredColumns[]): number[] | null {
  return alignDays(movements, stored.map(entryOf), "any");
}

function describeStored(row: StoredColumns): string {
  return `${row.date} "${row.description}" ${formatCents(row.amount_cents)} (balance ${formatCents(row.balance_cents)})`;
}

function describeMovement(movement: Movement): string {
  return `${movement.sheet} row ${String(movement.row)}, ${movement.date} "${movement.detail}" ${formatCents(movement.amountCents)} (balance ${formatCents(movement.balanceCents)})`;
}

/** Every way the workbook can sit against the stored rows, as how many of its rows come before them. */
function readings(movements: readonly Movement[], stored: readonly StoredColumns[]): number[] {
  const head = stored[0];
  if (head === undefined) return [movements.length];
  const found: number[] = [];
  for (let before = 0; before < movements.length; before++) {
    const shared = Math.min(movements.length - before, stored.length);
    if (align(movements.slice(before, before + shared), stored.slice(0, shared)) !== null) {
      found.push(before);
    }
  }
  const newest = movements.at(-1);
  if (
    newest !== undefined &&
    newest.balanceCents === head.balance_cents - head.amount_cents &&
    newest.date <= head.date
  ) {
    found.push(movements.length);
  }
  return found;
}

function place(
  movements: readonly Movement[],
  stored: readonly StoredColumns[],
  problems: string[],
): Placement | null {
  const head = stored[0];
  if (head === undefined) {
    return {
      added: [...movements],
      firstSeq: 0,
      overlap: [],
      lastSeq: movements.length - 1,
    };
  }
  const found = readings(movements, stored);
  const newest = movements.at(-1);
  // Every consistent reading counts, the ones that would leave workbook rows
  // after the newest stored row included: refusing those alone and taking the
  // one left would be choosing between two readings by a rule, not by the data.
  if (found.length > 1) {
    problems.push(
      `The workbook can be placed against the stored rows ${String(found.length)} ways (with ${found.map((before) => String(movements.length - before)).join(" or ")} of its rows already stored), because the same amounts and balances come round again. The books cannot tell which is meant.`,
    );
    return null;
  }
  const [before] = found;
  if (before === undefined) {
    if (newest !== undefined && newest.date < head.date) {
      const opening = head.balance_cents - head.amount_cents;
      problems.push(
        `The workbook's newest row, ${describeMovement(newest)}, leaves ${formatCents(newest.balanceCents)}, but the oldest stored row, ${describeStored(head)}, opens from ${formatCents(opening)}: ${formatCents(opening - newest.balanceCents)} is unexplained between them.`,
      );
      return null;
    }
    // The likeliest place, said precisely when there is one: the workbook's
    // row on the stored row's day with its amount, whose balance disagrees.
    const near = movements.find(
      (movement) =>
        movement.date === head.date &&
        movement.amountCents === head.amount_cents &&
        movement.balanceCents !== head.balance_cents,
    );
    problems.push(
      near === undefined
        ? `The workbook's rows do not line up with the stored ones: no run of them matches the stored rows from the oldest, ${describeStored(head)}, day by day by amount and balance, so a row is in one and not the other.`
        : `${describeMovement(near)} moves the same day and amount as the oldest stored row, but leaves ${formatCents(near.balanceCents)} where it leaves ${formatCents(head.balance_cents)}: ${formatCents(head.balance_cents - near.balanceCents)} is unexplained.`,
    );
    return null;
  }
  if (movements.length - before > stored.length) {
    problems.push(
      `The workbook runs ${String(movements.length - before - stored.length)} rows past the newest stored row, ${describeStored(stored.at(-1) as StoredColumns)}. Those rows belong to a paste: paste the statement through ${newest?.date ?? ""} first, so the import adds only what is older.`,
    );
    return null;
  }
  // Within a day the two may list the rows in different orders, so each
  // movement is paired with its own stored row, not the one in its position.
  const alreadyStored = movements.slice(before);
  const pairing = align(alreadyStored, stored.slice(0, alreadyStored.length)) ?? [];
  const overlap = alreadyStored.map((movement, index) => ({
    movement,
    stored: stored[pairing[index] ?? index] as StoredColumns,
  }));
  // A correction is written as a note on the row it moves, and a stored row
  // is never written again: the row is the app's to file (decided 2026-10-08).
  const held = overlap.filter(({ movement }) => movement.workbook !== null);
  for (const { movement, stored: row } of held) {
    problems.push(
      `The correction for ${movement.sheet} row ${String(movement.row)} names a row a paste already holds, ${describeStored(row)}. File that row in the app, and take it out of the corrections file.`,
    );
  }
  if (held.length > 0) return null;
  return {
    added: movements.slice(0, before),
    firstSeq: head.seq - before,
    overlap,
    // The newest stored row the overlap reaches, by position: the newest
    // movement may be paired with an earlier row of its day.
    lastSeq: stored[overlap.length - 1]?.seq ?? head.seq - 1,
  };
}

function count(db: Database, table: string): number {
  // `table` is one of the five names written in `alreadyHeld`, never input.
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/**
 * What the import is the first record of. Anything already there would have
 * to be reconciled with the workbook's history, which the books cannot do
 * without guessing which one stands.
 */
function alreadyHeld(db: Database, problems: string[]): void {
  const tables = [
    ["periods", "closed periods"],
    ["period_lines", "period lines"],
    ["recurring_items", "recurring items"],
    ["salaries", "salaries"],
    ["ratios", "ratios"],
  ] as const;
  for (const [table, what] of tables) {
    const n = count(db, table);
    if (n > 0) {
      problems.push(
        `The books already hold ${String(n)} ${what}. The workbook's are their first record, so it is imported into books that hold none.`,
      );
    }
  }
}

interface Written {
  rows: number;
  periods: number;
  lines: number;
  /** Each ratio the import confirmed, oldest first. */
  ratios: { from: string; shares: readonly Share[]; accueil: boolean }[];
  openLinesFrom: string | null;
}

/** What tells two ratios apart: each person's parts, in id order. */
function keyOf(shares: readonly Share[]): string {
  return shares.map((share) => `${share.personId}:${String(share.partsPerMillion)}`).join(",");
}

/** A ratio the corrections file gives, which no salary record derives. */
function insertRatio(
  db: Database,
  context: RuleContext,
  from: string,
  shares: readonly Share[],
): number {
  const ratio = db
    .prepare(
      "INSERT INTO ratios (effective_from, supersedes, entered_at, entered_by) VALUES (?, NULL, ?, ?)",
    )
    .run(from, context.now().toISOString(), context.personId);
  const id = Number(ratio.lastInsertRowid);
  const insert = db.prepare(
    "INSERT INTO ratio_shares (ratio_id, person_id, parts_per_million, salary_id) VALUES (?, ?, ?, NULL)",
  );
  for (const share of shares) insert.run(id, share.personId, share.partsPerMillion);
  return id;
}

function writeAll(
  db: Database,
  reading: WorkbookReading,
  placement: Placement,
  context: RuleContext,
): Written {
  const at = context.now().toISOString();
  const written: Written = { rows: 0, periods: 0, lines: 0, ratios: [], openLinesFrom: null };

  if (placement.added.length > 0) {
    const batch = db
      .prepare(
        "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
      )
      .run(at, context.personId);
    const insert = db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id, note)
       VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
    );
    for (const [offset, movement] of placement.added.entries()) {
      const row = insert.run(
        placement.firstSeq + offset,
        movement.date,
        movement.detail,
        movement.amountCents,
        movement.balanceCents,
        batch.lastInsertRowid,
        noteOf(movement),
      );
      const rowId = Number(row.lastInsertRowid);
      // How the workbook filed it, and then the owner's correction, if any,
      // as a later record that supersedes it: what was believed stays.
      const filed = movement.workbook ?? movement;
      classifyRow(context, { rowId, personId: filed.personId, bucket: filed.bucket });
      if (movement.workbook !== null) {
        classifyRow(context, { rowId, personId: movement.personId, bucket: movement.bucket });
      }
      written.rows += 1;
    }
  }

  // The salaries Accueil holds are the only ones the workbook has, so they
  // are dated in the history's first year. Their ratio is in effect wherever
  // the corrections file gives a closed period none of its own (decided
  // 2026-10-08), and after the last close. Each change of ratio takes effect
  // at a period boundary, the day after the close before it, as the books'
  // own ratios do, so the ratio in effect on any day is the one its period
  // was settled at.
  const firstDay = [
    reading.movements[0]?.date,
    ...reading.periods.map((period) => period.start),
    reading.open?.start,
  ]
    .filter((date): date is string => date !== undefined)
    .toSorted()[0];
  const ratioOf = new Map<string, number>();
  if (firstDay !== undefined && reading.salaries.length === 2) {
    const entered = enterSalaries(context, {
      year: Number(firstDay.slice(0, 4)),
      salaries: reading.salaries,
    });
    const salaryIds = entered.salaries.map((salary) => salary.id);
    const accueil = ratioFromSalaries(reading.salaries);
    let current: { key: string; id: number } | null = null;
    const takeEffect = (from: string, shares: Share[] | null): number => {
      const key = keyOf(shares ?? accueil);
      if (current?.key === key) return current.id;
      const id =
        shares === null
          ? confirmRatio(context, { effectiveFrom: from, salaryIds }).id
          : insertRatio(db, context, from, shares);
      written.ratios.push({ from, shares: shares ?? accueil, accueil: shares === null });
      current = { key, id };
      return id;
    };
    let from = firstDay;
    for (const period of reading.periods) {
      ratioOf.set(period.sheet, takeEffect(from, period.ratio));
      from = dayAfter(period.end ?? from);
    }
    takeEffect(from, null);
  }

  const insertLine = db.prepare(
    `INSERT INTO period_lines (person_id, date, amount_cents, category, note, source, entered_at, entered_by)
     VALUES (?, ?, ?, ?, ?, 'workbook', ?, ?)`,
  );
  const insertPeriod = db.prepare(
    `INSERT INTO periods (start_date, end_date, closed_at, closed_by, formula, ratio_id, payer_id, recipient_id, deposit_cents, net_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const period of reading.periods) {
    const { settlement, end } = period;
    const ratioId = ratioOf.get(period.sheet);
    if (settlement === null || end === null || ratioId === undefined) continue;
    // The settlement as it happened. A historical formula had no separate
    // figure for paying directly, so the direct figure is the one it asked.
    insertPeriod.run(
      period.start,
      end,
      at,
      context.personId,
      settlement.formula,
      ratioId,
      settlement.payerId,
      settlement.recipientId,
      settlement.depositCents,
      settlement.depositCents,
    );
    written.periods += 1;
    // A sheet's lines carry no date of their own; dated on its last day, each
    // falls inside its own period even where two sheets overlap.
    for (const line of period.lines) {
      insertLine.run(
        line.personId,
        end,
        line.amountCents,
        line.label || null,
        line.note,
        at,
        context.personId,
      );
      written.lines += 1;
    }
  }
  if (reading.open !== null) {
    // The open period starts the day after the last closed one, whatever the
    // sheet says, so its lines are dated no earlier than that.
    const lastEnd = reading.periods.at(-1)?.end ?? null;
    const opens = lastEnd === null ? reading.open.start : dayAfter(lastEnd);
    const date = reading.open.start > opens ? reading.open.start : opens;
    written.openLinesFrom = date;
    for (const line of reading.open.lines) {
      insertLine.run(
        line.personId,
        date,
        line.amountCents,
        line.label || null,
        line.note,
        at,
        context.personId,
      );
      written.lines += 1;
    }
  }
  return written;
}

interface LedgerFigures {
  own: OwnMoney[];
  mortgageBalanceCents: number;
  bufferBalanceCents: number;
  unclassified: number;
}

/** The two buckets as the stored books now file them, through the workbook's newest row. */
/**
 * The two buckets as the stored books now file them, over the stretch the
 * workbook covers: every row up to the position of its newest, whatever the
 * rows' dates say. A cut by date would leave out a stored row dated a day
 * after the workbook's copy of it, and count in nothing a workbook row whose
 * typed date runs ahead of the rows after it.
 */
function ledgerFigures(db: Database, lastSeq: number, people: readonly string[]): LedgerFigures {
  const rows = (
    db
      .prepare(
        `SELECT r.date, r.amount_cents, c.bucket, c.person_id
         FROM statement_rows r
         JOIN current_classifications c ON c.row_id = r.id
         WHERE r.seq <= ?
         ORDER BY r.seq`,
      )
      .all(lastSeq) as {
      date: string;
      amount_cents: number;
      bucket: Bucket;
      person_id: string | null;
    }[]
  ).map((row): FiledRow => ({
    date: row.date,
    amountCents: row.amount_cents,
    bucket: row.bucket,
    personId: row.person_id,
  }));
  const unclassified = (
    db
      .prepare(
        `SELECT count(*) AS n FROM statement_rows
         WHERE seq <= ? AND NOT EXISTS (SELECT 1 FROM classifications WHERE classifications.row_id = statement_rows.id)`,
      )
      .get(lastSeq) as { n: number }
  ).n;
  const asOf = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), "0000-01-01");
  const mortgage = mortgageAsOf(rows, people, asOf);
  return {
    own: mortgage.own,
    mortgageBalanceCents: mortgage.balanceCents,
    bufferBalanceCents: bufferAsOf(rows, people, asOf).balanceCents,
    unclassified,
  };
}

/** `60.0000 %`: a share in parts per million, to the four decimals it holds. */
function percent(partsPerMillion: number): string {
  return `${(partsPerMillion / 10_000).toFixed(4)} %`;
}

function money(cents: number): string {
  return formatCents(cents);
}

/** A person as the report prints them: by shown name, never a generated id (lg-79). */
type Shown = (person: string) => string;

function gapOf(own: readonly OwnMoney[], shown: Shown): { label: string; cents: number } | null {
  const [first, second] = own;
  if (own.length !== 2 || first === undefined || second === undefined) return null;
  return {
    label: `${shown(first.personId)} − ${shown(second.personId)}`,
    cents: first.ownCents - second.ownCents,
  };
}

/** Each figure the import is held to, the workbook's beside the books', and whether they agree. */
function compare(
  expected: WorkbookFigures,
  ledger: LedgerFigures,
  shown: Shown,
): { lines: string[]; failed: string[] } {
  const rows: [string, number, number][] = [];
  for (const person of expected.mortgage.own) {
    const found = ledger.own.find((entry) => entry.personId === person.personId)?.ownCents ?? 0;
    rows.push([`mortgage: ${shown(person.personId)}'s own money`, person.ownCents, found]);
  }
  const gapExpected = gapOf(expected.mortgage.own, shown);
  const gapLedger = gapOf(ledger.own, shown);
  if (gapExpected !== null) {
    rows.push([`mortgage gap (${gapExpected.label})`, gapExpected.cents, gapLedger?.cents ?? 0]);
  }
  rows.push(["mortgage balance", expected.mortgage.balanceCents, ledger.mortgageBalanceCents]);
  rows.push(["buffer balance", expected.bufferBalanceCents, ledger.bufferBalanceCents]);
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(
    ([label, workbook, books]) =>
      `  ${label.padEnd(width)}  ${money(workbook).padStart(14)}  ${money(books).padStart(14)}${workbook === books ? "" : "   DIFFERS"}`,
  );
  const failed = rows
    .filter(([, workbook, books]) => workbook !== books)
    .map(
      ([label, workbook, books]) =>
        `The books would show ${money(books)} for the ${label}, and the workbook ${money(workbook)}.`,
    );
  return {
    lines: [`  ${"".padEnd(width)}  ${"workbook".padStart(14)}  ${"books".padStart(14)}`, ...lines],
    failed,
  };
}

function describeSettlement(figures: SettlementFigures | null, shown: Shown): string {
  if (figures === null) return "no ratio in effect";
  const { deposits, transfers } = figures;
  if (deposits !== null && deposits.length === 0 && transfers.length === 0) return "nobody owes";
  // Between two people, the line lg-7 printed.
  const [only, more] = transfers;
  const [deposit, another] = deposits ?? [];
  const onePayer = deposit === undefined || only === undefined || deposit.personId === only.fromId;
  if (more === undefined && another === undefined && (deposit ?? only) !== undefined && onePayer) {
    const payer = shown(deposit?.personId ?? only?.fromId ?? "");
    const what =
      deposit === undefined ? "pays directly" : `deposits ${money(deposit.depositCents)}`;
    return `${payer} ${what} (net ${money(only?.cents ?? 0)}), ${figures.formula}`;
  }
  const direct = transfers
    .map(
      (transfer) => `${shown(transfer.fromId)} to ${shown(transfer.toId)} ${money(transfer.cents)}`,
    )
    .join(", ");
  const asked =
    deposits === null
      ? `pays directly: ${direct}`
      : `${deposits.map((each) => `${shown(each.personId)} deposits ${money(each.depositCents)}`).join(", ")} (net ${direct === "" ? "nothing" : direct})`;
  return `${asked}, ${figures.formula}`;
}

export function importWorkbook(
  db: Database,
  sheets: readonly Sheet[],
  options: WorkbookImportOptions,
): WorkbookImportResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    // Inside the transaction, so a refused import leaves the schema as it was.
    applyMigrations(db);
    const { ok, report, problems, reading } = run(db, sheets, options);
    if (options.commit && ok) {
      options.beforeCommit?.();
      db.exec("COMMIT");
      return { ok, written: true, report: `${report}\nWritten.\n`, problems, reading };
    }
    db.exec("ROLLBACK");
    const outcome = ok
      ? `Every verification held. This was a dry run: nothing was written. ${options.via === "screen" ? "Confirm to import." : "Run again with --write to import."}`
      : "Refused: nothing was written.";
    return { ok, written: false, report: `${report}\n${outcome}\n`, problems, reading };
  } catch (error: unknown) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function run(
  db: Database,
  sheets: readonly Sheet[],
  options: WorkbookImportOptions,
): { ok: boolean; report: string; problems: string[]; reading: WorkbookReading } {
  enrollPeople(db, options.members, options.now());
  const people = knownPeople(db);
  const names = options.names ?? new Map<string, string>();
  const shown: Shown = (person) => shownName(names, person);
  const reading = readWorkbook(sheets, {
    people,
    corrections: options.corrections,
    ...(options.names === undefined ? {} : { names: options.names }),
    ...(options.layout === undefined ? {} : { layout: options.layout }),
  });
  const problems = [...reading.problems];
  // None under the household's layout, which names a bucket and a balance
  // column; a row with neither is a statement's, never filed by this import.
  // A described layout can name neither (lg-66), and is refused here.
  if (reading.unfiled.length > 0) {
    problems.push(
      `${String(reading.unfiled.length)} rows have no bucket or no balance, and this import files every row it stores.`,
    );
  }
  if (!people.includes(options.personId)) {
    problems.push(
      `--as names "${options.personId}", who is not one of the household (${people.map(shown).join(", ") || "nobody is in the directory"}).`,
    );
  }
  alreadyHeld(db, problems);

  const stored = storedRows(db);
  const placement = problems.length === 0 ? place(reading.movements, stored, problems) : null;
  const passed: string[] = [];
  if (placement !== null && placement.overlap.length > 0) {
    passed.push(
      `The ${String(placement.overlap.length)} rows the pastes already hold are the workbook's newest, day by day, by amount and balance.`,
    );
  }
  const out: string[] = [];
  const say = (line = ""): void => {
    out.push(line);
  };

  say(options.write ? "Importing the workbook." : "Dry run: nothing will be written.");
  say();
  say("Rows");
  say(`  movements read  ${String(reading.movements.length)}`);
  if (placement !== null) {
    say(`  imported        ${String(placement.added.length)}`);
    say(
      `  already stored  ${String(placement.overlap.length)} (from pastes: checked, not imported)`,
    );
  }
  say(`  repaired        ${String(reading.repairs.length)}`);
  say(`  skipped         ${String(reading.skipped.length)}`);
  const corrected = reading.movements.filter((movement) => movement.workbook !== null);
  say(`  corrected       ${String(corrected.length)}`);
  for (const repair of reading.repairs) {
    say(
      `  repaired: ${repair.sheet} row ${String(repair.row)}, ${repair.from} → ${repair.to} (the sheet's year)`,
    );
  }
  for (const skip of reading.skipped) {
    say(`  skipped: ${skip.sheet} row ${String(skip.row)}, no amount`);
  }
  for (const late of reading.outOfOrder) {
    say(
      `  dated out of order: ${late.sheet} row ${String(late.row)}, ${late.date}, is listed above row ${String(late.belowRow)}, ${late.belowDate}; imported as typed`,
    );
  }
  for (const movement of corrected) {
    const was = movement.workbook;
    if (was === null) continue;
    say(
      `  corrected: ${movement.sheet} row ${String(movement.row)}, ${was.bucket} ${was.personId === null ? "joint" : shown(was.personId)} → ${movement.bucket} ${movement.personId === null ? "joint" : shown(movement.personId)}: ${movement.correction ?? ""}`,
    );
  }
  if (placement !== null) {
    for (const { movement, stored: row } of placement.overlap) {
      if (movement.date !== row.date) {
        say(`  dated differently: ${describeMovement(movement)}; the paste says ${row.date}`);
      }
    }
  }
  say();
  say("Periods");
  for (const period of reading.periods) {
    const settlement = period.settlement;
    const asked =
      settlement === null
        ? "no settlement read"
        : settlement.payerId === null
          ? `${settlement.formula}, nobody owed`
          : `${settlement.formula}, ${shown(settlement.payerId)} deposited ${money(settlement.depositCents)}`;
    const ratio =
      period.ratio === null
        ? ""
        : `, settled at ${period.ratio.map((share) => `${shown(share.personId)} ${percent(share.partsPerMillion)}`).join(", ")}`;
    say(
      `  ${period.sheet}: ${period.start} to ${period.end ?? ""}, ${String(period.lines.length)} lines, ${asked}${ratio}`,
    );
  }
  // The sheet's ask against the account, reported and never refused (lg-37).
  for (const deposit of reading.deposits) {
    say(
      deposit.paid === null
        ? `  not paid in the workbook: ${deposit.sheet} asked ${shown(deposit.payerId)} for ${money(deposit.askedCents)}, and no deposit of that amount by ${shown(deposit.payerId)} is in the year sheets from ${deposit.from}; check it before --write`
        : `  paid: ${deposit.sheet}'s ${money(deposit.askedCents)} by ${shown(deposit.payerId)}, ${deposit.paid.sheet} row ${String(deposit.paid.row)}, ${deposit.paid.date}`,
    );
  }
  if (reading.open !== null) {
    say(
      `  ${reading.open.sheet}: open since ${reading.open.start}, ${String(reading.open.lines.length)} lines`,
    );
  }
  if (reading.salaries.length > 0) {
    say(
      `  salaries (Accueil): ${reading.salaries.map((salary) => `${shown(salary.personId)} ${money(salary.amountCents)}`).join(", ")}`,
    );
  }
  if (reading.ignored.length > 0) say(`  not imported: ${reading.ignored.join(", ")}`);

  const expected = workbookFigures(reading, people);
  if (placement !== null) {
    const context: RuleContext = {
      db,
      personId: options.personId,
      now: options.now,
      people: new Set(people),
    };
    const written = writeAll(db, reading, placement, context);
    for (const ratio of written.ratios) {
      say(
        `  ratio from ${ratio.from}: ${ratio.shares.map((share) => `${shown(share.personId)} ${percent(share.partsPerMillion)}`).join(", ")} (${ratio.accueil ? "Accueil's salaries" : "the corrections file"})`,
      );
    }
    if (
      written.openLinesFrom !== null &&
      reading.open !== null &&
      written.openLinesFrom !== reading.open.start
    ) {
      say(
        `  the open period's lines are dated ${written.openLinesFrom}, the day after the last closed period`,
      );
    }

    const ledger = ledgerFigures(db, placement.lastSeq, people);
    const { lines, failed } = compare(expected, ledger, shown);
    say();
    say(`Figures over the workbook's rows, through ${expected.asOf}`);
    for (const line of lines) say(line);
    if (failed.length === 0) passed.push("The books show the workbook's figures for both buckets.");
    if (failed.length > 0) {
      problems.push(...failed);
      if (ledger.unclassified > 0) {
        problems.push(
          `${String(ledger.unclassified)} stored rows in the workbook's stretch are in the inbox, and no bucket counts them: classify them first.`,
        );
      }
      for (const { movement, stored: row } of placement.overlap) {
        if (
          row.bucket !== null &&
          (row.bucket !== movement.bucket || row.person_id !== movement.personId)
        ) {
          problems.push(
            `The stored row ${describeStored(row)} is filed ${row.bucket} ${row.person_id === null ? "joint" : shown(row.person_id)}; the workbook files it ${movement.bucket} ${movement.personId === null ? "joint" : shown(movement.personId)}.`,
          );
        }
      }
      if (reading.opening.mortgage !== 0 || reading.opening["current-expenses"] !== 0) {
        problems.push(
          `The first year carries in ${money(reading.opening.mortgage)} (mortgage) and ${money(reading.opening["current-expenses"])} (buffer) from before the workbook, and the books count nothing before their first row.`,
        );
      }
    }

    const lastClosed = reading.periods.at(-1)?.end ?? null;
    if (lastClosed !== null) {
      const candidates = [expected.asOf, dayAfter(lastClosed), written.openLinesFrom ?? ""];
      const end = candidates.toSorted().at(-1) ?? expected.asOf;
      const open = openPeriod(db, { end });
      say();
      say(`The open period as of ${end}, everything since the two were last even:`);
      say(
        `  books (cumulative, the catch-up folded in): ${describeSettlement(open.settlement, shown)}`,
      );
      const asked = reading.open?.settlement ?? null;
      if (asked !== null) {
        say(
          `  workbook (${reading.open?.sheet ?? ""}, this period alone, ${asked.formula}): ${asked.payerId === null ? "nobody owes" : `${shown(asked.payerId)} deposits ${money(asked.depositCents)}`}`,
        );
      }
    }
  } else {
    say();
    say(`The workbook's figures as of ${expected.asOf}`);
    for (const person of expected.mortgage.own) {
      say(`  mortgage: ${shown(person.personId)}'s own money  ${money(person.ownCents)}`);
    }
    say(`  buffer balance  ${money(expected.bufferBalanceCents)}`);
  }

  say();
  say("Verifications");
  for (const check of [...reading.checks, ...passed]) say(`  ok      ${check}`);
  for (const problem of problems) say(`  FAILED  ${problem}`);
  return { ok: problems.length === 0, report: out.join("\n"), problems, reading };
}
