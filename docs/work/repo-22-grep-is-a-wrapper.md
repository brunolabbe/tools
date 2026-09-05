---
id: repo-22
tool: repo
title: "`grep` here is a wrapper that silently honours ignore files"
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-22 — `grep` here is a wrapper that silently honours ignore files

**Blocked on the Decision below.** Do not start until it is answered: the answer
picks which file the Build edits.

## Why

In this devcontainer `grep` is a bash **function**, not GNU grep. It execs a
bundled `ugrep` under a fixed flag set:

```
-G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg …
```

So every `grep` an agent types honours ignore files and skips binaries. There is
**no warning and no exit-code signal** — which is what makes it worse than the
two sibling footguns below, each of which at least leaves something behind.

Reproduction, needing no repository (measured 2026-09-05). Paste it whole:

```bash
d=/tmp/grep-wrapper-demo; rm -rf "$d"; mkdir -p "$d/ignored"
printf 'ignored/\n*.log\n' > "$d/.gitignore"
echo NEEDLE > "$d/tracked.txt"; echo NEEDLE > "$d/ignored/hidden.txt"
echo NEEDLE > "$d/build.log"; printf 'NEEDLE\x00\n' > "$d/blob.bin"
echo -n "grep:         "; grep -rl NEEDLE "$d" | wc -l          # 1
echo -n "command grep: "; command grep -rl NEEDLE "$d" | wc -l  # 4
grep -rl NEEDLE "$d" >/dev/null; echo "exit: $?"                # 0
```

It takes a literal path and never `cd`s on purpose: the worktree-isolation guard
refuses the `mktemp -d` plus `cd` spelling outright. Even this spelling was
refused once and accepted twice while the ticket was written, so **a refusal is
not a failed acceptance** — run the lines separately and the result is the same.

Four further facts, each measured:

- **The gap is content-dependent, not a constant.** In a clean worktree
  `grep -rl vitest .` and `command grep -rl vitest .` both return **183, with
  identical file sets** — nothing ignored here contains `vitest`. The gap grows
  with whatever ignored subtree happens to be in the tree, so two agents
  measuring the same thing get different answers. `git worktree list` showed
  **12** agent worktrees under the ignored `.claude/worktrees/`
  (`.gitignore:48`) while this was written, up from 8 a day earlier.
- **The wrapper is not exported** — `BASH_FUNC_grep` is absent from `export -p`.
  It applies only to commands typed into the Bash tool. A `#!/usr/bin/env bash`
  script, `bash -c`, a hook and CI all get real GNU grep, so an agent's manual
  check does not match what the repo's own scripts see. In the fixture above:
  inline 1, through a script 4.
- **Stdin is unaffected**, because the suppressed flags only govern walking a
  tree. The documented id sweep in
  `.claude/skills/orchestrate-tickets/reference/concurrency.md` pipes into
  `grep -oE`, and both spellings returned the same answer here.
- **Path shapes differ**: the wrapper prints `tracked.txt`, GNU prints
  `./tracked.txt`. Two searches fed to `comm` or `diff` disagree on every line
  for that reason alone.

**Two siblings, already recorded — cite, do not restate:**

- `grep -l` under an alternation cannot say which alternative matched:
  `docs/work/repo-20-reviewer-setup-order-builds-the-wrong-tree.md`'s Log, on
  branch `docs/record-2026-09-04-orchestration-batch` (PR #148).
- A missing search path still prints matches from the paths that exist, warns on
  stderr and exits 2: the PR #148 thread.
- The family already has a note in
  `.claude/skills/orchestrate-tickets/reference/records.md`, opening "Measure
  that exit code without a pipe". Point at it; do not copy it.

## Decision — open, answer before building

**Where does the rule live?** All three options state the same fact and differ
only in who reads it.

| Option                                             | Cost                                                                                                                                                                                         | Reaches                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A (recommended) — a short block in `CLAUDE.md`** | ~6 lines onto a 269-line, 14.5 kB file that every session pays for                                                                                                                           | every agent, before it types anything             |
| **B — a `.claude/rules/` file**                    | ~25 lines, loaded only on a `paths:` glob match. **Measured blocker:** all five existing rules key on a file being _opened_, and a `grep` is a Bash call, so no path reliably precedes it    | only agents that first open some chosen file      |
| **C — a `PreToolUse` Bash hook**                   | a new script. The mechanism is already wired — `.claude/hooks/check-pr-title.sh`, matcher `Bash` — and its own header records that a naive substring match misfired on that hook's first run | exactly the agent about to run a tree-wide `grep` |

A and C are not exclusive: A is the statement, C is the reminder. B is the one
this ticket recommends against, on the measurement in its row.

## Build

1. Answer the Decision. Record the answer in this file as a
   `## Decision — answered <date>` section, not in the Log.
2. Write the rule in the file the answer names. It must say: `grep` is a
   function here; it honours ignore files and skips binaries; there is no
   warning and no exit code; use `command grep` when a search must be
   exhaustive; and the wrapper does not apply inside scripts, hooks or CI.
3. Cite the two siblings and the `records.md` note by path. **Do not restate
   them** — a fact in two places is the defect `repo-21` exists to remove.
4. If the answer includes option C, keep the hook advisory: warn on stderr, exit 0. Match a tree-walking `grep` (`-r`/`-R`, not already `command grep` or a
   VCS grep) only where it is being invoked, per the matching note in
   `check-pr-title.sh`.

## Done when

- The fenced block under **Why**, pasted into a shell, prints `grep: 1`,
  `command grep: 4` and `exit: 0`.
- `command grep -c 'command grep' <the file the Decision named>` returns ≥ 1,
  and `command grep -c 'ignore-files' <same file>` returns ≥ 1.
- `command grep -c 'repo-20' <same file>` and
  `command grep -c 'records.md' <same file>` each return ≥ 1, while
  `command grep -c 'alternation' <same file>` prints `0` and exits 1, which is
  `grep`'s no-match code, not a failure — proving the siblings
  were cited rather than copied.
- `npm run check` passes, `npm run format` leaves the tree clean, and
  `node scripts/status.mjs --json` exits `0`.
- If option C landed:
  `printf '{"tool_input":{"command":"grep -rl x ."}}' | bash .claude/hooks/<hook>.sh; echo $?`
  prints the warning and `0`; the same input with `command grep -rl x .` prints
  nothing.

## Log

**2026-09-05 — filed.** Every number above was re-measured in a fresh worktree
off `c37cab9`. Two of them corrected the brief that requested this ticket.

- The brief reported `183` vs `187` in a clean worktree. Here both spellings
  returned **183, with identical sets**; the only difference was the `./`
  prefix, which made a first `comm` run report all 183 files as divergent. The
  honest claim is not a number — it is that the gap tracks whatever ignored
  content is in the tree.
- The brief's own correction (that `.claude/worktrees/` produced its 2592-file
  reading, not the wrapper) is upheld, and is why this ticket leads with a fixed
  synthetic fixture instead of a repo-wide count.
- **Not measured:** the shared checkout `/workspaces/tools`. The command needed
  `--exclude-dir=.git`, which the worktree-isolation guard refuses from an
  isolated agent; it was not respelled. The 12-worktree count stands in for it.
- The id sweep ran both spellings and they agreed. `repo-21` lives on
  `origin/repo-cleanup-orchestrate-skill`, which has no PR, so the documented
  union-of-files sweep cannot see it — the caveat `concurrency.md` already
  records. `repo-22` is the union of `main`, the open PRs, and that branch.
- The worktree-isolation guard refused the reproduction once and accepted the
  same fixture twice, differing only in an `echo -n` label. Noted under **Why**
  so a reviewer does not read a refusal as a failed acceptance. Not filed
  separately: it is an observation about the harness, not about this repo.
- `difficulty: standard` rates the build after the Decision is answered: option
  A is prose, but option C is a shell matcher whose predecessor misfired live.
