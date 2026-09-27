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
