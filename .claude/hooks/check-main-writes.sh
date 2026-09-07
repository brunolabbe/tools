#!/usr/bin/env bash
# PreToolUse hook: refuse the commands that put code on `main` without a human —
# `gh pr merge` in any spelling, and the `git push` spellings that reach `main`
# past the deny list's globs.
#
# This is repo-15's tier 1, and only tier 1: decision A1, answered 2026-09-07.
# See docs/work/repo-15-deny-list-does-not-protect-itself.md for the threat
# table, the options that were declined, and the objection this scope carries.
#
# WHY A SECOND LAYER AT ALL, WHEN THE DENY LIST ALREADY SAYS THIS
#
# Because the deny list is a string-prefix match and misses spellings of the
# same act. Measured against `.claude/settings.json` at repo-15 build time, the
# rules `Bash(git push * main*)` and `Bash(git push *:main*)` need a literal
# " main" or ":main" in the command, so all three of these are ALLOWED by them:
#
#     git push origin +main            the `+` refspec sits where the space was
#     git push origin refs/heads/main  same reason
#     git push                         bare, from a checkout tracking main
#
# and `Bash(gh pr merge *)` needs an argument, so bare `gh pr merge` — which
# opens an interactive picker — is allowed by that glob too. (Whether the real
# matcher reads a trailing `*` as requiring an argument was NOT settled: see
# "unmeasured", below.)
#
# WHAT THE REMOTE ACTUALLY REFUSES, WHICH IS NOT WHAT IT LOOKS LIKE
#
# Ruleset 20870721 on brunolabbe/tools, re-read 2026-09-07, enforcement active,
# bypass never, condition `ref_name: [include: [~DEFAULT_BRANCH]]`:
#
#     deletion, non_fast_forward,
#     pull_request: [required_approving_review_count: 0]
#                   [require_last_push_approval: false]
#
# So the push rows above are double-covered — the server refuses them too, and
# this hook closes them for legibility rather than because they are live. The
# merge row is the opposite: **`required_approving_review_count: 0`**, and
# `require_last_push_approval: false`. The server requires a pull request and
# then requires NO HUMAN ON IT. `gh pr merge` is held by the deny rule and by
# this file, and by nothing else anywhere.
#
# THE LIMITS, WHICH ARE THE CEILING OF THE MECHANISM AND NOT BUGS TO FIX
#
#   - INDIRECTION DEFEATS IT. A PreToolUse hook is handed a command string. An
#     agent that writes /tmp/x.sh and runs `bash /tmp/x.sh` presents a string
#     this file cannot read through, and so can `$(echo Z2gg… | base64 -d)`, a
#     shell alias, a `git` alias in a config the agent just wrote, or an `npm`
#     script. This is the same ceiling CLAUDE.md already names for the deny list
#     itself ("/bin/echo defeats a deny on echo"). Raising cost and making
#     intent explicit is the whole benefit; closing the hole is not on offer.
#
#   - IT DOES NOT PROTECT ITSELF. This file is tracked, writable, and named by
#     no deny rule — 0 of the 11 rules mention `.claude`, `settings` or `hooks`,
#     and 0 of them are `Edit(`/`Write(` rules at all. An agent that can edit
#     `.claude/settings.json` can unregister this hook, and an agent that can
#     edit this file can gut it. repo-15 §1 is uncovered by every mechanism this
#     repo has, and A1 does not cover it either: that was declined on cost, with
#     the objection recorded rather than answered — "it leaves the guardrail
#     editable, which makes every other rule advisory". A2 is the option that
#     closes it and is not re-argued as new. Do not read this hook as evidence
#     that the guardrail is protected; it is evidence that one act is.
#
#   - IT UNDER-BLOCKS ON PURPOSE, IN ONE DIRECTION ONLY. A quoted argument is
#     invisible to the argument scan below, so `git push origin "main"` and
#     `git push origin '+main'` are NOT matched — measured, not assumed. That is
#     a miss, and a miss is the side to err on: a hook that wrongly blocks
#     trains everyone to route around it, and routing around it works. The push
#     half is double-covered by the ruleset anyway.
#
#   - IT OVER-BLOCKS IN EXACTLY ONE PLACE, AND IT IS KNOWN RATHER THAN LATENT.
#     The quote strip and the boundary rule work per line, so an UNQUOTED
#     mention at the start of a heredoc body line reads as an invocation and is
#     refused — measured: a heredoc whose body line is `gh pr merge 129
#     --squash`, or `git push origin +main`, or the same indented as a fenced
#     code block, all exit 2. check-pr-title.sh has had the identical shape
#     since it shipped. It costs nothing in practice because markdown here is
#     written with the Write/Edit tools rather than piped through a heredoc, and
#     a quoted mention is silent either way — but write a document containing
#     these commands through `cat <<EOF` and this hook will stop you. That is
#     the trade, stated so it is met in a comment rather than in a refusal.
#
#   - `gh api` IS NOT TOUCHED HERE, and that is decision B1 rather than an
#     oversight. `gh api -X PUT repos/o/r/pulls/N/merge` and the branch-
#     protection call are tier 1, and they are held by the blanket
#     `Bash(gh api *)` deny rule, which stays exactly as it is. Adding a path
#     match for them here would be the first half of the request parser
#     (option B2) that was declined — and repo-15 names "B2 without
#     self-protection" as the one combination to refuse.
#
# UNMEASURED, AND STATED AS UNMEASURED
#
# Whether the real permission matcher treats `Bash(gh pr merge *)` as covering
# bare `gh pr merge`. repo-15's table is an anchored-glob reading of a
# documented string-prefix match, not a reading of the implementation. The
# throwaway-`settings.local.json` probe repo-15 suggests was attempted at build
# time and was INCONCLUSIVE: its positive control did not fire, because the file
# was not reloaded into the running session. It must not be settled by
# attempting a real merge. This hook blocks the bare form either way, so the
# answer changes the size of the gap it closes, not whether it closes one.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

cmd="$(jq -r '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0

# Strip quoted spans and escaped characters before looking for shell structure,
# so the boundary test below sees structure and not string contents. Borrowed
# verbatim from check-pr-title.sh rather than re-derived — its header carries
# the reasoning, the two shipped false blocks that produced it, and why each
# removed span becomes one \x01 instead of nothing. Do not re-invent it here and
# do not "simplify" it to a deletion; repo-22 records what that costs.
bare="$(printf '%s' "$cmd" | sed -E "s/\\\\./\x01/g; s/'[^']*'/\x01/g; s/\"[^\"]*\"/\x01/g")"

# Same boundary rule as that hook's anchor, applied by splitting instead of by
# matching: a command is invoked at the start of the string or after a shell
# operator. Splitting is what this file needs because the push half must read an
# invocation's OWN argument list — `git push origin feature && echo main` must
# not be blocked by the `main` that belongs to the echo.
#
# `>` and `<` are deliberately absent: a redirect does not start a new command,
# and splitting on `<<` would cut a heredoc's introducer off its own line.
segments="$(printf '%s' "$bare" | sed -E 's/(\&\&|\|\||[;&|()])/\n/g')"

# The argument scan below word-splits on purpose, which is also glob expansion
# unless it is turned off. `git push origin *` must tokenise as `*`, not as the
# contents of the working directory.
set -f

block_merge=0
block_push=""

while IFS= read -r segment; do
  if printf '%s' "$segment" | grep -qE '^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
    block_merge=1
    continue
  fi

  printf '%s' "$segment" | grep -qE '^[[:space:]]*git[[:space:]]+push([[:space:]]|$)' || continue

  args="$(printf '%s' "$segment" | sed -E 's/^[[:space:]]*git[[:space:]]+push//')"

  # A command that cannot push is not this hook's business. `--dry-run` and
  # `--help` are not an escape hatch: a real push cannot be spelled with either.
  case " $args " in
    *" --dry-run "* | *" -n "* | *" --help "* | *" -h "*)
      continue
      ;;
  esac

  positional=0
  # shellcheck disable=SC2086 # word splitting is the tokenisation; globbing is off
  for token in $args; do
    case "$token" in -*) continue ;; esac
    positional=$((positional + 1))

    # Reduce a refspec to what it writes on the remote: drop a leading `+`
    # (force), keep only the right-hand side of a `src:dst` pair, and drop the
    # fully-qualified prefix. `+main`, `HEAD:main`, `refs/heads/main`,
    # `+HEAD:refs/heads/main` and `:main` all land on `main`.
    destination="${token#+}"
    destination="${destination##*:}"
    destination="${destination#refs/heads/}"
    if [ "$destination" = "main" ]; then
      block_push="an explicit refspec targeting main"
    fi
  done

  # No refspec means the push goes wherever the CURRENT branch is configured to
  # go, which the command string cannot tell you. Ask the checkout. One
  # positional counts as none here, because it is the remote (`git push origin`)
  # and still leaves the branch implicit.
  #
  # This reads HEAD in CLAUDE_PROJECT_DIR, which is where an agent's bare push
  # runs in practice but is not guaranteed to be the cwd of the command — a
  # `cd elsewhere && git push` is one more instance of the indirection limit
  # above. On any failure to read HEAD it stays silent, per "under-block on
  # purpose".
  if [ -z "$block_push" ] && [ "$positional" -le 1 ]; then
    if branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" && [ "$branch" = "main" ]; then
      block_push="a bare push from a checkout whose HEAD is main"
    fi
  fi
done <<<"$segments"

if [ "$block_merge" -eq 1 ]; then
  cat >&2 <<'MESSAGE'
Merging a pull request is the owner's decision, not an agent's. The gate
workflow deliberately ends at "open the PR", and this repo's ruleset requires
no approving review on main — so nothing but this refusal is between an agent
and the default branch.

What to do instead: report the branch and the pull request number and stop. If
you believe you were given ship authority, say so and ask for the merge — do
not look for another spelling, because another spelling will work.
MESSAGE
  exit 2
fi

if [ -n "$block_push" ]; then
  cat >&2 <<MESSAGE
Refusing $block_push. Code reaches main through a reviewed pull request here,
never through a push.

What to do instead: push your own branch and open a pull request for it.

    git push -u origin <your-branch>
    gh pr create --title "type(scope): subject (<ticket-id>)" --body ...

Check the title first — it is the message that lands, because this repo
squash-merges:  node scripts/commit-message.mjs --text "<title>"
MESSAGE
  exit 2
fi

exit 0
