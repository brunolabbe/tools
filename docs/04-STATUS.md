# Status and handoff

Living document. Updated at the end of each work session so the next agent can
start without re-deriving where things stand. Roadmap and phase definitions live
in [02-ROADMAP.md](./02-ROADMAP.md); this file records what actually happened.

**Last updated:** 2026-08-09 · **Phases 0–3 ✅ · M1–M4 ✅ · Phase 4 (coverage)
is what remains**

---

## Where things stand

| Phase                    | State       | Evidence                                   |
| ------------------------ | ----------- | ------------------------------------------ |
| Phase 0 — Foundations    | ✅ complete | `5ab843f`                                  |
| Phase 1 — Parallel build | ✅ complete | `5662f95`, `725740c`, `ca35a55`, `b876906` |
| Phase 2 — Integration    | ✅ complete | WP-5, `tools/downloader/api`               |
| Phase 3 — Hardening      | ✅ complete | WP-6 ✅ · WP-7 ✅                          |

**510 tests pass across 34 files, plus 3 Playwright end-to-end tests.
`npm run check` is green.** Zero live-network tests.

### Milestones

- **M1 — Vertical slice ✅.** Proven by `tools/downloader/engine/test/hls-e2e.test.ts`.
- **M2 — Any-site probe ✅.** `tools/downloader/api/src/resolvers.ts` composes the registry,
  and `tools/downloader/api/test/queue-and-shutdown.test.ts` asserts the expendability
  invariant directly: with `ENABLE_YTDLP_RESOLVER=false` the chain still
  contains the sniffer and still resolves. A configuration with _every_ tier
  disabled is now refused at boot rather than answering `NO_MEDIA_FOUND` for
  every URL on earth.
- **M3 — Functional goal ✅.** Verified against a real HLS stream served by a
  fixture origin that 403s any request missing the `Referer` the resolver
  captured. Probe → job → SSE → download link → file. The output re-decodes
  cleanly under ffmpeg, has `moov` before `mdat` (fast-start), and the origin
  log confirms **every segment** carried the replayed header. Range requests
  return `206` with a correct `Content-Range`; a forged token returns `404`.
  Now also proven **through a browser** — see WP-7's E2E below.
- **M4 — Deployable ✅.** `docker compose up` gives a working service. Checked
  by doing it, not by reading the Dockerfile: the image builds, the container
  serves the UI and the API on one origin, `/api/health` reports green,
  Chromium launches inside it (`151.0.7922.34`), and a real HLS stream
  downloads through the container to a 157 KB MP4 whose box order is
  `ftyp,moov,free,mdat` and which re-decodes with zero ffmpeg errors.

---

## The undici work: address pinning and a real proxy

Two gaps this document listed separately turned out to be one seam, and they
closed together. `tools/downloader/api/src/dispatcher.ts` is the whole of it.

**DNS rebinding is now actually fixed, not narrowed.** The old guard resolved a
name, approved it, and then let the socket resolve it again — so the address
that was checked and the address that was connected to were never the same
object, and a TTL-0 record was free to differ. `net.connect` accepts a `lookup`
and undici passes one through from `Agent`'s `connect` options, so the
resolution the socket uses is now ours: resolve once, check every record, hand
the survivors straight to the socket. There is no second resolution left to
disagree with the first.

`ssrf.ts` stays exactly where it was. It refuses a URL before a socket exists,
with a typed error naming a reason, and it is the only check that can cover the
URLs **ffmpeg** fetches through its own HTTP stack — which is why the sweep over
every URL in a `ProbeResult` is still load-bearing. The two share one policy:
`isBlockedAddress` for the address rule and the guard's new `isExemptHost` for
the escape hatches, so a fixture host that the pre-flight check waves through
cannot be refused at connect time.

**The proxy now applies to direct fetches.** Node's global `fetch` ignores
`http_proxy` entirely, so before this `PROXY_URL` reached ffmpeg, yt-dlp and the
browser while every direct fetch quietly went around it. On a deployment that
sets a proxy because its egress IP matters, that means signed URLs issued to one
address and redeemed from another — a 403 that reads like a flaky extractor.
`ProxyAgent` closes it. `PROXY_URL` is also now validated at boot rather than at
the first request: `socks5://` is the common mistake, and `ProxyAgent` speaks
HTTP to the proxy.

**Proxy and pinning are exclusive, deliberately.** See the note in the gaps
section below — with a proxy there is no local resolution to pin, so pinning is
not weakened, it is simply not the mechanism in play.

The tests worth reading are the last block of `tools/downloader/api/test/dispatcher.test.ts`.
They give the guard a lookup that answers with a public address so the
pre-flight check passes, point the connector's resolver at loopback, and fetch
over a real socket — a DNS rebind reduced to its essentials. The connector
refuses it; the companion test proves the dispatcher is genuinely in the socket
path rather than being ignored. `npm run e2e:downloader` still passes unchanged.

---

## What WP-7 delivered

Five items in the brief, plus one addition the M4 criterion implied and three
bugs the end-to-end tests found.

| Brief item             | State                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| 1. Dockerfile          | ✅ multi-stage on the Playwright base, non-root, `compose.yaml`      |
| 2. Structured logging  | ✅ pino, request ids correlated to job ids                           |
| 3. Health              | ✅ ffmpeg, yt-dlp, browser pool, disk free, version, uptime          |
| 4. E2E                 | ✅ Playwright against a local fixture HLS origin — **found 3 bugs**  |
| 5. CI                  | ✅ check · tests on Linux + Windows · e2e · a `docker compose` smoke |
| _(added)_ Serve the UI | ✅ `WEB_DIR`, same-origin — without it a container is not a service  |

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

Each has a regression test in `tools/downloader/web/test/`. The general lesson is the one
the brief was betting on: a mocked transport cannot reproduce the ordering of a
real one, and the bug lived precisely in the ordering.

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
`tools/downloader/resolvers` — a mismatch makes Playwright try to download a browser at
runtime, into a read-only filesystem, at the moment of the first probe. ffmpeg
comes from the distribution rather than `ffmpeg-static`, so image builds do not
depend on a GitHub release being up and a CVE can be patched without an npm
publish. yt-dlp is a build arg, off by default, exactly as expendable as the
roadmap says it is.

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

Four jobs. `check` is split out because it answers in under a minute and a
formatting failure should not wait on a browser download. `test` runs on
**Linux and Windows**, because this project has a real Windows story — process
trees are killed with `taskkill`, paths are confined with `path.relative`, and
reserved names like `CON` are a Windows-only hazard — and Linux-only CI would
exercise none of it. `e2e` runs the stack and uploads traces on failure.
`docker` builds the image and waits for the service's own health endpoint,
because M4's criterion is a claim about a clean machine and should be checked
by a clean machine.

---

## What WP-6 delivered

Six items in the brief; two were already done, four were not.

| Brief item          | State                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| 1. SSRF guard       | ✅ shipped early, in WP-5. Unchanged.                                    |
| 2. Rate limits      | ✅ new — `tools/downloader/api/src/rate-limit.ts`                        |
| 3. Path confinement | ✅ already done in WP-3 (`storage.ts`) and WP-5 (`routes/files.ts`)      |
| 4. No shell         | ✅ already true; now **enforced** by a source scan rather than by care   |
| 5. Quotas           | ✅ global storage quota new; per-job, stage and concurrency caps existed |
| 6. Retention GC     | ✅ already done in WP-3/WP-5                                             |

### Rate limiting: two mechanisms, because they fail differently

A **per-IP token bucket** on `POST /api/probe` (10/min) and `POST /api/jobs`
(5/min). A bucket rather than a fixed window, because a window admits `2n`
across its boundary and for a 15 s browser probe that is the difference between
a limit and a suggestion. Refusals carry `Retry-After` plus the `RateLimit-*`
draft headers, and `details.retryAfterSec` — which was already on the
client-safe allowlist in `http-errors.ts`, so the UI can render it today.

Reads are not limited. Rate-limiting a cancel would leave a client unable to
stop the very work that spent its allowance.

A **global concurrency gate** on probes (`MAX_CONCURRENT_PROBES`, default four
per browser slot) behind it. Every per-IP bucket is passed by definition in a
distributed flood; this is the only thing that helps there. It refuses rather
than queues — the client is already holding a connection, and a wait line just
converts a spike into a pile of simultaneous timeouts.

Buckets are keyed by **IPv6 /64**, not by address. One customer routinely holds
a /64, so keying on the full address means 2^64 free rotations. IPv4-mapped
forms collapse to the v4 address so a client cannot hold two buckets by
changing how it spells itself. The bucket map is LRU-capped and prunes refilled
buckets, because an IP-keyed map is itself a memory attack.

### `trustProxy` now defaults to **off** — a behaviour change

WP-5 set `trustProxy: true` unconditionally. That is fine until something is
keyed on `request.ip`, at which point it means any client can name its own rate
limit bucket by sending `X-Forwarded-For`. It is now `TRUST_PROXY`, default
`false`, accepting `true` or — better — the proxy's address or CIDR.

**This needs setting on any deployment behind a reverse proxy.** Left off there,
every client shares the proxy's bucket: still safe, but one busy user throttles
everyone. Failing that way round was the deliberate choice.

### Global storage quota

`MAX_TOTAL_STORAGE_GB`, default 50, zero to disable. Enforced in the engine
(`#assertStorageQuota`) because the engine owns the filesystem layout. It counts
`tmp/` as well as `out/`: a job part-way through has already taken the space.

Over quota, it **runs the retention sweep and re-measures before refusing**.
Everything the sweep removes was already past its window, so refusing while
still holding files we had promised to delete would be self-inflicted. If the
space is still not there the answer is `SIZE_LIMIT_EXCEEDED` — the configured
cap — and not `DISK_FULL`, which means the volume and would send an operator to
look at a disk that has plenty of room.

### The no-shell rule is now enforced, not remembered

`packages/core/test/spawn-safety.test.ts` scans every `src` file in the repo:
no truthy `shell:`, no `exec`/`execSync` imported from `node:child_process`, and
every file that spawns must say `shell: false` explicitly. It asserts its own
scan found something first, so an empty walk cannot pass silently. Verified
against a planted violation rather than assumed to work.

---

## What WP-5 delivered

`tools/downloader/api`, ~20 source files and 5 test files (85 tests).

| Area            | Files                                           | Notes                                                                |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Server assembly | `server.ts`, `main.ts`, `context.ts`            | `createApp()` never listens; `main.ts` owns the socket and signals   |
| Job persistence | `db/schema.ts`, `db/job-store.ts`               | SQLite (`better-sqlite3`), append-only migrations, FSM enforced here |
| Orchestration   | `jobs/orchestrator.ts`, `jobs/queue.ts`         | Always re-probes; queue behind an interface so BullMQ can replace it |
| Transport       | `routes/*`                                      | probe, jobs, cancel, SSE, files, health                              |
| Security        | `ssrf.ts`, `guarded-fetch.ts`, `jobs/tokens.ts` | Pulled forward from WP-6 by decision — see below                     |

**The FSM is enforced in one place.** `JobStore.transition()` checks
`canTransition()` and writes inside a single SQLite transaction, so two callers
racing to finish a job cannot both win. `patch()` and `recordProgress()` exist
so field updates and progress — which arrive many times a second — cannot move
the state machine by accident.

**Capability tokens.** 32 CSPRNG bytes, base64url, stored alongside the job and
never derived from the job id. `/api/files/:token` rejects malformed tokens on
shape before touching the database.

**SSE emits the `JobEvent` union verbatim.** Heartbeat every 15 s, teardown on
disconnect, and the stream ends on a terminal frame. A client that connects
_after_ a job finished still receives its `completed`/`failed`/`canceled` frame
immediately, so it is never left staring at `queued`.

### Decisions taken

**The SSRF guard shipped with WP-5, not WP-6** (owner decision). It checks
resolved **IP addresses**, not hostnames — a name check is theatre, since
`localtest.me` resolves to loopback. Every record must be acceptable, not just
the first, which closes the multi-record rebinding variant. `guarded-fetch.ts`
re-checks after **every redirect** and is injected into both `DirectUrlResolver`
and the engine's `fetchImpl`.

**ClearKey is split by how the key is obtained** (owner decision). HLS
`KEYFORMAT="org.w3.clearkey"` with a directly fetchable key URI is transport
encryption — in scope, `protected: false`. This was verified empirically rather
than assumed: the bundled ffmpeg decrypts it byte-for-byte identically to
`identity`. Anything needing an EME licence exchange stays a hard stop, which in
practice means **all** DASH ClearKey (the key lives behind `<clearkey:Laurl>`)
and anything the browser detector sees, since `requestMediaKeySystemAccess` _is_
the EME entry point.

**`satisfies z.ZodType<T>` forced a spelling change.** The note in the previous
status doc assumed it would just work. It does not: under
`exactOptionalPropertyTypes`, a plain `?: T` is genuinely incompatible with
zod's `.optional()` output. `MediaVariant`, `ProbeResult`, `RequestContext`,
`DrmInfo` and `AppErrorPayload.details` now spell out `| undefined`, matching
the precedent `JobOptions` already set. The remaining string unions
(`JobStatus`, `StreamProtocol`, `DrmSystem`, subtitle formats, containers) were
converted to const tuples with the union derived from them — the `ERROR_CODES`
pattern — so `z.enum` cannot drift from the type.

**Two bugs found and fixed during verification**, both mine:

- The retention sweep deleted the token _row_ along with the file, which turned
  an expired link into `404` ("never existed") instead of `410 Gone`. The row
  now outlives the file by 30 days (`TOKEN_ROW_GRACE_MS`), with a `swept_at`
  column so the sweep does not reprocess it. Regression-tested at both the store
  and the route level.
- `URL.hostname` keeps the brackets on an IPv6 literal, so `http://[::1]/` was
  falling through to the DNS path instead of the address check. It failed closed,
  but for the wrong reason and with the wrong error code.

---

## Open questions for the owner

### 1. The job FSM has no back-edge, so retries cannot be modelled honestly

`JOB_TRANSITIONS` is strictly forward. The brief requires "on `VARIANT_GONE`,
re-probe once and retry", but `downloading → probing` is not a legal move, so
the retry currently re-probes **in place**: the job stays in `downloading`,
`attempts` increments, and a fresh `probed` event is emitted.

That works and is tested, but it is a workaround. `CLAUDE.md` forbids editing
the contract unilaterally, so this is left as-is. **Recommendation:** add
`probing` to `downloading`'s legal targets. The UI would then correctly show a
job that is genuinely re-probing rather than one that appears stuck mid-download.
See the note above `MAX_REPROBE_RETRIES` in `jobs/orchestrator.ts`.

**Update from WP-7.** The client no longer depends on the FSM's adjacency to
interpret a status frame, so the workaround is now invisible to the UI rather
than merely tolerable — a re-probe in place renders as a job still working. The
recommendation stands, but it is now a modelling improvement rather than
something the UI is papering over.

### 2. `attempts` semantics

Currently "how many probe-and-download attempts this job has made", so a
first-time success reports `1`. Worth confirming that is what the UI wants to
render.

### 3. Are the rate-limit defaults the ones you want?

10 probes and 5 job creations per minute per client, as a token bucket, so both
numbers are also the burst. They are a guess at "one person using the UI
normally, with room for a mistake" — a probe, a look at the variants, a second
probe after editing the URL. If this is ever pointed at a shared network where
many people appear as one address, both want raising. `TRUST_PROXY` is the
other half of that answer: set correctly, colleagues behind one NAT still get
their own buckets.

---

## Known gaps and risks

**Rate limiting is per-process, not per-deployment.** The buckets live in
memory, so two replicas behind a load balancer grant two allowances. Correct for
the single-container deployment this targets; a shared store (the same Redis
BullMQ would want) is the fix if it is ever scaled out.

**DNS rebinding: closed, except through ffmpeg.** `tools/downloader/api/src/dispatcher.ts`
pins the vetted address into the socket, so the check and the connection can no
longer disagree — see the section above. What remains is the same ffmpeg gap
recorded below: ffmpeg resolves its own names and no dispatcher of ours governs
it, so for the segments ffmpeg fetches, the pre-flight check on every URL in a
`ProbeResult` is still the only guard, TOCTOU and all.

**ffmpeg fetches outside the guard.** `guarded-fetch.ts` covers the direct
resolver and the engine's own fetches, but ffmpeg does its own HTTP and cannot
be wrapped. This is why the guard vets **every URL in a `ProbeResult`** before
the engine is handed anything — that check is load-bearing, not belt-and-braces.

**Proxy mode does not pin, by design.** With `PROXY_URL` set, the target name is
resolved by the proxy and there is no local resolution to pin; what bounds
egress there is the proxy's own policy. The pre-flight check still runs, and
`SSRF_ALLOW_PRIVATE_ADDRESSES` exists for the deployment whose DNS view differs
from its proxy's.

**Test files are still not typechecked.** Unchanged: each project's `include` is
`src/**`. `tools/downloader/api/test` is now the largest untypechecked surface in the repo,
and `e2e/` is in the same position — Playwright transpiles it without type
checking, so a stale selector helper fails at run time rather than at build.

**Interrupted jobs are failed, not resumed.** A job running when the process
died cannot be resumed — the engine's tmp state is gone and the probe is stale —
so `reconcileInterruptedJobs` fails them with a retryable `INTERNAL` at boot
rather than leaving a progress bar that never moves.

**403 is ambiguous** and **ffmpeg failures surface as `DOWNLOAD_FAILED`** —
both unchanged from Phase 1, and both now handled: `DOWNLOAD_FAILED` during
`downloading` is treated as re-probe-worthy exactly once.

**No component-render tests** in `tools/downloader/web`. The Playwright suite now covers the
paths that matter most end to end, which is where the three status bugs were
caught, but there is still nothing between "pure function" and "whole stack in
a browser". A broken component that happens not to be on the E2E path fails
silently.

**The E2E suite drives only the direct resolver.** The browser sniffer and
yt-dlp have their own tests against their own fixtures, and dragging Chromium
and a network extractor into a UI test would make it slow and flaky without
proving anything new. The consequence is that nothing exercises
sniffer → engine → UI in one piece; the seam is covered by types and by the
API's own tests.

**The container's browser tier is only smoke-tested.** Chromium is confirmed to
launch and render inside the image, but no probe of a real MSE page has been
run from inside a container.

---

## Running things

```bash
npm run check                       # lint + format + typecheck — must pass
npm test                            # vitest run, all 510
npx vitest run tools/downloader/api             # one package

npm run e2e:install                 # once: fetches the browser
npm run e2e:downloader                         # whole stack in a real browser

docker compose up --build           # the service, on http://localhost:8080

# The full stack, one terminal. API on 127.0.0.1:8080, UI on 5173.
npm run dev
npm run dev:downloader:api                     # or one at a time
npm run dev:downloader:web
```

`tools/downloader/web` defaults to the **mock** transport. To point it at a running API,
copy `tools/downloader/web/.env.example` to `.env.local` (it sets `VITE_API_MOCK=false`).
The Vite dev server proxies `/api`, so the setup is same-origin and needs no
CORS configuration.

**Two dev-tooling traps, both fixed, both worth not re-introducing.**
`npm run dev --workspaces` runs workspaces _serially_, so the API's watcher held
the chain and the web app never started — the root script goes through
`concurrently` now. And on Windows, `tsx watch` under `concurrently` starts,
prints nothing and never binds: no error, no exit, just a dead port. The API dev
script is `node --watch --import tsx` for that reason. Verified by running it,
including that a source edit still triggers a restart.

To exercise the real pipeline without a browser tier, as the M3 verification did:

```bash
ENABLE_BROWSER_RESOLVER=false ENABLE_YTDLP_RESOLVER=false \
  SSRF_ALLOW_HOSTS=127.0.0.1 STORAGE_DIR=./storage \
  npm run dev -w @downloader/api
```

`SSRF_ALLOW_HOSTS` is the escape hatch for a local fixture origin; it is empty
by default and must stay that way in production.

A load test will trip the limits long before it finds anything interesting.
Turn them off for that, and only that:

```bash
RATE_LIMIT_PROBE_PER_MINUTE=0 RATE_LIMIT_JOBS_PER_MINUTE=0 \
  npm run dev -w @downloader/api
```
