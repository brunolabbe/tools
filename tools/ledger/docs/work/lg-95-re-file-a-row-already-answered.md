---
id: lg-95
tool: ledger
title: Re-file a bank row whose person and bucket were already answered
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-11-01 · `83eac952..cb1b036d` · Opus 5.5, depth standard

| Done when                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `manual` row is re-filed to another person and bucket from History, driven by a test, and then shows the new answer | `web/test/history.test.tsx` › "a row answered by a person is filed again from the history, the list is read again, and no undo is offered (lg-95)" ✓ — `classifyRow` called once with `{ rowId: 7, personId: "sam", bucket: "mortgage" }`, a second `fetchRows` asked, and the list then reads "sam · Mortgage" and not "alex · Current expenses". Positive control: dropping the `classifyRow` call fails it ("expected to be called 1 times, but got 0 times"), and swapping the re-read for a local patch fails it ("expected [ { offset: +0, limit: 50 } ] to have a length of 2 but got 1") |
| The earlier record is still stored; the UI sends a new answer and offers no undo                                      | API half: `api/test/classifications.test.ts` › "classifying a row again" › "keeps the earlier classification, with who changed it and when" ✓ (two records, the first untouched). UI half: the same History test ✓ — the `classifyRow` call, then `queryByRole("button", { name: /undo\|revert\|restore/iu })` is null, with the status line asserted beside it so an empty screen fails                                                                                                                                                                                                         |
| Decision 1's behaviour is tested on a row in a closed period                                                          | `web/test/history.test.tsx` › "a row in a closed period says what the change reaches, and the next close carries it (lg-95)" ✓ — the closed-period paragraph (settlement stays as paid, next close carries it), none on the open-period row, and the after-save notice; `closedPeriodOf` bounds › "closedPeriodOf holds a period's first and last day, and the first period has no start (lg-95)" ✓. Gate probe: 16 dates over two closed periods (first `start: null`, then a chosen first start) agree with books' `periodIndexOf` on every one                                                |
| `layout.spec.ts` covers the open control at 360 px and desktop                                                        | `e2e/layout.spec.ts` › "History fits a phone and a desktop with a filed row's change open" — `e2e` (ledger workflow) success at `cb1b036d`, and the whole layout spec passed locally on `E2E_PORT=8291`, 31 of 31 ✓                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run check` and `npm test -- --project ledger` pass                                                               | **verified** — `npm run check` exit 0; ledger project 2140 of 2140, 99 files, exit 0, at `cb1b036d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **med** · no `Done when` line depends on it · **open decision** · History's
  change control offers every person the books ever held, retired ones
  included, for every row — an open-period row too. `History` loads
  `fetchPeople(signal, "everyone")` for its filter and passes the same list to
  `AnswerControls`; `fetchPeople`'s own header in `web/src/api/rules.ts` says
  `"in"` is "what a screen offers to pick" and `"everyone"` is for the
  history's filter and a stored row's owner, and the inbox and Auto-filed both
  offer `"in"`. The API's `requireKnownPerson` accepts any known person
  (read, not run). Gate probe: a row dated after the close that retired `pat`
  is offered `Joint, alex, pat, sam`. A row already answered to `pat` does
  preselect `pat`, which is right. What filing an open-period row to a retired
  person does to the next close is unmeasured. Options in the report.
- **low** · `nfr:reliability` · a save whose `classifyRow` succeeds and whose
  re-read fails shows the re-read's error with the control still open, enabled
  and showing the old answer; a second Save sends a second identical answer
  (probe: 2 `classifyRow` calls). Nothing wrong is stored — the duplicate holds
  the same answer — but the screen says a saved change failed.
- **low** · `nfr:reliability` · `fetchPeriods` joins the `Promise.all` that
  loads people and spending categories, so a failed periods read now also drops
  the names and category names History shows. Same `read` guard as `GET
  /api/rows`; needs a transient failure.
- **low** · a11y · the closed button carries `aria-expanded={false}` but is
  replaced by the fieldset on open, so nothing ever reports `true`, and focus
  falls to the body when the button unmounts.
- **low** · the Log's build entry places the bound in `api/src/periods.ts`
  (`date >= start`, `date <= end`); the server assigns a dated amount to a
  period with books' `periodIndexOf` (first period whose end is on or after the
  date, `-1` before the first's start). The two agree on contiguous periods,
  which `closePeriod` enforces (`PERIOD_NOT_OPEN`), and the probe measured them
  equal; false in the safe direction.
- **dropped** · `web/src/inbox/AnswerControls.tsx` has no test file of its
  own: every branch is exercised through `inbox.test.tsx`, `app.test.tsx` and
  `history.test.tsx` (a person and `null` both sent), and a base/head DOM dump
  of Inbox and Auto-filed is byte-identical.
- **dropped** · a row dated before a chosen first-period start gets no
  closed-period wording: the server counts it in no period either (`-1`), so
  saying nothing is correct.
- **dropped** · a Save while a Show more request is in flight could append a
  stale page after the re-read: `refile` does not abort `moreRequest`. Read,
  not reproduced; needs a click during a pending page. Folded into nothing,
  recorded here as unmeasured rather than as a finding.
- **findings** · the hunt returned 8; 5 carried, 3 dropped.
- NFR: security ✓ (no new route, no logging) · performance ✓ (one extra GET
  on open; the re-read asks `max(50, shown)` rows) · reliability — above ·
  maintainability ✓ (one shared control replaces two hand copies). 360 px and
  desktop read through the layout case.
- CI at `cb1b036d`: every check success — `check`, `changes`, `test
  (ubuntu-latest)`, `test (windows-latest, informational)` (CI); `e2e`,
  `docker` (ledger); `codeql`, `dependency-review` (security); `CodeQL`;
  `pr-title`.

## Log

- 2026-11-01 — Filed at the owner's request after they mis-filed a row and found no
  way to change it. They first asked for it to be built, then chose to file it.
- 2026-11-01 — The owner answered both decisions (see above); status moved to `ready`.
- 2026-11-01 — Built on branch `lg-95-refile-from-history` from `83eac952`.
  - **Build 3 holds, no contract change.** `StoredRow` carries `date` and `classification.source`, and `GET /api/periods` (`fetchPeriods`) lists each closed period's `start` (`null` for the first) and `end`, the server assigns a dated amount to the first period whose end is on or after it, and none before the first's start (`periodIndexOf` in `books/src/periods.ts`), which for periods that touch end to end, as `closePeriod` enforces (`PERIOD_NOT_OPEN`), is the same as `start <= date <= end`, both ends inclusive. `closedPeriodOf` in `web/src/history/History.tsx` is that test on the client; `history.test.tsx`'s last test holds its first day, last day, null start and a day after every close.
  - **Shared controls.** `web/src/inbox/AnswerControls.tsx` is the `.answer` block (two selects and a button) that `Inbox.tsx` and `AutoFiled.tsx` each drew by hand; the two now render it, with the same labels and the same markup, and History is the third use. Their own tests (`inbox.test.tsx`, `app.test.tsx`: 42 of 42) pass unchanged.
  - **History.** Each row with an answer gets a "Change who and what" button, which opens a `fieldset.offer` holding the controls, a Save button and a Cancel. The row's source reads beside its answer ("answered by a person", "filed by a rule", ...: `CLASSIFICATION_SOURCE_LABELS` in `labels.ts`). A row with no answer has no button: it is the inbox's. Saving sends `classifyRow`, then reads the list again with the same query and as many rows as were shown; nothing is patched locally. There is no undo: changing it back is one more change.
  - **Decision 1.** A row in a closed period says, before the change, that the recorded settlement stays as paid, that stats and deposit matching follow at once, and that the next close carries the correction; the notice after saving repeats the last. A row in the open period says nothing of a close.
  - **What the brief had slightly wrong.** The e2e seed (`layout.spec.ts`) has every one of its 12 rows dated July to September 2026 and closes through 2026-09-30, so every History row there is in a closed period; the layout case therefore measures the longest text the control says, and the open-period wording is covered by the web test only. Three seeded rows share the description "Hypothèque /Prêteur Exemple", so that case takes the first.
  - **A fake the brief did not name.** `web/test/generated-ids.test.tsx` automocks `api/periods.ts`, so its History case read `fetchPeriods` as `undefined` once History called it: the first full `npm test -- --project ledger` was 1 failed of 2140 (`history/History.tsx: History`, "expected '' to match 'Alex · Mortgage'"). The case now sets `fetchPeriods` to `[]`.
  - **Folded in: none.** Nothing else was made free. Not done, and not asked: History's identical "Change who and what" buttons are told apart for a screen reader only by their row's position; a per-row accessible name would break the exact name the ticket gives the action.
- 2026-11-01 — Owner's answer, relayed by the coordinator, to a question the build left open: should each History "Change who and what" button's accessible name also name its row? Options: **A** leave the identical names (the builder's recommendation); **B** keep the visible text and give each button an `aria-label` that also names the row, "Change who and what: <description>, <date>". **The owner chose B**, over the builder's recommendation. This supersedes the build entry's last bullet ("Not done, and not asked: ..."), which said a per-row name would break the exact name the ticket gives the action: the visible text is unchanged and the accessible name starts with it, so label-in-name holds.
  - **Applied.** The button's visible text is still "Change who and what"; its `aria-label` is "Change who and what: <description>, <date>" (`Refile` in `web/src/history/History.tsx`). `history.test.tsx` finds each button by that full name and asserts the visible text is the start of the label; the layout case finds the Hypothèque row of 2026-09-12 by its name, which also drops the `.first()` the three same-named seeded rows had forced. `history.test.tsx` 12 of 12; `layout.spec.ts -g History` on `E2E_PORT=8273`, 2 of 2.
- 2026-11-01 — Gate 1 (cb1b036d) graded CONCERNS, nothing high, and the owner answered its two questions. This is the one round. Each is recorded with its options, before the code.
  - **Whom History's change control offers (medium).** The control was given every person the books ever held (`fetchPeople(signal, "everyone")`, built for the filter), so an open-period row could be filed to someone who left; the inbox and Auto-filed offer `"in"`. Options: **(a)** current members plus the row's own current person (the gate's recommendation); **(b)** everyone on a closed-period row and (a) on an open-period row; **(c)** leave it as built. **The owner chose (a).** Cost, accepted: a closed-period row can no longer be moved to someone who left after that period.
  - **The four lows.** Options: fix the one fully stated Log line and record the other three (the coordinator's recommendation); fix all four; record all four. **The owner chose to fix all four:** the Log's bound (the entry above is corrected in place, to `periodIndexOf`), a save whose re-read fails, a failed periods read dropping the names, and the button's `aria-expanded` and focus.
  - **Applied, in `web/src/history/History.tsx`, each with a test in `history.test.tsx` that fails on `cb1b036d`'s source** (that file restored from `cb1b036d` into the tree, then `npx vitest run tools/ledger/web/test/history.test.tsx`: 4 failed, 12 passed; at `cf652270`: 16 of 16):
    - _Whom it offers._ `fetchPeople(signal, "in")` is read beside `"everyone"`, which stays for the filter. The control gets the members plus the row's own person if they left, in shown order, and opens on that person. Test: "the control offers the people in now, and a row's own person even if they left; the filter still names everyone".
    - _A save whose re-read fails._ `classifyRow` and the re-read are two steps now. A refused save keeps the control open, as before; once stored, the control closes and the alert reads "The change was saved, but the list could not be read again. ...", so there is no second Save to send a duplicate. Test: "a save whose re-read fails closes the control ..." (one `classifyRow` call).
    - _Periods read on their own._ A failed `fetchPeriods` leaves the names and categories, and the open control says the closed periods have not been read, instead of saying nothing. Test: "a failed read of the closed periods leaves the names and the categories ...".
    - _The button._ It stays mounted with `aria-expanded` true while its control is open and `aria-controls` naming it, and takes focus back when the control closes by Cancel or Save, only if focus fell to the page (opening another row's control moves it there on purpose). Test: "the button reports whether its control is open, and takes focus back when it closes".
  - **Not changed:** `closedPeriodOf` still tests `start <= date <= end` on the client rather than `periodIndexOf`'s rule. The two agree on contiguous periods and differ only in a gap, where the server's answer is the later period. Not asked.
- 2026-11-01 — Owner's answer, relayed by the orchestrator, to gate 2's two unfixed lows: what is left of F2 (after a failed re-read the row shows the old answer, and reopening preselects it, so a second save would quietly send the old answer back) and N1 (on Safari and iOS, focus returns to row A's button when row B is opened). Options: **A** file one ticket for both (the orchestrator's recommendation); **B** record both; **C** fix F2 now, with a third gate. **The owner chose A.** The ticket is filed separately after this pull request merges, so it is not filed here; both stay in gate 2's section as the gate wrote them.
