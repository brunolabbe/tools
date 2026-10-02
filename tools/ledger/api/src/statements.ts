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
 *   Its oldest row either is a stored row (identity: date, description, amount,
 *   balance) and every row after it up to the stored tail must be identical to
 *   what is stored, or it must open from the stored tail's balance. Anything
 *   between is money nobody can explain, and the error says how much.
 * - **Never overwrite.** A stored row is never edited and never replaced: the
 *   rows a paste adds are `INSERT`ed, and a pasted row that disagrees with a
 *   stored one is refused with both named, not reconciled.
 *
 * The whole thing runs in one `IMMEDIATE` transaction, so two pastes arriving
 * at once cannot both read the same tail and both extend it.
 */

import { AppError } from "@ledger/contract";
import type { ImportStatementReport } from "@ledger/contract";
import { formatCents, parseStatement } from "@ledger/books";
import type { StatementRow } from "@ledger/books";
import type { Database } from "better-sqlite3";

/** A stored row: the parser's row, with `seq` now the position in the whole history. */
type StoredRow = StatementRow;

interface Columns {
  seq: number;
  date: string;
  category: string;
  description: string;
  amount_cents: number;
  balance_cents: number;
}

const SELECT = `SELECT seq, date, category, description, amount_cents, balance_cents FROM statement_rows`;

function toRow(columns: Columns): StoredRow {
  return {
    seq: columns.seq,
    date: columns.date,
    category: columns.category,
    description: columns.description,
    amountCents: columns.amount_cents,
    balanceCents: columns.balance_cents,
  };
}

/** What a row is called in an error: the fields that identify it, in a person's words. */
function describeRow(row: StatementRow): string {
  return `${row.date} "${row.description}" ${formatCents(row.amountCents)} (balance ${formatCents(row.balanceCents)})`;
}

function identityKey(row: StatementRow): string {
  return JSON.stringify([row.date, row.description, row.amountCents, row.balanceCents]);
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

/** A row as an error carries it, without a `seq` whose meaning differs by side. */
function plain(row: StatementRow): Record<string, unknown> {
  const { seq: _seq, ...fields } = row;
  return fields;
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
  return context.db.transaction(() => store(context, rows, oldest, newest)).immediate();
}

function store(
  context: ImportContext,
  rows: StatementRow[],
  oldest: StatementRow,
  newest: StatementRow,
): ImportStatementReport {
  const { db } = context;
  const count = (db.prepare("SELECT count(*) AS n FROM statement_rows").get() as { n: number }).n;
  const tailColumns = db.prepare(`${SELECT} ORDER BY seq DESC LIMIT 1`).get() as
    | Columns
    | undefined;
  const tail = tailColumns === undefined ? undefined : toRow(tailColumns);

  const byIdentity = db.prepare(
    `${SELECT} WHERE date = ? AND description = ? AND amount_cents = ? AND balance_cents = ?`,
  );
  const lookup = (row: StatementRow): StoredRow | undefined => {
    const found = byIdentity.get(row.date, row.description, row.amountCents, row.balanceCents) as
      | Columns
      | undefined;
    return found === undefined ? undefined : toRow(found);
  };

  // The paste's oldest row that is already stored, and where it sits.
  const overlapAt = rows.findIndex((row) => lookup(row) !== undefined);
  const firstStored = overlapAt === -1 ? undefined : lookup(rows[overlapAt] ?? oldest);

  // The paste index of its oldest row that is not stored yet. The stored
  // position that row takes is `count`, because a new row is only ever the next.
  let firstNew: number;
  if (firstStored === undefined) {
    // Nothing overlaps. That is only acceptable as the anchor, or as a paste
    // that opens exactly where the stored history ends.
    if (tail !== undefined) {
      const head = toRow(db.prepare(`${SELECT} ORDER BY seq ASC LIMIT 1`).get() as Columns);
      // A paste that ends exactly where the stored history begins is older
      // history, not a gap: say so rather than quote an "unexplained" amount
      // that is only the distance between two ends of the same account.
      if (newest.balanceCents === head.balanceCents - head.amountCents) {
        throw beforeHistory(head);
      }
      if (oldest.balanceCents - oldest.amountCents !== tail.balanceCents) throw gap(oldest, tail);
    }
    firstNew = 0;
  } else {
    if (overlapAt > 0) {
      // Rows before the first stored one: either older than everything stored,
      // or a row the stored history has a different row in place of.
      if (firstStored.seq === 0) throw beforeHistory(firstStored);
      const before = toRow(
        db.prepare(`${SELECT} WHERE seq = ?`).get(firstStored.seq - 1) as Columns,
      );
      const pasted = rows[overlapAt - 1] ?? oldest;
      conflict(
        `The pasted row ${describeRow(pasted)} is not the stored row ${describeRow(before)} that comes before the rows they share (they differ in: ${differingFields(before, pasted).join(", ")}).`,
        before,
        pasted,
      );
    }
    // The paste starts on a stored row: every row up to the stored tail must be
    // the stored row that is there.
    const overlapping = db
      .prepare(`${SELECT} WHERE seq >= ? ORDER BY seq ASC`)
      .all(firstStored.seq) as Columns[];
    for (const [index, columns] of overlapping.entries()) {
      const pasted = rows[index];
      if (pasted === undefined) break;
      const stored = toRow(columns);
      const fields = differingFields(stored, pasted);
      // Identity found the first of these; every other one is only the same row
      // if its fields still say so, and a category — which identity leaves out —
      // is the case that has to be caught here.
      if (fields.length > 0) {
        conflict(
          `The pasted row ${describeRow(pasted)} does not match the stored row in its place, ${describeRow(stored)} (they differ in: ${fields.join(", ")}). Stored category "${stored.category}", pasted "${pasted.category}".`,
          stored,
          pasted,
        );
      }
    }
    firstNew = overlapping.length;
  }

  const added = rows.slice(firstNew);
  // A new row cannot share an identity with a stored row or with another new
  // row: the unique index would refuse it as a 500 rather than say which.
  const seen = new Set<string>();
  for (const row of added) {
    const key = identityKey(row);
    const stored = lookup(row);
    if (stored !== undefined || seen.has(key)) {
      conflict(
        `The pasted row ${describeRow(row)} has the same date, description, amount and balance as another row, so the two cannot be told apart.`,
        stored ?? row,
        row,
      );
    }
    seen.add(key);
  }

  if (added.length > 0) {
    const imported = db
      .prepare("INSERT INTO statement_imports (imported_at, imported_by) VALUES (?, ?)")
      .run(context.now().toISOString(), context.personId);
    const insert = db.prepare(
      `INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [offset, row] of added.entries()) {
      insert.run(
        count + offset,
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
  const stored = db.prepare("SELECT balance_cents FROM statement_rows ORDER BY seq DESC LIMIT 1");
  return {
    rowsAdded: added.length,
    rowsAlreadyPresent: rows.length - added.length,
    tailBalanceCents: (stored.get() as { balance_cents: number }).balance_cents,
  };
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
