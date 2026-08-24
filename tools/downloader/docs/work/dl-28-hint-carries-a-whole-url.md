---
id: dl-28
tool: downloader
title: The ttml row still reads a hostname as a format claim
kind: fix
status: ready
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
