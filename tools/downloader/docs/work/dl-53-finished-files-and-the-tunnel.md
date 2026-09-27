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

## Review

### Gate 1

Re-resolved at f96ad15 for round 3: no citation in this section moved this round (round 3s diff on this angle touched only config.ts, .env.example, config.test.ts and stream.ts, none of which this section cites); words and verdicts are unchanged from the round-1 record.

**Gate: CONCERNS** -- 2026-09-27 . `c87153d...9794c04` (head `9794c04940f4b7a9b01ac6aa6c9c99c508867733`; origin/main unchanged at `c87153d` since dispatch) . code-review at hard, angle A only -- the link lifecycle and its security. A second, parallel gate covers the engine, the migration, the removal of stored files, the web card and the citation pins; this section speaks only to the link and the request that opens it: `api/src/routes/files.ts`, `api/src/jobs/links.ts`, `api/src/jobs/orchestrator.ts`, `api/src/routes/jobs.ts`, `api/src/db/job-store.ts` (the job_links methods only), and the parts of `contract/src/job.ts` and `contract/src/errors.ts` that shape the link and FILE_EXPIRED.

Measured first, before the diff. createApp with a real fixture HLS origin and real ffmpeg (6.1.1), POST /api/jobs, GET the returned link over a real socket, saved the body, ffprobed it, listed the storage and temp directories before and after, and read the job row from the store. Script and full output kept in the scratch directory as measure2.test.ts. Result: GET answered 200, content-type video/mp4, content-disposition attachment, no content-length; ffprobe read mov,mp4,m4a,3gp,3g2,mj2, h264+aac, duration 6.037188 against a 6 s fixture; the job row went queued through to completed with result.sizeBytes equal to the received byte count and link: null; the storage and temp directories were byte-for-byte identical before and after (only a pre-existing, unrelated egress-CA temp directory present in both). This is the same shape as `tools/downloader/api/test/stream-link.test.ts:495 "streams to a real client as fragmented MP4 that ffprobe reads, and nothing is kept"`, which I also ran and which passed; the sibling engine gate owns the DASH/progressive/subtitle cases of that line.

**Verdicts, only for the acceptance text inside this angle:**

| Item                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                        | Verdict                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Headers arrive before the stream completes (Done when #3, first half)                                                                        | `tools/downloader/api/test/stream-link.test.ts:526 "the headers arrive before the stream completes"`                                                                                                                                                                                                                                                         | proven                                                                                                                                                       |
| Disconnect mid-stream leaves no ffmpeg, job row carries the canceled outcome (Done when #4)                                                  | `tools/downloader/api/test/stream-link.test.ts:174 "a visitor who disconnects mid-stream cancels the job"` (stub engine) and `tools/downloader/api/test/stream-link.test.ts:538 "a client that disconnects mid-stream leaves no ffmpeg, and the job is canceled"` (real ffmpeg, Linux only via skipIf)                                                       | proven -- both re-run by me, green; each turned red under my own mutation, below                                                                             |
| Error before the first byte answers JSON with its code; error after aborts and the job row carries the code (Done when #5)                   | `tools/downloader/api/test/stream-link.test.ts:133 "an error before the first byte answers JSON with its code"`, `tools/downloader/api/test/stream-link.test.ts:153 "an error after the first byte cuts the connection"`, `tools/downloader/api/test/stream-link.test.ts:587 "an error after the first byte aborts the connection with the code on the job"` | proven -- re-run green; the before-first-byte half turned red under my own mutation, below                                                                   |
| A second GET on a used link answers 410 (Done when #6)                                                                                       | `tools/downloader/api/test/routes.test.ts:633 "a used link is 410 Gone, not 404"`, `tools/downloader/api/test/job-store.test.ts:353 "a link is claimed exactly once, and claiming it withdraws it from the job"`, `tools/downloader/api/test/routes.test.ts:670 "an unopened link canceled from the card is withdrawn with its job"`                         | proven -- re-run green; two independent mutations, below, each turned exactly one of these red                                                               |
| A stream that passes MAX_FILE_SIZE_MB is cut and recorded SIZE_LIMIT_EXCEEDED (Done when #7)                                                 | `tools/downloader/api/test/stream-link.test.ts:569 "a stream that passes MAX_FILE_SIZE_MB is cut and recorded as SIZE_LIMIT_EXCEEDED"`                                                                                                                                                                                                                       | verified passing, but the cut itself lives in engine/src/stream.ts -- out of this angle; the sibling engine gate owns the negative half                      |
| Done when #1, #2, #8, #9 (formats/ffprobe/dirs across HLS+DASH+progressive, no writes under the removed directories, npm run check/test/e2e) | --                                                                                                                                                                                                                                                                                                                                                           | not this angle -- the sibling gate (engine, migration, removed storage) owns these; I spot-checked only the HLS case of #1 and #2 above while measuring once |

**The seven 2026-09-27 owner decisions, as recorded in the ticket at lines 88-115, checked against the code:**

- #1 (JobLink with url and expiresAt, optional Job.link, JobResult without downloadUrl/expiresAt) -- confirmed: `tools/downloader/contract/src/job.ts:121 "export interface JobLink"`, `tools/downloader/contract/src/job.ts:104 "export interface JobResult"` (no link fields), `tools/downloader/contract/src/job.ts:101 "There is no link here any more"`.
- #3 (410 with core FILE_EXPIRED, reworded message) -- confirmed: `tools/downloader/contract/src/errors.ts:89 "This download link has expired or was already used"`.
- #4 (downloader stops raising DISK_FULL, stays in core, no core edit) -- confirmed: no raise site under tools/downloader/*/src (a grep for DISK_FULL finds only the two exhaustive status/UI maps that the ErrorCode union forces every code, raised or not, into); packages/core is untouched by this diff.
- #6 (bounded wait, 429 plus Retry-After, wait plus probe timeout under 100 s) -- confirmed for the case the decision literally describes, one probe attempt, with a finding -- see below.
- #7 (fixed 15-minute link, unopened goes queued to canceled reason link-expired) -- confirmed: `tools/downloader/api/src/jobs/links.ts:22 "LINK_TTL_MS = 15 * 60_000"`; `tools/downloader/api/test/routes.test.ts:643 "past its fifteen minutes an unopened link is 410"`; `tools/downloader/api/test/stream-link.test.ts:289 "the sweep cancels a job whose link expired unopened"`.
- #2 and #5 are the migration/thumbnail-storage half of the ticket, the sibling gates angle, not re-checked here beyond confirming `tools/downloader/contract/src/job.ts:20 "export const JOB_STATUSES"` no longer lists muxing.

**Attacks, run myself, not read off the diff:**

1. Single use under concurrency. 10 concurrent real-socket GETs at one freshly-issued link: 1x200, 9x410, every time across repeated runs (own script, attacks.test.ts, in the scratch directory). GET racing a cancel: `tools/downloader/api/test/pipeline.test.ts:562 "cancelling a running job reaches canceled, not failed"` opens the link, waits for probing, cancels via POST /api/jobs/:id/cancel while the resolver is still blocked, and asserts canceled, JOB_CANCELED, engine.calls === 0 -- re-run, green. GET racing expiry: not a real race in this process -- findLink, claimLink, the expiry check and queue.enqueue run with no await between them, so two requests cannot interleave inside that block; `tools/downloader/api/src/server.ts:772 "export function runSweep"` independently double-guards against a sweep racing an in-flight claim (expiredLinks only selects used_at IS NULL rows, and the sweep re-checks job.status !== "queued" before canceling), so a link already claimed by a GET is never touched by the sweep. I did not find a way to make these interleave; recorded as a property of the single-process execution model, not as an exhaustive fuzz.
2. Spending the link without work. HEAD and OPTIONS on a freshly-issued link: both 404 (no route registered -- exposeHeadRoute: false at `tools/downloader/api/src/routes/files.ts:95 "exposeHeadRoute: false"`, and no OPTIONS route exists with CORS_ORIGINS unset), and the job afterwards is still queued with its original link unchanged (own script, attacks.test.ts; also `tools/downloader/api/test/routes.test.ts:659 "a HEAD does not spend the link"`, re-run green). A GET refused by the per-client cap or the queue-full wait line: `tools/downloader/api/test/per-client-caps.test.ts:168 "a client over MAX_JOBS_PER_CLIENT gets a well-formed RATE_LIMITED"` and `tools/downloader/api/test/per-client-caps.test.ts:196 "MAX_QUEUED_JOBS refuses a new job immediately once the wait line is full"`, plus my own refusals.test.ts in the scratch directory, both confirming the job stays queued with link deep-equal to the one issued at POST -- the refusal happens before store.claimLink is ever called (the admission block in files.ts precedes the claim), so there is nothing to give back, because the link was never spent. A GET that fails before the first byte, for example a bad source, does spend the link -- store.claimLink runs before the job is enqueued, and nothing refunds it on an ordinary failure; only the bounded-wait timeout explicitly calls releaseLink. This matches the tickets own wording, "a second GET on a used link answers 410", not "on a failed one", and decision 7s "opened or has expired" -- a failed attempt is opened.

3. The wait-for-slot cap -- finding. `tools/downloader/api/test/stream-link.test.ts:239 "no slot inside the bounded wait is a 429 with Retry-After"` proves the cap, Retry-After, and the give-back, for the case decision 6 describes: one probe attempt. But maxLinkWaitMs (`tools/downloader/api/src/jobs/links.ts:46 "function maxLinkWaitMs(probeTimeoutMs: number): number"`) computes TUNNEL_BUDGET_MS minus probeTimeoutMs (`tools/downloader/api/src/jobs/links.ts:32 "TUNNEL_BUDGET_MS = 100_000"`), and the wait-cap timer in the route becomes a no-op the moment the job starts running (`tools/downloader/api/src/routes/files.ts:204 "if (!queue.isWaiting(job.id)) return"`) -- nothing in the route re-arms a deadline for the running phase. The orchestrator retries once, with a fresh full-length probe, on a pre-first-byte VARIANT_GONE or DOWNLOAD_FAILED (`tools/downloader/api/src/jobs/orchestrator.ts:97 "MAX_REPROBE_RETRIES = 1"`, `tools/downloader/api/src/jobs/orchestrator.ts:127 "REPROBE_WORTHY: ReadonlySet<string>"`, gated on `tools/downloader/api/src/jobs/orchestrator.ts:297 "progress.started = true"` not yet having run). I reproduced the mechanism directly (own script, retry-mechanism.test.ts): a job whose engine call fails DOWNLOAD_FAILED on its first attempt makes two full resolver calls and two full engine calls, entirely inside the running phase, with the request still answering 200 -- nothing bounds that second attempts duration.

Combined with the constants: if a GET had already waited close to maxLinkWaitMs(45000) which is 55000 ms for a slot, and the fresh probe it finally gets is itself near-probeTimeoutMs-slow before failing retryably, the retry adds a second near-probeTimeoutMs-length attempt -- worst case 55000 + 45000 + 45000 = 145000 ms, past Cloudflares 125 s 524 cutoff that the whole budget exists to respect (00-ANALYSIS, cited in the tickets own Log). This is exactly the retry the ticket added the wait-plus-probe budget to protect against getting into in the first place, a busy server making a signed URL more likely to have died by the time a slot frees -- the two mechanisms were not reconciled with each other.

med severity -- it needs both a near-full wait and a retryable pre-first-byte failure to compound, and the decisions literal text, "the wait plus the probe timeout", singular, is satisfied for one attempt; this is a gap in what the decision considered, not a contradiction of its exact words, so I am not calling the acceptance line itself wrong. Two ways to close it, as an open decision: (a) size maxLinkWaitMs off probeTimeoutMs times (MAX_REPROBE_RETRIES + 1) instead of probeTimeoutMs alone; (b) give the running phase its own deadline in files.ts, independent of the wait-cap timer, covering retries. Recommend (a): it is a one-line change in links.ts, keeps the no-new-timer-during-running property the disconnect and cancel logic already relies on, and the resulting wait cap, 10 s with todays defaults, is still generous next to the numbers in the tickets own Log (browser-tier re-probe measured at 2.7-3.3 s).

4. Disconnect and process trees. Linux only, the container, as the tickets own test is (skipIf(process.platform !== "linux")). Mid-stream: `tools/downloader/api/test/stream-link.test.ts:538 "a client that disconnects mid-stream leaves no ffmpeg, and t"`, re-run green, scans /proc for any process whose own cmdline names the fixture origin and pipe:1 -- none survive; ffmpeg does not fork children for this pipeline so this is not a narrower check than "any descendant". During the slot wait: `tools/downloader/api/test/stream-link.test.ts:201 "a visitor who leaves while waiting for a slot cancels the waiting job"`, re-run green (no ffmpeg was ever started, so there is nothing to leak). I did not independently measure the egress proxys own open-connection count before and after a disconnect -- the proxy is long-lived, shared, in-process infrastructure, not per-job, and its per-job connection is opened and owned by ffmpeg, whose death already closes its sockets; I am treating this as implied by the process-tree result rather than separately measured, which should be read as unverified-directly.
5. Egress and SSRF at GET time. The re-probe calls guard.assertAllowed(sourceUrl) fresh on every attempt (`tools/downloader/api/src/jobs/orchestrator.ts:345 "const url = await guard.assertAllowed(sourceUrl)"`, inside #probe), and every URL the engine could touch is swept with guard.assertAllAllowed(urlsInProbeResult(probe).mustPass) before the engine is handed anything (`tools/downloader/api/src/jobs/orchestrator.ts:229 "await guard.assertAllAllowed(urlsInProbeResult(probe).mustPass)"`). The engines own construction is pinned to the SSRF-checked egress proxy at boot (`tools/downloader/api/src/server.ts:385 "createEngine({"`, the call that is given proxyUrl: ffmpegEgress.proxyUrl), unchanged by this diff (egress-proxy.ts only change in this branch is a comment, confirmed by git diff c87153d...HEAD for that file). The redirect-to-a-private-address-mid-stream reproduction the dispatch asks for is a property of stream.ts and the egress proxys own CONNECT handling, neither touched by this diff beyond that comment -- I am leaving that reproduction to the sibling engine gate rather than duplicating it, and naming the boundary explicitly rather than silently skipping it.
6. Logging and redaction. `tools/downloader/api/test/logging.test.ts` (47 of 47, re-run) covers exactly this routes two live risks: the token never reaching a log line, including on the expired-link 410 (`tools/downloader/api/test/logging.test.ts:621 "nor when the link has expired, which is the ordinary 410"`) and on a refused request (`tools/downloader/api/test/logging.test.ts:592 "not when the file is served, and not when the request is refused"`); and the Cookie in probe.requestContext never reaching the orchestrators "re-probe complete" debug line even though that line passes the whole context object (`tools/downloader/api/test/logging.test.ts:282 "nor the orchestrator's, whose re-probe fetches the preview with"`) -- caught by the loggers own structural pass (`tools/downloader/api/src/logger.ts:211 "isRequestContext(value)"`, which redacts any field literally named requestContext regardless of call site). I walked every logger. and log. call in files.ts, links.ts, jobs.ts and orchestrator.ts, 12 call sites, and none logs a URL or header bag outside that mechanism.
7. Errors. Every throw, .reject(, and catch in the four files this angle owns: 13 in files.ts, 0 in links.ts, 2 in jobs.ts, 5 throws plus 3 catches in orchestrator.ts -- 23 points checked, all typed AppError (via new AppError(...), the invalidLink()/rateLimited()/cancelError()/failureOf() helpers, or AppError.from(...)), none a bare Error. Before headers: every one of these becomes the usual JSON body through the shared error handler. After headers: the one catch in files.ts runs before queue.enqueue, meaning before any header could have gone; nothing in the post-header path calls reply.send again, only reply.raws own destroy or end, matching "the connection is aborted and the job keeps the code".

8. Negative half, run myself, each reverted (git diff clean and the full narrow-spec pair green again after every one):

- Removed reply.raw.once("close", onClose) (`tools/downloader/api/src/routes/files.ts:175 ", onClose);"`) -- turned both disconnect tests red (`stream-link.test.ts:174 "a visitor who disconnects mid-stream cancels the job"` and `stream-link.test.ts:538 "a client that disconnects mid-stream leaves no ffmpeg, and t"`), each hanging to its afterEach hook timeout rather than failing fast -- a defect a hasty read of the diff would miss, since it manifests as a timeout, not an assertion failure.
- Removed the used_at IS NULL guard from claimLinks SQL (`tools/downloader/api/src/db/job-store.ts:259 "UPDATE job_links SET used_at = @used_at WHERE token = @token AND used_at IS NULL"`) -- turned `tools/downloader/api/test/job-store.test.ts:353 "a link is claimed exactly once"` red, and left the HTTP-level `routes.test.ts:633 "a used link is 410 Gone"` green: that test is actually protected by the earlier link.usedAt !== null check in `tools/downloader/api/src/routes/files.ts:109 "usedAt !== null || job.status !== "`, not by the stores atomicity, in this single-process, no-await-in-between code path -- the SQL guard is the layer that matters for a persisted-store-level regression, and for any future deployment with more than one process sharing the database, not for this specific sequential HTTP test. Recorded as a clarification, not a defect.
- Disabled the link.usedAt !== null or job.status !== "queued" check entirely (`tools/downloader/api/src/routes/files.ts:109 "usedAt !== null || job.status !== "`, wrapped in an always-false condition) -- `routes.test.ts:633 "a used link is 410 Gone, not 404"` stayed green (the stores claimLink guard alone still answers 410 on the immediate re-GET), but `routes.test.ts:670 "an unopened link canceled from the card is withdrawn with its job"` turned red, 200 where 410 was expected -- this is the check that stops a canceled jobs still-unclaimed link from being reopened and run again; claimLinks own guard cannot see a jobs cancellation, only whether its link row was ever claimed.
- Removed the "if (media === null) started.reject(failureOf(context, job.id))" line (`tools/downloader/api/src/routes/files.ts:191 "if (media === null) started.reject(failureOf(context, job.id))"`) -- turned `stream-link.test.ts:133 "an error before the first byte answers JSON with its code"` red: the request hangs, times out at 60 s, instead of answering wrong -- the same "manifests as a hang" shape as the first mutation.
- Positive control: the full stream-link.test.ts plus routes.test.ts pair (58 tests) ran green before any mutation and again after every revert.

**NFR sweep, this angle only.**

- security: the one med finding above; token handling (32 CSPRNG bytes, never derived from the job id, a constant-time-comparison helper present though unused pre-existing dead code, `tools/downloader/api/src/jobs/tokens.ts`, untouched by this diff, out of scope here), rate-limit bucketing by a hashed token rather than address, redaction, and SSRF re-checking are all sound.
- performance: not this angle beyond the above.
- reliability: the med finding is also a reliability concern from the visitors side, a correctly-working origin can still hand the visitor a Cloudflare 524. Otherwise sound -- process-tree cleanup, queue release on every exit path, and the sweeps double-guard against racing an in-flight claim all held under my own reproduction.
- maintainability: no concern raised by this angle; the new files are heavily and specifically commented on exactly the properties I tried to break.

**findings** -- code-review at hard returned 2, 1 carried, 1 dropped: the wait-cap/retry-compounding finding above (carried, med); tools/downloader/api/src/jobs/tokens.ts unused tokensMatch helper (dropped -- pre-existing at the base commit, git diff c87153d...HEAD for that file is empty, so this diff neither introduced nor could have fixed it).

### Gate 2

_Re-resolved at `8ac378c` for round two, again at `f96ad15` for round three, and again at `c509fdf` for round four: citations re-pointed to their moved lines, two whose text the fixes deleted rewritten as prose naming `9794c04` (branch-only, never a pin); every verdict below is unchanged from what I originally wrote._

**Angle: engine, migration, stored-file removal, web card, citation pins.** No `## Review` line here — it lands under gate A's, which covers the link lifecycle, concurrency, egress/SSRF, and disconnects. `origin/main` at dispatch time was `c87153d`, and it had not moved by the time I fetched — base sha confirmed exact (`git merge-base --is-ancestor c87153d origin/main`, and `git log origin/main -1` still shows `c87153d`). Head: detached at `9794c04` (`git log --oneline -1`), `git diff --stat c87153d...HEAD`: 128 files, +4854/-6279.

**Before the diff**, ran `npx vitest run tools/downloader/engine/test/stream.test.ts` with real ffmpeg 6.1.1 (`/usr/bin/ffmpeg`), real fixtures (HLS 6s/11s, DASH 8s with a muxed and a separate-audio-rendition case, progressive MP4 both moov-at-end and fast-start, 4s/9s), real `ffprobe` verification of container/streams/duration, and a real directory snapshot of a private `TMPDIR`: **15 of 15 passed**.

#### Method

- `git checkout --detach 9794c04...`, farmed (`worktree-farm.sh`), `npm run build` (all workspaces green) — done in that order, after the checkout.
- Read the ticket at `c87153d:tools/downloader/docs/work/dl-53-finished-files-and-the-tunnel.md` (`## Log` not yet present there) and the branch's own `## Log` only after reading the diff.
- Code-review at **medium**, my own hunt, on `git diff c87153d...HEAD` restricted to `engine/*`, `api/src/db/*`, `api/src/jobs/orchestrator.ts`, `contract/*`, `web/src/components/JobCard.tsx` and siblings, and the 29 citation-only doc records plus `compose.downloader.yaml`, `scripts/test/citations.test.ts`, `docs/02-DEPLOYMENT.md`. I did not review `api/src/jobs/links.ts`, `api/src/routes/files.ts`'s wait-for-slot/claim logic, egress/SSRF, or the disconnect paths — that is gate A's angle, and I stopped at its edge deliberately.
- Ran, at head, with real ffmpeg and real HTTP fixtures, not mocks: `engine/test/stream.test.ts` (15/15), `npx vitest run --project downloader` (1507 passed, 2 skipped, of 1509 — matches the Log's own count), `npx vitest run packages/core/test/image-closure.test.ts` (7/7), `npx playwright test -c tools/downloader/playwright.config.ts` (9/9, `download.spec.ts` included — a real browser followed the link and downloaded a real file), `npx playwright test -c tools/downloader/playwright.sniffer.config.ts` (1/1). `node scripts/citations-gate.mjs --against origin/main` and `node scripts/preflight.mjs --base origin/main --title "feat(downloader): stream each file to its visitor and keep no copy (dl-53)"` both exit 0, checked by redirecting to a file and reading `$?` directly (never through a pipe).
- Four mutate/revert cycles, each with `git status --short` clean afterward: (1) swapped the fragmented `-movflags` for `+faststart` in `tools/downloader/engine/src/mux.ts:191 "frag_keyframe+empty_moov+default_base_moof"` — stream.test.ts went from 15/15 to 13 failed/2 passed, matching the Log's own recorded mutation exactly; (2) made schema.ts's migration-6 UPDATE target a status that never matches — schema.test.ts went from 4/4 to 1 failed (A stored job could not be read — the exact boot-blocking failure the migration exists to prevent); (3) inserted a real writeFileSync into openStream() at a hardcoded /tmp path (not through os.tmpdir()) — see finding 4, all 15 stream.test.ts cases still passed; (4) reverted all three, confirmed git status --short empty and each suite green again.

#### Proof table — Done-when lines in my angle

| Done when                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HLS/DASH/progressive stream to a real client, `ffprobe`-verified, duration within tolerance                                       | **proven** — `tools/downloader/engine/test/stream.test.ts:460 "fragmented MP4, read back at its length, nothing written"`, 6 fixture cases, real ffmpeg/ffprobe, 15/15 including this parametrised block                                                                                                                                                                                                                                                                                                                              |
| storage dir + OS temp dir unchanged before/after, subtitles too                                                                   | **proven, with a coverage gap** — same test above snapshots `os.tmpdir()`'s resolved directory, and `tools/downloader/engine/test/stream.test.ts:501 "with subtitles embedded, the track arrives and still nothing is written"` repeats it for subtitles. But see finding 4: the check is scoped to `os.tmpdir()`, not to the filesystem generally                                                                                                                                                                                    |
| response headers arrive before the stream completes; re-probe + first byte under 125 s                                            | **proven** (engine half) — `tools/downloader/engine/test/stream.test.ts:558 "response headers arrive while the origin is still being read"`; the 125 s/re-probe-under-load measurement is the Log's own and is gate A's to re-verify (probing/timing is its angle)                                                                                                                                                                                                                                                                    |
| disconnect leaves no ffmpeg process                                                                                               | **proven** (process-tree half) — `tools/downloader/engine/test/stream.test.ts:650 "a client that disconnects mid-stream leaves no ffmpeg behind"`; the job-row-outcome half (`disconnected` reason) is gate A's                                                                                                                                                                                                                                                                                                                       |
| error before first byte answers JSON with its code; error after aborts the connection, and the job row carries the code           | **wrong, not merely untested** — see **finding 1**. The "before" half is proven (`tools/downloader/engine/test/stream.test.ts:584 "an error before the first byte is thrown, with its code, and nothing is written"`) and the "after" half is proven for a **timeout**-shaped failure (`tools/downloader/engine/test/stream.test.ts:597 "an error after the first byte cuts the connection and rejects"`) but is **false** for a real, common failure shape: a mid-stream connection failure that ffmpeg's own HLS demuxer skips past |
| a second GET on a used link answers 410                                                                                           | **not in my angle** — link-lifecycle, gate A's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| a stream that passes `MAX_FILE_SIZE_MB` is cut and recorded `SIZE_LIMIT_EXCEEDED`; the engine's pre-flight estimate refuses first | **proven** — `tools/downloader/engine/test/stream.test.ts:620 "a stream that passes the size cap is cut and says SIZE_LIMIT_EXCEEDED"` and `tools/downloader/engine/test/estimate.test.ts:120 "raises SIZE_LIMIT_EXCEEDED with the evidence, before any download starts"`                                                                                                                                                                                                                                                             |
| no production code writes under the removed output directory; no setting named in step 5 is still read                            | **proven for what exists, with two gaps** — manual enumeration of every `fs` write/`mkdir`/`createWriteStream` across `tools/downloader/*/src` (below) found none under a removed directory and no removed setting read; but see **findings 2 and 4**                                                                                                                                                                                                                                                                                 |
| `npm run check`, `npm test`, the downloader e2e suite are green; container build `unproven (gate)`                                | **verified, e2e included** — `npm test -- --project downloader` 1507/1509 (2 skipped); `npx playwright test -c tools/downloader/playwright.config.ts` 9/9; `npx playwright test -c tools/downloader/playwright.sniffer.config.ts` 1/1 — I ran all three myself, not merely re-read the Log. Container build remains `unproven (gate)`: nothing here builds the image                                                                                                                                                                  |

#### Findings

- **high** · **A mid-stream source failure after the first byte can end as a clean, successful response with a silently truncated file — the acceptance line "an error after it aborts the connection, and the job row carries the code" is false for this shape, not merely untested.** Reproduced with real ffmpeg 6.1.1 and a real HTTP server: an HLS fixture (6 segments, 1 s each) served correctly for segments 0-1, then every later segment's connection is reset (`req.socket.destroy()`). `engine.stream()` resolves at the first byte as designed, but ffmpeg's own HLS demuxer retries each failed segment, logs "Segment N of playlist 0 failed too many times, skipping", and **exits 0** having written only the segments it got. `media.done` **resolves** (not rejects) with bytes 39519 and durationSec 2.02 against a 6 s source — no `AppError`, no `SIZE_LIMIT_EXCEEDED`, nothing. The engine's own `logger.debug` records the skip lines but nothing above it inspects them. Traced into the orchestrator: `tools/downloader/api/src/jobs/orchestrator.ts:306 "const outcome = await media.done;"` is awaited unconditionally, and the job is transitioned to `completed` at `tools/downloader/api/src/jobs/orchestrator.ts:316 "const done = store.transition("` with `result.durationSec = outcome.durationSec` — no comparison anywhere against the probed/expected duration. The visitor's browser receives a normal, complete-looking HTTP response; the job row says `completed`, `sizeBytes: 39519`, no error. This is not the disconnect/no-resume trade-off the Build section accepts ("a cut-off download still plays up to the cut") — that passage is about the _visitor's_ connection, not a _source_ failure the tool had the means to detect and chose to swallow. Confirmed the failure is real and not an artefact of my harness: with `-err_detect explode` added to the same ffmpeg invocation, the process **exits 255** on the identical fixture — and the engine's existing failure path (`runner.ts`) already turns a non-zero exit into `DOWNLOAD_FAILED` correctly, so the fix is narrow. Scripts and full output kept at `/tmp/gateb/` (this session's scratch; not committed).
  - **Open decision, options with a recommendation:**
    - **A (recommended)** — add a strictness flag (`-err_detect explode` or equivalent) to the stream's ffmpeg args so a partial/skipped-segment source failure exits non-zero, which the engine's existing `DOWNLOAD_FAILED` path already handles correctly. Cheapest fix, no contract change, but unverified against a _corpus_ of real sources for false positives (a source with genuinely tolerable minor stream errors might now fail where it used to finish) — I verified only the one reproduction, not a sweep.
    - **B** — add a post-`done` sanity check in the orchestrator comparing `outcome.durationSec` against the probed duration (a tolerance), failing the job if far short. Catches the same case without touching ffmpeg's own error tolerance, but is a new check with its own threshold to pick and is more invasive.
    - **C** — accept as a known limitation and document it. I do not recommend this: the Done-when line's own wording ("aborts the connection, and the job row carries the code") is a direct claim this reproduction falsifies, and a user-facing silent truncation with no error is exactly what "never fake progress" and honest job outcomes exist to prevent.

- **med** · **`runFfmpeg` had no production caller anywhere in the tree.** At the commit I gated (`9794c04`, branch-only): `tools/downloader/engine/src/ffmpeg/runner.ts` defined `export function runFfmpeg` at line 126, and both call sites that existed then — `tools/downloader/engine/src/stream.ts:534 "failureCode: "` and `tools/downloader/engine/src/ffmpeg/preview-frame.ts:198 "failureCode: "` — used `streamFfmpeg`, never `runFfmpeg`. It was re-exported from the engines public surface, `tools/downloader/engine/src/index.ts`, at line 114 (`runFfmpeg,`), and still had its own dedicated suite (`ffmpeg-runner.test.ts`) exercising it directly. This was the same shape the ticket explicitly removed elsewhere for the identical reason (the manual segment path with no caller) — this one sibling was missed. It also left `MUX_FAILED`s only live path as `runFfmpeg`s own default (`failureCode ?? MUX_FAILED`), so the Logs claim "MUX_FAILED is now raised by nothing" was true then only because nothing called the function that would raise it, not because the capability was removed.
- **med** · **A new contract field this ticket adds was written by the server and never read by the web card.** `error.details.reason` (`requested` | `disconnected` | `link-expired`, `tools/downloader/contract/src/job.ts:41 "says which. Not a failure of the tool"`) exists specifically to let a visitor tell "I canceled this" apart from "the link expired before anyone opened it." But at the commit I gated (`9794c04`, branch-only), `JobCard.tsx`s only render path for a canceled job read `{job.status === "canceled" && <ErrorPanel error={localErrorPayload("JOB_CANCELED")} />}` at line 163, using the fresh, generic `localErrorPayload("JOB_CANCELED")` rather than the real `job.error` — rendering all three reasons identically ("The download stopped before it finished. Nothing was kept on the server."). Confirmed end-to-end, not just by reading: the dev mock scenario built specifically to demonstrate the link-expired case populates the reason correctly (`tools/downloader/web/src/api/mock.ts:144 "details: { reason:"`) and it still rendered the generic copy. `job-card.test.tsx`s only canceled-state test (`tools/downloader/web/test/job-card.test.tsx:569 "a canceled job is presented as an answer, not an alarm"`) never varied the reason either. No Done-when line explicitly requires the UI to differentiate the three reasons, so I did not mark a proof-table row false for this — flagged as a design gap in my angles territory (the web card) that the tickets own contract change invites.
- **low, methodological** · **The "nothing written" test's guarantee is narrower than the acceptance line's wording.** `stream.test.ts`'s `beforeAll` redirects TMPDIR/TMP/TEMP to a private directory and snapshots only that directory (`os.tmpdir()`'s resolved value). A write to a hardcoded absolute path — not derived through `os.tmpdir()` — would not appear in the snapshot at all. Verified by mutation (see Method, cycle 3): a real `writeFileSync` to a hardcoded `/tmp` path inserted at the top of `openStream()` produced a real file on disk (confirmed by listing and reading it after the run) while all 15 tests stayed green. I found no such hardcoded-path write in production code today — the manual enumeration below is clean — so this is not a live defect, but the test's proof is "nothing is written under the OS temp directory," not "nothing is written anywhere," and the Done-when line's plain-English claim is the latter.
- **dropped** · considered flagging the API's TLS-interception root-CA write (`tools/downloader/api/src/tls-interception.ts:300 "fs.mkdtemp(path.join(os.tmpdir()"`) as a survivor worth scrutiny. Not carried: the file is untouched by this branch (`git diff c87153d...HEAD` for it is empty), it is a one-time, boot-time CA cert/key pair for the terminating TLS proxy, not per-job or video content, and it predates this ticket by two others (dl-27/dl-31). Allowed, out of scope.
- **findings** · code-review at medium returned 5; 4 carried (1 high, 2 med, 1 low), 1 dropped as a pre-existing, out-of-scope survivor.

#### Enumeration — every `fs` write, `mkdir`, `createWriteStream`, ffmpeg output path, and tmp use across `tools/downloader/*/src`

`grep -rn` over writeFile/createWriteStream/mkdir/mkdtemp/fs.write/appendFile/rename/unlink/node:fs across every package's `src/`, plus `pipe:1`/`pipe:3` for ffmpeg's own output routing:

- `tools/downloader/api/src/server.ts:429 "await mkdir(path.dirname(config.databasePath), { recursive: true });"` — creates the directory the **job database** lives in; "nothing else writes there since dl-53" per the comment immediately above it, confirmed by everything below. **Allowed** — this is not the removed output directory, it is the database's.
- one-time root CA cert+key into os.tmpdir() for the terminating egress proxy, at tools/downloader/api/src/tls-interception.ts (see the dropped finding below for the anchored line). **Allowed** — pre-existing (dl-27/dl-31), untouched by this branch, not video content.
- `tools/downloader/api/src/operator-ca.ts`, `tools/downloader/api/src/routes/web.ts`, `tools/downloader/api/src/routes/health.ts`, `tools/downloader/resolvers/src/resolvers/ytdlp.ts`, `tools/downloader/api/src/report.ts` — every other match is a **read**: readFileSync/access/statfs/existsSync/realpathSync, serving static assets, checking the ffmpeg binary, resolving a symlink for report validation, or (dl-53's own change) computing free disk space for the health route without the removed `@downloader/engine` freeDiskBytes (reimplemented locally with statfs, read-only).
- ffmpeg's own output routing: exactly two call sites append a final output argument anywhere in engine/src, and both are pipe:1 — `tools/downloader/engine/src/stream.ts:351 "args.push(...output.args,"` and `tools/downloader/engine/src/ffmpeg/preview-frame.ts:168 "the frame never touches a disk"` (the frame grab). No file path is ever the output target.
- `tools/downloader/api/src/thumbnails.ts` — zero fs imports of any kind. The in-memory ten-minute store dl-29 already had is what dl-44's frame grab now uses too (dl-44's Log confirms the reversal).

**Removed-setting grep**, across code, docs, .env*, compose files, the Dockerfile and the tool's CLAUDE.md: `MAX_TOTAL_STORAGE_GB` and `FILE_RETENTION_HOURS` appear only in historical ticket prose (dl-6, dl-23, dl-52 — describing what those tickets did at the time, never edited to claim the settings are still live) and in .env.example's/docs/02-DEPLOYMENT.md's own "no longer read" sentences; zero `.ts` source hits (`grep -rln` over every `*.ts` in the repo, zero results). `DISK_FULL` stays in `packages/core/src/errors.ts` exactly as decided; the only downloader-side survivors are the shared HTTP-status mapping table (`api/src/http-errors.ts`, inherited wholesale from core) and a deliberate stand-in throw in `api/test/per-client-caps.test.ts` simulating any store.create failure for dl-51's slot-release test — not a live raise. `muxing` as a bare string survives only in `contract/test/contract-schemas.test.ts`, `api/test/schema.test.ts`, and `api/src/db/schema.ts`'s migration itself — all three are about the removal, not a leftover use. `@downloader/*` imports: zero hits outside `tools/downloader` (`packages/`, `tools/planner/`). `packages/core/test/image-closure.test.ts`: 7/7 passed at head.

#### Migration 6

Built a database at the base schema (MIGRATIONS[0..4] from `c87153d`, user_version = 5) holding one row per every old status — queued, probing, downloading, muxing (with progress_json.stage: muxing too), completed, failed, canceled — plus a file_tokens row and a thumbnail_files row on the completed job, and a completed result carrying downloadUrl/expiresAt. Ran head's migrate():

- The muxing row's status became failed and its progress_json.stage became failed too (matching status, per the migration's second UPDATE), with error.code: INTERNAL.
- file_tokens and thumbnail_files were dropped as tables regardless of holding rows; job_links and jobs.link_json exist afterward, job_links empty (no link is manufactured for legacy rows — nothing to link to).
- Every one of the 7 rows read back through `JobStore.get()` and through a real `createApp()` booted against this file (`app.server.inject({ method: "GET", url: "/api/jobs/:id" })`) with status 200 for every id.
- Ran migrate() twice: second call is a no-op (user_version stays 6, no exception, the `for (version = current; version < MIGRATIONS.length; ...)` loop simply does not execute).
- One side observation, not a defect: at boot, 3 of the 7 rows (queued, probing, downloading) flip to failed via the pre-existing `reconcileInterruptedJobs`/`unfinished()` machinery, which already unconditionally failed every queued row at the base too (`WHERE status IN ('queued', 'probing', 'downloading', 'muxing')` at `c87153d`) — the head version is narrower, excluding a queued job with a live, unopened link, which is an improvement over the base's blanket rule, not a regression. Legacy queued rows with no job_links row still get swept, correctly, since there is no way for anyone to ever open a link for them.

#### Old records (contract backward-compatibility)

Via the built `contract` package's `jobSchema`, on a raw record shaped like a pre-dl-53 localStorage entry:

- A completed job whose result carries downloadUrl/expiresAt and no link key at all: parses, result is kept minus those two fields (`z.object` strips unknown keys), link reads back undefined. Proven generically at `tools/downloader/contract/test/contract-schemas.test.ts` (the dl-53 block) and reproduced directly by me against the built package.
- A job whose status is "muxing": rejected outright — the whole record fails `jobSchema.safeParse`, not just the field. Reproduced directly; matches `tools/downloader/contract/test/contract-schemas.test.ts:369 "is no longer a status, and nothing moves to or from it"` — muxing is no longer in jobStatusSchema's enum.
- Web survives it: `loadJobs` (`tools/downloader/web/src/lib/job-store.ts:51 "const parsedJob = jobSchema.safeParse(candidate);"`) parses per-record and keeps only what parses — proven generically (not muxing-specifically, but the same code path) at `tools/downloader/web/test/job-store.test.ts:74 "drops entries that do not match the Job contract but keeps the rest"`.

#### Web card

- Link offered only while usable: `tools/downloader/web/src/components/JobCard.tsx:83 "job.link && <LinkOffer"`. Proven both ways — offered (`tools/downloader/web/test/job-card.test.tsx:534 "a queued job offers its link, once, and says how long it has"`) and withdrawn on client-clock expiry (`tools/downloader/web/test/job-card.test.tsx:544 "a queued job whose link has expired offers the reason, not a dead link"`) — and the reducer clears job.link the moment status leaves queued for any reason (`tools/downloader/web/src/lib/job-reducer.ts:51 "the server has withdrawn it either way"`), so a spent/opened link stops being offered on the very next SSE frame, not only via the 15-minute timer.
- 410/429 from the actual HTTP route: the link is followed by a plain anchor with download, deliberately (so cookies/credentials ride a real navigation, per the Build section) — which means the web app cannot observe the response status of that click at all; a live 410 or 429 on an already-rendered link is a browser-native download failure, not something React renders. This is architecturally forced by the ticket's own choice, not a gap I'm flagging, but it means "the web card handles 410 and 429" is proven only for the predictive half (hiding the link once the client's clock or the status stream says it is spent) — the live-response half is not observable by the web card by design, and if there is a residual window (an already-rendered, not-yet-hidden link that the server has just spent from another tab) that is gate A's territory to characterise, since it depends on the link-claim mechanics I did not review.
- Never fakes progress: percent is computed only from media time (`tools/downloader/engine/src/ffmpeg/progress.ts:191 "percent = Math.min(100, Math.max(0, (processedSec / duration)"`), totalBytes stays null always (stream.ts's onProgress callback), and the bar renders indeterminate on null (`tools/downloader/web/src/components/ProgressBar.tsx:15 "const indeterminate = percent === null;"`).
- Completed state offers no second download and says so honestly: `tools/downloader/web/test/job-card.test.tsx:521 "a completed job says what arrived, and offers no second copy"`.

#### Citation pins

157 citations across 29 merged records pinned to @c87153d, per the Log. Confirmed the count of touched records independently: `git diff --stat c87153d...HEAD -- 'docs/work/*.md' 'tools/*/docs/work/*.md'` (excluding dl-53's own file) lists 29 files. `node scripts/citations-gate.mjs --against origin/main` — which resolves every @sha pin via `git show <sha>:<path>` (confirmed by reading `scripts/citations.mjs`'s pin-resolution code) and is therefore a real, exhaustive check of every pin's text against its historical blob, not a HEAD-relative one — reports 112 enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored; 7 entries compared against origin/main: 0 raised, exit 0. Of the 29 touched records, only one (dl-33-tls-fixture-certificates-fail-under-contention.md) is on the GRANDFATHERED list, so its lone changed pin is checked only by the ratchet, not the full-anchor pass — I hand-verified it directly instead: `git show c87153d:tools/downloader/api/test/two-origin-tls.test.ts | sed -n 123p` reads `afterAll(async () => {`, matching the record's new pin exactly. I additionally hand-verified 7 more pins across repo-13, repo-31, repo-34 (x4) and repo-39 — every one held its quoted text at the pinned sha. 112 non-grandfathered records were exhaustively re-checked by the tool itself (every pin, sha-relative or not); I sampled 8 of the specific new pins this branch introduced by hand across 6 different records and every one held. I did not open all 157 pins individually by hand — the corpus-wide tool pass is what makes that unnecessary, and I named exactly what it checks so that claim can be checked rather than trusted.

Every edit outside `tools/downloader/` is forced, not gratuitous:

- `compose.downloader.yaml` (repo root) — drops FILE_RETENTION_HOURS/MAX_TOTAL_STORAGE_GB env lines, keeps MAX_FILE_SIZE_MB. Forced by decision 3.
- `docs/02-DEPLOYMENT.md` — named explicitly by the ticket's own Build step 6.
- `docs/work/repo-13`, `repo-31`, `repo-34`, `repo-39` — each is a citation repointed onto a file this branch deleted or moved (files.ts, hls-e2e.test.ts (deleted entirely — its pin is now the only way to read it), storage.ts/storage.test.ts (both deleted), job-card.test.tsx). Forced; hand-verified above and against the earlier reproductions.
- `scripts/test/citations.test.ts` — its ambiguous-bare-basename fixture used hls.ts, which this branch's deletion of engine/src/download/hls.ts made unambiguous (1 tracked file, not 2); swapped for events.ts, verified independently: tracked events.ts basenames = 4, tracked hls.ts basenames = 1. Forced.

Release-please attribution: `release-please-config.json` defines exactly two packages, tools/downloader and tools/planner — there is no `repo` package at all. So none of the root-level or docs/work/repo-* edits above register with release-please as a separate component; they cannot produce a spurious changelog entry, because there is nothing configured to route them to. The commit's feat(downloader) type and its many genuine tools/downloader/** paths are what the downloader component's changelog will show; nothing here creates a second, misattributed entry.

#### NFRs

- **security** — no new SSRF/credential surface in my angle; the size-cap and TLS-verification paths are unchanged mechanically (buildNetworkInputArgs still carries tlsVerify/tlsCaFile through stream.ts). Not swept for egress/SSRF specifics — gate A's.
- **performance** — not applicable beyond what the Log already measured (backpressure, RSS) and I did not re-measure.
- **reliability** — the high finding above is exactly a reliability defect: a real, non-adversarial failure mode (a mid-stream network blip) degrades to silent data loss with no error surfaced anywhere.
- **maintainability** — the two med findings (dead runFfmpeg, unread error.details.reason) are both maintainability gaps: capability left in place with no caller, and contract surface added with no consumer.

#### Where I stopped

I did not review: `api/src/jobs/links.ts` (link creation/claim/release/expiry), the wait-for-a-slot logic and its 100s/PROBE_TIMEOUT_MS arithmetic in `routes/files.ts`, the SSRF guard, egress proxy, or the disconnect-cancellation wiring beyond the engine's own process-tree kill. Those are gate A's angle. I also did not run the container build (correctly unproven (gate)), and did not sweep the size-estimate/bitrate math beyond the one existing test I re-ran.

### Gate 3

Re-resolved at f96ad15 for round 3: two citations moved (both into `tools/downloader/engine/src/stream.ts`, at :496 and :499, now :524 and :527 -- round 3 inserted the FRAGMENT_LOST and DEMUX_READ_FAILED patterns above them); everything else in this section is unchanged. Words and verdicts are unchanged from the round-2 record.

**Gate: PASS on this angles round-2 scope** -- 2026-09-27 . `git diff 9794c04..8ac378c` excluding the two record commits (7cd02a1, 3106835) . head `8ac378c9ecd8c3def2ba1c886da7e24e43698e12` . code-review at hard, angle A only -- the link lifecycle and its security, plus the gap both round-1 gates left (the mid-stream SSRF/redirect reproduction). New findings only where this rounds diff touches this angle.

**1. The wait-cap med from gate 1 -- fixed, verified by measurement.**

The fix is `tools/downloader/api/src/jobs/links.ts:47 "return Math.max(0, TUNNEL_BUDGET_MS - probeTimeoutMs * (MAX_REPROBE_RETRIES + 1))"`, exactly option (a) as recommended and as the owner chose. Arithmetic at the default: probeTimeoutMs=45000, attempts=2, wait = 100000 - 2*45000 = 10000 ms, so worst case wait plus both probe attempts is 10000 + 2*45000 = 100000 ms exactly -- at the budget, not past it, with Cloudflares 125000 ms cutoff leaving 25000 ms of margin (the same margin the codes own comment on TUNNEL_BUDGET_MS names for ffmpegs first byte and slack). This closes the 145000 ms worst case gate 1 found.

The edge asked for: probeTimeoutMs at or above 50000 makes wait clamp to 0 (`maxLinkWaitMs(50_000)` and `maxLinkWaitMs(99_000)` both 0, per the new test below). Measured what the visitor gets at that edge with a real request, own script (zero-wait.test.ts in the scratch directory): with probeTimeoutMs=50000, one slot occupied and a second GET arriving behind it, the second answers 429 in 3 ms with Retry-After and RATE_LIMITED, and the job row afterward is still queued with link deep-equal to the one issued at POST -- a zero wait behaves exactly like a non-zero one: give the link back and answer fast, not a hang, not a crash, not a negative setTimeout delay (Math.max(0, ...) floors it). When a slot is free at the same instant, admission still succeeds normally, because queue.enqueue dequeues synchronously before the 0 ms timer callback can even run on the next tick -- the same reasoning gate 1 gave for why the timer is a no-op once running applies at delay 0 as well as at any other delay.

The new test, `tools/downloader/api/test/stream-link.test.ts:628 "the cap is the budget less a probe timeout per attempt, re-probe included"`, re-run: 17 of 17 in the file, green. Mutated (`tools/downloader/api/src/jobs/links.ts:47 "return Math.max(0, TUNNEL_BUDGET_MS - probeTimeoutMs * (MAX_"`, reverted to the pre-fix `TUNNEL_BUDGET_MS - probeTimeoutMs` with no factor) -- turned exactly that test red (`expected 55000 to be 10000`), reverted, `git status` clean, re-ran green again.

Residual, low: `PROBE_TIMEOUT_MS` carries no upper bound in `tools/downloader/api/src/config.ts` (its `int()` call passes no `max`, unlike `MAX_CONCURRENT_JOBS`), and `.env.example` only warns not to set it too low. Past 50000 ms the wait clamps to 0 but nothing bounds the running phase itself, so `attempts * probeTimeoutMs` (2x) grows past `TUNNEL_BUDGET_MS` on its own -- e.g. 198000 ms at probeTimeoutMs=99000, past Cloudflares cutoff with no wait involved at all. This needs an operator to set `PROBE_TIMEOUT_MS` well above its 45000 default, undocumented and unguarded rather than reachable by an ordinary visitor, which is why this is low rather than carried as a blocking finding: recommend a `max` on the `int()` call or a sentence in `.env.example`, owners call.

**2. The gap both gates left -- run now, no defect found.**

Own script (redirect-mid-stream.round2.test.ts in the scratch directory), real `createApp` with `ssrfAllowHosts: ["127.0.0.1"]` only (not `ssrfAllowPrivateAddresses`), real ffmpeg, real egress proxy, a fixture HLS origin (11 s, generateHls) and a fixture progressive MP4 (9 s, generateProgressive, moov at the end so a later Range fetch is required). The origin serves everything normally except one path, which answers a 302 to a target the test controls.

Positive control first: segment 2 redirected to another path on the SAME (allowed) origin. Followed -- `redirectHits` incremented, the client received 200 with the full 286292 bytes, and the job row reached completed. This is the harnesses own proof that a redirect it issues is actually followed when the target is allowed, before trusting a not-followed result in the blocked cases below.

HLS segment 2 redirected to `http://169.254.169.254/latest/meta-data/`: the egress proxy answered the redirected request with HTTP 403 (own log capture), ffmpegs HLS demuxer retried a few times then wrote `Segment 2 of playlist 0 failed too many times, skipping` on stderr -- exactly the `SEGMENT_SKIPPED` pattern this round added (`tools/downloader/engine/src/stream.ts:133 "export const SEGMENT_SKIPPED = /failed too many times, skipping/iu"`). No certificate rejection appeared first (plain HTTP, so `isTlsVerificationFailure` never matched, `tools/downloader/engine/src/ffmpeg/runner.ts:117 "export function isTlsVerificationFailure(stderr: string): boolean"`), so the code took the `DOWNLOAD_FAILED` branch (`tools/downloader/engine/src/stream.ts:567 ": new AppError("`) rather than `TLS_VERIFICATION_FAILED` (`tools/downloader/engine/src/stream.ts:564 "? new AppError("`) -- the precedence held correctly for a plain SSRF refusal. The client got 200 (headers had already gone for segments 0 and 1) then the connection was cut with 104466 bytes delivered, `aborted: true`. The job row: `status: "failed"`, `error.code: "DOWNLOAD_FAILED"`, `error.message: "The source stopped serving part of the video."`, with the stderr tail as `error.details.stderr` -- never `completed`, which is the silent-truncation outcome this rounds fix exists to prevent, and which my reproduction confirms it prevents specifically for an SSRF refusal, not only for the connection-reset fixture the fix itself was tested against.

HLS segment 2 redirected to `http://10.0.0.1/secret-segment.ts` (RFC1918, distinct from the link-local case above): identical shape -- proxy 403, `SEGMENT_SKIPPED` triggered, `DOWNLOAD_FAILED`, client cut mid-stream at 104466 bytes, job row failed with the same code.

Progressive `Range` request redirected to `http://169.254.169.254/latest/meta-data/` once the offset passed halfway through the file (the moov atom for this fixture sits at the end, so opening the input needs that later range): here the block landed before any output byte, since ffmpeg could not even parse the container -- stderr showed `moov atom not found` and `Invalid data found when processing input`, exit code 183. The client got a clean JSON 502 (102 bytes, a normal error body, not a stream cut) and the job row again reached `failed` with `DOWNLOAD_FAILED`, never `completed`. This is the pre-headers half of the same guarantee: an SSRF refusal that happens before the first byte answers like any other AppError, and one that happens after it cuts the connection with the code on the job -- both halves held for a redirect, not only for the failures the two gates each measured separately.

Unmeasured, named as such: all four redirects above are plain HTTP, matching the fixture origins own scheme, so the proxy refused them at the absolute-form-request layer with a 403 body. An HTTPS redirect target refused at the CONNECT layer (before any TLS handshake) would manifest to ffmpeg differently, and I did not reproduce that variant -- the TLS_VERIFICATION_FAILED-versus-DOWNLOAD_FAILED precedence in stream.ts is a stderr-text match, and whatever text a refused CONNECT actually produces on this ffmpeg build was not checked. Given the precedence held correctly for the plain-HTTP case and the mechanism (a stderr regex, unconditional on scheme) is scheme-agnostic in its own logic, I read this as a coverage gap in my reproduction rather than a live suspicion, but it is not measured.

**findings** -- code-review at hard, this round, returned 1, 1 carried, 0 dropped: the PROBE_TIMEOUT_MS upper-bound gap above (low). The redirect reproduction found no defect: 4 of 4 own tests green (positive control plus three blocked-redirect cases), no SSRF bypass, no silent completion.

NFR, this round only: security -- the redirect reproduction is a genuine strengthening of the round-1 sweep, and it held; reliability -- the wait-cap fix is verified at the default and at its edges; nothing else in this angle changed.

### Gate 4

_Re-resolved at `f96ad15` for round three, two citations re-pointed and one rewritten as prose naming `8ac378c` (branch-only, never a pin); and again at `c509fdf` for round four, one further citation re-pointed to its moved line; every verdict below is unchanged from what I originally wrote._

**Round 2, angle B.** Head `8ac378c9ecd8c3def2ba1c886da7e24e43698e12`, checked out detached; farmed and built after the checkout. Reviewed `git diff 9794c04..8ac378c` on my angle (`docs/02-DEPLOYMENT.md`, `docs/work/repo-13...`, `tools/downloader/api/src/egress-proxy.ts`, `tools/downloader/api/src/jobs/orchestrator.ts` (comment/export-only), `tools/downloader/docs/01-ARCHITECTURE.md` (one word, gate A's), `tools/downloader/docs/work/dl-74-retire-mux-failed.md` (new), `tools/downloader/engine/src/ffmpeg/args.ts`, `.../ffmpeg/preview-frame.ts`, `.../ffmpeg/runner.ts`, `tools/downloader/engine/src/index.ts`, `tools/downloader/engine/src/stream.ts`, `tools/downloader/engine/test/ffmpeg-runner.test.ts`, `.../test/helpers/media.ts`, `.../test/preview-frame.test.ts`, `.../test/stream.test.ts`, `tools/downloader/web/src/components/JobCard.tsx`, `.../web/src/lib/error-presentation.ts`, `.../web/test/job-card.test.tsx`); left `tools/downloader/api/src/jobs/links.ts`, `tools/downloader/api/test/proxied-https.test.ts`, `tools/downloader/api/test/stream-link.test.ts` to gate A (the wait-cap fix, and a local `runFfmpeg`-removal follow-on in a file that is otherwise its territory).

Positive control before anything: `npx vitest run --project downloader` at head, before any mutation — **1512 passed, 2 skipped, of 1514** (up from 1507/1509 in round one by exactly 5: the new engine `midfail` case, the three `canceledFor` cases, and gate A's wait-cap case).

#### 1–5. The disputed high finding, settled by measurement

All four commands below were run against my own preserved `gate-b/midfail-fixture` (round one's), with ffmpeg 6.1.1 and the real `-c copy`/`-bsf:a aac_adtstoasc`/fragmented-`-movflags` argument shape `buildStreamArgs` actually produces for an HLS source — not the simplified argv I used in round one, which is exactly where round one's evidence went wrong.

**1. The exit-255 command, with and without the flag, and with and without the bitstream filter.**

| `-err_detect explode` | `-bsf:a aac_adtstoasc` | exit | bytes  |
| --------------------- | ---------------------- | ---- | ------ |
| no                    | no                     | 255  | 6,346  |
| yes (input option)    | no                     | 255  | 6,346  |
| no                    | yes                    | 0    | 39,487 |
| yes (input option)    | yes                    | 0    | 39,487 |

Also run, all with the bitstream filter present: `-err_detect explode` as an output option, on both sides, `-f_err_detect explode`, and `-xerror` — every one exits 0 at 39,487 bytes. **Round one's exit 255 was the missing bitstream filter, not the flag catching the skipped segment.** The engine's real args always carry `-bsf:a aac_adtstoasc` for an HLS/MPEG-TS source (`tools/downloader/engine/src/mux.ts:161 "The source is (or may be) MPEG-TS. Controls"`), so round one's simplified repro was testing a shape the engine never sends. The refutation holds completely; my original Option A recommendation was wrong.

**2. The built mechanism against its mutation.** Positive control: `engine/test/stream.test.ts` — 16/16 (the new case at `tools/downloader/engine/test/stream.test.ts:694 "a source that fails after the first byte fails the stream, not a truncated success"` included). Mutated the `if (SEGMENT_SKIPPED.test(line))` line inside `attempt()` in `tools/downloader/engine/src/stream.ts`, at the commit I gated that round (`8ac378c`, branch-only, line 490 there) — this round's own fix replaced that exact line with `if (losesSourceData(line))`, so the citation cannot point at head. Mutated to `if (false && SEGMENT_SKIPPED.test(line))` — the named test went red exactly as it should: `expected false to be true` on `received.aborted`, the response completed as a clean 200 instead of aborting. Reverted; 16/16 again, `git status --short` clean.

**3. False failures — probed, not exhaustive.**

- A segment that fails once or twice and then loads on the next attempt: **no false trigger**, twice measured. One failure then a success on attempt 2: zero stderr, exit 0, 115,869 bytes (the full six-segment file). Two failures then a success on attempt 3: one "Failed to open segment 2 of playlist 0" line (no "repeated"), still zero match against `SEGMENT_SKIPPED`, exit 0, 115,869 bytes again.
- A single segment permanently lost while every other segment succeeds (a real transient-CDN shape, not a dead source): **does trigger**, correctly, per the code's own disclosed trade-off. Only `seg002.ts` made unreachable, the rest fine: "Segment 2 of playlist 0 failed too many times, skipping", exit 0, 96,449 bytes (most of the file — a control run with nothing failing gives 115,869). This is not a new false positive: it is precisely the cost `stream.ts`'s own comment names as accepted ("a source whose segments ffmpeg used to skip over quietly now fails where it used to finish short") — I am confirming the comment's claim by measurement, not contradicting it.
- A discontinuity marker (`#EXT-X-DISCONTINUITY`) with no network failure at all: zero stderr, exit 0, the full byte count. Rules out a structural false positive from a playlist discontinuity.
- A live/event playlist edge: **not measured** — synthesising a sliding-window or `EXT-X-PLAYLIST-TYPE:EVENT` source that changes between fetches was more fixture work than this round's budget covered. Said as unmeasured rather than assumed safe.

**4. False passes — measured, and this is the significant result.** Neither DASH nor progressive is covered by the fix that shipped, for exactly the shape this ticket is about: a failure after the first byte, not at open.

- **DASH, a later segment.** An 8 s DASH fixture (4x2 s fragments), `chunk-stream0-00003.m4s` (the third of four) made permanently unreachable, everything else served normally. First byte at 47 ms (so this is unambiguously "after the first byte", not an open failure). Result: **exit 0, 171,334 bytes** against a 206,414-byte control with nothing failing — stderr says only "Failed to open fragment of playlist", which does not match `SEGMENT_SKIPPED` (`/failed too many times, skipping/iu`) at all. The output is not merely short: ffprobe's packet timestamps jump from 3.956576 straight to 6.023242 — a real 2 s gap in the middle — while `format=duration` still reports 8.023242, matching the undamaged length, because the last fragment (4) is still present and still carries the timeline out to the end. A visitor gets a file that looks complete by every metric except playback.
- **Progressive, a mid-body Range reset.** A 9 s progressive MP4 (moov-at-end), served over Range; the third request (the main sequential body read, after the moov negotiation already succeeded) sends 40% of what was asked and then resets the connection. First byte at 49 ms. Result: **exit 0, 96,079 bytes**, stderr full of "Stream ends prematurely at 92990, should be 232403", "Packet corrupt", "Invalid NAL unit size", "corrupt input packet in stream 0", "partial file", "Error retrieving a packet from demuxer: Input/output error" — none of which match `SEGMENT_SKIPPED` either. ffprobe on the result: duration=3.623242 against a 9 s source, a trailing cut with nothing after it (unlike DASH's gap, this one really did just stop).

The Log's claim that "DASH was not reproduced the same way: its demuxer fails at open on the equivalent fixture (exit 183)" is accurate for a failure at open — I did not need to re-check that, it is a different and unrelated fixture shape from the one this ticket's own high finding was about. But the sentence reads as covering the whole protocol, and it does not: a DASH failure after the first byte behaves nothing like an open failure, and is not caught. Progressive was not mentioned in the fix's own account at all, and is equally uncaught.

**5. Does Option B (compare streamed duration to the probed one) cover what the stderr match misses? Measured, and only partly.**

- It would catch the **progressive** case cleanly: 3.6 s against a 9 s probe is not a plausible tolerance match by any reasonable margin.
- It would **not** catch the **DASH** case: the container's own declared duration (8.023242) matches the undamaged source almost exactly, because the timeline still reaches the end even though ~2 s are missing from the middle. A duration-only check sees a normal-length file and passes it. This is a real, measured limit on Option B, not a hypothetical one — a whole-file duration comparison cannot distinguish "shorter" from "the same length with a hole in it."

**Restating the owner's decision as options, given what I measured:**

- **A (recommended)** — extend the existing stderr-watching mechanism with a DASH-specific pattern ("Failed to open fragment of playlist", or the class of "fragment/segment could not be opened" lines the DASH demuxer writes) and a progressive-specific one ("Stream ends prematurely", or "Error retrieving a packet from demuxer: Input/output error"), each verified the same way the HLS one was — red first against a real reproduction, a positive control against a recovering source, reverted mutation. This keeps the mechanism and its proven characteristics (no protocol-agnostic flag exists; the shipped approach is otherwise sound) and simply completes it for the two protocols it does not yet cover. Cost: two more patterns to maintain and re-verify if ffmpeg's wording changes across versions — the same fragility the HLS pattern already accepted.
- **B** — a duration-vs-probed sanity check in the orchestrator, as I originally proposed as Option B. Measured this round to reliably catch a trailing truncation (progressive) but to **miss** a mid-stream gap that still reaches the expected end (DASH's exact failure shape) — so on its own this option does not close the gap the ticket is about, only a subset of it.
- **C** — both A and B together: the stderr patterns for what they catch precisely, a duration check as a second, coarser net for whatever wording a future ffmpeg version changes out from under the patterns. More machinery, but the two failure modes I measured (a same-length gap, and a trailing cut) are different enough in kind that neither check alone is complete.
- I would not recommend leaving DASH and progressive uncovered: the ticket's Done-when line ("an error after it aborts the connection, and the job row carries the code") is now true for HLS and demonstrably false for the other two protocols this same ticket added, which is exactly the shape of the original high finding, just narrower.

#### Verdicts on my other findings, at head

- **`runFfmpeg` removed (med, fixed).** A repo-wide grep confirms no re-export and no definition anywhere under `tools/downloader/*/src`; `tools/downloader/engine/src/index.ts` no longer names it, `tools/downloader/engine/src/ffmpeg/runner.ts` no longer defines it, and `PROGRESS_ARGS` (the stdout-progress constant only the removed file-writing path used) went with it — `tools/downloader/engine/src/ffmpeg/args.ts` no longer exports it, zero hits repo-wide. `FfmpegFailureCode` is narrowed to `"DOWNLOAD_FAILED"` alone, so `MUX_FAILED` cannot be raised by construction; that removal is filed as `tools/downloader/docs/work/dl-74-retire-mux-failed.md`, a well-scoped follow-up that names the one real hazard (an old persisted record carrying `error.code: "MUX_FAILED"`) rather than skipping it. The two test files that called the removed function (`engine/test/ffmpeg-runner.test.ts`, `api/test/proxied-https.test.ts`) now define their own three-line local `runFfmpeg` wrapper over `streamFfmpeg`, preserving every original assertion; both re-run green (`ffmpeg-runner.test.ts` 5/5, `two-origin-tls.test.ts` 9/9).
- **`error.details.reason` rendered (med, fixed).** `JobCard.tsx` now passes the real `job.error` (falling back to a generic payload only when there truly is none), and `error-presentation.ts`'s `presentError` reads the reason through a closed lookup table, never verbatim, matching the "details is not rendered verbatim" contract rule. Positive control: `web/test/job-card.test.tsx` 37/37. Mutated `tools/downloader/web/src/lib/error-presentation.ts:296 "function readCancelReason("` to return `null` unconditionally — all three new cases (`tools/downloader/web/test/job-card.test.tsx:874 "a job the visitor canceled says they stopped it"`, `tools/downloader/web/test/job-card.test.tsx:881 "a job whose connection closed mid-download says it was interrupted"`, `tools/downloader/web/test/job-card.test.tsx:888 "a job whose link nobody opened says the link expired"`) went red, collapsing back to the generic "Canceled"/"The download stopped before it finished" copy; the other 34 stayed green. Reverted; 37/37 again.
- **My low finding (methodological) — handled correctly.** The fix does not widen the directory snapshot (which cannot close the gap: a hardcoded-path write lands wherever it lands, and my own round-one mutation proved that). Instead the Log narrows the reading of Done-when line 2 to what the test actually proves ("the storage directory and the process's temp directory are unchanged") and rests the broader "nothing written anywhere" claim on Done-when line 8's source search instead. I checked this is a Log entry, not an edit to the brief: `git diff 9794c04..8ac378c` for the ticket file has exactly two hunks, the frontmatter status line and a pure append after the existing `## Done when` section — the original bullet's text is byte-for-byte unchanged (the ## Done when section's second bullet, still reading in full: "A test lists the storage directory and the OS temp directory before and after each of those streams, and they are unchanged"). Editing the brief itself would have been the wrong move (a gate or a builder does not get to narrow an acceptance line unilaterally); recording the narrower reading in the Log, while leaving the broader search (my own round-one enumeration, unchanged and still valid — no new hardcoded-path write exists) as the actual proof of the wider claim, is the right shape.
- **`status: in-flight` — right.** Reproduced: with the `## Review` section present, setting `status` back to `ready` and running `node scripts/status.mjs --json` gives exit 1 with a `reviewed-but-ready` problem naming this exact ticket ("status is "ready" but the ticket carries a `## Review` gate record, which nothing unstarted has"); restoring `in-flight` gives exit 0 with no such problem. `in-flight` rather than `done` is also right on the merits: this very round exists because a finding was disputed, so the ticket is plainly not settled yet.

#### New findings, in lines this round touched

- **high (carried forward, narrowed)** — see §4 above: the stderr-watching fix this round shipped is complete for HLS and absent for DASH and progressive, both reproduced with a real failure after the first byte. This is the same acceptance line as round one's high finding, now proven false specifically for two of the three protocols the ticket's own Done-when line 1 names.
- **low** — the interaction the fix's own account flags (`sawCertificateRejection` making a skipped, certificate-rejected segment `TLS_VERIFICATION_FAILED` rather than `DOWNLOAD_FAILED`, `tools/downloader/engine/src/stream.ts:555 "sawCertificateRejection = isTlsVerificationFailure(line);"`) has no dedicated case in `engine/test/stream.test.ts`; it is protected only by the pre-existing `api/test/two-origin-tls.test.ts` suite at a different layer (confirmed green, 9/9), which the Log says caught this as a regression during the fix rather than by design. Not a live defect — re-run and green — but a gap in the engine-level suite that owns this file, for the one branch inside the mechanism this round added.

**findings** — 2 new/carried this round; both carried (1 high, 1 low). Nothing dropped.

#### Method note

Fixtures for §4 (DASH, progressive) were generated fresh this round with the same ffmpeg the repo's own `test/helpers/media.ts` uses (`testsrc`/`sine` lavfi sources, `libx264`/`aac`, `-f dash -seg_duration 2 -use_template 1 -use_timeline 1` for DASH; a plain muxed MP4 for progressive) and kept in scratch, not committed. Every mutation this round (Q2, and the two positive-control mutations under "Verdicts") was reverted before this section was written; `git status --short` is empty in the reviewed worktree.

### Gate 5

**Gate: PASS on this angles round-3 scope** -- 2026-09-27 . `git diff 8ac378c..f96ad15` excluding the five record commits (9da92b7, 7240ebd, c9bf005, d4d5953, 536e1d6) . head `f96ad15c78217c0cee9f26684b0f9dcbc657b2b4` . code-review at hard, angle A only. New findings only where this rounds diff touches this angle: `api/src/config.ts`, `.env.example`, `api/test/config.test.ts`, and the re-run redirect reproduction against `engine/src/stream.ts`.

**1. The PROBE_TIMEOUT_MS low from gate 3 -- fixed in the reachable path, verified by measurement.**

The fix is `tools/downloader/api/src/config.ts:361 "export const PROBE_TIMEOUT_CEILING_MS = 50_000;"`, applied as `{ max: PROBE_TIMEOUT_CEILING_MS }` on the `int()` call that reads `PROBE_TIMEOUT_MS` from the environment (`tools/downloader/api/src/config.ts:530 ", API_DEFAULTS.probeTimeoutMs, { max: PROBE_TIMEOUT_CEILING_MS })"` -- capping in config, as recommended and as the owner chose.

What an operator setting 120000 actually gets, measured directly (own script, probe-ceiling.test.ts in the scratch directory, calling loadApiConfig with a real env map): `probeTimeoutMs` comes back 50000, silently -- no warning, no refusal, no error thrown. Checked the boundary too: 50000 stays 50000, 50001 also clamps to 50000. This is not a gap specific to this setting: `int()` (`tools/downloader/api/src/config.ts`) clamps every capped numeric setting the same silent way (MAX_CONCURRENT_JOBS, MAX_CONCURRENT_BROWSERS, MAX_QUEUED_JOBS and the rest all go through the same helper with no logging), so PROBE_TIMEOUT_MS now matches its siblings rather than being an exception either way. `.env.example` documents the ceiling in the same breath as the setting (`tools/downloader/.env.example`): "At most 50000... A larger value is read as 50000."

The uncapped path: `overrides.probeTimeoutMs ??` (`tools/downloader/api/src/config.ts:529 "overrides.probeTimeoutMs ??"`) runs before the capped `int()` call, so a value handed in as a `CreateAppOptions.config.probeTimeoutMs` code override never reaches the ceiling -- confirmed directly (own script): `loadApiConfig({ probeTimeoutMs: 120_000 }, {})` returns 120000, not 50000. Traced who can reach that path: `tools/downloader/api/src/server.ts:90 "const config = loadApiConfig(options.config ?? {});"` is the only caller with an overrides parameter, and the sole production entry point, `tools/downloader/api/src/main.ts:22 "const app = await createApp();"`, calls it with zero arguments -- `options.config` is undefined there, so `overrides.probeTimeoutMs` is undefined and the capped branch always runs in production. The only place in the tree that passes a `probeTimeoutMs` code override is one test, `tools/downloader/api/test/stream-link.test.ts:251 "config: { maxConcurrentJobs: 1, maxJobsPerClient: 0, probeTimeoutMs: 99_950 },"`, exactly as the builder said. This is a test-only escape hatch, unreachable from any production caller.

The test under mutation: `tools/downloader/api/test/config.test.ts:56 "a value past what two probes can spend in 100 s is capped, not taken"`. Re-run alone: 6 of 6 in the file, green. Mutated (`tools/downloader/api/src/config.ts:530 ", API_DEFAULTS.probeTimeoutMs, { max: PROBE_TIMEOUT_CEILING_MS })"`, dropped the `{ max: PROBE_TIMEOUT_CEILING_MS }` option) -- turned exactly that test red (`expected 120000 to be 50000`). Reverted, `git status` clean, re-ran green again -- 6 of 6.

Worst-case wall time at the ceiling, recomputed from the constants as they now stand: `maxLinkWaitMs(50_000) = max(0, 100000 - 2*50000) = 0`, so total = 0 + 2*50000 = 100000 ms, the same as at the 45000 default and at every value in between -- because `PROBE_TIMEOUT_CEILING_MS` is defined as `TUNNEL_BUDGET_MS / (MAX_REPROBE_RETRIES + 1)` exactly, `(TUNNEL_BUDGET_MS - 2p) + 2p = TUNNEL_BUDGET_MS` for every p from 0 up to the ceiling, so the worst case is now a constant 100000 ms for every value the environment can reach, not a curve that gets worse as the operator raises the setting. This closes gate 3s residual for every production-reachable configuration; only the code-only override (confirmed test-only, above) can still reach 198000 ms as gate 3 measured, and it cannot be reached in production.

**2. Round-2 redirect-to-private-address reproduction, re-run at f96ad15.**

Same own script (redirect-mid-stream.round3.test.ts in the scratch directory, byte-identical to round 2s), unchanged fixtures, re-run against the new head: 4 of 4 green, and every observable outcome identical to round 2s numbers. HLS segment 2 redirected to `169.254.169.254`: proxy 403, ffmpeg writes `Segment 2 of playlist 0 failed too many times, skipping`, still matched by the unmoved `SEGMENT_SKIPPED` pattern (`tools/downloader/engine/src/stream.ts:133 "export const SEGMENT_SKIPPED = /failed too many times, skipping/iu"`), client cut at 104466 bytes, job row `failed`/`DOWNLOAD_FAILED`. Redirected to `10.0.0.1`: identical shape and numbers. Progressive `Range` redirected to `169.254.169.254`: client 502 (102 bytes), job row `failed`/`DOWNLOAD_FAILED`, exit code 183, the same "moov atom not found" stderr as round 2. Never `completed`, and never a different code, in any of the four.

Why this rounds new patterns did not fire, and what that means: `FRAGMENT_LOST` is DASH-only and neither of my fixtures is DASH, so it was never in play. `DEMUX_READ_FAILED` (`tools/downloader/engine/src/stream.ts:165 "export const DEMUX_READ_FAILED = /Error during demuxing|Error retrieving a packet from demuxer/iu;"`) covers a progressive input that opened successfully and then lost the source mid-read; my progressive repro instead blocks the very request that fetches the moov atom (this fixtures moov sits at the end), so ffmpeg never opens the input at all and fails through the older, generic non-zero-exit path (`exitCode: 183`) rather than through the stderr-pattern path this round added. Both paths land on the same `DOWNLOAD_FAILED`, so the outcome the coordinator asked me to confirm holds either way, but I did not separately construct a redirect that lands after the first byte specifically to exercise `DEMUX_READ_FAILED` for progressive -- named as not attempted, since it was not what was asked and building a fixture-specific trigger for the exact post-open byte range was not cheap to do reliably.

Dropped, out of this rounds diff: while measuring the ceiling I found that `tools/downloader/api/test/stream-link.test.ts:241 "A probe timeout of 99.95 s leaves a 50 ms wait, so the refusal is quick."` is now stale -- gate 3s fix changed the formula so this same 99_950 value now yields a 0 ms wait, not 50 ms (measured directly: 4 ms elapsed to the 429, own script). The test itself still passes, because it asserts the outcome, not the duration. This is a leftover from gate 3s fix to a file gate 3 did not touch, not from anything in this rounds diff, so it is dropped rather than carried here; worth a one-line comment fix whenever that file is next touched.

**findings** -- code-review at hard, this round, returned 1, 0 carried, 1 dropped: the stale 50 ms comment above (out of round). The ceiling fix and the redirect re-run both found no defect.

NFR, this round only: security -- the redirect reproduction still holds, unchanged in outcome; reliability -- the wait-cap fix now bounds worst-case wall time to a constant 100000 ms for every environment-reachable value, closing gate 3s residual; the remaining uncapped path is confirmed test-only and does not reach production.

### Gate 6

_Re-resolved at `c509fdf` for round four: two citations re-pointed to their moved lines; every verdict below is unchanged from what I originally wrote._

**Round 3, angle B.** Head `f96ad15c78217c0cee9f26684b0f9dcbc657b2b4`, checked out detached; farmed and built after the checkout. Reviewed `git diff 8ac378c..f96ad15` excluding the five record commits (`9da92b7`, `7240ebd`, `c9bf005`, `d4d5953`, `536e1d6`). On my angle: `tools/downloader/engine/src/stream.ts` (+30) and `tools/downloader/engine/test/stream.test.ts` (+192, six new cases). Out of my angle, reviewed but not re-verified in detail: `tools/downloader/api/src/config.ts`, `tools/downloader/api/test/config.test.ts`, `docs/02-DEPLOYMENT.md`, `tools/downloader/docs/01-ARCHITECTURE.md` — all one mechanism, a `PROBE_TIMEOUT_MS` ceiling tied to `TUNNEL_BUDGET_MS`/`MAX_REPROBE_RETRIES`, which is gate A's wait-cap machinery, not mine.

Positive control before anything: `npx vitest run tools/downloader/engine/test/stream.test.ts` at head — **21/21** (up from 16 by the five new cases: DASH-gap, prog-cut, two healing controls, and the certificate-precedence case). `npx vitest run --project downloader` — **1518 passed, 2 skipped, of 1520** (up from 1512/1514 by exactly 6: the five above plus gate A's new config-ceiling case).

I did not have the builder's own scripts (`scratchpad/dl-53/explore*.mts`, `mutate.cjs`) — those live in the builder's own session scratchpad, not mine — so every measurement below is my own independent reproduction, built fresh against fixtures preserved from earlier rounds (`gate-b/midfail-fixture`, `gate-b/round2-fixtures/{dash8,prog9}`).

#### The carried high, checked item by item

**1 and 2. Each new case is red without its pattern; each control completes.** Positive control: 21/21 (above). Mutated `losesSourceData` at `tools/downloader/engine/src/stream.ts:198 "return SEGMENT_SKIPPED.test(line) || FRAGMENT_LOST.test(line)"` to drop `FRAGMENT_LOST.test(line)` — `tools/downloader/engine/test/stream.test.ts:762 "a DASH fragment that cannot be fetched after the first byte fails the stream"` went red exactly as it should: `expected false to be true` on `received.aborted`. Reverted, dropped `DEMUX_READ_FAILED.test(line)` instead — `tools/downloader/engine/test/stream.test.ts:776 "a progressive body cut after the first byte and never served again fails the stream"` went red the same way. Reverted; `git status --short` clean, 21/21 again. The two controls (`tools/downloader/engine/test/stream.test.ts:793 "control: a progressive body cut once and resumed on reconnect completes whole"`, `tools/downloader/engine/test/stream.test.ts:808 "control: an HLS segment refused once and served on the retry completes whole"`) both completed in the unmutated run above and were not separately mutated — they are controls, not cases the mechanism is supposed to catch.

**3. "The DASH demuxer never retries" — confirmed.** Reset `chunk-stream0-00003.m4s` on its first request only, serving it correctly on a second — the origin was ready to answer. Result: **only one request was ever made for that fragment** (`requests: 1`), exit 0, 171,334 bytes, `Failed to open fragment of playlist` on stderr. The demuxer never asked again even though the fragment was there for the asking. This is different from HLS, where I measured in an earlier round that one or two failures followed by a success on the next attempt heals with zero stderr and the full byte count — DASH's fragment fetch has no such retry loop, so `FRAGMENT_LOST` firing does always mean the bytes are gone for good, confirmed by measurement rather than by reading the demuxer's source.

**4. "Stream ends prematurely" is not a safe signal — confirmed.** Cut the progressive fixture's body at 40% on its third request (the main sequential read, after `moov` negotiation), destroyed the connection, and this time let a fourth request (ffmpeg's own automatic reconnect) serve the remainder. Result: **exit 0, 233,063 bytes** — the exact figure the builder cited — with stderr reading `Stream ends prematurely at 92990, should be 232403` immediately followed by `Will reconnect at 92990 in 0 second(s), error=Input/output error.`, and nothing else. The file is whole. My own earlier candidate pattern would have failed this stream for no reason; the builder's refusal of it holds.

#### The open decision: cut-body cases, reproduced

**HLS.** Sent 50% of `seg002.ts`'s bytes then destroyed the connection (never a full refusal, and no reconnect ever offered by this fixture). The segment was requested exactly once. Result: **exit 0, 106,205 bytes** against a 115,869-byte clean control, stderr reading only `Stream ends prematurely at 10810, should be 21620` and `corrupt input packet in stream 0` (with two `Packet corrupt` lines either side of it) — neither `SEGMENT_SKIPPED`, `FRAGMENT_LOST` nor `DEMUX_READ_FAILED` matches any of that text, so this round's fix does not catch it either.

**DASH.** Same shape against `chunk-stream0-00003.m4s`: 50% of its bytes, then a destroyed connection, one request only. Result: **exit 0, 188,700 bytes** against a 206,414-byte clean control, stderr reading `Stream ends prematurely at 17496, should be 34992`, two `Packet corrupt` lines, `corrupt input packet in stream 0`, and `partial file` — again nothing any of the three shipped patterns match. Neither number matches the builder's cited 141,503/157,114 (HLS) or 185,160/206,414 (DASH) exactly — my cut fraction and fixture differ from whatever the builder used — but the shape is identical: a body cut mid-transfer, no retry, silent completion, and the same two stderr lines.

**Testing option (a) for false failures.** Flipped every byte in the middle 20% of `seg002.ts` (same length, full `content-length`, nothing truncated, nothing reset — a fully-delivered but internally-corrupted segment, the kind a bad transcode or storage bit-rot would produce, with no download failure involved at all) and streamed it. Result: **exit 0, 111,907 bytes** — nearly the full 115,869-byte clean length — with stderr reading `Packet corrupt (stream = 0/1, dts = ...)` four times, `corrupt input packet in stream 0` and `corrupt input packet in stream 1` (twice each), `PES packet size mismatch`, and an ADTS bitstream-filter error. **`corrupt input packet in stream` is present here too, on a source whose transfer was never interrupted at all.** Option (a) as written would fail this stream outright, discarding a file that is 97% complete and plays except for one glitchy second, over a problem that has nothing to do with the download. This is exactly the cost the builder's own recommendation names ("the cost is failing a source with genuinely corrupt packets") — I did not have to hypothesise it, one bit-flipped segment reproduces it directly.

I also checked the recovering controls for the same string, since option (a)'s premise depends on it being absent from them: the progressive-heal repro's stderr (`Stream ends prematurely` + `Will reconnect`, above) contains no `corrupt` text at all, and neither does a segment that fails once or twice and heals on HLS (zero stderr, measured in an earlier round). So the premise holds for the two controls named — `corrupt input packet in stream` is absent from both — but it is not absent from a third case nobody in this decision has named yet: a healthy transfer carrying corrupted content.

**Option (b), re-examined in light of that.** `Stream ends prematurely` alone does not appear in my corruption case at all — the transfer completed with the declared `content-length`, so there was nothing for the `http` protocol handler to complain about; the corruption is caught by the demuxer/decoder layer instead, on different lines. So (b) — matching `Stream ends prematurely` only when no `Will reconnect` follows — would **not** misfire on the corrupted-but-fully-delivered case I found, while (a) does. It also correctly fires on both cut-body reproductions above (neither logged `Will reconnect` — HLS and DASH's own fragment/segment fetchers have no such reconnect concept; only the plain `http` protocol handler progressive uses does) and correctly stays silent on the two healing controls (where `Will reconnect` does follow). The "tracked per connection" the builder's option names is likely for the case of a separate audio rendition or a subtitle track on its own connection — each needs its own pending flag, since `Stream ends prematurely` and any `Will reconnect` for it are lines on one input's connection, not the whole process's.

**Restated as options, with a recommendation:**

- **(a)** — one pattern, catches every cut-body case measured across all three protocols and needs no per-connection state. Against it: a real, measured false failure — a fully-delivered segment with corrupted content (no transfer loss at all) also logs `corrupt input packet in stream`, and this option would fail that stream, discarding 97% of a video over a defect the download did nothing wrong on.
- **(b) (recommended)** — more implementation, but measured to catch all three cut-body cases and to correctly stay silent on both my corruption false-positive and the two healing controls. The complexity is real but bounded: a pending flag per open ffmpeg input connection, set on `Stream ends prematurely` and cleared by an immediately-following `Will reconnect`; for HLS/DASH there is no reconnect concept at all, so the flag never needs clearing there and the line is unambiguous by itself.
- **(c)** — accept the gap. I would not recommend it on its own: the shortfall I measured is real (roughly 8-9% of the file, silently) and is exactly the class of defect this whole ticket exists to stop happening quietly. Worth naming only as the fallback if (b)'s per-connection bookkeeping turns out costlier to build than it looks from here — I did not attempt the implementation, only the measurements it would need to pass.

#### The stand-in ffmpeg test at line 848 — not a tautology

`tools/downloader/engine/test/stream.test.ts:848 "a segment skipped after a certificate refusal is TLS_VERIFICATION_FAILED, not DOWNLOAD_FAILED"` replaces the real ffmpeg binary with a Node script that writes 4096 bytes to stdout, then two hand-written stderr lines, then exits 0. Two things make this more than a restatement of the classifier it exercises:

- It runs the real production path end to end — a real spawned process, the real `attempt()`, the real line-by-line `onStderrLine` buffering, the real `ffmpeg.terminate()` and `done` rejection — not a direct call to `isTlsVerificationFailure` or `losesSourceData`.
- It tests an **ordering property**, not just a string match: the sticky flag `sawCertificateRejection` is set by the refusal line and stays set when the `skipping` line arrives after it. I mutated `tools/downloader/engine/src/stream.ts:555 "if (!sawCertificateRejection) sawCertificateRejection = isTlsVerificationFailure(line);"` to `if (false) sawCertificateRejection = isTlsVerificationFailure(line);` — the first of the test's two cases (refusal-then-skip, expecting `TLS_VERIFICATION_FAILED`) went red with `DOWNLOAD_FAILED` instead; reverted, green again. A test that could pass regardless of this line's presence would be the tautology; this one cannot.

Its real limitation is disclosed in its own comment, not hidden: the stderr text is hand-written to match the classifier's regexes, not captured from a real egress-proxy refusal. `api/test/two-origin-tls.test.ts` is named as the real, end-to-end version — and it is real for the **classification itself** (a round-2 regression in this exact precedence broke two of its cases, per that round's Log), but every one of its passing cases I read fails at the very first segment, before any byte reaches the visitor, so it does not exercise the specific shape the stand-in does: some data already sent, then a later segment lost to a certificate refusal on the same stream. That narrower shape — precedence after the first byte, specifically — is proven only by the stand-in, and the stand-in is honest that it is a stand-in. I judge this adequate, not a gap worth carrying as a finding: the property under test (ordering of two flags inside one function) does not need real TLS to be true or false, and the stand-in's own comment already names where the real wiring is proven.

#### New findings, in lines this round touched

- **high (carried forward, narrowed further)** — the open decision above: a cut-body failure (as distinct from a refused-outright segment/fragment) still ends as a silent, truncated success on every protocol measured, uncaught by any of the three patterns this round shipped. Same acceptance line as every prior round's high finding.
- **med** — testing the builder's own recommended option (a) surfaced a real false-failure case its "false failures" note did not anticipate: a fully-delivered, internally-corrupted segment (no transfer loss) also logs `corrupt input packet in stream`. Not a defect in anything shipped — (a) is not yet implemented — but a cost the owner's decision should be made with, not after.
- **findings** — 2 this round; both carried (1 high, 1 med). Nothing dropped.

#### Method note

Fixtures reused from earlier rounds (`gate-b/midfail-fixture`, `gate-b/round2-fixtures/dash8`, `.../prog9`), all still present and unmodified. The corrupted-segment file (`/tmp/gateb/seg002-corrupt.ts`, a byte-flipped copy) and every cut-body script are kept in scratch, not committed. Every mutation this round was reverted before this section was written; `git status --short` is empty in the reviewed worktree.

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

- 2026-09-27 — **Round four: gate 4's narrowed high, gate 3's low and gate 4's
  low, on the owner's answers of the same day.** The committed `## Review` was
  withdrawn in one commit and the four sections — gates 1 and 2 re-resolved at
  `8ac378c`, then gates 3 and 4 — landed verbatim with
  `scripts/review-record.mjs`, one commit each.

  **Truncation after the first byte, for DASH and progressive. Reproduced,
  fixed with two more stderr patterns, one of the gate's candidates refused.**
  Measured first with `scratchpad/dl-53/explore*.mts`: the argv from
  `buildStreamArgs`, the fixtures from `engine/test/helpers/media.ts`, ffmpeg
  6.1.1.
  - **DASH**, `chunk-stream0-00003.m4s` reset: exit 0, 171,334 bytes against
    206,414 whole, and one line, `Failed to open fragment of playlist`. The
    DASH demuxer never retries: the same fragment reset **once** and served on
    a second request gives the same 171,334 bytes, because it asks once. So the
    line always means a hole, and is `FRAGMENT_LOST` in `engine/src/stream.ts`.
  - **Progressive**, the body read cut at 40% and every reconnect refused:
    exit 0, 96,079 bytes, ending in `Error during demuxing: Input/output error`
    and `Error retrieving a packet from demuxer: Input/output error` —
    `DEMUX_READ_FAILED`.
  - **"Stream ends prematurely" is refused as a signal.** The same cut, served
    whole on the reconnect, completes at 233,063 bytes (the full file) and
    still writes `Stream ends prematurely at …` and `Will reconnect at …`.
    Matching it would fail a download that succeeded.
  - Red first: the two new cases at the end of `engine/test/stream.test.ts`
    ("a DASH fragment that cannot be fetched after the first byte" and "a
    progressive body cut after the first byte and never served again") failed
    with `expected false to be true` on `received.aborted`. Controls, green
    before and after: a progressive cut resumed on reconnect, and an HLS
    segment refused once and served on the retry, each complete and within
    0.6 s of its length. Mutations, each reverted by the script that made it
    (`scratchpad/dl-53/mutate.cjs`): dropping `FRAGMENT_LOST` fails only the
    DASH case; dropping `DEMUX_READ_FAILED` fails only the progressive case.
  - The progressive case refuses reconnects with `404`, not a reset: ffmpeg
    gives up on a 404 in 11 s and on resets in 55, and both end in the same
    lines.
  - **Not checked against real-world sources for false failures**, as before.

  **A shape neither gate named, measured and not fixed: a segment or fragment
  whose body is cut short, rather than refused.** An HLS segment cut at 40%
  once loses data — 141,503 bytes against 157,114 for the same fixture served
  whole — and so does a DASH fragment cut at 40% (185,160 against 206,414).
  Neither demuxer re-requests it, and neither writes any line matched above:
  both write `Stream ends prematurely` (which cannot be the signal, see above)
  and `corrupt input packet in stream 0`. Raised to the orchestrator as an open
  decision rather than closed here, because the one line that would catch it
  is also what a source with genuinely corrupt packets produces.

  **`PROBE_TIMEOUT_MS` is capped at 50 s (gate 3's low, fixed as decided).**
  `PROBE_TIMEOUT_CEILING_MS` in `api/src/config.ts` is the `max` on its `int()`
  call; `config.test.ts`'s new last case failed first with `expected 120000 to
be 50000`, and holds the ceiling to `TUNNEL_BUDGET_MS / (MAX_REPROBE_RETRIES
  - 1)`. An override passed in code is not capped — tests use one to reach a
zero wait. `.env.example`, the settings table and the deployment doc say so.

  **The certificate precedence has an engine-level case (gate 4's low).** A
  real refused segment needs the API's egress proxy, which the engine cannot
  import, so the case stands ffmpeg in with a script that writes the proxy's
  refusal line and then the skip line: `TLS_VERIFICATION_FAILED`, and
  `DOWNLOAD_FAILED` without the refusal line. Skipped on Windows, where a
  script cannot be spawned without a shell. Making the precedence branch
  always false fails it; reverted.

- 2026-09-27 — **Round five: the cut-body shape, on the owner's answer of the
  same day** — gate 6's option (b), which overrode the builder's (a), because
  gate 6 measured (a)'s `corrupt input packet` firing on a segment delivered
  whole with damaged bytes. The committed `## Review` was withdrawn and the
  six sections landed verbatim, one commit each.

  **The rule.** An early end — "Stream ends prematurely" — fails the stream
  when no "Will reconnect" from the **same connection** answers it; it is
  decided when ffmpeg exits, before the body is ended, so the visitor sees a
  cut connection and the job records `DOWNLOAD_FAILED` (`STREAM_ENDED_EARLY`
  and `connectionOf` in `engine/src/stream.ts`).

  **Attribution, measured rather than assumed** (`scratchpad/dl-53/explore4.mts`,
  ffmpeg 6.1.1, raw lines): the early end and its reconnect carry the same
  `[http @ 0x…]` address — `0x557cbe02b840` for both in the healed
  progressive case — and a separate video and audio input each get their own:
  audio cut once gave `0x558f9e5993c0` on both lines, video cut once
  `0x55f2d7d73a00`, and both files came back whole at 233,063 bytes. The
  interleaving itself is tested with the stand-in: early ends on two
  connections, reconnects in the other order, completes; the same with one
  reconnect missing fails.

  **Red first**, each `expected false to be true` on `received.aborted` or, for
  the stand-in, `promise resolved … instead of rejecting`: "an HLS segment
  whose body is cut short", "a DASH fragment whose body is cut short", and the
  interleaving case, all at the end of `engine/test/stream.test.ts`.
  **Controls**, green before and after: the healed progressive reconnect, the
  HLS retry, a segment delivered whole with 4 KB inverted (new), and a
  separate audio rendition cut once and resumed (new). The progressive cut
  never served again was red first last round and stays green.

  **Mutations** (`scratchpad/dl-53/mutate2.cjs`, the whole spec each time, the
  file restored after):
  - no early end recorded: fails the HLS and DASH cut-body cases and the
    interleaving case — the three cases the rule exists for;
  - a reconnect answering for every connection: fails only the interleaving
    case;
  - a reconnect answering for none: fails only the two healed controls and the
    healed half of the interleaving case;
  - `FRAGMENT_LOST` dropped: fails only the DASH refused-fragment case;
  - **`DEMUX_READ_FAILED` dropped: fails nothing.** The progressive case it was
    added for last round now also ends in an early end that no reconnect
    answers — the last refused reconnect writes one (raw lines in
    `scratchpad/dl-53/explore5.mts`'s run) — so the new rule catches it at
    exit. Kept, with that said at the constant, and raised to the orchestrator
    as a decision rather than removed: the owner added it last round.
