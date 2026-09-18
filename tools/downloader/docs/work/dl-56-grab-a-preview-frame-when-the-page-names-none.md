---
id: dl-56
tool: downloader
title: A probe whose page names no preview image gets one frame grabbed from its chosen stream
kind: work-package
status: done
milestone: null
depends_on: [dl-55]
difficulty: hard
---

# dl-56 — Grab a preview frame when the page names none

**Packages:** `engine` (one ffmpeg invocation), `api` (the thumbnail capture
and its wiring), and the preview notes in `thumbnails.ts` and the architecture
doc.

**The site and the page are deliberately not named anywhere in this ticket**,
on the owner's instruction, as in dl-48 and dl-55.

## Why

**A video page probes with renditions and shows no preview.** The owner
reported it as "the downloader can't generate a preview". Reproduced on
2026-09-13: the API logged `probe complete` with `preview: false`, and the
probe carried no `thumbnailUrl`.

**There is no image for the current design to find**, and each fallback short
of the stream was measured:

| Where a preview could come from                         | On this page                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `og:image`, `og:image:url`, `twitter:image` (top frame) | absent, in the served HTML and in the rendered DOM            |
| JSON-LD `VideoObject.thumbnailUrl`                      | no `application/ld+json` block in the served HTML             |
| The player frame's `og:image`                           | absent: the player is a cross-origin iframe with none         |
| A `<video poster>`                                      | the only one in the top frame belongs to a related-video card |
| yt-dlp's `thumbnail`                                    | yt-dlp rejects both the page URL and the embed URL            |
| The page's own inline JSON                              | a poster is there, but reading it is a site-specific resolver |

So `captureThumbnail` finds nothing in `urlsInProbeResult(probe).bestEffort`
and returns `null` before any fetch. The design is working as dl-29 built it:
dl-29 kept previews to images the source names, and called grabbing frames
with ffmpeg "a different and much larger feature, and explicitly out of scope
here".

**The stream is the one source every successful probe has.** A frame grabbed
from it covers this page and every page like it, which no markup fallback does.

### Decided by the owner, 2026-09-13

Chosen from options, after the table above was measured:

- **Grab a frame from the chosen stream** when the source names no image. This
  was preferred over markup fallbacks, which leave this page blank, and over
  filing the choice as an open decision.
- **The site and page stay out of the repo.**

### Adopted rather than asked, and why

- **Only when there is no image URL at all.** A named image that fails to fetch
  stays no preview. The page did name an image, and grabbing after a failed
  4 s fetch would stack two bounded costs on one probe.
- **One frame per video, never per rendition.** dl-29's answer (2) stands: one
  preview per video.
- **Not for a live stream.** A live probe's variant can be a moving window with
  no stable frame, and a live probe is already on its own path
  (`LIVE_STREAM_UNSUPPORTED` without a `liveDurationSec`).
- **In-line, like the image fetch, and bounded.** The eager, at-probe-time shape
  in `thumbnails.ts` exists because the credentials are in hand only there. An
  asynchronous grab would need a contract change to announce a preview later,
  which is out of proportion to a decorative image.
- **Depends on dl-55.** On the reproduction page the chosen stream is another
  video's until dl-55 lands, so a grab built first would show the wrong
  picture, beside the wrong video.

## Build

1. **The grab, in `engine/src/ffmpeg/`.** A new exported function, say
   `grabPreviewFrame`, that returns JPEG bytes or `null` and never throws for a
   stream-side failure:
   - **Input:** `buildNetworkInputArgs`, given the probe's `requestContext`,
     `tlsVerify`, and `ffmpegEgress.tlsCaFile` as `tlsCaFile`. It replays the
     `RequestContext` and keeps TLS verification on, exactly as a download
     does.
   - **Seek a little in, not frame 0.** Opening frames are often black. Use an
     input-side `-ss` of about 10% of `durationSec`, capped at a few seconds,
     and 0 when the duration is unknown.
   - **Output:** `-frames:v 1`, no audio, subtitle or data streams, scaled to
     at most the size the UI renders (`preview--panel`), as MJPEG, written to a
     temporary file under the storage `tmp/` directory. Not stdout:
     `PROGRESS_ARGS` already claims `pipe:1`.
   - **Run through `runFfmpeg`**, with `proxyUrl` set to the **ffmpeg egress
     proxy** (`ffmpegEgress.proxyUrl`), a `timeoutMs`, a `signal` and a `maxOutputBytes`. `runFfmpeg`
     already spawns with an argument array and kills the process tree.
   - **Pick the cheapest video input:** the lowest-bitrate variant that has
     video, and for split DASH its video URL only.
2. **The fallback, in `api/src/thumbnails.ts`.** `captureThumbnail` gains an
   optional `grabFrame` dependency. When `bestEffort` is empty, the probe is not
   live, and a variant has video, call it. The result goes through the same
   `ALLOWED_CONTENT_TYPES` (`image/jpeg`), the same `MAX_THUMBNAIL_BYTES` and
   the same `store.put`. Every failure is `debug` and `null`, as every existing
   failure path there is. Update the header comment: previews are no longer only
   images the source named, and the comment should say why this is not the
   "different and much larger feature" dl-29 ruled out.
3. **Wire it in both call sites.** `routes/probe.ts` and
   `jobs/orchestrator.ts` both call `captureThumbnail`, so both pass
   `grabFrame`. The API already holds what it needs: `server.ts` resolves
   `ffmpegEgress` and reads `config.ffmpegPath`, and `context.ts` carries the
   store. `ffmpegEgress` is the pair the engine is given: the tiers' proxy when
   ffmpeg TLS interception is off, and a separate terminating `ffmpegProxy`
   when it is on (dl-27's reason: ffmpeg cannot verify its own segment
   connections). Thread that same pair, and never pick `tierProxy` directly. Add a
   `previewSource: "page" | "frame" | null` field to the `probe complete` log
   line. It is log-only, with no contract change.
4. **The budget.** Give the grab its own timeout constant, beside
   `THUMBNAIL_FETCH_TIMEOUT_MS`, with a comment stating the relationship to
   `probeTimeoutMs` (45 s by default). The reproduction's probe alone took
   22.8 s. Measure the grab against the e2e fixture origin and against one real
   page, and put both numbers in the Log. Choose the constant from those
   numbers, not from this brief.
5. **Tests.**
   - **Engine:** against a local HLS fixture generated with ffmpeg, the way
     `e2e/fixtures/hls-origin.ts` builds its origin, the grab returns bytes
     starting `FF D8` within the timeout. A stream behind a `Referer` check
     succeeds only with the context replayed. A timeout returns `null` and
     leaves no ffmpeg process behind. Output over `maxOutputBytes` returns
     `null`.
   - **API unit** (`api/test/`, next to the existing thumbnail tests), with an
     injected `grabFrame`:
     - It is called only when `bestEffort` is empty.
     - It is not called for a live probe, nor when a named image fails to
       fetch.
     - A returned JPEG is stored and served by `/api/thumbnail/:token` as
       `image/jpeg`.
     - A throwing or `null` grab leaves the probe response unchanged apart
       from `thumbnailPath: null`.
   - **The egress path:** a test proving the grab's `proxyUrl` is the ffmpeg
     egress proxy. For example, a grab whose origin is on a blocked address
     gets no bytes, even though the probe itself vetted the manifest URL.
6. **Docs.** `docs/01-ARCHITECTURE.md`, wherever it describes preview images,
   says where a frame grab comes in and what it costs.

## Traps

- **Every URL ffmpeg opens after the manifest is unvetted until the proxy sees
  it.** The segments, the init segment and the key are why the grab goes
  through the ffmpeg egress proxy. A direct spawn with no `proxyUrl` passes
  every unit test and reopens dl-11's hole.
- **Signed URLs expire in seconds to minutes** (analysis §5). The grab must run
  in the same `captureThumbnail` call as today, right after the probe, never
  later from a stored probe.
- **ffmpeg echoes input URLs on stderr.** Anything logged goes through
  `redactUrlsInText` or `redactUrl`. A signed URL's query string is a
  credential.
- **`-ss` placement matters.** An input-side seek on HLS skips whole segments.
  An output-side seek decodes and downloads everything before it. Measure
  before choosing, and record the bytes fetched in the Log.
- **This adds an ffmpeg process to probes that name no image.** Most pages do
  name an image, and the yt-dlp tier normally carries `thumbnail`. Count how
  often the fallback fires across the e2e suites and state it in the Log, so
  the operational cost is a number.
- **The frame is not decorative to a reader of the image.** A frame grabbed
  from the wrong stream is actively misleading. That is why this depends on
  dl-55, and why a grab never falls back to a different variant from the one
  the probe ranked.

## Done when

- A probe whose source names no image and whose stream has video returns a
  `thumbnailPath` that serves an `image/jpeg` frame (API unit test with an
  injected grab, plus an engine test against a generated fixture stream).
- The grab is not attempted when an image URL exists, when that image fails,
  or for a live probe (API unit tests, one per case).
- The grab runs through the ffmpeg egress proxy with the probe's
  `RequestContext` replayed (engine test for the header, egress test for the
  proxy).
- A grab that times out, fails, or exceeds the cap costs the probe nothing but
  its bounded time, and leaves no process behind (engine tests).
- The grab's timeout constant and its measured costs (fixture and one real
  page) are in the Log.
- `thumbnails.ts`'s header and `docs/01-ARCHITECTURE.md` describe the frame
  source.
- **Added 2026-09-18, from the owner's answer to the open decision below.**
  Grabs are bounded server-wide by a cap of their own, configurable, defaulted
  and documented in `.env.example` and `docs/01-ARCHITECTURE.md`; past it the
  grab is skipped rather than queued. A test fails without the cap, and the
  concurrency script that found the gap reports no more than the cap.
- `npm run check` and `npm test -- --project downloader` pass. This changes
  what the container runs at probe time, so say that the downloader's e2e and
  image gates in CI are the proof a local run does not supply.

## Review

**Gate B: CONCERNS** — 2026-09-17 · `origin/main...HEAD`, reviewed at `4c13032` · defect hunt run directly by the reviewer (Sonnet), medium depth, scoped to everything but Gate A's egress/protocol/injection/kill-cleanup track (agent `ad4658d782570769e`, reported separately, PASS)

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A probe whose source names no image and whose stream has video returns a `thumbnailPath` that serves an `image/jpeg` frame  | `engine/test/preview-frame.test.ts:192 "returns JPEG bytes, inside the timeout, with the context replayed on every request"` ✓, `api/test/thumbnails.test.ts:486 "one grab, from the cheapest rendition with video, stored as image/jpeg"` ✓                                                                                                                                                                                                                                                                                                                                                                       |
| The grab is not attempted when an image URL exists, when that image fails, or for a live probe                              | `api/test/thumbnails.test.ts:502 "an image URL that loads is used, and nothing is grabbed"` ✓, `:513 "an image URL that fails to fetch stays no preview, and nothing is grabbed"` ✓, `:526 "a live probe grabs nothing"` ✓                                                                                                                                                                                                                                                                                                                                                                                         |
| The grab runs through the ffmpeg egress proxy with the probe's `RequestContext` replayed                                    | `engine/test/preview-frame.test.ts:403 "the context's headers are input options, ahead of the input"` ✓, `api/test/frame-grab-egress.test.ts:111 "the ffmpeg egress proxy and its root, never the tiers' proxy, with the context replayed"` ✓ — reproduced by mutation: reverting `engine/src/ffmpeg/preview-frame.ts:143 "requestContext: options.requestContext,"` to `undefined` turns 4 engine tests red; reverting `downloader/api/src/server.ts:408 "createFrameGrabber({"`'s `proxyUrl` argument to `""` turns the wiring test and the blocked-address test red, with 2 requests reaching `/localhost/seg*` |
| A grab that times out, fails, or exceeds the cap costs the probe nothing but its bounded time, and leaves no process behind | **verified, Linux-gating-leg only** — `engine/test/preview-frame.test.ts:285 "a stream that trickles is cut off at the timeout, and its ffmpeg is gone when the grab returns"` is `skipIf` on non-Linux; explicitly skipped, not silently passing, on the informational `windows-latest` leg, which does not gate the merge                                                                                                                                                                                                                                                                                        |
| The grab's timeout constant and its measured costs (fixture and one real page) are in the Log                               | present; "one real page" was substituted with a public CDN title, disclosed in the Log as a consequence of the ticket's own site-secrecy rule — reasonable, not a defect                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `thumbnails.ts`'s header and `docs/01-ARCHITECTURE.md` describe the frame source                                            | ✓ — every claim in the two new architecture paragraphs checked against code and confirmed accurate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run check` and `npm test -- --project downloader` pass; e2e/image gates are CI's job                                   | reproduced — `npm run check` exit 0; `npm test -- --project downloader` → 87 files, 1458 tests, all pass; e2e and the image gate correctly left `unproven (gate)`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

- **med · open decision, not resolved here** — `api/src/routes/probe.ts:183 "const release = context.probeGate.tryAcquire();"` releases the server-wide gate before `:233 "const captured = await captureThumbnail({"` runs. Reproduced twice independently: I measured 12 concurrent real ffmpeg grabs against a configured `maxConcurrentProbes` of 8 (12 distinct clients); the builder independently reproduced the same mechanism with `maxConcurrentProbes: 2` and 5 clients, getting 5 concurrent grabs, none left afterwards. The per-client cap bounds one client; nothing bounds the server. This goes to the orchestrator as an open decision with the options the builder is presenting alongside mine.
- **low, settled** — the Log's `-ss` placement table's 1-second-segment row (input-side cheaper by 1.25x) did not reproduce on my original fixture (640x360@15fps, g=15, video-only: 1.00x, no difference). Re-running with the builder's exact fixture (1280x720@25fps, g=25, both with and without audio) reproduced their numbers exactly (1.245x and 1.255x). Settled: the effect is fixture-dependent (resolution/frame-rate/GOP), not audio-dependent as I'd first guessed; the output-side choice is unaffected and both reviewers agree with it. The Log and the `preview-frame.ts:159 "It lost only on 1 s segments"` comment now say so.
- **verified** — the re-probe's grab is used, not wasted: `api/src/jobs/orchestrator.ts:265 "store.patch(jobId, { variant, variantId: variant.id, thumbnailPath }"` feeds `#persist`, proven by `api/test/thumbnails.test.ts:632 "a job's re-probe takes its preview from the grab too"`. The doubled ffmpeg cost per direct-tier job is real but not new in shape — it is dl-44's existing "always re-probe" cost, now paid by a heavier process. Folded into the open decision above, not counted separately.
- **verified** — output-side seek past the real stream's end (probe-reported duration longer than the actual media) fails cleanly: ffmpeg exits 0 in ~90ms, writes nothing, `grabPreviewFrame` returns `null`.
- **verified** — citations: `node scripts/citations-gate.mjs --against origin/main` → 84 enforced, 0 failing. All 5 pinned tickets (dl-18, dl-32, dl-45, dl-57, dl-60) diffed programmatically against `origin/main`: only the `@20c8fd1` pin and table repadding changed, never verdict or anchor text; dl-60's 34 lines are 17 pin insertions.
- **verified** — `image-closure`: no new workspace dependency (exports added to an already-depended-upon `@downloader/engine`); `npx vitest run packages/core/test/image-closure.test.ts` → 11 pass.
- **findings** — defect hunt run directly (medium depth, scope excluding Gate A's track) returned 2 items; both carried above, both resolved through reproduction with the builder. 0 dropped.
- NFR: security — out of scope (Gate A, PASS) · performance — the open decision above is the only cost concern found · reliability — "no process left behind," "fails cleanly past EOF," and "the two cap layers are independent" each independently reproduced ✓ · maintainability — architecture doc and header comment checked accurate against code ✓.

_Transcribed by the builder (Opus 5) from the reviewer's message. Two changes, both so the citation check can resolve the text, and neither changes a verdict. The `server.ts` citation gained a `downloader/` prefix, because the shorter path also matches the planner's file. The seek-comment citation in `preview-frame.ts` gained its quoted anchor. Nothing was dropped. One more coordinate moved afterwards: the `server.ts` citation, and the five into `thumbnails.test.ts`, moved when the frame-grab cap was built above them, so each is repointed to the line its own quoted anchor is on now rather than pinned to a branch commit that will not survive the squash. No anchor text changed. `npm run format` reflowed the table padding._

**Gate A: PASS** — 2026-09-17 · `origin/main...HEAD`, reviewed at `cff1440` (redirect-hop and split-DASH coverage confirmed again at `4c13032`) · defect hunt run directly by the reviewer (Sonnet), scoped to the frame grab's egress proxy, protocol whitelist, argument construction, header redaction, kill/cleanup and output-size checks (agent `a34392b2236d95ba0` covered everything else, reported separately, CONCERNS)

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The grab runs through the ffmpeg egress proxy with the probe's `RequestContext` replayed                                    | `downloader/api/src/server.ts:408 "createFrameGrabber({"` wires `proxyUrl: ffmpegEgress.proxyUrl` (never `tierProxy`), reproduced by mutation: reverting that argument to `""` turns `api/test/frame-grab-egress.test.ts:317 "segments on a blocked address: no preview, and not one request reaches it"` red — 2 requests reach `/localhost/seg*` — then restored; positive control at `:306 "segments on an allowed address: the grab produces a frame (the control)"` ✓ |
| A grab that times out, fails, or exceeds the cap costs the probe nothing but its bounded time, and leaves no process behind | `engine/test/preview-frame.test.ts:285 "is cut off at the timeout, and its ffmpeg is gone when the grab returns"` ✓ (Linux-gating leg); extended myself, not in the shipped suite: a connection that accepts but sends nothing (killed at the bound, no orphan ffmpeg, no leftover temp dir) and a genuine mid-flight `abort()` fired 500 ms into a live run (rejects `JOB_CANCELED` at ~533 ms, clean) — both reproduced against real ffmpeg, not committed               |

- **Egress, enumerated, not sampled.** Six sub-resource hop types, each refused when the target is `localhost` (blocked by name, same socket as the allowed `127.0.0.1` literal) and reached when it's the allowed literal: manifest→segment (`api/test/frame-grab-egress.test.ts:306 "segments on an allowed address: the grab produces a frame (the control)"` and `:317 "segments on a blocked address: no preview, and not one request reaches it"`, the shipped control/negative pair) ✓; a 302 redirect on a segment to a blocked host, now shipped at `:326 "a segment that redirects to a blocked address: the redirect is refused too"` ✓; `#EXT-X-KEY`, `#EXT-X-MAP` and a DASH `BaseURL` on a blocked host — reproduced by me against real fixtures (AES-128 HLS, fMP4 HLS, a hand-written MPD), not committed as tests: same `engine/src/ffmpeg/args.ts`/`engine/src/ffmpeg/runner.ts` plumbing the shipped tests already prove. Split DASH itself (not a blocked-host case, but the first thing to exercise `protocol: "dash"` end to end) is now shipped at `engine/test/preview-frame.test.ts:508 "returns JPEG bytes, with the context replayed on the init and media segments"` ✓.
- **verified** · protocol escapes against real ffmpeg 6.1.1, not in the shipped suite: `file://` as a segment URI is refused by `-protocol_whitelist`, which omits it (`engine/src/ffmpeg/args.ts:62 "export const REMOTE_PROTOCOL_WHITELIST"`, comment at `:52 "is deliberately absent"`); `tcp://`, `udp://` and `concat:file://` as segment URIs are refused by ffmpeg's own HLS demuxer before it even attempts to open a socket, even when explicitly added to the whitelist to isolate the mechanism — defense in depth beyond what this code sets. `subfile:`/`crypto+file:` not independently run; inferred from the same demuxer-level gate, not reproduced.
- **verified** · argument injection: `url` is the single argv element immediately after `-i` (`engine/test/preview-frame.test.ts:358 "args[input + 1]).toBe("` asserts the position), `runFfmpeg` spawns an array with `engine/src/ffmpeg/runner.ts:134 "shell: false,"`, and `packages/core/test/spawn-safety.test.ts` still passes (11/11, reran). Reproduced directly with real ffmpeg: a URL starting with `-` (`-rtbufsize 1`) is opened as a filename, never parsed as a flag.
- **verified** · header replay: CRLF is stripped before the `-headers` blob by shared, unmodified code — `engine/src/text.ts:18 "export function stripControlChars(value: string): string {"`, `:22 "isControlCodePoint(code)) continue;"` — already asserted by `engine/test/ffmpeg-args.test.ts` (a `\r\nX-Injected:` value collapses to one line). Reproduced live: a failing grab against a URL carrying a query-string token shows `[redacted]` in every debug line and the failure's stderr detail (`engine/src/ffmpeg/runner.ts:64 "export function redactUrlsInText(text: string): string {"`); grepped the full output, the literal secret never appears.
- **verified** · output checks: `engine/src/ffmpeg/preview-frame.ts:239 "if (stat.size > options.maxOutputBytes) {"` gates `:246 "bytes = await fs.readFile(destPath);"` — an oversized file is rejected without being read into memory. The shipped over-cap test passes.
- **dropped** — none.
- **findings** — defect hunt (scoped to this track) returned 0; nothing to carry.
- NFR: security ✓ (this is the security gate) · performance — out of scope (Gate B) · reliability ✓ (kill/cleanup above) · maintainability — out of scope (Gate B).

_Transcribed by the builder (Opus 5) from the reviewer's message. The reviewer wrote the `server.ts` call four lines higher, where it was before the frame-grab cap was built above it, and the trickle test one line lower than it is; both coordinates are repointed here so the check resolves. Nothing else changed, nothing dropped, and no anchor text touched. `npm run format` reflowed the table padding._

## Log

**2026-09-13 — filed** from the owner's report that one page produced no
preview, on their choice of a frame grab. The probe ran against the dev API
from a checkout at `82e7801`, and the page and embed were inspected with a bare
Playwright Chromium. The code facts were checked at `origin/main` `1835657`. No
commit between the two touches `tools/downloader`.

- `METADATA_SCRIPT` reads `og:image`, then `og:image:url`, then
  `twitter:image`, from the top document only. `BrowserResolver` sets
  `thumbnailUrl` from that alone.
- `captureThumbnail` takes the first `urlsInProbeResult(probe).bestEffort` URL
  and returns `null` when there is none, before any fetch.
- `THUMBNAIL_FETCH_TIMEOUT_MS` is 4 s, `MAX_THUMBNAIL_BYTES` is 512 KB, and
  `ALLOWED_CONTENT_TYPES` includes `image/jpeg`.
- `runFfmpeg` takes `proxyUrl`, `timeoutMs`, `signal` and `maxOutputBytes`.
  `PROGRESS_ARGS` writes progress to `pipe:1`.
- `server.ts` hands the engine `ffmpegEgress.proxyUrl` and
  `ffmpegEgress.tlsCaFile`. That is the tiers' proxy when ffmpeg TLS
  interception is off, and a separate terminating `ffmpegProxy` when it is on.
- `probeTimeoutMs` defaults to 45 s.

## The gate on this filing

**2026-09-13 — CONCERNS**, the same gate as dl-55, recorded there in full. For
this ticket it confirmed the code facts: `captureThumbnail`'s early return, the
thumbnail constants, `runFfmpeg`'s options, `PROGRESS_ARGS`, `ffmpegEgress` and
the `probeTimeoutMs` default. It also confirmed that `depends_on: [dl-55]` is
justified by the text. It raised nothing against this ticket's Build.

## 2026-09-17 — built

Branch `dl-56-grab-a-preview-frame` off `origin/main` at `20c8fd1`. dl-55 is in
that base (merged as `1806525`). Nothing here touches
`resolvers/src/browser/provoke.ts`, so there is no overlap with dl-61.

**What landed, by Build step.**

1. **The grab**, `engine/src/ffmpeg/preview-frame.ts`, exported from the engine.
   `grabPreviewFrame` returns JPEG bytes or `null`. It runs one `runFfmpeg` with
   `buildNetworkInputArgs` (the `RequestContext`, `tlsVerify` and `tlsCaFile`
   replayed, `reconnect` off), `-map 0:v:0 -an -sn -dn -frames:v 1`, a scale to
   at most 256 px on the longer edge (never up), and `-f mjpeg` into a fresh
   `preview-<uuid>/` directory under the storage `tmp/` root. That directory is
   removed in a `finally`. `PROGRESS_ARGS` stay in, because `runFfmpeg` enforces
   `maxOutputBytes` off the progress stream. The file size is checked again after
   exit, and the bytes must start `FF D8`. `TIMEOUT`, `SIZE_LIMIT_EXCEEDED`,
   `DOWNLOAD_FAILED` and `TLS_VERIFICATION_FAILED` return `null` at `debug`.
   `JOB_CANCELED` and a binary that will not start are thrown, since neither is a
   fact about the stream. `choosePreviewVariant` picks the lowest declared
   `bitrateBps` among variants with video. With no bitrates it keeps the probe's
   order (the first with video). It returns one variant and never retries another.
2. **The fallback**, `api/src/thumbnails.ts`. `captureThumbnail` takes optional
   `grabFrame` and `signal`. With no `bestEffort` URL it calls `captureFrame`,
   which returns `null` for a live probe or no video variant. Otherwise it calls
   the grab and holds the answer to `image/jpeg`, a JPEG signature and
   `MAX_THUMBNAIL_BYTES`, then `store.put`s it. `CapturedThumbnail` gained a
   log-only `source: "page" | "frame"`. `createFrameGrabber` is the production
   grabber. The header now says where images come from and why this is not
   dl-29's "much larger feature".
3. **Wiring.** `server.ts` builds `grabFrame` once, after the engine, from
   `ffmpegEgress.proxyUrl`, `ffmpegEgress.tlsCaFile`,
   `!config.ffmpegAllowUnverifiedTls`, `engine.config.ffmpegPath` and
   `engine.storage.tmpRoot`. It goes on `AppContext.grabFrame` and
   `OrchestratorOptions.grabFrame`. `CreateAppOptions.grabFrame` overrides it for
   tests. `routes/probe.ts` passes it with the request's abort signal and logs
   `previewSource`. `jobs/orchestrator.ts` passes it with the job's signal.
4. **The budget.** `FRAME_GRAB_TIMEOUT_MS = 6_000`, beside
   `THUMBNAIL_FETCH_TIMEOUT_MS`. Its comment states the relationship to
   `probeTimeoutMs` and that it never stacks with the image fetch.
5. **Tests.** See the verification section below.
6. **Docs.** `docs/01-ARCHITECTURE.md` gains two "Key decisions" paragraphs:
   preview images (dl-29) and the frame grab (dl-56), with its cost.

**What the brief had wrong, or did not know.**

- **"Use an input-side `-ss`" is the more expensive placement here.** The Trap
  said to measure first, so I did, and the result reversed the Build line. The
  HLS demuxer fetches the first two segments while it probes streams. An
  input-side seek then reopens the segment that holds the seek point, and it
  fetches that segment again. `-ss` is output-side. The measurement used
  generated `libx264` ladders on loopback. The seek was `min(3 s, 10%)`, and
  "bytes" means bytes the origin served:

  | Ladder                     | output-side (built) | input-side   | frame 0   |
  | -------------------------- | ------------------- | ------------ | --------- |
  | 6 s clip, 2 s segs (0.6 s) | 138,753             | 277,309 (2x) | 138,753   |
  | 60 s, 1 s segs             | 343,013             | **275,521**  | 138,281   |
  | 60 s, 2 s segs             | 410,981             | 547,845      | 274,117   |
  | 120 s, 6 s segs            | 819,977             | 1,639,281    | 819,977   |
  | 60 s, 10 s segs            | 1,364,416           | 2,728,544    | 1,364,416 |

  Output-side matches frame 0 on 6- and 10-second segments. It loses only on
  1-second segments, by 1.25x. Script:
  `scratchpad/dl-56/measure.mjs`, not committed. These ladders were 25 fps
  with `-g 25`, 320x240 for the 6 s clip and 1280x720 for the rest, with AAC
  audio. **The 1-second row depends on the fixture.** Gate B used a video-only
  fixture and found input-side and output-side fetched identical bytes (1.00x).
  I re-ran my fixture without audio and still got 1.25x (295,261 against
  235,289). So the loss depends on how the fixture is encoded, not on audio.
  Across both fixtures, output-side never cost more than 1.25x, and the choice
  stands.

- **`01-ARCHITECTURE.md` did not describe preview images anywhere**, so "wherever
  it describes preview images" had nothing to edit. The dl-29 paragraph is new,
  and the dl-56 paragraph goes beside it.
- **"Most pages do name an image" does not hold for the direct tier.** No code
  in the direct resolver sets `thumbnailUrl`. Only the browser tier (`og:image`)
  and yt-dlp (`thumbnail`) do. So **every probe the direct tier answers now
  grabs**, and so does every job re-probe of one. Across the e2e suites, run
  locally with `LOG_LEVEL` temporarily set to `info` (not committed):
  `e2e:downloader` had 7 passed and 1 `probe complete` line, with
  `previewSource: "frame"`. `e2e:downloader:sniffer` had 1 passed and 1
  `probe complete`, with `previewSource: "page"`. Each suite also runs one job.
  Its re-probe logs at `debug` and was not counted. By the code path, the direct
  suite's job grabs a second time and the sniffer's does not. So the fallback
  fired on 1 of the 2 logged probes, and by inference on 2 of the 4 captures.
- **The test harness now defaults `grabFrame` to `async () => null`**
  (`api/test/helpers.ts`). The stub engine's ffmpeg is `process.execPath`, and
  `probeResult()` names no image. Without that default, most harness probes would
  have spawned node with ffmpeg arguments.

**The timeout constant, measured before it was chosen.**

- **Fixture:** under 0.11 s for a whole `POST /api/probe` that grabbed, through
  the real wiring with the terminating proxy (5 runs, 78–108 ms). The grab alone,
  directly, took 65–335 ms across the ladders above.
- **Real stream, not the reproduction page.** The ticket keeps that page out of
  the repo and this dispatch was never told it, so it was **not** measured. The
  real measurement is Mux's public HLS test title (`test-streams.mux.dev`,
  634 s, served from a CDN). Directly: 0.23–0.27 s on the 240p rung, which the
  picker takes, and 0.44–0.49 s on 1080p (5 runs each). Through `createApp`, with
  a terminating ffmpeg egress proxy, a whole probe that grabbed took 0.38–0.50 s
  (5 runs). The frame decoded and looked right (the title card, 256x147).
- **6 s** is twelve times the slowest of those. It never stacks with
  `THUMBNAIL_FETCH_TIMEOUT_MS`, because one probe runs one or the other.
  Scripts: `measure-real.mjs` and `measure-api.mjs`, not committed.

**Verification.**

- `npx vitest run tools/downloader/engine/test/preview-frame.test.ts`: 14 tests,
  all pass. The fixture is a gated HLS origin that 403s any request without the
  Referer, Cookie and UA. The tests cover JPEG bytes inside the timeout with the
  context on every request, `.ts` included; the 640x360 frame scaled to 256x144;
  no context giving `null` with `DOWNLOAD_FAILED`; `maxOutputBytes: 100` giving
  `null`; and a canceled caller throwing `JOB_CANCELED`. They also cover the
  argv: seek placement and cap, `-tls_verify 1` and `-ca_file`, headers before
  `-i`, one input only. Four tests cover `choosePreviewVariant`.
  **The bound**: segments trickle one byte per 50 ms, and `timeoutMs` is 2 s. The
  test waits 750 ms and finds the ffmpeg process by a UUID marker in its argv,
  read from `/proc`. That is the positive control. It then asserts `null`,
  `TIMEOUT`, 2000 ms ≤ elapsed < 6000 ms, no process with the marker, and no
  `preview-*` directory left. It is Linux-only (`skipIf`), because it reads
  `/proc`.
- `npx vitest run tools/downloader/api/test/thumbnails.test.ts`: 31 tests
  (21 before, 10 new), all pass. The new ones: one grab from the cheapest video
  rung, stored as `image/jpeg`; no grab when the image loads; no grab when the
  image 404s; no grab for a live probe; no grab without video; `null`, a throw, a
  non-JPEG or an oversized answer is no preview; served by
  `/api/thumbnail/:token` as `image/jpeg`; a failing grab's response equals
  `probeForClient(withThumbnailPath(probe, null))`; a job's re-probe gets its
  path from the grab; `previewSource` is `frame` / `null` / `page`.
- `npx vitest run tools/downloader/api/test/frame-grab-egress.test.ts`: 3 tests,
  all pass. A stand-in ffmpeg records its env and argv through the real
  `createApp`, with interception on. `http_proxy` equals `ffmpegProxyUrl`, which
  differs from `egressProxyUrl`. `-ca_file` equals the engine's `tlsCaFile`. The
  headers carry the cookie. With a real ffmpeg, a manifest on `127.0.0.1` whose
  segments are on `localhost` (same socket, not exempt) gives no preview and
  **zero requests** under `/localhost/`. The same manifest with its segments on
  `127.0.0.1` gives a JPEG served as `image/jpeg`.
- **Each proof turned red on its own, with every edit reverted afterwards** from
  a saved copy, then compared:
  - Omitting `requestContext` from the args turned 4 engine tests red.
  - Passing `timeoutMs: undefined` to `runFfmpeg` made the trickle test time out
    at 30 s.
  - Removing **both** byte-cap layers turned the cap test red. Removing either
    layer alone left it green, because the two layers are independent.
  - Making the `isLive` check a no-op turned the live test red.
  - Unwiring `grabFrame` in `routes/probe.ts` and `jobs/orchestrator.ts` turned
    the 4 route tests red.
  - Grabbing after a 404 turned the fails-to-fetch test red.
  - In `server.ts`, `proxyUrl: tierProxy.url` turned only the wiring test red.
    `proxyUrl: ""` turned the wiring test and the blocked-address test red, with
    2 requests to `/localhost/seg*`.
  - `pgrep -a ffmpeg` afterwards: none left.
- `npm run check`: exit 0. `npm test -- --project downloader`: 87 files, 1456
  tests, all pass. `npx vitest run packages/core/test/spawn-safety.test.ts
packages/core/test/image-closure.test.ts`: 11 pass.
  `npm run e2e:downloader` (7 passed) and `npm run e2e:downloader:sniffer`
  (1 passed) both ran locally, with the new code.
- **Citations.** This branch moves lines in `orchestrator.ts`, `server.ts`,
  `routes/probe.ts` and `thumbnails.ts`. Before the fix,
  `node scripts/citations-gate.mjs --against origin/main` failed 5 records:
  dl-18, dl-32, dl-45, dl-57 and dl-60. Each moved citation is now pinned to
  `@20c8fd1`, the base these lines were true of and a commit on `main`. After the
  pins the gate reports 84 enforced, 0 failing, exit 0.

**Not proven here, and what does prove it.** The container was not built. This
changes what the image runs at probe time: an ffmpeg process per probe whose
source names no image, reading `tmp/` under `STORAGE_DIR`. The downloader's
image gate in CI is the proof of that. The e2e suites ran locally, and CI's run
remains the one of record.

**Fold-in: none.** The closest candidate is making the image fetch honour the
caller's abort signal, now that `captureThumbnail` receives one. No ticket
specifies that, and it would change a tested path's behaviour, so it was not
folded in.

**Left for the orchestrator, not settled here — answered on 2026-09-17, and
built in the entry below.** `routes/probe.ts` releases the
server-wide `probeGate` straight after `registry.resolve`, before
`captureThumbnail`. The per-client probe slot is held through the capture. So
concurrent grabs are bounded per client, and each lasts at most 6 s, but nothing
bounds them server-wide. The image fetch always had that shape. A grab is an
ffmpeg process, which is heavier. It is reported as an open decision.

## 2026-09-17 — gate findings answered

Two reviewers gated `cff1440`. Gate A (agent `ad4658d782570769e`) covered
security, egress, injection and kill/cleanup, and passed it. Gate B (agent
`a34392b2236d95ba0`) covered the rest and returned CONCERNS: one med open
decision and one low.

- **Gate B med, the server-wide gate does not bound grabs: reproduced.**
  `scratchpad/dl-56/measure-concurrency.mjs` (not committed) drives
  `createApp` and the real grabber with `maxConcurrentProbes: 2`, against a
  no-image fixture whose segments trickle. Five distinct client addresses each
  probed once, concurrently. All five answered 200, the peak was **5**
  concurrent ffmpeg grab processes (counted from `/proc`), and 0 were left
  afterwards. That agrees with Gate B's 12 against a gate of 8. Not changed
  here: it is the open decision already named at the end of the build entry.
- **Gate B low, the 1-second `-ss` row: partly contested.** My number reproduces
  on my fixture both with and without audio. Gate B's fixture gives 1.00x. The
  row is now marked fixture-dependent in the build entry and in the
  `preview-frame.ts` comment. The choice of output-side seek is unchanged, and
  both reviewers agree with it.
- **Gate A's suggested tests: two added, since neither hop was covered.**
  - `frame-grab-egress.test.ts`, "a segment that redirects to a blocked
    address: the redirect is refused too". Segments on the allowed address
    302 to `localhost`. The first hop is served, nothing under `/localhost/` is
    requested, and no preview results. Red with the grabber's `proxyUrl: ""`
    (2 requests reached `/localhost/seg*`), then restored.
  - `preview-frame.test.ts`, "grabPreviewFrame against a generated split-DASH
    stream". ffmpeg generates DASH with separate video and audio adaptation
    sets behind the header gate. The grab returns a JPEG, and the init and media
    segments carry the Referer. Red with `requestContext` dropped from the args,
    then restored. Until now nothing ran `protocol: "dash"` end to end.
  - Gate A's `#EXT-X-KEY`, `#EXT-X-MAP` and blocked-DASH-`BaseURL` runs were
    **not** turned into tests. They go through the same
    `buildNetworkInputArgs`, `runFfmpeg` and egress plumbing the redirect and
    blocked-segment tests prove, and their fixtures cost more than their
    coverage adds.
- **A flake in my own test, found while re-running the gates.** One full
  `npm test -- --project downloader` run failed the trickle test with
  `expected 1112 to be greater than or equal to 2000`. In that same run the
  `TIMEOUT` assertion just before it passed. The timer is a 2000 ms
  `setTimeout` started after `startedAt`, so it cannot have fired at 1112 ms.
  I read this as the wall clock stepping, which WSL2 is known to do. That is
  inferred, not measured. Both elapsed-time tests now use `performance.now()`,
  which is monotonic. After that change, three isolated runs of
  `preview-frame.test.ts` gave 15/15 each. The full suite is below.
  Full suite after these changes: `npm run check` exit 0, and
  `npm test -- --project downloader` 87 files, 1458 tests, all pass.

## 2026-09-18 — the open decision, answered and built

**The owner chose a server-wide cap on grabs alone**, through
`AskUserQuestion` in the orchestrator's session on 2026-09-17, from the three
options this branch and Gate B put up. **It overrode my own recommendation**,
which was to leave the gap and file a ticket to measure it under load; it
matched Gate B's and the orchestrator's inclination. The reasoning given to the
owner: a grab is bounded at 6 s and nothing waits on it, so a cap of its own
costs the image-fetch path nothing, where holding `probeGate` through the
capture would make every probe hold a slot for a decorative image.

**What it cost, and what it bought.**

- `maxConcurrentFrameGrabs` in `api/src/config.ts`, from
  `MAX_CONCURRENT_FRAME_GRABS`, **defaulting to `maxConcurrentJobs`** — the
  other cap on how many ffmpegs this service runs at once, and 2 out of the
  box. Minimum 1, maximum 64, and **no value that disables it**: a cap that can
  be turned off is the state this entry exists to end. Documented in
  `.env.example` and in `docs/01-ARCHITECTURE.md`'s configuration table.
- `limitFrameGrabs(grab, gate, logger)` in `api/src/thumbnails.ts` wraps
  whichever grabber `server.ts` ends up with — an injected one included, so a
  test exercises the same gate production does. `server.ts` builds one
  `ConcurrencyGate` and puts it on `AppContext.frameGrabGate`.
- **Full means no preview, never a wait**, and this is not a choice I made
  quietly: every other way a preview fails here ends the same way, the probe is
  answered as soon as the resolver returns, and a queue would hold that answer
  for a decorative image. A burst past the cap loses previews rather than
  slowing probes, which is the cost this records.

**Proof.**

- `api/test/thumbnails.test.ts` gains three tests: five concurrent calls
  against a gate of 2 start the inner grabber exactly twice and answer `null`
  three times, with nothing waiting; a slot is released when the grab throws;
  and three concurrent probes through the real route, with
  `maxConcurrentFrameGrabs: 1`, produce one preview and two probes that answer
  without one.
- **Red without the cap, in two mutations, both restored.** Making
  `limitFrameGrabs` pass its grabber straight through reddens the first and the
  third. Unwrapping the grabber in `server.ts` alone reddens the third, which
  is the one that goes through the wiring.
- **The script that found the gap now reports the cap.**
  `scratchpad/dl-56/measure-concurrency.mjs`, unchanged from the run in the
  gate entry: five clients probing a trickling no-image fixture at once, peak
  concurrent ffmpeg grabs **2** (it was 5), none left afterwards, and all five
  probes still answered 200. Raising the cap to 8 in the same script puts the
  peak back to 5, so the script can still see what it saw before.
- `npm run check` exits 0. `npm test -- --project downloader`: 87 files, 1461
  tests, all pass (1458 + 3). `node scripts/citations.mjs` on this record's
  Review section: 15 verified, exit 0. `citations-gate.mjs --against
origin/main`: 85 enforced, 0 failing.
- Gate B's Review cites six lines that this entry's code moved — the
  `server.ts` call and five in `thumbnails.test.ts`. Each is repointed to the
  line its own anchor text is on now, which the section's disclosure note
  records; no anchor text and no verdict changed.
