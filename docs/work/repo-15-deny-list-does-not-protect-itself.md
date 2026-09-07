---
id: repo-15
tool: repo
title: The deny list cannot express what it is protecting, and it does not protect itself
kind: chore
status: done
milestone: null
depends_on: []
difficulty: hard
---

# repo-15 — The deny list cannot express what it is protecting, and it does not protect itself

## Why

`.claude/settings.json` denies merging a pull request, cutting a release,
`gh api`, printing the auth token, `npm publish`, pushing to `main`, and reading
a real `.env`. The root `CLAUDE.md` is explicit about what that is: **"a
guardrail, not a boundary — a string-prefix match with no understanding of
intent"**, with measured escapes.

Two things follow, and both were reproduced against `origin/main@f5d5a0e`
before this was filed rather than reasoned about.

### 1. Nothing stops an agent editing its own guardrail

`.claude/settings.json` and `.claude/hooks/` are tracked, writable, and named by
no rule anywhere. Measured:

```
$ git ls-files .claude/settings.json .claude/hooks/
.claude/hooks/check-pr-title.sh
.claude/hooks/format-markdown.sh
.claude/settings.json

$ git check-ignore .claude/settings.json .claude/hooks/check-pr-title.sh; echo $?
1                       # not ignored — .gitignore:48-54 allowlists them back in

$ ls -l .claude/settings.json
-rw-r--r-- 1 pwuser pwuser 1840 …    # writable by the agent's own user
```

And nothing guards them:

| Would-be guard              | Result                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a `deny` rule               | **0 of 11** deny rules mention `.claude`, `settings` or `hooks`                                                                                                            |
| an `Edit`/`Write` deny rule | **0** — all 11 rules are `Bash(` (7) or `Read(` (4)                                                                                                                        |
| a `PreToolUse` hook         | the only one is `check-pr-title.sh`, matcher `Bash`, and it returns early on anything that is not `gh pr create`                                                           |
| a `PostToolUse` hook        | `format-markdown.sh` matches `Write\|Edit` but `exit 0`s on any path that is not `*.md` — and `PostToolUse` cannot block a write that already happened                     |
| a repo-wide scan            | `grep -rln '\.claude' .github/ packages/core/test/ scripts/` returns one file, `oxfmt-ignore-patterns.test.ts`, and the hit is a code comment                              |
| prose                       | every `settings.json` mention in the tree (`CLAUDE.md:224`, `docs/03-RELEASING.md:227`, four ticket Logs) describes **what it denies**, never that it is itself off limits |

An agent that can edit the deny list has no deny list. This is the highest-value
item on this ticket and it is currently uncovered by every mechanism the repo
has.

### 2. `gh api` is denied because it is a universal spelling, and repo-13 wants it narrowed

`gh api` is one deny rule doing the work of several. The REST API expresses
`gh pr merge` as `PUT /repos/{owner}/{repo}/pulls/{n}/merge`, branch protection
as `PUT /repos/{owner}/{repo}/branches/main/protection`, and a release as
`POST /repos/{owner}/{repo}/releases` — so `Bash(gh api *)` is silently the
backstop for `Bash(gh pr merge *)`, `Bash(gh release *)` and for branch
protection, which has no `gh` subcommand of its own and therefore no other rule
at all.

[repo-13](./repo-13-codeql-false-positives-recur.md) is blocked on exactly this.
Its Log records the alert numbers and text as **relayed and unverified**,
"because `gh api` is denied by `.claude/settings.json` and there is no other
route to the code-scanning API from here", and its Build step 4 cannot choose a
home for the triage record without reading those alerts. Narrowing `gh api` to
let `GET …/code-scanning/alerts` through **reopens merge-by-API and
branch-protection-by-API in the same edit**, unless something else is holding
those. That is the coupling: repo-13 needs the narrowing, and the narrowing is
only safe once a hook can read the request rather than the command name.

### The measured coverage of the current list

Applied offline to a threat list, grouped by irreversibility. No denied command
was invoked; this is the deny patterns matched against candidate command strings
as a string glob (script kept at
`/tmp/…/scratchpad/repo-15/match.mjs`, reproduced in Build step 1).

**Tier 1 — puts code on `main` without a human**

| Command                                                           | Today                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `gh pr merge 129 --squash`                                        | denied `Bash(gh pr merge *)`                                       |
| `gh pr merge 129 --auto --squash` (merges later, unattended)      | denied `Bash(gh pr merge *)`                                       |
| `gh pr merge` (bare, interactive picker)                          | **unmatched by this glob** — see the honest limits                 |
| `gh api -X PUT repos/o/r/pulls/129/merge`                         | denied `Bash(gh api *)` — the rule repo-13 wants narrowed          |
| `gh api --method PUT repos/o/r/branches/main/protection …`        | denied `Bash(gh api *)` — same rule, no other                      |
| `git push origin main`, `git push --force origin main`            | denied `Bash(git push * main*)`                                    |
| `git push origin HEAD:main`                                       | denied `Bash(git push *:main*)`                                    |
| `git push origin +main`                                           | **allowed** — no `" main"` substring, the `+` refspec sits between |
| `git push origin refs/heads/main`                                 | **allowed** — same reason                                          |
| `git push` (bare, from a checkout tracking `main`)                | **allowed**                                                        |
| editing `.github/workflows/` so a required check passes trivially | **allowed** — 0 `Edit`/`Write` deny rules                          |

**Tier 2 — destroys work.** Every one **allowed**: `git push --force origin
<feature-branch>` (which silently invalidates a gate mid-review — the reviewer's
cited `file:line` no longer resolves), `git push origin --delete <branch>`,
`git reset --hard`, `rm -rf`, `git worktree remove --force` in the shared
checkout.

**Tier 3 — exfiltration and supply chain.** `gh release create` and
`npm publish` are denied. `gh secret set`, a `postinstall` script and a new
dependency are **allowed** (the latter two are file edits, so tier 3 inherits
the same 0 `Edit`/`Write` deny rules as tier 1's workflow row).

### What the server side actually covers — measured, and it is not what was assumed

The framing this ticket was filed from said "the real boundary is server-side
branch protection, which no agent-side control substitutes for". Half true, and
the wrong half is load-bearing. `gh ruleset view 20870721` on
`brunolabbe/tools`:

```
Enforcement: Active          You can bypass: never
Conditions  - ref_name: [include: [~DEFAULT_BRANCH]]
Rules       - deletion
            - non_fast_forward
            - pull_request: [required_approving_review_count: 0]
                            [require_last_push_approval: false]
                            [dismiss_stale_reviews_on_push: false]
```

So:

- **Tier 1's `git push … main` rows are genuinely double-covered.** `deletion`
  and `non_fast_forward` hold on `main` with no bypass, so `+main` and
  `refs/heads/main` above are gaps in the deny list that the server still
  refuses. They are worth closing for legibility, not because they are live.
- **`gh pr merge` is covered by nothing but the deny list.** The ruleset
  requires a pull request and then requires **zero approvals** on it, and does
  not require last-push approval. A merge needs no human. The deny rule is the
  entire control, and it is the one an agent can edit (§1) and the one
  `gh api` currently backstops (§2).
- **The ruleset's condition is `~DEFAULT_BRANCH` only.** Feature branches have
  no `deletion` and no `non_fast_forward` rule, so **every tier-2 remote-side
  threat is unprotected on both sides at once.**

`gh repo view` reports `"visibility":"PUBLIC"`. So `gh repo edit --visibility
public`, offered as tier 3's one-command irreversible disclosure, is a **no-op
on this repo** — the disclosure is the intended state. Dropped from the threat
list as framed; what survives in tier 3 is `gh secret set` and the supply chain
items, both of which a public repo makes _worse_, since a workflow edited on a
branch runs on GitHub's runners.

## Build

The wiring already exists, so a new hook is a file plus a matcher, not new
machinery: `.claude/hooks/check-pr-title.sh` is a registered `PreToolUse` `Bash`
hook and `.claude/hooks/format-markdown.sh` is a registered `PostToolUse`
`Write|Edit` hook, both tracked, both in `settings.json`'s `hooks` block. Copy
their shape: `set -uo pipefail`, `cd "${CLAUDE_PROJECT_DIR:-.}"`, read the input
with `jq`, `exit 2` with a message on stderr to block, `exit 0` to allow.

**Answer the two decisions below before writing anything.** They change what the
file contains, and one of them is what repo-13 is waiting on.

1. **Re-run the reproduction against the tip before you start.** The coverage
   table above is `origin/main@f5d5a0e` plus a ruleset read on the same day; both
   move. The matcher is ~40 lines: read `permissions.deny` from
   `.claude/settings.json`, keep the `Bash(…)` entries, turn each into an
   anchored regex by splitting on `*` and escaping the literals, and test the
   candidate command strings. Re-read the ruleset with `gh ruleset list` and
   `gh ruleset view <id>` — both are read-only and neither is denied.
2. **Write the hook** at `.claude/hooks/`, matcher per the scope decision, and
   register it in `settings.json`'s `PreToolUse` block. ~~It must fire on `Bash`
   for the command threats and on `Write|Edit` for the self-protection ones,
   which is **two matchers, therefore plausibly two hook files** — `PostToolUse`
   is useless for self-protection, since it runs after the write.~~ **Narrowed
   by decision A1: `Bash` only, one hook file.** The `Write|Edit` matcher was
   the self-protection half, and A1 does not take it. The struck sentence is
   left in place because it is what A2 would need, and A2 is the option kept
   open above.
3. **Borrow `check-pr-title.sh`'s invocation test, do not re-derive it.** Its
   comment records that a plain substring test fired on the command name
   appearing inside a heredoc and blocked an innocent command on the hook's
   first live run. Match at the start of the string or after a shell operator:
   `(^|[;&|(]|&&|\|\|)[[:space:]]*`. This ticket's own file will contain every
   dangerous command string as prose, so the false positive is not hypothetical
   — a naive hook blocks reading this ticket back.
4. **Make the message say what to do instead**, as both existing hooks do. A
   hook that says "denied" trains the reader to route around it; one that says
   "the reviewer gates first — ask for ship authority" does not.
5. **Test it.** `packages/core/test/` already holds repo-wide scans
   (`spawn-safety`, `image-closure`, `oxfmt-ignore-patterns`), which is the
   precedent for a test that asserts on files outside any package. Drive the
   hook script with fixture JSON on stdin and assert the exit code per threat
   string, including the heredoc false positive from step 3 and at least one
   command that must stay allowed. **Make it fail first**: a hook nobody has
   seen refuse is a hook nobody has seen.
6. **Record the limits in the hook's header comment**, not only here — see
   below. Both existing hooks carry their reasoning in the file, and it is the
   only place the next editor reliably reads.
7. ~~If the `gh api` decision lands on "narrow it", say so in **repo-13's** Log
   or Build in the same commit, since that is the ticket waiting on it.~~
   **`n/a` — decision B landed on B1, so nothing is narrowed.** And repo-13 is
   now `status: done`, so this step would have meant editing a closed ticket
   even had B2 been chosen. Left in place so a later reader can see the coupling
   that used to exist and how it ended.

### The honest limits, which belong in the file rather than being discovered later

- **A `PreToolUse` hook sees a command string, and indirection defeats it.** An
  agent that writes `/tmp/x.sh` and runs `bash /tmp/x.sh` presents the hook a
  string it cannot read through. So can `$(echo Z2gg… | base64 -d)`, an alias, a
  `git` alias in a config the agent just wrote, or an `npm` script. This is not
  a bug to fix; it is the ceiling of the mechanism, and the same ceiling
  `CLAUDE.md` already names for the deny list (`/bin/echo` defeats a deny on
  `echo`).
- **The self-protection hook has the same hole as the thing it protects.** It is
  a tracked file in `.claude/hooks/`, so an agent that can edit `settings.json`
  can also unregister the hook that stops it — the hook must therefore refuse
  edits to **itself and to `settings.json`**, and even then only against an
  agent using `Edit`/`Write` rather than `sed -i`. Which is the argument for the
  `Bash` matcher covering in-place edits of those paths too. Say plainly that
  this raises cost and makes intent explicit; it does not close the hole.
- **The real remote boundary is the ruleset, and it does not cover the main
  threat.** Measured above: `required_approving_review_count: 0`. No agent-side
  control substitutes for server-side protection, _and here there is no
  server-side protection against a merge to substitute for_. If the answer that
  matters is "require one approval on `main`", that is a repository-settings
  change, not a hook, and it belongs in its own ticket — note it, do not do it
  here.
- **A hook that wrongly blocks is worse than no hook**, because it trains
  everyone to route around it, and routing around it works. That is the whole
  reason step 5 requires an allowed-command case, not just denied ones.

### Unmeasured, and to be stated as unmeasured

- **Whether the real matcher treats `Bash(gh pr merge *)` as covering bare
  `gh pr merge`.** The table's `unmatched` row is this ticket's own anchored-glob
  reading of a documented "string-prefix match"; the actual implementation was
  not read and **must not be probed by attempting the command**. Settle it by
  reading the matcher's documentation or by testing a harmless analogue
  (`Bash(echo foo *)` against `echo foo`) in a throwaway `settings.local.json` —
  never by trying a real merge.
- **Whether this token could merge at all.** The ruleset permits it; whether the
  installation's token carries the permission was not tested and cannot be
  tested without doing the thing.
- **Whether `gh secret set` or `gh repo edit` would succeed here.** Neither was
  run. They are listed as unmatched by the deny list, which is a statement about
  the list and not about the token.

## Decision — answered 2026-09-07, not open

Two questions were posed here. Both are answered, and **both answers went
against this ticket's own recommendation.**

**Question A was:** what does the hook cover — tier 1 only (A1), tier 1 plus
self-protection of `.claude/settings.json` and `.claude/hooks/` (A2), or the full
tier 1–3 list (A3)?

**Question B was:** what happens to the blanket `gh api` deny — the hook sits
alongside it and `gh api` stays fully denied (B1), the hook replaces the deny
with a parser permitting read-only calls (B2), or the deny rule is narrowed
directly (B3)?

**The answer, from the owner, relayed through the orchestrator: A1 + B1.**
Recorded 2026-09-07; **nothing below has been built.**

**This overrode two recommendations, and both said A2.** The ticket's own text
recommends A2, with B2 named as "the only option that unblocks repo-13"; the
orchestrator relaying the question also recommended A2 + B2. The answer is A1 +
B1. **The losing options' grounds are not withdrawn — they are still true**, and
they are kept below in full for that reason.

**The objection A1 must live with, in this ticket's own words: it "leaves the
guardrail editable — which makes every other rule advisory."** Section 1 above
is uncovered by every mechanism this repo has, and A1 does not cover it either.
So after this work lands, an agent that can edit `.claude/settings.json` still
has no deny list, and the hook A1 adds is a tracked file in `.claude/hooks/` that
the same agent can unregister. That is accepted as a standing cost of the cheap
option, not answered by it. **A2 remains the option that closes it** and should
not be re-argued as new; it was declined on cost, not on the reasoning.

### The correction to decision B's costing, which had expired

**This ticket's costing of B1 is stale, and this section supersedes it.** It was
correct when written on 2026-09-01 and is not correct now. The stale text reads
that B1 is recommended "only if repo-13 can proceed on relayed data, which its
Log says it cannot" — i.e. that B1's price is **repo-13 stalling**.

**repo-13 now reads `status: done`.** Verified on this branch by reading the
file, not relayed. It was not unblocked; **it shipped carrying the gap**, and it
says so itself:

- its gate table's acceptance row 3 reads "correctly left **deferred** —
  `gh api` denied, ticket does not claim otherwise, no defect";
- the same gate records "**Could not verify**, both needing `gh api`, which is
  denied", against the SARIF/fingerprint attribution;
- and its filing Log says "the alert numbers, severities and alert text are
  **relayed from screenshots and were not verified**, because `gh api` is denied
  by `.claude/settings.json` and there is no other route to the code-scanning API
  from here."

**So B1's real cost is not that work stalls. It is that security records close
with unverified claims in them, and the next one will too.** That is a worse cost
than the one the table below states, not a milder one: a stalled ticket is
visible, and a closed ticket carrying relayed alert data reads exactly like a
closed ticket that checked. repo-16 is the immediate next instance — its own
measurement section marks two of its four load-bearing facts as relayed, for the
same reason.

**Attribution, so a later reader does not read the original as wrong:** the
table's B1 row was accurate on 2026-09-01, when repo-13 was open and blocked.
This correction was written on 2026-09-07 while recording the answer, and it
supersedes that row rather than contradicting it.

The reasoning that produced both questions stands, and is kept because it is what
makes the answers legible:

**Decision A — scope of the hook.** A2 was recommended here; **A1 was chosen.**

| Option                          | Covers                                                                                                                 | Cost                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A1 — tier 1 only — CHOSEN**   | the merge paths and the `git push` spellings the deny list misses                                                      | cheapest, and leaves the guardrail editable — which makes every other rule advisory                                     |
| A2 — tier 1 + self-protection   | the merge and workflow-edit paths, plus `.claude/settings.json` and `.claude/hooks/` (was recommended, **overridden**) | one `Bash` hook and one `Write\|Edit` hook, ~2 short files and a test. Closes the item nothing else covers              |
| A3 — the full list — not chosen | tiers 1–3, including `git reset --hard`/`rm -rf`/`worktree remove` in the shared checkout                              | the largest false-positive surface, on the commands agents run most. Highest risk of training people to route around it |

A2 was recommended because §1 is uncovered by every existing mechanism while
tier 1's `git push` rows are already double-covered by the ruleset, and because
tier 3's headline item turned out to be a no-op on a public repo. **That
reasoning was not refuted; the answer went to A1 anyway, on cost.** §1 therefore
stays uncovered — see the objection recorded under the Decision heading.

**Decision B — what happens to the `gh api` blanket deny.** ~~This is the one
repo-13 is waiting on.~~ **B1 was chosen. repo-13 has since closed carrying the
gap rather than waiting — see "The correction to decision B's costing" above,
which supersedes the B1 row's stated consequence.**

| Option                                                                                                 | Consequence                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 — hook sits alongside the deny; `gh api` stays fully denied — CHOSEN**                            | safest. ~~**repo-13 stays blocked** on unverifiable alert data (recommended only if repo-13 can proceed on relayed data, which its Log says it cannot)~~ — **superseded 2026-09-07: repo-13 is `done`. The cost is not a stall; it is that security records close with unverified claims in them.** See above                                                                      |
| B2 — hook replaces the deny with a parser permitting read-only calls (was recommended, **overridden**) | ~~repo-13 unblocks~~ — repo-13 already closed without it, so what B2 now buys is _future_ verifiable security records, not an unblock. The hook must then allow `GET`/no-`--method` against a `code-scanning` path and refuse everything else, and it becomes the **sole** control on merge-by-API and branch-protection-by-API. An allow-list of paths, never a deny-list of them |
| B3 — narrow the deny rule itself, no hook — not viable                                                 | not viable: permission rules are prefix matches, so `Bash(gh api *)` cannot express "GET only" — the flag order is free (`gh api -X PUT x` and `gh api x -X PUT` are the same call)                                                                                                                                                                                                |

~~B2 is the only option that unblocks repo-13~~, and it is safe only if A2 or A3
lands in the same change — otherwise the parser it depends on is editable by the
agent it constrains. **B2 without self-protection is the one combination to
refuse.**

**That last sentence is why A1 + B1 is coherent rather than merely cheap.** The
combination the ticket warned against is B2 without self-protection; the answer
takes neither half of it. A1 + B1 leaves the `gh api` deny exactly as it is, so
no parser becomes the sole control on merge-by-API, and nothing depends on a
hook the agent could edit. What it does not do is close §1 — and the two facts
are the same fact seen from either end.

## Done when

1. `.claude/hooks/` contains the hook(s) chosen by decision A, registered in
   `.claude/settings.json` under the matchers they need, and a fresh run of the
   step-1 matcher shows every threat in the chosen scope either denied by a
   permission rule or blocked by the hook.
2. A test under ~~`packages/core/test/`~~ **`scripts/test/hooks.test.ts`** drives
   each hook script with fixture input and asserts its exit code: at least one
   blocked command per threat group in scope, at least one command that must
   remain allowed, and the heredoc case from Build step 3. It failed before the
   hook existed.

   **Amended 2026-09-07, by the owner, on the builder's reading.** The original
   named `packages/core/test/` because on 2026-09-01 its repo-wide scans were the
   only precedent for a test asserting on files outside any package — that was
   correct when written, and is struck rather than deleted so this reads as an
   amendment and not as drift. It is no longer the closest precedent:
   `scripts/test/hooks.test.ts` **did not exist then** (repo-22 added it), and it
   already does exactly what this line asks — drives a hook with fixture JSON on
   stdin and asserts the exit code — in the `repo` vitest project, which exists
   for tooling belonging to no tool. `packages/core/test/` holds repo-wide
   _source scans_, which is a different job. The substance of this line was
   checked as met at the new path by the gate recorded below, which is the
   outside check an amended acceptance line needs.

3. ~~An attempted `Edit` of `.claude/settings.json` is refused by the hook,
   proven by that test rather than by an agent trying it.~~ **`n/a` — decision A
   landed on A1**, which is the condition this line names for itself, and the
   Log says so. There is no `Write|Edit` hook under A1, so there is nothing to
   refuse the edit and nothing to prove.
4. Decision B is recorded on this ticket with its answer and its reason ~~, and
   repo-13's Log or Build says what it now can or cannot do~~. **The repo-13 half
   is `n/a`: B1 changes nothing about what repo-13 could do, and repo-13 is
   `done` — editing a closed ticket to say "still denied" records nothing it does
   not already say.**
5. The hook's header comment states the indirection limit, the self-edit limit
   and the ruleset's `required_approving_review_count: 0`, in the file.
6. `npm run check` passes and `npm run format` has been run if any `.md` changed.
7. `npm run status -- --show repo-15` parses and `npm run status -- --json`
   exits 0.

## Review

### Gate: PASS — 2026-09-07 · reviewed at `f343bc2` · base `origin/main@e9054c5`

Built by **Opus**, gated by **Sonnet**. Long form — the reasoning, the row-by-row
enumeration and the reproductions — is on the pull request thread; this is the
short record, per the gate-record convention.

**Three findings, all low, none changing a `Done when` verdict.**

| #   | Finding                                                                                                        | Where                                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "12 tier-1 threats, 0 uncovered" read as contradicting the next sentence's concession of the workflow-edit gap | this file, `Done when` 1 verdict in the Log entry below | **Reworded, but not as proposed.** The gate suggested "11 of 12 covered, 1 known gap"; that would assert one of the twelve measured command strings is uncovered, and none is. The table's 11 rows are 10 command rows plus one non-command row, so the workflow-edit gap was never among the twelve. Now reads "12 tier-1 **command strings**, 0 uncovered" with the non-command row named. Gate agreed the correction is better than its suggestion                                                                 |
| 2   | The mutation-red counts (`7 failed, 24 passed`; `13 of 31`) do not reconcile against a 33-test file            | this file, `Done when` 2 verdict in the Log entry below | **Corrected in place, visibly.** Gate read it as a transcription slip; it was not — they were real prints at an intermediate **31-test** state, before the two pin tests were added, and they reconcile against that file. Stale rather than mistyped, and stale has no place in an acceptance record. Re-measured at the tip: **`7 failed \| 26 passed (33)`**, matching the gate's independent run. The differing _composition_ is recorded too. Gate withdrew the "transcription slip" reading                     |
| 3   | `check-main-writes.sh` has never fired live, including throughout its own build and gate                       | `.claude/hooks/check-main-writes.sh:70`                 | **Accepted and recorded**, in the header beside the other limits and in the Log. Confirmed here with the control the gate's method lacked: the build session's transcript shows `hook_success` for `check-tree-grep.sh` twice and zero records for this hook, so the mechanism is live and this hook is merely absent from the set. Written at the strength the evidence supports — _not observed to fire pre-merge_, _expected_ to register on merge by inference from the sibling, **not verified**. No code change |

**Acceptance-to-test traceability.** All seven `Done when` lines proven or
verified, each re-run by the gate rather than read: line 1 by the combined
deny-plus-hook check plus `scripts/test/hooks.test.ts:144`; line 2 by an
independent fail-first reproduction; lines 3 and 4 `n/a` as recorded; line 5 by
`scripts/test/hooks.test.ts:457` and by reading the header; lines 6 and 7 by
running `npm run check` and `npm run status` directly. Line 2's **path** was
amended by the owner rather than by the gate — see the amendment on that line.

**What this gate did not do.** It did not verify that the hook fires as a real
`PreToolUse` hook — that is finding 3, and it is unverifiable before merge. It
did not settle either open decision: the test-file path and the `gh api`
path-refusal deferral were escalated to the owner, who answered both (keep
`scripts/test/hooks.test.ts`; leave `gh api` alone). It did not re-derive the
`f5d5a0e` coverage tables, and it ran no denied command.

**Findings** · 3 returned, 3 carried, 0 dropped. **NFR** · security is the
feature under test; performance n/a; reliability ✓ (fails open on missing input
and on a failed HEAD read, by design); maintainability ✓.

## Log

- **2026-09-01** — Filed off `origin/main@f5d5a0e`. Not implemented; filing was
  the whole job, and `.claude/settings.json` and `.claude/hooks/` were
  deliberately not touched.

  **Id.** `repo-15` was confirmed free against both lists `docs/01-TICKETS.md`
  requires: `git ls-tree origin/main docs/work/` tops out at `repo-13`, and
  `grep -rohE '\brepo-[0-9]+\b' --include=*.md` over the tree adds only
  `repo-99`, `repo-404`, `repo-808`, `repo-901`, `repo-999`, all of which are
  `scripts/status.mjs` test fixtures. No remote branch and no pull request —
  open, merged or closed, checked back to #100 — names `repo-14` or `repo-15`.
  `repo-14` is claimed by another session's in-flight worktree and was skipped
  on that basis, not on anything visible in the repo.

  **Three things the framing this was filed from had wrong**, all found by
  measuring:

  - **"The real boundary is server-side branch protection."** Only for pushing.
    `gh ruleset view 20870721` shows `pull_request` with
    `required_approving_review_count: 0` and `require_last_push_approval: false`,
    so a merge to `main` needs no human and the `Bash(gh pr merge *)` deny is the
    only thing in the way. The sentence as given would have let the ticket treat
    the merge threat as double-covered when it is single-covered by the very rule
    §1 shows is editable. The ruleset's `deletion` and `non_fast_forward` rules
    _do_ double-cover the `git push … main` rows, which is the opposite of where
    the reassurance was aimed.
  - **`gh repo edit --visibility public` is a no-op.** `gh repo view --json
visibility` returns `PUBLIC`. Tier 3's "one command, irreversible as a
    disclosure" does not apply to this repo, and it was dropped from the threat
    list rather than carried as an unexamined line.
  - **The ruleset's condition is `~DEFAULT_BRANCH`.** So the tier-2 threats
    (force-push to a feature branch, branch delete) are unprotected on the server
    _and_ unmatched by the deny list — worse than the tier ordering implies,
    since tier 2 was the group presumed to have some remote backstop.

  **Two gaps in the deny list found while matching, which were not on the list
  given:** `git push origin +main` and `git push origin refs/heads/main` both
  slip `Bash(git push * main*)` and `Bash(git push *:main*)`, because neither
  contains the literal `" main"` or `":main"` the patterns need. Both are
  refused by the ruleset today, so they are legibility gaps rather than live
  ones — recorded in the tier 1 table rather than filed separately.

  **Not attempted, on instruction and on principle:** no denied command was run,
  and the `gh api` deny was not probed. §1 is demonstrated by showing that no
  rule, hook, scan or CI job _mentions_ `.claude/settings.json` — not by writing
  to it. `gh ruleset list`/`view` and `gh repo view` are read-only, are denied by
  nothing, and are the only network calls this filing made.

  **Deliberately not folded in**, though the context was here: requiring one
  approving review on `main` would close the merge threat at the boundary rather
  than at the guardrail, and it is arguably the single highest-value change this
  investigation found. It is a repository-settings change made through the GitHub
  UI, not a diff, so it is neither reviewable on a branch nor within an agent's
  authority — it is named in Build's honest-limits section as its own ticket for
  a human to file, and left there on purpose.

- **2026-09-05** — `status: ready` → `needs-decision`, by
  [repo-19](./repo-19-ready-does-not-mean-startable.md) in the commit that taught
  the parser the value. Nothing about this ticket changed: it carries decisions A
  and B under a heading that says it does not settle them, and B is the one
  repo-13 is waiting on. It was on the `--ready` board and could not be started.
  Move it back to `ready` in the commit that writes both answers onto this page.

- **2026-09-07 — both decisions were answered by the owner: A1 + B1.** Tier 1
  only, no self-protection hook; the hook sits alongside the deny list and
  `gh api` stays fully denied. `status: needs-decision` → `ready`. The decision
  section is now `## Decision — answered 2026-09-07, not open`, the option tables
  are marked in place, and Build steps 2 and 7 and `Done when` lines 3 and 4 are
  marked where the answer narrows them.

  **This overrode two recommendations, both of which said A2** — this ticket's
  own, and the orchestrator's (A2 + B2). Neither was refuted; A1 was chosen on
  cost. The losing options' grounds are left standing in the tables rather than
  rewritten, because they are still true.

  **`Done when` line 3 is `n/a`, and this is the Log entry that line asks for.**
  It reads "(If decision A lands on A1, this line is `n/a` and the Log says so.)"
  — decision A landed on A1. There is no `Write|Edit` hook to refuse an `Edit` of
  `.claude/settings.json`, so there is nothing to prove and the line is retired
  rather than failed.

  **The objection A1 must live with**, in this ticket's own words: it leaves the
  guardrail editable, which makes every other rule advisory. §1 stays uncovered
  by every mechanism this repo has, including the hook this ticket will now
  build. Accepted as a standing cost. A2 is not re-argued as new if someone wants
  it later; it is the same option, declined on cost.

  **A correction to this ticket's own costing of B, made here and attributed
  here.** The B1 row said B1 was acceptable "only if repo-13 can proceed on
  relayed data, which its Log says it cannot". That was true on 2026-09-01 and is
  not true now: **repo-13 reads `status: done`** — read from the file on this
  branch, not relayed. It was never unblocked; it closed carrying the gap, with
  an acceptance row reading "correctly left **deferred** — `gh api` denied", a
  "**Could not verify**, both needing `gh api`" note, and alert numbers and
  severities described as "relayed from screenshots and were not verified".

  So the real cost of B1 is **not** that work stalls — it is that security
  records close with unverified claims in them, and the next one will too;
  repo-16 is already the next instance. The stale row is struck rather than
  deleted, and dated, so a later reader knows the original text was superseded
  rather than wrong when written.

  **Recorded, not built.** `.claude/settings.json` and `.claude/hooks/` were not
  touched, no hook was written, and the step-1 matcher was not re-run — the
  coverage tables above are still the `origin/main@f5d5a0e` measurement and Build
  step 1 still says to re-take them. This branch is bookkeeping across four
  tickets whose decisions were answered in one sitting.

- **2026-09-07 — built, A1 + B1, off `origin/main@e9054c5`.**
  `.claude/hooks/check-main-writes.sh` (new, registered in
  `.claude/settings.json` under the existing `PreToolUse` `Bash` matcher
  alongside `check-pr-title.sh` and `check-tree-grep.sh`), and its cases in
  `scripts/test/hooks.test.ts`. `status: ready` → `done`.

  **Build step 1 was re-taken and the coverage table survived the move from
  `f5d5a0e` to `e9054c5` unchanged.** The matcher reports 11 deny rules, 7 of
  them `Bash(…)`, **0** mentioning `.claude`/`settings`/`hooks` and **0**
  `Edit(`/`Write(` rules — so §1 is uncovered at the tip exactly as it was at
  filing. Every verdict in the tier 1–3 tables reproduced, including the two
  gaps found while filing: `git push origin +main` and
  `git push origin refs/heads/main` are still `ALLOWED` by the globs, and bare
  `git push` and bare `gh pr merge` still are too.

  **The ruleset was re-read** (`gh ruleset list` → `20870721`;
  `gh ruleset view 20870721`) and is unchanged in every load-bearing field:
  active, bypass never, `ref_name: [include: [~DEFAULT_BRANCH]]`, `deletion`,
  `non_fast_forward`, and `pull_request` with
  `required_approving_review_count: 0`, `require_last_push_approval: false`,
  `dismiss_stale_reviews_on_push: false`. `gh repo view` still reports
  `PUBLIC`. **One field is visible now that the 2026-09-01 transcript does not
  show: `require_extra_approval_for_unattributed_changes: true`.** It is not
  recorded here as new — it may simply be newly printed by `gh` — and it does
  not move the finding: it governs commits GitHub cannot attribute to a user,
  not a normally-attributed pull request, which still needs nobody.

  **Verdicts, per `Done when` line.**

  1. **Met.** A combined check ran each tier-1 threat through both the deny
     matcher and the real hook (stdin JSON, exit code), against a fixture
     checkout whose HEAD is `main` so the bare-push rows have a determinate
     answer: **12 tier-1 command strings, 0 uncovered.** The four the deny list
     misses (`gh pr merge` bare, `+main`, `refs/heads/main`, bare `git push`)
     are covered by the hook alone; the two `gh api` rows by the permission rule
     alone, per B1.

     **"0 uncovered" is a statement about commands, and the tier-1 table's last
     row is not one.** The table has 11 rows: 10 command rows — one of which
     carries two strings, `git push origin main` and `git push --force origin
main` — plus "editing `.github/workflows/` so a required check passes
     trivially", which is a `Write`/`Edit` act and not a command at all. That
     makes 11 command strings in the table; the check ran 12, the extra being
     `git push --force-with-lease origin main`, added here. **The workflow-edit
     row is deliberately not covered and is not claimed to be**: the decision
     table puts workflow-edit coverage under A2, and A1 is a `Bash` matcher, so
     it structurally cannot see it. Worded this way after the gate read the two
     sentences as contradicting each other — they are about different sets, but
     the original wording did not say so.

  2. **Met, and it failed first — twice, and the second red is the one that
     counts.** With the hook file absent and the `settings.json` entry reverted,
     the suite failed; but the allowed-command cases failed there for the wrong
     reason (bash exits 127 on a missing file, so "silent" is false). So the
     hook was replaced with a two-line script that does nothing but `exit 0` —
     the shape of a dead guard — and **every refusing assertion went red while
     every allowed-command assertion stayed green**. That asymmetry is repo-26's
     lesson applied to this hook, and it is the evidence that the tests detect a
     hook which stops refusing rather than only one which stops existing.

     **The authoritative numbers, re-measured at `f343bc2` after the gate, with
     only the hook mutated and `settings.json` intact:
     `7 failed | 26 passed (33)`, restored to `33 passed`.** The gate measured
     the same independently.

     **A correction, made visibly rather than by overwriting, because the wrong
     number reached a report.** This entry first said `7 failed, 24 passed` and
     `13 of 31 failed`. Those were real prints, but at an **intermediate
     31-test** state of the file — the two pin tests (heredoc over-block,
     quoted-refspec miss) were added afterwards. They reconcile against that
     file (24+7 and 18+13 are both 31) and not against the 33 that shipped, so
     the entry read as an arithmetic slip. It was not, but it was stale, and a
     number that only reconciles against a file that no longer exists has no
     business in an acceptance record. The current figures were produced now,
     not backdated.

     **The composition differed too, and the matching count of 7 is a
     coincidence worth writing down.** In the build run the seven were six
     refusal tests **plus the settings-wiring test**, because `settings.json`
     was still reverted from the preceding absent-hook run. In the gate's run
     and in the re-measurement they are six refusal tests **plus the
     heredoc-over-block pin**, with wiring green. Same total, different set.

  3. `n/a`, as the 2026-09-07 entry above already records.
  4. **Met** by that entry; the repo-13 half stays `n/a`.
  5. **Met**, and asserted by a test rather than by inspection: the header
     carries `required_approving_review_count: 0`, the indirection limit, the
     self-edit limit and the note that `gh api` is untouched by decision B1.
  6. `npm run check` and `npm run format` — see the gate list at the end.
  7. `npm run status -- --show repo-15` and `--json` — same.

  **What the brief had wrong: the test's home.** Build step 5 and `Done when` 2
  say the test goes under `packages/core/test/`, on the reasoning that its
  repo-wide scans are "the precedent for a test that asserts on files outside
  any package". That was the best precedent available on 2026-09-01 and is no
  longer the closest one: **`scripts/test/hooks.test.ts` did not exist then**.
  repo-22 added it, and it already does precisely what step 5 describes — drives
  a hook script with fixture JSON on stdin and asserts the exit code — with a
  `run()` helper, an `isSilent()` helper and a settings-wiring assertion this
  work extends rather than duplicates. It is also in the `repo` vitest project,
  which exists for "repo tooling, which belongs to no tool and ships in no
  image". The cases went there. Putting them in `packages/core/test/` would have
  copied the harness into a package that has nothing to do with hooks, and left
  the three hooks tested in two places. **Recorded rather than done quietly,
  because it is a `Done when` line: the substance of the line is met and the
  path is not.**

  **The `settings.local.json` probe was attempted and is inconclusive — the
  ticket's `gh pr merge` question stays unmeasured.** The "Unmeasured" section
  suggests settling whether `Bash(gh pr merge *)` covers the bare form by
  testing a harmless analogue in a throwaway `settings.local.json`. A throwaway
  file denying `Bash(zzrepo15probe foo *)` was written into this worktree and
  `zzrepo15probe foo bar` was then run as the **positive control**. It was not
  refused — it reached the shell and returned 127, "command not found" — so the
  file had not been loaded into the running session and the probe could not
  distinguish "the rule does not match" from "the rule was never read". No
  conclusion is drawn from it. The file was deleted and
  `git status --porcelain` is empty. **No denied command was attempted**, and
  the real matcher's behaviour was not read. The hook blocks the bare form
  either way, so this changes the size of the gap it closes, not whether it
  closes one.

  **Two behaviours of the hook are pinned by tests as trades rather than left to
  be discovered**, both measured:

  - It **over-blocks** an _unquoted_ mention at the start of a heredoc body
    line — a heredoc whose body is `gh pr merge 129 --squash`, or
    `git push origin +main`, or the same indented as a fenced code block, all
    exit 2. `check-pr-title.sh` has had the identical shape since it shipped.
    A quoted mention is silent, and so is a harmless push.
  - It **misses** a quoted refspec: `git push origin "main"` and
    `git push origin '+main'` are allowed, because the quote strip removes the
    span before the argument scan sees it. Both are refused by the ruleset
    regardless, and over-blocking is the costlier error — repo-15's own honest
    limits say so.

  **Not folded in, though it was free, and named here so the deferral is not
  silent:** the hook could also refuse `gh api` calls naming a merge or
  branch-protection path, as a second layer under the two tier-1 `gh api` rows
  that today rest on the editable `Bash(gh api *)` rule alone. It would be
  strictly additive — it can only block, never permit — and it is ~4 lines.
  **It was left out because it is the first half of option B2's request parser,
  which was declined**, and because this ticket names "B2 without
  self-protection" as the one combination to refuse. `Done when` 1 is met
  without it. If the owner wants it, it is a small edit to this file and two
  tests; it is an open option, not a defect.

  **The hook has never fired live, and had not throughout its own build and
  gate.** Found by the gate, and it is the most valuable thing the gate
  produced: it settled decisively what the `settings.local.json` probe above
  could only fail to settle. A session resolves its `PreToolUse` hook set once,
  from the settings in force when it starts — in practice the **shared root
  checkout's** `.claude/settings.json`, which is on `main` and does not carry
  this registration. A hook added on an unmerged branch is therefore never
  loaded, **including by the session that writes it**. Measured three ways:

  - the gate ran the two commands this suite pins as must-block
    (`git push origin +main`, `git push origin refs/heads/main`) against a
    scratch local remote, and both went through, exit 0;
  - a heredoc shape this hook exits 2 on when driven directly completed
    normally as an ordinary Bash call in the build session;
  - and the build session's own transcript records `hook_success` for
    `check-tree-grep.sh` **twice** and **zero** records of any kind for
    `check-main-writes.sh`.

  That third one is the control, and it is why this is not a defect in the
  script: the mechanism is live and firing in the same session; this hook is
  simply not in the set. **It is expected to register once this is on `main`,
  inferred from that sibling evidence and not verified** — nobody has yet
  watched it refuse anything, and it should not be written up as working until
  somebody has. Every claim here and in the header about what it refuses is a
  claim about what the script does when driven directly, which is what the tests
  drive. Recorded in the header beside the indirection and self-edit limits.

  **That is this ticket's own subject, one level up, and it deserves saying
  rather than filing.** repo-15 exists because a guardrail that cannot protect
  itself makes every other rule advisory. A guardrail that is not yet
  _registered_ is the same silence standing somewhere else: it reads as
  protection in the diff, it passes its tests, it is cited in a gate — and it
  refuses nothing. The tests are green because they drive the script directly,
  which is precisely the gap repo-26 names in the other direction: a check whose
  failure mode is silence needs something asserting the negative, and no test
  here can assert that the _harness_ loaded the hook. An observation, not new
  work.

  **The objection A1 carries is unchanged by having built it, and is worth
  restating from inside the code:** this hook is a tracked file in
  `.claude/hooks/`, referenced by a tracked `settings.json`, and neither is
  named by any deny rule, any `Edit`/`Write` rule, any hook or any CI job. An
  agent that can edit either has no hook. §1 remains uncovered. The header says
  so in the file, in those terms, so the next reader does not mistake this for
  protection it is not.
