---
id: dl-6
tool: downloader
title: Security and limits — rate limiting, quotas, path confinement
kind: work-package
status: done
milestone: M4
depends_on: [dl-5]
---

# dl-6 — Security and limits

**Area:** `tools/downloader/api` + `tools/downloader/engine` · **Was:** WP-6 ·
**Ran parallel with:** [dl-7](./dl-7-ops-and-e2e.md)

## Why

This service fetches URLs a client names and runs a browser against them. Every
item below is the difference between that being a product and it being an open
proxy with a 15-second amplification factor.

## Build

1. **SSRF guard** — resolve hostnames, reject loopback / private / link-local /
   ULA / cloud-metadata (`169.254.169.254`), re-checked **after every redirect**.
   Apply it to the page URL _and_ to every media URL a resolver returns —
   resolver output is attacker-influenced data, not trusted input.
2. **Rate limits** — per-IP on `/probe` and `/jobs`; browser probes are
   expensive enough to be a one-line DoS otherwise.
3. **Path confinement** — verify every resolved output path is inside
   `STORAGE_DIR`; sanitise filenames (strip separators, control chars, reserved
   Windows names like `CON`/`NUL`, cap length).
4. **No shell** — argument arrays everywhere, assert no `shell: true` survives.
5. **Quotas** — global disk cap, per-job size cap, hard stage timeouts, browser
   and job concurrency caps.
6. **Retention GC** — periodic sweep deleting expired files and orphaned tmp dirs.

## Done when

Tests prove SSRF payloads (`localhost`, `127.0.0.1`, `169.254.169.254`, a
redirect _to_ one of those, DNS-rebinding-shaped input) are all rejected.

## Log

Shipped in `c7846b9`. Six items in the brief; two were already done, four were
not.

| Brief item          | State                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| 1. SSRF guard       | ✅ shipped early, in [dl-5](./dl-5-api-and-orchestration.md). Unchanged. |
| 2. Rate limits      | ✅ new — `tools/downloader/api/src/rate-limit.ts`                        |
| 3. Path confinement | ✅ already done in dl-3 (`storage.ts`) and dl-5 (`routes/files.ts`)      |
| 4. No shell         | ✅ already true; now **enforced** by a source scan rather than by care   |
| 5. Quotas           | ✅ global storage quota new; per-job, stage and concurrency caps existed |
| 6. Retention GC     | ✅ already done in dl-3/dl-5                                             |

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

dl-5 set `trustProxy: true` unconditionally. That is fine until something is
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

### Open question for the owner

**Are the rate-limit defaults the ones you want?** 10 probes and 5 job creations
per minute per client, as a token bucket, so both numbers are also the burst.
They are a guess at "one person using the UI normally, with room for a mistake"
— a probe, a look at the variants, a second probe after editing the URL. If this
is ever pointed at a shared network where many people appear as one address,
both want raising. `TRUST_PROXY` is the other half of that answer: set
correctly, colleagues behind one NAT still get their own buckets.

**2026-08-22 — carried here from `03-STATUS.md` (repo-1).** The limits are
**per-process, not per-deployment.** Both buckets and the concurrency gate live
in memory, so two replicas behind a load balancer grant two allowances. That is
correct for the single-container deployment this targets, and the fix if it is
ever scaled out is a shared store — the same Redis a BullMQ queue would want.
The status page had been the only place this was written down; it is a property
of what this ticket built, so it belongs here.
