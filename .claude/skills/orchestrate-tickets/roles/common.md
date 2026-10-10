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
- **Populate and build before you measure anything**, after your role page's
  checkout step:
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
  looks fine.
- **A dependency your ticket adds is not in the farm.** Run
  `npm install --ignore-scripts` in your worktree once, and say so in your
  report; it is the one install allowed here.
- **A red/green across packages needs a rebuild between the two states** —
  `contract` included; `e2e:serve` builds only `web` — and a grep of `dist` for
  an identifier the change introduced, to prove which state you measured. A
  bare word matches comments.
- **For a new workspace, check the lockfile with
  `node scripts/check-lockfile-sync.mjs`**, not `npm ls`.

## Your scratch directory

Your dispatch names one, and it already exists. Write every scratch file there,
under your own subdirectory (`build/`, `gate-<n>/`, `land/`), and never list the
ticket's scratch root: a gate must not see a builder's files. A script there is
`.mts` — a `.ts` runs as CommonJS with no `package.json` beside it, and
top-level `await` fails — and it imports worktree modules by absolute path
through a dynamic `import()`.

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
  `git commit -F <file>`, `gh pr comment --body-file <file>`);
- reading an exit code by redirecting output to a file in one call and reading
  the file in the next.

A refusal takes the whole chain with it: nothing before the refused part ran
either. `pkill -f` and `pgrep -f` match your own shell — kill by pid.

**Confirm a commit landed** with `git log -1` as its own call before you measure
anything that depends on it: a refused `git add && git commit` leaves the tree
uncommitted and says nothing.

**Preflight runs longer than a foreground call allows.** Run it in the
background with its output and its exit code written to files in your scratch
directory, then wait with `until [ -s <exit file> ]; do sleep 3; done`. The
harness's "completed" notice reports the outer shell, not preflight; the exit
file is the signal. The same shape for any suite that can run past two minutes:
three resolver spec files took 490 s.

## Point every run at the narrowest thing that can fail

One spec file while you work — seconds — and the tool's project once at the end.
Read the test count on every timing: a suite that cannot load is the fastest
suite there is.

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
- **End with what these pages got wrong or omitted for this job.**
- **Never write `# Done`**, and **do not spawn subagents**.

## Findings you are handed

Builders and fixers receive a gate's findings pasted as the reviewer wrote them.
Reproduce each one before changing anything — a check that fails before the fix
and passes after it — and push back rather than transcribe: if a finding does not
survive contact with the code, do not fix it, and report the command and output
that refute it.
