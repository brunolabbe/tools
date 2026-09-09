#!/usr/bin/env bash
# PreToolUse hook: refuse the commands that put code on `main` without a human —
# `gh pr merge` in any spelling, and the `git push` spellings that name `main`
# explicitly and get past the deny list's globs. A push that names no
# destination at all is out of scope on purpose; see repo-42, below.
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
# The first two are what this hook's push half is for. The third is NOT — it
# was, until repo-42; see its own section below.
#
# And `Bash(gh pr merge *)` needs an argument, so bare `gh pr merge` — which
# opens an interactive picker — is allowed by that glob too. (Whether the real
# matcher reads a trailing `*` as requiring an argument was NOT settled: see
# "unmeasured", below.)
#
# WHAT THE REMOTE ACTUALLY REFUSES, WHICH IS NOT WHAT IT LOOKS LIKE
#
# Ruleset 20870721 on brunolabbe/tools, re-read 2026-09-09 with
# `gh ruleset view 20870721` — enforcement active, bypass never, condition
# `ref_name: [exclude: []] [include: [~DEFAULT_BRANCH]]`:
#
#     deletion, non_fast_forward,
#     pull_request: [allowed_merge_methods: [merge squash rebase]]
#                   [dismiss_stale_reviews_on_push: false]
#                   [require_code_owner_review: false]
#                   [require_extra_approval_for_unattributed_changes: true]
#                   [require_last_push_approval: false]
#                   [required_approving_review_count: 0]
#                   [required_review_thread_resolution: false]
#                   [required_reviewers: []]
#
# So the push rows above are double-covered — the server refuses them too, and
# this hook closes the explicit ones for legibility rather than because they are
# live. The merge row is the opposite: **`required_approving_review_count: 0`**,
# and `require_last_push_approval: false`. The server requires a pull request
# and then requires NO HUMAN ON IT. `gh pr merge` is held by the deny rule and
# by this file, and by nothing else anywhere.
#
# One qualifier on that, added at the 2026-09-09 re-read and stated as
# unmeasured: `require_extra_approval_for_unattributed_changes: true` is a
# parameter the 2026-09-07 reading did not carry. It asks for an approval on
# changes GitHub cannot attribute to an account. Whether it ever fires on this
# repo's commits — authored under the owner's own address, with an agent
# `Co-Authored-By` trailer — was NOT tested, and testing it would mean merging
# something to find out. Read the "requires NO HUMAN ON IT" sentence as holding
# for attributed changes, which is every commit anyone here has made, and do not
# read this parameter as a second human in the loop until somebody has watched
# it stop a merge.
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
#   - IT HAS NOW BEEN OBSERVED TO FIRE, AND IT WAS WRONG EVERY TIME IT DID.
#     Until it reached `main` it never fired at all, and that was true
#     throughout its own build and gate: a session resolves its PreToolUse hook
#     set once, from the settings in force when it started — in practice the
#     shared root checkout's `.claude/settings.json`, which is on `main` — so a
#     hook registered only on an unmerged branch is not loaded, including by the
#     session writing it. That was measured three ways before this landed: the
#     two commands the test suite pins as must-block (`git push origin +main`,
#     `git push origin refs/heads/main`) ran unblocked against a scratch local
#     remote; a heredoc shape this file exits 2 on when driven directly
#     completed normally as a real Bash call; and the build session's own
#     transcript records `hook_success` for `check-tree-grep.sh` and **zero**
#     records of any kind for this file. That section then said the hook was
#     EXPECTED to register once this was on `main`, called that an inference
#     rather than a verification, and asked not to be written up as verified
#     "until somebody watches it refuse something".
#
#     Somebody did, and the evidence for it is worth separating from the
#     evidence for everything else in this header, because the two are not the
#     same kind and an earlier draft of this paragraph ran them together.
#
#     Driving this script by hand — crafted JSON on stdin, which is how repo-42
#     was filed and how its tests work — CANNOT establish that the harness loads
#     it. A script piped a payload runs and exits whether or not it is
#     registered anywhere. repo-42's filing recorded a direct drive, and its
#     narrative and its own detail do not quite agree about the live command:
#     it says the hook refused "a legitimate `git push origin`", and then says
#     the agent that hit it issued `git push origin <branch>` — two positionals,
#     which this hook demonstrably does NOT refuse. So the filing does not, on
#     its own, carry the observation it claims.
#
#     What carries it is an automatic interception, seen twice on 2026-09-09
#     during repo-42's build and gate, in two different sessions. In the build
#     session: a bare `git push` from a worktree whose HEAD was
#     `fix/repo-42-drop-bare-push-branch`, already in sync with its own
#     same-named upstream — a command that could not reach `main` under
#     `push.default = simple` and was a no-op besides — came back as
#     `PreToolUse:Bash hook error: [$CLAUDE_PROJECT_DIR/.claude/hooks/`
#     `check-main-writes.sh]: Refusing a bare push from a checkout whose HEAD is
#     main.` Nobody invoked this file; the harness did. The gate reviewer
#     reported the same prefix twice on its own scratch pushes, independently.
#
#     So: registration and automatic invocation are now VERIFIED, by that
#     interception and not by the direct drive. The refusal itself was a false
#     positive — HEAD was not `main` in either session's actual checkout, only
#     in `CLAUDE_PROJECT_DIR`, which under worktree isolation is the shared root
#     — and it is the exact bug the section below deletes. Every remaining claim
#     in this header about WHICH strings are refused is still only pinned by the
#     tests: those are claims about what the script does when driven directly.
#     See docs/work/repo-42-the-hook-has-fired-and-overblocks-a-worktree-push.md,
#     whose Log carries this correction as well as the original filing.
#
#   - IT OVER-BLOCKS IN ONE PLACE THAT IS KNOWN, AND HAS HAD ONE MORE THAT WAS
#     LATENT UNTIL IT FIRED. Read the count as "one that anybody has found so
#     far", not as a proof that there is only one; the previous wording said
#     "EXACTLY ONE PLACE, AND IT IS KNOWN RATHER THAN LATENT" and repo-42 is the
#     counterexample it did not survive.
#
#     The known one: the quote strip and the boundary rule work per line, so an
#     UNQUOTED mention at the start of a heredoc body line reads as an
#     invocation and is refused — measured: a heredoc whose body line is `gh pr
#     merge 129 --squash`, or `git push origin +main`, or the same indented as a
#     fenced code block, all exit 2. check-pr-title.sh has had the identical
#     shape since it shipped. It costs nothing in practice because markdown here
#     is written with the Write/Edit tools rather than piped through a heredoc,
#     and a quoted mention is silent either way — but write a document
#     containing these commands through `cat <<EOF` and this hook will stop you.
#     That is the trade, stated so it is met in a comment rather than in a
#     refusal.
#
#     The latent one, now closed rather than documented: the bare-push branch,
#     which fired on the ordinary path for every worktree-isolated dispatch in
#     this repo. It was deleted rather than repaired — the next section is why.
#
# THE ONE PUSH SHAPE THIS DELIBERATELY DOES NOT JUDGE
#
# A `git push` that names no destination — bare, or `git push origin` with the
# branch still implicit — is not this hook's business. repo-42 decision (c),
# answered by the repo owner 2026-09-09, over this ticket's own recommendation
# that the branch be repaired instead by reading the payload's `cwd`.
#
# The branch that used to be here asked a checkout for `git symbolic-ref HEAD`
# and refused when the answer was `main`. It read the WRONG checkout: the script
# began by `cd`-ing to `CLAUDE_PROJECT_DIR`, which the harness deliberately
# leaves on the shared root when Claude enters a worktree. Every builder and
# reviewer in this repo is dispatched with `isolation: "worktree"`, so the
# refusal fired on the normal path, not on an exotic one.
#
# Deleting it costs no coverage, and that is a conclusion about the wire, not
# about the client. A refspec is client-side syntax; what reaches GitHub is a
# ref update naming `refs/heads/main`, and ruleset 20870721 above matches on
# `ref_name ~DEFAULT_BRANCH` with a `pull_request` rule, enforcement active,
# bypass never. A direct push landing on `main` is refused there whether the
# client spelled it `main`, `+main`, `refs/heads/main` or nothing at all. The
# bare form was in fact the WEAKEST row this hook ever held: a bare push only
# reaches `main` when HEAD is `main` AND `push.default` sends it there, while a
# `push.default = upstream` (or a configured `remote.origin.push`) can send a
# bare push from a FEATURE branch straight to `main` — which the deleted branch
# read as safe and waved through. It was refusing the wrong cases in both
# directions.
#
# Not measured, and it is the load-bearing gap in the paragraph above: nobody
# has watched the server refuse a push to `main`, because settling that would
# mean attempting one. It is read off the ruleset's own semantics. If that
# reading is ever falsified, the row to restore is this one, and it should be
# restored by reading `.cwd` from the hook payload — option (a) — not by
# reading `CLAUDE_PROJECT_DIR` again.
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

# No `cd` and no directory read of any kind: the verdict is a function of the
# command string alone. That is repo-42's decision (c) expressed in code — the
# one thing this file used a checkout for was the deleted bare-push branch, and
# a `cd` left behind after it is an invitation to re-add one.
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

  # shellcheck disable=SC2086 # word splitting is the tokenisation; globbing is off
  for token in $args; do
    case "$token" in -*) continue ;; esac

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

  # A push with no refspec is deliberately NOT judged here — repo-42's decision
  # (c). See "THE ONE PUSH SHAPE THIS DELIBERATELY DOES NOT JUDGE" above for why
  # dropping it costs no coverage, and why the branch that used to be here was a
  # false positive on every worktree-isolated dispatch in this repo.
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
