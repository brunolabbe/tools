/**
 * How the mortgage's joint rows split, from a date (lg-63): by shares, equally,
 * or at the ratio.
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). Filing a split for a day
 * that already has one supersedes it, as confirming a ratio for its day does,
 * and the earlier record stays; `current_mortgage_splits` is what stands. No
 * record is `equal`. The arithmetic is `books`' (`MortgageSplitter`): this file
 * stores the records and gathers what the split reads — the ratios that stand,
 * the retirements and the bucket's rows.
 *
 * **A split by shares names exactly the people the books hold on its day**, as
 * `books` answers it (`heldOn`): the ratio in effect's people, less anyone
 * retired then. Its parts are the household's own, so nothing derives them; a
 * set that does not sum to 1 000 000 is refused (the schema does it first).
 */

import { MortgageSplitter, PARTS_PER_MILLION } from "@ledger/books";
import type { SplitHistory } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  MortgageSplit,
  MortgageSplitMode,
  MortgageSplitPart,
  MortgageSplitRequest,
  MortgageSplitsResponse,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { knownPeople, retirementsOf } from "./people.ts";
import { currentRatios } from "./salaries.ts";

interface SplitColumns {
  id: number;
  effective_from: string;
  mode: MortgageSplitMode;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

interface ShareColumns {
  person_id: string;
  parts_per_million: number;
}

function readSplits(db: Database, where: string, ...params: unknown[]): MortgageSplit[] {
  const splits = db
    .prepare(`SELECT * FROM current_mortgage_splits ${where} ORDER BY effective_from, id`)
    .all(...params) as SplitColumns[];
  const shares = db.prepare(
    "SELECT person_id, parts_per_million FROM mortgage_split_shares WHERE split_id = ? ORDER BY person_id",
  );
  return splits.map((split) => ({
    id: split.id,
    effectiveFrom: split.effective_from,
    mode: split.mode,
    shares: (shares.all(split.id) as ShareColumns[]).map((share) => ({
      personId: share.person_id,
      partsPerMillion: share.parts_per_million,
    })),
    supersedes: split.supersedes,
    enteredAt: split.entered_at,
    enteredBy: split.entered_by,
  }));
}

/** Every split record that stands, oldest first. */
export function currentSplits(db: Database): MortgageSplit[] {
  return readSplits(db, "");
}

/** The ratios and the split records that stand: what each joint row's split reads besides the retirements. */
export function splitHistoryOf(db: Database): SplitHistory {
  return { ratios: currentRatios(db), splits: currentSplits(db) };
}

/** The split records that stand, and the one in effect on `asOf`. */
export function splitsAsOf(db: Database, asOf: string): MortgageSplitsResponse {
  return db.transaction(() => {
    const splits = currentSplits(db);
    const standing = splits.filter((split) => split.effectiveFrom <= asOf);
    return { asOf, splits, inEffect: standing.at(-1) ?? null };
  })();
}

/**
 * The books' splitter over what is stored now. It reads only who each mortgage
 * row is filed to and on what day, under the classification that stands.
 */
export function splitterOf(db: Database): MortgageSplitter {
  const rows = (
    db
      .prepare(
        `SELECT statement_rows.date, current_classifications.person_id
         FROM statement_rows
         JOIN current_classifications ON current_classifications.row_id = statement_rows.id
         WHERE current_classifications.bucket = 'mortgage'`,
      )
      .all() as { date: string; person_id: string | null }[]
  ).map((row) => ({ date: row.date, personId: row.person_id }));
  return new MortgageSplitter(knownPeople(db), rows, retirementsOf(db), splitHistoryOf(db));
}

function sameShares(a: readonly MortgageSplitPart[], b: readonly MortgageSplitPart[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (share, index) =>
        share.personId === b[index]?.personId &&
        share.partsPerMillion === b[index]?.partsPerMillion,
    )
  );
}

/**
 * Files a split from `request.effectiveFrom`, by `by`, superseding the one that
 * stands for that day. The same split filed again for its day is one filing.
 * Shares that do not name exactly the people the books hold on the day are
 * `MORTGAGE_SHARES_WRONG_PEOPLE`.
 */
export function fileSplit(
  db: Database,
  request: MortgageSplitRequest,
  by: string,
  now: Date,
): MortgageSplit {
  return db
    .transaction(() => {
      const shares =
        request.mode === "shares"
          ? request.shares
              .map((part) => ({ personId: part.personId, partsPerMillion: part.partsPerMillion }))
              .toSorted((a, b) => (a.personId < b.personId ? -1 : 1))
          : [];
      if (request.mode === "shares") {
        const total = shares.reduce((sum, part) => sum + part.partsPerMillion, 0);
        if (total !== PARTS_PER_MILLION) {
          throw new AppError("BAD_REQUEST", "The parts sum to exactly 1 000 000.");
        }
        const held = splitterOf(db).heldOn(request.effectiveFrom);
        const named = shares.map((part) => part.personId);
        if (named.length !== held.length || named.some((id, index) => id !== held[index])) {
          throw new AppError("MORTGAGE_SHARES_WRONG_PEOPLE", undefined, {
            details: { effectiveFrom: request.effectiveFrom, people: held },
          });
        }
      }

      const [earlier] = readSplits(db, "WHERE effective_from = ?", request.effectiveFrom);
      if (
        earlier !== undefined &&
        earlier.mode === request.mode &&
        sameShares(earlier.shares, shares)
      ) {
        return earlier;
      }
      const result = db
        .prepare(
          `INSERT INTO mortgage_splits (effective_from, mode, supersedes, entered_at, entered_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(request.effectiveFrom, request.mode, earlier?.id ?? null, now.toISOString(), by);
      const splitId = Number(result.lastInsertRowid);
      const insertShare = db.prepare(
        "INSERT INTO mortgage_split_shares (split_id, person_id, parts_per_million) VALUES (?, ?, ?)",
      );
      for (const part of shares) insertShare.run(splitId, part.personId, part.partsPerMillion);
      const [stored] = readSplits(db, "WHERE id = ?", splitId);
      if (stored === undefined) throw new AppError("INTERNAL", "A filed split did not read back.");
      return stored;
    })
    .immediate();
}
