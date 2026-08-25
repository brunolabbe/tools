---
id: pl-32
tool: planner
title: Pin the planner dev server's HOST, port and strictPort in a test
kind: chore
status: done
milestone: null
depends_on: [pl-31]
---

# pl-32 — nothing asserts what the planner's dev server binds

## Why

`tools/planner/web/vite.config.ts` decides three values that fail silently when
they are wrong: `host` (from `HOST`), `port` (5183) and `strictPort`. The
docblock in the file says what each is for — inside the dev container
`localhost` resolves to `::1`, so Docker's IPv4 port forwarding reaches nothing
and the page is simply blank, with no error anywhere — and `tools/planner/Dockerfile`
sets `HOST=0.0.0.0` for exactly that reason.

pl-31 put the file into a tsconfig project, so a _type_ error in it is now
caught. Nothing catches a _value_ regression: `host: "localhost"`,
`strictPort: false`, or a port that is no longer the 5183
`.devcontainer/devcontainer.json` forwards, all typecheck perfectly.

The downloader has this test —
`tools/downloader/web/test/vite-config.test.ts`, added by dl-22 — and the
planner does not, which matters beyond symmetry: **repo-5 is open and asks
whether the `HOST` resolution lifts to `packages/`.** Its acceptance says the
behaviour dl-22 pinned must survive the move "proven by the tests that pinned
it". Only the downloader has such tests, so a lift could change what the planner
binds and the whole suite would stay green.

Decided while building pl-31, which was scoped to the tsconfig line and says in
its Log that a test was wanted and filed rather than grown into it.

## Build

1. **`tools/planner/web/test/vite-config.test.ts`**, modelled on
   `tools/downloader/web/test/vite-config.test.ts`. It is a near-twin, and the
   mechanism is the part worth copying rather than re-deriving: `HOST` is read at
   module scope, so each case must `vi.resetModules()` before
   `await import("../vite.config.ts")` or the second import returns the first
   one's answer. Restore the ambient `HOST` in `afterEach`.
2. Assert the three values that fail silently, with the planner's own numbers:
   `host` is `"0.0.0.0"` when `HOST=0.0.0.0`; `host` is `false` (Vite's
   "localhost only", not the string `"localhost"`) when `HOST` is unset; `port`
   is `5183` and `strictPort` is `true`.
3. Do not assert the proxy target or `build.outDir`. They are not silent — a
   wrong proxy target fails loudly on the first request and a wrong `outDir`
   fails the build — and a test that pins every field of a config is a test that
   has to be edited every time the config is edited.
4. No new project file is needed. `tools/planner/web/test` is already a tsconfig
   project and already inside the `planner` vitest project's include, and pl-31
   put `../vite.config.ts` on the same compiler surface — which is what lets the
   test import it.

## Done when

- `npm test -- --project planner` covers the three values above, and the
  unset-`HOST` case asserts `false` rather than a string.
- `npm run check` and `npm test` pass.
- Changing `strictPort` to `false` in `vite.config.ts` fails the suite —
  measured, not assumed.

## Log

- **2026-08-25** — Built. One file added, `tools/planner/web/test/vite-config.test.ts`,
  three tests, near-twin of the downloader's. Nothing else in the repo changed:
  before the edit to this ticket, `git status --porcelain` listed exactly
  `?? tools/planner/web/test/vite-config.test.ts` and nothing more — no tsconfig,
  no `vitest.config.ts`, no root config of any kind. Step 3 of the brief was
  followed: the test reads `server.host`, `server.port` and `server.strictPort`
  and nothing else off the config.

- **Which project claims the new file, measured rather than inferred.** A file in
  no project passes green while checking nothing, which is the failure pl-31 and
  root `CLAUDE.md`'s Testing section both exist to prevent, so this was taken by
  `--listFiles` rather than by reading globs:

  ```
  $ npx tsc -p tools/planner/web/test/tsconfig.json --noEmit --listFiles | grep …
  …/tools/planner/web/vite.config.ts
  …/tools/planner/web/test/vite-config.test.ts
  ```

  The same command over the three projects that could plausibly have claimed it
  instead returns `0` for the test file each time: `tsconfig.tests.json` (whose
  `exclude` names `tools/planner/web/test/**`), `tools/planner/web/tsconfig.json`
  (`include` is `src/**` only) and `tools/downloader/web/test/tsconfig.json`. So
  it is in exactly one project, with no double membership. It is claimed by that
  config's existing `**/*.ts` glob, not by name —
  `grep -rn "vite-config" --include=tsconfig*.json .` finds nothing anywhere in
  the repo. Build step 4 was right that no new project file is needed.

- **And it is genuinely typechecked, not merely a member.** A lint-clean type
  error appended to the test file, then `npm run typecheck` — which is
  `tsc --build --verbose` — run **cold**, every `.tsbuildinfo` outside
  `node_modules` deleted first, because an incremental run can skip a project and
  report exit 0 having compiled nothing:

  ```
  01:38:42 AM - Building project 'tools/planner/web/test/tsconfig.json'...
  tools/planner/web/test/vite-config.test.ts(68,14): error TS2322: Type 'string'
  is not assignable to type 'number'.                                   # exit 1
  ```

  Probe reverted, cold again: `grep -c "error TS"` → `0`. The probe was
  `export const pl32Probe: number = "not a number";` — **exported on purpose**,
  because pl-31's gate finding F2 is real: `npm run check` is
  `lint && format:check && typecheck`, so an unused-local probe fails at oxlint
  and never reaches tsc, proving nothing about the project. `npm run typecheck`
  was invoked directly for the same reason.

- **The negative half. Five value regressions, one at a time, each restored and
  the config re-diffed against `HEAD` before the next.** The harness ran only
  this file — `npx vitest run tools/planner/web/test/vite-config.test.ts` under
  `--project planner` — and asserted `git diff --quiet` on the config after each
  restore. The restore is `cp` + `touch`, never `mv`: `mv` keeps the mtime, and
  `tsc --build` will then judge the source older than its output, skip the
  project and leave a mutated build in place.

  | Mutation                                   | Exit | Assertion that caught it                                                                       |
  | ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------- |
  | `host: HOST` → `host: "localhost"`         | 1    | `expected 'localhost' to be '0.0.0.0'` **and** `expected 'localhost' to be false` — 2 of 3 red |
  | `strictPort: true` → `false`               | 1    | `expected false to be true`                                                                    |
  | `port: 5183` → `5173` (the downloader's)   | 1    | `expected 5173 to be 5183`                                                                     |
  | `port: 5183` → `5184` (the walked-to port) | 1    | `expected 5184 to be 5183`                                                                     |
  | `?? false` → `?? "localhost"` on the const | 1    | `expected 'localhost' to be false` — 1 of 3 red                                                |

  Positive controls on the unmutated tree, **before** the first mutation and
  again **after** the last restore: `Test Files 1 passed (1)`,
  `Tests 3 passed (3)`, exit `0` both times. Without that pair the table above
  would be five reds from a harness that could not go green.

  Two mutations beyond the brief's three, and they earn their place. The brief's
  "a wrong port" is caught by the same assertion whichever wrong number is
  chosen, so `5184` is not a fourth case so much as evidence the third is not
  pinning a coincidence. The last row is the one that matters: it regresses only
  the unset-`HOST` fallback, and only the unset test goes red — which is what
  shows the two `host` assertions are not two spellings of one check.

- **The port to pin is 5183, and the trap next door is 5184.** `5184` appears in
  `tools/planner/web/vite.config.ts` only inside the `strictPort` comment, as the
  port Vite would walk to if 5183 were taken; the **downloader binds 5173**, not 5184. `.devcontainer/devcontainer.json:102` forwards
  `[8080, 5173, 8099, 8090, 5183]` and `:108` labels 5183 "planner web". Written
  down because a test copied
  from the downloader and pinned to the wrong number passes for the wrong reason,
  and both wrong numbers are sitting in the file being copied.

- **What the brief had wrong: one citation, in Why.** "and
  `tools/planner/Dockerfile` sets `HOST=0.0.0.0` for exactly that reason" —
  `tools/planner/Dockerfile:110` does carry `ENV HOST=0.0.0.0`, but that image
  never runs Vite. Its runtime stage ends
  `CMD ["node", "tools/planner/api/dist/main.js"]` with `EXPOSE 8090`, and the
  comment directly above the line says which `HOST` it means: _"127.0.0.1 — the default in
  `API_DEFAULTS` — is unreachable from outside a container."_ It is the API's.
  The file that actually puts `HOST=0.0.0.0` in front of the **dev server** is
  `.devcontainer/devcontainer.json:97`, whose own comment is _"Dev servers must
  listen on all interfaces to be reachable through Docker's port forwarding"_.
  Same value, so nothing in the test changes — but a reader following the
  citation lands on a file that would not reproduce the bug.

  The config's own docblock carries the same slip in a vaguer form, _"The
  container sets `HOST=0.0.0.0` for precisely this reason"_, and that sentence is
  **inside the 15-line block repo-5 measured as byte-identical across the two
  tools** — re-diffed here and still clean, `tools/downloader/web/vite.config.ts`
  lines 13–27 against `tools/planner/web/vite.config.ts` lines 12–26. Fixing the
  wording in one config would de-synchronise the very thing repo-5 is weighing, so
  it is deliberately left alone; repo-5 is where it gets said once, in whichever
  home the block ends up.

- **Everything else the brief asserted was checked and holds.** pl-31 did put
  `../vite.config.ts` into `tools/planner/web/test/tsconfig.json` (`:23`, and the
  `--listFiles` above); the downloader's test does exist at the stated path and
  dl-22 did add it — `git log --diff-filter=A` over that path returns exactly
  `30f77c9`, whose subject is
  `fix(downloader): bind the web dev server to the host it is given (dl-22) (#78)`;
  repo-5 is genuinely open
  (`status: ready`) and its acceptance does read "proven by the tests that pinned
  it rather than by hand". With this file, both tools' bindings are now pinned, so
  a lift that changed what the planner binds can no longer pass green — which was
  the point of the ticket beyond symmetry.

- **What was left on the table, deliberately.** The last trap bullet in
  `docs/work/repo-5-lift-the-host-resolution.md` still reads that the planner's
  config "is in no tsconfig project and is not typechecked … it is being filed
  separately". pl-31 closed that and this ticket is the "separately", so the
  bullet is stale. Striking it here would have been free in changelog terms —
  `chore` is `hidden` in `release-please-config.json`'s `changelog-sections`
  (read off the config: only `feat`, `fix`, `perf` and `revert` are not), and
  `docs/work/` is outside `tools/` anyway. It was not done: repo-5 is open, its
  Build says "Decide first, build second", and whoever builds it will be editing
  that file — an unrequested edit from a planner branch buys a stale sentence a
  merge conflict. Recorded rather than silently skipped so it is cheap to
  overrule.

- **Gates.** Cold `npm run check` (every `.tsbuildinfo` outside `node_modules`
  deleted first): exit **0**, `grep -c "error TS"` → `0`, and
  `Building project 'tools/planner/web/test/tsconfig.json'...` present exactly
  once, so the project compiled rather than being skipped. oxlint's
  `no-await-in-loop` warnings are pre-existing and are warnings; none is in
  `tools/planner/web`. `npm test -- --project planner`: exit **0**, 50 files /
  702 tests — pl-31's Log recorded 49 / 699 on this project, so the delta is
  exactly this file and its three tests. Full `npm test` was run too although no
  shared config was touched: exit **0**, 104 files / 1531 tests.

- **Not run here, and not implied:** the planner e2e suite and the container
  image gate, which live only in `.github/workflows/planner.yml`. This branch adds
  one test file and ships no code, and `tools/planner/web/vite.config.ts` is
  byte-identical to `HEAD` (`git status --porcelain` on it, empty), so neither
  gate has new input — but that is an argument, not a run.
