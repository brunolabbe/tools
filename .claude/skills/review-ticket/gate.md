# The gate's procedure

The steps a gate runs, the severity table it grades by and the section it
returns. **Read only by the gate agents** — `ticket-reviewer-sonnet` and
`ticket-reviewer-opus` — in the same `git show` as the orchestrator's
`roles/common.md` and `roles/reviewer.md`, which say how a dispatched gate gets
its tree, what it is not given and where its section goes. Whoever dispatches a
gate reads [SKILL.md](SKILL.md) instead; step 8, the lander's, is there. The
numbering is shared with it.

**When the branch has no ticket**, the dispatch supplies the acceptance lines and
names the commit message as the brief: trace each supplied line as you would a
ticket's, and say in the section that the acceptance came from the prompt.

## Steps

1. **Read the ticket** — `tools/<tool>/docs/work/<id>-*.md`, or `docs/work/` for
   `repo-`. Its **Done when** lines are the acceptance criteria; its **Build**
   steps and traps are what the author expected to be hard. Read the tool's
   `CLAUDE.md` too. A ticket with no `Done when` section is a finding and an open
   decision: say which lines you derived acceptance from, and from where.

2. **Establish the diff.** `git diff <base sha>...<head sha>`. Name both shas in
   the section's header — a gate against an unstated range cannot be reproduced.

3. **Hunt defects yourself**, in your own context, to the depth your dispatch
   names — `medium` when it names none. **Account for every finding**: keep it,
   or drop it and say in the section that you dropped it and why — wrong, already
   fixed, out of the reviewed range, a product decision rather than a defect. A
   finding that vanishes between the hunt and the section leaves a gate that
   reads like one that found nothing. Two findings that are one mechanism may
   share a bullet; say so in it.

4. **Trace every acceptance line to its proof.** One row per **Done when** line,
   each naming the test that proves it — **the spec file and the test's name**,
   `api/test/runs.test.ts › "a run over HTTP leaves a PlanDetail"`, never
   "covered". **No line numbers anywhere in the section, and no commit pins**:
   the header names the sha you read, and a line number is true only of that sha
   (adr/006). Name code by file and symbol.

   - **Read the assertion, not the test's name.** A test whose name covers half
     the clause proves half the clause. Say which assertion carries the line.
   - **A line with several clauses is proven only when every clause is.** A row
     ticked on the strength of its first clause is the failure this step exists
     to prevent.
   - **Every "contains no X" assertion needs a companion that fails on empty
     output.** A test that a string never appears passes on a function that
     returns nothing.

   Four verdicts:

   - **proven** — a test asserts it, and it runs in `npm test`.
   - **unproven** — nothing asserts it.
   - **unproven (gate)** — asserted only by something the local gates do not
     run: a tool's `e2e` suite, its container build, the Windows leg. When the
     pull request's CI has run that leg green on the head you are gating, say so
     and count it proven, naming the check and the sha.
   - **verified** — nothing asserts it, but you re-ran it: the gates pass, the
     suite count went up, no existing test changed meaning. **Give the numbers
     you got, not the ones the Log claims** — run the suite at the base too, and
     read the diff of the test files for deletions and reworded assertions.

   **Then look for what has no proof at all.** A source file the diff adds a
   branch to, with no test file of its own, is a finding in its own right. It
   costs one `ls` of that package's `test/`.

5. **Walk the repo's invariants.** Each is a rule the root or tool `CLAUDE.md`
   states, and a generic reviewer knows none of them. Check only the ones the
   diff can plausibly touch, and say which you skipped.

   - A tool imports nothing from another tool. Shared code moves to `packages/`
     on the **second** real consumer, and a lift is itself a change to the other
     tool, to be declared.
   - Failures throw `AppError` with a code from the taxonomy. New code in core
     only if it would mean something to a tool that never heard of this one.
     `NOT_FOUND` (no route) and `JOB_NOT_FOUND` (no such job) are not
     interchangeable. Re-worded copy at the raise site means the code is wrong.
   - No shell. Argument arrays, `shell: false`. Kill process **trees**.
   - `redactHeaders` / `redactUrl` wherever a header or URL is logged.
   - Every user-influenced URL is SSRF-checked, after each redirect included.
   - No faked progress: unknown total is `null` and an indeterminate UI.
   - Contract packages are not edited unilaterally: the ticket must show that
     decision being made.
   - New tests are registered: a package's `references` line in
     `tsconfig.tests.json`, and a `web` or `e2e` package's own project file plus
     the `exclude` entry. Unregistered specs pass green while checking nothing.
   - A new workspace dependency for an `api` costs **two** edits to that tool's
     `Dockerfile`, and neither is typechecked.
   - When a check is about "every route", enumerate them with Fastify's
     `printRoutes({ includeHooks: true })`, not a contract table, which misses
     `HEAD` and a second verb on one path.
   - Style: no `any`, no `console`, `import type`, `node:` builtins, `.ts` in
     relative imports.

6. **Sweep the four NFRs** — security, performance, reliability,
   maintainability — one line each. *Not applicable* is a fine answer; silence
   is not.

7. **Decide the gate by the rule below, not by feel**, write the section to the
   file `roles/reviewer.md` names, and return it. You do not commit it.

### A shape-level finding goes onto the siblings too

When a finding is about a **shape** the change shares with its siblings — the
same wrong assumption in three resolvers — it belongs in the siblings' `## Build`
sections, in the same pull request as the fix. Name them in the finding.

## Severity and the gate

| Severity | Means |
| --- | --- |
| **high** | Breaks an invariant above, loses data, leaks a credential, or an acceptance line is wrong rather than merely untested — including a test that passes when the thing it claims to prove is broken, and shipped text that is false against the code |
| **med** | An acceptance line unproven, a rule bent with no reason given, a defect behind a condition that will occur, a new branch in a file with no test file of its own |
| **low** | Style, a missing fixture, a comment that will mislead the next reader, a defect with no live call site |

**Say for each `med` whether a `Done when` line depends on it.** Only a `high`,
or a `med` an acceptance line depends on, opens a fix round; everything else is
recorded and may land unfixed. So a severity is a cost you are assigning: grade a
hypothetical with no caller as `low`, and say "no live call site" in the bullet.

- **FAIL** — any high, or any acceptance line **unproven**.
- **CONCERNS** — any med, or any acceptance line **unproven (gate)**.
- **unproven (scope)** — a line the dispatch removed from the branch's scope,
  with the row naming who scoped it and where the work lands instead. It does
  not force FAIL.
- **PASS** — every acceptance line proven or verified, nothing above low.
- **WAIVED** — never yours to write. A human waives, names themself and says why.

**A review never edits the ticket's `status` frontmatter or its brief.** FAIL is
a report; whether work stops is the author's call.

## The section

One subsection per gate. Keep it short; the reasoning goes in your report, which
is posted to the pull request thread.

```markdown
## Review

**Gate: CONCERNS** — 2026-10-03 · `1a2b3c4..5d6e7f8` · Opus 5.5, depth medium

| Done when                                 | Proof                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Run over HTTP leaves a `PlanDetail`       | `api/test/runs.test.ts` › "a run over HTTP leaves a PlanDetail" ✓ |
| Image ships every workspace `api` imports | **unproven (gate)** — planner.yml's container job, not yet run   |

- **med** · no `Done when` line depends on it · `Dockerfile` lists workspaces by
  hand in two places and nothing typechecks the list.
- **low** · `nfr:maintainability` — no fixture for the empty-roster branch of
  `buildRoster` in `api/src/roster.ts`.
- **dropped** · the retry loop in `fetchPlan` reported as unbounded; it is
  bounded by `maxAttempts` in its caller. Not a defect.
- **findings** · the hunt returned 3; 2 carried, 1 dropped.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability — above.
```

**The `findings` line is required even when nothing was dropped.** It is the only
line that separates a gate whose hunt found nothing from one whose hunt never
ran, and its count has to reconcile against the bullets.

A later gate's section starts `### Gate 2` with the same header line, gives each
earlier finding a verdict — fixed, not fixed, refuted — and lists only findings
in the lines the round touched.

## What this is not

It does not run the slow gates for you, and it must not report them as run. It
does not fix what it finds: a model asked to both judge and repair is back on the
wrong side of the split this skill exists to draw.
