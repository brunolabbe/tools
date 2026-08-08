# Status and handoff

Living document. Updated at the end of each work session so the next agent can
start without re-deriving where things stand. Roadmap and phase definitions live
in [02-ROADMAP.md](./02-ROADMAP.md); this file records what actually happened.

**Last updated:** 2026-08-08 · **Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · WP-6 ✅ ·
WP-7 next**

---

## Where things stand

| Phase                    | State       | Evidence                                   |
| ------------------------ | ----------- | ------------------------------------------ |
| Phase 0 — Foundations    | ✅ complete | `5ab843f`                                  |
| Phase 1 — Parallel build | ✅ complete | `5662f95`, `725740c`, `ca35a55`, `b876906` |
| Phase 2 — Integration    | ✅ complete | WP-5, `apps/api`                           |
| Phase 3 — Hardening      | 🟡 half     | WP-6 ✅ · WP-7 ops not started             |

**466 tests pass. `npm run check` is green.** 31 test files, zero live-network
tests.

### Milestones

- **M1 — Vertical slice ✅.** Proven by `packages/engine/test/hls-e2e.test.ts`.
- **M2 — Any-site probe ✅.** `apps/api/src/resolvers.ts` composes the registry,
  and `apps/api/test/queue-and-shutdown.test.ts` asserts the expendability
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
- **M4** — after WP-7. WP-6's half is done: rate-limited, SSRF-guarded and
  quota'd. Containerisation and CI remain.

---

## What WP-6 delivered

Six items in the brief; two were already done, four were not.

| Brief item          | State                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| 1. SSRF guard       | ✅ shipped early, in WP-5. Unchanged.                                    |
| 2. Rate limits      | ✅ new — `apps/api/src/rate-limit.ts`                                    |
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

`packages/engine/test/spawn-safety.test.ts` scans every `src` file in the repo:
no truthy `shell:`, no `exec`/`execSync` imported from `node:child_process`, and
every file that spawns must say `shell: false` explicitly. It asserts its own
scan found something first, so an empty walk cannot pass silently. Verified
against a planted violation rather than assumed to work.

---

## What WP-5 delivered

`apps/api`, ~20 source files and 5 test files (85 tests).

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

**DNS rebinding is only partly mitigated.** The guard rejects any name where
_any_ record is blocked, and re-checks after each redirect, but the gap between
`lookup()` and the socket connect is a genuine TOCTOU. Closing it properly means
pinning the checked address into the connection via a custom dispatcher, which
needs `undici` — the same dependency the proxy gap below wants.

**ffmpeg fetches outside the guard.** `guarded-fetch.ts` covers the direct
resolver and the engine's own fetches, but ffmpeg does its own HTTP and cannot
be wrapped. This is why the guard vets **every URL in a `ProbeResult`** before
the engine is handed anything — that check is load-bearing, not belt-and-braces.

**No proxy for direct fetches.** Unchanged from Phase 1. Adding `undici` closes
this and the rebinding gap together.

**Test files are still not typechecked.** Unchanged: each project's `include` is
`src/**`. `apps/api/test` is now the largest untypechecked surface in the repo.

**Interrupted jobs are failed, not resumed.** A job running when the process
died cannot be resumed — the engine's tmp state is gone and the probe is stale —
so `reconcileInterruptedJobs` fails them with a retryable `INTERNAL` at boot
rather than leaving a progress bar that never moves.

**403 is ambiguous** and **ffmpeg failures surface as `DOWNLOAD_FAILED`** —
both unchanged from Phase 1, and both now handled: `DOWNLOAD_FAILED` during
`downloading` is treated as re-probe-worthy exactly once.

**No component-render tests** in `apps/web` — unchanged; WP-7's Playwright E2E
is the right place.

---

## Running things

```bash
npm run check                       # lint + format + typecheck — must pass
npm test                            # vitest run, all 466
npx vitest run apps/api             # one package

# The full stack. Two terminals:
npm run dev -w @downloader/api      # API on 127.0.0.1:8080
npm run dev -w @downloader/web      # UI on 5173, proxying /api to the API
```

`apps/web` defaults to the **mock** transport. To point it at a running API,
copy `apps/web/.env.example` to `.env.local` (it sets `VITE_API_MOCK=false`).
The Vite dev server proxies `/api`, so the setup is same-origin and needs no
CORS configuration.

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
