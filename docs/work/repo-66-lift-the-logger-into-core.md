---
id: repo-66
tool: repo
title: Three tools carry their own copy of the pino logger; lift the shared half into core
kind: work-package
status: done
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

## Review

### Gate 1

_Re-issued at `5b8daa3`, the gated sha unchanged: coordinates re-resolved, and the two F3 citations are prose naming `6c3f8ea`, because the round gate 2 reviewed rewrote the comments they quoted._

**Gate: FAIL** — 2026-09-30 · `e79b04f...6c3f8ea` (base `origin/main` at `e79b04f`, unmoved after the fetch) · code-review at medium · Opus 5.5 gating a Sonnet build (`standard`) · unpinned coordinates resolve against `5b8daa3`

| Done when                                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One adapter in `packages/core`, used by all three tools; no `tools/*/api/src/logger.ts` keeps its own pino setup             | **verified** — the one emit is `packages/core/src/logger.ts@3aaa21a:103 "logger[level](safe(fields) ?? {}, message);"`; a grep for `from "pino"` over `tools/` and `packages/` matches 1 file, that one; each tool delegates: `tools/planner/api/src/logger.ts:43 "redactPaths: REDACT_PATHS"`, `tools/ledger/api/src/logger.ts:47 "redactPaths: REDACT_PATHS"`, `tools/downloader/api/src/logger.ts@3aaa21a:228 "redactPaths: REDACT_PATHS,"` ✓                                                                                                                                                                                           |
| The downloader `RequestContext` and whole-line URL passes run through the hook, and its existing logger tests pass unchanged | **proven** — `tools/downloader/api/src/logger.ts@3aaa21a:229 "redactFields: safeFields,"`; bypassing the hook in the core emit turns 14 of 47 downloader logging tests red, among them `tools/downloader/api/test/logging.test.ts@e79b04f:88 "credentials but keeps the rest"` and `tools/downloader/api/test/logging.test.ts@e79b04f:875 "a query string in a top-level field outside details is redacted too"`; dropping the hook from grandchildren turns 3 red. No downloader test file is in the diff; 47 of 47 green ✓                                                                                                               |
| Each tool keeps its redaction list, and a test per tool proves its credential paths are censored                             | **unproven** — lists stay in the tools (row 1). Planner: per entry 6 of 7, per credential 3 of 3 (`tools/planner/api/test/redaction.test.ts:94 "toEqual({"`). Ledger: per entry 8 of 9, per credential 4 of 4 (`tools/ledger/api/test/logging.test.ts:110 "toEqual({ cookie:"`). Downloader: per entry 1 of 6, per credential 1 of 2 — cookie proven by `tools/downloader/api/test/logging.test.ts@e79b04f:101 "redacts a header bag that arrived under some other name"`; authorization not: deleting all three authorization entries from `tools/downloader/api/src/logger.ts@e79b04f:85 "const REDACT_PATHS = ["` leaves 47 of 47 green |
| `npm run check` and every project suite pass                                                                                 | **verified** — check exit 0; `npm test` exit 0, 3495 passed and 2 skipped of 3497 in 188 files at `6c3f8ea`, against 3477 and 2 of 3479 in 186 files at `e79b04f`; the +18 are the 8 planner and 10 ledger tests in the two new files, and no existing test file is in the diff ✓                                                                                                                                                                                                                                                                                                                                                          |

- **med** · F1 — the downloader authorization paths have no test (row 3). Premises: `{ headers: { authorization } }` reaches pino only through the path layer, since the structural pass matches `requestContext` alone; `tools/downloader/api/test/logging.test.ts` contains no lowercase `authorization` at all. Mutation: delete `headers.authorization`, `*.headers.authorization` and `*.authorization` together, run that spec: 47 passed of 47. Remedy: new tests for the three shapes, appended at the end of that spec or in a new file, so no existing test changes.
- **med** · F2 — `packages/core/src/logger.ts` is a new file with no test in `packages/core/test/`, and its child-bindings hook, `packages/core/src/logger.ts@3aaa21a:114 "adapt(logger.child(safe(extra) ?? {}), redactFields)"`, is proven by nothing: replacing `safe(extra)` with `extra` there passes 2851 of 2851 across the downloader, planner and ledger projects, although a probe shows that call is what stops `child({ requestContext })` writing a Cookie. Pre-existing gap, moved: the same mutation at `e79b04f` against the downloader adapter passes 1525 of 1525. Remedy: a core spec driving `redactFields` through fields, `child`, a grandchild and the `fieldsDropped` fallback.
- **low** · F3 — both new specs say deleting an entry turns a named test red (line 9 of the header comment in `tools/planner/api/test/redaction.test.ts` and in `tools/ledger/api/test/logging.test.ts`, as of `6c3f8ea`). False for `headers.authorization` in both, which `*.authorization` shadows: deleting it leaves the planner 8 of 8 and the ledger 10 of 10 green. The Log says so; the comments do not.
- **low** · F4 — two findings, one mechanism: `redactFields` never sees (a) the `msg` string, an `err` that is an `Error` (message and stack are not enumerable) or the `createLogger` `bindings` option, `packages/core/src/logger.ts@3aaa21a:136 "...options.bindings"` — a signed URL in each is written verbatim; and (b) an `Error` with an enumerable URL field is copied to a plain object, dropping its message and stack. Identical at `e79b04f` for all three tools, and no call site reaches any of them today (errors are logged as `String(error)` or a code; nothing passes `bindings`). Low because nothing regressed; it has a reproduction, so filing it is an open decision in the gate report.
- **low** · F5 — the Log, 2026-09-30 entry, fold-in paragraph: "No other ticket in `docs/work/` or `tools/*/docs/work/` names the logger". A grep for `logger.ts` there finds 10 others (dl-29, dl-43, dl-53, dl-56, dl-58, dl-66, pl-39, lg-3, repo-29, repo-48). None goes stale: the one open ticket, lg-3, says the ledger logger censors the token and header, which still holds.
- **dropped** · the planner and ledger `AppLogger` became a type re-export instead of an interface, so it is no longer declaration-mergeable; nothing augments it and `npm run check` passes. Not a defect.
- **findings** · code-review at medium returned 7; 6 carried in 5 bullets (F4 holds two), 1 dropped.

- Parity: 34 inputs per tool (call fields, `child` bindings, a nested child, `msg`, `err`, lower- and mixed-case header bags, `apiKey`, a signed URL, a cycle, a throwing getter, the `bindings` option, all four levels) through the base and the head logger of each tool: 102 of 102 outputs byte-identical once `time`, `pid` and `hostname` are dropped. `@webtools/core` still does the redacting: `tools/downloader/contract/src/redact.ts@e79b04f:9 "import { redactHeaders, redactUrl } from"` and `tools/downloader/engine/src/ffmpeg/runner.ts@e79b04f:79 "(match) => redactUrl(match)"`, neither in the diff; planner and ledger censor with the core `REDACTED`, the same string their removed local constant held.
- Packaging: `packages/core/package.json:21 "./logger"` is exported and `dist/logger.js` and `.d.ts` are built; 0 of 3 web bundles contain `pino`. `npm install --package-lock-only` over the 17 head manifests, extracted to scratch, changes 0 lines of the lockfile; with the core `pino` dependency removed first it changes the core entry, so the check can fail. The lockfile holds one `node_modules/pino`, 10.3.1, not dev. Each image copies the core manifest before `tools/planner/Dockerfile@e79b04f:40 "RUN npm ci"` (and its downloader and ledger twins), and `npm prune --omit=dev` keeps `pino` as a production dependency of `@webtools/core`. Traced, not built: image boot is **unproven (gate)**. `image-closure.test.ts` passes in the suite, and governs workspaces, not `pino`.
- Title and preflight: `preflight.mjs --base origin/main` with the proposed title exits 0 — check, ciCommands, citations, review, title and mergeTree (3 open PRs, all clean) each ok. `refactor` is hidden, and honest here: nothing a tool user sees changed (parity above).
- Citations: `citations-gate.mjs --against origin/main` exits 0, 135 enforced, 0 failing. Merged records citing the three `logger.ts` or the core `index.ts` in `## Review`: 4 of 141, 7 citations — repo-40 (1, pinned to `e79b04f` by the branch, ok), dl-53 (1, pinned likewise, ok), dl-43 (1, unpinned, ok at the head, claim still true), dl-58 (4, declared evidence, same verdict at base). dl-29 also cites `logger.ts` 5 times, in gate sections not titled Review, which CI does not read.
- Invariants: no cross-tool import (tools import only `@webtools/core/logger`); lifted on the third consumer, as decided; contracts untouched; no new workspace dependency and no Dockerfile edit; new specs counted in the suite; no `any`, no `console`, `import type` and `node:` kept. Skipped, nothing in the diff touches them: AppError, shell, SSRF, progress.
- NFR: security — F1, F4 · performance — planner and ledger now pay one identity call per line, negligible · reliability ✓ the `fieldsDropped` fallback survives (removing it turns a downloader test red) · maintainability — F2, F3.

### Gate 2

**Gate: PASS** — 2026-09-30 · `6c3f8ea..5b8daa3` only · base `e79b04f`, `origin/main` unmoved · Opus 5.5 · unpinned coordinates resolve against `5b8daa3`

| Gate 1 finding | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 · med       | **fixed** — new `tools/downloader/api/test/redaction.test.ts:84 "{ request: { authorization:"` and its siblings. Deleting the three authorization entries now fails 4 of 54 across that spec and `logging.test.ts` (was 0 of 47). Per entry 4 of 6 red; `headers.cookie` and `headers.authorization` stay green, shadowed by `*.cookie` and `*.authorization` as the spec header says. Per credential 2 of 2; all six deleted, 9 red                                                                                                                                                                                                      |
| F2 · med       | **fixed** — new `packages/core/test/logger.test.ts:110 "is applied to a child"` and `packages/core/test/logger.test.ts:117 "is applied to a grandchild"`. The gate-1 core mutation set, M1 to M9, over `--project core` plus the three tools (2896 tests): 9 of 9 red. The child-bindings mutation fails 2 (was 0 of 2851)                                                                                                                                                                                                                                                                                                                |
| F3 · low       | **fixed** — per-entry deletions re-run: planner 6 of 7 red, ledger 8 of 9, and in each the green one is `headers.authorization`, the one exception the rewritten headers name (`tools/planner/api/test/redaction.test.ts:10 "shadows (pino"`, `tools/ledger/api/test/logging.test.ts:10 "shadows (pino"`)                                                                                                                                                                                                                                                                                                                                 |
| F4 · low       | **filed** as repo-85, the owner choice. Its script, saved from the brief as `repro.mjs` at the repo root and run at `5b8daa3` after `npm run build`, exits 0 and prints the five recorded lines (only the stack path differs): control redacted, then `msg`, `err` and the `bindings` option each carrying `SECRET`, then `err + enumerable` with no `message` or `stack`. Frontmatter uses only fields and values in `docs/01-TICKETS.md`; `npm run status -- --show repo-85` exits 0 and shows it blocked by repo-66 (ready); `status.mjs --json` exits 0; no `repo-85` exists on `main` or on the three open branches that add tickets |
| F5 · low       | **fixed** — the sentence is struck and kept with the ten tickets named; the same grep now finds those ten plus repo-85, filed in this round                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

- Gate 1 row 3 (a test per tool proves its credential paths are censored) is now **proven** for all three tools, per F1. No acceptance line is unproven.
- Empty output: making the core emit write nothing fails 36 of the 37 tests in the four new or edited specs. The one that passes is the throwing-hook test, whose fallback line is written by the catch. `not.toContain` on `JSON.stringify(undefined)` fails, so no absence assertion here passes on a missing line.
- **low** · F6 — `tools/downloader/api/test/redaction.test.ts:4 "proves the cookie half at one depth"` understates: `logging.test.ts` covers the cookie at two depths — deleting `*.headers.cookie` alone turns its case-sensitivity test red, and deleting `headers.cookie` with `*.cookie` turns its other-name test red.
- **dropped** · the repo-85 brief cites the `bindings` spread in `packages/core/src/logger.ts` by line and anchor, outside any `## Review`, so CI never checks it, and its own fix is what will move that line. Not a defect.
- **findings** · code-review at medium over the round returned 2; 1 carried, 1 dropped.
- Commands at `5b8daa3`: `npm run check` exit 0; the four new or edited specs exit 0, 37 of 37; `npm test -- --project core --project downloader --project planner --project ledger` exit 0, 2894 passed and 2 skipped of 2896 in 178 files; `citations-gate.mjs --against origin/main` exit 0, 135 enforced, 0 failing. `preflight.mjs` with the proposed title exits 16: check, ciCommands, citations, review and title ok, and mergeTree merges cleanly with all 4 open heads, but its scratch-merge citation fold with #326 fails 11 records (repo-29 to repo-82) on moved citations. Neither branch edits those records; #326 changes the scripts they cite. That is the expected failure the dispatch named; the other 3 folds are clean.
- NFR: security ✓ F1 and F2 closed · performance n/a, tests only · reliability n/a · maintainability — F6.
- Not re-swept: anything outside `6c3f8ea..5b8daa3`.

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
  the ledger had no logging test at all): one test per `REDACT_PATHS` entry
  (9, wildcard forms included) plus one proving redaction and not deletion,
  10 in all. The first draft covered only the four top-level forms (5
  tests); extended on the coordinator's review to the planner's standard.
  Mutation, one entry deleted at a time from the ledger's list
  (`node` script in the scratch directory, file restored after each): eight of
  nine turn their own test red (`apiKey`, `*.apiKey`, `*.headers.authorization`,
  `*.authorization`, `headers.cookie`, `*.headers.cookie`,
  `headers['cf-access-jwt-assertion']`,
  `*.headers['cf-access-jwt-assertion']`; deleting `headers.cookie` also fails
  the redaction-not-deletion test, which uses that path). **Shadowed:
  `headers.authorization` only** — deleting it stays green (`exit 0`, no test
  failed), because `*.authorization` matches `headers.authorization`. No path
  removed. **Correction, same day, on the coordinator's review:** an
  earlier draft of this entry left the planner without an equivalent, reading
  "the ledger has none today" as narrowing the Done-when. It does not; "a test
  per tool" includes the planner, whose `REDACT_PATHS` were exercised nowhere
  directly (`grep -rn "headers.authorization\|headers\['x-api-key'\]"
tools/planner/api/test` matched nothing before this commit). Added
  `tools/planner/api/test/redaction.test.ts`, a new file so no merged record's
  citation moves: one test per `REDACT_PATHS` entry (7) plus a
  redaction-not-deletion test, 8 in all. Red-green: deleting
  `*.headers['x-api-key']` from the planner's list turns exactly that test red
  (`1 failed | 7 passed`, `expected ... not to contain 'super-secret'`),
  restored afterwards. Also measured: deleting `headers.authorization` stays
  green (`8 passed`), because pino's `*.authorization` already matches it, so
  that entry is redundant; left in place, since removing a redaction path is
  not this ticket's call.

  `npm run build` exit 0. `npm run check` exit 0 (lint, format, typecheck).
  Suites: `npx vitest run --project downloader` 89 passed / 1 skipped (90
  files), 1525 passed / 2 skipped (1527 tests) — the same 47/47 in
  `logging.test.ts` the Done-when asks to stay unchanged, re-run directly
  too. `--project planner` 76 files, 1301 tests, all passed (75/1293 before the planner test above). `--project
ledger` 5 files (`api/test/{config,health,logging}.test.ts`,
  `contract/test/errors.test.ts`, `web/test/vite-config.test.ts`), 25 tests,
  all passed — 4 files / 15 tests before this branch, +1 file / +10 tests from
  the new `logging.test.ts` alone (25 tests after the extension; 20 in the
  first draft). `--project core` 5
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

  Fold-in: none identified. ~~No other ticket in `docs/work/` or
  `tools/*/docs/work/` names the logger~~ — **WITHDRAWN, do not cite (gate 1,
  F5): false as written.** `grep -l "logger.ts" docs/work/*.md
tools/*/docs/work/*.md` finds ten other tickets — dl-29, dl-43, dl-53,
  dl-56, dl-58, dl-66, pl-39, lg-3, repo-29, repo-48 — the sentence was
  written from the citations gate's output, which reads only `## Review`
  sections, and not from a grep. What stands is the narrower claim: the only
  citations the gate found displaced were the two repaired above
  (`packages/core/src/index.ts`, the three tools' `logger.ts`), found by
  running the gate, so this is not a claim that no other ticket could ever be
  affected. None of the ten goes stale (the one open ticket, lg-3, says the
  ledger logger censors the token and header, which still holds).

- 2026-09-30 — **Round 2, on gate 1's findings** (F1, F2, F3, F5 fixed; F4
  filed as `repo-85`). Both med findings were reproduced before anything was
  fixed, by a mutation runner in the scratch directory (`mutate.mjs`, file
  restored after each run):
  - **F1 reproduced, then fixed.** Deleting `headers.authorization`,
    `*.headers.authorization` and `*.authorization` from the downloader's
    `REDACT_PATHS` left `tools/downloader/api/test/logging.test.ts` at `47
passed / 47`. New file `tools/downloader/api/test/redaction.test.ts` (no
    existing downloader test touched): one test per entry (6) plus
    redaction-not-deletion, 7. Per-entry mutation, one entry deleted at a
    time: `*.headers.cookie`, `*.headers.authorization`, `*.cookie` and
    `*.authorization` each turn their own test red (`6 passed / 7`). **Shadowed:
    `headers.cookie` (by `*.cookie`) and `headers.authorization` (by
    `*.authorization`)** — each stays `7 passed / 7` when deleted, and so do
    both together. F1's own mutation, all three authorization entries at once,
    now fails 4 tests (`3 passed / 7`). No path removed.
  - **F2 reproduced, then fixed.** Replacing `safe(extra)` with `extra` in
    `packages/core/src/logger.ts`'s `child` line: `69 passed / 69` across the
    downloader, planner and ledger logging specs (four spec files; the gate's
    2851-test figure covers whole projects and was not re-run). New file
    `packages/core/test/logger.test.ts`, 12 tests: the adapter itself (line
    shape, levels, `silent`, bindings), `redactPaths` (censors; none by
    default) and one test per route the `redactFields` hook is applied on
    (call fields, child bindings, grandchild bindings, call fields on a
    grandchild, `undefined` in and out, the `fieldsDropped` fallback, no hook).
    One mutation per route, each red: `child(safe(extra))` → `child(extra)`
    fails 2 (child and grandchild bindings); dropping the hook from the
    child's `adapt` fails 2 (grandchild bindings, grandchild call fields);
    `safe(fields)` → `fields` fails 4; removing the `fieldsDropped` line, and
    letting the hook's throw propagate, each fail the fallback test;
    `redactPaths` ignored fails 1; the top-level `adapt` without the hook
    fails 6. The stand-in hook (`scrub`, a `secret` key) is the core spec's own;
    the downloader's real hook stays tested in `tools/downloader/api/test/`.
  - **F3 fixed.** The planner and ledger spec headers said deleting an entry
    turns a named test red; each now names `headers.authorization` as the
    shadowed exception, which is what the mutation runs measured (planner
    `8 passed / 8`, ledger `10 passed / 10` when it is deleted).
  - **F5 fixed** above, in place: the withdrawn sentence is struck through and
    kept, with the ten tickets `grep -l "logger.ts" docs/work/*.md
tools/*/docs/work/*.md` finds, re-derived here (same ten as the gate).
  - **F4 filed**, not fixed, on the owner's choice:
    `docs/work/repo-85-logger-hook-misses-msg-err-and-bindings.md` (`kind:
fix`, `status: ready`, `difficulty: standard`, `depends_on: [repo-66]`),
    with the reproduction inlined as a script and its output. `node
scripts/next-id.mjs repo` printed `next free: repo-85` before the file was
    written. Run again with the file present but uncommitted it still printed
    `repo-85`, so it does not see an uncommitted file; the id is held from the
    commit that adds it.

  `npm run check` exit 0. The four new or edited specs: 4 files / 37 tests
  passed (7 + 12 + 8 + 10). `npm test -- --project downloader --project
planner --project ledger --project core`: exit 0, 177 files passed / 1
  skipped (178), 2894 tests passed / 2 skipped (2896).
  `node scripts/citations-gate.mjs --against origin/main`: exit 0, `135
enforced, 0 failing`.
