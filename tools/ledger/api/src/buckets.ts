/**
 * What each bucket holds as of a date, read from the stored rows and the
 * classification that stands for each (lg-5).
 *
 * Recomputed on every read and never stored (`docs/00-ANALYSIS.md` §4, §9): the
 * arithmetic is `books`', and this only gathers its input. A row counts in the
 * bucket its **current** classification files it under, so reclassifying a row
 * moves it for every date at once — a classification is a correction of what the
 * row always was, not a change dated when it was made.
 */

import { bufferAsOf, mortgageAsOf } from "@ledger/books";
import type { FiledRow } from "@ledger/books";
import type { Bucket, BucketsResponse } from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { knownPeople } from "./people.ts";

interface FiledColumns {
  date: string;
  amount_cents: number;
  bucket: Bucket;
  person_id: string | null;
}

function filedRows(db: Database, asOf: string): FiledRow[] {
  const rows = db
    .prepare(
      `SELECT statement_rows.date, statement_rows.amount_cents, current_classifications.bucket, current_classifications.person_id
       FROM statement_rows
       JOIN current_classifications ON current_classifications.row_id = statement_rows.id
       WHERE statement_rows.date <= ?
       ORDER BY statement_rows.seq`,
    )
    .all(asOf) as FiledColumns[];
  return rows.map((row) => ({
    date: row.date,
    amountCents: row.amount_cents,
    bucket: row.bucket,
    personId: row.person_id,
  }));
}

function unclassifiedAsOf(db: Database, asOf: string): number {
  return (
    db
      .prepare(
        `SELECT count(*) AS n FROM statement_rows
         WHERE date <= ?
           AND NOT EXISTS (SELECT 1 FROM classifications WHERE classifications.row_id = statement_rows.id)`,
      )
      .get(asOf) as { n: number }
  ).n;
}

/** Both buckets as of `asOf` (`yyyy-mm-dd`), with every row dated on or before it. */
export function bucketsAsOf(db: Database, asOf: string): BucketsResponse {
  // One read transaction, so a paste landing between the queries cannot make the
  // count disagree with the figures.
  return db.transaction(() => {
    const rows = filedRows(db, asOf);
    const people = knownPeople(db);
    const mortgage = mortgageAsOf(rows, people, asOf);
    const buffer = bufferAsOf(rows, people, asOf);
    return {
      asOf,
      mortgage: { balanceCents: mortgage.balanceCents, own: mortgage.own, lead: mortgage.lead },
      buffer: { balanceCents: buffer.balanceCents, contributions: buffer.contributions },
      unclassified: unclassifiedAsOf(db, asOf),
    };
  })();
}
