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
- 2026-10-01 — **Decision, from the owner via the orchestrator, answered
  through AskUserQuestion the same day:** the three newly failing records are
  repaired in this branch, one pull request, under a hidden-type title. The
  options were one pull request with the repairs, two pull requests (a
  records-only `docs(repo)` repair first, this one a draft behind it), or
  grandfathering; the first was chosen. Superseding the previous entry's "none
  is repaired in this branch": six citations are now repaired, citation text
  only, no verdict, row or severity touched — dl-37 line 138 qualified to
  `tools/downloader/Dockerfile` with an anchor, pl-31 line 316 anchored, pl-32
  lines 146-148 anchored (four citations).
  - **Why not `fix`:** preflight's title check fails a changelog-reaching type
    when every `tools/` path in the diff is markdown, and release-please would
    cut downloader and planner versions over a records repair. `scripts/`
    belongs to no release component, so a hidden type loses no changelog line.
  - **Why `chore` and not `ci`:** both are `hidden: true` in
    `release-please-config.json`. `ci` names the pipeline and its workflow
    files; this is a script's parsing rule plus the records it newly reaches,
    which `chore` says without claiming CI changed. The title is `chore(repo):
read citations into files with no extension (repo-87)`.
  - dl-57's `moved` Dockerfile citation and the other non-fatal moves in
    unchanged records are left alone, as instructed.
- 2026-10-01 — Gate 1 (Opus) returned FAIL at `ea901ee` on one high; the round
  below was answered by the owner through AskUserQuestion the same day.
  - **High, reproduced and fixed.** dl-37's record line 138 quotes dl-39's Log
    about an `INSTALL_YTDLP=false` citation, whose lines 90-93 at the commit the
    reviewer meant begin "Optional, and off by default" (`git show
1aae8c8:tools/downloader/Dockerfile | sed -n 90,93p`), while at the base they begin "yt-dlp,
    installed by default" — the opposite. My anchor had been true of the base
    and false of the reviewer's meaning. Owner chose the pin: the citation
    now reads `tools/downloader/Dockerfile@1aae8c8:90-93 "Optional, and off by
default"`; `node scripts/citations.mjs <dl-37> --section Review
--require-anchors --require-distinct-anchors` gives `10 verified … 4 pinned`,
    exit 0. `1aae8c8` is an ancestor of the base, so the pin outlives a squash.
  - **Med, reproduced and fixed as the owner chose (keep the open rule, fail
    loud).** `extractCitations("see and/or:5")`, the unquoted sentence, returns
    the file `and/or`. (Corrected 2026-10-02, gate 3: a draft of this entry said
    the same of the quoted spelling, and I measured it returns `[]`.) The
    docblock no longer claims the lexical guards keep prose out; it says the
    rule is open, reads prose, and why that beats a closed list. The resolver's
    `no tracked file matches` now ends "if this is prose and not a file, quote
    it in a double-backtick span, which is not read" for a file with no
    extension; an extension-bearing miss keeps the short message. After this,
    any such shape written in a gate section about this checker must sit in
    double backticks.
  - **Low 3, reproduced and fixed (docblock).** `40/tools/x/Dockerfile:9` reads
    as `tools/x/Dockerfile` — there is no left boundary. The false sentence is
    gone and the truncation is stated: the resolver's suffix match still finds
    the file. A boundary would instead drop a real path whose first directory
    starts with a digit, silently, so I did not add one.
  - **Low 4: dl-57 fixed, repo-48 and repo-60 declined.** dl-57's one
    unpinned Dockerfile citation is now pinned to `eb903a3`, where line 152 is
    `CMD ["node", "tools/downloader/api/dist/main.js"]` (`git show
eb903a3:tools/downloader/Dockerfile | sed -n 152p`) and which is an ancestor of the
    base; no shorthand follows it on that line, so no inheritance changes. I
    could also have pinned the eight into `scripts/citations.mjs` in repo-48 (2)
    and repo-60 (6) and did not: they were never in the instruction, they are
    non-fatal by repo-47's rule, a pin there would change what the shorthands
    after it inherit in two merged records, and `repo-84` exists to re-resolve
    exactly these.
  - **Low 5, fixed.** `roles/reviewer.md` now says a bare `Dockerfile` reads
    but always fails as ambiguous, and that prose reads too and is quoted in
    double backticks. Same four lines. (`Makefile` and `LICENSE` stay in the
    closed set; `LICENSE` is tracked once and resolves, `Makefile` is tracked
    nowhere and would fail loudly if cited.)
  - Two tests appended at the end of `scripts/test/citations.test.ts`. Not run
    red against the previous script.
- 2026-10-02 — Gate 2 (at `df818f8`) returned CONCERNS; this round answers it.
  - **Med, reproduced: the escape the previous round taught did not survive
    `npm run format`.** A probe with a plain double-backtick span, a nested
    form (a backticked token inside double backticks) and the nested form
    wrapped once more, run through `npx oxfmt` and then `extractCitations`:
    before formatting nothing was read; after, the plain span had become single
    backticks and was read as the file `and/or`, while the nested form stayed
    put and stayed unread. The advice now names the nested form in all four
    places (the resolver message, the docblock above `NO_EXT_PATH`, the test,
    `roles/reviewer.md`) and says plain double backticks do not survive. The
    test now formats a file with the real `oxfmt` (the package's own entry
    under this node) and checks it, rather than asserting on unformatted text.
  - **Low, reproduced and fixed: the hint's test was the wrong one, and the
    pathed rule cut a real path.** `tools/9x/Dockerfile` was read as
    `x/Dockerfile` — the rule required a directory to start with a letter, so
    the match restarted inside the segment. The rule is now "a directory is
    not all digits", which still rejects a ratio, a date and pl-10's
    `low:40/high:60`, reads `tools/9x/Dockerfile` and `v2/sub/Dockerfile`
    whole, and can only be cut on a `/` (an all-digit directory cannot be
    entered part-way). Re-measured over every `.md` in the tree: 0 removed, and
    the added set is the previous 24 plus this branch's own prose about the
    checker, with no new false positive in an older record. The hint now shows
    when the token is one the older rules would not have read (`OLDER_FILE`),
    not when it lacks an extension: a dotfile such as `.env` gets it, and
    `gone.txt` under a directory does not.
  - **Low, reproduced and fixed: the old "no left boundary" test could not
    fail.** Its resolver half resolved an exact name. It now resolves the
    tail against a tracked path with the digit directory in front, which goes
    through the suffix match, and checks the whole-read cases. The
    `df818f8` script fails two of the three tests of this round (hint,
    digit directories); the formatter test passes on both by design, since it
    measures `oxfmt` and not this script.
  - **Docblock sentence, "true only when the cut lands on a slash":** the
    sentence now says the cut always lands on one, and why.
  - Edited in this round: `scripts/citations.mjs`, its test file,
    `roles/reviewer.md` and this ticket's own Log. No other ticket file, and
    nothing inside any `## Review` section.
- 2026-10-02 — Gate 3 (at `c054f59`) returned two lows; this round answers them.
  - **Low, reproduced and written down (docblock and test title).** An
    all-digit directory in the middle of a path is not read whole: one form is
    dropped outright and another is cut to the tail after the digit directory,
    both measured with `extractCitations` at the head. No tracked path has an
    all-digit directory (`git ls-files`, 0 of 1001), so the docblock beside the
    leading-directory sentence now states it as a limit, not a guard, the test
    title no longer claims "nothing else is", and the test pins both results.
    The extraction rule is unchanged, and `scripts/citations.mjs` keeps its 2449
    lines (15 lines reworded, none added).
  - **Low, reproduced and corrected.** The earlier entry of this Log, the one
    headed "Med, reproduced and fixed as the owner chose", had been reworded to
    say the quoted spelling returns the file; it returns `[]`. It now says what
    the unquoted sentence returns, `extractCitations("see and/or:5")`, run
    again this round, with the correction noted in place.
