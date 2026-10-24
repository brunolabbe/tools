---
id: dl-118
tool: downloader
title: The three dl-83 accepted-residue rows spend about 11 s each in provoke-playback
kind: chore
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-118 — Three age-gate rows spend about 11 s each in provoke-playback

## Why

This came out of the 2026-10-12 suite-speed audit, found while building
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).
The owner chose, on 2026-10-12, to file it rather than widen dl-111 into
production provocation code.

Three rows in `resolvers/test/browser/browser-resolver.test.ts`, the
"accepted residue" `test.each` under "false candidates and the press, as gate
round 1 measured them (dl-83)", take 10.8 to 13.0 s each, against about 2.8 s
for a normal probe. Together that is about 36 s of a file that CI times at
620 s:

- `age-false-cookie-sheet-closable.html` — 12.8 to 13.0 s
- `age-false-cookie-sheet-sticky.html` — 12.8 to 13.0 s
- `age-false-shell-menu-button.html` — 10.8 s

It is not a stalled body: nothing in the row asks for a manifest. Their
`server.requests` hold the page and one or two beacons and nothing else
(`/beacon/accept` and `/beacon/view-partners`, or `/beacon/nav-18`), and the
tests assert `/beacon/play` never fires.

## Reproduction

Gate 1 of dl-111 wrote the script below and ran it first: about 11 s inside
`provoke-playback` and 12 ms in `settle`. The builder of dl-111 re-ran it on
2026-10-12 on `origin/main` plus the dl-111 fixtures (which change none of these
pages). Run it from a worktree with `node --import tsx stages.mts <worktree
root> <page path> 1`; each stage's number is the millisecond offset at which
that stage began, and the last stage ends at the total.

```ts
// stages.mts — probes one fixture page with the dl-83 confirming() settings.
const [tree, pathname, confirm = "1"] = process.argv.slice(2);
const base = `${tree}/tools/downloader/resolvers`;
const { BrowserPool } = await import(`${base}/src/browser/pool.ts`);
const { BrowserResolver } = await import(`${base}/src/resolvers/browser.ts`);
const { recordingHlsParser } = await import(`${base}/test/browser/helpers/fake-parsers.ts`);
const { startFixtureServer } = await import(`${base}/test/browser/helpers/fixture-server.ts`);

const server = await startFixtureServer();
const pool = new BrowserPool({ maxConcurrent: 1, headless: true });
try {
  const resolver = new BrowserResolver({
    pool,
    hlsParser: recordingHlsParser().parser,
    quietMs: 1200,
    confirmAge: confirm === "1",
    emptyMinWaitMs: 1200,
  });
  const t0 = performance.now();
  const marks: string[] = [];
  let outcome = "ok";
  try {
    await resolver.resolve(new URL(server.url(pathname)), {
      timeoutMs: 25_000,
      signal: new AbortController().signal,
      onStage: (e: { stage: string }) =>
        marks.push(`${Math.round(performance.now() - t0)} ${e.stage}`),
    });
  } catch (error) {
    outcome = `error ${(error as { code?: string }).code}`;
  }
  process.stdout.write(
    `${Math.round(performance.now() - t0)} ms, ${outcome}\n  ${marks.join("\n  ")}\n  requests: ${server.requests.join(" ")}\n`,
  );
} finally {
  await pool.close();
  await server.close();
}
```

Output from one run of the script above, by the dl-111 builder:

```
/age-false-cookie-sheet-sticky.html
12971 ms, error NO_MEDIA_FOUND
  0 browser-launch / 112 page-load / 634 provoke-playback
  11752 network-quiet / 12959 settle-requests
  requests: /age-false-cookie-sheet-sticky.html /beacon/accept /beacon/view-partners
/age-false-cookie-sheet-closable.html
12969 ms, error NO_MEDIA_FOUND
  0 browser-launch / 99 page-load / 620 provoke-playback
  11749 network-quiet / 12958 settle-requests
  requests: /age-false-cookie-sheet-closable.html /beacon/accept /beacon/view-partners
/age-false-shell-menu-button.html
10899 ms, error NO_MEDIA_FOUND
  0 browser-launch / 99 page-load / 622 provoke-playback
  9679 network-quiet / 10886 settle-requests
  requests: /age-false-shell-menu-button.html /beacon/nav-18
control, /age-false-shell-link.html (same suite, same settings)
2860 ms, ok
  0 browser-launch / 91 page-load / 622 provoke-playback
  1641 network-quiet / 2842 settle-requests / 2845 manifest-fetch
  requests: ... /media/mse/master.m3u8 /media/mse/v1080.m3u8 /media/mse/init.mp4 ...
```

`provoke-playback` runs from about 620 ms to 11.7 s (11.1 s) on the two
cookie-sheet rows and to 9.7 s (9.1 s) on the menu-button row; the control page's
`provoke-playback` is 1.0 s. `network-quiet` is the 1.2 s `quietMs` and
`settle-requests` is about 12 ms, so the time is neither the wait nor the cap.

**Not measured:** where inside `provoke-playback` the 9 to 11 s goes. The
suspicion, untimed, is clicks that a covering layer blocks, each waiting out
Playwright's 1500 to 2000 ms action timeout. Five sites were first suspected
(`provoke.ts:1552`, `:1573`, `:1674`, `:1753`, `:1771`; gate 1 of dl-111 named
no lines, so they are not its). Three of them cannot be the cause: `:1552` and
`:1573` in `clickChosenVideo` and `:1674` in `clickPlayerBox` are `force: true`
clicks, which skip Playwright's actionability wait, so a covering layer cannot
make them sit out their timeout. The blockable clicks in this path are `provokeFrame`'s `clickVisible(…, PLAY_SELECTORS,
{ timeoutMs: 2000, max: 3 })` (`:1771`, cited) and `clickByText(frame,
PLAY_TEXT, 2000)` (`:1775`, not cited); `:1753` is the `dismissModal` call,
which this note did not examine. That is step 1 below.

## Build

1. **Find the time.** Time each step of `provokePlayback` on the three pages
   (the clicks, the dismiss, the age press, the scroll) and name the ones that
   add up to 9 to 11 s. Paste the timing in the Log.
2. **Decide what the rows need.** The rows pin that a false age candidate is
   pressed where play is a click and that nothing plays. If the wait is a blocked
   click's action timeout, the options are a shorter timeout on a click that is
   expected to be blocked, or checking that the target is covered before clicking
   it. Either changes production provocation code, which dl-111 deliberately did
   not: pick one with the timing in hand, and change no default behaviour a real
   page can see (the owner's rule for the audit: a timing option may be added only
   with its default unchanged).
3. If the time is not removable without changing what the rows prove, say so in
   the Log and close the ticket with the measurement.

## Done when

1. The Log holds the per-step timing for the three pages.
2. Either the three rows drop below 5 s each with the same assertions, or the Log
   says which assertion the time buys.
3. `npm test -- --project downloader` passes.

## Review

**Gate: PASS** — 2026-10-12 · `d759b80e..53509ff7` · Opus 5.5, depth standard

| Done when                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The Log holds the per-step timing for the three pages       | **verified**: the Log's step-1 table lists five blocked clicks on each cookie-sheet page and four on the menu-button page. Checked by a second method: the brief's `stages.mts` under `DEBUG=pw:api` on `/age-false-cookie-sheet-sticky.html` shows five `locator.click failed` of 2000 ms each, and `provoke-playback` running 605 → 11696 ms uncapped                                                                                                                                                                                                                          |
| 2. The three rows drop below 5 s each with the same assertions | **verified**: the diff changes only the resolver construction (`confirming(BLOCKED_CLICK_MS)`) and a comment, so the three assertions are unchanged. Across 12 local runs, several under 4 concurrent copies, 12 CPU burners or `taskset` to 2 CPUs with 4 burners, the rows took: closable 4513–4876 ms, sticky 4408–4601 ms, menu button 3989–4168 ms. On PR #447 at this head, `test (ubuntu-latest)` measured 4369 / 4361 / 3977 ms and `test (windows-latest, informational)` 4395 / 4406 / 4024 ms. Nothing asserts the 5 s, so this verdict holds only for the runs above |
| 3. `npm test -- --project downloader` passes                   | **verified**: 2460 passed, 2 skipped (2462 tests); 114 files passed, 1 skipped (115); 536 s, run beside the row-timing load above. `test (ubuntu-latest)` passes on #447 at this head                                                                                                                                                                                                                                                                                                                                                                                            |

The rows still prove what their names say at the 300 ms cap. Each regression below was planted on the detached tree and then restored:

- With the age press removed from `provokeFrame`, all 3 rows fail (`expected undefined to be an instance of AppError`: the stream is found).
- With play pressed through the cover by `dispatchEvent("click")`, all 3 rows fail.
- With the menu cover clearing itself 1000 ms after the press, the menu-button row fails.

The new cap test can fail. With `cappedTimeout` made to ignore the cap, `provoke.test.ts` › "four blocked play clicks cost 4 x the cap, not 4 x 2000 ms" fails with `expected 9303 to be less than 5000`. At head it takes 2036–2511 ms.

- **low** · no live call site · `cappedTimeout` in `resolvers/src/browser/provoke.ts` passes `0` and `NaN` through to Playwright. Playwright reads a timeout of 0 or NaN as "no timeout", so the cap removes the bound instead of lowering it. Both `clickTimeoutMs` doc comments call the option "an upper bound". A negative cap makes every consent and play click fail at once. A value above 2000 is clamped to 2000, which is correct. Reproduction: `node --import tsx edge.mts <tree>` clicks a button under a fixed cover:
  - `cap=0 -> timeout 0: 6001 ms, STILL WAITING at 6000 ms`
  - `cap=NaN -> timeout NaN: 6000 ms, STILL WAITING`
  - `cap=-1 -> timeout -1: 2 ms, Timeout -1ms exceeded`
  - `cap=5000 -> timeout 2000: 2001 ms`
  - `cap=undefined -> 2004 ms`

  End to end, `stages.mts <tree> 0 /age-false-shell-menu-button.html` returns `28041 ms, error TIMEOUT` where the uncapped run returns `NO_MEDIA_FOUND` in 10.8 s. The only callers pass 300 and 200, and `api/src/resolvers.ts` never sets the option. Remedy: treat a non-finite or non-positive cap as unset.

- **low** · `nfr:maintainability` · the consent click's cap is not tested. Restoring `dismissConsent(frame, 2000, scriptable)` alone leaves the cap test and all 3 rows green, while the cookie-sheet rows slow to 6254 and 6215 ms, above Done when 2's 5 s. Done when 2 is met at this head; this is the missing guard that would keep it met. Remedy: run the cap test on a cookie-sheet page as well.
- **low** · `nfr:maintainability` · no test checks that the uncapped wait is still 2000 ms. With `cappedTimeout` planted to `Math.min(timeoutMs, cap ?? 300)`, a 300 ms cap for every caller, all 757 of 757 tests in `npx vitest run tools/downloader/resolvers/test/browser` stay green. The `2000` literal it replaces was never pinned either. Exporting `cappedTimeout` and unit-testing `undefined`, `0`, `NaN`, a negative value and 5000 would cover this finding and the first one.
- **low** · the cap test's title, "four blocked play clicks cost 4 x the cap", claims more than it asserts. The assertion is a 5000 ms ceiling, which proves the cap shortens the run (see the control above). It does not prove the cost is four times the cap.
- **dropped** · the suspicion that the rows' 0.5 s margin under 5 s fails on CI. CI measured all three rows under 4.41 s on both legs at this head. The worst local reading, under contention, was 4876 ms. Most of a row's time is fixed waits (`quietMs` 1200, the empty floor 1200, the 900 ms sleep between passes, five 300 ms caps), so CPU load moves it by about 0.3 s. No test asserts the 5 s, so CI cannot go red on it either way.
- **findings** · the hunt returned 5; 4 carried, 1 dropped.
- Scope: provoke.ts's hunks touch neither `isPlayPress` nor `startsWord`. All four hunks in `browser-resolver.test.ts` fall inside the "false candidates and the press … (dl-83)" block. `confirming()` with no argument passes no cap, so the other rows in that block are unchanged. dl-113 and dl-114 have no open pull request, so the merge with them was not measured.
- Default unchanged:
  - On the code: modal close 1500 and age press 2000 are literal in `provokeFrame` and `revisitOverlays` on every path; only the consent, play-selector and play-text sites read `blockable`.
  - Measured: uncapped `stages.mts` on the three pages gives 13001, 12915 and 10774 ms, matching the brief's 12969, 12971 and 10899.
  - `api/src/resolvers.ts` never sets the option.
- Invariants: no cross-tool import, no new throw, no spawn, no new log line, no URL handling, contract untouched, no new package or test registration, no new dependency. Style is clean, and `npm run check` exits 0. Not applicable: routes, progress, Dockerfile.
- F9 in `engine/test/parallel-ranges.test.ts` did not fail in this gate's full run. It is not graded against this branch.
- NFR: security n/a · performance ✓ (rows 12.9/12.9/10.8 s down to 4.4/4.4/4.0 s on this box) · reliability: the 0/NaN cap above, otherwise ✓ · maintainability: above.

## Log

- 2026-10-12 — Filed from dl-111's round 2. The reproduction is gate 1's script,
  re-run by dl-111's builder, with the numbers above. Difficulty is `standard`
  on the builder's judgement: step 1 is measurement, but step 2 touches
  production provocation code and needs a call on which clicks may wait less.
- 2026-10-12 — Step 1 done (builder, on `origin/main` d759b80e). **Every
  second is a click that a covering layer blocks and Playwright retries until the
  click's own timeout.** Method: the reproduction's `stages.mts` run with
  `DEBUG=pw:api`, which stamps each Playwright call; calls over 100 ms,
  `offset ms (from launch) + duration`, all `locator.click failed`:

  | page                  | blocked click (offset, wait)                                                                                               | sum    | `provoke-playback` | total |
  | --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------ | ----- |
  | cookie-sheet-sticky   | 787 +2002 play selector · 2792 +2001 play text · 5712 +2000 consent text · 7738 +2000 play selector · 9740 +2001 play text | 10.0 s | 623 → 11754 ms     | 12976 |
  | cookie-sheet-closable | 789 +2003 · 2796 +2001 · 5718 +2000 · 7746 +2001 · 9750 +2001 (same five)                                                  | 10.0 s | 629 → 11768 ms     | 12990 |
  | shell-menu-button     | 752 +2002 play selector · 2757 +2064 play text · 5801 +2001 play selector · 7804 +1999 play text                           | 8.1 s  | 635 → 9754 ms      | 10974 |

  The sites: the play-selector wait is `provokeFrame`'s
  `clickVisible(frame, PLAY_SELECTORS, { timeoutMs: 2000 })` (`provoke.ts:1770`),
  the play-text wait `clickByText(frame, PLAY_TEXT, 2000)` (`:1775`), both once
  per pass; the third wait on the cookie rows is pass 1's own age press opening
  `#vendors` over the sheet, so pass 2's `dismissConsent(frame, 2000, …)`
  (`:1754` → `clickByTextIn`, `:1320`) cannot reach "Accept All Cookies". The log
  says `<div id="vendors">…</div> intercepts pointer events` (or `#menu`) on every
  retry, with Playwright's 20, 100, 100, 500, 500, … ms back-off. The remainder of
  `provoke-playback` is the fixed `sleep(900)` between the passes (`:1835`) and
  about 0.2 s of calls. `dismissModal` (`:1753`) is 6 ms plus a 2 ms Escape,
  `confirmAgeGate` 33 ms including the click, the scroll 1 ms, the first
  consent click 52 ms, `isPlayPress`'s five `getAttribute` calls 20 ms together:
  none of them waits. `:1552`, `:1573`, `:1674` do not appear at all.
  `isPlayPress`/`startsWord` hold none of the time, so dl-114 is not affected.
  Stopped here for the call in Build step 2 (a new option in production
  provocation code).

- 2026-10-12 — Step 2 decided by the owner, relayed by the orchestrator, from
  four options: **A**, an optional `clickTimeoutMs` cap, unset by default, the
  three rows passing 300 ms (chosen; the builder's recommendation); **B**, a
  hit-test that skips covered targets (changes what a real page sees, as a
  fading banner would be skipped); **C**, `test.concurrent` on the rows (the
  fixture server's `requests` array is shared and `/beacon/view-partners` is
  common to two rows); **D**, close with the measurement only. Built as A:
  `BrowserResolverOptions.clickTimeoutMs` -> `provokePlayback` ->
  `provokeFrame`, where `cappedTimeout(2000, cap)` replaces the literal on the
  consent click (`dismissConsent`), the play-selector click and the play-text
  click. `dismissModal` (1500) and the age press (2000) keep their own timeouts:
  the press has to land, and 300 ms on a loaded runner might not be enough for
  Playwright's stable check. `isPlayPress`/`startsWord` untouched.
  - Default unchanged: the same `stages.mts` run on the changed code, no cap,
    `/age-false-shell-menu-button.html` — `10925 ms, error NO_MEDIA_FOUND`, four
    `locator.click failed` of 2004, 2000, 1999 and 2066 ms (10974 ms before).
  - Rows, `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts
    -t "accepted residue: .* is pressed where play is a click"`, 3 passed of 183:
    closable 4546 ms (was 12.8 to 13.0 s), sticky 4489 ms (was 12.8 to 13.0 s),
    menu button 4125 ms (was 10.8 s). Same three assertions. The margin under
    5 s is about 0.5 s, so a runner slower than this one may see a row above it;
    the floor is the 2.9 s a clean probe costs here.
  - The cap itself, `provoke.test.ts` "clickTimeoutMs caps the clicks a covering
    layer blocks (dl-118)": one page, four blocked play clicks, `clickTimeoutMs:
    200`, finishes in under 5 s where the uncapped run above takes 8 s of waits.

- 2026-10-12 — **Gate 1's four lows, _fixed at landing_, by the owner's choice**
  (asked: "Land it how?"; options: "lander applies all four (recommended)",
  "apply lows 1 and 3 only", "land as is"; chosen: the lander applies all four,
  with no re-gate). Commit `dd639f8c`, on top of the gated head `53509ff7`. The
  cap test in the builder's entry above ("one page, four blocked play clicks,
  under 5 s") is superseded by items 2 and 4 below. Each guard was shown red
  against the code it guards, from this worktree:
  1. _`cappedTimeout` passed a cap of 0 or NaN through, which Playwright reads as
     no timeout_ (and a negative cap fails every click at once). It now treats a
     cap that is not a positive finite number as unset, and stays an upper bound
     only; it is exported, and the option's two doc comments say so. Guarded by
     `cappedTimeout (dl-118)` in `provoke.test.ts`, seven rows: unset, 300, 5000,
     0, NaN, -1, Infinity. With the body put back to
     `cap === undefined ? timeoutMs : Math.min(timeoutMs, cap)`,
     `npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
     cappedTimeout`:
     `× a cap of '0'` (`expected +0 to be 2000`), `× 'NaN'` (`expected NaN to be
     2000`), `× 'negative'` (`expected -1 to be 2000`), `Tests  3 failed | 4
     passed | 234 skipped (241)`.
  2. _The consent click's cap was untested._ The cap test is now a `test.each`
     over the menu page and both cookie-sheet pages. With `dismissConsent(frame,
     2000, scriptable)` restored in `provokeFrame` and nothing else changed, the
     same command with `-t "dl-118"`:
     `✓ a shell's 18+ menu button … 2028ms`, `× … closable panel … 4022ms`
     (`expected 4020 to be less than 3000`), `× … sticky panel … 3929ms`
     (`expected 3927 to be less than 3000`), `Tests  2 failed | 8 passed | 231
     skipped (241)`. With the fix in place the three rows ran 2011, 2213 and 2155 ms,
     all green. The menu page does not move, which is why the cookie sheets are rows: the
     ceiling sits between about 2.2 s capped and about 4 s with the consent click
     alone uncapped.
  3. _No test checked that the uncapped wait is still 2000 ms._ The same seven
     rows: `unset -> 2000` and `5000 -> 2000`. With the body planted as
     `Math.min(timeoutMs, cap ?? 300)`: `× a cap of 'unset'` (`expected 300 to be
     2000`) and the three non-positive rows, `Tests  4 failed | 3 passed | 234
     skipped (241)`.
  4. _The cap test's title claimed 4 x the cap._ It now reads "the blocked clicks
     wait for the cap, not 2000 ms", and its comment says the ceiling shows the cap
     shortened the run and is not a count of the clicks.

  After the fixes, with the fix in place: `npx vitest run
  tools/downloader/resolvers/test/browser/provoke.test.ts`: `Tests  241 passed
  (241)`; `npx vitest run
  tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "accepted
  residue"`: `Tests  5 passed | 178 skipped (183)`, the three rows at 4387 ms
  (closable), 4368 ms (sticky) and 4015 ms (menu button), under Done when 2's 5 s.
  `provoke.ts` and `browser.ts` change only `cappedTimeout` and two doc comments;
  `isPlayPress`, `startsWord` and the dl-83 block of `browser-resolver.test.ts`
  are untouched by this commit.
