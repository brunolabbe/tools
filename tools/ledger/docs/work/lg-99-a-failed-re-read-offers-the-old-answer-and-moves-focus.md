---
id: lg-99
tool: ledger
title: A failed re-read offers the old answer again, and opening a row can move focus to another
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# lg-99 — A failed re-read offers the old answer again, and opening a row can move focus to another

## Why

lg-95 put "Change who and what" on History (`web/src/history/History.tsx`). Its gate 2
(ticket-reviewer-opus, at `f6e06db1`, PASS) left two low findings unfixed, and the owner
chose on 2026-11-01 to file one ticket for both, rather than fix them now or only record
them (lg-95's Log, last entry). No `Done when` line of lg-95 depends on either.

- **F2, remaining clause.** A save the API stores, followed by a list read that fails,
  leaves the list as it was. The row still shows its old answer ("alex · Current
  expenses") while the notice says the row is now "sam". Reopening the control preselects
  the old answer, so a second Save sends it back, and nothing says so. lg-95's test "a save
  whose re-read fails closes the control ..." asserts only that Save has gone. It never
  reopens the control, so it passes with this defect in place.
- **N1.** `Refile`'s focus effect gives focus back to its own button whenever its control
  closes while focus sits on the page body. A browser that does not focus a button on click
  (Safari and iOS, per MDN's "Clicking and focus" table, read and not run in Safari) leaves
  the body focused when row B's button is clicked, so opening B while A's control is open
  sends focus to A's button. jsdom does not focus on click either, and the same steps there
  read `focusIsA: true`. Whether the page also scrolls up to A is not measured.

Both reproduce on `origin/main` at `580dabbe` (see the Log). The remedy for F2 is a design
choice the owner has not made, and N1's fix is not stated; both are open under Decision.

## Reproduction

Run from the worktree root on a farmed and built tree: `bash .claude/scripts/worktree-farm.sh`,
then `npm run build`, because the ledger web tests read `@ledger/contract` through its `dist`.
Never `npm install` there.

The probe is one file, `tools/ledger/web/test/zz-repro-lg98.test.tsx` (the name is yours to
choose). It is a scratch file: delete it before any `npm run check` or commit, since
`oxfmt --check` reads everything under `test/`. Its two cases, F2 and N1, can share a file.

### Setup both cases share

1. Start with the header `// @vitest-environment jsdom`, and import `test`, `expect`, `vi`,
   `beforeEach` and `afterEach` from `vitest` (globals are off). Import `render`, `screen`,
   `fireEvent`, `waitFor`, `within`, `act` and `cleanup` from `@testing-library/react`,
   `AppError` from `@ledger/contract`, and `History` from `../src/history/History.tsx`.
2. Mock the same five API modules `web/test/history.test.tsx` mocks, each with `vi.fn()`:
   `../src/api/rows.ts` (`fetchRows`), `../src/api/inbox.ts` (`classifyRow`),
   `../src/api/periods.ts` (`fetchPeriods`), `../src/api/rules.ts` (`fetchPeople`) and
   `../src/api/spending.ts` (`fetchSpendingCategories`).
3. In `beforeEach`, `vi.clearAllMocks()`. `fetchPeople` resolves `["alex", "sam"]` when called
   with `"in"` and `["alex", "pat", "sam"]` when called with `"everyone"`.
   `fetchSpendingCategories` resolves `[]`.
4. A row is `{ id, date, category: "Épicerie", description, amountCents: -100,
   balanceCents: 100000, classification: { bucket: "current-expenses", personId: "alex",
   source: "manual" }, spendingCategory: { id: 1, source: "map" } }`, typed `satisfies StoredRow`.
5. Each case calls `render(<History />)`, then waits for
   `screen.findByRole("list", { name: "Bank rows" })`. Call `cleanup()` after each case.

### F2: the save is stored, and the re-read fails

The fake: `fetchRows` resolves a one-row page the first time (`mockResolvedValueOnce`, the
row `{ id: 1, description: "R", date: "2026-10-10" }` with the classification above) and
rejects every later call (`mockRejectedValue(new AppError("UNREACHABLE", "Down."))`).
`fetchPeriods` resolves `[{ id: 1, start: null, end: "2026-09-30" }]`. `classifyRow` resolves
any record; the screen does not read the value it returns.

1. Click the row's "Change who and what" button.
2. Set the "Belongs to" select inside the "Bank rows" list to `sam`.
3. Click Save. Wait until `classifyRow` has been called once, then 50 ms, for the re-read to reject.
4. Assert: one alert reads "The change was saved, but the list could not be read again. Down.";
   the status output reads "R is now sam · Current expenses."; the row's text still contains
   "alex · Current expenses"; the button's `aria-expanded` is `"false"`.
5. Click the same button again and read the "Belongs to" select's value. **The defect:
   `"alex"`**, the answer the notice says was replaced.
6. The control arm: make the second `fetchRows` resolve the row with `personId: "sam"`
   instead, and repeat steps 1 to 5. Step 5 then reads `"sam"`.

### N1: opening row B while row A's control is open

The fake: `fetchRows` resolves two rows, ids 1 and 2, descriptions "A" and "B", both on
`2026-10-10`, both `personId: "alex"`, `source: "manual"`. `fetchPeriods` resolves `[]`.

Arm 1, no focus on click (the Safari and iOS behaviour, as MDN describes it):

1. Get A's and B's "Change who and what" buttons, each inside its own `listitem`.
2. Click A's button without calling `focus()` on it. Then click B's button, again without focusing it.
3. Assert: A's `aria-expanded` is `"false"`, B's is `"true"`, and `document.activeElement` is
   A's button. **The defect: A's button.** jsdom does not focus on click either, so this
   models the browser; it is not a run in Safari. The steps do not check scrolling.

Arm 2, focus before click (Chrome and Firefox):

1. Call `focus()` on A's button, then click it. Call `focus()` on B's button, then click it.
2. Assert: `document.activeElement` is B's button. This holds on `origin/main` today.

## Decision — open

Two questions, both open. Each answer goes under this heading with the options it was chosen
from, and `status` moves to `ready` in the commit that records the last of them.

### 1. The remedy for F2 — open

After a stored save whose re-read fails, what may the row offer?

- **a. Offer no change on that row until a read succeeds (recommended; the gate's direction).**
  The row's "Change who and what" button is disabled, with a line beside it saying the list
  has not been read since the change, and that a new read (a filter change or a reload) will
  bring the button back. Any later successful read clears it. Costs: one piece of per-row
  state; a person whose network is back must change a filter or reload before they can act
  on that row; until a read succeeds the row's text still shows the old answer beside the
  notice; the new line is visible text, so the layout case covers that state at 360 px.
- **b. Keep the answer the save returned on the row.** `classifyRow` already returns the stored
  `ClassificationRecord` (`web/src/api/inbox.ts`). The row shows that record, and the control
  preselects it, until a read replaces it. Costs: the row is patched locally, which the lg-95
  Build ruled out ("Re-read the list afterwards; do not patch it locally") and whose test
  asserts against (a local patch fails it), so the Build and that test change together; the
  row shows an answer the last read did not hold, until the next one; the returned record
  must be carried in state.
- **c. Read the list again when the control opens.** Before it preselects, the control reads
  the list; if that read fails, the control does not open and says why. Costs: one more read
  every time a control opens, against lg-95's one read per change; the failure copy is new;
  it fixes the preselection, not the stale row, which only a successful read corrects.
- **d. Leave it, and record it.** No change. Costs: after a stored save whose re-read fails, a
  second Save sends the old answer and says nothing. It takes a transient read failure, then a
  reopen and a save without looking. Gate 2 rated it low, and no `Done when` line of lg-95
  depends on it.

### 2. The remedy for N1 — open

When row B's control opens while row A's is open, focus should not return to A's button in a
browser that does not focus on click. What should the screen do?

- **a. Restore focus only when the row's own Cancel or Save closed its control (recommended).**
  Narrow `Refile`'s effect from "closed while focus sits on the body" to "closed by this row's
  own Cancel or Save". Costs: a ref the row sets on its own Cancel and Save and clears when the
  control opens; a refused Save must clear it again, or a later close by another row would
  restore focus wrongly; one test. Chrome and Firefox behave as they do now. The Safari reading
  is MDN's and jsdom's, and nothing in the repo measures it.
- **b. Move focus into the new control when it opens.** On open, focus its "Belongs to" select.
  Costs: focus moves on every open, in Chrome and Firefox too, where it stays on the button
  today; nobody has asked for a focus move; what a focused select does on a phone is not
  measured. The restore on Cancel and Save still applies.
- **c. Accept it, and record it.** No code. Costs: in Safari and iOS, opening a second row's
  control after the first sends focus back to the first row's button, and the page may scroll
  to it (not measured). The repo has no Safari reading either way.

## Build

Written from the recommended options, 1a and 2a. Not to be dispatched until the owner
answers, and the answer may change it.

1. F2, option 1a: in `web/src/history/History.tsx`, mark a row whose save is stored but unread
   (set when `classifyRow` succeeds, cleared by the next successful `fetchRows`), and disable
   that row's button with its line. Test in `web/test/history.test.tsx`: after the F2 steps, the
   button is disabled and the control cannot open; a successful read clears both.
2. N1, option 2a: narrow `Refile`'s focus effect as option 2a says. Test: the two arms of the
   N1 reproduction on the branch, arm 1 leaving focus on B's button.
3. Leave the two existing tests named under Done when unchanged.
4. Any visible text or control the answer adds to History goes in the History case of
   `tools/ledger/e2e/layout.spec.ts`, at 360 px and at desktop width.

## Done when

1. Each question's answer is recorded under the Decision heading with the options it was chosen
   from, and `status` is `ready` in the commit that records the last one.
2. The F2 steps of the Reproduction, run on the branch, show the behaviour the answer sets. The
   test that asserts it fails on `580dabbe`'s `History.tsx`, and passes on the branch.
3. The N1 arms of the Reproduction, run on the branch, read the focus the answer sets. The test
   that asserts it fails on `580dabbe`'s `History.tsx`, and passes on the branch.
4. "the button reports whether its control is open, and takes focus back when it closes (lg-95)"
   and "a save whose re-read fails closes the control ..." in `web/test/history.test.tsx` still
   pass, unchanged, or the answer says why they change.
5. Any visible text or control the answer adds to History is covered by the History case of
   `tools/ledger/e2e/layout.spec.ts` at 360 px and at desktop width.
6. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-11-01 — Filed at the owner's choice, from lg-95's gate 2 (PASS at `f6e06db1`), which
  left F2's remaining clause and N1 as lows. The options were: file one ticket for both (chosen,
  the orchestrator's recommendation); record both; fix now with a third gate. Filed on
  `580dabbe`, `origin/main` at filing. No code changed: the commit adds this file only. Status
  is `needs-decision` because both remedies are the owner's to choose.
- 2026-11-01 — Reproduced on `origin/main` at `580dabbe`, before filing. Gate 2's two probe
  specs were copied into `tools/ledger/web/test/`, run with `npx vitest run` against the
  worktree's source, and removed; `git status --short` was empty after the removal. The probes
  log what the screen shows and assert nothing, so exit 0 means they ran; the record lines
  below are the reading.
  - `zz-gate2-lg95.test.tsx`: `Test Files 1 passed (1)`, `Tests 7 passed (7)`, exit 0.
    - `reread-fails`: `classifyCalls` 1, `rowsCalls` 2, alert "The change was saved, but the
      list could not be read again. Down.", status "R is now sam · Current expenses.",
      `expanded` "false", row text "...alex · Current expenses...".
    - `reread-fails-reopen`: `person` "alex", `bucket` "current-expenses".
    - `reread-ok` (the control): row text "...sam · Current expenses...";
      `reread-ok-reopen`: `person` "sam".
  - `zz-gate2-lg95-n1.test.tsx`: `Test Files 1 passed (1)`, `Tests 2 passed (2)`, exit 0.
    - `N1-no-focus-on-click`: `beforeTag` "BODY", `aExpanded` "false", `bExpanded` "true",
      `focusIsA` true, `focusIsB` false.
    - `N1-focus-on-click`: `focusIsA` false, `focusIsB` true.
  - Both defects reproduce on `origin/main`.
- 2026-11-01 — The gap in lg-95's tests, found while reading them for this ticket: "a save whose
  re-read fails closes the control ..." asserts that Save has gone and that `classifyRow` was
  called once. It does not reopen the control, so no test in the repo fails on F2's remaining
  clause. Not changed here: the test is lg-95's, and the fix is the owner's to choose.
- 2026-11-01 — Not measured, as the gate left it: whether the page scrolls to row A on N1, and
  the Safari and iOS focus behaviour, which rests on MDN's table and was not run in Safari.
- 2026-11-01 — Id moved from lg-98 to lg-99 before the push, because a peer's lg-98 (`lg-98-tanstack-query-for-the-ledger-web.md`, `ready`) reached `origin/main` first, in #736 (`b9b1f0bf`). Rebased onto `origin/main` at `05a6d450`; the reproduction above still ran on `580dabbe`.
