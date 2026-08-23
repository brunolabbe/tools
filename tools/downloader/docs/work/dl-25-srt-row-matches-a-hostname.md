---
id: dl-25
tool: downloader
title: A CDN hostname containing "srt" classifies the track as SubRip
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-25 — the `srt` row reads a hostname as a format claim

**Packages:** `resolvers` (`common.ts`).

## Why

`SUBTITLE_FORMATS`' second row is
[`common.ts:242`](../../resolvers/src/common.ts) —
`/(^|\W)srt(\W|$)|subrip/i`. It matches `srt` as a token _anywhere_ in the
hint, and [`dash.ts:338`](../../resolvers/src/manifest/dash.ts) builds that
hint as `` `${mimeType} ${codecs} ${fileUrl}` `` — a whole URL, host and path
included. A host or a path segment that happens to contain `srt` is therefore
read as a format claim:

```
"application/mp4  https://srt.cdn.net/sub.mp4"        -> srt   ✗  should be unknown
"application/mp4  https://cdn.net/srt/sub.mp4"        -> srt   ✗  should be unknown
"video/mp4  https://srt-edge.example.com/s/sub.mp4"   -> srt   ✗  should be unknown
"application/ttml+xml  https://srt.cdn.net/sub.ttml"  -> srt   ✗  should be ttml
```

`srt` is a plausible label for a CDN — SRT is also a widely used transport
protocol (Secure Reliable Transport), so `srt.cdn.example` and `/srt/` paths
exist in the wild for reasons that have nothing to do with SubRip.

**This one reaches the disk, and it is the reason the ticket is a `fix`.**
[`engine/src/index.ts:119`](../../engine/src/index.ts) declares
`SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])` and
[`index.ts:533`](../../engine/src/index.ts) skips any track outside it. `srt`
is _inside_ it. So where dl-24's wrong answers (`ttml`, `unknown`) caused a
track to be silently dropped, this one causes the opposite: a file that is not
a subtitle at all is downloaded, written as `sub-<i>-<lang>.srt`
([`index.ts:541`](../../engine/src/index.ts)) and handed to ffmpeg as a
subtitle stream. The blast radius is a wasted fetch and an ffmpeg failure or a
garbage track, not a crash — `#fetchSubtitles` catches per-track errors — but
it is a real wrong download.

The fourth row above is the sharper case: a genuine TTML track, correctly
described by its own mime type, is answered `srt` because the `srt` row is
scanned before the `ttml` row. Ordering is doing real work here, which is the
other half of why this is worth fixing rather than tolerating.

## Build

1. **Reproduce first.** The four hints above, through `subtitleFormat`. They
   behave identically on `origin/main` and on the dl-24 branch — this is
   entirely pre-existing and dl-24 neither caused nor worsened it.

2. **Decide what the row should mean, and say so in the Log.** The tension is
   that the row serves three callers with different amounts of context.
   `hls.ts:278` passes a bare extension (`srt`), `ytdlp.ts:256` passes
   `chosen.ext ?? chosen.url` — so possibly a whole URL — and `dash.ts:338`
   always passes a whole URL with a mime type in front. A boundary tight
   enough to reject a hostname must not reject the bare extension. Options
   worth weighing: anchoring the token to an extension position
   (`\.srt(\?|#|$)`) with a separate whole-hint alternative for the bare
   extension; or having `dash.ts` stop concatenating the URL into the hint at
   all and pass mime type and codec only, falling back to the URL's extension.
   The second is a larger change and touches a caller, but it removes the
   whole class rather than this instance — **`ttml`, `dfxp` and `stpp` are
   matched unanchored too, and have the same bug.** Confirmed while filing
   this: `"application/mp4  https://stpp.cdn.net/sub.mp4"` and
   `"application/mp4  https://cdn.net/ttml/sub.mp4"` both answer `ttml`. Those
   two are less damaging than the `srt` case only because `ttml` fails the
   `index.ts:533` gate and so is dropped rather than downloaded.

3. **Extend `common.test.ts`.** dl-24 added the table at
   `tools/downloader/resolvers/test/common.test.ts`; it has boundary probes but
   no hostname probes. Add the four hints above plus the `stpp`/`ttml`
   equivalents, and keep every existing row passing — that table is the
   regression net for this file now.

4. **Re-check the ordering comment** at `common.ts:223-239`. It currently
   documents this very defect as the reason the row order is still
   load-bearing. If the fix removes the overlap, that paragraph needs to change
   with it.

Trap: do not tighten the row by dropping `|subrip`, which is unanchored on
purpose and matches mime types like `application/x-subrip`.

## Done when

1. A DASH-shaped hint whose _host or path_ contains `srt` but whose mime type,
   codec and file extension do not, classifies as something other than `srt`,
   proven by a test.
2. `application/ttml+xml https://srt.cdn.net/sub.ttml` classifies as `ttml`,
   proven by a test.
3. A bare `srt` extension and `application/x-subrip` still classify as `srt`,
   proven by the existing table in `common.test.ts`.
4. The same hostname defect in the `ttml` row — confirmed present, see Build 2
   — is either fixed with it or filed separately. Answered in the Log, not left
   unstated.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-23** — Filed from gate 1 on
  [dl-24](./dl-24-classify-wvtt-as-webvtt.md). dl-24 fixed the `vtt` and `ttml`
  rows and deliberately left the `srt` row alone; the reviewer found this
  latent defect beside it and confirmed leaving the row alone was right, since
  it is pre-existing and out of that ticket's scope. Reproduced against both
  `origin/main`'s table and the dl-24 branch's — identical answers on both, so
  nothing about dl-24 is implicated. The `application/ttml+xml` case in the Why
  is one this builder found while reproducing, and is worse than the gate
  reported: it is a correctly-described subtitle being mislabelled, not just a
  non-subtitle being picked up.

- **2026-08-23** — Built. Row 2 is now
  `/(^|\W)srt(?![\w./-])|subrip/i`: the only change is the right boundary,
  `(\W|$)` → `(?![\w./-])`. `(\W|$)` let `srt` be followed by any non-word
  character, which is every hostname and path separator there is; the lookahead
  says the token may not continue into a `.`, `-` or `/`, so it has to _end_ a
  claim. `subrip` is untouched and still unanchored (the named trap), and the
  left `(^|\W)` is untouched (dl-24's trap).

  **Reproduced first, before any edit.** All four hints in the Why reproduce
  verbatim on this branch's `origin/main` base, and so do the two extra
  `stpp`/`ttml` cases:

  ```
  "application/mp4  https://srt.cdn.net/sub.mp4"       -> srt
  "application/mp4  https://cdn.net/srt/sub.mp4"       -> srt
  "video/mp4  https://srt-edge.example.com/s/sub.mp4"  -> srt
  "application/ttml+xml  https://srt.cdn.net/sub.ttml" -> srt
  "application/mp4  https://stpp.cdn.net/sub.mp4"      -> ttml
  "application/mp4  https://cdn.net/ttml/sub.mp4"      -> ttml
  ```

  **Build 2, the design decision: option 1 (anchor the token), not option 2
  (stop `dash.ts` concatenating the URL).** Two things decided it, and the
  second contradicts the brief.

  First, option 2 cannot be proven by the tests the ticket asks for. Build 3
  says extend the `common.test.ts` table with these four hints, and Done-when 1
  and 2 name hint strings and say "proven by a test". Under option 2 those
  strings are never built, so `subtitleFormat` keeps answering `srt` for all of
  them and the new rows would have to assert the defect. The acceptance and the
  regression net both live at the function, so the fix has to as well.

  Second — **the brief is wrong that option 2 "removes the whole class"**. It
  does not, for two independent reasons. `ytdlp.ts:256` passes
  `chosen.ext ?? chosen.url`, so a whole URL still reaches the matcher whenever
  yt-dlp omits `ext`; fixing only `dash.ts` leaves that caller with the same
  bug. And the obvious repair for ytdlp — reduce the URL to `urlExtension` —
  is a _regression_, because yt-dlp subtitle URLs commonly carry the format in
  the query string (a YouTube timedtext URL ends `&fmt=vtt`) and the path
  extension is nothing useful. Passing the URL is load-bearing there. Option 2
  is a partial fix wearing a total fix's description.

  **Done-when 4 — filed, not fixed: [dl-28](./dl-28-hint-carries-a-whole-url.md).**
  Row 3 provably cannot take row 2's new boundary, and this is the sharp reason
  rather than a scope judgement: `stpp.ttml.im1t` is a real DASH `codecs=`
  string whose dots separate a claim, `stpp.cdn.net` is a hostname whose dots do
  not, and both are `stpp` followed by `.`. Measured, not reasoned — applying
  `(?![\w./-])` to row 3 turns the existing `stpp.ttml.im1t` row of the table
  red. So row 3 needs the caller-side change, which is a different ticket's
  worth of work and touches `dash.ts`.

  **A finding the brief did not have: row 1 is exposed identically, and worse.**
  `subtitleFormat("application/mp4 https://vtt.cdn.net/sub.mp4")` answers `vtt`,
  and `vtt` is _inside_ `SUBTITLE_FORMATS_FFMPEG_READS`, so it has the same
  reaches-the-disk blast radius this ticket was raised for — unlike the `ttml`
  cases, which are dropped at that gate. It is left unfixed here because it is
  outside this ticket and one fix closes it together with row 3; it is folded
  into dl-28 with its own pinned test rather than left as prose.

  All four of dl-28's cases are pinned in the table as the **wrong** answers
  they currently give, under a comment saying so, so dl-28 has a failing target
  to flip rather than a paragraph to re-derive.

  **Build 4, the ordering comment: rewritten.** The overlap it documented is
  gone — `https://srt.cdn.net/sub.wvtt` no longer matches row 2 at all, so it is
  no longer an example of order deciding anything. Order is still load-bearing,
  for a narrower reason now stated instead: the alternatives that are unanchored
  on purpose, `subrip` in row 2 and the whole of row 3, so
  `https://cdn.net/subrip/sub.vtt` matches rows 1 and 2 both and answers `vtt`
  only because `vtt` is scanned first.

  **Mutation check, with its control.** Control first, on the unmutated tree:
  `npx vitest run tools/downloader/resolvers` → exit 0, 199 passed. Then the fix
  reverted to `(\W|$)` in place, same command → exit 1, `4 failed | 195 passed`,
  and the four are exactly the four dl-25 rows. Fix restored, green again. The
  harness can fail.

  Gates: `npm run check` and `npm test -- --project downloader`, both green.
  Not measured: nothing was run against a live DASH manifest or a real CDN —
  the whole of this is the classifier and its table.
