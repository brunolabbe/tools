---
id: repo-42
tool: repo
title: check-main-writes.sh has now fired, and over-blocks a bare push from a worktree
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-42 — check-main-writes.sh has now fired, and over-blocks a bare push from a worktree

## Why

`.claude/hooks/check-main-writes.sh` carries a header with two claims this
ticket updates with new evidence, and reports a second over-block its header
does not yet know about. Both were reproduced against `origin/main@a5e31c7`
before filing, from a builder's ordinary worktree — never against a real push.

### Half one: the header's own request, answered

The header states, in capitals, that the hook has **never** been observed to
fire, explains the mechanism (a session resolves its `PreToolUse` hook set once
at start, from `.claude/settings.json` in the checkout it started in — in
practice the shared root, which sits on `main`; a hook registered only on an
unmerged branch is not loaded, including by the session that wrote it), and
says plainly:

> it is EXPECTED to register once this is on `main` — inferred from that
> sibling evidence, NOT verified, and it should not be written up as verified
> until somebody watches it refuse something
> (`.claude/hooks/check-main-writes.sh:83-85`)

Somebody has now watched it refuse something. Preconditions verified
independently rather than taken on the dispatching prompt's word:

```
$ grep -n -A3 -B3 'check-main-writes' .claude/settings.json
71-          },
72-          {
73-            "type": "command",
74:            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-main-writes.sh"
75-          }
76-        ]
77-      }
```

registered under `PreToolUse`, matcher `Bash`
(`.claude/settings.json:60,62,74`), and:

```
$ git log -1 -- .claude/hooks/check-main-writes.sh
commit 43670a204ee23779fbf7f1e7bb4c82492c08292a
    chore(repo): refuse merges and main pushes with a PreToolUse hook (repo-15, repo-26) (#182)
$ git merge-base --is-ancestor 43670a2 origin/main && echo "yes, ancestor of origin/main"
yes, ancestor of origin/main
```

on `main`, as the header requires for the hook to load at all. What it refused
is half two, below — a legitimate `git push origin` for a feature-branch
worktree, with `CLAUDE_PROJECT_DIR` pointing at the shared root checkout on
`main`.

### Half two: a second over-block, undocumented

The header's "IT OVER-BLOCKS IN EXACTLY ONE PLACE, AND IT IS KNOWN RATHER THAN
LATENT" section (`.claude/hooks/check-main-writes.sh:89-99`) names only the
heredoc-body-line case. This is a second one, and it sits on the normal path
rather than an edge case: **every builder in this repo works in a worktree**
(`CLAUDE.md`, and the builder/ticket-reviewer agents both declare
`isolation: "worktree"`).

The mechanism: the script begins `cd "${CLAUDE_PROJECT_DIR:-.}"`
(`.claude/hooks/check-main-writes.sh:120`), and its bare-push branch then asks
_that_ checkout for the current branch:

```
  if [ -z "$block_push" ] && [ "$positional" -le 1 ]; then
    if branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" && [ "$branch" = "main" ]; then
      block_push="a bare push from a checkout whose HEAD is main"
    fi
  fi
```

(`.claude/hooks/check-main-writes.sh:197-201`). `CLAUDE_PROJECT_DIR` is the
**shared root checkout**, which sits on `main`. So a bare `git push` issued
from a _worktree_ whose own `HEAD` is a feature branch reads `main` anyway and
is refused. The header's own comment at that branch half-anticipates this and
gets it wrong:

> This reads HEAD in CLAUDE_PROJECT_DIR, which is where an agent's bare push
> runs in practice but is not guaranteed to be the cwd of the command
> (`.claude/hooks/check-main-writes.sh:192-193`)

The premise — that `CLAUDE_PROJECT_DIR` is where an agent's push runs "in
practice" — is false for the harness's own worktree isolation, which is not an
exotic indirection like `cd elsewhere && git push`; it is how every builder and
reviewer in this repo is dispatched.

**Reproduced by driving the script directly**, per the hook's own header
("must not be settled by attempting a real merge" — the same restraint applies
to a real push). Crafted `tool_input.command` JSON on stdin, run from this
worktree (`HEAD` = `docs/repo-42-the-hook-has-fired-and-overblocks-a-worktree-push`,
confirmed with `git symbolic-ref --quiet --short HEAD` immediately before each
run):

```
$ export CLAUDE_PROJECT_DIR=/workspaces/tools   # the shared root, HEAD=main
$ printf '%s' '{"tool_input":{"command":"git push origin"}}' \
    | .claude/hooks/check-main-writes.sh
Refusing a bare push from a checkout whose HEAD is main. Code reaches main through a reviewed pull request here,
never through a push.
...
$ echo $?
2
```

```
$ export CLAUDE_PROJECT_DIR=/workspaces/tools/.claude/worktrees/agent-aa7acd691fd2af11d   # this worktree, HEAD=feature branch
$ printf '%s' '{"tool_input":{"command":"git push origin"}}' \
    | .claude/hooks/check-main-writes.sh
$ echo $?
0
```

Same command, only `CLAUDE_PROJECT_DIR` changed, opposite verdict. `$?` read
directly from the command, never through a pipe (`cmd | tail; echo $?` reports
`tail`'s status, not the hook's — a documented trap in this session's own
history).

**No guardrail was circumvented in producing this.** The agent that actually
hit this used `git push origin <branch>` — an explicit two-positional-argument
form, which is _the exact command the hook's own refusal message instructs_
(`.claude/hooks/check-main-writes.sh:223-225`, "push your own branch and open a
pull request for it: `git push -u origin <your-branch>`"). Two positional
arguments set `positional=2`, so `[ "$positional" -le 1 ]`
(`.claude/hooks/check-main-writes.sh:197`) is false and the bare-push branch is
never reached — confirmed directly:

```
$ export CLAUDE_PROJECT_DIR=/workspaces/tools   # shared root, HEAD=main
$ printf '%s' '{"tool_input":{"command":"git push origin docs/repo-42-the-hook-has-fired-and-overblocks-a-worktree-push"}}' \
    | .claude/hooks/check-main-writes.sh
$ echo $?
0
```

That is the hook working as designed for an explicit refspec, not an escape.
`CLAUDE.md` says that on hitting a guardrail an agent stops rather than finds
another spelling — nothing here did either; the refusal only fires for the
_bare_ form, which nobody in this reproduction issued on purpose.

### The test suite already has the shape of this gap and does not cover it

`scripts/test/hooks.test.ts` pins both halves of the bare-push branch read —
`"check-main-writes reads HEAD for a push with no refspec, rather than
guessing"` and `"check-main-writes leaves a bare push alone when HEAD is not
main"` (`scripts/test/hooks.test.ts:339-359`) — but its `run()` helper always
points `CLAUDE_PROJECT_DIR` at the same scratch checkout the command is
notionally issued from (`scripts/test/hooks.test.ts:37-51`), and the crafted
JSON payload it sends never carries a `cwd` field at all
(`scripts/test/hooks.test.ts:43-49`). Neither existing test can catch the
worktree case, because neither ever separates "the directory
`CLAUDE_PROJECT_DIR` names" from "the directory the push actually happens in."

## Build

**This ticket does not fix the hook.** The fix is a real decision (below) and
this dispatch is the reproduction and the record. Whoever picks this ticket up
next:

1. **Settle the decision below first**, via `AskUserQuestion` if you can ask, or
   as an open decision in your report if you cannot — never by assumption.
2. Update the header's two stale claims in the same change: the "NEVER BEEN
   OBSERVED TO FIRE" section (`.claude/hooks/check-main-writes.sh:70-87`) no
   longer holds and should record this ticket's observation instead of the
   inference it replaces; the "OVER-BLOCKS IN EXACTLY ONE PLACE" heading
   (`.claude/hooks/check-main-writes.sh:89`) is no longer accurate regardless of
   which option below is chosen for the mechanism itself, unless option (a) is
   taken and closes this instance rather than documenting it.
3. Extend `scripts/test/hooks.test.ts` with a case that separates
   `CLAUDE_PROJECT_DIR` from the checkout the push actually runs in — the gap
   named above — so this shape stays pinned. `run()`'s signature
   (`scripts/test/hooks.test.ts:43`) will need a second directory parameter, or
   a `cwd` field in the payload it sends, depending on which option is chosen.
4. Whichever option is chosen, keep the "err on the false negative" posture the
   header already states elsewhere (`.claude/hooks/check-main-writes.sh:66-68`,
   "a miss is the side to err on") in view when weighing it against a new false
   positive.

## Decision — open, not to be settled here

Three options were named; none was picked. Recommendation first, with the
grounds that changed since the header was written.

**(a) Read `HEAD` from where the command actually runs, not from
`CLAUDE_PROJECT_DIR`.** Recommended. This is not the general "indirection
defeats it" case the header already accepts (`cd elsewhere && git push`,
`.claude/hooks/check-main-writes.sh:192-196`) — Claude Code's own hook payload
already carries the answer. Fetched from the current hooks reference
(`https://code.claude.com/docs/en/hooks`) this session:

> `cwd` — Current working directory when the hook is invoked
>
> Worktrees are different. If Claude enters a worktree during the session,
> Claude Code keeps `${CLAUDE_PROJECT_DIR}` where it was and passes the
> worktree path to your hooks a different way: `${CLAUDE_PROJECT_DIR}` stays
> put ... `cwd` follows Claude: the `cwd` field in the hook's input JSON is the
> worktree root after Claude enters a worktree ... Read it when a hook needs to
> know which directory Claude is working in.

That is this exact scenario, documented as the reason the field exists. The
fix is small — read `.cwd` from the same `jq` call already reading
`.tool_input.command` (`.claude/hooks/check-main-writes.sh:122`), and
`git -C "$cwd" symbolic-ref` instead of relying on the script's own `cd`. It
does not touch the merge half, the quote-stripping, or the refspec-destination
scan — only the bare-push branch read. Cost: `run()`'s test helper needs a
`cwd` parameter distinct from `projectDir` to exercise it (see Build, step 3).
Not yet confirmed: whether the _test_ harness (`spawnSync` in
`scripts/test/hooks.test.ts`) can be made to send a `cwd` field the way the
real Claude Code harness does, or whether the test has to fake it structurally
instead — that is implementation work, not part of this ticket's reproduction.

**(b) Leave the read as `CLAUDE_PROJECT_DIR` and document the worktree case as
a second known over-block**, beside the heredoc one. Cheapest, and consistent
with the header's stated posture that a false positive here is the side to
err on (`.claude/hooks/check-main-writes.sh:66-68`) — except this one is not
rare like the heredoc case (`.claude/hooks/check-main-writes.sh:95-96`, "costs
nothing in practice"); it fires on the ordinary path for every worktree-isolated
builder that ever issues a genuinely bare `git push`, which trains exactly the
routing-around-it behavior the header warns against
(`.claude/hooks/check-main-writes.sh:67-68`). Not recommended for that reason,
but named because it costs nothing to implement and nothing was broken by
choosing it — the explicit-refspec form the hook's own message recommends is
unaffected either way.

**(c) Drop the bare-push branch of this hook entirely.** The header already
notes the push rows are double-covered by ruleset 20870721 on the remote
(`.claude/hooks/check-main-writes.sh:26-40`) — the server refuses a
non-fast-forward or a deletion against the default branch regardless of this
hook. Only the merge half (`gh pr merge`) is uniquely held by this file and by
the deny list; the header says of the push rows that this hook "closes them
for legibility rather than because they are live"
(`.claude/hooks/check-main-writes.sh:35-36`). Worth naming because it sidesteps
the whole class of false positive rather than fixing one instance of it, but it
was not measured here whether the ruleset's coverage extends to a bare push
with no refspec at all (the header's coverage table is for explicit
`main`-targeting refspecs) — that would need re-reading before this option is
safe to take, the same way repo-15 re-read the ruleset rather than assuming it.

## Done when

- The decision above is answered and recorded in this ticket, not resolved in
  passing inside a commit.
- A test in `scripts/test/hooks.test.ts` reproduces the worktree false positive
  against the unfixed hook (red), then passes against whichever option was
  chosen (green) — or, for option (c), asserts the bare-push branch no longer
  exists.
- The header's two stale claims (`:70-87` and the `:89` heading) read true
  against the code as it ships, not against the state this ticket found it in.
- `npm run check` is green, and so is
  `npx vitest run scripts/test/hooks.test.ts` directly (confirm which
  `--project` name covers it before relying on `npm test -- --project <name>`
  instead).

## Log

- 2026-09-08: Filed from a builder dispatch that was told explicitly not to fix
  the hook. Reproduced both halves by driving
  `.claude/hooks/check-main-writes.sh` directly with crafted
  `tool_input.command` JSON on stdin, never by attempting a real push to
  `main` — the same restraint the hook's own header already states for the
  merge question. Confirmed independently, not taken from the dispatching
  prompt: the hook's `PreToolUse`/`Bash` registration in `.claude/settings.json`,
  that its introducing commit `43670a2` is an ancestor of `origin/main`, and
  that `next-id.mjs`'s `repo-42` answer is not shadowed by any pushed branch
  without a ticket file (`git ls-remote --heads origin` named no `repo-42` or
  earlier unclaimed branch). The `cwd`-vs-`CLAUDE_PROJECT_DIR` distinction cited
  under option (a) came from fetching Claude Code's own current hooks
  documentation this session, not from memory.
