---
id: pl-31
tool: planner
title: Put the web vite.config.ts into a tsconfig project, so npm run check reads it
kind: chore
status: done
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

## Review

### Gate 1 — 2026-08-24 — `pl-31-vite-config-project` — **PASS**

Verbatim from the reviewer's report, which was written in a worktree that is now
discarded. Only two things were adjusted, neither of them content: the report's
own heading levels are shifted to nest under this section, and its title line is
folded into the heading above. Every finding is here, including the three that
asked for no change.

**Citations re-resolved against `df93d53`**, the tree this gate reviewed, as the
last action before committing — programmatically, each cited `file:line` checked
to still hold what the record claims, after `npm run format` had run. All 18
resolve except one, corrected here: section 2 put `"types": ["node",
"vite/client"]` one line early in `tools/planner/web/test/tsconfig.json` — line
14 rather than `:15`, which is where it is.
The coordinate was off by one when the report was written — nothing moved it —
and the line it names is the one the finding is about, so only the number
changed. The commit that adds this section touches only this file, which no
citation names by line. The two `vite.config.ts(l,c)` coordinates are compiler
output from probes that were reverted, not citations into the tree; F3 says so
itself.

Reviewed at branch tip `df93d53`, base `567f9e5`. Diff is 3 files: one `include`
entry plus a comment in `tools/planner/web/test/tsconfig.json`, the pl-31 Log,
and a new `pl-32`. No shipped code changes.

This gate was interrupted mid-run by a session usage limit and resumed. Worktree
state was re-verified before any evidence below was gathered: `git status` clean,
`git stash list` empty, `HEAD` = `df93d53`, `git diff df93d53` empty, no stray
`vite.config.d.ts`. Nothing is carried across the cut.

#### 1. The negative half, with the harness proved first

**Positive control: cold `npm run check` on the clean branch exits `0`.** Zero
`error TS`, and `Building project 'tools/planner/web/test/tsconfig.json'...`
appears in the `--verbose` output — the project genuinely compiled, it was not
skipped. Every `.tsbuildinfo` outside `node_modules` deleted first.

An independent probe, different construct and location from the builder's
(builder: TS2322 appended at 55,7; reviewer: an arity error inside the config
object at line 30):

```
tools/planner/web/vite.config.ts(30,35): error TS2554: Expected 0-1 arguments, but got 2.
```

exit **1**.

Same probe with `tools/planner/web/test/tsconfig.json` reverted to `567f9e5`:
exit **0**, `error TS` count `0`, and the string `vite.config` appears **nowhere**
in the output — while `Building project 'tools/planner/web/test/tsconfig.json'...`
still appears. The one added line is load-bearing; the error is not being caught
by anything else.

#### 2. The surface question

**Which project holds the file:**
`tsc -p tools/planner/web/test/tsconfig.json --listFiles` lists
`tools/planner/web/vite.config.ts`. The `web` src project lists it `0` times. A
grep of every `tsconfig*.json` finds it named only in the two `web/test` configs.
No double membership: `tsconfig.tests.json`'s `include` is anchored at `test/`
and its `exclude` names `tools/planner/web/test/**`, neither of which reaches
`web/vite.config.ts`.

**Does the surface catch a realistic node mistake?** Yes, precisely:

| probe                               | resolved type         | verdict                                |
| ----------------------------------- | --------------------- | -------------------------------------- |
| `process.env["HOST"]`               | `string \| undefined` | node types real and strict             |
| `process.cwd()`                     | `string`              | node types real                        |
| `resolve("a","b")` from `node:path` | `string`              | `node:` builtins resolve under Bundler |

`"types": ["node", "vite/client"]` at `tools/planner/web/test/tsconfig.json:15`
supplies this. The `web` **src** project has only `["vite/client"]`, so the test
project has strictly more node reach, not less.

#### 3. `pl-32` and the CI gate

- **Id is free.** `git ls-tree origin/main tools/planner/docs/work` tops out at
  `pl-31`; `gh pr list --state open` returns `[]`;
  `git log --all --diff-filter=A` shows `pl-32-vite-config-test.md` added on this
  branch only. Checked by file, not by log subject or PR title.
- **Frontmatter valid** against `docs/01-TICKETS.md`: all six parsed fields
  present, `kind: chore` and `status: ready` in the allowed lists, `id` agrees
  with the filename, `depends_on: [pl-31]` is a list of real ids.
- **Gate verified red first.** `node scripts/status.mjs --json > /dev/null` -> `0`.
  Repointed `depends_on` at `pl-999` -> stderr
  `depends_on "pl-999", which is not a ticket`, exit **1**. Restored -> `0`. The
  green is evidence because it was seen to go red.
- `npm run status -- --show pl-32` renders fields, path, `depends on pl-31`,
  `unblocked`.

#### 4. Citations — all resolved, none sampled

**~42 citations resolved across the Log, `pl-32` and the new comment. Zero
failed.** Sweep was unfiltered (`git grep` with no `--include`, plus `grep -rn`
for `pl-32` across all file types) and covered the other names of the thing —
bare ids `repo-5`, `dl-22`, `pl-31`, `tools-45`, and both file slugs. **There are
zero markdown links in the added text**, so there were no `#anchor` targets to
follow.

Spot-checks worth naming:

- `docs/work/repo-5-lift-the-host-resolution.md` — exists, `status: ready`
  (genuinely open), and its acceptance reads "the behaviour dl-22 pinned must
  survive the move, proven by the tests that pinned it rather than by hand". The
  Log's and pl-32's use of it is accurate, including the quoted fragment.
- `tools/downloader/web/test/vite-config.test.ts` — every mechanism pl-32's Build
  claims is there: `vi.resetModules()` at :20 before
  `await import("../vite.config.ts")` at :24, ambient `HOST` restored in
  `afterEach` at :28-31, `expect(server?.host).toBe(false)` at :44 with the "not
  the string `localhost`" comment at :42-43, port/`strictPort` at :50-51.
- `vitest.config.ts:55` — `include: ["tools/planner/*/test/**/*.test.{ts,tsx}"]`,
  so pl-32's "no new project file is needed" is correct.
- `tools/planner/e2e/tsconfig.json:23` —
  `"include": ["**/*.ts", "../playwright.config.ts"]`. The comment's analogy is
  exact.

#### 5. The three repo-level assertions

- **TS6059 / "the src project could not take the file anyway"** — **true,
  reproduced verbatim.** Adding `"vite.config.ts"` to
  `tools/planner/web/tsconfig.json`'s include yields
  `error TS6059: File '.../tools/planner/web/vite.config.ts' is not under
'rootDir' '.../tools/planner/web/src'`, and drops `vite.config.d.ts` and
  `vite.config.d.ts.map` beside the config. Both reverted.
- **`npm run build -w @planner/web` still bundles** — **true.** From a deleted
  `dist`: `tsc --build && vite build`, 136 modules,
  `dist/app/assets/index-DAGvF8Ts.js` at **311.61 kB**, matching the Log. No
  stray `.d.ts` beside the config afterwards.
- **`.devcontainer/devcontainer.json` forwards 5183** — **true.** `:102`
  `"forwardPorts": [8080, 5173, 8099, 8090, 5183]`, `:108` labels `5183`
  "planner web". `tools/planner/Dockerfile:110` is `ENV HOST=0.0.0.0`.

#### Findings

**F1 — low. DOM globals are in scope for a config Vite executes in Node. No
change requested.**
`tools/planner/web/test/tsconfig.json:11` (`"lib": ["ES2023","DOM","DOM.Iterable"]`)
now applies to `tools/planner/web/vite.config.ts` via `:23`. `document.title`,
`window.innerWidth` and `localStorage.getItem` all resolve inside the config.
_Scenario:_ someone adds `define: { __W__: window.innerWidth }`; it typechecks,
`npm run check` is green, and Vite throws `ReferenceError: window is not defined`
while loading the config.
_Why no change:_ identical to `tools/downloader/web/test/tsconfig.json:20`, so it
is the repo's established pattern rather than a new deviation; the realistic
mistake class (node APIs) is caught precisely, as measured in section 2; and
before this branch the file was in **no** project, so nothing was caught at all.
The only fix would be a sixth project for two config files, which is what
`tsconfig.tests.json`'s own comment argues against. Recorded so the next reader
knows it was looked at, not missed.

**F2 — informational. `npm run check` short-circuits at lint, which can fake a
"before" reproduction. No change requested.**
`npm run check` is `lint && format:check && typecheck`, and oxlint already read
`vite.config.ts` before this branch. A first probe — an unused local — failed the
gate **with the tsconfig line reverted**, via `error eslint(no-unused-vars)`,
never reaching tsc. It proves nothing about the tsconfig. The gap was re-proved
with a lint-clean probe. The ticket's claims are all correctly scoped to
_typechecking_, so nothing in it is misleading; recorded because the next person
reproducing the "before" state will hit this trap.

**F3 — trivial. Ephemeral line coordinate. No change requested.**
The Log cites `vite.config.ts(55,7)`; the committed file is 53 lines, so that
coordinate exists only with the probe appended. The Log says the probe was
appended, so it is not wrong — noted only because a reader grepping line 55 finds
nothing.

#### Acceptance

| Done when                                                                               | Verdict  | Proof                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include` names `../vite.config.ts`, comment says why, no other config changed          | verified | `tools/planner/web/test/tsconfig.json:17-23`; `git diff 567f9e5..df93d53 --stat` = 3 files, only that config                                                            |
| Deliberate type error fails cold `npm run check` by file, line, TS code; probe reverted | verified | independent probe -> `tools/planner/web/vite.config.ts(30,35): error TS2554`, exit 1; same probe with the line reverted -> exit 0, `error TS` count 0, file never named |
| With no probe, cold `npm run check` green                                               | verified | cold `npm run check` exit 0, 0 `error TS`, `Building project 'tools/planner/web/test/tsconfig.json'` present                                                            |
| `npm test` green, `npm run build -w @planner/web` still bundles                         | verified | planner project 49 files / 699 tests green; cold-`dist` build 136 modules, `index-DAGvF8Ts.js` 311.61 kB, no stray `.d.ts`                                              |
| Log records step 5's decision                                                           | proven   | pl-31 Log final bullet + `tools/planner/docs/work/pl-32-vite-config-test.md`                                                                                            |

#### What this gate did NOT do

- **The planner e2e suite and the container image gate do not run in this loop.**
  They live in `.github/workflows/planner.yml` and only there. No coverage of
  either is implied. Mitigating but not a substitute: this branch changes no
  shipped code — one tsconfig `include` entry and two markdown files — and the
  `web` bundle output is byte-identical to what the Log recorded.
- Did not re-run the full 1508-test suite (settled before this gate ran). Ran
  `npm test -- --project planner`: 49 files, 699 tests, green.

## Log

- **2026-08-23** — Built. One line changed:
  `tools/planner/web/test/tsconfig.json`'s `include` now names
  `../vite.config.ts`, with a comment above it saying why the file is there —
  the `web` project beside it includes `src/**` only and could not take the file
  anyway, so until now it was in no project at all.

- **The brief was right on every measurement it made, and I re-took them all in
  this worktree rather than trusting them.** All four runs below deleted every
  `.tsbuildinfo` outside `node_modules` first, and `npm run typecheck` is
  `tsc --build --verbose`, so each run printed
  `Building project 'tools/planner/web/test/tsconfig.json'...` and the green ones
  are green because the project compiled, not because it was skipped.

  1. Probe appended to `vite.config.ts`, fix reverted (`git stash` of the one
     file): **exit 0**, and neither `error TS` nor `vite.config` appears
     anywhere in the output. The gap is real on `567f9e5`.
  2. Probe present, fix applied: **exit 1**, with
     `tools/planner/web/vite.config.ts(55,7): error TS2322: Type 'string' is not
assignable to type 'number'.`
  3. Probe reverted (`git checkout --`, then diffed against a copy taken before
     it was appended), fix applied: **exit 0**.
  4. The rejected alternative from step 3 of the brief, confirmed rather than
     taken on faith — `"vite.config.ts"` added to `tools/planner/web/tsconfig.json`:
     `error TS6059: File '…/tools/planner/web/vite.config.ts' is not under
'rootDir' '…/tools/planner/web/src'.` It also dropped a `vite.config.d.ts`
     and a `.d.ts.map` beside the config, exactly as the brief warned. Both
     reverted, both stray files deleted.

- `npm run build -w @planner/web` after deleting `tools/planner/web/dist`:
  `tsc --build && vite build` green, 136 modules, `dist/app/assets/index-*.js`
  at 311.61 kB. Being in a `noEmit` project as well as being Vite's input
  disturbs neither, and no stray declaration lands beside the config.

- Gates: cold `npm run check` green (lint's 16 `no-await-in-loop` warnings are
  pre-existing and are warnings), `npm test` green — 103 files, 1508 tests.

- **Step 5's decision: yes, the planner wants a `vite-config.test.ts`, and it is
  filed as pl-32.** The brief's doubt was that the planner's config "already
  reads `HOST` the same way", so a test might prove nothing new — but reading it
  the same way is not the same as anything asserting it. This ticket makes a
  _type_ error in the file fail the gate; a _value_ regression — `host:
"localhost"`, `strictPort: false`, a port that is no longer the 5183
  `.devcontainer/devcontainer.json` forwards — still typechecks perfectly and
  still produces the silent blank page the docblock describes. repo-5 is what
  settles it: it asks whether the `HOST` resolution lifts to `packages/`, and
  its acceptance requires the pinned behaviour to survive the move "proven by
  the tests that pinned it". Only the downloader has those tests today, so a
  lift could change what the planner binds with the suite staying green. Scoped
  out of here per the brief's own instruction to file rather than grow.
