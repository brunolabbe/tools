---
id: lg-78
tool: ledger
title: The import screen asks what to do with a name the household does not have
kind: work-package
status: ready
milestone: P6
depends_on: [lg-66, lg-74]
difficulty: hard
---

# lg-78 — The import screen resolves a name the household lacks

## Why

A workbook names people in its person column, its period sheets and `Accueil`'s
salaries. The reader resolves each name to a person the household holds, by the
corrections file's `people` map first and then by the name folded for case and
accents (`People` in `books/src/workbook.ts`); a name that matches no one is a
problem, and one problem blocks the whole import, so nothing is written. That is
right: a person is permanent in the books, so a name in a file must never make one
on its own.

From the host command the way out is the corrections file, or adding the person
to the directory and running again. lg-66's screen has neither: its brief says
nothing about a name the household lacks, so the person sees the problem and no
way past it. The common case is the owner's: one person sets up the household,
imports the old workbook, and the workbook names the second.

## Decision — answered 2026-10-25 by the owner

Asked what lg-66's screen should do with such a name, with options: resolve it on
screen, each name either the same as a person the household holds or a new
person without an email, as its own ticket; the same inside lg-66; or refuse and
list the names, for the person to add on the household page and read again. The
owner chose **resolve it on screen, its own ticket**, so lg-66 keeps its size.

## Build

1. **After the read** (lg-66's Describe request): the response lists every name
   the file uses that resolves to no one, each with where it first appears and
   how many rows name it, instead of folding them into the problems as text. A
   name that resolves stays out of the list.
2. **On screen**, before any confirm control: for each such name, a choice
   between a person the household holds (by shown name, a member who has left
   included) and **a new person**, under that name or another typed, with no
   email (lg-74). Every name must be answered before Confirm is offered.
3. **Confirm** takes the answers beside the file and the description. It first
   runs every verification with the answers applied — a mapped name as that
   person, a new one as held — and writes nothing when one fails. Only then does
   it add the new people to the directory, signed by the caller (a member may add
   a person, lg-22), and import. The directory and the books are separate files,
   so the two writes cannot share a transaction: if the import fails after the
   people are added, they stay, and a second Confirm finds them held. Say in the
   Log whether the build found a narrower window.
4. **A new person's id** follows lg-76 when it has landed (a UUID, the name as
   shown), and the name as the id when it has not; take whichever `addPerson`
   does.
5. **Enrolment and periods**: a new person must be in the books' `people` before
   any row naming them is written (`createEnroller`, `api/src/people.ts`), and the
   reader's period sheets and `Accueil` assume two people (`books/src/workbook.ts`);
   confirm both hold for a household of one that the import makes two, and test
   it.
6. **Layout**: the choice list gets a case in `e2e/layout.spec.ts`, at 360 px with
   at least two names, one long.

## Done when

- A workbook naming a person the household lacks reads with that name listed,
  and writes nothing, proved by a test.
- Mapping it to a held person imports its rows under that person, proved by a
  test.
- Adding it as a new person adds them to the directory without an email, signed
  by the caller, and imports their rows under them, proved by a test on a
  household of one.
- A verification that fails with the answers applied adds no one, proved by a
  test that the directory is unchanged.
- Confirm is not offered while a name is unanswered, proved by a web test;
  `e2e/layout.spec.ts` passes.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's scenario: alone in the household, an
  imported workbook names a second person.
- 2026-10-31 — Built on `c7bdef21`.
  - **The list** comes from the reader's own match, not a second one. `People`
    in `books/src/workbook.ts` records each name `resolve` finds no one for,
    with its first cell and how many times it is named, as
    `WorkbookReading.unresolved`. Describe's xlsx answer carries `unresolved`
    and `held`, the people a name may be answered as. `held` is `knownPeople`
    plus the members, so a member who has left is included, shown through
    `distinctNames`. That function moved from `routes/rules.ts` to
    `directory.ts` so both routes can use it. While a name is listed, Describe
    reads the file with each listed name as a provisional new person. Its `ok`,
    `problems` and report therefore show only what no answer can remove, and
    the old "Map the name … corrections file" line no longer reaches the
    screen. lg-79's test of that line in `workbook-describe.test.ts` is
    rewritten in place to assert the list, and `lg37-describe.json` gains the
    two fields.
  - **Confirm** takes `names`, one answer per listed name. An unanswered name is
    `BAD_REQUEST`. These answers are refused as `WORKBOOK_IMPORT_REFUSED` with
    nothing written: a held person the household does not hold, and a new
    person whose name is empty, over 64 characters, or folds to a held
    person's. An answer for a name that resolves is not used, so a second
    Confirm finds an added person held. Each new person's UUID is minted
    first, and the import is verified under that exact id. The new people are
    then added by `Directory.addPeople`, all or none, without an email and
    signed by the caller's address.
  - **A narrower window (Build 3).** The directory add runs inside
    `importWorkbook`'s books transaction, through a new `beforeCommit` option,
    after every verification has held and every row is written but before
    `COMMIT`. If the add throws, the books roll back and nothing is kept. The
    only window left is the books' `COMMIT` itself failing after the directory
    has committed. The brief's two separate writes would also have exposed a
    second read, verification and write pass.
  - **Build 4** was settled: lg-76 landed, so the id is a UUID.
  - **Build 5 holds.** On a household of one, the new id is enrolled in the
    books' `people` (passed as a member to `importWorkbook`) before any row is
    written. The period sheets and `Accueil` then read two people, and the
    salaries and both closed periods are stored.
  - **What the brief did not say.** The brief predates lg-67's CSV branch. A CSV
    description naming a person column is refused (`LAYOUT_NOT_FOR_CSV`), so
    the list exists on the xlsx branch only and a CSV Confirm ignores `names`;
    no `Done when` line changes. Period sheets and `Accueil` match names with
    `peek`, which reports nothing. A name that appears only there, never in the
    person column, is therefore not listed; it still fails as that sheet's
    "names 1 of the household" problem. The screen also lists a refused
    Confirm's `details.problems`, since an answer such as Sam as alex can fail
    a period sheet after a clean Describe.
  - **Measured.** `npx vitest run tools/ledger/api/test/workbook-names.test.ts`:
    14 of 14 passed. Moving the `beforeCommit` call ahead of the `ok` check
    failed 1 of 1 for "a verification that fails with a new person answered
    adds no one". The held-answer refusal test does not reach that path, which
    the mutation showed: it failed only the two success tests.
    `npx vitest run tools/ledger/web/test/import-names.test.tsx`: 5 of 5
    passed, and with the "every name answered" condition dropped from Confirm,
    1 of 5 failed ("Confirm is not offered while a name is unanswered").
    `npx vitest run tools/ledger/api/test/workbook-describe.test.ts`: 120 of
    120 passed. The e2e `-g Import` run on a private port: 3 of 3 passed. The
    360 px screenshot shows the long name wrapping in its box.
    `npm test -- --project ledger`: 1961 of 1961 passed, in 89 files.
