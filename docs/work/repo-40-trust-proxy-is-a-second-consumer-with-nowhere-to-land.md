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

**2026-09-12 — Build step 1, the seam decision, and the lift itself
(`repo-40-trust-proxy-lift`).** Chose `packages/core/src/trust-proxy.ts`, a
new file, over landing `trustProxy()` beside `clientKey` in `rate-limit.ts`.
Reasoning:

- The two are related but not the same thing. `trustProxy()` decides which of
  Fastify's `request.ip` and `request.hostname` come from; `clientKey` in
  `rate-limit.ts` is one of several things _downstream_ that then keys off
  `request.ip`. Rate limiting is a consumer of this value, not what it is
  about — nothing here uses `trustProxy` for anything else yet, but the ticket
  itself names that as the reason to keep the door open, not a reason to
  couple them today.
- `rate-limit.ts` is deliberately excluded from this package's main barrel
  (`index.ts`) because it imports `node:net`, and the package root is in the
  web bundle graph by way of every tool's contract — exporting it there would
  drag server-only code into a browser build. `trustProxy()` imports nothing
  from `node:*`. Filing it under `rate-limit.ts` would force it behind that
  same server-only subpath for a reason that does not apply to it, and would
  make the next config-parsing lift (this package's first, per the ticket's
  own framing) look for precedent in the wrong file.

Also: this is the moment `packages/core` gains the "config parsing" shape the
ticket describes as absent (`trust-proxy.ts` is the first file here shaped
like reading a value and falling back, not a primitive or a mechanism), and a
direct test (`packages/core/test/trust-proxy.test.ts`) now pins the default,
both boolean directions case-insensitively, and CIDR/list passthrough —
neither tool tested this at the function level before (see pl-38's Log and
below). `npm run check` and full `npm test` both green on this branch alone
(2397/2397 tests, no `tools/` path touched, so this can land as its own PR
ahead of the other two — see Traps).

**What Done-when's third bullet has wrong.** It says both tools' own project
suites "still cover `ApiConfig.trustProxy` end to end" — read as a claim that
both already do. The planner's does (`tools/planner/api/test/config.test.ts`
plus the proxy-aware rate-limit integration tests in `runs.test.ts`, pl-38).
**The downloader's never has**: there is no `config.test.ts` under
`tools/downloader/api/test/` at all, and nothing else in that suite reads
`TRUST_PROXY` or sets `trustProxy` in a config override. That gap predates
this ticket and is not created by the lift, so it is left alone here rather
than folded in — adding a downloader end-to-end proxy-trust test is a real
piece of work (a new integration test file, modeled on the planner's), not a
byproduct of moving one function, and Build's three steps do not ask for it.
Recorded here so "still cover... end to end" is read correctly: true for the
planner, unchanged (i.e. still absent) for the downloader — **superseded by
the entry below**, which closes that gap in this same branch on the owner's
decision.

**2026-09-12 — the owner's decision on Done-when bullet 3, and the downloader
wiring test it produced (`repo-40-trust-proxy-downloader`).** The question:
does `packages/core/test/trust-proxy.test.ts` discharge the ticket's "closed
for both at once" line, or does the downloader still owe an end-to-end test?
Options were (A) correct the line and file a `dl-` ticket, (B) add the test
in this branch, (C) leave the line as written with nothing behind it.
**Chosen: B, by the repository owner, on 2026-09-12, overriding both the
gate's recommendation and the builder's, which were both (A).** The owner's
answer makes bullet 3's acceptance line true rather than merely accurate —
the line stays as written and the branch was raised to meet it, rather than
the line being lowered to meet the branch.

What the new test proves, and what it does not: `packages/core`'s test
covers parsing (default, both boolean directions, CIDR/list passthrough) at
the one place the function lives. It cannot prove that `TRUST_PROXY` reaches
`Fastify({ trustProxy })` and thereby changes which address this tool's rate
limiters key on — that is wiring, and the downloader had never tested it.
`tools/downloader/api/test/trust-proxy.test.ts` (new file) exercises
`rateLimitJobsPerMinute` through `POST /api/jobs`, behind both a trusted and
an untrusted hop, modeled on the planner's own `describe("behind a proxy
(pl-38)")` block in `runs.test.ts` rather than invented fresh — the two tools
wire the identical setting into the identical Fastify option, so the shape
should match.

Made able to fail before committing, per the instruction to prove rather
than assert it: hardcoded `server.ts`'s `trustProxy: config.trustProxy` to
`trustProxy: false`, reran the new suite — `1 failed | 1 passed`. The
"two clients behind a trusted proxy get independent allowances" test caught
it (a client behind the trusted hop got refused because every request now
collapsed onto the proxy's own address); the "outside the trusted CIDR"
test did not go red under this particular mutation, because it exercises the
case where the forwarded header is already ignored, which `trustProxy: false`
does not change. Restored `server.ts` from a byte-for-byte backup and
confirmed `git status --porcelain` reported only the new test file before
committing. Gates on the new tip: `npm run check` 0, `--project downloader`
74 files / 1216 tests (was 73/1214 — +1 file/+2 tests), full `npm test` 138
files / 2400 tests (was 137/2398).

**2026-09-12 — Build step 3, the downloader half
(`repo-40-trust-proxy-downloader`, stacked on the lift).**
`tools/downloader/api/src/config.ts` now imports `trustProxy` from
`@webtools/core` and defines no local copy; its own doc comment was deleted
and replaced with a two-line pointer above the import, the same pattern
`rate-limit.ts` set. `ApiConfig.trustProxy`'s field-level doc comment is
unchanged — it is tool-specific (what the setting does to _this_ tool's
rate limiter), per the ticket. `@webtools/core` was already a `dependencies`
(not `devDependencies`) entry in `tools/downloader/api/package.json` — the
rate-limit import put it there first, so no manifest edit was needed.
`npm run check` green; `npm test -- --project downloader`: 73 files, 1214
tests, all passed.
