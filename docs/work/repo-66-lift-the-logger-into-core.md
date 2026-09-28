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
