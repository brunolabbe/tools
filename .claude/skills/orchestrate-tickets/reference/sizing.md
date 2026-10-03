# Size the process to the ticket

Running the loop identically over a one-line fix and a seventeen-file change is
the largest source of waste, and each individual round looks reasonable.

## What a batch pays for

**Cost is requests times context size.** Cache reads are most of every bill, an
agent's context grows with every turn, and every turn re-reads all of it. So:

- **Rounds cost more than gates.** A resumed builder re-reads its whole
  transcript on every turn however small the fix. Batch every finding of a gate
  into one relay, and end the last relay with conditional ship authority
  ([dispatching.md](dispatching.md)).
- **Turns cost more than tokens.** One plain command per call is the sandbox's
  rule, so an agent that needs a script writes it to a file and runs it once.
- **Gates past the second have not paid.** Across 253 recorded gate sections,
  rounds 3 and later found no high; `SKILL.md` step 8 is the rule that follows.
- **A gate on the same brief re-derives the first.** A second reviewer is worth
  dispatching only for a second kind of setup.

## Some work needs no gate

- **Filing a ticket that records a defect**: require the builder to reproduce
  the defect before writing it up, and the reproduction is the verification.
- **Maintenance**: a rebase, a merge from `main`, one Log edit.

Everything that touches `scripts/`, `packages/` or a tool's source gets a
reviewer.

## Slice a blocked ticket

A ticket whose open question a builder may not settle is usually blocked in part,
not in whole, and it often says which part: a Build step marked unconditional
("regardless of what is decided below"), a recommended ordering, or a step whose
deliverable is a measurement — do that one yourself.

The dispatch for a slice carries:

- **The boundary and its reason**, quoting the ticket's own "do not settle it
  here" heading. A boundary without its reason gets helpfully exceeded.
- **How it ends: by splitting.** When the record lands, the ticket goes `done`
  and the unbuilt half is filed as its own ticket, carrying the decision, the
  cost that came with it and the objection the chosen option has to meet.
- **What to surface**: "if landing this forces a behavioural answer to the open
  question, say so as an open decision rather than picking one." A slice can de
  facto answer the question it was supposed to hold.

Ask the held decision immediately; the answer is cheap only while the builder
lives. And tell the gate which acceptance lines belong to the unbuilt half.

## Fold it in, or file it

The rule is repo-wide and lives in `docs/01-TICKETS.md`: a ticket carries a
decision or a reproduction, and work with neither left gets done in the commit
at hand. The orchestrator is the one who has to catch it, because a builder told
"do not widen" will file a 58-line brief for a one-line change.

Three tells, cheap to check at relay time:

- the Build section's output is a single line or a single frontmatter field;
- the blocking reason is already gone, most sharply when this branch removed it;
- the ticket's own Why explains why it was not folded in.

Folding in costs one message to an agent that is alive. Filing costs an intake
slot, a dispatch, a gate, a pull request and a merge, paid later by someone with
none of the context. When you fold in a ticket that is already committed, mark it
`done` and rewrite its Log to say so; do not delete the file.

**The inverse still holds**: a ticket that records a *defect* is worth filing
even when the fix looks small, because the reproduction is the deliverable.
