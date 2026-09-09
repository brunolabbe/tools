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

`docs/01-TICKETS.md:351 "So the reviewer reports and the builder writes"`
(`:293` as originally filed; `293` → `294` → `349` → `350` → `351` across four
rebases and rounds since, per the 2026-09-09 Log entries) — the sentence
finishes "the section down", and the writer it names is **the builder**.

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

## Review

**Gate: PASS** — 2026-09-09 · round 6, `origin/main...2371b5b` (rounds 1-5: `c8e1f51`, `2bc8d9d`, `1cc4a87`, `0c553e7`, `0635578`) · defect hunt run in-context at medium

Every finding across six rounds is resolved or dropped; nothing is carried. One item below is informational and belongs to the orchestrator, not to this branch.

**No coordinate cites this ticket's own file, deliberately** — a `## Review` section that cites its own file is structurally indistinct and fails CI, which is the `med` that round 5 raised and this branch then wrote down. The acceptance rows name their evidence by date and heading instead.

| Done when                                                                                             | Proof                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Decision recorded as a dated Log entry naming the option and the reasoning                         | **verified** — the Log entry dated 2026-09-08, later names option A over B and C with the reasoning, and its second paragraph names the disclosure answer. A second entry, 2026-09-09 owner's rulings, records both escalated decisions with their provenance         |
| 2. Exactly one document states the rule; the other names it and points at it rather than restating it | **verified** — `grep -c caller docs/01-TICKETS.md` is 0; `docs/01-TICKETS.md:339 "what it returns is appended to the"` names no actor, and `docs/01-TICKETS.md:352 "The rule itself, and the"` points at the page that states it                                      |
| 3. Whether a transcription note is required is stated in whichever document holds the rule            | **verified** — `.claude/skills/review-ticket/SKILL.md:143 "The disclosure note is required, not a habit"`                                                                                                                                                             |
| 4. `npm run check` and `node scripts/status.mjs --json` exit 0                                        | **verified** — reproduced at `2371b5b`: both exit 0, plus `--project repo` 288 tests across 6 files, `oxfmt --check` exit 0, and `citations-gate.mjs` exit 0 with and without `--against origin/main`; both halves of the status gate watched failing first at exit 1 |

- **resolved** · round-5 `med`, the carve-out's non-working repair. `.claude/skills/orchestrate-tickets/reference/dispatching.md:229 "Repairing that means not citing"` now drops the full-path prescription, states that a full path does not help and why, and keeps only the repair that works. Both agents reproduced the full-path case independently at `anchor starts on 2 lines`, `1 anchor(s) not distinct`; a cross-file citation in the same probe passed and the page now says so.
- **resolved** · round-1 `high`. `docs/work/repo-29-citations-carry-no-anchor.md:549 "So the reviewer reports and the builder writes"` is repointed by one character, touching nothing else in that record. Both forms of the gate exit 0 at `23 enforced, 0 failing` with no record named, after four rounds at exit 1 with that record named. **Severity note for the next reader:** this was called `high` against the letter of the table, which would have said `med`, because it fired unconditionally on push and no gate this ticket's own acceptance names could see it. The stretch is why it was repaired rather than merged red.
- **resolved** · round-1 `med`. `.claude/skills/orchestrate-tickets/reference/dispatching.md:171 "Tell the reviewer to send a"` now instructs what that section previously forbade, agreeing with `.claude/skills/review-ticket/SKILL.md:113 "the builder commits it to"`. Both 2026-09-03 measurements survive intact — every concrete fact, citation and quoted test name — and only the evaluative conclusion drawn from one of them was reversed, which is what the ruling licenses.
- **resolved** · round-5 `low`. The Log now carries both owner rulings with provenance, the orchestrator's two supporting measurements, the builder's own wrong first prescription and who caught it, and why the correction would not trim below the size it was asked to hit.
- **resolved** · rounds 2-4, five `low`s: three coordinates one line short, an ambiguous bare file name, a pointer loop, an unrecorded finding with a misattributed mechanism, and a reference count that went stale three times before being dropped. Each settled by `node scripts/citations.mjs` on the ticket at exit 0, 0 moved, 0 unresolvable, and by reading the fix at the tip.
- **shape, informational, for the orchestrator** · Three branches in this batch independently broke the citation in `repo-29`'s gate record, each by adding a line above the sentence it names in `docs/01-TICKETS.md`. Verified directly rather than relayed: the `repo-32-done-hides-obligation` branch rewrites the same line of the same record to a different value than this branch does, so the two conflict on that line and neither value survives both merging. Sequencing and the sibling briefs are the orchestrator's, not this branch's.
- **dropped** · the `records.md` fold-in quote adds bold around _verbatim_ absent from the source; inherited convention, disclosed. Not a defect.
- **dropped** · `status: done` set before the gate record lands. Reproduced that `ready` plus a Review section exits 1, so `done` is correct here and `ready` would go red.
- **dropped** · two stale coordinates in `sizing.md`; pre-existing and outside this diff. A third, in `dispatching.md`, was fixed in passing during round 5.
- **findings** · defect hunt run in-context at medium across six rounds returned 15; 0 carried, 12 resolved between rounds, 3 dropped.
- Invariants: no tool code, contract, `Dockerfile`, test registration or TypeScript in this diff, so the tool-isolation, `AppError`, shell, process-tree, redaction, SSRF, progress, test-registration, image-closure and style rules are all not applicable and were not checked further. The rules that do apply — a record is appended not rewritten, and a ticket carries its decision — are checked above.
- NFR: security n/a · performance n/a · reliability — CI green at this tip, both gate forms reproduced · maintainability — the governing documents now agree, and the rule they agree on is stated once.

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

- **2026-09-09, owner's rulings** — Both open decisions this ticket's gate
  exchange escalated are answered by the repo owner, relayed by the
  orchestrator with provenance for each, since neither agent in this exchange
  can verify authority from inside its own sandbox.

  **Ruling 1, on the `high`: repair the coordinate (option a).** Options put
  to the owner were the two the reviewer framed: repoint the citation inside
  the other ticket's own already-committed gate record, or shrink the
  paragraph that moved it back to its original height. The owner chose to
  repoint it, matching the reviewer's own recommendation. Two supporting facts
  the orchestrator measured and put to the owner alongside the question: the
  splice warning this repo's own records reference carries is about softening
  a verdict, not correcting a coordinate; and a sibling branch in the same
  batch already does the identical repair to the identical file, unremarked.
  Repointed the one citation, touching nothing else in that record. Both forms
  of the citation gate went from exit 1, naming that record, to exit 0 with
  nothing named — reproduced independently by both agents in this exchange.

  **Ruling 2, on the `med`: verbatim wins (option a of the reviewer's three).**
  `.claude/skills/orchestrate-tickets/reference/dispatching.md`'s "Send the
  findings in full; the builder writes the section down" section had argued
  the opposite of what this ticket just settled — that verbatim transcription
  was nowhere in the rule. Corrected it: the reviewer's returned section is
  what gets committed, unedited; completeness governs a different, earlier
  question, what has to reach the builder before it commits anything. Both
  measured historical examples that section carried were kept intact —
  every concrete fact, every citation, every quoted test name — and only the
  evaluative conclusion drawn from one of them ("the section was correct") was
  reversed, which is what the ruling licenses and nothing more.

  Folded in the evidence the orchestrator asked for: a self-citing `## Review`
  section fails the distinctness check even when transcribed verbatim, because
  the anchor-occurrence count runs over the whole file with no exclusion for
  the line doing the citing. Verified the mechanism myself in
  `scripts/citations.mjs` before writing it down, and initially wrote the wrong
  first-listed repair for it (a full path in place of a bare line number) —
  the reviewer reproduced that a full path does not change the occurrence
  count and stays indistinct, and corrected it to the repair that actually
  works: not citing the ticket's own file at all. Fixed in the same file.

  **Tried twice to trim the `dispatching.md` correction below the "paragraph
  or two" the orchestrator asked for, and it did not shrink.** Both attempts
  landed back near the same size, because leaving either historical example's
  stated conclusion standing would have left the section directly
  contradicting the rule it was being corrected to state — an internally
  contradictory governing document being a worse outcome than a longer diff.
  Flagged the size to both the reviewer and the orchestrator before
  proceeding rather than deciding alone that it was fine; the reviewer read
  the whole section afterward and said it had not drifted and would not have
  trimmed it further.

  Gates re-verified at each step: `npm run check` exit 0, `npx vitest run
--project repo` 288/288 across 6 files, `node scripts/status.mjs --json`
  exit 0, and both `node scripts/citations-gate.mjs` and the same command with
  `--against origin/main` at exit 0 with `23 enforced, 0 failing` and nothing
  raised — the condition that had failed every round since it first
  appeared.

- **2026-09-09, rebase** — `origin/main` moved to `239de07` while this branch
  sat gated: repo-32 (#204), repo-42 (#205), repo-43 (#206), repo-41 (#207) and
  the history row (#209) all merged first. Rebased onto it. One conflict, in
  `docs/work/repo-29-citations-carry-no-anchor.md`, at the exact citation this
  ticket had already repointed once — resolved by applying the owner's second
  ruling below directly in the conflict, rather than picking either side.

  **The owner ruled a third time in this exchange, relayed by the orchestrator
  with provenance**, since neither builder nor reviewer can verify authority
  from inside its own sandbox. Put to the owner: the sentence
  `docs/01-TICKETS.md`'s "So the reviewer reports and the builder writes the
  section down" had been cited by line from committed `## Review` sections in
  three separate tickets, moved four times in two days (`293` → `294` → `349`
  → `350`), and cost a rebase's worth of repair each time a sibling touched
  the paragraph above it. Options were: file a separate ticket; fold a fix
  into this rebase; leave it. **The owner chose to fold it in here.**

  The orchestrator's first proposed mechanism — cite by section or anchor name
  instead of by line — turned out not to be representable:
  `scripts/citations.mjs`'s `DECLARED_LOCATION` pattern requires a line number
  in all four recognised citation forms. Re-put to the owner, corrected. **The
  owner's actual ruling: strip the `file:line` from the two citations that
  name this sentence — `docs/work/repo-29-citations-carry-no-anchor.md:549`
  and `docs/work/repo-32-done-can-hide-an-outstanding-obligation.md:193` — and
  restate the reference in prose that names no line.** Done, identically in
  both records: `` `docs/01-TICKETS.md`'s "So the reviewer reports and the
builder writes the section down" sentence ``, with the four-value history
  parenthesised so a future reader does not mistake a missing coordinate for
  an oversight. No verdict, finding, severity, row or measurement in either
  record was touched — confirmed by re-reading both records' `## Review`
  sections end to end after the edit, not just the two changed lines.

  **The cost, recorded explicitly because that is the whole value of the
  trade: those two citations lose mechanical verification permanently.**
  Neither will ever again be checked by `citations.mjs` for whether it still
  points at the sentence it names — a future edit to `docs/01-TICKETS.md`
  could delete that sentence outright and nothing here would notice. That is
  what the owner accepted in exchange for the coordinate no longer being able
  to rot. A future reader who wants that sentence checked again would need to
  restore a `file:line` form and accept the churn back with it.

  **Re-derived the coordinate rather than copying `351`.** The orchestrator's
  own arithmetic said 351 and explicitly warned not to take it on faith — the
  last two "obvious" values in this exact chain were both wrong, each correct
  only against a tree that did not yet contain the next sibling's edit.
  `grep -n` then `grep -c` on the rebased tree: line 351, count 1. The number
  was right this time, but arrived at rather than accepted — and turned out
  not to be needed for the two owner-ruled citations at all, since those no
  longer carry a line. It was still needed elsewhere: this ticket's own `##
Why` section (`:294` before this entry) and
  `.claude/skills/orchestrate-tickets/reference/dispatching.md`'s citation of
  the same sentence in its own prose (`:294` before this entry, outside any
  `## Review` section and so never gate-enforced, but a live claim in a
  governing document all the same). Both repointed to `:351`, uniqueness
  verified with `grep -c` first. This ticket's own `## Why` section now also
  records the coordinate's full history (`293` → `294` → `349` → `350` →
  `351`) rather than the single hop it noted before, since one hop was no
  longer the whole story.

  **Fold-in, found while re-checking rather than assumed clean:** this
  ticket's own committed `## Review` section carried two citations into
  `docs/01-TICKETS.md` at coordinates the merged siblings had also moved
  (`:282` → `:339`, `:295` → `:352`) — a defect the coordinator's own
  instructions anticipated ("re-resolve your own committed section's
  citations: five branches have merged since it was written") rather than one
  found independently. Repointed both, verified unique first, re-ran the
  section-scoped checker after: `7 verified, 0 moved, 0 unanchored, 0
unresolvable, 0 unchecked — exit 0`.

  **Found and reported, not fixed, per instruction:**
  `docs/work/repo-41-next-id-cannot-see-a-pushed-branch-with-no-pr.md`'s Log
  (lines in the high 440s and 490s, not a `## Review` section, so
  citations-gate does not enforce it) narrates this exact coordinate's churn
  in detail — a table of the four prior values, a sentence naming repo-29's
  record and its line as now citing `:350`, and "Whoever merges after this
  branch will get 350 wrong too, and should re-derive rather than copy it from
  this table." All of that was true when repo-41 wrote it. Once
  this branch merges, repo-29's citation no longer carries any line number at
  all, so repo-41's narrative will describe a state that no longer holds —
  not wrong about what happened, but read against the tree as it will be, it
  overstates how the story ends. Left entirely untouched, per instruction: a
  committed Log entry is not edited by a later, unrelated branch, and this
  observation is not this branch's decision to act on.

  **Re-ran everything named in the acceptance, reading the failing record's
  name rather than trusting the exit code alone** — the specific habit
  `repo-41`'s builder is credited with, and the reason the instruction bears
  repeating: `npm run check` exit 0; `npx vitest run --project repo` — 313
  tests across 6 files, all passed (the count moved from 288 because the base
  moved, not because anything here added tests); `node
scripts/citations-gate.mjs` exit 0, `27 enforced, 0 failing` (up from 23,
  because more sibling tickets are now enforced too, not because anything
  here changed); `node scripts/citations-gate.mjs --against origin/main` exit
  0, same count, `0 raised`. No record named in either failing list, because
  neither failed.

  Force-pushed `repo-38-review-writer` after the rebase (old tip `12856ab`,
  new tip below) and left the PR open, per instruction not to merge. Sha
  mapping and the history-rewrite note are in the PR thread, not repeated
  here.
