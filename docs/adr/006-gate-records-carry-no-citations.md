# 006 — Gate records carry no line citations, and a ticket gets two gates

**Status:** accepted · **Date:** 2026-10-03 · **Affects:** every tool, and the
`orchestrate-tickets` and `review-ticket` skills

Reverses [repo-29](../work/repo-29-citations-carry-no-anchor.md)'s decision to
enforce citations in gate records, and the rules built on it since
(repo-35, repo-47, repo-52, repo-67, repo-78, repo-84).

## Context

A gate record's acceptance table named the test proving each `Done when` line as
`file.test.ts:88 "anchor text"`, and CI checked every merged record's citations
against the tip of `main` on every push. The intent was sound: a row that says
"covered" cannot be checked by anyone else.

The owner asked on 2026-10-03 for a review of what the build-and-gate loop costs.
What it found, measured on `main` at `ebb808b` and on that day's batch:

- **The machinery had become most of the work.** 81 of 203 finished tickets were
  `repo-` tickets, about 26 of them building or repairing the citation and
  record tooling, and roughly 60% of the spend in the orchestration history
  since 2026-09-20 went to `repo-` tickets (an estimate from the history rows'
  own cost fields). Of 132 "what the skill got wrong" items logged in that
  period, 63 concerned records, citations or landing.
- **It protected records, not products.** Every defect repo-29 reproduced was a
  defect in a record about a record — a citation onto a blank line, a drifted
  coordinate, a wrong file — and each arose during a live review, not by
  ageing. The review found no product defect that citation enforcement caught.
- **It taxed every later branch.** A line added above a cited line broke another
  ticket's merged record, so the loop grew rules to protect line numbers: append
  tests only at the end of a suite, make edits line-neutral, re-issue every
  earlier gate section on each re-gate, pin pre-existing content to the base,
  scratch-merge the whole batch to find citations two branches moved between
  them. In two batches every merge conflict was in a gate record and none was in
  source.

The same review counted gate rounds, over every `## Review` section committed to
the repository (253 sections, counted by severity bullet; a few older records use
other formats, so the counts are approximate):

| Gate round | Sections | Highs | Meds |
| ---------- | -------- | ----- | ---- |
| 1          | 153      | 18    | 91   |
| 2          | 53       | 6     | 26   |
| 3          | 27       | 0     | 7    |
| 4 or later | 20       | 0     | 3    |

Of the ten meds at round 3 or later, six were on one ticket, dl-58, and four of
those six were about the record itself: branch-sha pins, a non-verbatim
transcription, a missing section. dl-58 was the skill's standing argument against
capping gate rounds, and its six gates came from three things that are not
gating depth: an acceptance line widened mid-flight to "every string value",
which a gate can always falsify with one more shape; an owner decision left open
across three re-gates, which held a line "unproven" and the verdict at FAIL; and
record mechanics. Its sixth gate was a documentation-only PASS.

## Decision

1. **A gate record names the sha it gated, the spec file and the test's name for
   each acceptance line, and the file and symbol for each finding. It carries no
   line numbers and no commit pins.** It is a statement about one commit.
2. **Nothing checks a record after it lands.** `scripts/citations.mjs`,
   `scripts/citations-gate.mjs`, their suites, both CI steps, preflight's
   citations check and its scratch-merge citations probe, and the landing
   script's citation and pin checks are removed. Records written before this
   keep their citations as written and are not repaired.
3. **A ticket gets two gates: the first, and one re-gate scoped to the fix
   round. A third runs only when the re-gate itself raises a `high`.** A `high`,
   or a `med` a `Done when` line depends on, opens a fix round; every other
   finding is recorded and may land unfixed.
4. **Open decisions are answered before a re-gate**, and an acceptance line that
   says "every" is reworded to an enumerable scope before dispatch.
5. **A builder opens a draft pull request when its first build is pushed**, so
   CI runs while the gate works and the gate can read it. A pull request stays a
   draft until its records land, or while it is held for merge order.

## Consequences

- **A record can go stale and nothing will say so.** A reader who wants to check
  a row opens the named spec at the named sha. That is the cost accepted here:
  the row is still checkable by someone else, by name instead of by coordinate,
  and only as of the commit it names.
- **A wrong test name in a record is not caught mechanically.** The gate ran the
  test, the full report is on the pull request thread, and the builder's own
  verdicts are compared with the gate's before the record lands.
- **A `med` or `low` found at the re-gate can land unfixed**, recorded as found.
  dl-58's two later leak shapes, each with no live call site, would have been
  recorded rather than fixed under this rule.
- **The rules that existed to protect line numbers are gone**: append-only
  tests, line-neutral edits, re-issued sections, pin-to-base, the whole-batch
  citations merge. Preflight still probes every other open pull request for a
  plain merge conflict.
- **Open pull requests built under the old rules** carry records with citations
  and may touch the removed scripts. Their records land as written; a branch
  that edits `scripts/citations*.mjs` conflicts with this change and is closed
  or rebased by its owner.

## Not decided here

Whether the `mechanical` gate should be narrower still, and whether the Sonnet
gate should run at `high` rather than `xhigh`: both are trials, recorded in the
skill's `reference/model-pairing.md`.
