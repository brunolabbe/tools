---
id: lg-55
tool: ledger
title: A household with no mortgage, or one paid off, reads as such on Stats and Home
kind: work-package
status: ready
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

## Decision — answered 2026-10-19 by the owner

How should the tool know that there is no mortgage, and what should the screens
do then?

- **(A) Infer it from the rows.** Treat the mortgage as ended when no payment
  has come out of the bucket for some period, and say so on the cards. No new
  setting or contract field, but a threshold both schedules must survive, and a
  late payment reads as a payoff until the next one arrives.
- **(B) Record it.** _Chosen._ A dated household fact, "mortgage ended on
  <date>" or "no mortgage", set from the UI. Stats and Home close the mortgage
  views from that date, and history before it still charts. Exact, and covers a
  household that never had one, at the cost of a contract change, a migration
  and a form.
- **(C) Wording only.** Keep every card and reword the two empty messages. The
  cheapest, but a paid-off household keeps two empty cards and a Home section
  indefinitely.

**The balance left in the bucket after the final payment goes back to each
person as their own money** — chosen over moving it into current expenses as
shared money. §4's model already attributes every dollar in the bucket to one
person (`own = deposits − share of payments`), so nothing is recomputed: what
each person holds on the end date is theirs, and a later row filed to them that
takes it out of the bucket brings their part down to zero. No row is ever
invented to move it.

## Build

The contract change is the owner's decision above; it is not a licence to
reshape anything else in `@ledger/contract`.

1. **The record, in each household's books** (`api/src/db/schema.ts`, the next
   migration — append it, never edit a shipped one, and check `main` for the
   number at build time, since other ledger tickets add migrations). An
   appended table in the shape of `ratios`: what the household says about its
   mortgage — _ended on `yyyy-mm-dd`_, _none_ (never had one), or _live_ (the
   correction that takes either back) — with `supersedes`, `entered_at` and
   `entered_by`, and a `current_…` view so exactly one record stands. No row
   means _live_, so every existing household reads exactly as it does today.
   No `UPDATE`, no `DELETE` (`classification-schema.test.ts` scans for them).
2. **The contract** (`contract/src/api.ts`). A route for it (read and write),
   its zod schema, and the state on the two responses that need it: the
   mortgage part of `BucketsResponse` and the two mortgage stats responses
   (or one small route both screens read — the builder's choice, named in the
   Log). An end date after today is refused by the schema. Any member may set
   it, like a ratio; it takes `rateLimitsFor(context).read` / `.write`, and
   `route-limits.test.ts` and `isolation.test.ts` pick the route up by
   themselves — make sure they do.
3. **The rule the screens follow.** Call _the close_ the later of the end date
   and the last joint payment out of the bucket — a payment pasted later than
   the record, or dated after it, still charts, and the close moves with it.
   - **A range entirely before the close charts exactly as today.** Ranges are
     trims of what is shown, never of what is counted (lg-9), so nothing in
     `books/src/stats.ts`'s arithmetic changes.
   - **Mortgage payment card.** A range that spans the close ends the line
     there with an end marker, the same mechanism as a renewal's, and its note
     says "Last payment on <date>; the mortgage ended." A range wholly after the
     close, or a household recorded as _none_, does not render the card.
   - **Own money card.** While anything is left in the bucket after the close,
     the card stays and says the money is each person's own, theirs to take
     back, with each person's part. Once the bucket is at zero, a range wholly
     after the close does not render the card; _none_ never renders it.
   - **Home.** _None_, or ended with nothing left: no mortgage section. Ended
     with something left: the section stays, and its lead sentence says what
     is left and whose it is, in place of who is ahead.
   - The current empty messages ("No payment came out…", "The mortgage bucket
     did not move…") stay for a _live_ mortgage only.
4. **The form.** One place to set it — the household screen
   (`web/src/household/`) is the nearest fit; the builder may pick another and
   says why in the Log. It shows the current state, sets an end date or _no
   mortgage_, and takes either back.
5. **`docs/00-ANALYSIS.md` §4.** Add what an ended mortgage means: the record,
   the close, and that the balance left is each person's own money by the model
   already, taken out by rows filed to them. Note in §9 that the mortgage views
   close from the close.

## Done when

1. An API test files each state and reads it back, refuses an end date after
   today, and proves a later record supersedes an earlier one.
2. A web test renders Stats for books recorded as ended, over a range wholly
   after the close, and finds no mortgage payment card and neither of the two
   current empty messages.
3. A web test renders a range that spans the close and finds every earlier
   payment charted and the end marker on the last.
4. A web test renders Stats and Home for books ended with money still in the
   bucket and finds each person's part named as their own; and, for the same
   books with the bucket at zero, finds no Own money card and no Home section.
5. A web test renders Stats and Home for a household recorded as _none_ and
   finds no mortgage card and no mortgage section.
6. A web test renders Stats and Home with no record and finds today's screens,
   unchanged.
7. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18: filed from the owner's question about how Stats handles a
  household with no mortgage payment. The cards on `main` at 140bd78a render
  unconditionally and fall back to their empty messages.
- 2026-10-19: the owner chose (B), and the balance left going back to each
  person. Build and Done when rewritten for it; the cited code still read as
  filed on `main` at 96da35c8. Moved to `ready`.
- 2026-10-20: built on `origin/main` 00977771, branch `lg-55-no-mortgage-reads-as-such`.
  - **The record.** Migration 13 (`mortgage_records`, `current_mortgage_record`):
    `state` in `live | ended | none`, `ended_on` only for `ended` (a `CHECK`
    holds that), `supersedes`, `entered_at`, `entered_by`; one unique index on
    `supersedes` and one on the constant `(1)` where `supersedes IS NULL`, so one
    chain and exactly one record stands. No `UPDATE`, no `DELETE`.
    `classification-schema.test.ts` still passes. The seven `user_version` asserts
    (`schema`, `auto-file`, `spending-backfill`) moved from 12 to 13. **If lg-35
    lands first it takes 13 and this becomes 14**: those same lines are the
    textual conflict.
  - **The contract: one small route**, `GET`/`POST /api/mortgage`
    (`ROUTES.mortgage`), read by both screens and written by the form, rather than
    a field on `BucketsResponse` and the two stats responses. Reason: three
    responses carrying the same five fields is three places to keep in step, and
    it leaves `BucketsResponse` alone, which lg-35 also edits. It answers the
    record, `state`, `endedOn`, `lastPaymentOn`, `closedOn` (the later of the
    end date and the last joint payment, `null` unless ended), `left` and the
    bucket's `balanceCents` and `own`. Nothing else in `@ledger/contract` changed.
  - **"Refused by the schema" needed a clock the contract does not have.** The
    brief says an end date after today is refused by the schema;
    `mortgageRecordRequestSchemaOn(today)` is that schema, built by the route with
    the API's clock, over `mortgageRecordRequestSchema` (the shape, for a caller
    with no clock). Saying what already stands, or `live` over no record, files
    nothing.
  - **The close and what is left** are `api/src/mortgage.ts`, reading
    `mortgagePayments` and `bucketsAsOf` as they are; `filedRows` in
    `api/src/stats.ts` gained an `export` and nothing else. `books/src/stats.ts`
    is untouched, so lg-63's rewrite of it does not meet this branch there.
  - **The screens** follow `web/src/mortgage.ts`: the Mortgage payment card ends
    its line on the last payment with a marker (the renewal's mechanism) and the
    note "Last payment on <date>; the mortgage ended." when the range holds the
    close; a range wholly after it, or _none_, does not draw it. The Own money
    card stays while anything is left, with a sentence naming each person's part
    (`ChartCard` gained an optional `note`), and goes when the bucket is at zero
    and the range is wholly after the close. Home drops the section for _none_ or
    ended-and-empty, and for ended-with-money replaces who is ahead with what is
    left and whose it is. The two live empty messages are kept for a live mortgage
    only; an ended one says "No payment is in this range; the mortgage ended on
    <date>." and "Nothing moved in the bucket in this range." instead. A range
    that ends before the close is drawn exactly as before, with no marker and
    no note about the money left.
  - **Until `/api/mortgage` answers, and if it fails, the screens read as live.**
    Stats draws the two cards as live while it loads, so the common case does not
    jump; Home waits for it with the buckets. This is a choice, not in the brief.
  - **The form** is `web/src/household/MortgageSetting.tsx`, a card under the
    household's on the household tab: three radio choices, an `Ended on` date
    capped at today, Save. It sits there, and not on Stats or Home, because it is a
    fact about the household and not about a month, and the tab is where the
    household is already edited. A small `.mortgage-form` CSS block was added
    before `.hint` in `styles.css`; `main.tsx` is untouched.
  - **`docs/00-ANALYSIS.md`** §4 gained "A mortgage that ends, or never was" and §9
    a paragraph on the views closing from the close.
  - **Not folded in:** lg-63 rewrites the same card's arithmetic and the brief
    forbids touching it here. Nothing else small and specified came free.
  - **Proposed line for `tools/ledger/CLAUDE.md`** (not added: the Build does not
    name the file): in the paragraph on appended records, "the household's word
    on its mortgage is the same (lg-55, `current_mortgage_record`); it decides
    which views are shown and never what is counted."
  - **Measured at the commit this entry is in:** `npx vitest run
tools/ledger/api/test/mortgage.test.ts`, 16 of 16; `npm test -- --project
ledger`, 1594 of 1594 in 73 files, exit 0; `npm run check` exit 0. The
    isolation sweep (`isolation.test.ts`) and `route-limits.test.ts` picked the
    route up from the lists they already walk, once `mortgage` was added to
    `VERBS`, to the isolation writes and reads and to the two-verb list (the
    isolation writes carry a distinct end date per household). **Not run:** a red
    state of the new web tests against the base's source; they assert behaviour
    the base has no code for (the end marker, the hidden cards).
