---
id: lg-95
tool: ledger
title: Re-file a bank row whose person and bucket were already answered
kind: work-package
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-95 — Re-file a bank row whose person and bucket were already answered

## Why

The owner filed a bank row to the wrong person or bucket and found no way to change
it. The API already allows it: `POST /api/classifications` (`ROUTES.classifications`,
`classifyRequestSchema` in `tools/ledger/contract/src/api.ts`) takes a new answer
for any row, filed or not. It appends a record, and the `current_classifications`
view takes the latest by `id` (`tools/ledger/api/src/classifications.ts`, header).
lg-4 built and tested that ("Reclassifying keeps the earlier classification as
history"). No screen sends it for a row a person has already answered. Read on
`main` at `14078579`:

- **Inbox** (`web/src/inbox/Inbox.tsx`) lists only rows with no record.
- **Auto-filed** (`web/src/inbox/AutoFiled.tsx`) lists only `auto` records nobody
  has confirmed. Once a person confirms or changes one, the row leaves the list.
- **History** (`web/src/history/History.tsx`) says in its header that it is
  read-only.
- **Stats** period rows (`web/src/stats/PeriodRows.tsx`) and **Spending**
  (`web/src/spending/Spending.tsx`) change only a row's spending category, through
  `RowSpending`.
- **Rules** never re-file stored rows: a rule added later is only offered as a
  suggestion (`classifications.ts` header, and lg-4's Log).

So a `manual`, `accepted` or `rule` answer is fixed for good unless someone calls
the API by hand. The spending category is a different, per-row override that can
already be changed, and it is out of scope here.

## Decision — open

**1. open — what happens when the row falls inside a period that is already
closed.** A recorded settlement is never recomputed; the next close is cumulative
(`api/src/periods.ts` header). Two reads already follow the current answer:
`depositMatches` recomputes which closed period a buffer deposit settles "so a
reclassified row moves with it", and stats count a row under the answer standing
now (`api/src/stats.ts` header). Re-filing an old row therefore already moves those
numbers, and the API accepts it today without a check.

- **a. Allow it, and say what moves (recommended).** The control shows that the row
  is in a closed period, and that the change reaches stats and deposit matching but
  not the recorded settlement. No API change. This matches the append-only model,
  in which an earlier belief is never lost.
- **b. Allow it silently.** The cheapest option. It hides the fact that a settled
  period's numbers shift.
- **c. Refuse it for a row in a closed period.** This needs a domain error code in
  `@ledger/contract`, a contract change that lg-4's design did not anticipate. It
  also leaves a wrong answer from a past period with no fix at all.

**2. open — where the control lives.**

- **a. On History (recommended).** History is where a person searches for the row
  they got wrong. Each row gets a "Change who and what" action that opens the same
  person and bucket controls the inbox uses. History stops being read-only, so its
  header comment changes.
- **b. On Stats period rows,** beside `RowSpending`. This only reaches rows that
  some period's chart slice contains.
- **c. Both.**

## Build

Once the decisions are answered:

1. Lift the inbox's person and bucket answer controls out of `Inbox.tsx` into a
   component the chosen screen can reuse, without changing how the inbox renders.
   `AutoFiled.tsx` already renders a variant of them, so share one with it if the
   shapes allow.
2. Show the row's current answer: person and bucket through `answerLabel` in
   `web/src/labels.ts`, and its source (a rule, a person, or history). Then send a change through `classifyRow` in
   `web/src/api/inbox.ts`. Re-read the list afterwards; do not patch it locally.
3. Apply decision 1. For option a, the screen needs to know whether the row's date
   falls inside a closed period. Find out whether `GET /api/rows` (`StoredRow`)
   carries enough to tell. If it does not, adding a field is a contract change, so
   stop and say so rather than editing the contract.
4. Phone layout: the controls must fit 360 px. Add a case to
   `tools/ledger/e2e/layout.spec.ts` for the open control.

## Done when

- A row answered `manual` can be re-filed to another person and bucket from the
  chosen screen. An e2e or web test drives it, and the row then shows the new answer.
- The earlier record is still stored. lg-4's test already covers the API half; the
  new test asserts the UI sends a new answer and does not offer an "undo".
- Decision 1's behaviour is tested on a row in a closed period.
- `layout.spec.ts` covers the open control at 360 px and at desktop width.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-11-01 — Filed at the owner's request after they mis-filed a row and found no
  way to change it. They first asked for it to be built, then chose to file it.
