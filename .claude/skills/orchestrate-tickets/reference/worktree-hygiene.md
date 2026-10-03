# Worktree hygiene

## When a worktree goes

`SKILL.md` step 10 is the rule: a ticket's worktrees — builder, gate and fixer —
are removed once its records are committed, its pull request is open, and you
have looked once at that pull request's finished checks. Before removing each:

- `git status --porcelain` is empty, and its head is on origin
  (`git branch -r --contains <head>`);
- its agent has delivered its completion notification and been sent nothing
  since. **The lock is not the test**: subagents run inside your process, so
  every lock names your pid, a live agent's included.

Then `git worktree unlock`, then remove. If CI shows a problem at that look, ask
the owner whether to keep the ticket's worktrees.

**Removing a worktree makes its agent unresumable.** A follow-up after that — a
post-PR fix, a stacked rebase — goes to a fresh `fixer`, not a resume.

**Before the landing, a round is not over because an agent said so.** A builder
can always be woken for one more finding; hold the worktrees until the landing.

**Isolated workflow agents that detach HEAD leave their worktree behind.** Remove
those by hand after the run.

## Branch refs leak even when the directories do not

Removing a worktree leaves its `worktree-agent-*` branch behind, and they
accumulate across sessions. Sweep them at the end of a batch, but check each for
unmerged commits first and delete only those with none — never by name pattern
alone:

```bash
for b in $(git branch --list 'worktree-*' | sed 's/^[* ]*//'); do
  [ "$(git log --oneline origin/main.."$b" | wc -l)" -eq 0 ] && git branch -D "$b"
done
```

## When every agent dies at once

A session usage limit can kill every in-flight agent at the same instant. The
recovery is cheap and the wrong recovery is expensive.

- **Capture pointers, not content**: the worktree path, the branch, the pushed
  tip. A transcription of a live worktree goes stale while you write it. Copy
  content out only for what exists nowhere else — a gate's returned section.
- **Prefer pushing over describing.** Tell an agent securing its work to push
  the thing that exists nowhere else first; the code can be rewritten.
- **Check for damage before resuming anything**: the shared checkout is clean,
  every builder branch is intact at its reported tip, and nothing stray reached
  `origin` (`git ls-remote --heads origin`).
- **Resume by message, do not re-dispatch.** A message resumes the agent from
  its own transcript and keeps its partial work.
- **A result carried across an interruption is not evidence.** A gate that died
  mid-mutation may be sitting on a mutated tree: have it restore to the branch
  tip and re-run its positive control before continuing.

## The worktree an agent is in is not always the tree it just tested

Two ways to get a green run that proves nothing, and neither announces itself:

- **Running from the shared checkout.** A command given an absolute path under
  `/workspaces/tools` tests `main`'s copy, not the branch.
- **Testing a worktree with no `dist`.** A directory timed at 2 s was really
  28 s: 17 of 18 files failed to import. Read the test count, never the wall
  clock alone.

## Give a new worktree its dependencies without installing them

`bash /workspaces/tools/.claude/scripts/worktree-farm.sh`, then `npm run build`.
Never `npm install` or `npm ci` in a worktree: it takes minutes, and can fail
outright when a postinstall cannot reach the network. The farm mirrors the shared
checkout, so after a new workspace merges, the shared checkout itself needs one
`npm install` — the owner's to run, or yours when no peer session is live.
