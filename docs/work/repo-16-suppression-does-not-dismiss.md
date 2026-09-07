---
id: repo-16
tool: repo
title: An inline CodeQL suppression documents the finding but does not clear the check
kind: chore
status: done
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

## Decision — answered 2026-09-07, not open

**The question was:** which of four options carries the suppression —
`advanced-security/dismiss-alerts` in `security.yml` (option 1),
`advanced-security/filter-sarif` before upload (option 2), dismissing by hand on
each recurrence (option 3), or accepting the red check (option 4)? And the
sub-decision Build step 2 poses: **tag-pin that step like everything else, or
SHA-pin it and write down why the exception exists?**

**The answer, from the owner, relayed through the orchestrator: option 1, and
SHA-pin the step with the reason written beside it.** Both matched the
orchestrator's recommendation, so neither overrode anything. **This ticket itself
recommends neither** — Build step 1 deliberately costs the four options without
picking one, and Build step 2 poses the pinning question without answering it —
so there is no ticket-level recommendation for the answer to have overridden.
Recorded 2026-09-07; **nothing below has been built** —
`.github/workflows/security.yml` is untouched and adr/005 is unedited.

**Why the other three were not chosen**, which `Done when` line 1 requires be
recorded with the cost that ruled each out:

- **Option 2 — `filter-sarif`. Ruled out because the alert never appears at
  all.** There is nothing in GitHub's record to show a human looked, which is
  precisely the property adr/005's Context identifies as the failure worth
  fixing. Option 1 leaves a weakly worded dismissal; option 2 leaves nothing.
  Secondary cost: it is a three-step workflow change rather than a one-step one,
  and it moves ownership of the upload path onto this repo.
- **Option 3 — dismiss by hand on each recurrence. Ruled out on its measured
  price:** this alert was dismissed on 2026-08-23 and came back when `dl-27`
  moved the code on 2026-08-30, with none of the first triage's reasoning
  attached. It is exactly what repo-13 was filed to escape, and the recurring
  cost is the click plus the red check in between.
- **Option 4 — accept the red check. Ruled out because it trains people to
  ignore a red security check** — the failure mode with the longest tail and the
  one nothing in this repo would detect. It is the honest baseline and it is not
  free.

**Carry option 1's own cost with the answer**, in this ticket's terms: it
dismisses with **fixed generic text** — reason "won't fix", comment "Suppressed
via SARIF". adr/005 requires five fields of justification, and under option 1 all
five live only in the code comment while **GitHub's own record of the decision
becomes uninformative**. Someone reading the security tab sees a machine-worded
dismissal and has to open the file. That is a **real narrowing of the property
adr/005 was written to protect, though not a loss of it** — the reasoning still
exists, in the place adr/005 chose to put it. Whoever builds this should not
discover that late and treat it as a defect in the action.

### The pinning sub-decision, and the measurement behind it

**Answered: SHA-pin the `dismiss-alerts` step, and write the reason beside it in
`security.yml`.**

Re-measured on this branch on 2026-09-07 rather than relayed —
`grep -rhoE 'uses: [^ ]+' .github/workflows/*.yml | sort | uniq -c`:

**34 action references across `.github/workflows/`, every one tag-pinned, across
12 distinct actions, with no SHA pins at all.** (`actions/checkout@v7` ×12,
`actions/setup-node@v7` ×4, `docker/build-push-action@v7` ×4,
`docker/setup-buildx-action@v4` ×4, `actions/upload-artifact@v7` ×2,
`docker/login-action@v4` ×2, and one each of `actions/cache@v6`,
`actions/dependency-review-action@v5`, `docker/metadata-action@v6`,
`github/codeql-action/analyze@v4`, `github/codeql-action/init@v4`,
`googleapis/release-please-action@v5`. A grep for a 40-hex `@` suffix returns 0.)

**So the SHA pin is the first exception to a uniform convention.** This ticket's
own rule is that a convention with one _silent_ exception is worse than either
policy — so the exception is only acceptable spoken. **The reason must be written
beside the step in `security.yml` when it is built:** steps holding
`security-events: write` are pinned harder than the rest, because this one
_writes_ alert state and a compromised release could dismiss real alerts
silently. That sentence is the deliverable of this half of the decision, not a
nicety attached to it.

**One thing this branch did not do:** it did not check whether
`advanced-security/dismiss-alerts` still publishes the `v2.0.3` tag recorded
above, and did not resolve any commit SHA. Both are the builder's to read at
build time, and a SHA copied out of a ticket filed a week earlier is the failure
this pin exists to prevent.

## Build

**Nothing here is a code fix, and the deliverable is a decision.** Do not settle
it inside the implementation — bring the four options below to the repo's owner
with their costs, as the root `CLAUDE.md`'s "Decisions" section requires, and
implement the one chosen.

### 1. ~~Bring the four options, costed~~ — done; option 1 chosen

**Settled by the decision above.** The four options and their costs are kept as
written, because they are what makes the answer legible and because `Done when`
line 1 requires the rejected three to stay recorded with the cost that ruled each
out. Build the chosen one; do not re-cost the others.

**Option 1 — `advanced-security/dismiss-alerts` in `security.yml` — CHOSEN.** Parses the
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

**Option 2 — `advanced-security/filter-sarif` — not chosen.** Filters results out of the SARIF
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

**Option 3 — dismiss by hand on each recurrence — not chosen.** What repo-13 was filed to
escape, now with a measured price: this alert was dismissed on 2026-08-23 and
came back when `dl-27` moved the code on 2026-08-30 (`ec1dd6b`), with none of the
first triage's reasoning attached. Its one real merit — a human in front of every
finding — is cheaper than it was, because adr/005 now carries the reasoning; the
recurring cost is the click, and the red check in between.

**Option 4 — accept the red check — not chosen** on any pull request touching that file. Zero
work, and the honest baseline. It trains people to ignore a red security check,
which is the failure mode with the longest tail and the one nothing in this repo
would detect.

### 2. ~~Cost the supply-chain exposure separately~~ — answered: SHA-pin, with the reason beside it

**Settled by the decision above**, including the measurement that makes it an
exception worth naming. The reasoning below is kept as written; the answer is
the SHA, and the sentence in `security.yml` is part of the deliverable rather
than a comment somebody may skip.

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

**Answered 2026-09-07: SHA, with that sentence.** The tag list above is left as
written and should be re-read at build time rather than trusted from here.

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

1. ~~The four options are put to the repo's owner as a decision with costs, and
   one is chosen; the rejected three are recorded with the cost that ruled each
   out.~~ **Done 2026-09-07: option 1 chosen, three rejected with their costs, in
   the Decision section above.**
2. ~~If an option changing `security.yml` is chosen, it is implemented, and the
   default-branch-only condition on any dismissal step is verified by reading the
   workflow rather than asserted.~~ **Done 2026-09-07.** The condition was read
   back out of the parsed file rather than off the diff: the dismissal step's
   `if` is
   `github.event_name == 'push' && github.ref == 'refs/heads/main'`. See the Log
   for the command. **A second step was needed and the Build section did not name
   it** — `packs: codeql/javascript-queries:AlertSuppression.ql` on `init`,
   without which the SARIF carries no suppressions and the dismissal is inert.
3. ~~The pinning sub-decision in Build step 2 is answered explicitly — tag or
   SHA~~ **— answered 2026-09-07: SHA** — and, **because it does depart from the
   repo's uniform tag pinning (34 references, 12 actions, 0 SHA pins, measured
   2026-09-07), the reason is written beside the step.** ~~That half is still
   outstanding: it lands in `security.yml` when this is built, and it is the part
   of this line that can still fail.~~ **Done 2026-09-07:** the pin is
   `advanced-security/dismiss-alerts@a18f986bdb40edba0dd7a74382c15d4a3d50a1c8`
   (`v2.0.3`) and the paragraph above it in `security.yml` says why a step
   holding `security-events: write` is pinned harder than the rest. The 34/12/0
   measurement reproduces on `origin/main` at `e9054c5`; command in the Log.
4. ~~adr/005 carries all three amendments in Build step 3, including the
   correction to its path-scoped-filter alternative.~~ **Done 2026-09-07** —
   register/mechanism split in the Decision, a `> Correction` under the
   path-scoped-filter alternative, and a `#### What the merge showed`
   subsection replacing the "still unverified" position, with the superseded
   paragraphs kept and marked and the hypothetical-follow-up sentence struck in
   place. A fourth amendment the ticket did not ask for: the `Open` result is
   recorded as having **two** explanations this repo cannot separate, not one.
5. repo-13's acceptance lines 5 and 8 are answered — pointing at this ticket is
   enough — and its deferred line 3 is marked settled by fact 4 above.
   **Answered 2026-09-07: amend repo-13 in place.** repo-13 is now
   `status: done`, so this line asks for an edit to a closed ticket, and the
   owner chose to make it. **That overrode the orchestrator's recommendation**,
   which was to record the answer on this ticket only and leave the closed one
   alone, on the grounds that a `done` ticket is a historical record and
   amending it retroactively is the same class of move as repointing a dated
   citation. **The reason the override wins: repo-13 contradicts itself today.**
   Its body reads
   `repo-13-codeql-false-positives-recur.md:216` "**Answered 2026-09-01: it closed.**"
   struck through, while its own gate table still reads
   `repo-13-codeql-false-positives-recur.md:294` "correctly left **deferred**"
   — **that row is now marked `WITHDRAWN` and retracted beneath the table; the
   line number is repointed from the one this ticket was filed with, which this
   build's own edit moved**.
   Leaving that standing misleads every future reader of repo-13, not only
   whoever builds this ticket.

   **The objection this amendment must meet, and it is the reason it is not a
   free edit: the half being corrected is a reviewer's committed gate record.**
   Whoever does it is amending evidence somebody else signed. So **annotate,
   do not overwrite** — the repo's own rule for this exact case is in
   `.claude/skills/orchestrate-tickets/reference/records.md`, which says a claim
   that reached a record is withdrawn in place and never deleted: mark the wrong
   row `WITHDRAWN — do not cite this paragraph`, leave it standing with the
   retraction directly beneath it, restore the corrected statement as the
   standing one, and **attribute the error to the link that made it** rather than
   to the reviewer generically. A record showing only the corrected state hides
   that the claim was made and acted on, and the propagation is the part a later
   reader needs.

   **This is the build's work, not the bookkeeping branch's.** The branch that
   answered this decision deliberately did not touch repo-13.

   **Done 2026-09-07.** Lines 3, 5 and 8 each carry a dated answer; gate 1's
   table row 3 is marked `WITHDRAWN — do not cite this row` and kept, with the
   retraction in a blockquote directly beneath the table, attributed to the
   round that applied the owner's security-tab reading rather than to the
   reviewer. Verified programmatically that exactly one of the 29 gate-table
   rows changed in content; command in the Log.

6. **Not done, and not doable from here.** The state of alert 2 after the chosen
   change cannot be recorded yet by anyone: the dismissal step runs only on a
   push to `main`, so there is no "after" until this merges. Nor could the
   _current_ state be re-read — `gh api` is denied and the security tab is not
   reachable from the development container, so fact 3 in "The measurement" above
   is still the 2026-09-01 relayed reading and nothing on this branch upgrades
   it. **This line is the ticket's outstanding acceptance**, and the first look
   after the merge is what closes it: the alert should read _dismissed_ with the
   comment `Suppressed via SARIF`.
7. ~~`npm run check` passes and `npm run format` has been run, since this
   ticket's work is `.md` and `.yml`.~~ **Done 2026-09-07** — see the Log.

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

- **2026-09-05** — `status: ready` → `needs-decision`, by
  [repo-19](./repo-19-ready-does-not-mean-startable.md) in the commit that
  taught the parser the value. Nothing about this ticket changed: its Build
  section already opens with "the deliverable is a decision. Do not settle it
  inside the implementation", which is exactly what the new status records. It
  was on the `--ready` board and could not be started, and a builder dispatched
  against it would have spent a full round to learn that. Move it back to `ready`
  in the commit that writes the chosen option onto this page.

- **2026-09-07 — the decision was answered by the owner: option 1
  (`advanced-security/dismiss-alerts` in `security.yml`), plus the pinning
  sub-decision: SHA-pin that step, with the reason written beside it.** Both
  matched the orchestrator's recommendation, and this ticket recommends neither
  option itself, so nothing was overridden. `status: needs-decision`
  → `ready`. The Decision section above is new, Build steps 1 and 2 are marked
  settled in place, and `Done when` lines 1 and 3 are marked.

  **The cost carried with the answer:** option 1 dismisses with fixed generic
  text ("won't fix" / "Suppressed via SARIF") where adr/005 requires five fields
  of justification, so GitHub's own record of the decision becomes uninformative
  and the reasoning lives only in the code comment. A real narrowing of what
  adr/005 protects, not a loss of it. The three rejected options are recorded
  with the cost that ruled each out, per `Done when` line 1.

  **The pinning measurement was taken on this branch, not relayed:**
  `grep -rhoE 'uses: [^ ]+' .github/workflows/*.yml | sort | uniq -c` returns
  **34 action references, 12 distinct actions, every one tag-pinned; a grep for a
  40-hex `@` suffix returns 0.** So the SHA pin is the **first exception to a
  uniform convention**, which is exactly the case this ticket says must not be
  silent. The sentence beside the step is therefore part of the deliverable:
  steps holding `security-events: write` are pinned harder than the rest, because
  this one _writes_ alert state and a compromised release could dismiss real
  alerts silently.

  **`Done when` line 5 is answered too, and its answer overrode a
  recommendation.** It asks to answer repo-13's acceptance lines 5 and 8 and mark
  its deferred line 3 settled. **repo-13 now reads `status: done`** — read from
  the file, not relayed — so that means editing a closed ticket. **The owner
  chose to amend repo-13 in place**, against the orchestrator's recommendation to
  record only here and leave the closed ticket alone. The losing argument is kept
  because it is still true: a `done` ticket is a historical record, and amending
  it retroactively is the same class of move as repointing a dated citation —
  which is the very thing this branch refused to do on repo-29. What settles it
  the other way is that **repo-13 already contradicts itself**, so leaving it
  alone is not neutral.

  **The objection the amendment must meet: the half being corrected is a
  reviewer's committed gate record**, so it means amending evidence somebody else
  signed. `Done when` line 5 above now carries the rule for that —
  `.claude/skills/orchestrate-tickets/reference/records.md`'s withdraw-in-place
  form, annotate rather than overwrite, and attribute the error to the link that
  made it. **Not done on this branch:** the amendment is repo-16's build work,
  and repo-13 was not touched.

  A second wrinkle found while checking, worth carrying because it changes what
  that line is even asking for: **repo-13's acceptance line 3 already reads
  answered** — struck through, with "**Answered 2026-09-01: it closed.**" — while
  its gate table's row 3 still reads "correctly left **deferred** — `gh api`
  denied". So the body and the gate record disagree, and "mark its deferred line
  3 settled" was already partly stale when this ticket was filed. Not fixed here;
  fixing it is an edit to a closed ticket, which is the same unresolved question.

  **Recorded, not built.** `.github/workflows/security.yml` is untouched, adr/005
  is unedited, no SHA was resolved, and the security tab was not re-read — facts
  3 and 4 in the measurement section above are still relayed and still marked as
  such, and this ticket's own instruction to re-read the security tab before
  acting is unchanged. This branch is bookkeeping across four tickets whose
  decisions were answered in one sitting.

- **2026-09-07 — built.** Branch `repo-16-dismiss-suppressed-alerts` off
  `origin/main` at `e9054c5`; `origin/main` exists on the remote, checked with
  `git ls-remote --heads origin main` → `e9054c5d1c…`. Files: three, exactly the
  declared surface — `.github/workflows/security.yml`, `docs/adr/005-…md`,
  `docs/work/repo-13-…md`, plus this ticket.

  **The SHA, resolved at build time as Build step 2 requires.**
  `git ls-remote --tags --refs https://github.com/advanced-security/dismiss-alerts`
  →
  `a18f986bdb40edba0dd7a74382c15d4a3d50a1c8 refs/tags/v2.0.3`. The same run
  without `--refs` returns **no `^{}` peeled entry**, so `v2.0.3` is a
  lightweight tag pointing straight at that commit and the SHA is the commit's,
  not a tag object's. **`v2` resolves to the same commit**, which is worth
  noting: today the moving tag and the pinned one agree, so the pin buys nothing
  yet and everything later. `git clone --depth 1 --branch v2.0.3` then
  `rev-parse HEAD` returns the same 40 hex.

  **Three things the ticket had wrong or did not have, all found by reading the
  pinned action rather than the docs page it was filed from.**

  - **The input is `sarif-id`, not `sarif-upload-id`.** Build step 1 says the
    action "takes `sarif-file` and `sarif-upload-id`". `action.yml` at
    `a18f986` declares `sarif-id` and `sarif-file`, both required, and
    `src/main.ts` reads exactly those, at lines 449-450. The ticket transcribed the
    action's **own README**, whose prose bullet still says `sarif-upload-id`
    while every YAML example beneath it says `sarif-id` — so the error came from
    upstream and would have failed the step at runtime with
    `Input required and not supplied: sarif-id`.
  - **The step needs `GITHUB_TOKEN` in `env:`.** `src/main.ts` line 451, in the
    same repository, is
    `core.getInput("token") || getRequiredEnvParam("GITHUB_TOKEN")`, and
    `action.yml` declares no `token` input. Build step 1's "no new permission" is
    right — `security-events: write` is already on the job — but a permission is
    not a token, and without the `env:` block the step throws before its first
    API call.
  - **The bigger one: `security-extended` never runs an alert-suppression
    query, so there was no `suppressions[]` for anything to act on.** Measured
    against `github/codeql` at `4239fee` and `github/codeql-action` at
    `cdf488f` (the `v4` tag):
    `javascript/ql/src/AlertSuppression.ql` is `@kind alert-suppression`;
    `misc/suite-helpers/security-extended-selectors.yml`, the selector behind
    `queries: security-extended`, includes only kinds `problem`,
    `path-problem`, `diagnostic` and `metric`; and
    `grep -o -E '"--sarif-[a-z-]+"' codeql-action/lib/entry-points.js | sort | uniq -c`
    returns five flags
    (`--sarif-add-baseline-file-info`, `--sarif-category`,
    `--sarif-group-rules-by-pack`, `--sarif-include-diagnostics`,
    `--sarif-merge-runs-from-equal-category`), none about suppressions.
    So `packs: codeql/javascript-queries:AlertSuppression.ql` went on the `init`
    step; codeql-action's own
    `src/config/db-config.ts` — `generateCodeScanningConfig`, read at `cdf488f`
    — shows `queries` and
    `packs` are injected into the computed config independently, so the suite is
    not displaced, and its `init/action.yml` says `packs` is available in a
    single-language analysis, which this is.

  **What that third finding does to this ticket's own premise, and it is not
  cosmetic.** "The measurement" above states the answer as _GitHub reads the
  suppression field and does not act on it_. On the evidence above, **no
  suppression field was ever produced**, so alert 2 staying `Open` has a second
  explanation and this repo cannot separate the two — the same trap repo-13's
  green-check dichotomy fell into. The **conclusion** survives untouched: the
  comment alone does not clear the check, and option 1 is still the answer,
  because both explanations want the same two workflow steps. The **stated
  mechanism** does not, and adr/005 now says so rather than asserting the
  opposite. The Why section above is left as filed; this entry is the
  correction.

  **The default-branch gate, read rather than asserted** (`Done when` 2). Parsed
  the file with the `yaml` package fetched to a scratch directory
  (`npm pack yaml`, extracted outside the worktree — the repo has no YAML parser
  in `node_modules` and none was installed into it) and printed
  `jobs.codeql.steps`: all seven workflow files parse, and the dismissal step
  reads
  `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
  `uses: advanced-security/dismiss-alerts@a18f986…`, with `sarif-id` and
  `sarif-file` bound to `steps.analyze.outputs.*` and `GITHUB_TOKEN` in `env`.
  `analyze` carries `id: analyze`; `analyze/action.yml` at `cdf488f` gives
  `output` the default `../results` and declares `sarif-output` and `sarif-id`
  as outputs, so nothing is hard-coded. Consequence worth stating: the step is
  skipped on `schedule` and `workflow_dispatch` too, not only on pull requests.
  That is the condition the decision specified and it is right — alerts move on
  the push analysis — but it is broader than "not on pull requests".

  **The pinning measurement reproduces**, on `origin/main` at `e9054c5` rather
  than relayed:
  `git grep -hoE 'uses: [^ ]+' origin/main -- .github/workflows/ | sort | uniq -c`
  → **34 references, 12 distinct actions**, and
  `git grep -hoE 'uses: [^ ]+@[0-9a-f]{40}' origin/main -- .github/workflows/ | wc -l`
  → **0**. So this is the first SHA pin in the directory, and the reason sits
  beside it in the file.

  **repo-13, amended in place** (`Done when` 5). Row 3 of gate 1's table is
  marked `WITHDRAWN — do not cite this row` and left standing, with the
  retraction in a blockquote directly beneath the table. Checked
  programmatically rather than by eye that nothing else in either gate record
  moved: a script comparing every `|`-row against `git show HEAD:` with padding
  normalised reports **29 rows, 1 differing in content**, and `git diff -U0`
  shows no `-` line anywhere in the two records' prose. The retraction
  attributes the break to the `2026-09-01, the open input` round — which struck
  the body's line 3 and left the committed row without a forward-pointer — not
  to the reviewer, whose row was accurate at `196fd28`. Row 4 is deliberately
  not retracted, and the retraction says why.

  **`Done when` 6 is outstanding and nobody could have closed it here.** The
  dismissal runs only on a push to `main`, so there is no post-change state to
  read until this merges, and the pre-change state could not be re-read either:
  `gh api` is denied and there is no other route to the code-scanning API from
  the container. Fact 3 above is still the 2026-09-01 relayed reading. Setting
  `status: done` with one acceptance line waiting on a merge is what repo-13
  itself did with its lines 5 and 8.

  **What was not established, stated as unestablished.** Nobody has seen this
  mechanism run. The workflow is not triggered by a push to a feature branch —
  `on: push` is filtered to `main` — so opening a pull request is the earliest
  point at which GitHub even parses the file, and the dismissal step is skipped
  there by design. The `packs:` line has never been executed against a real
  CodeQL run from here; that the suite excludes `AlertSuppression.ql` is
  measured, but whether the CodeQL CLI would have added it by some other route
  is **not established from here** — the Action passes no flag that would, and
  the action's own README instructs adding the query explicitly, which is
  evidence and not proof.

  **One thing folded in, since reading `AlertSuppression.qll` made it free.**
  adr/005's rule 1 ("the line before, never the end of the line") rested only on
  the alert-hash argument. The shared library the query is built from gives a
  `codeql[…]` comment a scope of exactly the line after it, and requires nothing
  else to start that line — so the placement rule is what the query _requires_,
  not only what avoids churn. Two sentences added to adr/005; no rule renumbered.

  Gates: `npm run format`, then `npm run check`, then
  `node scripts/citations.mjs` on both edited tickets, then
  `npm run status -- --json`. Results in the report and in the pull request body;
  no unit suite is implicated — the diff is one workflow file and three `.md`.

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
