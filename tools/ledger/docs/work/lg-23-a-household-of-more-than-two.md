---
id: lg-23
tool: ledger
title: A household of more than two people
kind: work-package
status: ready
milestone: P6
depends_on: [lg-20, lg-22]
difficulty: hard
---

# lg-23 — A household of more than two people

## Why

The owner, asked on 2026-10-12 whether lg-20's cap of two person names in a
household should count every name ever held or only the current members, said
the cap should not exist: "A household could have 3, 4, 5 if needed." That
answer keeps the cap as built for now and asks for this ticket
([lg-20](./lg-20-the-household-directory.md), Log).

The cap is there because the books are two people's. Each place is a refusal,
not a missing feature:

- `books/src/ratio.ts` — `ratioFromSalaries` refuses anything but two salaries
  ("A ratio is between two people's salaries.") and gives the second person
  what the first leaves out of 1 000 000.
- `books/src/settlement.ts` — `pairOf` takes the two shares in id order, and
  `owedMicro` refuses a stretch whose ratio is not between those same two people
  ("Every ratio in a settlement is between the same two people."). The matching
  rule is written for one payer and one recipient: `Settlement` has a single
  `payerId`, `recipientId` and `depositCents`.
- `books/src/buckets.ts` — `mortgageAsOf` already splits a joint row between any
  number of people, but `leadOf` returns `null` unless there are exactly two, so
  the mortgage bucket's "who is ahead" disappears.
- `api/src/salaries.ts` — `proposalFor` proposes a ratio only for a year holding
  exactly two salaries.
- `api/src/db/schema.ts` — `periods` records a closed settlement as one
  `payer_id`, one `recipient_id`, one `deposit_cents` and one `net_cents`, and a
  CHECK that the first two are both set or both null.
- `api/src/directory.ts` and the directory's migration 1 — lg-20 refuses a third
  name with `HOUSEHOLD_FULL`, in a trigger and in the class, and
  `api/src/household-command.ts` says "A household holds two people".

`ratio_shares` and `mortgageAsOf` are already per person, so the storage of a
ratio and the split of the mortgage bucket do not need a new shape. The
settlement and its record do.

### Reproduction

What lifting only the cap does today. The gate for lg-20 (Sonnet 5.5, xhigh, at
`6baf3dd6`) built books with `alex` and `sam` and one closed period, removed
`sam`, then added `casey` as a third name by dropping the cap's trigger on a
scratch copy of the directory. Under lg-20 the directory refuses this on its own,
so the run needs the trigger dropped. It cannot be reproduced from a normal
checkout in any other way. The figures are the gate's, from its full report on
pull request #441:

| Read                                                             | sam removed, nobody added                 | sam removed, casey added                                                         |
| ---------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `/api/buckets` mortgage `own` (balance 19999)                    | alex 14999, sam 5000; `lead` alex by 9999 | alex 26666, casey -23334, sam 16667; `lead` null                                 |
| `/api/periods/open?end=2027-01-31` and `POST /api/periods/close` | 200                                       | 400 `BAD_REQUEST`, "Every ratio in a settlement is between the same two people." |

Salaries and ratios still succeeded with `casey`. So a third name is stored,
splits the mortgage bucket three ways, loses its lead, and then no period can be
opened or closed: the household's books stop at the settlement, which is the
one step the household exists to do.

### Where lg-22 stops

[lg-22](./lg-22-manage-households-from-the-app.md) already owns changing
membership over time: an admin creates households and adds or removes any
member, and a member adds one to their household. This ticket does not
duplicate that. It lifts the number two, and only the books' arithmetic and the
directory's cap change.

The owner's words also asked for "a way to manage persons in household, because
it can change". Read against lg-22 that raises questions lg-22 does not answer,
put to the owner below as Question 4 and not as Build steps.

## The decision

**Answered by the owner on 2026-10-12, every recommendation taken:**

1. **A** — the matching rule, generalised: up to N − 1 buffer deposits.
2. **A** — `lead` is the person with most and their margin over the next.
3. **A** — a membership change that changes the people in a ratio waits for a
   close, so every stretch has the same people.
4. lg-22's "remove a member" removes an **address**. A person's name stays in
   the books for good. **lg-22 lands first**, with the cap, and this ticket
   changes lg-22's test that refuses a third name.

The answers also approve `HOUSEHOLD_FULL` leaving `@ledger/contract` (Build 4).
The questions are kept as asked below, so the reasoning stays on record.

Nobody can build this until the owner chooses how a settlement works for more
than two people, because it changes what money the household is asked to move.

**Question 1. How does a settlement generalise?** Today: shares `r` and `1 − r`;
`net = r × (A + B) − A + charges`; one person deposits `net / (1 − r)` or `−net / r`
into the buffer, or pays `net` directly.

Stated per person, with `r_i` the closing ratio's shares and `e_i` each person's
cumulative contribution after charges (what they put in, less what they owe
another by charge, plus what is owed them): `net_i = r_i × Σe − e_i`. These sum
to zero. For two people they are exactly today's `net` and `−net`. `net_i` is
linear in every contribution, so a stretch's nets still add across a ratio
change, and a person absent from a stretch contributes zero to it. That derivation
is mine and has not been run against the code; the build checks it first, and a
test proves it reduces to `settleStretches` for two people to the cent.

- **A. The matching rule, generalised (recommended).** Everyone short tops up
  until all contributions stand at the ratio. A person's deposit is
  `net_i + r_i × K`, with `K = max_i(−net_i / r_i)` over those with `r_i > 0`,
  the smallest top-up that leaves nobody depositing a negative amount, and
  the person furthest ahead for their share deposits nothing. A close then
  produces up to N − 1 deposits, and the direct form is up to N − 1 transfers
  from those with a positive `net_i`. Cost: `Settlement` and the `periods`
  record become a list, the contract's `payerId`/`recipientId` change shape, the
  deposit matcher (`matchDeposits`) must match several, and a household of two
  must keep reading exactly as it does. The matching rule is the owner's own
  (`00-ANALYSIS.md` §5), kept.
- **B. A buffer deposit only for two; transfers otherwise.** For more than two
  people a close names net transfers only. Cost: smaller, no change to what two
  people see, but a household of three settles by direct payment while a
  household of two settles into the buffer, and the buffer stops being funded
  at the ratio by settlements, which §5 says is the point of matching.

**Question 2. The mortgage bucket's lead.** `own` is already per person.
(A) `lead` is the person with most and their margin over the next (recommended);
(B) no lead for more than two, `own` alone.

**Question 3. A person who joins or leaves between two closes.** `owedMicro`'s
refusal is, in part, this case: a ratio changes at a boundary because the people
did. (A) A membership change that changes the people in a ratio waits for a
close, so every stretch has the same people (recommended: nobody leaves owing);
(B) allow it, and sum the per-person nets across stretches with different people.

**Question 4. For lg-22, not for this ticket.** Does lg-22's "remove a member"
remove an address or a person? A name is permanent in the books and a person may
hold several addresses, so removing the last address of a name leaves the name in
the ratio and the settlement. lg-22 step 4 also refuses "a third person name
(lg-20's cap)", which this ticket lifts; whichever of the two lands second changes
the other's test. Decide the order, and whether a person can be taken out of the
books at all.

## Build

The answers are above. Build after lg-22 has merged.

1. **The arithmetic**, in `books/` where it is pure. `ratioFromSalaries` for N
   salaries, with the rounding rule extended past one remainder (shares sum to
   exactly 1 000 000; a tie rule that needs no state, like the odd cent in
   `buckets.ts`). The settlement is the generalised matching rule (Question 1
   A). Check the derivation against `settleStretches` before building on it.
2. **The record.** `periods` and the contract's period shapes carry the
   settlement as a list of deposits and transfers. The books' stored formula
   stays `v3` for two people, and a household of two reads and closes unchanged.
3. **The mortgage bucket**: `lead` is the person with most and their margin
   over the next (Question 2 A). `proposalFor` proposes for N salaries.
4. **The directory.** Directory migration 4 (2 is lg-22's, 3 is lg-24's) drops the cap's trigger (migration
   1 stays as shipped, appended never edited), the class stops counting names,
   `HOUSEHOLD_FULL` leaves `@ledger/contract` (approved with the answers) and
   the host command's text changes. lg-20's tests for the cap change with it,
   and so does lg-22's test that refuses a third person name (Question 4).
5. **People change only at a close** (Question 3 A). A ratio whose people
   differ from the open stretch's people does not take effect inside the open
   period. The build chooses whether it is refused or deferred to the next
   period, and records which in the Log. Removing an address never removes a
   name from the books (Question 4).
6. **Docs.** `00-ANALYSIS.md` §7's "a household is still exactly two people" and
   the ledger `CLAUDE.md`'s person-name rule, and the roadmap row.

## Done when

1. Reproduction above, run against the finished build: with `sam` removed and
   `casey` added (no trigger dropped), `/api/buckets`, `/api/periods/open` and
   `POST /api/periods/close` all answer 200.
2. For two people the new settlement equals `settleStretches` to the cent on the
   existing settlement tests, unchanged, and on a property test over varied
   salaries (not one fixed pair).
3. For three, four and five people, the nets sum to zero, nobody deposits a
   negative amount, and after the deposits every contribution stands at its
   share to within a cent each.
4. A household can hold more than two names in the directory, and a test that
   asserts a third is refused is replaced by one asserting it is not.
5. A test proves that a ratio with a different set of people cannot take effect
   inside an open period.
6. Gates green.

## Log

- 2026-10-12 — Filed from the owner's answer on lg-20's cap. Read at filing:
  `ratio.ts`, `settlement.ts`, `buckets.ts` and the `periods` and `ratio_shares`
  tables, which is where the Why's list comes from. `depends_on` is lg-20
  because the cap is its. It does not wait for lg-21: nothing here needs a
  second household's books, and a bigger household in the one books file works
  the same. It does not wait for lg-22 either, but Question 4 asks the owner to
  fix the order.
- 2026-10-12 — The owner answered all four questions over `AskUserQuestion`,
  each time taking the recommended option. The answers are under _The decision_.
  The status is now `ready`, `difficulty` stays `hard`, and `depends_on` adds
  lg-22, because Question 4 put it first. Build 5 and Done when 5 are new and
  carry Question 3. Question 4's recommendation came from the session that
  asked, not from the filing.
- 2026-10-13 — Build 4 said "a directory migration 2" for the cap's trigger, but
  migration 2 is lg-22's and is on `main`. Corrected to "the next free directory
  migration (migration 2 is lg-22's)", which is the number lg-24 also uses, so
  whichever lands second takes the next free one. Command and output at the
  correction, on `origin/main`:
  `git show origin/main:tools/ledger/api/src/db/directory-schema.ts | grep -n -i 'migration'`
  ```
  5: * migrations numbered from 1 in its own `user_version`. The books' migrations
  17:import { applyMigrationList, configure } from "./schema.ts";
  20: * Each entry is one irreversible step. Never edit a shipped migration — append
  23:const DIRECTORY_MIGRATIONS: readonly string[] = [
  123:/** Brings a directory up to `target`, every migration by default. */
  124:export function migrateDirectory(db: Database, target: number = DIRECTORY_MIGRATIONS.length): void {
  126:  applyMigrationList(db, DIRECTORY_MIGRATIONS, target);
  ```
  The grep does not show the number itself. Migration 2 is the entry commented
  `// 2 — a record is never replaced (lg-20's gate, F2; lg-22).` in the array
  above, and the comment has no word "migration" for the grep to match.
- 2026-10-17 — Built on `8e50f0d4`, branch `lg-23-households`.

  **What the brief had wrong.** Build 4's "the next free directory migration"
  is 4, not 3: lg-24 took 3 (`// 3 — a household is never added without an id
(lg-24)` in `api/src/db/directory-schema.ts` on `8e50f0d4`). Build 4 now says
  so. Question 1 said "the person furthest ahead for their share deposits
  nothing"; that holds, but its claim that rounding each deposit once, half-up,
  is enough does not past three people. Measured with a scratch search over
  200 000 skewed five-person histories (seed 7): rounding each deposit alone
  left someone 1 444 620 millionths of a cent off their share, against 999 370
  for the rounding built. The reason is the person furthest ahead: they deposit
  nothing and move by their share of every other deposit's rounding. Four is
  already enough: with each deposit rounded alone, the four-person property test
  fails at trial 1207 with `casey: expected 1046539 to be less than or equal to
1000000`. So `roundDeposits` (in `books/src/settlement.ts`) rounds the deposits
  together. As many go up as the sum of their fractions rounds to, half-up, so
  the total is off by half a cent at most. A deposit goes up, or down, only if
  that keeps its person within a cent. There are always enough of each to
  choose from. The argument, with `f_i` a fraction, `r_i` a share and `S` the
  total rounding: going down, `S` is in (−½, 0] and `c` deposits must go up; if
  fewer than `c` had `f_i ≥ r_i·|S|`, then `Σf < (c − 1) + |S|·Σr ≤ c − 1 + |S|`.
  That is below `Σf = c + |S|`, a contradiction. Going up is the mirror. With one
  fraction to round this is half-up, which is every two-person settlement.

  **The derivation, checked first.** `settleHousehold` computes `net_i` per
  stretch and the deposits `net_i + r_i·K`. `settleStretches` is now that,
  read in lg-6's shape (`asPair`). `books/test/settlement.test.ts` is unchanged
  (`git diff --stat 8e50f0d4 -- tools/ledger/books/test/settlement.test.ts` prints
  nothing), and all 30 of its tests pass against it. lg-6's formula as it stood is
  kept as a test oracle (`books/test/helpers/two-person-v3.ts`). The property test
  compares against it over 5 000 two-person histories. Each has one to four
  stretches at varied ratios, a share of zero in one ratio in ten, and charges
  both ways. Over that draw more than 4 000 owe and more than 50 settle only
  directly.

  **Build 5: refused, not deferred.** A ratio whose people differ from the open
  period's is refused when it is confirmed, as `BAD_REQUEST`, with the open
  period's first day in the sentence. `requireSamePeopleInOpenPeriod` is in
  `api/src/salaries.ts`, and it runs inside the confirm's transaction, so nothing
  is stored. Deferring would show one ratio on the salaries screen and settle at
  another, with nothing saying so. The open period's people are those of the
  ratio in effect on its first day, the day after the last close. Before any
  close they are the earliest ratio's: the first period runs from the beginning.
  So a change of people before the first close is refused too, unless it replaces
  the first ratio on its own day. Only a breach the new ratio is part of is
  refused, so an older one can never block a confirm. The refusal reuses
  `BAD_REQUEST`, as every other ratio refusal in `books/src/ratio.ts` does. The
  error taxonomy gains nothing and no `Done when` line changed.

  **The record.** A close between exactly two people writes its `periods` row
  as before and nothing else. A test reads the stored row: `payer_id` alex,
  `recipient_id` sam, `deposit_cents` 15 000, `net_cents` 6 000, and no rows in
  the new tables. A close between more is books migration 10's
  `settlement_deposits` and `settlement_transfers`. Its `periods` row says
  nobody, with `deposit_cents` NULL when only transfers settle it. "More" counts
  everyone the settlement names: a two-person ratio with a person who has left
  and is still owed is a three-person settlement. The formula stays `v3` for
  every close. Between two people the figures equal lg-6's to the cent, and a
  `v4` would have meant rebuilding `periods` for its CHECK. The contract's
  `SettlementFigures` swaps `payerId`, `recipientId`, `depositCents` and
  `netCents` for `deposits` (or `null`) and `transfers`. `ClosedPeriod.deposit`
  swaps `rowId` for `deposits`, one outcome per person. `matchDeposits` matches
  each deposit to its own person's row.

  **A person outside the closing ratio** has a share of zero in it. Their nets
  still count. If they are owed, the close is settled by transfers alone
  (`deposits: null`), as lg-6 did when the recipient's share was zero. The
  reproduction's close is that case: casey's 30.00 in January, at alex and sam's
  ratio.

  **Folded in.** `web/src/periods/LineForm.tsx`: with more than two people a
  charge asks whose it was, where it used to name the first other person. Lifting
  the cap made that a wrong charge. The settlement sentences, the deposits-not-seen
  list, the stats card and the home screen's lead read the new shape, and a
  two-person household's text is unchanged. **Not folded in:** the salaries
  screen still asks a salary of every person the books name, a person who has
  left included. A blank meaning "not in this year's ratio" would change what a
  blank means, so it is a question, not a fold-in.

  **Done when**, each with its test:

  1. `api/test/more-than-two.test.ts`, "with sam removed and casey added, the
     buckets, the open period and a close all answer 200". It uses the
     directory's own `removeMember` and `addMember` and drops no trigger. The
     mortgage reads alex 26 666, casey −23 334, sam 16 667, with `lead` alex by
     9 999.
  2. The unchanged `books/test/settlement.test.ts` (30 tests), and
     `books/test/household-settlement.test.ts`, "over 5 000 histories of varied
     salaries, stretches, ratio changes and charges".
  3. `books/test/household-settlement.test.ts`, "for %i people the nets sum to
     zero…", for 3, 4 and 5 people with 3 000 histories each. A fixed five-person
     case also fails if each deposit is rounded alone.
  4. `api/test/directory.test.ts`, "a third, a fourth and a fifth person name are
     taken, by the code and by the schema". It replaces lg-20's "a third person
     name is refused as HOUSEHOLD_FULL…" and "a name the household held once
     still counts…". "migration 4 drops the cap a directory at migration 3 still
     holds" refuses casey at 3 and takes casey at 4. lg-22's tests changed with
     it: `api/test/households.test.ts`, the admin's "third person" case and the
     member's, and `api/test/household-command.test.ts`.
  5. `api/test/more-than-two.test.ts`, "a ratio between different people from
     inside the open period is refused, and nothing is stored", with two
     companions and a before-any-close case. With the check disabled, 3 of the 6
     tests in that file fail.
