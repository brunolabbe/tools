---
id: lg-62
tool: ledger
title: The isolation sweep's marks can match a photo's random file name
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-62 — The isolation sweep's marks can match a photo's random file name

## Why

`api/test/isolation.test.ts`'s sweep searches the stored files for the other
household's numeric marks, and one of the stores it searches holds a random
name it never planted. The lg-59 gate 2 reviewer (Sonnet 5.5, 2026-10-19)
wrote the mechanism:

> the builder's one-off `isolation.test.ts` failure ("away's receipts holds home's 3119") is not reachable from the round … `storedLeaks` searches each table's JSON for four-digit marks (`3119`, `4113`, `2227`, `3227`), and the `receipts.photo` column holds `randomUUID()` file names: 2,339 of 2,000,000 random UUIDs contain one of the four (0.12%). The spec passes 3 of 3 here and in CI at `b7efbfef`.

and

> In `isolation.test.ts`, `marks(HOME)` includes `String(lineCents)` = `3119`, and `storedLeaks` does `JSON.stringify(rows).includes(mark)` over every table of the other household's file. `receipt-photos.ts` names each photo `randomUUID().<ext>` and the `receipts.photo` column holds it.

The failure was observed once, by the lg-59 builder's first preflight on
2026-10-18 (`tools/ledger/api/test/isolation.test.ts > the isolation sweep >
each household reads its own records through every read route, and nothing of
the other's`, `+ "away's receipts holds home's 3119"`). It has not reproduced
since.

The mechanism is as the reviewer says, read off `origin/main` (see
**Reproduction**):

- `marks(household)` returns bare numeric strings for the amounts, among them
  `3119` (HOME's `lineCents`) and `4113`, `2227`, `3227`. A bare digit string is
  a substring of any hex string that happens to hold it.
- `storedLeaks` runs `JSON.stringify(rows).includes(mark)` over every table of
  each file, and `receipts.photo` is one of those tables' columns
  (`api/src/db/schema.ts`, `CREATE TABLE receipts`, `photo TEXT NOT NULL UNIQUE`).
- The photo store saves each file as `randomUUID().<ext>` (`api/src/receipt-photos.ts`,
  `photoName`), so the column holds a 36-character hex name, and about one in
  eight hundred of those names contains one of the four marks.

**The 0.12 % figure is a simulation, not a measurement from the suite.** The
filer ran `randomUUID()` 2,000,000 times in a short script kept in its scratch
directory, not in the repo: 2,350
names contain one of the four four-digit marks (0.117 %), and 2,408 contain any
of the ten numeric marks of both households (0.120 %). The reviewer's 2,339 is a
different draw of the same rate. The rate is per photo name: a run whose sweep
reads n stored photo names fails with probability about n × 0.12 %, so one
failure in CI is a rare event that a single preflight could hit, and it reads
as an unrelated flake. The filer did not count how many photo names a sweep run
stores, so the per-run figure is unmeasured.

The same substring test also runs over every read response (`isolation.test.ts`,
the `marks(other).filter((mark) => response.body.includes(mark))` line in the
read sweep). **Not checked here:** whether any read route returns a photo's file
name in its body. If one does, the same flake reaches that sweep too, and the
builder should say so in the Log.

`photoLeaks` already checks each household's photo column against what is in its
directory, by exact name (`SELECT photo FROM receipts`). Placement of photos is
therefore covered by a check that cannot match a substring, which bears on the
second option below.

## Reproduction

The ticket's own reproduction is that each named line still exists on
`origin/main`. The filing's base is `origin/main` at `33a8451d`, which contains
the `f58473f4` the dispatch named; the three commits between them (`a58bb490`,
`093f673c`, `33a8451d`) change nothing under `tools/ledger/api`. Run on
2026-10-19 with `git grep -n` against `origin/main`:

```
$ git grep -n -E 'storedLeaks|marks\(|randomUUID' origin/main -- 'tools/ledger/*isolation*' 'tools/ledger/*receipt-photos*'
origin/main:tools/ledger/api/src/receipt-photos.ts:16:import { randomUUID } from "node:crypto";
origin/main:tools/ledger/api/src/receipt-photos.ts:43:  return `${randomUUID()}.${EXTENSIONS[mediaType]}`;
origin/main:tools/ledger/api/test/isolation.test.ts:109:function marks(household: Household): string[] {
origin/main:tools/ledger/api/test/isolation.test.ts:792:function storedLeaks(app: App): string[] {
origin/main:tools/ledger/api/test/isolation.test.ts:812:      const shown = marks(other).filter((mark) => text.includes(mark));
origin/main:tools/ledger/api/test/isolation.test.ts:906:          const shown = marks(other).filter((mark) => response.body.includes(mark));
origin/main:tools/ledger/api/test/isolation.test.ts:910:          if (!marks(own).some((mark) => response.body.includes(mark))) silent.push(where);
origin/main:tools/ledger/api/test/isolation.test.ts:916:      expect(storedLeaks(app)).toEqual([]);
```

Every named line is present. The deterministic failure (a stored photo name
containing `3119`, making the sweep report a leak) is not reproduced here: it is
the first step of **Build**, and the filer wrote no test code.

## Build

1. **Pin the failure first.** In `isolation.test.ts`, plant a photo name that
   contains `3119` (a UUID-shaped name such as `00003119-…` with a valid
   extension) in away's `receipts` row, and run the sweep. On `origin/main` it
   must go red with `away's receipts holds home's 3119`. Keep the plant in the
   test, not in a one-off script, so the red state is in the suite.
2. **Make the marks unable to match an unrelated name.** Choose one of these,
   record the choice and its reason in the Log, and make the planted case from
   step 1 green:
   - **Option A — marks no hex name can contain.** Change what the sweep searches
     for so that no mark is a substring of a 36-character hex UUID. A bare digit
     string cannot do this, because hex contains every decimal digit. It needs a
     mark with a character outside `[0-9a-f-]` (a quoted string, a currency
     separator), and that is only possible where the stored form carries one. An
     integer cents column does not, so this option may leave the amount columns
     unswept. Check that before choosing it.
   - **Option B — exclude the photo file-name column from the text search.** Skip
     `receipts.photo` in `storedLeaks` and write the reason in the code: the
     name is generated by the service and not household data, and `photoLeaks`
     already checks each photo's placement by exact name. Cost: a household's
     photo name that matched the other's marks would no longer be reported by
     this check; `photoLeaks` still reports a photo kept in the wrong directory.
   - **Recommendation: Option B**, because it keeps every amount column swept and
     names exactly what is left unsearched. The builder decides; this is not an
     owner question.
3. **Positive control.** Keep the sweep able to fail on a real cross-household
   leak: plant the other household's mark in a text column that is still
   searched (a description or a payee, not the photo column), and show the sweep
   red with it and green without. A fix that makes the sweep green by searching
   less must fail this control.
4. Check the read-response search (the paragraph on it under **Why**) against
   the routes in `READS`, and say in the Log whether any returns a photo file
   name.
5. Run `npm run check` and `npm test -- --project ledger` in the branch's own
   worktree.

## Done when

1. The planted photo-name case from Build step 1 is red on `origin/main` and
   green on the branch: the named test in `isolation.test.ts`, the command, and
   both exit codes in the Log.
2. The positive control from Build step 3 is red with the leak planted and green
   without it, on the branch: the named test and the output in the Log.
3. `npm run check` exits 0 and `npm test -- --project ledger` exits 0 in the
   branch's own worktree, with the counts in the Log.
4. The Log names the option chosen under Build step 2 and why, and says whether
   any read route returns a photo file name.

## Log

- **2026-10-19 — filed (maintenance dispatch).** Base `origin/main` at
  `33a8451d`. Mechanism and reproduction as above. The `0.12 %` figure is the
  filer's own simulation over 2,000,000 `randomUUID()` names (scratch, not in
  the repo): `2408 of 2000000 (0.120 %)` for all ten numeric marks,
  `2350 of 2000000 (0.117 %)` for the four four-digit marks. Difficulty
  `standard`: the Build leaves a choice between two options with different
  costs, which is judgement under the format's definition; the dispatch's
  `mechanical` default did not fit. No `## Decision` heading, because the
  choice is the builder's to make and records, not an owner question, and that
  heading requires `status: needs-decision`.
