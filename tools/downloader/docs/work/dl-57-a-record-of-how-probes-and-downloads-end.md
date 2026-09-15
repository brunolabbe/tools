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

### Phase 1, round 1 — `790c17b`

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
`a2c458af8634d9e1b`'s phase-1 verdict against `790c17b`. **Altered**: every
`file:line` citation in it was re-pinned to `@790c17b` (the commit it reviewed,
per `records.md`'s gate-record pinning convention — my later fixes on this same
branch moved lines in the files it cites). Nothing else in the block was
changed. Since that commit, the same branch fixed the **high** (both
doc/comment references and the ticket's own Build/Done-when text now use the
full path, per the orchestrator's ruling) and all three **med** findings
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

### Phase 1, round 2 — `7b0cdcb`

**Gate: CONCERNS** — 2026-09-14 · `95c6403...7b0cdcb` (fixes in `790c17b..7b0cdcb`) · defect hunt run by the gate itself (ticket-reviewer, Opus) at medium · still phase 1; the rebase onto dl-51 is gated separately

| Done when                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration test takes a fresh database and one at migration 4 to migration 5; both have the table and `jobs.host`                                                | `tools/downloader/api/test/schema.test.ts:27 "gets probe_outcomes and jobs.host from one migrate() pass"` ✓ · `tools/downloader/api/test/schema.test.ts:50 "gets the same table and column from the remaining migrate() pass"` ✓ — unchanged since round 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| One `probe_outcomes` row each for success, failure (each attempt's resolver, code, duration), cache hit, gate refusal; none for a per-client rate-limit refusal | success `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:39-49 "toBeGreaterThanOrEqual(0)"` ✓ · failure `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:85 "expect(rows[0]?.attempts).toEqual(["` ✓ · cache `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:111 "cached: true, durationMs: 0"` ✓ · gate `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:156 "const refusal = rows.find((row) =>"` ✓ · none per-client `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:178 "expect(refused.statusCode).toBe(429)"` ✓. A tier cut off by the deadline or a cancel is now named: `tools/downloader/resolvers/test/registry.test.ts:259 "the tier the deadline cuts off is still named"` ✓ · `tools/downloader/resolvers/test/registry.test.ts:281 "the tier a caller cancel cuts off is named with CANCELED"` ✓; removing the abort-branch push turns both red |
| Path + `?sig=` never in `probe_outcomes` or `jobs.host`, nor the client address                                                                                 | `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:203 "const serialized = JSON.stringify(row);"` ✓ · client address now asserted: `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:207 "default remote address — `host` is computed from the"` ✓ and `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:262 "expect(host).not.toBe("` ✓. `host = request.ip` turns the signed-URL spec red                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A failing outcome write leaves the probe's response unchanged                                                                                                   | `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:232 "expect((response.json() as { cached: boolean }).cached).toBe(false)"` ✓ — unchanged since round 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Retention test with a controlled clock prunes rows older than `OUTCOME_RETENTION_DAYS` and keeps newer ones                                                     | `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:270 "a controlled clock prunes rows older than OUTCOME_RETENTION_DAYS"` ✓ · `tools/downloader/api/test/probe-outcomes.test.ts@7b0cdcb:291 "0 disables pruning entirely"` ✓. Days→hours, never-prune and the inverted zero guard each turn a spec red (1, 1, 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Report test against a seeded database prints the expected rates and percentiles                                                                                 | `tools/downloader/api/test/report.test.ts@7b0cdcb:203 "expect(report.probes.total).toBe(9)"` ✓ · `tools/downloader/api/test/report.test.ts@7b0cdcb:229 "cache hits excluded, nearest-rank"` ✓ · `tools/downloader/api/test/report.test.ts@7b0cdcb:252 "expect(report.downloads.p50DurationMs).toBe(60_000)"` ✓ · probe window `tools/downloader/api/test/report.test.ts@7b0cdcb:258 "expect(withoutFilter?.successes).toBe(5)"` ✓ · text `tools/downloader/api/test/report.test.ts@7b0cdcb:269 "success rate: 75.0% (6/8 attempted"` ✓. Eight report mutations red (window with its parameter kept, percentile rank, gate string, cache exclusion, gate-in-failing-hosts, rate precision); the job-side window is not pinned — low below                                                                                                                                                                     |
| `npm run check` and `npm test -- --project downloader` green                                                                                                    | **verified** — `npm run check` exit 0; `npm test -- --project downloader` exit 0, 78 files / 1297 tests; +13 over round 1 reconciles against report.test.ts 9 + retention 2 + registry 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docker compose exec downloader node tools/downloader/api/dist/report.js --days 1` runs inside the built image                                                  | **unproven (gate)** — command now matches the image layout (`docs/02-DEPLOYMENT.md:494 "docker compose exec downloader node tools/downloader/api/dist/report.js --days 7"`); its node half run from the repo root prints the report, exit 0. No Docker daemon here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **resolved from round 1** · the high (report path), all three med (retention, report test, attempts on abort), and three low findings (percentile now nearest-rank at `tools/downloader/api/src/report.ts@7b0cdcb:141 "const rank = Math.max(1, Math.ceil(p * sorted.length));"`, direct-invocation check at `tools/downloader/api/src/report.ts@7b0cdcb:354 "function isMainModule(): boolean"` now prints through a symlink, the client-address clause now asserted). Each is re-run above, not taken from the builder's report.
- **held from round 1** · finding 7 (IP-literal page URL stores an address; `site.example.` groups apart) and both open decisions (guard-stage exits get no row; CANCELED probes counted as failures) — on the orchestrator's hold, pending the owner.
- **low** · two findings, one mechanism: the report's job window at `tools/downloader/api/src/report.ts@7b0cdcb:222 "WHERE finished_at IS NOT NULL AND finished_at >= ?"` is unpinned. Ignoring the window with its parameter kept, or admitting unfinished jobs, leaves all 104 specs green, because every seeded job is finished and inside the window.
- **low** · the builder's disclosure note calls the round-1 block "committed unedited", but every citation in it was re-pinned to `@790c17b`. The re-pin is right; the note has to name it.
- **low** · the disclosure note ("all four med") and the Log's gate-round-1 entry ("1 high + 4 med") miscount round 1: the gate carried 1 high and 3 med. The note's own list names three.
- **dropped** · `let clock` in both retention specs is never reassigned; style only, `npm run check` passes.
- **findings** · round 2 returned 5; 4 carried in 3 bullets, 1 dropped. The `resolved` and `held` lines are round-1 carry, not new findings.
- Also run · the corrected report command's node half from the repo root, and through a symlink, both print, exit 0. `citations.mjs` on this record, anchors required and distinct: 21/21, exit 0 (before this subsection). `citations-gate.mjs --against origin/main` exit 1 on `repo-33` only, expected before the dl-51 rebase.
- NFR: security ✓ (no URL, path or client address reaches a row; mutation A1 red) · performance ✓ · reliability ✓ (aborted tiers recorded) · maintainability — lows above.

**Disclosure note (builder, 2026-09-15, after round 2):** the `### Phase 1,
round 1 — 790c17b` heading above and this `### Phase 1, round 2 — 7b0cdcb`
heading are both `a2c458af8634d9e1b`'s — it asked for the first to be added
retroactively and wrote the second itself; committed as given. Took all three
lows it offered:

- **Job-side window, now pinned.** `report.test.ts`'s seed gained a job
  finished ten days before the window and a job still running (no
  `finished_at` at all), plus a new test,
  `tools/downloader/api/test/report.test.ts:285 "a job outside the window, or still unfinished, is never counted"`.
  Reproduced the reviewer's P2 (window ignored, bound parameter kept) against
  this new seed: 3 red. **P3 (dropping `finished_at IS NOT NULL`) is verified
  unobservable, not fixed** — SQLite treats a NULL compared with the
  greater-or-equal operator as NULL, never true, so a `finished_at IS NULL`
  row already fails the plain comparison with no explicit null check at all.
  No seed and no assertion can turn that mutation red; the clause is worth
  keeping for what it tells a reader, not for behaviour a test can pin. The
  reviewer confirmed this reading independently on the round-2 gate; recorded
  here as "verified unobservable" rather than claimed fixed.
- **Wording, both corrected in place** (not as new prose here, since the
  wrong words were already committed): the round-1 disclosure note above now
  says "Altered" and names the re-pin explicitly, and both the note and the
  Log's gate-round-1 entry now say "1 high + 3 med".

New sha and the P3 finding reported to the reviewer directly.

### Phase 2 — the rebase onto dl-51 `2e8aa7b` and the owner's decisions · `c64defb`

**Gate: CONCERNS** — 2026-09-15 · `2e8aa7b...c64defb` (dl-57 rebased onto dl-51; `2e8aa7b` is `6045f80` plus one dl-51 record commit) · defect hunt run by the gate itself (ticket-reviewer, Opus) at medium · scoped to the rebase, decisions A–C and the round-2 lows; phase-1 ground not re-gated

| Phase-2 check                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dl-51 per-client probe-cap refusal writes no row, and releases nothing it never held | refusal thrown before any try, at `tools/downloader/api/src/routes/probe.ts:155 "const clientReleaseProbe = context.probeClientGate.tryAcquire"` · `tools/downloader/api/test/probe-outcomes.test.ts:316 "records no probe_outcomes row, and still releases its client slot"` ✓ · `tools/downloader/api/test/probe-outcomes.test.ts:363 "expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(0)"` ✓. Writing a row in that refusal turns the spec red                                                                                                                                                                                                                                                                                                                                                                                          |
| A global concurrency-gate refusal still writes one                                     | phase-1 gate spec still red when that row is removed (1 red) ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The per-client slot is released on every path, including when the outcome write throws | `tools/downloader/api/src/routes/probe.ts:289 "clientReleaseProbe();"` in the outer `finally` ✓ — **verified** with a temporary spec, not committed: outcome writes forced to throw on the success, resolver-failure, gate-refusal and guard-stage paths, slot count 0 on all four. Deleting the release turns 3 of those red (guard-stage never acquires) and 4 committed specs red. With the wrapper made to rethrow, only the status assertions fail; the slot assertions before them pass                                                                                                                                                                                                                                                                                                                                                                         |
| Record conflicts keep a valid pin; citation gate exits 0                               | `citations.mjs --rev origin/main` exit 0 on dl-32 and on dl-46 (both `routes/probe.ts@95c6403` pins resolve); dl-51's `tools/downloader/api/src/config.ts@95c6403:215 "or better, to the"` re-pin resolves; `citations-gate.mjs --against origin/main` exit 0, 75 enforced, 0 failing — **verified**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Decision A: UNREACHABLE and BLOCKED_TARGET get a row; unparseable input none           | `tools/downloader/api/src/routes/probe.ts:66 "const guardHost = hostnameOrNull(rawUrl);"` · `tools/downloader/api/test/probe-outcomes.test.ts:372 "BLOCKED_TARGET records a row, host masked as an IP literal"` ✓ · `tools/downloader/api/test/probe-outcomes.test.ts:402 "UNREACHABLE records a row with the guard"` ✓ (live DNS — low below) · `tools/downloader/api/test/probe-outcomes.test.ts:431 "an unparseable URL never reaches the guard"` ✓. Dropping the row: 2 red; dropping either code: 1 red each                                                                                                                                                                                                                                                                                                                                                     |
| Decision B: CANCELED excluded from the probe success rate and failing hosts, row kept  | `tools/downloader/api/test/report.test.ts:331 "are counted separately, and excluded from attempted"` ✓. CANCELED back in `attempted`: 1 red; back in failing hosts: 1 red                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Decision C: a fixed marker for every IP-literal host, trailing dot normalised          | route `tools/downloader/api/test/probe-outcomes.test.ts:449 "stores the marker, not the address"` ✓ · `tools/downloader/api/test/probe-outcomes.test.ts:472 "a trailing FQDN dot does not group a host apart from itself"` ✓ · unit `tools/downloader/api/test/host.test.ts:18 "masks a bracketed IPv6 literal"` ✓ · `tools/downloader/api/test/host.test.ts:22 "removes exactly one trailing FQDN dot"` ✓. Raw hostname at the route: 2 red; at the guard stage: 1 red; no bracket strip: 1 red; dot kept: 2 red. **`jobs.host` unproven** — med below. 25 spellings through the real guard, including octal, hex, decimal, short-form, percent-encoded and fullwidth IPv4, and link-local and ULA IPv6: every IP literal stores `ip-literal`; `localhost`, `127.0.0.1.nip.io` and `metadata.google.internal` store themselves, which is the cost Decision A records |
| Decisions recorded as answered                                                         | ticket `## Decisions — answered 2026-09-15, not open`: question, options, owner's choice, accepted cost and what was built, for each of A, B, C; the marker spelling is marked as the builder's choice ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Round-2 lows                                                                           | job window: `tools/downloader/api/test/report.test.ts:285 "a job outside the window, or still unfinished"` ✓, window ignored with its parameter kept → 3 red; dropping `IS NOT NULL` → 0 red, an equivalent mutant (`NULL >= ?` is never true), recorded as verified unobservable ✓ · disclosure note names the re-pin ✓ · counts read 1 high + 3 med ✓ · no line starts with a blockquote marker ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check` and `npm test -- --project downloader`                                 | **verified** — `npm run check` exit 0; suite exit 0, 80 files / 1339 tests. 1339 = 1265 base + 26 dl-51 (its record: 1291) + 33 dl-57 through round 3 + 15 this round (host 8, probe-outcomes 6, report 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **med** · `tools/downloader/api/src/db/job-store.ts:303 "host: hostnameOrNull(input.sourceUrl),"` — Decision C's masking of `jobs.host` is not tested. Replacing it with `new URL(input.sourceUrl).hostname` leaves 85/85 specs green, so a job for `http://93.184.215.14/x` could store the address with nothing going red.
- **low** · the UNREACHABLE spec makes a live DNS query; `CreateAppOptions` has no lookup seam. It passes on NXDOMAIN and on blocked DNS alike, and would fail only behind a resolver that hijacks NXDOMAIN.
- **dropped** · a BLOCKED_TARGET row can hold a DNS name that spells an internal address (`127.0.0.1.nip.io`) or an internal name (`localhost`, `metadata.google.internal`): the accepted cost Decision A records.
- **dropped** · the guard-stage rows are written before the per-client probe cap is consulted; they are bounded by the per-minute bucket in front, and the dl-51/dl-57 agreement concerns refusals, not guard exits.
- **dropped** · the `IS NOT NULL` mutation survives: an equivalent mutant, not a gap.
- A pre-existing issue outside this branch's range was escalated to the orchestrator.
- **findings** · phase 2 returned 6; 2 carried, 3 dropped, 1 escalated as a pre-existing defect outside the range.
- NFR: security ✓ (no IP literal, path, query or client address reaches a row by any spelling tried) · performance ✓ · reliability ✓ (slot released on every path, write failure included) · maintainability — the med above.

**Disclosure note (builder, 2026-09-15, after phase 2):** committed with one
class of edit beyond the reviewer's own text — on the orchestrator's
instruction, relayed by the reviewer, every reference to the pre-existing
issue escalated below was reduced to the single acknowledgement line the
block now carries; this note does not describe that issue either, by the
same instruction. Reproduced the med finding first: mutated the `host` field
the med bullet above cites to `new URL(input.sourceUrl).hostname`, ran the
five specs named
(`probe-outcomes.test.ts`, `report.test.ts`, `host.test.ts`,
`job-store.test.ts`, `per-client-caps.test.ts`) — 85/85 green, matching the
reviewer exactly. Fixed with one new test,
`tools/downloader/api/test/job-store.test.ts`'s "masks an IP-literal source
URL's host, dl-57 decision C" — reproduced the same mutation against it
before restoring: 1 red. Took the low's recommendation (b): the UNREACHABLE
spec keeps its live DNS query rather than widening `CreateAppOptions` with a
lookup seam only one spec would use.

## Decisions — answered 2026-09-15, not open

Three questions the phase-1 gate raised as open decisions, put to the owner by
the orchestrator quoting this ticket (Build step 4 at line 74, the Why at line
28, Build step 2 at line 67). All three are answered and built on this branch;
the reasoning below is what the next agent should read instead of re-opening
any of them.

### A — do guard-stage exits (before a resolver ever runs) get a row?

**The question:** `INVALID_URL`, `UNREACHABLE` and `BLOCKED_TARGET` can all be
thrown by `context.guard.assertAllowed(rawUrl)`, before `routes/probe.ts` had
declared `host` at all — so none of them got a `probe_outcomes` row as
originally built, even though Build step 4 says "every way out" and the Why
asks "which sites fail".

**Options the gate put forward:** (1) record `UNREACHABLE` and
`BLOCKED_TARGET` with the guard's parsed hostname, and leave an unparseable
`INVALID_URL` with none — the gate's recommendation; (2) keep the built
behaviour, no row for any of the three; (3) record all three, with an empty
host on the unparseable case.

**The owner took (1).** `UNREACHABLE` and `BLOCKED_TARGET` are thrown only
after the guard's own `new URL(rawUrl)` succeeded, so a hostname genuinely
exists to attach a row to; `INVALID_URL` from a schema-rejected body has none.
**Accepted cost:** a `BLOCKED_TARGET` row can hold an internal hostname a page
pointed at (`internal.corp`, say) — decision C is the part of the answer that
keeps a literal address out of it, not this one.

**Built:** `routes/probe.ts` wraps `context.guard.assertAllowed(rawUrl)` in a
`try`/`catch` that records a row for exactly those two codes, using
`hostnameOrNull(rawUrl)` (`host.ts`) to re-derive the hostname the guard must
already have parsed. In practice `INVALID_URL` never reaches this route at
all — `probeRequestSchema`'s `sourceUrlSchema` already runs `new URL()` and
checks the scheme before the handler is entered, so the guard's own
`INVALID_URL` branches are unreachable from here and exist for its other
callers (the orchestrator's re-probe, resolver-output vetting). Tests:
`tools/downloader/api/test/probe-outcomes.test.ts`'s "guard-stage exits"
block — one spec each for `BLOCKED_TARGET` (a literal blocked IP, no DNS
needed), `UNREACHABLE` (a real lookup against a `.invalid` hostname, which
RFC 2606 guarantees never resolves), and the unparseable case (asserts zero
rows, proving the schema catches it first).

### B — do CANCELED probes count as a failure?

**The question:** a client navigating away aborts the probe
(`routes/probe.ts`'s `close` listener), which the registry records as
`CANCELED`. Built, this was an ordinary row: counted in `attempted`, and
counted against a host in "hosts that fail most" if it had run past resolving.

**Options:** (1) keep the row, but exclude `CANCELED` from the probe
success-rate denominator and from "hosts that fail most" — the same treatment
`RATE_LIMITED` gate refusals already get, and the gate's recommendation; (2)
count it as a failure, and leave the distinction to dl-53 (which owns
disconnect semantics for downloads, not probes).

**The owner took (1).** A visitor's own choice to leave is not evidence the
tool failed, and dl-53 does not cover probes at all — nothing else was going
to draw this line for the probe case.

**Built:** `report.ts`'s `Report.probes` gained a `canceled` count alongside
`gateRefusals`; `attempted = total - gateRefusals - canceled`; `CANCELED` is
excluded from `topFailingHosts` the same way `RATE_LIMITED` already was;
`formatReport` prints the count ("N canceled by the visitor"). The row itself
is unchanged — a `CANCELED` outcome still carries whatever tier the registry
had reached, per the round-1 med fix. Test:
`tools/downloader/api/test/report.test.ts`'s "CANCELED probes (dl-57 owner
decision B)" block.

### C — what does a probe_outcomes or jobs.host row store for an IP-literal page URL?

**The question:** `url.hostname` is stored verbatim. For a page URL whose
host is itself an IP literal — `http://93.184.215.14/`, an IPv6 literal, or a
numeric form the WHATWG URL parser canonicalises into one of those two before
`.hostname` is ever read — the stored value is an address, which is exactly
what Build step 2 and every piece of documentation this ticket touched say
never happens. A trailing FQDN dot (`site.example.`) was a related, smaller
finding: it groups a host apart from the same host written without one.

**Options:** the gate made no recommendation. (1) store the address and
correct the "never an address" wording everywhere it appears instead; (2)
store a fixed marker in place of any IP-literal host, on every row —
`BLOCKED_TARGET` included, since decision A now lets that code carry a host
at all; (3) mask only rows that are already `BLOCKED_TARGET`, leaving a
successful IP-literal probe to store the real address.

**The owner took (2).** It is the only option that keeps Build step 2's
"never store an address" literally true, which is what every downstream
document (`.env.example`, `01-ARCHITECTURE.md`, `docs/02-DEPLOYMENT.md`)
already asserts on the strength of that step — (1) would mean rewriting all
of them, and (3) leaves the successful case exposed, which is the more common
one, not the rarer one.

**Marker spelling — my choice, not the owner's or the gate's:** one constant,
`"ip-literal"` (`host.ts`'s `IP_LITERAL_HOST`), rather than separate
`ip-literal-v4`/`ip-literal-v6` markers. The report already groups this
bucket as "not a real hostname", and an operator who wants the IP-version
split for the few rows that land here has `probe_outcomes.attempts_json` and
the raw address logs `redactUrl` already covers elsewhere — a second marker
pair would buy a distinction the report never surfaces today, for a cost paid
on every row. If a future ticket wants the split, it is a report-level
grouping change, not a storage-format one, since nothing here is lost.

**Built:** `host.ts` (new) exports `normalizeHost(hostname)` — masks any
`net.isIP`-recognised literal (v4 or bracketed v6) to `IP_LITERAL_HOST`, and
strips exactly one trailing FQDN dot — and `hostnameOrNull(rawUrl)`, which
parses and normalises in one step, returning null only when `rawUrl` will not
parse as a URL at all. Both `routes/probe.ts` (the `host` a `probe_outcomes`
row carries, and decision A's guard-stage catch) and
`db/job-store.ts`'s job creation (`jobs.host`) now go through it — `job-store.ts`'s
previous private `hostnameOf` helper was deleted in favour of the shared one,
since the two had become the same function with the same gap. Tests:
`tools/downloader/api/test/host.test.ts` (unit-level: ordinary hostnames,
IPv4, bracketed IPv6, the already-canonicalised numeric-form case, the
trailing dot, and the unparseable-string case) and
`tools/downloader/api/test/probe-outcomes.test.ts`'s "IP-literal hosts never
reach a row as themselves" block (route-level: a successful probe against a
literal-IP page URL stores the marker and never the address anywhere in the
row; a trailing-dot host normalises to the same string as without one).

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
  1 high + 3 med + 5 low findings in 4 bullets, 2 open decisions held for the
  orchestrator, 5 dropped. Fixed on this branch, same day: the high (report
  path, see the correction above), all three med (retention now has a
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
- 2026-09-14 — Gate round 2 (`a2c458af8634d9e1b`, phase 1 of 2): **CONCERNS**,
  every round-1 fix reproduced independently, 3 lows remaining (the report's
  job-side window unpinned; the round-1 disclosure note undercounting its own
  re-pin as "unedited"; the same note and the Log miscounting round 1 as
  "four med" against the gate's own "three med"). Took all three: `report.test.ts`
  now seeds a job finished outside the window and one still running, with a
  test pinning both are excluded — the reviewer's window-ignored mutation
  reproduces 3 red, and its NULL-check-dropped mutation reproduces as a
  genuine no-op (recorded as such, not claimed fixed); both wording errors
  corrected in place. Verified: `npm run check` clean; `npm test -- --project
downloader` — 78 files, 1298 tests; citations 46/46 verified,
  `citations-gate.mjs` unchanged (`repo-33` only).
- 2026-09-15 — Phase 2. The owner answered all three of gate round 1's held
  items (see `## Decisions` above), and dl-51 settled at `6045f80`
  (`origin/dl-51-per-client-job-cap`). In order:
  1. **Rebased** onto `origin/dl-51-per-client-job-cap` (`git rebase`, not a
     merge). One real conflict, in `routes/probe.ts`: dl-51 wraps the whole
     handler body in an outer `try`/`finally` for its per-client probe cap,
     and dl-57 had restructured the same region into a `try`/`catch`/`finally`
     with a `catch` clause dl-51's tree never had. Resolved by nesting dl-57's
     structure inside dl-51's outer `try`/`finally`, with the per-client cap
     check (and its own refusal, which throws before either `try` and so
     needs no release) ahead of everything dl-57 added. Two more conflicts
     were citation pins in `dl-32-the-job-list-has-no-caller.md` and
     `dl-46-rate-limit-the-probe-stage-channel.md`, where each branch had
     independently pinned a different one of two citations on the same
     line — resolved by taking the union, both pinned. Re-ran
     `probe-outcomes.test.ts` and `per-client-caps.test.ts` immediately after,
     before anything else: both green (30 tests). Added a new test —
     `probe-outcomes.test.ts`'s "the dl-51/dl-57 agreement" block — proving
     the agreement holds in the merged code: a per-client probe-cap refusal
     gets no `probe_outcomes` row and still releases its slot. Force-pushed
     with `--force-with-lease`.
  2. **Built the three owner decisions**, each recorded in full under
     `## Decisions` above with its question, options, choice and who
     recommended it. Summary: (A) `UNREACHABLE`/`BLOCKED_TARGET` now record a
     row via a `try`/`catch` around `context.guard.assertAllowed` in
     `routes/probe.ts`, using a re-derived hostname (`host.ts`'s
     `hostnameOrNull`) since the guard does not hand one back on failure;
     `INVALID_URL` provably never reaches that catch, because
     `probeRequestSchema` already rejects an unparseable or wrong-scheme URL
     before the route handler runs. (B) `report.ts` gained a `canceled` count,
     excluded from `attempted`, `successRate` and `topFailingHosts` exactly
     like `gateRefusals`. (C) new module `host.ts` (`normalizeHost`,
     `hostnameOrNull`) masks any IP-literal hostname to a single marker,
     `"ip-literal"`, and strips a trailing FQDN dot; wired into both
     `routes/probe.ts` and `db/job-store.ts`, which lost its own private
     `hostnameOf` in favour of the shared one. New tests: `host.test.ts`
     (unit), and three new blocks in `probe-outcomes.test.ts` and one in
     `report.test.ts`.
  3. **Gate round 2's three lows** were already fixed in the prior commit
     (`a6e9096`), and stayed fixed across the rebase — re-verified rather
     than re-done.
  4. **A citations-gate regression the rebase introduced, fixed the same
     way as the round-1 pins**: `OUTCOME_RETENTION_DAYS`'s addition to
     `config.ts` (unrelated to dl-51) shifted a pre-existing line dl-51's own
     `## Review` cited (a `TRUST_PROXY` warning, not a dl-51 defect per that
     record's own words). Pinned to `origin/main`'s `95c6403` at the line that
     text actually sits at there (`215`, not the record's un-pinned `248`,
     which was dl-51's own tip and not main) — verified with
     `node scripts/citations.mjs <record> --section Review --require-anchors
--require-distinct-anchors`, exit 0, before trusting it.
  5. **Also folded in**, per the reviewer's ask on the prior round's commit:
     a markdown blockquote artefact in the round-2 disclosure note (oxfmt read
     a wrapped line starting with `>= ?` as a blockquote marker) — rephrased
     to avoid the symbol at a line start, confirmed gone with
     `grep -n "^  > "`.

  Verified after all of the above: `npm run check` clean; `npm test --
project downloader` — 80 files, 1339 tests, all green; citations on this
  record 46/46 verified (`--require-anchors --require-distinct-anchors`);
  `node scripts/citations-gate.mjs --against origin/main` — exit 0, `repo-33`
  no longer failing (its pin arrived with dl-51). Sent the new sha to the
  reviewer and said phase 2 is ready. Ship authority: none — stopped before
  the pull request, as instructed.

- 2026-09-15 — Gate round 3 (`a2c458af8634d9e1b`, phase 2): **CONCERNS**, one
  med (`jobs.host` never tested for IP-literal masking — decision C's route
  and guard-stage rows were, `jobs.host` was not) and one low (the
  UNREACHABLE spec makes a live DNS query, with no stub seam to avoid it).
  Reproduced the med first — the reviewer's exact mutation
  (`job-store.ts:303` to `new URL(input.sourceUrl).hostname`) left the five
  named specs 85/85 green — then fixed with one test in `job-store.test.ts`,
  reproduced red against the same mutation before restoring. Took the
  reviewer's recommendation on the low (keep the live query rather than widen
  `CreateAppOptions` with a lookup seam only one spec would use) rather than
  building one. A pre-existing issue outside this branch's range, unrelated
  to this branch's own changes, was escalated to the orchestrator rather than
  built here; on the orchestrator's instruction, relayed by the reviewer,
  it is not described further in this ticket. Verified: `npm run check`
  clean; `npx vitest run` on the five named specs plus the new test — all
  green; full `npm test -- --project downloader` still pending this round's
  push.
