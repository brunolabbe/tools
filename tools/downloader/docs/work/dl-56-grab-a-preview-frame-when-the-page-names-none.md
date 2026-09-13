---
id: dl-56
tool: downloader
title: A probe whose page names no preview image gets one frame grabbed from its chosen stream
kind: work-package
status: ready
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
- `npm run check` and `npm test -- --project downloader` pass. This changes
  what the container runs at probe time, so say that the downloader's e2e and
  image gates in CI are the proof a local run does not supply.

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
