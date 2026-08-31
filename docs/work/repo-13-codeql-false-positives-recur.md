---
id: repo-13
tool: repo
title: A CodeQL false positive comes back every time its file moves, and dismissal does not hold
kind: chore
status: ready
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
(`ec1dd6b`), the alert's location moved, and it is open again on the same code,
for the same reason, with the same answer.

The second alert is arriving at the same place by a different road.
`js/missing-rate-limiting` on `tools/downloader/api/src/routes/files.ts` was a
**true** positive when it was filed — it is what produced `dl-23`. Once `dl-23`
lands, the hook exists and the alert becomes wrong, because the query reads the
handler body and not the sibling options object one line above it. Nothing about
that is a mistake anyone made; it is the limit of the query. But from that day it
is a permanent false `high` on a route that is, in fact, metered.

And it is not free. On PR #123 — the branch that _fixes_ the thing the alert
complains about — the merge state is `UNSTABLE` and the single failing check is
`CodeQL`. Every one of that branch's ten other checks passes, the `security`
workflow's own `codeql` job included.

So the question this ticket exists to settle is not "are these two alerts
wrong". They are, and the evidence is below. It is: **what does this repo do with
a finding it has looked at and rejected, such that the next reader can tell it
apart from one nobody has looked at yet?** Today there is no answer anywhere —
`docs/` contains no CodeQL triage record at all, and the 2026-08-23 triage
survives only as four lines inside one downloader ticket's Log.

## Build

**Nothing here is a code fix.** Both flagged designs are correct as they stand;
the deliverable is a policy plus whatever mechanism carries it.

### 1. Confirm both alerts are still wrong, at the tip you are on

Do not take the citations in this ticket on faith — they were pinned at
`origin/main@1d2647b` and at `origin/dl-23-meter-download-route`, and both files
have moved before. Re-resolve each before you decide anything.

**`js/missing-rate-limiting` — `tools/downloader/api/src/routes/files.ts`.** The
alert says the handler performs a file system access and is not rate-limited.
After `dl-23` merges it is: the route registration attaches
`{ onRequest: rateLimit }` as its options argument, one line above the handler
body where the alert's range begins, and the hook is built by
`createRateLimitHook` exactly as `routes/jobs.ts` and `routes/probe.ts` build
theirs. It is proven end to end by the `describe("the download route")` block in
`tools/downloader/api/test/rate-limit.test.ts`, whose first test drives a real
`createApp` harness to a 429 carrying `Retry-After`.

**`js/request-forgery` — `tools/downloader/api/src/egress-proxy.ts`.** The alert
says the request URL depends on user input. It does, and that is the entire
purpose of the file: it is a forward proxy. Two guards stand behind that, and
both matter to the argument:

- `await guard.assertAllowed(target)` runs before the request is constructed; a
  refusal is a `403` and a `BLOCKED_TARGET` log line.
- `connectOptions` is `{ lookup }` when there is no upstream proxy, where
  `lookup = createPinningLookup(guard, options.resolve ?? systemResolve)`, and it
  is spread into that same `http.request` call. `createPinningLookup` in
  `dispatcher.ts` checks **every** resolved record for a blocked address and only
  then filters by address family — the comment there says why, and it is the
  multi-record rebinding case.

Say in the Log **which of the two `connectOptions` arms you checked**. When an
upstream proxy is configured the arm is `{}` and there is no pinning lookup,
because the socket goes to the proxy rather than to the target and the target
travels as `path`; `guard.assertAllowed` still ran. If you conclude that arm is
not covered, that is a defect and a downloader ticket, not a suppression.

Coverage to check rather than assume: `egress-proxy.test.ts`,
`dispatcher.test.ts`, `proxied-https.test.ts`, `two-origin-tls.test.ts` and
`tiers-behind-the-proxy.test.ts` all exercise this path. The rebinding case is
the test named "a name that rebinds after the pre-flight check is refused at
connect".

### 2. Establish what actually fails the check, because it decides which options are real

The `security` workflow and the check that fails are **not the same thing**, and
conflating them will send you to edit the wrong file. On PR #123, `gh pr checks
123` lists a passing `codeql` job belonging to `workflowName: security`, and
separately a failing check run named `CodeQL` with an **empty** `workflowName` —
that is GitHub's code-scanning results check, generated from the uploaded SARIF
rather than by a job in this repo.

It also appears to fail only on alerts within the pull request's own diff: #121
and #122 were both `CLEAN` at the time of filing, and neither touches
`egress-proxy.ts` or `routes/files.ts`, while #123 touches `routes/files.ts` and
fails. **Verify that before relying on it** — if it holds, the cost of both
alerts is "blocks the next pull request that edits either file", not "blocks
everything", and it explains why the egress-proxy alert being open on `main`
right now is not stopping anyone.

### 3. Decide the policy, from at least these four

Each survives refactoring differently and each fails differently. Pick one, or
one per alert if they genuinely differ — but say so explicitly rather than
letting it happen.

1. **Dismiss each recurrence by hand.** Zero configuration, and it keeps a human
   in front of every finding. Costs a full triage every time either file is
   refactored; the egress-proxy alert has already cost that once. The dismissal
   reason is a free-text box on GitHub, which is not in version control and is
   not visible to anyone reading the code.
2. **Inline `// codeql[js/...]` suppression comments.** Lives with the code,
   moves with it, is reviewed with it, and is readable by someone who has never
   opened the security tab. The real cost is that it also masks a **genuine**
   regression: if someone deleted the `onRequest` hook from the file route, the
   suppression would hide the true alert that should follow. Note what does still
   protect that — the `describe("the download route")` tests in
   `rate-limit.test.ts` go red without the hook, and they run on every push
   through `ci.yml`. Confirm that claim by deleting the hook locally and watching
   the suite fail; do not assert it from reading.
3. **A path-scoped query filter in `security.yml`.** It already sets `queries:
security-extended`, so a filter is a config-level neighbour of something that
   is already there, it is in version control, and it survives any refactoring
   inside the named path. It is the coarsest of the four — it excuses a whole
   query for a whole path, including code not yet written — and it lives a long
   way from the thing it is excusing.
4. **Raise the code-scanning check's failure threshold in repository settings.**
   Mentioned for completeness and probably wrong: it is not in version control,
   it is invisible from the repo, and it would silence real `high` findings
   everywhere to quiet two known ones. **Not verifiable from inside this
   container** — reading or changing it needs the settings UI or `gh api`, which
   `.claude/settings.json` denies.

### 4. Answer the question that outlives whichever option wins

**How does a reader in three months tell an excused false positive from one
nobody looked at?** Whatever is chosen must leave a durable, in-repo record
carrying the alert's query id, the file, the date, the reasoning, and the test
that would catch the corresponding true positive if the design regressed.

Where it goes is part of the decision, and the choice is narrow on purpose. A
comment beside `queries:` in `security.yml` is a candidate; so is a section in
that workflow's header, which already explains at length why CodeQL fits this
codebase. **A new top-level document is not** — `docs/` is repo-wide only, and a
page describing two files inside one tool is where the split starts to rot.
Follow the rule in `CLAUDE.md`: narrowest home that fits.

### 5. Say what happens to the next one

The triage that produced these two also produced `dl-24` from a real finding and
dismissed a `startsWith` inside a test double. Whatever you write must make it
obvious what to do with alert five, without reconstructing this ticket.

## Done when

1. Both alerts are re-verified as false positives at the tip of `main`, with the
   file and line of each guard recorded in the Log — including which
   `connectOptions` arm was checked and what that arm relies on.
2. One of the four options in Build step 3 is chosen and implemented, with the
   rejected ones named in the Log alongside the cost that ruled each out.
3. If suppression comments are chosen: the claim that `rate-limit.test.ts`
   catches a removed `onRequest` hook is proven by removing it and recording the
   failing test name, not asserted.
4. An in-repo record exists carrying, for each excused alert, its query id, its
   file, the date, the reasoning, and the test that would catch the true positive
   — and Build step 4's question is answered by it in a form the next reader can
   apply to an alert this ticket never saw.
5. A pull request touching `tools/downloader/api/src/routes/files.ts` no longer
   fails the `CodeQL` check run, confirmed on a real pull request with
   `gh pr checks` rather than reasoned about.
6. `npm run check` passes, and `npm run format` has been run if any `.md`
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

  Everything else checked out. `guard.assertAllowed(target)` at
  `egress-proxy.ts:345` precedes the request at `:357`; `connectOptions` at
  `:239` is `{ lookup }` from `createPinningLookup` at `:236`;
  `dispatcher.ts:133` does check every record before filtering by family, with
  the comment at `:164` naming multi-record rebinding as the reason. `dl-23`'s
  Log does record the 2026-08-23 triage and the two dismissals, and `dl-27`
  (`ec1dd6b`, 2026-08-30) did move `egress-proxy.ts`, which is the recurrence.

  Also noted while looking: `docs/` contains no CodeQL triage record of any kind
  — the 2026-08-23 triage exists only inside `dl-23`'s Log — which is the gap
  Build step 4 is really about.

  No implementation attempted; this is a filing and the decision in Build step 3
  is deliberately left open.

## The gate on this filing

Not gated by a reviewer. `## Review` is left empty per `docs/01-TICKETS.md`: a
pull request that only files a ticket has no work to check, and a gate record in
that section would make an unstarted ticket trip `repo-12`'s
`reviewed-but-ready` board check.

What the filing branch ran, on `repo-13-codeql-false-positives` off
`origin/main@1d2647b`:

- `npm run check` — pass.
- `npm run status -- --show repo-13` — renders, showing `blocked by dl-23`.
- `npm run status -- --json` — exit 0, no dangling dependency and no
  `reviewed-but-ready` warning.
- No test suite run: the diff is one new `.md` file and touches no code.
