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
