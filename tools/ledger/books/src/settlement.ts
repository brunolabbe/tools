/**
 * Who tops up the buffer, and by how much (lg-6): the matching rule, computed
 * cumulatively, with charges (`docs/00-ANALYSIS.md` §5, _Charges between the
 * two_).
 *
 * With A the first person of the ratio and r their share:
 *
 * ```
 * net = r × (A + B) − A + (charges A owes B) − (charges B owes A)
 *       (net > 0: A owes B; net < 0: B owes A)
 * into the buffer: A deposits net / (1 − r), or B deposits −net / r
 * directly:        the same net, as a transfer between the two
 * ```
 *
 * With no charges, A's deposit is `B × r / (1 − r) − A`: the matching rule.
 * Dividing by the recipient's share is what makes a deposit into shared money
 * worth exactly the debt to the person it settles, because the payer keeps
 * their own share of whatever they put in.
 *
 * **Exact until the end.** A ratio is parts per million and money is cents, so
 * `r × cents` is a whole number of millionths of a cent. Everything is summed
 * in those, as `bigint`, and rounded **once**, half-up, on the two figures
 * returned (§5, _Numbers_). Nothing intermediate is ever a float.
 *
 * **A ratio change is a boundary, and what is owed across it is money.** `net`
 * is linear in every contribution and every charge, so the net of a long
 * stretch is the sum of the nets of its parts. Each stretch is weighed at its
 * own ratio, the nets are added as money, and only the final net is divided by
 * the recipient's share at the ratio in effect now. What was owed before the
 * boundary therefore does not change when the ratio does (§5, the last bullet of
 * _Numbers_).
 */

import { AppError } from "@ledger/contract";
import { PARTS_PER_MILLION } from "./ratio.ts";
import type { Share } from "./ratio.ts";

/**
 * The formula a settlement was computed with. `v1` and `v2` are the workbook's
 * two historical formulas, which lg-7 imports as they happened; `v3` is this
 * file: the matching rule over cumulative contributions, with charges, each
 * stretch at its own ratio, divided by the recipient's share and rounded once.
 */
export const CURRENT_FORMULA = "v3";

/** What one person has put toward shared costs: shared card lines and buffer deposits. */
export interface PersonCents {
  personId: string;
  cents: number;
}

/** An amount one person owes the other outright: it was entirely theirs. */
export interface Charge {
  /** Who consumed it, and owes its full price. */
  owedBy: string;
  /** Who paid for it. */
  owedTo: string;
  cents: number;
}

/** Contributions and charges weighed at one ratio. */
export interface Stretch {
  ratio: readonly Share[];
  contributions: readonly PersonCents[];
  charges: readonly Charge[];
}

export interface Settlement {
  formula: typeof CURRENT_FORMULA;
  /** Who owes, or `null` when the two stand at the ratio to within half a cent. */
  payerId: string | null;
  recipientId: string | null;
  /**
   * What the payer deposits into the buffer, rounded half-up once; `0` when
   * nobody owes. `null` when the recipient's share is zero: a deposit into
   * shared money would never reach them, so only a direct transfer settles it.
   */
  depositCents: number | null;
  /** The same debt paid directly to the recipient instead, rounded half-up once. */
  netCents: number;
}

const MILLION = BigInt(PARTS_PER_MILLION);

/** The ratio's two shares in id order, checked: two people, summing to one million. */
function pairOf(ratio: readonly Share[]): [Share, Share] {
  const [first, second] = ratio.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  if (ratio.length !== 2 || first === undefined || second === undefined) {
    throw new AppError("BAD_REQUEST", "A settlement is between the two people of a ratio.");
  }
  if (first.partsPerMillion + second.partsPerMillion !== PARTS_PER_MILLION) {
    throw new AppError("INTERNAL", "A ratio's two shares do not sum to one million.");
  }
  return [first, second];
}

function cents(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new AppError("BAD_REQUEST", "An amount is a whole number of cents.");
  }
  return BigInt(value);
}

/**
 * What `first` owes `second` over one stretch, in millionths of a cent:
 * `r × (A + B) − A`, plus the charges between them. Negative when `second` owes.
 */
function owedMicro(stretch: Stretch, first: string, second: string): bigint {
  const [a, b] = pairOf(stretch.ratio);
  if (a.personId !== first || b.personId !== second) {
    throw new AppError(
      "BAD_REQUEST",
      "Every ratio in a settlement is between the same two people.",
    );
  }
  const firstShare = BigInt(a.partsPerMillion);
  const secondShare = BigInt(b.partsPerMillion);
  let owed = 0n;
  for (const { personId, cents: amount } of stretch.contributions) {
    // A's own x moves the net by r·x − x = −(1 − r)·x; B's y by r·y.
    if (personId === first) owed -= secondShare * cents(amount);
    else if (personId === second) owed += firstShare * cents(amount);
    else throw new AppError("BAD_REQUEST", "A contribution names someone the ratio does not.");
  }
  for (const charge of stretch.charges) {
    if (charge.owedBy === first && charge.owedTo === second) owed += MILLION * cents(charge.cents);
    else if (charge.owedBy === second && charge.owedTo === first) {
      owed -= MILLION * cents(charge.cents);
    } else throw new AppError("BAD_REQUEST", "A charge is between the two people of the ratio.");
  }
  return owed;
}

/** `numerator / denominator`, both positive, rounded half-up to a whole number. */
function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/**
 * The settlement over every stretch since the two were last even, each weighed
 * at its own ratio, divided by the recipient's share in `ratio` — the ratio in
 * effect at the end of the period being closed.
 */
export function settleStretches(
  stretches: readonly Stretch[],
  ratio: readonly Share[],
): Settlement {
  const [first, second] = pairOf(ratio);
  const owed = stretches.reduce(
    (sum, stretch) => sum + owedMicro(stretch, first.personId, second.personId),
    0n,
  );
  const nobody: Settlement = {
    formula: CURRENT_FORMULA,
    payerId: null,
    recipientId: null,
    depositCents: 0,
    netCents: 0,
  };
  if (owed === 0n) return nobody;
  const [payer, recipient] = owed > 0n ? [first, second] : [second, first];
  const magnitude = owed > 0n ? owed : -owed;
  const recipientShare = BigInt(recipient.partsPerMillion);
  // net / share = (micro / 1e6) / (ppm / 1e6) = micro / ppm.
  const depositCents = recipientShare === 0n ? null : roundHalfUp(magnitude, recipientShare);
  const netCents = roundHalfUp(magnitude, MILLION);
  // Less than half a cent owed is what paying a rounded figure leaves behind,
  // and it rounds to nothing. It names nobody: a payer at 0.00 would be asked to
  // deposit nothing, and the next close would expect that nothing. The deposit
  // is never smaller than the net, so a deposit of 0 means a net of 0 too.
  if (depositCents === 0 || (depositCents === null && netCents === 0)) return nobody;
  return {
    formula: CURRENT_FORMULA,
    payerId: payer.personId,
    recipientId: recipient.personId,
    depositCents,
    netCents,
  };
}

/** The settlement for contributions and charges all weighed at one ratio. */
export function settlement(
  contributions: readonly PersonCents[],
  charges: readonly Charge[],
  ratio: readonly Share[],
): Settlement {
  return settleStretches([{ ratio, contributions, charges }], ratio);
}
