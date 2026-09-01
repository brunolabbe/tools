---
id: repo-13
tool: repo
title: A CodeQL false positive comes back every time its file moves, and dismissal does not hold
kind: chore
status: in-flight
milestone: null
depends_on: [dl-23]
---

# repo-13 — Dismissing a CodeQL alert binds to the alert, not to the reason

## Why

`.github/workflows/security.yml` runs CodeQL with `queries: security-extended`
on every push to `main`, every pull request, and weekly. It has no way to record
that a finding was looked at and found wrong. The only lever GitHub offers is
dismissing an alert, and **a dismissal binds to an alert instance, not to the
pattern that produced it** — so when the code moves, the alert comes back and
somebody triages it again from zero.

This is not hypothetical; the repo has already paid twice.

`js/request-forgery` on the egress proxy was **dismissed as a false positive on
2026-08-23**, during the triage recorded in
[dl-23's Log](../../tools/downloader/docs/work/dl-23-rate-limit-the-download-route.md).
Then `dl-27` edited `tools/downloader/api/src/egress-proxy.ts` on 2026-08-30
(`ec1dd6b`), the alert's location moved, and it came back on the same code, for
the same reason, with the same answer.

`js/missing-rate-limiting` on `tools/downloader/api/src/routes/files.ts` arrived
at the same place by a different road. It was a **true** positive when it was
filed — it is what produced `dl-23`. `dl-23` merged on 2026-08-31 (`6f29eb0`)
and the route is now metered, so from that commit the alert is either closed or
permanently wrong. Which of the two is the **open input** this ticket cannot
resolve from inside the container; see the Log.

So the question is not "are these two alerts wrong". The evidence below says
they are. It is: **what does this repo do with a finding it has looked at and
rejected, such that the next reader can tell it apart from one nobody has looked
at yet?** Today there is no answer anywhere — `docs/` contains no CodeQL triage
record of any kind, and the 2026-08-23 triage survives only as four lines inside
one downloader ticket's Log, which is precisely the failure this ticket exists
to stop repeating.

## Build

**Nothing here is a code fix.** Both flagged designs are correct as they stand;
the deliverable is a policy plus whatever mechanism carries it.

### 1. Re-verify both alerts at the tip — settled 2026-08-31 at `6f29eb0`

Done, with the citations re-resolved and two masking claims measured rather than
reasoned about. The evidence is in the Log and the guard-by-guard detail is in
the triage record below. **Re-resolve it again before acting** if `main` has
moved; both files have moved twice already.

The one open question this step was told to take seriously — whether the
upstream-proxy arm of `connectOptions`, the `{}` arm with no pinning lookup, is
genuinely uncovered — **is answered, and it is not a defect.** Reasoning in the
triage record. No downloader ticket is owed.

### 2. Establish what actually fails the check — settled 2026-08-31

Done. The `security` workflow and the failing check are **not the same thing**,
and conflating them sends you to edit a file that is working. Detail and the four
data points are in the Log.

### 3. Decide the policy — **OPEN, and deliberately not settled here**

This is a policy change about how the repo excuses a security finding, and a
wrong answer fails silently: an over-broad exclusion hides a real alert and
nobody notices, because the signal it removes is the one nobody was going to see
anyway. It belongs to whoever owns the repo's security posture, not to the agent
that happened to be in the file.

The four options, with the costs that are now measured rather than guessed:

1. **Dismiss each recurrence by hand.** Zero configuration, and it is the only
   option that keeps a human in front of every finding. Costs a full triage every
   time either file is refactored — measured: the check goes red on any pull
   request whose diff moves the alert, and stays red until someone dismisses it.
   Already failed once, on the egress proxy, between 2026-08-23 and 2026-08-30.
   The dismissal reason is a free-text box on GitHub: not in version control, not
   visible to anyone reading the code, and absent from the diff entirely.
2. **Inline `// codeql[js/...]` suppression comments.** Lives with the code,
   moves with it, is reviewed with it, and is legible to someone who has never
   opened the security tab. Its stated cost — that it would also mask a genuine
   regression — **is measured and largely answered**: the tests catch the
   regression that the suppression would hide, in both files, and they run on
   every push. Numbers in the Log. **Unverified and blocking: whether inline
   suppression is actually honoured by this repo's CodeQL setup.** Confirming it
   requires reading the alert list, which cannot be done from the container.
3. **A path-scoped query filter in `security.yml`.** Config-level, in version
   control, and it survives any refactoring inside the named path. **This option
   may not exist in the form the brief imagines** — see the Log. A CodeQL config
   file's `query-filters` selects queries by _metadata_ (`id`, `tags`,
   `severity`), with no path key, while `paths-ignore` excludes files from
   analysis for _every_ query. So the achievable variants are "this query off
   everywhere" or "all queries off for this file", both materially coarser than
   "this query off for this file". **Verify this before choosing option 3**; it
   is the single fact that most changes the answer.
4. **Raise the code-scanning check's failure threshold in repository settings.**
   Listed for completeness and almost certainly wrong: not in version control,
   invisible from the repo, and it would silence real `high` findings everywhere
   to quiet two known ones. **Not verifiable from inside this container** —
   reading or changing it needs the settings UI or `gh api`, which
   `.claude/settings.json` denies.

The two alerts are **not the same kind of thing**, and the answer may differ per
alert without that being an inconsistency:

- `js/request-forgery` on `egress-proxy.ts` is a **structural, permanent** false
  positive. The file is a forward proxy; its entire purpose is to make a request
  to a URL a user supplied. No code shape will ever stop this query firing there.
- `js/missing-rate-limiting` on `routes/files.ts` is a **query limitation**, not
  a design. It fires because the query reads the handler body and not the sibling
  options object one line above it. It is narrower, it may already be closed, and
  it is the sort of thing that gets fixed upstream.

### 4. Give the triage record a durable home — blocked on step 3

The record's **content is written** and sits in the triage record below. Its
**home is not**, and this step cannot be finished without step 3, for a reason
worth stating plainly: **a ticket Log is not an acceptable home.** That is
exactly where the 2026-08-23 triage went, and its being there is why this ticket
exists. Leaving the record in `repo-13`'s Log and calling step 4 done would
reproduce the defect under a new id.

Whatever step 3 chooses must carry, per excused alert: the query id, the file,
the date, the reasoning, and **the test that would catch the corresponding true
positive if the design regressed**. That last field is what makes the record
auditable instead of reassuring.

Where it goes is part of the decision, and the choice is narrow on purpose. A
comment beside `queries:` in `security.yml` is a candidate; so is a section in
that workflow's header, which already explains at length why CodeQL fits this
codebase; so is a comment at the excused line itself. **A new top-level document
is not** — `docs/` is repo-wide only, and a page describing two files inside one
tool is where the split starts to rot. Follow the rule in `CLAUDE.md`: narrowest
home that fits.

### 5. Say what happens to the next one — criteria settled, home blocked on step 3

The triage that produced these two also produced `dl-24` from a real finding and
dismissed a `startsWith` inside a test double, so the next alert is not
hypothetical either. The **criteria** below are decision-independent and hold
whichever mechanism wins; only where they get written down waits on step 3.

For any new code-scanning alert, in order:

1. **Reproduce it against the tip before anything else.** Both of this ticket's
   alerts had citations that resolved on a branch and not on `main`, and one of
   them changed truth value mid-ticket. An alert is a claim about a commit.
2. **Decide true or false positive, and say which on the evidence.** If true, it
   is an ordinary ticket in the owning tool's `work/` — that is `dl-23` and
   `dl-24`, and it is the common case, not the exception.
3. **If false, name the test that would go red if the design regressed.** If no
   such test exists, that is the finding: write the test, and do not excuse the
   alert until it exists. An excused alert with nothing behind it is worse than
   an open one, because it looks handled.
4. **Record it wherever step 3 decides, with all five fields.** A dismissal with
   no in-repo trace is not a decision, it is a disappearance.
5. **A test double is not production code.** The `startsWith` dismissed on
   2026-08-23 was in a test fixture. Say so in the record rather than arguing the
   code is safe; the reason is the category, not the logic.

## The triage record, pending a home

The content step 4 owes, written now because it is decision-independent.
**Placement is still open** — see Build steps 3 and 4. Verified at `6f29eb0`.

### `js/request-forgery` — `tools/downloader/api/src/egress-proxy.ts`

|              |                                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| **Query**    | `js/request-forgery`                                                              |
| **Verdict**  | False positive, structural and permanent                                          |
| **Verified** | 2026-08-31 at `6f29eb0`                                                           |
| **History**  | Dismissed 2026-08-23; reopened when `dl-27` (`ec1dd6b`) moved the file 2026-08-30 |

The alert says the request URL depends on user input. It does, and that is the
file's purpose: it is a forward proxy. Two guards stand behind it.

- `await guard.assertAllowed(target)` at `egress-proxy.ts:345` precedes the
  `http.request` at `:357`; the CONNECT path has its own at `:398` before the
  `net.connect` at `:407`. A refusal is a `403` and a `BLOCKED_TARGET`.
- `connectOptions` at `:239` is `{ lookup }`, where `lookup` at `:236` is
  `createPinningLookup(guard, options.resolve ?? systemResolve)`, spread into
  both the `http.request` at `:357` and the `net.connect` at `:407`.
  `createPinningLookup` at `dispatcher.ts:133` checks **every** resolved record
  against `isBlockedAddress` at `:157` and only then filters by address family at
  `:168`; the comment at `:164` names multi-record rebinding as the reason for
  that order.

**The `{}` arm is deliberate, not a gap.** When an upstream proxy is configured,
`connectOptions` is `{}` and there is no pinning lookup. This is documented in
place at `:237-238` — "in chained mode the upstream resolves the target, so
there is no local resolution to pin — the same trade dl-8 documents for
`PROXY_URL`" — and it is safe for three reasons that hold together:
`guard.assertAllowed` still runs unconditionally at `:345` and `:398`; the socket
is aimed at `upstream.hostname` from `PROXY_URL` (`config.ts:339`), which is
operator configuration and not user input; and the residual — the upstream doing
its own resolution — is the operator's egress policy, which is the trade `dl-8`
records. Covered by `egress-proxy.test.ts` (three chained cases from `:496`) and
`proxied-https.test.ts:628`.

**Test that catches the regression:** `egress-proxy.test.ts`. Removing both
`guard.assertAllowed` calls fails 5 tests — "a segment URI that never reached a
ProbeResult is refused", "a redirect hop gets its own check", "a policy refusal
names the rule, not an internal error", "a blocked plain-HTTP fetch never reaches
the origin", "a POST to a blocked target never reaches it". Measured, not
assumed. Rebinding specifically is `egress-proxy.test.ts:234`, "a name that
rebinds after the pre-flight check is refused at connect".

### `js/missing-rate-limiting` — `tools/downloader/api/src/routes/files.ts`

|              |                                                                         |
| ------------ | ----------------------------------------------------------------------- |
| **Query**    | `js/missing-rate-limiting`                                              |
| **Verdict**  | True positive until `6f29eb0`; false from that commit **if still open** |
| **Verified** | 2026-08-31 at `6f29eb0`                                                 |
| **History**  | Filed as `dl-23` on 2026-08-23; fixed and merged 2026-08-31 (#123)      |

The alert says the handler performs a file system access and is not rate-limited.
Since `dl-23` it is limited: `files.ts:119` passes `{ onRequest: rateLimit }` as
the route's options argument, one line above the handler body at `:120` where
the alert's range begins. The hook is built at `:110` by `createRateLimitHook`,
keyed by `fileBucketKey` at `:97`, exactly as `routes/jobs.ts` and
`routes/probe.ts` build theirs. If the alert is still open, the cause is that the
query reads the handler body and not its sibling options object.

**Test that catches the regression:** `rate-limit.test.ts`. Deleting line 119
fails 5 tests — "refuses with a 429 and a Retry-After once the bucket is empty",
"a refusal carries none of the route's own headers", "one exhausted link does not
spend another link's allowance", "a token that is not even well formed cannot
mint itself a bucket", "the bucket key never contains the token itself".
Measured, not assumed.

**This entry is conditional.** If the alert closed when `dl-23` merged, it was
never a false positive and it should be struck from the record rather than
excused — see the Log.

## Done when

1. ~~Both alerts re-verified as false positives at the tip, with the file and
   line of each guard recorded, including which `connectOptions` arm was checked
   and what it relies on.~~ **Done 2026-08-31 at `6f29eb0`.**
2. ~~What fails the check is established: which check run, and whether it is
   scoped to the pull request's diff.~~ **Done 2026-08-31.**
3. Whether `js/missing-rate-limiting` closed when `dl-23` merged is supplied by
   someone who can read the alert list, and the triage record's second entry is
   either struck or kept on that answer.
4. Before option 3 can be chosen: whether a CodeQL query filter can be scoped to
   a path at all is confirmed against the CodeQL action's configuration schema,
   not from memory.
5. Before option 2 can be chosen: whether inline `// codeql[...]` suppression is
   honoured by this repo's setup is confirmed on a real pull request.
6. One of the four options is chosen **by the repo's owner**, with the rejected
   ones named alongside the cost that ruled each out.
7. The triage record has a durable in-repo home that is not a ticket Log,
   carrying all five fields per excused alert, and Build step 5's criteria are
   written down somewhere a reader of an unfamiliar alert will find them.
8. A pull request touching either file no longer fails the `CodeQL` check run,
   confirmed on a real pull request with `gh pr checks` rather than reasoned
   about.
9. `npm run check` passes, and `npm run format` has been run if any `.md`
   changed.

## Log

- **2026-08-31** — Filed. The two code claims in the brief were reproduced
  against `origin/main@1d2647b` before filing rather than transcribed; the alert
  numbers, severities and alert text are **relayed from screenshots and were not
  verified**, because `gh api` is denied by `.claude/settings.json` and there is
  no other route to the code-scanning API from here. Four things the framing this
  ticket was filed from had wrong, all found by checking:

  - **`js/missing-rate-limiting` is a true positive on `main` today, not a false
    one.** `routes/files.ts` at `1d2647b` is 134 lines and contains no occurrence
    of `rateLimit` at all; the route registers as
    `app.get<...>(ROUTES.file(":token"), async (request, reply) => {` with no
    options argument. `dl-23` is still `status: ready` and its fix is unmerged on
    PR #123. The cited `files.ts:119` and `rate-limit.test.ts:465` resolve
    exactly as described, but on `origin/dl-23-meter-download-route`, not on
    `main` — on `main` `rate-limit.test.ts` is 368 lines and has no download-route
    block. This alert becomes a false positive **when #123 merges**, which is why
    this ticket carries `depends_on: [dl-23]` rather than an empty list.
  - **The failing check is not the `security` workflow.** Every workflow run on
    the `dl-23` branch is `success`, `codeql` included. `gh pr checks 123` shows
    the sole failure is a check run named `CodeQL` with an empty `workflowName`
    — the code-scanning results check, built from uploaded SARIF. The claim that
    #123 is `UNSTABLE` solely because of this alert's check does hold, but the
    thing to edit is not the job that passes.
  - **The check appears to fire only on alerts in the pull request's own diff.**
    #121 and #122 were `CLEAN`; neither touches `egress-proxy.ts` or
    `routes/files.ts`. That is why the egress-proxy alert, open on `main`, is
    blocking nothing at the moment. Recorded as an observation to verify in Build
    step 2, not as established fact — three data points is a pattern, not a
    proof.
  - **`egress-proxy.test.ts:230-231` is not the rebinding test.** Those lines end
    a test asserting the guard passes `public.test` and refuses `internal.test`,
    which is a guard test. The rebinding test — guard told public, resolver
    answers loopback — begins at line 234.

  Everything else checked out. Also noted while looking: `docs/` contains no
  CodeQL triage record of any kind — the 2026-08-23 triage exists only inside
  `dl-23`'s Log — which is the gap Build step 4 is really about.

  No implementation attempted; this is a filing and the decision in Build step 3
  is deliberately left open.

- **2026-08-31, later** — Build steps 1, 2 and 5 completed and step 4's content
  written; step 3 left open on purpose. Merged `origin/main` (`1d2647b` →
  `6f29eb0`, picking up pl-36, dl-16 and dl-23) first, because step 1 is about
  the tip and the tip had moved in the way that matters most.

  **The correction I filed this ticket with has itself expired, which is the
  point of step 1.** `dl-23` merged, and `routes/files.ts:119` on `main` now
  reads `{ onRequest: rateLimit },`. When this was filed, that line did not
  exist. `js/missing-rate-limiting` is therefore no longer a true positive on
  `main`; it is either closed or permanently wrong, and the two need different
  handling. `dl-23` is `status: done`, so `depends_on: [dl-23]` is satisfied.

  **The upstream-proxy arm is not a defect, and no downloader ticket is owed.**
  This was the outcome step 1 was told to stop for. The `{}` arm at
  `egress-proxy.ts:239` is documented in place at `:237-238` and cross-referenced
  to `dl-8`, whose Why paragraph does record the `PROXY_URL` trade. It is safe on
  three legs, not one: `guard.assertAllowed` runs unconditionally at `:345` and
  `:398` regardless of the arm; the socket is aimed at `upstream.hostname`
  derived from `PROXY_URL` at `config.ts:339`, which is operator configuration
  and never user input; and chained mode is covered by three cases in
  `egress-proxy.test.ts` from `:496` plus `proxied-https.test.ts:628`. The
  residual is the upstream's own resolution, which is the operator's egress
  policy and the trade `dl-8` took knowingly.

  **Both "the tests would catch a real regression" claims are now measured, not
  reasoned.** Done-when 3 asked for this only if suppression comments were
  chosen; it was worth spending up front, because it is the measurement option
  2's cost turns on and the recommendation would otherwise be a guess. Deleting
  `files.ts:119` fails 5 tests in `rate-limit.test.ts`; replacing both
  `guard.assertAllowed` calls with a comment fails 5 tests in
  `egress-proxy.test.ts`. Names are in the triage record. Both files were
  restored and the working tree confirmed clean before continuing.

  **Step 2 is settled, with a positive control.** The failing check is the
  code-scanning results check run — named `CodeQL`, empty `workflowName`, built
  from uploaded SARIF — and not `security.yml`'s `codeql` job, which passes. It
  is scoped to alerts the pull request's own diff introduces or relocates, on
  four data points now: #123 touched `routes/files.ts` and failed; #121 and #122
  touched neither file and passed; and **#124, this ticket's own filing, touches
  no code at all and its `CodeQL` check passes** while `js/request-forgery` is
  open on `main`. The last is the control the first three lacked. Consequence:
  an open false positive costs nothing until someone edits its file, and then it
  costs that pull request.

  **A finding that undercuts option 3, and it is the one the next round should
  settle first.** The brief and the dispatch both describe "a path-scoped query
  filter" as the config-level answer. I do not believe that shape exists: a
  CodeQL config file's `query-filters` selects queries by metadata — `id`,
  `tags`, `severity` — and has no path key, while `paths`/`paths-ignore` control
  which files are analysed at all, for every query. If that is right, option 3
  collapses into "`js/request-forgery` off everywhere" or "no analysis at all on
  `egress-proxy.ts`", both far coarser than advertised, and inline comments
  become the only mechanism that is both durable and narrow. **This is from
  knowledge and is not verified in this container** — `WebFetch` is blocked by
  the firewall and this session has no search tool — so it is written as
  Done-when 4 rather than as a conclusion. It is the single fact that most
  changes the answer, and it is cheap for someone with a browser.

  **What changes on the open input.** If `js/missing-rate-limiting` closed when
  `dl-23` merged, it was never a false positive: strike its entry from the triage
  record, narrow this ticket to `egress-proxy.ts` alone, and note in the record
  that the query does read a Fastify options object — which is useful to the next
  person reading a route alert. If it stayed open, the two entries stand, and the
  asymmetry in Build step 3 matters: the egress-proxy alert is structural and
  permanent while this one is a query limitation that may be fixed upstream, so a
  permanent config exclusion is a worse fit for it than for the proxy.

  Step 3 not settled, per dispatch. No source file was changed by this round; the
  two edits above were measurements and were reverted.

## The gate on this filing

Not gated by a reviewer. `## Review` is left empty per `docs/01-TICKETS.md`: a
pull request that only files a ticket has no work to check, and a gate record in
that section would make an unstarted ticket trip `repo-12`'s
`reviewed-but-ready` board check. This branch still changes no source file — the
policy in Build step 3 is unmade — so it remains a filing, and `## Review` waits
for the round that implements the mechanism.

What the branch ran, on `repo-13-codeql-false-positives`, after merging
`origin/main` at `6f29eb0`:

- `npm run build` — exit 0, run after the merge because the merge moved source.
- `npm run check` — pass.
- `npm test -- --project downloader` — pass, confirming both measurement edits
  were fully reverted.
- `npm run status -- --show repo-13` — renders, `depends on dl-23`, unblocked.
- `npm run status -- --json` — exit 0, no dangling dependency and no
  `reviewed-but-ready` warning.
- Two deliberate red runs, reverted: `npx vitest run tools/downloader/api/test/rate-limit.test.ts`
  with `files.ts:119` deleted (5 failed), and `npx vitest run tools/downloader/api/test/egress-proxy.test.ts`
  with both `guard.assertAllowed` calls removed (5 failed).
