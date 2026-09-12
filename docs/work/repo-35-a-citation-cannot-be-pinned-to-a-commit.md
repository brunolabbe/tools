---
id: repo-35
tool: repo
title: A citation cannot be pinned to a commit, so a record describing more than one tree cannot be checked
kind: fix
status: ready
difficulty: hard
milestone: null
depends_on: []
---

# repo-35 — Pinning one citation to a commit

## Why

`scripts/citations.mjs` resolves a record's citations against one tree. Which
tree is a property of the **run**, not of the citation:
`scripts/citations.mjs:1178` "usage: node scripts/citations.mjs" is the whole of
the interface, and `scripts/citations.mjs:562` "export function makeReader(repo, rev)"
takes the rev once and hands back a reader every citation in the record shares.

That is right for a gate record, which describes one branch. It has no answer at
all for a record whose lines describe **different** trees, and this repo now has
one: `.claude/skills/orchestrate-tickets/reference/history.md` appends an entry
per orchestration session, each measured against its own base. An entry that was
correct when written turns `moved` the moment the work it describes merges, and
no single `--rev` repairs the page — pinning to one entry's base breaks every
other entry's citations.

The consequence is not cosmetic. Such a record has only two states available to
it, and neither is the one the script exists to provide:

- **wrong about the present** — left as `moved`, so the page fails its own
  checker forever and every reader inherits a red baseline they did not cause;
- **unverifiable** — declared with `<!-- citations: evidence ... -->`, which
  stops the failure and stops the check with it.

This page is currently in the second state, deliberately and as an interim:
`.claude/skills/orchestrate-tickets/reference/history.md:79` "### Citations on this page are historical"
records four pinned coordinates and the commit each was verified at, and the two
declarations that carry them are at
`.claude/skills/orchestrate-tickets/reference/history.md:653` "<!-- citations: evidence"
and `:1219` "<!-- citations: evidence". **That interim is better than the red it
replaced** — a declaration is a verification somebody performed, recorded with
the rev it was performed at, where a bare `moved` records nothing — but it is not
the answer, and this ticket is why. A reader arriving at those declarations
should arrive here.

The twelfth session's own entry proposed `--rev` as the remedy without measuring
it: `.claude/skills/orchestrate-tickets/reference/history.md:1497` "pin a history citation with".
The reproduction below is what that proposal costs when it is run.

## The reproduction

At `4901cd6`, before the declarations were added. The file is on this branch, so
the earlier revision is an ancestor:

```bash
git checkout 4901cd6 -- .claude/skills/orchestrate-tickets/reference/history.md
node scripts/citations.mjs .claude/skills/orchestrate-tickets/reference/history.md
node scripts/citations.mjs .claude/skills/orchestrate-tickets/reference/history.md --rev b142a4a
node scripts/citations.mjs .claude/skills/orchestrate-tickets/reference/history.md --rev 9b426c8
git checkout HEAD -- .claude/skills/orchestrate-tickets/reference/history.md
```

Exit codes read from `$?` on unpiped invocations:

| Run                                                     | Result                                                            | Exit  |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ----- |
| plain, against the working tree                         | `15 verified, 3 moved, 1 unanchored, 0 unresolvable, 3 unchecked` | **2** |
| `--rev b142a4a` — the tenth session entry's own base    | `7 verified, 6 moved, 5 unresolvable`                             | **3** |
| `--rev 9b426c8` — the eleventh session entry's own base | `16 verified, 1 moved, 1 unresolvable`                            | **3** |

**The proposed remedy repairs one citation by breaking five.** `b142a4a` fixes
the two citations belonging to the tenth session's entry and destroys eleven
belonging to every other entry — including five that become `unresolvable`,
because files cited by later entries did not exist yet at that commit. `9b426c8`
is the better of the two and still cannot reach 0. No commit can: the page cites
files that exist only after some entries were written and only before others.

Nothing about this is specific to a history page. The same shape is any record
that cites a before and an after — a gate record quoting the line it asked to be
changed alongside the line that replaced it.

### Re-run at `a5e31c7` (2026-09-08), beside the original — per Done when #2

The table above is left exactly as it was printed at `4901cd6`. The same three
commands, run again against today's tip:

| Run                                                     | Result                                                            | Exit  |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ----- |
| plain, against the working tree                         | `11 verified, 7 moved, 1 unanchored, 0 unresolvable, 3 unchecked` | **2** |
| `--rev b142a4a` — the tenth session entry's own base    | `7 verified, 6 moved, 1 unanchored, 5 unresolvable, 3 unchecked`  | **3** |
| `--rev 9b426c8` — the eleventh session entry's own base | `16 verified, 1 moved, 1 unanchored, 1 unresolvable, 3 unchecked` | **3** |

**The two pinned rows reproduced exactly** — same verified/moved/unresolvable
counts, same exit codes, because a `--rev` pins both the record content (checked
out at `4901cd6`, unchanged since) and the tree it is read against, so nothing
about the tip moving touches them. **The plain row drifted**: `15 verified, 3
moved` at `4901cd6`-relative-to-then is now `11 verified, 7 moved` — four more
citations from the pre-declaration history.md now read `moved` against the
current tree, because the tree has moved and the pre-declaration file has not.
The exit code (`2`) and the shape of the argument are unchanged; only the
plain row's numbers are.

**The more important finding is not in this table.** `Done when` #3 states as a
present-tense fact, "It exits 0 today," about `history.md` **as it actually
stands on `HEAD`** (declarations included) — a different measurement from the
table above, which runs a `4901cd6` copy. Re-checked directly:
`node scripts/citations.mjs .claude/skills/orchestrate-tickets/reference/history.md`
against `HEAD` at `a5e31c7` now exits **2**, not 0 — `13 verified, 4 moved, 0
unanchored, 0 unresolvable, 3 unchecked, 8 evidence`. The four `moved` are not
the declared-evidence citations; they are new drift, in `scripts/test/citations.test.ts`
(record lines 1288, 1289) and `.github/workflows/ci.yml` (record lines 1491,
1492), introduced when `eca2ed3` (#194, repo-29) grew both of those files after
`history.md`'s citations into them were written. The interim state this ticket
calls "better than the red it replaced" is itself red again, for a reason that
has nothing to do with the pinning problem this ticket is about. This is worth
recording rather than fixing here — repointing those four is a normal citation
repair, out of this ticket's scope, and doing it quietly here would hide that
the interim declarations are not self-maintaining.

Also checked: the declarations are load-bearing. Deleting the `<!-- citations:
evidence dispatching.md:206, dispatching.md:209 -->` line, the first of the two,
from a scratch
copy of `history.md` and re-running turns `13 verified, 4 moved, ..., 8 evidence`
into `13 verified, 8 moved, ..., 4 evidence` — the four citations it covers move
from suppressed to failing. Reverted; `git status` confirmed clean before and
after.

## Two facts an implementer needs, both found the hard way

Neither is inferable from the source without running it, and each costs a round
if it is not written down.

### 1. Both naive spellings of a per-citation rev already fail, silently and differently

`@` is already a path character — `scripts/citations.mjs:184` "(?<file>(?:" — so
a rev suffix is not free syntax. Measured, by putting each spelling in a scratch
record and running the checker over it:

| Written as                              | What the checker did                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/citations.mjs@b142a4a:810 "…"` | **no reference at all** — the token is not recognised, and the citation vanishes from the count  |
| `citations.mjs@b142a4a:810 "…"`         | same: no reference at all                                                                        |
| `scripts/citations.mjs:810@b142a4a "…"` | one reference, resolved correctly, **and the anchor silently discarded** — reported `unanchored` |

The first shape is the dangerous one: a citation nothing counts is invisible
rather than wrong, which is the failure mode this script exists to refuse. The
third is the subtler one — it keeps the citation and downgrades it from checked
to unchecked, because `scripts/citations.mjs:176` "const ANCHOR" allows at most
one space between the location and its quoted fragment. **So the syntax has to
be designed, not guessed at**, and whichever is chosen has to be rejected loudly
when it is written wrong.

### 2. `unanchored` is not a failure, so it cannot be declared — and adding an anchor creates one

`scripts/citations.mjs:864` "const FAILING = new Set(" holds `unresolvable`,
`moved` and `unchecked`, and `unanchored` is deliberately not among them. Two
consequences that pull against each other:

- an `unanchored` citation cannot be waived by a declaration; declaring one is
  itself reported as a stale declaration, with its own exit bit;
- adding the anchor a stale citation lacks converts it from a non-failing
  `unanchored` into a failing `moved`. Measured on this page: anchoring one
  shorthand took it from `3 moved, 1 unanchored` to `4 moved, 0 unanchored`.

So "add the missing anchors" and "reach exit 0" are in tension for any record
that is behind the tree, and today the only way to have both is a declaration.
Any per-citation rev has to say what it does with an unanchored citation, or it
will inherit this corner.

## The decision — do not settle it here

Three questions. They are not independent — an answer to the first constrains
the third — and none of them should be settled by whoever picks this up.

### A. What the syntax is

- **A rev inside the location**, some spelling of `<file>@<rev>:<line>`. Reads as
  one token, matches how the rest of the tree writes a pinned reference. Costs a
  regex that is already load-bearing for four reference shapes, and the naive
  spelling of it currently disappears (fact 1).
- **A rev after the anchor**, `<file>:<line> "fragment" @<rev>`. Leaves the
  location grammar untouched and is easy to make loud when malformed. Costs a
  third optional trailing group next to `ANCHOR`, whose interaction with the
  shorthand form's two anchor positions is the part to look at first.
- **A rev declared beside the citation**, the shape declarations already use:
  `<!-- citations: rev <rev> <file>:<line> -->`. Adds no citation syntax at all
  and reuses a parser that is already strict, at the cost of separating the pin
  from the thing it pins — which is the complaint `records.md` makes about
  waivers that outlive their citation.

### B. Whether a pinned citation is checked on every run, or only as a fallback

- **Always at its rev.** Says what the record means and stays true. Costs a
  `git show` per distinct rev — cheap, but it makes a pin permanent: a citation
  pinned to a commit is never re-checked against the present, so a page could
  pin its whole self green.
- **Present first, rev only when the present fails.** A citation that still
  resolves keeps being checked against the tree everyone reads, and the pin is
  consulted only to explain a failure. Costs a state the summary does not have
  yet — "correct then, moved since" is a fourth answer, not one of the three.

### C. What happens to `<!-- citations: evidence ... -->`

- **It stays**, as the escape hatch for a citation naming something that exists
  at no rev — a fabricated anchor quoted as a defect's own evidence, which is
  the case the mechanism was built for and which a rev cannot express.
- **It narrows**, staying for that case and being withdrawn from the staleness
  case, with the four declarations on this page migrated to pins in the same
  change.
- **It goes**, with every declaration in the tree migrated. Measurable before
  choosing: `grep -rn "citations: evidence" --include=*.md .` returns eight
  today.

  **Measured again at `a5e31c7` (2026-09-08), beside the above rather than
  replacing it.** The same command now returns **27** lines, not eight — but
  that counts every mention of the string, including backtick-quoted prose
  describing the syntax (repo-35's own text among them). Filtering to lines
  that actually match the checker's own `DECLARATION` regex
  (`scripts/citations.mjs:248`) — i.e. lines that function as a declaration,
  not lines that talk about one — narrows it to **10** real declaration
  comments across **5** files: `.claude/skills/orchestrate-tickets/reference/history.md`
  (2 lines, naming 4 citations), `.claude/skills/orchestrate-tickets/reference/records.md`
  (1), `docs/work/repo-21-the-orchestration-skill-outgrew-its-loop.md` (1),
  `docs/work/repo-25-citations-checker-misses-shorthand-references.md` (5), and
  `tools/downloader/docs/work/dl-44-persist-the-thumbnail-beside-the-file.md`
  (1). Of those five, only `history.md`'s two are the production case this
  ticket is about — the other three are ticket pages demonstrating or testing
  the declaration syntax inside their own examples, not live staleness escape
  hatches. "Every declaration in the tree migrated" is a smaller job than
  either the stale 8 or a naive full-string count (22, across those same 8
  files after excluding pure prose lines) suggested, once fixtures are told
  apart from production use.

## The cost, stated honestly

This is not a small script. `scripts/citations.mjs` is 1,336 lines, most of them
a documented rationale for a refusal somebody already tried to remove; its suite
is 62 tests in `scripts/test/citations.test.ts`, inside a `scripts` project of 245. Its own header records the blast radius:
`scripts/citations.mjs:114` "all 965 citations already". Every one of those keeps
parsing exactly as it does today, whichever option is chosen — that is a
constraint on the answer, not a thing to verify afterwards.

**Measured again at `a5e31c7` (2026-09-08), beside the above.** `scripts/citations.mjs`
is now **1,532** lines. Its suite is **73** tests (`npx vitest run
scripts/test/citations.test.ts` — a plain `grep -c "^\s*test("` undercounts at
71 because two of the 73 are written `test.skipIf(`). `scripts/test/` as a whole
— all six files in that directory, not `citations.test.ts` alone — is now **288**
tests, not 245. The `965` figure has never been recomputed since the commit that
wrote it (`65ac617`, repo-18, #146) and is not a live invariant any script
maintains; a best-effort whole-tree re-count (every `.md` file outside
`node_modules`, `node scripts/citations.mjs <file>` per file, summing the
`unanchored` count from each summary line — the state `--require-anchors` would
turn fatal, which is what the sentence this figure sits in is about) comes to
**approximately 1,701** today, across 2,419 total references in 160 files that
carry citations at all. The method is not guaranteed identical to whatever
produced 965 originally, so treat the new number as directional, not exact — but
directionally it has grown by roughly 76%, not shrunk, so every option's blast
radius is larger than the page states, not smaller.

## Build

Written against the answers recorded in the Log entry of **2026-09-12**: **A — a
rev inside the location**, **B — a pinned citation is always checked at its
rev**, **C — the declaration mechanism goes.** Do not re-open those three; they
were decided by the repo owner and each overrode the dispatching orchestrator's
recommendation.

**This is the expensive combination, and the brief says so rather than around
it.** A reopens the one regex this page's own reproduction shows swallowing a
citation whole; B makes a pin permanent; C removes the only escape hatch the tree
has for a citation a rev cannot express — and the measurement in step 6 found
that class is not hypothetical, it is 21 of the 26 declared locations in the tree
today.

### 0. The blast radius, re-measured at `8d79d8e` before any of it is written

- `scripts/citations.mjs` — 1,532 lines, unchanged since `a5e31c7`
  (`git log --oneline a5e31c7..HEAD -- scripts/citations.mjs scripts/test/citations.test.ts`
  printed nothing).
- `scripts/citations-gate.mjs` **is also in scope, and this page did not
  previously say so.** It imports `extractDeclarations` and `applyDeclarations`
  and folds stale declarations into the number its grandfather list ratchets on:
  `scripts/citations-gate.mjs:543` "const declarations = extractDeclarations(markdown)"
  and `scripts/citations-gate.mjs:574` "failing: failures.length + stale.length".
  C cannot land in `citations.mjs` alone.
- `scripts/test/citations.test.ts` — 73 tests, 24 lines mentioning `evidence`.
- The corpus: `node scripts/citations-gate.mjs` at base reports
  `27 enforced, 0 failing; 45 grandfathered, holding 35 unresolvable, 43 moved, 530 unanchored, 6 indistinct.`,
  exit 0. That line is the before-picture every step below is measured against.

### 1. The grammar (A)

Extend the location grammar with an optional rev between the file and the colon,
`<file>@<rev>:<line>`, in `scripts/citations.mjs:183` "const INLINE = new RegExp("
and in the declaration-shaped twin at
`scripts/citations.mjs:251` "const DECLARED_LOCATION" (which survives C only if
something still parses a bare location; see step 5).

**The regex risk is smaller than this page feared, and that is measured, not
argued.** The fear was that `@` is already a path character, so a rev suffix
would be eaten by the file group. Prototyped standalone — a scratch script, not
an edit to the checker — with the rev spelled `(?:@(?<rev>[0-9a-fA-F]{7,40}))?`
inserted between the existing file alternation and the colon:

Every token below is written with `<line>` where the prototype used a real line
number, and that is not laziness — a literal one turns each row of this table
into a live citation this page then has to keep true. Writing the placeholder is
the same technique Build step 6 prescribes for a coordinate that must be read and
not resolved, demonstrated on itself.

| Token                                     | Today                               | With the rev group                     |
| ----------------------------------------- | ----------------------------------- | -------------------------------------- |
| `scripts/citations.mjs:<line> "x"`        | file, no rev                        | **identical**                          |
| `docs/01-TICKETS.md:<line> "x"`           | file, no rev                        | **identical**                          |
| `ci.yml:<line> "--require-anchors"`       | file, no rev                        | **identical**                          |
| `node_modules/@scope/thing.ts:<line> "x"` | file `node_modules/@scope/thing.ts` | **identical** — read as a path, no rev |
| `scripts/citations.mjs@<rev>:<line> "x"`  | **no reference at all**             | file + rev + anchor                    |

The `@`-bearing path still reads as a path because the hex-and-length rule on the
rev fails and the engine backtracks into the existing alternation. Two facts make
that safe to rely on: no tracked file in this repo contains `@` at all
(`git ls-files | grep -c '@'` returns `0`), and the one shape that would collide
— an npm-scoped path — is preserved above by test rather than by argument. **Keep
that case as a regression test.** It is the only thing standing between this
change and a silently renamed file token.

Then say what a **shorthand** does with a rev, which this page never asked and an
implementer cannot avoid. `scripts/citations.mjs:212` "const SHORTHAND = new RegExp("
means "the same file as the last one I named". It must also mean _the same rev_,
because the citations this ticket exists for come in runs: each declared location
on `history.md` is followed by shorthands belonging to the same entry, and
pinning the named citation while leaving its shorthands on the working tree would
repair the head of a run and break its tail. A shorthand may not carry its own
`@rev`; it inherits.

### 2. A malformed pin is rejected loudly — the hardest line, not a formality

`Done when` #4 is where option A is expensive, because under A the malformed case
and the invisible case are the same case. The same prototype:

| Token                                    | With the rev group                        |
| ---------------------------------------- | ----------------------------------------- |
| `scripts/citations.mjs@nope!:<line> "x"` | **no reference at all**                   |
| `scripts/citations.mjs@bb:<line> "x"`    | **no reference at all** — rev too short   |
| `scripts/citations.mjs:<line>@<rev> "x"` | file, no rev, **anchor silently dropped** |

A stricter location grammar does not satisfy #4 — it _is_ the failure #4
describes. Rejection therefore needs a second, deliberately permissive scan
beside the strict one: a pass matching anything pin-shaped —
`<pathish>@<anything>:<digits>` and `<pathish>:<digits>@<anything>` — that
reports every match the strict grammar did not accept at the same offset as a new
state, `malformed-pin`, printed with the token exactly as the record wrote it.

Two rules keep that scan honest, and both come out of the prototype:

- **"Matched by the permissive scan" is not by itself malformed.** It also
  matches every ordinary citation. The rule is _contains an `@`, and the strict
  grammar produced no reference at that offset_.
- **`<file>:<line>@<rev>` must be caught even though it parses.** It is the
  subtler of the two failures this page measured: the reference survives and its
  anchor is silently discarded, so the citation is downgraded from checked to
  `unanchored` and nothing says why. The permissive scan sees it; the strict one
  never will.

Add `malformed-pin` to `scripts/citations.mjs:864` "const FAILING = new Set(" so
it sets an exit bit — and, since C removes declarations, it is a state nothing
can excuse. Tests: one per row of the table above, each asserting the citation is
**counted** and **fails**, not merely that the run is non-zero.

### 3. Resolution at the rev (B), and the permanence the owner accepted

`scripts/citations.mjs:562` "export function makeReader(repo, rev)" already takes
a rev and already exists; B is a reader per distinct rev, memoised, with the
citation's own rev overriding the run's `--rev` when both are present.

**A pin is permanent and nothing here guards against it.** The owner chose
"always at its rev" knowing the cost this page states — a pinned citation is
never re-checked against the present, so a page can pin its whole self green.
That is accepted, not mitigated, and no step below reverses it. Two things are in
scope only because they make the accepted cost _visible_ rather than smaller:

- **A rev that does not resolve is a failure, never a pass.** An unknown or
  unreadable rev reports `unresolvable`, reason "rev not in this repository". A
  pin to a commit nobody has is the one way B could turn a citation green by
  accident.
- **The summary prints `N pinned`, and prints it only when `N` is above zero.** A
  record with no pins must print a byte-identical summary line to the one it
  prints today, because `Done when` #2 holds this page's reproduction table to
  the exact strings it printed at `4901cd6`. Suppressing the field at zero is
  what keeps those three rows unchanged; a field printed unconditionally changes
  every record's output in the tree and costs the reproduction its meaning.

### 4. What a rev does with an `unanchored` citation

Fact 2 above says any per-citation rev has to answer this. The answer this
combination gives, and it is the one piece of good news in the brief:

- A rev changes **which tree the line is read from**, not whether an anchor
  exists. A pinned citation with no anchor stays `unanchored` — still not in
  `FAILING`, still printed, and now unexcusable, since declarations are gone.
- **The tension fact 2 names dissolves for pinned citations.** Today, adding the
  missing anchor to a stale citation converts a non-failing `unanchored` into a
  failing `moved`, which is why "add the anchors" and "reach exit 0" pull against
  each other. Add the anchor to a _pinned_ citation and it is checked at the rev
  where it was true, so it becomes `verified`. Under B, anchoring a pinned
  citation is a strict improvement where today it is a trade.
- Write that as a test on both halves: pinned, anchored and correct-at-rev is
  `verified`; pinned, anchored and wrong-at-rev is `moved`, so a pin cannot
  launder a citation that was already wrong when it was written.

### 5. Removing the declaration mechanism (C)

Delete `scripts/citations.mjs:247` "const DECLARATION =", `extractDeclarations`
(`scripts/citations.mjs:473` "export function extractDeclarations(markdown)"),
`applyDeclarations`
(`scripts/citations.mjs:892` "export function applyDeclarations(results, declarations)"),
the `evidence` state, the stale-declaration exit bit and its explanatory tail;
drop the two imports and the `stale` term from the gate's `failing` arithmetic in
`citations-gate.mjs`; delete the 24 `evidence` lines in
`scripts/test/citations.test.ts`, and the passage in
`.claude/skills/orchestrate-tickets/reference/records.md` that teaches the syntax.
`DECLARED_LOCATION` goes with it unless a caller still needs a bare location
parser.

**Nothing here lands until step 6 lands with it.** The measurement below is what
CI does if the mechanism is removed and the migration is not.

### 6. The migration, and the case a rev cannot express

`Done when` #1's answer to C is "every declaration in the tree migrated".
Measured at `8d79d8e` by re-running the checker's own `DECLARATION` regex
(`scripts/citations.mjs:247` "const DECLARATION =") over all 171 `.md` files
outside `node_modules` — **12 declaration lines naming 26 locations across 7
files, suppressing 31 citations.** That is not the 10 lines across 5 files this
page recorded on 2026-09-08; `993af05` (repo-37, #200) added two more while it
sat.

Written as a list rather than a table on purpose: a findings table's bare numbers
are citations too, so a `declaration lines` column on a row naming a file becomes
seven citations into seven files that nobody meant to make. Each entry reads
_declaration lines / locations named / citations suppressed_.

- **history.md** — 2 / 4 / 8. Staleness, pinnable.
- **dl-44-persist-the-thumbnail-beside-the-file.md** — 1 / 1 / 1. Staleness,
  pinnable.
- **records.md** — 1 / 2 / 0. Already stale; excuses nothing.
- **repo-21-the-orchestration-skill-outgrew-its-loop.md** — 1 / 1 / 1. Exists at
  no rev.
- **repo-25-citations-checker-misses-shorthand-references.md** — 5 / 15 / 18.
  Exists at no rev.
- **pl-29-detours-along-a-leg.md** — 1 / 1 / 1. Outside this repository.
- **pl-34-locality-free-query-confident-wrong-place.md** — 1 / 2 / 2. Ambiguous,
  not stale.

**This page's 2026-09-08 note said only `history.md`'s two were the production
case and the rest were ticket pages demonstrating the syntax. That is wrong in
both directions, and the correction is why step 6 is the largest step.** `dl-44`'s
is production — a gate record deliberately holding the coordinate it resolved at
tip `e3d065e` — and `pl-29`'s and `pl-34`'s are production too, while being no
kind of staleness case at all.

**What removal actually costs, measured rather than predicted.** Every
declaration line stripped from all seven files in the working tree, then
`node scripts/citations-gate.mjs`; restored with `git checkout -- .` and
`git status --porcelain` confirmed empty afterwards. The gate goes from exit 0 to
**exit 1**, `27 enforced, 3 failing`, naming three records:

- `pl-29` **FAIL** — one `unresolvable`, reason "no tracked file matches", on a
  range in `src/overpass_api/statements/around.cc` (the Overpass project's own
  source, lines 392-441). **No rev of this repo can express it**, which is
  exactly the case C withdrew the escape hatch from.
- `pl-34` **FAIL** — two `unresolvable`, reasons "ambiguous — 3 tracked files
  match" on a `travel.ts` range and "ambiguous — 2 tracked files match" on a
  `brief.ts` line. A rev picks a tree, not a file; pinning these does nothing at
  all.
- `repo-25` **WORSE** — 15 failing against a `GRANDFATHERED` entry of 12,
  including two coordinates reported "past end of file". They are fabricated on
  purpose, as that record's own evidence.

So the answer to "what happens to the case a rev cannot express" is not one
answer but three, and none of them is a pin:

1. **Fabricated and past-end-of-file coordinates inside a reproduction**
   (`repo-25`, `repo-21`) — stop spelling them in citation shape. Write the
   location in the prose form `scripts/citations.mjs:232` "const PROSE" already
   recognises, which is counted, printed and reported `unchecked` without setting
   an exit bit, so the coordinate stays visible to a reader and stops being a
   claim the checker must adjudicate. Fencing does **not** do this: the
   declaration in `records.md` sits inside a fenced block and the checker parses
   it anyway, which is why that file reports two stale declarations today.
2. **Paths outside this repository** (`pl-29`) — the same treatment. That record
   already says in prose that these are not paths in this tree and cannot be
   resolved locally; after C it must stop writing them as though they were.
3. **Ambiguous paths** (`pl-34`) — not a migration at all, a repair. Qualify each
   to the file meant; the checker prints the candidates. This one ends up better
   than it is today.

`records.md`'s two locations need no migration, only deletion: they excuse
nothing, and that file already fails on them.

**Do not raise a `GRANDFATHERED` number to absorb `repo-25`.** The gate says so
in its own output, and the list ratchets one way.

### 7. Order

One branch, with the pieces in this order and the suite green at the end rather
than in the middle: grammar and malformed-pin scan with their tests (1, 2, 4),
then rev resolution (3), then the migration of all seven records (6), then
removal of the declaration mechanism (5). Removal last, because until the final
declaration is gone the mechanism is still holding 31 citations up.

The migration touches records under `docs/work`, `tools/downloader/docs/work` and
`tools/planner/docs/work`. That is one pull request, not three: the paths are
`.md` records under a `docs`-typed commit, `docs` is `hidden` in
`release-please-config.json`, so no changelog line is split across tools — and
splitting the branch would leave CI red between the halves.

### Not in scope

- Any change to what `--rev` does as a whole-run flag. It stays.
- Widening `citations-gate.mjs`'s scope
  (`scripts/citations-gate.mjs:120` "export const SCOPE = {"). `history.md` and
  `records.md` are outside it and stay outside it; their red is a direct-run red.
- Repairing unrelated `moved` citations elsewhere in the corpus, beyond the five
  on `history.md` that `Done when` #3 now names.

## Done when

Lines 1 to 4 were written against the decision, not against an implementation.
The decision is answered, so 1 is met by the 2026-09-12 Log entry and 5 is added
for the work the answers imply.

1. A, B and C are each answered on this page as a dated Log entry naming the
   option and the reasoning, and `status` moves to `ready`.
2. Whatever is chosen, the reproduction above still runs and its three rows are
   still the numbers it prints at `4901cd6` — if the fix changes them, the new
   numbers are recorded here beside the old ones rather than replacing them.
3. **Corrected 2026-09-12.** The two declaration lines on
   `.claude/skills/orchestrate-tickets/reference/history.md`, naming four
   locations and suppressing eight citations, are **migrated** — C is answered
   "it goes", so "explicitly kept" is no longer one of the two ways to satisfy
   this — and that page's plain run exits 0 afterwards.

   **The clause this line used to carry, "It exits 0 today", was already false
   when it was written, and this page's own 2026-09-08 re-measurement said so.**
   Re-measured a third time at this ticket's base, `8d79d8e`:
   `node scripts/citations.mjs .claude/skills/orchestrate-tickets/reference/history.md`
   exits **2**, `11 verified, 7 moved, 3 unanchored, 0 unresolvable, 3 unchecked, 8 evidence — of 32 references`.
   Not 0, and no longer the four `moved` recorded on 2026-09-08 either: seven.

   So exit 0 is a bar that cannot be cleared by migrating the declarations alone,
   and this line now says what else it takes. Two of the seven are shorthands into
   `dispatching.md` at 230 and 233, written at record lines 106 and 107; they are
   the undeclared twins of the declared pair and migrate with them. **The
   remaining five are ordinary drift with nothing to do with pinning** — two into
   `scripts/test/citations.test.ts`, two into `.github/workflows/ci.yml`, one into
   `scripts/next-id.mjs` — and this line now requires them repointed in the same
   change. That reverses the "out of scope" note in the 2026-09-08 Log entry, on
   the ground that it was right for a measurement-only branch and wrong for a
   branch that is editing this page anyway. **One edit to change back**: replace
   "exits 0 afterwards" with "carries no failing citation that a declaration used
   to suppress, and names the residual drift by file with a count".

4. A malformed pin is rejected loudly, with a test proving it — not dropped from
   the count, which is what the naive spelling does today (fact 1). **Under A this
   is the hardest line on the list, not a formality**; Build step 2 is why, and it
   is where a reviewer should look first.
5. **Added 2026-09-12, for C.** Every declaration in the tree is gone and
   `node scripts/citations-gate.mjs` still exits 0. Measured at `8d79d8e`:
   removing the twelve declaration lines and nothing else takes the gate from
   exit 0 to exit 1 with three records failing, so this line is not free and
   Build step 6 is the work it names.

## Log

- **2026-09-12** — **The decision is answered. A, B and C all three, by the repo
  owner, in answer to the questions exactly as this page words them.** Branch
  `repo-35/record-the-decisions`, base `origin/main` at `8d79d8e`. This commit
  records the answers, writes the Build section they imply and moves `status` to
  `ready`. It does not touch `scripts/citations.mjs`, its tests, or `history.md` —
  the implementation is the next batch's work.

  **A — what the syntax is. Chosen: a rev inside the location**, some spelling of
  `<file>@<rev>:<line>`.

  **B — when a pinned citation is checked. Chosen: always at its rev.**

  **C — the fate of the evidence declaration. Chosen: it goes** — every
  declaration in the tree migrated, the mechanism removed.

  **Each of the three overrode the dispatching orchestrator's recommendation, and
  that is recorded here because a decision that went against advice is worth more
  to the next reader than one that did not.** The orchestrator recommended A's
  second option, a rev _after_ the anchor; B's second option, present first with
  the rev only as a fallback; and C's second option, that the mechanism _narrows_.
  The owner chose otherwise on all three. The reasoning is the owner's and is not
  re-argued here — this entry records the answers, and the Build section records
  what they cost.

  **They are the expensive combination, and the Build says so rather than around
  it.** A reopens the regex this page's fact 1 measured swallowing a citation
  whole; B makes a pin permanent, so a page can pin its whole self green; C
  withdraws the only escape hatch for a citation naming something that exists at
  no rev.

  **`difficulty: hard`, added in this commit.** The filing deliberately left the
  field off because "the decision changes the work materially — under C's first
  option this is a regex, a reader and its tests, and under C's third it is that
  plus a migration of every declaration in the tree." C's third is what was
  chosen, so it is the larger shape, and it is a load-bearing regex plus a new
  failing state plus a tree-wide migration. One edit to change if the owner
  disagrees.

  **What was measured before the Build was written, rather than relayed.**

  **1. The option-C migration scope has grown since 2026-09-08 and the relayed
  breakdown was wrong about which declarations are production.** Re-ran the
  checker's own `DECLARATION` regex over all 171 `.md` files outside
  `node_modules` (a scratch script importing nothing from the checker but the
  regex text, so the filter is the checker's and not a substring grep):
  **12 declaration lines naming 26 locations across 7 files, suppressing 31
  citations** — not the 10 lines across 5 files this page recorded. `993af05`
  (repo-37, #200) added the two new ones, on `pl-29` and `pl-34`. The per-file
  table is in Build step 6.

  The 2026-09-08 note also said that of the five files, "only `history.md`'s two
  are the production case ... the other three are ticket pages demonstrating or
  testing the declaration syntax inside their own examples". **Read in context,
  that is wrong about three of them**, and the correction is the largest thing in
  the Build: `dl-44`'s declaration is a gate record holding the coordinate it
  actually resolved at tip `e3d065e`, which is the staleness case exactly;
  `pl-29`'s covers an upstream project's path that is in no tree of this repo at
  any rev; and `pl-34`'s covers two citations that are _ambiguous_, not stale, so
  a rev does nothing for them. 21 of the 26 declared locations are in the class a
  pin cannot express, not the handful the note implied.

  **2. What removing the mechanism does to CI, measured rather than predicted.**
  Stripped every declaration line from all seven files in this worktree, ran
  `node scripts/citations-gate.mjs`, then restored with `git checkout -- .` and
  confirmed `git status --porcelain` empty and the gate back to exit 0. Before:
  `27 enforced, 0 failing; 45 grandfathered`, exit 0. After: **exit 1**,
  `27 enforced, 3 failing`, naming `pl-29` (unresolvable, "no tracked file
  matches"), `pl-34` (two unresolvable, "ambiguous — 3 tracked files match" and
  "ambiguous — 2 tracked files match") and `repo-25` (WORSE — 15 failing against a
  `GRANDFATHERED` entry of 12). That is the size of `Done when` #5.

  **3. `citations-gate.mjs` is in scope for C and this page did not say so.** It
  imports `extractDeclarations` and `applyDeclarations` and adds stale
  declarations into the number its grandfather list ratchets on. C cannot land in
  `citations.mjs` alone.

  **4. Option A's regex risk is smaller than this page feared, and `Done when` #4
  is larger.** Prototyped the extended location grammar standalone, in the
  scratchpad, against nine tokens — nothing was written back into the checker. An
  optional `(?:@(?<rev>[0-9a-fA-F]{7,40}))?` between the file alternation and the
  colon leaves every existing shape byte-identical, **including an npm-scoped path
  with an `@` in it**, because the hex-and-length rule fails and the engine
  backtracks. Supporting measurement: `git ls-files | grep -c '@'` returns `0`, so
  no tracked file in this repo carries an `@` at all.

  But the same prototype shows a malformed rev (`@nope!`, or a two-character
  `@bb`) still produces **no reference at all** under the stricter grammar — which
  is precisely the invisibility `Done when` #4 forbids. **A stricter location
  grammar does not satisfy #4; it is the failure #4 describes.** Build step 2
  therefore specifies a second, deliberately permissive scan and a new
  `malformed-pin` state, with the rule that catching it cannot be "the permissive
  scan matched" — that matches every ordinary citation too.

  **5. `Done when` #3's "It exits 0 today" is corrected in place, not annotated
  around.** Re-measured at this branch's base: `history.md`'s plain run exits **2**
  with `11 verified, 7 moved, 3 unanchored, 0 unresolvable, 3 unchecked, 8
evidence — of 32 references`. That is worse than the 2026-09-08 re-measurement
  found (four `moved`, no `unanchored`); three more citations have drifted and
  three have lost their anchors since. #3 now names the five residual drifting
  citations that are unrelated to pinning and requires them repointed, because
  otherwise the exit-0 bar it sets is unreachable. **That reverses the earlier
  "out of scope" note**, and the line says so and says how to reverse it back.

  **6. The reproduction's three rows are untouched, confirmed rather than
  re-derived** (`Done when` #2). Nothing on this branch changes behaviour, and
  `git log --oneline a5e31c7..HEAD -- scripts/citations.mjs scripts/test/citations.test.ts`
  printed nothing, so neither the checker nor its suite has moved since the rows
  were last reproduced. Build step 3 adds the constraint that keeps them
  reproducible after the fix: the new `pinned` count is printed only when it is
  above zero, so a record with no pins prints a byte-identical summary.

  **7. This page walked into its own defect while the Build was being written, and
  the repairs are folded in rather than filed.** A first draft of the Build spelled
  its example tokens with real line numbers and laid step 6's breakdown out as a
  table. Re-running the checker took this page from `10 verified, 1 moved, 10
unanchored, 1 unresolvable, 2 unchecked`, exit 3, to **8 failing** — the example
  tokens had become live citations, and the table's `declaration lines` column had
  become seven citations into the seven files those rows name, because a findings
  table's bare numbers are citations too. Three repairs, all inside this file:

  - example tokens now write `<line>` and `<rev>` where the prototype used a real
    coordinate, which is the same technique Build step 6 prescribes for a
    coordinate meant to be read and not resolved;
  - step 6's breakdown is a list, not a table;
  - the citation into `docs/01-TICKETS.md` read `moved` and is repointed from 134
    to 147, and the parenthesised shorthand in the 2026-09-08 reproduction note —
    which named a declaration's line number in prose and was being resolved as a
    citation into `dispatching.md`, the last file that sentence named — is written
    out in words instead. Neither changes what either note says.

  **This page now exits 0**, `24 verified, 0 moved, 10 unanchored, 0 unresolvable,
5 unchecked, 0 evidence — of 39 references`, against exit 3 at the base. It is
  grandfathered by `citations-gate.mjs` rather than enforced, so none of that was
  load-bearing for CI; it is recorded because a ticket about citation hygiene that
  degrades its own page is worth catching before a reviewer does.

  **Verification.** All read from `$?` on unpiped invocations, redirected to a file
  rather than piped. `npm run check` → exit 0. `npm test -- --project repo` → exit
  0, `6 passed (6)` files, `313 passed (313)` tests — **the project that holds
  `scripts/test/` is named `repo`, not `scripts`; `--project scripts` fails with
  "No projects matched the filter"**, which is worth one line here because this
  page's cost section talks about the `scripts` suite throughout.
  `node scripts/citations-gate.mjs` → exit 0,
  `27 enforced, 0 failing; 45 grandfathered`, unchanged from the base.
  `node scripts/status.mjs --show repo-35` → exit 0, `status ready`,
  `difficulty hard`, `unblocked`.

- **2026-09-08** — Filed, on branch `records/repo-history-tools-09` at `b728287`
  (PR #191), which also carries the interim declarations this ticket exists to
  replace. Base `origin/main` at `277a182`.

  **Id.** `node scripts/next-id.mjs repo` reported `next free: repo-35`, naming
  `repo-33` (PR #186) and `repo-34` (PR #187) as held; the answer matched what
  was expected of it, so it was taken rather than second-guessed. The script
  reads the file half of the union only — `docs/work/` and `tools/*/docs/work/`
  on `origin/main` plus every open pull request's diff — so ids promised in
  another ticket's Log are not covered by it; nothing in this session's reading
  of the open branches named a `repo-35`.

  (**`repo-33` was renumbered to `repo-36` the next day**, after a peer session
  filed a different `repo-33` — ADR 004's compose rename — and merged it in #192
  ahead of #186. The measurement above is left as it was taken: `next-id.mjs`
  really did print `next free: repo-35` and really did name `repo-33` as held,
  and it was right on both counts at the time. `repo-35` is unaffected either
  way; only the id of the ticket it names in passing moved.)

  **`status: needs-decision`, not `ready`, and this is a deviation from the
  dispatch, which asked for `ready`.** `docs/01-TICKETS.md:147` "is a ticket's first state"
  defines that state as a filing that is complete and not dispatchable because it
  poses a question its own page says must not be settled by whoever picks it up,
  which is exactly this ticket: its Build section cannot be written until A, B
  and C are answered. Filing it `ready` would put an unstartable ticket on the
  `--ready` board, which is the measured failure `repo-19` exists to prevent.
  Raised rather than transcribed; the field is one edit to change if the owner
  disagrees.

  **No `difficulty`, deliberately.** The field rates the work as it will be once
  the decision is answered, and here the decision changes the work materially:
  under C's first option this is a regex, a reader and its tests, and under C's
  third it is that plus a migration of every declaration in the tree. Rating it
  now would be rating a shape that does not exist yet.

  **One thing the dispatch relayed that did not survive, because it came from
  this session's own earlier report.** The claim was that a naive
  `file.md@sha:206` "would parse as a filename and go `unresolvable`". It does
  not. Measured rather than re-reasoned: it produces **no reference at all**, and
  the variant with the rev after the line number keeps the reference and silently
  drops its anchor. Both are recorded as fact 1 above, and both are worse than the
  `unresolvable` that was claimed — an uncounted citation is invisible, where an
  unresolvable one is printed.

  **This page reproduces fact 1 on itself, and the `unanchored` in its own run is
  that rather than an oversight.** `node scripts/citations.mjs` over this file at
  filing reports `11 verified, 0 moved, 1 unanchored, 0 unresolvable, 0 unchecked`
  and exit 0. The one `unanchored` is the third row of fact 1's table: the checker
  sees that citation, drops the anchor written beside it, and says so. Rows one
  and two of the same table produce no reference at all, which is why the count is
  12 and not 14.

- **2026-09-08** — Measurement refresh, dispatched because this page's cost
  figures were taken at `4901cd6` and the tree had moved 12 commits since,
  three of them touching `scripts/citations.mjs` or the citation corpus
  directly. Base `origin/main` at `a5e31c7` (`git fetch origin` at dispatch
  time). No decision answered, `status` untouched, Build section untouched —
  this is arithmetic, not work.

  **The four figures, re-measured and recorded beside the originals in place**
  (see "Measured again at `a5e31c7`" notes under "The decision" and "The cost,
  stated honestly" above): the option-C grep count is 27 raw / 10 real
  declarations across 5 files, not 8; `citations.mjs` is 1,532 lines, not
  1,336; its suite is 73 tests (71 by a naive `grep -c "^\s*test("`, which
  misses two written `test.skipIf(`), not 62; `scripts/test/` as a whole is
  288 tests, not 245.

  **The reproduction (`## The reproduction`) still runs and its exit codes are
  unchanged**, but only two of its three rows reproduced with identical
  numbers. The two `--rev`-pinned rows are byte-identical to what the page
  already prints, because a pin fixes both the record content and the tree it
  is checked against. The plain row — against the _current_ working tree — has
  drifted (`15 verified, 3 moved` then; `11 verified, 7 moved` now), which is
  expected and not itself a problem: that row was always a measurement of "how
  far has the tree moved," not a constant. New numbers recorded beside the old
  in the reproduction section per `Done when` #2, neither replacing the other.

  **The finding that matters more than any of the above: `Done when` #3's "It
  exits 0 today" is no longer true.** That line describes a different
  measurement from the reproduction table — `history.md` as it stands on
  `HEAD`, declarations included, not a `4901cd6` copy. Run directly against
  `a5e31c7`, it now exits 2, with four `moved` citations unrelated to the four
  declared-evidence ones: `scripts/test/citations.test.ts` and
  `.github/workflows/ci.yml` both grew in `eca2ed3` (#194, repo-29, merged
  after this ticket's declarations went in), shifting the lines `history.md`'s
  own citations into those two files point at. This is ordinary citation drift
  in a page this ticket does not otherwise touch, not a symptom of the pinning
  problem repo-35 exists to solve — but it means the "better than the red it
  replaced" interim state has itself gone red, silently, and nobody would know
  without running the checker directly on `history.md` rather than through
  `citations-gate.mjs` (which grandfathers this file entirely — 6 files
  enforced, not this one; confirmed via `node scripts/citations-gate.mjs`,
  exit 0, "6 enforced ... 59 grandfathered"). Left as a finding, not fixed:
  repointing those four citations is a normal repair on `history.md`, out of
  this ticket's scope, and would have been indistinguishable from padding this
  branch's diff past its stated purpose.

  **Declarations are load-bearing, checked directly.** Deleting the `<!--
citations: evidence dispatching.md:206, dispatching.md:209 -->` line from a
  scratch copy of `history.md` and re-running turned `4 moved, ..., 8 evidence`
  into `8 moved, ..., 4 evidence` — the four citations that line covers move
  from suppressed to failing the moment it is gone. Reverted with `git checkout
HEAD --`, diffed byte-identical against a pre-edit backup before continuing.

  **The `965` figure (`scripts/citations.mjs:114`) has never been recomputed
  since it was written** (`git log -S"965 citations"` names exactly one commit,
  `65ac617`, repo-18, #146). A best-effort whole-tree re-count — every `.md`
  file outside `node_modules`, summing the `unanchored` count `citations.mjs`
  reports per file — comes to approximately 1,701 today, roughly 76% higher,
  not lower. Recorded as directional rather than exact, since the original
  count's method is not documented and this one may not match it, but the
  direction is unambiguous: every option's blast radius has grown since the
  page was written, not shrunk.

  **One disagreement with the dispatching session's own relayed numbers, both
  ways.** It relayed "22 are real declaration comments, across 8 files" for the
  option-C count; filtering by the checker's actual `DECLARATION` regex
  (`scripts/citations.mjs:248`) rather than by substring match gives 10 across
  5 — the relayed count still included prose lines that merely mention the
  string inside backticks. It also relayed "I measured 3" against this page's
  own "four declarations on `history.md`" (`Done when` #3); re-measured here as
  **4** (two declaration lines, `:653` and `:1219`, naming two citations each),
  matching what the page already says — no correction needed there. Both
  disagreements are with a relay one step removed from the tree, not with
  anything on this page; per dispatch instructions, this measurement's own
  numbers are the ones recorded above.

  **Verification.** `node scripts/citations-gate.mjs` → exit 0. `node
scripts/citations-gate.mjs --against origin/main` → exit 0, 0 raised. `npm
run check` → exit 0. `node scripts/status.mjs --json` → exit 0, `repo-35`
  still reads `needs-decision`. All four read from `$?` on unpiped
  invocations, redirected to a file rather than piped, per the pipe-swallows-
  exit-code trap this dispatch named explicitly.

  **Diff scope.** This commit touches only this file. The Decision section's
  options, reasoning and the three questions themselves are untouched; only
  the one numeric aside in option C (previously "returns eight today") gained
  a dated addendum. `status` and the Build section are untouched.
