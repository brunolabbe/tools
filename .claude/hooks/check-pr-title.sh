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
# **SUBSTITUTE, DO NOT DELETE — this is the whole design, and two fixes died
# learning it.** Each removed span becomes one `\x01`, never nothing.
#
# Deleting a span moves its neighbours together, and the boundary anchor cannot
# tell an adjacency the text always had from one the deletion just built. That
# is not a hypothetical: it shipped twice, from the same mechanism, and each
# time the fix passed its own tests.
#
#   - deleting a *quoted span*: `x; "note \"gh pr create y\" z"` collapses to
#     `x; gh pr create y` — the `\"` pairs as a real quote, `note` is deleted,
#     and the phrase lands against the `;`.
#   - deleting an *escaped character*, the fix for the above: `true; \x gh pr
#     create` collapses to `true; gh pr create`. `\x` is a no-op escape, so that
#     command runs a program named `x` and never invokes this one at all.
#
# `origin/main`, which strips nothing, is correctly silent on both. Each fix
# introduced its own false block. A sentinel ends the class rather than the
# instance: a deletion can never again close a gap, because nothing is removed.
#
# Why `\x01` specifically — it must be none of the things the anchor reacts to:
# not whitespace (or `[[:space:]]*` would skip it), not one of `; & | (` (or it
# would forge the very boundary it is there to block), and not a character of
# the phrase. It need NOT be absent from real input: a stray `\x01` someone
# actually types is inert for the same three reasons, so there is no sentinel
# collision to defend against. Not `\x00`, which would truncate the pipeline.
#
# The substitution can only ever *prevent* a match, never create one: it leaves
# one non-matching character where deleting left zero, so its match set is a
# subset of the deleting version's. That is the property being bought.
#
# **Strip for the boundary test only, never for the extraction below** — see the
# trap named above; the title is still read out of raw `$cmd`.
#
# It strips per line, because the anchor is applied per line. A quoted span that
# genuinely spans a newline is still not stripped; that costs a match, not a
# false block.
bare="$(printf '%s' "$cmd" | sed -E "s/\\\\./\x01/g; s/'[^']*'/\x01/g; s/\"[^\"]*\"/\x01/g")"

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
