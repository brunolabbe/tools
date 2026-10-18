---
id: lg-55
tool: ledger
title: A household with no mortgage, or one paid off, reads as such on Stats and Home
kind: work-package
status: needs-decision
milestone: null
depends_on: [lg-9]
difficulty: standard
---

# lg-55 — A household with no mortgage, or one paid off

## Why

A household can end up with no mortgage payment: it pays the mortgage off, or
it never had one. On 2026-10-18 the owner asked how the Stats cards handle that.
Today nothing handles it. The mortgage is one of the two fixed buckets
(`BUCKETS` in `contract/src/api.ts`), and every screen assumes it is live:

- `web/src/stats/Stats.tsx` always renders `MortgagePaymentCard` and
  `MortgageOwnCard`, whatever the books hold.
- **Mortgage payment** (`web/src/stats/Cards.tsx`) charts joint withdrawals from
  the bucket (`mortgagePayments` in `books/src/stats.ts`). A range after the
  last payment reads "No payment came out of the mortgage bucket in this
  range.", which looks like missing data rather than a finished mortgage. A
  range that spans the payoff ends the line at the last payment with no
  marker, although every renewal gets one.
- **Own money in the mortgage** reads "The mortgage bucket did not move in this
  range." If anything is left in the bucket after the final payment, each
  person's share stays attributed to them indefinitely, and nothing says what
  happens to it.
- **Home** (`web/src/home/Home.tsx`) always shows the mortgage section and its
  lead sentence.

The model in `docs/00-ANALYSIS.md` §4 and §9 assumes a mortgage exists. None of
this is wrong yet, since the household still pays one. It becomes a question
the day the payments stop.

## Decision — open

How should the tool know that there is no mortgage, and what should the screens
do then?

- **(A) Infer it from the rows.** Treat the mortgage as ended when no payment
  has come out of the bucket for some period, and say so on the cards: "Last
  payment on <date>" in place of the empty message, plus an end marker on the
  payment line. No new setting or contract field. It costs a threshold that
  biweekly and monthly schedules both have to survive, and it guesses: a missed
  or late payment reads as a payoff until the next one arrives.
- **(B) Record it.** Add a dated household fact, "mortgage ended on <date>" (or
  "no mortgage"), set from the UI. Stats and Home hide or close the mortgage
  views from that date, and history before it still charts. This is exact and
  covers a household that never had one, but it is a contract change with a
  store migration and a form.
- **(C) Wording only.** Keep every card and rewrite the two empty messages so
  they do not suggest missing data, for example "No mortgage payment in this
  range." The cheapest option, but a paid-off household keeps two empty cards
  and a Home section indefinitely.

Recommended: **(B)**, because it is the only option that is correct for a
household with no mortgage at all, and the rows cannot tell an ended mortgage
from a late payment. Whichever is chosen, the leftover balance needs its own
answer: when the bucket still holds money after the final payment, is it
returned to each person as their own money, or moved somewhere?

## Build

To be written once the decision is answered. Whichever option is chosen:

1. Every view that names the mortgage changes together: both Stats cards and
   the Home section.
2. A range that covers the mortgage's life still charts it unchanged. Only
   ranges after the end, or a household without one, read differently.
3. Update `docs/00-ANALYSIS.md` §4 to say what an ended mortgage means for the
   bucket and for any balance left in it.

## Done when

- A web test renders Stats for books whose mortgage payments stopped (or, under
  (B), were marked ended) and finds the chosen wording or no mortgage cards,
  never the current empty messages.
- A web test renders a range that spans the end and still finds the earlier
  payments charted.
- A web test renders Home for the same books and finds the mortgage section
  following the same rule.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18: filed from the owner's question about how Stats handles a
  household with no mortgage payment. The cards on `main` at 140bd78a render
  unconditionally and fall back to their empty messages.
