/**
 * `fromHistory` — what a person said the last times a description came up (lg-16).
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
  const wanted = normalize(row.description);
  const same = answers
    .filter((answer) => normalize(answer.description) === wanted)
    .toSorted((a, b) => b.id - a.id);
  const [latest] = same;
  if (latest === undefined) return null;
  let times = 0;
  for (const answer of same) {
    if (answer.bucket !== latest.bucket || answer.personId !== latest.personId) break;
    times += 1;
  }
  return { bucket: latest.bucket, personId: latest.personId, times };
}
