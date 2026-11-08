---
id: lg-104
tool: ledger
title: A worksheet part SheetJS still parses once per sheet past lg-96's check
kind: fix
status: needs-decision
milestone: null
depends_on: [lg-96]
difficulty: hard
---

# lg-104 — A worksheet part SheetJS still parses once per sheet past lg-96's check

## Why

[lg-96](./lg-96-a-far-stored-cell-costs-memory-by-its-address.md) bounds `readSheets`
(`tools/ledger/api/src/xlsx.ts`). Its shared-part check refuses a workbook in which
two `<sheet>` entries name one worksheet part, before SheetJS parses it. Gate 3 of
lg-96 (Opus 5.5, 2026-11-08, at `3b8e95d4`, FAIL, F2) found two ways SheetJS still
parses one worksheet-level part once per sheet, past that check. Both files are under
the 4 MiB inflated bound, and both pass every bound lg-96 sets.

The cost is memory. A crafted upload of under 4 MiB inflated makes `readSheets` build
or parse about 350 to 380 MB, against the 512 MB the ledger's production container
gets (`compose.ledger.prod.yaml`, `memory: 512m`). Gate 3 measured +310.3 to +367.5 MB;
the re-run for this ticket measured +313.3 to +379.0 MB (table below).

The owner chose on 2026-11-08 to land lg-96 and file these two as this ticket. lg-96's
own text names lg-104 at its landing head `1aabcb4a`, not at the gated `3b8e95d4`.

The landing head's `workbook-parts.ts` header (line 13 at `1aabcb4a`) says "Distinct
parts cannot multiply the parse: `MAX_WORKBOOK_INFLATED_BYTES` is a total over every
entry of the file … so the parts together never inflate to more than the bound."
`git grep -n "cannot multiply"` on `1aabcb4a` finds it. Both shapes below contradict
it, and Build step 4 rewords it.

## Reproduction

Both shapes were run at `3b8e95d4` on a detached worktree
(`/workspaces/tools/.claude/worktrees/builder-lg-104-1`), farmed (`worktree-farm.sh`,
exit 0) and built (`npm run build`, exit 0). Each probe ran once, one process at a
time; every measured process ran under `node --max-old-space-size=900`. The generators
(`localname.mts`, `comments.mts`) are small and ran uncapped.

The probes are not in the repo. They are the gate's scratch files under
`/tmp/claude-1000/-workspaces-tools/5216e6bd-cee7-4d2a-9586-dbefdd171526/scratchpad/lg-96/gate-3/`
(`localname.mts`, `localname.sh`, `inspect.mts`, `comments.mts`, `comments.sh`), and
they call gate 2's `multiplier.mts` in `…/lg-96/gate-2/`. The `.sh` scripts export a
`TMPDIR` under `/tmp/claude-1000/lg96g3`. A builder who takes the answer needs these
files committed or re-written; that is not decided here.

Every reading is in MB of RSS growth over the process baseline, and "peak" is the
process peak. The "gate 3" column is gate 3's own figure for the same file.

### Shape 1: a zip entry whose local-header name differs from its central name

SheetJS's CFB names each zip entry from its **local** header. The ledger's copy
(`workbookEntries` and `compressedOf` in `tools/ledger/api/src/workbook-zip.ts`) names
it from the **central directory** and never compares the two. The decoy file has 14
sheet targets whose first lookup, in the copy, is a distinct entry. Each of those
entries has a local name SheetJS never asks for, so SheetJS falls through to the
target itself, and all 14 targets name one 1,400 × 100 numeric part (3.84 MB inflated).
The control is the same file with every local name equal to its central name.

Commands, from the worktree root, outputs under `build/probe-localname/`:

```
bash <gate-3>/localname.sh /workspaces/tools/.claude/worktrees/builder-lg-104-1 <out> 2 14
node --max-old-space-size=900 --import tsx <gate-3>/inspect.mts <tree> <out>/files/localname-decoy-14.xlsx
node --max-old-space-size=900 --import tsx <gate-3>/inspect.mts <tree> <out>/files/localname-control-14.xlsx
```

`localname.sh` exit 0; both `inspect.mts` runs exit 0. The 14-sheet decoy is 294,618 B,
3,836,319 B inflated, 18 entries. Its `sheetPartsOf` is `[4,5,…,17]`, 14 distinct
indices; SheetJS's full read gives 14 sheets, all 14 the big part. The control's
`sheetPartsOf` is the same, and its full read gives 1 of 14 the big part.

| File                                                | Reading (this re-run)                                                                | Gate 3's figure        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `localname-decoy-2`, reader                         | 2 sheets, 280,000 cells; +87.3 MB (peak 182.1)                                       | +81.0 MB               |
| `localname-control-2`, reader                       | 2 sheets, 140,001 cells; +59.7 MB (peak 147.7)                                       | not run                |
| **`localname-decoy-14`, reader**                    | 14 sheets, 1,960,000 cells; **+379.0 MB (peak 462.0)**, 11.6 s                       | +367.5 MB (peak 448.9) |
| **`localname-control-14`, reader** (honest control) | 14 sheets, 140,013 cells; +60.0 MB (peak 145.1), 1.2 s                               | +63.1 MB (peak 146.7)  |
| **`localname-decoy-14`, route**                     | `WORKBOOK_TOO_LARGE {"bound":"cells"}`, only after the build; +350.1 MB (peak 464.8) | +349.1 MB              |

The route refuses the decoy as `cells` only after the build, so its figure is the
build's cost. The command path calls only `readSheets`, so the reader row is the one
the command pays. Forty such sheets would cost about forty parses (about 1 GB by
extrapolation); that was not run.

### Shape 2: one comments part named by 14 sheets' `.rels`

Each of 14 sheets has a worksheet part of its own. Each sheet's `.rels` names one
comments part of 50,000 comments (3.2 MB inflated). SheetJS's `safe_parse_sheet` reads
each sheet's comments relationship and parses the part once per sheet. The copy looks
at none of this, and every bound passes. The control is 14 comments parts of 3,571
comments each, the same total inflated size, so nothing is shared.

Commands, outputs under `build/probe-comments/`:

```
bash <gate-3>/comments.sh /workspaces/tools/.claude/worktrees/builder-lg-104-1 <out> 50000 1 14
node --max-old-space-size=900 --expose-gc --import tsx <gate-2>/multiplier.mts <tree> run <out>/files/comments-comments-14-50000.xlsx <out> route
```

`comments.sh` exit 0; the route run exit 0. The 14-sheet comments file is 120,025 B,
3,238,478 B inflated, 33 entries.

| File                                                          | Reading (this re-run)                                                                                          | Gate 3's figure                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `comments-comments-1`, reader (one sheet names it)            | 1 sheet, 1 cell; +44.5 MB (peak 127.0)                                                                         | +41.7 MB (peak 140.5)                       |
| **`comments-comments-14`, reader**                            | 14 sheets, 14 cells; **+327.1 MB (peak 412.0)**, 4.5 s                                                         | +352.5 MB (peak 435.4)                      |
| **`comments-distinct-14`, reader** (honest control: 14 parts) | 14 sheets, 14 cells; +54.0 MB (peak 136.2)                                                                     | +54.6 MB (peak 138.8)                       |
| **`comments-comments-14`, route**                             | `LAYOUT_UNREADABLE`, every bound passed (the route's model step refuses the fake file); +313.3 MB (peak 442.7) | `LAYOUT_UNREADABLE`; +310.3 MB (peak 440.6) |

The VML, threaded-comment, drawing and chart parts are read the same way by SheetJS
(`parse_vml`, `parse_drawing`, `parse_chart`). Gate 3 did not build them and nor did
this re-run; they are unmeasured.

### Observation, not a recommendation

Each of lg-96's three gates found a point where the copy and SheetJS disagree about
the parts, or where SheetJS parses what the copy charges once. They differ in kind:

- **Gate 1** (`e2e6a6cb`), F2: the cap's stated worst case does not hold. SheetJS's
  parse of a shared part runs before `placesOf` charges anything. This is a cost
  finding, not a disagreement about which part a sheet names.
- **Gate 2** (`c2e36eb7`), F2 and N1: seven spellings (an entity and `_x0031_` in a
  target, a `>` inside a quoted name, an empty `r:id` beside `strRelID`, a sheet with
  no id beside `Id="undefined"`, a tab after a tag name) that SheetJS reads as two sheets
  over one part and `sharedSheetPart` answers `undefined` for; and, in the other
  direction, a tab after `<Relationship`.
- **Gate 3** (`3b8e95d4`), F2: the local-header name against the central name (shape 1).
  Shape 2 is not a disagreement about identity: SheetJS parses a shared comments part
  per sheet, and the copy does not inspect comments.

Each further rule added to the copy has so far been followed by a new difference.

## Decision — open

**Who decides:** the owner. One question is open. Gate 3 (Opus 5.5) recommended option
1; that recommendation is gate 3's, recorded here as gate 3's. This ticket does not add
one.

**What do the two shapes do under the shared-part check?**

1. **Refuse both shapes before the parse (gate 3's recommendation).** Refuse a zip
   whose local-header name differs from the central name of an entry the copy reads
   (in `compressedOf` or `workbookEntries`), and refuse a workbook in which two sheets'
   `.rels` (comments, VML, drawing, chart) name one part. Costs: a second copy of
   SheetJS's rules (`parse_rels` and `resolve_path`), and the observation above says a
   copy has been followed by a new difference each time. The refusal is `WORKBOOK_NOT_XLSX`,
   as lg-96's answer 11 has it for the shared part. Per `workbook-parts.ts`'s own header,
   no workbook Excel saves has either shape.
2. **Parse one sheet per `XLSX.read` (`sheets: i`).** Each shared part is parsed and
   released per sheet, so one part's parse is held at a time. Costs: unmeasured. Time
   grows with the sheet count, about N full inflates for N sheets (up to the sheet
   bound). Built grids still accumulate across sheets, so memory for the built result is
   not closed by this.
3. **Accept and document.** Keep the code. Reword the texts that promise the bound
   (`workbook-parts.ts`'s header, `xlsx.ts`'s `refuseUnlessEachSheetIsItsOwn` comment,
   `workbook-bounds.ts`'s +129 MB figure) to the measured figure and the two shapes
   named. Costs: lg-96's answer 10 rests on "+129 MB the worst built"; restated, a
   crafted upload under 4 MiB takes about 350 to 380 MB of the 512 MB container, and
   the cap is not the bound on it.

## Build

Written for the answer the owner gives. The owner's answer goes under the heading
above first (who, the date, the options it was chosen from), and `status` moves to
`ready` in that commit, as `docs/01-TICKETS.md` says.

1. **If 1:** in `tools/ledger/api/src/workbook-zip.ts`, `workbookEntries` and
   `compressedOf` compare each entry's local-header name with its central name, at the
   local header's offset, and refuse the zip on a mismatch with `WORKBOOK_NOT_XLSX`. In
   `tools/ledger/api/src/workbook-parts.ts`, refuse a workbook whose sheets' `.rels`
   (comments, VML, drawing, chart) resolve to one part, before any sheet is parsed. Both
   run before `readSheets` calls SheetJS. Tests: each shape, through `readSheets`, the
   describe route and the import command.
2. **If 2:** measure first, before the change, on both shapes at 14 sheets and at the
   largest sheet count the workbook bound admits, one process at a time under
   `--max-old-space-size=900`: time, peak, and the size of the built grid. Record the
   table in the Log. Then change `readSheets` to `XLSX.read` once per sheet with
   `sheets: i`, keeping only that sheet's built grid, and measure again on the same
   shapes.
3. **If 3:** reword the three texts named under option 3 to the measured figure and to
   the two shapes, and record in lg-96's answer 10 that its premise is corrected.
4. **Under any answer:** reword the header sentence in
   `tools/ledger/api/src/workbook-parts.ts` that begins "Distinct parts cannot multiply
   the parse" (line 13 at `1aabcb4a`). Both shapes contradict it. The new sentence states
   what the chosen answer covers, and under option 3 it names the shapes and the
   measured figure.

## Done when

The population is the two shapes: (a) a zip entry whose local-header name differs from
its central name, and (b) a workbook in which two sheets' `.rels` name one part. Each is
the file named in the Reproduction. Each line is checked by someone other than the
builder.

1. **If 1:** `xlsx.test.ts` or `workbook-import.test.ts` has one test per shape, each
   asserting `WORKBOOK_NOT_XLSX` before SheetJS parses (the decoy-14 file and the
   comments-14 file), through `readSheets`, the describe route and the import command.
   Re-running `localname.sh 2 14` and `comments.sh … 50000 1 14` on the head refuses both
   14-sheet files, and reads the honest controls unchanged (`localname-control-14`
   140,013 cells; `comments-distinct-14` 14 cells). Removing the new check fails the
   tests.
2. **If 2:** the Log holds the before and after table for both shapes, at 14 sheets and
   at the largest sheet count, with time and peak under `--max-old-space-size=900`. Each
   shape's peak at that count is named, and the built-grid growth is measured, not
   estimated.
3. **If 3:** `git grep -n "Distinct parts cannot multiply"` on the branch matches nothing,
   and the reworded texts name the two shapes and the re-run figure
   (`localname-decoy-14` +379.0 MB; `comments-comments-14` +327.1 MB, or their re-measured
   values at the time).
4. **Under any answer:** `git grep -n "cannot multiply the parse"` on the branch matches
   nothing, and the reworded header names what the chosen answer covers.
5. **Under any answer:** the Reproduction's probes re-run at the head, with their output in
   the Log, and the honest controls read the same as above.
6. **Under any answer:** `npm run check` and `npm test -- --project ledger` pass.

## Log

### 2026-11-08, filing

- Filed by a builder on a maintenance dispatch (no ship authority), from lg-96's gate 3
  (Opus 5.5, FAIL at `3b8e95d4`, F2). The owner chose on 2026-11-08 to land lg-96 and
  file these two shapes as this ticket.
- Re-ran gate 3's probes, once each, on a detached `3b8e95d4` (farm exit 0, build exit 0).
  Readings are in the Reproduction beside gate 3's. The local-name and comments figures
  agree with gate 3's to within about 10 MB on each row, except `comments-comments-14`
  reader (+327.1 against +352.5), which is recorded as measured.
- `lg-96` at `3b8e95d4` does not name lg-104. At its landing head `1aabcb4a` it does, in
  its Log, in `workbook-bounds.ts` and in `xlsx.ts`. The reference is in place for the
  landing; no change is made here.
- The dispatch's observation said each of lg-96's three gates found a new disagreement
  between the copy and SheetJS. Gate 1's F2, read from the lg-96 Log, is the parse that
  runs before the charge (a cost finding). Gates 2 and 3 each found an identity
  disagreement. The Observation section says it this way.
- Coordinator's addition: the header of `tools/ledger/api/src/workbook-parts.ts` at
  `1aabcb4a` line 13 says "Distinct parts cannot multiply the parse … the parts together
  never inflate to more than the bound". Verified by `git show 1aabcb4a:… | grep -n
  "cannot multiply"`. Build step 4 and Done when 4 cover it.
- `difficulty: hard`. The recommended option (1) is another copy of SheetJS's rules, and
  lg-96's three gates are the record of how such a copy goes. The rating follows the
  recommended option, as `docs/01-TICKETS.md` says for a question.
- `depends_on: [lg-96]` resolves on `main`, where lg-96's ticket file already exists.
- Not measured: the VML, threaded-comment, drawing and chart variants of shape 2, and the
  built-grid growth under option 2.
