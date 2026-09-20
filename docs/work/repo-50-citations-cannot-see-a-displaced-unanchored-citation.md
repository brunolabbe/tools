---
id: repo-50
tool: repo
title: citations.mjs cannot see an unanchored citation whose cited line changed since a base
kind: work-package
status: ready
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
  misses and why.

## Log

- 2026-09-20 — Filed from the third gate on `orchestrate-skill-sweep`, on the
  reviewer's recommendation. Not built on that branch: it is scoped to the skill
  pages, and this is a change to a script with tests.
