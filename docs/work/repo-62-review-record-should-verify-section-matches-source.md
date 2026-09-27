---
id: repo-62
tool: repo
title: review-record.mjs should verify a committed section equals its source file
kind: fix
status: ready
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
  anchor, and its `scripts/review-record.mjs:434 "shell: false,"` starts on two
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
