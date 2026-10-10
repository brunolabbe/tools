/**
 * `fromHistory` — what a person said the last times a description came up (lg-16),
 * and `autoFile`, which files a row on it with nobody tapping (lg-17).
 *
 * A row no rule claims has usually been answered before: the same description,
 * filed by a person under a person and a bucket. That is a suggestion a person
 * can take in one tap, and nothing more — nothing is filed from it without the
 * tap (`00-ANALYSIS.md` §3).
 *
 * **Only a person's answers count.** The caller passes the classifications whose
 * `source` is `manual` or `accepted`; one a rule applied is not an answer, it is
 * the rule talking, and a rule is already offered as a suggestion by `classify`.
 * Descriptions are compared as `classify` compares them — case, accents and runs
 * of whitespace do not matter — and the amount and category do not enter at all:
 * a description is what the bank says the row is.
 *
 * **`autoFile` files only within limits** (`00-ANALYSIS.md` §3, amended
 * 2026-10-06): the latest three answers for the description agree, and the
 * row's amount fits theirs. A transfer is a question at any amount nobody has
 * answered before; any other debit may drift by a fifth. Everything else is the
 * inbox's, with `fromHistory`'s answer offered there as before.
 *
 * Pure, and generic over the answer so the caller's own fields come back.
 */

import { normalize } from "./classify.ts";

/** A person-given classification of some stored row, with the row's description. */
export interface HistoryAnswer<B extends string = string> {
  /** The classification record's id. Larger is later, which is what "latest" means. */
  id: number;
  /** The description of the row that was classified. */
  description: string;
  bucket: B;
  personId: string | null;
  /** The classified row's amount, which `autoFile` weighs a new row's against (lg-17). */
  amountCents: number;
}

export interface HistorySuggestion<B extends string = string> {
  bucket: B;
  personId: string | null;
  /**
   * How many of the most recent answers give this same answer, counting back
   * from the latest and stopping at the first that differs: "the last 3 times".
   */
  times: number;
}

/**
 * The latest answer for `row`'s description, or `null` when none was ever given.
 * `answers` may be in any order and may include other descriptions.
 */
export function fromHistory<B extends string>(
  row: { description: string },
  answers: readonly HistoryAnswer<B>[],
): HistorySuggestion<B> | null {
  const same = latestFirst(row, answers);
  const [latest] = same;
  if (latest === undefined) return null;
  let times = 0;
  for (const answer of same) {
    if (answer.bucket !== latest.bucket || answer.personId !== latest.personId) break;
    times += 1;
  }
  return { bucket: latest.bucket, personId: latest.personId, times };
}

/** The answers for `row`'s description, latest first: one folding for both functions. */
function latestFirst<B extends string>(
  row: { description: string },
  answers: readonly HistoryAnswer<B>[],
): HistoryAnswer<B>[] {
  const wanted = normalize(row.description);
  return answers
    .filter((answer) => normalize(answer.description) === wanted)
    .toSorted((a, b) => b.id - a.id);
}

/** The part of a stored row `autoFile` weighs. */
export interface AutoFilableRow {
  description: string;
  /** Desjardins' own category: `Virements` makes a debit a transfer. */
  category: string;
  amountCents: number;
}

/**
 * Why history did not file a row. `too-few`: fewer than three answers for the
 * description. `disagree`: the latest three do not all name the same person and
 * bucket. `amount`: they do, and the row's amount does not fit theirs.
 */
export type AutoFileRefusal = "too-few" | "disagree" | "amount";

export type AutoFiling<B extends string = string> =
  | {
      kind: "filed";
      bucket: B;
      personId: string | null;
      /** The ids of the three answers it rests on, latest first. */
      restsOn: [number, number, number];
    }
  | { kind: "ask"; reason: AutoFileRefusal };

/**
 * Whether history files `row` by itself, and on which three answers (lg-17).
 *
 * The caller decides that the row is history's to file at all — only a row no
 * rule's pattern matches is — and passes only a person's answers: an automatic
 * filing is never one, so history cannot reinforce itself.
 *
 * - **The latest three answers** for the description name the same person and
 *   bucket. Folded as `fromHistory` folds, latest by `id`.
 * - **A transfer** — a credit, or a row whose Desjardins category folds to
 *   `virements` — is filed only at an amount, to the cent, one of those three
 *   rows had.
 * - **Any other debit** is filed within ±20 % of the latest of the three, with
 *   the same sign, compared in integer cents as `5 × |a − b| ≤ |b|`: a float
 *   must not decide which side of the line a cent falls on.
 */
export function autoFile<B extends string>(
  row: AutoFilableRow,
  answers: readonly HistoryAnswer<B>[],
): AutoFiling<B> {
  const [latest, second, third] = latestFirst(row, answers);
  if (latest === undefined || second === undefined || third === undefined) {
    return { kind: "ask", reason: "too-few" };
  }
  const three = [latest, second, third];
  const agree = three.every(
    (answer) => answer.bucket === latest.bucket && answer.personId === latest.personId,
  );
  if (!agree) return { kind: "ask", reason: "disagree" };
  if (!amountFits(row, three, latest)) return { kind: "ask", reason: "amount" };
  return {
    kind: "filed",
    bucket: latest.bucket,
    personId: latest.personId,
    restsOn: [latest.id, second.id, third.id],
  };
}

const TRANSFERS = normalize("Virements");

function amountFits(
  row: AutoFilableRow,
  three: readonly HistoryAnswer[],
  latest: HistoryAnswer,
): boolean {
  const transfer = row.amountCents > 0 || normalize(row.category) === TRANSFERS;
  if (transfer) return three.some((answer) => answer.amountCents === row.amountCents);
  const before = latest.amountCents;
  return (
    Math.sign(row.amountCents) === Math.sign(before) &&
    5 * Math.abs(row.amountCents - before) <= Math.abs(before)
  );
}
