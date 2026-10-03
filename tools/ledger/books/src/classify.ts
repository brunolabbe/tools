/**
 * `classify` — which rule, if any, a row belongs to (lg-4).
 *
 * **A row takes a rule only on an exact match**, and an exact match is all of a
 * rule's own criteria holding at once: the whole description matches the pattern,
 * the category equals the rule's when it names one, the amount equals the rule's
 * when it names one. Nothing here is "close enough". A transfer that is not its
 * usual amount is a question for a person, not a guess (`00-ANALYSIS.md` §3).
 *
 * - **Exactly one rule matches exactly:** the row takes it.
 * - **None, or more than one:** the row takes none. Two rules matching one row
 *   is two answers, and taking the first of them is how a row ends up in the
 *   wrong bucket with nobody having been asked.
 *
 * Either way the function says which rule is nearest, as a *suggestion* — a
 * person still has to take it. Nearest is, in order: the fewest criteria the row
 * fails, the smallest gap between the rule's fixed amount and the row's, the
 * most criteria the rule names, the longest literal pattern. When two rules are
 * still level there is no nearest, and the suggestion is `null` rather than the
 * older of two equals.
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
       * category or the fixed amount does not. `ambiguous`: more than one rule
       * matches exactly.
       */
      reason: "no-rule" | "differs" | "ambiguous";
      suggestion: R | null;
      /** The rules that match exactly: two or more only for `ambiguous`. */
      matching: R[];
    };

/** Case, accents and runs of whitespace are not differences a rule should care about. */
function normalize(text: string): string {
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

export function classify<R extends MatchableRule>(
  row: ClassifiableRow,
  rules: readonly R[],
): RuleMatch<R> {
  const candidates = rules
    .filter((rule) => matchesPattern(rule.descriptionPattern, row.description))
    .map((rule) => score(rule, row))
    .toSorted(nearer);

  const matching = candidates.filter((candidate) => candidate.misses === 0).map((c) => c.rule);
  const [only] = matching;
  if (matching.length === 1 && only !== undefined) return { kind: "classified", rule: only };

  const [best, second] = candidates;
  const suggestion =
    best === undefined || (second !== undefined && nearer(best, second) === 0) ? null : best.rule;
  return {
    kind: "inbox",
    reason: candidates.length === 0 ? "no-rule" : matching.length > 1 ? "ambiguous" : "differs",
    suggestion,
    matching,
  };
}
