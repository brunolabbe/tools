---
id: lg-33
tool: ledger
title: A test helper's inferred return type fails typecheck in any worktree outside the repo root (TS2883)
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# lg-33 — A test helper's inferred return type fails typecheck outside the repo root

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

## Log

- 2026-10-17 — Filed from the owner's review of #521 (session tools-d3), which
  ran the reproduction above and read the cause off the error's relative path:
  twelve `../` from the helper's directory to `/`, then into the shared
  `node_modules`.
