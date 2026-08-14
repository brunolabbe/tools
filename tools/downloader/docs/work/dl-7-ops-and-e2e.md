---
id: dl-7
tool: downloader
title: Ops and end-to-end tests — Docker, logging, health, CI
kind: work-package
status: done
milestone: M4
depends_on: [dl-5]
---

# dl-7 — Ops and end-to-end tests

**Area:** repo root · **Was:** WP-7 · **Ran parallel with:**
[dl-6](./dl-6-security-and-limits.md)

## Why

M4 is a claim about a clean machine, so it has to be checked by one. Everything
here exists to make "it works on my machine" into something CI can refute.

## Build

1. **Dockerfile** — multi-stage, Playwright base image (Chromium deps
   preinstalled), ffmpeg, optional yt-dlp. Non-root user. `compose.yaml` with a
   storage volume.
2. **Structured logging** — `pino`, request ids correlated to job ids.
   **Redact `Cookie` and `Authorization` from every logged `RequestContext`** —
   captured headers routinely contain live session credentials.
3. **Health** — `/api/health` reporting ffmpeg availability, yt-dlp presence,
   browser pool state, disk free.
4. **E2E** — Playwright test driving the real UI against a local fixture server
   that serves a genuine HLS stream. No third-party sites in CI.
5. **CI** — `npm run check` + tests on push.

## Done when

**(M4)** `docker compose up` gives a working service from a clean machine, and
CI is green.

## Log

Shipped in `3d322c2`. Five items in the brief, plus one addition the M4 criterion
implied and three bugs the end-to-end tests found.

| Brief item             | State                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| 1. Dockerfile          | ✅ multi-stage on the Playwright base, non-root, `compose.yaml`      |
| 2. Structured logging  | ✅ pino, request ids correlated to job ids                           |
| 3. Health              | ✅ ffmpeg, yt-dlp, browser pool, disk free, version, uptime          |
| 4. E2E                 | ✅ Playwright against a local fixture HLS origin — **found 3 bugs**  |
| 5. CI                  | ✅ check · tests on Linux + Windows · e2e · a `docker compose` smoke |
| _(added)_ Serve the UI | ✅ `WEB_DIR`, same-origin — without it a container is not a service  |

M4 was checked by doing it, not by reading the Dockerfile: the image builds, the
container serves the UI and the API on one origin, `/api/health` reports green,
Chromium launches inside it (`151.0.7922.34`), and a real HLS stream downloads
through the container to a 157 KB MP4 whose box order is `ftyp,moov,free,mdat`
and which re-decodes with zero ffmpeg errors.

### The E2E tests found three real bugs, all in the UI's event handling

This is the entry worth reading. Every one of them was invisible to the unit
suites, which mock the transport, and to manual testing against a slow site.
They only appear when a job finishes **fast** — a local fixture stream
completes in under a second, so the whole race runs every single time.

The failure a user saw: a download that finished perfectly on the server, while
the card sat at "Queued" forever with its byte counter climbing, and no
download link ever appeared.

1. **The reducer refused a status the server reported.** `withStatus` gated on
   `canTransition`, so a non-adjacent jump was held back. But the first frame a
   client receives is the SSE route's opening snapshot of the job's _current_
   status — `downloading` for anything that started while the `POST` response
   was still in flight. `queued → downloading` is not a step in the FSM, so it
   was refused, and from there every later frame was refused too. A status
   frame is the server _reporting_ where the job is, not asking to move it, so
   it is now applied unconditionally. Monotonicity is still guaranteed by the
   terminal-state and stale-timestamp guards, which is what the gate was
   really protecting.
2. **The client hung up before the payload arrived.** The outcome is sent as
   two frames — `status: completed`, then `completed` carrying the result and
   the download link. `job-stream.ts` treated the first as terminal and closed
   the socket, throwing the second away. Only the payload-carrying frames end
   the stream now.
3. **And then the terminal guard swallowed the payload.** With (1) fixed, the
   status frame arrived first and set the job terminal, at which point
   `applyJobEvent`'s "nothing may follow a terminal state" rule dropped the
   `completed` frame behind it. The guard now admits the payload that _agrees_
   with the status already recorded, so a late or contradictory `failed` still
   cannot overturn a completed job.

Each has a regression test in `tools/downloader/web/test/`. The general lesson is
the one the brief was betting on: a mocked transport cannot reproduce the
ordering of a real one, and the bug lived precisely in the ordering.

### Logging: pino, and one line per request

`createLogger` kept its interface exactly — that seam was written for this — so
no call site changed. Two pino defaults are overridden: string levels and ISO
timestamps, because these logs are read raw far more often than they are piped
through anything; and stderr rather than stdout, unchanged from before.

Redaction now runs twice. The structural pass still recognises a
`RequestContext` by shape, so a caller that forgets cannot leak a session
cookie; pino's own `redact` paths catch header bags that arrive under some
other name. Both are tested, including that `Referer` — the header that makes
replay work — survives.

**Request ids** come from `X-Request-Id` when a caller sends a sane one and are
generated otherwise, are echoed back on every response, and are bound to a
child logger for the request. `POST /api/jobs` passes its id into the
orchestrator, so every line a job writes minutes later on a queue worker still
carries the id of the call that created it. Health checks log at `debug`: at
`info` a liveness probe every few seconds is the majority of the log within a
day, which buries everything worth reading.

### Health went from "is ffmpeg configured" to "can this thing work"

The most useful addition is the smallest: `/api/health` now **stats** the ffmpeg
binary rather than trusting the path. `ffmpeg-static` hands out a confident path
inside `node_modules` whether or not its postinstall download ran, so a
container built with `--omit=optional`, or on a platform it has no build for,
passed every check and then failed every job. That is now a red health check at
boot. It also reports yt-dlp's _resolved_ path (a missing binary on a machine
where it is plainly installed is nearly always a `PATH` that differs between
the shell and the service), browser pool occupancy including whether Chromium
has ever launched, free disk, version and uptime.

A full disk is deliberately **not** unhealthy: a failing container health check
restarts the container, and restarting frees nothing — it just converts a
degraded service into a crash loop.

### The container serves the UI, because otherwise it is not a service

The brief did not ask for this, but "`docker compose up` gives a working
service" does. `WEB_DIR` points the API at a built bundle and it serves it
same-origin, which is also why there is no CORS to configure and why
`EventSource` — which cannot send headers and is fussy about origins — works at
all. Unknown paths fall back to `index.html` for a browser asking for HTML, but
an unknown `/api/…` path and any request for JSON still get their typed 404:
answering those with a page is how a client ends up parsing `<!doctype html>`
as a `Job`.

Hashed assets are immutable, `index.html` is `no-cache`, dotfiles are not
served, and it is off entirely when `WEB_DIR` is unset — running headless is a
perfectly good configuration.

**One behaviour change worth knowing:** `VITE_API_MOCK` now defaults by mode.
Dev still defaults to the mock, so the UI runs with no backend; a _production
build_ defaults to the real API. An image that silently mocked every download
would look perfectly healthy and do nothing, and the mistake would be found by
a user rather than by a test.

### Docker

Playwright's own image as the base, pinned to the `playwright` version in
`tools/downloader/resolvers` — a mismatch makes Playwright try to download a
browser at runtime, into a read-only filesystem, at the moment of the first
probe. ffmpeg comes from the distribution rather than `ffmpeg-static`, so image
builds do not depend on a GitHub release being up and a CVE can be patched
without an npm publish. yt-dlp is a build arg, off by default, exactly as
expendable as the roadmap says it is.

`compose.yaml` binds to **loopback**. This service fetches URLs a client names
and runs a browser against them, so publishing it on every interface by default
would be handing out an open proxy. It also sets `init: true` (ffmpeg and
Chromium both fork, and PID 1 does not reap orphans) and `shm_size: 1gb`
(Docker's default 64 MB `/dev/shm` shows up as tabs crashing mid-probe, which
reads as a flaky site rather than a container setting).

**The security trade-off to understand:** `BROWSER_NO_SANDBOX=true` is set,
because Chromium's own sandbox needs privileges the container does not have.
The container is the boundary instead — which is why it runs as `pwuser` with
no added capabilities. The alternative, keeping the sandbox and granting
`SYS_ADMIN`, is a strictly larger hole. Do not run this container as root.

### CI

`check` is split out because it answers in under a minute and a formatting
failure should not wait on a browser download. `test` runs on **Linux and
Windows**, because this project has a real Windows story — process trees are
killed with `taskkill`, paths are confined with `path.relative`, and reserved
names like `CON` are a Windows-only hazard — and Linux-only CI would exercise
none of it. `e2e` runs the stack and uploads traces on failure. `docker` builds
the image and waits for the service's own health endpoint, because M4's
criterion is a claim about a clean machine and should be checked by a clean
machine.

The slow, downloader-specific gates live in `.github/workflows/downloader.yml`,
path-filtered to this tool; the repo-wide `ci.yml` is what every tool pays on
every push.
