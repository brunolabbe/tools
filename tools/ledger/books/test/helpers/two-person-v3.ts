/**
 * lg-6's two-person settlement, kept as it stood on `main` before lg-23 (at
 * 8e50f0d4, `books/src/settlement.ts`), as the reference lg-23's general rule
 * is checked against. `settleStretches` in `src` is now the general rule read
 * in the two-person shape, so comparing it with itself would prove nothing; this
 * copy is the formula the household's two-person books were settled by. It is a
 * test's oracle, and nothing in `src` imports it.
 */

import { AppError } from "@ledger/contract";
import type { Settlement, Share, Stretch } from "../../src/index.ts";

const MILLION = 1_000_000n;

function pairOf(ratio: readonly Share[]): [Share, Share] {
  const [first, second] = ratio.toSorted((a, b) => (a.personId < b.personId ? -1 : 1));
  if (ratio.length !== 2 || first === undefined || second === undefined) {
    throw new AppError("BAD_REQUEST", "A settlement is between the two people of a ratio.");
  }
  if (first.partsPerMillion + second.partsPerMillion !== 1_000_000) {
    throw new AppError("BAD_REQUEST", "A ratio's two shares do not sum to one million.");
  }
  return [first, second];
}

function owedMicro(stretch: Stretch, first: string, second: string): bigint {
  const [a, b] = pairOf(stretch.ratio);
  if (a.personId !== first || b.personId !== second) {
    throw new AppError("BAD_REQUEST", "Every ratio in a settlement is between the same two people.");
  }
  const firstShare = BigInt(a.partsPerMillion);
  const secondShare = BigInt(b.partsPerMillion);
  let owed = 0n;
  for (const { personId, cents: amount } of stretch.contributions) {
    if (personId === first) owed -= secondShare * BigInt(amount);
    else if (personId === second) owed += firstShare * BigInt(amount);
    else throw new AppError("BAD_REQUEST", "A contribution names someone the ratio does not.");
  }
  for (const charge of stretch.charges) {
    if (charge.owedBy === first && charge.owedTo === second) owed += MILLION * BigInt(charge.cents);
    else if (charge.owedBy === second && charge.owedTo === first) {
      owed -= MILLION * BigInt(charge.cents);
    } else throw new AppError("BAD_REQUEST", "A charge is between the two people of the ratio.");
  }
  return owed;
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

export function settleStretchesV3(stretches: readonly Stretch[], ratio: readonly Share[]): Settlement {
  const [first, second] = pairOf(ratio);
  const owed = stretches.reduce(
    (sum, stretch) => sum + owedMicro(stretch, first.personId, second.personId),
    0n,
  );
  const nobody: Settlement = {
    formula: "v3",
    payerId: null,
    recipientId: null,
    depositCents: 0,
    netCents: 0,
  };
  if (owed === 0n) return nobody;
  const [payer, recipient] = owed > 0n ? [first, second] : [second, first];
  const magnitude = owed > 0n ? owed : -owed;
  const recipientShare = BigInt(recipient.partsPerMillion);
  const depositCents = recipientShare === 0n ? null : roundHalfUp(magnitude, recipientShare);
  const netCents = roundHalfUp(magnitude, MILLION);
  if (depositCents === 0) return nobody;
  return {
    formula: "v3",
    payerId: payer.personId,
    recipientId: recipient.personId,
    depositCents,
    netCents,
  };
}
