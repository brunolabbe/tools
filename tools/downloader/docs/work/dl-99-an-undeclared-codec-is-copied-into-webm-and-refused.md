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

### Additions, 2026-10-08

Taken by the owner on the first gate's two open decisions.

6. **A header read that fails only at the job's probe is tried once more.**
   Question: when the origin served the ranged header read at probe time and
   403s it at the job's re-probe, the visitor was offered WebM and the job
   fails for good with the non-retryable `CONTAINER_UNSUPPORTED`, and nothing
   logs why. What should happen? Options: (a) re-probe once on that error in the
   orchestrator (the gate's recommendation); (b) accept it and record it under
   decision 3. Chosen: **(a) re-probe once.** The job completes after one fresh
   probe, or fails with the same non-retryable error and no loop; the failed
   read is logged at debug level, with the URL redacted.
7. **MP4 output changes for some sources, and that is accepted.** Question:
   decision 3 says "MP4 and MKV are unchanged", but declaring codecs from a
   header (and the `ac-3`/`mp4v` aliases) changes MP4 output for some sources.
   Which way? Options: (a) keep the aliases, add the Dolby Vision ones
   (`dvh1`/`dvhe` to `hevc`, `dva1`/`dvav` to `h264`, `dav1` to `av1`), and
   record the MP4 change in the Log as an amendment to the owner's decision
   (the gate's recommendation); (b) feed header-read codecs only to the WebM
   decision, so MP4 and MKV are literally unchanged. Chosen: **(a)**. This
   amends the sentence "MP4 and MKV are unchanged" above: a source whose codec
   is now named, by a header or by an RFC 6381 string, is judged by
   `containerSupports` for MP4 like any declared source, where an undeclared one
   was always copied.

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

**2026-10-08 (third round)** — the first gate returned CONCERNS (no high); the
owner answered its two open decisions (Decisions 6 and 7). Dispositions:

- **Browser tier's header read untested (med): fixed.**
  `api/test/webm-undeclared-codecs.test.ts` › "an undeclared MP4 the browser
  tier found gets its codecs from its header" puts a stand-in for the browser
  tier (Chromium is not the subject) behind the real `buildRegistry`. With the
  browser entry unwrapped in `resolvers.ts`, `npx vitest run tools/downloader/api`
  gave 1 failed, 775 passed of 778 (it was 0 of 772 red before).
- **Re-probe once on `CONTAINER_UNSUPPORTED` (med, Decision 6): built.**
  `orchestrator.ts` re-probes once despite the code not being retryable.
  Tests: `pipeline.test.ts` (stub engine, two cases) and the gate's
  served-once-then-403 origin through the real engine
  (`webm-undeclared-codecs.test.ts`: completes as VP9/Opus on attempt 2; a
  really undeclared file fails after exactly one re-probe with `retryable:
false` and no further header reads). With the exemption removed, 4 of 35
  failed. The failed read is now logged (debug, `redactUrl`; a test asserts a
  signature in the query never reaches the log).
- **MP4 output changed (med, Decision 7): amended, aliases added.** The gate
  measured, from `buildOutputArgs`, at base `mp4 avc1 + ac-3 => -c copy | -c:a
aac` and `mp4 mp4v.20.9 + mp4a => -c copy | -c:v libx264`; at head both copy.
  It also listed header-read fourccs outside the alias table that now transcode
  for MP4 where an undeclared variant was copied: `dvh1`/`dvhe`/`dva1`/`dvav`/
  `dav1` (now aliased, one `mux-args.test.ts` case each), and still `vp08`,
  `s263`, `jpeg`/`mjpa`, `apcn`/`apch`, `ac-4`, `samr`, `sowt`/`twos`/`lpcm`,
  `dtsc`, `mha1` (left, as the owner chose; these are the gate's measurement
  from `fourccs.mjs` over 32 fourccs, not re-run here). Whether a base copy of
  the Dolby Vision, MJPEG and DTS ones succeeds is unmeasured.
- **Per-variant read bound (low): recorded, not fixed.** The Log's "two ranged
  reads per undeclared MP4" above is the typical case. The bound is up to 4
  reads per variant (`MAX_READS`), up to 64 KiB plus 16 MiB, on every probe and
  every job re-probe, for as many variants as the interceptor kept (up to 400),
  at concurrency 4 and 4 s a read. The gate measured 2, 20 and 100 requests for
  1, 10 and 50 tail-`moov` variants. Capping the variants read is a decision
  about which variants to skip and the finding does not state one.
- **`nowebm` mock failed MP4 jobs (low): fixed.** `JobScript.failOnlyForContainer`;
  `mock-api.test.ts` › "the nowebm scenario refuses WebM and nothing else".
- **"keep source" offered for a WebM file with undeclared separate audio
  (low): fixed.** `ProbePanel` withholds it with WebM; `stream.test.ts` shows
  the engine refuses that choice, `probe-panel.test.tsx` the picker hides it.
- **Dropped findings stay dropped.** One of them was left unmeasured at base,
  and it reproduces there with ffmpeg alone, no dl-99 code: a moov-at-end MP4
  copied through the engine's output arguments from an origin that ignores
  `Range` comes out as 1,292 bytes, exit 0, from a 103,485-byte source
  (`ffmpeg … "partial file"`, `Stream ends prematurely at 48`), against 103,115
  from an origin that honours it. `stream.ts`'s header already records the
  same `partial file` / exit 0 case (measured 2026-09-27). Script:
  `scratchpad/dl-99/build/norange.mjs`.
