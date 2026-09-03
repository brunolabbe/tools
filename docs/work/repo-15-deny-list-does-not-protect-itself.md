---
id: repo-15
tool: repo
title: The deny list cannot express what it is protecting, and it does not protect itself
kind: chore
status: ready
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
   register it in `settings.json`'s `PreToolUse` block. It must fire on `Bash`
   for the command threats and on `Write|Edit` for the self-protection ones,
   which is **two matchers, therefore plausibly two hook files** — `PostToolUse`
   is useless for self-protection, since it runs after the write.
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
7. If the `gh api` decision lands on "narrow it", say so in **repo-13's** Log or
   Build in the same commit, since that is the ticket waiting on it.

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

## The decisions this ticket poses, which it does not settle

**Decision A — scope of the hook.** Recommended first.

| Option                            | Covers                                                                                             | Cost                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A2 — tier 1 + self-protection** | the merge and workflow-edit paths, plus `.claude/settings.json` and `.claude/hooks/` (recommended) | one `Bash` hook and one `Write\|Edit` hook, ~2 short files and a test. Closes the item nothing else covers              |
| A1 — tier 1 only                  | the merge paths and the `git push` spellings the deny list misses                                  | cheapest, and leaves the guardrail editable — which makes every other rule advisory                                     |
| A3 — the full list                | tiers 1–3, including `git reset --hard`/`rm -rf`/`worktree remove` in the shared checkout          | the largest false-positive surface, on the commands agents run most. Highest risk of training people to route around it |

A2 is recommended because §1 is uncovered by every existing mechanism while
tier 1's `git push` rows are already double-covered by the ruleset, and because
tier 3's headline item turned out to be a no-op on a public repo.

**Decision B — what happens to the `gh api` blanket deny.** This is the one
repo-13 is waiting on.

| Option                                                                   | Consequence                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 — hook sits alongside the deny; `gh api` stays fully denied**       | safest, and **repo-13 stays blocked** on unverifiable alert data (recommended only if repo-13 can proceed on relayed data, which its Log says it cannot)                                                                                                      |
| **B2 — hook replaces the deny with a parser permitting read-only calls** | repo-13 unblocks. The hook must then allow `GET`/no-`--method` against a `code-scanning` path and refuse everything else, and it becomes the **sole** control on merge-by-API and branch-protection-by-API. An allow-list of paths, never a deny-list of them |
| B3 — narrow the deny rule itself, no hook                                | not viable: permission rules are prefix matches, so `Bash(gh api *)` cannot express "GET only" — the flag order is free (`gh api -X PUT x` and `gh api x -X PUT` are the same call)                                                                           |

B2 is the only option that unblocks repo-13, and it is safe only if A2 or A3
lands in the same change — otherwise the parser it depends on is editable by the
agent it constrains. **B2 without self-protection is the one combination to
refuse.**

## Done when

1. `.claude/hooks/` contains the hook(s) chosen by decision A, registered in
   `.claude/settings.json` under the matchers they need, and a fresh run of the
   step-1 matcher shows every threat in the chosen scope either denied by a
   permission rule or blocked by the hook.
2. A test under `packages/core/test/` drives each hook script with fixture input
   and asserts its exit code: at least one blocked command per threat group in
   scope, at least one command that must remain allowed, and the heredoc case
   from Build step 3. It failed before the hook existed.
3. An attempted `Edit` of `.claude/settings.json` is refused by the hook, proven
   by that test rather than by an agent trying it. (If decision A lands on A1,
   this line is `n/a` and the Log says so.)
4. Decision B is recorded on this ticket with its answer and its reason, and
   repo-13's Log or Build says what it now can or cannot do.
5. The hook's header comment states the indirection limit, the self-edit limit
   and the ruleset's `required_approving_review_count: 0`, in the file.
6. `npm run check` passes and `npm run format` has been run if any `.md` changed.
7. `npm run status -- --show repo-15` parses and `npm run status -- --json`
   exits 0.

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
