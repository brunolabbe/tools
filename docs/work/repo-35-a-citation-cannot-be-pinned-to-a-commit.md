---
id: repo-35
tool: repo
title: A citation cannot be pinned to a commit, so a record describing more than one tree cannot be checked
kind: fix
status: needs-decision
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
evidence dispatching.md:206, dispatching.md:209 -->` line (`:653`) from a scratch
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

**Not startable.** The build is whichever set of answers A, B and C receive;
writing it now would be writing several briefs and discarding most of them. When
the answers are recorded on this page, replace this section with the steps and
move `status` to `ready` in the same commit.

## Done when

Written against the decision, not against an implementation.

1. A, B and C are each answered on this page as a dated Log entry naming the
   option and the reasoning, and `status` moves to `ready`.
2. Whatever is chosen, the reproduction above still runs and its three rows are
   still the numbers it prints at `4901cd6` — if the fix changes them, the new
   numbers are recorded here beside the old ones rather than replacing them.
3. Whatever is chosen, the four declarations on
   `.claude/skills/orchestrate-tickets/reference/history.md` are either migrated
   or explicitly kept, in the same change, and that page's plain run still exits
   0 afterwards. It exits 0 today; a fix that reintroduces the red it replaced
   has not finished.
4. A malformed pin is rejected loudly, with a test proving it — not dropped from
   the count, which is what the naive spelling does today (fact 1).

## Log

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
  dispatch, which asked for `ready`.** `docs/01-TICKETS.md:134` "is a ticket's first state"
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
