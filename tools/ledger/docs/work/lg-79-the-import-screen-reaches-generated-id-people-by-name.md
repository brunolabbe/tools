---
id: lg-79
tool: ledger
title: The Import screen reaches people under generated ids by their shown names
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# lg-79 — The Import screen reaches people under generated ids by their shown names

## Why

lg-76 gave a person added since a UUID for an id, with the typed name only
shown. It taught the host import to resolve a workbook's names through the
directory's shown names: `directoryPeople` in `api/src/import-command.ts` hands
`importWorkbook` its `names`. lg-66's screen, merged a day earlier, builds its
own caller in `api/src/routes/workbook.ts` and never got them. So on a household
whose people have generated ids, the screen's describe and confirm fold
"Alex" against UUIDs, match no one, and refuse the whole workbook. The refusal
then lists the household by UUID, which nothing is meant to print. Every
household made since lg-76 is one; a household from before keeps word ids and is
unaffected.

Found by lg-66's live read on 2026-10-27 (its Log): the first read ran on a
household the household command had just made, and was refused on names alone.

## Reproduction

On `a018ffcf`, a household with alex and sam added by `addMemberByName`, `lg7`
uploaded to `/api/workbook/describe` with its correct description answered:

```
2022!E2 names "Alex", who is not one of the household (4f9c2d8e-…, a1b2c3d4-…). Map the name to a person in the corrections file's "people".
2022!E6 names "Sam", who is not one of the household (4f9c2d8e-…, a1b2c3d4-…). Map the name to a person in the corrections file's "people".
```

`ok` is false, so the screen offers no Confirm.

## Build

1. `WorkbookCaller` in `api/src/workbook-describe.ts` carries `names`, and both
   of its `importWorkbook` calls pass it, as the host import does.
2. `callerOf` in `api/src/routes/workbook.ts` fills it from
   `context.directory.names(person.household)`.
3. Added after gate 1, by owner choice: every person the import's report and
   problems print goes through the shown name, falling back to the id, so a
   household with word ids prints the same text. That is `run`, `compare`,
   `gapOf` and `describeSettlement` in `api/src/workbook-import.ts`, and the
   period sheet's per-person check lines through `People.shown` in
   `books/src/workbook.ts`.

## Done when

1. On a household whose alex and sam have generated ids, `lg7` described and
   then confirmed through the routes stores salaries and classifications under
   the two UUIDs: `api/test/workbook-describe.test.ts` › "a household whose
   people have generated ids (lg-79)" › "the workbook's names reach them by their
   shown names, on describe and on confirm".
2. A name such a household lacks is refused with the household listed as shown
   and no UUID in any problem: the same block › "a name the household lacks is
   refused naming the household as shown, never by a generated id".
3. Both tests fail with the two source files at `a018ffcf`.
4. Added after gate 1: on that household the describe report and the confirm
   report each print `salaries (Accueil): alex ` and neither holds either UUID,
   asserted in the first test. Those assertions fail with Build 3 reverted.
5. `npm run check` and the ledger suite pass.

## Review

**Gate 1: CONCERNS** at `a34a9c41`, 2026-10-27, Sonnet 5.5. Done when 1 to 4 (as
they stood) proven; the gate reverted the two files itself and each call site
alone turns the first test red.

- **F1 (med), fixed by owner choice:** once names resolve, the describe and
  confirm reports each printed 17 lines naming a person by UUID, against
  `tools/ledger/CLAUDE.md`'s "a UUID is never printed". lg-76's Log had left it
  as an operator's console; lg-66's screen made that untrue. Build 3, Done
  when 4.
- **F2 (low), left:** `WorkbookImportOptions.names` stays optional, which is how
  the screen left it out without a type error. Every production caller passes
  it now, and `WorkbookCaller.names` is required, so a new screen caller fails
  typecheck.

## Log

### 2026-10-27 — filed and fixed together

The owner chose to file and fix it in one pull request. Both tests failed with
the source files reverted (the first on the two messages above, the second
listing the UUID), and pass with the fix. The household list in the refusal
comes from `People` in `books/src/workbook.ts`, which already prints a shown
name when it has `names`, so the second test needed no change there. lg-78,
which asks what to do with a name the household lacks, is unchanged by this.

### 2026-10-27 — round 1: gate 1's F1 fixed

The owner chose to fix F1 here rather than file it. Build 3 and Done when 4
are new. The two new assertions failed with only `workbook-import.ts` and
`books/src/workbook.ts` reverted, and pass with them. No existing test changed,
which is what the fallback to the id promises for word-id households.
`npm run check` exits 0 and the ledger suite passes, 1,842 of 1,842.

**Left, out of the screen's reach:** `noteOf` in `books/src/workbook.ts` writes
a corrected row's note as "Corrected on import from <bucket>, <person id>".
Only the host command's corrections file makes a correction, and the note is
stored, so changing its text would change what later imports store.
`run`'s `--as names …` line prints the id the command was given; the screen's
caller is always a member, so it never reaches it.
