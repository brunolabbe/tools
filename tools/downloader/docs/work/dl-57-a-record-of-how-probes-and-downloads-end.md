---
id: dl-57
tool: downloader
title: Keep a record of how each probe and download ended, and a report that reads it
kind: work-package
status: done
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

**[dl-53](./dl-53-finished-files-and-the-tunnel.md) changes what a finished
download is.** On 2026-09-14 the owner chose to stream files to the visitor
with no copy kept. A download then ends when the stream reaches its end, or
when the visitor abandons it. Whichever of the two tickets lands second counts
a visitor who disconnects as its own outcome, not as a failure. Otherwise the
download success rate measures patience instead of the tool.

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
- 2026-09-14 — Noted that dl-53's streaming makes a visitor's disconnect a
  download outcome of its own.
- 2026-09-14 — Built. Branch `dl-57-outcome-record` off `origin/main` `95c6403`.
  **dl-57 lands before dl-53.** Per the orchestrator's note at intake, the
  obligation to distinguish a visitor's disconnect from a real failure falls on
  whichever of dl-57 / dl-53 lands second — that is dl-53. This branch does not
  build streaming or disconnect semantics; a download's outcome here is still
  read straight off `jobs.status`/`error_json`, unchanged from today. The next
  builder on dl-53 should read this note before assuming the split is settled
  elsewhere.

  **What the brief had wrong or left open:**
  - `details` on `AppErrorPayload` (`@webtools/core`) is `Record<string,
unknown>` — not typed in `@downloader/contract` — so step 3's "stop and
    raise it" did not apply; proceeded without asking.
  - "Time the winning attempt too" turned out to need more than adding
    `durationMs` to the existing `details.attempts` entries (which only ever
    covers the failed-then-fell-through case). Gave `ResolverRegistry.resolve()`
    a new optional third parameter, `attempts?: ResolverAttempt[]` (mutated in
    place, one entry per candidate tried — `code: null` for the winner) so a
    caller has the full timeline on success and on failure alike, without
    reaching into an error's `details`. `ResolverAttempt` is exported from
    `@downloader/resolvers`, not `@downloader/contract` — the registry is not
    part of that tool's contract package, so this is not the kind of change
    step 3 was warning about. `resolvers/test/registry.test.ts` covers the
    out-parameter directly; the existing "lists what was tried" test gained
    `durationMs: expect.any(Number)` on each entry, which is the one place a
    pre-existing assertion had to change shape.
  - `docs/02-DEPLOYMENT.md` (repo-root, not a `tools/downloader/docs/` file) is
    what the ticket's bare `docs/02-DEPLOYMENT.md` reference meant, distinct
    from `01-ARCHITECTURE.md` a line above it, which is
    `tools/downloader/docs/`-relative. Added a "Reading the downloader's
    outcome report" subsection under its "## Operating it" heading, per the
    Build step's instruction to document it there specifically.
  - Scoping call, not a contract question: outcome recording in `routes/probe.ts`
    starts once `context.guard.assertAllowed(rawUrl)` has returned a `URL` (so a
    hostname exists to record). `INVALID_URL` (an unparseable body) and a
    guard-blocked address before that point are not recorded — there is no
    hostname to attach, and the four enumerated Done-when cases (success,
    failure, cache hit, gate refusal) all sit after that point. If the report
    should also see malformed/blocked-address attempts, that is a small,
    separate follow-up rather than a rework of this branch.
  - Report's "probe success rate, per winning resolver" reads as each
    resolver's share of successful probes (successes by that resolver ÷ total
    successes), not that resolver's own hit rate across every attempt —
    `attempts_json` has the data for the latter if a future report wants it.
    Duration percentiles per resolver exclude cache hits (recorded `durationMs:
0`), which would otherwise deflate real resolve latency.

  **dl-51 seam** (per-client job-slot cap, built concurrently by
  `aaa591c7f4b3f67c7` on an unmerged branch): agreed directly with that builder
  that its new per-client probes-in-flight refusal is per-client, not tool-wide
  capacity, and — by the same reasoning my own ticket gives for excluding the
  existing per-minute bucket — must not get a `probe_outcomes` row. On my
  current `routes/probe.ts`, that refusal is thrown before my `attempts`/
  `startedAt` declarations and outside the `try`/`catch` my recording lives in,
  so it is excluded by construction; no defensive `scope` check was added
  because nothing in my code currently reaches it. dl-51 flagged a real
  file-overlap risk: its change wraps the whole existing handler body (probe
  gate through `reply.send`) in a new outer `try`/`finally`, re-indenting the
  span my recording calls sit in — whoever merges the two branches should
  rebase/re-apply rather than line-merge that hunk. Not something either
  branch needs to fix now.

  **Citations gate.** `node scripts/citations-gate.mjs --against origin/main`
  found 8 records with citations whose line numbers this branch's edits moved
  (line-shifted, not wrong): `dl-19`, `dl-32`, `dl-34`, `dl-43`, `dl-44`,
  `dl-45`, `dl-46`, and the repo-scoped `repo-33`. Pinned the 7 `dl-*` records'
  moved citations to `origin/main`'s `95c6403` (`<file>@95c6403:<line>`, line
  and anchor text unchanged), per `.claude/skills/orchestrate-tickets/reference/records.md:93-138`
  and the repo-44 precedent. Left `repo-33` untouched — it is under
  `docs/work/repo-*`, and the orchestrator said a peer session is pinning repo
  records concurrently. Verified each pin resolves with
  `node scripts/citations.mjs <record> --section Review --rev origin/main`
  (`exit 0 — nothing to fix` on the ones checked). Gate before: 8 records
  failed, 73 enforced. Gate after: 1 record failed (`repo-33`, left for the
  peer session), 73 enforced.

  **Fold-in:** nothing else in reach was small and already specified enough to
  fold in beyond the ticket's own Build list.

  **Files:** `tools/downloader/api/src/db/schema.ts` (migration 5),
  `tools/downloader/api/src/db/job-store.ts` (`jobs.host`, `probe_outcomes`
  read/write/prune), `tools/downloader/resolvers/src/registry.ts` +
  `src/index.ts` (`ResolverAttempt`, the `attempts` out-parameter),
  `tools/downloader/api/src/probe-outcomes.ts` (new — the never-fail wrapper),
  `tools/downloader/api/src/routes/probe.ts` (records every outcome),
  `tools/downloader/api/src/config.ts` + `.env.example` +
  `tools/downloader/docs/01-ARCHITECTURE.md` (`OUTCOME_RETENTION_DAYS`),
  `tools/downloader/api/src/server.ts` (prunes `probe_outcomes` in the
  retention sweep), `tools/downloader/api/src/report.ts` (new — the read-only
  report), `docs/02-DEPLOYMENT.md` (documents running it). Tests:
  `tools/downloader/api/test/schema.test.ts` (new),
  `tools/downloader/api/test/probe-outcomes.test.ts` (new), additions to
  `tools/downloader/api/test/job-store.test.ts` (and its two migration-count
  assertions updated from 4 to 5), `tools/downloader/resolvers/test/registry.test.ts`.

  **Verification:** `npm run check` — clean. `npm test -- --project
downloader` — 77 files, 1284 tests, all green (baseline before this branch:
  75 files, 1265 tests). `docker compose exec downloader node dist/report.js`
  is **unproven (gate)** — the container build did not run here, per the
  ticket.
