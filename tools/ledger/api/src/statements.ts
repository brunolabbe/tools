/**
 * Storing a pasted statement, chained onto what is already stored (lg-2).
 *
 * `parseStatement` has already proven the paste against itself: its own running
 * balance, its month totals, its echo lines. What it cannot know is the history
 * the paste joins, so this is the fourth proof, and the one that makes a
 * *second* paste safe:
 *
 * - **The first paste into an empty database is the anchor** and is accepted as
 *   it stands.
 * - **A later paste must overlap the stored tail exactly, or continue from it.**
 *   It is read by *position*: the paste's first `k` rows must be the stored
 *   tail's last `k` rows, field for field, and the rest is new; or, with `k = 0`,
 *   its oldest row must open from the stored tail's balance. A paste that sits
 *   wholly inside the stored history adds nothing. Anything between is money
 *   nobody can explain, and the error says how much.
 * - **A row's date, description, amount and balance are not unique** — a
 *   transfer, its reversal and the transfer again on one day repeat all four —
 *   so no row is ever matched by those fields alone. Where two readings of one
 *   paste are both consistent with what is stored and they would store
 *   different things, the paste is refused naming both, because picking one
 *   silently is how a row gets dropped or a day gets booked twice.
 * - **Never overwrite.** A stored row is never edited and never replaced: the
 *   rows a paste adds are `INSERT`ed, and a pasted row that disagrees with a
 *   stored one is refused with both named, not reconciled.
 * - **A row the workbook imported is compared the way the workbook import
 *   compares** (lg-40). Its row came in through a `statement_imports` row whose
 *   `source` is `'workbook'`, and carries the workbook's wording and no
 *   category, so it is never compared by description or category. Where the
 *   overlap reaches such rows, they are read day by day (`workbook-days.ts`):
 *   each stretch of consecutive workbook rows on one date, and the pasted rows
 *   in their positions, must hold the same amounts, counted with repeats, and
 *   end on the same balance, and each pasted row must be dated that day or a day
 *   either side. A paste may start or end partway through such a day: its rows
 *   there must be among the day's amounts and open from a balance the bank's day
 *   reaches at that point (`matchPart`), and the balances the workbook shows
 *   inside a day, which follow its own order, are never compared. So within a
 *   day the order may differ, a date a day off is accepted, two days off is not,
 *   and a day whose amounts differ by one row is not, even when it ends on the
 *   same balance. Two exceptions are refused whatever the paste holds: a day the
 *   workbook both re-dated and reordered (it is two runs, so it does not match),
 *   and a paste that starts and ends inside a day of more than
 *   `LONGEST_SEARCHED_DAY` rows (20), which is not searched. A row a paste
 *   stored is still compared field for field, in order. Every reading this
 *   makes possible is a reading like any other: two of them are refused as
 *   ambiguous. The workbook's rows keep their wording and dates; only the rows
 *   past the tail are stored. When nothing fits and the
 *   stored row the paste had to meet is the workbook's, the refusal names that
 *   row and the pasted row that opens from its balance, and does not ask for a
 *   longer stretch: that is the advice for a paste that falls short of the
 *   stored rows, and this one reached rows it does not match.
 *
 * The whole thing runs in one `IMMEDIATE` transaction, so two pastes arriving
 * at once cannot both read the same tail and both extend it. The rows it adds
 * are classified by the rules in force in that same transaction (lg-4).
 */

import { AppError } from "@ledger/contract";
import type { ImportStatementReport } from "@ledger/contract";
import { dayAfter, formatCents, parseStatement } from "@ledger/books";
import type { StatementRow } from "@ledger/books";
import type { Database } from "better-sqlite3";
import { classifyAdded, lastRowId } from "./classifications.ts";
import { LONGEST_SEARCHED_DAY, dayBefore, matchPart } from "./workbook-days.ts";

/**
 * A stored row: the parser's row, with `seq` now the position in the whole
 * history, and whether the workbook import stored it (lg-40).
 */
type StoredRow = StatementRow & { fromWorkbook: boolean };

interface Columns {
  seq: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
  source: string;
}

// The import a row came in with says whether it is the workbook's. No column
// here shares a name with `statement_imports`'s, so the WHERE clauses below
// need no table prefix.
const SELECT = `SELECT seq, date, category, description, amount_cents, balance_cents, source
  FROM statement_rows JOIN statement_imports ON statement_imports.id = statement_rows.import_id`;

function toRow(columns: Columns): StoredRow {
  return {
    seq: columns.seq,
    date: columns.date,
    category: columns.category,
    description: columns.description,
    amountCents: columns.amount_cents,
    balanceCents: columns.balance_cents,
    fromWorkbook: columns.source === "workbook",
  };
}

/** What a row is called in an error: the fields that identify it, in a person's words. */
function describeRow(row: StatementRow): string {
  return `${row.date} "${row.description}" ${formatCents(row.amountCents)} (balance ${formatCents(row.balanceCents)})`;
}

/** The fields two rows can disagree on, each in the words an error uses for it. */
const FIELDS = [
  ["date", "date"],
  ["category", "category"],
  ["description", "description"],
  ["amountCents", "amount"],
  ["balanceCents", "balance"],
] as const;

/** The fields two rows disagree on, which is what the error names. */
function differingFields(stored: StoredRow, pasted: StatementRow): string[] {
  return FIELDS.filter(([key]) => stored[key] !== pasted[key]).map(([, word]) => word);
}

function sameRow(stored: StoredRow, pasted: StatementRow): boolean {
  return differingFields(stored, pasted).length === 0;
}

/** A row as an error carries it, without a `seq` whose meaning differs by side. */
function plain(row: StatementRow): Record<string, unknown> {
  const { date, category, description, amountCents, balanceCents } = row;
  return { date, category, description, amountCents, balanceCents };
}

function conflict(message: string, stored: StoredRow, pasted: StatementRow): never {
  throw new AppError("STATEMENT_ROW_CONFLICT", message, {
    details: {
      fields: differingFields(stored, pasted),
      // `seq` is the position in the whole history. The paste numbers its own
      // rows from 0, a different number, so it is named for what it is.
      stored: { ...plain(stored), seq: stored.seq },
      pasted: { ...plain(pasted), pasteIndex: pasted.seq },
    },
  });
}

export interface ImportContext {
  db: Database;
  /** The configured name of whoever pasted, never the address. */
  personId: string;
  now: () => Date;
}

export function importStatement(context: ImportContext, text: string): ImportStatementReport {
  // Outside the transaction: a paste that does not parse needs no lock.
  const { rows } = parseStatement(text);
  const oldest = rows[0];
  const newest = rows.at(-1);
  if (oldest === undefined || newest === undefined) {
    throw new AppError("BAD_REQUEST", "The paste holds no statement rows.");
  }
  try {
    return context.db
      .transaction(() => {
        // Taken before the rows are stored, so the paste's own are the ones after it.
        const before = lastRowId(context.db);
        const report = store(context, rows, oldest, newest);
        // A row with exactly one matching rule is classified here; the rest wait
        // in the inbox (lg-4). Inside the paste's transaction, so a paste is
        // never stored without its classifications or classified without it.
        classifyAdded(context, before);
        return report;
      })
      .immediate();
  } catch (error: unknown) {
    // Another connection holds the write lock past the busy timeout. Nothing
    // here opens a second connection, but a backup or an operator's shell can.
    if ((error as { code?: unknown } | null)?.code === "SQLITE_BUSY") {
      throw new AppError("TIMEOUT", "The ledger's database was busy. Try the paste again.", {
        cause: error,
      });
    }
    throw error;
  }
}

function store(
  context: ImportContext,
  rows: StatementRow[],
  oldest: StatementRow,
  newest: StatementRow,
): ImportStatementReport {
  const { db } = context;
  const count = (db.prepare("SELECT count(*) AS n FROM statement_rows").get() as { n: number }).n;
  const tail = latest(db, "DESC", 1)[0];

  let alreadyPresent = 0;
  if (tail !== undefined) {
    const found = readings(db, rows, oldest, count, tail);
    if (found.length === 0) fail(db, rows, oldest, newest, tail);
    const [first] = found;
    if (found.length > 1 || first === undefined) throw ambiguous(oldest, rows.length, found);
    alreadyPresent = first;
  }

  const added = rows.slice(alreadyPresent);
  if (added.length > 0) {
    const imported = db
      .prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)")
      .run(context.now().toISOString(), context.personId);
    // The position after the highest stored one — not the row count, which only
    // equals it while positions run 0..n.
    const next = (
      db.prepare("SELECT coalesce(max(seq), -1) + 1 AS next FROM statement_rows").get() as {
        next: number;
      }
    ).next;
    const insert = db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [offset, row] of added.entries()) {
      insert.run(
        next + offset,
        row.date,
        row.category,
        row.description,
        row.amountCents,
        row.balanceCents,
        imported.lastInsertRowid,
      );
    }
  }

  // Read back, not taken from the paste: a paste that sits inside the stored
  // history leaves the tail where it was, and this is the answer either way.
  const last = latest(db, "DESC", 1)[0];
  return {
    rowsAdded: added.length,
    rowsAlreadyPresent: alreadyPresent,
    tailBalanceCents: last?.balanceCents ?? 0,
  };
}

/** The first or last `limit` stored rows, in the order asked for. */
function latest(db: Database, order: "ASC" | "DESC", limit: number): StoredRow[] {
  return (db.prepare(`${SELECT} ORDER BY seq ${order} LIMIT ?`).all(limit) as Columns[]).map(toRow);
}

/**
 * Every stored row a paste lists as `row` — the same date, description, amount
 * and balance — and that a paste stored. A workbook row is never one: its
 * wording is the workbook's, so it is found by `workbookStarts` instead.
 */
function candidates(db: Database, row: StatementRow): StoredRow[] {
  return (
    db
      .prepare(
        `${SELECT} WHERE date = ? AND description = ? AND amount_cents = ? AND balance_cents = ? AND source <> 'workbook' ORDER BY seq DESC`,
      )
      .all(row.date, row.description, row.amountCents, row.balanceCents) as Columns[]
  ).map(toRow);
}

/**
 * Every workbook row a paste starting on `row` could start on: dated that day
 * or a day either side, since the workbook's day may list `row` anywhere in it.
 */
function workbookStarts(db: Database, row: StatementRow): StoredRow[] {
  return (
    db
      .prepare(`${SELECT} WHERE source = 'workbook' AND date IN (?, ?, ?) ORDER BY seq DESC`)
      .all(dayBefore(row.date), row.date, dayAfter(row.date)) as Columns[]
  ).map(toRow);
}

/**
 * The workbook rows of `edge`'s day on one side of it, oldest first: the rest of
 * a day a stretch of stored rows starts or ends partway through.
 */
function restOfDay(db: Database, edge: StoredRow, side: "before" | "after"): StoredRow[] {
  const query =
    side === "before"
      ? `${SELECT} WHERE seq < ? ORDER BY seq DESC`
      : `${SELECT} WHERE seq > ? ORDER BY seq ASC`;
  const found: StoredRow[] = [];
  for (const columns of db.prepare(query).iterate(edge.seq) as IterableIterator<Columns>) {
    const row = toRow(columns);
    if (!row.fromWorkbook || row.date !== edge.date) break;
    found.push(row);
  }
  return side === "before" ? found.toReversed() : found;
}

/**
 * Whether these stored rows are the pasted rows in their places: a row a paste
 * stored field for field, and a stretch of workbook rows on one date day by day.
 * Such a stretch is weighed against its whole day (`matchPart`), the rows the
 * stretch leaves out included, since a paste may start or end partway through a
 * day whose order the workbook does not keep.
 */
function overlaps(
  db: Database,
  stored: readonly StoredRow[],
  pasted: readonly StatementRow[],
): boolean {
  if (stored.length !== pasted.length) return false;
  let start = 0;
  while (start < stored.length) {
    const first = stored[start] as StoredRow;
    if (!first.fromWorkbook) {
      if (!sameRow(first, pasted[start] as StatementRow)) return false;
      start += 1;
      continue;
    }
    let end = start + 1;
    while (stored[end]?.fromWorkbook === true && stored[end]?.date === first.date) end += 1;
    const earlier = start === 0 ? restOfDay(db, first, "before") : [];
    const later = end === stored.length ? restOfDay(db, stored[end - 1] as StoredRow, "after") : [];
    const day = [...earlier, ...stored.slice(start, end), ...later];
    if (!matchPart(day, earlier.length, pasted.slice(start, end), "a day either side")) {
      return false;
    }
    start = end;
  }
  return true;
}

/** Up to `limit` stored rows from position `from` on, oldest first. */
function from(db: Database, position: number, limit: number): StoredRow[] {
  return (
    db
      .prepare(`${SELECT} WHERE seq >= ? ORDER BY seq ASC LIMIT ?`)
      .all(position, limit) as Columns[]
  ).map(toRow);
}

/**
 * Every way this paste can sit against the stored history, as the number of its
 * oldest rows that are already stored. More than one is an ambiguity; none means
 * the paste does not fit.
 *
 * - `k` rows overlapping the stored tail: the paste's first `k` rows are the
 *   tail's last `k`, and `k = 0` is a continuation, opening from the tail's balance.
 * - A paste wholly inside the history: every row already stored, so `rows.length`.
 *
 * Either way the stored rows are compared by `overlaps`: the workbook's day by
 * day, a paste's field for field (lg-40).
 */
function readings(
  db: Database,
  rows: StatementRow[],
  oldest: StatementRow,
  count: number,
  tail: StoredRow,
): number[] {
  const found = new Set<number>();
  const window = latest(db, "DESC", rows.length).toReversed();
  for (let k = 0; k <= Math.min(rows.length, window.length); k++) {
    const fits =
      k === 0
        ? oldest.balanceCents - oldest.amountCents === tail.balanceCents
        : overlaps(db, window.slice(window.length - k), rows.slice(0, k));
    if (fits) found.add(k);
  }
  if (rows.length <= count) {
    for (const candidate of [...candidates(db, oldest), ...workbookStarts(db, oldest)]) {
      if (overlaps(db, from(db, candidate.seq, rows.length), rows)) found.add(rows.length);
    }
  }
  // Most already-stored first, so the readings list reads from "nothing new" up.
  return [...found].toSorted((a, b) => b - a);
}

/** Nothing fits: say why, as precisely as the history allows. Never returns. */
function fail(
  db: Database,
  rows: StatementRow[],
  oldest: StatementRow,
  newest: StatementRow,
  tail: StoredRow,
): never {
  // The paste starts on a row the history holds, and then departs from it.
  let best: { matched: number; stored: StoredRow } | undefined;
  for (const candidate of candidates(db, oldest)) {
    const stored = from(db, candidate.seq, rows.length);
    const matched = stored.findIndex((row, index) => !sameRow(row, rows[index] as StatementRow));
    const at = stored[matched];
    if (matched !== -1 && at !== undefined && (best === undefined || matched > best.matched)) {
      best = { matched, stored: at };
    }
  }
  const pastedAt = best === undefined ? undefined : rows[best.matched];
  if (best !== undefined && pastedAt !== undefined) {
    conflict(
      `The pasted row ${describeRow(pastedAt)} does not match the stored row in its place, ${describeRow(best.stored)} (they differ in: ${differingFields(best.stored, pastedAt).join(", ")}). Stored category "${best.stored.category}", pasted "${pastedAt.category}".`,
      best.stored,
      pastedAt,
    );
  }

  // The paste starts on a row the history does not hold but runs into one it does.
  const head = latest(db, "ASC", 1)[0];
  for (const [index, row] of rows.entries()) {
    const [found] = candidates(db, row);
    if (found === undefined || index === 0) continue;
    const before = previous(db, found.seq);
    if (before === undefined) throw beforeHistory(found);
    // The rows before the shared ones had to meet the workbook's, and did not.
    if (before.fromWorkbook) throw workbookMismatch(before, rows);
    const pasted = rows[index - 1] ?? oldest;
    conflict(
      `The pasted row ${describeRow(pasted)} is not the stored row ${describeRow(before)} that comes before the rows they share (they differ in: ${differingFields(before, pasted).join(", ")}).`,
      before,
      pasted,
    );
  }

  // Nothing in the paste is stored. Older than everything stored, or a gap after it.
  // Dates only run forward, so a paste that ends before the oldest stored row's
  // day is older history. On that very day it is older history when the history
  // runs past the day, because a paste dated then cannot follow the tail, which is
  // on a later one; with a one-day history the day cannot tell the two apart, so
  // the balance the oldest row opened from does. The balance alone is never
  // enough: a gap after the history can end on any balance, that one included, and
  // it is dated later. Quoting an "unexplained" amount for older history would be
  // the distance between two ends of one account.
  if (
    head !== undefined &&
    (newest.date < head.date ||
      (newest.date === head.date &&
        (newest.date < tail.date || newest.balanceCents === head.balanceCents - head.amountCents)))
  ) {
    throw beforeHistory(head);
  }
  // The paste had to meet the workbook's rows, which were compared without their
  // wording, a date a day off or the order within a day: not the gap's case.
  if (tail.fromWorkbook) throw workbookMismatch(tail, rows);
  throw gap(oldest, tail);
}

/** The stored row just before position `seq`, if any. */
function previous(db: Database, seq: number): StoredRow | undefined {
  const row = db.prepare(`${SELECT} WHERE seq < ? ORDER BY seq DESC LIMIT 1`).get(seq) as
    | Columns
    | undefined;
  return row === undefined ? undefined : toRow(row);
}

/** The paste opens at a balance the stored tail does not end on. */
function gap(oldest: StatementRow, tail: StoredRow): AppError {
  const opening = oldest.balanceCents - oldest.amountCents;
  return new AppError(
    "STATEMENT_CHAIN_BROKEN",
    `The oldest row of the paste, ${describeRow(oldest)}, opens from ${formatCents(opening)}, but the newest stored row left ${formatCents(tail.balanceCents)}: ${formatCents(opening - tail.balanceCents)} is unexplained. A row is missing between the two, so paste a longer stretch that overlaps what is stored.`,
    {
      details: {
        date: oldest.date,
        description: oldest.description,
        amountCents: oldest.amountCents,
        balanceCents: oldest.balanceCents,
        previousBalanceCents: tail.balanceCents,
        expectedBalanceCents: tail.balanceCents + oldest.amountCents,
        unexplainedCents: opening - tail.balanceCents,
      },
    },
  );
}

/**
 * The paste had to meet the workbook's rows, ending on `newest`, and fits them
 * nowhere. Its refusal names that row and the pasted row that opens from its
 * balance, if the paste holds one: a paste starting there continues the
 * workbook. It does not ask for a longer paste, the gap's advice: this paste
 * reached the workbook's rows and does not match them, and what it says instead
 * is how they were compared.
 */
function workbookMismatch(newest: StoredRow, rows: readonly StatementRow[]): AppError {
  const earliest = dayBefore(newest.date);
  const at = rows.findIndex(
    (row) => row.balanceCents - row.amountCents === newest.balanceCents && row.date >= earliest,
  );
  const continuing = rows[at];
  const left = formatCents(newest.balanceCents);
  const next =
    continuing === undefined
      ? ` No pasted row opens from the ${left} it left, so the paste does not reach it, or a row is in one and not the other.`
      : ` The pasted row ${describeRow(continuing)} opens from the ${left} it left: a paste that starts on that row continues the workbook.`;
  return new AppError(
    "STATEMENT_CHAIN_BROKEN",
    `The paste does not line up with the rows imported from the workbook, which end on ${describeRow(newest)}. Those are compared by amount and balance a day at a time: a day's rows in any order, each dated within a day of the workbook's, and a paste may start or end partway through a day, except that a day the workbook both re-dated and reordered is refused, and so is a paste that starts and ends inside a day of more than ${String(LONGEST_SEARCHED_DAY)} rows. Their wording is never compared.${next}`,
    {
      details: {
        date: newest.date,
        description: newest.description,
        amountCents: newest.amountCents,
        balanceCents: newest.balanceCents,
        continuesAt:
          continuing === undefined
            ? null
            : {
                pasteIndex: at,
                date: continuing.date,
                description: continuing.description,
                amountCents: continuing.amountCents,
                balanceCents: continuing.balanceCents,
              },
      },
    },
  );
}

function beforeHistory(oldestStored: StoredRow): AppError {
  return new AppError(
    "STATEMENT_BEFORE_HISTORY",
    `The paste reaches back before the oldest stored row, ${describeRow(oldestStored)}. Older history cannot be added in front of what is stored.`,
    {
      details: {
        date: oldestStored.date,
        description: oldestStored.description,
        amountCents: oldestStored.amountCents,
        balanceCents: oldestStored.balanceCents,
      },
    },
  );
}

/** Two readings of one paste are both consistent with the books and store different things. */
function ambiguous(oldest: StatementRow, total: number, present: number[]): AppError {
  const described = present.map((stored) => ({
    rowsAdded: total - stored,
    rowsAlreadyPresent: stored,
  }));
  const said = described
    .map((r) => `${r.rowsAlreadyPresent} already stored and ${r.rowsAdded} new`)
    .join(", or ");
  return new AppError(
    "STATEMENT_ROW_CONFLICT",
    `The paste starting at ${describeRow(oldest)} can be read two ways, and each fits what is stored: ${said}. The same rows come round again in the account, so the books cannot tell which was meant. Paste a longer stretch that starts on an earlier row, so only one reading fits.`,
    {
      details: {
        readings: described,
        date: oldest.date,
        description: oldest.description,
        amountCents: oldest.amountCents,
        balanceCents: oldest.balanceCents,
      },
    },
  );
}
