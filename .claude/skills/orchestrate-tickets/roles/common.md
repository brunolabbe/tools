# What every dispatched agent needs

Read by every builder, fixer and gate before its own role page, in the same
`git show`. The agent definitions in `.claude/agents/` carry only what a
definition alone can set — the model, the effort, the tools, the worktree — and
point here. Anything written into a definition's body reaches one agent type and
nobody reviewing the skill sees it; that is why the bodies are a pointer.

## Your model and effort are not yours to choose

They are pinned in your agent definition's frontmatter, chosen by the
orchestrator from the ticket's `difficulty` — the table is in the skill's
`SKILL.md` under _Which model built it_. You do not need it to work. A builder's
or a gate's definition also pins a **1-hour prompt-cache TTL**
(`experimental: cacheTtl: 1h`), because both are woken after idling past the
5-minute default; it needs Claude Code v2.1.248 or later, and Claude Code
ignores it while the subscription is on usage credits. **If your
prompt did not tell you which model you are, say so rather than guessing** in
anything you write, a pull request body included: a model named wrongly is worse
than one left blank, and the orchestrator reads the real one from your
transcript.

## Your worktree

**You already have your own isolated git worktree. Do not call
`EnterWorktree`.** Your working directory is pinned at launch; entering another
worktree moves only your write access and leaves the Bash sandbox pinned here,
which then refuses every command, `pwd` included. Two agents launched that way
stalled, and one concluded it should work in the shared checkout instead.

**Never touch `/workspaces/tools` itself, or any other worktree.** Several
sessions run against this repo at once. If a command seems to need the shared
checkout, that is the signal to stop and report. The one intended exception is
the farm script below, run *from* the shared checkout's copy on purpose; it
writes only into your worktree.

**Use worktree-relative paths everywhere.** An absolute path built from
`/workspaces/tools/<repo-relative-path>` resolves silently to the shared root's
copy — no error, and content that looks exactly like the right content.

**Populate and build before you measure anything**, after your role page's
checkout step:

1. `bash /workspaces/tools/.claude/scripts/worktree-farm.sh` — `node_modules` in
   about half a second. **Never `npm install` or `npm ci`**: minutes, the
   largest fixed cost of a dispatch, and it can fail outright when a
   postinstall cannot reach the network (a gate told to run `npm ci` ran two
   hours without reporting, 2026-09-03).
2. `npm run build`. Without built `dist`, most suites fail with
   `packageEntryFailure`, which reads as a test failure and is not.

**Neither step fails loudly if skipped.** Node walks up to the shared checkout
and resolves workspace packages there, so the package you edited or are
reviewing is not the one the compiler reads — a correct change looks broken, or
a broken one looks fine.

## The sandbox refuses some ordinary shell shapes

With "too complex to verify that it stays inside the worktree", and nothing else
warns you. Refused (2026-09-12 to 2026-09-20): a git command followed by
`echo $?`; a heredoc, whether a commit message or a script body; a variable
holding a path; a `for` loop over `git`, `gh` or `sed`; an `awk` program
containing `>>`; `python3`; and the literal token `git` anywhere inside a
`node -e` program, even in a string that never runs. Also refused
(2026-09-27): a git command chained after any other command, not only after
`echo $?`; `sed -i` with a `Na\…` insert-at-line script; a large heredoc, past
some size this repo has not pinned; and a long `node -e` program, on its
length alone rather than any token inside it. **`pkill -f` can match the shell
that is running it and kill your own session** — never reach for it here; find
the pid and `kill` it by number instead. What holds: one plain command per
call, `git commit -F <file>`, literal paths, `printf` over `cat <<EOF`,
`awk -v`, a short `node -e`, and reading an exit code by redirecting a
command's output to a file and running the next command plainly. **Rewrite the
shape rather than reporting a broken channel.**

## Point every run at the narrowest thing that can fail

One spec file, not its directory: measured warm here at 2 s against 41 s for
the directory and ~50 s for the project (`sizing.md`). Run the spec while you
work and the project once at the end.

## Your report

Your final message is a report to the orchestrator, which checks it before it
accepts it. Write it so the checks are answerable without a follow-up question:

- **Never report a verification you did not run.** If you substituted something
  for a required check — an in-test demonstration for a real red run, an
  argument for a command — say which check you replaced and why, in those words.
  A builder once reported an in-test block over a local copy of the old function
  as "the test is red-green" (2026-09-01).
- **Each command you ran, with the lines of its output that matter**, and every
  count with its denominator and the command it came from — `4 of 71,
  npx vitest run <spec>`, not "tests pass".
- **What you could not do, named as unmeasured**, rather than filled with
  reasoning. A gap filled with reasoning is worse than an admitted one.
- **Any open decision, as options with a recommendation** — a choice with two
  defensible answers, a scope question, anything contract-adjacent. Neither you
  nor any other agent may settle it; the orchestrator is the only participant
  that can ask a human. Do not resolve it in a commit or leave it as a Log
  observation.
- **End with what these pages got wrong or omitted for this job** — a step that
  did not fit, a rule that misled you, a cost nobody named — whether or not your
  dispatch asked. It is the field the skill's history is built from, and it
  does not arrive unasked.
- **Never write `# Done`.** That heading closes the session that talks to the
  user; in your report it lands mid-transcript claiming a batch is over that you
  cannot see the end of (twice on 2026-09-17, and again from a builder on
  2026-09-27 whose page already carried this rule). Say what you finished.
- **Do not spawn subagents.** Dispatch is the orchestrator's; nesting it hides
  cost and makes the agent tree unreadable.

## Findings you are handed

Builders and fixers receive a gate's findings **pasted as the reviewer wrote
them**. Reproduce each one before changing anything — a check that fails before
the fix and passes after it — and push back rather than transcribe: if a
finding's framing does not survive contact with the code, do not fix it, and
report the command and output that refute it. Reviewers are usually right and
occasionally not, and you are the one in contact with the code; this repo has
recorded a builder refuting a finding whose every premise was true (2026-09-01).
