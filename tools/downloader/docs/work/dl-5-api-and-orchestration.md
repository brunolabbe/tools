---
id: dl-5
tool: downloader
title: API and job orchestration
kind: work-package
status: done
milestone: M3
depends_on: [dl-1, dl-2, dl-3, dl-4]
---

# dl-5 — API and job orchestration

**App:** `tools/downloader/api` · **Was:** WP-5 · **Ran alone**, after Phase 1.
This is M3.

## Why

The join point. One ticket rather than several, because it wires the other four
together and concurrent edits here cause more trouble than they save.

## Build

1. Fastify + zod validation from `contract/src/api.ts`. Routes exactly as `ROUTES`.
2. **Job FSM** — use `canTransition()` from `contract/src/job.ts`; reject illegal
   transitions rather than tolerating them. Persist to SQLite
   (`better-sqlite3`), so a restart does not lose job history.
3. **Queue** — in-process, `MAX_CONCURRENT_JOBS`, behind an interface so BullMQ
   can replace it later without touching callers.
4. **Pipeline** — `probing` (**always re-probe**, per analysis §5 — never reuse
   the probe from the original request) → `downloading` → `muxing` →
   `completed`. On `VARIANT_GONE`, re-probe once and retry automatically.
5. **SSE** — `/api/jobs/:id/events`, heartbeat every 15 s, clean teardown on
   client disconnect. Emit the `JobEvent` union verbatim.
6. **File serving** — `/api/files/:token`, token = 32 random bytes, stored
   alongside the job; never derived from the job id. Range requests supported,
   `Content-Disposition: attachment`, `410 Gone` past expiry.
7. **Probe cache** — short TTL (≤60 s) keyed by URL. Long enough to spare a
   double-click, short enough that signed URLs are still alive.
8. Graceful shutdown: stop intake, cancel running jobs, dispose resolvers.

## Done when

**(M3)** Paste a URL in the web UI, pick a quality, watch progress, download the
file. End to end, on a real site.

## Log

Shipped in `8d0d6d0`: ~20 source files and 5 test files (85 tests).

| Area            | Files                                           | Notes                                                                |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Server assembly | `server.ts`, `main.ts`, `context.ts`            | `createApp()` never listens; `main.ts` owns the socket and signals   |
| Job persistence | `db/schema.ts`, `db/job-store.ts`               | SQLite (`better-sqlite3`), append-only migrations, FSM enforced here |
| Orchestration   | `jobs/orchestrator.ts`, `jobs/queue.ts`         | Always re-probes; queue behind an interface so BullMQ can replace it |
| Transport       | `routes/*`                                      | probe, jobs, cancel, SSE, files, health                              |
| Security        | `ssrf.ts`, `guarded-fetch.ts`, `jobs/tokens.ts` | Pulled forward from dl-6 by decision — see below                     |

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

M3 was verified against a real HLS stream served by a fixture origin that 403s
any request missing the `Referer` the resolver captured. Probe → job → SSE →
download link → file. The output re-decodes cleanly under ffmpeg, has `moov`
before `mdat` (fast-start), and the origin log confirms **every segment** carried
the replayed header. Range requests return `206` with a correct `Content-Range`;
a forged token returns `404`.

### Decisions taken

**The SSRF guard shipped here, not in [dl-6](./dl-6-security-and-limits.md)**
(owner decision) — this is the first code exposed to the internet. It checks
resolved **IP addresses**, not hostnames: a name check is theatre, since
`localtest.me` resolves to loopback. Every record must be acceptable, not just
the first, which closes the multi-record rebinding variant. `guarded-fetch.ts`
re-checks after **every redirect** and is injected into both `DirectUrlResolver`
and the engine's `fetchImpl`.

**ClearKey is split by how the key is obtained** (owner decision). HLS
`KEYFORMAT="org.w3.clearkey"` with a directly fetchable key URI is transport
encryption — in scope, `protected: false`. Verified empirically rather than
assumed: the bundled ffmpeg decrypts it byte-for-byte identically to `identity`.
Anything needing an EME licence exchange stays a hard stop, which in practice
means **all** DASH ClearKey (the key lives behind `<clearkey:Laurl>`) and
anything the browser detector sees, since `requestMediaKeySystemAccess` _is_ the
EME entry point.

**`satisfies z.ZodType<T>` forced a spelling change.** The Phase 1 status note
assumed it would just work. It does not: under `exactOptionalPropertyTypes`, a
plain `?: T` is genuinely incompatible with zod's `.optional()` output.
`MediaVariant`, `ProbeResult`, `RequestContext`, `DrmInfo` and
`AppErrorPayload.details` now spell out `| undefined`, matching the precedent
`JobOptions` already set. The remaining string unions (`JobStatus`,
`StreamProtocol`, `DrmSystem`, subtitle formats, containers) were converted to
const tuples with the union derived from them — the `ERROR_CODES` pattern — so
`z.enum` cannot drift from the type.

**Two bugs found and fixed during verification**, both mine:

- The retention sweep deleted the token _row_ along with the file, which turned
  an expired link into `404` ("never existed") instead of `410 Gone`. The row
  now outlives the file by 30 days (`TOKEN_ROW_GRACE_MS`), with a `swept_at`
  column so the sweep does not reprocess it. Regression-tested at both the store
  and the route level.
- `URL.hostname` keeps the brackets on an IPv6 literal, so `http://[::1]/` was
  falling through to the DNS path instead of the address check. It failed closed,
  but for the wrong reason and with the wrong error code.

**Left open:** the FSM has no back-edge, so the `VARIANT_GONE` retry re-probes
in place rather than moving the job back to `probing`. That is
[dl-9](./dl-9-fsm-reprobe-back-edge.md).
