---
name: review-ticket
description: Review finished work against its ticket and record a gate on the ticket file. Use when work on a ticket is done and someone asks to review it, check it against its acceptance, or decide whether it can land — "review pl-16", "is dl-9 ready", "gate this before I open the PR". Checks acceptance-to-test traceability and this repo's own invariants, which a generic code review does not know about; delegates defect-hunting to the code-review skill rather than repeating it.
---

# Reviewing a ticket

A defect review asks whether the code is wrong. This asks a different question:
**does the change do what its ticket said, can someone else check that, and did it
break any of the rules this repo learned the hard way?** The two are complementary
and only one of them is already built — so this skill runs `code-review` for the
first question and spends its own effort on the rest.

The output is a `## Review` section appended to the ticket file, because
`docs/01-TICKETS.md` already holds that the file is the unit of work from brief to
record. A verdict that lives in a terminal scrollback is not a record.

## Arguments

`/review-ticket <id> [level]` — e.g. `pl-16`, or `dl-9 high`.

With no id, infer it: the branch name, then the ticket ids named in the commits on
this branch. If that is still ambiguous, ask rather than guess — reviewing the
wrong ticket produces a confident answer to a question nobody asked.

`level` is passed to `code-review` and defaults to `medium`. **Never `ultra`**: it
is billed separately and is the user's to trigger, not yours.

## Steps

1. **Read the ticket** — `tools/<tool>/docs/work/<id>-*.md`. Its **Done when**
   lines are the acceptance criteria; its **Build** steps and traps are what the
   author expected to be hard. Read the tool's `CLAUDE.md` too.

2. **Establish the diff.** `git diff origin/main...HEAD` for branch work, or the
   PR's diff if given one. Say which range you reviewed — a gate against an
   unstated range cannot be reproduced.

3. **Hunt defects with the existing skill.** Invoke `code-review` at `level`
   against that range. Do not re-run its analysis yourself; carry its findings
   into the table below with its severities.

4. **Trace every acceptance line to its proof.** One row per **Done when** line,
   each naming the test that proves it — `file.test.ts:88`, not "covered". A line
   with no test is a finding, and so is a test that asserts something narrower
   than the line claims. Three verdicts, and the third is the one that matters:

   - **proven** — a test asserts it, and it runs in `npm test`.
   - **unproven** — nothing asserts it.
   - **unproven (gate)** — asserted only by something the local gates do not run:
     a tool's `e2e` suite or its container build, which live in
     `.github/workflows/<tool>.yml` and nowhere else.

   The third exists because of [pl-16](../../../tools/planner/docs/work/pl-16-the-plan-run.md):
   `npm run check` and 1,020 tests passed and the image would not boot. "Green
   locally" is not proof of an acceptance line whose proof is a gate you did not
   run, and this is the row that refuses to let that pass silently.

5. **Walk the repo's invariants.** These are not general advice — each is a rule
   the root or tool `CLAUDE.md` states, and a generic reviewer knows none of them.
   Check only the ones the diff can plausibly touch, and say which you skipped.

   - A tool imports nothing from another tool. Shared code moves to `packages/`
     on the **second** real consumer — and a lift is itself a change to the other
     tool, to be declared rather than smuggled.
   - Failures throw `AppError` with a code from the taxonomy. New code in core
     only if it would mean something to a tool that never heard of this one.
     `NOT_FOUND` (no route) and `JOB_NOT_FOUND` (no such job) are not
     interchangeable. Re-worded copy at the raise site means the code is wrong.
   - No shell. Argument arrays, `shell: false`. Kill process **trees**.
   - `redactHeaders` / `redactUrl` wherever a header or URL is logged — a signed
     URL carries its credential in the query string.
   - Every user-influenced URL is SSRF-checked, after each redirect included.
   - No faked progress: unknown total is `null` and an indeterminate UI.
   - Contract packages are not edited unilaterally. If the diff changes one, the
     ticket must show that decision being made, not assumed.
   - New tests are registered: a package's `references` line in
     `tsconfig.tests.json`, and a `web` or `e2e` package's own project file plus
     the `exclude` entry. Unregistered specs pass green while checking nothing.
   - A new workspace dependency for an `api` costs **two** edits to that tool's
     `Dockerfile`, in two places, and neither is typechecked.
   - Style: no `any`, no `console`, `import type`, `node:` builtins, `.ts` in
     relative imports.

6. **Sweep the four NFRs** — security, performance, reliability,
   maintainability — one line each. *Not applicable* is a fine answer and a fast
   one; silence is not, because a skipped sweep and a clean one look identical
   afterwards.

7. **Decide the gate by the rule below, not by feel**, and append the section.

## Severity and the gate

| Severity | Means                                                                    |
| -------- | ------------------------------------------------------------------------ |
| **high** | Breaks an invariant above, loses data, leaks a credential, or an acceptance line is wrong rather than merely untested |
| **med**  | An acceptance line unproven, a rule bent with no reason given, a defect behind a condition that will occur |
| **low**  | Style, a missing fixture, a comment that will mislead the next reader     |

- **FAIL** — any high, or any acceptance line **unproven**.
- **CONCERNS** — any med, or any acceptance line **unproven (gate)**.
- **PASS** — every acceptance line proven, nothing above low.
- **WAIVED** — never yours to write. A human waives, names themself and says why.

`unproven (gate)` is CONCERNS rather than FAIL on purpose: the work may be
entirely correct and the gate simply has not run yet. It is not PASS either,
because that is precisely the case that has already shipped a broken image here.

**A review never edits the ticket's `status` frontmatter**, and never edits the
brief. FAIL is a report; whether work stops is the author's call, not the
reviewer's. Append only.

## The section to append

Above `## Log`, or replacing a previous `## Review` — one gate per ticket, the
current one. Keep it short; the reasoning belongs in the Log where the author
writes it.

```markdown
## Review

**Gate: CONCERNS** — 2026-08-16 · `origin/main...HEAD` · code-review at medium

| Done when                                  | Proof                              |
| ------------------------------------------ | ---------------------------------- |
| Run over HTTP leaves a `PlanDetail`         | `api/test/runs.test.ts:142` ✓      |
| Image ships every workspace `api` imports   | **unproven (gate)** — planner.yml  |

- **med** · `Dockerfile` lists workspaces by hand in two places and nothing
  typechecks the list; the build-stage half fails differently from the runtime half.
- **low** · `nfr:maintainability` — no fixture for the empty-roster branch.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability — above.
```

## What this is not

It does not run the slow gates for you, and it must not report them as run. If an
acceptance line needs the e2e suite or the image, the honest row is
`unproven (gate)` and the honest sentence is that the gate is the proof you do not
have.
