# 005 — Excusing a code-scanning finding, in the code it excuses

**Status:** accepted · **Date:** 2026-09-01 · **Affects:** every tool

## Context

[`security.yml`](../../.github/workflows/security.yml) runs CodeQL with
`queries: security-extended` on every push to `main`, every pull request and
weekly. Most of what it reports is worth reading — two of the four alerts from
the 2026-08-23 triage became [dl-23](../../tools/downloader/docs/work/dl-23-rate-limit-the-download-route.md)
and [dl-24](../../tools/downloader/docs/work/dl-24-classify-wvtt-as-webvtt.md),
which is the common case and the reason the workflow exists.

The problem is the other kind. **A dismissal binds to an alert instance, not to
the reason it was wrong.** `js/request-forgery` on the downloader's egress proxy
— severity **Critical** — was dismissed as a false positive on 2026-08-23.
`dl-27` edited
`egress-proxy.ts` on 2026-08-30 (`ec1dd6b`), the alert's location moved, and it
came back on the same code, for the same reason, with the same answer. The repo
paid for that triage twice, and the second bill arrived with none of the first
one's reasoning attached.

The cost is concentrated rather than constant. Measured on four pull requests,
the `CodeQL` check — a check run built from the uploaded SARIF, distinct from
`security.yml`'s `codeql` job, which passes regardless — reports only alerts a
pull request's own diff introduces or relocates. #123 touched `routes/files.ts`
and went red; #121, #122 and #124 touched neither flagged file and stayed green,
with #124 the control, since it changed no code at all while an alert was open
on `main`. So a known-wrong alert costs nothing until somebody edits its file,
and then it costs that pull request until somebody dismisses it again.

Underneath the mechanics is the question this record actually answers. Before
today the only trace of the 2026-08-23 triage was four lines inside `dl-23`'s
Log — invisible to anyone reading `egress-proxy.ts`, and indistinguishable from
no triage at all. **A reader had no way to tell an alert somebody had examined
and rejected from one nobody had opened.** That is the failure worth fixing;
the red check is a symptom.

## Decision

**An excused finding is excused in the code it excuses, with a comment on the
line above the alert** — and that comment is the **register**, not the
**mechanism**. It tells a reader of the file why the finding is excused, which
nothing else here does; it does not, on its own, clear the `CodeQL` check. What
clears the check is the dismissal step in
[`security.yml`](../../.github/workflows/security.yml). See
"[Register and mechanism are two jobs](#register-and-mechanism-are-two-jobs)"
below. _(Amended 2026-09-07 by [repo-16](../work/repo-16-suppression-does-not-dismiss.md);
this record originally used one word for both.)_

```ts
// Why this query fires here and why that is correct, in prose.
// Excused under docs/adr/005. Guarded by <the real guard>; if it is removed,
// <suite> fails <n> tests — that, not this comment, is what protects the design.
// Verified <date> at <commit>.
// codeql[js/request-forgery]
const proxied = http.request(
```

Four rules, each carrying its own weight:

1. **The suppression comment goes on the line _before_ the alert, never at the
   end of its line.** Code scanning identifies an alert partly by a hash of its
   line's contents; a trailing comment changes that hash and churns the alert it
   was meant to settle.
2. **Five fields, always: the query id, the file, the date, the reasoning, and
   the test that would catch the true positive if the design regressed.** The
   file is the one the comment sits in. The last field is what makes the record
   auditable rather than merely reassuring.
3. **No test, no excuse.** If nothing goes red when the guard is removed, that
   absence _is_ the finding: write the test first, and leave the alert open until
   it exists. An excused alert with nothing behind it is worse than an open one,
   because it looks handled.
4. **The register is the comments.** There is no list to maintain and no page to
   keep in sync:

   ```bash
   grep -rn 'codeql\[' --include='*.ts' .
   ```

   Every excused finding in the repo, with its reasoning in the lines above it.
   An alert with such a comment was examined; an alert without one was not. That
   is the whole answer to the question in Context, and it cannot drift from the
   code, because it _is_ the code.

Rule 4 is [003](./003-the-status-page-is-generated.md)'s reasoning applied to a
second projection. A hand-maintained register of excused findings needs a writer,
every writer available here is a human who will forget, and a register that
disagrees with the code is worse than none — so derive the view instead of
storing it.

### Register and mechanism are two jobs

_Added 2026-09-07 by [repo-16](../work/repo-16-suppression-does-not-dismiss.md)._

Rules 1–4 describe a **register**: an in-repo, in-diff, in-review record that a
human looked at a finding and rejected it. That job is done, and no dismissal,
SARIF filter or repository setting does it.

They do **not**, by themselves, do the second job — clearing the check — and the
first version of this record did not distinguish the two. Two workflow steps
carry the mechanism, and both are needed:

1. **`packs: codeql/javascript-queries:AlertSuppression.ql`** on the `init` step.
   That query is what turns a `// codeql[<rule-id>]` comment into a SARIF
   `suppressions[]` entry. It is **not** part of `security-extended`: that suite
   selects queries of kind `problem`, `path-problem`, `diagnostic` and `metric`,
   and `AlertSuppression.ql` is `@kind alert-suppression`. Without this line the
   uploaded SARIF records no suppression at all.

   **A free result from reading it: rule 1 is now measured, not only reasoned.**
   The shared library behind that query
   (`shared/util/codeql/util/suppression/AlertSuppression.qll`, github/codeql at
   `4239fee`) matches `codeql[…]` anywhere in a single-line comment, requires
   nothing else to start that line before it, and gives the comment a scope of
   **exactly the line after it**. So "on its own line, immediately above the
   alert" is what the query requires — an independent reason for rule 1, which
   until now rested only on the alert-hash argument.

2. **`advanced-security/dismiss-alerts`**, SHA-pinned, on pushes to `main` only.
   It splits the uploaded SARIF by whether `suppressions[]` is non-empty and
   PATCHes the suppressed results' alerts to dismissed — and re-opens an alert it
   had dismissed whose suppression has since gone, which is what makes deleting a
   comment mean something.

**The cost of step 2, named rather than discovered later.** It dismisses with
fixed text: reason `won't fix`, comment `Suppressed via SARIF`. Rule 2 requires
five fields of justification, and under this mechanism all five live only in the
code comment, so GitHub's own record of the decision is uninformative on its own
— someone reading the security tab has to open the file. That is a real narrowing
of what this record protects, though not a loss of it: the reasoning still exists,
in the place rule 4 chose to put it.

**The SHA pin is this repo's only one**, against 34 tag-pinned action references
across 12 distinct actions in `.github/workflows/` (measured 2026-09-07). The
exception is spoken rather than silent: a step holding `security-events: write`
is pinned harder than the rest, because this one _writes_ alert state, and a
compromised release could dismiss real alerts silently with nothing here to
notice.

### Triaging a new alert

The steps, in order, whichever query fired:

1. **Reproduce it against the tip before anything else.** Both alerts behind this
   record had citations that resolved on a branch and not on `main`, and one
   changed truth value mid-ticket when its fix merged. An alert is a claim about
   a commit, and the commit moves.
2. **Decide true or false positive on the evidence, and say which.** If true, it
   is an ordinary ticket in the owning tool's `work/`. This is the common case.
3. **If false, name the test that would go red if the design regressed** — see
   rule 3. Measure it by breaking the guard and watching the suite, rather than
   reasoning that it would.
4. **Excuse it in place, with all five fields.** A dismissal with no in-repo
   trace is not a decision, it is a disappearance.
5. **A test double is not production code.** The `startsWith` dismissed on
   2026-08-23 was in a test fixture. Record the category as the reason; do not
   argue the logic of code that never ships.

## Alternatives considered

**Dismiss each recurrence in the GitHub UI.** The status quo, and the only option
that puts a human in front of every finding — which is a real merit, not a
consolation. Rejected because it has already failed once in the measured way:
the reason lives in a free-text box that is not in version control, not in the
diff, and not visible to anyone reading the file. The recurrence is not
hypothetical and the second triage started from nothing.

**A path-scoped query filter in `security.yml`.** This was the leading candidate
and **it does not exist.** `paths` and `paths-ignore` govern which files are
analysed at all, for _every_ query; `query-filters` select queries by metadata —
`id`, `tags`, `severity` — with no path key. The two are not composable into
"this query, this path". So the option collapses into disabling
`js/request-forgery` across the whole repo, or excluding `egress-proxy.ts` from
analysis entirely, and both trade a narrow known-wrong alert for a wide blind
spot. Recorded at length because the shape is plausible enough that the next
person will propose it again.

> **Correction, 2026-09-07 ([repo-16](../work/repo-16-suppression-does-not-dismiss.md)).**
> Everything above about CodeQL's _configuration_ is still true and still the
> reason this option was struck. The sentence **"it does not exist"** is too
> broad, and read as a general claim it is wrong: **path + rule-id scoping does
> exist, one layer later in the pipeline.**
> [`advanced-security/filter-sarif`](https://github.com/advanced-security/filter-sarif)
> drops results from the SARIF by `[+/-]<file glob>[:<rule glob>]` before upload.
> The paragraph answers "can the _analysis_ be scoped"; the question that
> mattered was "can the _result_ be scoped". Filtering the result was costed on
> its own terms in 2026-09-07's decision below and lost there, for a different
> reason — it leaves nothing in GitHub's record to show a human looked, which is
> the failure in Context.

**Raise the check's failure severity in repository settings.** Not in version
control, invisible from a checkout, and global: it would silence real `high` and
`critical` findings everywhere to quiet one known-wrong finding in one file. The
finding this record does excuse is itself **Critical**, so the threshold would
have to be set high enough to blind the repo to its most serious class. Rejected
on sight.

**A register document under `docs/`.** Rejected for the reason in rule 4, and
for a second: a page describing two files inside one tool is where the root
`docs/` spine starts to fuse with a tool's, which [001](./001-per-tool-docs-and-tickets.md)
exists to prevent. The policy is repo-wide and belongs here; the entries are
about specific lines and belong on them.

### Carrying the suppression to the check — decided 2026-09-07

The alternatives above answer "where does the reasoning live". These answer the
second question, which this record did not separate from the first until
[repo-16](../work/repo-16-suppression-does-not-dismiss.md): **what actually
clears the `CodeQL` check.** Chosen by the repo's owner.

**`advanced-security/dismiss-alerts` in `security.yml` — CHOSEN.** It converts a
SARIF suppression into a real dismissal, and reverses itself when the comment
goes. Its cost is named under "Register and mechanism" above: the dismissal it
writes carries fixed generic text, so the security tab's own record of the
decision is uninformative and rule 2's five fields live only in the code comment.

**`advanced-security/filter-sarif` before upload — not chosen.** It scopes by
path and rule id, which is the shape the struck alternative above was reaching
for. Rejected because **the alert never appears at all**, so there is nothing in
GitHub's record to show a human looked — precisely the failure this record's
Context names. `dismiss-alerts` leaves a weakly worded dismissal; `filter-sarif`
leaves nothing. Secondary cost: it runs _between_ `analyze` and upload, so the
workflow must set `upload: failure-only` and add an explicit
`github/codeql-action/upload-sarif` step — three steps change instead of one, and
the repo takes ownership of an upload path `analyze` currently handles for it.

**Dismiss by hand on each recurrence — not chosen**, on its measured price: this
alert was dismissed on 2026-08-23 and came back when `dl-27` moved the code on
2026-08-30 (`ec1dd6b`) with none of the first triage's reasoning attached. That
is what [repo-13](../work/repo-13-codeql-false-positives-recur.md) was filed to
escape. Its one real merit — a human in front of every finding — is cheaper than
it was, because this record now carries the reasoning.

**Accept the red check — not chosen.** Zero work, and the honest baseline. It
trains people to ignore a red security check, which is the failure mode with the
longest tail and the one nothing in this repo would detect.

## Consequences

**A reader of the code learns what a reader of the security tab used to have to
infer.** The comment is reviewed with the diff that moves it, which is the
property every rejected alternative lacked.

**Suppression does not weaken the guarantee, because the comment was never the
guarantee.** Rule 3 makes that explicit and it is measured, not asserted:
disabling `guard.assertAllowed` in `egress-proxy.ts` fails 5 tests in
`egress-proxy.test.ts`; disabling the address rejection inside the pinning
`lookup` fails 2 there and 6 in `dispatcher.test.ts`. Both suites run on every
push.

**Rule 2's last field has to be measured every time, because the first attempt at
it was wrong.** The original comment on the egress proxy claimed five tests for
_both_ guards. That was true of `assertAllowed` and false of the pinning lookup,
where the real figure in that file was **one** — and repo-13's gate caught it by
isolating each guard rather than trusting the sentence. Worse, the single test
then covering it was not the one named for the job: `egress-proxy.test.ts`'s
"a name that rebinds after the pre-flight check is refused at connect" asserted
only a `502`, which a socket dying on its own also produces, so it passed with
the guard disabled. It was strengthened to assert the refusal in the log, which
is what raised that file's figure from 1 to 2.

The lesson is not "count carefully". It is that **a claim about what a test
proves decays exactly like the code it describes**, so the number in rule 2 is
worth re-measuring whenever the comment is touched — by breaking each guard
separately and watching which tests notice. A guard covered only by a test that
cannot fail is the case this whole record exists to prevent, and it was found
inside the first excuse written under it.

### The experiment, and what it settled

_The four paragraphs immediately below are the 2026-09-01 statement of the open
question, kept as written because the question they pose is the one
[repo-16](../work/repo-16-suppression-does-not-dismiss.md) answered. **They are
superseded by "What the merge showed" at the end of this subsection and are not
this record's current position.**_

**Whether GitHub honours the comment natively is still unverified, and the
pull-request check cannot answer it.** #126 was expected to settle it and did
not. Its `CodeQL` check was green, but every line it added was comment: the
flagged `http.request` call is unmodified context, so the alert may never have
been attributed to that diff at all — which is also why #124, a pull request
touching no code, was green while the alert sat open on `main`. **A green check
is consistent with both "suppression honoured" and "never attributed", and
proves neither.** Reading the security tab does not settle it either: the alert
is expected to read `Open` there while the only copy of the comment sits on an
unmerged branch, so `Open` is what both readings predict.

**The experiment that does settle it is the merge, and there is now a control
for it.** `js/missing-rate-limiting` was `Open` on `main` and **closed when
`dl-23` merged its fix** (relayed 2026-09-01). That is the pipeline working end
to end: a change landing on `main` is re-analysed and its alert is retired. So
the same mechanism applies to this record's own suppression, with two outcomes
and no third:

- **The alert closes** — suppression comments are honoured, and rules 1–4 stand
  as written.
- **It stays `Open`** — they are not honoured natively, and the follow-up is the
  `advanced-security/dismiss-alerts` action, which converts SARIF suppression
  data into real dismissals. ~~That is a change to `security.yml`, to be taken on
  its own evidence rather than pre-empted here.~~ _(Struck 2026-09-07: the
  evidence arrived and the change was made. See below. The diagnosis in this
  bullet — "not honoured natively" — is itself narrowed there.)_

Either way the comment keeps its documentation value, which is why this record
does not depend on the answer.

**The experiment is now running, and nobody needs to do anything to start it.**
#126 merged on 2026-09-01 as `94206d9`, so the suppression comment is on `main`
and the `security` workflow's push analysis has already re-read it. **The next
person to open the security tab settles this by reading one line**, and should
record the outcome in the two bullets above. Until then it is the last unverified
claim in this document.

One piece of evidence favours "honoured": `dl-27` is recorded as having reopened
this alert on 2026-08-30 without touching the flagged line either, only shifting
the lines below it — and if a shift alone reattributes, this diff should have
been reattributed too. That history is screenshot-relayed and unverified, so it
is evidence rather than an answer.

#### What the merge showed — 2026-09-07

**The outcome was the second bullet: `js/request-forgery` stayed `Open` after
`94206d9` put the comment on `main`.** Read from the security tab by the repo
owner on 2026-09-01 and **relayed**; not verified in the development container,
where `gh api` is denied and there is no other route to the code-scanning API.
Everything downstream of this paragraph rests on that one relayed reading.

**The diagnosis the outcome was first given is not the only one, and it is not
the best-supported one.** "Not honoured natively" assumes a suppression reached
GitHub and was ignored. Measured on 2026-09-07 against `github/codeql`
(`4239fee`) and `github/codeql-action` (`cdf488f`, the `v4` tag), **no suppression
was ever in the SARIF**:

- `javascript/ql/src/AlertSuppression.ql` is `@kind alert-suppression`.
- `misc/suite-helpers/security-extended-selectors.yml` — the selector behind
  `queries: security-extended` — includes only kinds `problem`, `path-problem`,
  `diagnostic` and `metric`. It never selects that query.
- `github/codeql-action`'s bundle passes five `--sarif-*` flags to the CLI
  (`--sarif-add-baseline-file-info`, `--sarif-category`,
  `--sarif-group-rules-by-pack`, `--sarif-include-diagnostics`,
  `--sarif-merge-runs-from-equal-category`) and none of them concerns
  suppressions.

**Both diagnoses predict `Open`, and this repo cannot distinguish them**, which
is the same trap the paragraphs above fell into with the green check. Whether
GitHub would act on a `suppressions[]` entry natively, had one been produced, is
**not established from here** — the workflow change is not evidence that it would
not.

**The decision is unaffected, because both diagnoses want the same two steps.**
Run the alert-suppression query so a suppression exists, and run `dismiss-alerts`
so something acts on it whatever GitHub does. Both landed in `security.yml` on
2026-09-07; see "Register and mechanism are two jobs".

**What is still unverified, and it is the load-bearing part.** Nobody has yet
observed this working. The dismissal step runs only on a push to `main`, so the
first evidence is the security tab after this change merges: the alert reading
_dismissed_ with the comment `Suppressed via SARIF`, rather than `Open`. Until
somebody records that, this record describes a mechanism that has been built and
not seen to run.

**Nothing enforces the five fields.** A suppression comment with no reasoning and
no named test would pass every gate this repo has. That is a real gap, and the
repo already has the shape that would close it —
`packages/core/test/spawn-safety.test.ts` and `image-closure.test.ts` are source
scans policing exactly this kind of convention. It was left out deliberately
rather than forgotten: there is one suppression in the repo today, and a scan
built for one instance is a guess about the second. Revisit it when a third
arrives, or sooner if one lands without its reasoning.

**`js/missing-rate-limiting` on `routes/files.ts` is not excused, and never
should have been a candidate.** It was a **true positive**, correctly fixed:
`dl-23` metered the route on 2026-08-31, and the alert **closed on merge**
(security tab, read 2026-09-01, relayed). So CodeQL did read the
`{ onRequest: rateLimit }` sibling options object after all — the query has no
blind spot on Fastify's route options, and the "query limitation" this repo
believed in for a week did not exist.

**That failure of ours is what fixes the scope of this record.** This policy
governs findings that are **structurally permanent** — where no shape the code
could take would stop the query firing, as with a forward proxy whose whole
purpose is to fetch a URL a user chose. A query limitation is not such a finding,
because it resolves itself: either the code changes and the alert closes, or the
query improves and it closes. **Reaching for a suppression comment because a
query looks wrong is the failure mode this paragraph exists to prevent.** Fix the
code, or wait; do not excuse it. The test is not "is this alert wrong today", it
is "will this alert be wrong for every version of this code".
