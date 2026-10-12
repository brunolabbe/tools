---
id: dl-113
tool: downloader
title: About 50 browser probes repeat another probe or a unit test, and four cannot fail
kind: chore
status: ready
milestone: null
depends_on: [dl-111]
difficulty: standard
---

# dl-113 — Browser tests that repeat another test or a unit test

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

The owner asked that the audit not assume the tests are right. Every browser
probe costs about 2.8 s of fixed waits, even after dl-111. About fifty of them
prove something another probe in the same file already proves, or something a
browser-free unit test already pins. Four of them cannot fail at all:

- the fixture is excluded by an earlier rule before the rule the test is named
  for is read.

**The owner decided (2026-10-12):** delete what is covered elsewhere, but **keep
rows that a gate or an owner decision chose**. Merge assertions into the test
that survives, with a comment naming the gate finding they came from. Do not
simply delete them.

The rows that need a new pure function to demote are in
[dl-114](./dl-114-pure-rules-the-browser-tests-reach-through-chromium.md), not
here.

## Build

Re-read each test against what it is said to cover before acting. The audit's
verdicts below come from reading the source. Where a verdict says _vacuous_,
**prove it by mutation** before deleting: break the rule the test is named for,
and show that the test still passes. Line numbers are against `origin/main` at
`f52848a4`, before dl-111.

### browser-resolver.test.ts

**Merge** (same fixture and configuration, one probe asserts both):

| Line | Test                               | Into                                                                                                                                                                                 |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 126  | request context                    | 98, MSE blob                                                                                                                                                                         |
| 146  | locale                             | 228, real parsers, which then passes `locale: "fr-CA"`. 126's `toContain("en")` also passed for fr-CA.                                                                               |
| 361  | logger on departure                | 349                                                                                                                                                                                  |
| 262  | NO_MEDIA_FOUND                     | 1148, no-media stages                                                                                                                                                                |
| 1857 | early media keeps the normal quiet | 1114, stages in order                                                                                                                                                                |
| 1886 | floor overridable                  | 1148, given a 500 ms floor and the time assertion                                                                                                                                    |
| 1808 | floor and deadline                 | 2344, dl-105: one probe with a 3000 ms floor, timed from the `network-quiet` stage. This also closes the dl-105 gate's open low finding (its floor was timed from before page load). |

**Delete as duplicate:**

- **385, redirect during load:** 429 is also a 302 and must also finish
  probing.
- **832 `[false]`:** with confirm off the gate is never pressed
  (`provoke.ts:1759`), so `[true]` subsumes it.
- **1199, cross-origin shadow:** 1215 takes the same branch and needs the right
  index.
- **1448, both rows:** 1586 makes the same three assertions.
- **1473 newsletter:** duplicates the 1527 "Ho capito" row.
- **1473 comment and vote:** duplicate the checkout row; label refusal is pinned
  at `provoke.test.ts:354`.
- **1527 "Accetta":** duplicates 1487 (same whole-frame path).
- **1565, 1688 shown, 1744, 1764:** duplicate `consent-scope.test.ts` c7, c7,
  c13 and c14. Keep the consent-scope rows, by the audit's recommendation.
- **1575 "OK" and 1641 "Accetta":** duplicate 1487.
- **1703:** 1586 plus 1688.
- **2238, ctl=none:** every 2252 row asserts box-clicked and the stream.
- **396, fragment only:** a subset of 429 (its page is `guard-fragment.html`
  minus the `<video>`). The audit leans toward keeping 396 and deleting 385 so
  that a failure names its cause. Delete 396 only if 429's failure message would
  name the fragment.

**Delete as vacuous** (prove by mutation first):

- **1549, docked checkout, both rows:** the bar is a `<form>`, excluded by
  dl-93's form rule (`provoke.ts:1268`) before its wording is read.
- **1688 `display:none`:** the hidden node is an `<a>`, excluded by the link
  check (`provoke.ts:1250`) before visibility is read.
- **1716 "consente":** the same `<form>` fixture as 1549. The real check is
  `provoke.test.ts:413`.
- **1754, app root with footer link:** the root always holds an `<h1>`, so the
  page-content rule decides first. The script case it claims is then tested
  nowhere. Add a unit row for it.

**Demote** (a browser-free test already covers it; check that it does, and add
the row if it does not):

- **1281:** `capture-rules.test.ts:585, 654–661`.
- **1325, 1338:** `sniff.test.ts:75–79, 89`.
- **1371:** `sniff.test.ts:340`.
- **1405:** keep one label end to end (for example "Sono d'accordo"); the other
  seven labels are in `provoke.test.ts:336–341`.
- **1422:** `provoke.test.ts:313, 317`, plus new `REFUSED` rows for
  `CONSENT_TEXT_ANYWHERE`.
- **1527 "Accetto e continua":** a label row.
- **1728:** `provoke.test.ts:416`.
- **1958:** `capture-rules.test.ts:875–892`. Medium confidence, so verify.
- **2007:** `provoke.test.ts:515`. Medium confidence, so verify.
- **1048, GEO_BLOCKED:** a page-level `readSignals` plus `classifyFailure` test,
  following the pattern at `provoke.test.ts:447`.

**Keep, by the owner's decision:**

- **2093's 300 ms and 1500 ms rows.** A gate chose them under the owner's
  decision of 2026-10-07, although the 3000 ms row subsumes them by the audit's
  reading.
- Apply the same rule to any other row whose `git log -S` shows a gate or owner
  decision behind it.

### consent-scope.test.ts (75 s, 27 probes)

- **r3b:** the same markup as r5 (`consent-bar-rows.html:36` against `:38`); r5
  only adds the 1.2 s reveal. Delete it.
- **r3, r4, r6, r7, r8:** identical structure, differing only in wording. Keep
  one wording row end to end. The wording is pinned in `CONSENT_WORDING` in
  `provoke.test.ts` (lines 364, 386 and 387). r4's Polish is not there; add it.
- **c1 to c14:** these assert beacon counts, never the stream. Drive them
  through `provokePlayback` on a page directly, as `provoke.test.ts` already
  does, which skips the resolver's settle and quiet waits. Keep the
  resolver-level browser tests that assert a stream.
- **r5 and r5b:** they reveal at 1.2 s and 6 s, timed against the 500 ms and
  900 ms waits. Do not retime them.

### chunk-streams.test.ts (30 s, 11 probes)

Already unit-tested in `chunk-sniff.test.ts`:

| Case            | Unit test line                |
| --------------- | ----------------------------- |
| manychunks      | 136                           |
| manywhole       | 144                           |
| mixed           | 188                           |
| zero            | 166                           |
| lonefrag        | 55                            |
| resolutions     | 101, 75                       |
| moov-after-mdat | 80                            |
| wholefrag       | gallery and lonefrag combined |

- **Demote** each of those after reading the unit test.
- **"Boxes but not a movie":** demote to a new head-bytes unit test (none found).
- **Keep** nomanifest (dl-90's end-to-end claim), gallery (real ranged reads)
  and abort.

## Done when

1. Every test removed is listed in the Log with what covers it now: a test name
   and its file.
2. Every vacuous verdict acted on has its mutation run recorded in the Log: the
   mutated line, and the test passing anyway before the change.
3. No row with a gate or owner decision behind it was removed. The Log names
   the rows kept for that reason.
4. Before and after durations for the three files, from a local run, are in the
   Log, and `npm test -- --project downloader` passes.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 190 s of
  browser-resolver's 620 s, plus about 40 s of consent-scope and about 22 s of
  chunk-streams. The vacuous verdicts come from reading
  `provoke.ts:1250–1270`, not from mutation runs.
