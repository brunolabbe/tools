---
id: repo-31
tool: repo
title: The CI matrix's windows-latest leg is almost all the red, and whether to keep it is unanswered
kind: chore
status: needs-decision
milestone: null
depends_on: []
---

# repo-31 — Whether `windows-latest` stays in the CI matrix

## Why

`.github/workflows/ci.yml` runs the unit-test matrix over
`` `.github/workflows/ci.yml:215` "os: [ubuntu-latest, windows-latest]" ``, gated
by a `changes` job rather than an event filter — a documentation-only push still
skips the matrix, on both `push` and `pull_request` alike. The repo's owner asked
directly whether the Windows leg is worth keeping. This ticket is where that
question gets answered, with measurements rather than an impression, and it is
filed rather than settled because the two readings of "worth keeping" cost real,
different things and neither of us should pick quietly.

## The measurements

All of these were re-run for this filing rather than taken on faith; where a
number moved between the brief and this run, it is called out.

### 1. Failure concentration, last 30 `CI`-workflow runs

`gh run list --workflow=ci.yml --limit 30`, read again at filing time:

| Conclusion | Count |
| ---------- | ----- |
| cancelled  | 16    |
| failure    | 8     |
| success    | 6     |

Matches the brief's count exactly, but not by luck: one of the 8 was still
`in_progress` — for `origin/repo-30-id-sweep-repo-tickets`, run `34131675937` —
when this session first queried it, and finished as `failure` about a minute
later while this ticket was being written. It is included below as run 8.

`gh run view <id> --json jobs` on each of the 8:

| Run           | `test (windows-latest)` | `test (ubuntu-latest)` |
| ------------- | ----------------------- | ---------------------- |
| `34131675937` | failure                 | success                |
| `34131505836` | failure                 | success                |
| `34129983662` | failure                 | success                |
| `34129655619` | failure                 | success                |
| `34127289168` | failure                 | success                |
| `34125118107` | failure                 | **failure**            |
| `34118115575` | failure                 | success                |
| `34118115501` | failure                 | success                |

7 of 8 fail on `windows-latest` alone; `34125118107` fails both.

**What the brief did not have: all 8 fail on the identical assertion.** Reading
each failed job's log rather than just its conclusion, every one of the 8 has,
on `windows-latest`:

```
FAIL  repo  scripts/test/citations.test.ts > --rev names which record it read, and says when that record cited something else
AssertionError: expected '2 references in ..\..\..\..\..\RUNNER…' to match /This record exists at that rev and ci…/
```

This is not eight independent Windows problems. It is one regression, unfixed,
failing the same way on every completed run of the matrix since it merged —
including run 8, caught live during this filing, three-plus hours and eight
runs after it landed. **"Windows is the dominant source of red" and "the team
has looked at eight different Windows failures" are different claims, and only
the first is true.** The second would be a much weaker argument for removal,
because a checker broken eight different ways on one OS says more about the
checker's Windows-readiness than a checker broken once and never re-triaged
does.

`34125118107` additionally fails
`scripts/test/next-id.test.ts > a command that is not on PATH exits 127 and says which one`
on **both** platforms — `expected 128 to be 127` on ubuntu,
`expected 'git: spawnSync git ENOENT\n' to match /gh/u` on windows. This file
does not exist on `main`; it belongs to the still-open
`repo-30-id-sweep-repo-tickets` branch (PR #176), which has since rewritten the
test — its current tip carries a comment, at line 355 of that branch's
`scripts/test/next-id.test.ts`, recording the exact failure this ticket saw
("came back `expected 128 to be 127` on both `ubuntu-latest` and") and replaces
the brittle assertion with one that does not depend on which absent-command
error string a shell reports. Cross-platform, already addressed on that
branch, unrelated to the citations regression: not evidence either way on
`windows-latest` specifically. (Not cited as `file:line` here — that pattern
resolves against this branch's own tree, where the file does not exist, and
would report a false `unresolvable`.)

### 2. The live instance

`main` at `24e5bf7` is red on `windows-latest` right now, on the assertion
above. It arrived with repo-25 (PR #168, merge commit `4bc3e66`, merged
2026-09-07T11:39:47Z), which touched
`` `scripts/citations.mjs` `` and
`` `scripts/test/citations.test.ts` ``. The failing assertion is
`` `scripts/test/citations.test.ts:1319` "This record exists at that rev and cited something different there" ``,
reached from
`` `scripts/test/citations.test.ts:1318` "expect(pinned.stdout).toMatch(" ``.
The mechanism looks like a POSIX-path assumption in the repo's own tooling
(`scripts/citations.mjs` computes a path relative to the repo root and prints it
unchanged; on Windows that string carries backslashes and the printed preview
never reaches the "This record exists…" branch the test expects), not a defect
in the citations _logic_ itself — see classification below. It has been red on
every scheduled and pull-request run of the matrix since it merged, and nobody
has filed anything for it yet — this ticket does not either, since filing that
fix is a five-minute, no-decision piece of work outside this ticket's scope, not
a reason to widen this one.

### 3. The product genuinely diverges

`` `tools/downloader/engine/src/ffmpeg/kill.ts` `` exists because Windows has no
process groups reachable from Node —
`` `tools/downloader/engine/src/ffmpeg/kill.ts:9` "Windows has no process groups usable from Node" ``
— and a bare kill leaves ffmpeg holding the output file, which then fails
cleanup with `EBUSY`:
`` `tools/downloader/engine/src/ffmpeg/kill.ts:7` "the visible symptom is `EBUSY` on `rm -r tmp/<jobId>`." ``.
That is a real, load-bearing platform difference, not a portability nuisance.

Grepped for `win32`, `taskkill` and `PATHEXT` across `.ts`/`.tsx`/`.mjs`/`.js`,
outside `node_modules` and `dist`, repo-wide — the brief's own grep, re-run and
confirmed complete against that pattern set:

- `tools/downloader/engine/src/ffmpeg/kill.ts`
- `tools/downloader/engine/test/ffmpeg-args.test.ts`
- `tools/downloader/engine/test/storage.test.ts`
- `tools/downloader/resolvers/src/resolvers/ytdlp.ts`

Exactly four files, exactly the brief's list. Nothing under `tools/planner` or
elsewhere matches.

### 4. What the runner actually proves — the load-bearing measurement

This needed working out, not quoting, and the answer is more specific than "the
divergent logic is already unit-testable":

**`buildTaskkillArgs` is pure and already tested everywhere, Windows included,
independent of the runner.**
`` `tools/downloader/engine/src/ffmpeg/kill.ts:22` "assertion is a unit test" ``
(docblock) /
`` `tools/downloader/engine/test/ffmpeg-args.test.ts:295` "so children die with the parent" ``.
This one needs nothing from `windows-latest` and would not lose anything if it
were dropped.

**`taskkillPath` (`kill.ts`), which resolves `taskkill.exe`'s absolute path from
an injectable `env`, is pure and testable anywhere — and is not tested at all,
on any platform, today.** A gap that has nothing to do with the runner.

**`killProcessTree`'s real Windows branch — the one `kill.ts`'s own docblock
justifies the whole file with — is exercised by no test, on any platform,
including `windows-latest` itself.**
`` `tools/downloader/engine/src/ffmpeg/kill.ts:98` "export async function killProcessTree" ``
is called from
`` `tools/downloader/engine/src/ffmpeg/runner.ts:164` "await killProcessTree(targetPid, { logger });" ``,
and
`tools/downloader/engine/test/ffmpeg-runner.test.ts` has no test that aborts,
cancels, or kills a real ffmpeg process — the file contains no `kill`, `abort`,
or `cancel` test at all. **Today's `windows-latest` leg does not verify the
EBUSY-avoidance behaviour its own justification cites.** That is the opposite of
a `(c)` finding, but it changes the answer just as much: the strongest argument
for keeping the leg is currently unbacked by any test, on either OS.

**A second, undeduplicated implementation does get exercised for real, and it is
this ticket's actual evidence for "the runner earns something."**
`tools/downloader/resolvers/src/resolvers/ytdlp.ts` has its own `killTree`
(`` `tools/downloader/resolvers/src/resolvers/ytdlp.ts:732` "if (process.platform ===" ``,
spawning
`` `tools/downloader/resolvers/src/resolvers/ytdlp.ts:733` "const killer = spawn(" ``
via a bare `"taskkill"` resolved off `PATH`, not the absolute path `kill.ts`
resolves), and `tools/downloader/resolvers/test/ytdlp.test.ts`'s
`` `tools/downloader/resolvers/test/ytdlp.test.ts:392` "an abort kills the process instead of hanging" ``
really spawns a child Node process and really aborts it, so on `windows-latest`
this test genuinely calls the real OS `taskkill.exe` via `PATH` lookup and
proves the process tree actually dies. That is one real fact a pure-function
test cannot buy: whether `spawn("taskkill", [...], { shell: false })` resolved
off `PATH` on a real Windows host does what the code assumes.

**`findExecutable`'s `PATHEXT` branch is untested on any platform** —
`` `tools/downloader/resolvers/src/resolvers/ytdlp.ts:820` "const isWindows = process.platform ===" ``
/
`` `tools/downloader/resolvers/src/resolvers/ytdlp.ts:822` "const extensions = isWindows" ``
— and unlike `taskkillPath`, it reads `process.platform` and `process.env`
directly rather than accepting them as parameters, so making it testable
cross-platform is a small refactor away, not free today.

**`assertPathInside` (`storage.ts`) is the one case where Node's own ambient
`path` module makes the divergence genuinely OS-bound**, because
`` `tools/downloader/engine/src/storage.ts:20` "import path from" `` imports
`node:path`, which _is_ `path.win32` on a real Windows process and `path.posix`
everywhere else — not a mockable constant.
`` `tools/downloader/engine/test/storage.test.ts:76` "const elsewhere = process.platform" ``
already branches the fixture on `process.platform`, so the assertion is
correct either way it runs — but it only _proves_ the Windows branch when it
actually runs as a Windows process. Node ships `path.win32` for exactly this,
and `assertPathInside` could be rewritten to accept an injectable path module
the way `taskkillPath` already accepts an injectable `env` — at which point this
one test, too, stops needing the runner. Nobody has done that refactor.

**`sanitizeFilename`'s reserved-name stripping is not platform-conditional at
all** —
`` `tools/downloader/engine/src/storage.ts:110` "if (RESERVED_WINDOWS_NAMES.has(stem.toLowerCase())) stem = " ``
— it strips `CON`, `PRN`, etc. on every OS, on purpose, so files stay portable.
Already needs no runner.

**Net reading of measurement 4:** of the four files the grep found, one function
(`buildTaskkillArgs`) is already portable and tested; one (`taskkillPath`) is
portable and untested; one real behaviour (`killTree` in `ytdlp.ts`, via the
abort test) is genuinely proven only by a live Windows OS today; the flagship
justification (`killProcessTree`'s Windows branch, the one the file's docblock
argues from) is proven by nothing at all; and one (`assertPathInside`) is
OS-bound only because of an import choice a small refactor would undo. **The
runner is not currently earning what its own comments claim it earns, and no
option below fixes that — narrowing the matrix to "the engine's process and
storage paths" would keep running a test that proves less than it appears to.**
Whoever answers this ticket should treat "make `killProcessTree` actually
tested" as a separate, already-identifiable gap regardless of which option
below is chosen — filed here as an observation, not folded into this ticket's
Build, because it is decision-independent work that any option leaves undone.

Classification requested by the brief — of the 8 failures, by root cause:

- **(a) test/tooling making a POSIX assumption:** all 8 (the citations
  regression, present in every one).
- **(b) fixture/harness defect:** 1 (`34125118107`'s `next-id.test.ts`, on an
  unmerged branch, already rewritten there).
- **(c) real product bug only Windows exposed:** **none.** Nothing in these 8
  runs touches `kill.ts`, `ytdlp.ts`'s `killTree`, or `assertPathInside`.
- **(d) infrastructure:** none of the 8. (See measurement 5 for a real `(d)`
  that is _not_ among these 8 and is not evidence for this decision.)

No `(c)` turned up. Per the brief's own instruction, that is what would have
changed the answer, and it did not happen — but measurement 4 is the reason this
ticket does not read that as "Windows found nothing real, ever": the leg is not
currently positioned to find the one thing it exists for.

### 5. A separate, transient failure mode — not part of the count above

At the time the brief was written (~15:45 UTC), `ffmpeg-static`'s postinstall
was failing `npm ci` with HTTP 504 fetching a GitHub Releases asset, hitting
`e2e (direct)` and `test (windows-latest)` on unrelated branches. **Re-checked
at filing time and no longer reproducing**: the `windows-latest` job in run
`34131675937` (15:46–15:48 UTC) completed `npm ci` cleanly and failed later, on
the citations assertion, not on an install error; the most recent `downloader`
workflow run on the `dl-43` branch (`34131505805`) also passed `npm ci`. This
was a GitHub-releases outage, not a Windows defect, and not part of the 8-run
count above — recorded so a later reader does not attribute today's transient
504s to "Windows is unreliable."

### 6. The `changes`-job chain, verified

Four `gh run view` calls, as asked:

- `34117774583` — `push`, `main`, **cancelled**. This is repo-25's own push run
  (merge `4bc3e66`, 11:39:47 UTC); it never completed because the next merge
  landed on top of it before it finished.
- `34118068454` — `push`, `main`, **success**, with the `test` job **skipped**
  (`changes` found the diff was markdown-only). So the merge that introduced the
  regression reported green on `main`'s own push trigger, having never run the
  matrix.
- The `changes` gate is real, not a guess:
  `` `.github/workflows/ci.yml:146` "changes:" `` /
  `` `.github/workflows/ci.yml:211` "if: needs.changes.outputs.code == 'true'" ``.
- Only the unfiltered `schedule` trigger ran the matrix against the regression
  and went red — run `34127289168`, 13:25 UTC, the first of the four
  citations-only failures in measurement 1's table. Everything between 11:39
  and 13:25 either skipped the matrix (docs-only diffs) or was cancelled by a
  subsequent push before it could report.

This is why a regression that has been red for three-plus hours and eight
matrix runs was never once flagged on a pull request: every intervening push to
`main` was documentation-only, and `changes` correctly — by its own design —
skipped the matrix for each one. **Not filed separately, and not this ticket's
work either.** The `changes` gate is doing exactly what `.github/workflows/ci.yml`'s
own comments say it should; the gap is that nothing currently owns "a scheduled
failure got looked at within a day," and that is a process question, not a code
change this ticket's Build should carry.

## The decision — do not settle it here

Four options, none picked. They cost differently and at least one pair is not
mutually exclusive.

### A. Remove `windows-latest` from the matrix

Cheapest. Deletes one array entry at
`` `.github/workflows/ci.yml:215` "os: [ubuntu-latest, windows-latest]" ``.

- Ends the dominant source of red immediately — 7 of 8 failures counted here
  disappear outright, and the 8th's Windows half with them.
- **The cost depends entirely on measurement 4, and measurement 4 says the
  thing this option would stop testing is mostly not tested anyway.** The one
  real behaviour currently proven only on a live Windows host is `ytdlp.ts`'s
  `killTree` abort path; losing that is the actual, specific cost, not the
  vaguer "the product diverges on Windows" — that divergence is real, but most
  of it is either already portable or already untested regardless of this
  decision.
- If chosen, `killTree`'s abort path and `assertPathInside`'s Windows branch
  become entirely unverified — not "less verified," genuinely zero coverage of
  a real OS-level API call that this option would remove the only runner able
  to exercise.

### B. Keep it, fix tests as they break

Status quo. Cost measured above: the dominant source of red today is a single
unfixed regression that has now been red for three-plus hours across eight
completed matrix runs without anyone noticing, because the only trigger that
ran it during that window was `schedule`. That is not evidence the leg is
worthless — the regression is real, in the repo's own tooling — but it is
evidence that "someone looks at scheduled red" is not currently true of this
repo, and B does nothing to fix that on its own.

### C. Narrow it — run only the suites that actually diverge on Windows

Restrict the `windows-latest` leg to the engine's process and storage
suites — `tools/downloader/engine/test/ffmpeg-args.test.ts`,
`tools/downloader/engine/test/ffmpeg-runner.test.ts`,
`tools/downloader/engine/test/storage.test.ts` — plus
`tools/downloader/resolvers/test/ytdlp.test.ts` for the `killTree`/`PATHEXT`
paths, so `scripts/` and other POSIX-shaped suites stop running on a platform
they were never written for. **This is a recommendation carried over from the
brief, not a measurement — record it as one if chosen.**

- Would have suppressed all 8 of the failures counted here (none touch the
  suites this option would keep running) while preserving the one real
  Windows-only proof this ticket found (measurement 4's `ytdlp.test.ts` abort
  test).
- Costs a second matrix dimension (a `windows-latest` job scoped by
  `--project`/path rather than running the same `npm test` everywhere) and a
  rule for which suites qualify — a rule that rots the moment a new
  Windows-sensitive test is added somewhere else and nobody remembers to widen
  the scope. `tools/downloader/resolvers/src/resolvers/ytdlp.ts`'s
  `findExecutable` (measurement 4) is exactly this kind of test waiting to be
  written and easy to add in the wrong suite.
- Does not, by itself, fix the `killProcessTree` coverage gap measurement 4
  surfaced — that gap exists inside the very suites C would keep running, and
  needs a new test, not a matrix change.

### D. Keep it non-blocking — run, report, do not gate merges

Run `windows-latest` as `continue-on-error` or a separate, informational
workflow.

- Cheapest way to keep _some_ signal without cancelling merges on it.
- The repo already has a documented case, in this very ticket, of a red
  nobody looked at for three-plus hours because nothing forced anyone to.
  Making the leg non-blocking does not add a mechanism to look at it — it
  removes the one mechanism (a failing gate) that would force the question,
  and measurement 6's window shows that mechanism was already the only thing
  that caught this regression at all.

**No recommendation stated in this ticket's own voice.** C is the option the
brief's author leaned toward before filing, recorded above as inherited
opinion, not as this ticket's conclusion — measurement 4 both supports C (it
would have caught nothing this cycle lost) and complicates it (the coverage C
would preserve is thinner than "the engine's process and storage paths"
suggests, and C does nothing about the specific gap that matters most).
Whoever answers this should read measurement 4 before choosing, not just the
option list.

## Build

**Not startable.** The build is whichever option is chosen; writing it before
the decision would be writing four briefs and discarding three. When the
decision is recorded on this page, replace this section with the steps for the
chosen option and move `status` to `ready` in the same commit.

## Done when

Written against the decision rather than an implementation.

1. The chosen option is recorded on this page as a dated Log entry naming it and
   the reasoning, and `status` moves to `ready` or `done` accordingly.
2. Whichever option is chosen, the ticket that fixes the live `citations.mjs`
   Windows regression (measurement 2) is filed separately — this ticket does
   not fix it, and nothing here should be read as having done so.
3. If C is chosen: the suite list is written down on the ticket that builds it,
   with a rule for what qualifies a suite for the Windows leg, not left to
   whoever edits `ci.yml` next to infer.
4. Whichever option is chosen: the `killProcessTree` coverage gap (measurement 4) is either fixed in the same change or filed as its own ticket — not left
   as a paragraph in this one.

## Log

- **2026-09-07** — Filed. Base `origin/main` at `24e5bf7`. Id taken from the
  union of `docs/work/`, `tools/*/docs/work/`, and the five open pull requests
  at filing time (#175–#179): `repo-` tops out at `repo-30`, `dl-` tops out at
  `dl-46` held by PR #178 (`dl-43-gate-progress-on-what-actually-happened`),
  `pl-` tops out at `pl-37`, all pre-existing on `main` or on an open branch.
  `repo-31` was free on every branch checked. Every number in the brief was
  re-measured rather than trusted; all matched except the run-8 timing
  artifact noted in measurement 1 (it was `in_progress`, not yet `failure`, at
  the moment this session first queried it, and completed with the same
  failure a minute later) and the ffmpeg-static 504 in measurement 5, which had
  cleared by the time this session checked it.
