---
id: repo-38
tool: repo
title: Two governing documents disagree on who writes the Review section
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
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

`docs/01-TICKETS.md:294 "So the reviewer reports and the builder writes"`
(`:293` as originally filed; moved one line by this ticket's own build, see the
2026-09-09 Log entry) — the sentence finishes "the section down", and the
writer it names is **the builder**.

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

  `difficulty: standard` was set in this same move to `ready`, by the
  coordinator, not defaulted.

- **2026-09-09** — Built option A. Both cited line numbers still held against
  `origin/main` at dispatch (`.claude/skills/review-ticket/SKILL.md:113`,
  `docs/01-TICKETS.md:293`); re-checked with `grep -n` before editing either.

  `.claude/skills/review-ticket/SKILL.md` now states the rule: the builder — not
  "the caller" — commits the `## Review` section, verbatim, and discloses its own
  authorship. A new paragraph names the tradeoff directly (dispatcher and
  committer are two different sessions in a dispatched loop; the builder is the
  one already holding write access) and points at `docs/01-TICKETS.md` for the
  costed decision. The disclosure note is now stated as required, not a habit:
  say that you transcribed the section and name what you altered or dropped, even
  "nothing" — matching the ticket's Build step 1 instruction.

  **Wider than the single cited sentence, and here is why.** "The caller"
  described the committer in twelve base occurrences through the page (of
  fifteen total pre-edit) — the opening summary (`:15-20` pre-edit), two of the
  repo-1 narrative's three, both halves of step 7/8's procedure, the
  merged-bullet note in step 3, and the closing paragraph. Fixing only `:113`
  and leaving the other eleven would have left the same contradiction one level
  down: two statements in the _same_ file disagreeing about who commits, which
  is the exact defect this ticket exists to remove.

  **Three "caller" uses were left alone on purpose**, all genuinely about the
  _dispatching_ role rather than the committing one: the ticket-id/sha/range
  hand-off (`:93`), the historical "old wording" quote (`:137`), and, inside the
  repo-1 narrative itself, "the caller saw a correctly-formatted gate, believed
  it was recorded" (`:119` at the tip — that sentence's wording is untouched by
  this edit, only reflowed by the paragraphs added around it). `:119` reads as
  the dispatcher who oversaw the pre-fix process and was misled by it, not as a
  claim about who commits today, which is why it was left standing alongside
  `:93` and `:137` rather than folded into the eleven that changed. (Caught by
  the gate on this build, which read the diff and found this paragraph had
  undercounted the survivors as two and mis-filed `:119` among the changed
  places — corrected here rather than in a new round.)

  `docs/01-TICKETS.md`'s `:293` sentence stays exactly as filed. One sentence
  was added right after it, pointing at `SKILL.md` for the rule and the
  disclosure requirement, rather than restating either — per Build step 2. Left
  `:282`'s "the caller appends what comes back" alone: it predates and sits
  outside this ticket's two cited sentences, and touching it would have widened
  scope from a two-sentence fix into a document-wide terminology pass over a
  file this ticket does not own editing rights to beyond the one line.

  **Third document found stale by this change, and fixed rather than filed**
  (fold-in): `.claude/skills/orchestrate-tickets/reference/records.md` directly
  quoted the old SKILL.md phrasing — `"the caller commits the gate record
**verbatim**"` — as the thing a later splice threatens. That quote, and the
  "caller editing a reviewer's words" framing beside it, named the actor this
  ticket just renamed. Updated both to "the builder" and cited `(repo-38)` so a
  future reader knows why the quote does not match `SKILL.md` word-for-word (it
  was already a paraphrase, not a literal substring, before this edit).

  Checked for other stale references with
  `grep -rn "caller commits\|caller writes\|caller who summarises\|caller
appends"` across the repo: two hits were this ticket's own brief (quoting
  itself, fine to leave) and two were historical `docs/work/` Log entries
  (`repo-1`, `pl-5`) quoting wording as it stood at the time — append-only
  records, not live rules, left untouched.

  `.claude/agents/ticket-reviewer.md:83-86` already said "the builder writes the
  `## Review` section" before this ticket; it was not the outlier and needed no
  change. Its two remaining "caller" uses (`:153-154`) are about which model
  gates, unrelated to who writes the record.

  Gates run from a fresh worktree: `worktree-farm.sh` then `npm run build`,
  both green, before trusting anything else. Then `npm run format` — no
  additional diff, the three governing-doc edits plus this file stayed the only
  modified paths. Then `npm run check` exits 0 (measured with the exit code
  captured directly, not through a pipe). `node scripts/status.mjs --json`
  exits 0 and reports this ticket's own entry as `"status": "done"`. Ran the
  narrowest relevant suite twice: `npx vitest run --project repo` — **288
  tests, 6 files, all passed** — then `npx vitest run scripts/test/status.test.ts`
  alone — **108 tests, 1 file, all passed**. Did not run `npm test` in full:
  this ticket touched no shared config, only prose in three governing documents
  and the ticket file itself.

- **2026-09-09, later** — Gate on `c8e1f51` came back FAIL (2 med, 3 low). I
  reproduced every finding before acting on any of them.

  **Fixed, med** — `docs/01-TICKETS.md:282` said "the caller appends what comes
  back", five lines above "the builder commits the gate" and twelve above this
  ticket's own new pointer sentence — the one file left naming two actors for
  one act, and this branch is what removed the last governing document that
  still supported the "caller" reading, so it went from merely-imprecise to the
  sole surviving statement of it. Fixed by dropping the actor from the clause
  entirely rather than naming one, since the paragraph's subject is which model
  gates, not who commits: "what it returns is appended to the ticket without
  editing it — who does the appending is stated once, below, not here."

  **Not acted on, med** — `.claude/skills/orchestrate-tickets/reference/
dispatching.md:176` ("Verbatim transcription is nowhere in that rule")
  contradicts `SKILL.md`'s now-authoritative verbatim requirement. Confirmed
  real and pre-existing at `origin/main`, sharpened rather than created by this
  branch: `docs/01-TICKETS.md` now delegates the rule to `SKILL.md` by name, so
  `dispatching.md`'s claim resolves through that pointer into a page that
  requires verbatim four times. Reviewer correctly named this contract-adjacent
  and escalated it to the orchestrator as an open decision rather than asking
  either of us to settle it — verbatim transcription vs. completeness-of-receipt
  is a real tradeoff with measured evidence on both sides
  (`dispatching.md:186-197`), and neither a builder nor a reviewer gets to pick.
  Left both documents exactly as they stood.

  **Fixed, low** — the Log's survivor count was wrong: it said "two" `caller`
  uses were left deliberately and listed "the repo-1 narrative" among the
  places changed, when one of that narrative's three `caller` mentions
  (`.claude/skills/review-ticket/SKILL.md:119`, unchanged text, only reflowed)
  survived alongside its `:93` and `:137`. Corrected the count to three and
  named `:119`'s own reason — it reads as the dispatcher who oversaw the
  pre-fix process, not a claim about who commits today.

  **Fixed, low** — `node scripts/citations.mjs` on this ticket exited 1: the
  bare filename `SKILL.md` at line 113 in the Log's dispatch line was ambiguous
  across three tracked files of that name. Qualified it to
  `.claude/skills/review-ticket/SKILL.md:113`. Fixing `:282` above then moved
  `docs/01-TICKETS.md:293`'s sentence down to `:294`, which the checker caught
  as `MOVED` on the next run — this ticket's own Why-section citation
  (`:26` in this file) and re-cited it at `:294`, noting it was `:293` as
  originally filed. **Then repeated the same mistake writing this very entry**
  — three more bare `SKILL.md:*` coordinates, caught by re-running the checker
  rather than by care; qualified all three the same way. The reference count
  kept moving while this entry was being written, so do not trust a number
  recorded mid-edit — the number that matters is the one from the final run
  below, after every edit in this round landed.

  **Deferred, low, on the reviewer's own recommendation** — the pointer loop
  between `.claude/skills/review-ticket/SKILL.md:126` and
  `docs/01-TICKETS.md`'s disclaimer. Fixed anyway, since it was one sentence:
  `SKILL.md`'s tradeoff paragraph no longer points back to `docs/01-TICKETS.md`
  at all, so there is nothing left to loop with.

  Re-ran the full gate set after all five fixes: `npm run format` (no
  additional diff beyond the three touched files), `npm run check` exit 0,
  `node scripts/status.mjs --json` exit 0, `npx vitest run --project repo` —
  **288 tests, 6 files, all still passing** — and `node scripts/citations.mjs`
  on this ticket — exit 0.

- **2026-09-09, round 3** — Re-gate on `2bc8d9d` closed round 1's `med` and all
  three `low`s, and confirmed the round-1 `med` on `dispatching.md` is a live
  escalation neither of us settles. It also found what neither of us had run:
  the round-2 fix commit reddens CI.

  **Not acted on, high** — `node scripts/citations-gate.mjs --against
origin/main` exits 1 at this tip. `repo-29`'s own already-committed `## Review`
  section, at line 549 of its ticket file, cites `docs/01-TICKETS.md:293` with
  an anchor that now sits at `:294` — moved by this ticket's own Finding-1
  fix, which added a line above it. Reproduced the exit code, the mechanism,
  and that `c8e1f51` (before that fix) was exit 0 for the same command. This
  gate is not part of `npm run check` and is not in this
  ticket's own Done-when #4 — it runs separately in CI's `check` job, filtered
  by nothing, which is exactly why a documentation-only branch can turn it red
  while every gate this ticket names stays green. Holding per the reviewer's
  instruction and my own agreement: repairing a coordinate inside a different,
  already-committed ticket's gate record is contract-adjacent — this repo's own
  `records.md` is a whole passage warning against a later agent splicing a
  record it is not touching, and correcting a citation is a smaller version of
  the same act, done by an agent that record was never about. Not mine or the
  reviewer's to pick between repairing `repo-29`'s coordinate and shrinking
  `docs/01-TICKETS.md:282-286` back to its original height. Both options are
  with the orchestrator.

  **Fixed, low** — three `:138` coordinates written in the round-2 Log entry,
  citing `.claude/skills/review-ticket/SKILL.md`'s "old wording" quote, went
  stale by one line in the same commit: the Finding-5 fix removed a line above
  that sentence, from `:138` to `:137`, after the Log paragraph naming it as a
  deliberate survivor had already been written. All three re-cited at `:137`.
  This did not move any other line, so nothing downstream shifted again.

  **Fixed, low** — the round-2 entry's "21 references" was a count taken
  mid-edit, before the entry finished adding its own coordinates; the tip
  reported 37. Replaced the specific number with a pointer to the final
  checker run instead of a count restated by hand, so a future edit to this
  entry cannot make the same claim stale again.

  **Found while writing this entry, and worth a bullet of its own: a hand
  line-wrap, not `oxfmt`, broke a citation.** While drafting the `high` bullet
  above, I wrote the sentence with manual line breaks at roughly 80 columns to
  match the file's style, and broke `docs/work/repo-29-citations-carry-no-anchor.md:549` across two lines at the hyphen inside its own backticks. `node scripts/citations.mjs` then parsed the fragment after the break as its own citation attempt (`no tracked file matches`) and failed. I told the reviewer `oxfmt` had caused it. **That was wrong, and the reviewer caught it.** Reproduced myself before writing this: a 354-character single-line paragraph containing the same long `file:line` span, run through `npx oxfmt` both outside and inside this tree with its own config, comes back byte-identical — `oxfmt` does not wrap prose and does not rejoin a hand-wrapped line. The break was mine, made while composing the text of an `Edit` tool call, not a formatting side effect. **The rule, correctly attributed this time: never break a `file:line` inline-code span across a line, by hand or otherwise** — nothing here will rejoin it for you, so the only fix is not making the break in the first place, or, if a long span must sit inside a wrapped paragraph, naming the file and the line number apart in prose rather than as one inline-code token.

  Re-ran `node scripts/citations.mjs` on this ticket after all three fixes:
  **exit 0, 0 moved, 0 unresolvable** (reference and unanchored counts change
  every time this entry grows, so the number itself is not restated here —
  the checker's own output on the tip is the count, not this sentence). Did
  not touch `docs/work/repo-29-citations-carry-no-anchor.md` or
  `docs/01-TICKETS.md:282-286`'s height — both wait on the orchestrator.
  `npm run check`, `node scripts/status.mjs --json` and `npx vitest run
--project repo` (288/288, 6/6) all still green; `node
scripts/citations-gate.mjs --against origin/main` still exits 1, unchanged,
  because the `high` is deliberately untouched.
