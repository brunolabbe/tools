---
id: dl-28
tool: downloader
title: The vtt and ttml rows still read a hostname as a format claim
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-28 — the remaining `SUBTITLE_FORMATS` rows read a URL as a format claim

**Packages:** `resolvers` (`common.ts`, and whichever caller stops passing a URL).

## Why

dl-25 fixed the `srt` row: its token now has to _end_ a claim rather than
continue into a hostname label or a path segment. Rows 1 and 3 were left
matching their tokens anywhere in the hint, so the same defect is still live
there. Pinned as expectations in
[`common.test.ts`](../../resolvers/test/common.test.ts), which currently
asserts the **wrong** answers on purpose so this ticket has a failing target to
flip:

```
"application/mp4 https://stpp.cdn.net/sub.mp4"  -> ttml  ✗  should be unknown
"application/mp4 https://cdn.net/ttml/sub.mp4"  -> ttml  ✗  should be unknown
"application/mp4 https://cdn.net/dfxp/sub.mp4"  -> ttml  ✗  should be unknown
"application/mp4 https://vtt.cdn.net/sub.mp4"   -> vtt   ✗  should be unknown
```

The `vtt` one is the one that reaches the disk, and it is why this is a `fix`
rather than a chore. `SUBTITLE_FORMATS_FFMPEG_READS` at
[`engine/src/index.ts:119`](../../engine/src/index.ts) is `{"vtt", "srt"}`, so a
`vtt` answer means the track is fetched, written as `sub-<i>-<lang>.vtt` and
handed to ffmpeg as a subtitle stream — a real wrong download of something that
is not a subtitle. That is exactly the blast radius dl-25 closed for `srt`, and
`vtt.cdn.net` is at least as plausible a CDN label as `srt.cdn.net`. The three
`ttml` answers are the milder half: `ttml` fails that gate, so those tracks are
dropped rather than downloaded.

## Build

1. **dl-25's boundary cannot be reused here, and this is the whole difficulty.**
   Row 2 took `(?![\w./-])` — the token may not continue into a `.`, `-` or `/`.
   Row 3 cannot: `stpp.ttml.im1t` is a real DASH `codecs=` string whose dots
   separate a claim, and `stpp.cdn.net` is a hostname whose dots do not. Both
   are `stpp` followed by `.`, so no token-level boundary tells them apart. It
   is checked in the table already — apply dl-25's lookahead to row 3 and
   `["stpp.ttml.im1t", "ttml"]` goes red. Verify that before designing anything.

2. **So the fix is to stop putting a whole URL in the hint**, which is the
   option dl-25 weighed and did not take.
   [`dash.ts:338`](../../resolvers/src/manifest/dash.ts) builds
   `` `${mimeType} ${codecs} ${fileUrl}` ``; passing
   `` `${mimeType} ${codecs} ${urlExtension(fileUrl) ?? ""}` `` keeps every real
   claim (mime type, codec, extension) and drops the host and the path.
   `urlExtension` is already in `common.ts`.

3. **`ytdlp.ts:256` is the caller that must _not_ get the same treatment**, and
   dl-25 established this by counterexample. It passes `chosen.ext ?? chosen.url`,
   and yt-dlp subtitle URLs routinely carry the format in the **query string** —
   a YouTube timedtext URL ends `…&fmt=vtt`. Reducing that URL to its path
   extension answers `unknown` where it answers `vtt` today, which is a
   regression, not a fix. Leave it passing the URL, and accept that a hint from
   this caller can still contain a hostname.

4. That acceptance is the reason step 2 alone does not close the class, and the
   ticket has to say which it is buying:
   - fix `dash.ts` only, and the four pinned cases go green because they are all
     DASH-shaped — but a ytdlp URL on an `stpp`-named host is still wrong; or
   - normalise inside `subtitleFormat`: reduce any whitespace-separated token
     that is URL-shaped (`^[a-z][a-z0-9+.-]*://`) to `urlExtension` **plus its
     query string**, so `?fmt=vtt` survives and `stpp.cdn.net` does not. This
     closes it for every caller and every row at once, and is the only variant
     that lets rows 1 and 3 keep their current unanchored shape honestly.

   Decide and record it in the Log.

5. **Rewrite the ordering paragraph** at
   [`common.ts:223`](../../resolvers/src/common.ts). It currently names this
   ticket and explains why row 3 could not take row 2's boundary. If the fix
   lands, the remaining reason order is load-bearing is the unanchored `subrip`
   alternative alone (`https://cdn.net/subrip/sub.vtt` matches rows 1 and 2
   both) — say that, and delete what is no longer true.

6. **Flip the four pinned expectations** in `common.test.ts` to `unknown` and
   delete the comment block above them that tells the reader not to.

Trap: do not drop `|subrip` from row 2, and do not drop a `(^|\W)` from any row
— dl-24 was exactly that mistake.

## Done when

1. All four hints in the Why classify as `unknown`, proven by the table in
   `common.test.ts` with the pinned wrong answers flipped.
2. `stpp.ttml.im1t`, `application/ttml+xml`, `wvtt`, `text/vtt` and every other
   existing row of that table still pass unchanged.
3. A ytdlp-shaped hint whose format lives in the query string
   (`https://www.youtube.com/api/timedtext?lang=en&fmt=vtt`) classifies as
   `vtt`, proven by a test — whichever option step 4 chose.
4. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-23** — Filed from dl-25, which fixed row 2 and stopped there. Row 3
  was in dl-25's Done-when as "fix it or file it"; it is filed, because the
  boundary that fixed row 2 provably breaks row 3 (`stpp.ttml.im1t`) and the
  alternative is a caller change dl-25 had no mandate for. Row 1 is this
  builder's own finding while writing dl-25's ordering comment: it is exposed
  identically and is the more damaging of the two, since `vtt` passes the
  `SUBTITLE_FORMATS_FFMPEG_READS` gate and `ttml` does not. It is folded in here
  rather than filed separately because one fix closes all of it. The `ytdlp.ts`
  constraint in Build 3 is measured only by reading yt-dlp's output shape and
  the code — no yt-dlp run was made against a live site to confirm the
  `fmt=vtt`-in-query case, and it should be confirmed before relying on it.
