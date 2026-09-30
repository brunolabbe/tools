---
id: repo-88
tool: repo
title: what verdict a gate gives a faithful build of an unmeetable Done-when line, or a line proven only by a release
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-88 — what verdict a gate gives an unmeetable Done-when line

## Why

`.claude/skills/review-ticket/gate.md` (_Severity and the gate_) has no verdict
for two cases that both recurred in the 2026-09-30 batch, and each time the gate
settled it by hand:

1. **A faithful build of a Done-when line that cannot be met.** The brief asks
   for something its own Decision cannot deliver, and the builder built exactly
   what the Decision says. repo-49's gate 1 graded it **FAIL "by the letter"**,
   because the Decision's filter could not satisfy Done-when 1. The build was
   not wrong; the brief was, and the question of what to do about it was an
   open decision the gate found by measurement (4 of 11 lines were name claims
   the filter cannot clear).
2. **A line proven only by a post-merge release.** repo-46's Done-when 1 and 3
   can only be proven once a release commit exists. Its gate 3 graded both
   `unproven (gate)` and the verdict **CONCERNS**, resting on those two lines
   alone. The four row verdicts in step 4 have no entry for "proven, but only
   after the merge", so the gate used the nearest one.

The gate's rule for `PASS` is "every acceptance line proven or verified", so
neither case can be a PASS today, and whether each is a FAIL or a CONCERNS is
left to whoever happens to be gating. The same facts got FAIL in one record and
CONCERNS in another.

A builder on this batch's close-out drafted two new verdict bullets for
`gate.md`, `proven (post-merge)` and `open decision`, and that draft was
dropped: it stated neither a verdict effect nor a rule (the gate's finding F7 on
PR #329), and it contradicted repo-46's own gate 3.

## The decision

What verdict does a gate return for each case? Options, from the gate's F7. **No
recommendation is set here; it is the owner's to choose.**

1. **Both cases yield CONCERNS.** A line proven only by a post-merge release is
   graded like `unproven (gate)`: CONCERNS, with the line named. An open
   decision found on a faithful build is CONCERNS, not FAIL, and the row names
   the contradictory facts so the owner can see what is open. This is what
   repo-46's gate 3 did, and what repo-49's gate 1 did not.
2. **A line proven only by a post-merge release is PASS; an open decision on a
   faithful build is CONCERNS.** The release is the proof, and waiting for it
   is not a defect in the build. The open-decision half is as in option 1.

What the page does today, for comparison, is neither: it has no rule, so the
verdict depends on the gate.

## Reproductions

Two gate records, each a case the gate graded by hand:

- **repo-49's gate 1, FAIL "by the letter".** On `main`, in
  `docs/work/repo-49-next-id-reports-a-clash-for-a-branch-that-only-edits-a-ticket.md`,
  under `## Review`, the section headed `### Gate 1`: its first row (Done-when
  1. and its first finding, F1, _open decision_. Read the verdict line and
     that F1.
- **repo-46's gate 3, CONCERNS resting only on Done-when 1 and 3.** This record
  is not on `main` yet. It is on open PR #328, branch `repo-46-lockfile-stamp`,
  in the ticket for repo-46, under `## Review`, the section headed
  `### Gate 3`. Its first line gives the verdict and the reason: "CONCERNS only
  because Done when 1 and 3 are still **unproven (gate)** until a release".

## Build

Not until the decision is answered. Once it is: the verdict rule goes in
`.claude/skills/review-ticket/gate.md`, and `roles/reviewer.md` restates it
wherever it restates the verdicts; the two bullets dropped from PR #329 are the
starting draft and must state their effect on the verdict.

## Done when

- `gate.md` states the verdict for a faithful build of an unmeetable Done-when
  line and for a line proven only by a post-merge release.
- Both reproductions above, read against the new rule, give the verdict it
  states.
- `npm run check` passes.

## Log

- 2026-09-30 — Filed on the owner's decision via `AskUserQuestion`, at PR #329's
  close-out: drop the two verdict bullets the builder drafted for `gate.md`, and
  pose the question here with the gate's options and no recommendation. The
  reproductions are the two gate records above.
