# Architecture

Derived from [00-ANALYSIS.md](./00-ANALYSIS.md).
Every structural choice below traces back to a constraint in that document.

---

## System shape

Every package named below lives under `tools/downloader/`.

```
┌──────────────┐   POST /api/probe          ┌────────────────────────────┐
│              │ ─────────────────────────► │                            │
│              │  GET  /api/probe/:id/events│            api             │
│     web      │ ◄───────── SSE ─────────── │          Fastify           │
│  React+Vite  │   POST /api/jobs           │                            │
│              │ ─────────────────────────► │  ┌──────────────────────┐  │
│              │   GET  /api/jobs/:id/events│  │  Job orchestrator    │  │
│              │ ◄───────── SSE ─────────── │  │  queue · FSM · SSE   │  │
└──────────────┘   GET  /api/files/:token   │  └──────┬───────────────┘  │
                 ◄──────────────────────────└─────────┼──────────────────┘
                                    ┌─────────────────┴─────────────────┐
                                    ▼                                   ▼
                    ┌───────────────────────────┐      ┌────────────────────────────┐
                    │        resolvers          │      │           engine           │
                    │  ─────────────────────    │      │  ────────────────────      │
                    │  registry (by priority)   │      │  hls · dash · progressive  │
                    │   ├─ site-specific   (10) │      │  ffmpeg runner + progress  │
                    │   ├─ yt-dlp adapter  (20) │      │  storage + retention GC    │
                    │   ├─ browser sniffer (50) │      │                            │
                    │   └─ direct URL      (90) │      └────────────────────────────┘
                    └───────────────────────────┘
                                    └────────────  contract  ───────────┘
                                       types · errors · FSM · API schemas
                                                    │
                                            @webtools/core
                                    error machinery · transitions · redaction
```

## Packages

| Package     | Responsibility                                                         | Depends on                  |
| ----------- | ---------------------------------------------------------------------- | --------------------------- |
| `contract`  | Types, error taxonomy, job FSM, zod API schemas. **No runtime logic.** | `@webtools/core`            |
| `resolvers` | URL → `ProbeResult`. Registry + all resolver implementations.          | contract                    |
| `engine`    | `ProbeResult` → file on disk. ffmpeg, segments, storage, GC.           | contract                    |
| `api`       | Fastify HTTP surface, job orchestration, SSE, file serving.            | contract, resolvers, engine |
| `web`       | Single-page UI: paste URL → pick variant → watch progress → download.  | contract                    |

`contract` is the seam that lets several agents build in parallel without
colliding — treat changes to it as interface changes requiring coordination,
not routine edits.

It owns only what is _about video_. The generic half of the error taxonomy and
the job-transition machinery come from `@webtools/core` in `packages/`, which is
shared with every other tool in the repo and must stay free of this tool's
vocabulary.

---

## The pipeline

```
URL ──► [probe] ──► ProbeResult ──► [user picks variant] ──► [job created]
                                                                  │
                    ┌─────────────────────────────────────────────┘
                    ▼
             [RE-PROBE]  ← mandatory; signed URLs expire in ~30–300 s (§5)
                    │
                    ▼
             [download]  ── HLS/DASH/progressive, replaying RequestContext
                    │
                    ▼
              [mux/remux]  ── ffmpeg -c copy, +faststart, subtitle embed
                    │
                    ▼
              [publish]  ── opaque token → /api/files/:token, TTL'd
```

The re-probe step is not redundant. It is the direct consequence of §5 of the
analysis, and skipping it produces intermittent 403s that are miserable to debug.

---

## Key decisions and why

**Browser sniffer as the foundation, extractors as a fast path in front of it.**
Not an even trade between two strategies — a base layer plus an optimisation.
Only the sniffer can handle a site nobody has written code for, which is the
whole requirement; yt-dlp is layered ahead of it mainly to serve the common ~90%
in 2 s instead of 15 s with better metadata. The invariant that follows: **a
missing extractor tier is a fallthrough, never an error**, and a site the sniffer
can read still resolves without it. Adding site support = adding a resolver file; it must never require
touching the engine, API or UI.

**What this section used to claim, and what building it measured.** It said
"remove every extractor tier and the system still works, only slower", and that
yt-dlp becoming load-bearing for coverage would mean the layering had inverted.
For YouTube it is load-bearing, and not because of anything this code did: the
sniffer comes back with `NO_MEDIA_FOUND` on a YouTube watch page, so without
yt-dlp the site finds no video at all
([dl-72](./work/dl-72-youtube-finds-no-video-because-the-image-has-no-yt-dlp.md)).
The layering is still right for the sites nobody has written an extractor for;
it is not a promise that every site the extractor handles is also one the
sniffer can. **YouTube needs yt-dlp**, so the image ships it and its pin is kept
current by `.github/workflows/ytdlp-bump.yml`.

**ffmpeg for all assembly.** Hand-rolled segment concatenation breaks on
discontinuities, timestamp drift and A/V sync. Ship `ffmpeg-static` so there is
no system-install step; allow `FFMPEG_PATH` to override it.

**SQLite + in-process queue for v1, not Redis/BullMQ.** One less service, and
jobs are long-running and low-throughput — the queue is not the bottleneck.
Keep the queue behind an interface so swapping in BullMQ later is a one-file
change, but do not pay for it now.

**SSE, not WebSockets.** Progress is server→client only. SSE is a plain HTTP
response, survives proxies, and reconnects on its own. WebSockets buy nothing
here.

**Two SSE channels, because a probe has no job (dl-43).** `/api/jobs/:id/events`
is keyed on a row in the job store, so it can 404 and its subscribers are bounded
by the store. `/api/probe/:id/events` is keyed on an id the _client_ mints and
sends with the POST — there is no earlier request to have been handed one by, and
the first resolver stage happens while that POST is still in flight. So it cannot
404 on an unknown id, it buffers until its first subscriber attaches, and its
channels expire on a timer of their own. The rule both obey is that a stage is
reported because code reached the line that reports it; the analyse panel is a
single replaced line and deliberately _not_ a gated bar, because the resolver
tiers are alternatives and a bar that filled as the chain degraded would report
failure as progress.

**Capability-token file URLs.** `/api/files/:token` where the token is
unguessable random bytes, never the job id. Job ids appear in logs and URLs; the
download capability must not be inferable from them.

**Preview images are fetched here, at probe time, and served by token (dl-29).**
A resolver's `thumbnailUrl` is attacker-influenced, so the browser is never
pointed at it: the API fetches it through the SSRF-checked fetch, replaying the
probe's `RequestContext`, and serves the bytes from `/api/thumbnail/:token`. It
happens in-line, right after the probe, because that is the only moment the
source's credentials are in hand. It is bounded at 4 s and 512 KB, and every
failure is simply no preview.

**When the source names no image at all, one frame is grabbed from the stream
instead (dl-56).** The stream is the one source every successful probe has. One
ffmpeg invocation (`grabPreviewFrame` in the engine) reads the cheapest
rendition with video, seeks a tenth in (at most 3 s), and writes one JPEG, at most
256 px on its longer edge. It goes out through the **ffmpeg egress proxy** with
TLS verification on, exactly like a download, because the segments and keys a
manifest names are URLs only that proxy ever vets. It is never attempted after a
named image failed, never for a live stream, and never retried against another
rendition. What it costs: one ffmpeg process per probe or job re-probe whose
source names no image, which is every probe the direct tier answers (it never
reads an image) — bounded server-wide by `MAX_CONCURRENT_FRAME_GRABS`, its own
cap, because the probe gate is released before the grab runs. Past that cap a
probe simply answers with no preview. The grab is bounded at 6 s, including the process-tree kill, and
at the same 512 KB. Measured through the terminating proxy, a whole probe that
grabbed took 0.38–0.50 s against a real CDN and under 0.11 s against the
generated fixture. On HLS it fetches the playlist and the first two segments,
the same as frame 0 would, on 6- and 10-second segments.

**Fail loudly with typed codes.** Every failure maps to one `ErrorCode` in
`contract/src/errors.ts`. No layer invents its own strings — that is what makes the UI
able to say something useful instead of "something went wrong".

---

## Runtime layout

```
storage/
  tmp/<jobId>/          segments, partial muxes — deleted on terminal state
  out/<jobId>/<file>    finished artifacts — deleted by retention GC
data/downloader.sqlite  jobs, probe cache, file tokens
```

## Configuration

All via environment, parsed and validated once at boot with zod. Fail fast on a
bad value rather than discovering it mid-job. See
[`.env.example`](../.env.example), which nothing loads: it lists the variables
and their defaults.

| Variable                      | Default      | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                        | `3000`       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `STORAGE_DIR`                 | `./storage`  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MAX_CONCURRENT_JOBS`         | `2`          | ffmpeg is I/O and CPU hungry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MAX_CONCURRENT_BROWSERS`     | `2`          | ~300 MB each                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MAX_JOBS_PER_CLIENT`         | `2`          | jobs one client may have running _and_ waiting at once — bounds who holds a slot, where `RATE_LIMIT_JOBS_PER_MINUTE` only bounds how fast one is claimed. Counted in flight, not per minute, so CGNAT and shared offices wait rather than get locked out (`dl-51`). `0` disables it                                                                                                                                                                                                                                                                                                                                |
| `MAX_QUEUED_JOBS`             | `8`          | jobs allowed to be waiting at once, across every client — bounds the queue itself, which a per-client cap cannot: many client keys, each under its own cap, could otherwise still queue without limit. Past it, a new job is refused rather than accepted to wait up to `JOB_TIMEOUT_MS`. Defaults to `4 × MAX_CONCURRENT_JOBS`. `0` disables it (`dl-51`)                                                                                                                                                                                                                                                         |
| `MAX_CONCURRENT_FRAME_GRABS`  | `2`          | preview-frame grabs in flight at once, server-wide — its own cap rather than a share of `MAX_CONCURRENT_PROBES`, because the probe gate is released before the grab runs and so never bounded it (measured: 12 grabs against a cap of 8). Defaults to `MAX_CONCURRENT_JOBS`, the other cap on concurrent ffmpegs. Past it the grab is skipped and the probe answers with no preview; there is no queue and no disabled value (`dl-56`)                                                                                                                                                                             |
| `MAX_PROBES_PER_CLIENT`       | `2`          | the same cap as `MAX_JOBS_PER_CLIENT`, for probes against `MAX_CONCURRENT_PROBES`. `0` disables it (`dl-51`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MAX_FILE_SIZE_MB`            | `4096`       | checked _before_ download, from bitrate × duration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FILE_RETENTION_HOURS`        | `6`          | GC deadline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `OUTCOME_RETENTION_DAYS`      | `90`         | how long a `probe_outcomes` row survives the same sweep; a size bound, not a privacy one — the row carries a hostname and resolver timings, never a path, a query string or an address (`dl-57`)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PROBE_TIMEOUT_MS`            | `45000`      | browser sniffing is slow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `JOB_TIMEOUT_MS`              | `3600000`    | hard kill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FFMPEG_PATH`                 | bundled      | override system binary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `YTDLP_PATH`                  | `yt-dlp`     | absent is a fallthrough, not an error — but the image ships it, because YouTube resolves through nothing else (`dl-72`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PROXY_URL`                   | —            | must apply to probe _and_ download (IP-bound signed URLs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `EGRESS_CA_FILE`              | system store | extra CA bundle, **merged** with the public roots; four clients get it — ffmpeg's terminating proxy, the tiers' terminating proxy (`dl-37`), the undici dispatcher behind every probe, and ffmpeg when interception is off. Chromium and yt-dlp are reached through their proxy rather than directly, because neither has a trust store this repo can write to; with `FFMPEG_TLS_INTERCEPT` off they are not reached at all and say `TLS_VERIFICATION_FAILED` when that bites (`dl-34`). Boot warns which of the two states it is in. `FFMPEG_CA_FILE` is the deprecated spelling and still works, warning at boot |
| `FFMPEG_TLS_INTERCEPT`        | `true`       | the proxies terminate TLS, which is what verifies **segment** origins and what carries `EGRESS_CA_FILE` to the tiers. `false` restores the `dl-14` tunnel for ffmpeg _and_ the tiers: everything keeps working and the manifest is still checked, but the segments go back to unverified (`dl-21`) and the tiers back to their own trust stores (`dl-34`). Narrower than its name since `dl-37`. Warns at boot                                                                                                                                                                                                     |
| `FFMPEG_ALLOW_UNVERIFIED_TLS` | `false`      | **strictly larger, and the last resort.** Nothing is verified at all, manifest included. If the interception is what broke, `FFMPEG_TLS_INTERCEPT=false` is the smaller answer and is tried first. Warns louder, see `dl-19`                                                                                                                                                                                                                                                                                                                                                                                       |
| `ENABLE_AGE_CONFIRMATION`     | `false`      | the browser tier presses a recognised "I am over 18" control. **Off because that press is an attestation made on the user's behalf**, which only an operator can choose to make; with it off, such a page fails `AGE_CONFIRMATION_REQUIRED` rather than `NO_MEDIA_FOUND`. Closing a modal over the player is not behind it (`dl-48`)                                                                                                                                                                                                                                                                               |
| `ENABLE_BROWSER_RESOLVER`     | `true`       | lets you run a cheap, fast-only deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## Security posture

Non-negotiable, because this service fetches arbitrary URLs on request:

- **SSRF guard** — resolve hostnames and reject loopback / private / link-local /
  cloud-metadata ranges, re-validated **after every redirect**. Applies to the
  page URL _and_ to every media URL a resolver returns; a resolver's output is
  attacker-influenced data, not trusted input.
- **Guarded egress** — the pre-flight check above cannot reach a fetch made by a
  subprocess, and three of them fetch: ffmpeg, Chromium and yt-dlp. All three
  are pointed at a loopback proxy that runs the same guard on every request and
  pins the address it vetted, so a segment URI or a page subresource that no
  `ProbeResult` ever contained is still checked. `PROXY_URL`, when set, is
  chained to rather than replaced.
- **TLS verification, and who performs it.** The engine's own fetches go through
  undici, which verifies without being asked — against the system store **plus
  `EGRESS_CA_FILE`** since `dl-31`, which is when that dispatcher was told about
  the operator's root at all. Until then the operator's root reached ffmpeg and
  the proxy and not the dispatcher, so a private-root deployment half worked
  with the halves the confusing way round: the download succeeded and the probe
  that set it up answered `502 UNREACHABLE`, because a rejected chain reaches
  `fetch` as a bare `TypeError` that reads as a network failure. ffmpeg's do not
  verify unless told —
  `tls_verify` defaults to off in libavformat — so since `dl-19` every remote
  input ffmpeg opens carries `-tls_verify 1`. That covers the manifest
  connection and, on its own, nothing else:

  - **A plain-`http://` input carries neither flag, deliberately.**
    `avformat_open_input` fails on an option nothing consumed, so the flag on an
    HTTP manifest aborts the download outright. Nothing is lost: a manifest
    fetched in the clear can be rewritten by whoever could have substituted the
    segments it names.
  - **No ffmpeg option verifies a segment connection, and there is not going to
    be one.** libavformat copies a fixed list onto the connections a demuxer
    opens for its segments — `headers`, `user_agent`, `cookies`, `http_proxy`,
    `referer`, `rw_timeout`, `icy` — and `tls_verify` and `ca_file` are not in
    it. The list is a compile-time array in `ffio_copy_url_options`
    (`libavformat/aviobuf.c`), `hls.c`'s `open_url` builds every segment
    connection from that copy, and `dashdec.c` calls the same function, so DASH
    is identical by construction rather than by coincidence.
    [`dl-21`](./work/dl-21-verified-hls-segments.md) measured sixteen candidates
    on ffmpeg 6.1.1 and 7.0.2 and recovered the array from the binary itself.
    Until `dl-27` the consequence was the whole video: a manifest on a verified
    origin whose segment URIs point at a second, untrusted origin downloaded and
    remuxed without complaint, exit 0.

  **[`dl-27`](./work/dl-27-verify-segment-origins.md) closes it from the other
  end — the one option libavformat _does_ propagate is `http_proxy`.** Every
  ffmpeg egress has gone through this service's loopback guarded proxy since
  `dl-11`, so the proxy is already on every segment connection. It now
  **terminates** ffmpeg's connections instead of tunnelling them: it verifies the
  real origin itself, against the system store plus `EGRESS_CA_FILE`, and
  re-encrypts to ffmpeg under a leaf issued by a root generated per process.
  ffmpeg checks that leaf on the manifest, where `-tls_verify 1` reaches, and
  ignores it on the segments, where it never could — and either way the origin
  behind it has been verified.

  Four consequences, each of which has bitten somebody:

  - **The two CA settings swapped sides.** `-ca_file` _replaces_ ffmpeg's trust
    store, so ffmpeg's is now the generated root and nothing else, and
    `EGRESS_CA_FILE` goes to the proxy, merged with the system store. Reversed,
    a deployment fails closed on every public origin.
  - **This reverses `dl-14`, which chose a tunnel precisely so the certificate
    reaching the client is the origin's own.** ffmpeg no longer sees one, and
    every media byte crosses this process in plaintext. `server.ts` says so once
    per boot rather than leaving it to this page.
  - **Only ffmpeg's proxy intercepted, until `dl-37`.** Chromium and yt-dlp
    verify their own connections, so the tiers kept a tunnelling proxy on a
    second port. The reasoning held except for one clause — they verify against
    trust stores **nothing in this repo can write to**, so `EGRESS_CA_FILE`
    could not reach the two tiers that load the page, which is what `dl-34`
    filed. Both proxies terminate now, on separate roots; `server.ts` starts one
    each and gives the tiers theirs by a mechanism per tier, described below.
  - **There is a way back, and it is deliberately not the big switch.**
    `FFMPEG_TLS_INTERCEPT=false` returns both proxies to tunnelling: the
    manifest stays verified, `EGRESS_CA_FILE` goes back to ffmpeg and stops
    reaching the tiers, and the segments are unchecked again exactly as `dl-21`
    described them. It exists so an operator whom the interception breaks has
    somewhere to go other than `FFMPEG_ALLOW_UNVERIFIED_TLS`, which also gives
    up the manifest. The two are not interchangeable, each has its own boot
    warning, and the smaller one still reopens a hole and says so in those
    words.
  - **A refused origin has one channel out.** No certificate semantics reach
    ffmpeg from a segment fetch by any route, so the proxy answers the `CONNECT`
    with `502 TLS certificate verification failed (<verify code>)`; ffmpeg
    echoes a proxy's status line at warning level, which is why `GLOBAL_ARGS`
    asks for `-loglevel warning`, and `runner.ts` reads it back as
    `TLS_VERIFICATION_FAILED` rather than a dead link.

  **[`dl-37`](./work/dl-37-tiers-move-onto-the-terminating-proxy.md) puts the
  resolver tiers on the same footing, and it is three mechanisms rather than
  one** — because "trust this root" is said differently to every client, and
  each was measured rather than assumed:

  - **Chromium** gets `--ignore-certificate-errors-spki-list=<base64 SHA-256 of
the root's SPKI>`. Not a trust store: Chromium on Linux reads NSS, which
    needs a `certutil` the image does not ship, and `SSL_CERT_FILE` reaches it
    not at all. The flag exempts chains carrying **that key**, so it adds rather
    than replaces and cannot fail closed on a public origin; what bounds it is
    that the key is generated per process and never written to disk. It is a
    launch flag, so it is bound per browser like `--proxy-server` is.
  - **yt-dlp** gets `SSL_CERT_FILE` pointing at the public roots **plus** the
    generated root, together with `--compat-options no-certifi`. Both halves:
    the shipped binary is a PyInstaller build carrying its own `certifi` and
    prefers it, so `SSL_CERT_FILE` on its own is read by OpenSSL and never
    consulted — as are `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`. Merged rather
    than replaced for the reason `-ca_file` is not.
  - **The verdict comes back by side channel.** The status-line trick above
    works for yt-dlp, which quotes it, and not for Chromium: every non-200
    `CONNECT` response reaches it as `net::ERR_TUNNEL_CONNECTION_FAILED` and
    nothing else. So the tiers' proxy files what it refused by host and
    `resolvers.ts` reattaches it, or `dl-34`'s `TLS_VERIFICATION_FAILED` would
    silently become "the site could not be reached", retryable, for a trust
    problem. `tls-rejections.ts` states what that match does and does not
    cover.

  The cost is the one `dl-14` named, at a larger size: a **whole rendered page**
  crosses this process in plaintext, not just a manifest and its segments. It is
  breadth and only breadth — a captured session cookie already crossed here
  through ffmpeg's proxy, by default, since `dl-27`.

- **Path safety** — filenames sanitised, output paths confined to `STORAGE_DIR`,
  no user string ever reaching a shell. Spawn with argument arrays, never
  `shell: true`.
- **Resource limits** — timeouts on every stage, process-tree kill on cancel,
  concurrency caps, disk quota check before starting.
- **Rate limiting** — **every client-facing route has a bucket**, which since
  [`dl-46`](./work/dl-46-rate-limit-the-probe-stage-channel.md) is a property
  rather than a list to keep in step. Per-IP on `/probe`, `/jobs` and
  `/probe/:id/events`, because what those protect is the service; per capability
  token on `/files/:token` and `/thumbnail/:token`, because what those protect is
  the one artefact the token names. Browser probes are expensive enough to be a
  trivial DoS vector otherwise, and on the SSE channel subscribing is what
  _creates_ a channel — so an unbucketed one let anybody fill the hub and leave
  every other user's analysis unnarrated.
- **There is no caller, so there is nothing that lists.** This service has no
  session, no user and no ownership column, and
  [`dl-32`](./work/dl-32-the-job-list-has-no-caller.md) settled what follows from
  that rather than leaving it: `GET /api/jobs` is **removed**, not scoped.
  Unauthenticated and unfiltered, it answered anyone who could reach the port
  with every job in the store — a browsing history, with a title-derived
  filename and a `variant.url` the contract itself says routinely carries a
  signed credential. Nothing in the UI ever called it, so the exposure is closed
  by deletion rather than by inventing an identity model to filter it with.

  **`GET /api/jobs/:id` deliberately stays**, and the reasoning is the trade
  [`dl-23`](./work/dl-23-rate-limit-the-download-route.md) already accepted for
  the capability: reaching it costs an attacker a `randomUUID()` job id, and
  that id already buys the download, so the history behind it is not a further
  step. This holds **only** while job ids are unguessable. Making them
  sequential or timestamped turns the single read back into an enumeration, and
  at that point it needs real authorisation — `routes.test.ts` asserts the id
  shape for that reason.

  **A list is not forbidden; it is unpaid for.** Restoring one means first
  deciding who may read a history, which is a trust model this tool has never
  had and a bigger change than the route. The three answers considered and
  declined are recorded on the ticket.
