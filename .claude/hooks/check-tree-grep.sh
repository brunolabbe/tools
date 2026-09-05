#!/usr/bin/env bash
# PreToolUse hook: warn when a tree-walking `grep` is typed into the Bash tool,
# because `grep` in this devcontainer is not GNU grep.
#
# `grep` here is a bash *function*. It execs a bundled `ugrep` under a fixed
# flag set:
#
#     -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn ...
#
# so every `grep` an agent types honours ignore files and skips binaries. There
# is no warning and no exit-code signal — the search just returns less and exits
# 0, so "no matches" reads as a fact about the repo rather than a fact about the
# flags. `command grep` is the spelling for an exhaustive search.
#
# Measured on a four-file fixture (one tracked file, one under an ignored
# directory, one *.log, one holding a NUL byte; all four contain the term):
# `grep -rl` finds **1**, `command grep -rl` finds **4**, and both exit **0**.
# The gap is content-dependent, not a constant: it is however much ignored
# content happens to be in the tree, so two agents measuring the same thing get
# different answers.
#
# The wrapper is **not exported** — `BASH_FUNC_grep` is absent from `export -p`.
# It applies only to commands typed into the Bash tool. A `#!/usr/bin/env bash`
# script, `bash -c`, a hook (including this one) and CI all get real GNU grep,
# so an agent's manual check does not match what the repo's own scripts see: on
# that fixture, 1 inline against 4 through a script and 4 through `bash -c`.
#
# The two spellings also print different path shapes — the wrapper prints
# `tracked.txt` where GNU prints `./tracked.txt` — so feeding both results to
# `comm` or `diff` reports every line as divergent even when the file sets are
# identical. Compare the sets, not the raw output.
#
# Stdin is unaffected: the suppressed flags only govern walking a tree, so a
# `grep -oE` at the end of a pipe answers the same either way. Hence this hook
# fires on `-r`/`-R` only.
#
# Two siblings and a standing note, cited rather than restated (repo-21 exists
# to remove a fact kept in two places):
#
#   - docs/work/repo-20-reviewer-setup-order-builds-the-wrong-tree.md, its Log
#   - .claude/skills/orchestrate-tickets/reference/records.md, the note opening
#     "Measure that exit code without a pipe"
#   - the PR #148 thread, for a missing search path
#
# Advisory, never blocking. Most searches genuinely want the ignore rules, so
# this fires on a correct command far more often than on a mistaken one and a
# blocking exit 2 would be wrong. Filed and reasoned as repo-22.
set -uo pipefail

# No `cd`: unlike the sibling hooks this reads nothing out of the tree.
cmd="$(jq -r '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0

# Strip quoted spans before the boundary test, so a `grep -r ...` that is only
# being *quoted* — in an echo, a message, a search pattern — is not read as one
# being run. Why that matters, and the measurement behind this exact sed, is in
# the sibling hook: .claude/hooks/check-pr-title.sh. Do not restate it here.
bare="$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")"

# Match `grep` only as the command word of a simple command — at the start or
# after a shell operator. That is exactly when the bash function fires: under
# `command grep`, `git grep`, `sudo grep` or `xargs grep` the real binary runs
# and there is nothing to warn about, and each of those puts a word other than
# `grep` in the command-word slot.
#
# `-r` and `-R` arrive inside bundled short-flag clusters far more often than
# alone — `-rl`, `-rn`, `-ril` — so match the cluster. A `-r\b` here would miss
# every real call site in this repo's own tickets.
printf '%s' "$bare" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*grep([[:space:]]+[^;&|()]*)?[[:space:]]+(-[A-Za-z]*[rR]|--recursive|--dereference-recursive)' || exit 0

echo "\`grep\` in the Bash tool is a wrapper around ugrep with --ignore-files --hidden -I: it skips ignored files and binaries, silently, and still exits 0. Use \`command grep\` if the search has to be exhaustive. Reasoning: .claude/hooks/check-tree-grep.sh" >&2
exit 0
