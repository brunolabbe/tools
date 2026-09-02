# What to name in a prompt, and what not to believe

## Defect shapes worth naming in a prompt

**A fixture value that is also the component's no-op.** A sorted list handed to a
sorter; the one enum value that renders nothing handed to a component that renders
on a different one; a present optional handed to a fallback chain. Nine instances
across two tickets in the reference session, none findable by reading the tests —
each reads as a good assertion and passes for the wrong reason.

**A fix that consumes its own counterexample.** Proving a lookup can delete the only
fixture that exercised the comparison beside it. After any test fix, ask what value
the suite no longer supplies.

**A test that asserts a library's prose.** Matching on a framework's warning text
passes green the day the wording changes. Prefer a structural assertion.

**A negative assertion with no companion.** `queryBy(...).toBeNull()` passes when the
whole markup block is gone. It needs a sibling that fails in that case.

**An acceptance line that cannot fail.** Check the premise: if the fixtures cannot
produce the input the criterion describes, the assertion was never live. Amending
such a line is honest — but the amendment needs an outside check.

**A tolerance is the sharpest version of that**, because the number reads as
rigour. A sibling session shipped a sampler whose accuracy fixture gave every
segment the same bitrate — so any sample of it was its own mean, and "within 10%"
could not fail. Against a fixture with real variance the sampler was **29% low**:
it would have passed its own acceptance and been wrong in production. **A
tolerance-phrased criterion is worth exactly the variance in the fixture behind
it, and a fixture with none turns a tolerance into a tautology.** Read every
acceptance line containing a percentage as a claim about the fixture, not about
the code.

**A correction that is false in a new place.** A gate finds a claim false, the
builder rewrites it, and the rewrite is wrong differently — and now it *reads as
reviewed*, so the next reader trusts it harder than the original. Twice on one
branch in the third session: "drop the fold and both go red" replaced a different
false sentence, and only one of the two tests goes red because the other is a
control that must stay green. This is the concrete case for _one false
self-report means another gate_ below: it is the correction, not the original,
that the second gate caught. When relaying, say **state only what you have run** —
the builder that fixed it put it best: what broke the pattern was not care, it was
refusing to write the sentence until the command had exited.

**A verification harness that cannot fail.** The shape above, one level up, where
none of the techniques on this page look — because they all examine the tests
rather than the thing running them. A builder reported *twelve mutations, twelve
red*; all twelve were worthless, because its harness ran
`npx vitest run <spec> --reporter=basic` and `basic` does not exist in vitest 4.
It fails to load and **exits 1 on a clean, unmutated tree**, so every mutation
"died" unconditionally. It was reporting the reporter.

**The discipline is one line: a control run.** Before trusting any red, run the
mutation command over the **unmutated** tree and confirm it exits 0. Require it in
the gate prompt, and require the reviewer to state the control's result. It
generalises past mutation testing: any harness whose signal is an exit code needs
its negative case proven once, or a green is indistinguishable from a
misconfiguration.

The corollary is that a builder's mutation report is not evidence until something
reproduces it. When one report on a branch is found false, **every other
self-reported result on that branch is suspect** — that is a reason for another
gate, and it is evidence rather than ritual. In the second session the branch
whose sweep collapsed was re-swept properly (16/16, control green), and the
*corrected* table still overstated by one row. The gate that caught that was the
one a "three gates then ship" cap would have skipped.

**Reasoning that was never run.** One level earlier than the harness that cannot
fail, and it is the most common defect in this repo's history. That shape is about
verification machinery producing a false negative; this one is about a claim that
**never had machinery at all** — sound reasoning, written down as a conclusion,
never executed.

Its distinguishing property is what makes it dangerous: **sound-but-unrun and
sound-and-run reasoning are identical on the page.** No reviewer can separate them
by reading, which is why prose review never catches this and why the fourth
session shipped three instances across two branches — and drafted a fourth, in
this very section. They rhyme:

- A builder deferred fixing one table row because it was "the same class" as a
  row it had *measured* to be unfixable. The measurement was real; the
  generalisation to the neighbouring row was never run. That row was the one
  reaching the disk.
- The same builder rejected an option on a ticket for a specific reason, then
  wrote the opposite into a sibling ticket an hour later. Its own diagnosis is the
  best statement of the class anyone produced: *"The reasoning was sound both
  times; only one was run."*
- A documentation branch replaced a **vague and true** sentence with a **precise
  and false** one, in a passage headed "re-derived from the repository, not taken
  on trust".

The countermeasure is one line, and it belongs in every builder and gate prompt:
**do not write the sentence until the command has exited.** Its corollary is
cheaper still — where you cannot run it, write the vague-and-true form rather than
the precise-and-unverified one. Precision is not a courtesy to the next reader
when it is unearned; it is a trap, because precision is what makes a claim look

**A `trap` cannot do this here, and the rule survives its mechanism.** Each Bash
call is a fresh shell, so a trap set before the mutation is gone by the time the
next call runs the test — it protects nothing across the mutate-run-restore
sequence this page is describing. Measured 2026-09-02: a reviewer hit exactly
this and substituted a **file-copy backup**, restored from it, `touch`ed the file
so the test runner saw the change, and confirmed with `git status --porcelain`
returning empty. That is the shape to copy in a per-call-shell harness. What must
not change is the requirement: **restore before you report, and prove the restore
with a command rather than an assurance.**
checked.

Two consequences for how you dispatch:

- **Require every figure to carry the command that produced it**, inline, in the
  Log. Not "verified" — the invocation and its output. This is the only mechanical
  test that separates the two cases, and it is what a later gate can audit.
- **A ticket's own rigour claim is a place to look, not a reassurance.** All three
  instances above sat inside sentences advertising that they had been measured.
  When a gate prompt says what to attack, "the sentence claiming it was measured"
  is a good answer.

**And it catches orchestrators.** The first draft of this very section reported the
fourth session's review share as "40%". Nobody computed it; it was the number that
felt right beside the previous three. Summing the six gates against the total gave
**34%** — written into a paragraph whose subject is claims that were never run, by
the agent writing the rule.

Then the session kept running, one branch took a fourth round, and the true figure
became **30%**. So the anecdote has two halves and the second is the more useful
one. Nobody is exempt from this class, least of all whoever is currently explaining
it — and **a figure computed while the work is still moving is a figure that will
move.** Re-derive every number as the last action before you commit, not the first
convenient one; the discipline that caught both errors was mechanical, not
vigilance.

**Why it recurs, which is the part worth carrying.** The documentation branch above
hit this class **three times on one document across three passes of one branch** —
written wrong, corrected wrong, and the correction's correction invalidated by the
next round — all inside a single session, across roughly one hour. That is the
alarming part: it does not need elapsed time or a change of author to recur. Two
gate rounds on that branch were enough to surface two of the three. Its builder found the
mechanism, and it is not carelessness: the paragraph was being edited for a
*different* finding, so it was on the **edit list** but not on the **re-derive
list**. The rule as practised was "verify the figures the gates named"; the rule as
written was "verify every figure". Adding a file to the branch silently invalidated
a count that had been correct when written, and nothing connected the two edits.

So the generalisation to put in a relay is theirs, not a restatement of the
finding: **a number is safe when it is re-derived in the same pass that could have
invalidated it — and adding a file to a branch invalidates every count of that
branch's files.** A fix that does not generalise is how a class recurs, and "fix
the number the gate named" is exactly such a fix.

## Verification traps

- **A harness that cannot fail is the defect class that produced everything else
  on this page.** Before trusting any negative result — a mutation that "died", a
  sweep where nothing worked, a check that stayed green — **prove the harness can
  produce the positive.** Three independent instances in one session, only one of
  them mutation testing: a component test whose value arrived from a refetch
  rather than the frames it named; sixteen ffmpeg candidates that all failed
  identically because the fixture returned the *requested* port (`0`) instead of
  the bound one; and a peer session's dangling-dependency test whose dependency
  was not dangling. In each the result looked like evidence and the setup had
  quietly removed the thing under test. The mutation-testing control run below is
  one instance of this rule, not the whole of it.
- **Build before testing** in a fresh worktree, always.
- **A worktree with no farm at all is worse than a stale `dist`, because it does
  not fail — it resolves somewhere else.** Node walks parent directories, so a
  worktree under `.claude/worktrees/` with no `node_modules` finds the **shared
  checkout's**, whose `dist` is whatever branch that checkout last built. A gate
  hit this and saw three or four tests fail exactly as a successful `-loglevel` or
  sticky-classifier mutation would, with nothing looking wrong — it was reading
  another branch's build. Run the farm and `npm run build` **before** measuring
  anything, and confirm the farm points inward:
  `readlink -f node_modules/@<scope>/<pkg>` must land inside the worktree. The
  stale-`dist` traps below all assume resolution is at least local; this one
  removes that assumption, so check it first.
- **Stale `dist` fakes a passing mutation.** Where a package resolves a sibling
  through `dist`, mutating that sibling and seeing green may mean the build never
  ran. Rebuild, then re-mutate.
- **And restoring a mutation can leave `dist` stale too** — the same trap running
  backwards, hit independently by two agents in one session. `mv "$F.bak" "$F"`
  restores the file's **original mtime**, so `tsc --build` judges the source older
  than the emitted output, skips the project, and the **mutated** `dist` survives
  the restore. One occurrence left a mutated `config.js` in place, failed an
  unrelated suite, and looked exactly like a branch flake. `touch` the source
  after restoring, or force a clean rebuild, and grep `dist` to confirm the
  mutation is gone. Suspect this first when a suite fails in a way the diff cannot
  explain.
- **Restore from a `trap`, not from the next line of the script.** The next line
  does not run when you are killed. A mutation harness whose restore is a
  subsequent statement leaves the tree mutated on any timeout, interrupt or usage
  limit — and the fifth session's orchestrator did exactly this to itself, running
  a sweep under a two-minute tool timeout and stranding a source file *and* its
  `dist` with a security-relevant lookahead deleted. Write
  `trap 'cp "$BAK" "$F"; touch "$F"; npm run build' EXIT INT TERM` **before** the
  first mutation, and have the run print a line when it fires so you can see that
  it did. This is the cheap half of *When every agent dies at once*: that section
  tells you to check for a mutated tree afterwards, and this stops there being one.
- **Measure the baseline yourself.** Never carry a delta across a rebase; check out
  the base, build there, run the suite.
- **Docs need mechanical verification, not prose review.** Prose has no compiler.
  What works: an **unfiltered** `git grep` (no `--include` — the citation that
  matters is in the file type you did not think of), resolving every link including
  anchors, `ls` on every cited path. Three consecutive gates each found exactly one
  more dangling citation than the sweep before it claimed existed.
- **A sweep anchored to one term is still a filter.** Unfiltering the file type is
  half of it; the other half is sweeping the **other names of the thing** — the
  flag, the script, the ADR slug, the bare noun in a spine listing — because a
  citation can name the subject without ever using its filename. Two found this way
  in one ticket, neither reachable by any `git grep` on the filename: a
  `package.json` annotation still advertising a deleted flag, because the ADR it
  pointed at is slugged differently; and a `CLAUDE.md` layout block listing the
  page by its bare noun. Three instances of this class across two tickets, each
  from an angle the previous fix did not cover — which is the tell that a fix which
  does not generalise is how a class recurs.
- **Slow gates do not run here.** e2e and container builds stay unrun in this loop.
  Say so when reporting a PASS; the CI workflow is the first thing to exercise them.
