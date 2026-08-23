---
id: dl-24
tool: downloader
title: Classify a subtitle by its codec, not by the last two letters of the hint
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-24 — `wvtt` is WebVTT, and `subtitleFormat` calls it TTML

**Packages:** `resolvers` (`common.ts`, `manifest/dash.ts`).

## Why

CodeQL flagged the third row of `SUBTITLE_FORMATS` in
[common.ts:226](../../resolvers/src/common.ts) —
`/ttml|dfxp|stpp|tt$/i` — for mixed anchoring
(`js/missing-regexp-anchor`, alert 4). The precedence warning on its own is
arguable: `tt$` is there to catch a `.tt` extension and the anchor is
deliberate. What is not arguable is what the table does when you feed it the
codec strings it exists to read:

```
"wvtt"                                    -> ttml     ✗  should be vtt
"application/mp4 wvtt https://…/sub.mp4"  -> unknown  ✗  should be vtt
"application/mp4 stpp https://…/sub.mp4"  -> ttml     ✓
"text/vtt https://…/sub.vtt"              -> vtt      ✓
```

`wvtt` and `stpp` are the ISO-BMFF sample-entry codes for WebVTT and TTML in
fragmented MP4 — the pair a DASH manifest carries in `codecs=`, and precisely
the input [dash.ts:338](../../resolvers/src/manifest/dash.ts) builds its hint
from. `stpp` is in the table. `wvtt` is not, and falls through two rows to be
answered wrongly or not at all.

Two independent faults produce that, and a fix that addresses one leaves the
other:

1. **The `vtt` row cannot see `wvtt`.** `(^|\W)(web)?vtt(\W|$)` requires a
   non-word character before `vtt`; in `wvtt` the preceding character is `w`.
   The row spells out `web` as an optional prefix and forgot the other one.
2. **The `ttml` row catches anything ending in `tt`.** With the hint reduced to
   the bare codec, `tt$` matches `wvtt` and answers `ttml`. With the DASH hint —
   codec in the middle, URL at the end — nothing matches at all, which is why
   the same input gives two different wrong answers depending on the caller.

**Blast radius today is a wrong label, not a wrong download.** `mux.ts` picks
its subtitle codec from the output container (`mov_text` / `webvtt` / `srt`),
not from `SubtitleTrack.format`, and the UI counts tracks and lists languages
without reading it. So nothing currently mis-muxes. That is the reason this is a
`fix` and not an incident — and also the reason it has survived: **no test
anywhere calls `subtitleFormat`.** The function has four branches, three
callers, and zero direct coverage.

## Build

1. **Pin the current behaviour before changing it.** Add a table-driven test for
   `subtitleFormat` in `tools/downloader/resolvers/test/` covering every row,
   both hint shapes (bare codec, and the `mimeType codecs fileUrl` triple
   `dash.ts` builds), and the four return values. Write the wrong answers down
   first if it helps — the point is that the next edit to this regex table
   cannot be silent.

2. **Add `wvtt` to the `vtt` row.** The minimal change is making the prefix
   alternation cover both spellings rather than only `web`. Keep the boundary
   discipline the row already has; do not drop `(^|\W)` to make `wvtt` match,
   because that re-admits every substring the boundary was added to exclude.

3. **Give the `ttml` row the same boundaries as its siblings.** `tt$` should be
   anchored on both sides like the `vtt` and `srt` rows are, so it means "the
   hint ends in the token `tt`" rather than "the hint ends in the letters
   `tt`". Whether that is `(^|\W)tt$` or a rewrite of the row is your call;
   state which in the Log.

4. **Check the order still carries its weight.** The table is scanned in order
   and `vtt` is first, which is what makes `text/vtt` land correctly today even
   though `tt$` would also match it. After step 3 that may no longer be
   load-bearing. If the rows become order-independent, say so in a comment; if
   they do not, say _that_, because the current file does not mention it and the
   next reader will reorder them.

5. **Extend the DASH fixture.** `tools/downloader/resolvers/test/dash.test.ts`
   already asserts a `.ttml` track. Add a representation with
   `mimeType="application/mp4" codecs="wvtt"` and a `.mp4` `fileUrl`, and assert
   `format: "vtt"` — that is the case the production path actually hits, and a
   unit test on the regex alone would not have caught the `unknown` variant.

Trap worth knowing in advance: `hls.ts:278` short-circuits `m3u8`/`m3u` to
`"vtt"` before calling this function and passes a bare _extension_, not a mime
type. A change to the boundaries has to keep a bare `srt` / `vtt` / `tt`
extension working — that caller gives the regex no surrounding context at all.

## Done when

1. `subtitleFormat` returns `"vtt"` for `wvtt` and for a DASH-shaped hint
   containing `wvtt`, proven by a test.
2. `subtitleFormat` has direct coverage of every row and every return value,
   including the bare-extension shape `hls.ts` passes, proven by a test.
3. A DASH representation with `codecs="wvtt"` yields a track with
   `format: "vtt"`, proven by a test in `dash.test.ts`.
4. `stpp`, `ttml`, `dfxp`, a `.tt` extension, `srt`, `subrip` and `text/vtt` all
   still classify as they do today, proven by the table in Done-when 2.
5. CodeQL's `js/missing-regexp-anchor` alert on `common.ts` is resolved by the
   change rather than dismissed — confirm on the next `security` run.
6. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-23** — Filed from CodeQL alert 4 (`js/missing-regexp-anchor`, high,
  `resolvers/src/common.ts:226`) during a triage of the four open code-scanning
  alerts. The alert is about operator precedence; the `wvtt` misclassification
  above was found while checking whether the precedence was intentional, and is
  the reason this is a ticket rather than a dismissal. Behaviour table in the
  Why was produced by running the three patterns against the listed hints, not
  read off the source. Sibling ticket from the same triage:
  [dl-23](./dl-23-rate-limit-the-download-route.md).
- **2026-08-23** — Fixed. Both faults confirmed against the built code before
  touching it: `wvtt` -> `ttml`, `application/mp4 wvtt https://…/sub.mp4` ->
  `unknown`, exactly the Why table. New `resolvers/test/common.test.ts` pins all
  four return values over 32 hints — every row, in all three shapes its callers
  build (bare extension from `hls.ts`, the `mimeType codecs fileUrl` triple from
  `dash.ts`, a whole URL from `ytdlp.ts`) — and was red on 5 of them before the
  fix. `dash.test.ts` gained a second text AdaptationSet in
  `dash-ondemand-baseurl.mpd` (`mimeType="application/mp4" codecs="wvtt"`,
  `.mp4` BaseURL) asserting `format: "vtt"`; it was red with `unknown`.

  Step 3 asked which shape the `ttml` row took. Neither of the two it offered:
  the row was **split in two**, `[/ttml|dfxp|stpp/i, "ttml"]` and
  `[/(^|\W)tt$/i, "ttml"]`. `(^|\W)tt$` inside the original alternation would
  have closed the `wvtt` fault but left the regex mixed-anchored — the shape the
  CodeQL alert is about, now with `^` in it as well as `$` — and giving the
  whole alternation the siblings' `(^|\W)…(\W|$)` would have widened `tt` from
  "ends the hint" to "appears as a token anywhere in it", which for the `dash.ts`
  caller means a URL with a `/tt/` path segment starts classifying as TTML. Two
  rows keep `ttml|dfxp|stpp` matching exactly as unanchored as it does today
  (`stpp.ttml.im1t`, the real DASH codec string, still lands), keep `tt`
  end-anchored, and leave no regex in the table with an anchor that reads as
  applying to more than it does.

  Step 4: the order is no longer load-bearing. `tt$` matching `text/vtt` was the
  one overlap, and the left boundary removes it; no token any row names is now a
  substring of another under these boundaries, so only a hint naming two formats
  at once still resolves by position. Said so in a comment above the table.

  The brief was right about everything it asserted, including that nothing calls
  `subtitleFormat` in any test (`git grep -n subtitleFormat` before the change:
  three call sites, zero tests). Two things it did not mention: the `tt$`
  over-reach was wider than `wvtt` — `xvtt`, `swvtt` and anything else ending in
  the letters `tt` answered `ttml` too, and all three now answer `unknown`; and
  the on-demand fixture's subtitle assertions had no length check, so the new
  track is pinned with `toHaveLength(2)` to stop a third one shifting the
  indices silently.

  Verified by mutation, control run first (clean tree, `npx vitest run
tools/downloader/resolvers`, exit 0): reverting the `vtt` row's prefix to
  `(web)?` alone fails 3 tests, reverting the `ttml` row to the fused
  `/ttml|dfxp|stpp|tt$/i` alone fails 3 others. Neither fix covers for the
  other, which is the thing the brief warned about.

  **Done-when 5 is not proven here.** Whether CodeQL now considers
  `js/missing-regexp-anchor` resolved can only be answered by the next
  `security` run; nothing local evaluates that query. The change removes the
  bare `$` the alert points at rather than suppressing the alert, which is the
  most that can be said from this side.
