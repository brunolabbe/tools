---
id: dl-99
tool: downloader
title: A variant with undeclared codecs, chosen as WebM, is copied as H.264 and refused
kind: fix
status: needs-decision
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

## Decisions needed

1. **What an undeclared codec means for WebM.**
   - (a) Transcode: treat it as unsupported for WebM only. This always works,
     but VP9 is slow, and a file that was already VP9 is re-encoded for nothing.
   - (b) Learn the codec first. `resolvers/src/mp4-header.ts` already reads a
     progressive MP4's sample entries (dl-64), but only the yt-dlp tier runs it.
     This costs two ranged reads per variant at probe time.
   - (c) Refuse WebM up front for a variant with undeclared codecs, with a
     typed error that says why. This is honest and cheap, and the visitor picks
     MP4 instead.
2. **Whether the UI should offer WebM at all** for a variant whose codecs are
   unknown.

## Build

After the decision. Reproduce first, as a stream test in
`engine/test/stream.test.ts`, appended at the end, with the undeclared variant
above into WebM.

## Done when

To be written with the decision. At minimum, the reproduction above no longer
ends in `DOWNLOAD_FAILED`.

## Log

**2026-10-07** — filed from dl-96's session; the owner chose a ticket over
widening dl-96.
