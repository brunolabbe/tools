---
id: dl-114
tool: downloader
title: Three pure rules are tested only by driving Chromium or ffmpeg, because none of them is exported
kind: chore
status: done
milestone: null
depends_on: [dl-112, dl-113]
difficulty: standard
---

# dl-114 — Pure rules the browser tests reach through Chromium

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

Three pure decisions are tested row by row through a full probe or a real
download, because each one is module-private. Each row costs 3 to 12 s to prove
what a table test proves in microseconds. **The owner allowed source changes for
testability on 2026-10-12**, provided production behaviour is unchanged.

## Build

1. **`sameDocument`** (`resolvers/src/resolvers/browser.ts:746`).
   - Export it, or move it to a module of its own if exporting it from
     `browser.ts` would widen the package's public API. Check that the package's
     `index.ts` does not re-export it.
   - Table-test it: `?t=`, `?start=`, `?autoplay=`, a reordered query, another
     key, and a fragment.
   - Then delete these browser-resolver rows: 446 `[start]` and 446
     `[autoplay]`, 457 ("other key departs") and 468 (reordered query).
   - Keep 446 `[t]` and 336 as the browser-level proof of the wiring.
2. **The play-press attribute rule** (`resolvers/src/browser/provoke.ts`,
   `startsWord` at 848 and `isPlayPress` at 866).
   - `isPlayPress` takes a `Locator`. Extract the attribute decision as a pure
     function over the attribute values it reads, and have `isPlayPress` call
     it. Table-test the extracted function.
   - Then delete these rows:
     - 2252: the five controls that do not count, other than `autoplay`;
     - 2280: the five controls that count, other than `jw`, `watch` and `xo` —
       `watch` and `xo` carry no attribute mark and take the label path
       (`clickByText`), so neither reaches this rule;
     - 2323: camel-testid and camel-title (the camel-case branch at about
       `provoke.ts:853`).
   - The 2323 label row is already deleted by dl-113 if it acted on it. If not,
     it is a duplicate of 2093's 3000 ms row.
3. **`Meter`** (`engine/src/download/parallel-ranges.ts:225`). Every method
   takes `now` as an argument, so it is pure. It is not exported.
   - Export it, and unit-test the pause and release arithmetic that the F9 tests
     now prove in real time. Those tests are 5.2, 5.5 and 12.5 s:
     `sleep(4_000)` at about line 1314, an 8 s pause at about 1411, and
     `sleep(12_000)` at about 1415 of `engine/test/parallel-ranges.test.ts`.
   - Keep one integration test, scaled down: `measureMs` from 4000 to about
     1000, pause from 8 s to about 2 s, sleep from 12 s to about 3 s. Read
     dl-106 first: its Windows timer-tick findings govern how far it can shrink.
   - Read dl-120 too: the loopback limits the shrink as well. When a test's
     reader stops, the kernel's socket buffers take several megabytes before
     the feeder pauses the origin, and all of that fill is measured origin
     time. A window shorter than the fill closes before the pause it is meant
     to contain. The amounts, measured on Linux, are not an upper bound:
     - with the stopped reader's origin at 4 MB/s, 5.2 MB at the least
       (dl-120's builder, `probe-busy24-10.log`, 24 busy loops spread over the
       cores) to 7.8 MB;
     - with it unthrottled, 7.5 to 10.45 MB (dl-120's builder, 23 busy loops on
       the test's core) and 6.3 to 10.45 MB (dl-120's gate 2, 11 and 23 loops).

     What sets the fill's time is the rate the fixture actually _delivers_,
     not the rate it was asked for, and a starved process delivers a fraction
     of it: at 23 busy loops on one core, an 8 MB/s origin with a 2 s window
     failed 4 of 15. dl-120's way out for the two-reader helper
     `pausedThenRead` is to leave the reader that stops unthrottled (set
     `behaviour.perConnectionBps = null` before its request, since the fixture
     takes the rate per request) and throttle only the reader being measured.
     The fill's cost to the window is then small at the median (522 ms in
     the builder's 23-loop series), but it is not bounded. At 23 busy loops it
     reached about 1.1 s in gate 2's series and 1.6 s in the builder's, and at
     47 it reached about 2 s (gate 2).
     - **Unmeasured:** whether the third F9 test can take the same remedy. Its
       one reader both stops and is measured, and nobody has measured whether
       an unthrottled reader keeps that test meaningful.

   - **Assert the meter's gap rule, whichever it is.** `Meter.record` adds
     `now - lastAt - paused`. Once `release()` has emptied the members, nothing
     is paused and nothing is being read, so the whole gap until the next
     request's first byte counts as origin time, with no bytes in it. dl-120's
     gate reproduced it (owner's decision, 2026-10-12: record it here, and
     change no production line in dl-120). The setup: an 8 MB/s origin against
     5 MB/s of media, A read for 0.5 s and closed, B started `gapMs` later and
     read for 4 s:

     | gapMs | judged rate               | mode after 4 s                              |
     | ----- | ------------------------- | ------------------------------------------- |
     | 0     | 7956671 B/s               | single                                      |
     | 300   | 6782876 B/s               | single                                      |
     | 1000  | 3994964 B/s, `added=1006` | **parallel** (a fast origin, wrongly split) |

     The options the gate gave: (a) leave it, since first-byte latency is
     arguably the origin's; (b) have `release()` of the last member call
     `interrupt()`, which drops the gap and B's first chunk as well. That
     choice is the owner's, not dl-114's builder's. Ask it before writing the
     assertion, then pin whichever rule is chosen with a unit test on the
     exported `Meter`.

     **Answered, 2026-10-13, by the owner** (through the orchestrator, before
     the assertion was written). The question: which rule should the unit test
     pin? The options were (a) leave it and pin it as is, which keeps Done-when 2
     true; (b) make `release()` of the last member call `interrupt()`, a
     production change that contradicts Done-when 2; and (c) pin (a) now and file
     (b) as a separate ticket. **Chosen: (a)**, the orchestrator's
     recommendation. Pin today's behaviour with a unit test on the exported
     `Meter`, and change no production behaviour.

## Done when

1. Each extracted rule has a table test covering every row deleted for it, so
   each deleted row maps to one table entry. The mapping is in the Log.
2. Production behaviour is unchanged: the resolver and engine suites pass
   untouched apart from the deleted rows, and no caller changes.
3. Nothing is exported from a package's `index.ts` that was not before, unless
   the Log says why.
4. Before and after durations for browser-resolver and parallel-ranges are in
   the Log.

## Review

**Gate: CONCERNS** — 2026-10-13 · `2cb4e734..81daba51` · Opus 5.5, depth standard

| Done when                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each deleted row maps to one table entry   | `resolvers/test/browser/same-document.test.ts` › "sameDocument" rows `adding ?start=`, `adding ?autoplay=`, `adding another key …`, `the same two keys in the other order …`; `resolvers/test/browser/play-press.test.ts` › the `display`, `autoplay-cls`, `autoplay-id`, `autoplay-camel`, `display-cls` rows (`toBe(false)`) and the `testid-word`, `class-btn`, `id-button`, `id-play`, `carousel`, `camel-testid`, `camel-title`, `label` rows (`toBe(true)`) ✓. The gate enumerated the population from the diff: 17 rows deleted from `browser-resolver.test.ts`, 17 matched, each with the fixture's own attributes or URLs as input and the same verdict. Mapping is in the Log |
| 2. Production behaviour unchanged             | **verified** — the `src` diff is three `export` keywords and `isPlayPress`'s tail moved verbatim into `attributesMarkPlayPress`, still inside the same `try`; same order, same short-circuits, the one call site of each rule unchanged. Local: `parallel-ranges.test.ts` 43 of 43, `browser-resolver.test.ts` 120 of 120 (under a read-path mutation that changes no outcome, below). CI `test (ubuntu-latest)` SUCCESS on 81daba51; `test (windows-latest, informational)` in progress, unread                                                                                                                                                                                        |
| 3. Nothing new re-exported from an `index.ts` | **verified** — neither `index.ts` is in the diff, both re-export by name, and both `package.json` `exports` map only `"."` to `dist/index`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4. Before and after durations in the Log      | **verified** — both specs, both sides, `npx vitest run <spec>`, same test counts at head. The gate's head runs agree: browser-resolver 343.0 s for 120 tests, parallel-ranges 70.8 s for 43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

- **med** · no `Done when` line depends on it · **open decision** · Only the
  table tests the attribute decision now, and the table's own `read()` helper
  always supplies all five attributes. So nothing checks the read that
  `isPlayPress` makes in a real page. The gate made `isPlayPress` null its
  `title`, `data-testid` and `id` reads, left `attributesMarkPlayPress`
  untouched, and logged every read. Result: `browser-resolver.test.ts` passed
  120 of 120 in 343.0 s, while the mutation flipped 14 press verdicts from true
  to false (`guard-*`, `box-xo-embed`, `abandoned-body`, all on `id="play"`). In
  the whole suite, no row reads a non-null `title` or `data-testid`. Every
  counting `aria-label` read sits on a page that also carries `id="play"` or a
  library class. Only `ctl=jw` (class) can fail on a broken read, and that was
  not run. Before dl-114, `id-play`, `testid-word` and `camel-title` were each
  the only mark on their element. Options: (1) export the attribute list
  `isPlayPress` reads, and have the table's `read()` build from it. That costs
  no browser time and catches an attribute dropped from the read. It does not
  catch a fault in Playwright's `getAttribute`. (2) Restore one browser row
  whose only mark is `id` (`ctl=id-play`). That costs 3 to 12 s and covers the
  `id` read for real. (3) Accept it. **Recommended: (1)**, because the read is
  one generic `Promise.all` over that list, and the list is the part that can
  drift. — owner chose (1), 2026-10-13; fixed in f39185ab
- **open decision** · no `Done when` line depends on it · Build item 3 says
  "Keep one integration test, scaled down". The branch keeps all three F9
  integration tests and scales only the third. The two `pausedThenRead` tests
  still `sleep(4_000)`, and the Log leaves deleting them to the owner. The
  gate's measurement: with the meter paused on any member rather than every
  member, `-t F9` fails "F9: a paused request left open does not stop the meter
  for one that is reading" (`expected null not to be null`, 10350 ms), so that
  test guards wiring the unit table cannot. The Log's matching claim for the
  other `pausedThenRead` test was not re-run. Options: (1) keep both, which is
  about 10 s; (2) delete both, as the brief read. **Recommended: (1).** — owner
  chose (1) keep both, 2026-10-13
- **low** · `nfr:maintainability` · Three places say `xo` does not reach the
  attribute rule because it "presses in a frame": the header of
  `play-press.test.ts`, the comment above the counting rows in
  `browser-resolver.test.ts`, and the brief. The conclusion holds but the reason
  is wrong. `provoke.ts` runs `clickVisible(frame, PLAY_SELECTORS, { countPress:
isPlayPress })` in every frame, and the gate's read log shows `embed-inner`'s
  `id="play"` read through `isPlayPress` inside a frame. `xo`
  (`box-xo-cta.html`) stays out of the rule because its "Watch now" button has
  no attribute mark and takes `clickByText`. — owner chose fix, 2026-10-13;
  fixed in f39185ab
- **dropped** · out of the reviewed range · "a Play press in a frame from
  another site still holds back the box click …" (`browser-resolver.test.ts`)
  passed while the mutation above flipped its press to not-counted. Its
  manifest is captured at 1.5 s, before any box click, so its title claims more
  than its outcome depends on. This is a test dl-114 did not touch, and is a
  candidate ticket rather than a finding here. — filed as dl-123 (#477,
  628d7efa); the filing measured the explanation wrong: `clickByText(PLAY_TEXT)`
  presses the same button and sets `labelClicked`, so the 1.5 s timing is not
  what holds it (gate 2 accepted the correction)
- **findings** · the hunt returned 4; 3 carried (1 med, 1 open decision, 1
  low), 1 dropped.
- Positive controls: (a) with option (b) planted (`release` of the last member
  calls `interrupt()`), `parallel-ranges-meter.test.ts` failed 5 of 15,
  including all three `a gap of N ms` rows. (b) With a closed reader kept as a
  member (`release` no longer deletes from members), `-t F9` failed the third
  F9 test 5 of 5 (`expected 'parallel' to be 'single'`). Restored, it passed 5
  of 5. All ten runs had the Chromium suite running beside them.
- Fixtures: no reference remains in `tools/`, `packages/` or `scripts/` to
  `player-poster-icon-grid.html`, to the removed `rewrite=` modes or to the
  removed `ctl=` modes, outside dl-114's tables and the historical Logs of
  dl-55 and dl-100.
- Invariants: only test registration (the new files sit under existing `test/`
  globs, and CI `check` passed) and style apply. Skipped as untouched: tool
  imports, `AppError`, shell, redaction, SSRF, progress, contract, Dockerfile,
  routes.
- NFR: security n/a · performance ✓ (about 62 s and 9 s off the two specs) ·
  reliability: the rescaled third F9 test is unmeasured on Windows (dl-106),
  and the Windows leg was still running at gating · maintainability: above.

### Gate 2

**Gate: FAIL** — 2026-10-13 · `81daba51..f8f8819e` (the round is f39185ab; the merge of `main` at 32929437 was not reviewed) · Opus 5.5, depth standard

| Done when                                     | Proof                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each deleted row maps to one table entry   | `resolvers/test/browser/play-press.test.ts` and `same-document.test.ts`, unchanged in substance from gate 1, and now 26 of 26 and 17 of 17 ✓                                                                                                                                                                                              |
| 2. Production behaviour unchanged             | **verified** — `PLAY_PRESS_ATTRIBUTES` is the same `[...new Set(PLAY_LOOSE_SELECTORS.map(…))]` that `isPlayPress` used to build on each call, now built once at module load. The values, their order, the `Promise.all` and `attributesMarkPlayPress` are all unchanged. The only round change in `browser-resolver.test.ts` is a comment |
| 3. Nothing new re-exported from an `index.ts` | **verified** — no `index.ts` or `package.json` in `81daba51..f8f8819e`; `PLAY_PRESS_ATTRIBUTES` is exported from `provoke.ts` only                                                                                                                                                                                                        |
| 4. Durations in the Log                       | **verified** at gate 1; the round adds the Windows F9 timings, which the gate read from run 38337572439 (6053, 6369 and 3533 ms, as logged)                                                                                                                                                                                               |

Gate 1's findings:

- **med, the untested DOM read: fixed, with option (1) as the owner chose.**
  `isPlayPress` now reads by `PLAY_PRESS_ATTRIBUTES`, and the table's `read()`
  builds from the same list. Dropping `id` from the list fails 3 of 26
  (`is the five attributes …`, `id-button`, `id-play`). Dropping `title` fails 4
  of 26 (that same pin test, `camel-title`, `title`,
  `display-name with a Player title`). Restored: 26 of 26.
  **Residue.** The gate nulled the `id` result after the `Promise.all`, leaving
  the list alone. `play-press.test.ts` and `provoke.test.ts` then passed 290 of
  290, and `browser-resolver.test.ts` passed 120 of 120 in 338.05 s. This is the
  gap option (1) knowingly left: anything inside `isPlayPress`'s read body, of
  which Playwright's `getAttribute` is the main part. It is not a new gap.
- **low, the xo reason: fixed.** All three rewordings match the code:
  - `provoke.ts` calls `clickVisible(frame, PLAY_SELECTORS, { countPress: isPlayPress })` in every frame;
  - `cta-inner.html`'s only control is `<button onclick=…>Watch now</button>`;
  - `watch` is an `<a href="#later">` with no attribute mark.
- **dropped, the box-xo-embed test: the explanation is corrected.** dl-123's
  filer measured that `clickByText(PLAY_TEXT)` presses the same button. The gate
  did not dispute that with a command. Gate 1's mutation flipped only
  `isPlayPress`'s verdict and left `labelClicked` alone, which fits the filer's
  account. Gate 1's 1.5 s timing explanation was wrong.

New in the round:

- **high** · shipped text that is false against the code · The new header of
  `play-press.test.ts` says Playwright's `getAttribute` "is covered thinly by the
  browser rows that remain: `ctl=jw` counts through a class, and the pages that
  count through `id="play"`". The round's Log says the same ("only `ctl=jw` (a
  class) and the pages that count through `id="play"` cover it, thinly"). The
  `id` half is false:
  - With `read.set("id", null)` planted after the `Promise.all` in
    `isPlayPress`, `browser-resolver.test.ts` passed `Tests 120 passed (120)`.
    Gate 1's mutation (`title`, `data-testid` and `id` nulled) gave the same
    result while flipping 14 `id="play"` verdicts.
  - The `class` half is true: with `read.set("class", null)` planted, `-t "ctl=jw"`
    fails `ctl=jw is a press that counts, so the box is not clicked`
    (`expected undefined to be an instance of AppError`). Restored, it passes.

  Remedy, fully stated: in the test header and in the Log bullet, strike "and
  the pages that count through `id="play"`". Then say that only `ctl=jw`
  (class) can fail on a broken read, and that no browser row fails on a broken
  `id`, `aria-label`, `title` or `data-testid` read. — owner chose fix then a
  narrow gate 3, 2026-10-13; fixed in a6c7254b, verified by gate 3

- **findings** · the round's hunt returned 1; 1 carried (high), 0 dropped. Of
  gate 1's: med fixed, low fixed, the dropped finding's explanation corrected.
- dl-105's flaky "a wall clock stepped back before the wait …": f39185ab cannot
  affect it. The round's only runtime change builds an identical list once
  instead of on every call, and that test's code and helpers are untouched.
- CI on f8f8819e, read once: `check` (CI), `check` (pr-title), `changes`,
  `dependency-review` and `e2e (sniffer)` passed. Still in progress and unread:
  `test (ubuntu-latest)`, `test (windows-latest, informational)`,
  `e2e (direct)`, `docker` and `codeql`.

### Gate 3

**Gate: PASS** — 2026-10-13 · `f8f8819e..e3f65f8e` (the round is a6c7254b; the merge of `main` bringing 4f756c40 and 628d7efa was not reviewed) · Opus 5.5, narrow: gate 2's high only

| Done when | Proof                                                                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4       | unchanged since gate 2: a6c7254b changes text only (a comment in `play-press.test.ts` and the ticket's Log). CI on e3f65f8e: every check passed, `test (ubuntu-latest)` and `test (windows-latest, informational)` included ✓ |

Gate 2's finding:

- **high, the false coverage claim: fixed.** a6c7254b touches 2 files, +15 −4,
  in the two places the remedy named.
  - The header of `play-press.test.ts` now says "Only `ctl=jw`, which counts
    through a class, can fail on a broken read; no browser row fails on a broken
    `id`, `aria-label`, `title` or `data-testid` read".
  - The Log's "Owner's answer 2" bullet says the same.
  - The rest of the change is one new Log bullet recording the fix.
  - Nothing else changed; the commit holds no code.

  `git diff origin/main...e3f65f8e | grep 'id="play"'` finds three Log lines on
  the branch, and none claims those pages cover the read:
  - the 3000 ms row's button carries `id="play"` (accurate);
  - gate 1's mutation flipped 14 verdicts on `id="play"` pages (accurate, left
    alone as the fixer reported);
  - the new bullet, which says they do not cover it.

- **findings** · the round's hunt returned 0.
- CI on e3f65f8e, read once: 11 checks passed, none failing or pending
  (`test (windows-latest, informational)` included). No tests were run locally,
  because the round touches no code.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 25 s
  from `sameDocument`, about 33 s from the play-press rule, and about 15 to 18 s
  from `Meter` (inferred).
- 2026-10-13 — The owner answered the meter-gap question (Build, item 3) before
  any source changed: option (a), pin today's behaviour. The question, the three
  options and the answer are written under that bullet.
- 2026-10-13 — Built (builder, Sonnet 5.5). Three rules exported, tabled and
  their browser rows deleted. Production code: three `export` keywords and one
  function split in two; no caller changes.
  - **`sameDocument`** (`resolvers/src/resolvers/browser.ts`) is exported in
    place. `src/index.ts` names what it re-exports from that module and does not
    name this, so the package surface is unchanged. The table is the new
    `resolvers/test/browser/same-document.test.ts`.
  - **The play-press rule** is extracted from `isPlayPress`
    (`resolvers/src/browser/provoke.ts`) as `attributesMarkPlayPress(read)`,
    over the `Map` of attribute values `isPlayPress` already built. `isPlayPress`
    reads the five attributes and calls it. The table is the new
    `resolvers/test/browser/play-press.test.ts`.
  - **`Meter`** (`engine/src/download/parallel-ranges.ts`) is exported in place;
    `src/index.ts` names its exports and does not name it. The unit tests are the
    new `engine/test/parallel-ranges-meter.test.ts`. Both new files are separate
    from `provoke.test.ts` and `parallel-ranges.test.ts` on purpose: dl-122 edits
    the first and dl-121 will edit the second.
  - **Done when 1: each deleted row, and the table entry that covers it.** The
    rows were in `resolvers/test/browser/browser-resolver.test.ts`, found by name
    (the ticket's line numbers did not resolve).

    | Deleted row (browser-resolver.test.ts)                                                | Table entry (test name)                                     |
    | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
    | `adding ?start= on play is not a departure`                                           | same-document: `adding ?start=`                             |
    | `adding ?autoplay= on play is not a departure`                                        | same-document: `adding ?autoplay=`                          |
    | `a query key outside the exception is still a departure`                              | same-document: `adding another key (...): a departure`      |
    | `a reordered query string is not a departure (dl-55, decision 5)`                     | same-document: `the same two keys in the other order (...)` |
    | `ctl=display (...) is pressed but does not hold back the box click`                   | play-press, do not count: `display`                         |
    | `ctl=autoplay-cls (...)`                                                              | play-press, do not count: `autoplay-cls`                    |
    | `ctl=autoplay-id (...)`                                                               | play-press, do not count: `autoplay-id`                     |
    | `ctl=autoplay-camel (...)`                                                            | play-press, do not count: `autoplay-camel`                  |
    | `ctl=display-cls (...)`                                                               | play-press, do not count: `display-cls`                     |
    | `ctl=testid-word is a press that counts, so the box is not clicked`                   | play-press, count: `testid-word`                            |
    | `ctl=class-btn is a press that counts, ...`                                           | play-press, count: `class-btn`                              |
    | `ctl=id-button is a press that counts, ...`                                           | play-press, count: `id-button`                              |
    | `ctl=id-play is a press that counts, ...`                                             | play-press, count: `id-play`                                |
    | `ctl=carousel is a press that counts, ...`                                            | play-press, count: `carousel`                               |
    | `ctl=camel-testid (...) is a press that counts, so a slow player is not clicked past` | play-press, count: `camel-testid`                           |
    | `ctl=camel-title (...) ...`                                                           | play-press, count: `camel-title`                            |
    | `ctl=label (aria-label=Play) ...`                                                     | play-press, count: `label`                                  |

    Kept in the browser, as the ticket asked: `adding ?t= on play is not a
departure` (now a single test), the `location.assign` departure test (the
    ticket's 336, still at that line), `ctl=autoplay`, `ctl=jw`, `ctl=watch` and
    `ctl=xo`. `t`, `autoplay` and `jw` are in the tables
    as well. 17 rows deleted: `browser-resolver.test.ts` went from 137 tests to
    120 (the head run's `Tests 120 passed (120)`). The three new files hold 57
    (`same-document` 17, `play-press` 25, `parallel-ranges-meter` 15). Their
    fixtures lost the modes nothing reaches any more: `guard-query.html` keeps
    `?rewrite=t`, `box-with-control.html` keeps `autoplay`, `jw` and `watch`, and
    `player-poster-icon-grid.html` is deleted (its only user was the `ctl=label`
    and camel rows).

  - **Each table can fail.** Every mutation was applied to the source, the spec
    run, and the source restored (`git diff` of the three `src` files shows only
    the intended change):

    | Mutation                                                      | Spec          | Failing tests                                                                       |
    | ------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
    | `sameDocument` stops sorting the query                        | same-document | `the same two keys in the other order`                                              |
    | `sameDocument` stops ignoring `start`                         | same-document | `adding ?start=`, `removing ?start=`                                                |
    | `sameDocument` stops comparing the path                       | same-document | `another path`                                                                      |
    | `startsWord` loses its camel-case branch                      | play-press    | `camel-testid`, `camel-title`                                                       |
    | `startsWord` accepts "play" anywhere ("Autoplay", "display")  | play-press    | six rows, `display` and the four `autoplay-*` among them                            |
    | the camel branch loses `(?<![Aa]uto)`                         | play-press    | `autoplay-camel`                                                                    |
    | the `id === "play"` line deleted                              | play-press    | `id-play`                                                                           |
    | the library-class line deleted                                | play-press    | `jw (kept in the browser)`, `plyr`                                                  |
    | `release` does not leave the paused set (the F9 fix undone)   | meter         | `a paused fetch that ffmpeg closed does not keep the meter paused for the next one` |
    | the meter is paused when any member is, not every one         | meter         | three F9 rows                                                                       |
    | `release` does not remove the member                          | meter         | `a fetch ffmpeg closed while it was reading does not make a later pause ...`        |
    | the pause is not taken out of the interval                    | meter         | five rows                                                                           |
    | `interrupt` does nothing                                      | meter         | `interrupt drops the next interval ...`                                             |
    | `release` of the last member calls `interrupt()` (option (b)) | meter         | the two release rows and all three `a gap of N ms` rows                             |

  - **The gap rule is pinned as option (a).** `a gap of 0, 300, 1000 ms before
B's first byte` in `parallel-ranges-meter.test.ts`: the 8 MB/s origin, A
    read for 0.5 s and released, the judge at 1500 ms of measured time against 5
    MB/s of media. 0 ms: 12 080 000 bytes in 1500 ms, fast; 300 ms: 9 680 000 in
    1500, fast; 1000 ms: 4 080 000 in 1500, **not fast** (a fast origin is split).
    These are not the ticket's 7956671, 6782876 and 3994964 B/s: those came from
    a real run and this is a deterministic model of the same rule, so the
    numbers differ and the verdicts agree. The tests carry a comment saying they
    pin today's rule rather than endorse it, and what option (b) would change.
    Option (b) was not filed: the owner chose (a) and not (c), so no ticket
    follows from this.
  - **The third F9 test was measured before it was changed** (the fold-in).
    `engine/test/parallel-ranges.test.ts` › "F9: a request ffmpeg closed while it
    was reading ...". A temporary parameterised copy (not committed) was run
    against the shipped `Meter` ("good") and against one that never removes a
    released reader from its members ("bug", the mutation the test exists to
    catch). Reader B unthrottled where it says "null". Single connection is the
    right answer.

    | Configuration (pause, sleep, media)                                             | good: single | bug: parallel |
    | ------------------------------------------------------------------------------- | ------------ | ------------- |
    | B 4 MB/s, window 4 s, pause 8 s, sleep 12 s, media 3 MB/s (as it was)           | 1 of 1       | 1 of 1        |
    | B 4 MB/s, window 1 s, pause 2 s, sleep 3 s, media 3 MB/s (the ticket's numbers) | 3 of 3       | **0 of 3**    |
    | B null, window 1 s, pause 2 s, sleep 3 s, media 3 MB/s                          | 3 of 3       | **0 of 3**    |
    | B null, same, media 6 MB/s                                                      | 3 of 3       | 3 of 3        |
    | B null, same, media 10 MB/s                                                     | 3 of 3       | 3 of 3        |
    | media 6 MB/s, 23 busy loops pinned to the test's core                           | 6 of 6       | 5 of 6        |
    | media 6 MB/s, 24 busy loops spread over 12 cores                                | 6 of 6       | 6 of 6        |
    | media 10 MB/s, 23 busy loops pinned                                             | 6 of 6       | 6 of 6        |
    | media 10 MB/s, 24 busy loops spread                                             | 6 of 6       | 6 of 6        |

    **The ticket's scaled numbers cannot work with a throttled reader**: at
    4 MB/s the loopback's fill (5.2 to 7.8 MB, so 1.3 to 2 s) outlasts a 1 s
    window, the meter judges B fast before the pause begins, and the test passes
    with the bug in (0 of 3 failed). That is dl-120's bound, met from the other
    side. The remedy dl-120 made for `pausedThenRead` does work here, with a
    higher media rate: with B unthrottled the fill is quick, and what a charged
    pause leaves is the fill over the pause, at most 10.45 MB over 2 s, about
    5.2 MB/s, so the media must be above that; 3 MB/s is not (0 of 3). **The test
    now runs B unthrottled, `measureMs: 1_000`, an 8 s pause cut to 2 s, a 12 s
    sleep cut to 3 s, and media at 10 MB/s** (`size / 10_000_000`; 6 MB/s missed
    the bug once in 12 loaded runs). At 10 MB/s: shipped code stayed single 12
    of 12 loaded runs, the bug split 12 of 12. `bBytes > 10_000_000` still
    holds (B read the 60 MB to the end in every run). The measurement ran the
    shipped Meter and one mutation, on Linux, under busy loops; Windows
    timer-tick behaviour (dl-106) is **unmeasured**.

  - **The other two F9 tests (`pausedThenRead`) are unchanged**, and so is the
    `sleep(4_000)` in it. Each of the three integration tests fails on exactly
    its own Meter mutation (run with `-t F9` after the edit: the paused-closed
    mutation fails "a paused request ffmpeg closed ...", the any-member mutation
    fails "a paused request left open ...", the never-remove mutation fails "a
    request ffmpeg closed while it was reading ..."), so none is a duplicate of
    the unit tests: they prove the feeder calls `pause`, `resume` and `release`
    where the meter needs them. Shortening the `sleep(4_000)` is dl-120's
    "could now be about 2.5 s" and nothing measured it; the first check after it
    is the only guard against a split before B exists, so a shorter sleep would
    narrow what dl-120 fixed. **Left for an owner decision** (see the report):
    whether to delete the two `pausedThenRead` tests (about 10 s) or leave them.
  - **Done when 4: durations.** Each suite alone, `npx vitest run <spec-file>`,
    wall time from the shell, same machine, other agents' suites running on it
    in both:

    | Spec                                                 | Base (2cb4e734)                        | Head                         |
    | ---------------------------------------------------- | -------------------------------------- | ---------------------------- |
    | `resolvers/test/browser/browser-resolver.test.ts`    | 137 tests, 408.6 s (406.3 s by vitest) | 120 tests, 346.3 s (344.2 s) |
    | `engine/test/parallel-ranges.test.ts`                | 43 tests, 81.5 s (80.5 s)              | 43 tests, 72.3 s (71.4 s)    |
    | `resolvers/test/browser/provoke.test.ts` (untouched) | 264 tests, 11.8 s                      | 264 tests, 11.8 s            |

    The saving is 62.3 s and 9.2 s, against the filing's estimates of 58 s
    and 15 to 18 s. Load was not controlled, so the browser figure carries
    that noise. The 9.2 s is the third F9 test going from 12.5 s (the ticket's
    figure; not re-timed on base) to 3.5 s (`--reporter=verbose` on head, `-t F9`:
    6.1 s, 6.4 s and 3.5 s for the three). The base `provoke.test.ts` run started
    after the `provoke.ts` edit, so that row is base plus the extraction; the
    browser-resolver and parallel-ranges base runs started before any edit.

  - **Done when 2 and 3.** `git diff` of the `src` files shows three `export`
    keywords and the function split. Neither `index.ts` changed, and the built
    `dist/index.d.ts` of both packages is byte-identical to the one built before
    the edit: `md5sum` of the engine's is `04432f6a...` and the resolvers' is
    `207b8122...` on both sides. The engine's and resolvers' suites at the
    changed paths pass; the full project is preflight's.
  - **What the brief had wrong.** The ticket's line numbers had moved (`sameDocument`
    at 756, not 746; `Meter` at 233; the F9 sleeps at 1372 and 1474), and the
    deleted-row citations (2252, 2280, 2323) did not resolve in a file of 2083
    lines; the browser-resolver spec is `resolvers/test/browser/browser-resolver.test.ts`.
    The label row at 2323 was **not** deleted by dl-113: it was still there. It
    is not strictly a duplicate of the 3000 ms row, since that page's button
    carries `id="play"` as well as `aria-label`, which the rule counts on either;
    but the attribute rule it exercised (`aria-label=Play` alone) is the `label`
    entry in the table, which is what makes the deletion safe. The ticket's
    scaling for the third F9 test did not work as written (above).
- 2026-10-13 — Round 1, after gate 1 returned CONCERNS on `81daba51`. Three
  owner answers and one measurement.
  - **Owner's answer 1, on the open F9 decision.** The question: the two
    `pausedThenRead` F9 tests are unchanged and each fails on a different meter
    mutation; what to do with them? The options were (1) leave both, (2) delete
    both (about 12 s saved, the feeder's `pause`/`release` wiring then rests on
    the third test alone), (3) file a measurement ticket for a shorter sleep.
    **Chosen: (1), leave both**, the builder's recommendation and the gate's. The
    gate measured why: with the meter paused on any member rather than every
    member, `-t F9` fails "F9: a paused request left open does not stop the meter
    for one that is reading" (`expected null not to be null`), a wiring fault the
    unit table cannot see. Nothing changed for it.
  - **Owner's answer 2, on the gate's medium finding.** The finding: only the
    table tests the attribute decision now, and its `read()` helper supplied all
    five attributes whatever `isPlayPress` reads, so nothing checked the read. The
    gate nulled `isPlayPress`'s `title`, `data-testid` and `id` reads and left
    `attributesMarkPlayPress` alone: `browser-resolver.test.ts` passed 120 of 120
    while 14 press verdicts flipped (all on `id="play"` pages). The options were
    (1) export the attribute list `isPlayPress` reads and build the table's
    `read()` from it (no browser time; catches a dropped attribute, not a fault
    in Playwright's `getAttribute`), (2) restore one browser row whose only mark
    is `id` (`ctl=id-play`, 3 to 12 s), (3) accept it. **Chosen: (1).** Built:
    `PLAY_PRESS_ATTRIBUTES` in `provoke.ts` is the list `isPlayPress` now reads
    by, with the same values in the same order as before (one per distinct
    `PLAY_LOOSE_SELECTORS` attribute), and `play-press.test.ts` builds each row's
    input from it. It is exported for that test only; `index.ts` did not change.
    **It can fail**: with one attribute filtered out of the list in `src`, the
    table fails and names the rows that lose their mark (restored afterwards;
    `git diff` shows only the export):

    | Attribute dropped from the read list | Failing rows (of 26)                                                         |
    | ------------------------------------ | ---------------------------------------------------------------------------- |
    | `id`                                 | `id-button`, `id-play`, and the pin test                                     |
    | `title`                              | `camel-title`, `title`, `display-name with a Player title`, and the pin test |
    | `data-testid`                        | `testid-word`, `camel-testid`, and the pin test                              |
    | `class`                              | `jw`, `vjs`, `ytp`, `plyr`, `class-btn`, and the pin test                    |
    | `aria-label`                         | `carousel`, `label`, `Playlist`, `Player`, and the pin test                  |
    | none (restored)                      | 0 failed of 26                                                               |

    A new test pins the list to the five names the rows can set, so adding a sixth
    attribute to the read forces a row for it. What stays uncovered is a fault in
    Playwright's own `getAttribute` in a real page: only `ctl=jw` (a class) can
    fail on a broken read, and no browser row fails on a broken `id`,
    `aria-label`, `title` or `data-testid` read.

  - **Owner's answer 3, on the gate's low finding, which I reproduced rather than
    transcribed.** Three places said `xo` stays out of the attribute rule because
    it "presses in a frame": the header of `play-press.test.ts`, the comment above
    the counting rows in `browser-resolver.test.ts`, and this brief (Build item 2).
    The reason was wrong. `provoke.ts` runs `clickVisible(frame, PLAY_SELECTORS,
{ countPress: isPlayPress })` in every frame, and `xo`'s `cta-inner.html` has
    only `<button onclick=...>Watch now</button>`, with no attribute mark, so it
    matches `PLAY_TEXT` through `clickByText`; `watch` is an `<a href="#later">`
    with the same property. Reworded in all three places. **The brief's sentence
    is corrected in place** (Build item 2: "`watch` and `xo` carry no attribute
    mark and take the label path (`clickByText`)"). The test header also named
    `player-poster-icon-grid.html` as if it still existed; it now says it is
    deleted.
  - **Measured by the orchestrator from CI on `81daba51`**: all three F9 tests
    passed on the Windows leg, in 6053, 6369 and 3533 ms (run 38337572439), so the
    rescaled third test is measured on Windows once. The leg is red only on the
    pre-existing dl-121 3x test (2.993 against 3). This replaces "Windows
    unmeasured" above.
  - **Gate 2's high was fixed** (gate 2, Opus 5.5, on `f8f8819e`). The header of
    `play-press.test.ts` and "Owner's answer 2" above both said the pages that
    count through `id="play"` cover Playwright's `getAttribute` thinly. They do
    not: with `read.set("id", null)` planted after the `Promise.all` in
    `isPlayPress`, `browser-resolver.test.ts` passed 120 of 120, while with
    `read.set("class", null)` planted `-t "ctl=jw"` fails. Both places now say
    that only `ctl=jw` (a class) can fail on a broken read, and that no browser
    row fails on a broken `id`, `aria-label`, `title` or `data-testid` read.
    Text only; no code changed. **Owner's answer 4**, on that high: the owner
    chose, 2026-10-13, to fix it and then run a narrow third gate (the
    alternatives were not part of this fixer's dispatch, so they are not
    recorded here). Gate 3 read `e3f65f8e` and passed it.
