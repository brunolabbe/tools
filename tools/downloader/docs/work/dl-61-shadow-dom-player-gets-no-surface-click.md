---
id: dl-61
tool: downloader
title: A player inside an open shadow root gets no surface click
kind: fix
status: done
milestone: null
depends_on: [dl-55]
---

# dl-61 — A player inside an open shadow root gets no surface click

## Why

dl-55 replaced the surface click's `frame.locator("video").first()` with a
chooser built around `document.querySelectorAll('video')`
(`CHOOSE_VIDEO_INDEX_FN` in `resolvers/src/browser/provoke.ts`), to stop the
click from landing on a related-video card ahead of the real player.
`querySelectorAll` does not descend into an open shadow root; the locator it
replaced did, since Playwright's locator engine is shadow-piercing by
default. A page whose player lives inside a shadow root — a common pattern
for a custom `<video-player>` web component — now gets no surface click at
all.

Found and reproduced by dl-55's round-3 gate (`ticket-reviewer`, Opus), while
checking the cross-origin chooser dl-55 added; not part of what that round
set out to test. **Never a wrong video** — the probe falls through to
`NO_MEDIA_FOUND`, the same code the registry already uses to try the next
tier, not a stream belonging to some other page. The owner decided to file
this rather than block dl-55 on it, on the reviewer's own recommendation.

### Reproduction, 2026-09-15

Fixture: a page whose only content is
`document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
'<video id="sv" width="640" height="360" muted playsinline></video>'`, with a
`click` listener on the shadow video that fetches a playlist. No other
video, no play button, no matching text.

- **`origin/main`'s `provoke.ts`/`browser.ts`** (before dl-55): returns the
  stream, both with the fixture served same-origin and with it embedded in a
  genuinely cross-origin iframe.
- **dl-55 at `d8aced1`**: `NO_MEDIA_FOUND` for both.

## Build

1. In `resolvers/src/browser/provoke.ts`, make `CHOOSE_VIDEO_INDEX_FN`'s
   candidate list shadow-piercing. `document.querySelectorAll('video')` only
   sees light-DOM video elements; a recursive walk (`element.shadowRoot`,
   entered when open, skipped when closed or absent) is needed to match what
   the locator API already does by default.
2. **Keep the chosen index aligned with the locator's own order** — the
   reviewer's own constraint on dl-55's cross-origin path. `clickChosenVideo`
   marks the scriptable-frame choice with `VIDEO_MARK` and clicks it through
   `frame.locator(`[${VIDEO_MARK}]`)`, which is shadow-piercing regardless
   and needs no index; the cross-origin branch clicks
   `frame.locator("video").nth(index)`, where `index` has to mean the same
   position in Playwright's own (also shadow-piercing) match order as it
   does in whatever list this ticket's candidate walk produces. Getting the
   two orders to disagree would silently misalign the click again, on a
   different page shape than dl-55's own gate found.
3. `METADATA_SCRIPT`'s duration fallback calls `CHOOSE_VIDEO_FN`, which
   shares `CHOOSE_VIDEO_INDEX_FN` — no separate change needed there once the
   candidate walk itself is shadow-piercing.
4. **Tests**, beside dl-55's in `resolvers/test/browser/browser-resolver.test.ts`:
   a fixture with a click-started player inside an open shadow root and no
   other candidate, probed both same-origin and (reusing dl-55's
   `FixtureServer.secondaryOrigin`) from a genuinely cross-origin frame.
   Revert the shadow-piercing walk and record in the Log that both tests go
   red.
5. A closed shadow root is out of scope — nothing in the DOM can see inside
   one, locator API included, so there is no behavior to match.

## Done when

- The reproduction above returns the stream, same-origin and cross-origin.
- Reverting the shadow-piercing candidate walk reddens both new tests
  (fixture test file:line noted in the Log).
- `npm run check` and `npm test -- --project downloader` pass.

## Review

### Gate 1 — ticket-reviewer (agent `a17a6bc218906c464`)

**Gate: PASS** — 2026-09-17 · `origin/main...HEAD` (base `20c8fd1`, tip `7d801d6`) · defect hunt at medium, run directly (no `code-review` dispatch — subagent tool constraints)

| Done when                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reproduction above returns the stream, same-origin and cross-origin                                       | proven — same-origin `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:762 "shadow-player.html"`; cross-origin `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:778 "cross-origin-shadow.html"`. Re-run at `7d801d6`: 4 passed, 45 skipped (49)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reverting the shadow-piercing candidate walk reddens both new tests (fixture test file:line noted in the Log) | proven — reverted `ALL_VIDEOS_FN` to a plain `querySelectorAll('video')` body, rebuilt, reran: `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:762 "shadow-player.html"` and `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:778 "cross-origin-shadow.html"` both went red (`NO_MEDIA_FOUND`), matching the Log's own mutation table; the two extra tests behaved exactly as documented there too (`tools/downloader/resolvers/test/browser/browser-resolver.test.ts:794 "cross-origin-shadow-order.html"` red, `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:807 "shadow-card.html"` green). Restored via `git status --porcelain` (clean) + a rebuild before continuing |
| `npm run check` and `npm test -- --project downloader` pass                                                   | proven — `npm run check` exit 0; `npm test -- --project downloader`: 85 files, 1433 tests, exit 0 (matches the Log exactly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

- **low** · `UNMARK_VIDEO_SCRIPT`'s shadow-piercing walk (`provoke.ts` around the `UNMARK_VIDEO_SCRIPT` definition) has no fixture, as the Log says — but the mechanism it guards is real, not merely unobservable. Isolated repro (outside the suite): mark a shadow-root video, run the OLD `document.querySelectorAll('[data-downloader-video]')`-based unmark (a no-op inside a shadow root), then mark a second, different shadow-root video (simulating `provokePlayback`'s second pass choosing a new "best" candidate) — `page.locator('[data-downloader-video]').first()` then resolves to the STALE first mark, not the intended one. That is dl-55's original click-misdirection bug, in a two-pass shape. The shipped (fixed) code already prevents this; only the regression test is missing. A suite-level fixture would need the "best" candidate to move between shadow roots between `provokePlayback`'s two passes — buildable, not attempted since it is not a live defect.
- **measured, not a finding** — the Log's own open question ("fold in or file"): built a scratch fixture, a shadow-root `<video>` whose media loads only via `.play()`, with no click listener at all. Probed it on this branch (temporary test appended to `browser-resolver.test.ts`, then reverted): the resolver throws `AppError NO_MEDIA_FOUND` — it does **not** find the media. Command: `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "shadow-root media that only loads on play"`. `PLAY_SCRIPT` and `METADATA_SCRIPT`'s `document.querySelector('audio')` fallback both stop at shadow roots, unchanged by this ticket, exactly as the Log says. I'm sending this measurement to the orchestrator as the open decision it already is — not resolving it here.
- **findings** · own hunt at medium returned 1; 1 carried, 0 dropped.
- NFR: security n/a (no URL/header logging touched) · performance ✓ — measured a ~5000-element page with 30 shadow roots (one nested 3 levels): the `ALL_VIDEOS_FN`-shaped walk costs ~0.93ms per call, negligible against the probe's second-and-minute budgets · reliability ✓ · maintainability ✓.

Transcribed by the builder from the reviewer's message. The only change is
that each short `browser-resolver.test.ts:<line>` citation now carries its
full repo-relative path, so `citations.mjs` can resolve it. The low stays
open as a coverage gap. The builder reproduced its mechanism (see Log) and
agrees it is not a live defect.

## Log

**2026-09-15 — filed** from dl-55's round-3 gate, which found and reproduced
this while checking a different fix on the same branch. Not built against;
`depends_on: [dl-55]` since the regression is dl-55's own chooser.

**2026-09-17 — built** on `dl-61-shadow-dom-surface-click`, off `origin/main`
at `20c8fd1`.

**Reproduced before any fix.** The two Done-when tests, written first against
`origin/main`'s unmodified `provoke.ts`, both failed `NO_MEDIA_FOUND`
(`npx vitest run …/browser-resolver.test.ts -t dl-61`: 2 failed, 45 skipped).
The premise holds.

**What changed**, all in `resolvers/src/browser/provoke.ts`:

- `ALL_VIDEOS_FN`, a new in-page walk, replaces every
  `document.querySelectorAll('video')` the chooser used: in `CHOOSE_VIDEO_FN`
  (and so `METADATA_SCRIPT`'s duration fallback, per Build step 3) and in
  `CHOOSE_VIDEO_INDEX_SCRIPT`.
- **Build step 2's order, measured instead of assumed.** Playwright 1.62's
  `locator("video")` is not in tree order. It returns one root's own matches
  first, then goes into the shadow roots of that root's elements, in document
  order, recursively. Test page: light `L1`, host `h1` (holding `S1a`, nested
  host with `N1`, `S1b`), light `L2`, host `h2` (holding `S2` and a slot) with a
  slotted light `L3`, light `L4`, and a closed root holding `C1`.
  `evaluateAll` and `nth(i)` both gave `L1 L2 L3 L4 S1a S1b N1 S2`. A tree-order
  walk gave `L1 S1a N1 S1b L2 S2 L3 L4`. `ALL_VIDEOS_FN` uses the first order.
  A walk in tree order would have made the cross-origin click miss again.
- **The brief missed two things. Both are fixed here.**
  1. **The link check stopped at a shadow root.** `CHOOSE_VIDEO_INDEX_FN`
     climbed `parentElement`, which is `null` at a shadow root. Once shadow
     videos are candidates, a card component inside a light-DOM `<a href>`
     would count as a player. Its composed `click` bubbles to the link, which
     is dl-55's own bug in a new shape. The climb now steps from a shadow root
     to its host.
  2. **`UNMARK_VIDEO_SCRIPT` could not see a mark inside a shadow root.** It
     used `document.querySelectorAll('[data-downloader-video]')`. It now
     clears the mark from every candidate `ALL_VIDEOS_FN` returns. Clicking
     still uses the locator `[data-downloader-video]`, which already pierces
     shadow roots. **No test in the suite covers this.** A stale mark on a
     video that the next pass also chooses changes nothing these fixtures can
     observe. The gate below showed the stale mark can send a click to the
     wrong video once the second pass chooses a different one. I reproduced
     that outside the suite with `scratchpad/dl-61/stale-mark.mjs`. It marks
     one shadow-root video, clears marks, then marks another. With the old
     unmark, `locator('[data-downloader-video]').first()` resolved to the first
     video, `A`. With the new one it resolved to the second, `B`.

**Tests.** They are at the end of
`resolvers/test/browser/browser-resolver.test.ts`, not next to dl-55's block
as step 4 asked. Merged gate records cite lines in the middle of that file, and
inserting tests there would move those lines. Fixtures:
`shadow-player.html` (the reproduction), `shadow-player-order.html`,
`shadow-card.html`. The fixture server's cross-origin outer page is now a small
table, so `/cross-origin-shadow.html` and `/cross-origin-shadow-order.html`
reuse `/cross-origin-card.html`'s shape.

| test                                                                       | main  | walk reverted to `querySelectorAll` | walk in tree order | link check stops at shadow root |
| -------------------------------------------------------------------------- | ----- | ----------------------------------- | ------------------ | ------------------------------- |
| `browser-resolver.test.ts:762` same-origin shadow player                   | red   | red                                 | green              | green                           |
| `browser-resolver.test.ts:778` cross-origin shadow player                  | red   | red                                 | green              | green                           |
| `browser-resolver.test.ts:794` cross-origin, host before a light-DOM decoy | red   | red                                 | **red**            | green                           |
| `browser-resolver.test.ts:807` shadow card inside a link, light player     | green | green                               | green              | **red** (`navigated-away`)      |

Each column was one change to the committed file, run with `-t dl-61`, then
restored from a saved copy (`cmp` identical). The last row is green on main
because main never treats a shadow video as a candidate. That test protects
the new clause and does not reproduce the ticket's bug.

**Citations repaired in dl-55's Review record.** This change moved four
`provoke.ts` citations there, and `citations-gate.mjs` flagged them. Three
were repointed to the same text at its new line (169→208, 328→373 twice,
570→615). The fourth, `provoke.ts:208 "var videos =
document.querySelectorAll('video');"`, describes the code this ticket
replaces, so it is now pinned to `@20c8fd1`, the `main` commit that still has
that line. No verdict or anchor text changed.

**Not folded in, and why.** `PLAY_SCRIPT`'s `querySelectorAll('video, audio')`
and `METADATA_SCRIPT`'s `document.querySelector('audio')` also stop at shadow
roots. No ticket specifies that work, so it cannot be folded in under the
fold-in rule. It is raised with the orchestrator instead of being decided
here. Separately, nothing handles a light-DOM video slotted into a shadow root
that wraps the slot in a link. The same gap already existed for light-DOM
videos before this change.

**Gates.** `npx vitest run tools/downloader/resolvers/test/browser/` (the
directory, run once): 7 files, 144 tests, all passing.
`npm test -- --project downloader`: 85 files, 1433 tests, exit 0.
`npm run check`: exit 0. `node scripts/citations-gate.mjs --against
origin/main`: 84 enforced, 0 failing, 0 raised. `npm run format` was run after
the markdown edits.

**2026-09-17 — the open question is filed, not folded in.** The owner chose to
file the `PLAY_SCRIPT` / `METADATA_SCRIPT` audio gap the gate measured rather
than widen this branch:
[dl-68](./dl-68-play-and-metadata-scripts-stop-at-shadow-roots.md), filed on
this branch, carrying the gate's own measurement verbatim. The gate's one low —
`UNMARK_VIDEO_SCRIPT`'s fix has no regression test — stays here: the finding is
in the Review section above, and the mechanism, reproduced by the builder and
again by the reviewer, is in this Log. It is a coverage gap, not a live defect,
and no ticket is filed for it.
