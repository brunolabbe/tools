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
   `docker compose exec downloader node tools/downloader/api/dist/report.js --days 7`
   — the full path from `/app`, the container's `WORKDIR`, which `docker
compose exec` inherits since neither compose file sets its own
   `working_dir`; `dist/report.js` alone resolves to a path that does not
   exist. Document that under "Operating it" in `docs/02-DEPLOYMENT.md`.

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
- `docker compose exec downloader node tools/downloader/api/dist/report.js --days 1`
  runs inside the built image. This is `unproven (gate)` until the container
  build runs.

## Review

**Gate: FAIL** — 2026-09-14 · `95c6403...790c17b` · defect hunt run by the gate itself (ticket-reviewer, Opus) at medium · phase 1 of 2 (dl-57's own content; the rebase onto dl-51 is gated separately)

| Done when                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration test takes a fresh database and one at migration 4 to migration 5; both have the table and `jobs.host`                                                | `tools/downloader/api/test/schema.test.ts@790c17b:27 "gets probe_outcomes and jobs.host from one migrate() pass"` ✓ · `tools/downloader/api/test/schema.test.ts@790c17b:50 "gets the same table and column from the remaining migrate() pass"` ✓. Mutation (ALTER removed) turns 66/66 red. Also verified by hand on a migration-4 file database with 4 `jobs` rows: `user_version` 4→5, every old row `host` NULL; the report does not read `jobs.host`                                                                                                                                                                                                                                                                                                                                                    |
| One `probe_outcomes` row each for success, failure (each attempt's resolver, code, duration), cache hit, gate refusal; none for a per-client rate-limit refusal | success `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:24-34 "toBeGreaterThanOrEqual(0)"` ✓ · failure `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:70 "expect(rows[0]?.attempts).toEqual(["` ✓ · cache `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:96 "cached: true, durationMs: 0"` ✓ · gate `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:141 "const refusal = rows.find((row) =>"` ✓ · none per-client `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:163-169 "expect(refused.statusCode).toBe(429)"` ✓. Each recording site mutated away alone turns its own spec red, and so does adding a row in the bucket hook. Failure clause holds for a terminal error; a deadline/cancel failure drops the tier that ran out the clock — med below |
| Path + `?sig=` never in `probe_outcomes` or `jobs.host`, nor the client address                                                                                 | `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:188 "const serialized = JSON.stringify(row);"` ✓ · `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:237 "harness.app.context.store.jobHost(jobId)"` ✓ · client address structurally, no column can hold it: `tools/downloader/api/test/job-store.test.ts@790c17b:481 "expect(Object.keys(row as object).toSorted()).toEqual("` ✓ (low below). `host = url.href` → 3 red; `jobs.host` = source URL → 3 red                                                                                                                                                                                                                                                                                                                                |
| A failing outcome write leaves the probe's response unchanged                                                                                                   | `tools/downloader/api/test/probe-outcomes.test.ts@790c17b:214 "expect((response.json() as { cached: boolean }).cached).toBe(false)"` ✓. Wrapper made to rethrow → that spec red                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Retention test with a controlled clock prunes rows older than `OUTCOME_RETENTION_DAYS` and keeps newer ones                                                     | **unproven** — `tools/downloader/api/test/job-store.test.ts@790c17b:497 "pruneProbeOutcomes drops rows older than the cutoff"` passes a literal cutoff; no clock, no setting. The arithmetic at `tools/downloader/api/src/server.ts@790c17b:730-735 "const outcomesPruned ="` survives days→hours, never-prune and an inverted zero guard (0 red each)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Report test against a seeded database prints the expected rates and percentiles                                                                                 | **unproven** — no test exists (the builder reported this gap itself)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check` and `npm test -- --project downloader` green                                                                                                    | **verified** — `npm run check` exit 0; `npm test -- --project downloader` exit 0, 77 files / 1284 tests. Base suite not re-run: +19 reconciles against the 19 tests the diff adds (probe-outcomes 8, schema 2, job-store 6, registry 3). Two existing assertions changed: registry `durationMs` added, job-store `user_version` 4→5; neither weakened                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docker compose exec downloader node dist/report.js --days 1` runs inside the built image                                                                       | **unproven (gate)** — and as written it cannot pass: see the high below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- **high** · `docs/02-DEPLOYMENT.md@790c17b:491 "docker compose exec downloader node dist/report.js --days 7"` and `tools/downloader/api/src/report.ts@790c17b:10 "docker compose exec downloader node dist/report.js --days 7"` (copied from the brief's Build 7 and its last Done-when line) name a path that does not exist in the image. The runtime stage's working directory is /app and the api dist lands at `tools/downloader/Dockerfile@790c17b:152 "tools/downloader/api/dist/main.js"`'s directory, so `node dist/report.js` resolves to `/app/dist/report.js`. Reproduced from the repo root (the /app layout): MODULE_NOT_FOUND, exit 1; `node tools/downloader/api/dist/report.js --days 1` prints the report, exit 0. No Docker daemon here, so not run in a container. An operator following the doc gets a stack trace. Fix: full path (recommended, matches CMD), or `exec -w /app/tools/downloader/api`.
- **med** · retention Done-when unproven (row above): nothing fails if `OUTCOME_RETENTION_DAYS` is read as hours, ignored, or its 0 guard is inverted.
- **med** · report Done-when unproven (row above): `buildReport`/`formatReport` have no test.
- **med** · `tools/downloader/resolvers/src/registry.ts@790c17b:116-125 "const error = AppError.from(cause);"` — `abortIfNeeded` throws before the attempt is pushed, so the tier the deadline or a cancel cut off never enters `attempts`. Reproduced: a `direct` miss then a hanging `browser` with `timeoutMs: 150` throws TIMEOUT with attempts `[{direct, NO_MEDIA_FOUND, 0}]`; a caller abort gives the same. A TIMEOUT row, and the report's "tried …" list for that host, omit the expensive tier the ticket's Why wants timed.
- **low** · `tools/downloader/api/src/report.ts@790c17b:128 "Math.floor(p * sorted.length)"` is upper-rank: p50 of [100,200,300,400] prints 300, and p50 of two downloads is the larger. Pin the definition in the report test.
- **low** · `tools/downloader/api/src/report.ts@790c17b:333 "if (import.meta.url === "` compares against a hand-built `file://` string. Run through a symlink, the report prints nothing and exits 0. Not live at the image path.
- **low** · two observations, one mechanism (host stored as `url.hostname` verbatim): an IP-literal page URL stores an address (`93.184.215.14`, `[2606:4700:4700::1111]`; `http://1572395278/` → `93.184.217.14`), so the "never … an address" wording in probe-outcomes.ts, `.env.example`, 01-ARCHITECTURE and 02-DEPLOYMENT is untrue there. It is the target's address, not the client's, so the Done-when holds. `site.example.` groups apart from `site.example`. Userinfo, port, IDN (punycode) and case are handled.
- **low** · the client-address clause is proven only structurally; the job-host spec's title claims "or an address" and asserts nothing about one.
- **open decision** (to the orchestrator) · guard-stage exits get no row: INVALID_URL, BLOCKED_TARGET, UNREACHABLE (`tools/downloader/api/src/ssrf.ts@790c17b:252 "That address could not be resolved."`), all thrown before `host` exists at `tools/downloader/api/src/routes/probe.ts@790c17b:50 "const url = await context.guard.assertAllowed(rawUrl);"`. Build 4 says "every way out" and "an AppError failure"; the Why asks "which sites fail". The builder's "no host" holds only for an unparseable URL.
- **open decision** (to the orchestrator) · a client that navigates away aborts the probe (`tools/downloader/api/src/routes/probe.ts@790c17b:84 "controller.abort(new AppError("`), recorded as CANCELED and counted as a failure in the probe success rate and in "hosts that fail most". dl-53 owns disconnect semantics for downloads; nothing names it for probes.
- **dropped** · `duration_ms` includes the output SSRF vet and the thumbnail capture, not only resolver time; "probe duration per resolver" reads as the whole probe, and `attempts_json` holds per-tier time. A reading, not a defect.
- **dropped** · a second row if `reply.send` threw after the success row was written; not reachable in practice.
- **dropped** · the guard admits `2001:db8::/32` (documentation prefix); pre-existing, outside the reviewed range.
- **dropped** · `details.url` (full href) on the registry's NO_MEDIA_FOUND error is pre-existing and dl-58's sweep; the new `attempts` entries carry only resolver, code and duration.
- **dropped** · `OUTCOME_RETENTION_DAYS` of -5 parses to 0 (keep every row) and `abc` to 90, the same `int(…, { min: 0 })` stance as the rate-limit siblings.
- **findings** · hunt returned 16; 11 carried in 10 bullets (1 high, 3 med, 5 low in 4 bullets, 2 open decisions), 5 dropped.
- Also run · `citations-gate.mjs --against origin/main` exit 1, one record failing (`repo-33`, expected before the dl-51 rebase); dl-43 and dl-46 pins spot-checked with `citations.mjs --rev origin/main`, exit 0 each. `packages/core/test/image-closure.test.ts` 7/7; the Dockerfile copies `api/dist`, so `report.js` ships.
- NFR: security ✓ (no path, query or credential reaches a row or the new warn line; mutations confirm) · performance ✓ (indexed `created_at`, synchronous single-row insert) · reliability — med above (attempts on abort) · maintainability — lows above.

**Disclosure note (builder, 2026-09-14, after this gate):** the block above is
`a2c458af8634d9e1b`'s verbatim phase-1 verdict against `790c17b`, committed
unedited as instructed. Since that commit, the same branch fixed the **high**
(both doc/comment references and the ticket's own Build/Done-when text now use
the full path, per the orchestrator's ruling) and all four **med** findings
(retention now has a clock-driven test at `tools/downloader/api/test/probe-outcomes.test.ts`'s
"probe_outcomes retention" block, mutation-tested by hand against the three
mutations the reviewer named, all three turn it red; the report now has a
seeded-database test at `tools/downloader/api/test/report.test.ts`, also
mutation-tested by hand; the registry now pushes an attempt with the abort's own
code before throwing, with two new registry tests for the deadline and the
cancel case), plus the **low** findings on the percentile definition (pinned to
nearest-rank, documented and tested), the symlink/`import.meta.url` check
(replaced with `realpathSync` + `pathToFileURL`, reproduced fixed through an
actual symlink), and the job-host/probe_outcomes address assertions (both specs
now assert `127.0.0.1` — `inject()`'s default remote address — is absent, not
just structurally implied). **Not touched**, on the orchestrator's explicit
hold: the two open decisions (guard-stage exits, CANCELED probes as failures)
and finding 7 (IP-literal hostnames) — the owner has not yet answered. No
rebase onto dl-51 attempted. New sha and mutation results reported to the
reviewer directly; this note is for whoever reads the record without that
exchange in front of them.

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
  75 files, 1265 tests). `docker compose exec downloader node
tools/downloader/api/dist/report.js` is **unproven (gate)** — the container
  build did not run here, per the ticket. **Correction:** the command as
  originally written here and in the brief (`node dist/report.js`, no path
  prefix) cannot run in the built image — the runtime stage's `WORKDIR` is
  `/app` and `dist/report.js` alone resolves to a path that does not exist.
  Fixed everywhere it appeared (this file, `docs/02-DEPLOYMENT.md`,
  `report.ts`'s own usage comment) to the full path from `/app`. Found by the
  gate, not by me; see the Review section and its disclosure note above for
  the reproduction.

- 2026-09-14 — Gate round 1 (`a2c458af8634d9e1b`, phase 1 of 2): **FAIL**,
  1 high + 4 med + 5 low findings in 4 bullets, 2 open decisions held for the
  orchestrator, 5 dropped. Fixed on this branch, same day: the high (report
  path, see the correction above), all four med (retention now has a
  clock-driven, mutation-tested test; the report now has a seeded-database
  test, also mutation-tested; `ResolverRegistry` now records the tier a
  deadline or a cancel cuts off, with two new registry tests), and three of
  the five low findings (the percentile method is now nearest-rank, pinned and
  tested; `report.ts`'s direct-invocation check now survives a symlink; the
  job-host and probe_outcomes specs now assert the client's own address is
  absent, not just implied). Not touched: the two open decisions, and finding
  7 (an IP-literal page URL stores an address, which the gate itself judged
  the Done-when still holds against) — all three on explicit hold from the
  orchestrator, pending the owner. No rebase onto dl-51 attempted; none
  authorized yet. Verified after the fixes: `npm run check` clean;
  `npm test -- --project downloader` — 78 files, 1297 tests, all green;
  `node scripts/citations-gate.mjs --against origin/main` — unchanged at 1
  failing record (`repo-33`, not mine to touch).
