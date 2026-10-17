---
id: lg-29
tool: ledger
title: A blank salary means the person is not in that year's ratio
kind: work-package
status: ready
milestone: P6
depends_on: [lg-23]
difficulty: standard
---

# lg-29 — A blank salary means the person is not in that year's ratio

## Why

lg-23 lets a household hold any number of people. A name stays in the books for
good, even after its last address is removed (`docs/00-ANALYSIS.md` §7). But the
salaries screen (`web/src/salaries/Salaries.tsx`, `save`) still asks for a salary
from every person the books name, the one who left included. Today the only way
to leave someone out of a year's ratio is to enter 0. They then stay among the
ratio's people with a share of zero, and that is what lg-23's "people change
only at a close" check compares.

**Leaving a person out of the entry is not enough on its own.** The API builds
the proposal from every standing salary of the year (`yearSalaries` in
`api/src/salaries.ts`), not from the entry. So a person who already has a salary
on record for that year stays in the proposal when a later entry leaves them out.
The form pre-fills the amounts on record, so blanking sam's field is exactly this
case. lg-23's gate 2 measured it (N2) with `blank.mts` on lg-23's head:

```
entry 1 (three people) proposal people: [["alex",555556],["casey",444444],["sam",0]]
entry 2 (sam left out) proposal people: [["alex",555556],["casey",444444],["sam",0]]
```

Whether the proposal becomes scoped to the entry changes the documented meaning
of `SalaryEntryResponse.proposal` in `@ledger/contract`. Whoever builds this
raises that as a question rather than settling it.

lg-23's builder raised it, and the owner answered on 2026-10-17 through
`AskUserQuestion`. The owner chose this over "Leave as is", then kept the choice
when asked again against the gate's alternative below.

### The decision

**Chosen: a blank salary means "not in this year's ratio".** The form sends only
the salaries it was given. The ratio it proposes is between those people.

**This changes what a blank means.** Today a blank is an error ("alex's salary is
not an amount"), and that error catches a salary forgotten by mistake. After this
ticket, a forgotten salary silently leaves that person out of the proposal. The
proposal's shares are on the screen before anyone confirms, and that is the only
check left.

**Rejected:** list only the people who currently hold an address on the
salaries form, and enter 0 for anyone else in the meantime. lg-23's gate 1
recommended it. It would keep a blank an error, but the form's list would then
depend on the directory rather than the books.

## Build

1. `web/src/salaries/Salaries.tsx`: a person whose salary field is blank is left
   out of the entry. A field that holds text that is not an amount is still
   refused, as now. Refuse the entry when fewer than two salaries remain.
2. Say on the screen that a blank leaves the person out of the year's ratio.
3. The API needs a change. `enterSalaries` takes any subset of the household's
   people, but the proposal is built from every standing salary of the year
   (`yearSalaries`), so a person left out of an entry who already has a salary
   that year is still proposed (Why, gate 2's N2). Scoping the proposal to the
   entry changes what `SalaryEntryResponse.proposal` is documented to mean; raise
   that as a question before building it.

## Done when

1. An API test: enter salaries for alex, casey and sam for a year, then enter
   only alex's and casey's for the same year, and read the proposal. It is
   between alex and casey.
2. A web test: a field holding text that is not an amount is still refused, and
   nothing is sent.
3. Gates green.

## Log

- 2026-10-17 — Filed by lg-23's builder in round 1, from the owner's answer.
- 2026-10-17 — At lg-23's landing, by owner choice, applied lg-23 gate 2's N2:
  Build 3's premise "the API needs no change" was false. The measured fact is now
  in Why and Build 3, and Done when 1 is an API test.
- 2026-10-17 — The owner answered Build 3's question, through `AskUserQuestion`.
  - **Question:** "lg-29 Build 3: you chose 'a blank salary means not in this
    year's ratio'. But the API builds the proposal from every salary on record
    for the year, so a person who already has one stays in it. How should the
    API change?"
  - **Options offered:**
    - "Scope proposal to entry" (recommended by the orchestrator): the proposal
      is built only from the salaries in this entry, and the doc comment on
      `SalaryEntryResponse.proposal` in `@ledger/contract` is reworded to say so.
    - "Clear left-out salaries": entering without a person deletes their salary
      on record for that year; the entry then erases data.
    - "Builder raises it later": the web half is built first and the builder asks
      with measurements.
  - **Chosen: "Scope proposal to entry".** That authorises rewording
    `SalaryEntryResponse.proposal`'s doc comment, and no other contract change.
- 2026-10-17 — Built (Sonnet 5.5). The proposal is scoped to the entry, and a
  blank salary leaves the person out.
  - **API.** `enterSalaries` in `api/src/salaries.ts` still stores the entry and
    still answers with every salary the year holds in `salaries`, but builds
    `proposal` from the people the entry names. A left-out person's salary on
    record is not erased.
  - **Contract.** The doc comment on `SalaryEntryResponse.proposal` says so. No
    other contract line changed. This changes the documented meaning of a
    contract field, by the owner's answer above.
  - **Web.** `Salaries.tsx` skips a field that is blank or only spaces, still
    refuses text that is not an amount, and refuses an entry of fewer than two
    ("A ratio is between two people or more. Enter a salary for at least two.").
    The screen says that a blank leaves the person out and that a salary already
    on record is kept.
  - **N2, reproduced.** `blank.mts` rebuilt from the Log of lg-23, with alex
    5 000 000, casey 4 000 000 and sam 0 in entry 1. Before (lg-23's gate, on
    lg-23's head): entry 2 proposed `[["alex",555556],["casey",444444],["sam",0]]`.
    On this head: `entry 1 (three people) proposal people: [["alex",555556],["casey",444444],["sam",0]]`
    and `entry 2 (sam left out) proposal people: [["alex",555556],["casey",444444]]`.
  - **Done when 1.** `api/test/salaries.test.ts`, "the proposal is between the
    people entered, not every salary the year holds", enters alex 5 000 000,
    casey 4 000 000 and sam 1 000 000, then alex and casey only. It failed before
    the change with `expected [ [ 'alex', 500000 ], …(2) ] to deeply equal [ [ 'alex', 555556 ], …(1) ]`
    (3 of its 3 new tests failed) and passes after. Sam's share is 10 % rather
    than the ticket's 0, so the three-person proposal differs visibly from the
    two-person one. Two companions: confirming that proposal stores a ratio of
    alex and casey, and an entry of alex alone proposes nothing though the year
    holds three salaries.
  - **Done when 2.** `web/test/salaries.test.tsx`, "text that is not an amount is
    refused even beside a blank, and nothing is sent (lg-29)", and the existing
    "an amount that is not one is refused before anything is sent". Beside them:
    "a blank salary leaves the person out of the entry, and the screen says so"
    and "fewer than two salaries is refused, and nothing is sent". The web tests
    were not run red against the base separately.
  - **One test had to change.** `api/test/salaries.test.ts`, "keeps the earlier
    record, and the earlier ratio still reads as in effect for its own dates",
    corrected sam's salary by sending sam alone and read a proposal between alex
    and sam. Under the owner's answer that entry proposes nothing, so it now
    sends alex's unchanged salary beside sam's correction (and asserts alex's
    record is not filed twice). The behaviour it pins, a correction keeps the
    earlier record, is unchanged.
  - **The brief had wrong:** nothing beyond what the landing already corrected.
    Folded in: nothing. No other small, specified piece became free; the roadmap
    row for lg-29 already says "a blank salary leaves a person out of the year's
    ratio".
- 2026-10-17 — Fixed at landing by owner choice: gate 1, med F1 (a), "reword the
  on-screen line to say that the amount comes back pre-filled whenever the year
  is opened, and must be cleared again each time". The line and the regex in the
  existing web test now say it. `npx vitest run tools/ledger/web/test/salaries.test.tsx`
  → the test "a blank salary leaves the person out of the entry, and the screen
  says so (lg-29)" failed with the new regex against the old line (1 failed, 6
  passed of 7) and passes with the new line (7 passed of 7).
- 2026-10-17 — Fixed at landing by owner choice: gate 1, low — "The header of
  `api/src/routes/salaries.ts` says 'files a year's salaries and answers with the
  ratio they give'", reworded to say the proposal is between the people the entry
  names; the two `@ledger/contract` comments the same finding names were not
  authorised and are untouched. `grep -n "between the people the entry names" tools/ledger/api/src/routes/salaries.ts`
  → `5: * between the people the entry names, as a proposal; ...` (a comment: no
  test can fail, so the evidence is the finding's own quotation).
