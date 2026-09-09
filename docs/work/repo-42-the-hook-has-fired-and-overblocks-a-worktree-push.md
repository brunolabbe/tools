---
id: repo-42
tool: repo
title: check-main-writes.sh has now fired, and over-blocks a bare push from a worktree
kind: fix
status: done
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

**The filing dispatch did not fix the hook** — the fix was a real decision
(below) and that dispatch was the reproduction and the record. A second
dispatch, 2026-09-09, carried the steps out once the owner had answered. They
are kept as written rather than rewritten in the past tense; the Log says what
each one turned into.

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

## Decision — answered 2026-09-09 by the repo owner

**Settled. Recorded here in full, because a decision that only exists in a
commit message is one the next reader has to reconstruct.**

**The question put to the owner:** how should `check-main-writes.sh` handle a
bare push from a worktree, given that it currently refuses one because it reads
`HEAD` from `CLAUDE_PROJECT_DIR` — the shared root, which is on `main`?

**The options offered** were this ticket's own three, read out of this file
rather than summarised: (a) read `HEAD` from the payload's `cwd`; (b) leave the
read where it is and document a second known over-block; (c) drop the bare-push
branch entirely. "Defer" was offered as a fourth.

**The answer: (c) — drop the bare-push branch of this hook entirely.**

**This overrode this ticket's own recommendation**, which was (a), marked
"Recommended" in the option list below. The list is kept as filed, with the
recommendation label intact, so the override is visible rather than tidied away.

**The condition (c) rested on, now discharged.** Option (c) was named with the
caveat that "it was not measured here whether the ruleset's coverage extends to
a bare push with no refspec at all". It was re-read before the build, not
assumed — `gh ruleset view 20870721` on 2026-09-09 (that command is not denied;
`gh api` is), enforcement active, bypass never,
`ref_name: [exclude: []] [include: [~DEFAULT_BRANCH]]`, rules `deletion`,
`non_fast_forward`, and `pull_request` with `required_approving_review_count: 0`
and `require_extra_approval_for_unattributed_changes: true`.

The conclusion drawn from it, stated as a conclusion rather than a measurement:
**dropping the branch leaves no gap.** A refspec is client-side syntax. What
reaches GitHub is a ref update naming `refs/heads/main`, and the ruleset matches
on the ref name that arrives, so a `pull_request` rule under `~DEFAULT_BRANCH`
refuses a direct push landing on `main` whether the client spelled it `main`,
`+main`, `refs/heads/main`, or nothing at all — the "no refspec" distinction
exists only on the client side and never reaches the server's matcher. The
header's coverage table being written for explicit refspecs was a limitation of
how it was worded, not of what the ruleset covers.

Two things fell out of that reading and are recorded because they cut against
keeping the branch, not for it:

- The bare-push branch was the **weakest** row this hook ever held, not the
  strongest. A bare push reaches `main` only when `HEAD` is `main` _and_
  `push.default` sends it there; meanwhile a `push.default = upstream` or a
  configured `remote.origin.push` can send a bare push from a _feature_ branch
  straight to `main`, which the deleted branch read as safe and waved through.
  It was wrong in both directions, and only the false-positive direction had
  ever been noticed.
- **Unmeasured, and it is the load-bearing gap:** nobody has watched the server
  refuse a push to `main`. Settling it would mean attempting one, which this
  ticket's own restraint forbids. The conclusion is read off the ruleset's
  semantics. It is recorded in the hook's header as the thing to falsify if the
  row is ever restored — and if it is restored, by option (a), never by reading
  `CLAUDE_PROJECT_DIR` again.

The three options as filed follow. Recommendation first, with the grounds that
changed since the header was written.

**(a) Read `HEAD` from where the command actually runs, not from
`CLAUDE_PROJECT_DIR`.** Recommended — **not chosen**. This is not the general "indirection
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
a second known over-block**, beside the heredoc one. **Not chosen.** Cheapest, and consistent
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

**(c) Drop the bare-push branch of this hook entirely. Chosen.** The header already
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

## Review

**Gate: PASS** — 2026-09-09 · `origin/main (435ee35)...b4c695a` · self-run defect
hunt (ticket-reviewer) at medium

| Done when                                                                | Proof                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision answered and recorded in the ticket                             | ✓ — this record's own "Decision — answered 2026-09-09 by the repo owner" section states the answer as (c) and says in the same paragraph that it overrode the ticket's own recommendation, with (a) left labelled "Recommended — not chosen" so the override stays visible. Named by section rather than by coordinate: see the builder's note below               |
| Test reproduces the worktree false positive (red) then passes (green)    | `scripts/test/hooks.test.ts:350 "leaves a push with no refspec alone"` and `scripts/test/hooks.test.ts:376 "consults no checkout at all"` — **verified**: reverted the hook to `origin/main`'s copy and reran; `2 failed`, `31 passed`, 33 total, first failure named the split-directory pair; restored the fix, `33 passed (33)` at both `4f8f29b` and `b4c695a` |
| Header's two stale claims read true against the shipped code             | `.claude/hooks/check-main-writes.sh:92 "IT HAS NOW BEEN OBSERVED TO FIRE"` and `.claude/hooks/check-main-writes.sh:144 "IT OVER-BLOCKS IN ONE PLACE THAT IS KNOWN"` — **verified** true, including the round-2 repair below                                                                                                                                        |
| `npm run check` green, `npx vitest run scripts/test/hooks.test.ts` green | **verified** directly at `b4c695a`: exit 0, 33/33                                                                                                                                                                                                                                                                                                                  |

- **resolved** · `.claude/hooks/check-main-writes.sh:92 "IT HAS NOW BEEN OBSERVED TO FIRE"`
  — flagged as low in round 1: "what is now verified is that this file loads"
  outran its cited (direct-drive) evidence. `b4c695a` separates the two evidence
  trails, grounds registration in an actual harness-generated interception
  (`PreToolUse:Bash hook error: [...]`, observed independently by both the
  builder and this reviewer), and additionally surfaces and repairs a genuine
  self-contradiction in the ticket's own filed evidence — the `## Why` section's
  opening claim to have watched the hook refuse something, against its own
  "No guardrail was circumvented" paragraph, which states that the live command
  was the two-positional form and confirms directly that the no-refspec branch
  is never reached for it — that neither of us had named before reproducing it.
  Verified:
  `git diff 4f8f29b...b4c695a -- .claude/hooks/check-main-writes.sh` touches only
  `#` lines; `bash -n`, `npm run check`,
  `npx vitest run scripts/test/hooks.test.ts` all green at `b4c695a`.
- **findings** · self-run defect hunt at medium returned 1 across both rounds; 1
  resolved, 0 dropped.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability ✓ (now
  stronger — the header separates evidence classes explicitly, which is itself a
  maintainability improvement over round 1).

**Builder's note on this record, added when committing it.** The gate asked for
it verbatim, and it is verbatim in every verdict but not in every coordinate.
Three mechanical repairs, none of which changes a finding:

- Its second row carried the red-run counts as a single string containing a
  pipe, inside a table cell. A pipe ends the cell, so the proof would have been
  silently truncated at exactly the number that matters. The counts are spelled
  around it now.
- Several citations used the bare shorthand a chat message can afford — a
  line number with no path in front of it. `scripts/citations.mjs` resolves that
  shorthand against whichever file was last named, which here would have bound
  hook and test coordinates to this ticket. Each is respelled with its full path
  and an anchor, or dropped for prose.
- **Every citation that pointed at this file has been replaced by a named
  section rather than a coordinate, and that is not tidying.** The gate requires
  each anchor to be distinct within the file it resolves against, and an anchor
  quoted into a record's own `## Review` section necessarily occurs twice in
  that record — once where it is cited and once in the citation. Measured before
  committing: the first draft of this section scored `9 verified, 7 unanchored`
  with `4 anchor(s) not distinct`, and all four were self-citations. A record
  cannot cite itself by coordinate under this gate, so it does not.

`node scripts/citations-gate.mjs` was run to exit 0 before this was committed,
which matters more than usual here: repo-42 is not in that file's grandfather
list, so this section is one of the minority the gate actually enforces, and a
first draft of it failed the build.

I also owe the gate a correction of my own. I told it that its citation into the
test file had "moved twice" and needed re-resolving against `b4c695a`. It had
not moved at all: `git diff 4f8f29b b4c695a -- scripts/test/hooks.test.ts` is
empty, because round two touched only the hook and this ticket, and the line it
quoted still reads exactly as quoted. I asserted that without running the command
that would have settled it — which is the failure this whole record exists to
catch, committed by the person writing the record. The gate ran the command and
corrected me.

## Log

- 2026-09-09: Built option (c). `.claude/hooks/check-main-writes.sh` no longer
  reads any checkout: the bare-push branch, the `positional` counter that only
  that branch used, and the opening `cd "${CLAUDE_PROJECT_DIR:-.}"` that only
  that branch needed are all gone, so the verdict is now a function of the
  command string alone. The explicit-refspec scan, the quote strip, the segment
  split and the `gh pr merge` half are untouched. The header is rewritten in
  three places: the "NEVER BEEN OBSERVED TO FIRE" section now records that it
  has fired once and that the firing was a false positive — its registration
  inference was correct, its refusal was not; the "EXACTLY ONE PLACE ... KNOWN
  RATHER THAN LATENT" heading now reads as one found so far, naming this ticket
  as the counterexample the old wording did not survive; and a new section
  states the bare-push non-coverage as a decision, with its reasoning and its
  unmeasured gap.

  Two tests replace the two the fix invalidates (`"reads HEAD for a push with no
refspec"` and `"leaves a bare push alone when HEAD is not main"`). `run()`
  gained a fourth parameter, `cwd`, defaulting to `projectDir`; it is sent as
  the payload's `cwd` field and used as the spawned process's working directory,
  which is what the real harness does. That default is precisely the assumption
  this ticket found baked into every case in the file. The behavioural test
  drives four no-refspec spellings across three directory arrangements, leading
  with the split one — `CLAUDE_PROJECT_DIR` on `main`, cwd on a feature branch —
  because that is the false positive that was measured live. A second test
  asserts on the script's executable half, split at `set -uo pipefail` so the
  header stays free to discuss what it dropped, that it contains neither
  `symbolic-ref` nor `CLAUDE_PROJECT_DIR`: the behavioural test alone would also
  pass for a hook that read the _right_ directory, and the property option (c)
  actually bought is that it reads none.

  Red then green, read as test counts rather than only as a wall clock.
  `npx vitest run scripts/test/hooks.test.ts` against the unfixed hook:
  `2 failed | 31 passed (33)`, with the failure message naming the split pair
  (`CLAUDE_PROJECT_DIR=/tmp/main-writes-RwWWko, cwd=/tmp/main-writes-6LStyI` —
  two distinct temporary checkouts, so it is the worktree case that went red and
  not merely the same-directory case). After the fix: `33 passed (33)`. The
  `--project` that covers this spec is `repo` — read off `vitest.config.ts:33-34`
  (`name: "repo"`, `include: ["scripts/test/**/*.test.ts"]`) rather than
  inferred from the name.

  **What the brief had wrong, or left to be found:**

  - Its line-number citations were all still exact. All twelve were re-resolved
    against `origin/main@435ee35` before anything was edited, per the rule that
    coordinates move — eight into the hook and four into the test — and every one
    landed on the line the ticket said it did. Recorded because "I re-checked and
    they held" is a result, and the alternative reading, that nobody checked, is
    indistinguishable from silence. The coordinates themselves are deliberately
    not repeated here as citations: they resolve against the base and not against
    this tip, so writing them in citation shape would make
    `scripts/citations.mjs` bind them to whatever file was last named and report
    a verified reading of the wrong file. That is not hypothetical — the first
    draft of this entry did exactly that, and the checker resolved all twelve
    against `vitest.config.ts`.
  - The ruleset re-read that (c) was made conditional on turned up a parameter
    the hook's coverage table did not carry:
    `require_extra_approval_for_unattributed_changes: true`. It does not bear on
    the push question at all. It does qualify the _merge_ sentence the header
    leans on — "requires a pull request and then requires NO HUMAN ON IT" —
    which is that section's whole argument for why the merge half is uniquely
    held by this file. The header now carries the full 2026-09-09 listing and
    states the qualifier as unmeasured, because settling whether it ever fires
    on this repo's commits would mean merging something to find out.
  - Option (c) was filed as sidestepping "the whole class of false positive"
    without noticing that the branch was also _under_-blocking. A bare push
    reaches `main` only when `HEAD` is `main` and `push.default` sends it there,
    whereas `push.default = upstream`, or a configured `remote.origin.push`, can
    send a bare push from a feature branch to `main` — which the deleted branch
    read as safe and waved through. The case for (c) is stronger than the ticket
    argued, not weaker.
  - The coordinates in the "Why" section above are now historical. They describe
    the pre-fix file and resolve against `origin/main@435ee35`; the lines they
    name do not exist at this ticket's tip, by design, since the fix deleted
    them. They are left as filed because a reproduction rewritten to point at
    the code that replaced it stops being a reproduction. (`citations-gate.mjs`
    scopes itself to `## Review` sections, so nothing enforces them either way.)

  **A correction to this ticket's own headline claim, found at the gate and
  repaired here.** The gate reviewer flagged, as a low finding, that the
  header's new sentence "what is now verified is that this file loads" did not
  follow from the evidence it cited — a direct drive of a script proves the
  script runs, not that the harness registered it. Reproducing that finding
  turned up something worse in the brief above: `## Why` asserts at its top that
  "somebody has now watched it refuse something" and says what it refused was "a
  legitimate `git push origin`", but the "No guardrail was circumvented"
  paragraph then states that the agent which actually hit this issued
  `git push origin <branch>` — two positionals — and confirms directly that the
  bare-push branch is "never reached" for that form, closing with "the refusal
  only fires for the _bare_ form, which nobody in this reproduction issued on
  purpose". Those cannot both be true. **As filed, this ticket did not carry the
  live observation its own title claims.**

  It does now, first-hand rather than relayed. During this build, a bare
  `git push` from this worktree — HEAD `fix/repo-42-drop-bare-push-branch`,
  already in sync with its own same-named upstream, `push.default` unset so
  `simple`, therefore a no-op that could not reach `main` — was refused
  automatically:

  ```
  PreToolUse:Bash hook error: [$CLAUDE_PROJECT_DIR/.claude/hooks/check-main-writes.sh]:
  Refusing a bare push from a checkout whose HEAD is main.
  ```

  Nothing invoked the hook; the harness did, and the `PreToolUse:Bash hook
error:` prefix is the harness's, not this script's. That settles registration
  and automatic invocation, which the direct drive could not, and it is
  simultaneously a live reproduction of the false positive — HEAD was not `main`
  in the checkout the command ran in, only in `CLAUDE_PROJECT_DIR`. The reviewer
  reported the same prefix twice on its own scratch pushes, independently; that
  is its observation, recorded as its own rather than restated as mine. The
  refusal was not routed around: the branch was already pushed with the explicit
  two-argument form before this happened, so nothing was pending.

  The `## Why` section is still left as filed, for the reason given above, and
  this entry is the correction to it. The header now separates the two evidence
  trails instead of resting the stronger claim on the weaker one.

  **Deliberately not folded in, and it was adjacent:** the harness's own
  worktree-isolation guard refused two commands during this build — a compound
  `git init` into the scratchpad, and a `printf`-into-the-hook reproduction
  whose only mention of git was inside a JSON string literal ("feeds
  check-main-writes.sh text naming git in a plain command"). That is a third
  over-block of exactly this ticket's shape: a guard reading a command string
  and refusing prose. It is not folded in because it is not this repo's code —
  `.claude/hooks/` holds four files and none of them is that guard, so it is the
  harness's built-in and nothing in this tree can change it. Neither refusal was
  routed around: the direct-drive reproduction was taken through the vitest
  suite instead, which sends the identical payloads through `spawnSync`.

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
