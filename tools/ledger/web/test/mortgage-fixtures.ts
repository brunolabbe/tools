/**
 * What the household says of its mortgage (lg-55), as `GET /api/mortgage`
 * answers it, for the screens' tests. Invented figures. A test that is not about
 * the mortgage takes `LIVE`, which is every household's answer until it says
 * something: the screens then read as they did before it could.
 */

import type { MortgageResponse, MortgageSplitOn } from "@ledger/contract";

/** How a payment splits with no split record, between alex and sam (lg-63). */
export const EQUAL_SPLIT: MortgageSplitOn = {
  mode: "equal",
  effectiveFrom: null,
  noRatio: false,
  parts: [
    { personId: "alex", partsPerMillion: 500_000 },
    { personId: "sam", partsPerMillion: 500_000 },
  ],
};

export const LIVE: MortgageResponse = {
  asOf: "2026-10-03",
  record: null,
  state: "live",
  endedOn: null,
  lastPaymentOn: "2026-03-15",
  closedOn: null,
  left: true,
  balanceCents: 19999,
  own: [
    { personId: "alex", ownCents: 14999 },
    { personId: "sam", ownCents: 5000 },
  ],
};

/** Ended on 2026-03-31, after the last payment on 2026-03-15, with 199.99 $ left in the bucket. */
export const ENDED: MortgageResponse = {
  ...LIVE,
  record: {
    id: 1,
    state: "ended",
    endedOn: "2026-03-31",
    supersedes: null,
    enteredAt: "2026-04-01T09:00:00.000Z",
    enteredBy: "alex",
  },
  state: "ended",
  endedOn: "2026-03-31",
  closedOn: "2026-03-31",
};

/** The same, with the bucket at zero. */
export const ENDED_EMPTY: MortgageResponse = {
  ...ENDED,
  left: false,
  balanceCents: 0,
  own: [
    { personId: "alex", ownCents: 0 },
    { personId: "sam", ownCents: 0 },
  ],
};

/**
 * A bucket at zero whose parts are not: alex paid in 1 000.00 $ and one joint payment of
 * 1 000.00 $ took it all, so alex holds 500.00 $ and sam is 500.00 $ short.
 */
export const ENDED_UNEVEN: MortgageResponse = {
  ...ENDED,
  left: false,
  balanceCents: 0,
  own: [
    { personId: "alex", ownCents: 50000 },
    { personId: "sam", ownCents: -50000 },
  ],
};

/** Money left (600.00 $) and one part below zero: alex holds 1 100.00 $ of it and sam owes 500.00 $. */
export const ENDED_OWES: MortgageResponse = {
  ...ENDED,
  balanceCents: 60000,
  own: [
    { personId: "alex", ownCents: 110000 },
    { personId: "sam", ownCents: -50000 },
  ],
};

export const NONE: MortgageResponse = {
  ...LIVE,
  record: {
    id: 1,
    state: "none",
    endedOn: null,
    supersedes: null,
    enteredAt: "2026-04-01T09:00:00.000Z",
    enteredBy: "alex",
  },
  state: "none",
  lastPaymentOn: null,
  left: false,
  balanceCents: 0,
  own: [],
};
