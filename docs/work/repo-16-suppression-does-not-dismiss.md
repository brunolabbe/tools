---
id: repo-16
tool: repo
title: An inline CodeQL suppression documents the finding but does not clear the check
kind: chore
status: ready
milestone: null
depends_on: [repo-13]
difficulty: hard
---

# repo-16 — Inline suppression does not dismiss; decide what carries it

## Why

[repo-13](./repo-13-codeql-false-positives-recur.md) chose inline
`// codeql[<rule-id>]` comments as this repo's mechanism for excusing a permanent
false positive, wrote the policy into
[adr/005](../adr/005-excusing-a-code-scanning-finding.md), and shipped the first
one on `tools/downloader/api/src/egress-proxy.ts`. It closed knowing one thing
was unsettled — its acceptance lines 5 and 8 both say so, and adr/005's
Consequences say "whether GitHub honours the comment natively is still
unverified", because a green `CodeQL` check on a comment-only diff is equally
consistent with "suppressed" and with "never attributed".

**It is now settled, and the answer is that it does not clear the check.**

CodeQL's alert-suppression queries record a suppression in the SARIF it uploads.
GitHub code scanning reads that field but does not act on it: the alert stays
`Open`. **The comment is a register, not a dismissal.** So every pull request
that touches `egress-proxy.ts` still gets a red `CodeQL` check, which is the cost
adr/005 measured on #123 and expected to have removed.

### The measurement

Four facts. The first two were checked here; the last two are relayed, marked as
repo-13 marks its own alert facts, because `gh api` is denied by
`.claude/settings.json` and there is no other route to the code-scanning API from
the development container.

1. **The suppression comment is on `main`.**
   `origin/main:tools/downloader/api/src/egress-proxy.ts` has exactly one
   `codeql[` match, at line 368, immediately above the flagged `http.request`
   call — verified with `git show origin/main:… | grep -n 'codeql\['`. It is also
   the only one in the repo: `grep -rn 'codeql\[' --include='*.ts' .` returns
   that one line, so adr/005's rule-4 register has a single entry.
2. **The `security` workflow ran on that push, with the comment present.**
   `gh run list --branch main --workflow security.yml` shows `success` at
   `94206d9` ("docs(repo): excuse a code-scanning finding in the code it excuses
   (repo-13)"), created 2026-09-01T02:16:18Z. `security.yml` triggers on
   `push: branches: [main]` and its `codeql` job carries no `if:`, so the
   analysis re-read the file after the comment landed.
3. **Alert 2 (`js/request-forgery`, Critical) remained `Open` afterwards.**
   Relayed by the repo owner on 2026-09-01; not verified here.
4. **The control that makes fact 3 readable:** alert 3
   (`js/missing-rate-limiting`, `routes/files.ts`) _closed_ when `dl-23`'s fix
   merged at `6f29eb0`. Relayed on the same terms. The route is metered on `main`
   today — `grep -c rateLimit tools/downloader/api/src/routes/files.ts` returns 4
   — so the pipeline does retire an alert once a change lands. That is why alert
   2 staying open is a result rather than a timing artefact, and it also settles
   repo-13's deferred acceptance line 3.

Facts 3 and 4 are the load-bearing ones and neither can be verified from here.
**Whoever picks this up should re-read the security tab before acting**, per
adr/005's own triage step 1: an alert is a claim about a commit, and `main` moves.

## Build

**Nothing here is a code fix, and the deliverable is a decision.** Do not settle
it inside the implementation — bring the four options below to the repo's owner
with their costs, as the root `CLAUDE.md`'s "Decisions" section requires, and
implement the one chosen.

### 1. Bring the four options, costed

**Option 1 — `advanced-security/dismiss-alerts` in `security.yml`.** Parses the
uploaded SARIF, splits results by whether `suppressions[]` is non-empty, matches
them to alerts by rule id, file, line and column through the Code Scanning Alerts
API, and PATCHes the suppressed ones to dismissed. It also re-opens alerts it
previously dismissed whose suppression has gone, which is the property that makes
deleting a comment mean something.

Three mechanics to get right, all of them cheap:

- It takes `sarif-file` and `sarif-upload-id`. **The brief this ticket was filed
  from said the existing `analyze@v4` step "already passes `output: ../results`".
  It does not** — the step passes `category:` and nothing else. The claim is
  right in effect and wrong in the letter: `../results` is the `analyze` action's
  documented default for `output`, so the SARIF is on disk regardless, and the
  step also exposes `sarif-output` (absolute path to that directory) and
  `sarif-id` as step outputs. So the real change is adding an `id:` to the
  analyze step and reading `steps.<id>.outputs.sarif-output` and `.sarif-id`,
  which is more robust than hard-coding a relative path. Confirm both defaults
  against the pinned action version before writing the step.
- **It must run only on the default branch.** Dismissal is a repository-global
  property, so a pull request that adds a suppression must not be able to dismiss
  an alert for everybody: gate the step on
  `github.event_name == 'push' && github.ref == 'refs/heads/main'`.
- **No new permission.** The `codeql` job already declares
  `security-events: write`, which is what the alerts API PATCH needs.

**The cost worth naming**: it dismisses with reason _"won't fix"_ and comment
_"Suppressed via SARIF"_ — fixed, generic text. adr/005 requires five fields of
justification, and under this option all five live only in the code comment while
GitHub's own record of the decision becomes uninformative. Someone reading the
security tab sees a machine-worded dismissal and has to open the file. That is a
real narrowing of the property adr/005 was written to protect, though not a loss
of it: the reasoning still exists, in the place adr/005 chose to put it.

**Option 2 — `advanced-security/filter-sarif`.** Filters results out of the SARIF
by **path and rule id** before upload; patterns are
`[+/-]<file glob>[:<rule glob>]`, later lines overriding earlier ones.

This option matters for a reason beyond its own merits. **repo-13 struck the
path-scoped filter option after establishing that CodeQL's `query-filters` select
by metadata with no path key** — see adr/005's "A path-scoped query filter in
`security.yml`", which calls it "the leading candidate" and says "it does not
exist". That conclusion is correct about CodeQL's configuration and wrong as a
general claim: **path + rule-id scoping does exist, one layer later, in the
pipeline.** adr/005's alternative answers "can the analysis be scoped"; the
question that mattered was "can the result be scoped". Note that when amending.

Cost, and it is structural in two ways:

- **The alert never appears at all.** There is nothing in GitHub's record to show
  that a human looked — which is precisely the property adr/005's Context
  identifies as the failure worth fixing ("a reader had no way to tell an alert
  somebody had examined and rejected from one nobody had opened"). Option 1
  leaves a dismissal, weakly worded; option 2 leaves nothing.
- **It is a bigger workflow change than option 1.** filter-sarif runs _between_
  `analyze` and `upload-sarif`, so the workflow has to set the analyze step's
  `upload` to `failure-only` and add an explicit
  `github/codeql-action/upload-sarif` step. Three steps change instead of one,
  and the repo takes ownership of the upload path `analyze` currently handles for
  it.

**Option 3 — dismiss by hand on each recurrence.** What repo-13 was filed to
escape, now with a measured price: this alert was dismissed on 2026-08-23 and
came back when `dl-27` moved the code on 2026-08-30 (`ec1dd6b`), with none of the
first triage's reasoning attached. Its one real merit — a human in front of every
finding — is cheaper than it was, because adr/005 now carries the reasoning; the
recurring cost is the click, and the red check in between.

**Option 4 — accept the red check** on any pull request touching that file. Zero
work, and the honest baseline. It trains people to ignore a red security check,
which is the failure mode with the longest tail and the one nothing in this repo
would detect.

### 2. Cost the supply-chain exposure separately, because it is a convention question

**Options 1 and 2 both add a third-party action to the job that uploads security
results and holds `security-events: write`.** For option 1 that action also
_writes_ alert state. A compromised release could dismiss real alerts silently,
and nothing here would notice — a different risk profile from `actions/checkout`,
which can only fail loudly.

`advanced-security` is a GitHub-maintained org, not `actions/` or `github/`, so
this is trust-adjacent rather than first-party. The repo's current discipline is
**tags, everywhere, no exceptions**: `actions/checkout@v7`, `actions/cache@v6`,
`github/codeql-action/{init,analyze}@v4`, `docker/build-push-action@v7`,
`googleapis/release-please-action@v5`. `dismiss-alerts` publishes a moving `v2`
alongside `v2.0.3` (2026-07-08), so a tag pin is available and matches the house
style.

So the sub-decision to put alongside the main one: **keep tag pinning uniformly,
or SHA-pin this one step and write down why the exception exists.** A convention
with one silent exception is worse than either; if the answer is a SHA, it wants
a sentence in `.github/workflows/security.yml` beside it saying that steps
holding `security-events: write` are pinned harder than the rest.

### 3. Amend adr/005 — required whichever option wins

Do not edit the ADR in this ticket; it is part of the implementation. The
amendment has to say three things:

- **The mechanism claim is wrong and the register claim is right.** adr/005's
  Decision presents the inline comment as the answer. The comment remains correct
  as the _register_ — it tells a reader of the file why the finding is excused,
  and no dismissal, filter or repository setting does that. It is not sufficient
  as the _mechanism_: it does not clear the check. Split the two words
  explicitly, because the record currently uses one for both.
- **The path-scoped filter alternative needs correcting**, per the note in option
  2 above. It was struck on a true statement about the wrong layer.
- **Consequences: replace the "still unverified" paragraph with the result**, and
  strike the sentence offering `dismiss-alerts` as a hypothetical follow-up "to
  take on its own evidence rather than to pre-empt here" — the evidence arrived.
  Record which option was chosen and why the other three were not, in the
  "Alternatives considered" form the record already uses.

### 4. Clear the outstanding alert, whichever way this goes

**Alert 2's dismissal is still outstanding under every option**, "do nothing"
included, and no option retires it retroactively: option 1 dismisses it on the
next push to `main`, option 2 hides it from the next upload, options 3 and 4
leave it standing. Say in the Log what state it was left in, checked against the
security tab rather than inferred.

## Done when

1. The four options are put to the repo's owner as a decision with costs, and one
   is chosen; the rejected three are recorded with the cost that ruled each out.
2. If an option changing `security.yml` is chosen, it is implemented, and the
   default-branch-only condition on any dismissal step is verified by reading the
   workflow rather than asserted.
3. The pinning sub-decision in Build step 2 is answered explicitly — tag or SHA —
   and, if it departs from the repo's uniform tag pinning, the reason is written
   beside the step.
4. adr/005 carries all three amendments in Build step 3, including the correction
   to its path-scoped-filter alternative.
5. repo-13's acceptance lines 5 and 8 are answered — pointing at this ticket is
   enough — and its deferred line 3 is marked settled by fact 4 above.
6. The state of alert 2 after the chosen change is recorded in this ticket's Log,
   read from the security tab, with the date and the commit.
7. `npm run check` passes and `npm run format` has been run, since this ticket's
   work is `.md` and `.yml`.

## Log

- **2026-09-01** — Filed, branched from `origin/main` at `94206d9`. Facts 1, 2
  and the `rateLimit` half of fact 4 were reproduced against `origin/main` before
  filing rather than transcribed; facts 3 and 4's alert states are relayed and
  were not verified, for the reason given under "The measurement". Three things
  the framing this ticket was filed from had wrong or left unsaid, all found by
  checking:

  - **`security.yml`'s `analyze` step does not pass `output: ../results`.** The
    brief said it "already passes" it; the step passes `category:` and nothing
    else. The conclusion the brief drew survives — `../results` is the action's
    own default, so the SARIF is on disk either way — but the workflow edit is
    not "confirm the existing line is usable", it is "add an `id:` and read
    `sarif-output`". Written into option 1 that way.
  - **`analyze@v4` exposes `sarif-id` as a step output**, which is what
    `dismiss-alerts`' second required input wants. The brief named only the
    on-disk SARIF as a thing to check; the upload id is the other one, and it is
    free once the step has an `id:`.
  - **Option 2 is a three-step workflow change, not a one-step one.**
    filter-sarif runs between `analyze` and `upload-sarif`, so choosing it means
    setting `upload: failure-only` on the analyze step and adding an explicit
    upload step. That asymmetry with option 1 belongs in front of whoever
    decides, and the brief did not name it.

  The action inputs, defaults and tag list above were read from
  `github.com/advanced-security/dismiss-alerts`,
  `github.com/advanced-security/filter-sarif`, and `codeql-action`'s
  `analyze/action.yml` at `v4`. `gh api` was not attempted: it is denied, and a
  deny rule binds in every permission mode.

  A fourth correction, to this ticket's own dispatch rather than to its subject:
  **"leave `## Review` empty" means omit the heading, not write an empty one.**
  Filing with a `## Review` heading holding only an HTML comment produced
  `status is "ready" but the ticket carries a ## Review gate record` from
  `npm run status`, because `scripts/status.mjs`'s `hasGateRecord` matches
  `/^##\s+Review\b/` outside a fence and never looks at the body. repo-13's
  filing commit `7d56035` has no `## Review` heading either. The heading was
  removed; a reviewer adds it with the gate.

  Not done, deliberately: `.github/workflows/security.yml` is untouched and
  adr/005 is unedited. Both are the implementation, and the option is unchosen.

## The gate on this filing

**This section records the gate on the pull request that files this ticket.**
There is no `## Review` section, per `docs/01-TICKETS.md`: a filing has no work
to check — its `Done when` lines describe an implementation that does not exist —
and a gate record in that section would make an unstarted ticket trip repo-12's
`reviewed-but-ready` board check. The heading is absent rather than empty
because that check reads the heading, not the body; see the Log.

Not gated by a reviewer; the reproduction above is the verification, which is why
each fact is marked checked or relayed rather than restated. What the branch ran:

- `npm run build` — exit 0, after `worktree-farm.sh`.
- `npm run check` — pass.
- `npm run format` — run; this branch adds one `.md` file and nothing else.
- `npm run status -- --show repo-16` — renders, depends on repo-13, which is
  `done`, so unblocked.
- `npm run status -- --json` — exit 0: no dangling dependency and no
  `reviewed-but-ready` warning.

**Id check.** `repo-16` was confirmed free against both lists
`docs/01-TICKETS.md` requires. `git ls-tree origin/main --name-only docs/work/`
ends at `repo-13`, and a grep for `repo-1[4-9]|repo-2[0-9]` across the tree
returns nothing, so no id above 13 is spoken for in any Log or gate record. The
`repo-40`, `repo-80`, `repo-90` and `repo-99` a looser grep finds are throwaway
fixture ids inside repo-3, repo-6, repo-7 and repo-8's records, not filed
tickets. **repo-14 and repo-15 are claimed by in-flight work in other
worktrees** and so appear in neither list — relayed by the repo owner, and the
reason this ticket is 16 rather than 14.
