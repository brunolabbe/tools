---
id: repo-60
tool: repo
title: A double-backtick quotation of a port number reads as a shorthand line citation
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-60 — a double-backtick quotation reads as a shorthand citation

## Why

`` `:443` `` inside a **double-backtick** markdown span is a quotation — a
reviewer writing about the exact backtick syntax something else misreads,
the way `docs/work/repo-25-citations-checker-misses-shorthand-references.md`
does for `dl-38`'s port numbers. `scripts/citations.mjs`'s `SHORTHAND` regex
cannot tell that apart from an ordinary shorthand citation, `` `:443` `` used
to mean line 443 of the file named above it: both are a backtick, a colon, a
number, a backtick, and the double backticks that mark a quotation are not
part of what `SHORTHAND` matches against, so they are invisible to it.

repo-50's `--displaced-since` is what turned this from a cosmetic
misclassification into a live failure. Before it, a misread port merely
resolved to whatever line that number happened to name in the inherited
file — visible as a loud, ordinary failure the moment the file was too short,
and silent (`unanchored`, uninteresting) the rest of the time. `--displaced-since`
adds a third outcome: if the misread line's text differs from what it read at
some earlier ref, the quotation is reported `displaced`, a state a
`<!-- citations: evidence -->` declaration cannot excuse (`displaced`'s own
non-excusability is deliberate, matching `unpinned-volatile`) and that no
coordinate edit can fix without rewriting what the reviewer's prose actually
says — repo-50 gate 2 recommended editing the coordinates and pinning the
citation, but the owner chose instead to keep repo-25's text byte-identical
to origin/main, letting `` `:443` `` stand unedited in the gate record even
though the coordinates it carries are unanchored.

So today `docs/work/repo-25-citations-checker-misses-shorthand-references.md`
fails `--displaced-since` on this branch, permanently, unless this defect is
fixed or the record's wording is edited — neither of which repo-50 does.
Reproduced at `5ad3286` (repo-50's branch tip):

```
$ node scripts/citations.mjs docs/work/repo-25-citations-checker-misses-shorthand-references.md --displaced-since origin/main
...
10 verified, 0 moved, 7 unanchored, 0 unresolvable, 13 unchecked, 18 evidence, 1 displaced — of 49 references, 9 pinned
exit 128 — 1 displaced
```

The record's own line 196 reads (unedited, exactly as committed):

```
- **low** · `dl-38`'s backticked port numbers (`` `:443` ``/`` `:8443` ``) were misread as shorthand line citations, ...
```

`` `:443` `` here is inside a double-backtick span (` ` `:443` ` `), which
is markdown's own way of escaping a literal backtick inside quoted text — the
whole point of the sentence is that this text is an example of the
misreading, not an instance of it. `SHORTHAND`'s regex requires only a single
backtick immediately before and after the token, so it matches the _inner_
pair and ignores that an _outer_ pair of backticks surrounds the whole thing.

## Build

Teach `extractCitations` (or the regexes it composes, `SHORTHAND` and
`INLINE`) to recognise a double-backtick span and skip scanning inside it for
a shorthand or inline citation, the same way a fenced code block is already
skipped for heading detection in `extractSections`. A double-backtick span is
` ` ... ` ` in CommonMark: two backticks, content, two backticks, and the
content may itself contain single backticks. `scripts/citations.mjs`'s own
top docblock already writes several — search it for ` ` ` `` to find real
examples to test against, including at least one that quotes a citation-shaped
token on purpose (the port examples this ticket is filed from, and the
```` ` `` `:99999` `` ` ```` reproduction a few lines above them in `repo-25`'s own record).

**The reproduction is inside a fenced code block was considered and is not
the same shape**: `extractSections`'s fence-skip is about _heading_ detection
specifically and does not touch `extractCitations`'s own scan, which
deliberately reads inside fences (a changelog fragment quoting an anchor is
real content to check, per that function's own docblock). This ticket is
narrower — only a double-backtick _inline span_, not a fenced block — and
should not widen to touch fence handling.

Watch the paragraph-inheritance rule (`nearby`, `currentFile`, `currentRev`):
a citation inside a skipped double-backtick span must not update
`currentFile` either, or a later, real shorthand on the same line or in the
same paragraph would inherit from a phantom citation the reproduction quoted
rather than from the citation actually meant.

## Done when

- `node scripts/citations.mjs docs/work/repo-25-citations-checker-misses-shorthand-references.md --displaced-since origin/main` exits 0 (no other change to that record), with the double-backtick port quotation no longer read as a citation at all — not `unanchored`, not `displaced`, absent from the reference count.
- A quoted shorthand (`` ` `` `:99999` `` ` ``, the reproduction earlier in the same record) is likewise not read as a citation.
- A real shorthand elsewhere in the same record, inheriting from a qualified citation that appears _before_ a double-backtick quotation, still resolves against the right file — the quotation must not consume or reset `currentFile`.
- A test plants a double-backtick quotation of a citation-shaped token in a fixture record and shows it uncounted; the same fixture with single backticks around the same token is still read as a citation, so the fix is "double-backtick is a quotation" and not "this token never parses".
- `npx vitest run scripts/test/citations.test.ts` and `npm run check` both pass.

## Review

### Gate 1

Amended at `7bb2d8f`, replacing the copy committed at `c49f0d5`: every coordinate is re-resolved against `7bb2d8f`, and the four citations whose text or claim the fix round changed — the Done-when 3 test, the repo-25 `GRANDFATHERED` entry, the repo-25 declaration line and the `DOUBLE_BACKTICK` regex — are now prose naming `247073d`, the tip this gate reviewed. Words and verdicts are otherwise unchanged.

**Gate: FAIL** — 2026-09-27 · `c87153d...247073d` (base `c87153d`; `origin/main` had not moved at fetch) · code-review at medium

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The repo-25 command exits 0 (no other change to that record), the port quotation absent from the count | **verified**, parenthetical **not met** — exit 0 at `247073d`; 49 references at base become 37, the 12 removed are all double-backtick quotations, 0 changed state, 0 added. The two declaration trims are forced: the head checker on the unedited record exits 8 with 2 stale declarations. Open decision below |
| 2. A quoted shorthand (the 99999 reproduction) is not read                                                | **proven** — `scripts/test/citations.test.ts:2807 "expect(found).toEqual([]);"`; on the record itself, record line 195 yields 0 references at head against 2 at base                                                                                                                                              |
| 3. A real shorthand after a quotation still resolves against the right file                               | **verified** — a probe at head resolves a shorthand written after a quoted inline citation to the earlier file, and 0 of 3,759 corpus references changed file. The test offered for it cannot fail on that property (med below): the test at `247073d`, line 2824, since replaced                                 |
| 4. A fixture shows the double-backtick token uncounted and the single-backtick one counted                | **proven** — `scripts/test/citations.test.ts:2783 "expect(quoted.map((c) =>"` and `scripts/test/citations.test.ts:2788 "expect(unquoted.map((c) =>"`; all 3 new tests red with the fix reverted, 102 others green. The premise the line names is refuted by the corpus (high below)                               |
| 5. The spec and `npm run check` pass                                                                      | **verified** — spec 105 of 105 (102 at base), `--project repo` 493 of 493, `preflight.mjs` exit 0 with `npm run check` inside it                                                                                                                                                                                  |

- **high** · The quotation rule drops real, anchored citations. `docs/work/repo-31-the-windows-leg-is-almost-all-red.md:424 "evaluates to the empty-string branch"` wraps three anchored citations in double backticks inside its gated Review; none is read now, and the Review-scope run on that record falls from 5 references to 2. Across that record 23 inline citations vanish (26 references become 4), and the whole-record run goes from exit 2 with 6 moved to exit 0 — live drift hidden, not fixed. Of the 62 references the head stops reading across 201 corpus files, 39 are quotations and these 23 are citations. It breaks `scripts/citations.mjs:33 "A reference this cannot check is still counted"`. **Open decision**: (a) skip a quoted reference only when it carries no anchor, two conditions in `extractCitations` — measured in a scratch copy: exactly the 39 quotations removed and the 23 kept, 105 of 105, the repo-25 command exit 0 on the same 37 references, the gate exit 0, repo-31 back to 6 moved; (b) skip only in the two shorthand passes, as the title reads — 35 removed and repo-31 kept, but the unanchored quoted inline citation on repo-25 record line 195 stays read (gate effect unmeasured); (c) keep the rule and rewrite the 23 spans in repo-31 to single backticks — edits a merged record and surfaces its 6 moved for repair; (d) count a quoted reference in a non-failing state of its own instead of dropping it — honours the rule above, unmeasured. Recommend (a).
- **med** · The repo-25 allowance lowered to 1 (its `GRANDFATHERED` entry in `scripts/citations-gate.mjs` at `247073d`, line 268, since removed) holds a stale declaration this branch created, not debt. The base Review scope held 2 unanchored (record lines 195 and 196), both quotations; at head it holds no failing reference and 1 stale declaration, the one on repo-25 record line 204 as it read at `247073d`, whose 99999 entry no Review citation matches any more (the whole-record run still matches record line 469, in the Log, so that command passes). The gate summary prints 1 unresolvable and 19 unanchored against allowances summing to 21, so the absorbed entry is invisible. Dropping only that entry leaves the record 0 failing and passed in the gate, and the whole-record command still exits 0 (the Log declaration at record line 210 covers record line 469): the entry could leave the list, not drop to 1.
- **med** · The test offered for Done-when 3 cannot fail on its property. Its quotation holds only a shorthand, which never sets the current file in any version; it goes red with the fix reverted only because the quoted shorthand is counted. Mutation: in the INLINE pass, let a match inside a quotation set the current file before skipping (the check built on `scripts/citations.mjs:601 "const inQuotation"`) — 105 of 105 green, while a probe (a qualified citation into one file, a quoted inline citation into another, then a shorthand) resolves the shorthand to the quoted file. Needs a fixture whose quotation holds a qualified citation followed by a real shorthand.
- **med** · This record is invisible to the citation gate. The Build line that opens with four backticks (brief line 76) is read by `extractSections` as a fence opener that never closes — CommonMark does not read it so, since a backtick fence info string cannot contain a backtick — so every heading after it, this Review included, is unseen: with this section spliced in, the gate scopes 119 records and not this one, while `preflight.mjs` finds the heading by regex and reports ok. Prefixing that line with one word brings the gate to 120 records, this one passing on 19 references. Present at the base, in the brief. **Open decision**: (a) the lander prefixes that line when committing this section, and the fence divergence in `extractSections` is filed as its own ticket — recommend; (b) fix `extractSections` in this branch — widens past a brief that says not to touch fence handling.
- **low** · The prose pass is not quotation-aware. A line-number phrase inside a quoted anchor used to be covered by the inline citation around it; with that citation skipped it is read as a new unchecked prose reference — `docs/work/repo-31-the-windows-leg-is-almost-all-red.md:103 "line 99 is past end of file"` gains one, the only reference the corpus inventory shows added. Goes away under option (a).
- **low** · `DOUBLE_BACKTICK` in `scripts/citations.mjs` at `247073d`, line 371, ignores backtick run length. A single-backtick span that holds a double backtick pairs with a later one and swallows a real citation between them (probe: base reads it, head reads nothing), and a triple-backtick span is read as a double one. 0 corpus hits.
- **low** · Two findings, one mechanism: the scan is per physical line. A double-backtick span inside a fenced block now hides a citation the extractor deliberately reads there (probe: base reads it, head does not), where the brief said not to widen into fences; and a double-backtick span broken across two lines is not recognised, so its shorthand is still read (probe). 0 corpus hits for the first; the second leaves the inventory unchanged by construction.
- **low** · The Log entry of 2026-09-27 says repo-50 took 4 citations in 5 occurrences; the diff repoints 5 distinct citations on 4 lines. It says the corpus has no double-backtick pin to disturb; record line 103 of repo-31 is one, and is disturbed — the Log does not mention repo-31 at all. Its reproduction claim holds: at `5ad3286` the command exits 0 against `origin/main` and 128 against `1e3204e`, re-run by this gate.
- **dropped** · repo-31 carries 6 moved citations outside its Review at base. Pre-existing, outside the range, and visible again only under option (a).
- **dropped** · The Log asks whether pl-32 needs a Log entry. Not a defect; recommend not, since any path under `tools/planner` in a `fix(repo)` pull request releases the planner for a change that says nothing about it.
- **Open decision** · Done-when 1 parenthetical. The reviewer text in repo-25 stays byte-identical; the two changed lines, record lines 130 and 204, are declarations the stale-declaration rule forces once the quotations stop being read, so no fix can meet the parenthetical. (a) Accept the trims, and also drop the 99999 entry per the first med — recommend; (b) accept the trims as built.
- **findings** · defect hunt at medium returned 11; 9 carried in 8 bullets (1 high, 3 med, 5 low, two of them sharing a bullet), 2 dropped.
- NFR: security n/a · performance — the quotation check is a linear scan per match per line, negligible · reliability — the high above · maintainability — the Done-when 3 test above.

### Gate 2

**Gate: CONCERNS** — 2026-09-27 · `247073d..7bb2d8f` (base `c87153d`; `origin/main` had not moved at fetch) · code-review at medium, over the round only

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The repo-25 command exits 0 (no other change to that record), the port quotation absent from the count | **verified** — exit 0 at `7bb2d8f` on the same 37 references. The parenthetical stays unmet, as the owner accepted on 2026-09-27 by option (a)                                                                                                           |
| 2. A quoted shorthand (the 99999 reproduction) is not read                                                | **proven** — `scripts/test/citations.test.ts:2807 "expect(found).toEqual([]);"`, unchanged by the round                                                                                                                                                  |
| 3. A real shorthand after a quotation still resolves against the right file                               | **proven** — `scripts/test/citations.test.ts:2839 "shorthand:6=a/one.ts"`; letting a skipped quoted inline citation set the current file reds exactly this test, 1 of 105                                                                                |
| 4. A fixture shows the double-backtick token uncounted and the single-backtick one counted                | **proven** — `scripts/test/citations.test.ts:2783 "expect(quoted.map((c) =>"` and `scripts/test/citations.test.ts:2788 "expect(unquoted.map((c) =>"`, unchanged; the rule is now narrowed to an anchor-less quotation, by the owner decision on the high |
| 5. The spec and `npm run check` pass                                                                      | **verified** — spec 105 of 105; `preflight.mjs` exit 0, `npm run check` and `--project repo` inside it                                                                                                                                                   |

Gate 1 findings:

- **high** (quotation rule drops anchored citations) · **fixed** — the skip is now conditional at `scripts/citations.mjs:617 "g.anchor === undefined) continue;"` and `scripts/citations.mjs:690 "g.outer === undefined) continue;"`. Corpus inventory, base extractor against head over 202 files: 42 gone, 0 added, 0 changed. The 25 gone from the seven records this round left unchanged are the same 25 as gate 1; the other 17 are quotations in repo-60 (16, its text having grown) and repo-63 (1). repo-31 loses none: its Review reads 5 verified, and the whole-record run is back to exit 2 with 6 moved, as at base. No test holds the fix (new med below).
- **med** (repo-25 allowance holds a stale declaration) · **fixed** — the entry is gone. A `gate()` run with no allowance: 120 records in scope, 6 failing, and their counts (3, 2, 8, 3, 3, 1) match the 6 remaining entries exactly; repo-25 passes with 10 verified and 1 evidence.
- **med** (the Done-when 3 test cannot fail) · **fixed** — the gate 1 mutation, re-applied at the head, reds 1 of 105, the replacement test only.
- **med** (the record is invisible to the gate) · **fixed** per the owner decision (a) — the Build line is prefixed; `extractSections` at the head finds Build, Done when, Review, Gate 1 and Log, and the gate scopes 120 records with repo-60 passing. repo-63 is filed with the reproduction, which re-runs at `247073d` to the three sections it quotes; `extractSections` is not in the diff, and `node scripts/next-id.mjs repo --rev origin/main` shows repo-63 claimed by this branch only.
- **low** (the prose pass) · **fixed** — 0 references added in the corpus inventory; the anchored quoted citation is read again and covers its line-number phrase.
- **low** (run length) · **half fixed** — a triple-backtick span now closes on a triple run; a single-backtick span holding a double backtick still swallows the citation between two of them (probe unchanged), now documented in the docblock. Accepted as documented. New low below on the docblock.
- **low** (per physical line, two findings) · **not fixed, documented** — both probes unchanged, both named in the docblock. Accepted as documented.
- **low** (Log accuracy) · **fixed** — both claims corrected in place, confirmed against the diff.

New, in lines this round touched:

- **med** · The anchor carve-out, the whole of the high fix, has no test. Removing both conditions at the head keeps `npx vitest run --project repo` at 493 of 493 and `node scripts/citations-gate.mjs --against origin/main` at exit 0 (114 enforced, 0 failing), since a dropped citation fails nothing. A regression to the gate 1 high would pass every local and CI gate. Needs a fixture reading an anchored citation inside a double-backtick span, for both the INLINE and the SHORTHAND pass.
- **low** · The regex docblock overclaims. Lines 361 and 375 of `scripts/citations.mjs` at `7bb2d8f` say the closer length is exact, but the opener can backtrack to a shorter run and the closer can be the tail of a longer one: a probe reads nothing out of a shorthand between three opening and two closing backticks, or two opening and three closing, where CommonMark reads a code span holding a shorthand. 0 corpus hits.
- **low** · The round-2 entry in this ticket Log says the unconditional skip dropped 23 anchored citations from the repo-31 Review section alone, with 5 references there falling to 2; the 23 are the whole record, 3 of them in its Review. It also calls the run-length finding a med; gate 1 graded it low.
- **low** · Line 112 of the repo-63 ticket at `d789c86` ("The owner chose (a) over the gate") says the owner went against the gate recommendation; (a) was the gate recommendation, as the repo-60 Log says correctly.
- **checked, no finding** · repo-50 and repo-52 re-repointed: 7 coordinates into `scripts/citations.mjs` now 40 lines on from `247073d`, 5 into `scripts/citations-gate.mjs` one line back after the removed entry; each read at the head holds its anchor.
- **findings** · hunt over the round returned 4; 4 carried, 0 dropped.
- NFR: security n/a · performance — the backreference regex runs per line, negligible · reliability — the med above · maintainability — the docblock low above.

### Gate 3

**Gate: PASS** — 2026-09-27 · `7bb2d8f..32c747c`, record commits excluded (base `c87153d`; `origin/main` had not moved at fetch) · code-review at medium, over the two rounds only

Done-when rows stand as gate 2 gave them; re-run at the head, the spec is 106 of 106, and every CI check on PR #296 at `32c747c` passes.

Gate 2 findings:

- **med** (the anchor carve-out has no test) · **fixed** — `scripts/test/citations.test.ts:2867 "inline:9|other anchor"` and `scripts/test/citations.test.ts:2868 "shorthand:10|shorthand anchor"`. Dropping the INLINE condition alone reds 1 of 106, and dropping the SHORTHAND condition alone reds 1 of 106, the new test each time; both restored, tree clean. New low below on its docblock.
- **low** (the regex docblock overclaims) · **fixed** — `scripts/citations.mjs:372 "shorter run, and its closer can be the tail"` and `scripts/citations.mjs:374 "this regex reads nothing where CommonMark reads a shorthand"` are now true. Re-probed at the head: three opening against two closing backticks, and two against three, each yields nothing, and under the CommonMark code-span rule (a maximal backtick run closes only on one of equal length) each is two unmatched runs around a single-backtick span holding the shorthand. The corpus inventory is unchanged from gate 2: 42 gone, 0 added, none in repo-31. The file is 2341 lines, as at `d789c86`.
- **low** (the repo-60 Log misstates repo-31 and a grade) · **fixed** — the round-2 entry now gives 3 of the 23 in the repo-31 Review, and grades the run-length finding low. The fixer entry also claimed a repo-63 correction that its round did not make; the next entry marks that false, and the diff over that round shows repo-63 untouched.
- **low** (the repo-63 Log reverses the owner decision) · **fixed** — `docs/work/repo-63-extractsections-reads-a-backtick-info-string-as-an-unclosed-fence.md:112 "The owner chose (a), the gate"`; two lines changed, nothing else in that file.

The records and the repoints:

- **checked, no finding** · The landed gate 1 and gate 2 match my own files after `oxfmt`, with gate 1 at `scripts/citations.mjs:601 "const inQuotation"` as the one coordinate changed; the only other difference is table padding and the blank line before the next heading.
- **checked, no finding** · 11 coordinate occurrences re-repointed (repo-50 5, repo-52 3, repo-60 3). A word diff of repo-50 and repo-52 changes line numbers only, each line read at the head holds its anchor, and `node scripts/citations-gate.mjs --against origin/main` exits 0, 114 enforced and 0 failing.
- **checked, no finding** · The branch diff against `origin/main` adds one pin, at `fdafd1a`, an ancestor of `origin/main`, inside an anchor-less quotation in the Log.

New, in lines these rounds touched:

- **low** · `scripts/test/citations.test.ts:2851 "If either carve-out condition is removed"` says either removal regresses the gate 1 high, with 23 anchored citations vanishing from repo-31. That holds for the INLINE half only: with only the SHORTHAND condition dropped, the corpus inventory is identical to the head (42 gone, 0 in repo-31), since those 23 are all inline. The test itself catches both halves.
- **dropped** · The docblock credits gate 1 with the first gap and gate 2 with the second. Gate 1 found a triple span read as a double one, which is the opener backtracking; close enough to leave.
- **findings** · hunt over the two rounds returned 2; 1 carried, 1 dropped.
- NFR: security n/a · performance n/a, no code path changed · reliability — the carve-out is now held by a test · maintainability — the test docblock low above.

## Log

- 2026-09-26 — Filed from repo-50 gate 2's med finding, on the owner's decision
  (option (b) over the gate's own recommended (a)): repo-25's Review-section
  text describing this exact misreading stays byte-identical to `origin/main`
  rather than being edited to carry a pin, and `--displaced-since` fails on it
  until this ticket is built. Neither CI nor `preflight.mjs` passes the flag
  today, so nothing enforced fails in the meantime.
- 2026-09-27 — Built. The Why's reproduction (`exit 128 — 1 displaced` at
  `5ad3286`) does not reproduce against today's `origin/main`: at `5ad3286`,
  `node scripts/citations.mjs docs/work/repo-25-...md --displaced-since
origin/main` exits 0, not 128. What moved is the ref, not the record —
  `origin/main` at the time the Why was written was `1e3204e`, main's tip
  _before_ repo-50's own PR (#291) merged as `9fb2096`. Re-run with
  `--displaced-since 1e3204e` against the same `5ad3286` tree: `exit 128 — 1
displaced`, matching the quoted output exactly. Once repo-50 merged,
  `origin/main` caught up to the tree `docs/work/repo-25-...md` already
  described, so the drift `--displaced-since` was built to catch had nothing
  left to catch it against — until this ticket's fix, which uncovers it
  again for a different reason (below).

  Fixed by teaching `extractCitations` a `DOUBLE_BACKTICK` span
  (`/\x60\x60(?:(?!\x60\x60).)*?\x60\x60/g`) and skipping a match of
  `INLINE`, the `PIN_SHAPED` pair, `SHORTHAND` or `SHORTHAND_PIN` whose start
  falls inside one — applied to all four, not only the two the Build names,
  since a double-backtick-quoted pin is the same defect. **Gate 1 found this
  claim wrong** — "the corpus has none today to disturb" — and it was, on my
  own re-run rather than taken on the gate's word:
  `docs/work/repo-31-the-windows-leg-is-almost-all-red.md` record line 103
  carries `` `scripts/test/citations.test.ts@fdafd1a:1331` `` (anchor omitted
  here) inside a
  double-backtick span, a real pinned, anchored citation, and it lost its
  anchor under this first version of the rule. Fixed in the same round as the
  gate-1 write-up below (the anchor carve-out); this sentence is corrected
  rather than deleted so the mistake stays legible. A skipped match is never
  pushed into `found` at all, so its `make()` never runs and it cannot set
  `currentFile` either — the mechanism the third `Done when` line asks for.

  **The first `Done when` line's parenthetical ("no other change to that
  record") does not fully hold, and I made the change anyway.** Fixing the
  defect removes the quoted `` `:443` ``/`` `:8443` ``/`` `:99999` `` matches
  at record lines 150, 195, 196, 522 and 534 from the reference count
  entirely — which is what the ticket asks for — and that leaves two of the
  record's `<!-- citations: evidence -->` declarations (record lines 130 and 204) naming a location, `` `index.ts:443` `` and
  `` `scripts/citations.mjs:8443` ``, that nothing in the record cites any
  more. `applyDeclarations` correctly refuses that as stale (`exit 8 — 2
stale evidence declaration`, `... is declared evidence, but this record
does not cite it`), which is the script's own documented behavior for
  exactly this situation ("a citation whose failure was fixed should lose its
  declaration in the same edit"). I trimmed both declarations to drop the
  now-dead entries only (`` `index.ts:440` `` and the other two locations in
  each stay); the reviewer's
  prose — the bulleted text the ticket's Why is about keeping
  byte-identical — is untouched. `--displaced-since origin/main` now exits 0.
  Recorded here rather than asked as an open decision because the mechanism's
  own error message names this exact remedy; there was no second reading of
  it to weigh.

  Also updated `extractCitations`'s own docblock (the paragraph naming this
  exact repo-25 tight-list example for the `nearby` rule), which the fix
  otherwise leaves silently false: the citations it describes as failing and
  needing a declaration no longer exist post-fix. Rewritten in the past tense
  with a pointer to `citations.test.ts` for the mechanism it was
  illustrating.

  **Two knock-on effects from editing `scripts/citations.mjs` itself,
  neither anticipated by the Build.** First: inserting the new regex and its
  guard shifted every line below it by 34, which `node scripts/citations-gate.mjs`
  (not named in this ticket, but what `preflight.mjs`'s citations check
  actually runs) caught as `moved` against two already-merged, already-gated
  records that cite `scripts/citations.mjs` by line with an anchor —
  `docs/work/repo-50-citations-cannot-see-a-displaced-unanchored-citation.md`
  (**correction, gate 1**: 5 distinct citations across 4 record lines, not "4
  citations, 5 occurrences" as first written here — record line 93 alone
  repoints two) and
  `docs/work/repo-52-citations-into-claude-pages-are-pinned-or-by-heading.md`
  (2 citations, 3 occurrences). Repointed each to the line the same anchor
  text now holds — verified individually before editing — per the tool's own
  documented remedy for `moved` ("repoint it at the line that now holds what
  it meant to say"); their prose is otherwise untouched. Second: the general
  fix also removes a real, independent false positive from
  `tools/planner/docs/work/pl-32-vite-config-test.md`'s own Review section —
  a parenthesised `` `(`:23`)` `` quoting the shorthand syntax, same shape as
  this ticket's own case, at that record's line 79 — which
  `citations-gate.mjs` reported `STALE` (holds 1 failing reference now, not
  the 2 its `GRANDFATHERED` entry names). Tightened `pl-32`'s entry from 2 to
  1; `repo-25`'s went from 2 to 1 in this same commit, then — gate 1, med,
  correctly — all the way out of `GRANDFATHERED`, once dropping the also-dead
  `99999` entry from record line 204's declaration (its only remaining
  citation, record line 469, is separately excused by the declaration at
  record line 210) left the whole record's Review-scoped debt at zero.
  Neither ticket's own file was touched, only the ratchet's memory of it in
  `scripts/citations-gate.mjs`, which is squarely `repo`-scoped. `pl-32` is a
  `tools/planner` ticket and I
  did not add a Log entry there, since no file of its own changed — flagged
  here for whoever reviews this branch to judge whether it should.

  Verified: `npx vitest run scripts/test/citations.test.ts` 105/105 (3 new,
  102 pre-existing), `npm run check` exit 0, `npx vitest run --project repo`
  493/493, `node scripts/citations.mjs docs/work/repo-25-...md
--displaced-since origin/main` exit 0, `node scripts/citations-gate.mjs`
  "112 enforced, 0 failing; 7 grandfathered" exit 0.

- 2026-09-27 — Gate 1 (FAIL) fixed. Each finding reproduced before touching
  anything; verdicts below.

  **High, fixed as the owner's chosen (a): skip a quoted reference only when
  it carries no anchor.** Reproduced first: the unconditional skip dropped 23
  real, anchored citations from `docs/work/repo-31-the-windows-leg-is-almost-
all-red.md` (3 of them in its Review, where 5 references fell to 2; the
  whole-record `moved` count went from 6 to 0 — live drift hidden, matching
  the gate's framing exactly). Fixed by moving the `inQuotation` check in the
  `INLINE` and `SHORTHAND` passes to after each match's groups are read, and
  gating the skip on `g.anchor === undefined` (`INLINE`) or `g.inner ===
undefined && g.outer === undefined` (`SHORTHAND`); `PIN_SHAPED` and
  `SHORTHAND_PIN` are left unconditional, since neither carries an anchor
  concept at all, so the same gate would always be true there. Verified: the
  repo-31 Review section is back to 5/5 `ok`, the whole-record run is back to
  `exit 2 — 6 moved` (matching base exactly), repo-25's command still exits 0
  on the same 37 references, and a corpus-wide scan (`extractCitations` at
  base vs. head, over every `docs/work/*.md` and `tools/*/docs/work/*.md`)
  shows a delta of exactly 39 references removed — the same number the gate
  measured in its own scratch copy — none of them state-changed, none added.

  **Low, fixed: `DOUBLE_BACKTICK`'s closing run must equal the opening
  one's length, not merely meet it.** Reproduced: a triple-backtick span
  closed on only the first two of its three closing backticks, leaving one
  dangling. Fixed with a backreference, `/(\x60{2,})[\s\S]*?\1(?!\x60)/g`;
  verified the repo-25 four-backtick reproduction, the two-spans-per-line
  case, and the triple-backtick probe all still resolve correctly, and the
  corpus scan above is unchanged by this half (0 hits, as the finding said).

  **Med, fixed: the Done-when-3 test replaced.** Reproduced the gate's
  mutation by hand — letting the `INLINE` pass's guard set `currentFile`
  before its `continue` — against the _old_ fixture (a quotation holding
  only a shorthand): stayed green, confirming the finding. The _new_ fixture
  quotes a qualified `INLINE` citation into a second file instead; against
  the same mutation it resolves the trailing shorthand to the quoted file
  (`b/two.ts` rather than `a/one.ts`), red as intended, green on the
  unmutated code and on every other test in the file.

  **Med, fixed per the owner's decision (a): the Build's line 76 prefixed
  with one word when landing this section, and the `extractSections`
  divergence filed as `repo-63`.** Reproduced: `extractSections` on this
  ticket's own file read `## Build` as swallowing `## Done when` and
  `## Log` both, because CommonMark does not treat a backtick run followed
  by more backticks on the same line as a fence opener at all (a backtick
  info string may not contain a backtick), and this file's own reproduction
  of `` `:99999` `` is written exactly that way. Not this ticket's to fix —
  its own Build says not to widen into fence handling — so filed as
  `repo-63` with the reproduction, and worked around here only by moving
  "literal" to open the physical line instead of the backtick run (oxfmt
  does not reflow a line that already fits the width, so a word appended to
  the _previous_ line — my first attempt — left line 76 untouched; moving it
  to open the line itself survives formatting). Verified:
  `extractSections` on the fixed file finds `Build`, `Done when` and `Log`
  each as their own section.

  **Low, fixed: the prose-pass finding.** Confirmed it goes away under the
  high's fix — verified directly, no `line 99` reference appears for
  `repo-31` any more since the citation around it is read again.

  **Low, accepted as documented, not fixed: backtick-adjacency and
  per-line scope (two findings).** Both 0 corpus hits, both would need
  either single-backtick span state or cross-line lexing that nothing else
  in this scan does, disproportionate to a low with no live instance.
  Documented in `DOUBLE_BACKTICK`'s own docblock instead, including the
  fence-inside-quotation half, which is this same per-line limitation
  cutting the other way (hides a citation `extractCitations` deliberately
  still reads inside a fence) rather than a new one.

  **Log corrections** (three, all confirmed by re-running rather than taken
  on the gate's word): the entry above is corrected in place rather than
  silently — "the corpus has none today to disturb" (a double-backtick pin)
  was wrong, `repo-31` record line 103 has one and it was disturbed until
  the high's fix; "(4 citations, 5 occurrences)" for `repo-50` was backwards,
  it is 5 distinct citations across 4 record lines; and the exit-128
  reproduction claim holds exactly as the gate re-confirmed.

  **Open decisions closed by the owner, not by me**: all three were
  answered through the coordinator's `AskUserQuestion`, each choosing the
  gate's own recommendation. Nothing left open from this round.

  **`pl-32`**: no Log entry added there, per the gate's own "dropped"
  disposition (not a defect; a `fix(repo)` pull request touching a
  `tools/planner` path releases that tool for a change describing nothing
  planner-specific) — reversing the flag I raised in the entry above.

  Verified after all of the above: `npx vitest run scripts/test/citations.test.ts`
  105/105, `npm run check` exit 0, `npx vitest run --project repo` 493/493,
  `node scripts/citations.mjs docs/work/repo-25-...md --displaced-since
origin/main` exit 0, `node scripts/citations-gate.mjs` "113 enforced, 0
  failing; 6 grandfathered" exit 0.

- 2026-09-27 — Gate 2 (CONCERNS) landed. Gate 1 record replaced by the
  reviewer's amended version after a lander edit. Mechanical fixes applied:
  added test for the anchor carve-out (both INLINE and SHORTHAND passes);
  corrected regex docblock to acknowledge opener backtrack and closer length
  variance; corrected Log entries stating the 23 citations are from the whole
  record with 3 in Review (not Review alone), and that the run-length finding
  is low (not med); corrected repo-63 Log entry to show it follows the gate
  recommendation, not against it. **Correction, next round**: that last
  clause is false — `git diff 7bb2d8f d789c86 --
docs/work/repo-63-...md` is empty, repo-63 was not touched this round.
  Left in place rather than rewritten so the mistake stays legible; the
  actual fix is in the entry below.

- 2026-09-27 — CI's `check` on PR #296 (`d789c86`) was red:
  `node scripts/citations-gate.mjs --against origin/main` exit 1, 3 records
  failing. Cause: the docblock edit in the entry above removed one line net
  from `scripts/citations.mjs`, shifting every citation below it by one, and
  the rewritten paragraph was itself wrong — "closed by a run at least as
  long" contradicts the backreference it describes, and "two-close-one" is
  not a sentence a probe can check. Fixed:

  Rewrote the docblock a third time, this time checked against a probe
  rather than described from memory, and against CommonMark's own code-span
  rule rather than assumed: the opener's `\x60{2,}` is greedy but can
  backtrack to a shorter run than the maximal one actually present, and the
  closer it settles for can be the tail of a longer run rather than one of
  its own — probed both ways (three opening against two closing backticks,
  and the reverse), each swallows a real shorthand where CommonMark reads an
  ordinary code span holding one. Kept the file's own line count identical
  to `d789c86` (2341 lines) so nothing below it moves again; verified
  `scripts/citations.mjs:601 "const inQuotation"` and `:402`'s
  `DOUBLE_BACKTICK` declaration both landed back where gate 1 and gate 2
  resolved them.

  Replaced the landed `### Gate 2` with the reviewer's amended,
  re-resolved copy (`scratchpad/repo-60/review-gate2-amended-reresolved.md`)
  byte for byte — removed the old block, spliced with
  `scripts/review-record.mjs --gate 2`; the only difference from the section
  file is table padding. Re-resolved gate 1's own `const inQuotation`
  citation into `scripts/citations.mjs`, previously line 602, to `:601`,
  coordinate only, since the docblock rewrite moved it back by the one
  line the fixer's edit had taken.

  Re-repointed `repo-50` and `repo-52` into `scripts/citations.mjs`: both
  were still repointed for `7bb2d8f`, one line short of `d789c86`'s tree
  (which neither record's own commits touched), verified each anchor holds
  at its new line before editing.

  Verified the fixer's new test (`"an anchored citation inside a
double-backtick quotation is still read"`) reds under _each_ half of the
  carve-out mutation independently — dropping the `INLINE` pass's
  `g.anchor === undefined` condition loses the quoted anchored inline
  citation; dropping the `SHORTHAND` pass's `g.inner === undefined &&
g.outer === undefined` condition loses the quoted anchored shorthand —
  confirmed by hand in two throwaway mutant copies, matching gate 2's own
  med finding that no test held this before.

  Corrected `repo-63`'s Log to the reviewer's wording
  (`scratchpad/repo-60/repo-63-corrected.md`, applied verbatim after
  diffing) and, above, the false claim in the prior entry that this had
  already happened.

  Verified: `node scripts/citations-gate.mjs --against origin/main` exit 0;
  `node scripts/citations.mjs docs/work/repo-60-*.md --section Review
--require-anchors --require-distinct-anchors` exit 0; `npx vitest run
scripts/test/citations.test.ts` 106/106; `npm run check` exit 0;
  `node scripts/preflight.mjs --base origin/main --title "fix(repo): stop
reading a double-backtick quotation as a shorthand citation (repo-60)"`
  exit 0.

- 2026-09-27 — Gate 3 (PASS) landed, `scripts/review-record.mjs --gate 3`,
  verbatim (0 diffs against the section file once table padding is
  normalised). One new low, not acted on here per the coordinator's
  instruction: `scripts/test/citations.test.ts:2851`'s comment says either
  carve-out condition regresses the gate 1 high; only the `INLINE` one does,
  since all 23 vanishing citations in repo-31 are inline. The test itself
  still catches both halves — this is a docblock-only overclaim, left for
  the owner to decide on separately, and the gate cites it by anchor.

- 2026-09-27 — `repo-63` landed `extractSections`'s fix, so this record's own
  Build line 76 no longer needs the one-word `literal` prefix worked around
  above; removed it here as `repo-63`'s Done-when asks, restoring the line to
  open with the backtick run itself. `extractSections` now reads `Build`,
  `Done when` and `Log` as their own sections again on this file unchanged —
  verified by `repo-63`'s own new test, which plants this exact line shape.
