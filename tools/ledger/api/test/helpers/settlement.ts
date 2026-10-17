/**
 * A two-person settlement read in lg-6's shape: a payer, a recipient, a deposit
 * and a net. lg-23 made the figures lists, and between two people they carry one
 * deposit at most and one transfer, so the tests lg-6 wrote assert what they
 * always asserted, through this.
 */

import { AppError } from "@ledger/contract";
import type { ClosedPeriod, SettlementFigures } from "@ledger/contract";

export interface TwoPersonSettlement {
  payerId: string | null;
  recipientId: string | null;
  depositCents: number | null;
  netCents: number;
}

export function asTwo(figures: SettlementFigures | null | undefined): TwoPersonSettlement {
  if (figures === null || figures === undefined) throw new AppError("INTERNAL", "No settlement to read.");
  const people = figures.shares.map((share) => share.personId);
  if (people.length !== 2) throw new AppError("INTERNAL", `A settlement between ${String(people.length)}.`);
  const [transfer, extra] = figures.transfers;
  const [deposit, another] = figures.deposits ?? [];
  if (extra !== undefined || another !== undefined) {
    throw new AppError("INTERNAL", "A two-person settlement has one deposit and one transfer at most.");
  }
  const payerId = deposit?.personId ?? transfer?.fromId ?? null;
  return {
    payerId,
    recipientId: payerId === null ? null : (people.find((person) => person !== payerId) ?? null),
    depositCents: figures.deposits === null ? null : (deposit?.depositCents ?? 0),
    netCents: transfer?.cents ?? 0,
  };
}

/** A two-person period's one deposit: its status, and the row that brought it in. */
export function oneDeposit(deposit: ClosedPeriod["deposit"] | undefined): {
  status: ClosedPeriod["deposit"]["status"];
  rowId: number | null;
} {
  if (deposit === undefined) throw new AppError("INTERNAL", "No period to read.");
  if (deposit.deposits.length > 1) throw new AppError("INTERNAL", "More than one deposit.");
  return { status: deposit.status, rowId: deposit.deposits[0]?.rowId ?? null };
}
