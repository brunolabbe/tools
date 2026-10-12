---
id: dl-111
tool: downloader
title: Browser fixtures that fetch a manifest and never read its body stall every probe on the 3 s settle cap
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-111 — Browser fixtures that never read a fetched body stall each probe 3 s

## Why

CI's unit-test job runs for about 11.5 minutes, and `npm test` takes 620 s of
it on `ubuntu-latest`. Of that, 620 s is
`resolvers/test/browser/browser-resolver.test.ts`, whose 177 tests run serially
in one file (run 38203804906, 2026-10-12). On 2026-10-12 the owner asked for the
suite to be made faster by **testing the same thing more cheaply, not by adding
CPU**, because an orchestrator runs several reviewers on one machine at once.
This is the first of the tickets that came out of that audit (dl-111 to dl-117,
repo-99, repo-100).

The cheapest saving is a fixture defect, and it changes no production code.
Some fixture pages `fetch()` a manifest and never read the response. The
collector's body read for that request never completes, so
`collector.settle(Math.min(SETTLE_TIMEOUT_MS, …))` (`browser.ts:403`) waits
out its full 3000 ms cap (`SETTLE_TIMEOUT_MS`, `browser.ts:86`). The fixture
server sends `cache-control: no-store` (`helpers/fixture-server.ts:276`).

**Reproduced during the audit**, with scratch copies of the pages:

- `guard-fragment.html` as served: 5997 and 5866 ms. With the body read: 2942
  and 2868 ms.
- `shadow-player.html`: 5739 → 2801 ms.
- `cross-origin-shadow.html`: → 2802 ms.
- `cross-origin-scroll-player.html`: → 2781 ms.

None of the affected tests is about the cap. `sniff.test.ts:309` already tests
the abandoned-body cap without a browser.

## Build

1. **Find every fixture with an unread fetch.** Do not trust this list; time the
   tests. The CI per-test durations put the affected tests at about 5.7 to 6.0 s,
   against about 2.8 s for a normal probe. The tests seen there:
   - `browser-resolver.test.ts`
     - dl-55: same-origin iframe, related card, largest candidate, pushState
       departure, fragment only, script redirect, router replaceState, landing
       URL, the three `?t=`/`?start=`/`?autoplay=` rows, reordered query,
       cross-origin card.
     - dl-48: Escape.
     - dl-61 and dl-68: all four shadow-player tests.
     - dl-100: box click only, billboard, cross-origin scroll, cross-origin
       `play()`.
   - **Pages named as suspects:** `iframe-player.html` (lines 23–25),
     `guard-*.html`, `modal-escape.html` (51–53), `related-card*.html`,
     `cross-origin-card-inner.html`, `shadow-player*.html`,
     `player-box-click-only.html`, `player-box-billboard.html`,
     `xo-play-only-inner.html` and `xo-scroll-player-inner.html:24`. Also check
     the fixtures used by `consent-scope`, `chunk-streams`, `manifest-refetch`
     and `size-probe-behind-the-proxy`.
2. **Make each such page read what it fetches** (`await r.text()`, or
   `arrayBuffer()` for binary). Change nothing else about the page: the delay,
   the player and the request order are what the tests prove.
3. **Keep one test that abandons a body on purpose**, at resolver level, so the
   end-to-end path through `settle()`'s cap is still exercised by one browser
   test. Use a fixture named for it, and have the test assert that the probe
   still answers. Do not assert a timing.
4. **Do not drop `no-store`** from the fixture server. Inside one probe, a
   browser cache could hide repeated requests from `server.requests`, and several
   assertions count those (inferred by the audit).

## Done when

1. No test that drives Chromium, other than the abandoned-body one, reaches
   `settle()`'s cap. Proof: a throw planted at the cap, run over
   `resolvers/test/browser`, fails that test and the two `sniff.test.ts` rows
   that pin the cap with fake responses and no browser, and nothing else (3 of
   756; output in the Log); the before and after per-test durations for every
   fixture changed are in the Log as well. _(Reworded in round 2, 2026-10-12;
   the first wording was "no browser test that is not about the settle cap
   takes 3 s more than the baseline probe", which six tests that wait on
   purpose or in provocation fail. See the Log. Narrowed again after gate 2 to
   match the measurement: the directory holds tests that do not drive Chromium,
   and the planted throw also fails two of them.)_
2. Exactly one test that drives Chromium exercises an abandoned body on
   purpose, and its name says so.
3. `npm test -- --project downloader` passes, and every test this changes still
   asserts what it asserted before.

## Review

**Gate: CONCERNS** — 2026-10-12 · `bb4d2044..e2239132` · Opus 5.5, depth medium

| Done when                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. No browser test that is not about the settle cap takes 3 s more than the baseline probe; before/after durations in the Log | **unproven (open decision)** — the mechanism is verified: with `HitCollector.settle` in `resolvers/src/browser/intercept.ts` planted to throw whenever its cap fires, 1 test of 221 in `resolvers/test/browser` (`browser-resolver`, `consent-scope`, `chunk-streams`) and 0 of 26 in the four `api` suites that build a real `BrowserResolver` reach it, and that one is the new test. All 24 tests on the 19 changed pages ran 1.58–3.09 s at the head against a 2775 ms median probe time, and the Log's table covers every changed page. But the line is false as worded for 6 tests that the build did not touch. Two facts contradict each other. (a) dl-48 "meets a modal and a gate that mount after the playback passes are over" (10.8 s, `quietMs: 6000` against `?late=3500`) and dl-80's two floor tests (10.5 s and 7.4 s, `emptyMinWaitMs: 9000`; one asserts `elapsedMs >= 9000`) wait on purpose, so no build can meet the literal line. (b) dl-83's three "accepted residue: … is pressed where play is a click, and nothing plays" rows (12.8, 12.8 and 10.8 s) name no wait in their code. Their time is spent in `provoke-playback` (0.6 → 11.8 s), and `settle-requests` takes 12 ms, so it is not the defect this ticket fixes |
| 2. Exactly one browser test exercises an abandoned body on purpose, and its name says so                                      | `resolvers/test/browser/browser-resolver.test.ts` › "a body the page never reads is abandoned at settle()'s cap, and the probe still answers" ✓. Its `variants[0].url` assertion goes red when the cap is removed (TIMEOUT, "The page analysis exceeded its time budget.", 28013 ms). The "exactly one" clause rests on the same planted throw: only this test reaches the cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3. `npm test -- --project downloader` passes, and every changed test asserts what it asserted before                          | first clause: `test (ubuntu-latest)` passed on `e2239132` (PR #439; it runs every project). Second clause **verified**: the test file's diff is 18 insertions and 0 deletions. Production mutants still turn the changed-page tests red at the head: dl-81 (no centre click: click-only box and billboard, 2 of 2 red), dl-55 (hash compared: fragment-only and landing URL, 2 of 2 red; query compared unsorted: reordered query, 1 of 1 red) and dl-61/dl-68 (media walk stops at shadow roots: 4 of 5 red; the fifth is the card test, see dropped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- **med** · `Done when 1` depends on it · **open decision**: the line, read literally, is not met by 6 tests outside the ticket's scope. 3 of them (dl-83 residue) are not deliberate waits. Reproduction: run `node --import tsx stages.mts <tree> /age-false-cookie-sheet-sticky.html` (scratch script: `BrowserResolver` with dl-83's `confirming()` settings and `onStage` offsets). It prints `browser-launch 0 · page-load 193 · provoke-playback 725 · network-quiet 11856 · settle-requests 13064`, total 13076 ms, `NO_MEDIA_FOUND`, and requests `/age-false-cookie-sheet-sticky.html /beacon/accept /beacon/view-partners`. The 11 s is inside provocation. My guess is clicks waiting out their 1500–2000 ms timeouts behind the page's full-viewport `#vendors` panel, but I did not measure that. Options:
  1. **Recommended:** the owner rewords Done when 1 to the mechanism ("no browser test other than the abandoned-body one reaches `settle()`'s cap"), which the planted throw proves. The dl-83 residue time goes to a sibling speed ticket's Build, or to a new ticket, with the stage reproduction above. dl-111 lands as built.
  2. Keep the line literal and widen dl-111 to make the dl-83 rows fast. That is production provocation work, which this brief scoped out ("changes test fixtures only"), and dl-48/dl-80 would still fail the line by design.
- **low** · `nfr:maintainability` · two comments state something false. The new test's comment says "The other fixtures read every body they fetch", and `abandoned-body.html` says "Every other fixture reads what it fetches". `drm.html`, `player-box-interstitial.html`, `shadow-player-lazy-mount.html` and `related-card-target.html` still fetch a playlist and never read it, and `no-media.html` does the same with `/media/notes.json`. What is true, and measured, is that no other test reaches the cap. A later test that reuses one of those pages on a path that does fetch would stall without anyone noticing. Remedy: word both comments as "no other test reaches the cap".
- **low** · Log accuracy · the Log says the dl-83 residue rows' "`server.requests` hold the page and a beacon and nothing else". The sticky-panel page requested two beacons (`/beacon/accept`, `/beacon/view-partners`). The conclusion (no manifest, no stalled body) holds.
- **dropped** · the new test's title says "abandoned at settle()'s cap", yet with `settle` returning at once the test stays green (3013 ms). Dropped because Build 3 forbids asserting a timing, the test's own comment says it asserts only the answer, and removing the cap does turn it red.
- **dropped** · "never clicks a shadow-root card whose host sits inside a link" stays green when the media walk stops at shadow roots. Its assertion is "the card is never clicked", which a blind walk satisfies. The page change does not touch it, so this is not a dl-111 matter.
- **dropped** · `drm.html` fetches a master and never reads it. Its test does not reach the cap under the planted throw, so the page costs no time.
- **findings** · the hunt returned 6; 3 carried, 3 dropped.
- Positive control: with the head's `r.text()` removed from `guard-fragment.html` (an exact revert to the base blob), its test ran 5884 ms in the same directory run. That is +3109 ms over the 2775 ms median and level with the abandoned-body test's 5884 ms. In the run with the planted throw, at head content, the same test took 2835 ms.
- Re-timed independently: `npx vitest run tools/downloader/resolvers/test/browser --reporter=json`, 756 of 756 passed, `browser-resolver.test.ts` 554.6 s summed. The Log says 548.8 s.
- Invariants: the diff touches test fixtures and one spec only. AppError, shell, redaction, SSRF, contract, Dockerfile and registration were skipped as untouched, because the new test sits in an existing registered file. Style is clean in the diff.
- NFR: security n/a (fixtures only) · performance ✓ (24 tests about 3 s faster each; CI unit leg 9m59s) · reliability ✓ (one browser test still drives the cap end to end) · maintainability: the comment above.

### Gate 2

**Gate: CONCERNS** — 2026-10-12 · `e2239132..e9e1206b` (one commit, `e9e1206b`) · Opus 5.5, depth medium

| Done when                                                                                                                                                                           | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. (reworded) No browser test other than the abandoned-body one reaches `settle()`'s cap; proof: a planted throw "run over the browser directory, fails that one test and no other" | **verified for the sentence, false in its proof clause.** I planted a throw in `HitCollector.settle` (`resolvers/src/browser/intercept.ts`) for when its `expire` timer wins the race, then ran `npx vitest run tools/downloader/resolvers/test/browser --reporter=json`. **3 of 756 failed**, all with `Error: MUTATION: settle cap reached with an unread body`: the new `browser-resolver.test.ts` test, and in `sniff.test.ts` dl-79's "a body that never arrives is abandoned when settle()'s budget runs out" and dl-91's "a read that never settles gives its slot back, so it cannot starve the manifest behind it". `sniff.test.ts` imports only types from `playwright` and launches no browser. So the sentence holds if "browser test" means a test that drives Chromium (1 test of 697 in the other 12 files), which is the brief's own usage ("`sniff.test.ts` … without a browser"). The proof clause, "run over the browser directory, fails that one test and no other", is false as committed, and the round's own Log, a few lines below it, shows 3 |
| 2. Exactly one browser test exercises an abandoned body on purpose, and its name says so                                                                                            | unchanged from gate 1; ✓ under the same definition (the two `sniff.test.ts` rows also abandon a body on purpose, but with fake responses)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3. `npm test -- --project downloader` passes, and changed tests assert what they did                                                                                                | the round changes comments and docs only (`git diff --stat e2239132 e9e1206b -- tools/downloader/resolvers/src` is empty). `test (ubuntu-latest)` and `test (windows-latest, informational)` were **pending** on `e9e1206b` when read; gate 1's green leg was on `e2239132`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Gate 1's findings:

- **med, open decision (Done when 1)**: **fixed as decided.** The owner chose "Reword + file dl-118", the line is reworded and dl-118 is filed. The reworded line's proof clause is a new finding, below.
- **low, comments claim every fixture reads what it fetches**: **not fixed.**
  - The test comment now says "No other browser test reaches `settle()`'s cap: dl-111 planted a throw at the cap and this was the only one that failed". Three failed.
  - `abandoned-body.html` says "No other test reaches that cap (dl-111 measured it)". `sniff.test.ts`'s two rows reach it.
  - `abandoned-body.html` still opens with "The one page that fetches a playlist and never reads it". `drm.html`, `player-box-interstitial.html`, `shadow-player-lazy-mount.html` and `related-card-target.html` each fetch a playlist and never read it, and the comment's own last sentence ("A few other pages still fetch without reading") contradicts its first.
- **low, beacon count**: **fixed.** I ran dl-118's script, extracted verbatim from the ticket. The two cookie-sheet pages request `/beacon/accept /beacon/view-partners` and the menu-button page requests `/beacon/nav-18`, as the Log now says.

New, in the lines this round touched:

- **med** · Done when 1 depends on it · the reworded line's proof clause contradicts the measurement it cites, and "browser test" is undefined in a directory named `browser/` that holds non-browser tests. Reproduction: the planted throw above, 3 of 756. Narrowest correct wording, fully stated: "1. No test that drives Chromium, other than the abandoned-body one, reaches `settle()`'s cap. Proof: a throw planted at the cap, run over `resolvers/test/browser`, fails that test and the two `sniff.test.ts` rows that pin the cap with fake responses and no browser, and nothing else (3 of 756; output in the Log)." The same definition makes Done when 2 exact.
- **low** · `nfr:maintainability` · the carried-over comment finding above. Fully stated remedy:
  - test comment: "No other test that drives Chromium reaches `settle()`'s cap: dl-111 planted a throw there, and only this test and two `sniff.test.ts` rows, which use fake responses, failed."
  - fixture comment: "The page for the one Chromium test that reaches settle()'s cap (dl-111): it fetches a playlist and never reads it. Other pages also fetch without reading, but no test waits on them."
- **low** · dl-118's "Not measured" paragraph.
  - It credits gate 1 with suspecting five cited sites. Gate 1 named no lines.
  - Three of the five sites are `force: true` clicks: the two in `clickChosenVideo` and the one in `clickPlayerBox`. Those skip Playwright's actionability wait, so a covering layer cannot make them sit out their timeout. The blockable clicks in that path are `provokeFrame`'s `clickVisible(…, PLAY_SELECTORS, { timeoutMs: 2000, max: 3 })` (cited) and `clickByText(frame, PLAY_TEXT, 2000)` (not cited).
  - "round 1 is within 100 ms of it" describes a two-round script, but the ticket pastes a one-round script.
  - The paragraph is labelled unmeasured and step 1 measures it, so this is low. It is worth correcting before a builder starts from it.
- dl-118, as filed:
  - **Reproduction reproduces.** The script extracted verbatim from the ticket gives sticky 12976 ms, closable 12983 ms and menu-button 10916 ms, all `NO_MEDIA_FOUND`; `provoke-playback` runs from about 625 ms to 11754 / 11759 / 9697 ms; settle takes 13 ms; the control `age-false-shell-link.html` gives 2881 ms ok. Every stage is within 25 ms of the ticket's pasted output.
  - **Format.** It carries a reproduction. `npm run status -- --show dl-118` parses it (`kind chore`, `status ready`, `difficulty standard`, unblocked), and `npm run status -- --json` exits 0.
  - **Measured claims.** I found nothing claimed as measured that was not, apart from the low above.
- **findings** · the re-gate found 3 new (1 med, 2 low; one low is gate 1's comment finding carried as not fixed); 0 dropped. Nothing is a `high`.
- NFR: security n/a · performance n/a (comments and docs) · reliability n/a · maintainability: the comment low above.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The owner's decisions behind
  the batch: delete tests already covered elsewhere but keep rows a gate or an
  owner decision chose; allow production timing options only with unchanged
  defaults; split the big file and raise workers on CI only; one ticket per
  phase. This ticket needs none of them, since it changes test fixtures only.
- 2026-10-12 — Built. Found by timing, not by the suspect list: every browser
  test under `resolvers/test/browser` (755 tests) timed before and after, one
  run each on this machine, `npx vitest run tools/downloader/resolvers/test/browser
--reporter=json`. The signature of the defect is a playlist fetched as the
  last request and never read, so the probe waits `settle()`'s 3000 ms cap once.
  A normal probe here is about 2.8 s; the stalled ones were 5.7 to 6.4 s.
  - **Fixed**, 19 pages, one `.then(function (r) { return r.text(); })` each and
    no other change: `cross-origin-card-inner`, `guard-fragment`,
    `guard-pushstate`, `guard-query`, `guard-redirect-fragment-target`,
    `guard-router-rewrite`, `guard-script-redirect-target`, `iframe-player`,
    `modal-escape`, `player-box-billboard`, `player-box-click-only`,
    `related-card`, `related-card-area`, `shadow-card`, `shadow-player`,
    `shadow-player-order`, `shadow-player-play-only`, `xo-play-only-inner`,
    `xo-scroll-player-inner`. Two of them (`guard-pushstate`,
    `xo-scroll-player-inner`) fetched a master; the other 17 a variant.
  - **24 tests dropped by at least 1.5 s**, all of them by about 3 s. The two
    that end on a departure (`pushState`, a query key outside the exception)
    stalled once rather than twice, so they started shorter. Before to after,
    in ms:

    | test                                                                            | before | after |
    | ------------------------------------------------------------------------------- | -----: | ----: |
    | dl-81 clicks the middle of the largest player-ish box when no video was clicked |   5725 |  2730 |
    | dl-81 frame from another site, scripted play()                                  |   5793 |  2789 |
    | dl-81 frame from another site, scroll                                           |   5764 |  2776 |
    | dl-81 never clicks a frame: a billboard larger than the page's own box          |   5793 |  2775 |
    | dl-48 presses Escape on a dialog it finds no close control in                   |   6017 |  2998 |
    | dl-55 fragment-only change on play                                              |   5852 |  2851 |
    | dl-55 router history.replaceState ~300ms in                                     |   5745 |  2757 |
    | dl-55 history.pushState never returns the other page's stream                   |   4584 |  1656 |
    | dl-55 script redirect ~200ms after load                                         |   5898 |  2842 |
    | dl-55 the landing URL is the page reached after a redirect                      |   5862 |  2843 |
    | captures a stream from a same-origin iframe embed                               |   6159 |  3061 |
    | dl-55 a query key outside the exception is still a departure                    |   4644 |  1643 |
    | dl-55 a reordered query string                                                  |   5856 |  2842 |
    | dl-55 adding ?autoplay=                                                         |   5858 |  2848 |
    | dl-55 adding ?start=                                                            |   5890 |  2849 |
    | dl-55 adding ?t=                                                                |   5905 |  2849 |
    | dl-55 cross-origin chooser, genuinely cross-origin frame                        |   6380 |  2807 |
    | dl-55 picks the largest visible candidate                                       |   5765 |  2744 |
    | dl-55 starts the real player and never reaches the card                         |   5766 |  2755 |
    | dl-68 shadow-root player with no click listener                                 |   5763 |  2733 |
    | dl-61 indexes candidates in the locator's own order                             |   5839 |  2798 |
    | dl-61 never clicks a shadow-root card inside a link                             |   5774 |  2734 |
    | dl-61 shadow-root player inside a cross-origin frame                            |   5839 |  2799 |
    | dl-61 shadow-root player probed directly                                        |   5764 |  2747 |

  - **File totals:** `browser-resolver.test.ts` 622.4 s to 548.8 s (CI timed it
    at 620 s); the directory's 755 tests summed 741.5 s to 660.0 s, and the
    756th is the new test below. Every other file in the directory is within
    noise.
  - **Still over 3.5 s, none an unread fetch.** The three dl-83 "accepted
    residue" rows (13.0, 12.8 and 10.8 s) request no manifest at all: their
    `server.requests` hold the page and one or two beacons (`/beacon/accept`
    and `/beacon/view-partners` for the two cookie-sheet rows, `/beacon/nav-18`
    for the menu-button row) and nothing else, so the time is not a stalled
    body. Round 2 below measures where it goes. dl-48's late modal
    (`quietMs: 6000` plus a 3500 ms delay), dl-80's floor tests (10.5, 7.4 and
    4.0 s), dl-81's 3000 ms-delay row (4.8 s) and dl-100's cross-origin Play
    press (4.5 s) wait on purpose; so does dl-105's stepped clock (4.5 s).
  - **Pages left alone.** Five pages still fetch without reading: `drm.html`,
    `player-box-interstitial.html`, `shadow-player-lazy-mount.html`,
    `related-card-target.html` and `no-media.html` (the last fetches
    `/media/notes.json`, not a manifest). No test waits on any of them. For
    `player-box-interstitial` and
    `shadow-player-lazy-mount` I patched
    and reverted both: the first fetches only on a click that its test asserts
    never happens (it ends `NO_MEDIA_FOUND`), and the second is reached only by
    `provoke.test.ts`, which stops at the request and never waits on a body. No
    timing moved for either, so nothing proves the change. `drm.html` is the same
    shape and ends on a verdict that does not wait. The ticket's other suspects
    (`consent-scope`, `chunk-streams`, `manifest-refetch`, the proxy size probe)
    do not stall: their slowest rows are 3.2 s and 3.0 s.
  - **One abandoned body on purpose**: `fixtures/pages/abandoned-body.html`
    (master read, variant fetched and dropped) and the last test in
    `browser-resolver.test.ts`, "a body the page never reads is abandoned at
    settle()'s cap, and the probe still answers". It asserts the answer and no
    duration; it takes 5.86 s, so it does reach the cap. `no-store` is untouched.
- 2026-10-12 — Round 2, after gate 1 graded round 1 CONCERNS at e2239132.
  - **The owner's answer (2026-10-12), relayed by the orchestrator.** Gate 1's
    open decision was that "no browser test that is not about the settle cap
    takes 3 s more than the baseline" is false for six tests nobody touched: the
    dl-48 late modal and the dl-80 floor tests wait by design, and the three
    dl-83 rows have no wait named in their code. The options were "Reword +
    file dl-118 (Recommended)", "Reword, log the dl-83 time only" and "Keep it
    literal, widen dl-111". **Chosen: reword and file dl-118.** Done when 1 now
    reads "no browser test other than the abandoned-body one reaches
    `settle()`'s cap", and the dl-83 time is
    [dl-118](./dl-118-three-age-gate-rows-spend-11-s-each-in-provoke-playback.md).
    No sibling (dl-113 to dl-117) covers it.
  - **The proof for the reworded line: a planted throw.** In
    `resolvers/src/browser/intercept.ts`, `settle()` threw
    `MUTATION: settle cap reached with an unread body` when its deadline had
    passed or its `expire` timer won the race. Run over the whole browser
    directory with
    `npx vitest run tools/downloader/resolvers/test/browser --reporter=json`,
    then reverted (`git checkout` of that file; the committed
    tree does not carry it). Result, 753 of 756 passed:

    ```
    browser/browser-resolver.test.ts 1 of 183 failed
       FAIL a page that abandons a fetched playlist (dl-111) a body the page never reads is abandoned at settle()'s cap, and the probe still answers | Error: MUTATION: settle cap reached with an unread body
    browser/consent-scope.test.ts 0 of 27 failed
    browser/chunk-streams.test.ts 0 of 11 failed
    browser/provoke.test.ts 0 of 231 failed   (and 0 failed in the other six files)
    browser/sniff.test.ts 2 of 59 failed
       FAIL a sniff never holds the probe up (dl-79) a body that never arrives is abandoned when settle()'s budget runs out
       FAIL a compressed typed manifest is read within a budget of inflated bytes (dl-91) a read that never settles gives its slot back ...
    ```

    The two `sniff.test.ts` rows use fake responses, not a browser, and are the
    ones that pin the cap by design. Among tests that drive Chromium, the
    abandoned-body test is the only one that reaches the cap.

  - **dl-83 rows, measured again.** Re-ran gate 1's stage script on the three
    pages (it is pasted in dl-118): `provoke-playback` runs about 11.1 s on the
    two cookie-sheet pages and 9.1 s on the menu-button page, `network-quiet` is
    the 1.2 s `quietMs`, `settle-requests` is about 12 ms. A control page,
    `age-false-shell-link.html`, spends 1.0 s in `provoke-playback`. Where
    inside provocation the time goes is unmeasured and is dl-118's step 1.
  - **Both low findings fixed.** The comments in `abandoned-body.html` and in
    the new test now say what was measured (no other test reaches the cap)
    instead of "every other fixture reads what it fetches", which five pages
    contradict. The beacon count above is corrected: the cookie-sheet rows
    request two beacons, the menu-button row one.
- 2026-10-12 — A round after gate 2 (CONCERNS, one med, two low), fixed by the
  fixer.
  - **Done when 1 and 2 narrowed to the measurement (med).** The planted throw
    above failed 3 of 756: the abandoned-body test and two `sniff.test.ts` rows
    that use fake responses and no browser. Done when 1 now says "no test that
    drives Chromium, other than the abandoned-body one", names the two
    `sniff.test.ts` rows in its proof, and gives "3 of 756"; Done when 2 says
    "test that drives Chromium". The pasted output was not edited; it lists
    1 + 0 + 0 + 0 + 2 = 3 failures.
  - **Carried-over comment (low).** The comments in the new test and in
    `abandoned-body.html` now say what was measured: no other Chromium test
    reaches the cap, and the two failing `sniff.test.ts` rows use fake
    responses; other pages also fetch without reading, but no test waits on them.
  - **dl-118's "Not measured" paragraph (low).** It no longer credits gate 1 with
    five suspected sites (gate 1 named no lines). It says three of the five are
    `force: true` clicks that skip the actionability wait, names the blockable
    clicks (`clickVisible` for `PLAY_SELECTORS`, `clickByText` for `PLAY_TEXT`),
    and stays labelled unmeasured. Its "round 0 of two; round 1 is within 100 ms"
    clause, which described a script the ticket does not paste, now reads "one
    run of the script above".
