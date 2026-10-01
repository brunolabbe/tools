---
id: repo-87
tool: repo
title: citations.mjs silently drops citations into extension-less files
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-87 — citations.mjs silently drops citations into extension-less files

## Why

`scripts/citations.mjs` silently ignores (does not verify or count) citations
into files with no extension. This was discovered when a `Dockerfile` citation
— which has no `.` extension — was written but neither verified nor counted
in the report, allowing an incorrect citation to pass validation. Fixing the
citation would have required catching the omission first.

**Reproduction** (run from the repository root; `e79b04f` is an ancestor of
`main`, so the pins resolve). Three citations are written and one is counted:
the two into `tools/planner/Dockerfile`, one of them wrong, are neither verified
nor unchecked, so a wrong citation into an extension-less file passes as if it
were absent.

```
$ printf '%s\n' '# t' '' '## Review' '' \
    '- a `tools/planner/Dockerfile@e79b04f:40 "RUN npm ci"` b' \
    '- c `tools/planner/Dockerfile@e79b04f:40 "NOT ON THAT LINE"` d' \
    '- e `scripts/next-id.mjs@e79b04f:1 "NOT ON THAT LINE"` f' > /tmp/probe.md
$ node scripts/citations.mjs /tmp/probe.md --section Review --require-anchors
1 references in …/probe.md under "Review" (record lines 3-8), resolved against the working tree

  MOVED      scripts/next-id.mjs@e79b04f:1 "NOT ON THAT LINE"  (record line 7, inline)
             anchor "NOT ON THAT LINE" is not in 1, and not anywhere in scripts/next-id.mjs

0 verified, 1 moved, 0 unanchored, 0 unresolvable, 0 unchecked, 0 evidence — of 1 reference, 1 pinned, anchors required
exit 2 — 1 moved
$ git show e79b04f:tools/planner/Dockerfile | sed -n 40p
RUN npm ci
```

## Build

Update `scripts/citations.mjs` to handle files with no extension correctly.
Citations to extensionless files like `Dockerfile` should be:

1. Verified against their anchors if `--require-anchors` is set.
2. Counted in the verification report.
3. Listed in any failure output if the anchor is not found.

## Done when

- A citation into an extensionless file (e.g., `Dockerfile`) is verified
  against its anchor when `--require-anchors` is set.
- An incorrect citation into an extensionless file is reported as unanchored
  or unchecked, not silently dropped.
- `npm run check` and the citations tests pass.

## Log

- 2026-09-30 — Filed from repo-66 gate 1, reproduced at b658179. First
  reported when repo-66's `Dockerfile` citation was neither verified nor
  unchecked in citations.mjs's 18-of-18 count. Reproduction shows one
  correct and one incorrect Dockerfile citation, plus one script citation to a
  non-existent line; only the script citation is counted as MOVED, and the
  Dockerfile citations are silently dropped.
- 2026-10-01 — Built on origin/main at b7fb3fb. Three changes, all in
  `scripts/citations.mjs`: a new `NO_EXT_FILE` alternative in `INLINE`, the same
  alternative in both `PIN_SHAPED` patterns (so a malformed pin on such a file
  is reported, not dropped), and in `DECLARED_LOCATION` (so an evidence
  declaration can name one). The rule: **pathed** (a directory that starts with
  a letter, `_`, `.` or `@`, then a last segment that starts with a letter or a
  dot and has no `@`) or **bare from a closed set** (`Dockerfile`, `Makefile`,
  `LICENSE`, or a leading-dot name), never the tail of a longer token. A bare
  name off that list must be written with its directory — an open rule would
  read `Note:5` as a file, and an unresolvable one is fatal.
  - The brief's repro now counts three: `node scripts/citations.mjs
probe.md --section Review --require-anchors` printed `1 verified, 2 moved, 0
unanchored, 0 unresolvable, 0 unchecked, 0 evidence — of 3 references, 3
pinned`, exit 2, where it had printed `0 verified, 1 moved … of 1 reference`.
  - **The brief's second Done-when line is met more strongly than it asks**: a
    wrong citation into such a file is `MOVED` (exit 2), not "unanchored or
    unchecked" — it is anchored, so it is checked like any other.
  - **First draft was wrong on this corpus.** The pathed rule first took any
    word characters as a directory, and read `low:40/high:60` in pl-10's
    record as the file `40/high`. Found by diffing old against new extraction
    over every `.md` in the tree; fixed by requiring a non-digit first
    character in a directory. The diff is the measurement below.
  - **Corpus effect**, measured by extracting every one of the 280 `.md` files
    with the old and the new `extractCitations` (scratch script): 4,847
    citations now, **24 added, 0 removed**, in 14 files. Run through
    `citations.mjs --require-anchors` over each whole file: 4 `ok`, 2 `moved`, 2
    `unresolvable` (a bare `Dockerfile` matches four tracked files), 16
    `unanchored`. The 24 are the one `.gitignore` pair in repo-15 and repo-22
    and `Dockerfile` citations in repo-33, repo-66, repo-87, dl-27, dl-37, dl-39,
    dl-57, dl-72, pl-2, pl-31, pl-32 and `history.md`.
  - **What fails CI as a result** (`node scripts/citations-gate.mjs --against
origin/main`): `FAIL dl-37 — 9 verified, 1 unresolvable`, `FAIL pl-31 — 10
verified, 2 unchecked, 1 unanchored`, `WORSE pl-32 — 5 failing, its entry
allows 1`. These are the records' own citations, newly visible, not drift; none is
    repaired in this branch because how is an open decision (see the report).
    Dry-run in scratch, not committed: one anchor added in each of the three
    records, and dl-37's bare name given its directory, takes dl-37 to `10
verified … exit 0`, pl-31 to `11 verified … exit 0`, and pl-32 back to its
    entry's one unresolvable (`21 verified, 1 unresolvable`).
  - **For repo-84:** extraction now returns `file` for these as the written
    path, unresolved (`Dockerfile`, `tools/planner/Dockerfile`, `.gitignore`); a
    bare `Dockerfile` is then ambiguous in `makeResolver` (four tracked
    matches), a pathed one resolves exactly. A script that rewrites a citation
    must treat `.gitignore:48` and `Dockerfile:90-93` as citations, and
    cannot assume a `.` in the file. Inserting the new block moved every line
    of `scripts/citations.mjs` below `INLINE` down by 37, so the 8 moved citations
    into it, in repo-48 (2) and repo-60 (6), are among the 26 the gate
    reports in unchanged records, non-fatal by repo-47's rule.
  - Folded in: `roles/reviewer.md` carried a 2026-09-30 paragraph warning that
    this script drops such citations "until that is fixed"; rewritten in place
    to say it reads them, and that a bare name off the closed set is not read.
    Four lines for four, so no citation into that page moves.
  - Tests, appended at the end of `scripts/test/citations.test.ts`: seven. With
    the old `scripts/citations.mjs` swapped in, `npx vitest run
scripts/test/citations.test.ts` gave `5 failed | 114 passed (119)`; the two
    that pass on both are the negative guards (a ratio, a date and a URL are
    not paths; an extension path reads as before). With the new one, `119
passed (119)`.
