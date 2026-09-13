---
id: dl-57
tool: downloader
title: Keep a record of how each probe and download ended, and a report that reads it
kind: work-package
status: ready
milestone: M5
depends_on: []
difficulty: standard
---

# dl-57 — A record of how probes and downloads end

**Packages:** `api` (a migration, the probe route, the orchestrator, the
retention sweep, a report entry point), `resolvers` (per-attempt timings), and
the settings lists in `.env.example`, `01-ARCHITECTURE.md` and
`docs/02-DEPLOYMENT.md`.

## Why

**The owner's choice, 2026-09-13:** an outcome table plus a report. The
alternatives were richer log lines only, a Prometheus endpoint, or nothing.
[dl-49](./dl-49-open-without-a-login.md) waits on this, so the first public
traffic is measured and not lost.

The questions this answers, none of which the service can answer today:

- **Which sites fail, and at which resolver.** This is Phase 4's input. Each
  site-specific resolver is chosen from exactly this list.
- **How long a probe takes, per resolver.** The browser tier is the expensive
  one, and nothing times it.
- **What share of downloads finish**, and which error codes end the rest, over
  days rather than one log tail.

What exists, read on `origin/main` `1835657`:

- **Download outcomes are already durable.** The `jobs` table (`db/schema.ts`,
  migration 1) keeps `source_url`, `status`, `error_json`, `attempts`,
  `created_at` and `finished_at`. No production code deletes a row:
  `JobStore.delete` has no caller outside the tests. The sweep removes files,
  tokens and thumbnails only. So a success rate can be queried today, but keyed
  on the full URL, which is dl-54's question and not a grouping key.
- **Probe outcomes are not durable at all.** A success logs `probe complete`
  (resolver, variant count, DRM, preview). A failure reaches `setErrorHandler`
  in `server.ts` as `request rejected`, with the code and `details`. The
  registry fills `details` with the page URL and one `{ resolver, code }` per
  attempt, with no duration (`resolvers/src/registry.ts`). A cache hit logs
  nothing. None of it is timed, and none of it outlives the container's log
  buffer.

## Build

1. **Migration 5: a `probe_outcomes` table.** Columns: `id`, `host` (hostname
   only), `outcome` (`ok` or the `AppError` code), `resolver` (the winning tier
   or null), `attempts_json` (`[{ resolver, code, durationMs }]`),
   `duration_ms`, `cached` (0/1), `variants`, `drm` (0/1), `created_at`. Index
   on `created_at`. The same migration adds a `host` column to `jobs`, set when
   a job is created. A download's duration is already
   `finished_at − created_at`, so it gets no column.
2. **Never store a path, a query string or an address.** A signed URL carries
   its credential in the query string (the root `CLAUDE.md` redaction rule), and
   a hostname answers every question above. Take it from `new URL(…).hostname`.
3. **Time each resolver attempt in the registry.** Add `durationMs` beside
   `resolver` and `code`, and time the winning attempt too. **Check first
   whether the `details` shape is typed in `@downloader/contract`.** If it is,
   stop and raise it: a contract change is not made unilaterally.
4. **Record one row on every way out of `POST /api/probe`:** a success, an
   `AppError` failure, a cache hit, and a refusal by the concurrency gate (a
   capacity signal that dl-52 needs). **Not** a refusal by the per-client
   rate-limit bucket. That measures one client, not the tool, and a flood of
   those rows would bury the ones that matter.
5. **Recording must never fail a probe or a job.** Wrap the write, log a `warn`
   and carry on, the same stance the orchestrator takes on persisting a preview
   image.
6. **Retention.** Add `OUTCOME_RETENTION_DAYS` (default 90) and prune in
   `runRetentionSweep`. The rows carry no address and no path, so the limit is
   about size, not privacy.
7. **The report.** An entry point in `api/src` (for example `report.ts`) that
   opens the database **read-only**, so it cannot contend with the server's
   writer. It takes `--days N` and prints:
   - probe success rate, overall and per winning resolver
   - the hosts that fail most, with their codes and the tiers attempted
   - p50 and p95 probe duration per resolver
   - download success rate and the job error codes that end the rest
   - p50 download duration

   Because it lives in `api/src`, it ships in the image with no change to
   the Dockerfile's workspace list. On the host it runs as
   `docker compose exec downloader node dist/report.js --days 7`. Document that
   under "Operating it" in `docs/02-DEPLOYMENT.md`.

8. Add `OUTCOME_RETENTION_DAYS` to `.env.example` and the architecture's
   settings table.

## Done when

- A migration test takes a fresh database and one at migration 4 to migration
  5, and both have the table and the `jobs.host` column.
- Tests prove one `probe_outcomes` row each for a success, a failure (with each
  attempt's resolver, code and duration), a cache hit, and a concurrency-gate
  refusal. They also prove no row for a per-client rate-limit refusal.
- A test submits a URL with a path and a `?sig=` query string and proves no
  `probe_outcomes` or `jobs.host` value contains either, or the client address.
- A test proves a failing outcome write leaves the probe's response unchanged.
- A retention test with a controlled clock prunes rows older than
  `OUTCOME_RETENTION_DAYS` and keeps newer ones.
- A report test against a seeded database prints the expected rates and
  percentiles.
- `npm run check` and `npm test -- --project downloader` are green.
- `docker compose exec downloader node dist/report.js --days 1` runs inside the
  built image. This is `unproven (gate)` until the container build runs.

## Log

- 2026-09-13 — Filed. The facts under Why were read on `origin/main`
  `1835657`, not measured.
