---
id: repo-66
tool: repo
title: Three tools carry their own copy of the pino logger; lift the shared half into core
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-66 — Lift the shared half of the logger into `@webtools/core`

## Why

`tools/ledger/api/src/logger.ts` landed with the ledger's scaffold as the
**third** copy of the same file: the planner's was written as a near-copy of the
downloader's, and its header deferred the lift to `@webtools/core` "once this
tool's own logging needs are known". The root `CLAUDE.md` moves shared code to
`packages/` on the second real consumer; this is the third. The owner chose on
2026-09-27 to file it rather than widen the scaffold's pull request.

The copies are not identical, which is why this is a decision and not a move:

- the **planner's** and the **ledger's** are the same adapter — string levels,
  ISO time, stderr, synchronous destination, a `child` — differing only in the
  `REDACT_PATHS` list (the ledger adds the cookie and Cloudflare Access's
  `cf-access-jwt-assertion` header);
- the **downloader's** has grown a `RequestContext` redaction pass and a
  whole-line `redactUrlsInText` walk (dl-58) that the other two do not have and
  may not want the cost of.

## Decision — answered 2026-09-28 by the owner: all three move, through a hook

The adapter and `createLogger` go to `@webtools/core`. Each tool passes its own
redaction paths, and any extra pass as an option: a hook that sees each line
before it is written. **The downloader moves too**, and supplies its
`RequestContext` pass and dl-58's `redactUrlsInText` walk through that hook
rather than keeping its own copy. The planner and the ledger pass no hook and
pay nothing for it. There is one implementation, not two.

## Build

The decision, as it was put: **what is shared**. The likely answer is the adapter and
`createLogger` in core, with the redaction paths — and any extra pass such as
the downloader's — supplied by each tool as options. Put that to the owner with
the measured differences before moving anything.

Then, in one pull request. `refactor` is `hidden` in
`release-please-config.json`, so a `refactor(core)` subject releases no tool
even though it touches three (`docs/03-RELEASING.md`). If the work turns out
to need a `fix` or `feat`, it splits into one pull request per tool.

1. Add the shared logger to `packages/core`, exported from a subpath if it
   imports `pino` — the barrel is in `web`'s bundle graph, as
   `@webtools/core/rate-limit` already shows.
2. Point the planner and the ledger at it; keep each tool's redaction list in
   the tool.
3. Move the downloader onto it, with its two extra passes supplied through
   the hook. Its existing redaction tests have to pass unchanged, because
   they are the proof that the move lost nothing.
4. `image-closure.test.ts` will name any `Dockerfile` line a new dependency
   needs.

## Done when

- One implementation of the adapter, in `packages/core`, used by all three
  tools. No `tools/*/api/src/logger.ts` keeps its own pino setup.
- The downloader's `RequestContext` and whole-line URL passes run through the
  hook, and its existing logger tests pass unchanged.
- Each tool's redaction list still lives in the tool, and a test per tool proves
  its credential paths are censored — the ledger has none today.
- `npm run check` and every project's suite pass.

## Log

- 2026-09-28 — **Answered by the owner: the adapter and a hook in core, and
  all three tools move.** This was not the recommendation, which kept the
  downloader on its own copy. Moved to `ready`, and the `note` field removed
  now that the question it named is answered. Re-read against `a084170`
  first: still three copies. The downloader's has 16 lines naming
  `RequestContext` or `redactUrlsInText`, the ledger's has none, and the
  planner's has one, a comment saying it deliberately leaves that pass out.

- 2026-09-30 — **Built, against base `e79b04f`.** Added the adapter and
  `createLogger` to `packages/core/src/logger.ts`, exported from
  `@webtools/core/logger` (not the barrel, matching `./rate-limit`'s reasoning
  — it imports `pino`) with `redactPaths` (pino's own path-based redaction)
  and `redactFields` (a hook run over a call's fields, and a `child`'s
  bindings, before either reaches pino) as its two optional layers. Each
  tool's `logger.ts` is now a thin file: its own `REDACT_PATHS`, and, for the
  downloader only, `isRequestContext`/`redactUrlsDeep`/`safeFields` supplied
  as `redactFields`. `pino` moved from each of the three `api` packages'
  `dependencies` to `packages/core`'s (`package.json` and `package-lock.json`
  in all four), since none of the three imports it directly any more —
  confirmed by `grep -rln "pino" tools/{downloader,planner,ledger}/api/src`
  matching only `logger.ts` before the move, and nothing after it.
  `@webtools/core` was already in every tool's `Dockerfile` and
  `dependencies`, so no image-closure edit was needed —
  `npx vitest run packages/core/test/image-closure.test.ts` (part of the
  `core` project run below) passed unchanged.

  Added `tools/ledger/api/test/logging.test.ts` (the Done-when's callout —
  the ledger had no logging test at all): five tests proving each of its
  `REDACT_PATHS` entries censors what it names (`Authorization`, `Cookie`,
  `cf-access-jwt-assertion`, top-level `apiKey`), plus one proving redaction
  and not deletion. Did not add an equivalent for the planner: its
  `REDACT_PATHS` (`apiKey`, `headers.authorization`,
  `headers['x-api-key']`) are not exercised directly anywhere in its existing
  suite either (`grep -rn "headers.authorization\|headers\['x-api-key'\]"
tools/planner/api/test` — no matches), so the ticket's own framing that only
  the ledger "has none today" is arguably imprecise; left as is rather than
  widened, since the Done-when's own wording names the ledger specifically and
  the planner's indirect coverage (pl-39, the SDK-error path) was in place
  before this ticket. Flagged here rather than silently deferred.

  `npm run build` exit 0. `npm run check` exit 0 (lint, format, typecheck).
  Suites: `npx vitest run --project downloader` 89 passed / 1 skipped (90
  files), 1525 passed / 2 skipped (1527 tests) — the same 47/47 in
  `logging.test.ts` the Done-when asks to stay unchanged, re-run directly
  too. `--project planner` 75 files, 1293 tests, all passed. `--project
ledger` 5 files (`api/test/{config,health,logging}.test.ts`,
  `contract/test/errors.test.ts`, `web/test/vite-config.test.ts`), 20 tests,
  all passed — 4 files / 15 tests before this branch, +1 file / +5 tests from
  the new `logging.test.ts` alone (`grep -c '^\s*test(' logging.test.ts` is 5,
  and it is the only test file this branch adds or edits). `--project core` 5
  files, 24 tests, all passed.

  Citations: `node scripts/citations-gate.mjs --against origin/main` was 0
  failing before any edit (135 enforced). After the move it reported 2
  failing — `docs/work/repo-40-trust-proxy-is-a-second-consumer-with-nowhere-to-land.md`
  (`packages/core/src/index.ts:3-8`, its quoted text changed from "so
  exporting **it**" to "so exporting **either**" when the barrel comment grew
  a second subpath) and `tools/downloader/docs/work/dl-53-finished-files-and-the-tunnel.md`
  (`tools/downloader/api/src/logger.ts:211 "isRequestContext(value)"`, shifted
  to line 210 by the new file header). Both cited content that was true of
  `origin/main` unchanged, so both were repaired by pinning to the base
  (`@e79b04f`) per repo-78, not by repointing within this branch — a
  repoint would itself go stale the next time either file moves. Re-run after
  the two pins: `135 enforced, 0 failing`. The three records the dispatch
  named as at risk — dl-43 (`logger.ts:74-112 "function isRequestContext"`),
  dl-53 (the one above), dl-58 (`logger.ts:115/125/127/142`, already excused
  by an `evidence` declaration rather than pinned, per its own Log's D4) — were
  checked individually with
  `node scripts/citations.mjs <ticket> --section Review --require-anchors --require-distinct-anchors`:
  dl-43's range citation still resolves `ok` (the function it names still
  falls inside the cited 74-112 span after the move), dl-58's declared
  citations remain excused (the pre-fix text they quote is still nowhere in
  the file), and only dl-53's needed a pin, done above.

  Fold-in: none identified. No other ticket in `docs/work/` or
  `tools/*/docs/work/` names the logger, and the only other citations into
  either changed file (`packages/core/src/index.ts`, the three tools'
  `logger.ts`) were the two repaired above — found by running the gate, not
  by a targeted grep, so this is not a claim that no other ticket could ever
  be affected, only that the gate found none.
