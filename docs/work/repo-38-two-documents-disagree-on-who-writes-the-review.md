---
id: repo-38
tool: repo
title: Two governing documents disagree on who writes the Review section
kind: fix
status: ready
milestone: null
depends_on: []
---

# repo-38 — Two documents disagree on who writes the `## Review` section

**Packages:** `.claude/skills/review-ticket/SKILL.md` and `docs/01-TICKETS.md`.
One of the two, not both — which one is the decision.

## Why

Both documents govern the gate loop, both are read by agents in every review, and
they name **different people** as the writer of the record.

`.claude/skills/review-ticket/SKILL.md:113` "The subagent returns the" — the full
sentence is that the subagent returns the section as text and **the caller**
commits it to the ticket, verbatim.

`docs/01-TICKETS.md:293 "So the reviewer reports and the builder writes"` — the
sentence finishes "the section down", and the writer it names is **the
builder**.

**They agree on the negative and differ on the positive**, which is why nobody has
noticed. Both say the reviewer must not write it, both give the same reason —
a reviewer's worktree is discarded when it reports, so a section written there is
written into nothing — and both cite the same incident, `repo-1` going through
two gates that left no trace in the repo. Read quickly, they sound like one rule.
They are not: in a dispatched loop the **caller** is the orchestrator and the
**builder** is a third agent, and those are two different sessions with two
different views of the work.

### Why it matters, rather than being a wording slip

**The split exists so a reader can hold the record against the report.** The
reviewer's findings travel twice — as the committed `## Review` section, and as
the report posted to the pull request thread — and the value of having two copies
is that a third party can compare them. Whoever transcribes the section can
soften it, and the posted report is the only thing that would show it.

That defence depends on the transcriber not being the same agent whose work is
being judged. **Today it is.** The builder writes it, which is
`docs/01-TICKETS.md`'s reading, and the practice is visible in the corpus:
`docs/work/repo-30-the-id-sweep-cannot-see-repo-tickets.md:179 "The section above is the reviewer's own text"`
is one of three such notes on that one record, each disclosing what was and was
not altered. So the convention that actually runs is the disclosed-self-
transcription one, and `SKILL.md` describes something else.

**This is not a claim that today's behaviour is wrong.** The disclosure notes are
detailed, they name what was dropped, and at least one of them records the
reviewer volunteering a finding against itself. The argument for the builder
writing it is real: the builder has the tree in front of it and can re-resolve a
coordinate the reviewer got wrong, which those same notes show happening. The
argument against is equally real and is the one above.

## Decision — answered, 2026-09-08

**The owner has already ruled on the interim: keep today's behaviour — the
builder writes the section and discloses its own authorship — and file the
conflict rather than reconciling the two documents in passing** (2026-09-08).
So this ticket exists to hold the contradiction, not to remove it.

Which document changes is now answered too — **option A**, kept as filed below
because it is what the options were costed against; the answer and its
provenance are in the dated Log entry below, and this section is not the
record of it.

- **A. `SKILL.md` changes to say the builder writes it.** Cheapest, matches what
  runs today and what the corpus shows. Costs the independence argument above:
  the subject of the review is its transcriber, with only a posted report as the
  check.
- **B. `docs/01-TICKETS.md` changes to say the caller writes it.** Restores the
  independence, at the price of a convention nobody currently follows and an
  orchestrator round-trip on every gate.
- **C. Say both, explicitly, and name when each applies.** The caller writes it
  when there is one; the builder writes it in a two-agent loop with no
  orchestrator in the middle. Honest about the two shapes this repo actually
  runs, and the most words.

**Whoever answers should also say whether the disclosure note is required.**
Today it is a habit, not a rule — it appears three times on `repo-30` and on
nothing else — and under A it is the only thing standing between a
self-transcribed gate and an unchecked one.

## Build

**Startable: the decision is answered — option A.** The answer and its
reasoning are in the dated Log entry below; this section is not the record of
them.

1. `.claude/skills/review-ticket/SKILL.md` becomes the document that states the
   rule, at and around the `:113` sentence cited in "Why": the builder writes
   the `## Review` section and discloses its own authorship. State the
   disclosure note as required there, not as a habit: the builder must say
   that it transcribed the section and name what it altered or dropped from
   the reviewer's text.
2. `docs/01-TICKETS.md`'s `:293` sentence ("So the reviewer reports and the
   builder writes the section down") stays — it already names the builder —
   but gets a sentence pointing at `SKILL.md` as the place the rule and the
   disclosure requirement are stated, rather than leaving it to independently
   restate them, per this ticket's own instruction that the **other** document
   points at the rule instead of repeating it from memory.

## Done when

1. The decision is recorded here as a dated Log entry naming the option and the
   reasoning.
2. Exactly one of the two documents states the rule; the other names it and
   points at it rather than restating it.
3. Whether a transcription note is required is stated in whichever document holds
   the rule.
4. `npm run check` and `node scripts/status.mjs --json` exit 0.

## Log

- **2026-09-08** — Filed from repo-29's build, on the owner's instruction, with
  the owner's interim answer already recorded above: keep today's behaviour, do
  not reconcile the documents in that branch.

  **Both quotations were read from `origin/main` rather than relayed.** The
  coordinator that raised this gave both coordinates and both hold. What is new
  here is the shape: the two documents **agree** that the reviewer must not write
  the record and give the same reason, and differ only on who does — which is why
  a reader who checks one against the other comes away thinking they match.

  The `repo-30` transcription note is cited as evidence of the practice rather
  than of the rule. It is not the only one on that record — there are three — and
  no other record in the corpus carries one, which is itself the answer to the
  "is the note required" question this ticket leaves open.

- **2026-09-08, later** — **Answered by the owner, via `AskUserQuestion` in the
  dispatching session: option A**, over B (`docs/01-TICKETS.md` changes to say
  the caller writes it) and C (say both, and name when each applies). The
  owner took the recommended option; neither answer in this exchange overrode
  a recommendation. `SKILL.md` becomes the document that states the rule —
  the builder writes the `## Review` section and discloses its own authorship
  — and `docs/01-TICKETS.md` gets a sentence pointing at it instead of
  independently restating it.

  **Second answer, same exchange: the disclosure note is required**, and the
  rule belongs in whichever document holds A, i.e. `SKILL.md`. Before this
  answer the note was a habit — observed three times on `repo-30` and nowhere
  else in the corpus; the requirement is what makes A defensible rather than
  merely cheapest, carrying the independence cost the Decision section states:
  the subject of the review becomes its transcriber, with only the posted PR
  report left as an independent check.

  `status` moves from `needs-decision` to `ready`. Nothing is implemented
  here, deliberately — this entry and the Build section above record the
  decision; editing `SKILL.md` and `docs/01-TICKETS.md` is the next builder's
  job, not this dispatch's.
