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

### Additions, 2026-10-07

Taken by the owner after the first build, on the builder's two open decisions.

4. **The refusal keeps its own code.** Question: decision 3 says "a typed error
   that says why"; the builder added `CONTAINER_UNSUPPORTED` (non-retryable,
   HTTP 422, its own UI copy). Keep it? Options: keep it (recommended), or
   reuse `DOWNLOAD_FAILED` as not retryable. Chosen: **keep
   `CONTAINER_UNSUPPORTED`**. No code change.
5. **Manifests are judged too.** Question: the first build judged progressive
   variants only, so an HLS or DASH variant with undeclared codecs chosen as
   WebM still failed inside ffmpeg after starting. What should happen? Options:
   refuse and hide WebM for them too; leave it and note it in the Log
   (recommended); leave it and file a ticket. Chosen: **refuse and hide WebM
   for them too**, overriding the recommendation. The same `canMakeWebm` rule
   applies to every protocol: refused with `CONTAINER_UNSUPPORTED` before any
   origin request, and not offered in the picker. A manifest stream whose
   undeclared codecs happen to be VP9/Opus loses WebM; a manifest variant with
   declared codecs is unchanged.

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

**2026-10-07** — built on `9dcf0f6f` (branch `dl-99-webm-undeclared-codecs`).

- **Reproduced again on the base**, with the engine alone (a 4 s H.264/AAC
  faststart MP4 from a loopback origin, `options: { container: "webm" }`):
  `stream()` resolved at its first byte and `done` rejected `DOWNLOAD_FAILED`,
  exit 234, `Only VP8 or VP9 or AV1 video and Vorbis or Opus audio …`. One
  correction to the Why: the visitor is not refused before a byte — the WebM
  header's 253 bytes reach the response first, then the body errors. Red test:
  `engine/test/stream.test.ts`, "dl-99: … the reproduction", 3 of 3 refusal
  cases failed (`expected null not to be null`, i.e. the stream opened).
- **Where each decision lives.**
  1. A WebM source and the picker's rule: `canMakeWebm` in
     `contract/src/media.ts`, one pure function that both the engine
     (`assertContainerCanHold`, `engine/src/mux.ts`, one call in `openStream`)
     and `ProbePanel` ask, so what is offered is what the server accepts.
  2. The header read runs in `api/src/resolvers.ts`
     (`describingProgressiveTracks`), a wrapper over the **browser and direct**
     tiers, using `describeProgressiveTracks` over the guarded fetch and the
     probe's own replayed headers. Not in `resolvers/src/browser/`: that tier's
     request probe cannot ask for a range, and dl-81 is open on it. The yt-dlp
     tier already ran it (dl-64) and is not wrapped. The engine cannot import
     the resolvers, so it never reads a header itself.
  3. Refusal: a new code `CONTAINER_UNSUPPORTED` (contract, 422 in
     `http-errors.ts`, copy in `error-presentation.ts`), not retryable.
- **Judgement calls the brief did not settle**, for the owner to overrule:
  a new error code rather than `DOWNLOAD_FAILED` with `retryable: false`
  (that code's UI copy says "flaky CDN, try again", which is the wrong advice);
  the rule judges **progressive** variants only, so an HLS or DASH variant with
  undeclared codecs is still copied into WebM and still fails in ffmpeg;
  `audioOnly` ignores the video's codec.
- **A side effect that needed fixing.** Declaring codecs from a header changes
  MP4 output too: `containerSupports` treats a recognised-but-unlisted codec as
  unsupported, so an `ac-3` or `mp4v` sample entry would now be transcoded for
  MP4 where it used to be copied. `normalizeCodecName` gains `ac-3` and `mp4v`
  aliases; `mux-args.test.ts` pins the fourccs MP4 holds.
- **Cost.** Two ranged reads per undeclared MP4 variant on every probe, and
  again on the re-probe of a job, for the browser and direct tiers.
- **Fold-in considered, not done:** the same refusal for HLS/DASH variants. No
  container field says what a manifest holds, so there is no decided rule to
  apply; left as an open question for the owner. **Superseded below.**

**2026-10-07 (second round)** — the owner answered both open decisions
(Decisions, additions 4 and 5): the new code stays, and manifests are judged.

- `canMakeWebm` lost its `protocol !== "progressive"` early return, so HLS and
  DASH go through the one rule the engine refuses by and the picker hides by.
  The header read is unchanged and still applies to progressive MP4 only.
- Tests, each shown to fail with its branch removed (contract `dist` rebuilt
  before the engine and web runs, since both read it):
  - the progressive-only guard put back: 4 failed, 73 passed of 77 —
    `can-make-webm.test.ts` "a manifest variant is judged by the same rule",
    `probe-panel.test.tsx` "a manifest variant is judged by the same rule …",
    `stream.test.ts` "HLS is refused …" and "DASH is refused …" (zero origin
    requests asserted);
  - the `ProbePanel` filter removed: 3 failed of 23 (the three WebM-offer
    tests); the fall-back to MP4 alone removed: 1 failed of 23.
- A declared H.264/AAC HLS variant still transcodes to VP9/Opus (real stream,
  `stream.test.ts`), and a manifest variant declared VP9/Opus is not refused and
  is copied (arguments asserted: no `-c:v`, no `-c:a`). The copied case is
  asserted from the arguments, not by streaming, because no fixture here is a
  VP9/Opus manifest.
