/**
 * Who tops up the buffer, and by how much (lg-6): the matching rule, computed
 * cumulatively, with charges (`docs/00-ANALYSIS.md` §5, _Charges between the
 * two_), between any number of people (lg-23).
 *
 * With A the first person of a two-person ratio and r their share:
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
 * **Any number of people** (lg-23, Question 1 A). Per person, with `r_i` a
 * share and `e_i` what they put in, plus the charges owed to them, less the
 * charges they owe: `net_i = r_i × Σe − e_i`. The nets sum to zero, and for two
 * people they are exactly `net` and `−net` above. Everyone short tops up until
 * every contribution stands at the ratio: person i deposits `net_i + r_i × K`,
 * where `K = max(−net_i / r_i)` over those with a share is the smallest top-up
 * that asks nobody for a negative amount, so the person furthest ahead for
 * their share deposits nothing. For two people that is `net / (1 − r)` from A,
 * or `−net / r` from B: the same figure. The direct form pays each net as
 * transfers from those who owe to those owed, at most one fewer than the people.
 *
 * **Exact until the end.** A ratio is parts per million and money is cents, so
 * `r × cents` is a whole number of millionths of a cent. Everything is summed
 * in those, as `bigint`, and rounded **once**, half-up, on each figure
 * returned (§5, _Numbers_). Nothing intermediate is ever a float. Deposits are
 * rounded together, so that after them every contribution stands at its share
 * to within a cent (`roundDeposits`); for one deposit that is half-up.
 *
 * **A ratio change is a boundary, and what is owed across it is money.** `net`
 * is linear in every contribution and every charge, so the net of a long
 * stretch is the sum of the nets of its parts. Each stretch is weighed at its
 * own ratio, the nets are added as money, and only the final nets are divided
 * by the shares of the ratio in effect now. What was owed before the boundary
 * therefore does not change when the ratio does (§5, the last bullet of
 * _Numbers_). A person a stretch's ratio does not name has a share of zero in
 * it, so a person who joins or leaves at a boundary adds nothing to the
 * stretches they were not part of.
 *
 * **A charge to the pot** (lg-91, the owner's answer of 2026-11-01). An item on
 * a joint-account row's receipt can be one person's: the pot paid for it, and
 * the members fund the pot at their ratios. Had X paid for it themselves, X
 * would bear all of its cost `c`; through the pot, each member `i` bore
 * `r_i × c` of it. So X owes each other member `r_i × c`, which totals
 * `(1 − r_X) × c`, at the ratio of the stretch the charge is dated in. In
 * `netsOf` that is `−r_i × c` on each other member's net and the sum of those,
 * `+(1 − r_X) × c`, on X's. A share is parts per million and `c` is cents, so
 * each term is a whole number of millionths of a cent: exact, and the nets
 * still sum to zero with nothing to round.
 *
 * ```
 * r = 0.5 alex, 0.3 blair, 0.2 casey; the pot paid 100.00 for casey's items
 *   alex  −50.00   owed 0.5 × 100.00
 *   blair −30.00   owed 0.3 × 100.00
 *   casey +80.00   owes (1 − 0.2) × 100.00
 * into the buffer: casey deposits 100.00, the items' cost, while alex and
 *                  blair, each standing at their share already, deposit nothing
 * directly:        casey pays alex 50.00 and blair 30.00
 * ```
 *
 * A charge between two people moves money from one to the other and leaves Σe
 * alone; a charge to the pot does the same, spread over everyone the stretch's
 * ratio names. A person the ratio does not name has no share of it, so a charge
 * to the pot for them is owed whole, to those who have one.
 */

import { AppError } from "@ledger/contract";
import type { SettlementDeposit, SettlementTransfer } from "@ledger/contract";
import { PARTS_PER_MILLION } from "./ratio.ts";
import type { Share } from "./ratio.ts";

/**
 * The formula a settlement was computed with. `v1` and `v2` are the workbook's
 * two historical formulas, which lg-7 imports as they happened; `v3` is this
 * file: the matching rule over cumulative contributions, with charges, each
 * stretch at its own ratio, divided by the shares in effect at the close and
 * rounded once. Between two people lg-23's generalisation is the same figure to
 * the cent, so it stays `v3`.
 */
export const CURRENT_FORMULA = "v3";

/** What one person has put toward shared costs: shared card lines and buffer deposits. */
export interface PersonCents {
  personId: string;
  cents: number;
}

/** An amount one person owes another outright: it was entirely theirs. */
export interface Charge {
  /** Who consumed it, and owes its full price. */
  owedBy: string;
  /** Who paid for it. */
  owedTo: string;
  cents: number;
}

/**
 * An amount one person owes the pot (lg-91): the joint account paid for
 * something that was entirely theirs. It is owed to the other members at the
 * stretch's ratio, never to one person.
 */
export interface PotCharge {
  /** Who consumed it. */
  owedBy: string;
  cents: number;
}

/** Contributions and charges weighed at one ratio. */
export interface Stretch {
  ratio: readonly Share[];
  contributions: readonly PersonCents[];
  charges: readonly Charge[];
  /** Charges to the pot (lg-91); absent is none. */
  potCharges?: readonly PotCharge[];
}

/** A settlement between two people, as lg-6 records it. */
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

/** A settlement between any number of people (lg-23). */
export interface HouseholdSettlement {
  formula: typeof CURRENT_FORMULA;
  /** Everyone it settles between, in id order: the closing ratio's people, and anyone a stretch names. */
  people: string[];
  /**
   * Into the buffer, in id order, each more than nothing; empty when nobody
   * owes. `null` when someone owed has no share in the closing ratio: a deposit
   * into shared money would never reach them, so only the transfers settle it.
   */
  deposits: SettlementDeposit[] | null;
  /**
   * The same, paid directly: from those who owe to those owed, at most one
   * fewer than the people, each more than nothing — but for one case. Between
   * two people, when only a transfer can settle it and it rounds to nothing,
   * the one transfer is of 0 cents: lg-6 named the payer and the recipient there.
   */
  transfers: SettlementTransfer[];
}

const MILLION = BigInt(PARTS_PER_MILLION);

/** A ratio's shares by person, checked: different people, summing to one million. */
function sharesOf(ratio: readonly Share[]): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  let total = 0;
  for (const { personId, partsPerMillion } of ratio) {
    if (shares.has(personId) || !Number.isSafeInteger(partsPerMillion) || partsPerMillion < 0) {
      throw new AppError(
        "INTERNAL",
        "A ratio names each person once, with a share of zero or more.",
      );
    }
    shares.set(personId, BigInt(partsPerMillion));
    total += partsPerMillion;
  }
  if (total !== PARTS_PER_MILLION) {
    throw new AppError("INTERNAL", "A ratio's shares do not sum to one million.");
  }
  return shares;
}

function cents(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new AppError("BAD_REQUEST", "An amount is a whole number of cents.");
  }
  return BigInt(value);
}

/**
 * Each person's net over the stretches, in millionths of a cent: `r_i × Σe − e_i`
 * per stretch, at that stretch's ratio, added up, with each charge to the pot
 * shared out at that same ratio. Positive owes; negative is
 * owed. They sum to zero, exactly. Everyone a stretch's ratio names has an
 * entry, though it be zero.
 */
export function netsOf(stretches: readonly Stretch[]): Map<string, bigint> {
  const nets = new Map<string, bigint>();
  const add = (personId: string, amount: bigint): void => {
    nets.set(personId, (nets.get(personId) ?? 0n) + amount);
  };
  for (const stretch of stretches) {
    const shares = sharesOf(stretch.ratio);
    const put = new Map<string, bigint>();
    const move = (personId: string, amount: bigint): void => {
      put.set(personId, (put.get(personId) ?? 0n) + amount);
    };
    let total = 0n;
    for (const { personId, cents: amount } of stretch.contributions) {
      move(personId, cents(amount));
      total += cents(amount);
    }
    for (const charge of stretch.charges) {
      if (charge.owedBy === charge.owedTo) {
        throw new AppError("BAD_REQUEST", "A charge is owed by one person to another.");
      }
      // Owed to whoever paid, by whoever consumed it: Σe does not move.
      move(charge.owedTo, cents(charge.cents));
      move(charge.owedBy, -cents(charge.cents));
    }
    for (const [personId, share] of shares) add(personId, share * total);
    for (const [personId, amount] of put) add(personId, -MILLION * amount);
    for (const charge of stretch.potCharges ?? []) {
      // Each other member is owed their share of it; whoever consumed it owes
      // the sum of those, (1 − r_X) × c. Exact, in millionths of a cent.
      const amount = cents(charge.cents);
      let owed = 0n;
      for (const [personId, share] of shares) {
        if (personId === charge.owedBy) continue;
        add(personId, -share * amount);
        owed += share * amount;
      }
      add(charge.owedBy, owed);
    }
  }
  return nets;
}

/** `numerator / denominator`, both positive, rounded half-up to a whole number. */
function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/**
 * Exact deposits, each `numerator / denominator` cents, rounded to whole cents
 * so that after them every contribution stands at its share to within a cent.
 *
 * Rounding each alone, half-up, does not promise that past three people: a
 * person's standing moves by their own rounding and by their share of everyone
 * else's — the one furthest ahead, who deposits nothing, by their share of all
 * of them — and with four people the second can pass a cent (lg-23's Log has
 * the measurement). So the deposits are
 * rounded together. As many are rounded up as the sum of their fractions rounds
 * to, half-up — so the rounding of the total, `S`, is within half a cent — and a
 * deposit is rounded up only if `r_i × S − (its own rounding)` stays within a
 * cent, and down likewise. There are always enough of each to choose from (the
 * count is in lg-23's Log). Among those allowed, the largest fractions are
 * rounded up first, a tie going to the earlier id; the rest are rounded down.
 * With one fraction to round this is half-up, which is every two-person
 * settlement: the person furthest ahead deposits exactly nothing.
 */
function roundDeposits(
  exact: readonly { personId: string; share: bigint; numerator: bigint }[],
  denominator: bigint,
): SettlementDeposit[] {
  const parts = exact.map((deposit, index) => ({
    ...deposit,
    index,
    whole: deposit.numerator / denominator,
    rest: deposit.numerator % denominator,
  }));
  const fractional = parts
    .filter((part) => part.rest > 0n)
    .toSorted((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  const restTotal = fractional.reduce((sum, part) => sum + part.rest, 0n);
  const up = roundHalfUp(restTotal, denominator);
  // S, the total rounding, in the same units as `rest`: c·d − Σrest.
  const s = BigInt(up) * denominator - restTotal;
  const rounded = new Set<number>();
  if (s <= 0n) {
    // Rounding up moves a contribution by 1 − f; allowed while f ≥ r × |S|.
    const allowed = fractional.filter((part) => part.rest * MILLION >= part.share * -s);
    for (const part of allowed.slice(0, up)) rounded.add(part.index);
  } else {
    // Rounding down moves it by f; allowed while f ≤ 1 − r × S.
    const down = fractional.length - up;
    const allowed = fractional.filter(
      (part) => part.rest * MILLION <= MILLION * denominator - part.share * s,
    );
    const floored = new Set(allowed.slice(allowed.length - down).map((part) => part.index));
    for (const part of fractional) if (!floored.has(part.index)) rounded.add(part.index);
  }
  return parts
    .map((part) => ({
      personId: part.personId,
      depositCents: Number(part.whole) + (rounded.has(part.index) ? 1 : 0),
    }))
    .filter((deposit) => deposit.depositCents > 0);
}

/** The matching rule's deposits: everyone short tops up until every contribution stands at the ratio. */
function depositsOf(
  people: readonly string[],
  nets: ReadonlyMap<string, bigint>,
  closing: ReadonlyMap<string, bigint>,
): SettlementDeposit[] {
  // The person furthest ahead for their share: the largest −net / r, compared
  // across multiplied out. The earlier id keeps a tie, which changes nothing:
  // tied, both deposit exactly nothing.
  let ahead: { net: bigint; share: bigint } | undefined;
  for (const personId of people) {
    const share = closing.get(personId) ?? 0n;
    if (share === 0n) continue;
    const net = nets.get(personId) ?? 0n;
    if (ahead === undefined || -net * ahead.share > -ahead.net * share) ahead = { net, share };
  }
  if (ahead === undefined) throw new AppError("INTERNAL", "A ratio gives nobody a share.");
  // net_i + r_i × K, with K = −net_j / r_j, in cents: (net_i·r_j − r_i·net_j) / (r_j·1e6).
  // Never negative: for a share, because j is furthest ahead; for no share,
  // because the caller has sent anyone owed with no share to the transfers.
  const { net: aheadNet, share: aheadShare } = ahead;
  const exact = people.map((personId) => {
    const share = closing.get(personId) ?? 0n;
    return {
      personId,
      share,
      numerator: (nets.get(personId) ?? 0n) * aheadShare - share * aheadNet,
    };
  });
  return roundDeposits(exact, aheadShare * MILLION);
}

/** The direct form: those who owe pay those owed, each in id order, each transfer rounded half-up. */
function transfersOf(
  people: readonly string[],
  nets: ReadonlyMap<string, bigint>,
): SettlementTransfer[] {
  const owing = people
    .filter((personId) => (nets.get(personId) ?? 0n) > 0n)
    .map((personId) => ({ personId, left: nets.get(personId) ?? 0n }));
  const owed = people
    .filter((personId) => (nets.get(personId) ?? 0n) < 0n)
    .map((personId) => ({ personId, left: -(nets.get(personId) ?? 0n) }));
  const transfers: SettlementTransfer[] = [];
  for (let from = 0, to = 0; from < owing.length && to < owed.length;) {
    const payer = owing[from];
    const payee = owed[to];
    if (payer === undefined || payee === undefined) break;
    const amount = payer.left < payee.left ? payer.left : payee.left;
    const rounded = roundHalfUp(amount, MILLION);
    if (rounded > 0) {
      transfers.push({ fromId: payer.personId, toId: payee.personId, cents: rounded });
    }
    payer.left -= amount;
    payee.left -= amount;
    if (payer.left === 0n) from++;
    if (payee.left === 0n) to++;
  }
  return transfers;
}

/**
 * The settlement over every stretch since everyone was last even, each weighed
 * at its own ratio, divided by the shares in `ratio` — the ratio in effect at
 * the end of the period being closed — between any number of people.
 */
export function settleHousehold(
  stretches: readonly Stretch[],
  ratio: readonly Share[],
): HouseholdSettlement {
  const nets = netsOf(stretches);
  const closing = sharesOf(ratio);
  for (const personId of closing.keys()) if (!nets.has(personId)) nets.set(personId, 0n);
  const people = [...nets.keys()].toSorted();
  const nobody: HouseholdSettlement = {
    formula: CURRENT_FORMULA,
    people,
    deposits: [],
    transfers: [],
  };
  const transfers = transfersOf(people, nets);
  // A deposit reaches each person only through their share of the buffer, so
  // someone owed who has none can be paid only directly.
  const unreachable = people.some(
    (personId) => (closing.get(personId) ?? 0n) === 0n && (nets.get(personId) ?? 0n) < 0n,
  );
  if (unreachable) {
    if (transfers.length > 0) return { ...nobody, deposits: null, transfers };
    // Between two, lg-6 named who owes whom even when what is owed rounds to
    // nothing: a period settled only directly, at 0.00. A residual of a fraction
    // of a cent, left by earlier periods at another ratio, reaches it. Kept so a
    // household of two closes unchanged (lg-23 gate 1, F1; owner, 2026-10-17).
    const owing = people.find((personId) => (nets.get(personId) ?? 0n) > 0n);
    const owed = people.find((personId) => (nets.get(personId) ?? 0n) < 0n);
    if (people.length === 2 && owing !== undefined && owed !== undefined) {
      return { ...nobody, deposits: null, transfers: [{ fromId: owing, toId: owed, cents: 0 }] };
    }
    return nobody;
  }
  // Less than half a cent owed is what paying a rounded figure leaves behind,
  // and it rounds to nothing. It names nobody: a payer at 0.00 would be asked to
  // deposit nothing, and the next close would expect that nothing.
  const deposits = depositsOf(people, nets, closing);
  if (deposits.length === 0 && transfers.length === 0) return nobody;
  return { ...nobody, deposits, transfers };
}

/**
 * A settlement between exactly two people in lg-6's shape, or `null` when it is
 * between more. The furthest ahead deposits nothing, so there is one deposit at
 * most, and one transfer.
 */
export function asPair(household: HouseholdSettlement): Settlement | null {
  const [first, second] = household.people;
  if (household.people.length !== 2 || first === undefined || second === undefined) return null;
  const [transfer] = household.transfers;
  if (household.deposits === null) {
    return {
      formula: household.formula,
      payerId: transfer?.fromId ?? null,
      recipientId: transfer?.toId ?? null,
      depositCents: null,
      netCents: transfer?.cents ?? 0,
    };
  }
  const [deposit] = household.deposits;
  if (deposit === undefined) {
    return {
      formula: household.formula,
      payerId: null,
      recipientId: null,
      depositCents: 0,
      netCents: 0,
    };
  }
  return {
    formula: household.formula,
    payerId: deposit.personId,
    recipientId: deposit.personId === first ? second : first,
    depositCents: deposit.depositCents,
    netCents: transfer?.cents ?? 0,
  };
}

/** The ratio's two people in id order, checked: two of them, summing to one million. */
function pairOf(ratio: readonly Share[]): [string, string] {
  const [first, second] = ratio.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  if (ratio.length !== 2 || first === undefined || second === undefined) {
    throw new AppError("BAD_REQUEST", "A settlement is between the two people of a ratio.");
  }
  sharesOf(ratio);
  return [first.personId, second.personId];
}

/**
 * The settlement over every stretch since the two were last even, each weighed
 * at its own ratio, divided by the recipient's share in `ratio` — the ratio in
 * effect at the end of the period being closed. Two people, every stretch
 * between the same two: `settleHousehold`, read in lg-6's shape.
 */
export function settleStretches(
  stretches: readonly Stretch[],
  ratio: readonly Share[],
): Settlement {
  const [first, second] = pairOf(ratio);
  for (const stretch of stretches) {
    const [a, b] = pairOf(stretch.ratio);
    if (a !== first || b !== second) {
      throw new AppError(
        "BAD_REQUEST",
        "Every ratio in a settlement is between the same two people.",
      );
    }
    for (const { personId } of stretch.contributions) {
      if (personId !== first && personId !== second) {
        throw new AppError("BAD_REQUEST", "A contribution names someone the ratio does not.");
      }
    }
    for (const { owedBy, owedTo } of stretch.charges) {
      const between =
        (owedBy === first && owedTo === second) || (owedBy === second && owedTo === first);
      if (!between) {
        throw new AppError("BAD_REQUEST", "A charge is between the two people of the ratio.");
      }
    }
    for (const { owedBy } of stretch.potCharges ?? []) {
      if (owedBy !== first && owedBy !== second) {
        throw new AppError("BAD_REQUEST", "A charge to the pot names someone the ratio does not.");
      }
    }
  }
  const pair = asPair(settleHousehold(stretches, ratio));
  if (pair === null) throw new AppError("INTERNAL", "A settlement of two named a third.");
  return pair;
}

/** The settlement for contributions and charges all weighed at one ratio. */
export function settlement(
  contributions: readonly PersonCents[],
  charges: readonly Charge[],
  ratio: readonly Share[],
): Settlement {
  return settleStretches([{ ratio, contributions, charges }], ratio);
}
