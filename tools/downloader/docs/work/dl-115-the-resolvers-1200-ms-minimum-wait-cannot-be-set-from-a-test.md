---
id: dl-115
tool: downloader
title: The resolver's 1200 ms minimum wait cannot be set from a test, so the quietMs every test passes does nothing
kind: chore
status: ready
milestone: null
depends_on: [dl-114]
difficulty: standard
---

# dl-115 — The resolver's minimum wait cannot be set from a test

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

A normal browser probe takes about 2.8 s, and 2.6 s of that is fixed. The audit
measured the phases with `onStage` timestamps:

| Phase                                       | Time                  | Source                                                   |
| ------------------------------------------- | --------------------- | -------------------------------------------------------- |
| Page load, then a fixed sleep               | about 510 ms          | `LANDING_URL_SETTLE_MS = 500`, `browser.ts:115`          |
| Two provocation passes with a sleep between | about 1000 ms         | 900 ms at `provoke.ts:1893`                              |
| Quiet wait                                  | about 1200 to 1400 ms | `MIN_WAIT_MS = 1200` (`browser.ts:66`, passed at `:394`) |

`browser.ts` here is `tools/downloader/resolvers/src/resolvers/browser.ts` and
`provoke.ts` is `tools/downloader/resolvers/src/browser/provoke.ts`; the line
numbers are as of `8e49523c`, before dl-115 changed the first.

**The quiet phase is held by `MIN_WAIT_MS`, not by `quietMs`.** The page's last
request lands at least 900 ms before the quiet wait starts. The 71 tests that
pass `quietMs: 1200` therefore pass a value with no effect. `quietMs: 200`
measured 2809 ms against 2761 ms. `MIN_WAIT_MS` is a constant.
`emptyMinWaitMs` (`browser.ts:150`) can be injected, but it only governs probes
that have captured nothing playable.

**The owner allowed this on 2026-10-12, with the default unchanged.** The two
sleeps above stay: dl-55 (tests 407 and 418) proves the 500 ms, and the 900 ms
covers players that mount late. Faking the clock was ruled out:

- the waits mix Node's `Date.now`, Playwright's own timers and Chromium's page
  timers;
- faking Node's timers would also fake Playwright's client timeouts.

## Build

1. **Add `minWaitMs?: number`** to the resolver's options, shaped like
   `emptyMinWaitMs`, with `MIN_WAIT_MS` as the default. Pin the default with a
   test that reads it through a probe's options or an exported constant, so a
   changed default fails.
2. **Use it only in tests that expect a stream.** In those tests a wait that is
   too short fails loudly: the stream is missing.
   - **Do not use it in negative tests:** `NO_MEDIA_FOUND`, `not.toContain` a
     beacon, nothing pressed. There a shorter wait makes the test pass more
     easily, which weakens it. That trade is the reason for this rule.
     **Answered by the owner, 2026-10-15** (gate 1 asked "Which reading?";
     options "Confirm build, reword" and "Literal: return the 16 blocks to the
     base wait"; chosen: the first): a negative test is one that expects no
     stream or an error. A test that expects a stream and also asserts that
     something was not pressed or not requested may take the short wait. The
     presses happen during provocation, which ends before the quiet wait, and
     every request these fixtures make on a press is made on the click itself.
     This is also what Done when 2 means by "negative".
   - Choose a value at or above the 200 ms tick of the wait loop, and measure
     that the overlay revisit (`browser.ts:399–408`, first at least 1 s in)
     still runs in every test that depends on it.
3. **Remove the dead `quietMs: 1200`** from tests where it changes nothing. Or,
   if the value documents intent, replace it with the option that actually
   holds the wait. Leave the one `quietMs: 6000` test alone (the late modal at
   about line 535).
4. **No-media tests:** the audit found that shorter `emptyMinWaitMs` and
   `quietMs` values could save about 14 s. The `NO_EMPTY_FLOOR_MS` comment in
   the test file says the base rule is kept on purpose. **Do not change it**:
   the owner's rule is that shorter waits go only in tests that expect a stream.

## Done when

1. A test pins `minWaitMs`'s default at 1200, and production callers pass
   nothing new.
2. Every test given a shorter `minWaitMs` expects a stream. The Log lists them
   and shows no negative test among them.
3. Before and after durations for the browser suites are in the Log, and
   `npm test -- --project downloader` passes three times in a row locally. It
   should also pass on the Windows leg.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 0.9 s on
  each of about 40 or more stream-expecting tests across the browser files,
  about 35 s or more in total (inferred). Considered and not filed:
  - **Skipping `settle` once the probe has left the page.** `settle` runs
    before the departure check (`browser.ts:411–435`) and departure discards
    every hit, so the skip would save up to 3 s per departed probe in
    production too. It is a production behaviour change, which the owner's
    "defaults unchanged" rule excludes.

- 2026-10-15 — Built on branch `dl-115` from `8e49523c`. Code and tests are in
  `cdf2e58e`.
  - **What changed.** `BrowserResolverOptions.minWaitMs` (default
    `MIN_WAIT_MS`, now exported) is passed to `waitForQuiet` where the constant
    was. `api` and every production caller pass nothing new. The tests take the
    pair `STREAM_WAITS = { quietMs: 200, minWaitMs: 200 }` from
    `test/browser/helpers/stream-waits.ts`.
  - **What the brief had wrong.**
    - Its cites pointed at the wrong lines and a path that does not exist as
      written: `provoke.ts:1838` is `:1893`, `browser.ts:384` is `:394`, the
      overlay revisit `389–398` is `399–408`, and `settle` through the
      departure check `402–425` is `411–435`. `:66`, `:115` and `:150` were
      right. All are corrected above, with the full paths.
    - Build 3 says to remove the dead `quietMs: 1200`. Removed, `quietMs`
      falls back to its default of 2500 and the wait gets longer. Worse, once
      `minWaitMs` is short, a `quietMs` of 1200 is what holds the wait (the last
      request is 900 ms old when it starts, so it ends at the next 200 ms tick
      after 1200 ms of silence), which gives back most of the saving. So the
      stream tests take both values at 200, and the negative tests keep
      `quietMs: 1200` as before.
    - `minWaitMs` only governs once a playable hit is captured; until then
      `emptyMinWaitMs` does. The overlay revisit runs only while nothing is
      captured, so it rides on `emptyMinWaitMs`, which no test changed.
  - **Tests given the shorter wait.** All of them assert a stream (a
    `variants[0]` URL, or a count of variants) or, where noted, that a probe
    carried on to the stream. By file, `test` blocks, with `test.each` tables
    counted as one:
    - `browser-resolver.test.ts` (51 blocks): the MSE, consent-banner HLS,
      DASH, iframe, throwing-parser and real-parser tests; both dl-55 chooser
      tests that start the real player; the fragment-only, script-redirect,
      `replaceState`, redirect-then-fragment and `?t=` tests; the cross-origin
      card; the age-gate close and Escape tests; in the dl-83 blocks the
      Italian gate told to confirm, the three exit-link rows, the shadow-root
      and decoy rows, the "never presses ... and finds the stream" and "presses
      nothing ... and finds the stream" rows, the cookie-sheet and age-button
      residue tests, and the gate-built-as-a-link rows that expect a stream;
      the stage-narration test with the stream; the shadow-root player tests
      (four); the untyped-playlist, "Sono d'accordo" and cookie-strip tests;
      three tests of the dl-82 gate 2 block that expect a stream; the dl-80
      delayed-player test; in the dl-81 block the first-wheel, header-nudge,
      box-click, poster-grid delay rows, autostart, billboard and three
      cross-origin frame tests; in the dl-100 block `ctl=autoplay` and the
      cross-site Play press; the dl-78 ranged progressive file; and the dl-111
      abandoned body.
    - `consent-scope.test.ts`: the `r5`, `r7` and `r9` rows, the ones that
      assert a stream.
    - `chunk-streams.test.ts`: the gallery test. The file's `MIN_WAIT_MS` was a
      comment; it now says "default `minWaitMs`", and the one probe that expects
      a stream takes the pair.
  - **No negative test among them.** Every builder that serves both kinds
    (`confirming()` in both dl-83 blocks, `press()`, both `resolverWith()`,
    `visit()`, `resolver()`) defaults to `{ quietMs: 1200 }`; only a call that
    expects a stream passes `STREAM_WAITS`, in the dl-81 and dl-100 blocks by
    way of `streamingWith()`. The `NO_MEDIA_FOUND`, `AGE_CONFIRMATION_REQUIRED`,
    `DRM_PROTECTED`, `BOT_CHALLENGE` and `AUTH_REQUIRED` tests, and every test
    that expects no stream, are untouched. A test that expects a stream and also
    asserts that something was not pressed or not requested does take the short
    wait (16 blocks by gate 1's count: the "never presses %s ... and finds the stream" and
    "presses nothing on %s, and finds the stream" tables, the decoy, exit, card,
    billboard and ad-frame tests); that reading is the owner's answer recorded
    in the round 1 entry below. Also untouched: `emptyMinWaitMs`, `NO_EMPTY_FLOOR_MS`, the late
    modal's `quietMs: 6000` and the dl-105 floor test.
  - **Pinned default.** A new block at the end of `browser-resolver.test.ts`
    ("the quiet wait's minimum can be set, and defaults to 1200 ms"): the
    exported `MIN_WAIT_MS` is 1200, a resolver given no `minWaitMs` holds the
    wait at least that long and under 3200 ms, and `minWaitMs: 200` holds it
    under 1200 ms. The wait is timed from the `network-quiet` stage to
    `settle-requests` on `performance.now()`. Each of three mutations failed
    exactly the test meant for it:
    - the constant at 900: `expected 900 to be 1200` (the "default is 1200 ms"
      test only);
    - the constructor default at `600`: `expected 605.07 to be greater than or
equal to 1200`;
    - the option ignored: `expected 1223.23 to be less than 1200`.
  - **Before and after**, `npx vitest run --project downloader --reporter=verbose
tools/downloader/resolvers/test/browser/` (15 files, 758 tests before, 761
    after), two pairs, each on the same machine in turn:

    | Run                 | Wall    | Summed test time | `browser-resolver.test.ts` |
    | ------------------- | ------- | ---------------- | -------------------------- |
    | before, first pair  | 366.1 s | 438.6 s          | 363.9 s over 120 tests     |
    | after, first pair   | 296.8 s | 371.2 s          | 289.6 s over 120 tests     |
    | before, second pair | 360.5 s | 431.0 s          | 357.9 s over 120 tests     |
    | after, second pair  | 300.4 s | 376.5 s          | 290.2 s over 120 tests     |

    That is about 70 s of summed test time and 60 s of wall time, against the
    35 s the brief estimated. A typical stream test fell from about 2.8 s to
    about 1.8 s. `consent-scope.test.ts` fell 1 to 2 s (two rows) and
    `chunk-streams.test.ts` did not move beyond noise (one row, 9.1 s against
    9.6 s over its three tests). The first "before" run overlapped a
    13 s `npm run format` and the first edits to two unrelated files, so the
    second pair is the cleaner one. Single tests move by up to a second
    between runs (`reports BOT_CHALLENGE`, which no edit touched, read 795 ms
    lower in the first "after").

  - **The overlay revisit still runs where it did.** A temporary line in
    `revisit()` (not committed) wrote the page of each revisit to a file during
    a full run of the directory, old test files against new. 51 revisits before,
    52 after, on the same 43 pages; the extra one is a second visit to
    `/age-gate-overlay.html?shadow` (two tests probe it, one told to confirm). No
    test lost one.
  - **`npm test -- --project downloader`, three in a row**, through the test
    gate, on `cdf2e58e` (the later commits change a ticket file only): each
    `Test Files 119 passed | 1 skipped (120)`, `Tests 2564 passed | 2 skipped
(2566)`, exit 0, at 304.4 s, 302.6 s and 299.4 s. The Windows leg is not
    measured here; the pull request's own run is the reading.
  - **Folded in, or not.** Nothing else was free. The hand-written `1200` in
    `consent-scope.test.ts`'s `emptyMinWaitMs` and the `quietMs: 1200` in the
    negative tests are the same number as the default and say so by being
    identical; making them reach for `MIN_WAIT_MS` would only widen the diff
    that dl-117 is about to move.

- 2026-10-15 — Round 1, after gate 1 (Opus 5.5, `dd8b5c8e`: CONCERNS).
  - **Owner's answers, 2026-10-15.** Med, "Which reading?" of Build 2's
    "negative tests", options "Confirm build, reword" and "Literal: return the
    16 blocks to the base wait": **Confirm build, reword.** It is recorded at
    Build 2 above. The reworded text is the `BASE_WAITS` comment in
    `browser-resolver.test.ts` and the "No negative test among them" bullet of
    the entry above. Lows, "Fold both in?", options "Fold both in", "Count only"
    and "Neither": **Fold both in.**
  - **Count.** 49 blocks was a miscount of my own list: it names 50 for
    `browser-resolver.test.ts`, and the dl-78 progressive-file test takes the pair
    through its `probeFile` helper, where the list did not look. That is 51, as
    the gate counted; corrected above.
  - **The default pin, tightened rather than retitled.** The test now reads what
    the resolver hands `waitForQuiet`: `browser-resolver.test.ts` wraps
    `waitForQuiet` in a pass-through `vi.mock` that records `minWaitMs`, and
    "a resolver given no minWaitMs hands the wait MIN_WAIT_MS, and holds it that
    long" asserts it is exactly `MIN_WAIT_MS` (and still that the wait is at
    least that, under 3200 ms). "a minWaitMs below it shortens the wait" asserts
    200 is handed and the wait is under 1200 ms. Exact equality was chosen over a
    tighter timing bound because the bound is load-sensitive: I first tightened
    the upper bound to `MIN_WAIT_MS + 600`, and the first run of five measured
    `4055 ms` for the wait (cause not established; load average was 2.6 from other
    sessions), failing it. The next four runs passed. The old `+ 2000` bound would
    have failed on 4055 too.
  - **Mutants, `npx vitest run ... -t "quiet wait's minimum"`.** The finding's
    `options.minWaitMs ?? 2400` is now red, in "hands the wait MIN_WAIT_MS" only:
    `AssertionError: expected 2400 ...` against 1200. Before the change it passed
    all three. The option ignored (`this.#minWaitMs = MIN_WAIT_MS`) fails
    "a minWaitMs below it shortens the wait" with `expected 1200 ...`. Both were
    restored from `d98d8799`.
