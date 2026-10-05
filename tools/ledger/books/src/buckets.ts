/**
 * What each bucket holds, and whose it is, as of a date (lg-5).
 *
 * Both are recomputed from the classified rows on every call and never stored
 * (`docs/00-ANALYSIS.md` §4, §9). Money is integer cents in and out.
 *
 * **The mortgage bucket is not shared money** (§4). Every cent in it is one
 * person's deposit that no payment has used yet, so its whole balance is
 * attributed: a row filed to a person is that person's, and a joint row — the
 * payment itself, or a rebate — is split in half between the two. With deposits
 * filed to people and payments joint, that is exactly
 * `own = deposits − ½ × payments`, and the own amounts sum to the balance with
 * nothing left over as "common".
 *
 * **The odd cent.** Half of an odd number of cents is not a number of cents. The
 * split is done **once, on the cumulative joint total**, never per payment, so a
 * run of odd payments cannot drift a cent each time towards one person; and the
 * cent that does not divide goes, by a fixed rule, to **the person whose id sorts
 * first** — they bear the extra cent of a payment, or take the extra cent of a
 * rebate. Any rule would do; this one needs no state and gives the same answer
 * to every reader.
 *
 * **The buffer** (the current-expenses bucket) is shared money, owned at the
 * ratio, and lg-6 settles it. What it needs from here is the balance and each
 * person's cumulative contributions: the sum of the rows filed to that person.
 * Payments out of the buffer are joint rows and are not anyone's contribution;
 * a row filed to a person that took money *out* — a mistaken transfer returned
 * to them — counts against their contributions, since that money is theirs again.
 */

import { AppError } from "@ledger/contract";
import type { Bucket, OwnMoney } from "@ledger/contract";

/** A stored row as the books see it: when, how much, and how it is classified. */
export interface FiledRow {
  /** `yyyy-mm-dd`. */
  date: string;
  amountCents: number;
  bucket: Bucket;
  /** `null` is joint. */
  personId: string | null;
}

/** The person with the most of their own money in the bucket, and by how much. */
export interface Lead {
  personId: string;
  byCents: number;
}

export interface MortgagePosition {
  balanceCents: number;
  /** One entry per person, in id order. They sum to `balanceCents`, to the cent. */
  own: OwnMoney[];
  /** `null` when the two are level, or when there are not exactly two people. */
  lead: Lead | null;
}

export interface Contribution {
  personId: string;
  contributedCents: number;
}

export interface BufferPosition {
  balanceCents: number;
  /** One entry per person, in id order. */
  contributions: Contribution[];
}

/** Rows of one bucket dated on or before `asOf`, compared as `yyyy-mm-dd` text. */
function inBucket(rows: readonly FiledRow[], bucket: Bucket, asOf: string): FiledRow[] {
  return rows.filter((row) => row.bucket === bucket && row.date <= asOf);
}

/**
 * The people to report on: those named, and anyone a row names besides. A row
 * filed to someone the caller did not list still has to land somewhere, or the
 * parts would not sum to the balance.
 */
function everyone(people: readonly string[], rows: readonly FiledRow[]): string[] {
  const ids = new Set(people);
  for (const row of rows) if (row.personId !== null) ids.add(row.personId);
  return [...ids].toSorted();
}

function sumOf(rows: readonly FiledRow[]): number {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * `total` split between `count` people, as whole cents. Each takes the share
 * truncated towards zero, and the cents that do not divide go one each to the
 * first people in order — so with two people and an odd total, the first takes
 * the odd cent whichever sign it has.
 */
export function splitCents(total: number, count: number): number[] {
  if (count < 1) return [];
  const share = Math.trunc(total / count);
  const left = total - share * count;
  const step = Math.sign(left);
  return Array.from({ length: count }, (_, index) =>
    index < Math.abs(left) ? share + step : share,
  );
}

/** Each person's own money in the mortgage bucket as of `asOf`, and who is ahead. */
export function mortgageAsOf(
  rows: readonly FiledRow[],
  people: readonly string[],
  asOf: string,
): MortgagePosition {
  const filed = inBucket(rows, "mortgage", asOf);
  const ids = everyone(people, filed);
  const halves = splitCents(sumOf(filed.filter((row) => row.personId === null)), ids.length);
  const own = ids.map((personId, index) => ({
    personId,
    ownCents: sumOf(filed.filter((row) => row.personId === personId)) + (halves[index] ?? 0),
  }));
  const balanceCents = sumOf(filed);

  // The model's promise (§4): nothing in the bucket is left unattributed. It
  // holds by construction; if it ever does not, the screen must not show it.
  const attributed = own.reduce((sum, person) => sum + person.ownCents, 0);
  if (attributed !== balanceCents) {
    throw new AppError("INTERNAL", "The mortgage bucket's parts do not sum to its balance.");
  }
  return { balanceCents, own, lead: leadOf(own) };
}

function leadOf(own: readonly OwnMoney[]): Lead | null {
  const [first, second] = own;
  if (own.length !== 2 || first === undefined || second === undefined) return null;
  if (first.ownCents === second.ownCents) return null;
  const [ahead, behind] = first.ownCents > second.ownCents ? [first, second] : [second, first];
  return { personId: ahead.personId, byCents: ahead.ownCents - behind.ownCents };
}

/** The buffer's balance as of `asOf`, and what each person has put into it by then. */
export function bufferAsOf(
  rows: readonly FiledRow[],
  people: readonly string[],
  asOf: string,
): BufferPosition {
  const filed = inBucket(rows, "current-expenses", asOf);
  return {
    balanceCents: sumOf(filed),
    contributions: everyone(people, filed).map((personId) => ({
      personId,
      contributedCents: sumOf(filed.filter((row) => row.personId === personId)),
    })),
  };
}
