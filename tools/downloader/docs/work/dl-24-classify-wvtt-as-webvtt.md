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

**Blast radius is a silently missing subtitle track.** ~~A wrong label, not a
wrong download.~~ — corrected during gate 1; the original claim and why it was
wrong are in the Log. `mux.ts` does pick its subtitle codec from the output
container (`mov_text` / `webvtt` / `srt`) rather than from
`SubtitleTrack.format`, and the UI does count tracks and list languages without
reading it, so nothing mis-muxes. But a third consumer reads `format` and
decides something larger:
[`engine/src/index.ts:119`](../../engine/src/index.ts) declares
`SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])`, and
[`index.ts:533`](../../engine/src/index.ts) skips any track outside that set
with a `logger.warn` and nothing else. Both of the defect's wrong answers —
`ttml` for a bare `wvtt`, `unknown` for the DASH-shaped hint — fall outside it,
and the chain from the resolver is live: `api/src/jobs/orchestrator.ts:246`
hands `probe.subtitles` straight to the `DownloadRequest`. So a DASH manifest
with `codecs="wvtt" lang="fr"`, a user who ticks "Embed subtitles" and picks
French, gets an MP4 with no French subtitle track, no error, and one warn line
in a server log nobody is reading. That is data loss, not a mislabel.

It is still a `fix` rather than an incident because it needs `wvtt` in the
manifest to bite, but the reason it survived is unchanged and is the real
lesson: **no test anywhere called `subtitleFormat`.** The function has four
branches, three callers, and had zero direct coverage.

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

## Gates

### Gate 1 — 2026-08-23 — CONCERNS

Reviewed at `5ea0fdf`. The verbatim reviewer's report is posted to the pull
request thread; this section is the record of it. **Citations below are
re-resolved against the commit that carries this section**, not against the
reviewed commit — the report's `common.ts:238` (the `srt` row) and its
`common.ts:224-234` (the table comment) both moved when finding 3 was
addressed, and are now `common.ts:242` and `common.ts:223-239`. Every other
`file:line` in the report resolves unchanged; all ten were checked
programmatically against the tip, not by eye.

| #   | Done when                                                                                               | Verdict         | Proof                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `"vtt"` for `wvtt` and for a DASH-shaped hint containing `wvtt`                                         | proven          | `common.test.ts:17`, `common.test.ts:20`                                                                                                                                                              |
| 2   | Direct coverage of every row and every return value, including the bare-extension shape `hls.ts` passes | proven          | `common.test.ts:13-53` (32 hints, all four rows, all three caller shapes); `common.test.ts:62` asserts the table reaches all four return values; bare extensions at `:15`, `:28`, `:43`               |
| 3   | A DASH representation with `codecs="wvtt"` yields `format: "vtt"`                                       | proven          | `dash.test.ts:125`, over the new AdaptationSet in `dash-ondemand-baseurl.mpd`                                                                                                                         |
| 4   | `stpp`, `ttml`, `dfxp`, `.tt`, `srt`, `subrip`, `text/vtt` all still classify as today                  | proven          | `common.test.ts:18`, `:28-31`, `:36-45`; independently brute-forced by the gate over 26,517 generated hints — 1340 diffs from `origin/main`, in exactly the four intended classes                     |
| 5   | CodeQL's `js/missing-regexp-anchor` resolved by the change, not dismissed                               | unproven (gate) | Nothing local evaluates that query. Deferred to the next `security` run. The change deletes the bare `$` the alert names rather than suppressing it, which is the strongest claim available from here |
| 6   | `npm run check` and `npm test -- --project downloader` pass                                             | verified        | Re-run by the gate in its own worktree: check exit 0, downloader 49 files / 694 tests, full suite 102 files / 1450 tests                                                                              |

**Findings, numbered as the report numbers them.**

- **1 — the ticket's blast-radius claim is false (the record, not the code). Fixed
  in this branch.** `SubtitleTrack.format` is not label-only: `index.ts:119`
  declares `SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])` and
  `index.ts:533` drops any track outside it with a `logger.warn` and no
  user-visible signal, and `orchestrator.ts:246` feeds resolver output straight
  into the `DownloadRequest`. Both wrong answers the defect produced — `ttml`
  and `unknown` — are outside that set, so the track was never downloaded.
  Verified at all three lines before writing it up. The **Why** paragraph is
  corrected in this commit and the Log says what it had wrong. This finding
  raises the fix's value rather than lowering it.
- **2 — the fix moves DASH `wvtt` tracks from "silently skipped" to "downloaded
  and handed to ffmpeg", and nothing exercises that. Recorded as unverified; no
  code change.** `index.ts:541` will now write `sub-0-fr.vtt` whose bytes are a
  fragmented MP4 carrying WebVTT samples. Neither the branch nor the gate
  verified that ffmpeg demuxes it. Stated at full strength in the Log and in
  "Unverified" below rather than argued away. One correction to the report:
  its "`-c:s webvtt` (`mux.ts:230`)" is container-dependent — `mux.ts:230`
  pushes `capability.subtitleCodec`, which is `mov_text` for the MP4 in the
  report's own scenario, `webvtt` only for webm and `srt` for mkv. The finding
  is unaffected; the path is untested either way.
- **3 — "Reordering is safe" in the table comment is stronger than the table
  supports. Fixed in this branch.** Reproduced:
  `https://srt.cdn.net/sub.wvtt` matches rows 1 and 2 both and flips `vtt` →
  `srt` when they are swapped, without the hint naming two formats. The comment
  at `common.ts:223-239` now says the order is still load-bearing and why.
- **4 — leaving the `srt` row alone was correct, and the latent defect beside it
  is real. Filed as dl-25; no change to this branch.** Reproduced on both sides:
  `"application/mp4  https://srt.cdn.net/sub.mp4"` classifies `srt` on `HEAD`
  and identically on `origin/main`, so this branch neither causes nor worsens
  it, and `srt` **passes** the `index.ts:533` gate where `ttml`/`unknown` do
  not. One case is worse than the report states —
  `"application/ttml+xml  https://srt.cdn.net/sub.ttml"`, a genuine TTML track,
  also answers `srt`, because the `srt` row is scanned before the `ttml` row.
  Both are in dl-25.

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

- **2026-08-23** — Gate 1 came back CONCERNS. Verdict recorded above as given;
  what it changed:

  **The Why was wrong about blast radius, and I had accepted it.** It said "a
  wrong label, not a wrong download", on the strength of `mux.ts` and the UI not
  reading `SubtitleTrack.format`. Both of those are true and neither is the
  whole picture: `engine/src/index.ts:119` defines
  `SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])` and `index.ts:533`
  skips every track outside it, so `format` decides whether a subtitle is
  fetched at all — and `api/src/jobs/orchestrator.ts:246` hands resolver output
  into the `DownloadRequest` untouched. `ttml` and `unknown`, the defect's two
  wrong answers, are both outside the set. A DASH manifest with `codecs="wvtt"`
  therefore lost its subtitle silently: no error, no UI signal, one
  `logger.warn`. I verified all three lines myself before rewriting the
  paragraph. **The lesson for the next reader is the one I missed too: three
  greps for `SubtitleTrack.format`'s consumers is not the same as one for
  `.format`, and the consumer that mattered was in a package the ticket's
  "Packages:" line did not name.**

  **Consequence of the fix that nothing on this branch proves.** Now that `wvtt`
  classifies as `vtt`, those tracks stop being skipped and start being
  downloaded: `index.ts:541` writes `sub-<i>-<lang>.vtt` for bytes that are a
  fragmented MP4 carrying WebVTT samples, and `mux.ts:230` passes them to ffmpeg
  as `capability.subtitleCodec` — `mov_text` for an MP4 output, `webvtt` for
  webm, `srt` for mkv. **Whether ffmpeg demuxes that file is untested here and
  was untested by the gate.** No engine test covers a `wvtt` track reaching
  `#fetchSubtitles`, and the e2e suite does not run DASH. It is plausible that
  it works — ffmpeg probes by content, not extension — but plausible is not
  proven, and I am not recording it as anything else. This is strictly better
  than the status quo either way: the alternative to a track ffmpeg might reject
  is a track that was never fetched.

  **Comment corrected.** "Reordering is safe" was too strong and I have
  rewritten it. `https://srt.cdn.net/sub.wvtt` matches rows 1 and 2 both and
  flips `vtt` → `srt` if they are swapped, so the order is still load-bearing —
  just not for the `tt$`/`text/vtt` reason it was before. What is unconditionally
  unsafe is dropping a `(^|\W)`, and the comment now says that instead.

  **Filed [dl-25](./dl-25-srt-row-matches-a-hostname.md).** The `srt` row I
  deliberately left alone has a latent defect of the same family: it matches
  `srt` as a token anywhere, so a CDN hostname triggers it —
  `"application/mp4  https://srt.cdn.net/sub.mp4"` → `srt`. Unlike `ttml` and
  `unknown`, `srt` **passes** the `index.ts:533` gate, so that one downloads a
  non-subtitle mp4 and feeds it to ffmpeg. Reproduced identically against
  `origin/main`'s table and this branch's, so it is entirely pre-existing and
  correctly out of scope here. One case is worse than the gate reported:
  `"application/ttml+xml  https://srt.cdn.net/sub.ttml"` also answers `srt`,
  because the `srt` row is scanned before the `ttml` row — a real TTML track
  mislabelled by its host. Both are in the ticket.

  Gate citations were re-resolved against this commit before the record was
  written down, which caught one that had moved: rewriting the table comment
  pushed the `srt` row from `common.ts:238` to `:242`. Everything else in the
  report still resolves.
