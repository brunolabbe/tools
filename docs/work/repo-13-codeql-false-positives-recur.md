---
id: repo-13
tool: repo
title: A CodeQL false positive comes back every time its file moves, and dismissal does not hold
kind: chore
status: done
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

### 3. Decide the policy — settled 2026-09-01: inline suppression comments

**Chosen by the user: option 2, inline `// codeql[query-id]` comments**, on the
line _before_ the alert rather than at the end of it, because code scanning
hashes the alert's line contents and a trailing comment churns the alert it was
meant to settle.

**Option 3 was struck, because it does not exist.** The ticket costed "a
path-scoped query filter" as the config-level answer and it is not expressible:
`paths`/`paths-ignore` govern which files are analysed at all, for every query,
and `query-filters` select queries by metadata — `id`, `tags`, `severity` — with
no path key. See the Log.

The decision, the two surviving rejected options, and the reasoning are in
[adr/005](../adr/005-excusing-a-code-scanning-finding.md).

### 4. Give the triage record a durable home — settled 2026-09-01

**The home is two halves, and neither is a ticket Log.**

- **The policy** is [adr/005](../adr/005-excusing-a-code-scanning-finding.md).
  Root `docs/` is where a decision binding more than one tool goes, and
  `docs/00-TOOLS.md` already names "how CI is split" as ADR-worthy. It is indexed
  there beside the other four.
- **The register is the suppression comments themselves.** No list, no page to
  keep in sync: `grep -rn 'codeql\[' --include='*.ts' .` is every excused finding
  in the repo, with its reasoning in the lines above it. An alert with such a
  comment was examined; an alert without one was not — which is the answer to the
  question this ticket poses, and it cannot drift from the code because it is the
  code.

That second half is [adr/003](../adr/003-the-status-page-is-generated.md)'s
reasoning reused: a projection kept by hand needs a writer, and the writer here
is a person who will forget.

### 5. Say what happens to the next one — settled 2026-09-01

The five criteria are in
[adr/005](../adr/005-excusing-a-code-scanning-finding.md) under "Triaging a new
alert", in the same file as the rule, so a reader who finds one finds the other.
They are unchanged from the draft below: reproduce against the tip first; decide
true or false on the evidence, with true being an ordinary ticket in the owning
tool and the common case; if false, name the test that goes red on regression and
write it first if it does not exist; record with all five fields; and excuse a
test double by its category rather than by arguing its logic.

## The triage record, as it was drafted

Kept as the working evidence behind
[adr/005](../adr/005-excusing-a-code-scanning-finding.md). The `js/request-forgery`
half now lives at the excused line in `egress-proxy.ts`; the
`js/missing-rate-limiting` half is **deferred, not excused** — see the Log for
what would settle it. Verified at `6f29eb0`.

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
3. **Deferred, deliberately.** Whether `js/missing-rate-limiting` closed when
   `dl-23` merged still needs someone who can read the alert list. Its entry is
   kept and marked deferred rather than excused, because excusing an alert nobody
   has confirmed is still open would break adr/005's own rule 3.
4. ~~Whether a CodeQL query filter can be scoped to a path is confirmed against
   the action's configuration schema, not from memory.~~ **Done 2026-09-01: it
   cannot. Option 3 struck.**
5. ~~Whether inline `// codeql[...]` suppression is honoured by this repo's setup
   is confirmed on a real pull request.~~ **This branch is that pull request** —
   it edits `egress-proxy.ts`, so the alert lands in the diff and the `CodeQL`
   check answers it either way. The verdict belongs in the gate record, not here.
6. ~~One of the four options is chosen by the repo's owner, with the rejected
   ones named alongside the cost that ruled each out.~~ **Done 2026-09-01:
   inline comments, in [adr/005](../adr/005-excusing-a-code-scanning-finding.md)
   under "Alternatives considered".**
7. ~~The triage record has a durable in-repo home that is not a ticket Log,
   carrying all five fields per excused alert, and Build step 5's criteria are
   written down somewhere a reader of an unfamiliar alert will find them.~~
   **Done 2026-09-01: adr/005 for the rule and the criteria, the suppression
   comments themselves for the register.**
8. **Answered by this pull request's own `CodeQL` check**, which is the
   experiment rather than a claim. A red check is a result: it means suppression
   comments are not honoured natively and the follow-up is the
   `advanced-security/dismiss-alerts` action — a separate decision, named in
   adr/005 and not taken here.
9. ~~`npm run check` passes, and `npm run format` has been run if any `.md`
   changed.~~ **Done — see the gate record.**

## Review

**Gate: FAIL** — 2026-09-01 · `origin/main(7d56035)...196fd28` · defect hunt run
directly by the reviewer (no `Skill`/`Agent` tool in that role), to `medium` depth.
Sonnet reviewing an Opus build.

| Done when                                                        | Proof                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Both alerts re-verified at the tip, guard/line recorded       | proven — triage record (ticket:115-193); guard lines and `connectOptions` arm re-checked at `196fd28`, resolve exactly as cited            |
| 2. What fails the check established (scoped to diff)             | verified — `gh pr checks` on #121/#122/#124/#126 all consistent with "CodeQL results-check is diff-scoped, separate from the `codeql` job" |
| 3. `js/missing-rate-limiting` open/closed                        | correctly left **deferred** — `gh api` denied, ticket does not claim otherwise, no defect                                                  |
| 4. Path-scoped query filter confirmed not to exist               | not re-verified (caller: already settled against GitHub's docs)                                                                            |
| 5. Inline suppression honoured, confirmed on a real PR           | **contested, not proven** — see high/med findings below                                                                                    |
| 6. Option chosen by owner, rejected options costed               | proven — `docs/adr/005-excusing-a-code-scanning-finding.md:103-131`                                                                        |
| 7. Durable home, five fields, criteria discoverable              | proven — `docs/adr/005:52-82`; register command reproduced, returns exactly one line                                                       |
| 8. Answered by this PR's own `CodeQL` check                      | check ran and passed (`gh pr checks 126`), but what it answers is ambiguous — see med finding                                              |
| 9. `npm run check` passes, `npm run format` run if `.md` changed | verified — ran `npm run check` at `196fd28`: pass (lint, format, typecheck)                                                                |

- **high** · `tools/downloader/api/src/egress-proxy.ts:357-364` — the suppression
  comment claims "remove either [`guard.assertAllowed` or the pinning `lookup`] and
  `egress-proxy.test.ts` fails five tests." That is exactly true for
  `guard.assertAllowed`: removing both call sites (`:345`, `:406`) fails 5 tests,
  names matching the ticket exactly. It is **not** true for the pinning lookup under
  either natural interpretation. Deleting `lookup` from `connectOptions`
  (`egress-proxy.ts:239`) fails **6** tests, not 5 — one extra because `lookup` also
  carries the test harness's mocked DNS resolution, so this edit breaks legitimate
  "allowed" requests too. Isolating the guard itself — commenting out only the
  `isBlockedAddress` rejection inside `createPinningLookup` (`dispatcher.ts:153-158`)
  while leaving DNS resolution intact — fails only **1** test ("a rebind caught at
  connect stays a refusal, though it arrives as a socket error",
  `egress-proxy.test.ts:289`). The companion test at `egress-proxy.test.ts:234` ("a
  name that rebinds after the pre-flight check is refused at connect") **still passes
  with the guard disabled**, because its mock target (`127.0.0.1` with nothing
  listening) produces the same `502` whether the guard blocked it or the connection
  just failed on its own — it does not distinguish "blocked" from "let through and
  then failed". Notably `docs/adr/005`'s Consequences section (lines 139-146) is more
  careful and only claims "five" for `guard.assertAllowed` and for the `files.ts`
  `onRequest` hook; it never repeats the claim for the pinning lookup. The overclaim
  is specific to the shipped code comment, which is the artifact rule 4 designates as
  the register future readers will trust. Two remedies, not one fix: (a) narrow the
  comment's wording to what was measured, or (b) strengthen
  `egress-proxy.test.ts:234` to assert on the distinguishing signal (log message and
  error code, as `:289` does) rather than status code. Recommend (b) first since it
  closes the real gap; (a) is the minimum honest fix.
- **med** · `docs/work/repo-13-codeql-false-positives-recur.md:393-398` (also softer
  at `:210-211`) — the Log states the PR "either goes green because the suppression
  is honoured, or red because it is not." That is a false dichotomy.
  `git diff origin/main...196fd28 -- tools/downloader/api/src/egress-proxy.ts` shows
  the 8 new lines are all `+` comment and `const proxied = http.request(` carries no
  `+`/`-` prefix — unmodified context, not an added line. A third explanation the
  prose forecloses: the alert was never attributed to this PR's diff at all
  (structurally like #124's control). Which explanation holds could not be resolved —
  `gh api` is denied, so the SARIF/fingerprint match is unreadable. One relevant,
  double-edged data point: `dl-27` (`ec1dd6b`), the commit the ticket cites as having
  moved and reopened this alert, also never touched the `http.request` line — its
  hunks are in the CONNECT handler, comments and imports — it only shifted line
  numbers below its edits. If that shift alone caused reattribution once, the same
  mechanism plausibly reattributes here, which would favour "suppression honoured".
  But the ticket's own Log says that alert history is "relayed from screenshots and
  not verified", so the counter-evidence is itself unverified. A later reader seeing
  this check green and reading `:393-398` as written would reasonably conclude the
  mechanism is proven, when the branch's own diff makes that unsupported. Remedies:
  (a) soften `:393-398` and `:210-211` to name the third possibility explicitly, or
  (b) get the alert state read before declaring Done-when 5/8 settled. Recommend (a)
  now, since (b) is blocked in this container.
- **verified, no defect** · the `net.connect` restraint — only `http.request` was
  suppressed. Right call: `guard.assertAllowed` gates both paths unconditionally
  (`:345`/`:406`), so no functional gap results, and an unconfirmed suppression would
  corrupt rule 4's register. Whether any query fires on `net.connect` could not be
  independently confirmed (`gh api` denied); the premise is inherited from the
  earlier screenshot-based triage.
- **verified, no defect** · the comment is inert — `npm test -- --project downloader`
  at `196fd28`: 55 files, 845 tests passing; the source diff is exactly 8 added
  comment lines.
- **verified, no defect** · register argument — `grep -rn 'codeql\[' --include='*.ts' .`
  returns exactly one line, `egress-proxy.ts:364`, matching the ADR. The adr/003
  parallel is honestly drawn, reused for the same structural reason rather than
  borrowed for authority.
- **verified, no defect** · the known gap (nothing enforces the five fields) is
  reasonable to defer with a stated trigger, given there is one suppression today —
  consistent with this repo's "second consumer, not the first guess" philosophy.
- **verified, no defect** · ticket record shape — `status: done`, `## Review` pending
  this gate, `## The gate on this filing` kept as #124's separate record. Matches
  `docs/01-TICKETS.md:154-163`; `npm run status -- --json` exits 0 with no
  `reviewed-but-ready` problem.
- **findings** · defect hunt at medium, self-run, returned 2; 2 carried, 0 dropped.
- NFR: security — the high finding is a security-documentation defect (an inaccurate
  claim about a suppression's regression net), not a live vulnerability, since
  `guard.assertAllowed` still blocks unconditionally · performance n/a (comment-only
  diff) · reliability n/a · maintainability — both findings are trust-in-the-register
  concerns.

**Reproductions run**, all edits reverted and the worktree confirmed clean:
`npm run build` / `npm run check` / `npm test -- --project downloader` at `196fd28`
(845/845); removing both `guard.assertAllowed` calls → 5 failed, names matching;
removing `files.ts:119` → 5 failed, names matching; removing `lookup` from
`connectOptions` → 6 failed; disabling only `isBlockedAddress` inside
`createPinningLookup` → 1 failed; the register grep → one match;
`git show ec1dd6b -- egress-proxy.ts` → confirmed dl-27 never touched the
`http.request` line; `gh pr checks 126` → all pass including `CodeQL`.

**Could not verify**: the actual code-scanning SARIF/fingerprint match for this PR;
whether `js/missing-rate-limiting` is currently open or closed; whether any CodeQL
query fires on the `net.connect` call. All three need `gh api`, which is denied.

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

- **2026-09-01** — Built and closed. Fresh branch off `origin/main@7d56035`,
  because the filing (#124) had landed and the implementation is a different
  change with a different type: this one edits source, so `## Review` waits for a
  reviewer while `## The gate on this filing` below stays as the record of #124.

  **Option 3 does not exist, and that is the finding worth carrying forward.**
  The ticket costed "a path-scoped query filter in `security.yml`" as the
  config-level answer, and the previous round flagged it as probably
  inexpressible from knowledge without a way to check. Settled now: `paths` and
  `paths-ignore` govern which files are analysed at all, for **every** query,
  while `query-filters` select queries by metadata — `id`, `tags`, `severity` —
  with no path key. The two do not compose into "this query, this path". The
  consequence is not just that one option lost: **the only remaining mechanisms
  that survive a refactor are inline comments**, because everything else is
  either instance-bound (a dismissal) or repo-wide (a query filter, a settings
  threshold). The option that looked like the balanced middle was never on the
  table. Recorded at length in adr/005's alternatives so the next person does not
  re-propose it.

  **Decision: inline `// codeql[query-id]`, on the line above the alert.** Not
  the same line: code scanning identifies an alert partly by a hash of its line's
  contents, so a trailing comment churns the alert it was meant to settle. The
  comment sits at `egress-proxy.ts:364`, immediately above the `http.request` at
  `:365`, and carries the five fields adr/005 requires.

  **What made inline suppression defensible was the measurement, not the
  argument.** Its one real cost is that it would also mask a genuine regression,
  and the previous round measured that away: removing both `guard.assertAllowed`
  calls fails 5 tests in `egress-proxy.test.ts`, and deleting the `onRequest`
  hook fails 5 in `rate-limit.test.ts`. The tests are the guarantee; the comment
  only explains it. That asymmetry is rule 3 in adr/005 — no test, no excuse —
  and it is the rule that keeps this from being a way to silence things.

  **The record's home is two halves.**
  [adr/005](../adr/005-excusing-a-code-scanning-finding.md) holds the policy and
  the five triage criteria, indexed in `docs/00-TOOLS.md`, which already names
  "how CI is split" as ADR-worthy. The **register is the comments themselves** —
  `grep -rn 'codeql\[' --include='*.ts' .` — so there is no page to keep in sync
  and no way for it to disagree with the code. That is adr/003's reasoning
  reused, and it is what answers the question this ticket was filed to ask: an
  alert with such a comment was examined, one without was not.

  **The rate-limit half is deferred, not excused.** `dl-23` merged, and whether
  `js/missing-rate-limiting` closed is still unread — `gh api` is denied and I
  did not attempt it. If it closed it was never a false positive and there is
  nothing to suppress; if it stayed open it needs its own comment at
  `files.ts:119`. Excusing it now would break adr/005's rule 3 by excusing an
  alert nobody has confirmed is still open. What settles it: one look at the
  security tab, or the next pull request that edits `routes/files.ts`, whose
  `CodeQL` check will say so for free.

  **This pull request is the experiment for acceptance line 5.** It edits
  `egress-proxy.ts`, so the alert lands in the diff, and the `CodeQL` check —
  which the previous round established is scoped to a pull request's own diff,
  with #124 as the control — either goes green because the suppression is
  honoured, or red because it is not. **A red check here is a result, not a
  failure.** The supported follow-up in that case is the
  `advanced-security/dismiss-alerts` action, which converts SARIF suppression
  data into real dismissals; that is a change to `security.yml` and a decision to
  take on its own evidence, deliberately not pre-empted in this branch. The
  comment's documentation value holds either way, which is why adr/005 does not
  depend on the answer.

  **One thing deliberately left out.** Nothing enforces the five fields — a
  suppression comment with no reasoning and no named test would pass every gate
  here, and this repo has the shape that would close it
  (`spawn-safety.test.ts`, `image-closure.test.ts` are source scans policing
  exactly this kind of convention). Not folded in: there is one suppression in
  the repo, and a scan written for one instance is a guess about the second. It
  is recorded as a known gap in adr/005's consequences with a trigger — revisit
  on the third suppression, or sooner if one lands without its reasoning —
  rather than left silent.

  Gates for this round: `npm run check`, and `npm test -- --project downloader`,
  which is the proof the change is inert — the suppression is a comment, so
  `egress-proxy.test.ts` and its four siblings must pass unchanged.

## The gate on this filing

**This section records the gate on PR #124, the filing.** The implementation
landed separately on `repo-13-excuse-codeql-findings`; its gate belongs in
`## Review`, which a reviewer adds.

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
