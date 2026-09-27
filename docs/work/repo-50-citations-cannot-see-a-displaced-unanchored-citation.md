---
id: repo-50
tool: repo
title: citations.mjs cannot see an unanchored citation whose cited line changed since a base
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-50 — `citations.mjs` cannot see an unanchored citation whose cited line changed since a base

## Why

An unanchored citation — a path and a line number with no quoted fragment —
resolves as long as the file has that many lines. When an edit above that line
pushes the text down, the citation still resolves, `citations.mjs` reports it `unanchored` as it
always did, and `citations-gate.mjs` exits 0, because the gate reads `## Review`
sections only and an unanchored citation is never `moved`. So a branch that
inserts ten lines into a page silently redirects every unanchored citation into
that page, in every record's Log, Why and Build, and nothing in the repo reports
it.

Measured on 2026-09-20, on the branch that swept sessions 12 to 23's skill
defects into the rule pages (`orchestrate-skill-sweep`). Its first gate found 11
anchored citations correct at the base and broken at the tip, all outside
`## Review`; its second found four unanchored ones in `repo-38`'s Log displaced by
the previous commit's own repair; its third found one more in `dl-57`'s Log, in
`tools/downloader/docs/work/`, because the sweep's pathspec had ended at the
directory and matched nothing. Three rounds, three scope misses, all found by a
hand-rolled base-versus-tip script that lives in a session scratchpad and nowhere
else. The final sweep pinned 24 unanchored citations across six records to the
base sha.

The check is mechanical and the checker already has both halves: it resolves
citations, and it accepts `--rev`. What it lacks is a mode that resolves each
unanchored, unpinned citation at two trees and reports the ones whose cited lines
differ.

## Build

Add `--displaced-since <ref>` to `scripts/citations.mjs`. For every unanchored,
unpinned citation in the record, read the cited line or range at `<ref>` and at
the tree the run resolves against; report each one whose text differs as
`displaced`, printing both versions' first differing line, and set a new exit bit
for it. Citations that are anchored, pinned, or inside an evidence declaration
are out of scope: the first two already fail or hold on their own, and the third
is a deliberately broken state.

Give `citations-gate.mjs` the same flag, passed through to every record in both
ticket roots — `docs/work/*.md` and `tools/*/docs/work/*.md`, with the `*.md`,
since a pathspec ending at the directory matches nothing — so one command answers
"what did this branch displace" for the whole corpus. Whether CI runs it is a
later decision; this ticket builds the instrument.

Prove the harness can fail before trusting a clean run: plant an insertion above
a cited unanchored line in a scratch copy and watch the mode report it.

## Done when

- `node scripts/citations.mjs <record> --displaced-since origin/main` reports
  every unanchored, unpinned citation whose cited text differs between the two
  trees, and nothing else, with a test that goes red when the comparison is
  removed.
- `node scripts/citations-gate.mjs --displaced-since origin/main` walks both
  ticket roots and a test asserts the `tools/*/docs/work/*.md` half is read.
- The positive control above is in the test suite, not only in the Log.
- Run against `orchestrate-skill-sweep`'s tip before its pins landed, the mode
  reports the 24 citations that branch pinned by hand, or the Log says which it
  misses and why. Those tips (`ac98b37`, `5c517d3`, `44196c1`) are branch-only
  commits, unreachable from a fresh clone once the branch squash-merges and is
  deleted; `git fetch origin refs/pull/281/head` brings them back, since all
  three are ancestors of pull request #281's head.

## Review

### Gate 1

**Gate: FAIL** — 2026-09-26 · `a1a417b...347cf4b`, tip `347cf4b`; `origin/main` was still at `a1a417b` after this gate fetched · code-review at medium · Opus 5.5, a different model from the builder

| Done when                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `--displaced-since` reports every unanchored, unpinned citation whose cited text differs, and nothing else, with a test that goes red without the comparison | **proven** — `scripts/test/citations.test.ts:2490 "expect(displaced?.state).toBe("`, the negative at `scripts/test/citations.test.ts:2510 "does not report displacement when the cited text has not moved"`, anchored and pinned left alone at `scripts/test/citations.test.ts:2549 "expect(anchored?.state).toBe("` and `scripts/test/citations.test.ts:2566 "expect(pinned?.state).toBe("`. Forcing the comparison to return null reds 5 of 139 over the two specs, all five new; forcing it always to fire reds 2 of 139, both negatives. Carve-outs in the lows below: whitespace-only differences, and a range that straddles the old EOF |
| 2. `citations-gate.mjs --displaced-since` walks both ticket roots, and a test asserts the tools half is read                                                    | **proven** as written — `scripts/test/citations-gate.test.ts:828 "reaches a record under tools/*/docs/work, not only docs/work"` runs the real `SCOPE`; dropping the tools pathspec from it reds that test and one other, 2 of 40. It walks only `## Review`, though — the high below                                                                                                                                                                                                                                                                                                                                                          |
| 3. The positive control is in the suite                                                                                                                         | **proven** — `scripts/test/citations.test.ts:2734 "expect(atTip.status).toBe(EXIT.displaced)"` over a real two-commit repository whose second commit inserts above the cited lines; the unflagged half at `scripts/test/citations.test.ts:2500 "const plain = checkCitations([citation], () => INSERTED_ABOVE)"`                                                                                                                                                                                                                                                                                                                               |
| 4. Against the sweep tips before their pins, the mode reports the 24 pinned citations, or the Log says which it misses                                          | **verified** — re-run by this gate against the three tips (all reachable after fetching pull request 281 head): 24 of 24 pins matched to a `DISPLACED` line, per record 5, 1, 4, 7, 6, 1, plus 5 unpinned extras, all shorthand in repo-38. The Log account of this row is wrong — med below                                                                                                                                                                                                                                                                                                                                                   |

- **high** · The gate flag cannot answer the question the Build gives it, "what did this branch displace, for the whole corpus". `scripts/citations-gate.mjs:133-135 "export const SCOPE = {"` reads `## Review` only, and the Why names that as half the defect: every incident it cites sat in a Log. Enforced Review sections hold no unanchored citation (one would already fail), so on any tree where the plain gate passes, the flag can only reach the 21 grandfathered unanchored ones. Reproduced: a fixture record with an anchored Review and a Log line citing a line an insertion displaced gives `gate()` 1 in scope, 0 failed, while `citations.mjs` on the same record exits 128 with 1 displaced. **Open decision**: (a) under the flag, the gate reads every section and fails on `displaced` alone, not on the unanchored backlog — recommended, since it is what the Build asks for; (b) keep Review-only, say so in the docblock, and correct the Build to answer the corpus question with a loop over `citations.mjs`.
- **med** · In a grandfathered record, `displaced` is absorbed into the debt allowance and the gate exits 0 without naming the record. Measured at this tip: `node scripts/citations-gate.mjs --displaced-since a1a417b` exits 0, printing only "holding 2 unresolvable, 1 displaced, 20 unanchored"; the one is the TLS port shorthand in repo-25, shifted by this branch edit above that line of `scripts/citations.mjs`. That contradicts `scripts/citations.mjs:224 "sets its own exit bit, unconditionally"`.
- **med** · The Log account of Done-when 4 is false in three places. "22 pins total. **Not 24**": 44196c1 adds 23 pins and b07d506 one, 24; the Log counted lines with `grep -c`, and repo-35 carries four pins on two lines. The "seven more" extras are five. And "22 further displaced results into scripts/citations.mjs at this same base" is an artefact of copying the branch script over the historical checkout: the scripts directory is unchanged from fdafd1a to 5c517d3, and read at 5c517d3 repo-35 reports 4 displaced, none into that file. The Log also blames the ticket premise for a discrepancy that is not there.
- **low** · The Log gives the base suite as 472; `npx vitest run --project repo` at `a1a417b` is 471, so the branch adds 10, not 9.
- **low** · The comparison is raw, `scripts/citations.mjs:1109 "if (at === -1) return null;"`, while the message normalises whitespace, `scripts/citations.mjs:1112 "const show = (line) => normalize"`. A re-indent or a CRLF-only difference is reported `DISPLACED` with identical text on both sides of "before" and "now". `.gitattributes` forces LF on checkout here, so the CRLF half needs an editor to write one before staging.
- **low** · `scripts/citations.mjs:202 "Nothing is reported when the ref cannot supply a baseline"` overclaims: a citation the record gained after the ref, onto a line that existed then and has changed since, is reported. That case can be a true positive (dl-72, whose record did not exist at its base, cites two lines its own fix rewrote, and the mode flags both) or a false one (a citation written against the tip). The docblock should say the mode cannot tell those apart.
- **low** · The EOF guard, `scripts/citations.mjs:1099 "c.end > before.length"`, has no test that can fail: deleting it keeps 139 of 139 green, because `scripts/test/citations.test.ts:2570 "const grew = checkCitations"` cites a line wholly past the old EOF, where the slice is empty anyway. The guard matters only for a range straddling the old EOF, and nothing covers that.
- **low** · `scripts/citations.mjs:1065 "displaced: 128,"` fills the last bit of the byte, and a ninth bit, 256, exits 0 (measured with node). Any combination with it also reads as 128 plus a signal to a shell: the repo-21 historical run exited 131. Neither is named in the EXIT docblock.
- **low** · An evidence declaration naming a displaced citation is reported stale with "it does not fail — drop the declaration", in a run that exits 136 because it fails. The same shape repo-52 gate 1 found for `unpinned-volatile`.
- **dropped** · the `c.start < 1` half of the EOF guard is unreachable, since `checkCitations` has already refused that start. Harmless.
- **dropped** · a citation into a file renamed since the ref reports nothing. Documented as a deliberate choice, and a product decision rather than a defect.
- **findings** · code-review at medium returned 11; 9 carried, 2 dropped.
- **scope** · no CI, preflight or skill-page wiring, which matches the Build ("whether CI runs it is a later decision"). The repo-52 edit changes seven `file:line` tokens in its Review and appends one Log entry; word diff shows no reviewer text touched.
- **gates** · `npm run check` exit 0; `npx vitest run --project repo` 481 of 481 (base 471); `node scripts/citations-gate.mjs --against origin/main` exit 0, 106 enforced, 0 failing.
- NFR: security ✓ (argument arrays, no shell) · performance ✓ (one tree per ref, cached) · reliability — the high and the first med · maintainability — the lows.

### Gate 2

**Gate: CONCERNS** — 2026-09-26 · `347cf4b..cf64d30`, tip `cf64d30`; `origin/main` still at `a1a417b` · re-gate of the round only · Opus 5.5

Gate 1 findings:

- **high** (Review-only scope) · **fixed**, one half unproven — reverting the widened read in `checkRecord` reds 2 of 42 in the gate spec, including the Log fixture at `scripts/test/citations-gate.test.ts:906 "expect(states).toEqual("`; `node scripts/citations-gate.mjs --displaced-since origin/main` exits 0 over 184 records. A record with no Review section at all is the new med below.
- **med** (grandfathered absorbs `displaced`) · **fixed** — `scripts/test/citations-gate.test.ts:1029 "never absorbs a displaced failure into the grandfathered allowance"`; dropping the new check reds 1 of 42.
- **med** (Log account of Done-when 4) · **fixed** — the Log now gives 23 plus 1 = 24 pins, 29 reported, 5 extras in repo-38, and withdraws the 22 into the script as a method artefact, all matching this gate. New low below on how it was corrected.
- **low** (base 472) · **fixed** — 471 in the Log, and 471 is what this gate measured.
- **low** (raw comparison) · **fixed** — `scripts/citations.mjs:1108 "normalize(line) !== normalize(now"`; reverting it reds 1 of 102 at `scripts/test/citations.test.ts:2631 "expect(crlf?.state).toBe("`, which also keeps a real change on the same line failing.
- **low** (postdates docblock) · **fixed** — the paragraph now says the mode cannot tell a citation written for the ref from one written for the tip. New low below on one label in it.
- **low** (EOF guard untested) · **fixed** — `scripts/test/citations.test.ts:2595 "refuses a range that straddles the ref"`; dropping the guard reds 1 of 102.
- **low** (exit byte full, signal reading) · **fixed** in the EXIT docblock; its 256-exits-0 and repo-21 exit 131 claims match this gate measurements.
- **low** (stale message says "does not fail") · **fixed** — `scripts/test/citations.test.ts:2672 "expect(stale[0]?.reason).not.toMatch(/does not fail/)"`; removing the new branch reds 1 of 102.

New, in lines this round touched:

- **med** · The repo-25 repair edits a reviewer quotation, not only a coordinate. `docs/work/repo-25-citations-checker-misses-shorthand-references.md:196 "backticked port numbers"` quoted the dl-38 port 443 as an example of text that is not a pointer; it now reads as a pin into `scripts/citations.mjs` at `fdafd1a`, line 443, which is unrelated code, and the sibling port 8443 inherits that pin. The words a reader sees in a merged gate record changed meaning. **Open decision**: (a) keep the pin and add a dated transcription note beside that section saying the quotation was rewritten and why, with the owner consenting to an edit of reviewer text — recommended, as the smallest change that keeps the flagged gate green; (b) restore the reviewer text byte for byte and accept that `--displaced-since` fails on repo-25 until the shorthand parser learns that a double-backtick span is a quotation, filed as its own ticket.
- **med** · Under the flag, a record with no Review section is no longer skipped (`scripts/citations-gate.mjs:567 "if (displacedSince === null) return { record, skipped: true };"`), and no test covers it: making that return unconditional keeps 42 of 42 green. It is the larger half of the high, since 71 of the 184 records reached have no Review section, and that is where most Logs are.
- **low** · Two findings, one cause: the widened read reaches a summary still worded for the Review-only scope. Under the flag the header still says the Review section of 184 records, and the grandfathered debt line reads 6 unresolvable, 8 moved and 51 unanchored where the plain run reads 2 and 21, because `scripts/citations-gate.mjs:716 "debt[state] = (debt[state] ?? 0) + n"` now sums states from Log citations that are not debt.
- **low** · `scripts/citations-gate.mjs:517 "outside it, only"` says only `displaced` is fatal outside the section, but every declaration in the record is now read (`scripts/citations-gate.mjs:586 "const declarations = extractDeclarations(markdown).filter((d) => inScope(d.line));"`), so a stale declaration in a Log fails the record under the flag. Reproduced on a fixture record with a clean Review and a Log declaration that excuses nothing: plain run 0 failed, flagged run fails it with 0 failures and 1 stale. No live case in the corpus today.
- **low** · `scripts/citations.mjs:218-219 "before dl-72 merged"` names `20eb8ba`, but dl-72 merged as `7156967`, whose parent is `6f1f6bf`. The measurement holds at both: 2 displaced at each.
- **low** · The Log says the wrong Done-when 4 figures are "kept struck rather than deleted, per records.md". The old method paragraph and the "Not 24" paragraph were deleted and only three fragments struck, and `records.md` has no such rule; the practice is recorded in `history.md`.
- **dropped** · the repo-14 pins change a Log, not a Review; the text said the two citations "stay as written", and pinned to `91c117b` they read exactly the `argv.find` line and the usage throw the entry describes (checked with `git show`). Meaning kept.
- **findings** · hunt over the round returned 7; 6 carried, 1 dropped.
- **plain gate unchanged** · `a1a417b` scripts and `cf64d30` scripts give byte-identical `node scripts/citations-gate.mjs` output on both the base tree and this tip; `ci.yml` passes neither the flag nor a new argument.
- **pins** · `91c117b` and `fdafd1a` are both ancestors of `origin/main` (`git merge-base --is-ancestor`).
- **gates** · `npm run check` exit 0; the two specs 144 of 144; `npx vitest run --project repo` 486 of 486; `node scripts/citations-gate.mjs --against origin/main` exit 0, 106 enforced; `--displaced-since origin/main` exit 0, 177 enforced; `node scripts/preflight.mjs --base origin/main` exit 0.

### Gate 3

**Gate: PASS** — 2026-09-26 · `cf64d30..5ad3286` (2eded7d, then 5ad3286, Log-only), tip `5ad3286`; base kept at `a1a417b`, while `origin/main` moved to `e50cf81` (#290) · re-gate of the round only · Opus 5.5

_Amended after landing (#291): the two repo-60 citations in the first new-findings low are now prose naming `5ad3286`, because the fix to repo-60 at `d0e82aa` deleted the line 35 text they quoted and rewrote line 43 to name `5ad3286` in place of `cf64d30`; no other coordinate in this section moved at `d0389bb`._

Gate 2 findings:

- **med** (repo-25 reviewer quotation) · **resolved as the owner decided, option (b)** — `git diff origin/main` and `git diff a1a417b` on the repo-25 record are both empty; `node scripts/citations-gate.mjs --displaced-since origin/main` exits 1 with repo-25 as its only failure (1 displaced), both at this tip and on a scratch merge of it into `e50cf81`. The parser gap is filed as repo-60; two lows on its brief below.
- **med** (record with no Review section untested) · **fixed** — `scripts/test/citations-gate.test.ts:922 "reads a record with no Review section at all, under displacedSince"`; making the skip unconditional reds it, 1 of 45.
- **low** (summary worded for Review-only scope) · **fixed** — the debt tally is locked at `scripts/test/citations-gate.test.ts:985 "expect(flagged.debt).toEqual({ unanchored: 1 });"`, and reverting it to sum the whole read reds 1 of 45; the flagged run now holds 2 unresolvable and 19 unanchored rather than 6, 8 and 51. The header half has no test, below.
- **low** (stale Log declaration fatal under the flag) · **fixed** by making the docblock match the code, and locked at `scripts/test/citations-gate.test.ts:1000 "a stale evidence declaration in a Log fails the record under displacedSince too"`. A defensible reading, and the behaviour the plain gate never sees.
- **low** (dl-72 label) · **fixed** — it now names `6f1f6bf`, where gate 1 measured the same 2 displaced.
- **low** (Log strike claim) · **half fixed, half withdrawn.** The Log now says which figures were struck and which paragraphs replaced. **WITHDRAWN — do not cite:** the Gate 2 clause "and `records.md` has no such rule". It is false: `.claude/skills/orchestrate-tickets/reference/records.md@a1a417b:35 "withdrawn in place, never deleted"` states it, for a claim that reached a record. That gate searched `records.md` for the word struck and not for withdrawn. The builder then relayed the false clause into the repo-50 Log, which is the last low below.

New, in lines this round touched:

- **low** · Two findings, both in the repo-60 brief. the repo-60 brief at `5ad3286`, line 43 ("Reproduced at"), names `cf64d30`, but the repo-25 record as committed there carries the pin and reports exit 0 (run with `--rev cf64d30` on the copy committed there); the quoted output needs the restored record over the cf64d30 scripts. It reproduces at `5ad3286`, exit 128, 1 displaced, with the tip line reading "* verdict." rather than the quoted "*". And the repo-60 brief at `5ad3286`, line 35 ("refused exactly that edit"), credits gate 2 with refusing the pin; gate 2 recommended keeping it, and the owner chose the restoration, as the repo-60 Log itself says correctly.
- **low** · The new header branch, `scripts/citations-gate.mjs:827 "every section (displaced fatal outside"`, has no test: forcing the old wording under the flag leaves every spec green, and no spec searches for the new string.
- **low** · The historical-check entry of the repo-50 Log now carries a parenthetical crediting gate 2 with the correction that the practice lives in `history.md` rather than `records.md`, and reads the `records.md` rule as scoped to gate records. The first is the withdrawn clause above; the second is one reading of a rule whose sentence says a record. **Open decision**: (a) restore the replaced method and "Not 24" paragraphs marked WITHDRAWN beneath the new ones, as that rule asks, and drop the attribution — recommended; (b) keep the replacement and only drop the attribution to gate 2.
- **findings** · hunt over the round returned 4 (the first bullet is two); 4 carried, 0 dropped.
- **checked, no finding** · repo-52: two coordinates re-pinned in its Review (1351 to 1352 twice, 1312 to 1313) and one Log entry added, no reviewer word changed. repo-60 id: `node scripts/next-id.mjs repo --rev origin/main` claims it for this branch only and answers repo-61 as next free, and no open pull request claims it. Scratch merge `5bdc63c` of `5ad3286` into `e50cf81` merged cleanly.
- **gates** · `npm run check` exit 0; the two specs 147 of 147; `npx vitest run --project repo` 489 of 489; `node scripts/citations-gate.mjs --against origin/main` exit 0 at the tip and exit 0 on the scratch merge, 106 enforced, 0 raised; `node scripts/preflight.mjs --base origin/main` exit 0.

## Log

- 2026-09-20 — Filed from the third gate on `orchestrate-skill-sweep`, on the
  reviewer's recommendation. Not built on that branch: it is scoped to the skill
  pages, and this is a change to a script with tests.

- 2026-09-26 — Built. `--displaced-since <ref>` added to `scripts/citations.mjs`
  (`checkDisplacement`, called only for a citation that is `unanchored` and
  carries no pin, using the same `trees()` machinery `--rev` already reads pins
  through) and threaded through `scripts/citations-gate.mjs` (`checkRecord` and
  `gate` both take it; the CLI's `--displaced-since` is validated against the
  repository up front, the same way an invalid `--against` was already refused).
  `EXIT.displaced = 128`, unconditionally fatal — no `--require-*` flag guards
  it, since the state cannot appear unless the caller already asked for it.

  Positive control, base vs. head, both runs recorded: at `a1a417b` (this
  branch's base) `node scripts/citations.mjs` does not accept the flag at all —
  `unknown option --displaced-since`. Reproduced the defect itself on a scratch
  fixture instead, per the ticket's Why: a two-commit repo where the second
  commit inserts three lines above a cited, unanchored `src/tls.ts:2-3` —
  `node scripts/citations.mjs drift.md` (no flag, either revision) reports
  `unanchored`, exit 0, on both — the coordinates still resolve, so nothing
  noticed the insertion. At head, the same fixture with
  `--displaced-since <the pre-insertion sha>` reports `DISPLACED
src/tls.ts:2-3`, `exit 128 — 1 displaced`, naming the line and both versions'
  text. The equivalent gate-level reproduction, a record under
  `tools/planner/docs/work/` (not `docs/work/`, to hit the second half of
  `SCOPE.records`): `checkRecord`/`gate`/the CLI all report the same citation
  `unanchored` without the flag and `displaced` (`FAIL … 1 displaced`) with it.
  Both fixtures are in the test suite, not only here — see `Done when` below —
  and a mutation check confirmed each one goes red: with `checkDisplacement`'s
  call site replaced by a bare `null`, `npx vitest run
scripts/test/citations.test.ts` failed 2 of 99 and `npx vitest run
scripts/test/citations-gate.test.ts` failed 3 of 40, all five the tests this
  ticket added; restored, both files are green again (99/99, 40/40).

  Fold-in considered and declined: repo-47 ("the citations gate fails a code PR
  on merged records") is `needs-decision` and adjacent, not folded in — its
  question is whether the gate should run at all against a PR that only touches
  code, which this ticket's `displaced` state does not bear on either way: it
  is a new _state_ the existing gate invocation can produce, not a change to
  when the gate runs or what triggers it. If repo-47 lands changing which PRs
  the gate runs against, `displaced` participates in that the same way `moved`
  and `unanchored` already do, with no code of its own to change.

  **Collision with the ticket's own edit, found by `preflight.mjs`'s citations
  check and not by anything in the Build section:** this branch's own diff to
  `scripts/citations.mjs` and its test inserted text above lines that
  `docs/work/repo-52-....md`'s `## Review` section cites with anchors — the
  exact class of drift this ticket detects, this time on an _anchored_ citation
  (which was already `moved`, not `unanchored`, so `--displaced-since` would not
  have caught it even if run; `moved` is `citations.mjs`'s pre-existing,
  anchor-based mechanism for exactly this case). `node scripts/citations.mjs
docs/work/repo-52-....md --section Review --require-anchors
--require-distinct-anchors` reported `0 verified, 7 moved` before repointing
  and `7 verified, 0 moved — exit 0` after; the six distinct `file:line` tokens
  (`scripts/test/citations.test.ts` at 2354, 2370, 2323, 2413 and
  `scripts/citations.mjs` at 1209 twice, 1170) were repointed to the lines the
  tool named, wording and verdicts unchanged — see that ticket's own Log entry,
  dated today, for the command and full before/after.

  **The historical check** (`Done when` 4), corrected in place after gate 1
  found three wrongs in the first pass. **Corrected, not all in the same
  shape**: three small wrong figures are struck through and replaced inline
  (`~~5, 1, 2, 7, 6 = 21~~`, `~~22~~`), matching the "correct in place, mark
  what moved, do not erase that a wrong claim propagated" practice
  `records.md`'s withdrawal rule records for exactly this case; the old method
  paragraph and its "Not 24" framing, which were wrong in their premise rather
  than in one figure, are replaced outright below rather than struck — a
  smaller, contained correction did not fit a paragraph whose whole reasoning
  was the thing to withdraw, so each is marked as withdrawn in place and stands
  prose instead of marked in the old one. `git fetch
origin refs/pull/281/head` brought `ac98b37`, `5c517d3` and `44196c1` back
  reachable — confirmed ancestors of `FETCH_HEAD` by `git merge-base
--is-ancestor`, all three.

  **Method, corrected.** The first pass copied this branch's `citations.mjs`
  over a `git worktree add --detach` checkout of the historical tip and ran the
  plain (no-`--rev`) CLI there — which reads every _unpinned_ citation's "now"
  side off that checkout's working tree, `scripts/citations.mjs` included, and
  that file had just been overwritten with this branch's own multi-thousand-
  line version. Every citation into it therefore compared the record's real
  historical line numbers against content that commit never held, which is
  exactly what produced the bogus `repo-35` figure below. The fix costs nothing
  extra: extract the record's own text at the historical tip with `git show
<tip>:<path>`, then run this branch's own `citations.mjs` against that
  extracted copy with `--rev <tip> --displaced-since fdafd1a`, from this
  worktree, untouched — `--rev` already resolves every _other_ citation's "now"
  side against `<tip>`'s real tree via `git show`, which is what it is for, and
  nothing in this repository's checkout is overwritten to get there.

  **Pin count, corrected.** `git show 44196c1 -- docs/work | grep "^+" | grep -o
'@fdafd1a' | wc -l` gives **23**, not the ~~5, 1, 2, 7, 6 = 21~~ the first
  pass counted with `grep -c` — which counts _matching lines_, and `repo-35`'s
  diff carries two lines with two pins each. Per record: `repo-21` 5,
  `repo-32` 1, `repo-35` 4, `repo-38` 7, `repo-48` 6. `b07d506` adds one more
  (`dl-57`, into `records.md`) — ~~22~~ **24 pins across six records**, matching
  the ticket's own figure exactly; the first pass's "Not 24" was wrong, not the
  ticket.

  **Displaced count, corrected.** Re-run with the fixed method — `--rev
5c517d3 --displaced-since fdafd1a` for the first five records' extracted
  text, `--rev 44196c1 --displaced-since fdafd1a` for `dl-57`'s — reports
  **29** `.claude`-page citations, unchanged from the first pass's total since
  that pass's flaw was confined to `repo-35`'s citations into
  `scripts/citations.mjs`, a different file from the ones it pins: 5, 1, 4, 12,
  6, 1 per record. All 24 pinned coordinates are among the 29 — spot-checked on
  `repo-38` (12 found, 7 pinned, matching exactly) and `repo-35` (4 found, 4
  pinned, now matching exactly where the first pass wrongly reported 2). The
  five extras are all in `repo-38`, all shorthand (`` `:153-154` ``, `` `:93` ``, `` `:137` ``, a second `` `:119` ``, `` `:282` ``) inheriting a file the
  sweep's own tool — `git grep -nE '\.claude/[^@ ]*\.md:[0-9]'`, a literal
  pattern — cannot read, the same caveat `repo-52`'s own gate 2 recorded
  against that grep ("cannot see the shorthand spelling"). So: every citation
  the humans caught, plus five more of the same class they structurally could
  not, no subset either way.

  **WITHDRAWN — do not cite this paragraph.** The first pass copied this
  branch's `citations.mjs` over a `git worktree add --detach` checkout of the
  historical tip and ran the plain (no-`--rev`) CLI there — which reads every
  _unpinned_ citation's "now" side off that checkout's working tree,
  `scripts/citations.mjs` included, and that file had just been overwritten
  with this branch's own multi-thousand-line version. Every citation into it
  therefore compared the record's real historical line numbers against content
  that commit never held, which is exactly what produced the bogus `repo-35`
  figure below. The fix costs nothing extra: extract the record's own text at
  the historical tip with `git show <tip>:<path>`, then run this branch's own
  `citations.mjs` against that extracted copy with `--rev <tip>
--displaced-since fdafd1a`, from this worktree, untouched — `--rev` already
  resolves every _other_ citation's "now" side against `<tip>`'s real tree via
  `git show`, which is what it is for, and nothing in this repository's
  checkout is overwritten to get there.

  **WITHDRAWN — do not cite this paragraph.** `git show 44196c1 -- docs/work |
grep "^+" | grep -o '@fdafd1a' | wc -l` gives **23**, not the ~~5, 1, 2, 7,
  6 = 21~~ the first pass counted with `grep -c` — which counts _matching
  lines_, and `repo-35`'s diff carries two lines with two pins each. Per
  record: `repo-21` 5, `repo-32` 1, `repo-35` 4, `repo-38` 7, `repo-48` 6.
  `b07d506` adds one more (`dl-57`, into `records.md`) — ~~22~~ **24 pins
  across six records**, matching the ticket's own figure exactly; the first
  pass's "Not 24" was wrong, not the ticket.

  ~~`repo-35` also carries 22 further `displaced` results into
  `scripts/citations.mjs` itself at this same base, unrelated to the sweep's
  `.claude`-page edits.~~ **Withdrawn.** That was the method's own artefact —
  re-run correctly, `repo-35` at `5c517d3` reports exactly the same 4
  `.claude`-page results and nothing into `scripts/citations.mjs` at all; the
  scripts directory is unchanged between `fdafd1a` and `5c517d3`, so there was
  never anything there to find. This also means the first pass's "blames the
  ticket premise" framing was itself the error being described: the premise —
  three rounds, three scope misses, 24 pinned citations — holds exactly as
  written, and the tool now confirms it rather than disputing it.

  Gates: `npm run format` (2 files reformatted, both mine); `npm run check`
  exit 0; `npx vitest run --project repo` 481/481 (up from **471**, not 472 —
  `npx vitest run --project repo` at `a1a417b` gives 471, so this branch adds
  10, not 9); `node
scripts/preflight.mjs --base origin/main` exit 0 after the repo-52 repoint
  (citations gate: `citation gate clean over 113 record(s), 7 grandfathered —
checked against origin/main`).

- 2026-09-26 — Gate 1 (ticket-reviewer, Opus 5.5, on `347cf4b`) returned FAIL:
  1 high, 2 med, 6 low, 2 dropped. Fixed all named findings; both drops
  (unreachable `c.start < 1` half, renamed-file silence) accepted as stated,
  no change.

  **High** — the flag's own `## Review`-only scope meant `--displaced-since`
  could never reach a Log, the exact incident class the Why section is built
  from. `checkRecord`/`gate` now widen extraction to the whole record when
  `displacedSince` is set, but only `displaced` is fatal outside the section
  that was actually found — an ordinary unanchored citation in a Log or Why is
  not new debt the flag created, and failing on it would flood the corpus.
  Reproduced on the gate's own fixture (an anchored Review verifying at the
  tip, a Log citing a line an insertion displaced): `gate()` gave `1 in scope,
0 failed` before, `1 failed, counts: {displaced: 1}` after — new tests
  `scripts/test/citations-gate.test.ts` "gate() reads the whole record under
  displacedSince, failing only on displaced outside Review" (also asserts the
  unanchored-but-undisplaced half does not fail).

  **Med 1** — `displaced` was silently absorbed into a grandfathered record's
  debt allowance; `EXIT.displaced`'s own docblock says "unconditionally" and
  the gate's ratchet did not hold to it. `gate()` now routes any record
  holding a `displaced` failure straight to `failed`, whatever its entry
  allows. New test: "gate() never absorbs a displaced failure into the
  grandfathered allowance", reproduced red first (mutated the check to `false`,
  the excused allowance of 10 absorbed it) then green.

  **Med 2** — the Done-when-4 account was wrong in the ways the gate named,
  and the method was the cause: copying this branch's `citations.mjs` over a
  `git worktree add --detach` checkout of a historical commit overwrites that
  commit's own copy of the file being cited, so every citation into
  `scripts/citations.mjs` compared real historical line numbers against
  content that commit never held — which is exactly what produced the bogus
  "22 further into `scripts/citations.mjs`" figure for `repo-35`. Corrected
  method: extract the record's text with `git show <tip>:<path>` and run this
  branch's own `citations.mjs` against the extract with `--rev <tip>
--displaced-since fdafd1a`, from this worktree, untouched — `--rev` already
  resolves every other citation's "now" side against `<tip>`'s real tree via
  `git show`. Recounted: `44196c1` pins 23 (`grep -o` on added lines, not
  `grep -c`, since `repo-35` carries two pins on one line), `b07d506` one more
  — **24 across six records**, matching the ticket's own figure exactly; "Not
  24" was the first pass's error, not the ticket's. Re-run correctly,
  `--displaced-since` reports the same **29** as before (5, 1, 4, 12, 6, 1 —
  the first pass's flaw never touched this total, only the separate,
  unrelated `repo-35` figure, now withdrawn in place as an artefact). All 24
  pins are among the 29; the 5 extras are all in `repo-38`, all shorthand,
  which the sweep's own `git grep` cannot read. Corrected in place in the
  earlier entry above — the wrong figures struck, the wrong method paragraph
  replaced and named as withdrawn, per `history.md`'s practice for a claim
  that reached a record and propagated (see that entry's own parenthetical for
  which is which and why the two are not the same shape).

  **Lows.** Base suite corrected to 471 (measured directly at `a1a417b`, not
  472). `checkDisplacement`'s comparison now runs through `normalize`, the
  same collapse the printed message already used, so a re-indent or a
  CRLF-only difference no longer reports `displaced` with identical text on
  both sides — new test with both shapes plus a same-line real-change
  negative. The "nothing is reported when the ref cannot supply a baseline"
  docblock paragraph no longer claims nothing is reported once a citation
  postdates the ref: a citation the _record_ gained
  after `<ref>` onto a line the _file_ already had is still compared, and
  measured on `dl-72`'s own record against `6f1f6bf` — 2 real citations,
  written after the ref, correctly flagged — which the docblock now says
  plainly rather than implying the opposite. The EOF guard now has a test that
  can fail: a straddling range (`start` inside the ref's length, `end` past
  it) whose truncated overlap differs from the tip, reproduced red with the
  guard mutated out (`expected 'unanchored' to be... 'displaced'`) then green
  — `grew`'s wholly-past-EOF shape could never show this, since an empty slice
  vacuously agrees either way. `EXIT.displaced`'s docblock now states the
  ceiling: a process exit code is one byte, `256` silently exits `0`
  (measured), and every code at or above `128` already reads to a shell as
  "killed by signal `code - 128`" — `repo-21`'s own historical run exits `131`
  and would misread as `SIGQUIT`. The stale-declaration message now names
  `displaced` specifically rather than falsely claiming "does not fail".

  **Considered making `displaced` excusable by declaration** (mirroring
  `unresolvable`/`unchecked`), on the theory that an illustrative citation
  quoting a known false positive has no line left to repoint to — tried
  against the two live cases this round surfaced, and reverted for both:
  `repo-25`'s bare port shorthand broke the _plain_ (unflagged) gate the
  moment it was declared, since its default state is `unanchored`, not a
  declarable one, so the declaration itself went stale outside
  `--displaced-since`; and both it and `repo-14`'s drift-demonstration
  citations turned out to have `unpinned-volatile`'s one clean repair all
  along — a pin, to the commit each already names in its own prose
  (`91c117b`, `fdafd1a`). `displaced` stays non-excusable, matching
  `unpinned-volatile`; `citations.mjs`'s `FAILING` docblock records the
  exception as tried and rejected, not only asserted against.

  **The three corpus-wide displaced citations the owner's cost measurement
  named, all resolved by pin, none by declaration or exemption:**
  `repo-14-citations-section-flag-is-a-no-op.md`'s two drift-demonstration
  citations pinned to `91c117b`, the commit its own 2026-09-03 entry already
  names for this purpose; `repo-25-citations-checker-misses-shorthand-references.md`'s
  bare port shorthand pinned to `fdafd1a`. Pinning the first port also pinned
  its sibling port by inheritance (same tight-list paragraph), so its
  existing evidence declaration was updated to the pinned key it now carries;
  the `GRANDFATHERED` entry for `repo-25` needed no change, since a pin does
  not alter the ordinary (unflagged) gate's count.

  Verification, every exit code read directly: `npm run format` (reformatted
  files already touched); `npm run check` exit 0; `npx vitest run
scripts/test/citations.test.ts scripts/test/citations-gate.test.ts` 144/144
  (up from 139, five new); `npx vitest run --project repo` 486/486 (up from
  481); `node scripts/citations-gate.mjs --against origin/main` exit 0, 106
  enforced, 0 failing, 0 raised; `node scripts/citations-gate.mjs
--displaced-since origin/main` exit 0, 177 enforced, 0 failing — the three
  named citations resolved and the high's widened scope reaches the corpus
  clean; `node scripts/preflight.mjs --base origin/main` exit 0.

- 2026-09-26 — Gate 2 (same reviewer, Opus 5.5, on `cf64d30`) returned
  CONCERNS: all nine gate-1 findings fixed, 2 new med, 4 new low.

  **Med — the repo-25 repoint edited a reviewer quotation, not only a
  coordinate.** Open decision, answered by the owner (option (b), overriding
  the gate's own recommended (a)): `docs/work/repo-25-....md` is restored
  byte-for-byte to `origin/main` — `git diff origin/main -- docs/work/repo-25-*.md`
  empty, checked directly. `--displaced-since` fails on that record's
  double-backtick port quotation until the parser is taught a double-backtick
  span is a quotation, not a citation; neither CI nor `preflight.mjs` passes
  the flag today, so nothing enforced regresses. Filed
  [repo-60](./repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md),
  `status: ready`, with the reproduction at this branch's tip.

  **Med — a record with no `## Review` section at all was untested under the
  flag**, the larger half of gate 1's own high (71 of 184 records reached).
  New test `scripts/test/citations-gate.test.ts` "gate() reads a record with
  no Review section at all, under displacedSince": making `checkRecord`'s
  early skip unconditional (ignoring `displacedSince`) keeps 42 of 42 green
  and reds this 43rd, exactly matching gate 2's own measurement.

  **Low — the flagged run's header and debt line still read for the
  Review-only scope.** Header now says `every section (displaced fatal
outside "Review")` when the flag widens the read. The debt tally now sums a
  new `scopedCounts` (counts restricted to the enforced section) rather than
  the whole widened `counts`, so a grandfathered record's own, unrelated Log
  citations no longer inflate its reported debt. New test: a record with one
  real Review debt citation and one unrelated Log citation reports `{
unanchored: 1 }` either way; reverting the tally to sum `counts` reds it at
  `{ unanchored: 2 }`.

  **Low — whether a stale declaration in a Log fails under the flag: docblock
  corrected to match the existing behaviour**, not the other way round. A
  stale declaration is a false claim the record itself makes, not corpus debt
  a flag can widen into existence — unlike an ordinary unanchored citation, it
  is fatal wherever it sits, and that was already true of the code before this
  round; only the docblock's "only `displaced` is fatal outside the section"
  line failed to carve it out. New test locks it: a clean, anchored Review
  plus a Log declaration that excuses nothing fails under the flag with 0
  failures and 1 stale, reproducing the gate's own fixture.

  **Low — the "commit before it merged" label was wrong.** `dl-72` merged as
  `7156967`, whose parent is `6f1f6bf`, not `20eb8ba`. Corrected in
  `citations.mjs`'s docblock and in this Log's own earlier entry; the
  measurement holds at the corrected sha too — `--displaced-since 6f1f6bf`
  still reports the same 2 displaced citations on `dl-72`'s record.

  **Low — the earlier Log's "kept struck… per `records.md`" claim was wrong
  in two ways**, both corrected in place in the entry above rather than here:
  the practice is `history.md`'s, since `records.md`'s own withdrawal rule is
  scoped to a claim inside a committed **gate record**, which a builder's Log
  is not; and only three small figures were actually struck through — the old
  method paragraph and its "Not 24" framing were replaced outright, which the
  entry now says plainly instead of describing both as one shape.

  **The owner's claim, measured**: that the flag stops flagging `repo-25`
  once this branch merges, since a ref taken after the merge already holds
  the grown file. Measured against this round's own commit `2eded7d` (this
  Log entry itself lands one commit later, so it is not citing its own sha):
  `node scripts/citations.mjs docs/work/repo-25-....md --displaced-since
2eded7d` reports 0 displaced, 8 unanchored (of 49 references) — clean. This
  is necessarily a same-tree comparison today — nothing has touched
  `scripts/citations.mjs` between `2eded7d` and the working tree it is read
  against — so it confirms the mechanism
  (`displaced` only fires across a gap in which the cited line's text
  changed, and a ref taken at or after the point the growth stopped has no
  such gap) rather than proving the claim survives an actual merge. What it
  does not cover: a future, unrelated edit to `scripts/citations.mjs` above
  line 443 would reopen the gap for anyone comparing against a ref that
  predates _that_ edit — repo-60 is the permanent fix, this is only why the
  interim gap does not grow on its own.

  Verification, every exit code read directly: `npm run check` exit 0; the
  two narrow specs 147/147 (up from 144, three new); `npx vitest run
--project repo` 489/489 (up from 486); `node scripts/citations-gate.mjs
--against origin/main` exit 0, 106 enforced, 0 failing, 0 raised; `node
scripts/citations-gate.mjs --displaced-since origin/main` **exit 1, exactly
  and only `repo-25` failing** (1 displaced), as expected under option (b);
  `node scripts/preflight.mjs --base origin/main` exit 0.
