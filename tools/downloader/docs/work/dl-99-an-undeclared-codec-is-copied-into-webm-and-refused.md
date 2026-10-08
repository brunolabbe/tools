---
id: dl-99
tool: downloader
title: A variant with undeclared codecs, chosen as WebM, is copied as H.264 and refused
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-08 · `9dcf0f6f..912c1b97` · Opus 5.5, depth full

| Done when                                                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undeclared H.264/AAC MP4 into WebM completes as VP9/Opus via the header read                                                                           | `api/test/webm-undeclared-codecs.test.ts` › "the reproduction: an H.264/AAC MP4 the tier did not describe completes as VP9 and Opus" ✓. It asserts that the bare direct tier has no `videoCodec`, that the registry's probe has `avc1`/`mp4a`, and that the streamed output's codecs are `["opus","vp9"]`. This covers the **direct tier only**: the browser tier's wrapping has no test (F1). Also checked on the real API over HTTP: a faststart and a tail-`moov` MP4 each completed as VP9 + Opus                                                                                                                                                                                                                                                                                                                                                                                                            |
| Undeclared `container: "webm"` into WebM is a copy, by its arguments, and completes                                                                    | `engine/test/stream.test.ts` › "an undeclared WebM source is copied into WebM, by its arguments and by its result" ✓ (`-c copy`, no `-c:v`/`-c:a`, output VP9 + Opus). Also `api/…` › "a WebM source is copied whole, and its header is never read" ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unknown container, and an MP4 whose header read fails, are refused for WebM with a typed error before ffmpeg starts, and WebM is not offered in the UI | Unknown container: `stream.test.ts` › "so is a source whose container nobody named, and any other" ✓ (`CONTAINER_UNSUPPORTED`, origin request count unchanged). Header read fails: `api/…` › "an MP4 whose header cannot be read stays undeclared, is refused for WebM" ✓. That test covers only a body that is not an MP4. A read that _fails_ (403 on the ranged read, short ranged answers, a server that ignores `Range` on a tail `moov`) is **verified** on the real API: link answered 422 `CONTAINER_UNSUPPORTED`, `retryable:false`, `attempts:1`, no engine request at the origin. The same source as MP4 and MKV completed. UI: `web/test/probe-panel.test.tsx` › "WebM is not offered for a file nothing describes, and is for one that is declared" ✓; unknown container through `canMakeWebm`: `contract/test/can-make-webm.test.ts` › "a file nothing describes cannot, whatever its container" ✓ |
| Each case has a test that fails if its branch is removed                                                                                               | **verified** by mutation, with `dist` rebuilt and grepped. Engine `assertContainerCanHold` call removed: 6 of 47 failed. Direct-tier wrapper removed: 1 of 3 failed. `wholeFileIsWebm` forced false: 4 of 95 failed. `ProbePanel` filter disabled: 3 of 23 failed. **Exception:** the browser-tier wrapper removed: 0 of 772 api tests failed (F1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

- **med** · Done when 1 and 4 depend on it · **The browser tier's header read is untested.** The brief's reproduction is the browser tier's variant shape ("A progressive variant the browser tier found"). Reproduction: in `api/src/resolvers.ts` › `buildRegistry`, replace `resolvers.push(describingProgressiveTracks(named(browser), options.fetchImpl));` with `resolvers.push(named(browser));`. Then `npx vitest run tools/downloader/api` gives `Tests 770 passed | 2 skipped (772)`, exit 0. No e2e spec mentions WebM either. Remedy: a test that goes red when the browser entry is unwrapped, either a `buildRegistry` seam the test can reach or an `e2e:sniffer` journey that picks WebM for an undeclared MP4 (that one is gate-only).
- **med** · no Done when line depends on it · **open decision** · **WebM is offered, then refused for good, when only the re-probe's header read fails.** The premise is an origin whose bounded ranged read works once and then answers 403. My `/flaky/` mode does exactly that. Reproduction with the real API, `node drive.mjs http://127.0.0.1:47991/flaky/h264.mp4 webm`:
  - The probe answers `videoCodec:"avc1"`, `audioCodec:"mp4a"`, label "H.264 + AAC", so WebM is offered.
  - The link then answers `422 CONTAINER_UNSUPPORTED`, with `retryable:false` and `attempts:1`.
  - The copy says "what it holds is not known to fit", which contradicts the label the visitor was shown.
  - Nothing logs why the read failed: `describingProgressiveTracks` swallows the failure silently.

  Options:
  - **(a) Recommended: re-probe once on `CONTAINER_UNSUPPORTED` in the orchestrator** (`REPROBE_WORTHY`). The UI already hides WebM for a variant that really is undeclared, so the extra probe almost only runs in this flake or after a hand-built POST.
  - **(b)** Accept it and record it under Decision 3.

- **med** · no Done when line depends on it · **open decision** · **MP4 output changed, despite the Decision "MP4 and MKV are unchanged".**
  - Before and after for _declared_ variants, from `buildOutputArgs`. At base (from base source): `mp4 avc1 + ac-3 => -c copy | -c:a aac` and `mp4 mp4v.20.9 + mp4a => -c copy | -c:v libx264`. At head: both give `-c copy`. MKV and WebM are unchanged. `ac-3` and `mp4v.20.x` are the standard RFC 6381 strings, so declared HLS, DASH and yt-dlp variants are affected too, not only header-read ones.
  - Header-read fourccs not in the alias table now transcode for MP4 where the undeclared variant used to be copied: `dvh1`/`dvhe`/`dva1`/`dvav`/`dav1`, `vp08`, `s263`, `jpeg`/`mjpa`, `apcn`/`apch`, `ac-4`, `samr`, `sowt`/`twos`/`lpcm`, `dtsc`, `mha1`. This is from `containerSupports` over 32 fourccs (script `fourccs.mjs`).
  - Some of these changes are improvements. An H.263 file served as MP4 now completes as H.264, while ffmpeg refused to write H.263 into `mp4` when the fixture was made ("Could not find tag for codec h263").
  - Dolby Vision, MJPEG and DTS sources now transcode where a copy probably worked. Whether a base copy of those succeeds is **unmeasured**.
  - `mux-args.test.ts` pins a sample of fourccs, not the whole set.

  Options:
  - **(a) Recommended:** keep the aliases, add the Dolby Vision ones (`dvh1`/`dvhe`→`hevc`, `dva1`/`dvav`→`h264`, `dav1`→`av1`), and record the MP4 change in the Log.
  - **(b)** Use header-read codecs only for the WebM check, so MP4 is literally unchanged.

- **low** · `nfr:performance` · **The wrapper does not bound how many variants it reads.** Measured with `hop-and-count.mjs` on tail-`moov` files: N=1/10/50 cost 2/20/100 requests. Per variant:
  - a faststart file whose `moov` fits in 64 KiB takes 1 read;
  - a tail `moov` takes 2 reads;
  - short answers took 3 reads;
  - `MAX_READS` caps it at 4, up to 64 KiB plus 16 MiB.

  This repeats on every job re-probe. The only limits are the browser interceptor's `MAX_HITS` (400), a 4 s timeout per read at concurrency 4, and the probe deadline. The Log's "two ranged reads per undeclared MP4" is the typical case, not the bound.

- **low** · no live call site · The mock scenario `nowebm` (`web/src/api/scenarios.ts`) fails every job, an MP4 job included, with "Not available as WebM". `mock.ts` applies `failWith` whatever container was chosen.
- **low** · no live call site verified · `ProbePanel` hides only `webm`. "keep source" stays offered for a `container: "webm"` variant whose separate audio is undeclared, and `resolveContainer` maps that choice to WebM, which the engine refuses.
- **dropped** · A `/forbidall/` MP4 job failed with `DOWNLOAD_FAILED`, because ffmpeg sends its own `Range: bytes=0-`. The engine's input is outside this diff.
- **dropped** · A tail-`moov` MP4 copied from an origin that ignores `Range` came out at 37,635 bytes from a 103,485-byte source, with `durationSec` 3.99. ffmpeg's input path is outside this diff and was not measured at base. It may be worth its own reproduction.
- **dropped** · `canMakeWebm` adds logic to `contract`, which the tool's `CLAUDE.md` describes as having none. Addition 5 names the function, and the Log gives the reason (`web` cannot import `engine`).
- **dropped** · Replayed `Cookie` headers follow cross-origin redirect hops. That is a property of `createGuardedFetch` that the engine already had, not something new here.
- **findings** · the hunt returned 10; 6 carried, 4 dropped.
- NFR:
  - **Security ✓.** Every hop goes through `createGuardedFetch`. A 302 to `169.254.169.254` was refused with `BLOCKED_TARGET` at the hop, with only the 302 reaching the socket. The wrapper logs nothing, and the error's `details` carry no URL or header.
  - **Performance:** see the variant-count bullet above.
  - **Reliability:** see the re-probe bullet above.
  - **Maintainability:** see the browser-tier and MP4 bullets above.
- CI on `912c1b97`: every check passed, `test (windows-latest, informational)` included (run 37704403499; `webm-undeclared-codecs.test.ts` ran 3 tests and `stream.test.ts` ran 44 with 4 skipped). Locally: `npm run check` exit 0, and `npm test -- --project downloader` gave 2157 passed | 2 skipped (2159).

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
