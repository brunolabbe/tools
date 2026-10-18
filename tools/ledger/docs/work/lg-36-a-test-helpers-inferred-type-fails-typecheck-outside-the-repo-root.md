---
id: lg-36
tool: ledger
title: A test helper's inferred return type fails typecheck in any worktree outside the repo root (TS2883)
kind: fix
status: done
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-36 — A test helper's inferred return type fails typecheck outside the repo root

## Why

`api/test/helpers/households.ts` exports `send(...)` with no return type. Its
inferred type is `Promise<Response>` from `light-my-request`, a package
`@ledger/api` reaches only through `fastify`. The declaration emit that
`tsc --build` performs has to name that type, and TypeScript names it as the
package `light-my-request` only when the directory holding the package is an
ancestor's `node_modules`.

Every agent worktree gets its `node_modules` from
`.claude/scripts/worktree-farm.sh`, which links each entry to
`/workspaces/tools/node_modules`. From a tree under
`/workspaces/tools/.claude/worktrees/`, that directory is an ancestor's
`node_modules` and typecheck passes. From a tree under `/tmp`, it is not, and
typecheck fails on this one symbol:

```
tools/ledger/api/test/helpers/households.ts(67,23): error TS2883: The inferred type of 'send' cannot be named without a reference to 'Response' from '../../../../../../../../../../../../workspaces/tools/node_modules/light-my-request/types/index.js'. This is likely not portable. A type annotation is necessary.
```

lg-23's gate 1 hit it first (2026-10-17), in a second tree under its scratch
directory, and could not run `npm run check` there. The orchestration skill now
tells gates and builders to put a second tree under `.claude/worktrees/`
instead (`roles/reviewer.md` and `roles/common.md` on #521), and dl-127's two
measurement worktrees under `/tmp` cannot pass typecheck either. That rule is a
workaround for one missing annotation.

## Reproduction

On `main` at `f3b9776b`, 2026-10-17, in a scratch directory under `/tmp`:
`git worktree add --detach <dir>/tree f3b9776b`, then in it
`bash /workspaces/tools/.claude/scripts/worktree-farm.sh`, `npm run build`
(exit 0), `npm run typecheck` → exit 1, with the one TS2883 line above and no
other error. The same sha under `/workspaces/tools/.claude/worktrees/` passed
`npm run check` for lg-23's gate.

## Build

1. Annotate `send`'s return type in `api/test/helpers/households.ts`. `fastify`
   re-exports the type as `LightMyRequestResponse`, so
   `import type { LightMyRequestResponse } from "fastify"` and
   `Promise<LightMyRequestResponse>` add no dependency. Then read every other
   exported function in `api/test/helpers/` for a return type inferred from a
   package the workspace does not depend on directly, and annotate those the
   same way.
2. Prove it where it failed: a worktree under `/tmp` at the branch head, farmed
   and built, `npm run typecheck` exit 0. Remove that worktree after.
3. In your report, name the sentences the orchestration skill can drop once
   this merges — `roles/reviewer.md`'s "Not under your scratch directory, nor
   anywhere outside `/workspaces/tools`…" and `roles/common.md`'s "a tree
   outside `/workspaces/tools` fails `npm run check`". Do not edit those pages:
   they change in the owner's review session.

## Done when

1. `npm run typecheck` exits 0 in a worktree under `/tmp` at the branch head,
   farmed and built — the command and its exit code in the Log.
2. `npm run check` exits 0 in the branch's own worktree.
3. The report names the skill sentences that become droppable.

## Review

**Gate: FAIL** — 2026-10-18 · `029641b4..83e4576e` · Sonnet 5.5, depth narrow (named attacks and the acceptance table, per the dispatch). The cause is one row, Done when 3, a line about the builder's report that a gate is not given and the Log does not carry; the code and Done when 1 and 2 are proven. If the orchestrator confirms the builder's report names the two sentences under F1, that row is **verified** on that reading and the gate is PASS.

| Done when                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `npm run typecheck` exits 0 in a worktree under `/tmp` at the branch head, farmed and built — the command and its exit code in the Log | **verified**, re-run by the gate: detached tree under `/tmp/claude-1000/…` at the head, farm exit 0, `npm run build` exit 0, `npm run typecheck` exit 0, 0 `error TS` lines, every test project built from scratch. **Positive control:** the same procedure at the base gives build exit 0, typecheck exit 1, one error, TS2883 at `tools/ledger/api/test/helpers/households.ts(67,23)`. The Log carries the command and the exit code (`npm run typecheck` exit 0). |
| 2. `npm run check` exits 0 in the branch's own worktree                                                                                   | **verified**, re-run by the gate: farmed and built tree at the head, `npm run check` exit 0 (lint, format check, typecheck); no lint warning in the one file the diff touches. Also exit 0 in the `/tmp` tree at the head, exit 1 there at the base with the same single TS2883.                                                                                                                                                                                      |
| 3. The report names the skill sentences that become droppable                                                                             | **unproven** — the gate is not given the builder's report, and the Log names no sentence. The two sentences the gate finds droppable are under F1, for the orchestrator to compare with the report.                                                                                                                                                                                                                                                                   |

- **med** · Done when 3 depends on it · F1: the Log records no list of droppable skill sentences, and the report that Done when 3 names is outside a gate's reading. The gate measured which sentences stop being true: in a tree outside `/workspaces/tools`, `npm run check` is exit 0 at the head and exit 1 at the base with the one TS2883. So (a) `roles/reviewer.md`, "What makes a gate worth its cost", the "Reproduce, do not assess" bullet: the sentence from "Not under your scratch directory, nor anywhere outside `/workspaces/tools`:" to "…where the same sha beside the agent worktrees passes." (the next sentence, on `cd` and the farm, stays true); (b) `roles/common.md`, "Your worktree", the "If the auto-mode classifier denies a temporary source mutation" bullet: the clause "a tree outside `/workspaces/tools` fails `npm run check`;" inside its parenthesis (the `cd`-in-a-separate-call trap stays). Repair: the orchestrator compares the report with (a) and (b), or the builder adds both to the Log. One caveat for the owner's review: `reference/worktree-hygiene.md` finds a forgotten second tree by its place under `.claude/worktrees/`, so drop the reasons and keep the placement.
- **low** · no `Done when` line depends on it · F2: the PR title and the commit `fix(ledger): annotate the test helper send's return type (lg-36)` touch one test helper and no shipped file, and `fix` is a visible type in `release-please-config.json` (`test` is `hidden`), so the merge lands a ledger "Fixes" line and a ledger release for no change to the artifact. Precedent is the other test-only `kind: fix` tickets (dl-123, dl-124), landed as `test(downloader)`. A `test(ledger): …` title with the same subject passes `node scripts/commit-message.mjs --text` (exit 0). The release effect is read from the config and CLAUDE.md, not run.
- **dropped** · "the annotation widens the type and hides a caller's error": refuted. A type-equality spec of the gate's own, copied into the ledger api's `test/` and removed after, compiles for `Awaited<ReturnType<typeof send>>` equal to `Response` from `light-my-request` and to `LightMyRequestResponse`, and not equal to `any` or `unknown`; its two controls (equal to `{ statusCode: number }`, equal to `any`) each fail TS2322. `fastify` declares `LightMyRequestResponse` as `Response as LightMyRequestResponse` from `light-my-request`, an alias of the same interface. The seven spec files that call `send` typecheck at the head.
- **dropped** · "another helper has the same shape": refuted for the ledger and for every other tool. Declaration emit of the node test project: 260 `.d.ts` at the base in a `/tmp` tree (the 261st, `households`, is the one the compiler refused), 261 at the head; no inline `import("…")` type and no bare specifier naming a package the owning workspace does not declare. Positive control: the same emit in a tree inside the repo root with the base's `send` gives 1 inline `import("light-my-request")` and 1 undeclared specifier of 261, `send` alone. The compiler's own count outside the root at the base is one error over every project, `web/test`, `e2e` and `scripts/test` included. The downloader's `api/test/helpers.ts` has the shape and already annotates it `Promise<LightMyRequestResponse>` from `fastify`.
- **dropped** · ticket `status` still `ready` at the head: the lander moves it with the record, and a review does not edit it. Not a defect.
- **ci** · `gh pr checks 536` at head `83e4576e`: `check` (both), `test (ubuntu-latest)`, `test (windows-latest, informational)`, `codeql`, `CodeQL`, `dependency-review` and `changes` pass; `docker` was still pending when read. No acceptance line rests on it, and the diff touches no `src`, `Dockerfile` or `package.json`.
- **findings** · the hunt returned 5; 2 carried (F1, F2), 3 dropped (above).
- NFR: security n/a · performance n/a · reliability ✓ (a type annotation, erased at runtime; the ledger project is 62 of 62 files and 1247 of 1247 tests, the Log's numbers) · maintainability — nothing guards the next helper with this shape (the Log names it as a decision about where such a check runs, outside the brief), recorded here and not a finding.

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), which
  ran the reproduction above and read the cause off the error's relative path:
  twelve `../` from the helper's directory to `/`, then into the shared
  `node_modules`.
- 2026-10-17 — Renumbered from lg-33 to lg-36: #523 filed its own lg-33 (rename a
  person) between this ticket's id check and its merge, and `main` carried two
  lg-33 files from #525's merge until this landed (`npm run status` → `"lg-33"
is used by more than one ticket`, exit 1).
- 2026-10-18 — Built on `lg-36-annotate-test-helper-return-types` from `main`
  029641b4; the fix is `e499389e`. Reproduced first, at 029641b4, in a detached
  tree under the builder's scratch directory: farm, `npm run build` exit 0,
  `npm run typecheck` exit 1, with the one TS2883 line and no other error.
  - The other exports of `api/test/helpers/`, read by `grep -n -A3 "^export"`
    over the directory and by the declaration emit (`tsc -p` into scratch, which
    wrote every helper's `.d.ts`): `send` was the only inferred return type
    naming a package outside the direct dependencies (`import("light-my-request")`).
    The rest are annotated, or infer from a direct dependency (`Database.Database`
    from `better-sqlite3`), a global (`RegExp`, `Date`), or string literals
    (`VERBS`, `as const satisfies`). No other helper changed.
  - After the annotation, at `e499389e`, in a detached tree under `/tmp`, farmed
    and built: `npm run typecheck` exit 0, and `npm run check` exit 0 there too.
    In the branch's own worktree `npm run check` exit 0, and
    `npm test -- --project ledger` exit 0: 62 of 62 files, 1247 of 1247 tests.
  - Not folded in: nothing else here became free. A guard against the next
    helper with this shape would have to typecheck from outside the repo root;
    that is a decision about where such a check runs, not a small piece, and it
    was not measured here.
- 2026-10-18 — Done when 3 ("the report names the skill sentences that become
  droppable") met by the orchestrator's comparison, under gate 1's own condition
  and its F1 remedy (2). The orchestrator compared the builder's report with
  gate 1's F1 (a) and (b) on 2026-10-18; the report names both:
  - (a) `roles/reviewer.md`, "What makes a gate worth its cost", the "Reproduce,
    do not assess" bullet: the paragraph beginning "Not under your scratch
    directory, nor anywhere outside `/workspaces/tools`: the farm's links
    resolve to the shared `node_modules` …" through "… where the same sha
    beside the agent worktrees passes."
  - (b) `roles/common.md`, "Your worktree", the "If the auto-mode classifier
    denies a temporary source mutation" bullet: the first clause of its
    parenthesis, "(a tree outside `/workspaces/tools` fails `npm run check`; a
    `cd` in a separate call farms the wrong tree)", with the `cd` clause kept.

  Both exist on `origin/main`:
  `git show origin/main:.claude/skills/orchestrate-tickets/roles/reviewer.md | grep -n "Not under your scratch directory, nor anywhere outside"`
  → `59:`;
  `git show origin/main:.claude/skills/orchestrate-tickets/roles/common.md | grep -n -A1 "a tree outside"`
  → `54:` and `55:`, with the `cd` clause on the second line.

- 2026-10-18 — Owner's answers, 2026-10-18, to gate 1's F2 and to the builder's
  open decision. F2 (title): retitle to `test(ledger): …`, the gate's
  recommendation, over keeping `fix(ledger)`;
  `node scripts/commit-message.mjs --text "test(ledger): annotate the test helper send's return type (lg-36)"`
  → exit 0. The builder's open decision (no guard for the next helper of this
  shape): "accept the gap, rely on review", the builder's recommendation, over
  filing `isolatedDeclarations` or an out-of-root CI job. Nothing is filed for
  either.
