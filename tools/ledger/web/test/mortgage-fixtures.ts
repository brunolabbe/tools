/**
 * What the household says of its mortgage (lg-55), as `GET /api/mortgage`
 * answers it, for the screens' tests. Invented figures. A test that is not about
 * the mortgage takes `LIVE`, which is every household's answer until it says
 * something: the screens then read as they did before it could.
 */

import type { MortgageResponse } from "@ledger/contract";

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
