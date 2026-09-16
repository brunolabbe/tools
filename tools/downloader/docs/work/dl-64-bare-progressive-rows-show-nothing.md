---
id: dl-64
tool: downloader
title: A progressive format yt-dlp describes only by height shows no codec, audio, bitrate or size
kind: fix
status: ready
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
7. An aborted signal during sizing or header reading ends the work without
   rejecting the probe with anything but the abort's own code.

## Log

- 2026-09-16 — Filed from a live reproduction; page, host and ids withheld at
  the owner's request. Codec approach decided by the owner (see **Decided**).
