---
id: lg-99
tool: ledger
title: A failed re-read offers the old answer again, and opening a row can move focus to another
kind: fix
status: done
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
  whose re-read fails closes the control ..." asserts the alert (three phrases), that Save has gone and one `classifyRow` call. It never
  reopens the control, so it passes with this defect in place.
- **N1.** `Refile`'s focus effect gives focus back to its own button whenever its control
  closes while focus sits on the page body. A browser that does not focus a button on click
  (Safari, per MDN's "Clicking and focus" section, which names Safari alone; read and not run in Safari) leaves
  the body focused when row B's button is clicked, so opening B while A's control is open
  sends focus to A's button. jsdom does not focus on click either, and the same steps there
  read `focusIsA: true`. Whether the page also scrolls up to A is not measured.

Both reproduce on `origin/main` at `580dabbe` (see the Log). The remedy for F2 is a design
choice the owner has not made, and N1's fix is not stated; both are open under Decision.

## Reproduction

Run from the worktree root on a farmed and built tree: `bash .claude/scripts/worktree-farm.sh`,
then `npm run build`, because the ledger web tests read `@ledger/contract` through its `dist`.
Never `npm install` there.

The probe is one file, `tools/ledger/web/test/zz-repro-lg99.test.tsx` (the name is yours to
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

Arm 1, no focus on click (the Safari behaviour, as MDN describes it):

1. Get A's and B's "Change who and what" buttons, each inside its own `listitem`.
2. Click A's button without calling `focus()` on it. Then click B's button, again without focusing it.
3. Assert: A's `aria-expanded` is `"false"`, B's is `"true"`, and `document.activeElement` is
   A's button. **The defect: A's button.** jsdom does not focus on click either, so this
   models the browser; it is not a run in Safari. The steps do not check scrolling.

Arm 2, focus before click (Chrome and Firefox):

1. Call `focus()` on A's button, then click it. Call `focus()` on B's button, then click it.
2. Assert: `document.activeElement` is B's button. This holds on `origin/main` today.

## Decision — answered 2026-11-07

Two questions, both answered by the owner on 2026-11-07, through AskUserQuestion at intake
(relayed in the build dispatch). Each answer is recorded under its question with the options it
was chosen from; `status` is `ready` in the commit that records them.

### 1. The remedy for F2 — answered: a

**Owner, 2026-11-07: option a** (the recommendation), chosen from a, b, c and d below. The row's
"Change who and what" button is disabled, with a line beside it, until a read replaces the list.

After a stored save whose re-read fails, what may the row offer?

- **a. Offer no change on that row until a read succeeds (recommended; the gate's direction).**
  The row's "Change who and what" button is disabled, with a line beside it saying the list
  has not been read since the change, and that a new read (a filter change or a reload) will
  bring the button back. Only a read that replaces the list clears it. Costs: one piece of per-row
  state; a person whose network is back must change a filter or reload before they can act
  on that row; until a read succeeds the row's text still shows the old answer beside the
  notice; the new line is visible text, so the History case of `layout.spec.ts` needs a new
  step for that state at 360 px: it deliberately never saves, so reaching a stored save then
  a failed read there takes `page.route` stubs on the save and on the re-read.
- **b. Keep the answer the save returned on the row.** `classifyRow` already returns the stored
  `ClassificationRecord` (`web/src/api/inbox.ts`). The row shows that record, and the control
  preselects it, until a read replaces it. Costs: the row is patched locally, which the lg-95
  Build ruled out ("Re-read the list afterwards; do not patch it locally"), so that Build
  sentence changes; the lg-95 test fails only if the patch replaces the re-read, and a patch
  beside the re-read passes it; the
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

### 2. The remedy for N1 — answered: a

**Owner, 2026-11-07: option a** (the recommendation), chosen from a, b and c below. Focus is
restored only when the row's own Cancel or Save closed its control.

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

Written from the recommended options, 1a and 2a. The owner answered 1a and 2a on 2026-11-07,
so it stands as written.

1. F2, option 1a: in `web/src/history/History.tsx`, mark a row whose save is stored but unread
   (set when `classifyRow` succeeds, cleared by the next read that replaces the list), and disable
   that row's button with its line. Test in `web/test/history.test.tsx`: after the F2 steps, the
   button is disabled and the control cannot open; a read that replaces the list (a filter
   change or a reload) clears both, and `showMore`'s append does not.
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

## Review

**Gate: FAIL** — 2026-11-07 · `1eafa0c6..191f8927` · Opus 5.5, depth full

| Done when                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Both answers recorded with their options; `status: ready` in that commit                                 | **verified** by reading `1ee7cc08`'s diff: question 1 "answered: a" (from a–d), question 2 "answered: a" (from a–c), owner and date named, `status: needs-decision` → `ready` in the same commit; matches the intake answers the dispatch carries (F2 1a, N1 2a)                                                                                                                                                                                                                           |
| 2. F2 steps show the answer's behaviour; the test fails on `580dabbe`'s `History.tsx`, passes on the branch | `web/test/history.test.tsx` › "a stored save whose re-read fails disables that row's button, with a line, until a read replaces the list (lg-99)" ✓ — asserts disabled, the line, the control will not open, Show more leaves the mark, a filter read clears it and preselects `sam`. Red alone on the base's `History.tsx` (identical to `580dabbe`'s), green on head; red alone under three plants (filter clear removed, Show more clears, `disabled` removed)                          |
| 3. N1 arms read the focus the answer sets; the test fails on `580dabbe`, passes on the branch               | `web/test/history.test.tsx` › "opening row B while row A's control is open does not send focus to A when the click focuses nothing (lg-99)" ✓ — red alone on base, green on head, red alone with `closedByOwn.current &&` removed. Arm 2, "… leaves focus on B when the click focuses the button (lg-99)", is green on both, as the Reproduction says it is today. The no-focus-on-click browser is jsdom's click, which is what the Reproduction's own arm 1 specifies; graded as written |
| 4. lg-95's two named tests still pass, unchanged                                                            | **verified** — the test-file diff is one hunk appended after the last test, 0 deleted lines; both pass, 21 of 21 in the file. See F1: the focus test passes on head while the Save half of what it asserts is broken in Chromium                                                                                                                                                                                                                                                           |
| 5. New visible text in the History case of `layout.spec.ts` at 360 px and desktop                           | `e2e/layout.spec.ts` › "History fits a phone and a desktop with a stored change whose re-read failed" ✓ — `e2e` (ledger) SUCCESS at `191f8927`; also run here on port 8303, 1 passed, both screenshots opened: the line wraps inside the row, no sideways scroll                                                                                                                                                                                                                           |
| 6. `npm run check` and `npm test -- --project ledger` pass                                                  | `npm run check` exit 0 here; `check` (CI) and `test (ubuntu-latest)` (CI) SUCCESS at `191f8927`. The ledger project was not re-run locally                                                                                                                                                                                                                                                                                                                                                 |

- **high** · F1 · no `Done when` line of lg-99 depends on it by its words; Done when 4's
  intent does · A successful Save no longer gives focus back to the row's button in a real
  browser. `refile` adds the row to `unread` before the re-read, so when the control closes
  the button is already `disabled`, `Refile`'s effect calls `focus()` on a disabled button
  (a no-op), and spends `closedByOwn`; nothing restores focus when the re-read succeeds and
  the button is enabled again. Chromium, the layout seed, Save stubbed, re-read real: head
  `active=BODY` at 0 ms and 400 ms re-read delay, base `active=BUTTON:Change who and what: …`
  at both. jsdom with the re-read deferred: head `BODY` in both arms, base the button. lg-95's
  "the button reports whether its control is open, and takes focus back when it closes"
  passes only because its mocks resolve in one batch with the close, so a test passes while
  the claim it asserts is broken; `Refile`'s comment ("Only when this row's own Cancel or
  Save closed it") promises a restore the code does not make for Save. The same early mark
  shows the "has not been read since this change … Change a filter or reload" line, and a
  disabled button, for the length of every successful re-read. The branch's Log says focus
  falls to the page only when the re-read fails. Direction, not a remedy (unrun): mark the
  row only when the re-read fails, or keep the claim until the re-read settles.
- **low** · F2 · no `Done when` line depends on it · After a Save whose re-read fails, focus
  falls to the page (base: to the then-enabled button). Forced by option 1a's `disabled`; no
  `Done when` line and nothing in Why rests on it, and the Log says so. Where focus should go
  (the alert, the line, or the page) is the owner's if F1's fix does not settle it.
- **low** · F3 · no `Done when` line depends on it · N1 survives inside a Save's latency: A
  open, A's Save clicked without focusing it, B clicked before `classifyRow` answers → focus
  goes to A's button (jsdom, `pending-other-nofocus active A`), because `closedByOwn` is set at
  the Save click, not by the close. Narrow window; the save's completion closes B's control
  anyway (pre-existing, base identical).
- **low** · F4 · `nfr:maintainability` · `history.test.tsx`'s `beforeEach` still uses
  `vi.clearAllMocks`, so a failing test leaves its `mockResolvedValueOnce` queue for the next:
  on base `History.tsx` the full file fails 4 tests where 3 fail alone (arm 2 passes alone);
  with `disabled` removed, 3 fail in the file and 1 alone.
- **low** · F5 · Closing a row's control with its own toggle button no longer restores
  focus in the no-focus-on-click arm (head `BODY`, base the button). What option 2a's words
  say ("only … Cancel or Save"); recorded, not a defect against the answer.
- **dropped** · a finished Save closes whichever control is open, another row's included
  (`setChanging(null)`); base identical, out of the reviewed range — worth a ticket.
- **dropped** · `refile`'s re-read uses the `key` captured at Save, so a filter change during a
  save is overwritten by the old query's rows; pre-existing, out of range.
- **dropped** · "a read path that replaces the list without clearing `unread`, or clears it
  without replacing the list": none. The filter/initial read and the save's re-read both
  replace and clear; Show more appends and keeps; a failed filter read shows no list and
  keeps the mark until a read succeeds (probed: 1a–1e all as the answer says).
- **findings** · the hunt returned 8; 5 carried, 3 dropped (two out of range, one refuted).
- Shuffle: the file whole and with `--sequence.shuffle` seeds 1–5, 21 of 21 each; no
  order-dependent result on head.
- Invariants: contract untouched, no `console`, no `any`, no new package or route; others
  (shell, SSRF, redaction, image closure) not reachable by the diff.
- NFR: security n/a · performance n/a · reliability — F1, F3 · maintainability — F4.

### Gate 2

**Gate: FAIL** — 2026-11-07 · `191f8927..42446ded` · Opus 5.5, depth medium

This gate's ids are `N1` to `N4`. They are not the ticket's N1, which is lg-95's gate 2 finding about focus.

| Done when                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Both answers recorded with their options; `status: ready` in that commit                                 | **verified**: the round's ticket diff only adds Log lines (55 added, 0 deleted), so gate 1's reading of the Decision still holds                                                                                                                                                                                                                                                                                   |
| 2. F2 steps show the answer's behaviour; the test fails on `580dabbe`'s `History.tsx`, passes on the branch | `web/test/history.test.tsx` › "a stored save whose re-read fails disables that row's button, with a line, until a read replaces the list (lg-99)" ✓. It is red alone on the base's `History.tsx` and under the plants `f2clear`, `f2more` and `f2disabled`, and green on the head. The F2 steps wait for the re-read to reject before they click again. See N1 for a click made while the re-read is still running |
| 3. N1 arms read the focus the answer sets; the test fails on `580dabbe`, passes on the branch               | `web/test/history.test.tsx` › "opening row B while row A's control is open does not send focus to A when the click focuses nothing (lg-99)" ✓. It is red alone on the base and under the `n1` plant. Arm 2 is green, as the Reproduction says it should be                                                                                                                                                         |
| 4. lg-95's two named tests still pass, unchanged                                                            | **verified**: in this round the test file only gains lines (42 added, 0 deleted), and 23 of 23 tests pass. "… takes focus back when it closes (lg-95)" now fails in the full file when the focus restore is planted out. Gate 1's F1 note on this line is resolved                                                                                                                                                 |
| 5. New visible text in the History case of `layout.spec.ts` at 360 px and desktop                           | `e2e/layout.spec.ts` › "History fits a phone and a desktop with a stored change whose re-read failed" ✓. `e2e` (ledger) is SUCCESS at `42446ded`. It also passed here on port 8303, and I opened the 360 px screenshot: the line wraps inside the row                                                                                                                                                              |
| 6. `npm run check` and `npm test -- --project ledger` pass                                                  | `check` (CI) and `test (ubuntu-latest)` (CI) are SUCCESS at `42446ded`, and so are all 10 checks on the head                                                                                                                                                                                                                                                                                                       |

Gate 1's findings:

- **F1 (high): fixed.** Gate 1's Chromium probe now reads the button on the head, at 0 ms and 400 ms (`head delay=0 active=BUTTON:Change who and what: …`), where it read `BODY` at `191f8927`. Gate 1's jsdom probe reads `reread-ok-*`: the button is not disabled and has focus, both while the re-read is pending and after it. The new test goes red, alone and in the full file, under each plant the dispatch named:
  - early mark restored: 2 of 2 fail at the focus assertion;
  - focus restore removed: 2 of 2 fail at the focus assertion, and lg-95's focus test fails too;
  - line always shown: 2 of 2 fail at the line assertion.

  The disabled assertion is live only depending on timing (N3).

- **F2 (low): recorded, and the reading holds in Chromium.** After a failed re-read on the head, Chromium reads `pending=BUTTON … after=BODY disabled=true` at 400 ms, and `after=BODY` at 0 ms. jsdom keeps focus on the disabled button. See N4.
- **F3 (low): not fixed, recorded as the owner chose.** `pending-other-nofocus active` still reads A's button.
- **F4 (low): not fixed, recorded.** On the base's `History.tsx`, the full file fails 4 tests while 3 fail alone.
- **F5 (low): not fixed, recorded.** `toggle-nofocus active "BODY"`.
- The Log records all five answers and the separate filing. I did not verify the filing, which is not on this branch.

New findings, in the lines this round touched:

- **high** · N1 · Done when 2's answer (1a, "Offer no change on that row until a read succeeds") depends on it; its literal F2 steps do not.
  - **What happens:** the row's button is now enabled while the re-read runs, so the control can be reopened during the re-read, and it preselects the old answer. When that re-read then fails, the row is marked: the button is disabled and the line shows. But the control stays open, Save is enabled and `alex` is still selected.
  - **Result:** a second Save sends `{"rowId":1,"personId":"alex","bucket":"current-expenses"}`, and the notice reads "R is now alex · Current expenses.". That is the ticket's own F2 defect, now reached through a click made during the re-read.
  - **On `191f8927`** the button was disabled during the re-read, so the control could not reopen.
  - **Why it is high:** the `unread` comment says the row "offers no change until a read replaces the list". The shipped line says it "can be changed again" only after a filter change or reload. Beside an open control with Save enabled, both are false in the unsafe direction.
  - Gate 1's direction (a) included closing that row's control if it was reopened during the re-read. The round left that clause out.
  - **Direction, run once:** in the `catch`, `setChanging((current) => (current === row.id ? null : current))`. It closes the reopened control, so Save is gone. It leaves another row's open control open. The file passes 23 of 23. Focus after that close was not measured. A test needs to reopen the control while the re-read is held, then reject it.
- **low** · N2 · no `Done when` line depends on it.
  - **What happens:** a filter change replaces the list while a save's re-read is still running, and then that re-read fails. The `catch` marks the row on a list that has just been read. The button is disabled and the line shows beside `sam · Current`.
  - **On `191f8927` and the base:** not disabled, no line.
  - **Why it is low:** the line is false in the safe direction. The row offers less, and the way out the line names works.
  - **Same cause:** the re-read has no check that the list was replaced since it was sent. The pre-existing overwrite gate 1 dropped (a successful re-read replaces a newer query's list) has the same cause.
- **low** · N3 · `nfr:maintainability` · The new test checks the pending state in a single moment.
  - **Plant:** the button disabled by an effect one render after the focus restore.
  - **Result:** the test passes alone (2 of 2) and fails in the full file (2 of 2), failing at the disabled assertion. So "nothing says it is unread while the re-read runs" is held by timing.
- **low** · N4 · The Log says "the gate's F2 is a Chromium reading". Gate 1 measured F2 in jsdom. Its Chromium probe covered only a successful re-read. This gate's Chromium reading agrees with F2, so nothing relies on the error.
- **dropped** · Another row's control (B) opened during A's re-read, after which A's re-read fails. B stays open and enabled, and A is marked. This is correct.
- **dropped** · In jsdom, focus stays on a button after it becomes disabled. That is jsdom behaviour; Chromium gives `BODY`. It is recorded under F2.
- **findings** · the hunt returned 6; 4 carried, 2 dropped.
- **Test runs:** the whole file passes 23 of 23. With `--sequence.shuffle`, seeds 1 to 5 each pass 23 of 23. The F2, N1-arm and refused-Save tests behave the same alone and in the file, as gate 1 recorded.
- **Invariants:** no `any`, no `console`, contract untouched. Shell, SSRF, redaction and image closure cannot be reached by the round.
- **NFR:** security n/a · performance n/a · reliability — N1, N2 · maintainability — N3.

### Gate 3

**Gate: CONCERNS** — 2026-11-07 · `42446ded..06adad74` · Opus 5.5, depth narrow (N1's fix only)

Gate 3 raises no new findings, so none of its ids is used. In its full report, P1 to P6 are probe cases, not findings.

| Done when                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Answers recorded with their options; `status: ready`                         | **verified**: this round's ticket diff adds 57 lines and deletes none, and `status: ready` is unchanged at the head                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2. F2 steps show the answer's behaviour; red on `580dabbe`, green on the branch | `web/test/history.test.tsx` › "a stored save whose re-read fails disables that row's button, with a line, until a read replaces the list (lg-99)" ✓. It passes alone (`1 passed \| 24 skipped (25)`) and in the full file (`25 passed (25)`). The click made during the re-read, which gate 2 raised as N1, is now proven by "a re-read that fails closes the control that was reopened while it ran (lg-99)" ✓. That test is red alone and in the file on `42446ded`'s `History.tsx`, at `expected 'true' to be 'false'` |
| 3. N1 arms read the focus the answer sets                                       | `web/test/history.test.tsx` › "opening row B while row A's control is open does not send focus to A when the click focuses nothing (lg-99)" ✓, in the full file (`25 passed (25)`). The round only adds 4 lines inside `refile`'s `catch`, so gate 2's red readings on the base still apply. I did not re-run them                                                                                                                                                                                                        |
| 4. lg-95's two named tests still pass, unchanged                                | **verified**: "… takes focus back when it closes (lg-95)" and "a save whose re-read fails closes the control … (lg-95)" each pass alone (`1 passed \| 24 skipped (25)`) and in the full file (`25 passed (25)`). The round's test diff deletes 0 lines                                                                                                                                                                                                                                                                    |
| 5. New visible text covered in the History layout case                          | `e2e/layout.spec.ts` › "History fits a phone and a desktop with a stored change whose re-read failed" ✓, because `e2e (ledger)` is SUCCESS at `06adad74`. The round adds no text and no control                                                                                                                                                                                                                                                                                                                           |
| 6. `npm run check` and `npm test -- --project ledger` pass                      | `check` (CI) and `test (ubuntu-latest)` (CI) are SUCCESS at `06adad74`, along with all 10 checks on the head                                                                                                                                                                                                                                                                                                                                                                                                              |

Gate 2's findings:

- **N1 (high): fixed in part.**
  - **The failed re-read is fixed.** I re-ran gate 2's `zz-gate2-lg99.test.tsx` on the head. G1 reads: `after-fail expanded "false"`, `save null`, `select null`, `disabled true`, `line true`. No second Save is sent. G3 reads: B's control stays open (`bExpanded "true"`, `bSave true`).
  - **The new tests catch the regressions.** The first new test is red on `42446ded`'s `History.tsx`. The second is red, alone and in the file, under an unconditional `setChanging(null)` plant.
  - **Chromium, a control reopened during a held re-read that then fails:** the control closes, there is no Save, and focus is on `BODY`. That holds with focus on the button and with focus on the "Belongs to" select. It is the same as gate 2's `BODY` reading for a failed re-read that was not reopened, so it is not a finding.
  - **What remains: the successful re-read**, the same mechanism (the control can be reopened during the re-read, and it preselects the old answer).
    - When the re-read succeeds, the reopened control stays open with `alex` selected, while the row now reads `sam · Current`. Save is enabled again.
    - A Save sends `{"rowId":1,"personId":"alex","bucket":"current-expenses"}`, and the notice reads "R is now alex · Current expenses." (probe P4).
    - The same happens on `42446ded`. On `191f8927` it could not happen, because the button was disabled during the re-read.
  - **Grading of what remains: `med`.** No `Done when` line depends on it. Answer 1a covers the failed read, and here the read succeeded. No shipped text is false here: the row is not marked, and the notice states what was stored. That is why this clause is not graded `high` as N1 was. A person still has to act within the re-read's window to reach it. Whether to fix it is put to the owner below.
- **N2 (low): not fixed, recorded unfixed as the owner chose.** The fix adds one more consequence through the same cause (probe P5). The sequence:
  1. A filter read replaces the list during A's re-read.
  2. A's control is reopened on the fresh list, where it correctly preselects `sam`.
  3. A's stale re-read then fails.

  The stale `catch` then closes that control as well as marking the row. This errs on the safe side: Save in that control was disabled while `saving`, so nothing could be sent from it.

- **N3 (low): not fixed, recorded as the owner chose.**
- **N4 (low): fixed.** The Log quotes the sentence from round 1's entry that begins "Round 1, gate 1's probe", and that sentence is there as quoted. The Log says gate 1's F2 was measured in jsdom and that gate 2's Chromium reading agrees with it. N2 and N3 are recorded unfixed, with the owner's answer.

Findings:

- **dropped** · A sequence of reopen, close, reopen (by the row's button, or by Cancel), then a failed re-read: the control closes and `classifyRow` is called once (P1, P2). Not a defect.
- **dropped** · A selection changed in the reopened control is discarded when the control closes (P3). Save was disabled while `saving`, so nothing could be sent from that control, and the owner's answer 1a closes it. This follows from the owner's decision; it is not a defect.
- **dropped** · Two of A's re-reads cannot overlap. Save is disabled in every row while `saving`. A click on the reopened Save sends nothing (P6: `classifyRow` 1, `fetchRows` 2).
- **dropped** · `closedByOwn` is not left set after a Cancel during the re-read. The `Refile` effect clears it whenever `open` is false, and a reopen while `saving` does not set it. The jsdom reading meant to show this (P2's B toggle) proves nothing: focus never left the disabled button. This conclusion rests on reading the code. Chromium was not measured for the Cancel path.
- **findings** · the hunt returned 6. 1 was carried, as N1 `fixed in part`. 1 was folded into N2. 4 were dropped.
- **Test runs:** the file passes 25 of 25. With `--sequence.shuffle`, seeds 1 to 3 each pass 25 of 25. Gate 2's probe passes 6 of 6. My probe passes 8 of 8 on the head and on `42446ded`.
- **Invariants:** no `any`, no `console`, contract untouched. Shell, SSRF, redaction and image closure cannot be reached by 4 lines in a React `catch`.
- **NFR:** security n/a · performance n/a · reliability: N1's success-path clause, N2 · maintainability ✓

## Log

- 2026-11-01 — Filed at the owner's choice, from lg-95's gate 2 (PASS at `f6e06db1`), which
  left F2's remaining clause and N1 as lows. The options were: file one ticket for both (chosen,
  the orchestrator's recommendation); record both; fix F2 now, with a third gate. Filed on
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
  the Safari focus behaviour, which rests on MDN's "Clicking and focus" section and was not run in Safari.
- 2026-11-01 — Id moved from lg-98 to lg-99 before the push, because a peer's lg-98 (`lg-98-tanstack-query-for-the-ledger-web.md`, `ready`) reached `origin/main` first, in #736 (`b9b1f0bf`). Rebased onto `origin/main` at `05a6d450`; the reproduction above still ran on `580dabbe`.
- 2026-11-01 — Owner's answer, relayed by the orchestrator, to gate 1's CONCERNS at `8bef87a5`
  (F1 med, F2 to F6 low). The options were: all six findings fixed at landing (the
  orchestrator's recommendation); F1 at landing with the lows recorded; treat F1 as high and run
  a gate 2. The owner chose all six at landing, with no re-gate.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F1 — "the Build and that test change together". Option 1b's cost now says the Build sentence changes and lg-95's test fails only if the patch replaces the re-read. Proof: `git diff 8bef87a5 HEAD -- tools/ledger/docs/work/lg-99-a-failed-re-read-offers-the-old-answer-and-moves-focus.md | grep -c '^-.*so the Build and that test change together'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F2 — "Any later successful read clears it". Option 1a and Build step 1 now say only a read that replaces the list clears the mark, and `showMore`'s append does not. Proof: same diff, `grep -c '^-.*Any later successful read clears it'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F3 — "the layout case covers that state at 360 px". Option 1a's cost now says the History case needs a new step, and that reaching a stored save then a failed read takes `page.route` stubs on the save and the re-read. Proof: same diff, `grep -c '^-.*so the layout case covers that state at 360 px'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F4 — "MDN's "Clicking and focus" table". Why, the Reproduction's Arm 1 and the Log's not-measured entry now say Safari alone and the section, not a table and not iOS. Proof: same diff, `grep -c '^-.*table, read and not run in Safari'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F5 — "asserts only that Save has gone". Why now lists the alert's three phrases, Save gone and one `classifyRow` call, and the filing entry now quotes lg-95's option C as "fix F2 now, with a third gate". Proof: same diff, `grep -c '^-.*asserts only that Save has gone'` → 1.
- 2026-11-01 — Fixed at landing by owner choice: gate 1, F6 — "zz-repro-lg98.test.tsx". The Reproduction's scratch file is now `zz-repro-lg99.test.tsx`. Proof: same diff, `grep -c '^-.*zz-repro-lg98'` → 1.
- 2026-11-01 — Gate 1's full report is on the pull request thread, #742; status unchanged.
- 2026-11-07 — Owner's answers recorded under Decision, F2 option a and N1 option a, chosen from
  the options listed there (commit `1ee7cc08`); status `ready`. Built from the base
  `1eafa0c6`, not `580dabbe`.
- 2026-11-07 — Reproduction re-run on `1eafa0c6`'s `History.tsx`, before the source changed. The
  five new tests in `web/test/history.test.tsx` were run one at a time with
  `npx vitest run tools/ledger/web/test/history.test.tsx -t "<name>"` (run together, a failing
  F2 test leaves its `mockResolvedValueOnce` queue behind, and `vi.clearAllMocks` does not drop
  it, so the next tests fail on the leftover and not on the defect): F2 ("a stored save whose
  re-read fails disables ...") failed at `expect(button.hasAttribute("disabled")).toBe(true)`,
  the row's button enabled; N1 arm 1 ("does not send focus to A when the click focuses
  nothing") failed at `expect(document.activeElement).not.toBe(a)`; N1 arm 2 ("leaves focus on B
  when the click focuses the button") passed, as the ticket says it does today; "a refused Save
  leaves no claim on focus ..." failed at `not.toBe(a)`. Both defects reproduce on the base.
- 2026-11-07 — Built, option 1a: `History` keeps `unread`, the row ids whose change `classifyRow`
  stored and whose list has not been read since. A row in it gets `disabled` on its "Change who
  and what" button and a `muted hint` line, tied to the button with `aria-describedby`: "The
  list has not been read since this change, so this row shows the old answer. Change a filter
  or reload the page, and it can be changed again." The set empties when a read replaces the
  list (the filter-change read and the save's own re-read); `showMore`'s append leaves it, and
  the test asserts that with a second row whose button is enabled. Option 2a: `Refile` sets a
  `closedByOwn` ref in its own Cancel and in its Save's `onAnswer`, and its focus effect now
  needs that ref and focus on the body. The ref is spent when the control is closed and cleared
  on opening and when a Save was refused (`!open || !saving`), so a later close by another row
  does not read as this row's own. Tests, `web/test/history.test.tsx`, 21 of 21 together once the
  source was built; "a refused Save leaves no claim ..." is the one that pins the clearing.
- 2026-11-07 — What the brief had wrong. Build step 2 says arm 1 leaves "focus on B's button":
  in jsdom, and in a browser that does not focus on click, nothing focuses B's button, so arm 1
  reads `document.body` and arm 2 (focus before click) reads B's button; the test asserts those.
  Done when 3 reads "the focus the answer sets", and what stands in for a Safari reading is
  jsdom's click, which does not focus a button: a model of the behaviour MDN's "Clicking and
  focus" section gives for Safari, not a run in Safari. Whether the page also scrolls was not
  measured. Also not changed: when a Save closes a control and the row goes `unread`, focus is
  handed to a button that is now disabled, which a browser does not honour, so focus falls to
  the page; the notice (`output`) is the thing a person reads next. Not measured in a screen
  reader.
- 2026-11-07 — The layout case. `e2e/layout.spec.ts` ends with "History fits a phone and a
  desktop with a stored change whose re-read failed": the save is answered by a `page.route`
  stub, so the seed keeps its answers, and every read after the control opens is aborted. It
  asserts the alert, the disabled button and the line, then `fitsBothWidths`; screenshots at
  360 and 1280 px opened, the line wraps inside the row in four lines at 360 px.
  `E2E_PORT=8203 npx playwright test -c tools/ledger/playwright.config.ts layout.spec.ts -g
  History` → `3 passed (11.4s)`.
- 2026-11-07 — `npm run check` exit 0; `npm test -- --project ledger` exit 0, `Test Files 99
  passed (99)`, `Tests 2198 passed (2198)`. lg-95's two named tests are unchanged:
  `git diff -U0 tools/ledger/web/test/history.test.tsx | grep -c '^-[^-]'` → 0, the new tests
  are appended.
- 2026-11-07 — Fold-in: considered none. The lg-95 test gap this ticket's Why names (no test
  reopens the control) is closed by the new F2 test, which reopens the control after the
  filter-change read.
- 2026-11-07 — Gate 1 (Opus 5.5) FAILed `191f8927` on one high, F1, and four lows (F2 to F5;
  full report on the pull request thread). Owner's answers, through AskUserQuestion, relayed in
  round 1's dispatch:
  1. **F1's fix.** Chosen: **a, mark the row only after its re-read fails**, so lg-95's restore
     works unchanged and a successful re-read shows no disabled button or line (the gate's
     recommendation). Not chosen: b, keep the early mark and hold the focus restore until the
     re-read settles.
  2. **F2** (after a failed re-read, focus falls to the page; on the base it went to the
     then-enabled button). Chosen: **a, leave focus on the page and record it** (the gate's
     recommendation). Not chosen: b, move focus to the new line or the alert with
     `tabindex="-1"`.
  3. **F3, F4 and F5: record all three, unfixed** (the orchestrator's recommendation). Not
     chosen: also fix F3 in this round; fix F3 and F4 in this round.
  4. **The defect outside the range** (a finished Save closes whichever control is open,
     another row's included, `setChanging(null)`; identical on the base): the owner chose to
     file it as a ticket, filed separately by the orchestrator. Not fixed or filed here.
     Recorded unfixed, as the owner chose: F3, `closedByOwn` is set at the Save click, so with A's
     Save clicked without focus and B opened before `classifyRow` answers, focus goes to A's
     button; F4, `beforeEach` uses `vi.clearAllMocks`, which leaves a failing test's
     `mockResolvedValueOnce` queue for the next test, so the full file fails more tests than each
     does alone; F5, in a browser that does not focus on click, closing a row with its own toggle
     button no longer restores focus, which is option 2a's own wording ("only ... Cancel or
     Save").
- 2026-11-07 — Round 1, F1 fixed by answer 1a: `refile` marks the row `unread` in the `catch`
  of its re-read, no longer when `classifyRow` returns. The earlier entries above that say the
  mark is set when the save is stored, and that focus is handed to a disabled button after a
  save, describe `191f8927` and are superseded: now the button is enabled while the control
  closes, so the restore works, and a successful re-read shows no disabled button and no line.
  Test, appended to `web/test/history.test.tsx`, in two arms: "after a stored save whose
  re-read is still running, focus is on the row's button and nothing says it is unread,
  focused (lg-99)" and the same "... unfocused (lg-99)". The re-read is a pending promise
  released after the close, so the test cannot pass by the close and the re-read landing in
  one render; it asserts, with `fetchRows` called twice and the control closed, that
  `document.activeElement` is the button, the button is not disabled and no "has not been
  read since" text shows, then releases the re-read and asserts the same again with the new
  answer on the row. Red on `191f8927`'s `History.tsx`, both arms (`npx vitest run
  tools/ledger/web/test/history.test.tsx -t "re-read is still running"` → `Tests 2 failed | 21
  skipped (23)`), at the focus line: `expected <body> ... to be <button ...>`. Green on the
  fix: `Tests 23 passed (23)` for the file.
- 2026-11-07 — Round 1, gate 1's probe `zz-gate1-lg99.test.tsx`, copied unchanged into
  `web/test/`, run, removed (`git status --short` showed only the two edited files after):
  `Tests 22 passed (22)`, exit 0; it logs and asserts nothing. The readings that moved: a save
  whose re-read succeeds after a delay, `reread-ok-nofocus` and `reread-ok-focus`, read
  `disabled false` and `active BUTTON:Change who and what: R, 2026-10-10` both while the
  re-read is pending and after it (gate 1 on `191f8927`: `BODY`); a re-read that fails reads
  `disabled false` while pending, `disabled true` after. The unchanged ones: `other-nofocus
  active BODY`, `refused-other-nofocus active BODY`, `pending-other-nofocus active` row A's
  button (F3), `toggle-nofocus active BODY` (F5). In jsdom, `document.activeElement` stays on
  a button that becomes disabled (`reread-fail-* after active` the button); the gate's F2 is a
  Chromium reading, which was not re-measured here.
- 2026-11-07 — Round 1 checks on the fix: `npx oxlint tools/ledger/web tools/ledger/e2e` exit
  0; `npm run check` exit 0; `E2E_PORT=8203 npx playwright test -c
  tools/ledger/playwright.config.ts layout.spec.ts -g History` → `3 passed (8.4s)`;
  `npm test -- --project ledger` exit 0, `Test Files 99 passed (99)`, `Tests 2200 passed
  (2200)`.
- 2026-11-07 — Gate 2 (Opus 5.5) FAILed `42446ded` on one high, N1, and three lows (N2 to N4;
  its ids are its own, not lg-95's N1; full report on the pull request thread). Owner's answers,
  through AskUserQuestion, relayed in round 2's dispatch:
  1. **N1** (after a stored save, the row's button is enabled while the re-read runs, so the
     control can be reopened during it and preselects the old answer; when the re-read then
     fails the row is marked, but the control stays open with Save enabled, and a second Save
     sends the old answer). Chosen: **a, close that row's control in the `catch`, only if it is
     that row's**, so another row's open control stays open (the gate's recommendation). Not
     chosen: b, leave the control open and disable Save while the row is unread.
  2. **The lows.** Chosen: **fix N4, record N2 and N3 unfixed** (the orchestrator's
     recommendation). Not chosen: fix N4 and N3, record all three.
  3. **N4**, the correction. Round 1's last-but-one entry (the one that begins "Round 1, gate
     1's probe") ends: "the gate's F2 is a Chromium reading, which was not re-measured here."
     Gate 1 measured F2 in jsdom, where focus stays on a button that becomes disabled; its
     Chromium probe covered only a successful re-read. Gate 2's Chromium reading of a failed
     re-read agrees with F2 (`after=BODY disabled=true` at 400 ms), so nothing relied on the
     error. This entry supersedes that sentence; the earlier entry is left as written.
  4. **Recorded unfixed, as the owner chose.** N2: a filter change replaces the list while a
     save's re-read is still running, and that re-read then fails; the `catch` marks the row on
     a list that was just read, so its button is disabled with the line beside it (on
     `191f8927` and the base it is not). The line is false in the safe direction; the cause is
     that the re-read does not check whether the list was replaced since it was sent, the
     cause of the older overwrite gate 1 dropped. N3: the new "re-read is still running" test
     checks the pending state at one moment, so with a plant that disables the button by an
     effect one render after the focus restore it passes alone (2 of 2) and fails in the full
     file (2 of 2).
- 2026-11-07 — Round 2, N1 fixed by answer 1a: the `catch` of `refile`'s re-read now also runs
  `setChanging((current) => (current === row.id ? null : current))`, so a control reopened on
  the old answer while the re-read ran closes with the mark, and another row's open control is
  left alone. Tests, appended to `web/test/history.test.tsx`: "a re-read that fails closes the
  control that was reopened while it ran (lg-99)" holds the re-read, reopens the row's control
  (`aria-expanded` "true", "Belongs to" reads `alex`, Save disabled because `saving` is true
  until the re-read settles), rejects the re-read, and asserts the button disabled, the control
  closed, no Save, and one `classifyRow` call; "a re-read that fails leaves another row's control
  open (lg-99)" opens row B during row A's re-read and asserts B still open and enabled, with
  Save, after the rejection. On `42446ded`'s `History.tsx`, the first is red alone and in the
  full file (`Tests 1 failed | 24 skipped (25)`; `1 failed | 24 passed (25)`) at
  `expect(button.getAttribute("aria-expanded")).toBe("false")`: `expected 'true' to be 'false'`.
  The second passes there, as it must: it guards against closing too much, and goes red
  (`expected 'false' to be 'true'`, alone) under a plant that makes the `catch` call
  `setChanging(null)` unconditionally, restored from the fix commit. On the fix: both pass alone
  and `Tests 25 passed (25)` for the file. Focus after that close was measured, not changed:
  nothing restores it, because `closedByOwn` is false for a close the re-read causes. In jsdom
  `document.activeElement` stays where it was, the row's own button, now disabled (a temporary
  assertion, removed); gate 2's `zz-gate2-lg99.test.tsx` agrees (`G4 ... after-fail active
  BUTTON:..., disabled true`). Chromium drops focus from a disabled button to the page (gate 2's
  reading for the failed re-read without a reopen); not measured here for the reopened case.
- 2026-11-07 — Round 2, gate 2's probe `zz-gate2-lg99.test.tsx`, copied unchanged into
  `web/test/`, run on the fix, removed: `Tests 6 passed (6)`, exit 0. Its N1 reading
  (`G1`) reads `pending reopen expanded "true"`, `pending reopen select "alex"`, then after the
  failure `disabled true`, `expanded "false"`, `line true`, `save null`, `select null`: the
  control is closed and Save is gone, where gate 2 read Save enabled with `alex` selected. `G3`
  reads B's control still open after A's failure (`bExpanded "true"`, `bSave true`).
- 2026-11-07 — Round 2 checks on the fix: `npm run check` exit 0; `npm test -- --project
  ledger` exit 0, `Test Files 99 passed (99)`, `Tests 2202 passed (2202)`. The layout case was
  not re-run: the round adds no visible text or control. N2 and N3 stay unfixed, as recorded
  above.
- 2026-11-07 — Owner's answer on gate 3's N1 (the successful re-read), through the
  orchestrator's AskUserQuestion at landing. Gate 3 (CONCERNS at `06adad74`) found the failed
  re-read fixed and one case left: during a re-read that succeeds the row's button is enabled,
  so the control can be reopened on the old answer (`AnswerControls` keeps the person and
  bucket it opened with, and the row is `<li key={row.id}>`), and it stays open with `alex`
  selected while the row reads `sam · Current`; a Save then files `alex` again. Graded `med`,
  below the severity floor: no `Done when` line depends on it. The options were: fix it at
  landing by gate 3's option (a), with no re-gate (chosen, the orchestrator's recommendation);
  fix it, then run a narrow gate 4; record it and add it to lg-103's brief; record it only.
  Option (a): in `refile`'s success path, after the re-read replaces the list, run
  `setChanging((current) => (current === row.id ? null : current))`.
- 2026-11-07 — Fixed at landing by owner choice: gate 3, N1 — "in `refile`'s success path, also
  run `setChanging((current) => (current === row.id ? null : current))`". Tests, appended to
  `web/test/history.test.tsx`: "a re-read that succeeds closes the control that was reopened
  while it ran (lg-99)", red at `06adad74`'s `History.tsx` and green with the fix; and "a
  re-read that succeeds leaves another row's control open (lg-99)", which guards the condition.
- 2026-11-07 — The landing fix's readings, after `88bccb28`, `npx vitest run
  tools/ledger/web/test/history.test.tsx`. The first test is "a re-read that succeeds closes the
  control that was reopened while it ran (lg-99)": it holds the re-read, reopens the row's
  control (`aria-expanded` "true", "Belongs to" reads `alex`, Save disabled while `saving`),
  resolves the re-read with `sam`, and asserts the button `aria-expanded` "false", no "Belongs to",
  no Save, the button enabled and one `classifyRow` call.
  - Red on `06adad74`'s `History.tsx`, test added alone: `-t "a re-read that succeeds closes"`
    gives `Tests 1 failed | 26 skipped (27)`, and the whole file `Tests 1 failed | 26 passed
    (27)`, at `expect(button.getAttribute("aria-expanded")).toBe("false")`: `Expected: "false"`,
    `Received: "true"`.
  - Green with the fix: that test and its guard alone, `Tests 2 passed | 25 skipped (27)`; the
    whole file `Tests 27 passed (27)`, which holds lg-95's tests, the existing lg-99 tests and
    the two new ones.
  - The guard, "a re-read that succeeds leaves another row's control open (lg-99)", passes on
    `06adad74` as it must, and is red (`Expected: "true"`, `Received: "false"`, `Tests 1 failed |
    26 skipped (27)`) when the success path's line is changed to an unconditional
    `setChanging(null)`, restored from `88bccb28`.
  - P4 is on `origin/main` (`1eafa0c6`) too, not only on the lg-99 branch: with `main`'s
    `History.tsx` in place, the first test is red alone, `Tests 1 failed | 26 skipped (27)`,
    `Expected: "false"`, `Received: "true"`. `main` never disables the button during the
    re-read, so it was reachable there; the early mark of round 1 only hid it at `191f8927`.
  - Focus after this close was measured with a temporary assertion, removed: the row's own
    button, enabled (`FOCUS BUTTON same=true`), with the reopening click focusing it and with it
    not focusing it. Nothing restores it for this close (`closedByOwn` is false); the first
    close, from Save, hands focus back to that button (read from the code, not separately
    measured). Chromium and Safari with a reopen are not measured here.
