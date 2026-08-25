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

## Review

### Gate 1 — 2026-08-25 — `pl-32-vite-config-test` — **PASS**

Verdict recorded as given. Three findings, **all disposed no-change**, nothing
above `low`. The gate reviewed commit `86b85a6` **in detached HEAD** — this
worktree holds the branch name — so its evidence is against that tree, which is
this branch minus the section you are reading and the Log entry under it.

**On the citation tooling, because it bounds what "citations resolved" means
here.** The orchestrator reports that `orch-resolve-citations.mjs` matched only
**2** of the Log's references as it stood at the gate: it does not recognise a
bare `:108`, nor a parenthesised ``(`:23`)``. Run against the finished record it
sees **6** and resolves all 6 — after the one cited by bare filename
rather than by repo-root-relative path was corrected, two files in this repo
carrying the basename `vite-config.test.ts` and the script correctly refusing
to guess between them. Every other coordinate —
the bare `:NNN`, the ranges, the parenthesised forms, **23 lines in all** — was
resolved **by hand**, by the gate and again here, and each says what the record
claims of it. The script is a floor, not a ceiling, and a green run of it is not
the claim being made.

#### What the gate reproduced, on its own harness

It wrote its own harness rather than running `pl32-mutate.sh`, and reproduced the
mutation table **row for row, including which test goes red in each case**: M1
reddens 2 of 3, M5 reddens 1 of 3. Controls green before and after.

It added a sixth mutation of its own — `?? false` → `?? undefined` — which goes
red with `expected undefined to be false`. That one proves something none of the
builder's five could: `:55` is `Object.is`-strict rather than a truthiness
assertion, a distinction invisible to any mutation that swaps one falsy value for
another.

It also ran the suite under `env -u HOST` and under `HOST=192.168.1.5`: **green
both ways**, so the suite does not depend on this container's ambient `HOST`.
That is the one property the builder's runs could not establish, since all of
them inherited `HOST=0.0.0.0` from `.devcontainer/devcontainer.json:97`.

**The `resetModules` experiment is the one worth carrying forward.** Deleting
`vi.resetModules()` at `:31` turns the suite **red**, with the cached-module
symptom exactly: `expected '0.0.0.0' to be false`. So the line the brief warned about is
not defensive folklore inherited from the downloader; it is load-bearing here and
now measured. Deleting the `afterEach` at `:39-42` left the suite green — F3.

Independent confirmations: `npm test -- --project planner` → 50 files / 702
tests, identical to the builder's report; a cold typecheck with the gate's own
probe → `TS2322` at `(46,9)`, reverted → clean, and the line
`Building project 'tools/planner/web/test/tsconfig.json'` present in all three
cold runs; diff
exactly the two files. Every Log citation resolved, **no mis-citation in either
direction**.

#### The gate's own harness failed first, which is why its negatives count

Its **first** harness scored **exit 1 on a clean tree**. It had written
`--reporter=basic`, which the pinned vitest does not ship, so zero tests ran.
Every mutation would then have "died" unconditionally and the table would have
been worthless — five reds meaning nothing at all. It caught this only because it
was required to run the control **before** any mutation.

Reproduced here first-hand rather than relayed, on the clean tree:

```
$ npx vitest run tools/planner/web/test/vite-config.test.ts --project planner --reporter=basic
⎯⎯⎯ Startup Error ⎯⎯⎯
Error: Failed to load custom Reporter from basic                        # exit 1
tests actually run: 0
```

The same command without the flag: exit **0**, `Tests 3 passed (3)`. Pinned
runner is `vitest/4.1.10 linux-x64 node-v22.23.2`. The mechanism that kept this
failure out of the builder's harness is written up in the Log below, because it
generalises past this ticket.

#### Findings — three, all no-change

**F1 — the Why at `:19-20` mis-cites the Dockerfile. Confirmed independently by
builder, gate and orchestrator. No change.**
`tools/planner/Dockerfile:110` does carry `ENV HOST=0.0.0.0`, but the image never
runs Vite: `:130` is `EXPOSE 8090` and `:139` is
`CMD ["node", "tools/planner/api/dist/main.js"]`, and the comment at `:108-109`
names `API_DEFAULTS` itself. The real source of the dev server's `HOST` is
`.devcontainer/devcontainer.json:97`, commented at `:95-96`. All five coordinates
re-verified while writing this section. _Disposition:_ **Why** stays as the
historical record of what was believed when the ticket was filed, and the Log
carries the correction — this repo's stated convention for a brief that did not
survive contact with the code.

**F2 — `:59` passes a `HOST` the test does not use. Inert, not wrong. No
change.**
`tools/planner/web/test/vite-config.test.ts:59` calls
`serverConfigWith("0.0.0.0")`, but that test asserts only `:63` `port` and `:64`
`strictPort`, neither of which reads `HOST`. The helper's signature requires an
argument and some value must be passed. Recorded so a later reader does not
mistake it for a dependency and preserve it as one.

**F3 — the `afterEach` at `:39-42` is uncovered by construction. Genuine
hygiene, unproven. No change.**
No mutation in this file can kill it: deleting it leaves the suite green, because
every test sets or deletes `HOST` before importing. It exists against a future
test that does not, and against leaking a mutated `HOST` to another file sharing
the worker. Kept as hygiene, with the record noting plainly that no assertion
demands it.

#### Acceptance

| Done when                                                                               | Verdict  | Proof                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -- --project planner` covers the three values; the unset case asserts `false` | verified | `tools/planner/web/test/vite-config.test.ts:47` (`host`), `:55` (`toBe(false)`, not a string), `:63` (`port`), `:64` (`strictPort`); gate's `?? undefined` mutation proves `:55` is `Object.is`-strict |
| `npm run check` and `npm test` pass                                                     | verified | cold `npm run check` exit 0, `grep -c "error TS"` → 0; full `npm test` exit 0, 104 files / 1531 tests; gate independently 50 / 702 on `--project planner`                                              |
| Changing `strictPort` to `false` fails the suite — measured, not assumed                | verified | M2 in the Log's mutation table: exit 1, `expected false to be true` against `:64`; gate reproduced it row for row on its own harness                                                                   |

#### What this gate did NOT do

- **The planner e2e suite and the container image gate did not run.** They live
  in `.github/workflows/planner.yml` and only there, and no coverage of either is
  implied. Mitigating but not a substitute: this branch adds one test file, ships
  no code, and leaves `tools/planner/web/vite.config.ts` byte-identical to `HEAD`.
- **It reviewed `86b85a6` in detached HEAD**, so it never saw this section or the
  Log entry beneath it.
- **It did not resolve citations by script alone** — the tooling reached 2 of
  them; the rest are hand-resolved, as noted in the preamble above.

**The coordinates in this section resolve against `86b85a6`**, and continue to
hold at the commit that adds the section, because the only file that commit
changes is this one and no citation here names this file by line.

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

- **2026-08-25 — why this harness did not hit the gate's `--reporter=basic`
  failure.** Asked directly, and worth answering as mechanism rather than taking
  the credit: **it was not the before-control.** Three things were in play and
  only the first actually did the work here.

  1. **The invocation was proven by hand before it was ever put in a script.**
     The first thing run after writing the test was the bare command, as itself,
     interactively —
     `npx vitest run tools/planner/web/test/vite-config.test.ts --project planner`
     → `Test Files 1 passed (1)`, `Tests 3 passed (3)`. `pl32-mutate.sh` then
     reused that exact string verbatim, so the harness contained no untested
     invocation. The controls on both ends were a real second net and I would
     write them again, but they were never tested against a broken harness in
     this run, so they cannot be claimed as the mechanism.

  2. **The generalisable rule: shape the output _downstream_ of the command under
     test, never by adding arguments to it.** The gate and I wanted the identical
     thing — terser output to grep against. It reached for a reporter flag,
     _inside_ the command; this harness reached for `grep -E` on the _outside_,
     leaving the command byte-identical to the one already proven green. The
     asymmetry is what matters: a pipe that mis-greps costs a blank line, whereas
     a flag that does not exist costs exit 1 with zero tests run — which is
     **indistinguishable from a caught mutation**. In a mutation harness that is
     the worst available failure mode, because the harness is _supposed_ to be
     producing failures and has no way to tell a real one from its own.

  3. **The same family holds a second trap, and this harness stepped around it by
     one line.** Piping into `grep | head` hands back the _last_ element's
     status. Measured on the clean tree, using the gate's own broken invocation as
     the failing case:

     ```
     PIPESTATUS array = 1 1 0
       [0] vitest = 1     <- the real answer
       [-1] head  = 0     <- what a bare $? after the pipe would have given
     ```

     So a bare `$?` would have scored a run in which **zero tests executed** as
     green. `pl32-mutate.sh` reads `${PIPESTATUS[0]}` as the very next command
     after the pipeline, which is what saved it — and the table's own shape is the
     proof it worked: had that plumbing been wrong, every row would have read
     exit 0, the five mutations included, and the table would have been uniformly
     and falsely green rather than obviously broken.

     Writing this up, the first version of the demonstration script proved the
     adjacent fact by accident. It did `naive=$?` and _then_
     `ps0=${PIPESTATUS[0]}`, and reported `0 0` for a run that genuinely exited 1.
     **A bare assignment is a command, and it clobbers `PIPESTATUS`.** So "read it
     immediately" is not style advice: one intervening line, of any kind, silently
     zeroes it.

  Short form for whoever writes the next mutation harness: _run the command by
  hand before you script it; keep the harness's invocation byte-identical to the
  one you proved; do your formatting after the pipe, not inside the command; and
  read `PIPESTATUS[0]` on the very next line._

- **Gate 1 recorded above — PASS, as given.** Three findings, all no-change and
  all accepted: F1 is the Dockerfile mis-citation this Log already corrected, F2
  is the inert `HOST` argument at `:59`, F3 is the uncovered `afterEach` at
  `:39-42`. **No code changed in response to the gate**; the diff is still the
  two files, and this commit touches only the ticket. The gate's own additions
  worth keeping are its `?? undefined` mutation (which proves `:55` is
  `Object.is`-strict, not truthiness) and its `env -u HOST` / `HOST=192.168.1.5`
  runs (which prove the suite does not lean on this container's ambient `HOST`) —
  both properties the builder's five mutations could not reach.
