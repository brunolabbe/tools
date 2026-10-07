---
id: dl-99
tool: downloader
title: A variant with undeclared codecs, chosen as WebM, is copied as H.264 and refused
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-99 — An undeclared codec is copied into WebM and refused

## Why

Found on 2026-10-07 while writing a test for dl-96. A progressive variant the
browser tier found has a size and usually no codecs. When the visitor chooses
WebM for it, the job fails with "The download failed partway through."

`containerSupports` (`engine/src/mux.ts`) returns `true` for an undeclared
codec, so `buildOutputArgs` copies it. ffmpeg then refuses H.264 or AAC in WebM
before writing a byte:

```
[webm @ 0x…] Only VP8 or VP9 or AV1 video and Vorbis or Opus audio and WebVTT subtitles are supported for WebM.
[out#0/webm @ 0x…] Could not write header (incorrect codec parameters ?): Invalid argument
```

**Reproduced on `main` at 10529a84 with the engine alone.** A 4 s H.264/AAC
MP4 was served from a local origin. A variant with `protocol: "progressive"`,
`hasVideo`, `hasAudio` and no `videoCodec` or `audioCodec` was streamed with
`options: { container: "webm" }`. The result was exit 234, `DOWNLOAD_FAILED`,
and the stderr above. The same variant with `videoCodec: "avc1.42c01e"` and
`audioCodec: "mp4a.40.2"` transcodes to VP9/Opus and completes. That case is
dl-96's "a transcode: H.264 into WebM" test.

Copying an undeclared codec is right for MP4 and MKV, where an unknown
progressive file is nearly always H.264/AAC and a copy is lossless. It is wrong
for WebM, which holds almost nothing such a file carries.

## Decisions

Taken by the owner on 2026-10-07. The rule is about a variant whose codecs are
undeclared and whose output container is WebM. MP4 and MKV are unchanged.

1. **A WebM source is copied.** Progressive variants already carry `container`,
   taken from the Content-Type or the URL extension (`containerOf` in
   `resolvers/src/browser/variants.ts`, and `direct.ts`). WebM can hold only
   VP8, VP9 or AV1 video and Vorbis or Opus audio, so a source whose container
   is `webm` copies into WebM losslessly. `containerSupports` ignores that field
   today.
2. **An MP4 source declares its codecs from its header.** `mp4-header.ts`
   (dl-64, today run only by the yt-dlp tier) reads the sample entries for
   progressive MP4 variants that carry no codecs, at two ranged reads per
   variant. Once the codecs are declared, the existing transcode path takes an
   H.264/AAC source into VP9/Opus.
3. **Any other source is refused for WebM.** That covers an unknown container
   and an MP4 whose header read fails. The job fails with a typed error that
   says why, and the UI does not offer WebM for that variant, so the visitor
   picks MP4. Any source is still offered MP4 and MKV.

Considered and not taken: transcoding every undeclared source (slow VP9 on the
host, and a WebM source re-encoded for nothing).

## Build

Reproduce first, as a stream test in `engine/test/stream.test.ts`, appended at
the end, with the undeclared variant above into WebM.

## Done when

- The reproduction above, an undeclared H.264/AAC MP4 into WebM, completes as
  VP9/Opus because its codecs are now read from the header.
- An undeclared variant with `container: "webm"` into WebM is a stream copy,
  asserted from the ffmpeg arguments, and completes.
- An undeclared variant with an unknown container, and an MP4 whose header read
  fails, are refused for WebM with a typed error before ffmpeg starts, and the
  variant does not offer WebM in the UI.
- Each case has a test that fails if its branch is removed.

## Log

**2026-10-07** — filed from dl-96's session; the owner chose a ticket over
widening dl-96.

**2026-10-07** — decisions taken by the owner. They asked why a WebM source
should need transcoding at all. It does not: the failure is the copy of a
_non_-WebM source, and the variant's existing `container` field tells the two
apart. The options for a non-WebM source were refusing WebM and hiding it,
transcoding, or reading the MP4 header. They chose the header read for MP4, and
then refusing and hiding WebM for everything else over transcoding it.
