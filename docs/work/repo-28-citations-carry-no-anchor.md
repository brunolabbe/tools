---
id: repo-28
tool: repo
title: Most citations carry no anchor text, so nothing checks what they claim
kind: chore
status: needs-decision
milestone: null
depends_on: []
---

# repo-28 — Most citations carry no anchor text

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

## The decision — do not settle it while building

**Four options. None is picked here, and picking one is what moves this ticket to
`ready`.** They are not exclusive: A is a floor the others sit on, and D is a
scoped C.

### A. Anchor on touch

A citation gains an anchor when it is next written or edited; nothing changes
today and the corpus converges as records are worked.

- Cheapest by a wide margin. No migration, no flag day, no coordination with any
  open branch.
- Never reaches a record nobody touches, and most of the 70 are finished work
  that nobody will touch again.
- **"Expected, with nothing enforcing it" is how the present state arose.** The
  anchor grammar has existed since repo-18 and the corpus went from 965 citations
  to 1,246 with 26 of them verified.

### B. One-time sweep

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

### C. Enforce in CI, corpus-wide

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

### D. Enforce where a citation carries a verdict

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

**Recommendation: D, then A, with B and C held open.** D buys the enforcement
where a citation is load-bearing, at a third of the migration, and it is the only
option whose cost has been measured against the corpus rather than estimated. A
covers the rest at no cost. B remains the right answer if the sweep can be shown
to pick distinctive anchors — that is a separate measurement nobody has taken.
**Whoever answers this should also say whether C is the intended destination**, so
D is built as a first slice rather than as a boundary.

## Two dependencies, deliberately in prose

`depends_on` is `[]` and must stay that way while these two are unmerged: a
`depends_on` naming a ticket absent from this branch's base makes
`node scripts/status.mjs --json` exit non-zero, and that is the CI board gate —
`docs/01-TICKETS.md:160` "the view; every ticket still renders, and only".

- **repo-25 (PR #168, open)** ships the `<!-- citations: evidence ... -->`
  declaration, the exit-code bitmask (`1` unresolvable · `2` moved · `4`
  unanchored under `--require-anchors` · `8` a wrong declaration), and the
  shorthand/paragraph rule. Anything here builds on all three. Do not start
  before it merges.
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

**Not startable.** The build is whichever option is chosen; writing it before the
decision would be writing three briefs and discarding two. When the decision is
recorded on this page, replace this section with the steps for the chosen option
and move `status` to `ready` in the same commit.

Whatever is chosen, two things hold:

1. **Prove the gate by making it fail first.** If a CI step is added, break one
   anchor, confirm the command exits non-zero, revert, and put the output in the
   Log. A citations gate that has only ever been seen green is a gate nobody has
   tested.
2. **A sweep must report what it could not anchor**, rather than picking a
   fragment to satisfy itself.

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
