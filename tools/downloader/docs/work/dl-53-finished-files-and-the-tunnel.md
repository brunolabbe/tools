---
id: dl-53
tool: downloader
title: Stream each finished file to its visitor as ffmpeg produces it, and keep no copy anywhere
kind: work-package
status: ready
milestone: M5
depends_on: []
difficulty: hard
---

# dl-53 — Finished files and the tunnel

**Packages:** `engine` (a streaming output, and the stored-file machinery
removed), `api` (the file route, the orchestrator, the retention sweep),
`contract` (job result and settings), `web` (the job card), and the deployment
docs.

## Why

A public service is exactly the scale at which anyone notices bulk video, and
today every finished file is first stored under `STORAGE_DIR`, then served
through the Cloudflare tunnel from `/api/files/:token`. Two problems follow:

- **The host keeps copies of videos whose content nobody has checked.** They
  stay for up to `FILE_RETENTION_HOURS`.
- **Cloudflare's terms** do not allow video through the proxy on any plan short
  of Enterprise. The Log has the reading.

## Decision — answered 2026-09-13 and 2026-09-14 by the owner, not open

1. **Stream each file to its visitor as it is produced, and keep no copy.** The
   owner's reason: "we don't know the content of the videos", so no copy should
   be kept anywhere or pushed to another company's servers.
2. **Over the tunnel, accepting the terms risk.** The video still passes
   through Cloudflare's proxy, which the CDN terms name. What the owner
   accepted: after a notice ("reasonable efforts"), Cloudflare may disable or
   limit the zone, and the planner shares the tunnel. **The fallback, if a
   notice arrives,** is a relay:
   - a DNS-only file hostname, which Cloudflare's proxy never carries;
   - pointing at a small VPS that forwards to the host over WireGuard, so the
     home address stays private and nothing is stored on the way.

   As read on 2026-09-14, Hetzner starts around €5–8/month and includes 20 TB
   of outbound traffic in EU regions (1 TB in US regions), with about €1/TB
   beyond.

3. **Streaming only.** Stored files, their tokens-to-paths, the file retention
   and the storage quota are removed for every deployment, self-hosted copies
   included. The owner chose this over keeping stored files behind a setting.
4. **Nothing on disk, not even while a transfer runs.** The owner asked
   whether ffmpeg could keep segments in memory. Measured on 2026-09-14, that
   costs no coverage:
   - HLS and DASH already never write a segment. ffmpeg reads the manifest
     over HTTP and writes the output in one pass (`download/manifest.ts`).
   - The manual segment path, which does write segments to `tmp/<jobId>/`,
     has no caller outside the engine: nothing in `api`, `resolvers` or
     `contract` passes `segmentUrls`.
   - The remaining disk writes are the output file, progressive downloads
     (Node writes the file) and opt-in subtitle tracks. All three can become
     pipes.

The alternatives, so they are not re-opened as oversights:

- **R2 with signed links** was rejected because it stores a copy on a company's
  servers.
- **Browser-direct download** was not chosen. It keeps no bytes on the host,
  but a browser cannot send another site's `Cookie` or `Referer`, and signed
  links are often bound to the probing host's IP (00-ANALYSIS §5). Its
  coverage is unknown.
- **Serving straight from the home address** was not chosen.

**What the owner accepted with streaming**, discussed on 2026-09-14:

- **Fragmented MP4, not fast-start MP4.** Fast-start needs a finished file to
  rewrite (`mux.ts`). Fragmented MP4 plays in browsers, VLC, mpv and QuickTime.
  Some players show the duration late or seek slowly in long files, and a
  cut-off download still plays up to the cut. MKV is out: Safari and iOS do
  not play it.
- **No resume.** An interrupted transfer restarts from zero, re-probe
  included. That covers sleep, a network switch, and every redeploy or
  cloudflared restart, which cuts all streams in flight.
- **No size or time left in the browser.** A stream's length is not known
  when its headers are sent, so there is no `Content-Length`.
- **Single-use links.** A link starts a new probe and a new ffmpeg each time it
  is opened, so a shared link is a second download, not a copy.

## Build

**Contract first.** Steps 1 and 5 change `@downloader/contract`: the job
result's link semantics, the `muxing` state, and the settings. Write the diff
and raise it with the owner before editing, per the root `CLAUDE.md`.

1. **Measure before building.** Using the fixture origins and the loopback
   egress proxy, stream a fixture HLS playlist through ffmpeg as fragmented MP4
   to `pipe:1` (`-movflags frag_keyframe+empty_moov+default_base_moof`). Record:
   - the time to its first output byte;
   - that `ffprobe` reads the result;
   - the peak RSS of ffmpeg and Node while a slow reader applies backpressure.

   Then time a browser-tier re-probe on the fixture page. **Cloudflare returns
   524 if the origin sends no response within 125 s** (its Error 524 doc, read
   2026-09-14), so re-probe plus first byte must fit well inside that. Write
   the numbers in the Log. If they do not fit, stop and raise it.

2. **Engine: a streaming download.** One entry point takes the same request as
   `download()` and returns a readable body with its content type and
   filename, instead of a path.
   - HLS and DASH: the existing single ffmpeg pass, with output to a pipe.
   - Progressive: the fetch body piped through ffmpeg (for the container) or
     straight to the response. There is no ranged resume against the source
     once bytes have gone out.
   - Subtitles: passed to ffmpeg as extra network inputs with the replayed
     headers, through the egress proxy, never fetched to a file.
   - Retries and mirror failover (dl-45) apply only **before the first byte**.
     After it, a failure ends the stream.
   - Cancellation kills the process tree, as today.
3. **API: the link starts the work.** `POST /api/jobs` validates, runs dl-50's
   check, creates the job row and returns a single-use, short-lived link. It
   does no download work.
   - `GET` on the link takes the job slot (dl-51's per-client cap counts it)
     and re-probes. It sends headers as soon as ffmpeg emits the MP4 header.
   - An error before the headers is the usual JSON `AppError`. An error after
     them aborts the connection, and the job row records the code.
   - A visitor disconnecting cancels the job and is recorded as its own
     outcome, not a failure (dl-57).
   - A second `GET` on a used link answers `410`.
   - Keep the `/api/files/` path, so dl-23's per-token limit and dl-49's note
     on the Access bypass still describe the same route.
4. **Web:** the job card's download button follows the link. Progress shows
   bytes sent from the existing event stream, with `null` totals (never fake
   progress).
5. **Remove the stored-file machinery:**
   - the output directory and its layout, and the file retention sweep;
   - `MAX_TOTAL_STORAGE_GB`, `FILE_RETENTION_HOURS` and `STORAGE_DIR`'s output
     role;
   - the manual segment path with no caller, and `DISK_FULL`, if nothing else
     raises it.

   `MAX_FILE_SIZE_MB` stays. The engine's size estimate refuses before
   starting, and a stream that passes the cap is cut and recorded as
   `SIZE_LIMIT_EXCEEDED`. Thumbnails are dl-29's and stay.

6. **Docs:** update `01-ARCHITECTURE.md` (the engine seam and settings table),
   `.env.example`, `docs/02-DEPLOYMENT.md` (the volume, "Operating it", and
   the accepted risk with the relay fallback) and the e2e download spec.

## Done when

- HLS (fixture), DASH with a separate audio rendition (fixture) and
  progressive (fixture) each stream to a real HTTP client as fragmented MP4.
  `ffprobe` reads each one with the expected streams and a duration within
  tolerance of the source, over fixtures of different lengths.
- A test lists the storage directory and the OS temp directory before and
  after each of those streams, and they are unchanged. The same holds with
  subtitle embedding on.
- A test proves response headers arrive before the stream completes. The
  Log's measurement puts re-probe plus first byte under 125 s on the browser
  tier.
- A client that disconnects mid-stream leaves no ffmpeg process, and its job
  row carries the cancelled outcome.
- An error before the first byte answers JSON with its code. An error after it
  aborts the connection, and the job row carries the code.
- A second `GET` on a used link answers `410`.
- A stream that passes `MAX_FILE_SIZE_MB` is cut and recorded as
  `SIZE_LIMIT_EXCEEDED`.
- No production code writes under the removed output directory, and no setting
  named in step 5 is still read. A search of `tools/downloader/*/src` says so.
- `npm run check`, `npm test` and the downloader e2e suite are green. The
  container build downloads a real HLS stream end to end, which is
  `unproven (gate)` until that workflow runs.

## Log

- 2026-09-13 — Filed as `needs-decision`. Cloudflare's current terms had not
  been read for this filing. That reading came first.
- 2026-09-13 — **Terms read, and they are stricter than the deployment doc
  said.** WebFetch is blocked in the devcontainer, so this reading comes from
  web search results that quote the pages, not from loading them directly:
  - [Service-Specific Terms, CDN section](https://www.cloudflare.com/service-specific-terms-application-services/):
    unless you are on Enterprise, video and other large files served through
    the CDN must use a paid service such as Stream, Images or the Developer
    Platform. Cloudflare may disable or limit the CDN for a customer serving
    video, or a disproportionate share of large files, without one, with
    reasonable efforts at notice.
  - [Cloudflare's 2023 terms update](https://blog.cloudflare.com/updated-tos/)
    names content hosted on R2 as allowed.
  - [Delivering Videos with Cloudflare](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/)
    applies the rule to Tunnel public hostname routes on Free, Pro and
    Business plans.

  The zone's plan was not checked (`gh api` is denied, and the Cloudflare token
  lives in a `.env`). Anything short of Enterprise is covered.
  `docs/02-DEPLOYMENT.md` said "discouraged" and was corrected.

- 2026-09-14 — **Decided, as recorded above, and moved to `ready`.** Two facts
  were measured for the decision:
  - no production caller passes `segmentUrls`;
  - the web UI links to the finished file (`JobCard.tsx`) and never plays it
    inline, so no in-page player depends on `Range`.

  The 524 limit is 125 s per Cloudflare's Error 524 doc, not the 100 s often
  quoted. Relay pricing was read from Better Stack's and Deploy Handbook's
  2026 Hetzner reviews. Neither the plan nor the price is contractual here.
