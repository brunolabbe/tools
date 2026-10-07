---
id: lg-13
tool: ledger
title: A matched settlement deposit is weighed at the ratio of the period it settles
kind: fix
status: done
milestone: P3
depends_on: [lg-6]
difficulty: hard
---

# lg-13 — A matched settlement deposit is weighed at the ratio of the period it settles

## Why

lg-6 weighs every deposit into the buffer at the ratio of the period its
**date** falls in ([00-ANALYSIS.md §5](../00-ANALYSIS.md), _Cumulative, not
per period_). A settlement's own deposit is always dated after the period it
settles, so when the ratio changes at that boundary, paying exactly what the
close asked leaves the next open period owing money: the deposit is weighed at
the new ratio, though it settles a debt computed at the old one.

The owner decided on 2026-10-06, answering lg-6's gate 1, to keep §5 as built in
lg-6 and to file this: **a deposit matched to a closed period's settlement is
weighed at that period's ratio.**

## Reproduction

Through the API (`lg-6`'s routes), clock 2026-10-03: a ratio of 0.6 for alex
from 2026-01-01; sam spends 100.00 on 2026-09-10; the period closes on
2026-09-30 and asks alex for 150.00; a new ratio takes effect on 2026-10-01;
alex's 150.00 is pasted, dated 2026-10-02, and is `matched`. Then
`GET /api/periods/open`:

| Ratio from 2026-10-01 | Open period says            |
| --------------------- | --------------------------- |
| unchanged (0.6)       | nobody owes                 |
| 0.5                   | sam deposits 30.00, net 15  |
| 0.7                   | alex deposits 50.00, net 15 |

With nothing spent since the close, all three should say nobody owes. Measured
on lg-6's branch at `0862fd3` by its gate 1, and re-run by lg-6's builder (see
the Log).

## Build

1. **`books`**: `cumulativeSettlement` takes, besides each deposit, the closed
   period it was matched to, if any (lg-6's `matchDeposits` decides that). A
   matched deposit goes into **that period's stretch**, weighed at its recorded
   ratio; every other deposit stays where its date puts it, as §5 says.
2. **`api/src/periods.ts`**: `settlementFor` computes the matches it already
   computes for `GET /api/periods` and passes them in. The match is recomputed
   on every read from the rows' current classification, so a reclassified row
   moves with it; keep it that way.
3. **What does not change.** A deposit paid short or long by more than a cent
   is not matched and stays weighed by its date; a `folded` expectation has no
   deposit; lg-6's rounding (once, half-up) and "a residue under half a cent
   names nobody" stand.
4. **`docs/00-ANALYSIS.md` §5**: one sentence saying which ratio weighs a
   settlement's own deposit.

## Done when

1. The reproduction above, as an API test with the ratio changed to 0.5 and to
   0.7, leaves the next open period owing nothing (`payerId: null`,
   `depositCents: 0`).
2. A books test: the same deposit unmatched (90.00 paid where 150.00 was asked,
   r = 0.6 then 0.5) is still weighed at the ratio of the period its date falls
   in — `payerId` alex, `depositCents` 3000, `netCents` 1500 — as lg-6 computes
   it.
3. Every lg-6 settlement test passes unchanged.
4. §5 of the analysis names the ratio a matched deposit is weighed at.
5. Gates green.

## Review

**Gate: CONCERNS** — 2026-10-07 · `1aece87d..0132e357` · Sonnet 5.5, depth full

PR #386 on `0132e357`: all nine checks green (`check` ×2, `codeql`, `CodeQL`, `dependency-review`, `docker`, `changes`, `test (ubuntu-latest)`, `test (windows-latest, informational)`).

| Done when                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The reproduction, as an API test at 0.5 and 0.7, leaves the next open period owing nothing                          | `api/test/periods.test.ts` › "a settlement's deposit, when the ratio changes after its period" › "paid exactly and matched, the open period owes nothing (salaries %i and %i)", three cases (0.6, 0.5, 0.7). The assertion is `toMatchObject({ payerId: null, depositCents: 0, netCents: 0 })`, and the same test pins the share so the ratio did change. **proven.** With `books/src/periods.ts` reverted to the base and books rebuilt, the 0.5 and 0.7 cases go red and the 0.6 case stays green: `2 failed \| 25 passed (27)` (control below) |
| 2. Books test: the unmatched 90.00 is still weighed by its date (`payerId` alex, `depositCents` 3000, `netCents` 1500) | `books/test/settlement.test.ts` › "a settlement's own deposit, across a ratio change" › "unmatched, 90.00 paid where 150.00 was asked is still weighed by its date". The assertion covers the deposit with no `settles` and with `settles: null`. **proven.** It passes at the base as well, which is what "as lg-6 computes it" asks for                                                                                                                                                                                                         |
| 3. Every lg-6 settlement test passes unchanged                                                                         | **verified.** `git diff --numstat` on the two test files: 46 added / 0 removed and 76 added / 0 removed. `npx vitest run --project ledger`: base 508 of 508 (33 files), head 519 of 519 (33 files); the +11 is 7 books cases and 4 api cases, all in the new `describe` blocks                                                                                                                                                                                                                                                                    |
| 4. §5 names the ratio a matched deposit is weighed at                                                                  | **verified** by reading: `docs/00-ANALYSIS.md` §5, _Numbers_, the bullet "A settlement's own deposit is weighed at the ratio of the period it settles". See the second finding on its last sentence                                                                                                                                                                                                                                                                                                                                               |
| 5. Gates green                                                                                                         | **proven.** `npm run check` exit 0 in my worktree; the ledger project 519 of 519; the PR's nine checks green on this head (above)                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Premise and control.** Through the built API (scratch harness, clock 2026-10-03, 6.00/4.00 salaries, sam spends 100.00 on 09-10, close 09-30, new ratio 10-01, alex pastes 150.00 on 10-02, `status: matched`), `GET /api/periods/open`:

| Ratio from 10-01 | base build                     | head build               |
| ---------------- | ------------------------------ | ------------------------ |
| 0.5              | `payer=sam dep=3000 net=1500`  | `payer=null dep=0 net=0` |
| 0.7              | `payer=alex dep=5000 net=1500` | `payer=null dep=0 net=0` |

The base column is the ticket's own table, reproduced. The base build is the head tree with `books/src/periods.ts` taken from the base and books rebuilt; `grep -c "deposit.settles" books/dist/periods.js` printed 0 for it and 2 for the head build. The tree was restored and rebuilt afterwards (2 again).

- **med** · no `Done when` line depends on it · **The rule "weighed at the period it matched" is proven for a single closed period only, and a wrong period survives the whole suite.** Every new test closes exactly one period, so "the period it matched" and "the last closed period" are the same period. A mutant in `books/src/periods.ts` `cumulativeSettlement` that replaces `periodIndexOf(periods, deposit.settles)` with `periods.length - 2` (the latest closed period, not the matched one) passes `npx vitest run --project ledger`: `519 passed (519)`. It is wrong through the API. Two closed periods at 0.6 then 0.5, sam spends 100.00 on 09-10 and 50.00 on 10-10, close 09-30 and 10-31, alex pays period 1's 150.00 on 11-02 (`statuses: 2026-10-31:expected 2026-09-30:matched`), ratio 0.7 from 11-01, open period read on 11-03: head `payer=alex dep=8333 net=2500`; mutant `payer=alex dep=3333 net=1000` (it weighs the 150.00 at 0.5). With period 1's deposit paid before the second close, head reads nobody on 11-03 and the mutant reads `payer=sam dep=2143 net=1500`. The same effect reaches what the **next close records**: with period 1's deposit paid inside period 2, period 2's recorded ask is `dep=5000 net=2500` at head and `dep=2000 net=1000` at the base. Nothing on the branch closes a second period over a matched deposit, reclassifies a matched row, or has two deposits each matching its own period. A books case that kills the mutant, run against the head dist: periods `[null..09-30 at 0.6]`, `[10-01..10-31 at 0.5]`, `[11-01..11-30 at 0.7]`, lines sam 100.00 on 09-10 and sam 50.00 on 10-10, deposit alex 150.00 dated 11-02. `settles: "2026-09-30"` gives `alex, depositCents 8333, netCents 2500`; `settles: "2026-10-31"` gives `3333 / 1000`; no `settles` gives `13333 / 4000`. Append it at the end of the new `describe` in `settlement.test.ts`, and an API version at the end of the new block in `api/test/periods.test.ts`.
- **low** · `nfr:maintainability` · **The text says the deposit cancels the debt "exactly", and a rounded ask does not.** `books/src/periods.ts`'s header comment ("weighed at the same ratio it cancels the debt exactly"), `docs/00-ANALYSIS.md` §5 ("Paying what a close asked then settles it, whatever the ratio does next") and the Log's "Why it is exact" are true to the cent only when the ask divided evenly. Measured through the API, 7×7 ratio pairs × spends 100.00, 100.01, 123.45 and 0.03, paying exactly the ask: head 158 of 196 name nobody and **38 of 196 name a payer, with `net 0` and a deposit of 1 to 3 cents**; the base had 167 of 196 naming a payer. Example: 0.6/0.4 then 0.3/0.7, sam spends 100.01, ask 150.02, paid 150.02 → `payer=sam dep=1 net=0`. Random three-period histories with every ask paid exactly (seed 1: 150 trials, seed 7: 300 trials): in all 450 every period reads `matched` or settles at nothing, 28 and 35 name a payer, worst deposit 3, worst net 0. **The residue is lg-6's, not new:** with one ratio throughout and no matcher, `settlement()` asks 4286 from alex for sam's 100.00 at 0.3/0.7, and after the exact payment names `payer=sam dep=1 net=0`. The ratio change only scales it by the old share over the new recipient's share. The builder's Log discloses this ("Sub-cent residue, measured, not changed"); the three sentences were not qualified to match. Remedy: say "to within the rounding of the figure asked" in the three places.
- **open decision** · low · no `Done when` line depends on it · **Whether `netCents === 0` should also name nobody.** The residue above is `net 0` with `deposit ≥ 1`, because lg-6's floor (gate 2 low 12) tests the deposit, not the net. Options: (a) leave it and qualify the text, as in the finding above; the dust is at most a few cents and is lg-6's rounding rule, which Build 3 of the brief says stands; (b) file a ticket to extend the floor to the net, which changes a recorded lg-6 rule and the "a deposit of one cent" tests. **Recommend (a).**
- **low** · no live call site · **Two closed periods that ask within a cent of each other flip a deposit's period after the later one closes, and with it the weighing.** `matchDeposits` lets the newest expectation choose first, and `closePeriod` reads the matches back after inserting the new period. Reproduction (scratch harness, clock 2026-11-03): 0.6/0.4 from 01-01, sam spends 100.00 on 09-10, close 09-30 (asks 150.00); ratio 0.5/0.5 from 10-01; alex pastes 150.00 **dated 10-31**; sam spends 150.00 on 10-10; `GET /api/periods/open?end=2026-10-31` says `payer=alex dep=15000 net=7500` (the row is weighed at period 1's 0.6); close `{start: "2026-10-01", end: "2026-10-31"}` asks `dep=15000 net=7500`; the statuses are then `2026-10-31:matched 2026-09-30:folded` and, after ratio 0.5/0.5 from 11-01, the open period says `payer=alex dep=12000 net=6000`. The row moved from period 1's ratio to period 2's, and the reading from 75.00 to 60.00 net. It needs a row dated exactly on the new period's last day and two asks equal to the cent, so it is a coincidence of lg-6's matcher that lg-13 now lets reach the arithmetic; before, only the status moved. Recorded, not fixed.
- **low** · `nfr:maintainability` · **The warning for lg-7's builder is only in lg-13's Log.** It is the right content (import each period with the ratio its settlement used; compute the catch-up through `settlementFor` or `cumulativeSettlement` with `settles` filled from `matchDeposits`, never by date alone). But `lg-7-import-the-workbook.md` has `depends_on: [lg-5, lg-6]`, its Build 8 reports "the cumulative catch-up" and does not mention lg-13, and a builder dispatched on lg-7 reads lg-7. Remedy: one sentence in lg-7's Build 8, or `lg-13` in its `depends_on`; either, and I would do both.
- **dropped** · "A matched deposit can be weighed twice, or at the wrong period's ratio" · not a defect in the code. `matchDeposits` marks a row `taken`, so a row id maps to one period; `settlementFor` builds a `Map<rowId, end_date>` from those matches; the ratio comes from `sharesOf(period.ratio_id)`, the recorded one. Scenarios A to D below, with the ratio changed after each close, all read the recorded ratio. The mutation in the first finding is what a wrong-period bug looks like, and the suite does not see it.
- **dropped** · "A reclassified row does not move with its match" · refuted. Matched deposit, then `POST /api/classifications` to sam: `expected`, open `payer=alex dep=27000 net=13500`; back to alex: `matched`, nobody; to the mortgage bucket: `expected`, `dep=12000 net=6000`. The match is recomputed on every read. No test asserts it (part of the first finding).
- **dropped** · the cliff at the match window: paid 2 cents off the ask is `expected`, weighed by its date, and moves the next period by about 15.00 net (ask 150.00, `paid 149.98`: `payer=sam dep=2998 net=1499`; `paid 150.02`: `dep=3002 net=1501`), where 1 cent off moves it by 1 cent. This is the brief's own Build 3 and Done when 2 (a deposit off by more than a cent "stays weighed by its date"): a product decision, not a defect. The owner may want to know the cliff is sharper now, since a matched deposit settles and an unmatched one does not.
- **dropped** · the Log says `grep -n "deposit.settles"` finds `dist/periods.js` lines 130 and 132; mine found 131 and 133. `dist` is untracked build output and the line numbers vary by build; not a defect.
- **dropped** · "`bufferAsOf` moved" · it did not; see below.
- **findings** · the hunt returned 10; 5 carried (one `med`, three `low`, one open decision), 5 dropped.

**The claim least to be believed, checked: lg-7's buffer balance is untouched.** `git diff --stat` for the range touches neither `books/src/buckets.ts` nor `api/src/buckets.ts`, and `bufferAsOf` imports only `@ledger/contract`. Measured too: `GET /api/buckets?asOf=` at 4 dates × 4 payments (15000, 14999, 9000, 15100: one matched, one matched a cent short, two unmatched; two closed periods and two ratio changes; balances 0, 15000 and 23500 appear) printed 562 lines of JSON from the base build and 562 from the head build, `diff` empty. The base build there differs only in `books/src/periods.ts`, which `bucketsAsOf` does not import. **Holds.**

**Scenarios run through the API** (A to D and the exact-payment grid at both builds; every head reading used the closed period's recorded ratio, never the ratio in force now):

- **A**: deposit dated on the closed period's last day (09-30), ratio 0.5 and 0.7 after: `matched`; open and `?end=2026-09-30` both nobody (base: the same).
- **B**: deposit dated 10-02, `?end=` 09-30, 10-01, 10-02, 10-03: the first two leave it out (`dep=15000`, then `12000` at 0.5 and `20000` at 0.7, `net=6000` throughout: the debt carried as money), the last two count it (nobody). The date still decides whether it counts; the match decides only where it is weighed.
- **C**: two closed periods, 0.6 then 0.5, then 0.7 from 11-01. D1 paid after close 1, D1 paid inside period 2, D1 never paid and the cumulative ask paid, D1 paid after close 2 with D2 still owed: nobody, nobody, nobody, `alex dep=8333 net=2500` (period 2's own 25.00 carried and divided by 0.3). All correct by hand. The base build misreads all four.
- **D**: one 150.00 payment, two asks of 150.00: matched to the newer period (`2026-10-31:matched 2026-09-30:folded`), weighed at its ratio, nobody.
- **Exact payment, enumerated**: 7 ratios × 7 ratios × 4 spends = 196 closes; 158 nobody, 38 dust (second finding).
- **Match window** (head only): ask −2, −1, 0, +1, +2 over three spends: −1, 0, +1 `matched`; ±2 `expected`.
- **Positive control**: the books revert (above) turns the 0.5 and 0.7 cases red in both packages (books 4 of 29, api 2 of 27). Separately an api mutant `settles: null` turns exactly the two API cases red (`2 failed | 25 passed (27)`), and a books mutant dropping `if (dated < 0) continue;` turns "matched, it is still counted only when its date says" red (`1 failed | 518 passed (519)`). Each was restored; the tree is clean at the head sha and `dist` was rebuilt and grepped after each.

**Invariants walked.** No other tool imported; no new throw or error code; contract untouched; no new workspace dependency, so no `Dockerfile` edit; no route added; `import type` used for `DepositMatch`; no `any`, no `console`; every changed source file has a test file of its own (`books/test/settlement.test.ts`, `books/test/periods.test.ts`, `api/test/periods.test.ts`) and no test file was added, so nothing to register. Skipped, the diff cannot touch them: redaction, SSRF, no shell, process trees, faked progress.

**Integer cents.** The change adds no division or multiply; it only chooses which stretch a contribution joins, and `settleStretches` still sums exact `bigint` micro-cents and rounds once. `cumulativeSettlement` pushes `deposit.amountCents` unchanged. No cent is lost or created by the split; the only residue is the rounding of the figure that was asked (second finding).

- NFR: security n/a (no new input; matches are computed server-side from rows already read) · performance ✓ (`matchDeposits` is closed × rows, once per read, and `settlementFor` still reads the buffer rows once) · reliability ✓ with the coincidence in the `low` above (both callers read through one `depositMatches` inside one transaction, `openPeriod`'s read and `closePeriod`'s `.immediate()`) · maintainability — the `med` and two `low`s above.

### Gate 2

**Gate: CONCERNS** — 2026-10-07 · `0132e357..4278e11c` · Sonnet 5.5, depth full, the round's diff only

Nothing found is a `high`. The one thing keeping this at CONCERNS is a CI leg that had not finished when I read it: `test (ubuntu-latest)` and `test (windows-latest, informational)` were still `pending` on `4278e11c`, while `check` (both), `codeql`, `CodeQL`, `dependency-review`, `docker` and `changes` were green. With both legs green on this head and nothing else changed, the verdict is PASS.

| Done when                                      | Proof                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Every lg-6 settlement test passes unchanged | **verified.** `npx vitest run --project ledger` at the head: 520 of 520 (33 files), the 519 of gate 1 plus the one new case; the round touched no existing test line (the diff to `books/test/settlement.test.ts` is 29 added, 0 removed) |
| 5. Gates green                                 | **unproven (gate)** until the two test legs run green on `4278e11c`. Locally: `npm run check` exit 0 and the ledger project 520 of 520. `npm run status -- --json` exit 0                                                                 |

Verdicts on gate 1's findings:

- **med, two closed periods: fixed where the rule lives.** The new case is `books/test/settlement.test.ts` › "a settlement's own deposit, across a ratio change" › "with two closed periods, it is weighed at the one it settles, not the latest closed". It asserts three readings of one deposit through `cumulativeSettlement` over three periods (0.6, 0.5, 0.7): `settles: "2026-09-30"` reads alex `8333 / 2500`; `settles: "2026-10-31"` reads `3333 / 1000`; no `settles` reads `13333 / 4000`. Each carries `payerId: "alex"`. I applied gate 1's mutant (`periodIndexOf(periods, deposit.settles)` replaced by `periods.length - 2`; `grep -c "periods.length - 2" books/dist/periods.js` → 1 and `grep -c "periodIndexOf(periods, deposit.settles)"` → 0, so the mutant was the build measured): `1 failed | 519 passed (520)`, the failing reading `8333 / 2500` expected, `3333 / 1000` received. It was 519 of 519 at gate 1. A second mutant, `: 0;` (always the first period), is killed too (`1 failed | 519 passed (520)`). Both restored; `grep -c "periodIndexOf(periods, deposit.settles)"` → 1 and the tree is clean.
- **"exactly" low: fixed.** The three places gate 1 named now read "to within the rounding of the figure asked": the header comment in `books/src/periods.ts`, the §5 bullet in `docs/00-ANALYSIS.md`, and "Why it is exact" in the ticket's Log. A sweep of `books/src/periods.ts`, `api/src/periods.ts`, §5 and the ticket for "exactly", "cancels" and "settles it" finds no other unqualified claim about this rule (the other "exactly"s are older, unrelated sentences; §5's "worth exactly the debt" at the matching rule is lg-6's and was not touched).
- **lg-7 hand-off low: fixed.** `lg-7-import-the-workbook.md` has `depends_on: [lg-5, lg-6, lg-13]` and Build 8 carries the sentence. `npm run status -- --show lg-7` prints `blocked by  lg-13 (ready)` and `--ready` withholds it ("waits on lg-13"), which is the intended effect; `status --json` exits 0, so the dependency is not dangling on this branch.
- **Cent-coincidence low and the `netCents === 0` decision: left as recorded**, by the owner's choice on 2026-10-07. Not re-graded; no new evidence.

Findings in the lines this round touched:

- **low** · no `Done when` line depends on it · **The API layer's pairing is still pinned by no two-period test, which answers whether the fixer's books-only case is enough.** It is enough for the rule, since the books case is where the arithmetic lives, but one line is not pinned: `settlementFor` in `api/src/periods.ts` pairs each match with its closed period (`settles.set(match.rowId, period.end_date)`). A mutant that maps every match to the latest closed period (`settles.set(match.rowId, closed.at(-1)?.end_date ?? period.end_date)`) passes the whole suite: `Tests  520 passed (520)`. It is wrong through the API, in the same scenarios as gate 1's: two closed periods (0.6, then 0.5, then 0.7 from 11-01), period 1's deposit paid after close 1: mutant `payer=sam dep=2143 net=1500`, head nobody; period 1's deposit paid after close 2: mutant `payer=alex dep=3333 net=1000`, head `dep=8333 net=2500`. The existing two-period API case (`"matched"` / `"folded"` statuses) reaches `closedPeriods`, not this weighing. Graded `low` rather than the `med` gate 1 gave the gap, because the rule is now pinned and what remains is a single index-to-period pairing that `closedPeriods` shares with it; there is no failing call site. Remedy, if the lander wants it: an API case at the end of the file's new block, two closes then the 150.00 paid after close 2, expecting `payerId: "alex"`, `depositCents: 8333`, `netCents: 2500` from `GET /api/periods/open` on 11-03.
- **low** · `nfr:maintainability` · no live call site · **The sentence added to lg-7's Build 8 names `settlementFor`, which is not exported.** `api/src/periods.ts` declares `function settlementFor` without `export`; `openPeriod` is the exported way to reach it. The sentence offers "or `cumulativeSettlement` with `settles` filled from `matchDeposits`" as the alternative, and that one is exported from `@ledger/books`, so a builder is not stuck; the pointer only reads as if the first were callable from an import script. Remedy: say `openPeriod`, or "the `settlementFor` logic in `api/src/periods.ts`".
- **findings** · the round's hunt returned 2; 2 carried (both `low`), 0 dropped.
- NFR: security n/a · performance n/a (a comment, a test and two ticket files) · reliability ✓ (the books case kills two wrong-period mutants) · maintainability — the two `low`s above.

## Log

- 2026-10-06 — Filed by lg-6's builder, from the owner's answer to lg-6's gate
  1 (options: keep §5 as built; settle a matched deposit at the closed period's
  ratio in lg-6; keep now and file a ticket — the last chosen). Not built.
  Reproduction re-run through lg-6's built API (`api/dist/server.js`, a
  scratch script; salaries 6.00 and 4.00, then the new ratio's), printing for
  no change, 0.5 and 0.7:
  `asked 15000 of alex; deposit matched; open period: payer null, deposit 0, net 0`,
  `… payer sam, deposit 3000, net 1500`,
  `… payer alex, deposit 5000, net 1500`.
- 2026-10-07 — Built on `1aece87`. **The rule, as built:** a deposit is
  _counted_ when its date says, as before, and a deposit matched to a closed
  period is _weighed_ in that period's stretch, at the ratio its settlement
  recorded. Why it is exact, to within the rounding of the figure asked: a
  close asks for its cumulative net divided by the recipient's share at its own
  ratio, so the same amount weighed at that ratio cancels the net, whatever
  ratio follows.
  - **`books`.** `DepositInput` gains an optional `settles`: the last day of the
    closed period the deposit was matched to. `cumulativeSettlement` puts it in
    the stretch holding that day (`periodIndexOf`), so the books need no period
    ids. Optional, so every lg-6 caller and test is untouched. A date after the
    open period's last day still leaves the deposit out, matched or not.
    Without that, `GET /api/periods/open?end=` a day before the deposit would
    have counted a deposit dated after it.
  - **`api`.** `settlementFor` now runs `matchDeposits` over the same buffer
    rows it weighs, through `depositMatches`, which `closedPeriods` shares. The
    match is still recomputed on every read from the current classification.
    There is no schema change.
  - **The brief had nothing wrong.** Its "always dated after the period it
    settles" is nearly always: `matchDeposits` accepts a row dated on the
    period's last day, which falls in that period anyway. The comment and §5
    say "nearly always".
  - Red, then green. `npx vitest run tools/ledger/books` with `periods.ts`
    reverted: `4 failed | 193 passed (197)` (the 0.5 and 0.7 cases, at 100.00
    and at 100.01). Restored: `197 passed (197)`. `npx vitest run
tools/ledger/api/test/periods.test.ts` against the books `dist` built
    before the change: `2 failed | 25 passed (27)` (0.5 and 0.7). After
    rebuilding books (`grep -n "deposit.settles"` in
    `books/dist/periods.js` finds lines 130 and 132), `npx vitest run
tools/ledger/api` passes `269 passed (269)`. `npm test -- --project
ledger` passes `519 passed (519)`. `git diff --numstat` shows 0 lines
    removed from either test file, so every lg-6 test stands unchanged.
  - **Sub-cent residue, measured, not changed.** I ran a seeded sweep (a scratch
    script over `books/dist`) of 20 000 trials. Each draws a random share
    (0.05–0.95) and one card line of up to 5 000.00, closes, pays exactly the
    asked figure, matches it, and reads the next period. With a new random
    ratio, 4 506 of 20 000 name a payer, worst deposit 8 cents, net 0 in every
    case. With the ratio unchanged, 2 843 of 20 000 name one, worst deposit 9
    cents, net 0. lg-6 already asks for a deposit of a few cents whose net
    rounds to nothing, by gate 2 low 12's rule that a deposit of 0, not a net of
    0, names nobody. lg-13 adds no new kind of outcome. Before lg-13 the same
    exact payment across a change named 30.00 or 50.00.
  - **For lg-7's builder.** Done-when 3's buffer balance is `bufferAsOf`
    (`books/src/buckets.ts`), a sum of rows. No settlement weighing reaches it,
    so lg-13 does not move it. lg-13 does move the cumulative catch-up that
    Build 8 reports, and any v3 close after the import. Each imported v1/v2
    period is a closed period with a recorded payer and deposit, so
    `matchDeposits` matches its historical deposit if one was paid within a
    cent, dated on or after the period's end, filed to the payer. That deposit
    is then weighed at the ratio the period records, which is the
    `periods.ratio_id` the import writes. Import each period with the ratio its
    historical settlement used, or a matched deposit is weighed wrong. Compute
    the catch-up through `settlementFor` (or `cumulativeSettlement` with
    `settles` filled from `matchDeposits`), never by date alone. A historical
    deposit paid off by more than a cent stays weighed by its date. If the
    workbook's ratio changed at a period boundary, its own catch-up figure
    followed neither rule necessarily, so a difference there is not a defect in
    the import.
  - **Fold-in:** none was free. No open ledger ticket touches the settlement's
    weighing, and lg-6's unfiled lows (a third person's buffer row) are not
    specified work.
- 2026-10-07 — Round 2, on `0132e35` (gate 1: CONCERNS), by the fixer. Added a books case at the end of `books/test/settlement.test.ts` for two closed periods (0.6, then 0.5) with period 1 paid after close 2: `settles` 2026-09-30 reads alex 83.33 / 25.00, `settles` 2026-10-31 reads 33.33 / 10.00, no `settles` reads 133.33 / 40.00. Mutant `periods.length - 2` in place of `periodIndexOf(periods, deposit.settles)`: `1 failed | 29 passed (30)` (8333 expected, 3333 received); restored: `30 passed (30)`. Qualified "exactly" as "to within the rounding of the figure asked" in the `periods.ts` header comment, §5 of `00-ANALYSIS.md` and "Why it is exact" above. Added lg-13 to lg-7's `depends_on` and a sentence to its Build 8. Left as recorded: gate 1's low on two asks within a cent of each other (a coincidence of lg-6's matcher, no live call site) and its open decision on `netCents === 0` (recommended: leave).
- 2026-10-07 — Round 3, on `4278e11` (gate 2: CONCERNS, both lows), by the fixer. Added an API case at the end of the new block in `api/test/periods.test.ts`: two closes (0.6, then 0.5), ratio 0.7 from 11-01, period 1's 150.00 paid on 11-02 after close 2, `GET /api/periods/open` reads alex 83.33 / 25.00. Mutant in `settlementFor` (`settles.set(match.rowId, closed.at(-1)?.end_date ?? period.end_date)`, books rebuilt, `grep -c "deposit.settles" books/dist/periods.js` printed 2): `1 failed | 27 passed (28)`, 3333 / 1000 received; restored: `28 passed (28)`. lg-7's Build 8 sentence now names `openPeriod` (exported) in place of `settlementFor` (not), keeping the `cumulativeSettlement` alternative.
