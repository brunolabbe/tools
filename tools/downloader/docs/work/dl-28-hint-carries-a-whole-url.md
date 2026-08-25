---
id: dl-28
tool: downloader
title: The ttml row still reads a hostname as a format claim
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-28 — row 3 of `SUBTITLE_FORMATS` reads a URL as a format claim

**Packages:** `resolvers` (`common.ts`, and whichever caller stops passing a URL).

## Why

dl-25 fixed rows 1 and 2 (`vtt` and `srt`): their tokens now have to _end_ a
claim rather than continue into a hostname label or a path segment. Row 3
(`/ttml|dfxp|stpp/i`) was left matching its tokens anywhere in the hint, so the
same defect is still live there. Pinned as expectations in
[`common.test.ts`](../../resolvers/test/common.test.ts), which currently
asserts the **wrong** answers on purpose so this ticket has a failing target to
flip:

```
"application/mp4 https://stpp.cdn.net/sub.mp4"  -> ttml  ✗  should be unknown
"application/mp4 https://cdn.net/ttml/sub.mp4"  -> ttml  ✗  should be unknown
"application/mp4 https://cdn.net/dfxp/sub.mp4"  -> ttml  ✗  should be unknown
```

**This is the milder half of the defect, and that is worth knowing before you
size it.** `SUBTITLE_FORMATS_FFMPEG_READS` at
[`engine/src/index.ts:119`](../../engine/src/index.ts) is `{"vtt", "srt"}`.
`ttml` is not in it, so a wrong `ttml` answer means the track is _dropped_ at
[`index.ts:533`](../../engine/src/index.ts) — the dl-24 data-loss mode — rather
than fetched and handed to ffmpeg. dl-25 took rows 1 and 2 first precisely
because those two are in that set and their wrong answers reached the disk.

What makes it worth doing anyway is the second failure mode, which the drop
hides: a **genuine** `application/x-subrip` or `text/vtt` track whose signed URL
happens to contain `ttml`, `stpp` or `dfxp` is answered `srt`/`vtt` today only
because rows 1 and 2 are scanned first. See the ordering caution in Build 6.

## Build

1. **dl-25's boundary cannot be reused here, and this is the whole difficulty.**
   Rows 1 and 2 took `(?![\w./-])` — the token may not continue into a `.`, `-`
   or `/`. Row 3 cannot: `stpp.ttml.im1t` is a real DASH `codecs=` string whose
   dots separate a claim, and `stpp.cdn.net` is a hostname whose dots do not.
   Both are `stpp` followed by `.`, so no token-level boundary tells them apart.
   It is checked in the table already — apply dl-25's lookahead to row 3 and
   `["stpp.ttml.im1t", "ttml"]` goes red, with or without the left anchor.
   Verify that before designing anything. Note the in-repo evidence for
   `stpp.ttml.im1t` is that one table row and not a manifest: no fixture under
   `tools/downloader/resolvers/test/fixtures/` carries it, and adding one would
   be a cheap improvement to make while you are here.

2. **So the fix is to stop putting a whole URL in the hint**, which is the
   option dl-25 weighed and did not take.
   [`dash.ts:338`](../../resolvers/src/manifest/dash.ts) builds
   `` `${mimeType} ${codecs} ${fileUrl}` ``; passing
   `` `${mimeType} ${codecs} ${urlExtension(fileUrl) ?? ""}` `` keeps every real
   claim (mime type, codec, extension) and drops the host and the path.
   `urlExtension` is already in `common.ts`.

3. **`ytdlp.ts:256` is the caller that must _not_ get the same treatment**, and
   dl-25 established this by counterexample. It passes `chosen.ext ?? chosen.url`,
   and yt-dlp subtitle URLs are believed to carry the format in the **query
   string** routinely — a YouTube timedtext URL ends `…&fmt=vtt`
   (**unmeasured — see Log**; no yt-dlp run was made against a live site, and
   this premise is the one thing here worth checking before you build on it).
   If it holds, reducing that URL to its path extension answers `unknown` where
   it answers `vtt` today, which is a regression, not a fix — leave it passing
   the URL, and accept that a hint from this caller can still contain a
   hostname. If it does not hold, step 4 collapses to the cheaper option and
   you should say so in the Log.

4. **Step 2 on its own cannot satisfy Done-when 1, and this is measured, not
   argued.** `dash.ts`-only was applied exactly as step 2 describes and the
   resolvers suite came back **199/199 green with all three pinned rows still
   passing and still asserting the defect** — because they are unit tests on
   `subtitleFormat`, which a `dash.ts` change never touches, and the hint
   strings they contain are not built by `dash.ts` in that test. So `dash.ts`
   alone is a real improvement to the DASH path that this ticket's acceptance
   cannot see. Two ways to close that, and the ticket has to say which it buys:
   - **step 2 plus a `dash.ts`-level test** (`parseDash` over an MPD fixture
     whose text representation sits on an `stpp`-named host), leaving
     `subtitleFormat` and its pinned rows alone. Cheaper, and it leaves a
     ytdlp URL on an `stpp`-named host still wrong. If you take this, say so
     and **rewrite Done-when 1**, which as written demands the pinned rows
     flip and this option cannot deliver that; or
   - **normalise inside `subtitleFormat`**: reduce any whitespace-separated
     token that is URL-shaped (`^[a-z][a-z0-9+.-]*://`) to `urlExtension`
     **plus its query string**, so `?fmt=vtt` survives and `stpp.cdn.net` does
     not. This closes it for every caller and every row at once, is the only
     variant that lets row 3 keep its unanchored shape honestly, and is the one
     the pinned rows are written for — applying it turns exactly those rows red
     and nothing else.

   Decide and record it in the Log.

5. **Rewrite the ordering paragraph** at
   [`common.ts:223`](../../resolvers/src/common.ts). It currently names this
   ticket and explains why row 3 could not take dl-25's boundary. If the fix
   lands, the remaining reason order is load-bearing is the unanchored `subrip`
   alternative alone (`https://cdn.net/subrip/sub.vtt` matches rows 1 and 2
   both) — say that, and delete what is no longer true.

6. **Caution, if you reorder the rows while rewriting them.** The rows 2 ↔ 3
   order is load-bearing and **no test pins it**: swapping them leaves the
   suite fully green, and it is not a safe swap. Measured on the dl-25 branch:

   ```
                                                     shipped   swapped
   application/x-subrip https://cdn.net/s/sub.ttml     srt       ttml
   text/srt https://cdn.net/ttml/sub.srt               srt       ttml
   ```

   Both are genuine SubRip tracks that would classify `ttml`, fail the
   [`engine/src/index.ts:533`](../../engine/src/index.ts) gate and be silently
   dropped — the dl-24 data-loss mode, with a green suite. This was raised on
   dl-25's gate and deliberately not pinned there, because the reorder it
   guards against is this ticket's change and not that one's. **Pin it here**,
   as part of whatever you do to row 3.

7. **Flip the three pinned expectations** in `common.test.ts` to `unknown` and
   delete the comment block above them that tells the reader not to.

Trap: do not drop `|subrip` from row 2, and do not drop a `(^|\W)` from any row
— dl-24 was exactly that mistake. And do not "fix" a pinned expectation by
editing the expectation.

## Done when

1. All three hints in the Why classify as `unknown`, proven by the table in
   `common.test.ts` with the pinned wrong answers flipped. If Build 4's first
   option is chosen instead, this line must be rewritten before it is claimed —
   that option provably cannot flip those rows (see Build 4), and claiming it
   unchanged is the failure this ticket most invites.
2. `stpp.ttml.im1t`, `application/ttml+xml`, `wvtt`, `text/vtt` and every other
   existing row of that table still pass unchanged.
3. A ytdlp-shaped hint whose format lives in the query string
   (`https://www.youtube.com/api/timedtext?lang=en&fmt=vtt`) classifies as
   `vtt`, proven by a test — whichever option Build 4 chose. That row already
   exists in the table as of dl-25; it must not go red.
4. The rows 2 ↔ 3 order is pinned by a test, so that swapping them fails (see
   Build 6).
5. `npm run check` and `npm test -- --project downloader` pass.

### Gate 1

_Citations in this section resolve against the final tree unless a line says
otherwise; the F1 evidence block is pinned to `2d94dda`, the commit reviewed.
Three bare citations elsewhere in this file (`index.ts:533` at :35,
`dash.ts:338` at :60) are pre-existing brief text whose markdown link targets
resolve, and F4's own row quotes the defective form on purpose — it is the
finding's evidence, not a pointer, so it is deliberately not repointed._

**2026-08-25 — CONCERNS.** Reviewed detached at `2d94dda`. Recorded here in
full because the reviewer's worktree and the orchestrator's copy do not
survive the session; this file is the only durable place for it.

| #   | Finding                                                                              | Disposition                      |
| --- | ------------------------------------------------------------------------------------ | -------------------------------- |
| F1  | The fix defangs nine of dl-25's own regression rows                                  | Accepted, fixed                  |
| F2  | Row 3 still reads a scheme-less hostname; the comment asserts a defence nothing pins | Accepted, fixed by the same rows |
| F3  | `URL_SHAPED` lets 26 of 43 probed URL shapes through                                 | Recorded; comment only           |
| F4  | `dash.ts:338` / `ytdlp.ts:256` cited without a repo-root-relative path               | Fixed; both say what was claimed |
| F5  | Log said 212 tests; actual is 213                                                    | Fixed; and see the class below   |
| F6  | The new `.mpd` `it` set is not conformant-packager output                            | Recorded, no change              |
| F7  | The three flipped rows were the only in-suite proof row 3 reaches a hostname         | Closed by F1's rows              |

**F1, reproduced by this builder both ways before accepting it.** Dropping
`(?![\w./-])` from rows 1 and 2 — reverting dl-25 — and running
`npx vitest run tools/downloader/resolvers`:

```
origin/main    11 failed | 196 passed (207)
this branch     2 failed | 211 passed (213)   only "vttx" and "srtx"
```

Those two numbers are the **finding**, measured at `2d94dda`, the commit gate 1
reviewed. They are pinned, not remapped: the whole point of F1 is what that tree
did, and rewriting them to match the fixed tree would delete the evidence.

**And here is the same mutation on the fixed tree, which is what says F1 is
closed.** Two rows were added — `srt.cdn.net/sub.mp4` and `vtt.cdn.net/sub.mp4`,
both expecting `unknown`. `claimsOnly` returns early on a hint with no `://`, so
these are the only rows in the table that reach rows 1 and 2 without a scheme in
front, and they are what dl-25's lookahead is actually holding up:

```
$ npx vitest run tools/downloader/resolvers          # control, unmutated
      Tests  215 passed (215)

$ # rows 1 and 2 with (?![\w./-]) deleted, i.e. dl-25 reverted
      Tests  4 failed | 211 passed (215)
        "vttx" is unknown
        "vtt.cdn.net/sub.mp4" is unknown      <- new
        "srtx" is unknown
        "srt.cdn.net/sub.mp4" is unknown      <- new

$ # restored
      Tests  215 passed (215)
```

Two red before this fix, four after. The two that were missing are the two whose
wrong answers reach the disk, since `vtt` and `srt` are the members of
`SUBTITLE_FORMATS_FFMPEG_READS`. The control is stated because without it a
uniformly failing harness would report the same four.

The nine that stop failing are dl-25's own: the `vtt`/`srt`/`webvtt` hostname
and path-segment rows, the two `dl-25 cost` rows, and
`application/ttml+xml https://srt.cdn.net/sub.ttml`. `claimsOnly` reduces
`application/mp4 https://vtt.cdn.net/sub.mp4` to `application/mp4 mp4` before
any row is scanned, so those rows pass whether or not dl-25's boundary exists.
The failure that follows is concrete: an agent tidying `SUBTITLE_FORMATS` drops
the lookahead — the dl-24 mistake this file's own comment warns against — sees
only `vttx`/`srtx` red, "fixes" those with `(?!\w)` and ships green, reopening
dl-25 for every hint `claimsOnly` does not cover. `vtt` and `srt` are inside
`SUBTITLE_FORMATS_FFMPEG_READS`, so those wrong answers reach the disk.

**F2 is the same hole from the other side, and it was this ticket's own defect
still live.** On `2d94dda`, `subtitleFormat("stpp.cdn.net/sub.mp4")` and
`subtitleFormat("ttml.cdn.net/sub.mp4")` both answered `ttml`: row 3 has no
boundary and `claimsOnly` returns early on any hint without `://`. The gate
grepped all 27 rows of the table and found every URL-bearing row to be
scheme-bearing, so nothing pinned it.

**F3 — the enumeration.** Of 43 probed URL shapes, `URL_SHAPED` admits 17 and
lets **26** through unreduced: protocol-relative (`//host/…`), scheme-less,
quoted and parenthesised, `blob:`, `data:`, comma-joined and percent-encoded
forms. Only `ytdlp.ts` can reach any of them today. The gate drove
protocol-relative and root-relative `<BaseURL>` values through `parseDash`
live; both came back `unknown`, so the DASH path is fully closed by
`resolveUrl`, and `hls.ts` passes a bare extension. The load-bearing invariant
is therefore **"every caller normalises its URL before building the hint"**,
and it was written nowhere. It is now stated in the `claimsOnly` comment.
`ytdlp.ts` was deliberately not changed.

**Settled, and the measurement is why.** Dropping the query string from
`claimsOnly` fails exactly two tests, and one of them is dl-25's pre-existing
`https://www.youtube.com/api/timedtext?lang=en&fmt=vtt` row — which is
Done-when 3 of this ticket. So closing the query-string edge would overturn an
inherited acceptance criterion, and the decision to leave it open and pin it is
measured rather than argued. The fragment change also stands: a fragment is
never transmitted, so no server can have stated a format in one,
`…/sub.vtt#t=10` still answers `vtt`, and nothing in the repo emits one.

**F6 in full.** The new `it` `AdaptationSet` carries `mimeType="application/mp4"`
with no `codecs`, which a conformant packager would not emit. The gate compared
all 16 fixtures in `tools/downloader/resolvers/test/fixtures/manifests/`: every
one uses `example.*` hosts and none is a captured real payload, so this does not
make the directory worse than it was.

**What the gate did not do.** It did not run the Playwright e2e suite or the
container build, and it did not re-review dl-25's rows as such — only their
behaviour under the mutation above.

## Log

- **2026-08-23** — Filed from dl-25, which fixed rows 1 and 2 and stopped there.
  Row 3 was in dl-25's Done-when as "fix it or file it"; it is filed, because
  the boundary that fixed rows 1 and 2 provably breaks row 3
  (`stpp.ttml.im1t`) and the alternative is a caller change dl-25 had no
  mandate for. The `ytdlp.ts` constraint in Build 3 is measured only by reading
  yt-dlp's output shape and the code — no yt-dlp run was made against a live
  site to confirm the `fmt=vtt`-in-query case, and it should be confirmed
  before relying on it.

- **2026-08-24** — Rewritten after dl-25's gate 1, before dl-25 merged. Three
  changes worth knowing about:

  Row 1 (`vtt`) was in this ticket's first draft and has been **removed from
  it** — it was fixed on the dl-25 branch instead. The gate measured what that
  draft had assumed: row 1 takes dl-25's boundary with 1 failure in 732, and
  that failure was this ticket's own pinned row. So row 1 was never like row 3;
  it was like row 2, and it was the half of the defect that reached the disk.
  What is left here is genuinely only row 3, and it is the milder half.

  Build 4's first option used to read "fix `dash.ts` only, and the four pinned
  cases go green". That was **false, and is now measured false**: the change was
  applied and the suite came back 199/199 green with every pinned row still
  asserting the defect. The option survives as a real choice, but it is now
  paired with the Done-when rewrite it requires.

  Build 6 (the rows 2 ↔ 3 ordering caution) is new, carried over from dl-25's
  gate, which found that swapping those two rows leaves the suite green while
  silently dropping genuine SubRip tracks. It was deliberately not pinned on
  dl-25 — the reorder it guards against belongs to this ticket.

- **2026-08-25** — Built, on **Build 4's second option**: `subtitleFormat` now
  normalises its hint before matching, and no row changed. Everything below was
  written after the command that proves it exited; where nothing was run, it
  says so.

  **Reproduced first, on the `origin/main` base, before any edit.** All three
  hints in the Why, plus the cases the ordering argument rests on
  (`npx tsx <scratch>/dl28-probe.ts`, calling `subtitleFormat` directly):

  ```
  "application/mp4 https://stpp.cdn.net/sub.mp4"      -> ttml
  "application/mp4 https://cdn.net/ttml/sub.mp4"      -> ttml
  "application/mp4 https://cdn.net/dfxp/sub.mp4"      -> ttml
  "stpp.ttml.im1t"                                    -> ttml
  "application/x-subrip https://cdn.net/s/sub.ttml"   -> srt
  "text/srt https://cdn.net/ttml/sub.srt"             -> srt
  ```

  **Build 1 is right, and it is measured.** Row 3 given dl-25's lookahead
  (`/(ttml|dfxp|stpp)(?![\w./-])/i`), everything else untouched,
  `npx vitest run tools/downloader/resolvers` → exit 1,
  `4 failed | 203 passed (207)`. Three of the four are the pinned rows, failing
  because they assert the defect and the code no longer has it; the fourth is
  `"stpp.ttml.im1t" is ttml`, and that one is a real regression. So the boundary
  buys row 3 at the cost of a real DASH `codecs=` string, exactly as the brief
  says. Reverted with `git checkout --` before continuing.

  **Build 6 is right too, and it is measured.** Rows 2 and 3 swapped on the
  _unfixed_ tree, same command → exit 0, `207 passed (207)` — fully green — and
  the probe on that tree reproduces the brief's table verbatim, both rows
  `srt` → `ttml`. So nothing pinned that order before this ticket. (The brief's
  counts say 199; the table has grown since dl-25 and the suite is 207 on this
  base. Nothing else about the measurement differs.)

  **The decision: Build 4 option (b), normalise inside `subtitleFormat`.**
  A new `claimsOnly(hint)` rewrites every whitespace-separated token that is
  URL-shaped (`^[a-z][a-z0-9+.-]*://`) to `urlExtension(token)` plus its query
  string, and leaves every other token — mime types, codecs, bare extensions —
  alone. Rows 1–4 are byte-for-byte unchanged, including row 3's unanchored
  shape and every `(^|\W)`. Applied with the test table still asserting the
  defect, `npx vitest run tools/downloader/resolvers` → exit 1,
  `3 failed | 204 passed (207)`, and the three are exactly the three pinned
  rows. That is the brief's claim for option (b) — "turns exactly those rows red
  and nothing else" — measured rather than taken.

  **Build 2 was not done, deliberately, and here is what that costs.** Option
  (b) makes the `tools/downloader/resolvers/src/manifest/dash.ts:338` change
  redundant for the host and the path: the
  hint may keep carrying the whole `fileUrl` because no row ever sees it. What
  option (b) does _not_ close is the query string, which it keeps on purpose
  (Build 3's `&fmt=vtt`), so `application/mp4 https://cdn.net/sub.mp4?x=ttml`
  still answers `ttml` — measured. Build 2's `urlExtension(fileUrl)` would have
  closed that for DASH alone, at the price of a second mechanism doing the same
  job in a different place and of a DASH claim that lives in a query being
  dropped. I judged one mechanism worth more than that one edge, pinned the
  edge as a table row so narrowing it later is a decision rather than an
  accident, and am recording the call here rather than leaving it silent. It
  did not seem worth a follow-up ticket: it is the accepted side of a trade the
  code now states, not an unclosed defect.

  **Folded in, because this change made them free** (the fold-in the
  orchestrator asked to be told about either way): Build 1's cheap improvement —
  `stpp.ttml.im1t` had no fixture anywhere, only one unit row — and the
  `dash.ts`-level test Build 4's option (a) would have required. Two text
  `AdaptationSet`s were added to
  `test/fixtures/manifests/dash-ondemand-baseurl.mpd`: one with
  `codecs="stpp.ttml.im1t"` (parses to `ttml` through `parseDash`, so the string
  that rules out the boundary is now evidenced by a manifest) and one with no
  codecs on an `stpp`-named absolute `BaseURL` (parses to `unknown`; it was
  `ttml` before this change). Both assert through `parseDash`, not
  `subtitleFormat`.

  **Done-when 4 — pinned, and the pin is mutation-checked.** The new row is
  `["application/x-subrip https://cdn.net/s/sub.ttml", "srt", …]`. With rows 2
  and 3 swapped on the finished tree, `npx vitest run tools/downloader/resolvers`
  → `1 failed | 214 passed (215)`, and the one failure is that row. Order
  restored, `215 passed (215)`.

  _Re-derived after gate 1._ These read `211/212` and `212` when first written:
  correct for the tree at `2d94dda`, and wrong the moment gate 1's F1 rows were
  added to this branch. The class, recorded because it recurred three times on
  this one ticket: **a count of a branch's own tests is invalidated by adding a
  test to that branch**, so it is only safe when re-derived in the pass that
  could have invalidated it — not in the pass that happens to notice it.

  **Two things the brief had wrong, both about what the fix leaves behind.**

  Build 5 says that after the fix "the remaining reason order is load-bearing is
  the unanchored `subrip` alternative alone (`https://cdn.net/subrip/sub.vtt`
  matches rows 1 and 2 both)". That example does not survive the fix:
  `claimsOnly` reduces it to `vtt`, so it matches row 1 only and answers `vtt`
  under either order — measured on the finished tree. The `subrip` alternative
  is still unanchored, but a path segment can no longer reach it.

  Build 6's second measured row goes the same way. With the fix in place and
  rows 2 and 3 swapped, `text/srt https://cdn.net/ttml/sub.srt` answers `srt`,
  not `ttml` — the `/ttml/` path segment is gone before any row is scanned. Only
  the first of the brief's two rows is still order-dependent, because it is the
  only one whose competing claims are both genuine (a `subrip` mime type against
  a `.ttml` extension). That is the one that is pinned; the comment at
  `common.ts` now says the order decides between two real claims rather than
  between a claim and a hostname.

  **A behaviour change I introduced that the brief did not ask for, pinned
  rather than left silent.** `claimsOnly` drops the fragment as well as the host
  and the path, so `https://cdn.net/sub.mp4#fmt=vtt` is now `unknown` where it
  was `vtt`. A `#` never reaches the server, so nothing can have used it to
  state a format; the row and a sentence in the comment say so.

  Two smaller corrections to the `common.ts` comment, both measured with
  `urlExtension` directly: `.../sub.srt/download` and `sub.srt.gz` are `unknown`
  before dl-25's lookahead is consulted at all (their extensions are `undefined`
  and `gz`), so `sub.srt-v2` is the only one of the three pinned "dl-25 cost"
  rows that still exercises the boundary. And the boundary is still doing real
  work despite `claimsOnly`: `srt.cdn.net/sub.mp4` with no scheme is not
  URL-shaped, passes through untouched and answers `unknown` only because of the
  lookahead.

  **Gates.** `npm run check` → exit 0. `npm test -- --project downloader` →
  exit 0, `50 passed (50)` files, `746 passed (746)` tests. The `packages`
  project was run too, since the repo-wide source scans live there → exit 0,
  `11 passed (11)`. `npm run format` was run for this file, and `npm run check`
  re-run after it → exit 0.

  **Not measured, and not inferred.** No yt-dlp was run against a live site, so
  Build 3's premise — that yt-dlp subtitle URLs routinely carry the format in
  the query string — is _still_ unmeasured, exactly as dl-25 left it. Nothing
  here depends on it being true:
  `tools/downloader/resolvers/src/resolvers/ytdlp.ts:256` is untouched and
  `claimsOnly`
  keeps query strings, so the behaviour that premise argues for is preserved
  either way, and the timedtext row proves only what the classifier answers, not
  what yt-dlp emits. No live DASH manifest and no real CDN were touched; the
  whole of this is the classifier, `parseDash` over checked-in fixtures, and the
  table. The Playwright e2e suite was not run; `grep -rin "subtitle\|caption"
tools/downloader/e2e/` returns nothing, so there is no subtitle path in it to
  exercise, but that is an argument from the specs' text and not from a run.
