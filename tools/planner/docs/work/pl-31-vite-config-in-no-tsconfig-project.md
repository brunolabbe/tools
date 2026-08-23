---
id: pl-31
tool: planner
title: Put the web vite.config.ts into a tsconfig project, so npm run check reads it
kind: chore
status: ready
milestone: null
depends_on: []
---

# pl-31 — `tools/planner/web/vite.config.ts` is typechecked by nothing

**Packages:** `tools/planner/web`

## Why

`npm run check` never reads `tools/planner/web/vite.config.ts`. The file belongs
to no tsconfig project, so `tsc --build` walks straight past it and any error in
it is invisible until someone starts the dev server or the bundle is built.

Found by a parallel session (`tools-45`) while fixing the downloader's identical
gap; credited there rather than discovered here.

### Which projects exist, and why none of them claims the file

Four configs could plausibly cover it, and each excludes it for a different
reason:

- **`tools/planner/web/tsconfig.json`** — the source project.
  `"include": ["src/**/*.ts", "src/**/*.tsx"]`. The config sits beside `src/`,
  not inside it.
- **`tools/planner/web/test/tsconfig.json`** — the `web` test surface.
  `"include": ["**/*.ts", "**/*.tsx"]`, and an `include` is rooted at its own
  directory, so it reaches `test/` and nothing above it.
- **`tsconfig.tests.json`** — the node surface. Its `include` is
  `["packages/*/test/**/*.ts", "packages/*/test/**/*.tsx", "tools/*/*/test/**/*.ts", "tools/*/*/test/**/*.tsx"]`,
  every pattern anchored at a `test/` directory; and its `exclude` names
  `["tools/downloader/web/test/**", "tools/planner/web/test/**"]` anyway.
- **The root `tsconfig.json`** — `"files": []`, deliberately. It is a solution
  file, an inventory of references and nothing else, so it contains no file of
  its own by construction.

`tools/planner/web/vite.config.ts` matches none of those globs. There is no
fifth project.

### Demonstrated

A deliberate error appended to the file:

```ts
const deliberateTypeError: number = "pl-31 probe";
export { deliberateTypeError };
```

Then, **cold** — every `.tsbuildinfo` in the tree deleted first, because an
incremental `tsc --build` can skip a project entirely and a green run would then
prove nothing:

```
$ find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete
$ npm run check
… lint, format, and a full tsc --build of every project …
                                                                       # exit 0
```

**Exit 0.** `TS2322` is not reported, and the string `vite.config` does not
appear anywhere in the 83 lines of output. On `60e48e7` (`origin/main`).

The same probe with PR #78's fix applied to
`tools/planner/web/test/tsconfig.json`, again cold:

```
$ npm run check
tools/planner/web/vite.config.ts(55,7): error TS2322: Type 'string' is not assignable to type 'number'.
                                                                       # exit 1
```

So the gap is real and the one-line fix closes it. Both probes were reverted.

### Why this is a ticket and not a nit

The downloader had the identical gap and it is being closed on PR #78, which
adds `../vite.config.ts` to `tools/downloader/web/test/tsconfig.json`. The two
tools' `web` test configs are otherwise near-twins — the planner's says so in
its own header comment, _"this config is deliberately its twin"_ — so when #78
lands the planner is the odd one out, with the divergence sitting in the one
line that decides whether a file is checked at all.

More to the point, it is the failure mode the root `CLAUDE.md` already names.
Its Testing section explains why `tsconfig.tests.json`'s `exclude` lists
concrete paths rather than a wide pattern:

> The `exclude` names `tools/downloader/web/test/**` and nothing wider on
> purpose — a pattern that pre-excluded every tool's `web` would drop a new one
> into no project at all, and pass green while checking nothing.

"In no project at all, and passes green while checking nothing" is exactly the
state `tools/planner/web/vite.config.ts` is in — arrived at from the other
direction. The rule was written about a test directory that an over-broad
`exclude` could orphan; this is a source file that no `include` ever claimed.
The guard against the first was written down and the second was never
considered, which is why the same outcome reached the repo through a door nobody
was watching.

**Kind is `chore`, not `fix`, and deliberately.** There is no defect in the
planner's `vite.config.ts` today — cold `npm run check` is green with the file
untouched, and its `HOST` handling is already the shape dl-22 gives the
downloader's. What is broken is the reach of the gate, not the file it fails to
read.

## Build

1. **`tools/planner/web/test/tsconfig.json`** — add `../vite.config.ts` to
   `include`:

   ```json
   "include": ["**/*.ts", "**/*.tsx", "../vite.config.ts"],
   ```

   That is the whole change. It is what PR #78 does for the downloader — see
   `git show origin/worktree-dl-22-web-binds-host -- tools/downloader/web/test/tsconfig.json`
   — and it is the same move `tools/planner/e2e/tsconfig.json` already makes to
   pull in `playwright.config.ts` from a directory up.

2. **Update the comment above `include`, and say why the file is there.** #78's
   wording is a good model; the planner's reason is its own — the `web` project
   above includes `src/**` only, so the config was in no project at all. A bare
   third entry in a glob list is the kind of line a later reader deletes as
   redundant.

3. **Do not put it in `tools/planner/web/tsconfig.json` instead**, which is the
   obvious-looking alternative and does not work. That project emits
   (`emitDeclarationOnly`, `rootDir: "./src"`, `outDir: "./dist"`), so a file
   above `rootDir` is rejected. Measured, adding `"vite.config.ts"` to its
   `include` and running cold:

   ```
   error TS6059: File '…/tools/planner/web/vite.config.ts' is not under 'rootDir'
   '…/tools/planner/web/src'. 'rootDir' is expected to contain all source files.
                                                                       # exit 2
   ```

   It also drops a stray `vite.config.d.ts` and `.d.ts.map` beside the config on
   the way out, which nothing cleans up. The test project is `noEmit` —
   inherited from `tsconfig.tests.json` — which is why it is the one that can
   hold a config file.

4. **Verify cold**, both with and without a probe error:

   ```bash
   find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete
   npm run check
   ```

   For the reason above: an incremental run can skip the project and report
   exit 0 having compiled nothing.

5. **Decide whether the planner also wants a `vite-config.test.ts`, and say
   which in the Log.** PR #78 adds `tools/downloader/web/test/vite-config.test.ts`
   alongside its tsconfig change, because dl-22 has behaviour to assert — the
   dev server binding `HOST`. The planner's config already reads `HOST` the same
   way, so there may be nothing here that a test would newly prove. This ticket
   is scoped to the tsconfig line; if a test is wanted, file it rather than
   growing this one.

## Done when

- `tools/planner/web/test/tsconfig.json`'s `include` names `../vite.config.ts`,
  with a comment saying why, and no other config changed.
- A deliberate type error in `tools/planner/web/vite.config.ts` fails
  `npm run check` by file, line and TS code — verified after deleting every
  `.tsbuildinfo` in the tree, not on an incremental run. The probe is reverted.
- With no probe, cold `npm run check` is green.
- `npm test` is green, and `npm run build -w @planner/web` still produces a
  bundle — the config is now in a `noEmit` project as well as being Vite's
  input, and neither should disturb the other.
- The Log records step 5's decision.

## Log

_Not started._
