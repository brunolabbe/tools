# What every dispatched agent needs

Read by every builder, fixer and gate before its own role page, in the same
`git show`. Your model and effort are pinned in your agent definition; if your
prompt did not tell you which model you are, say so rather than guessing in
anything you write, a pull request body included.

## Your worktree

**You already have your own isolated git worktree. Do not call
`EnterWorktree`**, and never touch `/workspaces/tools` itself or any other
worktree: several sessions run against this repo at once.

- **Use worktree-relative paths.** An absolute path built from
  `/workspaces/tools/<repo-relative-path>` resolves silently to the shared
  checkout's copy.
- **`origin/main` moves under you** whenever any session fetches. Use the sha
  your dispatch names, or `git rev-parse origin/main` once and reuse it.
- **Populate and build before you measure anything**, in the order your role
  page gives (a builder farms before it branches, a gate after it detaches):
  1. `bash /workspaces/tools/.claude/scripts/worktree-farm.sh`. **Never
     `npm install` or `npm ci`**, and no npm command that writes the lockfile.
     If the farm warns that the shared checkout is stale, stop and report it:
     the remedy is the orchestrator's, and you may not apply it.
  2. `npm run build`. Without `dist`, suites fail with `packageEntryFailure`,
     which reads as a test failure and is not. `api` resolves `engine` and
     `contract` through their `dist`, so a source change there is invisible to
     `api`'s tests until you rebuild.

  Neither step fails loudly if skipped: Node resolves workspace packages from
  the shared checkout instead, so a correct change looks broken or a broken one
  looks fine. **A branch whose diff is markdown only** — `git diff --name-only
  <base sha>...HEAD` lists nothing but `.md` — skips both steps and says so in
  the report (eight filing and ticket-only gates did, 2026-10-20 to
  2026-10-24); a measurement that runs a workspace's code builds first.
- **A dependency your ticket adds is not in the farm.** Run
  `npm install --ignore-scripts` in your worktree once, and say so in your
  report; it is the one install allowed here. **A workspace the shared
  checkout has no link for is different** — one your branch adds, or one
  `main` added after the shared checkout's last install: that install replaces
  the farm's links and leaves native modules unbuilt (lg-8: 63 of 101 failed on
  `better_sqlite3.node`). **The farm links these itself** (repo-117): after its
  copy loop it reads the worktree's own `package.json` `workspaces` and links
  each one `node_modules` lacks, printing a `linked workspace <name> -> <path>`
  line for each, and it names (stderr, with the `ln -s`) any it could not link.
  Read those lines rather than comparing directories; every agent of four
  batches linked `packages/ui` by hand before it did (2026-10-20 to
  2026-10-21). **The hand-link is the fallback for a workspace your branch adds
  after you farmed**, since the farm reads `package.json` as it stood: run the
  farm again (it is idempotent), or `ln -s ../../packages/<name>
  node_modules/@webtools/<name>` for a `packages/` workspace,
  `ln -s ../../tools/<tool>/<package> node_modules/@<tool>/<package>` for a
  tool's, and say so in your report; a gate on that branch does the same.
- **Undo a temporary mutation from a commit, never with `git checkout -- <file>`**,
  which restores the index and discards every uncommitted edit to that file,
  yours included (lg-8's builder lost its three Dockerfile lines that way).
  Commit first, with a conventional subject such as `test(<scope>): mutation
  baseline` — the commit-msg hook rejects `wip:` — and restore with
  `git checkout <sha> -- <path>`.
- **If the auto-mode classifier denies a temporary source mutation** ("Security
  Test Removal", lg-10's red/green), do not try another spelling: run the new
  spec against the base's source in a second tree instead, and say in your
  report which check that replaced. The second tree is
  `git worktree add --detach /workspaces/tools/.claude/worktrees/<role>-<id>-<n> <sha>`,
  then the farm and `npm run build` in it from one script run with
  `bash <file>`, and `git worktree remove --force` before you report;
  `reviewer.md`'s second-tree recipe has the traps (a `cd` in a separate call
  farms the wrong tree; the Edit tool cannot write there; `git` run in it is
  refused as a change of directory out of your worktree, so change its files
  by `cp` from your scratch directory and read it with `node <script> <tree>`).
- **End every commit message with the `Co-Authored-By` trailer** your session's
  attribution reminder gives, in the commit that lands it; never rewrite a
  pushed commit, or one a Log cites, to add it (repo-101 moved three cited shas
  that way).
- **A red/green across packages needs a rebuild between the two states** —
  `contract` included; `e2e:serve` builds only `web` — and a grep of `dist` for
  an identifier the change introduced, to prove which state you measured. A
  bare word matches comments.
- **For a new workspace, check the lockfile with
  `node scripts/check-lockfile-sync.mjs`**, not `npm ls`.
- **A `\uXXXX` escape typed into Write or Edit can land as the literal
  character** (lg-57: U+FEFF reached tests, the ticket and two gate sections,
  each repaired by a script). Build an invisible character in code with
  `String.fromCharCode`, and check any file you typed one into with
  `grep -cP '\x{feff}'` before you commit it.

## Your scratch directory

Your dispatch names one, and it already exists. Write every scratch file there,
under your own subdirectory (`build/`, `gate-<n>/`, `land/`), and never list the
ticket's scratch root: a gate must not see a builder's files. **A gate reads
exactly the paths its dispatch names and nothing else there** — the raw data a
measurement ticket's tables are re-derived from, say `build/scratch/raw/`
(owner, 2026-10-17; both pl-56 gates were handed it and flagged the conflict).
A script you hand to another agent takes the tree and its output directory as
arguments: dl-115's gate scripts and dl-125's `boundary.mjs` hard-coded both,
so the next agent could not run them on its own tree. A script there is
`.mts` — a `.ts` runs as CommonJS with no `package.json` beside it, and
top-level `await` fails — and it imports worktree modules by absolute path
through a dynamic `import()`. **Run every scratch script with your worktree as
the working directory** — `node --import tsx <scratch>/<script>.mts <tree>
<out>` from the worktree root: from the scratch directory `tsx`,
`vitest/config` and every bare package are `ERR_MODULE_NOT_FOUND`, and `gh`
answers `not a git repository` (five gates and two builders, 2026-10-18 to
2026-10-24).

## The sandbox refuses some ordinary shell shapes

The refusal is the harness's worktree-isolation check, not this repo's. It reads
your whole command string and refuses whatever it cannot prove stays inside your
worktree — "too complex to verify", "cannot be shown not to be git" — and it
refuses chains, loops, variables, substitutions, inline environment prefixes,
heredocs and a redirect beside a `git` call; the same shape can pass once and be
refused the next time. **Rewrite the shape; do not report a broken channel, and
do not learn a list** — five batches added shapes to one here and never
finished it.

What works:

- one plain command per call, with literal absolute or worktree-relative paths;
- a script or a long text **written to your scratch directory with the Write
  tool**, then run or passed by path (`node <file>`, `bash <file>`,
  `git commit -F <file>`, `gh pr comment --body-file <file>`) — **bare**:
  `bash <file> > out 2>&1; echo $?` is refused where `bash <file>` runs, so a
  redirect and an exit-file write go inside the script (pl-62's filer, lg-68's
  gate), and a `cd <your worktree> &&` in front of a script that runs `git`
  lets it through where the bare call "cannot be shown not to run git"
  (lg-65's Build 1);
- an exit code written to a file by the script itself, read in the next call.

A shape this list does not cover is not a defect in this page: say so in your
report only when a shape listed here was refused (the reviews of 2026-10-10
and 2026-10-24 dropped twelve and nine shape items).

A refusal takes the whole chain with it: nothing before the refused part ran
either. `pkill -f` and `pgrep -f` match your own shell — kill by pid.

**Confirm a commit landed** with `git log -1` as its own call before you measure
anything that depends on it: a refused `git add && git commit` leaves the tree
uncommitted and says nothing.

**Preflight runs longer than a foreground call allows, and so does
`review-record.mjs --land`, which runs preflight inside it.** Run either from one
script in your scratch directory that writes its output and its exit code to
files there, called bare — `bash <file>` — with the Bash tool's
`run_in_background: true`: the harness re-invokes you when the script exits,
and the exit file is the signal. A foreground `until … sleep` loop is blocked
by the Bash tool (pl-62's gate 2, 2026-10-24); `cmd > out 2>&1; echo $? > exit`
appended to the call is refused and runs nothing (lg-68's gate); and a
`( … ) &` wrapper reports `completed (exit code 0)` for the wrapper while the
exit file never appears (two filers, 2026-10-18). The harness's notice reports
the shell, never preflight. A downloader preflight ran 84–104 s on 2026-10-18
at `335efcd4` (dl-129's filing, PR #568), where it ran 598 s before dl-117. The
same shape for any suite that can run past two minutes: three resolver spec
files took 490 s.

That recipe is for preflight, `--land` and a suite run, where the agent has
nothing else to do while it waits and a poll costs little. **A gate's sweeps
follow `roles/reviewer.md` instead**, _What makes a gate worth its cost_
("Sweep inside the budget your dispatch names"): one background job, one exit
file, waited on once when nothing else is left, inside the dispatch's budget.
A gate's transcript is large, and every poll re-reads it.

## Reading a pull request's checks

`gh pr checks <n>` and `gh pr view <n> --json headRefOid,statusCheckRollup`,
naming the sha in anything you conclude, run from your worktree: `gh` needs a
git working directory, and from the scratch directory `gh run view` fails
"failed to determine base repo" (repo-106's builder).

- **Checks register up to a minute after a push.** An empty list is not green:
  `until ! gh pr checks <n> | grep -q pending` returns at once on it (dl-106).
- **A run still in progress has no log.** `gh run view <run> --log` and
  `--log-failed` answer "logs will be available when it is complete" until the
  whole run finishes; `gh run view <run> --json jobs` gives each step's
  conclusion at once. Once it has finished, `--job <id> --log-failed` prints the
  failing tests, and `--job <id> --log | grep "<test name>"` the per-test
  duration a timing line needs. Add `--attempt <n>` for an earlier attempt:
  without it a job id from attempt 1 returns the latest attempt's log.
- **A check `cancelled` on a sha with a later run of the same check on that sha
  is superseded**: the later run is the reading (`pr-title` on #420 and #417).
- **A `skipped` matrix is no baseline.** A run named as a "before" is read with
  `--json jobs` first; the push run at bb4d2044 tested nothing (repo-99).
- **The informational Windows leg is read, not graded.** A red one in code the
  diff cannot reach is named with its failing test and the latest reading of
  that leg on `main`; it is a finding only when the diff reaches it. That
  reading is the newest `push` run on `main` whose matrix ran:
  `gh run list --branch main --workflow ci.yml --event push --limit 10 --json databaseId,headSha,conclusion`,
  then `gh run view <id> --json jobs` down the list until a
  `test (windows-latest…)` job has a conclusion — a docs-only push skips the
  matrix and the next merge cancels the run before it (lg-30's gate walked
  back four).
- **Do not wait on a running leg past a few minutes.** A gate grades the line
  `unproven (gate)` and names the sha; the lander reads the leg before its push
  (`SKILL.md` step 9).

## Point every run at the narrowest thing that can fail

One spec file while you work — seconds — and the tool's project once at the end.
Read the test count on every timing: a suite that cannot load is the fastest
suite there is. **After a `timeout` around a test run returns 124**, look for a
survivor (`ps -eo pid,etimes,pcpu,args | grep vitest`) and kill it by pid:
lg-10's lander found its vitest still at 93 % CPU 63 s after `timeout -k 5 60
npx vitest run …` had returned, and the classifier can refuse a
`kill -- -<pgid>` ("Interfere With Workloads", lg-68's builder).

- **Every workspace an `api` imports is read through its `dist`** —
  `contract`, `engine`, `@ledger/books` alike: rebuild it before a test
  against it (lg-68: 1 of 1,680 failed on a stale `books`).
- **A probe spec exits 1 on vitest's 20 s `testTimeout` after writing every
  result**: read completeness from the results file, never from the exit code
  (lg-59's `gate-lg40c vitest exit 1`, every shard finished).
- **A probe copied into a package's `test/` fails a concurrent `npm run check`
  on `oxfmt --check`**: remove it before any check runs, yours or a peer's
  (lg-59's `Format issues found in above 1 files`).
- **An e2e run takes a private port**: each tool's Playwright config serves one
  fixed default (`E2E_PORT`, ledger's `8108`), and two sessions on it collide
  (lg-64's gate: `is already used`).

## Your report

Your final message is a report to the orchestrator, which checks it before it
accepts it:

- **Never report a verification you did not run.** If you substituted something
  for a required check, say which check you replaced and why.
- **Each command you ran, with the lines of its output that matter**, and every
  count with its denominator: `4 of 71, npx vitest run <spec>`, not "tests pass".
  A suite preflight ran is reported by its preflight `ok` line: preflight prints
  no counts, and re-running a nine-minute project to get them is not asked.
- **What you could not do, named as unmeasured**, not filled with reasoning.
- **Any open decision, as options with a recommendation.** You may not settle
  it in a commit or leave it as a Log observation; only the orchestrator can ask
  a human.
- **End with what these pages got wrong or omitted for this job.** A refused
  shell shape is one only when _The sandbox refuses_ says that shape works.
- **Never write `# Done`**, and **do not spawn subagents**.

## Findings you are handed

Builders and fixers receive a gate's findings pasted as the reviewer wrote them.
Reproduce each one before changing anything — a check that fails before the fix
and passes after it — and push back rather than transcribe: if a finding does not
survive contact with the code, do not fix it, and report the command and output
that refute it.
