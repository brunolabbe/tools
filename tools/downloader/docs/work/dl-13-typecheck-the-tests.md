---
id: dl-13
tool: downloader
title: Bring the test files and the e2e specs into the typechecker
kind: chore
status: done
milestone: null
depends_on: []
---

# dl-13 — The tests are not typechecked

**Area:** every `tsconfig.json` in the repo, plus `tsconfig.json` at the root
and whatever the fixes turn out to be under `test/`.

> **Why this is a downloader ticket.** The mechanism is repo-wide, the same way
> dl-10's was. `work/` exists only under a tool, and inventing a `repo-`
> namespace for the second time is worse than the precedent. The downloader owns
> it because it holds the largest untypechecked surface — 39 test files plus
> `e2e/` — and because `03-STATUS.md` is where the gap is
> written down. Applying the same pattern to `packages/` and to the planner is
> part of the ticket, not a follow-up: a convention that half the repo follows
> is not a convention.

## Why

Every project's `include` is `src/**`. Nothing else. So `npm run check` — which
is what the repo means by "done" — typechecks no test file in any workspace:

| Project                           | Test files |
| --------------------------------- | ---------- |
| `tools/downloader/api/test`       | 12         |
| `tools/downloader/engine/test`    | 12         |
| `tools/downloader/resolvers/test` | 7          |
| `tools/downloader/web/test`       | 7          |
| `tools/downloader/contract/test`  | 1          |
| `tools/downloader/e2e`            | 2          |

`e2e/` is in the worse position of the two: it is in no `tsconfig.json` at all,
and Playwright transpiles it without checking, so a selector helper that has
drifted from the component it selects fails after a browser has launched and a
clip has been segmented, rather than in a second at the terminal.

The cost is not hypothetical. `helpers.ts`, the fake clock, the fixture servers
and the fake binaries are _shipping code that only tests consume_ — a fake with
a signature that no longer matches the real thing silently tests nothing, and
that is exactly the failure a compiler catches for free. dl-12's log records
`ytdlp.ts` needing no code change but "never having been tested"; the same
blind spot applies one level up, to the tests themselves.

The repo already pays for the answer. `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` are on in `tsconfig.base.json`, and the test files
have never once been held to them.

## Build

1. **A test project per package.** `<package>/test/tsconfig.json`, extending
   `tsconfig.base.json`, including `test/**/*.ts` (`.tsx` too where the package
   has React — see dl-15), and referencing its own `src` project plus whatever
   else its tests import. Register each in the root `tsconfig.json` so
   `tsc --build` reaches them and `npm run check` stays the single gate. Do not
   add a second npm script: a check someone has to remember to run is a check
   that does not run.
2. **Decide the emit question and write it in the Log.** `tsc --build` wants
   composite projects, composite wants declarations, and nothing should be
   emitting `.d.ts` for a test file. Whatever you choose — a throwaway `outDir`
   that `.gitignore` covers, or whatever the pinned TypeScript (7.x, the native
   compiler) supports for a checked-but-not-emitted project — say which and why,
   because the next person will be tempted by the other one. What is not
   negotiable: no test artefact reaches a package's published `dist`, and
   `npm run build` does not get slower.
3. **`e2e/` gets one too**, with `@playwright/test` types and the `web`
   project's DOM lib. It references `engine` — `hls-origin.ts` imports
   `resolveFfmpegPath` — so it is a real consumer of the build graph, not a
   loose folder.
4. **Fix what it finds, without weakening anything.** Expect a pile of
   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` failures; they
   are the point. Do not add `any`, do not relax a compiler option for tests,
   and do not sprinkle `!` to make the list go away — an index that a test knows
   is populated is a test that should assert it is populated. Where a test
   deliberately passes a wrong-typed value to prove a guard rejects it, cast at
   that one call with a comment saying so.
5. **`scripts/test/` is a judgement call.** The `repo` vitest project tests
   `scripts/commit-message.mjs`, which is plain `.mjs` and deliberately outside
   the `tsc --build` graph. Either bring the test in with `allowJs` and no
   `checkJs`, or leave it out on purpose. Either is defensible; leaving it out
   silently is not.
6. **Then the other workspaces**, `packages/core` and every `tools/planner/*`,
   by the same pattern. If the pattern does not transfer, the pattern is wrong.

**Traps.**

- Tests import `test`/`expect` from `vitest` explicitly — globals are off — so
  no ambient type package is needed and none should be added. If a test project
  needs `types: ["vitest/globals"]`, something has gone wrong upstream of it.
- Relative imports carry `.ts` extensions (`allowImportingTsExtensions` plus
  `rewriteRelativeImportExtensions`); test projects inherit that from the base
  and must not fight it.
- `web` is `moduleResolution: "Bundler"` and `emitDeclarationOnly` while every
  other project is `NodeNext`. Its test project has to follow `web`, not the
  base's default.
- A test that imports a sibling package's _test_ helper is the one import this
  should not make easy. If one exists, that is a finding for the Log.

## Done when

- `npm run check` typechecks every file under every `test/` directory and under
  `e2e/`, and fails when a test does something the compiler should refuse.
- Proved by doing it rather than asserted: break a fake's signature, run
  `npm run check`, watch it fail, put it back.
- `npm test` and `npm run e2e:downloader` pass unchanged — this ticket fixes
  types, not behaviour. Any test whose _behaviour_ had to change is called out
  in the Log, because that means it was passing for a reason nobody knew.
- `npm run build` emits nothing new into any package's `dist`.
- The "test files are still not typechecked" entry in
  `03-STATUS.md` is gone rather than reworded.

## Log

**2026-08-14 — done.** Eleven test projects plus `e2e/`, all registered in the
root `tsconfig.json`, no second npm script. `npm run check` green, 573 tests
across 42 files pass, the 3 e2e specs pass, `npm run build` emits the same file
set it did before.

**The emit question (step 2): `noEmit: true`, not a throwaway `outDir`.** The
pinned TypeScript — 7.0.2, the native compiler — accepts `composite` together
with `noEmit`, which older versions refused. A test project's only output is its
`.tsbuildinfo`, which is what still lets `tsc --build` skip an unchanged one, and
`*.tsbuildinfo` was already in `.gitignore`. The `outDir` alternative would have
put a build directory beside every suite for files nobody ever loads. `npm run
build` is untouched either way: it runs each workspace's own `tsc --build`, and
no source project references a test project, so the test graph is only ever
reached through the root.

**The brief missed the trap that produced most of the errors.** The first run
was ~40 failures and almost all of them were TS2878, "unsafe to rewrite because
it resolves to another project" — `rewriteRelativeImportExtensions` is on in
`tsconfig.base.json`, and every `import "../src/foo.ts"` from a test crosses
from a project that emits nothing into one that emits to `dist/`, so there is no
output-relative path to rewrite to. It is off in `tsconfig.test-base.json`. This
is correct rather than a workaround: the option exists so emitted JS keeps
resolving, and these projects emit nothing. Vitest loads the `.ts` directly.

**Three real defects, which is the point of the ticket.**

- `api/test/helpers.ts` — the stub engine's `collectGarbage` returned
  `{ removedOutDirs: 0, removedTmpDirs: 0 }` where `GcReport` declares
  `string[]`. Exactly the drifted fake the Why predicted. What hid it was
  `return engine as DownloadEngine & { calls: number }` — a cast asserts,
  it does not check. It is `satisfies` now, and the fake passes it unchanged
  otherwise, so nothing else had drifted. The two inner casts on `config` and
  `storage` stay: the API reads one field of each and stubbing either type whole
  would be noise.
- `engine/test/quota.test.ts` — its `variant()` helper never set `label`, which
  is required on `MediaVariant`. Every variant that suite fed the engine was an
  invalid one.
- `web/test/job-stream.test.ts` — a completed-job event carried
  `transcoded: false`, a field `JobResult` has never had.

No test's _behaviour_ had to change; all three were fixes to the fixture data
and none of them altered an assertion.

**`scripts/test` (step 5): brought in, not left out.** `commit-message.mjs`
stays plain JS — the commit hook runs it under bare node with no build step —
but the test is TypeScript and asserts the `{ ok, errors }` shape that the hook
and the CI gate both read, so `allowJs` (with `checkJs` off) gets `validate`'s
inferred signature checked at the call sites. The `.mjs` is named in `include`
because a composite project must list every file in its program.

**One project per package, not one at the root** — and the reason is narrower
than it looks, so it is worth stating precisely. `moduleResolution`, `lib`,
`jsx`, `types` and `allowJs` are per-project, and this repo needs four different
combinations of them (`web` is Bundler + DOM + JSX, `e2e` adds Playwright's
types, `scripts/test` needs `allowJs`, everything else is NodeNext with node
globals only). That is decisive: they cannot be one project. The split also
scopes ambient globals, which is enforced — an `api` test naming `document`
fails to compile.

> **Superseded the same day — see the 2026-08-14 (later) entry.** The four
> combinations were real; "therefore one project per package" did not follow
> from them. Eight of the eleven shared a single combination.

It does **not** enforce import isolation, and an earlier draft of these comments
claimed it did. Project references order the build; they do not restrict module
resolution. A downloader test importing `@planner/contract` compiles clean,
exactly as the same import in `src` would. The no-cross-tool rule is the root
`CLAUDE.md`'s and stays a review rule. Verified by trying it, not assumed.

The eleven files are thin because the shared options live in
`tsconfig.test-base.json` at the root; eight of them are five lines.

**2026-08-14 (later) — eleven test projects collapsed to four.** Same coverage,
same gate, same enforcement; twelve config files became four.

The entry above got the analysis right and the conclusion wrong. Four
_compiler-option combinations_ exist, so four _projects_ are needed — but the
step from there to eleven projects was never argued, and eight of them were the
same five lines differing only in an `include` and a reference list. Neither of
those is a reason to be a separate project: an `include` is a glob, and a
reference list that only orders the build can be one list.

What exists now:

- `tsconfig.tests.json` at the root — every suite that runs under node, via
  `include: ["packages/*/test/**/*.ts", "tools/*/*/test/**/*.ts"]` with
  `tools/*/web/test/**` excluded. Eight suites, 40 files, one file. It also
  absorbed `tsconfig.test-base.json`, which no longer exists: a base extended by
  four files, one of which held the same options, was a level of indirection
  paying for nothing. The other three extend `tsconfig.tests.json` directly.
- `tools/downloader/web/test`, `tools/downloader/e2e`, `scripts/test` — the
  three that genuinely differ, each now overriding only what makes it different.

The glob is the point: a new package with node tests now costs one `references`
line rather than a new file, and `tools/*/web/test/**` is excluded by pattern,
so the planner's web suite lands in the right project the day it exists instead
of the wrong one silently.

**Two compiler constraints shape this, and both were found by trying to remove
them rather than reasoned about.** They are the answer to "why not just one
tsconfig at the root", which is the obvious question and deserves a real answer:

- **`references` cannot be dropped, and cannot be a glob (TS6307).** Tests
  import their subject relatively — `import "../src/context.ts"`. Deleting the
  reference list does not fall back to package resolution; tsc pulls that source
  file into the _test_ program as a loose member and then fails on every module
  it imports in turn, ~40 errors deep. The reference is what redirects the
  specifier to the built project, and TypeScript has no glob form for it.

  **The rider on this — "forgetting an entry is a hard error rather than a
  silent gap" — was wrong**, and only removing entries one at a time showed it.
  Deleting the _whole_ list fails loudly, which is what was measured and then
  over-generalised. Per entry: dropping `tools/downloader/api` gives 26 ×
  TS6307, because nothing else references `api` and it becomes unreachable;
  dropping `tools/downloader/engine` is **green**, because `api` still
  references it and redirection follows the graph transitively rather than only
  direct entries; dropping `packages/core` is **green**, because its one suite
  reads source files as text and imports nothing from `../src`. The loud
  failure lands only for a leaf package whose tests import their own `src`.
  Every other entry is redundant right until the graph shifts under it, which
  is when nobody is looking — so the list stays complete for that reason, not
  because each line individually earns it.

- **The root `tsconfig.json` cannot itself be the test program (TS6310).** A
  solution file may reference a `noEmit` project; a project with files of its
  own may not. Every test project is `noEmit`, so the moment the root grows an
  `include` it can no longer reference the three special test projects. That is
  the whole reason `tsconfig.tests.json` is a second file and not just the root,
  and it is why the reference list appears in two places — the root's is the
  repo inventory, and it is deliberately kept complete so that a package with no
  tests (`tools/planner/web` today) is still typechecked rather than dropping
  out of the graph unnoticed.

**Two silent gaps in the first version of the collapse, both found by review and
both fixed here.** The glob is what makes this layout cheap, and both bugs were
the same mistake: a glob that is wrong in the _quiet_ direction.

- **`exclude` was `tools/*/web/test/**`; it is now
  `tools/downloader/web/test/**`.** The generic form reads better and is a trap.
  It excludes web tests in every tool, including tools with no project to catch
  them, so a file at `tools/planner/web/test/probe.test.ts` belonged to no
  project at all — `npm run check` passed clean with a blatant `TS2322` in it.
  That is this ticket's own failure mode, re-armed for whichever tool grows web
  tests next. With one concrete path, the same file lands in the node project
  and fails loudly until someone gives it a project and a reference. **Rule:
  adding a tool must not be able to open a silent gap.** Verified both ways.
- **`include` was `*.ts` only; it now covers `*.tsx` too.** `vitest.config.ts`
  collects `*.test.{ts,tsx}` for both tools, so a `.tsx` test outside `web`
  would have _run_ while being invisible to the compiler. A `.tsx` probe in
  `packages/core/test` passed `npm run check`; with the glob widened it fails.
  The rule the include now follows is **anything vitest can run, tsc must
  check** — a `.tsx` in a node package is then either fine or a loud TS17004,
  and neither is silence.

- **The `tools/*/web/test/**` carve-out is a design choice, not a necessity —
  and the first comment written for it claimed otherwise.** Dropping the
  `exclude` and adding a `tools/downloader/web` reference typechecks green: the
  current web suite is reducers, a job store and presentation helpers, and
  touches no DOM global (the only `window` in it is inside a test title). So the
  carve-out is not holding back a compile error today. What it does hold is that
  a test file belongs to exactly one project — without it those seven files are
  checked twice under two different surfaces with nothing saying which answer is
  authoritative — and that they are checked the way they run: `web` is
  `moduleResolution: "Bundler"`, so a specifier Vite resolves and NodeNext does
  not is caught at the gate rather than at build time. The DOM half of the
  justification only starts paying when dl-15's component tests land.
- **`extends` inherits `exclude` but not `references`.** Verified with
  `tsc --showConfig`. The three children restate `exclude` for that reason: the
  root's `tools/*/web/test/**` would otherwise leave `web/test` with an empty
  program — a config that typechecks nothing and reports success. Confirmed the
  other way too: `--listFiles` shows 7 files in `web/test`, 40 in the node
  project.

**What was checked, not assumed.** `document` in an `api` test still fails to
compile (TS2584) — the isolation the split buys survives, because the DOM lib
still reaches only the two projects that should have it. Reverting
`collectGarbage` to the `number` version still fails `npm run check` with
TS2322, which is the ticket's own proof re-run against the new shape. Every
project's program was counted with `--listFiles` rather than inferred from a
clean compile, because an empty glob also compiles clean. Proved from cold, too:
deleting every `.tsbuildinfo` and every `dist/` and rebuilding is green, so the
graph does not depend on stale output.

573 tests across 42 files pass, `npm run check` is green, and `npm run build`
emits no new artefact — no source project references a test project, so the test
graph is still only ever reached through the root.

**What was given up.** Per-package incremental typechecking of tests: touching
`packages/core/src` now re-checks all 40 test files rather than one suite's.
That is a single 40-file program and it is not measurable here. And a `test/`
directory no longer declares its own dependencies — but that list was only ever
build ordering, never enforcement, as the entry below this one already records.

**Trap for the next person.** The brief warned that a test importing a sibling
package's _test_ helper would be a finding. There is none — every test's
non-relative imports are published package entry points. `engine/test/helpers/`
and `resolvers/test/browser/helpers/` are consumed only within their own suite.

**Proved by breaking it**, as "Done when" asks: reverting `collectGarbage` to
the `number` version fails `npm run check` with TS2322 and TS1360 at
`helpers.ts`, and restoring it goes green.

**Repo-wide, per the ticket's framing:** `packages/core` and all three
`tools/planner/*` packages with tests got the same pattern, and it transferred
without modification. The convention is written down in the root `CLAUDE.md` —
in Testing, and in step 3 of "Adding a tool", so a new tool picks it up.
