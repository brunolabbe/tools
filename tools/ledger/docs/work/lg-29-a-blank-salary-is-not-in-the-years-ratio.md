---
id: lg-29
tool: ledger
title: A blank salary means the person is not in that year's ratio
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-17 · `6b42ee19..5ad36f38` · Opus 5.5, depth standard

| Done when                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. API: enter alex, casey and sam, then alex and casey only, and the proposal is between alex and casey | `api/test/salaries.test.ts` › "the proposal is between the people entered, not every salary the year holds" ✓. The assertion on `second.proposal` shares equals `[["alex",555556],["casey",444444]]`. When only `enterSalaries` in `api/src/salaries.ts` is reverted to the base, this test fails with its two lg-29 companions (3 of 16, `npx vitest run tools/ledger/api/test/salaries.test.ts`).                                                                                                                                                                  |
| 2. Web: a field holding text that is not an amount is still refused, and nothing is sent                | `web/test/salaries.test.tsx` › "text that is not an amount is refused even beside a blank, and nothing is sent (lg-29)" ✓. It asserts the alert matches `casey's salary is not an amount` and that `enterSalaries` is not called. Mutation `skip-bad` (skip any field that does not parse) turns it red, with "an amount that is not one is refused before anything is sent" (2 of 7). Reverting the blank-skip alone leaves this test green, because the refusal it pins is older than lg-29. That revert turns the other two lg-29 web tests red instead (2 of 7). |
| 3. Gates green                                                                                          | verified — `npm run check` exit 0. `npm test -- --project ledger`: 1179 of 1179, 62 files. PR #515 at 5ad36f38: `check` ×2, `docker`, `codeql`, `CodeQL`, `test (ubuntu-latest)`, `dependency-review` and `changes` all SUCCESS. `test (windows-latest, informational)` was IN_PROGRESS when read. It is read, not graded, and the diff touches nothing that depends on the platform.                                                                                                                                                                                |

- **med** · no `Done when` line depends on it · **open decision** · A person left out of an entry is put back on the next correction without anyone touching their field. `typedFor` in `web/src/salaries/Salaries.tsx` pre-fills every salary on record for the year. It runs on every year change and on every load of the screen, and the left-out person's salary stays on record by the owner's choice. So the exclusion lasts one save. The next time anyone opens that year to correct someone else, the departed person is sent again and comes back into the proposal. The screen says "A blank salary leaves that person out of the year's ratio. The salary already on record for them, if any, is kept." That reads as a lasting exclusion, which the code does not keep. The falsehood runs in the unsafe direction: someone who trusts it can confirm a proposal that has brought the person back in. Two things soften it: the proposal's shares are on screen before confirming, and lg-23's people check refuses a change of people mid-period. Reproduction is `zz-gate-probe.test.tsx` (path below), copied into `tools/ledger/web/test/` and run with `npx vitest run`, using three people with 2025 salaries on record:
  ```
  a sam cleared: sent=[["alex",5000000],["casey",4000000]] alert=-
    sam field after save: ''
    sam field after year 2024 -> 2025: '10000.00 $'
  b alex corrected later, nothing else touched: sent=[["alex",5200000],["casey",4000000],["sam",1000000]] alert=-
  ```
  Options, not re-opening the API choice the owner settled:
  - **(a) Recommended:** reword the on-screen line to say that the amount comes back pre-filled whenever the year is opened, and must be cleared again each time. One JSX paragraph plus the regex in the existing web test. It can be fixed at the landing.
  - **(b)** Pre-fill only the people in the ratio in effect, or in the year's last confirmed ratio. That changes form behaviour, needs its own tests, and would be a ticket.
  - "Clear left-out salaries" was rejected by the owner and is not offered again.
- **low** · `nfr:maintainability` · Some prose still describes the proposal as coming from the whole year's salaries. The false direction is the safe one: the field's own comment directly beneath states the truth.
  - In `@ledger/contract`, the `SalaryEntryResponse` interface comment says "the year's salaries as they now stand, and the ratio they give". `SalaryEntry` says "a year's salaries, one per person". Changing either needs owner authorisation: only the `proposal` comment was authorised.
  - The header of `api/src/routes/salaries.ts` says "files a year's salaries and answers with the ratio they give". This one is free to fix.
- **dropped** · An API correction that names fewer people now proposes fewer people. This is the owner's "Scope proposal to entry", and no live caller is hurt. Measured with `zz-gate-probe.test.ts` against the real app (`createApp` with three members):
  - At head, correcting sam alone gives `proposal=null`; at base it gave `[["alex",454546],["casey",363636],["sam",181818]]`.
  - Correcting casey and sam gives `[["casey",615385],["sam",384615]]`. Confirming that from 2025-06-01 is refused with 400 "A ratio between different people takes effect only at a period's close…", which is lg-23's check.
  - A web-shaped correction that sends all three proposes and confirms a three-way ratio.
  - Callers enumerated: the web screen, which always sends every pre-filled field and refuses fewer than two; `workbook-import.ts`, which reads `entered.salaries` and never `proposal`; and the api tests. `tools/ledger/e2e` holds only `README.md` and `tsconfig.json`.
  - Not a defect.
- **dropped** · A household of one person can no longer save a salary from the screen, because of the fewer-than-two refusal. Build 1 asks for that refusal in so many words.
- **dropped** · Two salaries of "0" plus a blank are sent, come back with `proposal: null` and show no message. The behaviour is the same at base. It was there before this branch, not part of this change.
- **findings** · the hunt returned 5; 2 carried, 3 dropped.
- Contract: `git diff 6b42ee19..5ad36f38 -- tools/ledger/contract` is 1 file, +6 −1. The only change is the doc comment on `SalaryEntryResponse.proposal`, which the owner authorised. Its claim "`null` until the entry names at least two people, not all of them zero" matches `proposalFor` applied to the entry-filtered salaries.
- Invariants walked: contract edits (authorised, above); no cross-tool import; `AppError` unchanged; no new tests to register (existing spec files); no new workspace dependency or Dockerfile change; style (no `any` or `console`, `import type` kept separate). Skipped as out of reach of the diff: shell and process trees, redaction, SSRF, progress, routes enumeration.
- NFR: security n/a (the API schema is unchanged, with no new input) · performance n/a (one `Set` filter per entry) · reliability: F1 above · maintainability: the low above.

---

**Web form attacks.** All run through the probe, against a mocked API client:

- `"   "`, a tab plus newline, and a non-breaking space are all treated as blank (`String.trim`).
- `"0"` and `" 0 "` are sent as 0.
- `"$"` is refused with "sam's salary is not an amount".
- `"-5"` is refused.
- alex `"0"` with the other two blank is refused with "…at least two".
- A pre-filled amount cleared by the user is left out of the entry, and the API keeps the record and lists it, as the screen says.
- A person with no record left blank is left out.

**The ticket's Log, read as a document under review:**

- Its claim that the new API tests failed 3 of 3 before the change matches my revert.
- "The web tests were not run red against the base separately" is honest, and I have now run them red (above).
- The one changed existing test, "keeps the earlier record…", still asserts the same proposal `[600000, 400000]` and the same records. It passes both with and without the API change.

**Open decision for the orchestrator:** F1, option (a) or (b) as above. I recommend (a), fixed at the landing.

**Not measured:** the Windows informational leg (in progress when read), and any real-browser run, since the ledger has no e2e specs.

**Files** (scratch, for the builder or lander to re-run; each takes the tree as an argument or is copied into the package's `test/`):

- /tmp/claude-1000/-workspaces-tools/d93517c8-09aa-4ca5-bad3-f8598ec8ba87/scratchpad/lg-29/gate-1/zz-gate-probe.test.ts (API probe, copy into `tools/ledger/api/test/`; writes to `$PROBE_OUT`)
- /tmp/claude-1000/-workspaces-tools/d93517c8-09aa-4ca5-bad3-f8598ec8ba87/scratchpad/lg-29/gate-1/zz-gate-probe.test.tsx (web probe, copy into `tools/ledger/web/test/`)
- /tmp/claude-1000/-workspaces-tools/d93517c8-09aa-4ca5-bad3-f8598ec8ba87/scratchpad/lg-29/gate-1/mutate-web.mjs (`node mutate-web.mjs <tree> no-skip|skip-bad|no-min|no-trim`). `no-trim` and `no-min` each turn one lg-29 web test red (1 of 7).
- /tmp/claude-1000/-workspaces-tools/d93517c8-09aa-4ca5-bad3-f8598ec8ba87/scratchpad/lg-29/gate-1/run-ledger.sh

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
