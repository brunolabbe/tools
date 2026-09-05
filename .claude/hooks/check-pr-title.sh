#!/usr/bin/env bash
# PreToolUse hook: refuse `gh pr create` whose --title is not a conventional
# commit.
#
# This repo squash-merges, so the pull request title — not the branch's own
# commits — is the message that lands and the changelog line that ships.
# .githooks/commit-msg cannot see it: it fires on `git commit`, and by the time
# a bad title is on a PR it is on GitHub. Same rule, same script, the one place
# it was not being applied.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

cmd="$(jq -r '.tool_input.command // empty')"

# Strip quoted spans before testing for a command boundary, so that the boundary
# test sees shell structure and not string contents.
#
# This is the fix for the anchor's second recorded misfire (repo-22). The anchor
# below reads a raw `(`, `;`, `&` or `|` as a command boundary; on its own it
# never checked whether that character was a shell operator or just a character
# sitting inside a string. So a harmless `printf` that merely *mentions* this
# command inside a quoted argument, with a stray `(` in front of it, was
# rejected with exit 2 — measured live, against the very Bash call that was
# building the fixture for its own test. The reproduction and the seven-shape
# measurement are in docs/work/repo-22-grep-is-a-wrapper.md.
#
# **Strip for the boundary test only, never for the extraction below.** The
# title is read out of a quoted span of `$cmd`; substitute `$bare` there and
# every real invocation turns into the "without an inspectable --title"
# rejection instead. That is the trap in this three-line change.
#
# It strips per line, because the anchor is applied per line. A quoted span that
# spans a newline is not stripped, and a command with an odd number of quotes
# can strip the wrong side — both cost a match, not a false block, and neither
# has been observed.
bare="$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")"

# Match only where the command is actually being INVOKED — at the start, or after
# a shell operator. A plain substring test also fires on the string appearing
# inside a heredoc, a quoted argument or a search pattern, and then blocks a
# perfectly good command with an error about a pull request nobody was opening.
# That is not hypothetical: it happened on this hook's first live run, against a
# heredoc that merely mentioned the command in prose.
printf '%s' "$bare" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)' || exit 0

# --title "…" or -t "…", single or double quoted, or bare.
title="$(printf '%s' "$cmd" | sed -nE 's/.*(--title|[^-]-t)[[:space:]]+"([^"]*)".*/\2/p')"
[ -n "$title" ] || title="$(printf '%s' "$cmd" | sed -nE "s/.*(--title|[^-]-t)[[:space:]]+'([^']*)'.*/\2/p")"

if [ -z "$title" ]; then
  echo "gh pr create without an inspectable --title. The PR title is the message that lands (this repo squash-merges) — pass --title explicitly and check it with: node scripts/commit-message.mjs --text \"<title>\"" >&2
  exit 2
fi

if ! out="$(node scripts/commit-message.mjs --text "$title" 2>&1)"; then
  printf 'The pull request title is the changelog line that ships, and this one is rejected by the repo convention:\n\n%s\n' "$out" >&2
  exit 2
fi
exit 0
