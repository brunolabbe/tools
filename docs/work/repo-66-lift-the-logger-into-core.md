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
