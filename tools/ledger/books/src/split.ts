/**
 * How the mortgage bucket's joint rows are split between people (lg-63).
 *
 * The household chooses, from a date, one of three modes, in records that are
 * appended and never edited (`docs/00-ANALYSIS.md` §4):
 *
 * - **`shares`**: the parts the record names, in parts per million.
 * - **`equal`**: one part each for the people the books hold on the row's date.
 * - **`ratio`**: the ratio in effect on the row's date (`ratioInEffect`), its
 *   shares as they were confirmed — so a corrected salary, which never moves a
 *   confirmed ratio, never moves the mortgage either. A row dated before any
 *   ratio is split equally, and says so (`noRatio`).
 *
 * No record is `equal`, from the first row. **Each joint row is split by the
 * record in effect on its own date**, so a record filed from a later date never
 * moves an earlier payment, and neither does a person added later.
 *
 * **Who the books hold on a date.** People change only at a close (lg-23,
 * `confirmRatio` in `api`), so a ratio in effect on the date names them. Before
 * the first ratio they are the first ratio's people — the first period's, which
 * runs from the beginning — or, in books with no ratio at all, everyone the
 * caller lists; and in both cases anyone a row of the bucket has named by that
 * date. A person retired from the books on the date (lg-35) is not held.
 *
 * **A retirement under any mode** (owner, 2026-10-20): from the day it takes
 * effect, the retired person's part goes to the people who remain in proportion
 * to their own parts, until a new record is filed. Under `equal` that is lg-35's
 * rule as it was; under `ratio` the ratio confirmed at the close already names
 * only those who remain. Should every part that remains be zero, the rest split
 * equally; should nobody named remain, the row is split as if nobody had retired,
 * rather than left unattributed, which is what `JointTotals` did before.
 *
 * **The odd cent.** A split is a set of people with a weight each, reduced by
 * their greatest common divisor, so 50/50 by shares and `equal` between the same
 * two are one split. Joint rows are summed per split, and **each sum is split
 * once**, never row by row: whole cents truncated towards zero, and the cents
 * left over one each to the largest remainders, a tie to the person whose id
 * sorts first. For one split held throughout, that is exactly what one split of
 * the cumulative total gives, so a run of odd payments never drifts a cent each
 * time towards one person; for equal parts it is `splitCents`. A split that
 * returns — a person who left and came back, a mode filed and filed again — sums
 * into the same total, as lg-35 had it for a return.
 */

import type { MortgageSplitMode, MortgageSplitOn, MortgageSplitPart } from "@ledger/contract";
import { retiredOn } from "./people.ts";
import type { RetirementInput } from "./people.ts";
import { PARTS_PER_MILLION, ratioInEffect } from "./ratio.ts";

/** A split record as the books read it. */
export interface MortgageSplitInput {
  /** `yyyy-mm-dd`: the first day it holds. */
  effectiveFrom: string;
  mode: MortgageSplitMode;
  /** For `shares`, each person's part, summing to 1 000 000; empty otherwise. */
  shares: readonly MortgageSplitPart[];
}

/** A confirmed ratio, as far as the split needs it. */
export interface RatioInput {
  effectiveFrom: string;
  shares: readonly MortgageSplitPart[];
}

/** What decides a joint row's split besides the retirements: the records that stand, any order. */
export interface SplitHistory {
  ratios: readonly RatioInput[];
  splits: readonly MortgageSplitInput[];
}

/** No ratio and no split record: every joint row equally, between everyone listed and named. */
export const NO_SPLIT_HISTORY: SplitHistory = { ratios: [], splits: [] };

/** People with a weight each, in id order, every weight above zero and their divisor reduced out. */
type Weights = readonly (readonly [personId: string, weight: number])[];

/** A split, ready to sum rows under and to show. */
export interface SplitRule {
  /** The same for two rules that split alike, whatever mode or record gave them. */
  key: string;
  weights: Weights;
  split: MortgageSplitOn;
}

/** What a split looks like to a person: the mode, and what each takes. Two equal identities read alike. */
function identityOf(rule: SplitRule): string {
  return `${rule.split.mode}\n${String(rule.split.noRatio)}\n${rule.key}`;
}

function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** One part each for whoever `parts` names, whatever their weight. */
function everyOne(parts: readonly (readonly [string, number])[]): (readonly [string, number])[] {
  return parts.map(([id]) => [id, 1] as const);
}

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a, b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function reduced(parts: readonly (readonly [string, number])[]): Weights {
  const kept = parts
    .filter(([, weight]) => weight > 0)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const divisor = kept.reduce((held, [, weight]) => gcd(held, BigInt(weight)), 0n);
  if (divisor === 0n) return [];
  return kept.map(([personId, weight]) => [personId, Number(BigInt(weight) / divisor)] as const);
}

/**
 * `cents` split by `weights`, as whole cents in the weights' order: each takes
 * the exact share truncated towards zero, and the cents left over go one each to
 * the largest remainders, a tie to the earlier. With equal weights that is
 * `splitCents`. In `bigint`, so no total is large enough to lose a digit.
 */
export function apportion(cents: number, weights: Weights): number[] {
  const total = weights.reduce((sum, [, weight]) => sum + BigInt(weight), 0n);
  if (total === 0n) return weights.map(() => 0);
  const amount = BigInt(cents);
  const exact = weights.map(([, weight]) => {
    const scaled = amount * BigInt(weight);
    return { whole: scaled / total, remainder: scaled % total };
  });
  const left = amount - exact.reduce((sum, share) => sum + share.whole, 0n);
  const step = left < 0n ? -1n : 1n;
  const ranked = exact
    .map((share, index) => ({ remainder: magnitude(share.remainder), index }))
    .toSorted((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const extra = new Set(ranked.slice(0, Number(magnitude(left))).map((share) => share.index));
  return exact.map((share, index) => Number(share.whole + (extra.has(index) ? step : 0n)));
}

function keyOf(weights: Weights): string {
  return weights.map(([personId, weight]) => `${personId}:${String(weight)}`).join("\n");
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].toSorted();
}

/**
 * Answers, for any date, how a joint row of the mortgage bucket dated on it is
 * split. Built once over the bucket's rows and the records, and asked per row:
 * `mortgageAsOf` and `mortgageOwnSeries` both ask it, so they stay one rule.
 */
export class MortgageSplitter {
  readonly #people: readonly string[];
  readonly #firstNamed = new Map<string, string>();
  readonly #retirements: readonly RetirementInput[];
  readonly #history: SplitHistory;
  readonly #firstRatio: RatioInput | null;
  readonly #rules = new Map<string, SplitRule>();

  /**
   * `people` are everyone the books list; `rows` the bucket's rows, any order —
   * a row filed to a person names them from its date; `retirements` the books'
   * (lg-35), oldest first.
   */
  constructor(
    people: readonly string[],
    rows: readonly { date: string; personId: string | null }[],
    retirements: readonly RetirementInput[],
    history: SplitHistory,
  ) {
    this.#people = people;
    for (const row of rows) {
      if (row.personId === null) continue;
      const first = this.#firstNamed.get(row.personId);
      if (first === undefined || row.date < first) this.#firstNamed.set(row.personId, row.date);
    }
    this.#retirements = retirements;
    this.#history = history;
    this.#firstRatio = history.ratios.reduce<RatioInput | null>(
      (first, ratio) =>
        first === null || ratio.effectiveFrom < first.effectiveFrom ? ratio : first,
      null,
    );
  }

  /**
   * The people the books hold on `date`, in id order: the ratio in effect's, or
   * before any the first ratio's or everyone listed, with anyone a row has named
   * by then — less anyone retired on it. Should that leave nobody, everyone the
   * first step gave.
   */
  heldOn(date: string): string[] {
    const ratio = ratioInEffect(this.#history.ratios, date);
    const held =
      ratio !== null
        ? ratio.shares.map((share) => share.personId)
        : [
            ...(this.#firstRatio?.shares.map((share) => share.personId) ?? this.#people),
            ...[...this.#firstNamed].filter(([, first]) => first <= date).map(([id]) => id),
          ];
    const retired = retiredOn(this.#retirements, date);
    const inThen = held.filter((id) => !retired.has(id));
    return sortedIds(inThen.length === 0 ? held : inThen);
  }

  /** How a joint row dated `date` is split. */
  on(date: string): SplitRule {
    const cached = this.#rules.get(date);
    if (cached !== undefined) return cached;

    const record = ratioInEffect(this.#history.splits, date);
    const mode = record?.mode ?? "equal";
    const ratio = mode === "ratio" ? ratioInEffect(this.#history.ratios, date) : null;
    const noRatio = mode === "ratio" && ratio === null;
    const named: (readonly [string, number])[] =
      mode === "shares"
        ? (record?.shares ?? []).map((part) => [part.personId, part.partsPerMillion] as const)
        : ratio !== null
          ? ratio.shares.map((share) => [share.personId, share.partsPerMillion] as const)
          : this.heldOn(date).map((id) => [id, 1] as const);

    // A retired person's part goes to those who remain, pro rata (owner, 2026-10-20).
    const retired = retiredOn(this.#retirements, date);
    const remaining = named.filter(([id]) => !retired.has(id));
    let weights = reduced(remaining);
    if (weights.length === 0) weights = reduced(everyOne(remaining));
    if (weights.length === 0) weights = reduced(named);
    if (weights.length === 0) weights = reduced(everyOne(named));

    const parts = apportion(PARTS_PER_MILLION, weights);
    const rule: SplitRule = {
      key: keyOf(weights),
      weights,
      split: {
        mode,
        effectiveFrom: record?.effectiveFrom ?? null,
        noRatio,
        parts: weights.map(([personId], index) => ({
          personId,
          partsPerMillion: parts[index] ?? 0,
        })),
      },
    };
    this.#rules.set(date, rule);
    return rule;
  }

  /** Whether a joint row on `date` splits differently from one on `before`, as a person would read it. */
  changedBetween(before: string, date: string): boolean {
    return identityOf(this.on(before)) !== identityOf(this.on(date));
  }
}

/**
 * The bucket's joint rows, summed per split, each sum split once (the odd cent,
 * above). Replaces lg-35's `JointTotals`, whose parts were keyed on who was
 * retired: a split's weights now say that and the mode besides.
 */
export class JointSplit {
  readonly #sums = new Map<string, { weights: Weights; cents: number }>();

  add(rule: SplitRule, cents: number): void {
    const sum = this.#sums.get(rule.key) ?? { weights: rule.weights, cents: 0 };
    sum.cents += cents;
    this.#sums.set(rule.key, sum);
  }

  /** Everyone any sum gives a part to, in id order: the caller reports each of them. */
  people(): string[] {
    return sortedIds([...this.#sums.values()].flatMap((sum) => sum.weights.map(([id]) => id)));
  }

  /** Each of `ids`' part of the joint rows, `ids` in id order and holding `people()`. */
  sharesOf(ids: readonly string[]): number[] {
    const position = new Map(ids.map((id, index) => [id, index]));
    const shares = ids.map(() => 0);
    for (const { weights, cents } of this.#sums.values()) {
      for (const [index, share] of apportion(cents, weights).entries()) {
        const at = position.get(weights[index]?.[0] ?? "");
        if (at !== undefined) shares[at] = (shares[at] ?? 0) + share;
      }
    }
    return shares;
  }
}
