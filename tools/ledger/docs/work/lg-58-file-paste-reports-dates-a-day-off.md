---
id: lg-58
tool: ledger
title: A paste reports the dates it names a day off from the workbook's
kind: work-package
status: ready
milestone: null
depends_on: [lg-40]
difficulty: hard
---

# lg-58 — A paste reports the dates it names a day off from the workbook's

## Why

lg-40 (PR #548, from its branch `lg-40-paste-overlaps-workbook-rows`, unmerged)
lets a pasted row match a workbook row dated a day apart, and its Build item 2
says that date is "reported rather than refused". It is not reported.
`ImportStatementReport` in `contract/src/api.ts` has three fields, `rowsAdded`,
`rowsAlreadyPresent` and `tailBalanceCents`, and nothing that names a date. The
paste is accepted, the stored row keeps the workbook's date, the pasted row is
dropped, and the stored-paste screen (`web/src/statements/StatementPaste.tsx`)
says nothing about it. The household never sees that the bank and the workbook
disagree on that date, so the workbook's date stands unchallenged.

lg-40's builder recorded the choice in its Log: the report has no field to
carry the date, adding one is a contract change and a screen change, and the
owner chose on 2026-10-18 to file it as a new lg- ticket rather than add it in
lg-40's branch or leave it unreported.

## Build

1. Add an optional `datesDiffering` list to `ImportStatementReport` in
   `contract/src/api.ts`. It is absent, or empty, when no pasted row matched a
   workbook row a day off. Each entry names a day-off row. What an entry holds
   (the bank's date, the workbook's date, the amount, or some of these) is the
   builder's to choose, with the reason in the Log.
2. Fill it in the paste path in `api/src/statements.ts`, where lg-40 accepts a
   day-off match. The list is returned in the paste's response.
3. The stored row keeps the workbook's date, and the pasted row is dropped, as
   lg-40 builds them. A stored row is never edited (`tools/ledger/CLAUDE.md`).
4. On the stored-paste step in `web/src/statements/StatementPaste.tsx`, when the
   list is non-empty, show a line that names the dates in question, and says the
   workbook's date was kept. The wording is an open point below.
5. The `details` and logs rules in `tools/ledger/CLAUDE.md` still apply. The list
   is a response, not error `details`, and no log line may carry its dates. The
   builder confirms in the Log that it did not add one.

## Open points

These are not settled by this ticket. The builder records in the Log what it
did about each, or stops and reports if one needs the owner.

- **The wording of the screen line**, including whether it names both dates or
  only the workbook's.
- **Whether lg-54 carries the same report.** lg-54
  (`tools/ledger/docs/work/lg-54-a-stored-paste-says-its-rows-wait-in-the-inbox.md`)
  also changes the `stored` step in `StatementPaste.tsx`, and its Build item 3
  allows a count to grow `ImportStatementReport`. Whether the two land one
  report, or two, and in which order, is not decided here.

## Done when

- An `api` test in `api/test/statements.test.ts` pastes one synthetic row a day
  off from a workbook row, and gets the paste accepted with the workbook's date
  kept on the stored row and `datesDiffering` naming that row's date.
- An `api` test pastes synthetic rows that all match the workbook on date, and
  gets a report that names no date in `datesDiffering`.
- An `api` test pastes a day-off row and shows the workbook's stored rows are the
  same before and after the paste.
- An `api` test pastes a day-off row and shows no log line carries a date from
  `datesDiffering`, using the existing logging test or an extension of it.
- A web test stores a paste with one row a day off and finds the stored step
  naming that row's date.
- A web test stores a paste with no row a day off and finds no date named on the
  stored step as differing.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-18: filed by the orchestrator's maintenance dispatch, from lg-40's
  Build item 2 and the owner's choice on 2026-10-18 to file a new lg- ticket
  rather than add the field in lg-40's branch or leave it unreported (lg-40's
  Log, round 1). Reproduction on `origin/main`, `git show
origin/main:tools/ledger/contract/src/api.ts | grep -n -A5
'ImportStatementReport'`, which lists the interface with the three fields and
  no date field. lg-40's branch has the same interface.
