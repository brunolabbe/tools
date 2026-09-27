---
id: repo-66
tool: repo
title: Three tools carry their own copy of the pino logger; lift the shared half into core
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
note: which half of the logger is general — the downloader's copy has diverged
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

## Build

The decision first: **what is shared**. The likely answer is the adapter and
`createLogger` in core, with the redaction paths — and any extra pass such as
the downloader's — supplied by each tool as options. Put that to the owner with
the measured differences before moving anything.

Then, in one pull request per tool touched if the changelog attribution asks
for it (`docs/03-RELEASING.md`):

1. Add the shared logger to `packages/core`, exported from a subpath if it
   imports `pino` — the barrel is in `web`'s bundle graph, as
   `@webtools/core/rate-limit` already shows.
2. Point the planner and the ledger at it; keep each tool's redaction list in
   the tool.
3. Decide separately whether the downloader moves, or keeps its own because its
   extra passes are its own.
4. `image-closure.test.ts` will name any `Dockerfile` line a new dependency
   needs.

## Done when

- One implementation of the adapter, in `packages/core`, used by at least the
  planner and the ledger.
- Each tool's redaction list still lives in the tool, and a test per tool proves
  its credential paths are censored — the ledger has none today.
- `npm run check` and every project's suite pass.
