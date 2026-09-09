---
id: repo-29
tool: repo
title: Most citations carry no anchor text, so nothing checks what they claim
kind: chore
status: done
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

  `.github/workflows/ci.yml:129` "node scripts/status.mjs --json"

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
- **repo-21 — ~~unbuilt, `status: ready`~~ `done` and merged 2026-09-07 (PR
  #179, `9b426c8`), so this constraint is discharged too.** It wired
  `citations.mjs --require-anchors` into the `check` job — scoped to one file,
  `.claude/skills/orchestrate-tickets/SKILL.md`, in its build step 3:

  `repo-21-the-orchestration-skill-outgrew-its-loop.md:250` "Scope it to"

  **That is option C arriving from another direction**, and ~~whichever lands
  first constrains the other~~ **it landed first**, so the constraint resolved
  the way the first branch of this paragraph describes: this ticket's step lands
  _beside_ a working invocation rather than racing it. The two do not overlap —
  repo-21's reaches one skill page and deliberately no work record, and this
  one's reaches the work records and deliberately no skill page — so its step 3
  is neither redundant nor in need of amendment, which is what `Done when` 7
  asks. Verified on `main` rather than relayed: repo-21's ticket reads
  `status: done` and `ci.yml`'s `check` job carries the invocation.

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
the checker cleared it.** repo-36 (branch `repo-33-citations-windows-paths`,
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

`scripts/citations.mjs:176` "const ANCHOR = String.raw"

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
own citations after the run they came from. repo-36's round-one-and-two record
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

## Review

**Gate: PASS** — 2026-09-08 · five rounds · `origin/main...HEAD` · reviewer
dispatched `sonnet`, builder `opus`

**Written by the builder, which is the model under review**, per
`docs/01-TICKETS.md:333 "So the reviewer reports and the builder writes"`. The
reviewer returned five reports as messages and its worktree is gone — it hit a
session rate limit after delivering the PASS — so this is a transcription with
attribution rather than a verbatim block. **All five reports are posted to PR
#194's thread unaltered**, one comment per round, so a reader can hold this
section against what was actually sent. Where the two of us corrected each
other, the correction says which side found it.

The arc, because the final word alone hides the work: CONCERNS at `36cdf0d`,
CONCERNS at `1bc29b8`, CONCERNS at `8e42ecf`, CONCERNS at `4522ed4`, **PASS at
`345d639`**. Every finding was reproduced by the receiving side before it was
acted on, and two of them reversed a decision as a result.

| Done when                                                                 | Proof                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Chosen option recorded as a dated Log entry, `status` set              | **verified** — the 2026-09-07 entry names D-then-A with C as the destination; `status: done` in this commit                                                                                                     |
| 2. Zero `unanchored` in the chosen scope, `--require-anchors`, exit 0     | **proven, and contested in the narrow reading** — `scripts/test/citations-gate.test.ts:128 "a grandfathered record is excused and its debt is counted"` ✓                                                       |
| 3. No citation anchored to a non-distinctive fragment                     | **proven** — `scripts/test/citations-gate.test.ts:195 "an anchor that is not unique in its target fails the gate"` ✓, `scripts/test/citations.test.ts:1795 "changes the exit code and not one citation line"` ✓ |
| 4. Evidence declarations cover what fails, and excuse nothing that passes | **proven** — `scripts/test/citations.test.ts:1167 "exit 8 — 1 stale evidence declaration"` ✓                                                                                                                    |
| 5. The CI step observed failing and passing, both in the Log              | **verified** — three failing runs on 2026-09-08 with their exit codes; step at `.github/workflows/ci.yml:190 "node scripts/citations-gate.mjs --against"`                                                       |
| 6. `npm run check` and `node scripts/status.mjs --json` exit 0            | **verified** — both exit 0 at `f089742`; `npm test` 2343 passed, 136 files                                                                                                                                      |
| 7. repo-21's step 3 still coherent beside what landed                     | **verified** — `docs/work/repo-21-the-orchestration-skill-outgrew-its-loop.md:250 "Scope it to"`, one skill page and no work record; no amendment needed                                                        |

**Line 2 is the one to read carefully.** The enforced scope reports zero
unanchored at exit 0; the 59 grandfathered records still hold 741 failing
references. A reading of "the records in the chosen scope" that means the
enforced set is satisfied; a reading that means every record with a `## Review`
section is not. Both were put to the owner, who accepted the first and had the
migration filed as repo-37.

- **med** · _reviewer, round 1_ · `GRANDFATHERED` was a `Set` of paths, so adding
  a record silenced a break in it — exit 0, no output. **Fixed**: the list is a
  `Map` of counts and ratchets both ways.
- **med** · _reviewer, round 2_ · a count that matches the debt exactly is
  excused, so the ratchet was silent against an accurate number. **Fixed** in
  round 3 by `--against`, after being disclosed in round 2.
- **med** · _reviewer, round 3_ · the bootstrap window reopens when the file is
  deleted and re-added. **Fixed** — refused via a history probe, after the owner
  first chose to disclose and then reversed when the cost had been mis-described
  to them.
- **med** · _reviewer, round 4_ · renaming the gate evaded that probe in one
  commit. **Fixed** — the probe asks about `GATE_GLOB`, not the exact path.
- **low** · _reviewer, round 4_ · the shallow-clone refusal had no test. **Fixed**
  — one that builds a real shallow clone through `file://` and asserts
  `--is-shallow-repository` before asserting anything else.
- **med, no change** · _reviewer, round 1_ · the enforced surface is one record
  with a checked citation, not two. Correct, and the paragraph claiming otherwise
  is rewritten; nothing to fix in the code.
- **med, no change** · _reviewer, round 4_ · a rename outside `GATE_GLOB` with the
  constant edited still evades. Disclosed where the constant is defined, and
  measured as costing a **necessary** edit to the one constant whose job is
  catching renames.
- **dropped** · _reviewer, round 3_ · a third `ci.yml` comment still says
  "depth-1". Raised explicitly as not a finding and left, with a note saying so.

**Three corrections went the other way, and they are why a builder-written
section is worth more here than a pasted one.** Round 4: the reviewer's
merge-order arithmetic used repo-34 at `cd00fb4`, two commits stale, and the
corrected version was **worse** than filed — a red build rather than silent debt.
Round 3: its whole-corpus sweep grepped for `UNRESOLVABLE` where the checker
prints that state as `FAIL`, so it under-counted two records; that trap is now
commented where the labels are defined. Round 5: it caught that this record's own
"two paths" count had become three because the sentence reporting it created the
third match — this ticket's own rule, broken by the ticket.

- **findings** · reviewer returned 9 across five rounds; 5 carried and fixed, 3
  carried as disclosed residuals, 1 dropped. Builder returned 3 corrections to
  the reviewer; 3 carried.
- NFR: security ✓ (no new surface; the gate reads the tree and spawns `git` with
  argument arrays) · performance ✓ (the history probe is 2 ms; the full gate run
  is under a second) · reliability ✓ · maintainability — the `GRANDFATHERED` list
  is 59 lines of debt that repo-37 exists to drain.

**This section is enforced by the mechanism it reports on.** repo-29 is not on
`GRANDFATHERED`, so every citation above had to be anchored on a fragment
occurring once in its target, checked with `--require-anchors
--require-distinct-anchors` before the commit. That is the gate working on its
own author, and it is the narrowest possible demonstration that the thing works.

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
  than on a retrospective sweep: repo-36's (PR #186), the anchored round of the
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
    ends of one range. And the repo-36 record's own prose description of what
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

- **2026-09-08** — **The ticket this record's strongest instance is drawn from is
  now `repo-36`, not `repo-33`.** A peer session filed a different `repo-33` —
  ADR 004's compose rename — and merged it to `main` in #192 while this batch was
  open. Two tickets on one id makes `node scripts/status.mjs --json` exit 1,
  which is the board gate, so the batch renumbered its own; the merged one keeps
  the id. Four references on this branch were repointed, in the Build section and
  in the entry above: the ticket is the same ticket, the file is now
  `docs/work/repo-36-citations-loses-the-record-path.md`, and its branch is still
  named `repo-33-citations-windows-paths` — branch names were left alone, since
  renaming one closes and reopens its pull request.

  **The measurement quoted above was re-run after the renumber and is unchanged.**
  At #186's new tip (`0a6bf23`, which adds the renumber's own Log entry to that
  record and so moves every line below it), `node scripts/citations.mjs
docs/work/repo-36-citations-loses-the-record-path.md` still reports
  `7 verified, 0 moved, 29 unanchored, 0 unresolvable, 3 unchecked, 0 evidence —
of 39 references` at **exit 0** — byte-identical to the figure recorded here
  before the rename. That is worth stating rather than assuming, because it is
  this ticket's own thesis pointed at itself: renaming the file the record
  describes is exactly the class of change that silently invalidates a
  coordinate, and the only reason it did not here is that none of the 39 point at
  the ticket file itself.

  Nothing else about the evidence, the answered decision or the Build section
  moved. `status` stays `ready`, `difficulty` stays unset.

  **Observed while checking that, and pre-existing rather than caused here.**
  `node scripts/citations.mjs docs/work/repo-29-citations-carry-no-anchor.md`
  on this branch exits **2** with `7 verified, 4 moved, 1 unanchored, 0
unresolvable, 7 unchecked, 0 evidence — of 19 references`. The renumber did not
  cause it: the identical line and exit code come back from the file as it stood
  at `74b02fd`, checked by stashing the edit and re-running. The four sit in the downloader's
  `media.ts` contract, the web `variants.ts`, `citations.mjs` itself and
  `docs/01-TICKETS.md` — all anchored citations whose anchor text has since
  drifted below the coordinate recorded, and none of them touching the renumber.
  Their exact coordinates are deliberately not repeated here: writing four known-
  stale `file:line` pairs into this page would mint four fresh citations for the
  checker to fail on, which is how the first draft of this very entry took the
  file to `1 unresolvable`. Re-run the command above to see them. Left for this ticket's own gate — repairing them is its
  work, not the renumber's, and folding it in would hide a real finding inside an
  unrelated change.

- **2026-09-08 — built, and the half that is not built is named first.** Option
  D's _mechanism_ landed: `scripts/citations-gate.mjs`, its suite, a step in
  `ci.yml`'s `check` job, and the reviewer convention that keeps the gate fed.
  **The migration did not.** 639 unanchored citations across 56 records are
  still unanchored, and the gate names all 59 failing records in a
  `GRANDFATHERED` list rather than pretending otherwise. Read the next four
  paragraphs before the rest: this entry is long because the reasons are
  measured, not because the work is.

  **The corpus was re-measured on `b384033` rather than taken from this page.**
  The figures above were `b142a4a`'s — 353 unanchored across 42 of 46 records, of
  418 citations under `## Review`. They have not aged well. Today the same sweep
  gives **639 unanchored across 56 of the 63 records that carry a `## Review`
  section, of 827 references** — the denominator doubled in five days, exactly as
  the option C paragraph predicted it would. The full breakdown under
  `## Review` is 37 verified, 49 moved, 639 unanchored, 47 unresolvable, 52
  unchecked, 3 evidence. A figure of 639 was relayed to this branch by an
  orchestrator that had not verified it; it was re-derived here from scratch and
  it agrees to the citation.

  **Only 4 of the 63 records pass, and only 1 of the 4 has a citation this
  actually checks.** Pass means nothing under `## Review` is unanchored, moved or
  unresolvable — which three of the four achieve by having nothing to check.
  `dl-17` and `dl-26` report `0 references`; `repo-30` reports 2, both
  `unchecked` prose of the "line 12" shape, which names no file and resolves
  against nothing. **`pl-2` is the only record in the enforced set carrying a
  real `file:line`, and it carries two.** The gate found this: an earlier draft of
  this paragraph named the two empty records and let the reader infer that the
  other two were checked, which is a wrong number reached by implication rather
  than by claim — this ticket's own defect, one layer up from a citation. That
  number decides the shape of everything below: enforcing over 63 records is not
  a gate, it is an outage, which is what option C says about itself in its own
  words. It also sizes what today's gate is worth on its own — nearly nothing —
  and moves all of its value onto the records not yet written.

  **What the sweep measured, and why it was reverted — this is the entry option B
  has been waiting for, and B stays open.** An automatic anchoring sweep over
  this exact scope was built, run and thrown away. It refuses rather than
  guesses: an anchor is accepted only if it occurs **exactly once** in the whole
  target file, and it is chosen by one of three rules — anchor today's content
  where the cited lines are byte-identical to the commit that first carried the
  record's `## Review` heading (270 citations), repoint to where the text the
  reviewer saw has uniquely gone (116), or follow an existing anchor that has
  moved (40). It proposed 426 repairs of 688 and refused 262, and applying it
  took the scope from 37 verified to 463, and from 639 unanchored to 253.

  **It was reverted because two of the first ten anchors inspected were false**,
  both inside `repo-25`'s own gate record, and both would have reported
  `verified` for ever:

  - A backticked shorthand naming port 443 — a TLS **port**, quoted by that
    record as the known false positive it exists to describe — was anchored
    against line 443 of `citations.mjs`. The sweep minted a verified citation
    onto a line the record was not pointing at, inside the record that documents
    the ambiguity.
  - A citation quoted _inside a reproduction_ of an earlier run was anchored to
    what that line holds today, editing a dated measurement to match the tree.

  There is no lexical rule that separates either from a real citation —
  `citations.mjs`'s own docblock says so about the port — so this is not a bug in
  the sweep to be fixed. **It is B's stated objection reproducing itself**: an
  automated anchor that verifies the wrong thing is worse than the unanchored
  citation it replaced. **B is not closed by this.** What it now has is the
  distinctiveness measurement nobody had taken — a unique-fragment rule does hold
  for 426 of 688 — plus a hard boundary: a sweep must not touch a shorthand, and
  must not touch a citation inside a quoted reproduction. Whoever takes B starts
  from those two lines rather than from the argument.

  **What was built.**

  - `scripts/citations-gate.mjs` runs `citations.mjs`'s checks with
    `--require-anchors` over a _set_ of records. **The scope is data, not
    logic** — `scripts/citations-gate.mjs:120 "export const SCOPE"` holds the
    pathspecs and the section name, so option C is `section: null` and no other
    line changes. That is the "shape it so C can widen it" instruction taken
    literally: there is no rule about `## Review` anywhere in the mechanism.
  - It is a script and not a shell `for` over a glob so that the widening is an
    edit to a constant rather than to YAML, and so the loop is testable. 13 tests
    in `scripts/test/citations-gate.test.ts`.
  - One CI step in the `check` job, beside repo-21's:
    `.github/workflows/ci.yml:190 "node scripts/citations-gate.mjs --against"`.
  - A record with **no** `## Review` section is out of scope rather than an
    error, which is the one place this deliberately disagrees with
    `citations.mjs --section`. That flag refuses a name matching nothing for a
    good reason — a typo'd section would report success having checked nothing.
    Here the name is a constant and the record set is the variable, and dozens of
    tickets have not been gated yet. An **ambiguous** name is still an error.
  - **The grandfather list cannot rot into a rubber stamp**, and the rule that
    stops it is repo-25's, one level up: a listed record that now passes, or that
    the scope no longer reaches, is an _error_ naming the line to delete. The
    list can only shrink, and the run prints the remaining debt on every push.

  **The scope widened past this ticket's declared packages, on the owner's
  instruction, and the question is recorded rather than the answer alone.** The
  question, put on 2026-09-08: this gate fails _future_ gate records for a reason
  their builder did not cause, because nothing today tells a reviewer to anchor
  the citations it writes into a `## Review` section — and this branch is what
  introduces that. Three answers were available: land the gate and let the first
  reviewer after it discover the rule from a red build; hold the gate until a
  separate ticket changes the convention; or change the convention here. **The
  owner answered: change it here.** So `.claude/skills/review-ticket/SKILL.md`
  step 4 now requires anchor text on every citation in the section, names the
  parser's one hard constraint — an anchor cannot contain a double quote at all,
  the operational line this page already carries — and step 8 tells the caller to
  run the checker over the record _before_ committing it. That file is outside
  this ticket's **Packages** line, and it is edited deliberately rather than as a
  builder helping itself to scope.

  **The gate was watched failing before it was believed.** Three runs, output as
  it came:

  - Anchor removed from a passing record —
    `FAIL tools/planner/docs/work/pl-2-container-image.md — 1 unanchored, 1 verified`,
    then an `unanchored` line naming the citation at record line 107 and the
    reason `no anchor — nothing checked it`. **Exit 1.** (The coordinate the run
    printed is described rather than reproduced: quoting it would mint a real
    unanchored citation in this page, which is the dodge the filing entry at the
    top of this Log already had to take twice.)
  - Anchor replaced with text that is nowhere in the file — same record, `1
moved, 1 verified`, and `anchor "not what that line says" is not in 147, and
not anywhere in tools/downloader/api/src/routes/web.ts`. **Exit 1.**
  - A passing record added to `GRANDFATHERED` —
    `STALE docs/work/repo-30-the-id-sweep-cannot-see-repo-tickets.md — passes this gate now`.
    **Exit 1.** That third one is the anti-rubber-stamp rule, and it is the one
    that would otherwise have shipped never having run.

  Reverted after each. The gate reports `4 enforced, 0 failing; 59
grandfathered, holding 47 unresolvable, 49 moved, 639 unanchored` at exit 0 on
  this branch.

  **This branch broke six citations and repaired them, which is the tax this gate
  makes visible.** Inserting 22 lines into `ci.yml` moved every line below them,
  and `repo-31`'s gate record cites six of those lines with anchors. All six were
  repointed against the tip — the anchor says where it went, so the repair is
  arithmetic rather than judgement — and a whole-corpus before/after comparison
  across all 121 work records now shows **no** citation whose state this branch
  worsened. That comparison is the check rather than a reading: every reference
  was resolved twice, once with this branch stashed and once with it applied.
  **2,287 references before, 2,293 after** — and both numbers are given because
  one of them is not the other: this Log entry adds six references of its own, so
  a single figure here would be the self-counting error the entry above this one
  records, committed in the paragraph that reports the check for it.

  **A seventh was worse and earns its own line, because it is this ticket's
  thesis arriving unbidden — again.** `repo-31` also cited line 272 of `ci.yml`
  with the anchor `"informational"`. After the 22-line shift that citation still
  reported **verified**, because the word occurs on five lines of `ci.yml` and one
  of them had moved into position 272 — a _comment_, not the `name:` expression
  the record was talking about. It was caught by checking the shift arithmetic,
  not by the checker, which is precisely what `Done when` 3 forbids: an anchor
  occurring on more than a handful of lines verifies nothing while reporting that
  it did. Repointed to
  `.github/workflows/ci.yml:326 "&& ', informational' || ''"`, a fragment that
  occurs once. **The sweep described above would have refused the old anchor**,
  which is the one point in its favour worth carrying to option B.

  **A premise in this page's own Log was stale and is corrected above.** The "Two
  dependencies" section said repo-21 was unbuilt at `status: ready` and reasoned
  about which of the two would land first. repo-21 is `done` and merged (PR
  #179), and its `--require-anchors` step is live in the `check` job, so this
  step lands _beside_ a working invocation rather than racing it. The two do not
  overlap — repo-21's reaches one skill page and no work record, this one's
  reaches the work records and no skill page — so `Done when` 7 is satisfied by
  repo-21's brief needing no amendment, checked against its file rather than
  assumed.

  **`Done when`, line by line, including the one that is not met.**

  1. Met before this branch; the decision entry is above.
  2. **Not met for the whole of D's scope, and this is the honest gap.** The
     enforced scope reports zero unanchored at exit 0; the 59 grandfathered
     records hold 639 unanchored citations and are excused by name. A reading of
     "the records in the chosen scope" that means the enforced set is satisfied;
     a reading that means every record with a `## Review` section is not.
  3. Vacuous for a sweep — none ran, which is the finding above — and **not**
     satisfied as a standing property, which the gate found and this line first
     got wrong. Seven citations in `repo-31` were touched: **six were repointed
     with their anchor text unchanged**, which the paragraph above correctly
     calls arithmetic, and **exactly one was re-anchored**, on a fragment
     occurring once. An earlier draft of this line said "the two … both
     re-anchored", which overcounted the judgement by one and undercounted the
     arithmetic by five. Nothing in the shipped tooling enforces distinctiveness
     at all — see the gate entry below.
  4. No evidence declaration was added or needed; the three already under
     `## Review` in the corpus are untouched.
  5. Met — three failing runs above, each with its output and its exit code.
  6. Met — `npm run check` and `node scripts/status.mjs --json` both exit 0.
  7. Met — see the repo-21 paragraph above.

  **`difficulty` is still unset, and this build is a data point for whoever rates
  it later.** The entry above records the owner's "leave it unset" and the gap it
  leaves. The work as actually done was neither `mechanical` nor `standard`: the
  mechanism is small, and every decision that mattered — revert the sweep,
  grandfather rather than migrate, widen into the review skill — came from a
  measurement that had to be taken first. Anyone rating this later should weigh
  that rather than the diff.

  **This page's own citations, re-run after writing the sentences above** — which
  is the rule the entry above this one added, applied to itself. Before these
  paragraphs: `6 verified, 5 moved, 1 unanchored, 0 unresolvable, 7 unchecked, 0
evidence — of 19 references`, exit 2, and the identical line from `main`'s copy
  of the file in this worktree — checked by stashing rather than assumed. After
  them: `9 verified, 5 moved, 1 unanchored, 0 unresolvable, 10 unchecked, 0
evidence — of 25 references`, still exit 2. This entry therefore adds six
  references, three of them anchored citations that verify and three of them
  prose, and it adds nothing to any failing class. The `moved` count had already
  gone 4 → 5 since the entry above recorded it, from drift this branch did not
  cause. They are the deliberate
  demonstration the owner ruled on and they stay. This page has no `## Review`
  section, so the gate does not read it at all; when it gains one, that section
  is enforced and these Log citations still are not, which is exactly the line
  option D draws.

- **2026-09-08 — the gate's findings, each reproduced here before it was
  accepted, and one of them turned out worse than reported.** Verdict CONCERNS,
  five findings, all `med`. Four are corrections to this page or to the gate
  script's docblock and are applied above. None changed what was built.

  **1. The grandfather list is guarded in one direction only, and the docblock
  claimed both.** Reproduced: break the anchor in the one passing record that
  carries a real citation, add that record to `GRANDFATHERED` in the same
  change, run the gate — `3 enforced, 0 failing; 60 grandfathered, holding 47
unresolvable, 50 moved, 639 unanchored`, **exit 0**, no `FAIL`, no `STALE`,
  no warning. repo-25's rule fires when an entry stops being needed; nothing
  fires when one is added, and nothing notices a listed record getting worse.
  The script said "the list can only shrink"; it now says which half of that is
  enforced and which half is a norm in a comment. **Whether to close it is an
  owner's call and is left open** — the obvious closure is a per-record count
  that may only ratchet down, and its cost is that the count grows when an
  _unrelated_ branch shifts a cited file, so the ratchet bills whoever moved the
  source. Finding 4 below is that scenario happening for real, which is the
  argument on both sides at once.

  **2. The enforced set has one record with a checked citation, not two.**
  Reproduced by running the checker on each of the four individually: `dl-17` and
  `dl-26` report `0 references`, `repo-30` reports 2 and both are `unchecked`
  prose, `pl-2` reports 2 and both `verified`. The paragraph above named the two
  empty records and let the reader infer the other two were checked. Corrected
  there, and it is worth naming the shape: a true sentence that leaves a false
  number behind is what this whole ticket is about, arriving in the entry
  reporting it.

  **3. Nothing in the shipped tooling enforces anchor distinctiveness — the
  `"informational"` catch above is a standing gap, not a one-off.** Read at
  `scripts/citations.mjs:827 "const inRange = hits.filter"`: `verified` is
  decided by whether _any_ occurrence starts inside the cited range, and the
  full hit list is computed but used only to word the `moved` message.
  **Reproduced rather than read**, in a throwaway repo: a record citing line 5 of
  a file with the anchor `"informational"`, where that word occurs on lines 3 and
  5; insert two unrelated lines at the top; the first occurrence slides into
  position 5 and the record's real target moves to 7. Both runs report the
  identical `ok` line for that citation, unchanged, at **exit 0** — the fixture's
  own coordinate is described rather than quoted, because quoting it would put an
  unresolvable citation into a throwaway repo on this page. So `Done when` 3 is a
  rule for
  authors that the checker cannot hold anyone to, and every anchor this repo
  writes from now on inherits that. Not fixed here: it is a change to
  `citations.mjs`, which has an open pull request against it (#186), and adding a
  uniqueness requirement would reclassify existing anchors — a decision, not a
  tidy-up. **Recommended as its own ticket**, and named here so it is not
  rediscovered.

  **4. This branch turns the merge with repo-34 red, which neither the builder
  nor the gate predicted, and the gate's own numbers for it were measured against
  a superseded commit.** The finding as relayed used repo-34 at `cd00fb4` and
  reported ~6 citations in `repo-31` silently re-breaking. Re-measured here
  against that branch's actual tip `66dfe19` — `cd00fb4` is its _first_ commit,
  and one of the two commits after it is literally "repoint repo-31's citations":

  - The merge is clean; git reports no conflict in either file both branches
    touch.
  - In the merged tree `repo-31` reports `20 verified, 8 moved, 0 unanchored, 0
unresolvable, 1 unchecked — of 29 references`, exit 2 — six of the seven
    `ci.yml` coordinates repointed on this branch need a further +3. `repo-31`
    is grandfathered, so that costs nothing but debt, which is finding 1's hole
    in its live form.
  - **The part that is not silent: `node scripts/citations-gate.mjs` on the
    merged tree exits 1.** repo-34's own record is _anchored_ — 12 verified, its
    reviewer wrote it that way with no convention telling it to — and it is not
    grandfathered, so this gate enforces it. Two of its citations name
    lines 210 to 231 of `ci.yml` with the anchor `"The unit and integration suites"`, which
    is at line 210 on repo-34's tip and at 232 in the merged tree, because this
    branch inserted 22 lines above it. `FAIL … 2 moved, 4 unchecked, 12
verified`.

  **Neither branch is wrong against its own base**, and repo-34's reviewer
  explicitly checked for a collision with this one and recorded that its edit
  "sits inside the `test` job and clear of the `check` job that a sibling session
  was sweeping concurrently on repo-29". That was right about textual conflict
  and wrong about citation drift, and nothing either of them could run would have
  said so — which is this ticket's thesis reproducing itself a third time, on the
  branch that exists to fix it, between two agents who were both being careful.
  **Whoever merges second re-runs the checker on `repo-31` and on repo-34's own
  record and repoints.** With this gate in place, the second half of that is not
  advice: CI says it.

  **5. One re-anchoring, not two.** Diffed against `origin/main`: six of the
  seven `repo-31` citations kept their anchor text and changed only their line
  number; exactly one gained new anchor text. Corrected in `Done when` 3 above.

  **What was not accepted.** Nothing was refuted — all five reproduce — but
  finding 4's evidence is replaced rather than carried: its sha was two commits
  stale, its "clean merge, silent debt" reading understates the result, and the
  corrected version is more severe than the one filed.

  **And this entry broke one of its own branch's citations while being written,
  which is the fourth instance in four days and the shortest feedback loop yet.**
  Rewriting the `GRANDFATHERED` docblock for finding 1 added lines to
  `citations-gate.mjs` and pushed `SCOPE` down 15 lines, so the anchored citation
  the entry above it makes about that constant went `verified` → `moved` inside
  the same edit. Repointed. Caught by running the checker on this page before
  committing, which is the only reason it is a note rather than a defect shipped
  in the ticket that exists to prevent it.

  **Counts for this entry, re-run after writing them.** Before it, the page
  reported `9 verified, 5 moved, 1 unanchored, 0 unresolvable, 10 unchecked, 0
evidence — of 25 references`; after, `10 verified, 5 moved, 1 unanchored, 0
unresolvable, 15 unchecked, 0 evidence — of 31 references`, both at exit 2. Six
  references added, one of them an anchored citation that verifies and five
  prose, and nothing added to any failing class. The five `moved` are still the
  deliberate demonstration the owner ruled on. Two coordinates this entry wanted
  to quote — the throwaway fixture's, and repo-34's — are described instead,
  because quoting them would have added one `unresolvable` and one `unanchored`
  to the page arguing against both, which the first draft of this entry did.

- **2026-09-08 — the owner closed both gaps the gate found, and the seam between
  them was measured rather than argued.** Findings 1 and 3 above were left open
  as owner decisions; both were answered "close it". Neither is a norm any more.

  **The premise this branch gave for deferring finding 3 was wrong, not stale,
  and that is worth the distinction.** The Log entry above says the distinctness
  rule was not built because "PR #186 is open against `citations.mjs`". Checked
  here rather than relayed: #186 merged as `479c831`, and `479c831` is an
  **ancestor of this branch's own base** — so that file was already settled when
  the objection was written. It was not a fact that expired; it was never true
  during this branch. An unverified premise offered as a reason to defer work is
  the same failure this ticket is about, one level up from a coordinate.

  **1 · The grandfather list ratchets now.** `GRANDFATHERED` is a `Map` from
  record to the number of failing references it may hold, not a `Set` of paths.
  Exceed the number and the run prints `WORSE` and fails; fall below it and the
  entry is `STALE` and the number must be tightened. So both jaws bite, and the
  literal hole reproduced above — with bare paths, _any_ addition silenced
  _anything_ — no longer works, because an entry has to name a count somebody
  wrote down.

  **The cost was accepted knowingly rather than discovered.** An unrelated branch
  that shifts a cited file drives a grandfathered record's count up and turns this
  red. The owner's reasoning: finding 4 is that failure already happening, and it
  is better loud than silent.

  **The second jaw fired on this branch before any test did, which is the
  demonstration that matters.** Repointing eight citations broken by the
  `citations.mjs` edit below took `repo-36`'s debt from 30 to 28, and the run
  answered `STALE docs/work/repo-36-citations-loses-the-record-path.md — now
holds 28 failing reference(s), not 30 — tighten the number`, exit 1. Nobody
  arranged that.

  **2 · A distinct-anchor rule exists and is enforced.**
  `scripts/citations.mjs:1178 "usage: node scripts/citations.mjs"` now advertises
  `--require-distinct-anchors`, which fails a run where a _verified_ anchor's
  fragment starts on more than one line of the file it points at. It sets its own
  exit bit (16) and **changes no citation's state**, which is `--require-anchors`'
  contract restated for the same reason: a citation's state is a fact about the
  record, and whether a weak anchor is tolerable is the caller's policy.

  **It is a separate flag rather than part of `--require-anchors`, and that was a
  measurement, not caution.** repo-21's live CI step runs `--require-anchors` over
  `orchestrate-tickets/SKILL.md`, and that file anchors a citation on
  `"model: sonnet"` — a fragment occurring twice in `ticket-reviewer.md`. Folding
  the rule into the existing flag would have turned that step red on a file
  nothing here touched: the exact failure this ticket exists to stop shipping,
  committed by the branch fixing it. Recorded in repo-37's Build so whoever
  tightens that step fixes the anchor first.

  **The seam the orchestrator asked to be watched did not close.** The worry was
  that a uniqueness rule would push records onto the grandfather list at the
  moment that list was made harder to add to. Measured before either was built:
  across the whole enforced set exactly **one** anchor failed the new rule —
  `pl-2` anchoring on `"prefix"`, which occurs twice in the downloader's
  `web.ts`. It was repaired by adding one character, to `"prefix:"`. The
  grandfathered set is **59 records before and after**, so nothing was pushed onto
  the list and nothing had to be loosened. Had it gone the other way this entry
  would say so instead of saying it was fine.

  **What the two changes cost the corpus.** Total debt behind the list is now
  **741 failing references** across the same 59 records: 639 unanchored, 49
  moved, 47 unresolvable, and 6 indistinct anchors the new rule found. The gate
  reports `4 enforced, 0 failing; 59 grandfathered, holding 47 unresolvable, 49
moved, 639 unanchored, 6 indistinct` at exit 0.

  **3 · A fifth instance of this ticket's thesis, caused by the fix for the
  third.** Adding ~60 lines to `citations.mjs` moved every line below them and
  broke **eight** anchored citations across `repo-35` and `repo-36`. Every one
  named where it had gone, so the repair was arithmetic; all eight are repointed,
  and the whole-corpus before/after over 121 records shows nothing worsened. One
  of the eight was also indistinct — `repo-35` anchored the usage string on
  `"[--rev <sha>] [--section <name>]"`, which the docblock repeats — and was
  re-anchored on a fragment occurring once rather than merely repointed.

  **And a sixth, in a ticket filed by this very entry.** repo-38 cited
  `repo-30`'s transcription note anchored on `"Transcription note, by the
builder"`. That record carries three such notes — a fact repo-38's own sentence
  states — so the anchor was ambiguous and the new flag refused it before the
  ticket was committed. The rule caught the page arguing for the rule, in the
  hour it was written.

  **4 · Two tickets filed**, because a measurement with no home evaporates:

  - [repo-37](./repo-37-the-review-corpus-is-not-anchored.md) — the 741-reference
    migration, `ready`, `difficulty: hard`. It carries the corpus figures, the
    reverted sweep's two false anchors and the two boundaries that sweep earned
    (never a shorthand, never a citation inside a quoted reproduction), the
    331-drifted measurement, and **finding 2's correction** that today's enforced
    surface is one record and two citations. That last one weakens the argument
    for having stopped where this branch stopped, and it is in the ticket for
    that reason.
  - [repo-38](./repo-38-two-documents-disagree-on-who-writes-the-review.md) — the
    `## Review` authorship contradiction, `needs-decision`. Both quotations were
    read from `origin/main` here rather than relayed, and the shape is sharper
    than the relay: the two documents **agree** the reviewer must not write the
    record and give the same reason, and differ only on whether the _caller_ or
    the _builder_ does — which is why nobody reading one against the other has
    noticed. Today's behaviour is unchanged on the owner's instruction, and the
    two documents are deliberately not reconciled on this branch.

  Ids taken from `node scripts/next-id.mjs repo`, which reported `next free:
repo-37`. That sweep is a snapshot: repo-29's own Log records losing an id to a
  peer session between the sweep and the commit, so if either number is claimed
  elsewhere these files move and the branch keeps its name.

  **5 · Merge order, decided by the owner and not by this branch: repo-34 lands
  first, then this rebases onto it.** No rebase or repoint has been done here —
  repo-34's tip is still moving, and coordinates repointed against a moving tip
  are the defect this ticket describes. When it merges, both `repo-31`'s `ci.yml`
  citations and repo-34's own gate record need repointing, and the second of
  those is a red build rather than silent debt because repo-34's record is
  anchored and not grandfathered.

  **6 · The verification this branch had been reporting with was wrong twice,
  and the ratchet is what exposed it.** Every earlier entry above cites a
  "whole-corpus before/after comparison … no citation whose state this branch
  worsened". That check keyed each citation on `record:line|file:start-end`, and
  it has two blind spots, both found here rather than reasoned about:

  - **A record line that moves hides a regression.** Appending a Log entry above a
    citation changes its record line, so the key changes and the citation reads
    as _new_ rather than as changed. Re-keying on the target and the anchor
    instead — what a reader means by "the same citation" — immediately turned up
    a seventh broken citation the earlier runs had reported as six.
  - **Repointing changes the key too, so a _wrong_ repoint is invisible.** Fix a
    coordinate to 1301, then delete a line above it, and the citation is broken
    again at a key that never existed on the base. Both diffs reported clean.
    **What caught it was the gate**: `WORSE
docs/work/repo-36-citations-loses-the-record-path.md … 30 failing, and its
GRANDFATHERED entry allows 28`, exit 1, naming two off-by-one repoints. A
    third check that counts broken citations _per record_ rather than matching
    them one to one then found six more in `repo-35`, which the gate could not
    see because that record has no `## Review` section.

  All of them are repaired; the two independent checks and the gate now agree.
  The point worth keeping is not the eight repairs, it is that **the bespoke
  check this branch trusted was weaker than the gate it was building**, and said
  so in the confident register both times. A count that cannot go down is a worse
  thing to be wrong about than a diff, which is the argument for the ratchet
  arriving from the direction nobody planned.

- **2026-09-08 — gate 2, on the new surface only: one `med`, and it is a
  correction to what this page claimed rather than to what was built.** The
  entry above said the silencing hole was "closed by construction". It was not.
  The ratchet catches error and mis-provisioning; **a number that is exactly
  right is always silent, so a deliberate silencer still gets through.**

  Reproduced here rather than accepted, three runs on one record, each one a
  command:

  - **A.** Break a citation in a passing record and add that record to
    `GRANDFATHERED` at its exact new count — `3 enforced, 0 failing; 60
grandfathered`, **exit 0**. Silent, and silent for ever after: `STALE` fires
    only on `failing < allowed`, never on `==`, so an exact-match entry is
    permanently indistinguishable from inherited debt.
  - **B.** Break a _second_ citation in the same record, entry untouched —
    `WORSE tools/planner/docs/work/pl-2-container-image.md — 2 moved — 2 failing,
and its GRANDFATHERED entry allows 1`, **exit 1**. This is the ratchet
    working, and it is why the change was worth making.
  - **C.** Raise that entry from 1 to 2 in the same change — **exit 0**,
    absorbed, the record gone from the output entirely.

  **What does defend, so the finding is not overstated.** Over-provisioning is
  caught: adding a record at a round buffer number it does not need gives
  `STALE … now holds 1 failing reference(s), not 10 — tighten the number`, exit
  1, on the very next run. So a lazy silencer is caught and only an exact one is
  not.

  **It cannot be closed here, and that is structural rather than an oversight.**
  This gate reads the checkout and never the history — `ci.yml`'s `check` job
  takes a depth-1 clone with no `fetch-depth`, checked rather than assumed — so
  there is no previous value of a number to compare against. **What the count
  actually buys is a legible diff, not a machine guarantee**: silencing a record
  used to be one appended path and is now a number somebody has to write, or an
  existing number somebody has to raise, in a file whose whole purpose a reviewer
  knows. That is a real improvement and it is a different claim from the one the
  entry above made.

  Both the gate's docblock and that entry are corrected in this commit. **The
  framing was the defect; the mechanism does what it does.**

  **Open decision, for the owner and not for either agent in this loop.** The
  residual is now disclosed; whether to spend anything on it is a call with two
  defensible answers and a real cost either way:

  - **A. Accept it as the norm's residue and stop here.** Free. The disclosure
    above is the whole mitigation, and the argument is that a deliberate silencer
    is a person choosing to lie in a diff, which no in-tree check catches — the
    same reason `.claude/settings.json`'s deny list is documented as a guardrail
    and not a boundary.
  - **B. Require a justification beside each entry** — a reason string the gate
    refuses to accept as empty. Cheap, and it converts a silent number into a
    sentence somebody has to write and a reviewer can disbelieve. It does not
    stop anyone; it raises the cost of not being noticed.
  - **C. Make a history-aware check**, in a job that fetches more than one
    commit, comparing each entry against the base branch's value. The only option
    that actually closes it, and the most expensive: it needs a second checkout
    depth, it cannot live in `check` as that job is configured, and it is a new
    failure mode on every branch whose base has moved.

  **Recommended: B.** A is honest but spends the disclosure and nothing else; C
  buys a guarantee against a threat model — an agent deliberately concealing a
  regression from its own gate — that nothing else in this repo defends against
  either, at the price of a new CI shape. B is the one whose cost matches the
  risk.

  **Everything else on the new surface checked out**, and two of the checks are
  worth naming because they were done independently rather than re-run from this
  page: the `"model: sonnet"` fragment really does occur exactly twice in
  `ticket-reviewer.md`, and simulating the fold-in by running
  `--require-anchors --require-distinct-anchors` over
  `orchestrate-tickets/SKILL.md` gives `exit 16` on a file this branch never
  touched — so keeping the flags separate was necessary and not merely tidy. And
  the no-worse-than-base claim was corroborated by a third method: grep the whole
  corpus for citations naming the three files whose line numbers this branch
  moved, then check each of those 11 records.

  **One thing this page got wrong while checking the finding, recorded because it
  is the same shape one level down.** Reading `repo-31`'s failing count off the
  checker's summary line gave 1, while the gate counts 4. Both are right: the
  summary line carries the six _states_, and an indistinct anchor is not a state
  — it is `verified` with a policy attached, so it appears in the exit line
  (`N anchor(s) not distinct`) and in the per-citation output, and nowhere in the
  summary. That is deliberate and consistent with how a stale evidence
  declaration is reported, but a reader who greps the summary line for a total
  will be short by exactly the indistinct count.

- **2026-09-08 — one more trap, found in the gate's own verification rather than
  in the code under review, and it is the ticket's thesis at one more remove.**
  Gate 2 corroborated the no-regressions claim with a method better than either
  of the builder's: grep the whole corpus for citations naming the files this
  branch moved, then check each of those records. It reported one record with
  breaks. Re-run here it gives four — `repo-18` 26, `repo-1` 8, `repo-29` 5,
  `repo-21` 2 — and all four are pre-existing, so the conclusion held and the
  count did not.

  **The cause is a legibility trap in `citations.mjs`'s own output, and it is
  now commented where a grepper hits it.** Two of the six per-citation labels are
  not their state's name: `unresolvable` prints as **`FAIL`** and `verified` as
  **`ok`**. A sweep grepping `^ (MOVED|UNRESOLVABLE)` therefore drops every
  unresolvable citation — the worst class — and prints a smaller number with no
  indication anything was missed. That is the same shape as the defect this
  whole ticket describes: a check that reports confidently while a class of
  failure is invisible to it, one layer up from a coordinate.

  **`citations-gate.mjs` prints the state name for the same fact**, so the two
  tools label one thing two ways. Left as is — upper case meaning "always a
  failure" is repo-18's deliberate design and the gate's state names are the
  right choice in a per-record listing — but the mismatch is now stated in both
  places rather than discoverable only by being caught by it.

  **Where this leaves the no-regressions claim: three independent methods now
  agree**, and the third is the reviewer's with its filter corrected. Every
  record carrying breaks carries exactly as many as it did at `b384033`, checked
  per record rather than per citation, because the per-citation key changes when
  a coordinate is repointed and cannot see a repoint that is wrong.

- **2026-09-08 — the owner chose option C, the history-aware check, over the
  justification string this branch and its gate both recommended.** Built. The
  reasoning against B is the one both of us had already written down without
  following it to its conclusion: **B raises the effort of silencing without
  closing it**, and anyone willing to read an error message and paste an accurate
  number will also write a sentence. C is the only option of the four that closes
  both reproduced variants, because it supplies the one thing the gate lacked —
  the previous value of a number.

  **`--against <ref>` compares this tree's `GRANDFATHERED` with the copy at
  `ref` and fails on any entry that allows more than it did, an absent entry
  counting as zero.** So an addition is an increase, caught by the same
  comparison rather than by a rule of its own — which is the norm the file
  already stated in prose, finally enforced. Lowering a number or deleting an
  entry is always allowed; that is the ratchet turning the right way.

  **Watched failing first, both variants, with the output as it came.** Each was
  run twice — without the flag, which is what shipped before this round, and with
  it:

  - **Variant A**, break a citation in the one passing record that carries a real
    one and append it at its exact new count. Without history: **exit 0**, silent.
    With history: `RAISED tools/planner/docs/work/pl-2-container-image.md — its
GRANDFATHERED entry went from 0 to 1 against 68ee870`, then `60 entr(y/ies)
compared against 68ee870: 1 raised.`, **exit 1**.
  - **Variant C**, two real regressions in that record absorbed by appending it
    at 2. Without history: `3 enforced, 0 failing; 60 grandfathered`, **exit 0**.
    With history: `RAISED … went from 0 to 2`, **exit 1**.
  - **Raising an existing entry**, `repo-31` from 4 to 5: `RAISED
docs/work/repo-31-the-windows-leg-is-almost-all-red.md — its GRANDFATHERED
entry went from 4 to 5 against 68ee870`, **exit 1**.

  **And the negative controls, because a check that fires on everything is not a
  check.** Lowering `repo-31` from 4 to 3 gives `0 raised` from the history
  comparison — the `WORSE` it also prints is the in-tree jaw correctly saying the
  record really does hold 4. Deleting an entry outright gives `58 entr(y/ies)
compared against 68ee870: 0 raised.` A ref that does not resolve is an
  **error**, not a skip: `--against no-such-ref: no such commit. In CI that means
the checkout was shallow`, exit 1 — because reporting "nothing went up" after
  comparing against nothing is the failure this whole ticket is about.

  **The CI shape is the cheap one, and this is where the branch's own late
  finding paid for itself.** `check` keeps its step and its position; only its
  checkout gains `fetch-depth: 0`, which is **what the job fetches and not when
  it runs**. The precedent was already in the same file — the `changes` job sets
  it with a comment saying why — so this is an existing shape in a second job
  rather than a new one. The step passes
  `--against "origin/${{ github.base_ref || 'main' }}"`, so a pull request opened
  against another branch is compared with _that_ branch and not with `main`,
  which is the case `docs/01-TICKETS.md` warns about for a different reason.

  **Two comments in `ci.yml` were made false by that one line and are fixed in
  the same commit.** Both the `status.mjs` step and repo-21's citations step said
  this job reads the checkout and not the history _because_ there is no
  `fetch-depth` above. There is now. They now say they read the checkout **by
  choice**, and that a board check consulting the log would be answering a
  different question from the one repo-12 asked. Catching that was luck of the
  kind this ticket exists to remove: the sentence was three lines above the line
  that invalidated it.

  **What is left after C, narrowed rather than deleted.** The disclosure the gate
  was caught overclaiming once already is now smaller and still there:

  - **This branch's own 59 entries are not covered and cannot be.** The commit
    they would be compared against has no copy of the file, so the first run
    prints `No history compared — origin/main has no scripts/citations-gate.mjs`
    and passes. Printed rather than assumed, happens exactly once, and it means
    the initial list is only as good as the review that reads it. **That is this
    gate's own reviewer, on this branch.**
  - A push straight to `main` compares `main` with itself. Denied and
    squash-merged, so the pull request run is the gate.
  - A raise that survives review on a base branch is inherited as legitimate
    afterwards. Intended: the check moves the decision to a human rather than
    making it, which is why the failure text says to repair the citations and not
    the number.
  - A local run passes no ref and says `No history compared` on stdout, on every
    run including clean ones, so a log can tell "nothing went up" from "nothing
    was checked".

  **The pinning test was updated rather than left to disagree with itself.** It
  asserted the residual existed; it now asserts what `gate` alone still excuses
  and is named for that, sitting immediately above the tests for the check that
  covers it. Nine more tests: the parser against the live constant, both
  variants, the two ratchet-down directions, the bootstrap, the unresolvable ref,
  an unreadable base list, and the missing flag value. 28 in that file, 284 in
  the `repo` project.

  **One thing that could not be measured here and is named as unmeasured.** There
  is no YAML parser in this worktree and no network to fetch one, so the workflow
  change is **not** machine-validated. What was checked instead: the new
  `with:`/`fetch-depth: 0` block is byte-identical in indentation to the
  `changes` job's existing one, compared with `cat -A`. A malformed workflow
  fails on the first push, loudly, which is the cheap direction — but it is not
  the same as having parsed it.

  **One citation this branch made _quieter_, which its own check caught and which
  is worth more than the eighteen it repointed.** `repo-6` writes two bare
  shorthands — a backticked line number with no filename — in a paragraph about
  `scripts/status.mjs`; the nearest qualified citation above them names
  `.github/workflows/ci.yml`, so both bind to the workflow — repo-25's wrong-file inheritance, live on `main`. While
  `ci.yml` was shorter than 401 lines those were past its end and reported as
  such. This branch's CI comments took the file to 414, so the first now
  **resolves** — to an `echo` inside a shell block — and reports `unanchored`,
  which looks exactly like a citation nobody has anchored yet. Their coordinates
  are described rather than quoted, because a backticked bare number is a
  shorthand: the first draft of this paragraph minted three fresh ones, one of
  them twice, in the two pages explaining the defect.

  Nothing failed: neither state is fatal, `repo-6` has no `## Review` section, and
  no gate here will ever read it. It is recorded because the direction is the one
  that matters — **a loud wrong citation became a quiet one, and the cause was
  making an unrelated file longer.** Not repaired here: the symbols the record
  names are no longer in `status.mjs`, so qualifying the shorthands means deciding
  what a merged record's dated claim should point at, which is judgement over
  somebody else's evidence and belongs to repo-37, where it is now written down.

  It was found only because the branch's third check ranks `unchecked` above
  `unanchored` and flagged a transition neither of the other two would call a
  regression — the check disagreeing with its author, one more time.

- **2026-09-08 — gate 3: one `med`, falsified rather than argued, and disclosed
  rather than closed on the owner's answer.** The docblock claimed the bootstrap
  window — a base with no copy of this file, which reports `No history compared`
  and passes — "happens exactly once". It does not. It reopens once per
  continuous stretch of history in which the file exists.

  **The reproduction, with its steps rather than a summary of them.** A scratch
  repository, three commits: the first carrying a real gate with an honest
  `["docs/work/a.md", 1]`; the second **deleting `scripts/citations-gate.mjs`
  outright**; the third re-adding it with `9999` in place of the `1`. Comparing
  the third against the first gives
  `{"raised":[{"record":"docs/work/a.md","was":1,"now":9999}]}` — caught.
  Comparing it against the second gives
  `{"skipped":"… has no scripts/citations-gate.mjs …","raised":[]}` — **9999
  through, zero objection**, on the same code path as an ordinary first run. Run
  here as well as by the gate, and it is why the claim above is now narrowed in
  place instead of restated.

  **Answered by the owner: disclose, do not build a defence.** Two facts decided
  it, and both belong on the page rather than in a transcript. The route's first
  step is a **separately merged pull request deleting the whole
  citation-enforcement script** — louder than anything this check defends
  against, which is the gate's own calibration and it is right. And the branch
  introducing the gate is _itself_ inside the window, so a defence would have
  shipped together with the follow-up to remove it. **The reasoning is the
  practical bar, not the mechanism: the mechanism does not defend against this**,
  and the docblock now says so in those words.

  **Disclosed here as a builder's note, because this branch had already built the
  closure before the answer arrived.** It was a `git log` distinguishing a base
  that never had the file from one that lost it, plus a refusal on a shallow
  clone where that question cannot be answered; it passed its tests and did _not_
  fail this branch, because `origin/main` genuinely never had the file. **It is
  reverted, not kept** — the option the owner declined was described as failing
  this branch, and mine did not, so the two are not the same object and the
  difference is recorded rather than resolved by keeping the code. If that
  distinction changes the answer it is the owner's to change; a builder holding
  on to a declined mechanism because its own version is cheaper is the thing this
  note exists to not be.

  **What the disclosure rests on, and it is not the mechanism.** Every one of the
  59 founding entries was audited by the gate against what its record actually
  holds — enumerated, not sampled — and **59 of 59 matched exactly**, with none
  allowing more debt than its record has and four re-derived through the
  `citations.mjs` CLI to rule out the audit script itself being the broken thing.
  Those 59 are the one list `--against` can never check, so that audit is their
  whole guarantee and it is written down here for that reason.

  **The caveat the entry above left standing is discharged, by someone with a
  route this worktree did not have.** That entry recorded the workflow change as
  **not** machine-validated — no YAML parser here, no network to fetch one — and
  offered a `cat -A` indentation comparison as the named substitute. The gate had
  network: `js-yaml` parses `.github/workflows/ci.yml` cleanly, and `actionlint`
  v1.7.12 returns **0 errors and 0 warnings**. Read the earlier caveat as
  discharged rather than as still open. The substitute was labelled a substitute
  at the time, which is the only reason this is a discharge and not a correction.

  **One thing left undone on purpose.** A third comment in `ci.yml` still calls
  this job's clone "depth-1" after the checkout stopped being one. The gate
  raised it explicitly as _not_ a finding — the paragraph under it carves out
  `--against` correctly, so no reader is misled — and this round was scoped to
  documentation about the residual. It is a true sentence about a state the same
  commit removed, which is this ticket's genre exactly, and it is left here so
  that whoever touches that neighbourhood next has it named rather than has to
  notice it.

- **2026-09-08 — the bootstrap decision was re-put and the answer moved, because
  the cost it was first weighed against was wrong.** The closure the entry above
  records as reverted is **restored**. Same mechanism, un-reverted rather than
  redesigned.

  **The error was in the relay, and it is recorded as that rather than as
  anybody's oversight.** When the option was put to the owner it was described as
  needing an explicit `--bootstrap` flag, with this branch's own CI run requiring
  it and a follow-up to remove it after merge. That description was of a
  mechanism the describer had not seen. The one that existed uses `git log` to
  separate a base that never had this file from one that lost it, plus a refusal
  where a shallow clone makes that question unanswerable, and it does **not**
  fail this branch — `origin/main` genuinely never had the file, so the
  legitimate path is untouched. The owner declined one object and this branch had
  built another.

  **What made the difference visible was refusing to keep the code.** The
  previous entry could have folded the closure in quietly on the grounds that it
  was cheaper than the thing declined; it reverted instead and wrote the
  distinction down as the owner's to weigh. That note is what got the decision
  re-put. A builder keeping a declined mechanism because its own version is
  better is the failure being avoided, and avoiding it is what surfaced the
  mis-costing — which is the argument for the rule, since the rule cost a round
  and bought a corrected decision.

  **Failed first, with the attack that found the hole, both states run rather
  than summarised.** Three commits in a scratch repository: an honest
  `["docs/work/a.md", 1]`; a commit deleting `scripts/citations-gate.mjs`
  outright; a third re-adding it with `9999`.

  - **Before**, at the reverted tip — against the first commit
    `{"skipped":null,"raised":[{"record":"docs/work/a.md","was":1,"now":9999}]}`,
    and against the deletion
    `{"skipped":"… has no scripts/citations-gate.mjs …","raised":[]}`. **9999
    through.**
  - **After** — against the first commit, unchanged. Against the deletion it
    throws: `scripts/citations-gate.mjs is missing there, but that branch's
history has it — it was deleted rather than never added. Re-adding this file
on top of a commit that dropped it would reopen the one window in which any
GRANDFATHERED number is accepted unchecked, so this refuses instead.`

  **And the negative control that matters more than the attack, because failing
  it would break this branch.** A genuine first-ever bootstrap must still pass,
  and does: `No history compared — origin/main has no scripts/citations-gate.mjs
and never did, so there is no earlier list to compare against`, **exit 0**. The
  wording gained `and never did`, which is the whole of the new distinction
  showing up in the output. An ordinary comparison is untouched: `59 entr(y/ies)
compared against 68ee870: 0 raised.`, exit 0. **That property — the legitimate
  case still passes — is exactly what separated this mechanism from the one the
  owner declined**, so it is asserted here rather than assumed, and pinned by a
  test that drives both sides.

  **The disclosure is narrowed again, in the same paragraph, because it was about
  to be false.** It said in those words that _the mechanism does not defend
  against this_. It does now, so that sentence is gone rather than left to read
  true — the third time on this branch that a comment would otherwise have
  survived the thing it described. What it says instead is what is actually left:
  a base that never had the file is excused **and has to be**, since closing that
  would fail the commit that opens it; a shallow clone is refused rather than
  guessed at; and the reopening case is closed with the reason.

  **The 59/59 audit is credited exactly as before and is not made redundant.**
  No later check can retroactively cover entries written before the comparison
  existed, so the founding list's guarantee is still that audit — enumerated not
  sampled, 59 of 59 matching, four re-derived through the CLI — and the docblock
  now says in one clause that restoring this check does not touch it.

- **2026-09-08 — gate 4: one real finding, reproduced and disclosed rather than
  closed, and the cost of closing it is measured rather than described.** The
  restored deletion probe asks `git log` about `SELF`, so **renaming this file
  evades it**, and unlike the deletion route that takes one commit rather than
  two.

  **Reproduced here before it was written down.** A scratch repository: an
  honest base with the gate at `scripts/citations-gate.mjs` allowing one record
  `1`; an attacker commit deleting it and adding `scripts/citations-gate2.mjs`
  with `SELF` repointed. Probing as each copy would probe for itself —
  `probe for the original name : base has it`, and
  `probe for the renamed file  : SKIPPED — never existed, excused`. Asked about
  the _original_ path the same base correctly reports
  `{"raised":[{"record":"docs/work/a.md","was":1,"now":50}]}`, so the mechanism
  is sound and it is the question that is wrong, not the answer.

  **What still catches the lazy version, which is the gate's own calibration and
  it is right.** An entry set _higher_ than its record's real debt trips the
  in-tree `STALE` jaw, which consults no history at all. So the silent route
  needs a rename **and** a count matching the real debt exactly — the gate-2
  residual and this one composing — plus a `ci.yml` edit to invoke the new
  filename. Still a visible diff, and quieter than the deletion route it
  replaces.

  **The cost of closing it, measured on this repo rather than estimated.** The
  closure is to locate the base's list by _content_ instead of by path.
  `git grep -l "export const GRANDFATHERED = new Map"` over a whole ref runs in
  **38 ms**, which is nothing. It returns **three** paths — this script, its own
  test file, which carries the same declaration inside a fixture helper, and
  **this record**, which quotes the search string in the act of describing the
  measurement — so the rule "exactly one match" fails on the tree as it stands
  today, and the closure needs a discriminator that neither a test fixture nor a
  ticket writing about it can accidentally satisfy. Scoping the search to
  `scripts/*.mjs` gives exactly one match in 4 ms and moves the evasion one step,
  to a rename out of `scripts/`. **That is the whole decision: a cheap probe, and
  a discriminator nobody has designed.** Not built, and the numbers are here so
  whoever decides is not deciding against a description.

  **Two routes the gate enumerated and cleared, recorded so they are not
  re-walked.** A merge from a side branch does **not** hide the file: `git log`
  finds it through the merge parent, tested directly. A squash or rewrite of the
  base branch's own history would work, and is out of scope for any check here —
  every gate in this repo assumes `main`'s history is trustworthy.

  **The low finding is fixed rather than noted.** There was no test over the
  shallow-clone refusal; the gate had verified it by hand against a real shallow
  clone and said so. There is one now, and it builds a real shallow clone rather
  than mocking one — **`--depth` is ignored for a plain local path**, so the clone
  goes through `file://` and the test asserts `--is-shallow-repository` is `true`
  before asserting anything else. Without that assertion the clone would come out
  complete and the test would pass having measured nothing, which is this
  repo's own recorded trap about tests that measure the sandbox.

  **The docblock says all of it**, including that renaming evades the probe and
  what the measured closure would cost, because the paragraph as it stood read as
  covering the reopening case in general when it covers exactly one shape of it.
  That is the fourth time on this branch a comment would otherwise have outlived
  what it described.

- **2026-09-08 — the number in the entry above was wrong before it was
  committed, and the entry is what made it wrong.** Gate 4's follow-up caught it
  and it reproduces: the unscoped probe returns **three** paths, not two —
  `scripts/citations-gate.mjs`, `scripts/test/citations-gate.test.ts`, and **this
  record**, which quotes the search string in the act of describing the
  measurement. Corrected in both places.

  **The mechanism is this ticket's own rule, broken by the entry that relies on
  it.** An entry near the top of this Log says: _re-run the command after writing
  the sentence that quotes it_. The measurement was taken before the paragraph
  reporting it existed, was true then, and was false by the time it reached a
  commit — the paragraph created the third match. Re-run now, after writing this
  one, it is still three, because both edits went into files that already
  matched.

  **It strengthens the argument it was supporting rather than weakening it.** A
  closure keyed on "exactly one file in the tree contains this declaration" is
  defeated not only by a test fixture but by _writing about the rule_ — a ticket,
  a design note, a review comment. Three accidental matches is a better case
  against the naive form than two was, so the open decision on the rename bypass
  is unchanged in substance and better evidenced.

  **Fourth correction on this branch of a claim that was true when measured**,
  after the `"informational"` anchor, the two `ci.yml` comments, and the
  reference counts. Every one has the same shape: a number or a sentence that
  described the tree accurately and then stopped, with nothing between it and a
  reader. That is the ticket, arriving in the ticket, for the fifth time.

- **2026-09-08 — the rename bypass is closed, with a mechanism this branch had
  not costed.** The owner chose a **path glob**, `scripts/citations-gate*.mjs`,
  for the history probe — not the content probe this branch had priced and
  declined. The two are different objects and the distinction is the whole
  reason the answer was cheap: a content probe matches three paths and needs a
  discriminator nobody has designed; a path glob anchored at the gate's own name
  matches **one**, and matches neither the test fixture under `scripts/test/` nor
  this record under `docs/work/`.

  **Verified before building on it, because it arrived as a proposal and said so.**
  `git ls-files -- 'scripts/citations-gate*.mjs'` → **1** path,
  `scripts/citations-gate.mjs`, and zero matches against `test` or `docs`. The
  history probe with that pathspec runs in **2 ms**, and against `origin/main` —
  which never carried a gate — it is empty, which is the property the whole
  closure depends on.

  **Failed first, end to end, through the attacker's own copy rather than a
  shim.** A scratch repository with a real `citations.mjs`, a real record holding
  one unanchored citation, and a real gate module; then one commit that deletes
  `scripts/citations-gate.mjs`, adds `scripts/citations-gate2.mjs` with `SELF`
  repointed, breaks a second citation, and sets the entry to exactly the new
  debt. Invoked as CI invokes it, `node scripts/citations-gate2.mjs --against

<base>`:

- **Before**, at `74c85be`: `0 enforced, 0 failing; 1 grandfathered, holding 2
unanchored.` and `No history compared — … has no scripts/citations-gate2.mjs
and never did`. **Exit 0.** The raise from 1 to 2 absorbed in silence.
- **After**: `no scripts/citations-gate2.mjs there, but that branch's history
carried a file matching scripts/citations-gate*.mjs — so it was deleted, or
this one has been renamed.` **Exit 1.**

**The three controls, all held.** A genuine first-ever bootstrap still passes —
asserted for the third time on this branch because it is the property a
closure here can most easily break, and this branch _is_ that commit:
`origin/main has no scripts/citations-gate.mjs and never did`, exit 0. The
gate-3 deletion attack stays caught. `--against 68ee870` stays at `59
entr(y/ies) compared … 0 raised`, exit 0.

**Deletion and rename share one message, deliberately.** Telling them apart
needs a second pattern in a second syntax — `git ls-tree` does not honour this
pathspec, checked rather than assumed — and two spellings of one idea drifting
apart is the defect this ticket is about. One `git log`, one refusal, both
named in the text.

**What it does not do, stated because the paragraph it replaces was wrong the
other way.** `GATE_GLOB` is a constant in the file it protects, so someone
renaming the gate can edit it too, and a rename to a path outside the glob with
the constant updated evades the check. That is a bigger and stranger diff than
the one now closed, and no in-tree constant can do better than make a diff
louder — the same sense in which this repo's deny list is documented as a
guardrail rather than a boundary. The docblock says so where the constant is
defined.

**Two tests**, and the second is the one that matters for the next person:
the rename refusal, written from the renamed file's point of view because that
is the only side that can be built; and an assertion that the glob matches
`SELF` **and nothing else in this repository**, which is what would fail loudly
if anyone ever added `scripts/citations-gate-helpers.mjs` and quietly widened
the probe. 32 in that file, 288 in the `repo` project.

- **2026-09-08 — gate 5 passed with no findings, and contributed one measurement
  that sharpens the residual rather than a defect.** The disclosure said the
  rename bypass survives "a rename to a path outside the glob with the constant
  updated". True, and it left open whether editing `GATE_GLOB` was one route
  among several. The gate tested the sub-case; reproduced here rather than
  relayed:

  - rename to `scripts/gate.mjs`, **`GATE_GLOB` left alone** → **exit 1**, refused,
    because the unedited glob still matches the _old_ filename in the base's
    history;
  - rename to `scripts/gate.mjs`, **`GATE_GLOB` edited to match** → **exit 0**,
    `No history compared`.

  So editing the constant is **necessary**, not merely sufficient. That is worth
  a sentence in the docblock because it changes what the residual costs an
  attacker: not a rename, but a rename plus an edit to the one constant whose
  entire job is catching renames — about the strongest tell a diff here can
  carry. The framing "a bigger, stranger diff" was generous when written and is
  now measured.

  **The glob-boundary test was verified to be a real canary rather than a test
  that cannot fail**, which is this repo's own recorded trap: the gate added
  `scripts/citations-gate-helpers.mjs`, staged it — necessary, since the check
  reads the index through `git ls-files` and not the working tree — and the test
  failed naming the extra path, then passed again once removed. Worth recording
  because a boundary assertion nobody has watched fail is the same shape as a
  gate nobody has watched fail.

- **2026-09-08 — the repoint this branch promised landed after the merge, not
  before it, and `main` was red in between.** The pull request said in its first
  paragraph that #193 had to merge first and that a follow-up commit repointing
  two records had to land before this one merged. All three pull requests merged
  **34 seconds apart**, so the follow-up never got written, and the ordering the
  body asked for was overtaken rather than ignored.

  **What that makes false, stated plainly because this page claims the
  opposite.** The entries above say every citation in the corpus was left no
  worse than at this branch's base. That was true of the branch and **not true of
  `main`** between `1eecbdb` and this commit: the gate exited **1** there.
  Reproduced rather than taken from the report that raised it:

  - `FAIL docs/work/repo-34-the-windows-only-code-paths-nothing-asserts.md — 3
moved, 4 unchecked, 13 verified` — **the predicted case, arriving exactly as
    predicted.** That record is anchored and not on `GRANDFATHERED`, so this
    branch's own gate enforces it, and this branch's `ci.yml` insertion moved the
    lines its citations name. Both the gate and this builder had said in advance
    that this one would be a red build rather than silent debt.
  - `WORSE docs/work/repo-31-the-windows-leg-is-almost-all-red.md — 7 failing,
and its GRANDFATHERED entry allows 4`.

  **Seven citations repointed, and the two records needed different arithmetic.**
  repo-34's three moved by a uniform **+54** — one of them a range, `210-231` to
  `264-285`, re-resolved against the merged file rather than shifted on faith,
  since both branches edited `ci.yml` in different places and a uniform shift was
  an assumption rather than a fact. repo-31's four moved by **+11** in `ci.yml`
  and **+9** in `hls-e2e.test.ts`. Every one was arithmetic rather than judgement,
  because every one carried an anchor saying where it had gone — which is the
  whole argument of this ticket, cashed in on the one occasion it was needed most.

  **The ratchet then did the thing it was built for, to its own author.**
  Repairing repo-31 took it from 7 failing to 3, below the 4 its entry allowed,
  and the run answered `STALE … now holds 3 failing reference(s), not 4 — tighten
the number`, exit 1. Tightened to 3. **The number was not raised at any point**,
  and `--against origin/main` reports `59 entr(y/ies) compared … 0 raised`, which
  is the check that tells a legitimate lowering from a silencing.

  **The three that remain in repo-31 are `indistinct`, not `moved`, and are
  deliberately left.** They are self-citations whose anchors occur more than once
  in that record — weak when written, and untouched by either merge. Re-anchoring
  somebody else's committed gate record is repo-37's work, not a repoint's, so
  the entry says 3 rather than 0 and the debt stays visible.

  `node scripts/citations-gate.mjs` exits **0** on this branch, where it exits 1
  on `1eecbdb`.
