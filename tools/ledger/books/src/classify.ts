/**
 * `classify` — which rule, if any, a row belongs to (lg-4).
 *
 * **A row takes a rule only on an exact match**, and an exact match is all of a
 * rule's own criteria holding at once: the whole description matches the pattern,
 * the category equals the rule's when it names one, the amount equals the rule's
 * when it names one. Nothing here is "close enough". A transfer that is not its
 * usual amount is a question for a person, not a guess (`00-ANALYSIS.md` §3).
 *
 * **The most specific rule takes a row** (lg-16). Rules matching a row exactly
 * are ranked by, in order, the more criteria they name beyond the pattern (a
 * fixed amount, a category), then the longer literal part of the pattern (its
 * characters other than `*`). A broad rule on account info can therefore live
 * beside a narrow one with a fixed amount, and the narrow one takes its rows.
 *
 * - **One rule at the top rank, or several level there with the same answer**
 *   (person, bucket and spending category): the row takes it — the newest of
 *   them, by `id`.
 * - **Several level at the top with different answers:** the row takes none.
 *   That is two answers with no reason to prefer either, and taking the first of
 *   them is how a row ends up in the wrong bucket with nobody having been asked.
 *   **A spending category is part of the answer** (lg-15): two rules that differ
 *   only in it would otherwise be settled by `id` with nobody having chosen, and
 *   "none" counts as a value, so a rule that names one and a level rule that
 *   names none ask too. It costs a question only where two rules are exactly as
 *   specific as each other and already disagree about the row.
 * - **A rule whose pattern and category match but whose fixed amount does not,
 *   and which would outrank the best exact match:** the row takes none
 *   (`differs`). A mortgage transfer at an unusual amount is a question, and a
 *   broad rule must not file it in silence. An exact match that outranks every
 *   such rule takes the row. **Only an amount miss asks:** a rule that names a
 *   category the row is not in carves that category out of the broad rule's
 *   reach and has no say over the rows outside it.
 * - **None matches exactly:** the row takes none.
 *
 * Whenever the row takes none the function says which rule is nearest, as a
 * *suggestion* — a person still has to take it. Nearest is, in order: the
 * fewest criteria the row fails, the smallest gap between the rule's fixed
 * amount and the row's, the most criteria the rule names, the longest literal
 * pattern. When two rules are still level there is no nearest, and the
 * suggestion is `null` rather than the older of two equals. For a `differs`
 * that an exact match did not prevent, the rule suggested is the nearest of the
 * outranking ones, the one that stopped the row being filed.
 *
 * Only a rule whose description pattern matches is a candidate. The pattern is
 * what a rule says a row *is*; a category or an amount on its own is far too
 * common to suggest from.
 *
 * Pure, and generic over the rule so that whatever the caller keeps on a rule —
 * who it assigns, which bucket — comes back untouched.
 */

import { fold } from "./months.ts";

/** The part of a rule that decides whether a row is its own. */
export interface MatchableRule {
  id: number;
  /** The description as the bank writes it; `*` is any run of characters. */
  descriptionPattern: string;
  /** Desjardins' own category, or `null` for any. */
  category: string | null;
  /** An exact amount in cents, or `null` for any. */
  amountCents: number | null;
  /**
   * The bucket the rule files a row under; two rules agree when this,
   * `personId` and `spendingCategoryId` do.
   */
  bucket: string;
  /** Whose the filed row is, or `null` for the joint account. */
  personId: string | null;
  /** The spending category the rule gives its rows; absent and `null` both mean none (lg-15). */
  spendingCategoryId?: number | null;
}

/** The part of a stored row a rule is judged against. */
export interface ClassifiableRow {
  category: string;
  description: string;
  amountCents: number;
}

export type RuleMatch<R extends MatchableRule> =
  | { kind: "classified"; rule: R }
  | {
      kind: "inbox";
      /**
       * `no-rule`: no pattern matches. `differs`: a pattern does, and the
       * category or the fixed amount does not, and no exact match outranks it
       * (against an exact match, only an amount miss counts).
       * `ambiguous`: several rules level at the top rank match exactly with
       * different answers.
       */
      reason: "no-rule" | "differs" | "ambiguous";
      suggestion: R | null;
      /**
       * The rules at the top rank among those that match exactly: two or more
       * only for `ambiguous`, and possibly one under `differs`, where a
       * narrower rule the row does not fit stopped it being filed.
       */
      matching: R[];
    };

/** Case, accents and runs of whitespace are not differences a rule should care about. */
export function normalize(text: string): string {
  return fold(text).replace(/\s+/gu, " ").trim();
}

/**
 * Whether `text` is exactly `pattern`, with `*` standing for any run of
 * characters. Written as the iterative two-pointer match rather than a regular
 * expression built from the pattern: a person types these, and several `*`
 * turned into `.*` is the shape that backtracks without end.
 */
export function matchesPattern(pattern: string, text: string): boolean {
  const wanted = normalize(pattern);
  const actual = normalize(text);
  let at = 0;
  let from = 0;
  let star = -1;
  let resume = 0;
  while (from < actual.length) {
    const next = wanted[at];
    if (next === "*") {
      star = at;
      at += 1;
      resume = from;
    } else if (next !== undefined && next === actual[from]) {
      at += 1;
      from += 1;
    } else if (star !== -1) {
      at = star + 1;
      resume += 1;
      from = resume;
    } else {
      return false;
    }
  }
  while (wanted[at] === "*") at += 1;
  return at === wanted.length;
}

interface Scored<R extends MatchableRule> {
  rule: R;
  /** How many of the rule's own criteria the row fails. */
  misses: number;
  /** Whether the rule names a category the row is not in. */
  categoryMiss: boolean;
  /** Whether the rule names an amount the row does not have. */
  amountMiss: boolean;
  /** How far the row's amount is from the rule's fixed one. */
  distance: number;
  /** How many criteria beyond the pattern the rule names. */
  named: number;
  /** How many characters of the pattern are not `*`. */
  literal: number;
}

function score<R extends MatchableRule>(rule: R, row: ClassifiableRow): Scored<R> {
  const categoryMiss =
    rule.category !== null && normalize(rule.category) !== normalize(row.category);
  const amountMiss = rule.amountCents !== null && rule.amountCents !== row.amountCents;
  return {
    rule,
    misses: Number(categoryMiss) + Number(amountMiss),
    categoryMiss,
    amountMiss,
    distance: rule.amountCents === null ? 0 : Math.abs(rule.amountCents - row.amountCents),
    named: Number(rule.category !== null) + Number(rule.amountCents !== null),
    literal: rule.descriptionPattern.replaceAll("*", "").length,
  };
}

/** Negative when `a` is nearer. Zero means level, which is not a winner. */
function nearer<R extends MatchableRule>(a: Scored<R>, b: Scored<R>): number {
  return (
    a.misses - b.misses || a.distance - b.distance || b.named - a.named || b.literal - a.literal
  );
}

/**
 * Negative when `a` is the more specific rule: the more criteria beyond the
 * pattern, then the longer literal. These are `score`'s own `named` and
 * `literal`, so there is one notion of "narrower", not two.
 */
function narrower<R extends MatchableRule>(a: Scored<R>, b: Scored<R>): number {
  return b.named - a.named || b.literal - a.literal;
}

/**
 * Two rules file a row the same way when they name the same person, bucket and
 * spending category. The last is the one line to change if a rule's spending
 * category should not be part of the answer (`classify.test.ts` pins it).
 */
function sameAnswer(a: MatchableRule, b: MatchableRule): boolean {
  return (
    a.bucket === b.bucket &&
    a.personId === b.personId &&
    (a.spendingCategoryId ?? null) === (b.spendingCategoryId ?? null)
  );
}

export function classify<R extends MatchableRule>(
  row: ClassifiableRow,
  rules: readonly R[],
): RuleMatch<R> {
  const candidates = rules
    .filter((rule) => matchesPattern(rule.descriptionPattern, row.description))
    .map((rule) => score(rule, row))
    .toSorted(nearer);

  const exact = candidates.filter((candidate) => candidate.misses === 0).toSorted(narrower);
  const [best] = exact;
  const top = best === undefined ? [] : exact.filter((c) => narrower(c, best) === 0);
  const matching = top.map((c) => c.rule);

  // A rule the row only nearly fits, but which says more than anything that fits
  // it, is the one whose question the row is: filing it under a broader rule
  // would be answering that question with nobody asked.
  // Only an amount is that question (§3): a rule naming a category carves that
  // category out, and the broad rule keeps every row outside it. So a candidate
  // outranks an exact match only when the amount is the one thing it misses.
  const outranking = candidates.filter((candidate) =>
    best === undefined
      ? candidate.misses > 0
      : candidate.amountMiss && !candidate.categoryMiss && narrower(candidate, best) < 0,
  );

  if (outranking.length > 0) {
    const [first, second] = outranking;
    return {
      kind: "inbox",
      reason: "differs",
      suggestion:
        first === undefined || (second !== undefined && nearer(first, second) === 0)
          ? null
          : first.rule,
      matching,
    };
  }

  if (best !== undefined && top.every((c) => sameAnswer(c.rule, best.rule))) {
    // Ids only grow, and a rule's newer version has a newer id.
    const newest = top.reduce((a, b) => (b.rule.id > a.rule.id ? b : a));
    return { kind: "classified", rule: newest.rule };
  }

  const [nearest, second] = candidates;
  const suggestion =
    nearest === undefined || (second !== undefined && nearer(nearest, second) === 0)
      ? null
      : nearest.rule;
  return {
    kind: "inbox",
    reason: candidates.length === 0 ? "no-rule" : exact.length > 0 ? "ambiguous" : "differs",
    suggestion,
    matching,
  };
}
