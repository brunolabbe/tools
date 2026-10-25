---
id: lg-23
tool: ledger
title: A household of more than two people
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-17 · `8e50f0d..4143a88` · Sonnet 5.5, depth full

| Done when                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. With `sam` removed and `casey` added (no trigger dropped), `/api/buckets`, `/api/periods/open` and `POST /api/periods/close` answer 200              | `api/test/more-than-two.test.ts` › "with sam removed and casey added, the buckets, the open period and a close all answer 200" ✓. It asserts the three status codes, the mortgage figures (alex 26 666, casey −23 334, sam 16 667, lead alex by 9 999) and the close's transfers. I reran it on a populated database migrated from the base: 200, 200 and 200.                           |
| 2. For two people the new settlement equals `settleStretches` to the cent on the existing tests, unchanged, and on a property test over varied salaries | **proven as worded.** `books/test/settlement.test.ts` is byte-unchanged and its 30 tests pass. `books/test/household-settlement.test.ts` › "over 5 000 histories of varied salaries, stretches, ratio changes and charges" ✓. **Its intent is contradicted in one class of two-person history that this test never draws: F1, a med this line depends on.**                              |
| 3. For three, four and five people the nets sum to zero, nobody deposits a negative amount, every contribution stands at its share to within a cent     | `books/test/household-settlement.test.ts` › "for %i people the nets sum to zero, nobody deposits a negative amount, and after the deposits everyone stands at their share to within a cent" ✓ for 3, 4 and 5. Three assertions carry the three clauses: the nets sum to `0n`; each deposit is greater than 0; the standing after the deposits is at most 1 000 000 millionths of a cent. |
| 4. A household can hold more than two names; the test that a third is refused is replaced by one asserting it is not                                    | `api/test/directory.test.ts` › "a third, a fourth and a fifth person name are taken, by the code and by the schema" ✓ and "migration 4 drops the cap a directory at migration 3 still holds, its records unchanged" ✓. Companions that changed with it: `households.test.ts` and `household-command.test.ts`.                                                                            |
| 5. A test proves a ratio with a different set of people cannot take effect inside an open period                                                        | `api/test/more-than-two.test.ts` › "a ratio between different people from inside the open period is refused, and nothing is stored" ✓. It asserts 400 `BAD_REQUEST`, the first day in the message, the ratios list equal to before, and the open period still alex and sam. With the call removed, 3 of the file's 6 tests fail, this one among them.                                    |
| 6. Gates green                                                                                                                                          | PR #508's checks on the gated head all pass: `check` ×2, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review` ✓. Locally the ledger project is 1138 of 1138 in 62 files. The base is 1114 of 1114 in 60 files.                                                                                                   |

- **med** · Done when 2 depends on it · **F1. A two-person close differs from lg-6 when the closing ratio gives the person owed a share of zero and what is owed is under half a cent.**
  - Base `settleStretches` returns payer, recipient, `depositCents: null` and `netCents: 0`, so the period is stored as "direct" (`payer_id` set, `deposit_cents` NULL) and the screen says "alex pays sam 0.00 $ directly".
  - The head returns nobody: `payerId: null`, `recipientId: null`, `depositCents: 0`, `netCents: 0`. The period is stored as "none" and the screen says "Nobody owes anything".
  - No cent figure differs. The record, the deposit status and the sentence do.
  - It is reachable in ordinary use. A household settles earlier periods to the cent at one ratio, then moves to a ratio with a zero share, and a rounding remainder of a fraction of a cent stays owed.
  - The base source comment says that case "never rounds away". That holds for one stretch only.
  - The builder's oracle property test cannot find it, because its histories never leave a sub-cent residual. The Log's "Between two people the figures equal lg-6's to the cent" is false for this class.
  - Reproduction, books level, with `books/src/index.ts` of each tree:
    - stretch 1: ratio alex 666 667 and sam 333 333; contributions alex 2 cents and sam 1 cent
    - stretch 2: ratio alex 1 000 000 and sam 0; no lines
    - call `settleStretches([s1, s2], ratio2)`
    - base: `{"formula":"v3","payerId":"alex","recipientId":"sam","depositCents":null,"netCents":0}`
    - head: `{"formula":"v3","payerId":null,"recipientId":null,"depositCents":0,"netCents":0}`
  - Through the API I drove the same random two-person households through `/api/salaries`, `/api/ratios`, `/api/periods/lines`, `/api/periods/close` and a deposit paste, at the base and at the head, and compared every answer. Seed 5: 60 histories, 334 closes. Seed 11: 250 histories, 1 386 closes. 7 of 310 histories differ. Every first difference is this class, and the later ones follow from it. The generator makes a zero share one ratio in six, so the rate is inflated.
  - **Open decision.**
    - **(A)** Restore lg-6's result for this class. When exactly two people are named, someone owed has a zero share and every transfer rounds to nothing, return payer, recipient, `deposits: null` and zero. Add a residual-drawing case to the property generator.
    - **(B)** Keep "nobody owes", which is arguably the better reading. Reword Done when 2 and the Log's claim, add a test pinning the new reading, and accept that the stored status becomes "none" where lg-6 stored "direct".
    - Recommendation: **A**, because the ticket's promise is that a household of two "reads and closes unchanged". B can be its own ticket.
    - If the owner reads Done when 2 as strict equality of the returned settlement, F1 is a `high` and the gate is FAIL.
- **med** · no Done when depends on it · **F2. A receipt item marked "the other's" is charged to the first person who is not the payer, and there is no way to choose another.**
  - It is the same shape the builder fixed in `LineForm.tsx` ("lifting the cap made that a wrong charge"). The receipts path was neither fixed nor mentioned.
  - API: `fileLines` in `api/src/receipts.ts` sets `other` to the first person not the payer and files the charge line with `chargedTo: other`.
  - Web: `web/src/receipts/Receipts.tsx` does the same with `people.find((person) => person !== payer)`. It labels the checkbox and each item "This was alex's" and sends `chargedTo: theirs ? other : null`.
  - In a household of alex, casey and sam, a receipt filed by alex always charges casey.
  - Reproduction: copy `api/test/receipts.test.ts` to a scratch name inside `api/test`, then replace `directory: memberDirectory(),` with `directory: memberDirectory([[ALEX, "alex"], ["casey@example.test", "casey"], [SAM, "sam"]]),`. Run `npx vitest run <copy> -t "an item marked as the other's becomes a charge"`. It fails on `- "charged_to": "sam"` against `+ "charged_to": "casey"`. Delete the copy afterwards.
  - **Open decision.**
    - **(1)** In this ticket, refuse a "theirs" item when the household has more than two people, with a message that says to file the charge as a line. The web hides the choice for more than two. No contract change.
    - **(2)** Name whose: a person on the item or on the filing. That is a contract change, so the owner's, and a ticket of its own.
    - Recommendation: **(1)** now, **(2)** filed.
    - The sibling lg-27 reads receipt items. I did not check it for the same assumption.
- **low** · **F3. In a two-person household the settlements card loses the recipient in one case.**
  - The case is a deposit of at least 1 cent where the direct amount rounds to 0.
  - Base renders "sam owes alex". The head renders "sam owes", from `who()` in `web/src/stats/Cards.tsx`.
  - So the Log's "a two-person household's text is unchanged" is false in this case. It is false in the safe direction: nothing relies on it.
  - Render of `<SettlementsCard>` with `deposits: [{sam, 1}], transfers: []` gives "2026-02-28 v3 sam owes 0.00 $ 0.01 $". The same case in the base tree's old shape gives "sam owes alex".
  - The fix is to derive the recipient from `shares`, as `settlementSentence` in `Periods.tsx` already does.
- **low** · no live call site · **F4.** The multi-person branch of `describeSettlement` in `api/src/workbook-import.ts` has no test. The two-person lines it prints are asserted in `workbook-import.test.ts`. The importer reads a two-person workbook, so the branch is not reached in practice.
- **dropped** · The direct transfers can leave a person up to 1.97 cents off at five people (up to (n−1)/2 cents). Each transfer is rounded half-up on its own and a piece under half a cent is dropped. No acceptance line bounds it, and the next close asks again.
- **dropped** · Deposits non-null although a zero-share person is owed 0.000243 cent (1 of 250 000, five people). That amount rounds to nothing, so it is correct.
- **dropped** · TS2883 in `api/test/helpers/households.ts` when `npm run check` ran in my scratch merge trees. It is environmental, a path-depth artefact, and it reproduces on the base sha. It is recorded as a process-page defect in the report.
- **dropped** · A different-people ratio dated at or before the last close is accepted when it is the ratio in effect on the open period's first day. The open period still has uniform people, so it is consistent with Build 5. The closed periods keep their recorded ratios.
- **dropped** · A future-dated different-people ratio is refused. That is stricter than needed but is the "refuse, not defer" choice the Log records.
- **dropped** · The salaries screen still demands a salary from a person who has left. The builder flagged it and it is a product decision. Entering 0 works, because a zero share keeps the person in the ratio. It is relayed as an open decision in the report.
- **dropped** · The previous build reads a three-person close as "nobody owes", and nothing guards against opening a newer database with an older build. That is the repo-wide convention for irreversible migrations. Two-person closes written by the head read identically in the base (measured), and all households today are two-person.
- **dropped** · `BAD_REQUEST` with a specific sentence at the raise site. The Build 5 refusal follows the ledger's convention, with 39 such sites at the head. It is an existing code and not a defect.
- **findings** · the hunt returned 12: 4 carried (F1 to F4), 8 dropped.
- NFR: security ✓ (no new route; SQL is parameterised; the refusal sits behind the existing auth) · performance ✓ (two small queries per closed period per read; the matching is O(n log n)) · reliability ✓ (a close is one immediate transaction; migrations are atomic, measured by forcing migration 10 to fail midway) · maintainability — F1 to F3.

### Gate 2

**Gate: CONCERNS** — 2026-10-17 · `4143a88..66a6063` (round: `9b155a7`, `08b1604`; the merge of main at `9e15790` is not the round) · Sonnet 5.5, depth full

Gate 1's F1 to F3 are fixed. F4 was left as recorded. I found nothing above a med and no `high`. There are two new meds and two new lows, all in lines this round touched. No `Done when` line of lg-23 depends on any of them, so they are recorded rather than opening a round. Each has a fully stated fix.

| Done when                                                                 | Proof at `66a6063`                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. For two people the new settlement equals `settleStretches` to the cent | **proven, and the intent now holds too.** `books/test/household-settlement.test.ts` › "names who owes whom, paid directly, as lg-6 did (the gate's reproduction)" and "over 5 000 histories that leave a residual of a fraction of a cent, it is lg-6's settlement" assert it. At the API layer it is **verified**, not asserted: see F1 and N1.                                   |
| 6. Gates green                                                            | `npm run check` exit 0; ledger project 1157 of 1157 in 62 files (1138 at gate 1; the rest is the merged lg-26 tests and the round's new ones). PR #508 on this head: `check` ×2, `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review` and `test (ubuntu-latest)` pass. `test (windows-latest, informational)` was still pending when I stopped, so it is read, not graded. |

Done when 1, 3, 4 and 5 are untouched by the round. Their specs pass in the full run.

**Verdicts on gate 1**

- **F1, fixed.**
  - The `minimal` history now answers `{"payerId":"alex","recipientId":"sam","depositCents":null,"netCents":0}`, which is the base's answer.
  - 40 000 random two-person histories against the base tree's `settleStretches`: 0 mismatches. 93 of them reached the class.
  - The API differential (60, 250 and 300 histories, seeds 5, 11 and 23; 3 411 closes): 0 of 610 histories differ, against 7 of 310 at gate 1. 16 closes in 12 histories were in the class.
  - The fix fires only for exactly two named people. I compared `settleHousehold` at this head with gate 1's on 40 000 histories each of 3, 4 and 5 people, including a closing ratio that leaves someone out: 0 of 120 000 changed. Of the 40 000 two-person histories, 220 changed, every one "nobody" becoming one 0-cent direct transfer.
  - `property.mts` rerun, 100 000 per size: no zero-sum failure, no non-positive deposit and no standing over a cent. The worst standing is 0.749681, 0.989028 and 0.999994 cent for 3, 4 and 5.
  - Red then green: with `books/src/settlement.ts` put back to gate 1's version, the two new books tests fail (`trial 6`, as the Log says); restored, 11 of 11 pass.
- **F2, fixed by refusing.**
  - `api/test/receipts.test.ts` › "an item marked as the other's, among more than two › is refused, and nothing is filed" fails with `api/src/receipts.ts` put back to gate 1's version, and passes at the head. It asserts 400 `BAD_REQUEST`, "more than two people" in the message, and 0 rows in `period_lines` and `receipt_filings`.
  - The companion "a receipt with nothing marked as the other's still files" passes.
  - The web test "among three people, an item cycles between shared and not shared only, and the receipt is nobody's" fails with `Receipts.tsx` put back to gate 1's version. That put-back also removed lg-26's two lines, so lg-26's own web test failed beside it; that second failure is my artefact.
  - Judgement on the hidden "This was X's" checkbox, which goes beyond the finding's words: it is within F2's shape and not a scope change. F2 named that checkbox and the `chargedTo: theirs ? other : null` send as the same first-other pick. Leaving it would have kept the wrong-person charge on the whole receipt.
  - It does remove a control from the receipts screen for households of more than two. The API still accepts a named `chargedTo` for the whole line. The Log and lg-30 both record it.
  - "More than two" counts every name the books hold, departed ones included, so a household with two current members and one departed name loses both controls. That follows from names being permanent, and the owner should hear it.
- **F3, fixed.** `web/test/stats.test.tsx` › "a one-cent deposit with nothing to pay directly still says who owes whom" fails with `Cards.tsx` put back to gate 1's version (`sam owes` against `sam owes alex`) and passes at the head.
- **F4, not fixed, left as recorded by the owner.** Unchanged, low.

**New findings**

- **med** · no `Done when` of lg-23 depends on it · **N1. The API half of the F1 fix is untested.**
  - The change to `settledOf` in `api/src/periods.ts` (a stored direct-only period's transfer stands even at 0.00) has no assertion.
  - Reproduction: `git checkout 4143a888 -- tools/ledger/api/src/periods.ts`, then `npm test -- --project ledger` prints `Tests 1157 passed (1157)`, the same as the head.
  - With that revert, driving gate 1's history through the HTTP API gives close 2 `settlement: {"deposits":null,"transfers":[]}` instead of `transfers:[{"fromId":"alex","toId":"sam","cents":0}]`. The screen's sentence would then read "Paid directly: ." This is F1's symptom coming back at the layer the household sees, with every test green. The Log's red/green covers `settleHousehold` only.
  - The history, with the amounts in cents:
    - salaries alex 2 000 000 and sam 1 000 000 for 2027, ratio from 2027-01-01;
    - lines alex 2 on 2027-01-10 and sam 1 on 2027-01-11;
    - close `{start: null, end: "2027-01-31"}`;
    - salaries alex 1 and sam 0 for 2028, ratio from 2027-02-01;
    - close `{start: "2027-02-01", end: "2027-02-28"}`.
  - Expect for close 2: `deposits: null`, `transfers: [{fromId: "alex", toId: "sam", cents: 0}]`, `deposit.status: "direct"`, and the stored row `payer_id` alex, `recipient_id` sam, `deposit_cents` NULL, `net_cents` 0.
  - Base and head give the same stored rows (`api-class.mts`).
  - Fix: one test at the end of `api/test/periods.test.ts`.
- **med** · no `Done when` of lg-23 depends on it · **N2. lg-29's premise "The API needs no change" is false for a person with a salary already on record.**
  - Build 3 says to check that `proposalFor` still holds. Done when 1 is a web test, where the API is mocked.
  - The proposal is built from every standing salary of the year (`yearSalaries`). Entering alex and casey after an entry that included sam still proposes sam:
    - entry 1 (three people): `[["alex",555556],["casey",444444],["sam",0]]`
    - entry 2 (sam left out): `[["alex",555556],["casey",444444],["sam",0]]`
    - from `blank.mts` on the head.
  - The form pre-fills the amounts on record, so blanking sam's field is exactly this case.
  - As written, lg-29 would pass its mocked web test and not deliver what the owner chose.
  - Fix at landing: put the measured fact in lg-29's Why and Build 3, and make Done when 1 an API test (enter three, then two, and read the proposal).
  - Whether the proposal becomes scoped to the entry changes the documented meaning of `SalaryEntryResponse.proposal`. lg-29's builder should raise that rather than settle it.
- **low** · **N3. lg-30 is rated `standard`.** `docs/01-TICKETS.md` says a `needs-decision` filing rates its recommended option, and that "a one-line change to a contract is `hard`".
  - Both of lg-30's options change the contract. The recommended option A also changes `ReceiptProposal`, `receipt_items` and `splitReceipt`.
  - `npm run status -- --show lg-30` prints `difficulty standard`.
  - The commit that records the answer re-rates it (dl-102's precedent), so it costs nothing until a dispatch.
- **low** · **N4. The line added to the ledger `CLAUDE.md` receipts rule is undirected by name.** It reads: `With more than two people "the other's" names nobody, so it is refused until an item can say whose (lg-23, lg-30).`
  - Build 6 names the person-name rule and the roadmap row. F2's remedy names no page.
  - It keeps the sentence before it true: "the other's part is a charge line of its own" would be false for three people without it.
  - It is accurate, checked by the API and web tests above. It adds two lines to a page every ledger session loads, and it points at lg-30 so it is found when lg-30 lands.
  - Keep it. Graded low only because nothing directed it.

**Carried and checked**

- **The merge resolution** in `web/test/receipts.test.tsx` dropped nothing. Per distinct line, merged count equals ours plus theirs minus base for the whole file (454 + 459 − 438 = 475 lines). `Receipts.tsx` and `02-ROADMAP.md`, which both sides touched, check the same way (`mergecheck.mjs`).
- **lg-29 and lg-30.**
  - `npm run status -- --show` parses both (exit 0). lg-30 reads "waiting on a decision"; `npm run status -- --json` exits 0, which is the CI gate.
  - The ids are free: no other ref adds an lg-29 or lg-30 ticket, and `git grep` finds no reference to them on main or on lg-27's branch. lg-28 is taken by lg-27's branch, and the numbering skips it correctly.
  - lg-29 carries the owner's "Blank = not in ratio" and names the rejected alternative. It states the cost: a forgotten salary now leaves the person out silently.
  - lg-30 carries the owner's "refuse now, file 'name whose'" and the contract-change question, with options A (recommended) and B. It records the hidden whole-receipt checkbox as part of what the ticket can restore.
  - The only defects are N2 and N3.
- **The lg-23 Log** annotates the earlier false claim in place ("false for one class at this commit; corrected in round 1 below, gate 1 F1"). The `Done when` lines and the frontmatter are unchanged by the round. The Log's differential claim (0 of 310) reproduces.
- **findings** · the re-gate returned 4 new (N1 to N4), 0 dropped. F1 to F3 fixed, F4 unchanged.
- NFR: security ✓ (the refusal is behind the existing auth, and the change adds no input surface) · performance n/a · reliability — N1 (a regression guard) · maintainability — N1 to N4.

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
  every close. Between two people the figures equal lg-6's to the cent (false
  for one class at this commit; corrected in round 1 below, gate 1 F1), and a
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

- 2026-10-17 — Round 1, after gate 1 (Sonnet 5.5, xhigh) graded `8e50f0d..4143a88`
  CONCERNS: two meds, two lows. The owner answered three questions that day
  through `AskUserQuestion`:
  - **F1:** (A) "Restore lg-6's result". The rejected option was (B): keep
    "nobody owes" and reword Done when 2.
  - **F2:** "Refuse for >2 now, file 'name whose'". The rejected option was
    naming whose in this round, which is a contract change. The follow-up is
    filed as [lg-30](./lg-30-name-whose-a-receipt-items-charge-is.md), as
    `needs-decision`, because the contract change is the owner's to approve.
  - **The builder's salaries question:** "File a ticket", over "Leave as is".
    Asked again against the gate's alternative, the owner kept "Blank = not in
    ratio". Filed as [lg-29](./lg-29-a-blank-salary-is-not-in-the-years-ratio.md),
    with the gate's alternative named there as rejected: list only the people
    who currently hold an address, and enter 0 meanwhile.

  **F1, fixed.** The earlier claim "between two people the figures equal lg-6's
  to the cent" was false for one class. When the closing ratio gives the person
  owed a share of zero, and what earlier periods left owed is under half a cent,
  lg-6 named the payer and the recipient, to be paid 0.00 directly. The build
  returned nobody. No cent differed, but the record, the deposit status and the
  sentence did. lg-6's comment "never rounds away" holds for one stretch only.
  - `settleHousehold` now returns `deposits: null` and one transfer of 0 cents
    between the two in that case. `asPair` reads it as lg-6 did.
  - `settledOf` in `api/src/periods.ts` reads a stored direct-only period's
    transfer even at 0.00.
  - The contract's `transfers` doc names the exception.
  - Red then green, in `books/test/household-settlement.test.ts`:
    - "names who owes whom, paid directly, as lg-6 did (the gate's
      reproduction)" failed before the fix with
      `expected { formula: 'v3', payerId: null, …(3) } to deeply equal …`.
    - "over 5 000 histories that leave a residual of a fraction of a cent, it is
      lg-6's settlement" failed at `trial 6` before the fix. The draw reaches
      the class in 401 of its 5 000 histories.
  - The gate's `minimal.mts` on the fixed tree printed
    `head {"formula":"v3","payerId":"alex","recipientId":"sam","depositCents":null,"netCents":0}`,
    which is the base's answer.
  - The gate's `differential.mts`, compared with its base runs by `jclass.mjs`,
    printed `histories 60, closes 334, histories that differ 0` (seed 5) and
    `histories 250, closes 1386, histories that differ 0` (seed 11). That is
    0 of 310, against 7 at `4143a88`.

  **F2, fixed by refusing.** `fileLines` in `api/src/receipts.ts` refuses a
  receipt with any item marked as the other's when the household names more than
  two people. The refusal is `BAD_REQUEST`, the code the ledger uses at its other
  raise sites; no code was added. `web/src/receipts/Receipts.tsx` then stops
  offering "the other's", both on an item (the tap cycles between shared and not
  shared) and on the whole receipt. In their place it says what was someone
  else's goes on the period screen as a charge line.
  - Red then green:
    - `api/test/receipts.test.ts`, "an item marked as the other's, among more
      than two › is refused, and nothing is filed". This is the gate's
      reproduction with alex, casey and sam, now expecting the refusal.
    - `web/test/receipts.test.tsx`, "among three people, an item cycles between
      shared and not shared only, and the receipt is nobody's".
    - Both failed with `api/src/receipts.ts` and `Receipts.tsx` taken back to
      `4143a888`.
  - A control, "a receipt with nothing marked as the other's still files",
    passes on both.

  **F3, fixed.** The settlements card names the recipient of a one-cent deposit
  whose direct amount rounds to nothing, taking it from the ratio's other person.
  `web/test/stats.test.tsx`, "a one-cent deposit with nothing to pay directly
  still says who owes whom", failed with `Cards.tsx` taken back to `4143a888`.

  **F4: left as recorded.** The finding states no change to make.

- 2026-10-17 — Fixed at landing by owner choice: gate 2, N1 — "The API half of
  the F1 fix is untested." The fix is one test at the end of
  `api/test/periods.test.ts`, "less than half a cent owed to a share of zero ›
  is read back as a direct transfer of 0.00 from alex to sam".
  `npx vitest run tools/ledger/api/test/periods.test.ts -t "share of zero"` →
  `Tests 1 passed | 47 skipped (48)`. The same command with
  `tools/ledger/api/src/periods.ts` checked out from `4143a888` →
  `AssertionError: expected [] to deeply equal [ { fromId: 'alex', …(2) } ]`,
  `Tests 1 failed | 47 skipped (48)`.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, N2 — "lg-29's premise
  'The API needs no change' is false for a person with a salary already on
  record." lg-29's Why now carries the measured fact, Build 3 says the API needs
  a change, and Done when 1 is an API test.
  `grep -c "The API needs no change" tools/ledger/docs/work/lg-29-a-blank-salary-is-not-in-the-years-ratio.md`
  → `0`; `grep -c "The API needs a change" …` → `1`. In the same commit, by owner
  choice: lg-30 says that "more than two" in lg-23's refusal counts departed
  names, and that lg-30 should count current members. The line added to the
  ledger `CLAUDE.md` (gate 2, N4) is kept. lg-30's difficulty (gate 2, N3) is
  left as it is, to be re-rated when its answer is recorded.
