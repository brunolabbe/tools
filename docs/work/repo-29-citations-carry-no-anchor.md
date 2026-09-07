---
id: repo-29
tool: repo
title: Most citations carry no anchor text, so nothing checks what they claim
kind: chore
status: ready
milestone: null
depends_on: []
---

# repo-29 — Most citations carry no anchor text

**Packages:** `docs/work/`, `tools/*/docs/work/`, and — under one of the options
below only — `.github/workflows/ci.yml`.

## Why

`scripts/citations.mjs` resolves a `file:line` citation two different ways
depending on whether the citation was written with a fragment of the line beside
it. With one, it checks the claim. Without one, it checks only that the file has
that many lines. The script says so itself, and prints the unanchored ones for a
human to judge — the honest fallback, and not a verification:

`scripts/citations.mjs:25` "still resolves, and is reported as"

**The corpus is almost entirely the second kind.** Measured at `b142a4a` over
`git ls-files 'docs/work/*.md' 'tools/*/docs/work/*.md'` — 107 records, every one
of which carries at least one citation:

| State               | Count |
| ------------------- | ----- |
| verified            | 26    |
| moved               | 29    |
| unanchored          | 1,036 |
| unresolvable        | 155   |
| **total citations** | 1,246 |

70 of the 107 records carry at least one unanchored citation; 8 carry at least
one `moved`. The 155 unresolvable are **not** classified here — some are the
deliberate evidence class described below, and some are rot; separating them is
repo-25's mechanism, not this ticket's measurement. The script's own docblock
still says `965`, which is what the corpus held when repo-18 wrote it: the
denominator grows with every gate record, so any option that scales with the
corpus gets more expensive the longer it waits.

**Beware the pathspec.** `tools/*/docs/work` as a bare git pathspec matches
**zero** files — git's default wildcard spans `/`, so the glob has to end at a
file, not a directory. A combined pathspec written that way silently returns only
`docs/work`'s 26 records instead of 107, with no error, and that is exactly how
repo-25's builder lost every corpus figure it first reported. Always spell the
`*.md`.

### The reproduction — two real failures from PR #169

Neither was catchable by reading carefully. That is the argument.

**1. A citation stale on `main` that the checker calls clean.** dl-40's Why
section cites line 107 of `tools/downloader/contract/src/media.ts` for
`MediaVariant.language`, and line 26 of `tools/downloader/web/src/lib/variants.ts`
for `shortCodec` (record lines 43 and 51). Both were already stale before that
branch existed. On `main` today:

- `tools/downloader/contract/src/media.ts:107` "container?: string | undefined"
  is what line 107 actually holds. `language` is at
  `tools/downloader/contract/src/media.ts:121` "language?: string | undefined",
  and again at `tools/downloader/contract/src/media.ts:68` "language: string".
- `tools/downloader/web/src/lib/variants.ts:26` "videoCodec: string" is what line
  26 actually holds. `shortCodec` is at
  `tools/downloader/web/src/lib/variants.ts:40` "function shortCodec".

The branch then edited both files and pushed the true locations further away
without touching the pointers. Running the checker over the record as filed:

```
$ node scripts/citations.mjs tools/downloader/docs/work/dl-40-twenty-rows-that-differ-invisibly.md
0 verified, 0 moved, 8 unanchored, 0 unresolvable — of 8 citations
$ echo $?
0
```

Both of the two above are in that run, each printed as `unanchored` with the
wrong line's content underneath it. **The per-citation lines are cut from this
block rather than doctored** — reproducing them verbatim would put two more
unanchored citations into this very ticket, which is the joke this page is
written to avoid.

Exit 0, no `moved`, nothing to notice. Fixed on that branch by repointing **and
anchoring**, after which the same two report `verified`.

**2. A line quoted as content it did not contain.** dl-40's reviewer read a
multi-line `sed -n '105,110p'` block and attributed line 105's content to line
107, with the same off-by-two on the other file. The coordinate was cited, the
quote was wrong, and it travelled through an orchestrator's relay before a
builder caught it by hand. An anchor makes that class impossible — the fragment
is resolved against the line, not asserted beside it.

**The general form: an unanchored coordinate that is wrong reads exactly like one
that is right.** Reading carefully catches an instance. Anchoring catches the
class. That is the whole of the gap, and it is why this is worth a ticket rather
than a fix in passing.

### Three more, from live work rather than a retrospective sweep — 2026-09-07

Added after this ticket's decision was answered, and **deliberately not folded
into the options above**: they change nothing about which option was chosen. They
are here because they answer the strongest objection to the evidence this page
already carries.

**The evidence above is retrospective** — a sweep over records that were already
finished, where "these went stale over time" is the natural reading and "nobody
was being careless, the coordinates simply aged" is a fair defence. **These three
are not that.** All three were produced inside a single ticket's review cycle on
the same day, on a branch where both participants were being unusually careful,
and **all three still got past two agents**. They were caught only because
somebody ran `scripts/citations.mjs` by hand.

From dl-43's review cycle. **The coordinates below are as measured on that
branch, which is unmerged, so they are named in prose rather than cited** — a
`file:line` into an unmerged branch does not resolve repo-relative and would fail
this ticket's own checker:

1. **A citation landing on a blank line.** The gate cited line 251 of
   `contract-schemas.test.ts`; the test it was pointing at starts at line 252.
   Off by one, onto a line with no content at all. An anchor makes this
   impossible — there is no fragment to find on a blank line — while unanchored it
   resolves, because the file has that many lines, and reports clean.
2. **and 3. Two citations ambiguous between a downloader file and a planner file
   of the same name**, which resolved against the wrong tree until they were
   qualified with full paths.

**The second class is structural here, and it is measurable on `main` today
rather than only on that branch.** Comparing basenames across the two tool trees
— `git ls-files 'tools/downloader/*'` and `'tools/planner/*'`, reduced to
basenames — **41 names exist in both**, among them `errors.ts`, `index.ts`,
`config.ts`, `context.ts`, `logger.ts`, `events.ts` and `logging.test.ts`. So an
unqualified basename plus a line number is ambiguous across a large and growing
set of exactly the files a review is most likely to cite, and the repo's own
"a tool never imports from another tool" rule guarantees the duplication will
continue. Three of the four `moved` citations on this very page are in that
category of file.

**Why this is evidence for this ticket rather than a new one.** It is the same
argument, not a second one: the citations were _produced wrong_ rather than
_aged wrong_, which strengthens the case for enforcement without changing what
enforcement should be. And nothing in flight closes it — **repo-21's branch adds
a CI step reading `node scripts/citations.mjs
.claude/skills/orchestrate-tickets/SKILL.md --require-anchors`, which is
`SKILL.md` alone** (read from `refs/heads/repo-21-orchestration-skill-loop`, not
relayed; that branch is unmerged, hence prose). So `docs/work/`'s records stay
unchecked in CI whichever way repo-21 lands, and the gap these three fell through
is exactly the corpus-wide enforcement option C describes and which the owner has
now named as the destination.

## Decision — answered 2026-09-07, not open

**The question was:** which of four options does this repo take — anchor on
touch (A), a one-time sweep of all 1,036 (B), corpus-wide CI enforcement (C), or
anchor and enforce only the `## Review` gate records (D)? And, because the
ticket asked for it explicitly, **is C the intended destination, so that D is
built as a first slice rather than as a boundary?**

**The answer, from the owner, relayed through the orchestrator: D, then A — and
yes, corpus-wide enforcement (C) is the intended destination.** Both halves are
load-bearing and the second is the one a builder will otherwise guess at. It was
this ticket's own recommendation, so it overrode nobody. Recorded 2026-09-07;
**nothing below has been built.**

**D is a first slice of C, not a boundary.** So the wiring D adds is to be
written as something C can widen — one enforcement path that later takes a
larger scope — rather than as a rule about `## Review` sections that would have
to be unpicked. The `--section Review` scoping is the _scope_ of the first
slice, not the _shape_ of the mechanism.

**B stays open, and is not rejected.** It remains the right answer if a sweep
can be shown to pick distinctive anchors — and **that measurement is one nobody
has taken.** Recorded as still open rather than closed: whoever takes it should
take the measurement first, because the objection to B is not its size.

**Carry the objections with the answer:**

- **D's own cost, in this ticket's words: it draws a line that has to be
  explained and defended.** A wrong coordinate in a Why section misled a whole
  dispatch in reproduction 1 above, and **D would not have caught it.** A covers
  that case only by convergence, and A never reaches a record nobody touches.
  That gap is the reason C is the destination rather than the ceiling.
- **A's cost is that "expected, with nothing enforcing it" is how the present
  state arose.** A is doing real work here — it is what covers everything
  outside `## Review` until C lands — and it is the half most likely to be
  quietly dropped.
- **C cannot land before its scope is anchored**, or every affected record fails
  at once on the first push. That constraint is unchanged by this answer; naming
  C as the destination is not permission to wire it early.

**One fact that changed after this ticket was filed, verified 2026-09-07 rather
than relayed: repo-25 has merged** (PR #168; its ticket reads `status: done`, and
`citations.mjs` carries the `citations: evidence` declaration on `main`). The
dependency written in prose below as "do not start before it merges" is
therefore satisfied. The consequence for this ticket is the one its option C
already states: **an enforced gate must be built on that declaration mechanism,
not beside it** — and the mechanism now exists to build on.

`depends_on` stays `[]`. The reasoning is in "Two dependencies, deliberately in
prose" below and it still holds: a `depends_on` naming a ticket absent from a
branch's base fails the board gate, and prose is how this ticket carries the
constraint instead.

The reasoning that produced the question stands, and is kept because it is what
makes the answer legible:

**Four options. They are not exclusive: A is a floor the others sit on, and D is
a scoped C.**

### A. Anchor on touch — chosen, as the floor under D

A citation gains an anchor when it is next written or edited; nothing changes
today and the corpus converges as records are worked.

- Cheapest by a wide margin. No migration, no flag day, no coordination with any
  open branch.
- Never reaches a record nobody touches, and most of the 70 are finished work
  that nobody will touch again.
- **"Expected, with nothing enforcing it" is how the present state arose.** The
  anchor grammar has existed since repo-18 and the corpus went from 965 citations
  to 1,246 with 26 of them verified.

### B. One-time sweep — not chosen, and explicitly still open

Anchor all 1,036 in a migration.

- Complete, verifiable in one command, and it makes C safe immediately.
- The largest single mechanical change `docs/work/` has ever taken, touching 70
  records including finished ones — every one of which is somebody's committed
  record of a gate.
- **The real risk is a bad anchor, not a big diff.** An automated anchor that
  picks a non-distinctive fragment verifies nothing while reporting `verified`,
  which is worse than the unanchored state it replaced — the existing note that
  `"const"` appears on every line and proves nothing is the worked example. A
  sweep needs a distinctiveness rule and a way to report where it could not find
  one.
- Anchoring a stale citation also forces repointing it, so the sweep is not
  purely mechanical: it will surface an unknown number of real errors of class 1,
  each needing judgement. That is a benefit and a cost estimate problem.

### C. Enforce in CI, corpus-wide — not chosen now; named as the destination

Wire `node scripts/citations.mjs … --require-anchors` into `.github/workflows/ci.yml`
over every work record. **This is the option that needs the most care, and it
cannot be taken first.**

- `--require-anchors` already exists (repo-18), and it changes the exit code
  only — a citation's state is the same fact either way, which is what keeps this
  a policy question rather than a redefinition.
- **It cannot land before the corpus is anchored**, or all 70 records fail at
  once on the first push. The script's docblock says as much —

  `scripts/citations.mjs:55` "fails every run against all 965 citations"

  — so C without B (or without D's smaller B) is not an option, it is an outage.

- **This repo has deliberately unresolvable citations, and they are not a
  defect.** repo-21 carries two on purpose — a quoted false positive it exists to
  delete, and a reviewer's own mis-citation that its dispositions table refutes;
  repo-18 carries the quoted `unknown option` output of a broken run. Repointing
  any of them destroys the evidence. repo-25 (PR #168) ships the mechanism for
  exactly this, a `<!-- citations: evidence ... -->` declaration that is itself an
  error when it excuses nothing, so the waiver cannot rot into a rubber stamp. An
  enforced gate must be built on that mechanism, not beside it.
- The step belongs in the `check` job, which is filtered by nothing and so sees a
  markdown-only change, beside the board gate that is already there:

  `.github/workflows/ci.yml:115` "node scripts/status.mjs --json"

### D. Enforce where a citation carries a verdict — chosen, as the first slice

Anchor and enforce only the `## Review` gate records — the citations that name
the test proving an acceptance line — using the `--section` flag the script
already has, and leave narrative Log citations on option A.

**Measured, same sweep, `--section Review`:** 46 of the 107 records have a
`Review` section; they hold 418 citations, of which **353 are unanchored across
42 records**. So D is 34% of B's migration and 60% of its records, and it covers
the citations whose whole job is to be checkable by someone else —
`docs/01-TICKETS.md` requires a gate row to name a test file and a line rather
than "covered", which is a claim about a line's content and precisely what an
unanchored citation fails to carry. (Its worked example is not reproduced here:
it is an illustration, the checker parses it as a real citation, and repo-21's
build step 2 exists to reword the identical false positive out of a skill page.)

- The cheapest thing that actually enforces anything.
- Draws a line that has to be explained and defended: a wrong coordinate in a Why
  section misled a whole dispatch in reproduction 1 above, and D would not have
  caught it.
- Adds a per-record `--section` invocation to CI rather than one command over a
  glob, which is more wiring than C.

**Recommendation was: D, then A, with B and C held open.** D buys the
enforcement where a citation is load-bearing, at a third of the migration, and it
is the only option whose cost has been measured against the corpus rather than
estimated. A covers the rest at no cost. B remains the right answer if the sweep
can be shown to pick distinctive anchors — that is a separate measurement nobody
has taken. **Whoever answers this should also say whether C is the intended
destination**, so D is built as a first slice rather than as a boundary.

**The answer took the recommendation, and answered the destination question:
D, then A; C is the destination; B stays open on the unmeasured
distinctiveness question.** See the Decision heading above.

## Two dependencies, deliberately in prose

`depends_on` is `[]` and must stay that way while these two are unmerged: a
`depends_on` naming a ticket absent from this branch's base makes
`node scripts/status.mjs --json` exit non-zero, and that is the CI board gate —
`docs/01-TICKETS.md:160` "the view; every ticket still renders, and only".

- **repo-25 (PR #168) — ~~open~~ merged 2026-09-07, so this constraint is
  discharged.** It ships the `<!-- citations: evidence ... -->` declaration, the
  exit-code bitmask (`1` unresolvable · `2` moved · `4` unanchored under
  `--require-anchors` · `8` a wrong declaration), and the shorthand/paragraph
  rule. Anything here builds on all three. ~~Do not start before it merges.~~
  Verified on `main` rather than relayed: its ticket reads `status: done` and
  `citations.mjs` carries the declaration.
- **repo-21 (unbuilt, `status: ready`)** already proposes wiring
  `citations.mjs --require-anchors` into the `check` job — scoped to one file,
  `.claude/skills/orchestrate-tickets/SKILL.md`, in its build step 3:

  `repo-21-the-orchestration-skill-outgrew-its-loop.md:250` "Scope it to"

  **That is option C arriving from another direction**, and whichever lands
  first constrains the other: if repo-21 lands first, this ticket generalises its
  step and inherits its comment convention rather than adding a second one; if
  this ticket takes C or D first, repo-21's step 3 becomes redundant and should be
  dropped from its brief rather than built twice. Neither can be built in
  ignorance of the other.

### One interaction from repo-25's findings

A **wrong-file shorthand inheritance** is reachable on the live corpus — a bare
`:181`-style shorthand that inherits the file from a nearby qualified citation can
inherit the wrong one, and then reports `unanchored` with unrelated content
underneath. repo-25's reviewer reproduced this independently on a repo-23 record
and **accepted it as shipped**: resetting the inherited file at a heading was
declined with a measurement — 94 of 465 cross-heading resolutions, nearly all
correct — so a heading reset would refuse far more good references than it
catches. The per-citation provenance (`named at record line N`) is the mitigation.

**An anchoring policy interacts with this directly, and it cuts the good way**: an
anchored shorthand that inherited the wrong file stops being a silent
`unanchored` and becomes a visible failure, because the fragment will not be
found. That is an argument for anchoring rather than against it, but whoever
takes B or D should expect the sweep to expose some of these and should not treat
each one as a checker bug.

## Build

~~**Not startable.** The build is whichever option is chosen; writing it before
the decision would be writing three briefs and discarding two.~~ **The decision
is answered — D, then A, with C as the destination — so this is startable.** The
scope is stated here rather than expanded into step-by-step instructions,
deliberately: the corpus moves, and the sizing below was taken at `b142a4a`.
Whoever builds it writes the steps with the records in front of them.

**What D, then A means concretely.** The provenance of each line is marked,
because "D, then A, with C as the destination" is an answer that draws on two
option blocks and not only on D's — **the scope is D's, the enforcement
machinery is C's, and only the framing is new**:

- **Scope: the `## Review` gate records** — D's, verbatim. Measured at
  `b142a4a`: 353 unanchored citations across 42 of the 46 records that have a
  `Review` section, out of 418. Re-measure before starting; the denominator grows
  with every gate record.
- **Anchor them**, obeying the two invariants below — and repoint any that turn
  out to be stale, since anchoring a wrong coordinate forces fixing it.
- **Enforce that scope** with `--require-anchors` **and** the `--section` flag.
  Only `--section` is D's; **`--require-anchors` is named under option C, not
  under D**, and so is the requirement that an enforced gate be built **on**
  repo-25's `citations: evidence` declaration "not beside it". They are pulled
  forward deliberately — D is the first slice of C, so it uses C's machinery at
  D's scope.
- **Shape it so C can widen it** rather than as a rule about `## Review`
  specifically. **This line is in neither option block**; it follows from the
  owner's answer that C is the destination, and it is recorded as a consequence
  of the decision rather than as something the ticket already said.
- **A is the floor for everything outside that scope**: a citation gains an
  anchor when it is next written or edited. A is not optional and not implied by
  D; it is the half that covers the Why sections D deliberately does not.

**One more thing anchoring buys, added 2026-09-07 from repo-16's build.** An
unanchored bare `:N` shorthand is not merely unchecked — it can be resolved
against **the wrong file** and reported as `unanchored` rather than as a failure.
`citations.mjs` takes a shorthand's file from the nearest qualified citation
_above_ it, so a bare backticked range written under a citation naming a
different file is attributed to that file, printed with both ends on screen, and
does not fail. **Three independent instances in the 2026-09-07 batch, from three
different agents**, and the third is the one worth reading:

- **repo-16.** A builder note enumerating four repointed citations wrote each as
  a fully-qualified left side and a bare shorthand right side. All four corrected
  ranges bound to the wrong file. The run exited 0 and the record would have
  committed clean; it was caught only because fully qualifying them moved the
  verified count **2 → 6** — the four repointings had been counted and never
  checked.
- **dl-44's gate.** A bare range in a gate record inherited the previous
  citation's file and resolved into a different file entirely.
- **This paragraph, on its first draft.** It named the two ranges above in bare
  backticked form as _examples_, and all three bound to
  `repo-21-the-orchestration-skill-outgrew-its-loop.md` — the nearest qualified
  citation above, and a ticket with nothing to do with either instance. The
  prose describing the defect reproduced it, inside the hour, in the ticket filed
  to fix it. That is the argument for enforcement rather than for care: three
  agents and one of them forewarned.

`--require-anchors` is what turns all three into failures, which is why this belongs
here rather than in its own ticket: the flag this ticket already adopts is the
fix, and the case strengthens option C's argument that counting a reference is
not the same as checking it. Worth a line in whatever lands, so the next reader
knows the flag buys correctness and not only coverage.

Whatever is chosen, two things hold:

1. **Prove the gate by making it fail first.** If a CI step is added, break one
   anchor, confirm the command exits non-zero, revert, and put the output in the
   Log. A citations gate that has only ever been seen green is a gate nobody has
   tested.
2. **A sweep must report what it could not anchor**, rather than picking a
   fragment to satisfy itself.

### What enforcement costs and buys, measured on three real gate records — 2026-09-07

Recorded on the owner's instruction from that day's orchestration batch, as
evidence for the option already chosen. **It changes nothing above**: no new
option, no reopening of the answered decision, `status` unchanged, and nothing
here is built. Every figure was re-derived on this branch against the branches
named rather than transcribed from the batch's report, and where a relayed number
did not reproduce exactly that is said so.

Both records sit on unmerged branches, so they are named in prose rather than
cited — the same dodge, and the same reason, as the dl-43 reproductions above.

**The strongest instance is a gate record for the citation checker itself, and
the checker cleared it.** repo-33 (branch `repo-33-citations-windows-paths`,
PR #186) fixes how `citations.mjs` names a record's own path; its gate record is
unanchored throughout. At its tip the checker reports `7 verified, 0 moved, 29
unanchored, 0 unresolvable, 3 unchecked, 0 evidence — of 39 references` at **exit
0**. Two distinct failures sat inside that clean result:

- **A citation onto a blank line.** The reviewer's record cited the fixture's
  root-level record at 1278 of `citations.test.ts`; 1278 is blank and 1279
  carries the claim. The checker prints an empty preview under it and exits 0.
  Caught by a human re-resolution before the record was committed, not by the
  run.
- **Five coordinates that drifted onto unrelated content.** They were correct at
  `ab5e6fa`, and the round-three commits then edited the middle of the same test
  file. Running the round-one-and-two record against the branch tip, and again
  with `--rev ab5e6fa`, gives the **identical** answer both ways — `0 verified, 0
moved, 11 unanchored, 0 unresolvable, 2 unchecked — of 13 references`, exit 0 —
  for a set of coordinates that is right in one tree and wrong in the other. At
  the tip the five land on a docblock asterisk, a `//` comment, a statement, a
  docblock prose continuation and another `//` comment. The checker emits four
  entries for the five, because it previews a range at its start. **The record's
  own description of what they landed on is itself already stale** — it matches
  the tree at `1a774db` and not the tip, so the drift drifted again while the
  record was describing it. Both revs were checked here rather than assumed.

**The one anchored round failed loudly, inside a single run, and what it caught
was its own anchor.** Round four of that same record was the first written with
anchors. Four of them quoted lines containing double quotes and escaped the inner
ones; the parser takes straight quotes only —

`scripts/citations.mjs:146` "const ANCHOR = String.raw"

— so each anchor terminated at the escape and matched nothing. Reconstructed here
on a scratch record carrying those four anchors in the escaped form: `3 verified,
4 moved, 0 unanchored, 0 unresolvable, 0 unchecked — of 7 references`, **exit 2**,
each failure printed with its anchor truncated at the backslash. That was the
record's first non-zero exit across four rounds, and the coordinates were right —
only the anchor text was malformed. **Operationally, for whoever anchors the
corpus: an anchor fragment cannot contain a double quote at all.** Pick a
quote-free substring of the line rather than escaping one; the repair on that
branch was exactly that, with the coordinates untouched.

**The second record repeats the shape, and carries the one form that does fail.**
dl-45 (branch `feat/dl-45-keep-the-failover-mirrors`, PR #189) reports at its tip
`2 verified, 0 moved, 34 unanchored, 0 unresolvable, 5 unchecked, 0 evidence — of
41 references`, exit 0. Two coordinate errors in it were caught **by hand, not by
the checker**: a `displayKey` range given as 159–186, which overshoots the symbol
it names — `displayKey` ends at 173, 175–184 is `groupByKey`, and 186 is the
`DisplayRows` docblock, re-resolved against that branch — and the
`engine.download` call site cited by **bare filename**. Only the second failed. A
bare `orchestrator.ts` plus a number is `unresolvable` at **exit 1**, because
three files of that name are tracked here: `tools/downloader/api/src/jobs/`,
`tools/planner/agent/src/` and `tools/planner/api/src/runs/`. Worth stating
precisely, because it is the boundary of what the unanchored checker can do:
**that citation failed because it was bare, not because it was wrong.** The
overshooting range in the same record cleared at exit 0, and so would a plain
wrong number in place of a right one.

**Why this is evidence for D rather than an argument that D is noisy.** Across
both records the anchored round is the **only** round in which the mechanism
objected to anything at all — and what it objected to was a malformed anchor,
repaired in one edit, on a record whose 29 unanchored coordinates were
simultaneously hiding a blank line and five drifted ranges at exit 0. The
enforcement's one false alarm cost a single re-anchoring; the absence of
enforcement cost two silent failures on the same page. Under `--require-anchors`
today both records are exit 4 — 29 and 34 unanchored respectively — which is the
size of the gap on two gate records written the day this was measured, and the
scope D is defined over.

**One more thing for whoever writes the counts into a record: a record that
counts its own references changes what it is counting.** Two instances in the
same batch. dl-45's record stated `32 of these 39 references`, its gate caught it,
and a fresh run gave 34 of 41 — the paragraph carrying the numbers had added its
own citations after the run they came from. repo-33's round-one-and-two record
states `10 unanchored ... of 12 references`; re-run here at that very commit it
reports 11 of 13, for the same reason, and that one was never caught. Re-run the
command **after** writing the sentence that quotes it.

## Done when

Deliberately written against the decision rather than an implementation — each
line is checkable whichever option is taken.

1. The chosen option is recorded on this page as a dated Log entry naming it and
   the reasoning, and `status` is `ready` or `done` accordingly.
2. `node scripts/citations.mjs` over the records in the chosen scope reports zero
   `unanchored`, run with `--require-anchors` and exiting 0.
3. Every citation the sweep touched still points at what it claims: no citation is
   anchored to a fragment that occurs on more than a handful of lines in its file,
   and any citation that could not be given a distinctive anchor is listed in the
   Log rather than anchored badly.
4. Every deliberately unresolvable citation in scope is covered by a
   `<!-- citations: evidence ... -->` declaration, and none of those declarations
   excuses a citation that now passes.
5. If a CI step is added: it was observed failing on a deliberately broken anchor
   and passing after the revert, with both outputs in the Log.
6. `npm run check` and `node scripts/status.mjs --json` exit 0.
7. repo-21's step 3 is either still coherent beside what landed, or its brief is
   amended in the same pull request to say so.

## Log

- **2026-09-07** — Filed. The corpus figures above were re-measured from scratch
  at `b142a4a` rather than transcribed from the brief that requested this filing,
  and they agree with it: 70 records with unanchored citations, 1,036 unanchored.
  The full four-state breakdown (26/29/1,036/155 of 1,246 across 107 records) and
  the `--section Review` figures (353 unanchored across 42 of 46 records, of 418
  citations) are new here and are what option D rests on.

  The pathspec trap was reproduced rather than taken on trust:
  `git ls-files 'tools/*/docs/work'` returns 0 and the combined bare form returns
  26, against 107 for the spelled-out `*.md` form.

  Both halves of reproduction 1 were re-run against `main`, not relayed — the two
  cited lines hold `container?: string | undefined` and `videoCodec: string`, and
  the checker exits 0 over the record calling them `unanchored`. Reproduction 2 is
  taken from PR #169's exchange and is **not** independently re-run: it is a
  record of what a reviewer wrote and a builder caught, and the branch has since
  been fixed, so there is nothing left to reproduce. Stated as second-hand rather
  than dressed as a measurement.

  **This page's own ten citations are all anchored**, and
  `node scripts/citations.mjs` over it reports `10 verified, 0 moved, 0
unanchored, 0 unresolvable` at exit 0. Two things had to be written around to
  get there, and both are the gap itself showing through: the checker parses a
  coordinate quoted as an _illustration_, and it parses one quoted inside a
  reproduced run. `docs/01-TICKETS.md`'s example is therefore described rather
  than reproduced, and the dl-40 run above is cut to its summary. On top of
  repo-25's declaration mechanism neither dodge would be needed.

  `difficulty` is deliberately absent. The work is `mechanical` under A, and
  contract-adjacent under C — the same ticket rates differently depending on an
  answer nobody has given, so rating it now would be a guess about the decision
  rather than about the work. Set it in the commit that answers the decision.

  Option D is not in the brief this filing came from; it was added because the
  `--section` flag already exists and the measurement made it cheap to size.
  A fifth option worth naming and rejecting: enforcing on changed records only, in
  a `git diff`-filtered CI step. Rejected because a record's citations go stale
  when the _source_ moves, not when the record changes, so a diff filter watches
  the wrong file.

- **2026-09-07** — Renumbered from `repo-28` to `repo-29` before merge. It was
  filed as `repo-28` after a sweep that read every open pull request's diff
  individually and found the id free; a peer session's branch existed at that
  moment with the number in its name, no commits and no ticket file, and was
  flagged in the filing report as a possible second claimant. It then committed
  its own `repo-28` and opened PR #171, a lower number than this one's #172, so
  it claimed the id first and this ticket moved. Nothing of theirs was touched.

  **The branch is still named `repo-28-anchor-citations` and is deliberately left
  that way** — a branch name is not load-bearing here, the file and the pull
  request title carry the id, and churning an open pull request costs more than
  the stale name removes. Recorded here so a later reader hitting the mismatch in
  the history does not have to reconstruct it.

  Worth keeping for whoever answers this ticket's decision: an id sweep that
  reads the maximum rather than each pull request's own diff would have missed
  #171 entirely, and one taken a few minutes earlier — as this one was — sees a
  claimant that does not exist yet. That is the same shape as the defect this
  ticket is about. A coordinate, or an id, that is checked once and then trusted
  is checked against a tree that has since moved.

- **2026-09-07 — the decision was answered by the owner: D, then A, with C named
  as the intended destination.** D is a first slice, not a boundary. It was this
  ticket's own recommendation, so it overrode nobody. **B was not rejected and is
  recorded as still open**: it is the right answer if a sweep can be shown to
  pick distinctive anchors, and that measurement is one nobody has taken.
  `status: needs-decision` → `ready`. The decision heading is now
  `## Decision — answered 2026-09-07, not open`, the four option headings are
  marked chosen or not in place, and the Build section's "Not startable" is
  struck.

  **The objection carried with the answer**, so it is not rediscovered: D would
  not have caught reproduction 1 — a wrong coordinate in a Why section, which
  misled a whole dispatch. A covers that only by convergence and never reaches a
  record nobody touches. That residue is exactly why C is the destination.

  **One fact re-checked here rather than relayed: repo-25 merged.** Its ticket
  reads `status: done` and `scripts/citations.mjs` carries the
  `citations: evidence` declaration on `main`, so the "do not start before it
  merges" line above is discharged and struck. The corpus figures were **not**
  re-measured on this branch — they are still the `b142a4a` sweep, and the Build
  section says to re-take them.

  **`difficulty` is still unset, and that is a gap this entry is recording
  rather than closing.** The Log entry above says to set it in the commit that
  answers the decision. This branch relays an answer it did not make, and the
  rating that answer implies is a judgement about the work, not part of the
  answer that was given — under D it is a large anchoring pass plus a CI gate,
  which is neither obviously `mechanical` nor obviously `standard`. Rating it
  here would be this recorder guessing, which is the thing the original entry
  was trying to avoid. **Answered 2026-09-07 by the owner: leave it unset.**
  Absent means inherit, which is the honest statement while nobody has read the
  work. The refusal to rate work this branch was not asked to rate is upheld, so
  the earlier Log entry's "set it in the commit that answers the decision" is
  **discharged by a deliberate choice not to**, not left undone.

  **The gap that leaves is narrow but real, and worth naming as a mechanism
  rather than as an unease.** `.claude/agents/builder.md`'s table maps an absent
  `difficulty` to `inherit` — the same dispatch as `standard`, and **with no
  floor**. `hard` is the one row that names a model instead, and repo-27 (`done`)
  changed it to do so for exactly this reason: "a floor cannot be delegated to a
  variable." So if this ticket is picked up while the orchestrating session is
  running Sonnet, it inherits Sonnet with nothing to stop it — and under D the
  work wires `.github/workflows/ci.yml`, which is the seam-reaching territory
  `hard` is defined for. Leaving it unrated is the safe direction only in the
  sense that it does not _lower_ the model; it does not raise it either, and that
  is the half that could bite. **This note is kept deliberately even though the
  answer was "leave it unset"** — the answer settles the rating, not the gap, and
  the note is the only thing that makes the gap legible rather than silent.
  Anyone rating this later should decide between `hard` and `standard` on the
  merits, not inherit the absence.

  **This page's own citations have gone stale since it was filed, and that is
  left standing on purpose.** The filing entry above records `10 verified, 0
moved` at exit 0. Run again on 2026-09-07 the same file reports **6 verified, 4
  moved, 1 unanchored, 5 unchecked of 16 references, exit 2** — the extra
  references are repo-25's shorthand and prose counting, and the four `moved` are
  drift in the targets, not in this record: dl-40 moved both downloader lines,
  repo-25 rewrote the `citations.mjs` docblock, and repo-30 moved
  `docs/01-TICKETS.md`.

  **The drift is pre-existing and this branch did not cause it**, checked rather
  than asserted: `main`'s copy of this file, run against the same working tree,
  reports the identical `6 verified, 4 moved, 1 unanchored, 5 unchecked` at exit 2. Only the record line numbers differ.

  **It is not repointed here, and that is a deliberate refusal rather than an
  oversight.** Two of the four sit inside reproduction 1, which is a dated
  measurement of where two symbols were on a given day; silently rewriting the
  coordinates would edit the evidence to match the tree, which is the move this
  whole ticket exists to make visible. Three ways to settle it were put to the
  owner — repoint and re-anchor against the tip, pin the record with `--rev`, or
  leave the four `moved` standing as the ticket's own live demonstration.

  **Answered 2026-09-07 by the owner: leave them. Do not "fix" this.** This page
  is expected to fail its own checker at exit 2, and **that failure is the
  argument the page makes**. A later agent finding the four `moved` lines has
  found the ticket working, not a defect: repointing them would delete the
  demonstration to make a number go green, which is the precise move reproduction
  1 exists to warn about. If you believe they should be repointed, that is a
  decision to reopen with the owner, not a tidy-up to perform in passing.

  **Why they are worth more standing than fixed, and it is this ticket's thesis
  arriving unbidden:** all four were caught **because they carry anchors**. An
  unanchored citation drifting the same distance would still have reported exit 0
  with the wrong line's content underneath it — which is exactly reproduction 1,
  reproducing itself on the page that describes it. Anchoring is what converted a
  silent staleness into a loud one, and the loudness is the feature.

  **The Build section's scope statement was ruled on rather than assumed.** This
  ticket told the answering commit to "replace this section with the steps for
  the chosen option"; the dispatch that produced this branch said to mark steps
  in place and not to rewrite them into new briefs. Those conflict, and leaving
  `status: ready` above a Build reading "Not startable" would have been a real
  board defect — so the scope-not-steps compromise above was written, then put
  back to the orchestrator that wrote the constraint, which accepted it as the
  intended reading of its own instruction.

  **The distinction that took, and it is worth carrying past this ticket: a gate
  can verify that a compromise's _content_ is correct without that being the same
  question as whether making the compromise was the right call.** They are
  different objects. The reviewer here checked the content against the owner's
  answer — correctly, and it found a real misattribution in it — and then called
  the compromise itself settled, which was one object too far, since it did not
  hold the dispatcher's instruction as an artefact it could weigh. It corrected
  its own relay when that was put to it. A reviewer certifies output; only the
  agent whose instruction was bent can ratify the bending.

  **Recorded, not built.** Nothing under `scripts/` or `.github/` was touched and
  no citation anywhere was anchored. This branch is bookkeeping across four
  tickets whose decisions were answered in one sitting.

- **2026-09-07 — three more reproductions added to the Why, from dl-43's review
  cycle.** Evidence only: **the Decision section was not touched and the answered
  option is unchanged.** A citation onto a blank line, and two ambiguous between a
  downloader and a planner file of the same name. All three were produced during
  live review by two careful agents and caught only by a manual
  `scripts/citations.mjs` run.

  **What they add over the evidence already here:** everything above is a
  retrospective sweep over finished records, which admits the defence that the
  coordinates merely aged. These three were **produced wrong, not aged wrong**,
  on the same day, which is the stronger form of the same argument.

  **Their coordinates are as measured on dl-43's branch and are not cited**, on
  purpose: that branch is unmerged, `citations.mjs` resolves repo-relative, and a
  coordinate into an unmerged branch fails. Prose names the branch instead — the
  same dodge, and the same reason, as the two already recorded at the top of this
  Log.

  **Two things were checked here rather than relayed**, and one of them turned out
  stronger than the claim that prompted it. repo-21's branch really does scope its
  new CI step to `SKILL.md` alone — read from
  `refs/heads/repo-21-orchestration-skill-loop`, so `docs/work/` stays unchecked
  in CI whichever way it lands. And the ambiguity class is not anecdotal: **41
  basenames exist in both `tools/downloader/` and `tools/planner/`**, including
  `errors.ts`, `index.ts` and `config.ts`. That measurement is new here, it holds
  on `main` rather than only on dl-43's branch, and the repo's "a tool never
  imports from another tool" rule guarantees the set keeps growing.

  **This entry landed after the gate that passed this branch**, like the entry
  above it, and is disclosed as uncovered by that verdict in the pull request
  rather than left to look reviewed.

- **2026-09-07, one Build line added from outside** — by
  [repo-16](./repo-16-suppression-does-not-dismiss.md)'s build, on the owner's
  instruction, recording that an unanchored bare `:N` shorthand can bind to the
  **wrong file** and still exit 0. **Three** instances that day: repo-16's,
  dl-44's gate, and the first draft of that very Build paragraph, which wrote its
  two examples in bare backticked form and bound all three to `repo-21`. The
  third was caught by running `node scripts/citations.mjs` on this file before
  committing, which is the only reason it is a reproduction rather than a defect
  shipped into the ticket filed to fix it. All three are in the Build section.
  **Nothing else here was touched** — no status, decision or scope change, and
  nothing implemented. This
  ticket is held and undispatched, and the line is there so whoever picks it up
  has the strongest available argument for `--require-anchors` rather than
  rediscovering it.

- **2026-09-07 — the anchoring evidence from that day's orchestration batch
  recorded on the Build section, on the owner's instruction.** Evidence only:
  **the answered decision was not touched**, no option was added, reopened or
  re-argued, `status` stays `ready`, `difficulty` stays unset, and nothing in this
  ticket is built. Three measurements, taken on committed gate records rather
  than on a retrospective sweep: repo-33's (PR #186), the anchored round of the
  same record, and dl-45's (PR #189).

  **Every number was re-derived on this branch rather than transcribed from the
  batch's report**, by checking out each branch in this worktree and running
  `scripts/citations.mjs` against it. Three things came back differently from the
  relay, and are written as measured:

  - The relay quoted five states; the script prints six. Both headline counts
    carry `0 evidence` as well, which is repo-25's mechanism reporting that
    neither record declares anything.
  - The five drifted coordinates appear as **four** entries in the checker's
    output, because it previews a range at its start and two of the five are the
    ends of one range. And the repo-33 record's own prose description of what
    they drifted onto matches the tree at `1a774db`, not at the branch tip —
    checked at both revs, and recorded because the description going stale is the
    same defect one layer up.
  - The round-one-and-two record's self-reported `10 unanchored ... of 12
references` does not reproduce at its own commit: a fresh run there gives 11
    of 13. That is the same self-counting error dl-45's gate caught in `32 of
these 39`, uncaught in the second instance, and it is now a line in the Build
    section.

  **What could not be re-run, stated rather than reasoned around.** The
  malformed-anchor round was repaired before it was ever committed, so there is no
  commit holding it; the `3 verified, 4 moved`, exit 2 result is a
  **reconstruction** on a scratch record carrying the four anchors in their
  escaped form against the same branch tip, not a replay of the original run. It
  reproduces the reported counts and exit code exactly, and it independently
  confirms the mechanism — the parser's anchor group admits no `"` at all, so an
  escaped one truncates the fragment at the backslash. Both branches were read at
  the shas they carried on 2026-09-07 (`d0869fd` and `857114d`); a force-push to
  either detaches the figures from what is on the branch, and they are pinned to
  those shas here for that reason.

  `node scripts/citations.mjs docs/work/repo-29-citations-carry-no-anchor.md`
  goes from `6 verified, 4 moved, 1 unanchored, 0 unresolvable, 7 unchecked — of
18 references` on `main` to `7 verified, 4 moved, 1 unanchored, 0 unresolvable,
7 unchecked — of 19`, both at **exit 2**. This edit therefore adds exactly one
  reference and it is anchored and verified, which is what the entry above
  requires of anything written into this ticket. The four `moved` are the
  deliberate demonstration the owner ruled on, and they are untouched — the
  baseline was re-run from `main`'s own copy of this file in this worktree rather
  than assumed, because the count last recorded here (`of 16 references`) predates
  the entry that added the blank-line reproduction.
