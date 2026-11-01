---
id: lg-95
tool: ledger
title: Re-file a bank row whose person and bucket were already answered
kind: work-package
status: ready
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

## Decision — answered 2026-11-01 by the owner

**1. answered 2026-11-01 by the owner: allow it, caught up at the next close — what happens when the row falls inside a period that is already
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

**Answer to 1.** Allow the re-file. A row in the open period needs nothing
special: the open period's settlement (`settlementFor` in `api/src/periods.ts`) is
computed on every read from current answers, so it moves at once. For a row in a
closed period, the recorded settlement stays what was actually paid, and the next
close catches it up: `cumulativeHouseholdSettlement` recomputes every period from
`bufferRows`, which reads `current_classifications`. History says the row is in a
closed period and that the next close will carry the correction. The owner first
answered that the settlement should move, then clarified they meant the current
one. Rewriting a recorded settlement was offered and declined: it would break
§9's never-edit rule and stop matching the money people actually moved.

**2. answered 2026-11-01 by the owner: a, on History — where the control lives.**

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
3. Apply decision 1. To say the row is in a closed period, the screen needs to know whether the row's date
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
- 2026-11-01 — The owner answered both decisions (see above); status moved to `ready`.
- 2026-11-01 — Built on branch `lg-95-refile-from-history` from `83eac952`.
  - **Build 3 holds, no contract change.** `StoredRow` carries `date` and `classification.source`, and `GET /api/periods` (`fetchPeriods`) lists each closed period's `start` (`null` for the first) and `end`, both inclusive (`api/src/periods.ts`: `date >= start`, `date <= end`). `closedPeriodOf` in `web/src/history/History.tsx` is that test on the client; `history.test.tsx`'s last test holds its first day, last day, null start and a day after every close.
  - **Shared controls.** `web/src/inbox/AnswerControls.tsx` is the `.answer` block (two selects and a button) that `Inbox.tsx` and `AutoFiled.tsx` each drew by hand; the two now render it, with the same labels and the same markup, and History is the third use. Their own tests (`inbox.test.tsx`, `app.test.tsx`: 42 of 42) pass unchanged.
  - **History.** Each row with an answer gets a "Change who and what" button, which opens a `fieldset.offer` holding the controls, a Save button and a Cancel. The row's source reads beside its answer ("answered by a person", "filed by a rule", ...: `CLASSIFICATION_SOURCE_LABELS` in `labels.ts`). A row with no answer has no button: it is the inbox's. Saving sends `classifyRow`, then reads the list again with the same query and as many rows as were shown; nothing is patched locally. There is no undo: changing it back is one more change.
  - **Decision 1.** A row in a closed period says, before the change, that the recorded settlement stays as paid, that stats and deposit matching follow at once, and that the next close carries the correction; the notice after saving repeats the last. A row in the open period says nothing of a close.
  - **What the brief had slightly wrong.** The e2e seed (`layout.spec.ts`) has every one of its 12 rows dated July to September 2026 and closes through 2026-09-30, so every History row there is in a closed period; the layout case therefore measures the longest text the control says, and the open-period wording is covered by the web test only. Three seeded rows share the description "Hypothèque /Prêteur Exemple", so that case takes the first.
  - **Folded in: none.** Nothing else was made free. Not done, and not asked: History's identical "Change who and what" buttons are told apart for a screen reader only by their row's position; a per-row accessible name would break the exact name the ticket gives the action.
