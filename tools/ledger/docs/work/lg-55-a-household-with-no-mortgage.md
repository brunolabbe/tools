---
id: lg-55
tool: ledger
title: A household with no mortgage, or one paid off, reads as such on Stats and Home
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-20 · `00977771..e0f792e1` · Opus 5.5, depth full

| Done when                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. API files each state and reads it back, refuses an end date after today, a later record supersedes | `api/test/mortgage.test.ts` › "each state is filed and read back", "an end date after today is refused, and today is not after it", "a later record supersedes an earlier one, and only one stands" ✓. Positive control: the route built with a far-future "today" turns the refusal test red (`expected 200 to be 400`, 1 of 16).                                                                                                                                                                                                                            |
| 2. Ended, range wholly after the close: no payment card, neither empty message                        | `web/test/mortgage.test.tsx` › "stats of books ended, over a range wholly after the close, draw no payment card and neither empty message" ✓                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3. Range spanning the close: every earlier payment charted, end marker on the last                    | `web/test/mortgage.test.tsx` › "a range that spans the close charts every earlier payment and marks the last" ✓ (table rows and `circle.marker` count). Positive control: a marker on every payment turns it red (1 of 14). Gate probe on four varied shapes: only the last point carries the note and the tag (see low below).                                                                                                                                                                                                                               |
| 4. Ended with money left: each part named as their own; bucket at zero: no Own card, no Home section  | **unproven (open decision)** — proven for parts that are all zero (`mortgage.test.tsx` › "stats of books ended with money left name each person's part as their own, in a range after the close", "home of books ended with money left names each person's part and whose it is", "home of books ended with the bucket at zero has no mortgage section", and the Own-card assertion in Done when 2's test). For a bucket at zero whose parts are not zero, the API answers `left: true` and both the Own card and the Home section stay; see the first `med`. |
| 5. Recorded as none: no mortgage card, no Home section                                                | `mortgage.test.tsx` › "stats of books recorded as none draw no mortgage card", "home of a household recorded as none has no mortgage section" ✓                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6. No record: today's screens unchanged                                                               | `mortgage.test.tsx` › "with no record the stats and home are what they were" ✓. A fresh household through the real route answers `state: "live"`, `record: null`, `closedOn: null`; the `LIVE` mock differs only in fields no screen reads while live. The existing home, stats and app tests changed only by adding the mock.                                                                                                                                                                                                                                |
| 7. `npm run check` and `npm test -- --project ledger`                                                 | verified — `npm run check` exit 0; `npm test -- --project ledger` 1594 of 1594 in 73 files, exit 0. PR #581 at `e0f792e1`: every check pass, the Windows leg included.                                                                                                                                                                                                                                                                                                                                                                                        |

- **med** · open decision · Done when 4 depends on it · "Nothing left" is read off the parts, not the balance. `mortgageStatus` in `api/src/mortgage.ts` sets `left` to `own.some(ownCents !== 0)`. So a bucket at zero whose parts are not zero counts as having money left. That happens whenever one person paid in more than half: alex deposits 1 000.00 $ and one joint payment of 1 000.00 $ leaves `balanceCents: 0`, `own` alex +500.00 $ and sam −500.00 $, and `left: true`. The Home section and the Own card then stay for every range after the close. The brief says "once the bucket is at zero" and "ended with nothing left", and it does not say what happens to a part below zero. The same falsehood is in `docs/00-ANALYSIS.md` §9 ("once the bucket is at zero, a range wholly after the close does not draw it") and in the branch's Log. Options: **(A, recommended)** `left` is `balanceCents !== 0`, as the brief's line reads, and the two prose sentences stay as they are. The cost is that a ±500 $ imbalance between people stops showing on Home once the mortgage ends. **(B)** keep the parts rule, and have the owner reword Done when 4, §9 and the Log to say "while any person's part is not zero".
- **med** · no `Done when` line depends on it literally · The copy for what is left is false when a part is negative or the balance is zero. On P5's books, Home's `endedSentence` reads "The 0.00 $ left in the bucket is each person's own, theirs to take back.", and the Own card's note reads "…theirs to take back: alex 500.00 $, sam -500.00 $.". On the probe's books with a balance of 837.66 $, the API reports sam at −1 081.17 $, and the note would tell sam that −1 081.17 $ is theirs to take back. This is a condition that will occur, since parts are routinely negative (all 8 of the probe's odd-cent households, whose deposits were unequal by construction, carried one). The direction is unsafe: a reader is told money is theirs to withdraw when they owe it. Graded `med`, not `high`: it is screen copy about the books, not a guarantee about the code that a later check relies on.
- **low** · open decision (the builder's, put to the owner) · no `Done when` line depends on it · While `/api/mortgage` loads or fails, `Stats` draws both mortgage cards as live (`useMortgage` in `web/src/mortgage.ts`; `Stats.tsx` takes `null` as live), and `Home` waits for it. So a household recorded as _none_ briefly sees the two cards and fires `fetchMortgagePayments` and `fetchMortgageOwn`, and sees them for good if the read fails. The brief says nothing about loading. No test asserts the opposite of a line, since Done when 5 is asserted after the read lands. Options: **(A, recommended)** hold the two mortgage cards until the read lands, as Home does, and on a failure draw them as live. The cost is that the other cards move down when the cards appear for a live household. **(B)** keep it as built. The cost is the flash and two wasted requests for a _none_ household.
- **low** · "today" is the API's clock in UTC (`context.now().toISOString().slice(0, 10)` in `routes/mortgage.ts`), as `salaries.ts`, `periods.ts` and `routes/stats.ts` already use. In America/Montreal at 23:30 on 10-19 (03:30Z), an end date of local tomorrow is accepted (200). At 00:30 local both cases behave as expected (10-20 gives 200, 10-21 gives 400). The error runs in the permissive direction, for 4–5 hours a day, and only east of UTC is local today refused (Paris at 00:30 gives 400). The form's `max` is the API's `asOf`, so it agrees with the route.
- **low** · `nfr:maintainability` · Done when 3's test uses three equal payments, so its `circle.marker` count of 1 cannot tell the end marker from a renewal's. The gate's varied shapes show the code is right: unequal amounts, two payments on one day, a payment after `endedOn`, and one on `endedOn`. In each, only the last point carries "Last payment on …" and the table tag. When the last payment is also a change, its dot is the change dot and the note is what distinguishes it, which the brief allows ("the same mechanism as a renewal's").
- **dropped** · two records standing, or a fork. Refuted: three interleaved POSTs through the route chain 3→4→5, `current_mortgage_record` holds one row, and by direct SQL a second root, a second child of id 1 and a dangling `supersedes` are each refused (SQLite 3.53.2, `foreign_keys` 1). The partial unique index on `(1)` holds.
- **dropped** · parts not summing to the balance. Refuted: balances of 0.01 $, 0.02 $, 100.00 $ and 100.01 $ over 2 and 3 people sum to the cent, 8 of 8. `mortgageAsOf` throws `INTERNAL` otherwise.
- **dropped** · household isolation. Refuted: `isolation.test.ts` walks the GET and the POST with a distinct end date per household and passes in the project run.
- **findings** · the hunt returned 8; 5 carried, 3 dropped.
- NFR: security ✓ (isolation and rate limits picked up) · performance — `mortgageStatus` reads every filed row on each GET, the same cost as the stats routes · reliability — the two meds above · maintainability — the low above.

### Gate 2

**Gate: CONCERNS** — 2026-10-20 · `e0f792e1..09f9bf76` (base `00977771`) · Opus 5.5, the round only

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4. Ended with money left: each part named as their own; bucket at zero: no Own card, no Home section | `api/test/mortgage.test.ts` › "a bucket at zero has nothing left, whatever each person's part" (`left: false` at alex +500.00 $, sam −500.00 $) and `web/test/mortgage.test.tsx` › "books ended with the bucket at zero but parts that are not, draw no Own card and no Home section" ✓, with the two money-left tests' strings updated. Positive control: `left` planted back to the parts rule turns the API test red (`expected { … } to match object { left: false, balanceCents: +0 }`, 1 of 17).                     |
| 7. `npm run check` and `npm test -- --project ledger`                                                | verified — `npm run check` exit 0; `npm test -- --project ledger` 1601 of 1601 in 73 files, exit 0 (gate 1: 1594; the round adds 7). PR #581 at `09f9bf76`: every check passes except `test (windows-latest, informational)`, which fails in `tools/downloader/resolvers/test/browser/browser-resolver-consent-and-links.test.ts` › "does not press a checkout form's submit button" (`expected 'UNREACHABLE' to be 'NO_MEDIA_FOUND'`). The diff touches only `tools/ledger`, and that leg passed on `main` at `00977771`. |

Gate 1's findings:

- **F1 (med), fixed.** `mortgageStatus` sets `left` to `balanceCents !== 0`. Gate 1's P5 now answers `left: false` with `balanceCents: 0` and alex +500.00 $ / sam −500.00 $; it answered `true` at `e0f792e1`. Every reader of `left` follows from it: `showsOwnCard` and `showsHomeSection` in `web/src/mortgage.ts`, the note on `MortgageOwnCard`, and `mortgageStanding`. On every zero-balance shape (3 of 3), the Home section is absent and the Own card is absent for a range after the close.
- **F2 (med), fixed as the owner directed.** A part below zero is now named as owed ("Sam owes 500.00 $"). No screen can show the balance sentence at 0. Over 11 constructible shapes of balance sign × part sign (2 people and 3), no negative sum is said to be anyone's. The new wording has its own flaws, below.
- **F3 (low), fixed.** Stats holds both cards while the read is pending, for none, ended, live and a failed read: no card is drawn and neither series is requested. After the read, none draws nothing and never makes a request. Ended, live and failed each draw both cards. Positive control: with the hold removed, all 4 shapes draw and request both cards while pending, and the round's two tests go red (2 of 20). Raising `card()`'s wait to 4 s masks nothing. With it put back at 1 s, `stats.test.tsx` passed 17 of 17 in 10 of 10 runs. Its first test took 708–1561 ms at this head and 595–975 ms with the hold removed. A render that never resolves still fails, because `card()` waits for the slider.
- **F4 (low), not fixed, recorded by the owner.** P4 reads as it did at gate 1.
- **F5 (low), fixed.** `mortgage.test.tsx` › "the end marker is told from a renewal's…" uses unequal payments. Gate 1's `mutate.mjs` now turns 2 of 20 tests red, against 1 of 14 before.

New, in the lines the round touched:

- **med** · no `Done when` line depends on it · When any part is below zero, `endedSentence` tells people they can take back more than the bucket holds. The sentence's "It" stands for the balance, but the positive parts listed after it add up to more than that balance. Measured:
  - At 900.00 $ left, it reads "900.00 $ is left in the bucket. It is each person's own, theirs to take back: Alex 1100.00 $, Kim 300.00 $. Sam owes 500.00 $."
  - With a short bucket, it reads "The bucket is 400.00 $ short. It is each person's own, theirs to take back: Alex 100.00 $. Sam owes 500.00 $."

  This happens through the real route: a joint payment larger than the deposits gives balance −100.00 $, with alex +400.00 $ and sam −500.00 $. The error runs in the unsafe direction, because a person can withdraw money the bucket does not hold. The debt named in the same sentence softens it. Fix direction: when any part is below zero, say the positive parts are owed to those people, not theirs to take back now.

- **med** · no `Done when` line depends on it · The sentence the round added to `docs/00-ANALYSIS.md` §4 says that at a zero balance with a negative part "the screens then say who owes it". Measured on all 3 zero-balance shapes, none does: there is no Home section, no Own card after the close, no note on the Own card, and the household line reads only "The mortgage ended on 2026-03-31." This is the cost gate 1 named for the option the owner chose. The error runs in the unsafe direction: a reader would believe the imbalance between members stays visible.
- **low** · `mortgageStanding` (`household/MortgageSetting.tsx`) reads "-500.00 $ is left in the bucket." when the balance is negative. Home says "The bucket is 500.00 $ short." for the same books. This is reachable through the route (3 of 3 shapes there were negative). The error runs in the safe direction: nobody withdraws a negative sum.
- **low** · no live call site · At a zero balance, `endedSentence` returns "The mortgage ended on 2026-03-31. It is each person's own, …". The "It" there has nothing to refer to except the mortgage. The round's test "the sentence drops the balance when it is zero…" pins that text. Neither screen draws it.
- **dropped** · a person id starting a sentence in lowercase ("sam owes …") when a person has no shown name. `leadSentence` on `main` has the same shape (`${who} has paid the most`), so the round did not introduce it.
- **dropped** · amounts formatted as "1100.00 $". That is `formatCents`, the formatter behind Home's list beside the sentence and every other figure in the ledger.
- **dropped** · a part of exactly 0 is left out of the sentence. The docstring states this, and Home's list above the sentence still shows that person at 0.00 $.
- **dropped** · the 4 s `card()` wait hiding a slowdown. Refuted under F3 above.
- **findings** · the hunt returned 8; 4 carried, 4 dropped. None is a `high`.
- NFR: security n/a (no route or guard changed) · performance — one render later for the two mortgage cards, about +200 ms on the cold test · reliability — the two meds above · maintainability — the lows above. The `tools/ledger/CLAUDE.md` line is true: `current_mortgage_record` is read only by `mortgageStatus`, records are only ever `INSERT`ed, and no stats, buckets or settlement module reads the record.

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
- 2026-10-20 (round 1, after gate 1 at e0f792e1): the owner answered the gate's
  decisions. Each is a test.
  - **F1, "nothing left" is the balance** (owner: `left` is
    `balanceCents !== 0`, over keeping the parts rule). `api/src/mortgage.ts`; the
    contract comment, `00-ANALYSIS.md` §4 and the Log above now say so.
    `api/test/mortgage.test.ts` "a bucket at zero has nothing left, whatever each
    person's part" (alex 1 000.00 $ in, one joint 1 000.00 $ payment: `left: false`,
    alex +500.00 $, sam -500.00 $); `web/test/mortgage.test.tsx` "books ended with
    the bucket at zero but parts that are not, draw no Own card and no Home
    section". The earlier "measured" line above (16 of 16) predates this; the
    round's figures are below.
  - **F2, a negative part is owed** (owner: name it as owed; drop the balance
    sentence at zero). One function, `endedSentence` in `web/src/mortgage.ts`,
    serves Home and the Own card. The strings, for the owner:
    - money left, parts above zero: "The mortgage ended on 2026-03-31. 199.99 $ is
      left in the bucket. It is each person's own, theirs to take back: alex 149.99
      $, sam 50.00 $."
    - with a part below zero: "The mortgage ended on 2026-03-31. 600.00 $ is left
      in the bucket. It is each person's own, theirs to take back: alex 1100.00 $.
      sam owes 500.00 $."
    - balance zero (the function's own case; the cards close before it is shown):
      "The mortgage ended on 2026-03-31. It is each person's own, theirs to take
      back: alex 500.00 $. sam owes 500.00 $."
    - balance below zero: "The mortgage ended on 2026-03-31. The bucket is 100.00 $
      short. Sam owes 100.00 $." (my addition; the owner did not name it.)
    - A part of exactly zero is not mentioned. The household screen's standing line
      drops the part clause: "The mortgage ended on 2026-03-31. 199.99 $ is left in
      the bucket."
      Tests: "a part above zero is theirs to take back and a part below zero is owed,
      on Home and on the Own card" (both signs, both places) and "the sentence drops
      the balance when it is zero, and says a short bucket is short".
  - **F3, the mortgage cards wait for the read** (owner: hold them, as Home does;
    a failed read draws them as live; overrides my "keep as built"). `Stats.tsx`
    draws neither card while `useMortgage` is loading. Tests: "a household recorded
    as none never draws the mortgage cards or asks for their series"
    (`fetchMortgagePayments` and `fetchMortgageOwn` never called) and "the mortgage
    cards wait for the read, and a failed read draws them as live". The cost the
    gate named is real: the other cards sit one render earlier than these. Because
    those two now mount one render later, `card()` in `stats.test.tsx` waits up to
    4 s instead of 1 s: its first test, a cold render of ten charts, took 1.1 to
    1.4 s alone and failed in a parallel run at 1.5 s with the old limit.
  - **`tools/ledger/CLAUDE.md`** gained the proposed line, in the paragraph on
    appended records, unchanged by F1: "The household's word on its mortgage is the
    same (lg-55, `current_mortgage_record`: live, ended on a day, or none); it
    decides which views are shown and never what is counted."
  - **The two other lows stay unfixed:** "today" is the API's UTC clock, as
    `salaries.ts`, `periods.ts` and `routes/stats.ts` already use; and the
    equal-payment fixture. The varied-fixture test was free and is in: "the end
    marker is told from a renewal's" (payments 700.00, 712.34, 712.34 $; the last a
    payment dated after `endedOn`): two dots, and only the last point carries
    "Last payment on …".
- 2026-10-20 — Fixed at landing by owner choice: gate 2, med 1 — "When any part is
  below zero, `endedSentence` tells people they can take back more than the bucket
  holds." `endedSentence` now reads "<Name> is owed <x> $" for a positive part and
  "<Name> owes <y> $" for a negative one whenever any part is below zero, and keeps
  "theirs to take back" only when none is. At 900.00 $ left it reads "… 900.00 $ is
  left in the bucket. Alex is owed 1100.00 $, Kim is owed 300.00 $, Sam owes 500.00
  $." The two tests that pinned the old strings are updated and "with a part below
  zero the parts above it are owed, so three people do not each take back more than
  the bucket holds" is new. `npx vitest run tools/ledger/web/test/mortgage.test.tsx`
  → 3 failed of 21 against the previous `mortgage.ts`, 21 passed of 21 against this
  one.
- 2026-10-20 — Fixed at landing by owner choice: gate 2, low 2 — "At a zero balance,
  `endedSentence` returns "The mortgage ended on 2026-03-31. It is each person's
  own, …". The "It" there has nothing to refer to except the mortgage." At a balance
  of 0 with a part below zero the sentence drops "It is each person's own" and names
  the parts with the owed/owes wording above; the same commit. The test "the
  sentence drops the balance when it is zero, and says a short bucket is short" now
  pins "The mortgage ended on 2026-03-31. alex is owed 500.00 $, sam owes 500.00 $."
  Same command, same count as the entry above.
- 2026-10-20 — Fixed at landing by owner choice: gate 2, med 2 — "The sentence the
  round added to `docs/00-ANALYSIS.md` §4 says that at a zero balance with a
  negative part "the screens then say who owes it". Measured on all 3 zero-balance
  shapes, none does." `00-ANALYSIS.md` §4 now says no screen shows that imbalance
  between people after the close, the cost the owner accepted with F1's option A.
  `grep -c "screens then say who owes it" tools/ledger/docs/00-ANALYSIS.md` → 1
  before, 0 after.
- 2026-10-20 — Fixed at landing by owner choice: gate 2, low 1 — "`mortgageStanding`
  (`household/MortgageSetting.tsx`) reads "-500.00 $ is left in the bucket." when
  the balance is negative. Home says "The bucket is 500.00 $ short." for the same
  books." At a negative balance `mortgageStanding` now reads "The bucket is 500.00
  $ short.", as Home does; the new test is "the household screen's line says a
  short bucket is short, as Home does". `npx vitest run
tools/ledger/web/test/mortgage.test.tsx` → 1 failed of 22 against the previous
  `MortgageSetting.tsx` (the new test), 22 passed of 22 against this one.
