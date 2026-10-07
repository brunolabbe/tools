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
 * **One transaction, and nothing kept unless everything holds.** Every write
 * happens inside it, the report is built from what the writes produced, and
 * only then is it committed — and only with `write` and no problem left. A dry
 * run, and any import that fails a verification, is rolled back, so the report
 * a dry run prints is exactly what `--write` would store.
 *
 * **Placing the rows.** A statement row has no identity of its own (lg-2), so
 * the workbook is matched to the stored rows by **position**: its newest rows
 * must be the oldest stored ones, one for one, by amount and running balance,
 * or its newest row must leave the balance the oldest stored row opened from.
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
  readWorkbook,
  workbookFigures,
} from "@ledger/books";
import type {
  Corrections,
  FiledRow,
  Movement,
  Sheet,
  WorkbookFigures,
  WorkbookReading,
} from "@ledger/books";
import type { Bucket, OwnMoney, SettlementFigures } from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { classifyRow } from "./classifications.ts";
import { enrollPeople, knownPeople } from "./people.ts";
import { openPeriod } from "./periods.ts";
import type { RuleContext } from "./rules.ts";
import { confirmRatio, enterSalaries } from "./salaries.ts";

export interface WorkbookImportOptions {
  /** Whoever runs the import: the configured name everything it writes is recorded under. */
  personId: string;
  /** The configured people, enrolled as a boot would enrol them. */
  configured: readonly string[];
  corrections: Corrections;
  /** Without it, everything is done and then rolled back: a dry run. */
  write: boolean;
  now: () => Date;
}

export interface WorkbookImportResult {
  /** Whether every verification held. */
  ok: boolean;
  /** Whether the import was committed. */
  written: boolean;
  /** What to print, before anything is kept. */
  report: string;
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

function agrees(movement: Movement, stored: StoredColumns): boolean {
  return (
    movement.amountCents === stored.amount_cents && movement.balanceCents === stored.balance_cents
  );
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
    let fits = true;
    for (let index = 0; index < shared && fits; index++) {
      const movement = movements[before + index];
      const row = stored[index];
      fits = movement !== undefined && row !== undefined && agrees(movement, row);
    }
    if (fits) found.push(before);
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
  const all = readings(movements, stored);
  const newest = movements.at(-1);
  // A reading that leaves workbook rows after the newest stored one is not a
  // place the workbook can go: those rows would be a paste's.
  const found = all.filter((before) => movements.length - before <= stored.length);
  const past = all.find((before) => movements.length - before > stored.length);
  if (found.length === 0 && past !== undefined) {
    problems.push(
      `The workbook runs ${String(movements.length - past - stored.length)} rows past the newest stored row, ${describeStored(stored.at(-1) as StoredColumns)}. Those rows belong to a paste: paste the statement through ${newest?.date ?? ""} first, so the import adds only what is older.`,
    );
    return null;
  }
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
    } else {
      // The likeliest place, said precisely when there is one: the workbook's
      // row on the stored row's day with its amount, whose balance disagrees.
      const near = movements.find(
        (movement) => movement.date === head.date && movement.amountCents === head.amount_cents,
      );
      if (near !== undefined) {
        problems.push(
          `${describeMovement(near)} moves the same day and amount as the oldest stored row, but leaves ${formatCents(near.balanceCents)} where it leaves ${formatCents(head.balance_cents)}: ${formatCents(head.balance_cents - near.balanceCents)} is unexplained.`,
        );
        return null;
      }
      problems.push(
        `The workbook's rows do not line up with the stored ones: no run of them matches the stored rows from the oldest, ${describeStored(head)}, one for one by amount and balance.`,
      );
    }
    return null;
  }
  const overlap = movements.slice(before).map((movement, index) => ({
    movement,
    stored: stored[index] as StoredColumns,
  }));
  return {
    added: movements.slice(0, before),
    firstSeq: head.seq - before,
    overlap,
    lastSeq: overlap.at(-1)?.stored.seq ?? head.seq - 1,
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
  ratioFrom: string | null;
  openLinesFrom: string | null;
}

function writeAll(
  db: Database,
  reading: WorkbookReading,
  placement: Placement,
  context: RuleContext,
): Written {
  const at = context.now().toISOString();
  const written: Written = { rows: 0, periods: 0, lines: 0, ratioFrom: null, openLinesFrom: null };

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
  // and their ratio take effect from the start of the history, and every
  // imported period records that ratio.
  const firstDay = [
    reading.movements[0]?.date,
    ...reading.periods.map((period) => period.start),
    reading.open?.start,
  ]
    .filter((date): date is string => date !== undefined)
    .toSorted()[0];
  let ratioId: number | null = null;
  if (firstDay !== undefined && reading.salaries.length === 2) {
    const entered = enterSalaries(context, {
      year: Number(firstDay.slice(0, 4)),
      salaries: reading.salaries,
    });
    const ratio = confirmRatio(context, {
      effectiveFrom: firstDay,
      salaryIds: entered.salaries.map((salary) => salary.id),
    });
    ratioId = ratio.id;
    written.ratioFrom = firstDay;
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
    if (settlement === null || end === null || ratioId === null) continue;
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
function ledgerFigures(
  db: Database,
  lastSeq: number,
  people: readonly string[],
  asOf: string,
): LedgerFigures {
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
  const mortgage = mortgageAsOf(rows, people, asOf);
  return {
    own: mortgage.own,
    mortgageBalanceCents: mortgage.balanceCents,
    bufferBalanceCents: bufferAsOf(rows, people, asOf).balanceCents,
    unclassified,
  };
}

function money(cents: number): string {
  return formatCents(cents);
}

function gapOf(own: readonly OwnMoney[]): { label: string; cents: number } | null {
  const [first, second] = own;
  if (own.length !== 2 || first === undefined || second === undefined) return null;
  return {
    label: `${first.personId} − ${second.personId}`,
    cents: first.ownCents - second.ownCents,
  };
}

/** Each figure the import is held to, the workbook's beside the books', and whether they agree. */
function compare(
  expected: WorkbookFigures,
  ledger: LedgerFigures,
): { lines: string[]; failed: string[] } {
  const rows: [string, number, number][] = [];
  for (const person of expected.mortgage.own) {
    const found = ledger.own.find((entry) => entry.personId === person.personId)?.ownCents ?? 0;
    rows.push([`mortgage: ${person.personId}'s own money`, person.ownCents, found]);
  }
  const gapExpected = gapOf(expected.mortgage.own);
  const gapLedger = gapOf(ledger.own);
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

function describeSettlement(figures: SettlementFigures | null): string {
  if (figures === null) return "no ratio in effect";
  if (figures.payerId === null) return "nobody owes";
  const deposit =
    figures.depositCents === null ? "pays directly" : `deposits ${money(figures.depositCents)}`;
  return `${figures.payerId} ${deposit} (net ${money(figures.netCents)}), ${figures.formula}`;
}

export function importWorkbook(
  db: Database,
  sheets: readonly Sheet[],
  options: WorkbookImportOptions,
): WorkbookImportResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const { ok, report } = run(db, sheets, options);
    if (options.write && ok) {
      db.exec("COMMIT");
      return { ok, written: true, report: `${report}\nWritten.\n` };
    }
    db.exec("ROLLBACK");
    const outcome = ok
      ? "Every verification held. This was a dry run: nothing was written. Run again with --write to import."
      : "Refused: nothing was written.";
    return { ok, written: false, report: `${report}\n${outcome}\n` };
  } catch (error: unknown) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function run(
  db: Database,
  sheets: readonly Sheet[],
  options: WorkbookImportOptions,
): { ok: boolean; report: string } {
  enrollPeople(db, options.configured, options.now());
  const people = knownPeople(db);
  const reading = readWorkbook(sheets, { people, corrections: options.corrections });
  const problems = [...reading.problems];
  if (!people.includes(options.personId)) {
    problems.push(
      `--as names "${options.personId}", who is not one of the household (${people.join(", ") || "nobody is configured"}).`,
    );
  }
  alreadyHeld(db, problems);

  const stored = storedRows(db);
  const placement = problems.length === 0 ? place(reading.movements, stored, problems) : null;
  const passed: string[] = [];
  if (placement !== null && placement.overlap.length > 0) {
    passed.push(
      `The ${String(placement.overlap.length)} rows the pastes already hold are the workbook's newest, one for one, by amount and balance.`,
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
  for (const movement of corrected) {
    const was = movement.workbook;
    if (was === null) continue;
    say(
      `  corrected: ${movement.sheet} row ${String(movement.row)}, ${was.bucket} ${was.personId ?? "joint"} → ${movement.bucket} ${movement.personId ?? "joint"}: ${movement.correction ?? ""}`,
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
          : `${settlement.formula}, ${settlement.payerId} deposited ${money(settlement.depositCents)}`;
    say(
      `  ${period.sheet}: ${period.start} to ${period.end ?? ""}, ${String(period.lines.length)} lines, ${asked}`,
    );
  }
  if (reading.open !== null) {
    say(
      `  ${reading.open.sheet}: open since ${reading.open.start}, ${String(reading.open.lines.length)} lines`,
    );
  }
  if (reading.salaries.length > 0) {
    say(
      `  salaries (Accueil): ${reading.salaries.map((salary) => `${salary.personId} ${money(salary.amountCents)}`).join(", ")}`,
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
    if (written.ratioFrom !== null)
      say(`  ratio from those salaries, in effect from ${written.ratioFrom}`);
    if (
      written.openLinesFrom !== null &&
      reading.open !== null &&
      written.openLinesFrom !== reading.open.start
    ) {
      say(
        `  the open period's lines are dated ${written.openLinesFrom}, the day after the last closed period`,
      );
    }

    const ledger = ledgerFigures(db, placement.lastSeq, people, expected.asOf);
    const { lines, failed } = compare(expected, ledger);
    say();
    say(`Figures as of ${expected.asOf}`);
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
            `The stored row ${describeStored(row)} is filed ${row.bucket} ${row.person_id ?? "joint"}; the workbook files it ${movement.bucket} ${movement.personId ?? "joint"}.`,
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
      say(`  books (cumulative, the catch-up folded in): ${describeSettlement(open.settlement)}`);
      const asked = reading.open?.settlement ?? null;
      if (asked !== null) {
        say(
          `  workbook (${reading.open?.sheet ?? ""}, this period alone, ${asked.formula}): ${asked.payerId === null ? "nobody owes" : `${asked.payerId} deposits ${money(asked.depositCents)}`}`,
        );
      }
    }
  } else {
    say();
    say(`The workbook's figures as of ${expected.asOf}`);
    for (const person of expected.mortgage.own) {
      say(`  mortgage: ${person.personId}'s own money  ${money(person.ownCents)}`);
    }
    say(`  buffer balance  ${money(expected.bufferBalanceCents)}`);
  }

  say();
  say("Verifications");
  for (const check of [...reading.checks, ...passed]) say(`  ok      ${check}`);
  for (const problem of problems) say(`  FAILED  ${problem}`);
  return { ok: problems.length === 0, report: out.join("\n") };
}
