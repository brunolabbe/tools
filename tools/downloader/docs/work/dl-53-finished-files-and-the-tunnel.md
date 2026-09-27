---
id: dl-53
tool: downloader
title: Stream each finished file to its visitor as ffmpeg produces it, and keep no copy anywhere
kind: work-package
status: in-flight
milestone: M5
depends_on: [dl-50, dl-51]
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

## Decisions — answered 2026-09-27 by the owner, not open

Raised by the builder after Build steps 1 and 2, before the contract was
touched, and put to the owner by the orchestrator. Every answer is the
builder's recommendation, accepted — owner, 2026-09-27, via the orchestrator.

1. **Where the single-use link lives.** (a) a new `JobLink { url, expiresAt }`
   and an optional `Job.link`, null once opened or expired, with `JobResult`
   losing `downloadUrl` and `expiresAt`; (b) the link only on the `POST`
   response, kept by the web app on its own. **Chose (a).**
2. **The `muxing` state.** (a) removed, with a migration moving `muxing` rows
   to `failed`; (b) kept as a state nothing enters. **Chose (a).**
3. **A used or expired link.** (a) `410` with core's `FILE_EXPIRED`, the
   downloader's message reworded; (b) a new downloader code, `LINK_USED`.
   **Chose (a).**
4. **`DISK_FULL`.** (a) the downloader stops raising it and it stays in core,
   with no core edit here; (b) removed from `packages/core`. **Chose (a).**
5. **dl-44's thumbnails on disk.** (a) no longer saved, keeping dl-29's
   ten-minute in-memory preview; (b) moved to a directory of their own with its
   own retention. **Chose (a).** This reverses what dl-44 shipped.
6. **A `GET` that finds no free job slot.** (a) waits in line, capped so the
   wait plus the probe timeout stays under 100 s, then `429` with
   `Retry-After`; (b) refused at once with `429`; (c) waits with no cap.
   **Chose (a).**
7. **How long a link lives.** (a) a fixed fifteen minutes, not a setting, and
   an unopened link expires its job `queued → canceled`, reason
   `link-expired`; (b) a setting, `DOWNLOAD_LINK_TTL_MINUTES`. **Chose (a).**

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

- 2026-09-27 — **Build step 1 measured; step 2 (the engine) built; stopped
  before the contract**, per the Build's "raise it with the owner before
  editing". Branch `dl-53-stream-to-visitor` off `origin/main` `c87153d`.

  **Step 1, streaming.** A fixture HLS playlist (180 s, 1280x720 at 3 Mb/s,
  45 segments, 72,888,728 bytes of `.ts`) served by a Referer-gated local
  origin, fetched by the distribution ffmpeg 6.1.1 through the loopback egress
  proxy (`startEgressProxy` with an SSRF guard allowing `127.0.0.1`), written
  as `-movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1` with
  `-progress pipe:3`. The script and its output are in the builder's scratch
  directory, not the tree:

  | reader                | first byte | total     | bytes out  | peak ffmpeg RSS | Node RSS before → peak |
  | --------------------- | ---------- | --------- | ---------- | --------------- | ---------------------- |
  | full speed, to a file | 68 ms      | 710 ms    | 70,617,030 | 59.1 MB         | 96.2 → 136.1 MB        |
  | 1 MB/s (pause/resume) | 63 ms      | 66,963 ms | 70,617,030 | 59.4 MB         | 136.2 → 138.0 MB       |
  | full speed, discarded | 58 ms      | 642 ms    | 70,617,030 | 56.6 MB         | 112.4 → 126.1 MB       |

  Backpressure holds: a reader 100x slower than the source leaves ffmpeg's RSS
  flat and Node's within 2 MB. `ffprobe` read the fragmented output as
  `mov,mp4,m4a,3gp,3g2,mj2`, `h264` + `aac`, duration `180.024331`. A 30 s
  fixture gave first bytes of 81, 56 and 56 ms and the same flat ~58 MB.

  **Step 1, re-probe.** Five `POST /api/probe` with `refresh: true` on the e2e
  fixture's MSE page (`startHlsOrigin().watchUrl`) through `createApp` with the
  browser tier on and yt-dlp off, each answered by `browser` with 2 variants:
  3,327, 2,826, 2,755, 2,761 and 2,758 ms. **Re-probe plus first byte is about
  3.4 s against Cloudflare's 125 s**, on a fixture page. A real site is slower
  (the analysis says 10–20 s); the bound that matters is `PROBE_TIMEOUT_MS`
  (45 s default) plus any wait for a job slot — see the open decisions below.

  **What the brief had wrong.**
  - **A progressive MP4 cannot be piped into ffmpeg.** Measured with ffmpeg
    6.1.1: an MP4 with its `moov` at the end (ffmpeg's own default layout) fed
    on stdin logs `partial file`, **exits 0**, and writes a 1,293-byte output
    with no samples; the fast-start copy of the same file converts. Straight
    to the response would not be fragmented. So progressive sources go to
    ffmpeg **as a URL**, through the egress proxy with the replayed headers,
    exactly as manifests do, and ffmpeg seeks with `Range`. One code path for
    every protocol; `engine/src/stream.ts` says why in its header.
  - **The contract holds no settings.** Build step 5's settings live in
    `api/src/config.ts` and `engine/src/config.ts`; the contract's part is the
    job result, the link, the `muxing` state and one error message.
  - `DISK_FULL` and `FILE_EXPIRED` are `@webtools/core` codes, not the
    downloader's, so "remove `DISK_FULL`" reaches into `packages/core`.

  **Built, engine only, additive.** `engine.stream()` beside `download()`,
  which the API still calls until the contract is settled: one ffmpeg per
  attempt, every input over the network (subtitles as `-f webvtt`/`-f srt`
  inputs), output on stdout, progress on descriptor 3 (`streamFfmpeg` in
  `runner.ts`). It resolves at the first byte and rejects before it with the
  code; mirror failover and a retry without subtitles happen only before it.
  After it, `done` rejects and the body is destroyed. The body is piped with
  `end: false` — without it, a killed ffmpeg's stdout ends like any other and a
  timed-out stream reached the client as a clean, complete response (the
  "error after the first byte" case failed exactly that way before the fix).
  Bytes sent are counted in Node, so the size cut is exact.

  `npx vitest run tools/downloader/engine/test/stream.test.ts`: 15 of 15.
  Mutations, each reverted: a temp file written beside the first chunk failed 7
  of 15 on the directory listing (`{ tmp: [ 'leak-HLS6s' ] }`); pointing the
  11 s case at the 6 s fixture failed on duration (`4.962812` against a 0.6 s
  tolerance); `+faststart` in place of the fragmented flags failed 13 of 15.
  `npx vitest run tools/downloader/engine`: 204 of 204 across 17 files.

  Ten merged `## Review` citations into `args.ts`, `runner.ts`, `index.ts` and
  `api/test/helpers.ts` (dl-19, dl-34, dl-45, dl-50, dl-56, dl-58) moved and
  are pinned to `c87153d`; `node scripts/citations-gate.mjs --against
origin/main` exits 0.

  **Open, and put to the owner through the orchestrator:** the contract diff (a
  single-use `link` on `Job`, `downloadUrl` and `expiresAt` off `JobResult`,
  `muxing` removed, `FILE_EXPIRED`'s copy), `DISK_FULL`, dl-44's persisted
  thumbnails (they are written into the output directory this ticket removes),
  how long a link lives, and whether a `GET` waits for a slot. Steps 3 to 6
  wait on the answers.

- 2026-09-27 — **Steps 3 to 6 built on the owner's seven answers** (the section
  above). Same branch, on top of `bffbb5c`.

  **What changed, by package.**
  - **contract**: the diff raised before, applied as proposed — `JobLink` and
    an optional `Job.link`; `JobResult` without `downloadUrl` and `expiresAt`;
    no `muxing`; `FILE_EXPIRED`'s copy reworded. `canceled` now says why on
    `error.details.reason`: `requested`, `disconnected` or `link-expired`.
  - **engine**: `stream()` is the whole surface. `download()`, `Storage`, the
    retention sweep, the quota, the disk check, the manual segment path and the
    engine's own fetch and retry code are deleted, with their suites. The
    preview-frame grab writes its JPEG to stdout rather than to `tmp/`, which
    is what lets "nothing on disk" include `STORAGE_DIR/tmp` (a fold-in: the
    alternative was keeping a tmp directory and an orphan sweep for one JPEG).
  - **api**: `POST /api/jobs` creates the row and a fifteen-minute link and
    takes no slot. `GET /api/files/:token` checks the wait line and dl-51's
    per-client cap **before** spending the link, claims it atomically, waits
    for a slot for at most `100 s − PROBE_TIMEOUT_MS` (then gives the link back
    and answers `429`), and sends headers at the first byte. A disconnect
    before or after it cancels the job, reason `disconnected`. No automatic
    `HEAD` route. Migration 6 adds `job_links` and `jobs.link_json`, drops
    `file_tokens` and `thumbnail_files`, and fails `muxing` rows — including
    a `muxing` left in `progress_json.stage`, which the first draft missed and
    `schema.test.ts` caught. The sweep now runs every minute and cancels
    expired links; `report.ts` leaves `canceled` jobs out of the download rate.
  - **web**: the card offers the link while the job is queued, with its
    expiry, and says "Saved by your browser. The server kept no copy." when it
    completes. Progress is bytes sent; `percent` comes from media time when the
    duration is known and is `null` otherwise, never from a byte total.
  - **docs**: `01-ARCHITECTURE.md`, `.env.example`, `docs/02-DEPLOYMENT.md`
    ("Operating it", the accepted risk and its relay fallback, and two
    sentences elsewhere that named settings this build no longer reads), the
    e2e download and sniffer specs, `compose.downloader.yaml` and the tool's
    `CLAUDE.md`.

  **dl-44's shipped behaviour is reversed, on purpose.** A completed job's
  preview no longer lasts as long as its file, because there is no file: it
  lasts ten minutes in memory, like a probe's. dl-44's Log says so.

  **What the brief or the first round had wrong.**
  - **A fresh volume would not boot.** The engine used to create `STORAGE_DIR`
    for its working files, and the database relied on it. The e2e run failed
    at boot with `Cannot open database because the directory does not exist`;
    `createApp` now makes the database's directory, and
    `api/test/stream-link.test.ts`'s "a fresh volume" case fails without it.
  - **Deleting the engine's `hls.ts` broke a repo test.**
    `scripts/test/citations.test.ts` used `hls.ts` as its ambiguous bare
    basename; it now uses `events.ts`, of which four are tracked.
  - **Stored files from before this ticket stay on an upgraded volume.** The
    API reports `out/` and `tmp/` at boot and does not delete them; the
    deployment doc gives the one command. Deleting them automatically was the
    alternative, not taken: a recursive delete keyed on a configured path is
    one wrong `STORAGE_DIR` from deleting something that was never ours.

  **Could have folded in, and did not.** `MUX_FAILED` is now raised by
  nothing — every stream is one ffmpeg reporting `DOWNLOAD_FAILED` — but
  removing a code is a contract change nobody decided. `RATE_LIMIT_FILES_PER_MINUTE`'s
  default of 600 was sized for seeking in a stored file and is now far above
  what a single-use link needs; lowering it is a setting's default, and the
  owner's to choose.

  **Evidence.**
  - `npx vitest run --project downloader`: 1,507 passed, 2 skipped, of 1,509.
  - `npm test`, after the last change: 3,293 passed, 2 skipped, of 3,295, in
    179 files. One earlier full run failed the engine's "error after the first
    byte" case under load — its 1.5 s timeout could land before the first byte.
    Both such cases now stall only from the third segment on, with a 4 s budget.
  - `npx playwright test -c tools/downloader/playwright.config.ts`: 9 passed,
    `download.spec.ts` included — a real browser follows the link, Playwright
    saves the download, its bytes 4–8 are `ftyp`, the card reaches "Saved by
    your browser", and a second `GET` on the link answers `410`.
  - `npx playwright test -c tools/downloader/playwright.sniffer.config.ts`: 1
    passed.
  - Mutations, each reverted: no `exposeHeadRoute: false` failed the `HEAD`
    case; no cancel on `close` failed both disconnect cases and the
    waiting-visitor case; no `mkdir` failed the fresh-volume case with the
    production error.
  - The container-build line is `unproven (gate)`: nothing here builds the
    image.
  - The deletions and moves reached 157 more `## Review` citations in 29 merged
    records; each is pinned to `c87153d`, where it held. `scripts/test/citations.test.ts`
    keeps its line count, so repo-25 and repo-50 cite it unchanged.
    `node scripts/citations-gate.mjs --against origin/main` exits 0.

- 2026-09-27 — **Round three: both gates' findings, on the owner's answers of
  the same day** (every answer took the gate's or the builder's
  recommendation). The two gate records were committed first, verbatim, with
  `scripts/review-record.mjs`; the formatter's only changes were blank lines
  and `*emphasis*` to `_emphasis_`.

  **Gate 2, high — a source that fails after the first byte ended as a short
  success. Reproduced, fixed, but not the way the finding proposed.**
  - Red first: `engine/test/stream.test.ts`'s new last case ("a source that
    fails after the first byte fails the stream, not a truncated success")
    serves six 1 s segments and resets every connection from the third.
    Before the fix it failed with `expected false to be true` on
    `received.aborted`: the client got a clean, complete response.
  - **`-err_detect explode` does not do it, and the gate's evidence for it was
    an artefact.** On distro ffmpeg 6.1.1, on the gate's own fixture
    (`gate-b/midfail-fixture`), with the stream's output flags: exit 0 and
    39,487 bytes with no flag; the same with `-err_detect explode` as an input
    option, as an output option, on both sides, as `-f_err_detect explode`,
    and with `-xerror`. Without `-bsf:a aac_adtstoasc` the same command exits
    **255** with no flag at all — `Malformed AAC bitstream … Error muxing a
packet` — which is the exit the gate recorded. The fix the owner chose
    ("`-err_detect explode` or equivalent") is therefore the equivalent: the
    engine watches ffmpeg's stderr for the HLS demuxer's giving-up line,
    `failed too many times, skipping`, and ends the stream with
    `DOWNLOAD_FAILED` the moment it appears (`SEGMENT_SKIPPED` in
    `engine/src/stream.ts`). A retry that succeeds does not match; only the
    give-up does. The case is green after it.
  - **Not checked against real-world sources for false failures.** A source
    whose segments ffmpeg used to skip quietly now fails where it used to
    finish short. **A segment refused on its certificate is skipped the same
    way**, and the first draft reported it as `DOWNLOAD_FAILED`: two cases in
    `api/test/two-origin-tls.test.ts` failed on exactly that (`expected
'DOWNLOAD_FAILED' to be 'TLS_VERIFICATION_FAILED'`). The skip now ends the
    stream as `TLS_VERIFICATION_FAILED` when a certificate line came first, as
    the runner classifies an exit. DASH was not reproduced the same way: its demuxer fails at
    open on the equivalent fixture (exit 183) rather than skipping, so no
    pattern is claimed for it.

  **Gate 1, med — the wait cap did not allow for the re-probe. Fixed as
  decided.** `maxLinkWaitMs` is now `100 s − PROBE_TIMEOUT_MS ×
(MAX_REPROBE_RETRIES + 1)`: 10 s at the 45 s default, and 0 from 50 s up.
  Red first: the new case at the end of `api/test/stream-link.test.ts` failed
  with `expected 55000 to be 10000`, and passes after. The deployment doc,
  the architecture diagram and the route's header say "both probes" now.

  **Gate 2, med — the card ignored `details.reason`. Fixed as decided.** The
  card renders `job.error`, and `presentError` picks the title and detail
  from a closed table keyed by `requested`, `disconnected` and
  `link-expired` ("Canceled", "Download interrupted", "Link expired"). Three
  new cases at the end of `web/test/job-card.test.tsx`, one per reason; all
  three failed before the change.

  **Gate 2, med — `runFfmpeg` had no production caller. Removed.**
  `streamFfmpeg` is the runner's only entry now, `PROGRESS_ARGS` (stdout
  progress) went with it for the same reason, and `FfmpegFailureCode` is
  `DOWNLOAD_FAILED` alone, so `MUX_FAILED` cannot be raised by construction
  rather than by accident. `ffmpeg-runner.test.ts` and `proxied-https.test.ts`
  drive `streamFfmpeg` through a three-line helper, with every assertion as
  it was.

  **Gate 2, low — "nothing written" proves less than it says. Narrowed, not
  widened.** Listing more directories cannot close it: a write to a
  hard-coded path lands wherever it lands, and the gate's own mutation showed
  exactly that. So Done-when 2's verdict is now "the storage directory and
  the process's temp directory are unchanged", which is what the tests list,
  and the rest of the claim rests on Done-when 8's source search, which finds
  no file write under `tools/downloader/*/src` beyond the boot-time CA files
  of the TLS interception.

  **The builder's three calls, accepted:** files stored by older builds stay
  and are logged; `RATE_LIMIT_FILES_PER_MINUTE` stays at 600; and removing
  `MUX_FAILED` is filed as
  [dl-74](./dl-74-retire-mux-failed.md) — the next free id, checked against
  every remote branch as well as `main` (the highest anywhere was dl-73) —
  and not implemented.

  **`status: in-flight`**, set in this round: with a `## Review` section the
  ticket can no longer read `ready` — `npm run status -- --json` exits 1 on
  exactly that (`reviewedButReady` in `scripts/status.mjs`) — and it is not
  `done` until the re-gate and the landing.
