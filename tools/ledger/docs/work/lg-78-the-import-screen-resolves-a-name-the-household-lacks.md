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
