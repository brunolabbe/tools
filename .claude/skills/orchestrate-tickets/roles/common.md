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
     If the farm warns that the shared checkout is stale, stop and report it.
  2. `npm run build`. Without `dist`, suites fail with `packageEntryFailure`,
     which reads as a test failure and is not.

  Neither step fails loudly if skipped: Node resolves workspace packages from
  the shared checkout instead, so a correct change looks broken or a broken one
  looks fine.
- **A red/green across packages needs a rebuild between the two states**, and a
  grep of `dist` to prove which state you measured.
- **For a new workspace, check the lockfile with
  `node scripts/check-lockfile-sync.mjs`**, not `npm ls`.

## Your scratch directory

Your dispatch names one, and it already exists. Write every scratch file there,
under your own subdirectory (`build/`, `gate-<n>/`, `land/`), and never list the
ticket's scratch root: a gate must not see a builder's files.

## The sandbox refuses some ordinary shell shapes

It says "too complex to verify that it stays inside the worktree" and nothing
else warns you. **Rewrite the shape; do not report a broken channel.**

What works:

- one plain command per call, with literal absolute or worktree-relative paths;
- a script or a long text **written to your scratch directory with the Write
  tool**, then run or passed by path (`node <file>`, `git commit -F <file>`,
  `gh pr comment --body-file <file>`);
- reading an exit code by redirecting output to a file in one call and reading
  the file in the next.

What is refused, or silently does the wrong thing:

- heredocs, and `cat >` or `>>` redirections that build a file;
- a command naming `git` more than once, a git command followed by `echo $?`,
  and any text containing `git` or `github` inside a `node -e` program or a URL
  argument;
- a path held in a shell variable, and `for` loops over `git`, `gh` or `sed`;
- `python3`, `NODE_OPTIONS=… node`, a bare foreground `sleep`;
- `pkill -f` and `pgrep -f`, which match your own shell — kill by pid.

**Confirm a commit landed** with `git log -1` as its own call before you measure
anything that depends on it: a refused `git add && git commit` leaves the tree
uncommitted and says nothing.

**Preflight runs longer than a foreground call allows.** Run it in the
background with its output and its exit code written to files in your scratch
directory, then wait with `until [ -s <exit file> ]; do sleep 3; done`. The
harness's "completed" notice reports the outer shell, not preflight; the exit
file is the signal.

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
