---
id: repo-40
tool: repo
title: trustProxy() is duplicated in two tools' config.ts, and packages/core has no config-parsing home to receive it
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-40 — Lift `trustProxy()`, once its seam is decided

## Why

[pl-38](../../tools/planner/docs/work/pl-38-the-planner-limiter-shares-one-bucket.md)
gave the planner its own `ApiConfig.trustProxy: boolean | string`, parsed by a
`trustProxy()` function in `tools/planner/api/src/config.ts` that is
**byte-for-byte identical** to the one already in
`tools/downloader/api/src/config.ts` — `diff` on the two function bodies exits
0, measured by that ticket's reviewer during its gate.

That is the repo's own stated trigger. The root `CLAUDE.md` says shared code
moves to `packages/` "on the second real consumer, not the first guess", and
this is that moment by the letter of the rule: two tools, one function, no
guessing about whether a third will ever want it.

**It was not lifted on pl-38, and that was a deliberate call, not an
oversight.** Put to the repository owner with `AskUserQuestion` on 2026-09-08 as
two options — leave the duplication and file this ticket, or lift it
immediately in a separate PR — with leave-and-file recommended by both the
builder and the reviewer on that ticket. The owner took the recommendation and
overrode nobody. The objection that earned the deferral, so the next person to
pick this up does not have to rediscover it:

- **`packages/core` has no config-parsing home.** It holds `rate-limit.ts`,
  `errors.ts`, `redact.ts` and `job.ts` — primitives and mechanism, not "read an
  env var and fall back". A lift here is not a cut-and-paste of one function; it
  is the first thing in this package shaped like environment parsing, and its
  shape has to be decided rather than copied.
- **A lift changes the downloader too, and that must be declared rather than
  smuggled.** `tools/downloader/api/src/config.ts` is the function's original
  home. A single ticket that edits it alongside the planner's is exactly the
  shape the root `CLAUDE.md` warns about — "a commit that touches two tools
  lands in both changelogs under one sentence written for one of them, which is
  the tell that it should have been two commits" — so this is filed as repo-wide
  work precisely because no single tool's ticket should carry an edit to the
  other tool's file.

## Build

Three changes, and they are not one commit — see Traps.

1. **Decide the seam**, and record the choice in this ticket's Log before
   writing code: does `trustProxy()` land beside `clientKey` in
   `packages/core/src/rate-limit.ts` (the same file it protects, in every
   consumer today), or in a new `packages/core/src/trust-proxy.ts` (the parser
   is really about who `request.ip` and `request.hostname` mean, which is wider
   than rate limiting even though nothing here uses it for anything else yet)?
   Either is defensible; pick one and say why, the way `rate-limit.ts`'s own
   header records why the Fastify hook did **not** move with the arithmetic.
2. **Add the lifted function to `packages/core`**, with its own test file under
   `packages/core/test/` — neither tool tests this parser today beyond one
   config-loading test on the planner's side (`tools/planner/api/test/config.test.ts`),
   and a function two tools depend on should be tested where it lives, not
   incidentally by whichever caller happened to add a test first.
3. **Switch each tool's `config.ts` to import it**, deleting the local copy and
   its doc comment, replacing it with a one-line pointer to the shared one — the
   pattern `rate-limit.ts` already set for `clientKey`. `ApiConfig.trustProxy`'s
   field-level doc comment stays in each tool (what it does to _that_ tool's
   rate limiter is tool-specific), only the parsing function moves.

## Done when

- `tools/downloader/api/src/config.ts` and `tools/planner/api/src/config.ts`
  both import the same function from `@webtools/core` and neither defines its
  own.
- A test in `packages/core/test/` exercises the parser directly — default,
  boolean forms both cases, and passthrough of a CIDR/list — proven by a test
  file and line, not by "the existing config tests still pass".
- `npm run check` and `npm test` (full, since this touches `packages/core`)
  are green, and both tools' own project suites (`--project downloader`,
  `--project planner`) still cover `ApiConfig.trustProxy` end to end.

## Traps

**This is repo-wide work that touches two tools' files, and it is not one
pull request.** The lift itself (`packages/core` gains the function and its
test) touches no path under `tools/`, so it changes neither changelog and can
land on its own. Switching the downloader's `config.ts` to import it is a
downloader-scoped change; switching the planner's is planner-scoped. Landing
all three in one branch produces the exact squash-merge shape the root
`CLAUDE.md` names as the tell that it should have been more than one PR — split
it, in whatever order keeps each PR green on its own (the lift first, since the
other two depend on it existing).

**Behaviour must not change.** Neither tool has ever tested this parser's edge
cases directly before now (see pl-38's Log) — the lift is the moment that gap
either gets closed for both at once or gets closed twice, and closing it twice
is the thing this ticket exists to stop.

## Log

**2026-09-08 — filed from pl-38's gate.** pl-38 duplicated the downloader's
`trustProxy()` in the planner rather than lifting it, on the reasoning above.
Filed as `repo-40` rather than the id `next-id.mjs` reports, because a sibling
branch (`repo-37-anchor-planner-review-corpus`) had already pushed
`docs/work/repo-39-...md` with no PR open yet — invisible to a tool that reads
merged files plus open PR diffs. Not started.
