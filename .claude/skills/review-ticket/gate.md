# The gate's procedure

The steps a gate runs, the severity table it grades by and the section it
returns. **Read only by the gate agents** — `ticket-reviewer-sonnet` and
`ticket-reviewer-opus` — in the same `git show` as the orchestrator's
`roles/common.md` and `roles/reviewer.md`, which say how a dispatched gate
gets its tree, what it is not given and where its section goes. Whoever
dispatches a gate reads [SKILL.md](SKILL.md) instead; step 8, the lander's,
is there. The numbering is shared with it, so "`review-ticket` step 4" means
step 4 below.

**When the branch has no ticket**, the dispatch supplies the acceptance lines
and names the commit message as the brief: trace each supplied line as you
would a ticket's, grade an unproven one FAIL exactly as a ticket's, and say in
the section that the acceptance came from the prompt.

## Steps

1. **Read the ticket** — `tools/<tool>/docs/work/<id>-*.md`. Its **Done when**
   lines are the acceptance criteria; its **Build** steps and traps are what the
   author expected to be hard. Read the tool's `CLAUDE.md` too.

2. **Establish the diff.** `git diff origin/main...HEAD` for branch work, or the
   PR's diff if given one. Say which range you reviewed — a gate against an
   unstated range cannot be reproduced.

3. **Hunt defects yourself**, in your own context, to the depth your dispatch
   names — `medium` when it names none. You have no `Skill` tool, by design:
   dispatch belongs to whoever dispatched you, and nesting it hides cost and
   makes the agent tree unreadable. Record the range and the depth where the
   header below says `code-review at <level>`.

   **Read what its finders actually returned, not only the summary it hands
   back, and account for every finding.** Carrying is a decision per finding, not
   transcription: keep it, or drop it and **say in your own section that you
   dropped it and why** — wrong, already fixed, out of the reviewed range, a
   product decision rather than a defect. All three are good answers; silence is
   not, because a finding that vanishes between the finder and the table leaves a
   gate that reads exactly like one that found nothing.

   **Two findings that are one mechanism may share a bullet** — say so in it
   ("two findings, one mechanism") so the arithmetic still reconciles against the
   `findings` line below. Merging is a presentation choice and a reasonable one;
   merging silently is how a count stops adding up, and the builder is then left
   guessing whether one was dropped.

   This paragraph is here because it has already happened twice, in consecutive
   reviews, in both directions: pl-10's gate lost two defects its finders had
   reported — one of them a navigation bug that re-asked an already-drafted
   trip's questions — and pl-18's lost a duplicated-SQL finding, which its author
   then did not record in the Log either. Neither reviewer was careless. Both
   summarised a summary, which is what the old wording of this step invited.

4. **Trace every acceptance line to its proof.** One row per **Done when** line,
   each naming the test that proves it — `file.test.ts:88 "a fragment of that
   line"`, not "covered". A line with no test is a finding, and so is a test that
   asserts something narrower than the line claims.

   **Every citation you write into `## Review` carries anchor text, and the
   fragment must occur only once in the file it points at.** CI enforces both —
   `scripts/citations-gate.mjs` runs in `ci.yml`'s `check` job over every
   record's `## Review` section with `--require-anchors
   --require-distinct-anchors` — so a bare `file.test.ts:88` in a section you
   commit turns the build red, and so does `"const"`.

   Two constraints on the fragment, both of which have bitten somebody here:

   - **No `"` inside it, and no backtick either.** The parser's anchor group
     admits no `"`, so escaping one truncates the fragment at the backslash and
     the citation reports `moved`. A backtick inside the fragment breaks the
     cell's inline-code parsing, and the formatter then rewrites the text
     around it — measured on a gate's own first draft, 2026-09-20. Pick a
     substring free of both.
   - **A citation into any file under `.claude/` is pinned or names a
     heading, never a bare line number.** Those pages move every few sessions
     and an unanchored coordinate into them is silently redirected by the next
     edit; write `<file>@<rev>:<line>` with a `main` commit, or the page and
     the heading (repo-52). `citations.mjs --require-claude-pins` reports the
     bare form as `unpinned-volatile`.
   - **Quote enough of the line to be unique, and know that the line wrap bounds
     what you can quote.** `verified` means *some* occurrence of your fragment
     starts inside the range you named — not that only one does. In prose files
     the fragment cannot cross a physical line break, so the distinctive words
     are sometimes on the next line; cite that line, or a range, rather than
     settling for a short fragment that verifies on more than one line
     (2026-09-20). A one-word anchor keeps saying `ok` after an unrelated edit
     slides a different occurrence onto the cited line, which is exactly how
     `repo-31`'s `"informational"` citation survived pointing at a comment it had
     nothing to do with.

   This is not formatting. An unanchored coordinate still *resolves* — the
   checker only confirms the file has that many lines — so a citation onto a
   blank line, one that drifted onto unrelated code, and one that bound to the
   wrong file entirely all report clean at exit 0. All three are measured, all
   three came out of live review cycles, and they are why
   [repo-29](../../../docs/work/repo-29-citations-carry-no-anchor.md) exists. An
   anchor is the only thing here that checks the *claim* rather than the
   coordinates.

   **Cite the line of the assertion, not the line of the `test(` that contains
   it.** A test whose name covers half the clause — "reaches grounding, and
   grounding reaches the composer", for a bullet that also demands `grounding →
   done` be *rejected* — is cited correctly and is still unverifiable: the reader
   has to open the file to find out whether the other half is asserted anywhere.
   Cite the half you mean and the row can be checked without leaving the table.

   **A line with several clauses is proven only when every clause is.**
   Acceptance lines routinely join three or four claims with commas. Cite each,
   and if one is unproven the row is unproven whatever the others say — a row
   ticked on the strength of its first clause is the exact failure this step
   exists to prevent.

   Four verdicts, and the last two are the ones that matter:

   - **proven** — a test asserts it, and it runs in `npm test`.
   - **unproven** — nothing asserts it.
   - **unproven (gate)** — asserted only by something the local gates do not run:
     a tool's `e2e` suite or its container build, which live in
     `.github/workflows/<tool>.yml` and nowhere else.
   - **verified** — nothing asserts it, but you re-ran it. For the bullet almost
     every ticket ends with: the gates pass, the suite count went up, no existing
     test changed meaning. **Give the numbers you got, not the ones the Log
     claims** — a count is verified by running the suite at the base commit too,
     and "no existing test changed meaning" by reading the diff of the test files
     it touched for deletions and reworded assertions. Counts as proven for the
     gate.

   `unproven (gate)` exists because of [pl-16](../../../tools/planner/docs/work/pl-16-the-plan-run.md):
   `npm run check` and 1,020 tests passed and the image would not boot. "Green
   locally" is not proof of an acceptance line whose proof is a gate you did not
   run, and this is the row that refuses to let that pass silently.

   `verified` exists because that last bullet fits none of the other three —
   nothing asserts it, it is not a CI gate, and it is plainly not unproven.
   Without a verdict of its own a reviewer reads the Log's numbers back and ticks
   them, which is the ticket marking its own homework.

   **Then look for what has no proof at all.** A source file the diff adds a
   branch to, with no test file of its own, is a finding in its own right — name
   the file and the branch. It costs one `ls` of that package's `test/`, and it
   catches what reading does not: reading covers the lines you looked at closely,
   and nothing makes you look at all of them. pl-24 is the worked example.
   `RunView.tsx` took 38 changed lines in a package with no `run-view.test.tsx`,
   and absorbed two _never fake progress_ defects in one branch — a lookup
   labelled as a specialist, and the fan-out's finished counters replayed as
   grounding's own. Both were eventually found by eye; the second was found
   twice, because the first reading caught one of its two call sites.

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

7. **Decide the gate by the rule below, not by feel**, and **return** the section
   as text. Do not write it to the ticket yourself: your worktree is discarded
   when you report, so a file you edit here goes nowhere. Whoever lands the
   ticket commits it with every other gate's, once, in step 8 — so on a
   re-gate, an earlier gate's record missing from the branch is expected, not
   a finding (`orchestrate-tickets`' `records.md`, since `repo-67`).

### A shape-level finding goes onto the siblings too

When a finding is not about this change but about a **shape** the change shares
with its siblings — the same wrong assumption in three resolvers, one rule
restated in four ticket briefs — it belongs in the siblings' `## Build` sections,
in the same pull request as the fix. Naming it only in this ticket's `## Review`
records it where nobody building the sibling will read it, and the next agent
rebuilds the defect from the brief that still describes it.

## Severity and the gate

| Severity | Means                                                                    |
| -------- | ------------------------------------------------------------------------ |
| **high** | Breaks an invariant above, loses data, leaks a credential, or an acceptance line is wrong rather than merely untested |
| **med**  | An acceptance line unproven, a rule bent with no reason given, a defect behind a condition that will occur, a new branch in a file with no test file of its own |
| **low**  | Style, a missing fixture, a comment that will mislead the next reader     |

- **FAIL** — any high, or any acceptance line **unproven**.
- **CONCERNS** — any med, or any acceptance line **unproven (gate)**.
- **unproven (scope)** — a line the dispatch removed from the branch's scope,
  with the row naming who scoped it and where the work lands instead. It does
  not force FAIL: three gates on 2026-09-20 each had to reconcile this by hand
  when a builder was told to leave the page wiring to the orchestrator.
- **PASS** — every acceptance line proven or verified, nothing above low.
- **WAIVED** — never yours to write. A human waives, names themself and says why.
- **PREFLIGHT** — a page-only `chore` with no source change, gated by
  `scripts/preflight.mjs` exiting 0 and the orchestrator's own read, per
  `orchestrate-tickets`' `sizing.md`. Written by the orchestrator, naming the
  sha the check ran at; never for a ticket that touches `scripts/`, `packages/`
  or a tool's source, which gets a reviewer (2026-09-20).

`unproven (gate)` is CONCERNS rather than FAIL on purpose: the work may be
entirely correct and the gate simply has not run yet. It is not PASS either,
because that is precisely the case that has already shipped a broken image here.

**A review never edits the ticket's `status` frontmatter**, and never edits the
brief. FAIL is a report; whether work stops is the author's call, not the
reviewer's. The section is added, never in place of anything else in the file.

## The section to commit

Above `## Log`. On a ticket that has been through several rounds, keep one
subsection per gate rather than overwriting: a record that shows only the last
gate cannot be told from one whose earlier findings were dropped. Keep it short;
the reasoning belongs in the Log where the author writes it.

**Every `file:line` in it carries anchor text**, per step 4 — the section is the
one part of a ticket CI checks, and `node scripts/citations-gate.mjs` is what
checks it.

```markdown
## Review

**Gate: CONCERNS** — 2026-08-16 · `origin/main...HEAD` · code-review at medium

| Done when                                 | Proof                                          |
| ----------------------------------------- | ---------------------------------------------- |
| Run over HTTP leaves a `PlanDetail`       | `api/test/runs.test.ts:142 "expect(detail)"` ✓ |
| Image ships every workspace `api` imports | **unproven (gate)** — planner.yml              |

- **med** · `Dockerfile` lists workspaces by hand in two places and nothing
  typechecks the list; the build-stage half fails differently from the runtime half.
- **low** · `nfr:maintainability` — no fixture for the empty-roster branch.
- **dropped** · finder reported the retry loop as unbounded; it is bounded by
  `maxAttempts` two frames up. Not a defect.
- **findings** · code-review at medium returned 3; 2 carried, 1 dropped.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability — above.
```

A `dropped` line costs one sentence and is the difference between a gate that
found nothing and a gate that decided something was not worth carrying. It has
no severity, and it never changes the verdict.

**The `findings` line is required even when nothing was dropped.** `2 returned,
2 carried, 0 dropped` looks like a formality and is the opposite: it is the only
line that separates a gate whose defect hunt found nothing from one whose defect
hunt never ran. The header above names the hunt and its depth, so a reviewer that
skipped step 3 entirely still writes them, and every other part
of the section would look exactly the same. The count also has to reconcile
against the bullets, which is what makes a merged bullet safe to write.

## What this is not

It does not run the slow gates for you, and it must not report them as run. If an
acceptance line needs the e2e suite or the image, the honest row is
`unproven (gate)` and the honest sentence is that the gate is the proof you do not
have.

It does not fix what it finds unasked. The reviewing subagent fixes nothing at
all — a model asked to both judge and repair is back on the wrong side of the
split this skill exists to draw — and the builder proposes the work in step 8
rather than starting it.
