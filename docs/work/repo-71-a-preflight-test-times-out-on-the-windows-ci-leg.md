---
id: repo-71
tool: repo
title: A preflight test times out on the Windows CI leg, on code that never touched it
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-71 — a preflight test times out on the Windows CI leg

## Why

`scripts/test/preflight.test.ts`'s `"the CLI never leaks next-id.mjs's
id-sweep wording when gh fails inside check 5"` is flaky on the
`test (windows-latest, informational)` CI leg, on commits that touch neither
`scripts/preflight.mjs` nor that test file:

- 6,867 ms — run 36333161971, PR #298 at `f1adeb4`
- 6,081 ms — run 36333555081, `main` at `6988b65`
- **timed out at 30,000 ms** (ran 41,330 ms) — run 36334718531 attempt 1, #298
  at `18ca055`
- 2,024 ms — run 36334718531 attempt 2, the same sha

The same sha passed in 2 s on its retry and failed at 41 s on its first
attempt, so this is not a deterministic regression in anything the diffs at
those shas touch — it is intermittent, and the leg is `informational`
(`continue-on-error`), so it never blocked either pull request.

**An unverified hypothesis, from `dl-53`'s builder, offered as a hypothesis
to test rather than a finding.** The test
(`scripts/test/preflight.test.ts:838`) fakes `gh` with a shell script:

```js
fs.writeFileSync(ghPath, "#!/bin/sh\nexit 1\n");
fs.chmodSync(ghPath, 0o755);
```

then prepends `shimDir` to `PATH` and spawns the CLI, expecting `checkMergeTree`
to fail fast on the fake `gh` exiting 1. **Windows does not honour a `#!`
shebang line** — `.claude/rules/testing.md`'s own documented gotcha, measured
elsewhere in this repo for a different spawn (`packages/core`'s oxfmt scan,
which learned this by a Windows-only failure that read as a wording change
rather than a missing process). If the same holds here, `spawnSync("gh", ...)`
on Windows may not execute this fake file at all, falling through to
whatever `gh` is actually on the runner's `PATH` — the hypothesis being that
this reaches a **real** `gh` and real network latency, which would explain an
intermittent multi-second-to-timeout spread on a check that should fail in
milliseconds against a local fake.

**Not yet checked**, and worth checking before building anything:

- Does `windows-latest`'s runner image carry a `gh` binary on `PATH` by
  default? (GitHub-hosted Windows runners are documented to preinstall the
  `gh` CLI as of this writing, which would make the fallback path real rather
  than a `ENOENT`.)
- What `spawnSync` actually returns on Windows for a `PATH` entry containing an
  extension-less file that starts with `#!/bin/sh` — a `useless_command`
  process object with an error, an immediate `ENOENT`, or something the shell
  or `cmd.exe` resolves through a different mechanism.
- Whether the same shim pattern appears in any other test in this suite, or
  is unique to this one.

## Build

**Contract-adjacent nothing; this is a test-infrastructure fix once the
hypothesis is confirmed.** Proposed by the hypothesis's own shape, not yet
verified:

1. Confirm or refute the hypothesis directly: on a Windows runner (or a local
   Windows checkout if one is available), write the same shim and
   `spawnSync("gh", [...])` it with a `PATH` prepended the same way; observe
   whether the fake or a real `gh` answers, and at what latency.
2. If confirmed, fix the fake the way `.claude/rules/testing.md` already
   prescribes for this exact class: resolve `gh`'s real absolute path is not
   applicable here (there is no `gh` package under `node_modules`), so the
   fix is likely a `.cmd` or `.bat` shim on Windows specifically (matching how
   npm itself writes `.cmd`/`.ps1` beside a `.bin` shim), selected by
   `process.platform`, rather than a bare extension-less script everywhere.
3. If refuted, look for the real cause with the same rigor — a slow
   `spawnSync` teardown, a runner-wide resource contention on that leg,
   something else entirely — before proposing a fix.

## Done when

- The hypothesis above is confirmed or refuted, with the command and its
  output, not asserted from the shape alone.
- Whichever holds, the test is reliable on the Windows leg: three consecutive
  windows-latest runs of `scripts/test/preflight.test.ts` complete without a
  timeout, or the flakiness is shown to have a different, named cause and this
  ticket is updated or reassigned accordingly.
- `npm run check` and `npx vitest run scripts/test/preflight.test.ts` pass
  locally (they already do; this is a Windows-leg-only symptom).

## Review

**Gate: CONCERNS** — 2026-09-27 · `1a8321ce0615059d9b9d338628b78a2d9552249a...f2dd5eb02f7937d7b62ee20301083927d460edcf` · code-review at medium

| Done when                                                                                           | Proof                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Hypothesis confirmed or refuted, with command and output                                            | verified — see notes below                                                                 |
| Reliable on the Windows leg: three consecutive windows-latest runs without a timeout, or reassigned | **unproven (gate)** — no pull request open yet, so no Windows leg has run against this fix |
| `npm run check` and `npx vitest run scripts/test/preflight.test.ts` pass locally                    | verified — 45 of 45 tests, `npm run check` exit 0                                          |

**Local run, for the third Done-when line.** `npx vitest run scripts/test/preflight.test.ts` -- 45 of 45 passed, including `scripts/test/preflight.test.ts:853 "gh fails inside check 5"` -- and `npm run check` exits 0 with no lint, format or typecheck findings. `scripts/test/preflight.test.ts:58 "const CLI = path.join"` anchors the suite that ran.

**Mechanism, from primary source, not from the ticket's own restatement of it.**
Fetched `libuv`'s own `search_path` (`src/win/process.c`, tag v1.x) and Node's
`lib/child_process.js` at v22.23.3 directly rather than trusting the ticket's
paraphrase. Confirmed: libuv appends only `.com` and `.exe` to a bare name on
win32 — "Since CreateProcess can start only .com and .exe files, only those
extensions are tried" — and does so with no shell and no PATHEXT lookup; there
is no JS-level PATHEXT fallback in `child_process.js` either when `shell` is
falsy, so the native call is the only word on it. A `.cmd`/`.bat` shim (the
ticket's own Build proposal, before the hypothesis was confirmed) would
therefore never be found by that search, and Node's own docs say a `.bat`/
`.cmd` needs `shell: true` or an explicit `cmd.exe /c` to run at all — this
repo forbids `shell: true` outright, so the fix could not have taken that
shape. `scripts/test/preflight.test.ts:919 "function plantFakeGh"` — reaching
`process.execPath` under the fake's own name — is the only shape left that
satisfies both constraints, and it is what the branch built.

**The 4 named CI runs, re-fetched independently rather than taken from the Log.**
`gh run view <run> --job <id> --log` (the form the Log's own prose names) is
unreliable across attempts here: fetched for both the failing attempt's own
job id (108663382517) and the passing retry's job id (108667276749) of run
36334718531, both calls returned byte-identical content (same md5sum) — the
passing retry's log, for both ids. The per-job annotation view
(`gh run view --job <id>`, no `--log`) is not affected and correctly showed
the failing attempt's own annotation: "Error: Test timed out in 30000ms ...
scripts/test/preflight.test.ts, line 838". The reliable form turned out to be
`gh run view <run-id> --attempt 1 --log` (no `--job`), which reproduced the
Log's own numbers exactly: `checkTitle fails a subject commit-message.mjs
bypasses: squash!` at 13,083 ms (403 ms on the passing retry) and the gh-fails
test itself at 41,330 ms with `Error: Test timed out in 30000ms`, in the same
attempt. This independently confirms both of the Log's central claims and is a
process note worth carrying forward: cite `--attempt N --log`, not `--job <id>
--log`, for a specific historical run.

**Positive control, built and run here** (the container is Linux, so this is
an analogue of the Windows miss, not a Windows run): a standalone script
(kept in this ticket's scratch directory) reused `makeRepo` and the CLI
exactly as the test does, and ran four plants —

- HEAD's own `plantFakeGh`, real branch: `exited 1` / `fake gh answered`
  matched, as `npm test` already shows.
- HEAD's fake deliberately mis-named the way the defect mis-names it (asked
  for under a name the platform's own bare-name search will not find — here,
  `gh.exe` on a Linux `PATH`, standing in for `gh` on a Windows one): the real
  `/usr/bin/gh` answered instead — unauthenticated, exit 4 — and the new
  marker assertion did **not** match. This is the fix's discriminating power
  demonstrated directly: a real binary answering in the fake's place fails
  this test.
- The **base** shim (`#!/bin/sh`, `chmod 755`): passes on Linux, because the
  kernel's own `execve` honours the shebang here — consistent with the ticket
  never having seen this fail outside the Windows leg.
- The base shim made deliberately unreachable (`chmod 644`, mimicking "never
  found" the way Windows never finds it): the **old** assertions
  (`FAIL {2}mergeTree threw`, no id-sweep leak) still passed, against the
  same real, unauthenticated `gh` exiting 4 — proof that the old test could
  not tell its own fake from a live fallback binary, which is the whole
  defect.

**Other CI runs the ticket names**, spot-checked rather than fully re-walked:
run 36333161971 (PR #298 at f1adeb4) and run 36333555081 (`main` at 6988b65)
both list the gh-fails test at 6-7 s, consistent with the Log's own numbers;
not independently re-measured line by line here given the two runs above
already carry the weight of the claim.

**Repo invariants.** No `shell: true` anywhere in the diff
(`scripts/test/preflight.test.ts` uses `fs.symlinkSync` / `fs.linkSync` /
`fs.copyFileSync` and the existing `spawnSync` plumbing, never a shell), so
the "never invoke a shell" rule is not at stake in this branch. Answering the
dispatch's own question: `packages/core/test/spawn-safety.test.ts` walks only
`workspaceDirs()` — one level under `packages/`, two under `tools/` — and
never reaches `scripts/` at all, so `scripts/preflight.mjs` and
`scripts/test/*.ts` (which do spawn `git`/`gh`/`npm`) sit outside that scan
entirely. This is a pre-existing, repo-wide gap the branch neither
introduces nor worsens; noted rather than carried, since fixing it is a
separate, `packages/core`-scoped change with its own tradeoffs (widening a
repo-wide scan into `scripts/` is a decision for whoever owns that test, not
an implicit part of this ticket).

Fixtures, not live network calls: the fix's own fake never reaches a real
network endpoint; the CI-measurement half of the ticket's own hypothesis
check does spawn a real, unauthenticated `gh` against the live GitHub API
from the sandbox, but that was the ticket's diagnostic step, not something
the shipped test does — the shipped test never spawns a real `gh` when its
own fake is reached, which is the entire point of the fix.

`node scripts/citations-gate.mjs --against origin/main` (run from this
worktree, `origin/main` unmoved at `1a8321c`):

```
citation gate — the "Review" section of 124 record(s), distinct anchors required
118 enforced, 0 failing; 6 grandfathered, holding 1 unresolvable, 19 unanchored.
6 entr(y/ies) compared against origin/main: 0 raised.
```

`.claude/rules/testing.md` is tracked (`git check-ignore` exits 1, not
ignored), and its new paragraph is in scope — it documents exactly this
defect's class, in the same place the shebang paragraph it sits beside
already does, and no ticket cites this file by a bare line number that the
insertion could have moved (checked: every reference under `docs/work/` to
`.claude/rules/testing.md` is prose, none a `file:line` pin). Its claim
("a real binary answering in its place fails the test instead of passing
it") is true, and is exactly what the positive control above demonstrates.

`node scripts/preflight.mjs --base origin/main --title "fix(repo): make the
preflight gh fake run on Windows, and prove it answered (repo-71)"` from this
worktree: exit 0 — `check`, `citations`, `review`, `title` and `mergeTree`
all `ok`.

**NFR sweep.** security n/a. performance: the Windows copy-fallback path
duplicates the Node binary per invocation if the hard link is refused;
expected to be the rare path on a GitHub-hosted runner (same drive), unmeasured
on real Windows CI. reliability: directly improves it, per the positive
control above. maintainability: clear, and the `.claude/rules/testing.md`
fold-in generalises the lesson for the next test that plants a fake on `PATH`.

- **dropped** · `scripts/` sitting outside `spawn-safety.test.ts`'s scan —
  real, but pre-existing and not touched by this diff, which introduces no
  shell call. Worth a ticket of its own if the repo wants `scripts/` covered;
  not a defect in this branch.
- **findings** · code-review at medium returned 0; 0 carried, 1 dropped
  (the scan-coverage gap above, out of scope).
- NFR: security n/a · performance — see above (unmeasured on real Windows) ·
  reliability ✓ · maintainability ✓.

**Verdict rationale.** CONCERNS rather than PASS or FAIL: the second
Done-when line is `unproven (gate)`, not `unproven` — there is no reason to
think the fix is wrong, only that nothing has actually run it on the Windows
leg yet, and the branch's own Log says as much rather than claiming the row.
That is exactly what keeps this out of FAIL. It is also not PASS, for the same
reason `unproven (gate)` exists as its own category in the review procedure:
"green everywhere this container can reach" is not "green on the leg the
ticket is about."

## Log

- 2026-09-27 — Filed on the coordinator's instruction, as item 17 of the
  2026-09-27 batch close-out (`repo-64`). The four run timings above were
  measured by the coordinator via the batch's own CI runs; not independently
  re-run here. The Windows-shebang hypothesis is `dl-53`'s builder's,
  relayed as a hypothesis to test — filed rather than fixed because nothing
  here yet confirms it.
- 2026-09-27 — **Correction, `repo-64` gate 2, finding E.** Filed with
  `status: needs-decision`, which this ticket does not carry: its Build is a
  measurement step followed by a fix, not an open question for whoever picks
  it up to answer, so `--ready` would hide a dispatchable ticket behind that
  status. Set `ready`.
- 2026-09-27 — **Renumbered from `repo-66` to `repo-71`.** #301 (the ledger
  design) merged `docs/work/repo-66-lift-the-logger-into-core.md` into
  `main` after this ticket was filed under the same id, and
  `node scripts/next-id.mjs repo` gave `repo-71` as the next free id against
  `main` and every open branch. `repo-64`'s gate 2 and gate 3 sections name
  "repo-66" in prose describing this file as it existed at `f84c2a1` and
  `ce99898` — those gate records are unedited, and "repo-66" there means
  this file, now `repo-71`.
- 2026-09-27 — **Built, by a builder dispatch (Opus 5.5). The Windows leg's
  result is `unproven`: this container is Linux, and nothing below ran on
  Windows.** Each claim is labelled with where it comes from.
  - **The hypothesis is half right.** _Source-derived, not measured on
    Windows:_ libuv's Windows `PATH` search appends only `.com` and `.exe` to
    a bare name and starts no shell, so the extension-less `#!/bin/sh` file
    named `gh` is never a candidate and `spawnSync("gh", …)` reaches the
    runner's own `gh.exe`. _Measured here:_ the test could not tell — the
    base test, copied with its shim set to `0o644` so it never runs, **passes**
    (`npx vitest run` on the copy: `1 passed | 44 skipped (45)`), because the
    real `/usr/bin/gh` in a remote-less fixture also exits 1 — `no git remotes found` — and every assertion held either way.
  - **The "real network latency" half is refuted where it could be
    measured.** `ci.yml`'s test job sets no `GH_TOKEN`. A real, unauthenticated
    `gh` 2.101.0, spawned as preflight spawns it in a remote-less repository
    with an empty `GH_CONFIG_DIR` and `CI=true GITHUB_ACTIONS=true`, exits 4
    (`To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN…`) in
    63–126 ms over ten runs, and routed through a logging proxy it made **0
    requests** (`gh exited 4 in 71 ms; proxy saw 0`). The Windows runner's
    `gh` version and its cold-start cost were not measured.
  - **So the 41 s is not explained, only its uncontrolled binary removed.**
    From the CI logs (`gh run view --job … --log`): in the same attempt that
    timed out (run 36334718531 attempt 1), a test that spawns no `gh` at all —
    `checkTitle fails a subject commit-message.mjs bypasses: squash! …` — took
    **13,083 ms**, against 313–403 ms in the three other runs. The leg stalls
    on tests this ticket does not touch; a slow `gh.exe` cold start (a fresh
    VM every run) is a plausible share of this test's own 2–7 s, and is
    unmeasured. vitest's 30 s timeout cannot interrupt a synchronous
    `spawnSync`, which is why the failure reads 41,330 ms.
  - **The Build's proposed fix would not have worked.** A `.cmd` shim is
    invisible to the same `.com`/`.exe`-only search, and Node refuses to spawn
    a `.cmd` or `.bat` without `shell: true` (its 2024 fix for
    CVE-2024-27980), which this repo forbids. _Both from documentation and
    source, not run._
  - **What was built instead.** The fake is now a real executable on every
    platform: this process's own `node` under the name `gh` — a symlink on
    POSIX, a hard link or copy named `gh.exe` on Windows — with `pr.js`
    planted in the fixture, since `gh pr list …` makes node run `pr` from its
    `cwd`. `pr.js` prints a marker and exits 1, and the test asserts it,
    `scripts/test/preflight.test.ts:853 "exited 1\n\s+fake gh"`, plus
    `scripts/test/preflight.test.ts:851 "expect(result.error).toBeUndefined()"`.
    _Measured here:_ forcing the Windows branch on Linux (which names the file
    `gh.exe`, so Linux's search misses it the way Windows missed `gh`) fails
    the new test on the real `gh`'s `no git remotes found`; the same branch
    renamed to `gh` passes — the hard link is refused here (`EPERM`, a
    root-owned node) so that run proved the copy fallback, not the link.
  - **The shim pattern is unique to this test.** A grep for `#!/bin/sh`, `chmodSync` and a
    templated `PATH:` over every `*.ts` and `*.mjs` outside `node_modules` and
    `dist` found only this test; the one other hit is `ytdlp.test.ts` handing
    `findExecutable` a `PATH` string as an argument.
  - **Folded in:** a paragraph in `.claude/rules/testing.md` after the
    shebang one, naming the `PATH` variant of the same gap — the rule this
    ticket's brief leaned on covered spawning a `bin` directly, not a fake
    reached by `PATH`.
  - **Done when, line 2, stays open until a pull request's CI runs:** three
    consecutive `windows-latest` runs of this spec without a timeout. Given
    the 13 s stall above, the leg may still time out on something else.
- 2026-09-27, after landing: `Done when` 2 met — `test (windows-latest,
informational)` passed three consecutive times on PR #303 at `818bab2`
  (run 36344053801, attempts 1–3, jobs 108689610119 / 108703255144 /
  108706939302, each `completed success`, read by the orchestrator with
  `gh run view --json`); gate 1's `unproven (gate)` on that line is
  superseded by this CI evidence. The open decision this ticket's builder
  raised for a Windows leg that still timed out is moot.
- 2026-09-27 — repo-79's builder repointed this record's three citations that
  its own additions to `scripts/test/preflight.test.ts` moved — coordinate
  only, anchor text unchanged. `node scripts/citations-gate.mjs --against
origin/main` exit 0: 127 enforced, 0 failing.
- 2026-09-28 — repo-79's gate 1 round moved the same three citations again;
  repointed once more, coordinate only. `node scripts/citations-gate.mjs
--against origin/main` exit 0: 127 enforced, 0 failing.
