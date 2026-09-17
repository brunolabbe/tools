---
id: dl-64
tool: downloader
title: A progressive format yt-dlp describes only by height shows no codec, audio, bitrate or size
kind: fix
status: done
milestone: null
depends_on: []
difficulty: hard
---

# dl-64 — bare progressive rows show nothing but their height

**Packages:** `resolvers` (`size-sample.ts`, `resolvers/ytdlp.ts`, a new MP4
header reader beside `size-probe.ts`). No `contract` change: every field this
fills already exists on `MediaVariant`.

## Why

Reported by the owner on 2026-09-16, on the same page as dl-62. The page is
deliberately not named anywhere, at the owner's request; the fixture dl-62
committed, `resolvers/test/fixtures/ytdlp/extractor-null-fps.json`, already has
its shape with every identifying value rewritten.

The probe succeeds with 14 renditions and the picker reads as seven rows
duplicated: `2160p · — · — · — · — · PROGRESSIVE`, then `2160p · av1 · — · — · —
· PROGRESSIVE`, and so on down to 240p. **They are not duplicates.** Each height
is two distinct files, and yt-dlp's site extractor reports for each nothing but
`url`, `ext: mp4`, `height`, and — on the AV1 copy only — `vcodec: av1`. No
`width`, no `acodec`, no `tbr`/`vbr`/`abr`, no `filesize`.

Measured against the live files on 2026-09-16 (240p pair):

| format | `ffprobe` streams                      | `HEAD` `content-length` |
| ------ | -------------------------------------- | ----------------------- |
| plain  | h264 video 253 kb/s, aac audio 48 kb/s | 11,208,534              |
| `av1-` | av1 video 197 kb/s, aac audio 48 kb/s  | 9,173,078               |

So every blank column is knowable, and two of them are cheap:

1. **Size is blank because of us, not the site.** `measureVariantSizes` in
   `size-sample.ts` picks its one reference rendition from variants with
   `bitrateBps > 0`. None has one, so it returns the list unchanged **without
   sending a request** — although a `HEAD` on a progressive file answers the
   exact byte count, and `durationSec` is known (yt-dlp reports `duration`).
   The scale-from-one-reference design is right for an HLS ladder and wrong
   for a set of plain files, each of which can simply be asked.
2. **Codecs and audio are blank because yt-dlp does not say**, and dl-42
   rightly refuses to guess `hasAudio`. The file's own `moov` says.
3. **Bitrate follows from 1:** exact bytes × 8 ÷ duration is the file's average
   bitrate, a measurement rather than a declaration.

Without the codec, the picker cannot show what separates a pair, which is the
dl-40 complaint arriving by a different road: there the rows were duplicates,
here they differ in a field nobody filled.

### Measurements that shape the build

Ranged reads of the first 64 KiB of three of the files:

- **The H.264 files are faststart**: `ftyp@0(32) moov@32(247844)` at 240p,
  `moov@32(316387)` at 2160p. One ranged read reaches `stsd`, but it has to be
  sized from the `moov` box header, not a fixed 64 KiB — `moov` is ~250–320 KiB.
- **The AV1 files are not**: `ftyp@0(32) free@32(8) mdat@40(8916437)`. `moov` is
  at the tail; reaching it costs a second ranged read, placed from `mdat`'s
  declared size (offset 40 + 8,916,437) against the file's `content-length`.
- **`avc1` appears in the first 32 bytes of the H.264 file — as an `ftyp`
  compatible brand.** A brand is not a codec. Reading it as one would label an
  AV1 file carrying an `avc1` brand as H.264. Only the sample entry fourcc in
  `moov/trak/mdia/minf/stbl/stsd` counts.

Estimated cost for this page: ~21 ranged requests and ~4 MB across 14 rows.

### Decided

Owner, 2026-09-16, between a TypeScript `moov` reader over the size probe's
guarded fetch, `ffprobe` per row through dl-11's proxy, and filing undecided:
**the TypeScript reader.** It reuses the SSRF-checked, pinned fetch the size
probe already has, needs no subprocess and no ffprobe path threaded into a
library; it covers MP4/MOV only, and any other container stays `—`.

## Build

1. **Size every bare progressive variant, not one reference.** In
   `measureVariantSizes`, when no variant qualifies as a bitrate reference,
   `HEAD` (via the existing `SizeProbe.contentLength`, with its ranged
   fallback) each `protocol: "progressive"` variant that has no
   `filesizeBytes` and whose `audioUrl` is absent. Set `filesizeBytes` exact
   (`filesizeIsEstimate: false`). The HLS/DASH reference-and-factor path is
   untouched. Bound concurrency (a small constant, e.g. 4), stop on
   `options.signal`, and treat each row's failure as that row staying blank —
   one refused `HEAD` must not blank the others or fail the probe.
2. **Derive `bitrateBps`** for exactly those rows from the exact size and
   `durationSec`, only when `bitrateBps` is absent and duration is known and
   positive. Never overwrite a reported bitrate.
3. **Add an MP4 header reader** (`resolvers/src/mp4-header.ts`) that, given a
   ranged-read function, returns `{ videoCodec?, audioCodec? }` as `stsd`
   sample-entry fourccs (`avc1`, `hvc1`, `av01`, `mp4a`, …) — the vocabulary
   `web/src/lib/variants.ts` already labels. Read the leading boxes; if `moov`
   is there, fetch it by its declared size; if `mdat` comes first, fetch the
   tail by `mdat`'s end offset. Cap the bytes it will fetch for `moov` (a
   malformed size must not become a multi-gigabyte read) and the box-walk
   depth. Ignore `ftyp` brands entirely. Handle `size == 1` (64-bit largesize)
   and `size == 0` (to end of file).
4. **Fill only what is missing.** In the yt-dlp resolver, after sizing, run
   the reader for progressive rows lacking `videoCodec` or `audioCodec` (here,
   all 14 lack audio). Set `hasAudio: true` only when an audio sample entry was
   read; an absent audio track in a parsed `moov` makes `hasAudio: false`; a
   failed or partial read leaves `hasAudio` as it was (dl-42's three states).
   A codec yt-dlp did report (`av1`) is kept — do not replace it with `av01`.
5. **The ranged reads go through the size probe's fetch**, so they carry the
   probe's request headers, its SSRF guard and its per-request timeout. Add a
   ranged-bytes method to `SizeProbe` rather than a second fetch path.
6. **Fixtures, not the network.** Extend `extractor-null-fps.json` or add a
   sibling, and build two tiny synthetic MP4s in the test (a faststart
   `ftyp`+`moov`+`mdat` with `avc1`+`mp4a`, and an `ftyp`+`mdat`+`moov` with
   `av01`+`mp4a`) served by a fake fetch honouring `Range`. Include an H.264
   file whose `ftyp` lists no `avc1` brand and an AV1 file whose `ftyp` does.

## Done when

1. A yt-dlp probe of the bare-progressive fixture returns every row with an
   exact `filesizeBytes` and a derived `bitrateBps`, where the fake server
   answers `HEAD`; a row whose `HEAD` fails stays unsized while the others are
   sized, and the probe still succeeds.
2. The same probe reports `videoCodec` `avc1` on the plain rows, keeps `av1` on
   the AV1 rows, and `audioCodec` `mp4a` with `hasAudio: true` on both.
3. The reader finds a tail `moov` behind a leading `mdat` in no more than two
   ranged reads beyond the first, and a test counts them.
4. A file whose `ftyp` carries a brand disagreeing with its sample entry
   reports the sample entry — a test proves it in both directions.
5. A `moov` or `mdat` declaring an absurd size does not cause a read beyond
   the cap; a test proves it.
6. A variant that already carries a bitrate, a size or a codec keeps it
   unchanged; the existing `size-sample` and `ytdlp` suites pass untouched.
7. An aborted signal during sizing or header reading starts no further
   requests and resolves with the probe as measured so far. It never rejects:
   the registry does not check its deadline again after a resolver returns, so
   a rejection there would turn yt-dlp's completed answer into `TIMEOUT`.

## Review

**Gate: PASS** — 2026-09-16 · `562f60c...b0c219a` · ticket-reviewer on Sonnet 5, builder on Opus 5, own defect hunt at medium depth

| Done when                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Every row sized exactly with a derived bitrate; a failing row stays blank, the probe succeeds | `resolvers/test/ytdlp-bare-progressive.test.ts:109 "row.filesizeBytes).toBe(bytes)"`, `:111 "row.bitrateBps).toBe(Math.round"`, `:148 "filesizeBytes !== undefined)).toHaveLength(13"` ✓                                                                                                                                                            |
| 2. `avc1` on plain rows, `av1` kept, `mp4a` and `hasAudio: true` on both                         | `resolvers/test/ytdlp-bare-progressive.test.ts:113 "row.videoCodec).toBe(format.isAv1"`, `:114 "row.audioCodec).toBe("` ✓ — red on `ytdlp.ts` reverted to `562f60c` (2 of 5 fail), green restored                                                                                                                                                   |
| 3. Tail `moov` in no more than two reads beyond the first                                        | `resolvers/test/mp4-header.test.ts:62 "reads.length - 1).toBeLessThanOrEqual(2)"` ✓                                                                                                                                                                                                                                                                 |
| 4. Sample entry wins over a disagreeing brand, both directions                                   | `resolvers/test/mp4-header.test.ts:90 "an AV1 file listing avc1 among its brands reports av01"`, `:96 "an H.264 file listing no avc1 brand, and av01 instead"` ✓                                                                                                                                                                                    |
| 5. An absurd declared size reads no further than the cap                                         | `resolvers/test/mp4-header.test.ts:149 "sizes a file declares are not trusted"`, `resolvers/test/size-probe.test.ts:185 "a server that ignores Range is read no further than the range"` ✓ — plus a hand fuzz (size 4 box, truncated `stsd`, 50 top-level and 2,000 `trak` siblings): no throw, no hang                                             |
| 6. Reported values kept; existing suites unedited                                                | `resolvers/test/size-sample.test.ts:564 "a size, a bitrate, or a paired audio file already there is kept"`, `resolvers/test/mp4-header.test.ts:280 "a codec, an audio answer or a size already reported is kept"`; existing test files append-only ✓                                                                                                |
| 7. An abort resolves with what was measured, never rejects                                       | `resolvers/test/ytdlp-bare-progressive.test.ts:203 "through the registry, a deadline landing mid-measurement still returns yt-dlp's answer"`, `resolvers/test/size-sample.test.ts:610 "an abort mid-way starts no further requests and rejects nothing"`, `resolvers/test/mp4-header.test.ts:225 "an abort after the first read sends no second"` ✓ |

- **low** · Done when 7 was worded as "without rejecting with anything but the abort's code", met only vacuously by code that never rejects. **Fixed** in this commit: the line now states the behaviour and why. The behaviour itself was checked against `registry.ts`, which returns a resolved probe without re-checking the deadline.
- **findings** · 1 returned, 1 fixed, 0 carried, 0 dropped.
- NFR: security ✓ (ranged reads go through the same `GuardedFetch` as the `HEAD`); performance ✓ (4-wide bound per stage, stages sequential; not measured against a real origin); reliability ✓ (no `throw` in the three touched sources; fuzzed); maintainability ✓.
- Checked clean: direct and browser tiers cannot reach the per-file branch (browser routes files through `progressiveVariants`, `direct.ts` never calls `measureVariantSizes`); no contract edit, no shell, no `console`; the diff carries only `example.com` hosts, and no identifying value of the reproducing page.

## Log

- 2026-09-16 — Filed from a live reproduction; page, host and ids withheld at
  the owner's request. Codec approach decided by the owner (see **Decided**).
- 2026-09-16 — Built (Opus 5). `size-sample.ts` sizes each bare progressive
  file when no reference qualifies (`sizeEachFile`, concurrency 4 via
  `mapBounded`); `size-probe.ts` gains `bytes()`; the new
  `resolvers/src/mp4-header.ts` reads `moov` (`readMp4Tracks`) and fills
  variants (`describeProgressiveTracks`), called from `ytdlp.ts` after sizing.
  Every test is synthetic, with `media.example.com` URLs: MP4s are built box by
  box in `resolvers/test/helpers/mp4.ts`, and `extractor-null-fps.json` is used
  as it is, not extended. No real site was fetched.
  - **Done when → tests.** 1: `ytdlp-bare-progressive.test.ts` "every row is
    sized exactly…" and "a file refusing every request stays blank…", with
    `size-sample.test.ts` "every file is asked its size…" and "a file that will
    not answer stays unsized…". 2: the same first resolver test. 3:
    `mp4-header.test.ts` "a tail moov behind a leading mdat…", checked with and
    without a known total. 4: "an AV1 file listing avc1…" and "an H.264 file
    listing no avc1 brand, and av01 instead…". 5: the four tests under "sizes a
    file declares are not trusted", plus `size-probe.test.ts` "a server that
    ignores Range…". 6: `size-sample.test.ts` "a size, a bitrate, or a paired
    audio file already there is kept…", `mp4-header.test.ts` "a codec, an
    audio answer or a size already reported is kept"; the existing suites pass
    unedited. 7: the three tests under "an abort while measuring a bare ladder",
    plus `size-sample.test.ts` "an abort mid-way…" and `mp4-header.test.ts` "an
    abort after the first read sends no second".
  - **Mutations run, and each failed the tests named:** dropping the `moov`
    cap failed both cap tests. Throwing `toAbortError` after enrichment failed
    all three abort tests. Letting the file's fourcc replace a reported codec
    failed the resolver test and the "kept" test.
  - **What the brief had wrong, or left open:**
    - **`SizeProbe.bytes` is optional, not required.** The browser tier's probe
      cannot keep a ranged read's bound: Playwright's `APIResponse` hands over a
      body it has already read in full, so a server ignoring `Range` would hand
      it the whole file. Without `bytes`, codecs stay as the tier reported them.
      The fetch-backed `bytes()` reads a stream no further than the range, and
      refuses a 200 for a range that does not start at zero.
    - **Done when 7 is met by resolving, not rejecting.** An early draft threw
      the abort's code after enrichment. The registry returns a resolved probe
      as it stands and does not check the deadline again, so that throw would
      turn a successful yt-dlp answer into `TIMEOUT` whenever the deadline fell
      during measurement. dl-30's sampling already returned quietly on abort.
      Both steps now stop starting requests and return what they have. A
      registry-level test pins this with an origin that never answers.
    - **The request estimate is 28 ranged reads for this page, not ~21.** The
      measured faststart `moov`s (242–309 KiB) are larger than the 64 KiB first
      read, so each file costs two reads. A tail `moov` also costs two, because
      when the rest of the file fits the cap, the second read goes to the end of
      the file. Add 14 `HEAD`s.
    - **`hasAudio: false` needs every track classified.** A `trak` without a
      readable `hdlr` leaves `hasAudio` unset rather than false. Protected
      entries (`encv`/`enca`) name no codec, though an `enca` still counts as
      audio.
    - **Depth is bounded by construction.** The walk inside `moov` follows one
      fixed path and never recurses, so there is no depth counter. The limits
      are `MAX_CHILDREN` per level, `MAX_TOP_LEVEL_BOXES`, and `MAX_READS` (4)
      per file. The `moov` cap is 16 MiB.
    - **Rows are re-sorted after enrichment.** Measured bitrates break ties
      within a height, and the mapper promises best-first. This is a small
      widening.
    - **A mixed list still takes the dl-30 path, as the brief scoped it.** If
      one progressive row carries a bitrate and a duration, it becomes the
      reference, and bare rows beside it stay unsized.
      `size-sample.test.ts` had to strip durations to exercise the per-file
      path for a row that has a bitrate.
    - **Files that are not ISO BMFF, or have a paired `audioUrl`, are not read.**
      A known non-MP4 `container` is skipped. A paired `audioUrl` would make a
      missing audio track in this file mean nothing.
    - The direct and browser tiers call `measureVariantSizes` only on
      manifest-parsed (HLS/DASH) variants, so the per-file path does not reach
      them. This comes from reading the call sites, not from a test.
  - **Not measured:** real latency added to a probe, and `GuardedFetch`'s
    behaviour with a `Range` header against a real origin. The new resolver
    test lives in its own file, so no import is added to `ytdlp.test.ts`,
    whose line numbers merged gate records cite.
- 2026-09-16 — Gated PASS with one low finding (Done when 7's wording), fixed
  by rewording the line to the behaviour the builder chose and the gate
  confirmed against `registry.ts`.
