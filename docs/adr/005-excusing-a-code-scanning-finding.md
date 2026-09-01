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
was dismissed as a false positive on 2026-08-23. `dl-27` edited
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
line above the alert.**

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

**Raise the check's failure severity in repository settings.** Not in version
control, invisible from a checkout, and global: it would silence real `high`
findings everywhere to quiet one known-wrong finding in one file. Rejected on
sight.

**A register document under `docs/`.** Rejected for the reason in rule 4, and
for a second: a page describing two files inside one tool is where the root
`docs/` spine starts to fuse with a tool's, which [001](./001-per-tool-docs-and-tickets.md)
exists to prevent. The policy is repo-wide and belongs here; the entries are
about specific lines and belong on them.

## Consequences

**A reader of the code learns what a reader of the security tab used to have to
infer.** The comment is reviewed with the diff that moves it, which is the
property every rejected alternative lacked.

**Suppression does not weaken the guarantee, because the comment was never the
guarantee.** Rule 3 makes that explicit and it is measured, not asserted:
removing both `guard.assertAllowed` calls from `egress-proxy.ts` fails five tests
in `egress-proxy.test.ts`, and — for the alert this record deliberately does not
excuse — deleting the `onRequest` hook from `routes/files.ts` fails five in
`rate-limit.test.ts`. Both suites run on every push. The risk that a suppression
hides a genuine regression is the reason rule 3 exists, and it is answered by the
suites rather than by care.

**Whether GitHub honours the comment natively is unverified, and the first pull
request under this record is the experiment.** CodeQL records the suppression in
its SARIF; whether code scanning then dismisses the alert, or merely reports it
as suppressed and leaves the check red, could not be determined from a
development container, where `gh api` is denied. If the check stays red, the
supported follow-up is the `advanced-security/dismiss-alerts` action, which
converts SARIF suppression data into real dismissals — a change to
`security.yml`, and a decision to take on its own evidence rather than to
pre-empt here. **The documentation value of the comment holds either way**, which
is why this record does not depend on the answer.

**Nothing enforces the five fields.** A suppression comment with no reasoning and
no named test would pass every gate this repo has. That is a real gap, and the
repo already has the shape that would close it —
`packages/core/test/spawn-safety.test.ts` and `image-closure.test.ts` are source
scans policing exactly this kind of convention. It was left out deliberately
rather than forgotten: there is one suppression in the repo today, and a scan
built for one instance is a guess about the second. Revisit it when a third
arrives, or sooner if one lands without its reasoning.

**`js/missing-rate-limiting` on `routes/files.ts` is deliberately not excused.**
`dl-23` metered that route on 2026-08-31, so if the alert closed it was never a
false positive and there is nothing to suppress. Reading the alert list is what
settles it, and that needs `gh api` or the security tab. Until somebody looks,
excusing it would violate rule 3's spirit — excusing an alert nobody has
confirmed is still open.
