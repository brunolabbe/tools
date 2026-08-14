# Architecture

Derived from [00-ANALYSIS.md](./00-ANALYSIS.md).
Every structural choice below traces back to a constraint in that document.

---

## System shape

Every package named below lives under `tools/downloader/`.

```
┌──────────────┐   POST /api/probe          ┌────────────────────────────┐
│              │ ─────────────────────────► │                            │
│     web      │   POST /api/jobs           │            api             │
│  React+Vite  │ ─────────────────────────► │          Fastify           │
│              │   GET  /api/jobs/:id/events│                            │
│              │ ◄───────── SSE ─────────── │  ┌──────────────────────┐  │
└──────────────┘   GET  /api/files/:token   │  │  Job orchestrator    │  │
                 ◄──────────────────────────│  │  queue · FSM · SSE   │  │
                                            │  └──────┬───────────────┘  │
                                            └─────────┼──────────────────┘
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
whole requirement; yt-dlp is layered ahead of it purely to serve the common ~90%
in 2 s instead of 15 s with better metadata. The invariant that follows:
**remove every extractor tier and the system still works**, only slower. If a
change ever makes yt-dlp load-bearing for coverage, the layering has inverted and
is wrong. Adding site support = adding a resolver file; it must never require
touching the engine, API or UI.

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

**Capability-token file URLs.** `/api/files/:token` where the token is
unguessable random bytes, never the job id. Job ids appear in logs and URLs; the
download capability must not be inferable from them.

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
bad value rather than discovering it mid-job. See `.env.example`.

| Variable                  | Default     | Why it matters                                            |
| ------------------------- | ----------- | --------------------------------------------------------- |
| `PORT`                    | `3000`      |                                                           |
| `STORAGE_DIR`             | `./storage` |                                                           |
| `MAX_CONCURRENT_JOBS`     | `2`         | ffmpeg is I/O and CPU hungry                              |
| `MAX_CONCURRENT_BROWSERS` | `2`         | ~300 MB each                                              |
| `MAX_FILE_SIZE_MB`        | `4096`      | checked _before_ download, from bitrate × duration        |
| `FILE_RETENTION_HOURS`    | `6`         | GC deadline                                               |
| `PROBE_TIMEOUT_MS`        | `45000`     | browser sniffing is slow                                  |
| `JOB_TIMEOUT_MS`          | `3600000`   | hard kill                                                 |
| `FFMPEG_PATH`             | bundled     | override system binary                                    |
| `YTDLP_PATH`              | `yt-dlp`    | optional; degrade gracefully if absent                    |
| `PROXY_URL`               | —           | must apply to probe _and_ download (IP-bound signed URLs) |
| `ENABLE_BROWSER_RESOLVER` | `true`      | lets you run a cheap, fast-only deployment                |

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
- **Path safety** — filenames sanitised, output paths confined to `STORAGE_DIR`,
  no user string ever reaching a shell. Spawn with argument arrays, never
  `shell: true`.
- **Resource limits** — timeouts on every stage, process-tree kill on cancel,
  concurrency caps, disk quota check before starting.
- **Rate limiting** — per-IP on `/probe` and `/jobs`; browser probes are
  expensive enough to be a trivial DoS vector otherwise.
