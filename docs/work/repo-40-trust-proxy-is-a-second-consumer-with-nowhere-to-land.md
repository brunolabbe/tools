---
id: repo-40
tool: repo
title: trustProxy() is duplicated in two tools' config.ts, and packages/core has no config-parsing home to receive it
kind: chore
status: done
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

## Review

**Gate: FAIL** — 2026-09-12 · two rounds · tips `d3935bf` (lift), `6208c2d`
(downloader), `d7738ea` (planner), all off `8d79d8e` · defect hunt run
in-context at medium

| Done when                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Both tools' `config.ts` import the same function from `@webtools/core`, neither defines its own                          | **verified** — on a trial merge of `6208c2d` and `d7738ea`, `grep -n trustProxy` on both files gives one `import { trustProxy } from "@webtools/core"` each and no `function trustProxy`; planner side at `tools/planner/api/src/config.ts:11-14 "was pl-38's deliberate duplicate of the"`, seam recorded at `packages/core/src/trust-proxy.ts:11-20 "It lives in its own file rather than beside"`                                                                                                                                                                     |
| A test in `packages/core/test/` exercises the parser directly — default, boolean forms both cases, CIDR/list passthrough | **proven** — `packages/core/test/trust-proxy.test.ts:16 "expect(trustProxy(undefined)).toBe(false)"` · `:21-25 "recognises every truthy spelling, case-insensitively"` · `:27-31 "recognises every falsy spelling, case-insensitively"` · `:33-35 "passes a CIDR through verbatim rather than coercing it to a boolean"` · `:37-40 "passes a single address or a comma-separated list through verbatim"` · `:42-49 "preserves case and does not treat a word-shaped passthrough as a boolean prefix match"` · `:51-54 "trims surrounding whitespace before classifying"` |
| `npm run check` and full `npm test` green, and both tools' project suites still cover `ApiConfig.trustProxy` end to end  | **unproven** — gates verified (check 0 and `npm test` 137 files / 2398 tests on each of the three tips; base `8d79d8e` 136 / 2391); planner coverage proven at `tools/planner/api/test/config.test.ts:171 "expect(loadApiConfig({}, {}).trustProxy).toBe(false)"`, `tools/planner/api/test/config.test.ts:166-177 "kept as a CIDR rather than coerced to a boolean"` and `tools/planner/api/test/runs.test.ts:495-498 "all three counted against the one real address"`; downloader coverage absent, see below                                                           |

- **high** · The third `Done when` line's last clause is wrong rather than merely untested. It reads as a claim that both project suites already cover `ApiConfig.trustProxy` end to end; the downloader's never has. `ls tools/downloader/api/test/` holds no `config.test.ts`, and `grep -rn "trustProxy\|TRUST_PROXY" tools/downloader --include=*.ts -l | grep -v dist` returns only `api/src/config.ts`, `api/src/rate-limit.ts` and `api/src/server.ts` — no test. The premise was false before this branch and is not made false by it, so the repair is to the ticket, not to the diff. **Open decision, with the repository owner** — correct the line and file a `dl-` ticket for a downloader proxy-trust integration test, versus adding that test inside this branch.
- **low, fixed in this branch** · Round 1 found the pointer comment copied into the planner's `config.ts` claiming the function had lived there. What lived there was pl-38's deliberate duplicate, not the function's home. Repaired at `d7738ea`; the corrected text is the cited anchor in the first row above. The downloader's copy of that comment is true as written and was left alone.
- **low, fixed in this branch** · Round 1 found the parser's suite unable to fail against two mutations, because every passthrough fixture was numeric: returning the lowercased value instead of the trimmed one, and broadening the truthy match to `lower === "1" || ["true", "yes", "on"].some((v) => lower.startsWith(v))`. Both left the suite at 6 passed, exit 0. Repaired at `d3935bf` by `packages/core/test/trust-proxy.test.ts:42-49 "preserves case and does not treat a word-shaped passthrough as a boolean prefix match"`; re-running both mutations against it now gives `1 failed | 6 passed`, exit 1. Eight other mutations — default flipped, trim dropped, `toLowerCase` dropped, `"on"` dropped, `"off"` dropped, untrimmed passthrough, `trimStart`, full-list prefix match — were caught by the suite as first written.
- **dropped** · `packages/core/src/trust-proxy.ts` repeats its opening sentence in the function docblock below the file docblock. Deliberate: it preserves the shape the original carried while adding the seam rationale above it. Not a defect.
- **dropped** · `tools/downloader/api/src/config.ts` has a `bool()` helper using the same two spelling lists, but the planner has no equivalent (`grep -n 'function bool' tools/planner/api/src/config.ts` is empty), so there is no second consumer and the repo's rule says lift on the second, not the first guess.
- **findings** · defect hunt in-context at medium returned 4; 2 carried, 2 dropped; both carried were repaired in round 2. The `high` above is an acceptance finding, not a hunt finding.
- **behaviour identity** · The lifted function is byte-identical to what both tools had, and the round-2 test commit left that source blob untouched. Lines 318-325 of the downloader's `config.ts` and lines 310-317 of the planner's, both as they stood at `8d79d8e` before either branch, together with `packages/core/src/trust-proxy.ts:27 "export function trustProxy(raw: string | undefined): boolean | string"` through the end of its body with `export ` stripped, all md5 to `da5e4fcc9a5a7536813e6d816d8f70e5`, and `diff` exits 0 between all three. Those first two are deliberately prose, not citations: they are coordinates into `8d79d8e` rather than into this tree — the planner's copy is deleted on this branch and the downloader's goes when its own branch merges, so neither can carry an anchor that stays true. Reproduce with `git show 8d79d8e:tools/downloader/api/src/config.ts` piped through `sed -n 318,325p` and `md5sum`, and the planner's with `310,317p`. Confirmed at runtime too: main's body compared against both tools' built `loadApiConfig` and the core export over 42 inputs — every boolean spelling in four casings, near-misses, IPv4, CIDR, comma lists, IPv6, `loopback`, whitespace forms, `undefined` — giving `cases=42 mismatches=0` on each tool tip and on a trial merge of the two.
- **the split holds** · `d3935bf` touches no path under `tools/` and is green alone (check 0, `npm test` 137 / 2398). Each tool tip is green alone (`--project downloader` 73 files / 1214 tests; `--project planner` 53 / 848). The two siblings conflict only on this ticket file, and the composed tree is green.
- **the barrel decision holds** · `trust-proxy.ts` has no import statement at all, and `grep -rn "node:" packages/core/src/` finds `node:net` only in `rate-limit.ts`. Adding it to the main barrel changed neither web bundle: built at `8d79d8e` and at the lift tip, the content-hashed outputs are the same filenames, `index-wF6Q9jsf.js` and `index-BBIZV2-R.js`, and `grep -c` for `node:net`, `clientKey` and `trustProxy` is 0 in both. The reasoning recorded at `packages/core/src/index.ts:3-8 "so exporting it from the barrel drags server-only code into"` is true as stated.
- NFR: security — the `false` default is the guard `SECURITY.md` names against header-spoofed rate-limit buckets; preserved, and a mutation flipping it is caught. performance n/a. reliability ✓ — identical behaviour, every suite green on every tip and on the composed tree. maintainability — two lows, both repaired above.

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
planner, unchanged (i.e. still absent) for the downloader.

**2026-09-12 — Build step 3, the planner half
(`repo-40-trust-proxy-planner`, stacked on the lift, sibling of
`repo-40-trust-proxy-downloader` rather than stacked on it — the two switches
do not depend on each other, only on the lift).**
`tools/planner/api/src/config.ts` now imports `trustProxy` from
`@webtools/core` and defines no local copy; its doc comment was deleted and
replaced with the same two-line pointer the downloader branch used. The
field-level doc comment on `ApiConfig.trustProxy` stays, per the ticket, but
its closing paragraph was updated in place — it described pl-38's
"copied rather than shared" call, which repo-40 supersedes; it now says the
function is shared since repo-40 and explains what stays tool-specific (which
bucket this setting feeds, not the parsing). `@webtools/core` was already a
`dependencies` entry in `tools/planner/api/package.json`. `npm run check`
green; `npm test -- --project planner`: 53 files, 848 tests, all passed; full
`npm test` on this branch also green (137 files, 2397 tests, matching the
lift branch's own full run).

Setting `status: done` here, as the third and last of the three Build steps
— but flagging the sequencing this creates, since it is not this builder's
call to resolve: `repo-40-trust-proxy-downloader` and this branch are
siblings, both stacked on `repo-40-trust-proxy-lift` and not on each other,
and **both independently append a Log entry at this same point in the file**.
Landing them as two separate PRs (per Traps) means the second one merged will
conflict on this file — trivially, two insertions at the same anchor, fixed
by keeping both entries in landing order — but a merge conflict is a merge
conflict and worth calling out rather than discovering at merge time. Whoever
merges second should resolve it by keeping both Log entries, and should
double-check that `status: done` and this closing paragraph survive on
`main` whichever order the two PRs land in.
