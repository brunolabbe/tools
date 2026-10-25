---
id: dl-113
tool: downloader
title: About 50 browser probes repeat another probe or a unit test, and four cannot fail
kind: chore
status: done
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
3. No gate finding or owner decision loses its test; the Log names the
   survivor. (The owner's rewording of 2026-10-12; the original sentence and
   the question are in the Log.)
4. Before and after durations for the three files, from a local run, are in the
   Log, and `npm test -- --project downloader` passes.

## Review

**Gate: PASS** — 2026-10-12 · `07acbb86..df0ac687` (build base `d759b80e`) · Opus 5.5, depth standard

Done-when 3 is graded against the owner's rewording of 2026-10-12: "No gate finding or owner decision loses its test; the Log names the survivor".

| Done when                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Every removed test is in the Log with what covers it now                     | **verified**: I listed the removals from the diff (46 in `browser-resolver`, r3/r3b/r4/r6/r8 in `consent-scope`, 8 in `chunk-streams`). Each one is named in the Log with a surviving test and its file. I grepped every cited test name in the files it names, and each one exists.                                                                                                                                                  |
| 2. Every vacuous verdict acted on has its mutation recorded                     | **verified**: the Log records M2/M3b (docked checkout), M5 (display:none link), M6 (consente) and M4/M3c (footer link), each with the run that passed. I reproduced two of them at `d759b80e` with my own mutations. G3 (`consent\p{L}*`) leaves the 'consente' row passing and fails 3 `CONSENT_WORDING` rows. O5 (a script's text counted as prose) leaves the footer-link row passing.                                             |
| 3. No gate finding or owner decision loses its test; the Log names the survivor | **verified**: I ran 26 mutations of my own at `d759b80e` and at the head (table below). No mutation that a removed row caught is left without a surviving test that catches it. Positive control: O1 and O2 (the dl-93 app-root rule) fail `consent-scope.test.ts` › "c13, accepted cost: a consent notice in the flow of a fixed root that holds an h1 is no longer pressed" at the head. One Log survivor is misnamed (low, below). |
| 4. Durations in the Log; `npm test -- --project downloader` passes              | **verified**: the before and after durations for the three files are in the Log. At `df0ac687`, `npm test -- --project downloader` gives `Test Files 116 passed \| 1 skipped (117)`, `Tests 2488 passed \| 2 skipped (2490)`, 406.91 s, exit 0. `npm run check` exits 0. CI is green on `47c485cf`, which differs from `df0ac687` only in the ticket file.                                                                            |

**Mutations.** Each one was applied to `d759b80e`, rebuilt with `tsc --build` in contract, and to the head; "killers" means the tests that failed.

| id       | mutation                                                      | removed rows that failed at `d759b80e`      | surviving tests that fail at head                                                                                 |
| -------- | ------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| O1       | `h1` dropped from `PAGE_CONTENT`                              | a1 app root (dl-93 flip)                    | c13                                                                                                               |
| O2       | `n.querySelector(PAGE_CONTENT)` → `n.matches(...)`            | a1 app root                                 | c13                                                                                                               |
| O3       | `n.matches('form')` → `n.querySelector('form') !== null`      | a2 docked form (dl-93 flip)                 | c11, c14                                                                                                          |
| O4       | `checkVisibility()` with no options                           | none                                        | r5b                                                                                                               |
| O5       | a script's text counted as prose                              | none (the footer-link row is vacuous)       | c15 (new)                                                                                                         |
| G1       | `<a>` no longer excluded from prose                           | gate 3 visible link, a3c                    | c1, c4, c5, c6, c7, c10, r1, r1b                                                                                  |
| G2       | `kakor` loses its word start                                  | 'pannkakor'                                 | 4 `CONSENT_WORDING` SILENT rows                                                                                   |
| G3       | `consent\p{L}*`                                               | none (the 'consente' row is vacuous)        | 3 `CONSENT_WORDING` rows                                                                                          |
| W2       | the container pass scoped to `body`                           | gate 1 bottom bar, a3c                      | "reaches a bottom consent bar past a sticky header's notice", "presses a consent bar before a newsletter dialog…" |
| W6       | `^` dropped from `CONSENT_TEXT_ANYWHERE`                      | comment form, fixed and sticky checkout, a2 | the checkout row, c1, c2, c3, c10, 11 `provoke` rows                                                              |
| W8       | `sono d'accordo` added to `CONSENT_TEXT_ANYWHERE`             | vote button                                 | "CONSENT_TEXT_ANYWHERE does not match \"Sono d'accordo\""                                                         |
| W9       | `ok\|okay` dropped from `CONSENT_TEXT_ANYWHERE`               | header notice "OK"                          | "…still matches \"OK\"" and "\"Okay\""                                                                            |
| L1/L2/L3 | APOS typographic only / `&` dropped / `yes,?` dropped         | the matching LABELS rows                    | the `CONSENT_TEXT` "matches" rows (L1 also the kept "Sono d'accordo" probe)                                       |
| X1       | `clickChosenVideo(frame, true)`                               | none (cross-origin shadow passed)           | none: equivalent                                                                                                  |
| S1       | the `SCROLL_SCRIPT` call removed from `provokeFrame`          | nav-first plus 5 kept                       | 5 kept dl-81 rows, `provoke` dl-69                                                                                |
| U1       | sniffed manifest always recorded as `hls`                     | DASH text/plain                             | `sniff` "an untyped, extensionless body beginning <MPD is a dash hit"                                             |
| Q2       | the resolver passes no page text to `classifyFailure`         | not run at base                             | BOT_CHALLENGE and the dl-48 age row (full file)                                                                   |
| K1       | the later-`moof` check in `sniffHead` removed                 | none (lonefrag and wholefrag passed)        | `chunk-sniff` "a whole movie written as fragmented MP4…"                                                          |
| K2       | `lastEnd === head.length` → `"fragment"`                      | none                                        | `chunk-sniff` "an mvex moov followed by bytes that are not a box…"                                                |
| K4       | a file that was read is still dropped beside a fragment       | mixed                                       | `chunk-sniff` "a file read and found whole is kept…"                                                              |
| F1–F4    | floor ignored / −1000 ms / ×0.85 / wait started 1500 ms early | dl-80 floor row (F1 only)                   | the dl-105 row: waited 1205, 2014, 2610 and 1605 ms against `≥ 3000`. With no mutation the row passes.            |

The fold-in is stronger than what it replaced. F2, F3 and F4 pass every floor test at `d759b80e`. At the head they fail the dl-105 row.

**Scope and the merge.** The diff from `07acbb86` touches only `tools/downloader/resolvers/test/**` and the ticket. No `src` file differs from `main`. The dl-118 code is all still there and none of it is changed against `main`: `BLOCKED_CLICK_MS`, `confirming(clickTimeoutMs?)` and its use in the residue rows, the `clickTimeoutMs caps the clicks…` block and the `cappedTimeout (dl-118)` block in `provoke.test.ts`.

**Removed fixtures.** Nothing else in `tools/`, `packages/`, `scripts/` or `.github/` reads the 13 pages, `media/extless/`, `/guard-redirect`, `/cross-origin-shadow.html`, `/named.html`, `?id=3`, `?id=4` or `/api/manifest?1`. `web/test/fixtures.ts` reads only `*.variants.json`. `media/untyped/media.m3u8` and `media/dash/manifest.mpd` still have readers.

- **low** · no `Done when` line depends on it · The Log's reason why the lone fragmented-movie probes could not fail C5 is false. It says "their bodies are a megabyte, the `moof` falls outside the 2 KB head". The sniff's head is `SNIFF_HEAD_BYTES` in `chunk-sniff.ts`, 65536 bytes, and the `moof` ends at byte 585. The real reason is that the 1 MB `mdat` is cut off, so `lastEnd !== head.length` and `sniffHead` answers `unknown` whether the later-`moof` check is there or not. The conclusion (the e2e rows never guarded it) holds; K1 confirms it. Reproduction: `node --import tsx <scratch>/lonefrag-head.mts <tree>` prints `SNIFF_HEAD_BYTES 65536 … moof body@ 541 end 585 / lastEnd === head.length: false verdict: unknown`.
- **low** · `nfr:maintainability` · Done-when 3's survivor column names "cookie-strip row (M18)" for row 11 (the sticky header's notice labelled "OK"). That row does not fail when `ok|okay` is dropped from `CONSENT_TEXT_ANYWHERE` (W9: 0 of 9 failed in the dl-82/dl-93 blocks at head). The survivor for the label half is `provoke.test.ts` › "CONSENT_TEXT_ANYWHERE still matches \"OK\"". Both halves are guarded; the Log names one of them.
- **dropped** · X1: no test catches it at either sha. It is equivalent, because Playwright evaluates scripts in a cross-origin frame too. Nothing was lost.
- **dropped** · K3 (`prefixBytes: 512` in `#readHead`): no test catches it at either sha (11 of 11 and 36 of 36 pass). The gap was there before this branch and is outside its scope.
- **dropped** · Q1 (`bodyText: ""` only): neutral, because `classifyFailure` also reads `html`. Q2 replaced it.
- **dropped** · the c-rows now run `provokePlayback` without the resolver's `revisitOverlays`. That function never presses consent text: `revisitOverlays` in `provoke.ts` calls only `dismissModal` and `confirmAgeGate`.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- NFR: security n/a (tests only) · performance ✓ (`browser-resolver` 137 tests in 403 s at head) · reliability ✓ (the floor test is now timed from the wait itself) · maintainability — the two lows above.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 190 s of
  browser-resolver's 620 s, plus about 40 s of consent-scope and about 22 s of
  chunk-streams. The vacuous verdicts come from reading
  `provoke.ts:1250–1270`, not from mutation runs.
- 2026-10-12 — Built on `d759b80e` (dl-111 merged). Every row was found by its
  test name: the Build's line numbers are against `f52848a4` and were all stale.

  **Durations**, one local run each on an idle machine
  (`npx vitest run <file>`; load average 0.3 before and after):

  | file                   | tests before → after | duration before → after |
  | ---------------------- | -------------------- | ----------------------- |
  | `browser-resolver`     | 183 → 137            | 563.31 s → 415.31 s     |
  | `consent-scope`        | 27 → 23              | 77.45 s → 42.02 s       |
  | `chunk-streams`        | 11 → 3               | 31.28 s → 9.48 s        |
  | `provoke` (gained)     | 231 → 254            | 4.83 s → 4.95 s         |
  | `chunk-sniff` (gained) | 32 → 33              | 0.40 s → 0.42 s         |

  That is 205 s off the three files, against the audit's estimate of about 250 s:
  the estimate counted rows that stay (below). `capture-rules` (160) and `sniff`
  (59) are unchanged. `npm test -- --project downloader`: see the last entry.

  **How a row was judged.** A browser row was not deleted because it looked
  covered. The same string mutation was applied to a copy of `d759b80e` and to
  this branch, and the failing tests were listed on each side. A deleted row is
  covered only if a surviving test fails on every mutation it failed on. 38
  mutations, 28 source lines, three files; the runner and the catalogue are
  scratch files (a string replacement in `src/`, then `npx vitest run <file> -t
  <pattern> --reporter=json`, then the file restored). Every mutation that
  failed a test before still fails one after: no mutation lost its last killer.
  Tests outside `browser-resolver` lost nothing and gained eight (`c15`, the
  REFUSED row for `CONSENT_TEXT_ANYWHERE`, the free-box row, the GEO page test,
  the ad-iframe scroll row, `Sono d'accordo` as a unit row on M20b, and the
  free-box row on C4 and C7).

  | mutation (file, line)                                                             | killed before (browser-resolver / others) | killed after |
  | --------------------------------------------------------------------------------- | ----------------------------------------- | ------------ |
  | M1 `provoke.ts` whole-frame press uses `CONSENT_TEXT` for `CONSENT_TEXT_ANYWHERE` | 22 / 17                                   | 5 / 18       |
  | M2 `if (!content && wording.test(prose(n)))` → `if (!content)`                    | 8 / 12                                    | 3 / 13       |
  | M3b the `n.matches('form') \|\|` half of `content` removed                        | 1 / 1                                     | 0 / 1        |
  | M3c the `n.querySelector(PAGE_CONTENT)` half removed                              | 1 / 1                                     | 0 / 1        |
  | M4 `if (a.matches('a, [role="link"]'))` → `if (false)`                            | 2 / 9                                     | 0 / 9        |
  | M5 `!inLink && p.checkVisibility(...)` → `!inLink`                                | 0 / 1                                     | 0 / 2        |
  | M6 `s?(?!\p{L})\|consenso` → `s?\|consenso`                                       | 0 / 3                                     | 0 / 3        |
  | M7 the `(?<!\p{L})` word start of `CONSENT_WORDING` removed                       | 1 / 13                                    | 0 / 13       |
  | M8 `[ZONE_CONSENT, ZONE_DIALOG]` swapped                                          | 1 / 0                                     | 1 / 0        |
  | M9 `SCROLL_SCRIPT` takes `candidates[0]`                                          | 1 / 1                                     | 0 / 2        |
  | M10 cross-origin click `.nth(index)` → `.nth(index + 1)`                          | 3 / 0                                     | 2 / 0        |
  | M11 `options.confirmAge &&` dropped (both call sites)                             | 3 / 0                                     | 3 / 0        |
  | M12 `demoteChunks` calls any `\d.mp4` a segment                                   | 1 / 1                                     | 0 / 1        |
  | M13 `application/octet-stream` removed from `UNINFORMATIVE_TYPES`                 | 1 / 2                                     | 0 / 2        |
  | M14 `segmentCount > 0` → `>= 0`                                                   | 1 / 1                                     | 0 / 1        |
  | M15 `rankHits` sorts by score before arrival order                                | 1 / 6                                     | 0 / 6        |
  | M16 the `not available in your country` marker removed                            | 1 / 1                                     | 0 / 2        |
  | M17 `continua` added to `CONSENT_TEXT_ANYWHERE`                                   | 1 / 0                                     | 0 / 1        |
  | M18 the whole-frame press replaced by `return false`                              | 4 / 0                                     | 1 / 0        |
  | M19 `seq: patch.seq ?? this.#seq++` → `?? 0`                                      | 1 / 1                                     | 0 / 1        |
  | M20 `acconsento` removed from `CONSENT_PHRASES`                                   | 1 / 1                                     | 0 / 1        |
  | M20b `sono d'accordo` removed from `CONSENT_PHRASES`                              | 1 / 1                                     | 1 / 1        |
  | M22 `landingUrl = page.url()` → `url.toString()`                                  | 1 / 0                                     | 1 / 0        |
  | C1 `segmented.add(...)` removed                                                   | 1 / 4                                     | 0 / 4        |
  | C2 `reads >= MAX_SNIFF_READS` removed                                             | 1 / 1                                     | 0 / 1        |
  | C3 `read.add(hit)` removed                                                        | 1 / 1                                     | 0 / 1        |
  | C4 a non-printable box type reads as a fragment                                   | 2 / 3                                     | 0 / 4        |
  | C5 the later-`moof` check removed                                                 | 0 / 1                                     | 0 / 1        |
  | C6 a moov with no `mvex` reads as a fragment                                      | 5 / 5                                     | 1 / 5        |
  | C7 a `free` box reads as a fragment                                               | 4 / 1                                     | 1 / 2        |

  Every browser-resolver count that falls is a deleted row; the "others" column
  is `provoke`, `consent-scope`, `capture-rules`, `sniff` and `chunk-sniff`, and
  it never falls. The merged tests are checked on a third set (X1 the logger
  message, X1b its `step`, X2 `Accept-Language` from the locale, X4 the floor
  override ignored, X5 the floor ignored, X6 the floor applied to a page whose
  media arrived): 1, 1, 1, 2, 4 and 2 tests killed before; 1, 1, 1, 2, 3 and 2
  after. M20b, M22 and the X rows were run on both trees with `-t "dl-82"`,
  `-t "dl-55"` and a pattern over the stage, floor and dl-105 tests.

  **Vacuous verdicts, proved.** Each test below passed on a copy of `d759b80e`
  with the rule it is named for broken (`npx vitest run
  tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t
  "dl-82|dl-93"`, whose mutated run is `mutation M2 [before-A]: 8 failed of 183
  (29 passed)` and so on):
  - "does not press the submit button of a fixed / sticky checkout bar that says
    nothing of consent": M2, every fixed or sticky layer a container whatever it
    says. Neither row is among the eight that failed. The bar is a `<form>`, and
    M3b (the form rule off) leaves both rows passing too, because the wording is
    silent: only both rules broken together fail it.
  - "a sticky header with a display:none cookie link in its nav is not a
    container": M5, `checkVisibility` dropped. `mutation M5 [before-A]: 0 failed
    of 183 (37 passed)`. The hidden node is an `<a>`, which the link check
    excludes first. The visible-link row of the same test does fail M4 and M2, and
    is covered by `c7` in `consent-scope`.
  - "does not press a checkout submit in a bar whose prose says Italian
    'consente'": M6, the end-of-word guard on `consent` dropped. `mutation M6
    [before-A]: 0 failed of 183 (37 passed)`, and the three `CONSENT_WORDING` rows
    "Il pagamento sicuro consente di ordinare.", "Il pagamento è consentito." and
    "I partner consentono l'ordine." fail it in `provoke.test.ts`. Same `<form>`
    fixture as the first.
  - "a fixed app root whose footer only links a cookie policy is not a container":
    M4, a link's text counted as prose. `mutation M4 [before-A]: 2 failed of 183
    (35 passed)`, and the two are the visible-link row and the bar past a header
    that links a policy. The root holds an `<h1>`, so M3c (the page-content rule
    off) leaves it passing as well. The Build said the script case it claims
    "is then tested nowhere": the link case is `c1`, `c4`, `c5`, `c6`, `c7`, `c10`
    and `r1`, `r1b`, `r2b` (nine failures under M4 in `consent-scope`). The
    script-text case was pinned by nothing and is now `c15`, which fails M1, M2
    and M5 as `r5b` does.

  **Removed, with what covers each** (every file is under
  `tools/downloader/resolvers/test/browser/`; "M" is the mutation above that the
  removed row failed and a survivor still fails):
  - Merged into a survivor, assertions kept: "hands back a request context the
    engine can replay" into "captures the master playlist behind an MSE blob:
    player". "sends Accept-Language from the requested locale" into "works with
    the real parsers wired in", which now asks for `fr-CA` (X2). "reports the
    departure to the injected logger, naming the step and both URLs" into "a
    document navigation (location.assign) never returns the other page's stream,
    and is reported to the injected logger, ..." (X1, X1b). "reports
    NO_MEDIA_FOUND when the page has no video" and "the empty floor is overridable
    to allow tests to run quickly" into "a page with nothing playable never claims
    to have read a manifest" (a 500 ms floor, `NO_MEDIA_FOUND`, under 7000 ms; X4).
    "a page whose media arrives early still uses the standard quiet timeout" into
    "reports each phase it actually reaches, in order, and none it does not" (a
    9000 ms floor, under 7000 ms; X6). "a page with no media respects the empty
    floor and the deadline" into "a wall clock stepped back before the wait does
    not read as a floor that returned early" (X5): the wait is now timed from the
    `network-quiet` stage to `settle-requests`, which closes dl-105's open low
    finding that the floor was timed from before the page loaded. The 3000 ms
    floor replaces 9000 ms, and this saves about 11 s on its own.
  - Deleted as duplicate: "a redirect during load is not a departure" (the
    landing-URL test, `/guard-redirect-then-fragment`, is also a 302: M22 fails
    that one and not this one; its fixture route is gone). "sign-up chips ...
    (confirmation false)": confirmation off presses nothing, which "not told to
    confirm ages, fails AGE_CONFIRMATION_REQUIRED without pressing the gate" and
    "an Italian gate in a fixed layer, not told to confirm" pin and fail on M11.
    "starts a shadow-root player inside a genuinely cross-origin frame": "indexes
    candidates in the locator's own order ..." takes the same branch and now also
    asserts the request (M10). "finds the stream behind a full-viewport overlay /
    a bottom bar and leaves the newsletter alone": "reaches a bottom consent bar
    past a sticky header's notice" and "does not press a checkout form's submit
    button" fail M1 as they did. "does not press a newsletter's dismiss button":
    "an in-flow strip labelled \"Ho capito\" is not pressed". "does not press a
    comment form's submit button" and "does not press a review's vote button":
    the checkout row, and "CONSENT_TEXT_ANYWHERE does not match \"Yes, I agree\""
    and "\"Sono d'accordo\"" in `provoke.test.ts`. "an in-flow strip labelled
    \"Accetta\" is pressed", "a fixed bar that never says cookie or consent,
    labelled \"Accetta\", is pressed" and "still presses a sticky header's notice
    labelled with an old phrasing": "still presses an old label on a cookie strip
    that is neither a dialog nor a fixed layer" (M18: 4 killers before, 1 after).
    (Corrected at landing, 2026-10-12, after gate 1's low: that survivor stands
    for the first two of the three, not for the last, "still presses a
    sticky header's notice labelled with an old phrasing", the sticky header's
    notice labelled "OK", which does not fail when `ok|okay` is dropped from
    `CONSENT_TEXT_ANYWHERE`. Its survivor is `provoke.test.ts` "CONSENT_TEXT_ANYWHERE
    still matches \"OK\"". See the last entry.)
    "an in-flow strip labelled \"Accetto e continua\" is pressed: false":
    "CONSENT_TEXT_ANYWHERE does not match \"Accetto e continua\"". "does not press
    a sticky header's notice labelled with a dl-82 phrasing" and "a sticky header
    with a visible cookie link in its nav": `c7` (M2, M4). "reaches a bottom
    consent bar past a sticky header that links a cookie policy": `c7` and "reaches
    a bottom consent bar past a sticky header's notice" (M4, M2). "a fixed app root
    whose footer says 'cookie' holds an h1 ...": `c13` (M3c). "a docked checkout
    bar whose prose says 'cookie' is itself a form ...": `c14` (M3b). `ctl=none`:
    the `ctl=%s` rows assert the same box click and stream.
  - Deleted as vacuous: the four rows proved above, and the "fixed" and "sticky"
    checkout rows.
  - Demoted, a browser-free test already makes the assertion: "presses \"Accept
    all\" / \"Accetto e continua\" / \"Acconsento\" / \"Ho capito\" / \"Agree and
    continue\" / \"Accept & close\" / \"Yes, I agree\" and finds the stream behind
    it" are the `CONSENT_TEXT` KEPT and ADDED rows ("matches %j"; M20, M20b), with
    "presses \"Sono d'accordo\"" kept as the one end to end. "presses neither a
    pagination link nor a vote button ...": new rows `CONSENT_TEXT_ANYWHERE does
    not match %j either` over REFUSED (M17). "does not press a sticky header's
    notice whose prose says Swedish 'pannkakor'": the `CONSENT_WORDING` SILENT rows
    (M7). "a whole file with a resolution suffix in its name is offered":
    `capture-rules` "a numeric id or a resolution suffix does not classify a
    request as a segment" and "keeps a lone numbered file" (M12). "an HLS playlist
    served as application/octet-stream" and "a DASH manifest served as text/plain":
    `sniff` "a small fetch/xhr 200 with no type, text/plain or octet-stream is
    read" and "an untyped, extensionless body beginning <MPD is a dash hit" (M13).
    "a page that requested no segments carries no such reason": `sniff` "adds
    nothing when no segment was seen" (M14). "outranks the variant it names, even
    when that variant is called index.m3u8": `capture-rules` "an extensionless
    route that names a master, requested first, beats a later variant named
    index.m3u8" and `sniff` "a slowly-read untyped master ranks above the typed
    variant it names" (M15, M19: the Build marked it medium confidence, and both
    mutations fail a unit test). "scrolls to the largest candidate, so a nav bar
    and an ad iframe above the fold do not take the slot": `provoke` "brings the
    large shell into view, not the small nav bar that comes first", plus a new row
    on the same ad-iframe page (M9). "reports GEO_BLOCKED when the region is
    refused": `capture-rules` "region refusal is named as such" plus a new
    `provoke` test that reads `/geo.html` and classifies it (M16).
  - `consent-scope`: `r3b` was `r5`'s markup without the reveal, and `r3`, `r4`,
    `r6`, `r8` differ from `r7` only in the sentence and the label. `r4`'s Polish
    and `r6`'s sentence are new `CONSENT_WORDING` SPEAKS rows. `c1` to `c14` now
    drive `provokePlayback` on the page, with the resolver's viewport and locale:
    every mutation the 14 failed through the resolver (M1 to M5, M7) fails the
    same set through `provokePlayback`, no more and no fewer, and `c15` is added.
    `r5` and `r5b` are not retimed.
  - `chunk-streams`: kept nomanifest, gallery and abort. Demoted to
    `chunk-sniff`: twelve chunks (C1), twelve whole files (C2), the whole file
    read first (C3), the all-zero body (C4), clip-720 and clip-1080 (C6), and
    "boxes but not a movie" (C7, with a new row, "a free box, then zeros is
    unknown"). The lone fragmented movie and the one beside two whole files fail
    C5 in neither tree's browser test: the sniff reads a head of
    `SNIFF_HEAD_BYTES` (65536) and the `moof` ends at byte 585, but the 1 MB
    `mdat` is cut off at the head, so `lastEnd !== head.length` and `sniffHead`
    answers `unknown` with or without the check. (Corrected at landing,
    2026-10-12, by the fixer after gate 1's low: this sentence first said "their
    bodies are a megabyte, the `moof` falls outside the 2 KB head", which was
    wrong about the head and the `moof`; the conclusion stands. See the last
    entry.) The unit row with a 1 KiB movie is the only thing that fails C5 either
    way. The `moov`-after-`mdat` row of the Build's table is the gallery's third
    file, which stays.
  - Fixtures with no probe left were removed with their rows, and are in
    `d759b80e`: thirteen pages, `media/extless/`, the `/api/playlist?3`, `?4`
    and `/api/manifest?1` routes, the `/cross-origin-shadow.html` frame and the
    `/guard-redirect` route; `consent-bar-rows.html` lost five rows,
    `consent-header-then-bar.html` its `?menu=link`.

  **Kept.** The four `delay` rows of dl-81's "is skipped once a play control was
  pressed" (0, 300, 1500, 3000 ms), as the Build said. The fragment-only test
  (396 in the Build): M22 fails the landing-URL test and not the plain redirect,
  and nothing shows the fragment test's failure would name its cause otherwise.
  The label row of dl-100's "is a press that counts, so a slow player is not
  clicked past" (the Build did not list it; dl-114's step 2 says to delete it
  there if it is still here). Everything the Build did not name.

  **Where the Build's rule and this change disagree, which is for the owner.**
  Done-when 3 says no row with a gate or owner decision behind it was removed.
  Almost every consent row sits in a block titled for the dl-82 gate that found
  it, and `git log -S` cannot tell them apart: all of dl-82 landed as `0254c9a1`.
  Read as "no such row was deleted", about twenty here break it, among them the
  two dl-93 rows the owner flipped on 2026-10-10 (the app root and the docked
  form, `c13` and `c14` now) and dl-90's two fragmented-MP4 rows ("owner
  2026-10-10"). Read as "no gate finding or decision lost its test", none does:
  each finding is pinned by a survivor that fails the same mutation, and its
  name is on that survivor (gate 3's block is now a comment listing where each of
  its seven rows went). The change follows the second reading, which is the one
  the Build's own list (1565, 1744, 1764 for `c7`, `c13`, `c14`) needs. If the
  first is meant, restore those rows from `d759b80e`; nothing else depends on
  them.

  **For dl-114.** Its rows were not touched. By name, with the lines at this
  commit: `adding ?%s= on play is not a departure` 404, `a query key outside the
  exception is still a departure` 415, `a reordered query string is not a
  departure` 426, `a same-document navigation (history.pushState)` 310;
  `ctl=%s (%s) is pressed but does not hold back the box click` 1883, `ctl=%s is
  a press that counts, so the box is not clicked` 1913, `ctl=%s (%s) is a press
  that counts, so a slow player is not clicked past` 1948. `sameDocument` is
  `browser.ts:746`, `startsWord` and `isPlayPress` `provoke.ts:848` and `866`.
  `ctl=none`, the first row of the first of those, is gone.

  **Not done, and why.** dl-118's three accepted-residue rows were left alone, as
  asked; the only edit near them is the `[false]` sign-up row 30 lines above.
  Not measured: any other platform (the 7000 ms ceilings in the merged tests
  are the ones dl-95 already widened for Windows), and the cost of a
  `provokePlayback` case against a probe other than the 14 in `consent-scope`.

- 2026-10-12 — Merged `origin/main` (`07acbb86`: dl-116, dl-118, repo-102) with
  no conflict. dl-118 edited the dl-83 block and `provoke.test.ts`, which this
  branch also edits, in different places. After `npm run build` and `npx tsc
  --build`, `npx vitest run` on the five files: `browser-resolver` 137 passed in
  391.32 s, `consent-scope` 23 in 45.52 s, `chunk-streams` 3 in 9.43 s,
  `provoke` 264 in 11.32 s (dl-118's cap block added 10 tests), `chunk-sniff` 33.
  The durations in the first entry are the ones measured before the merge and
  are this ticket's alone; the 391 s includes dl-118's saving. Before the
  merge, `npm test -- --project downloader`: `Test Files 114 passed | 1 skipped
  (115)`, `Tests 2425 passed | 2 skipped (2427)`, 418.36 s, exit 0.
- 2026-10-12 — **Owner decision on Done-when 3: option A.**

  **Question.** Done-when 3 said "No row with a gate or owner decision behind it
  was removed. The Log names the rows kept for that reason." The change removed 27
  such rows (23 from gate findings, 4 from dated owner decisions). Which reading
  holds?

  **Options.** A: keep all 27, and reword Done-when 3 to "no gate finding or
  owner decision loses its test; the Log names the survivor" (full 205 s saving).
  B: restore the four dated owner rows (18, 20, 23, 24), 11 s. C: restore those
  four plus rows 25 and 26, 16 s. D: literal, restore all 27, 74 s.

  **Answer: A**, the builder's recommendation, given by the owner on 2026-10-12.
  Done-when 3 above is the owner's rewording of that date. The original sentence,
  kept here: "No row with a gate or owner decision behind it was removed. The Log
  names the rows kept for that reason."

  **The 27 rows**, with the survivor that fails the same mutations (letters are
  the mutations in the first entry; durations are from the `d759b80e` run, one run
  each, so they move with load). Files are `browser-resolver.test.ts` unless
  stated. Rows 25 and 26 are attributed to the owner on the strength of his
  2026-10-07 rewording of the Done-when line "a body the sniff cannot parse,
  including an all-zero one, is offered", not a row-specific decision.

  | #   | Test at `d759b80e`                                                                           | Decision                                      | s    | Survivor                                                                                                                 |
  | --- | -------------------------------------------------------------------------------------------- | --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
  | 1   | gate 1 › finds the stream behind a full-viewport overlay and leaves the newsletter alone     | dl-82 gate 1                                  | 2.79 | "reaches a bottom consent bar past a sticky header's notice", checkout row, `consent-scope` c-rows (M1)                  |
  | 2   | gate 1 › … behind a bottom bar …                                                             | dl-82 gate 1                                  | 2.79 | as row 1                                                                                                                 |
  | 3   | gate 1 › does not press a newsletter's dismiss button                                        | dl-82 gate 1                                  | 2.72 | "an in-flow strip labelled "Ho capito" is not pressed" (M1)                                                              |
  | 4   | gate 1 › does not press a comment form's submit button                                       | dl-82 gate 1                                  | 2.74 | checkout row; `provoke.test.ts` "CONSENT_TEXT_ANYWHERE does not match "Yes, I agree"" (M1)                               |
  | 5   | gate 1 › does not press a review's vote button                                               | dl-82 gate 1                                  | 2.74 | checkout row; "… does not match "Sono d'accordo"" (M1)                                                                   |
  | 6   | gate 2 › in-flow strip labelled "Accetto e continua" is pressed: false                       | dl-82 gate 2                                  | 2.72 | "CONSENT_TEXT_ANYWHERE does not match "Accetto e continua"" (M1)                                                         |
  | 7   | gate 2 › in-flow strip labelled "Accetta" is pressed: true                                   | dl-82 gate 2                                  | 2.77 | "still presses an old label on a cookie strip…" (M18)                                                                    |
  | 8   | gate 2 › does not press the submit of a fixed checkout bar                                   | dl-82 gate 2 (vacuous for the wording rule)   | 2.74 | checkout row (M1); `c1`                                                                                                  |
  | 9   | gate 2 › … of a sticky checkout bar                                                          | dl-82 gate 2 (vacuous for the wording rule)   | 2.74 | as row 8                                                                                                                 |
  | 10  | gate 2 › sticky header's notice labelled with a dl-82 phrasing                               | dl-82 gate 2                                  | 2.75 | `c7` (M2, M4)                                                                                                            |
  | 11  | gate 2 › sticky header's notice labelled with an old phrasing                                | dl-82 gate 2                                  | 2.81 | `provoke.test.ts` "CONSENT_TEXT_ANYWHERE still matches "OK"" (corrected at landing; first said "cookie-strip row (M18)") |
  | 12  | gate 2 › fixed bar that never says cookie or consent, "Accetta", is pressed: true            | dl-82 gate 2                                  | 2.80 | cookie-strip row (M18)                                                                                                   |
  | 13  | gate 3 › sticky header with a visible cookie link is not a container                         | dl-82 gate 3                                  | 2.74 | `c7`, `r1`, `r1b`, `r2b` (M4)                                                                                            |
  | 14  | gate 3 › … with a display:none cookie link                                                   | dl-82 gate 3 (vacuous for visibility)         | 2.73 | `c7` (M2); `r5b`, `c15` (M5)                                                                                             |
  | 15  | gate 3 › reaches a bottom consent bar past a sticky header that links a cookie policy        | dl-82 gate 3                                  | 2.79 | `c7`, "reaches a bottom consent bar past a sticky header's notice" (M4, M2)                                              |
  | 16  | gate 3 › checkout submit in a bar whose prose says Italian 'consente'                        | dl-82 gate 3 (vacuous)                        | 2.73 | `CONSENT_WORDING` SILENT rows in `provoke.test.ts` (M6)                                                                  |
  | 17  | gate 3 › sticky header's notice whose prose says Swedish 'pannkakor'                         | dl-82 gate 3                                  | 2.75 | `CONSENT_WORDING` SILENT rows, `c8` (M7)                                                                                 |
  | 18  | gate 3 › app root whose footer says 'cookie' holds an h1 (dl-93, flipped from a1)            | dl-82 gate 3; owner, dl-93, 2026-10-10        | 2.74 | `consent-scope` `c13` (M3c)                                                                                              |
  | 19  | gate 3 › app root whose footer only links a cookie policy                                    | dl-82 gate 3 (vacuous)                        | 2.75 | `c4`, `c15` (M4, M5)                                                                                                     |
  | 20  | gate 3 › docked checkout bar whose prose says 'cookie' is itself a form (flipped from a2)    | dl-82 gate 3; owner, dl-93, 2026-10-10        | 2.76 | `consent-scope` `c14` (M3b)                                                                                              |
  | 21  | dl-83 › sign-up chips … (confirmation false)                                                 | dl-83 gate round 1                            | 2.74 | "not told to confirm ages…", "an Italian gate… not told to confirm" (M11)                                                |
  | 22  | dl-81 › scrolls to the largest candidate, so a nav bar and an ad iframe do not take the slot | dl-81 gate 1                                  | 2.84 | `provoke.test.ts` SCROLL_SCRIPT rows, new ad-iframe row (M9)                                                             |
  | 23  | `chunk-streams` › a lone numbered file with moov, mvex and then moof is offered              | dl-90, owner, 2026-10-10                      | 2.71 | `chunk-sniff.test.ts` "a whole movie written as fragmented MP4 … is not a chunk" (C5)                                    |
  | 24  | `chunk-streams` › beside two whole files in one directory, all three are offered             | dl-90, owner, 2026-10-10                      | 2.75 | as row 23, plus the faststart rows (C6)                                                                                  |
  | 25  | `chunk-streams` › an all-zero body is offered                                                | dl-90, owner, 2026-10-07 (reworded Done-when) | 2.75 | `chunk-sniff.test.ts` "an all-zero body is unknown", "a read that finds nothing, or throws, offers the file" (C4)        |
  | 26  | `chunk-streams` › a body that is boxes but not a movie is offered                            | dl-90, owner, 2026-10-07 (reworded Done-when) | 2.73 | new "a free box, then zeros is unknown" (C4, C7)                                                                         |
  | 27  | `chunk-streams` › the whole file, read first, survives the init and media segments           | dl-90 gate 1 (low, read order)                | 2.72 | `chunk-sniff.test.ts` "a file read and found whole is kept when a fragment beside it is proven later" (C3)               |

  **Totals.** Restoring all 27 (option D): 74.32 s, leaving 130.7 s of the 205 s.
  Restoring rows 18, 20, 23, 24 (B): 10.96 s, leaving 194.0 s. Restoring those
  four plus 25 and 26 (C): 16.44 s, leaving 188.6 s. Option A restores none and
  keeps the 205 s. Rows not counted, with no gate or owner decision recorded for
  the row itself: the label and lookalike rows, `r3`, `r3b`, `r4`, `r6`, `r8`, the
  cross-origin shadow row, the plain redirect, `ctl=none`, the dl-78, dl-79 and
  dl-92 rows, GEO, and the chunk rows for 12 chunks, 12 whole files and
  `clip-720`/`clip-1080`. Rows merged into a survivor keep their assertions and
  are not in the table.

- 2026-10-12 — **Gate 1's two lows, _fixed at landing_** (the owner chose that
  over landing as is, with no re-gate; ticket text only, no code changed).

  **Question.** Gate 1 passed with two low findings, both wrong sentences in this
  Log. Land it how?

  **Options.** The lander corrects both (recommended); land as is.

  **Choice.** The lander corrects both, no re-gate.

  **Finding 1, low, no Done-when line depends on it.** The Log's reason why the
  lone fragmented-movie probes could not fail C5 was false: "their bodies are a
  megabyte, the `moof` falls outside the 2 KB head". The head is
  `SNIFF_HEAD_BYTES` in `chunk-sniff.ts`, 65536 bytes, and the `moof` ends at byte
  585; the 1 MB `mdat` is cut off, so `lastEnd !== head.length` and `sniffHead`
  answers `unknown` whether the later-`moof` check is there or not. The
  conclusion stands. Fixed in the `chunk-streams` bullet of the first built entry,
  with the old words quoted and marked. Command, run at the landing tree:
  `node --import tsx <scratch>/lonefrag-head.mts <tree>` printed
  `SNIFF_HEAD_BYTES 65536 body 1049169`, `moof body@ 541 end 585`,
  `lastEnd === head.length: false verdict: unknown`.

  **Finding 2, low, `nfr:maintainability`.** The survivor column named "cookie-strip
  row (M18)" for row 11, the sticky header's notice labelled "OK". Dropping
  `ok|okay` from `CONSENT_TEXT_ANYWHERE` does not fail that row (the gate's W9: 0
  of 9 in the dl-82 and dl-93 blocks). The survivor for the label half is
  `provoke.test.ts` "CONSENT_TEXT_ANYWHERE still matches \"OK\"". Fixed in row 11
  of the table and in the `browser-resolver` bullet that quotes it (M18), with the
  old words marked. Command: with `ok|okay` removed from `CONSENT_TEXT_ANYWHERE`
  in `provoke.ts`, `npx vitest run <provoke.test.ts>` failed
  "CONSENT_TEXT_ANYWHERE still matches \"OK\"" and "… still matches \"Okay\"":
  `Tests 2 failed | 262 passed (264)`. The source was restored afterwards.
