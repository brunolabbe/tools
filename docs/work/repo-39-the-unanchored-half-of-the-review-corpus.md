---
id: repo-39
tool: repo
title: 614 failing references still sit behind the citation gate's grandfather list
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# repo-39 — The unbuilt half of repo-37

**Packages:** `docs/work/`, `tools/*/docs/work/`, and `scripts/citations-gate.mjs`
(the `GRANDFATHERED` list only).

## Why

[repo-37](./repo-37-the-review-corpus-is-not-anchored.md) is the same job and it
was taken in one slice — the planner's records — on the reasoning its own Build
section gives: _"Not a single dispatch. Take it in reviewable slices."_ That
slice landed 14 of the planner's 17 records. **This ticket is the remainder**,
filed rather than left in repo-37's Log because a ticket that is `done` stops
being dispatchable and the debt has to keep a home.

Nothing here is a new discovery. What is new is repo-37's **method**, which is
the part the next builder cannot re-derive from repo-29's measurements, and it is
written down below rather than in a Log nobody will open.

### What is left, measured at `a3e3b08` on `repo-37-anchor-planner-review-corpus`

`node scripts/citations-gate.mjs`, exit code read without a pipe:

```
20 enforced, 0 failing; 45 grandfathered, holding 35 unresolvable, 43 moved,
530 unanchored, 6 indistinct.
```

| Slice                      | Records | References |
| -------------------------- | ------- | ---------- |
| `docs/work/repo-*`         | 22      | 231        |
| `tools/downloader/`        | 20      | 300        |
| `tools/planner/` remainder | 3       | 83         |
| **total**                  | **45**  | **614**    |

The planner remainder is exactly `pl-25-grounding-cache.md` (23),
`pl-28-valhalla-adapter.md` (38) and `pl-32-vite-config-test.md` (22) — the three
largest records in that tool, left because repo-37's slice was already the size
of a dispatch. **Re-measure before starting.** The denominator grows by one
record every time a ticket is gated, and repo-29's own filing figures were stale
within five days.

## Build

Same shape as repo-37, and its two prohibitions still bind — do not anchor a
stale coordinate to today's content, and do not touch a citation inside a quoted
reproduction. Take one tool, or one run of ids, per dispatch.

### What repo-37 learned about method

Nine of these are things it hit rather than things it expected. They are the
deliverable of that slice as much as the 126 references it repointed.

1. **Read the enclosing test's name, not the cited line.** By far the most common
   repair: a gate record cites the assertion line, the file has since grown, and
   the coordinate now lands on a comment or a blank. The **test name** is stable
   across a decade of edits, is almost always unique in its file, and is what the
   record's claim is actually about. Repointing to `test("…")` and anchoring on
   its name fixed the large majority of repo-37's 126.
2. **An anchor may not contain a double quote, and there is no escape.** The
   anchor is delimited by `"`, and `file.ts:1 "case \"snapshot\":"` is parsed as
   the anchor `case \` and reported `moved`. Pick a quote-free fragment, or cite
   a two-line range whose other line has one. This costs a retry every time it is
   forgotten.
3. **A record cannot cite itself under `--require-distinct-anchors`, ever.** The
   anchor text is written into the very file it points at, so it occurs at least
   twice — once on the citing line, once at the target — and `locateAnchor` does
   not exclude the citing line. Reproduced on `pl-5`, three times, with three
   different fragments. **The fix is to name the section in prose**, not to hunt
   for a fragment; there is none. Worth deciding, separately, whether the checker
   should skip the citing line — that is an open decision this ticket does not
   settle.
4. **A backticked bare number is a live citation, and it will bind to the wrong
   file.** `` `:41` `` inherits the last _qualified_ citation above it, which is
   frequently in the previous paragraph and about a different file. `pl-26`'s
   gate enumerated five `note` sites in `scripts/status.mjs` as
   `` `:41` `` … `` `:473` `` and every one of them resolved against
   `tools/planner/agent/src/grounding.ts`. This is repo-37's own repo-6 class,
   found twice more. **Qualify with the full path; never leave the colon form.**
5. **Some `:NNN` references are record lines, not file lines.** `pl-34`'s and
   `pl-26`'s findings quote where a defective citation _sat in a ticket_. Those
   are not citations at all and cannot be qualified into one, because a work
   record's line number moves every time the record grows. Rewrite them as prose
   naming the section.
6. **A comma list is one citation, not three.** `file.ts:195,209,227,335` parses
   as `:195` and the rest is invisible — so a record can look like it holds one
   failing reference while asserting four coordinates nobody has checked. Expand
   them. Same for `` `:105,:122` ``.
7. **A finding that was _fixed_ usually has no coordinate left.** The code it
   describes is gone by construction. Point at what stands there now and say so
   in the same sentence, in the form repo-37 used —
   _"(repo-37: the range this bullet named … no longer names anything)"_ — rather
   than at the replacement silently, which reads as if the finding were about the
   fix.
8. **`unchecked` and prose references do not fail this gate.** `FAILING` in
   `scripts/citations-gate.mjs` is `unanchored`, `moved`, `unresolvable` and the
   `indistinct` verdict. A citation demoted to prose therefore stops failing —
   which is right when it never named a file, and is **gaming the gate** when it
   did. repo-37 used it only for cases 5 and for `pl-34`'s quoted evidence, and
   said so at each site.
9. **`npm run format` reflows markdown, so re-run the checker after it.**
   repo-37 did, every time; the anchors survived, but the ordering is not
   optional and one reflow that split a citation across two lines would be
   silent.

### The tooling, which is worth rebuilding rather than re-deriving

repo-37 wrote a ~70-line `probe.mjs` against `citations.mjs`'s exports that
prints, per failing citation: the coordinate, the line it names **today**, the
line it named at the record's birth commit, and every line the birth text sits on
now. That last column is what turns a stale coordinate into a one-glance repoint.
It lived in the scratchpad and was deliberately not committed — it is a decision
aid, not a sweep, and repo-29's reverted sweep is the reason nothing here may
propose an anchor it has not read. The exports it needs are
`extractSections`/`selectSection`/`extractCitations`/`extractDeclarations`/
`candidateFiles`/`makeResolver`/`makeReader`/`checkCitations`/`applyDeclarations`,
and the two signatures that are easy to get wrong are
`makeResolver(tracked)` — one argument — and `checkCitations(citations, read, resolve)`.

Two more, both cheap and both earned:

- Substitute **inside the `## Review` span only**, refusing any pattern that does
  not occur exactly once there. `pl-20` carried the same broken citation in its
  Log and in its gate record, and a whole-file replace would have edited both.
- Take the baseline **in your own worktree**. A figure measured on the shared
  checkout is stale the moment a peer session commits.

### Two items repo-37 saw, deferred, and did not fix

Both are carried here because repo-37 went `done` and a `done` ticket is not a
home. Neither is a gate failure — the gate's scope is the `## Review` section and
neither of these is in one — so neither will ever go red on its own. That is the
argument for writing them down rather than trusting a later reader to re-find
them.

- **The same stale coordinates recur outside `## Review`, where nothing checks
  them.** Two confirmed instances at `fde65a9`, both in records whose gate
  sections repo-37 repaired:
  `tools/planner/docs/work/pl-34-locality-free-query-confident-wrong-place.md:353`
  still carries `api/src/runs/travel.ts:286-310`, which repo-37 repointed to
  `302-342` twenty lines earlier in the same file; and
  `tools/planner/docs/work/pl-20-intake-fixture-builders.md:140` still carries
  `intakes-store.test.ts:105,108`, repointed in that record's gate section to
  `105-109`. **A record whose `## Review` is repaired and whose Log is not now
  disagrees with itself**, which is worse than the uniform staleness it replaced,
  and it is invisible to `citations-gate.mjs` by design. Whether the fix is to
  widen `SCOPE.section` to `null` — repo-29's option C, which
  `scripts/citations-gate.mjs`'s own docblock names as the destination — or to
  repoint Log prose by hand as each record is touched, is an owner's call and not
  this ticket's to make silently. Repoint what you touch, at minimum.
- **`pl-20`'s first acceptance row does not render.**
  `tools/planner/docs/work/pl-20-intake-fixture-builders.md:94` puts an
  unescaped `|` inside a code span — a `grep` pattern of the form
  `"INSERT INTO (intakes | answers)"` — and a bare pipe splits a GFM table cell
  whether or not it sits in backticks. The row renders as one column of
  whitespace and one of run-together prose, so the proof for the ticket's first
  acceptance line is unreadable in every viewer. repo-37 left it alone because it
  is a rendering defect rather than a citation one and it did not want to rewrite
  a merged record's evidence on a citation ticket; it is a one-character escape
  for whoever is next in that file. **Check the other 44 records for the same
  shape while you are there** — nothing in the repo lints for it.

## Done when

1. `node scripts/citations-gate.mjs` exits 0 with an empty `GRANDFATHERED`, or
   the list holds only entries whose Log says why they cannot be repaired.
2. No citation is anchored on a fragment that occurs more than once in its
   target.
3. Every citation the work repointed still supports the claim the record makes
   about it, and anything that could not be given a distinctive anchor is listed
   in that record's Log.
4. `npm run check` and `node scripts/status.mjs --json` exit 0.

## Log

- **2026-09-08** — Filed by repo-37's builder as the unbuilt remainder of its own
  slice, at the moment that slice was gated rather than after it merged, so the
  debt never sits in a `done` ticket. Counts are this branch's own measurement at
  `a3e3b08`, not repo-29's and not repo-37's filing figures.

  **What repo-37 could not measure, said as unmeasured.** It never opened a
  `repo-*` or a downloader record, so nothing above is a claim about the shape of
  their citations — only about their count, which the gate reports. The nine
  method notes generalise from 17 planner records; the two classes most likely to
  behave differently elsewhere are the `repo-*` records, which cite scripts that
  churn far more than test files do, and `dl-15`, whose 57 references are the
  largest single entry in the list.
