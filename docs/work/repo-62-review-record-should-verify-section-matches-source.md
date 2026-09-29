---
id: repo-62
tool: repo
title: review-record.mjs should verify a committed section equals its source file
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-62 — review-record.mjs should verify a committed section equals its source file

## Why

When a lander (builder or fixer) commits a gate record using `review-record.mjs`,
the section is read from a source file handed by the orchestrator and inserted
into the ticket. No verification occurs that what gets committed matches what was
in the source file. This allows accidental (or deliberate) modifications to slip
through, changing a reviewer's words and verdicts without notice.

Two incidents on 2026-09-26:

- dl-69: Gate 2's three low bullets were reworded into the lander's own dispositions
  (committed at `ebd9649`, repaired at `55c40b3`)
- repo-50: Gate 3's first low bullet was re-anchored onto the corrected text
  (committed at `d0389bb`, repaired at `e6fa633`)

Each required a reviewer wake and a repair fixer.

## Build

Add a check to `scripts/review-record.mjs` that, after committing a section,
compares the committed text with the source file (ignoring table padding). If
they differ in any way other than trailing whitespace in table cells, the
commit should fail loudly with a clear error message naming the differences.

The reproduction cases are on the pushed branches of open PRs #289 and #291.
Verify the fix by reproducing the scenario: a lander hands a modified section
file and attempts to land it; the tool should reject the commit before it
reaches git.

## Done when

- `review-record.mjs` reads the source section file before commit
- After the commit lands, the tool compares the committed text against the
  source file
- Differences beyond table padding (trailing whitespace in cells) cause a
  clear, non-zero exit with a message naming the lines that differ
- Existing tests pass and new test covers the detection

## Review

**Gate: CONCERNS** -- 2026-09-27 -- `c87153d...162a166` (base confirmed exact match to dispatch; `origin/main` had not moved as of this review) -- code-review at medium, plus a dedicated defect-hunt against the new comparison/normalisation code specifically (per dispatch)

_Coordinates below are re-resolved against `1848baa` (round 2), not `162a166`, per the rule that a citation must resolve at the tip it lands on. Round 2 removed the gateNumbersIn helper and the own.has check the med below originally cited -- named by description only now, no coordinate -- and inserted a multi-line call into an existing test, moving two review-record.test.ts citations down by three lines. Every verdict below is unchanged from what was found at 162a166; see Gate 2 for what round 2 did about each._

| Done when                                                                                | Proof                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| review-record.mjs reads the source section file before commit                            | `scripts/review-record.mjs@2ffb72a:356 "const sectionText = fs.readFileSync(sectionFileAbsolutePath"` -- unchanged pre-existing read, exercised by every splice test |
| After the commit lands, the tool compares the committed text against the source file     | `scripts/test/review-record.test.ts:800 "const clean = runCli(dir,"` -- commits, then verifies                                                                       |
| Differences beyond table padding cause a clear, non-zero exit naming the differing lines | `scripts/test/review-record.test.ts:819 "expect(caught.status).toBe(1);"`, and reproduced independently against the real dl-69/repo-50 incidents                     |
| Existing tests pass and new test covers the detection                                    | verified at 162a166 -- 33 of 33 (27 at c87153d, 6 added, all appended after the round-1 tests)                                                                       |

- **med** -- the function then named gateNumbersIn, and the own.has check its caller then read, both removed in round 2 -- no coordinate names them any more. Together they extracted every level-3 heading whose title merely started with "Gate N", anywhere in the section file including inside a gate body, and let the boundary search skip a real "### Gate N" heading in the ticket once N was in that set -- so an earlier gate block ran past it and swallowed the real, later gate content. Reproduced directly at 162a166: a synthetic ticket with "### Gate 1" (whose faithful, unedited body legitimately carries a sub-heading titled "Gate 2 style findings quoted from elsewhere", the shape the tool own design already anticipates a gate body carrying) followed by a real "### Gate 2". `locateGateBlock(markdown, null, sectionText)` returned `{start:1, end:12}`, and `compareRecord` on that block reported `matches: false` -- a **false FAIL on a completely faithful, unedited gate-1 record**, purely because of coincidental heading text, through the exact --verify check this ticket own diff wires into orchestrate-tickets step 9 as a required exit-0 ship gate. Direction is one-way -- the block can only grow, never shrink, so this can only produce a stricter false alarm, never a false PASS that hides real tampering -- which mitigates severity, hence med rather than high. No test at 162a166 exercised a heading-title collision.
- **low** -- differingLines no-newline-marker skip (`scripts/review-record.mjs@2ffb72a:714 "if (!inHunk || line.startsWith"`) was unreachable through any real caller at 162a166: buildDiff always appends a trailing newline to both compared files (`scripts/review-record.mjs@2ffb72a:303 "fs.writeFileSync(before,"`, and the line after it for after), so neither side of any diff differingLines was fed could ever lack one. Confirmed the skip logic was correct if reached, via a direct call with a synthetic diff carrying that marker -- but across every mismatch produced in that review, the marker never appeared. Dead code at 162a166, not a functional defect.
- **findings** -- code-review at medium, run by the reviewer, returned 2; 2 carried, 0 dropped.
- NFR: security check -- every spawnSync/execFileSync call in the diff uses an argument array with no shell: true (`scripts/review-record.mjs@2ffb72a:431 "const fmt = spawnSync(process.execPath,"` and `scripts/review-record.mjs@2ffb72a:649 "const formatter = spawnSync(process.execPath,"`), and --rev explicitly rejects a value starting with a dash before it reaches git show, closing an option-injection path -- performance n/a -- CLI tool, no hot path -- reliability -- the med above -- maintainability -- the low above.

### Gate 2

**Gate: CONCERNS** -- 2026-09-27 -- git diff 162a166..1848baa -- re-gate of gate 1 two findings and the lines this round touched, nothing else re-swept

| Gate 1 finding                                                                       | Verdict at 1848baa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| med -- gateNumbersIn/own.has let a heading-title collision swallow a real later gate | fixed, and wider than reported: the round 2 Log shows the same collision also mislocated a later gate own start, which had not been separately tested at gate 1. Replaced with position-only counting -- `scripts/review-record.mjs@2ffb72a:629 "const ownHeadings = extractSections(sectionText)"` counts the section file own level-3 headings, and `scripts/review-record.mjs@2ffb72a:630 "const next = inReview.filter"` skips exactly that many headings from start rather than matching any title. Reproduced the gate-1 script again, unchanged, against 1848baa: locateGateBlock now returns {start:1, end:8} (not {start:1, end:12}) and compareRecord reports matches: true -- the same faithful gate-1 record that false-failed at 162a166 now verifies clean. Also independently reproduced the gate-2-own-start half of the Log claim: at 162a166, verifying gate 2 with the same fixture located {start:5, end:12} (the decoy), not the real heading at line 9; at 1848baa it locates {start:9, end:12} (the real one). Locked by a new test, `scripts/test/review-record.test.ts:894 "expect(linesOf(ticket, second)).toBe("` |
| low -- differingLines no-newline skip was dead code at 162a166                       | kept by design, not removed -- a comment now states why (`scripts/review-record.mjs@2ffb72a:712 "never emits it today, since it ends both sides with a"`: the skip is defensive for any future caller of the exported differingLines, not only buildDiff current one), and a dedicated test now locks the exact synthetic shape built to demonstrate it: `scripts/test/review-record.test.ts:915 "expect(differingLines(diff, 10)).toEqual({"`. The branch is still unreachable through buildDiff today -- the comment says so itself -- but that is now a documented, tested design choice rather than an unexplained, unlocked one, which is what a low finding of this kind asks for                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

- **low** -- the fix own new logic has a narrower version of the same class of bug it fixes. locateGateBlock --gate n branch picks the heading whose title exactly equals the section file own first line, falling back to the first title-prefix match when none is exact (`scripts/review-record.mjs@2ffb72a:622 "const heading = candidates.find"`, fed by `scripts/review-record.mjs@2ffb72a:618 "const firstTitle = /^###[ \t]"`). When an earlier gate body quotes a later gate canonical heading verbatim -- ### Gate 2, character for character, not merely prefixed -- and that quote sits before the real ### Gate 2, find() returns the first exact match in document order, which is the quote, not the real gate. Reproduced directly against 1848baa: a ticket with ### Gate 1 then one. then ### Gate 2 (the verbatim quote, body quoted verbatim inside gate 1 own body.) then ### Gate 2 (real, body two.) then ## Log. locateGateBlock(markdown, 2, section) returns {start:7, end:10} -- the quoted decoy inside gate 1, not the real gate 2 at line 11 -- and compareRecord reports matches: false with a diff substituting the decoy body for two.. Severity stays low: the direction is still a false FAIL, never a silent false PASS (the decoy body would have to coincidentally equal the real gate faithful content, which no natural incident produces), and reaching this ticket shape through the tool own splice CLI is already blocked by planInsertion pre-existing duplicate-heading refusal (unchanged this round, not re-tested). Not covered by this round new test, which only quotes a later gate title as a prefix, never verbatim.
- **findings** -- the lines this round touched returned 1 (the low above); 1 carried, 0 dropped. Both gate 1 verdicts above are re-gate verdicts on carried findings, not new findings.
- Verified against 1848baa: npx vitest run scripts/test/review-record.test.ts -> 35 of 35 (33 at 162a166, 2 new); node scripts/citations-gate.mjs --against origin/main exit 0, 112 enforced, 0 failing.
- NFR: as gate 1; no new spawn, no new URL or header handling in this round.

## Log

- 2026-09-27: Filed from account item 11 of the 2026-09-26 batch close-out.
  This is the mechanical guard requested by item 2 of the skill's findings
  (fixer.md edit). Reproductions are visible on pushed branches.

- 2026-09-27 — built (builder, Opus 5.5), on `origin/main` at `c87153d`.

  **What the brief had wrong.**
  1. _"After committing a section"_: `review-record.mjs` never commits. It
     splices, formats and checks; the lander commits. An edit made to the
     ticket after the splice, or to the lander's own copy of the section file
     before it, is invisible to anything the splice can check — the splice
     inserts the file verbatim. So "reject the commit before it reaches git"
     cannot catch either 2026-09-26 incident, and the Done-when's "after the
     commit lands, compare" is the check that can. Built as a mode,
     `review-record.mjs --verify <ticket> <section-file> [--gate <n>] [--rev <rev>]`,
     which reads the ticket at `<rev>` (default `HEAD`) and compares the gate's
     block with the file. It binds only when run against **the file the gate
     wrote**, which the orchestrator holds and the lander may not have kept
     intact, so `orchestrate-tickets` step 9 names it as a ship check beside
     preflight, and `review-ticket` step 8 names it for the lander.
  2. _"Ignoring table padding"_ is too narrow: `oxfmt` also rewrites `*`
     bullets to `-`, `*x*` to `_x_`, `__x__` to `**x**`, `***` to `---` and
     `1)` to `1.` (measured with `npx oxfmt` on a scratch file), so a
     byte-for-byte rule fails a record landed verbatim. The comparison accepts
     the block when, table padding collapsed, it equals the raw file **or**
     `oxfmt`'s rendering of it, and diffs against the rendering, so a mismatch
     shows only what the formatter did not do.
  3. _"On the pushed branches of open PRs #289 and #291"_: both merged, and
     both branches are deleted on origin (`git ls-remote --heads origin
dl-69-provoke-shadow-dom repo-50-citations-displaced` prints nothing). The
     commits survive under the PR refs: `refs/pull/289/head` is `55c40b3` and
     `refs/pull/291/head` is `e6fa633`, the two repairs, whose parents are the
     incident commits. The gates' original section files are gone; the only
     copy of each reviewer's words is the repaired record, which also carries
     the reviewer's amendment paragraph, so each reproduction's diff shows that
     paragraph too.

  **Reproduction**, each section file cut from the repaired commit
  (`dl-69` lines 234–257 at `55c40b3`; `repo-50` lines 135–158 at `e6fa633`):
  - `node scripts/review-record.mjs --verify <dl-69 ticket> dl69-gate2.md --gate 2 --rev ebd9649`
    → exit 1, naming ticket lines 249, 250 and 251, the three reworded lows.
    `--rev 55c40b3` → exit 0, "lines 234-257".
  - `node scripts/review-record.mjs --verify <repo-50 ticket> repo50-gate3.md --gate 3 --rev d0389bb`
    → exit 1, naming ticket line 150, the first new low. `--rev e6fa633` → exit 0.
  - At `HEAD`, repo-50's gate 1 (as `## Review`), gate 2 and gate 3, each
    against its own cut file → exit 0 three times, so an earlier gate's block
    ends at the next gate heading rather than running into it.

  **Also in the splice.** Step 5 runs the same comparison on the block just
  spliced and restores from `HEAD` on a mismatch. It cannot see a lander's
  edit; it catches the script's own locating going wrong, reproduced with a
  section ending in an unclosed fence, which swallows `## Log` into the Review
  block. The splice's success output now prints the `--verify` command, before
  the disclosure note so the note stays pasteable.

  **Placement.** Every addition to `review-record.mjs` is below `main`, and the
  tests are at the end of `review-record.test.ts` with their own `import`,
  because repo-55's merged record cites both files by line: `git diff origin/main
-U0` shows no hunk above line 478 of the script except three in-place lines in
  `buildDiff`, and none above line 638 of the spec.

  **Folded in.** `buildDiff` ran `git diff --no-index` on absolute temp paths,
  so the headers of the disclosure note read
  `section-file/tmp/review-record-diff-XXXX/section-file`; it now runs in the
  temp directory with empty prefixes and reads `--- section-file`. Same line
  count, and it is the output this ticket turns into an error message.

  **Appending is not enough on its own.** The first preflight failed the
  citations check, repo-55 "4 indistinct": two new helpers repeated
  `const sections = extractSections(markdown);` and
  `const fmt = spawnSync(process.execPath, [OXFMT`, the anchors of two of that
  record's citations, so each anchor started on two lines. Renamed to
  `headings` and `formatter`; `node scripts/citations-gate.mjs --against
origin/main` → exit 0, 112 enforced, 0 failing.

  **Tests.** `npx vitest run scripts/test/review-record.test.ts` → 33 of 33
  (27 before, 6 new). Red runs by mutation, each reverted: the comparison
  always matching → 4 of 33 fail; byte comparison without the formatter → 2
  fail (the formatter test and the CLI verify test); the gate block running to
  the end of `## Review` → 2 fail; step 5 disabled → 1 fails (the unclosed
  fence); `--verify` stat-ing a ticket missing from disk → 1 fails with ENOENT.

- 2026-09-27 — gate 1 round (builder, Opus 5.5), from `162a166`. The owner
  kept the design as built and both skill-page lines on this branch.

  **Gate 1's record is not in this ticket.** `node scripts/review-record.mjs
<this ticket> review-gate1.md` at `162a166` exited 20 and restored the ticket:
  "1 unanchored, 1 anchor(s) not distinct" — the NFR bullet's `:653` carries no
  anchor, and its `scripts/review-record.mjs@2ffb72a:434 "shell: false,"` starts on two
  lines, the second being this branch's own `formatMarkdown`. Neither is a
  coordinate a lander may repair, so the section goes back to its reviewer. The
  fix below also deletes the lines the med cites at 577 and 630 and moves the
  low's 712.

  **med, fixed — and wider than reported.** Reproduced with a ticket whose gate
  1 body carries `### Gate 2 style findings quoted from elsewhere`, followed by
  a real `### Gate 2` and `### Gate 3`, each checked against its own file on
  `162a166`'s `locateGateBlock` and `compareRecord`:
  `gate 1 (## Review): block 3-16, matches=false`,
  `gate 2: block 9-16, matches=false`, `gate 3: block 17-20, matches=true`.
  Gate 2 fails too: its _start_ was the first heading beginning `Gate 2`, which
  is the quoted one inside gate 1. Both ends are fixed. The end now counts the
  section file's own `###` headings, not what their titles say, and the start
  is the heading whose title is the file's first line. On the fix, the same
  script gives `3-12`, `13-16` and `17-20`, all `matches=true`. The new test at
  the end of the spec fails on `162a166`'s script ("not to contain 'two.'",
  1 of 35), and fails again with only the start reverted to the first
  `Gate 2` heading ("expected '### Gate 2 style findings quoted from…' to be
  '### Gate 2\n\ntwo.\n'", 1 of 35). One round-1 test passed `"### Gate 2\n"` as
  gate 2's file where the ticket's gate 2 has a second heading; counting
  rightly bounds that before the heading, so the test now passes the file the
  ticket implies. The incident reproductions still hold: `ebd9649` and
  `d0389bb` exit 1, `55c40b3` and `e6fa633` exit 0, and repo-50's gates 1 and
  2 at `HEAD` exit 0.

  **low, kept.** The `\ No newline at end of file` skip in `differingLines` is
  unreachable through `buildDiff` today, as the gate says. It stays because
  `differingLines` is exported and parses git's unified format, of which that
  marker is part. Without the skip, a diff that carries it counts the marker as
  a context line and shifts every line number after it. A comment now says
  so, and a test at the end of the spec pins the mapping with the marker in
  both sides.

- 2026-09-27 — landed (builder, Opus 5.5). Gates 1 and 2 committed with
  `review-record.mjs` from the reviewer's file, split byte for byte at its line
  18 (`9ca04bc`, `f9eb32d`); each normalised disclosure diff was empty — nothing
  differs. The owner chose to land with gate 2's low (a verbatim-quoted
  `### Gate <n>` heading ahead of the real one still starts `--gate <n>` at the
  quote, a false FAIL) recorded rather than fixed in a third round.
