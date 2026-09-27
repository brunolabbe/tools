---
id: pl-48
tool: planner
title: Change a plan's dates or budget from the plan page, and prove it through a browser
kind: work-package
status: done
milestone: P4
depends_on: [pl-45, pl-46, pl-47]
difficulty: standard
---

# pl-48 — Change the dates or the budget on the page

**Packages:** `web`, against a mocked API client as
[pl-45](./pl-45-revise-and-read-the-diff.md) is, plus one step in
[pl-46](./pl-46-revise-through-the-browser.md)'s `e2e/revise.spec.ts`.

## Why

[pl-47](./pl-47-edit-the-dates-and-budget.md) makes dates and budget editable
over HTTP, and nothing on the page can send the request. Until something can,
§6's "add a day in Trieste" and "we cannot afford the second hotel" are
expressible only by a test. The owner cut the work this way on 2026-09-13:
pl-47 for `contract`, `itinerary` and `api`, then this ticket for the page.

The controls already exist. The wizard's date and budget fields are the ones a
traveller used to answer the intake, and a second implementation of either on
the plan page would drift from the first.

## Build

1. **Export `DatesEntry` and `BudgetEntry` from `web/src/wizard/controls.tsx`.**
   Both are module-private today, and both take `Omit<FieldProps, "question">`,
   so neither needs a tree node. Export them unchanged. `QuestionField` keeps
   using them.
2. **Widen pl-45's `startReplan`** to accept the `brief` member of
   `ReviseRequest` beside `replan`. Both answer `{ kind: "run" }`, so this stays
   one function typed to that response kind (pl-45's trap).
3. **A "Change the dates or budget" fieldset** on the latest revision only,
   beside pl-45's re-plan fieldset, and absent on older revisions for pl-45
   step 8's reason.
   - **Seeded from `currentBrief(plan)`** (pl-47), never from `plan.brief`,
     which is the first draft's. An answered slot seeds `initial`. A declined or
     unasked budget seeds `null`.
   - **Submit sends only what changed**, compared by value. It is disabled while
     nothing has.
   - **The copy beside it says what each change does**, in the page's words:
     - a longer trip plans the days it adds;
     - a shorter trip drops days from the end with what is on them, and
       "Restore this version" brings them back;
     - a pinned item on a dropped day stops the change;
     - a budget change re-packs every day except what is pinned.

     No confirmation dialog, for pl-45 step 4's reason: restore undoes it in one
     step.

   - On success, hand the `Run` to pl-45's `onReplan`, which shows `RunView`.
4. **Refusals** go through pl-45's synchronous banner:
   - `INVALID_DATES` renders its message, which names the failure (a past
     departure, a trip too long, a window too short).
   - `PLAN_INFEASIBLE` renders each `details.findings[].detail`, which pl-47's
     `pin-on-dropped-day` entry fills with the items. That is pl-45's existing
     path, and it needs no case of its own.
   - `REVISION_STALE` and `PLAN_BUSY` are pl-45's.
5. **The diff caption for a `brief` operation** names both ends, with
   `describeDates` and `describeBudget` from `web/src/wizard/format.ts`:
   `Dates: {from} → {to}` and `Budget: {from} → {to}`, and "not given" for a
   budget slot that was not answered. It goes beside pl-45's caption, never
   inside `p.crumb` (pl-45's trap).
6. **Read the shown revision's brief wherever the page reads a brief.**
   `PlanView.tsx` reads `plan.brief.shape` today. The shape cannot change, so
   this is about a single rule: after pl-47, "the brief" on the page means the
   shown revision's.
7. **`booking-deadline-passed` needs no code.** It arrives in `unchecked` with
   the server's copy, and the page has no per-kind label to add (checked at
   filing).
8. **One step in `e2e/revise.spec.ts`**, after pl-46's final reload:
   1. Open the fieldset and extend the trip by one night **through the Nights
      field**. `draftAPlan` answers the dates question in `open` mode
      (`e2e/intake-walk.ts`, "the one that needs no invented date"), so the
      plan's dates are `open`, and `DatesEntry` shows Nights and no date
      inputs. Read the value off the field and fill one more. Do not type a
      literal number either.
   2. Wait for the run's finished state and open the plan. The crumb's version
      count is one higher, and the page shows one more day heading than it did.
   3. Reload with `reopenFromTheList`, and assert both again.

   The suite's path and spec counts do not change: this is a step in pl-46's
   walk, not a spec.

## Traps

- **`plan.brief` still type-checks, and seeds the wrong dates after the first
  edit.** A test seeds the fieldset from a fixture whose latest revision's brief
  differs from `plan.brief`, and asserts the latest's values.
- **The crumb line is load-bearing outside this package** (pl-45, pl-46). The
  brief caption goes beside it.
- **Sending unchanged slots is not harmless.** pl-47 accepts it, but a budget
  sent unchanged alongside a date change turns a dates edit into "re-packed
  every day". Only what changed is sent, and a test asserts the request body.
- **The shared draft has `open` dates, so there is no return date to read.** A
  step written against `exact` mode finds no input. If an exact-dates walk is
  ever wanted, it derives its dates from the page: a literal date fails once it
  is in the past, and `validateAnswer` refuses it with `INVALID_DATES`.

## Done when

- The fieldset renders on the latest revision only, seeded from the latest
  revision's brief. Its submit is disabled until something changes, and it
  sends only the changed slots (asserted on the mocked call's arguments).
- `INVALID_DATES` and a `PLAN_INFEASIBLE` carrying `pin-on-dropped-day` each
  render distinctly.
- A shown `brief` revision's diff captions both ends of each change, and shows
  "not given" for a budget that was not answered.
- `DatesEntry` and `BudgetEntry` are exported, and the wizard's tests pass
  unchanged.
- `e2e/revise.spec.ts` extends a trip by a night, and asserts the version count
  and the day count before and after a reload. `npm run e2e:planner` passes
  locally with its output quoted in the Log, or the gate records it as
  `unproven (gate)`, and `planner.yml`'s `e2e` job passes on the pull request.
- `npm run check` and `npm test -- --project planner` pass.

## Review

**Gate: CONCERNS** — 2026-09-27 · `c87153d...ac00b8d` (branch `pl-48-edit-dates-budget`; `origin/main` still at `c87153d` after fetch) · code-review at medium

Re-resolved at `4cb75e3`: every coordinate now points into that tip, and the two citations whose text round 3 removed are prose naming `ac00b8d`, the sha this gate reviewed; words and verdicts unchanged.

| Done when                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fieldset on the latest revision only, seeded from the latest revision’s brief, submit disabled until something changes, only changed slots sent | proven — absent on an older one `tools/planner/web/test/plan-view.test.tsx:1477-1490 "the fieldset is absent on an older revision"`; seeded against a disagreeing `plan.brief` `tools/planner/web/test/plan-view.test.tsx:1451-1474 "seeds from the shown revision"`; disabled then enabled, body without the untouched budget `tools/planner/web/test/plan-view.test.tsx:1493-1537 "stays disabled until something changes"`; dates returned to seed not sent `tools/planner/web/test/plan-view.test.tsx:1547-1585 "a slot touched and returned to its seeded value is not sent"`. Narrower than the line for a budget returned to its seed, and for a plan with more than one revision — see the med and low below |
| `INVALID_DATES` and a `PLAN_INFEASIBLE` carrying `pin-on-dropped-day` each render distinctly                                                    | proven — `tools/planner/web/test/plan-view.test.tsx:1609 "longest this tool will plan/i"`, the assertion on Day 8: “A long walk” is pinned at line 1647 of `plan-view.test.tsx` at `ac00b8d` (rewritten in round 3 to the undoubled text, inside `tools/planner/web/test/plan-view.test.tsx:1613-1651 "PLAN_INFEASIBLE from a dropped pin renders the composer"`)                                                                                                                                                                                                                                                                                                                                                    |
| A `brief` revision’s diff captions both ends of each change, "not given" for an unanswered budget                                               | proven for dates and for the unanswered budget — `tools/planner/web/test/plan-view.test.tsx:1681 "Dates: 5 nights, whenever is best → 6 nights, whenever is best"`, `tools/planner/web/test/plan-view.test.tsx:1684 "getByText(/not given/)"`, fixture `tools/planner/web/test/plan-view.test.tsx:1669 "budget: { from: slot.unknown()"`. The from-end of an **answered** budget is asserted nowhere — med below                                                                                                                                                                                                                                                                                                     |
| `DatesEntry` and `BudgetEntry` exported, wizard tests pass unchanged                                                                            | verified — `tools/planner/web/src/wizard/controls.tsx:354 "export function DatesEntry({"`, `tools/planner/web/src/wizard/controls.tsx:514 "export function BudgetEntry({"`; no wizard, controls or app test file in the diff; `controls.test.tsx` + `wizard.test.tsx` 25 of 25, with `app.test.tsx` 27 of 27                                                                                                                                                                                                                                                                                                                                                                                                         |
| e2e extends a trip by a night, asserts version and day count before and after a reload; local run; `planner.yml` e2e on the PR                  | local: **verified** — `tools/planner/e2e/revise.spec.ts:208 "const dayCountBefore = await dayArticles(page).count();"`, `tools/planner/e2e/revise.spec.ts:209 "nights.fill(String(nightsBefore + 1))"`, crumb and day count after the run and after the reload in `tools/planner/e2e/revise.spec.ts:199-224 "Change the dates: extend the trip by one night"`; `npm run e2e:planner` 5 of 5 passed at `ac00b8d`. CI: **unproven (gate)** — no pull request yet                                                                                                                                                                                                                                                       |
| `npm run check` and `npm test -- --project planner` pass                                                                                        | verified — `scripts/preflight.mjs` exit 0 at `ac00b8d` (check ok, planner tests ok); planner 1,280 of 1,280 at head, 1,273 at `c87153d`, +7 = the 7 new tests; the one edited test moves its brief onto the revision and now proves the shown-revision read                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **med** · open decision — an incomplete budget or dates entry is silently dropped while the other slot’s change is saved. `BriefForm` maps a control’s `null` (incomplete or invalid) to “unchanged” (`tools/planner/web/src/plan/PlanView.tsx:1452 "setDraftBudget(value !== null && value.kind ==="`), so with Nights changed, an Amount of 2000 typed beside an empty Currency (whose placeholder reads CAD) saves dates only, and so does clearing a seeded amount (`tools/planner/web/src/wizard/controls.tsx:605 "placeholder="`). The wizard never has this, because a `null` there disables Next. Options: (a) disable Save while a touched control emits `null` — recommended, the wizard’s own rule; (b) keep it and say on the page that an incomplete field is ignored.
- **med** · the budget half of “compared by value” is untested: replacing `tools/planner/web/src/plan/PlanView.tsx:1405 "!budgetEqual(draftBudget, seededBudget)"` with `draftBudget !== null` leaves `plan-view.test.tsx` 52 of 52 green. That is the Trap’s own case — a budget clicked away and back, resent beside a dates change, re-packs every day.
- **med** · the from-end of an answered budget in the caption is untested: rendering `not given` in place of `tools/planner/web/src/plan/PlanView.tsx:1087 "? describeBudget(operation.budget.from.value)"` leaves 52 of 52 green; the only fixture has an unknown from.
- **low** · nothing committed holds `editPlan`’s narrowing (`tools/planner/web/src/api/plan.ts:110 "request: Exclude<ReviseRequest, { kind:"`): reverting it to the base type compiles the whole tree; only a scratch `@ts-expect-error` probe went red (TS2578).
- **low** · the reseed key is untested: deleting `tools/planner/web/src/plan/PlanView.tsx:541 "key={latest.id}"` leaves 52 of 52 green. It is load-bearing only for a move or remove on the latest page, which with the key discards a typed draft and without it keeps it; a restore always remounts the form, since restore runs from an older page where the form is absent.
- **low** · the seed test has one revision, so seeding from the first revision instead of the latest (`tools/planner/web/src/plan/PlanView.tsx:542 "brief={currentBrief(plan)}"` → `plan.revisions[0]!.brief`) leaves 52 of 52 green. Seeding from `plan.brief`, the Trap, does go red.
- **low** · a dropped-pin refusal names the day twice, “Day 8: “A long walk” is pinned to day 8, …”: the `ActionErrorDetails` wrapper at line 199 of `PlanView.tsx` at `ac00b8d`, `Day {String(finding.dayIndex + 1)}: {finding.detail}`, prefixes a detail that already names it at `tools/planner/itinerary/src/brief-edit.ts:93 "which the new dates drop. Unpin it to shorten the trip."`.
- **low** · open decision, outside this diff — the plan’s title keeps the first draft’s length. After the e2e walk’s edit the API still answers `Montréal — a road trip for 5 nights` over a revision of 6 nights and 7 days, and the page’s heading renders `plan.title`, set once from `tools/planner/api/src/intakes/title.ts:93 "export function intakeTitle(brief: TripBrief)"`. Options: (a) file a planner ticket for the API to retitle on a brief edit — recommended; (b) fold into pl-48 by deriving the heading on the page.
- **dropped** · the error banner stays up while the form is edited after a refusal, until the next submit — pl-45’s re-plan does the same, and the retry clears it. Not a defect.
- **dropped** · a remove or move on the latest page discards a typed dates draft — the documented intent of the key; its lack of a test is carried above.
- **findings** · code-review at medium returned 10; 8 carried, 2 dropped.
- NFR: security n/a · performance n/a · reliability — the first med · maintainability — the four untested behaviours above.

### Gate 2

**Gate: CONCERNS** — 2026-09-27 · `ac00b8d..f1bde60` only (`origin/main` still `c87153d`) · code-review at medium, on the lines this round touched

Re-resolved at `4cb75e3`: every coordinate now points into that tip, and the two citations whose text round 3 removed are prose naming `f1bde60`, the sha this gate reviewed; words and verdicts unchanged.

Positive control first: `plan-view.test.tsx` 59 of 59 at `f1bde60`. Each gate 1 mutation was re-applied, run and reverted.

- **med, incomplete entry: fixed** by the owner’s option (a). The gate 1 reproductions now leave Save disabled: Nights 6 with Amount 2000 and an empty Currency, and a seeded amount cleared beside Nights 6. Pinned by `tools/planner/web/test/plan-view.test.tsx:1698-1719 "a touched control left incomplete disables Save"` and `tools/planner/web/test/plan-view.test.tsx:1722-1747 "clearing a seeded amount back to nothing is incomplete"`.
- **med, budget compared by value: fixed.** M4b now reddens `tools/planner/web/test/plan-view.test.tsx:1752 "a budget touched away and back to its seeded band is not sent"` (58 of 59).
- **med, answered from-budget in the caption: fixed.** M7b now reddens `tools/planner/web/test/plan-view.test.tsx:1829 "Budget: shoestring → 500 CAD total"` (58 of 59).
- **low, editPlan narrowing: fixed.** Reverting it to the base type fails `npm run check` with exit 1 and TS2578 on the directive above `tools/planner/web/test/plan-view.test.tsx:1928 "void editPlan("`.
- **low, reseed key: fixed.** M10 now reddens `tools/planner/web/test/plan-view.test.tsx:1840 "a remove that appends a new latest reseeds the fieldset"`.
- **low, one-revision seed: fixed.** M2c now reddens `tools/planner/web/test/plan-view.test.tsx:1881 "seeds from the latest revision, not the first"`.
- **low, the day named twice: refuted as to scope.** The rendering is real, but neither line is in this branch. `git diff c87153d...f1bde60` over `PlanView.tsx` and `itinerary/src/brief-edit.ts` has 0 matching lines. `git log -S` dates the wrapper to pl-45 (#246) and the copy to pl-47 (#279). Withdrawn from this gate; nothing on main records it yet.
- **low, stale title: decided (a), filed, not implemented.** `tools/planner/docs/work/pl-53-retitle-a-plan-after-a-brief-edit.md:32 "**Reproduced**"` carries the gate’s measurement. `git diff --stat c87153d...f1bde60` over `api`, `contract`, `intake` and `itinerary` is empty.
- **med · new, in this round’s lines · open decision** — once touched, a budget whose seed is unanswered cannot go back to “unchanged”, so Save stays disabled for a dates change with nothing on the page saying why. The expression `(budgetTouched && draftBudget === null)` at line 1369 of `PlanView.tsx` at `f1bde60` holds after the fields return to empty, because `BudgetEntry` emits `null` for empty and partial alike (`tools/planner/web/src/wizard/controls.tsx:534 "next.band === null ? null"`), and only a remount clears `tools/planner/web/src/plan/PlanView.tsx:1451 "setBudgetTouched(true);"`. Reproduced on an unasked budget, which is the e2e walk’s own plan, with Nights set to 6: typing 2 into Amount and clearing it, or clicking A feeling alone, or A feeling then A figure, each leaves Save disabled. Untouched, the same edit sends dates only. Options: (a) a per-slot “leave the budget as it was” reset that clears the flag and remounts that control, plus one line saying why Save waits — recommended, confined to `PlanView.tsx`; (b) have `BudgetEntry` report empty apart from partial, which changes a wizard control that Build step 1 exports unchanged; (c) keep it and add only the explanatory line.
- **low · new** — pl-53’s Log says `intakeTitle` “is called from exactly one” place (line 93 of `pl-53-retitle-a-plan-after-a-brief-edit.md` at `f1bde60`, since corrected). It is also called twice in `api/src/intakes/state.ts`, for the intake’s own title. `tools/planner/api/src/runs/orchestrator.ts:201 "title: intakeTitle(brief) ?? UNTITLED,"` is the only call that writes a plan’s title, which is what the sentence means.
- **findings** · gate 2 returned 10: 8 gate-1 verdicts (7 closed, 1 refuted) and 2 new, both carried, 0 dropped.
- Also run at `f1bde60`: planner 1,287 of 1,287 (+7 over `ac00b8d`); `npm run e2e:planner` 5 of 5 passed; `scripts/preflight.mjs` exit 0. The `planner.yml` e2e row remains **unproven (gate)**, with no pull request yet.
- NFR: security n/a · performance n/a · reliability — the new med · maintainability ✓.

### Gate 3

**Gate: PASS** — 2026-09-27 · `f1bde60..4cb75e3` only (`origin/main` still `c87153d`) · code-review at medium, on the lines this round touched

Positive control first: `plan-view.test.tsx` 63 of 63 at `4cb75e3`. Every mutation below was applied, run and reverted.

- **med, stuck Save: fixed** by the owner’s option (a). Gate 2’s three reproductions still disable Save, now with the line `tools/planner/web/src/plan/PlanView.tsx:1458 "Save is waiting on the budget"` and its reset (`tools/planner/web/src/plan/PlanView.tsx:1459 "onClick={resetBudget}"`). Each recovers to a dates-only body, pinned by `tools/planner/web/test/plan-view.test.tsx:1985 "typing an amount and clearing it back to nothing gets stuck"`, `tools/planner/web/test/plan-view.test.tsx:1998 "clicking 'A feeling' alone gets stuck"` and `tools/planner/web/test/plan-view.test.tsx:2009 "clicking 'A feeling' then 'A figure' gets stuck"`, through `tools/planner/web/test/plan-view.test.tsx:1969 "async function expectStuckThenRecovered("`. Dropping `tools/planner/web/src/plan/PlanView.tsx:1396 "setBudgetTouched(false);"` reddens all three (60 of 63).
- **The fix from other seeds, by probe:** a seeded 1500 CAD amount cleared, then reset, shows 1500 and CAD again and sends dates only. A seeded band switched to A figure, then reset, is checked again and sends dates only. After an `INVALID_DATES` refusal, the banner stays, the reset returns the budget to the plan’s own (unanswered) and the retry sends dates only. A budget-only change reset back to its seed leaves Save disabled.
- **low, pl-53’s Log: fixed** — `tools/planner/docs/work/pl-53-retitle-a-plan-after-a-brief-edit.md:93 "is called three places, not one"`.
- **Fold-in of the day named twice: holds, and is the narrowest change.** `tools/planner/web/src/plan/PlanView.tsx:185 "function findingLine(finding: InfeasibleFinding): string {"` drops the prefix only when the detail names its own day. Two producers reach it. The dropped-pin copy names the day it is filed under (`tools/planner/itinerary/src/brief-edit.ts:93 "which the new dates drop. Unpin it to shorten the trip."`). The critic findings passed through `tools/planner/itinerary/src/compose.ts:350 "export function refuseHardFindings("` name no day number, only this or any day (`tools/planner/itinerary/src/critic.ts:143 "Nothing could be placed on any day of this trip."`), so they keep the prefix. Always prefixing reddens `tools/planner/web/test/plan-view.test.tsx:1613 "PLAN_INFEASIBLE from a dropped pin renders the composer"`; never prefixing reddens `tools/planner/web/test/plan-view.test.tsx:1417 "Day 1: Over capacity."`. The alternatives are wider: a check by `kind` needs `infeasibleFindings` to keep a field it drops today, and new server copy would edit pl-47’s itinerary package and its tests.
- **low · new** — nothing holds the remount behind the reset: deleting `tools/planner/web/src/plan/PlanView.tsx:1448 "key={budgetResetKey}"` leaves 63 of 63 green, because every committed case starts from an unanswered budget, where empty fields equal the seed. Under that mutation, a seeded 1500 CAD amount cleared and reset shows an empty Amount while the budget stays 1500 CAD, which is gate 1’s med in another shape.
- **low · new** — pressing Leave the budget as it was unmounts the button that has focus, and focus falls to the page body (probe: `document.activeElement` is `BODY`). A keyboard user loses their place in the form.
- **dropped** · after a refusal, the reset discards a band chosen before it and returns to the plan’s own budget, not the last complete choice. That is what the button says. Not a defect.
- **findings** · gate 3 returned 6: 3 verdicts (the stuck-Save med and the pl-53 low fixed, the fold-in holds), 2 new lows carried, 1 dropped.
- Also run at `4cb75e3`: planner 1,291 of 1,291 (+4 over `f1bde60`); `npm run e2e:planner` 5 of 5 passed; `scripts/preflight.mjs` exit 0. The `planner.yml` e2e row remains **unproven (gate)**, with no pull request yet.
- NFR: security n/a · performance n/a · reliability ✓ · maintainability — the two lows.

## Log

**2026-09-13 — filed** beside pl-47, on the owner's cut. Checked against the
code at `origin/main` `d3fca5e`:

- `DatesEntry` and `BudgetEntry` are declared in `wizard/controls.tsx` without
  `export`, and each takes `Omit<FieldProps, "question">`.
- `wizard/format.ts` exports `describeDates` and `describeBudget`.
- `PlanView.tsx` reads `plan.brief.shape`, and is the page's only read of a
  brief outside the wizard.
- A grep of `web/src` finds no per-kind label for `UncheckedConstraintKind`.
- `e2e/intake-walk.ts` answers dates by checking "However long, whenever" and
  filling Nights, and `DatesEntry` renders `#date-return` only when its mode is
  `exact`. Step 8 first read a return date off the page. pl-47's filing gate
  caught it, and the step now uses Nights.

**2026-09-27 — built (dispatched as Sonnet 5, per this session's own system
prompt rather than the dispatch text itself).** Branched
from `origin/main` at `c87153d`, matching `depends_on`: pl-45, pl-46 and pl-47
were already `done` on that base.

**What landed.**

- `wizard/controls.tsx`: `DatesEntry` and `BudgetEntry` exported, unchanged
  otherwise.
- `api/plan.ts`: `startReplan`'s parameter widened to
  `Extract<ReviseRequest, { kind: "replan" | "brief" }>` (Build step 2).
  `editPlan`'s narrowed the mirror way, to
  `Exclude<ReviseRequest, { kind: "replan" | "brief" }>` — not asked for by
  name, but the type gap this closes is exactly pl-45's own "typed to their
  one response kind each" argument: before this, `editPlan` still admitted a
  `brief` request even though a brief edit answers `{ kind: "run" }`, never
  `{ kind: "revision" }`, same as `startReplan`'s own narrowing reason. Nothing
  in this branch calls `editPlan` with one, so this is a type-safety close, not
  a behaviour change; recorded here since it is easy to mistake for the brief's
  own instruction and it is not one.
- `PlanView.tsx`: `BriefForm` (the fieldset), `BriefCaption` (the diff's
  dates/budget lines), `datesEqual`/`budgetEqual` (value comparison, never
  reference), wired beside `ReplanForm` on the latest revision only, keyed on
  `latest.id` so a restore/move/remove that leaves the page mounted with a
  different latest reseeds the form rather than keeping stale drafts.
  `Document`'s `shape`/`caution` now read `shownRevision.brief.shape`, not
  `plan.brief.shape` (Build step 6).
- `e2e/revise.spec.ts`: one step appended after pl-46's final reload —
  extends the trip by one night through the Nights field, asserts the version
  and day count, reloads and asserts both again. Appended after the existing
  test's last line so no existing cited range in this file moved.
- `web/test/plan-fixtures.ts`: `brief()` gained an optional `budget` override,
  left unknown (the ordinary "unasked" state) unless given.
- `web/test/plan-view.test.tsx`: 7 new tests in a new `describe("changing the
dates or budget")`, appended after the file's last existing test so nothing
  before it moved.

**What the brief had wrong.**

- **"`PlanView.tsx` reads `plan.brief.shape`" was true at filing but the fix
  is not a one-line swap in place.** `shape`/`caution` were computed before
  `shownRevision` exists in `Document` (right after the `latest === null`
  early return), so reading `shownRevision.brief.shape` in their place needs
  moving the computation down past where `shownRevision` is derived. Done;
  no behaviour change for the ordinary case since `shownRevision === latest`
  most of the time, but a fixture whose revision's own brief disagrees with
  `plan.brief` (the trap Build step 6 names) proves the read is the right one
  — see the "seeds from the shown revision's own brief" test, and the fix to
  `plan-view.test.tsx`'s pre-existing "a backcountry plan points at the
  authority" test below.
- **A pre-existing test broke once the read moved**, and this is the trap
  materialising rather than a regression I introduced: "a backcountry plan
  points at the authority and claims no clearance"
  (`plan-view.test.tsx`) set `shape: "backcountry"` on `planView`'s top-level
  `brief` only, leaving the fixture's `revision()` at its own default
  (`road-trip`). Reading `plan.brief.shape` passed by coincidence; reading
  `shownRevision.brief.shape` (correctly, per Build step 6) failed until the
  fixture set the revision's own brief. Fixed by moving the override onto
  `revision()`'s `brief` override instead.

**Fold-in considered and declined.** `npm run status -- --tool planner` shows
one other open ticket, pl-52, which waits on pl-40 (a real model run's cost)
and touches nothing this ticket's diff does. No other already-specified,
already-free work surfaced.

**Verification**, each figure from the command beside it:

- `npx tsc --build tools/planner/web tools/planner/web/test`: clean, no
  output.
- `npx oxlint tools/planner/web/src tools/planner/web/test`: clean, no output.
- `npx oxfmt --check tools/planner/web/src tools/planner/web/test`: "All
  matched files use the correct format."
- `npx vitest run tools/planner/web/test/plan-view.test.tsx`: 52 tests, all
  passing (45 baseline + 7 new).
- `npx vitest run tools/planner/web/test/controls.test.tsx
tools/planner/web/test/wizard.test.tsx tools/planner/web/test/app.test.tsx`:
  27 tests, all passing, unchanged from baseline — the wizard's tests pass
  unchanged, per Done-when.
- `npx vitest run --project planner`: 75 files, 1,280 tests, all passing.
- `npx playwright test -c tools/planner/playwright.config.ts`: 5 specs, all
  passing — `revise.spec.ts`'s one spec, extended by this ticket's step 8,
  passed in 2.8s; the suite's path and spec count are unchanged at 5, per
  Build step 8's own rule. Run locally in this sandbox: chromium was already
  present at `/ms-playwright` system-wide, so `npm run e2e:install` (which
  needs `sudo`, unavailable here) was not needed.
- `npm run check`: exit 0.
- `node scripts/citations-gate.mjs --against origin/main`: 112 enforced, 0
  failing. Editing `PlanView.tsx` and `plan-view.test.tsx` moved 20 citations
  in pl-45's record and 1 in pl-46's (the backcountry-fixture fix alone moved
  every line below it in `plan-view.test.tsx`); each was repointed to its new
  line, text and verdict untouched.

**2026-09-27 — gate 1 (Opus, `c87153d...ac00b8d`): CONCERNS, 3 med, 6 low, 2
dropped.** Recorded verbatim via `node scripts/review-record.mjs`, in its own
commit. The owner answered both open decisions the gate raised, both times
taking the gate's own recommendation:

- **The incomplete-entry med, option (a).** `BriefForm` now tracks
  `datesTouched`/`budgetTouched` separately from the draft values, and Save
  disables while either is `true` with its draft still `null` — the wizard's
  own rule for a composite control, applied to Save rather than Next. Two
  reproductions, each red before the fix and green after: the gate's own
  (Nights changed, an Amount of 2000 beside an empty Currency) and a second
  for clearing a seeded amount back to nothing, which is incomplete for the
  same reason and not merely "unchanged".
- **The stale-title low, option (a).** Filed
  [pl-53](./pl-53-retitle-a-plan-after-a-brief-edit.md), `next-id.mjs pl`
  confirmed free against `main` and every open branch (`dl-53-*`, `pl-17-*`,
  `repo-60-*`, `repo-62-*`, `worktree-pl-19-*`, both release-please branches).
  Not implemented, per the owner's ask.

**The two untested meds, each pinned by a test reproduced red under the
gate's exact mutation, then restored and re-verified green:**

- Replacing `!budgetEqual(draftBudget, seededBudget)` with `draftBudget !==
null` reddened a new test (a budget clicked to another band and back beside
  a real dates change) before the mutation was reverted.
- Rendering `"not given"` unconditionally in the caption's from-branch
  reddened a new test (an **answered** `from` budget, "Budget: shoestring →
  500 CAD total") before the mutation was reverted.

**Three of the four lows, each pinned the same way:**

- `editPlan`'s narrowing: a committed `@ts-expect-error` test
  (`describe("editPlan's own narrowing (pl-48)")`), the same pattern
  `api/test/grounding-cache.test.ts` already uses for a type-only guarantee.
  Reverting `editPlan`'s parameter to admit `brief` turned the directive into
  `TS2578: Unused '@ts-expect-error' directive`, failing `npm run check` —
  confirmed, then the revert undone.
- The reseed key: a new test performs a Remove (which appends a revision
  while `PlanView` stays mounted, unlike a brief edit or a re-plan, which
  leave for `RunView`) after typing an unsaved Nights draft, and asserts the
  new latest's own seed (`5`) is on screen rather than the stale typed value
  (`9`). Deleting `key={latest.id}` reddened it (received `"9"`, expected
  `"5"`) before the deletion was reverted.
- The one-revision seed test: a new test seeds from a plan with two
  revisions whose briefs disagree on both slots. Mutating the seed to
  `plan.revisions[0]!.brief` reddened the new test while leaving the
  original, one-revision test green — reproducing the gate's own claim about
  which test could and could not see that mutation — before the mutation was
  reverted.

**The fourth low — pushed back, not fixed.** The "Day 8" double-naming
(`PlanView.tsx`'s `Day {N}: {detail}` wrapper prefixing a `detail` that
already names its own day, from `itinerary/src/brief-edit.ts`'s
`droppedPinsRefusal`) is real, but neither line is in this branch's diff:
`git diff origin/main -- tools/planner/web/src/plan/PlanView.tsx | grep
infeasibleFindings` and the same against `itinerary/src/brief-edit.ts` both
print nothing. Both predate this ticket (pl-45's wrapper, pl-47's finding
copy) and this ticket's own Build step 4 says the rendering "needs no case of
its own" — this branch only added a test that exercises an existing path and
made the pre-existing redundancy visible. Not fixed here, and not filed
separately either: it is cosmetic (low, per the gate itself) and belongs to
whichever of pl-45 or pl-47 owns the wording, not to a page-only ticket.

**The two dropped findings held on re-reading** — the error banner staying up
through a retry (pl-45's own behaviour) and the reseed key's _intent_ being
correct (only its missing test was carried, and is now closed above).

**Re-verification after this round**, each figure from the command beside it:

- `npx tsc --build tools/planner/web tools/planner/web/test`: clean, no
  output.
- `npx oxlint tools/planner/web/src tools/planner/web/test`: clean, no
  output.
- `npx oxfmt --check tools/planner/web/src tools/planner/web/test`: clean
  after `npm run format`.
- `npx vitest run tools/planner/web/test/plan-view.test.tsx`: 59 tests, all
  passing (52 prior + 7 new: 2 for the incomplete-entry fix, 2 for the untested
  meds, 3 for the lows).
- `npx vitest run --project planner`: 75 files, 1,287 tests, all passing.
- `npx playwright test -c tools/planner/playwright.config.ts`: 5 specs, all
  passing.
- `npm run check`: exit 0.
- `node scripts/citations-gate.mjs --against origin/main`: 113 enforced, 0
  failing. This round's own edits to `PlanView.tsx` moved two of gate 1's own
  citations (`:1381`→`:1404`, `:1348`→`:1364`); repointed. A new test's doc
  comment quoting an earlier test's title verbatim made one gate-1 anchor
  indistinct across two lines; reworded the quote rather than the record.

**2026-09-27 — gate 2 (Opus, `ac00b8d..f1bde60`): CONCERNS, 2 new (1 med, 1
low), 8 gate-1 verdicts (7 closed, 1 refuted as to scope).** Recorded verbatim
via `node scripts/review-record.mjs --gate 2`, in its own commit, before
anything else this round. **`--verify` is not available on this branch**:
`grep -n verify scripts/review-record.mjs` on this checkout returns nothing —
it is repo-62's addition, on a branch this ticket's own `main` base (`c87153d`)
predates, so `node scripts/review-record.mjs --verify` was not run. The
splice step's own check served the same purpose: "Normalised diff against the
section file … empty means verbatim survived the formatter" printed empty,
confirming the same 37-of-37 the gate itself dry-ran.

The owner answered both open decisions the gate raised, both times taking the
gate's own recommendation — and on the second, overriding the orchestrator's
own recommendation to file rather than fold in:

- **The stuck-Save med, option (a).** An unanswered budget, once touched, had
  no way back to "unchanged": `BudgetEntry` emits only `null` (incomplete) or
  a complete answer, never "unanswered" again, so `budgetTouched` stayed
  `true` forever and a dates-only Save stayed disabled with no explanation.
  `BriefForm` now has a per-slot escape: "Leave the budget as it was" clears
  `budgetTouched`, clears `draftBudget`, and remounts `BudgetEntry` under a
  fresh key (`budgetResetKey`) — the same reseed trick the whole form's own
  key already plays one level up, applied here to the one control that could
  dead-end. A line of copy ("Save is waiting on the budget…") explains the
  wait while it lasts. Proven red-first with the three named repro cases,
  each from an unanswered budget with Nights set to 6: typing an amount and
  clearing it, clicking "A feeling" alone, and "A feeling" then "A figure" —
  all three left Save disabled with no recovery before the fix, and all three
  recover through the new button after it.
- **The doubled "Day 8" refusal, folded into pl-48 — the owner's decision
  overrode the orchestrator's own recommendation to file it separately.**
  This is pl-45's `Day N:` wrapper (`ActionErrorDetails`,
  `git log -S` dates it to #246) and pl-47's finding copy
  (`droppedPinsRefusal`, #279) — neither line was in this branch before this
  commit, and the fix is recorded here only because the owner chose to fold
  it in rather than because it was already this ticket's to own. The
  narrowest change that holds for every finding kind `ActionErrorDetails`
  renders: a new `findingLine` helper skips the `Day N:` prefix when a
  finding's own `detail` already names that day (a case-insensitive `\bday
N\b` test), which is true today only of `pin-on-dropped-day`'s detail — the
  critic's own findings (`itinerary/src/critic.ts`) never name their day in
  prose, trusting the wrapper for it, and keep the prefix unchanged. Checked
  by content rather than by `kind`, so a future finding that also names its
  own day is covered without a second case here. The one existing test
  asserting the old, doubled text was updated to assert the fixed, undoubled
  one — its own citation into this record could not simply move, since the
  exact text it once quoted no longer occurs anywhere in the file once the
  bug is fixed; it is pinned to the commit it was true of instead —
  `PlanView.tsx@c87153d:192`, this code's own line on `origin/main` before
  this ticket, per `records.md`'s rule for a citation that is not moved but
  genuinely superseded. Not `ac00b8d`: a branch-only sha fails once this
  branch is squash-merged and deleted (`records.md:148`), and `c87153d` holds
  the identical text at line 192, not 199 — the wrapper had not yet grown
  the doc comment and helper this ticket later added above it.
- **pl-53's Log, line 93, fixed per the low.** `intakeTitle` is called three
  times, not one: `api/src/intakes/state.ts:173` and `:338` for the intake's
  own title, beside `runs/orchestrator.ts:201`'s `startRun`, which is the
  only one of the three that writes a _plan's_ title — the claim the
  sentence was actually making, now said correctly. This record's own
  citation into pl-53's Log (line 164, quoting the now-corrected sentence's
  old wording) cannot be pinned the same way: pl-53's file does not exist on
  `origin/main` at any commit, so no `@<sha>` there is an ancestor of `main`
  either. Named in prose instead — the sentence read this way at this
  branch's `f1bde60`, before this round corrected it — rather than as a
  citation nothing on `main` could ever resolve.

**Re-verification after this round**, each figure from the command beside it:

- `npx tsc --build tools/planner/web tools/planner/web/test`: clean, no
  output.
- `npx oxlint tools/planner/web/src tools/planner/web/test`: clean after one
  fix — `extendNights` (a new helper with no closure over its describe
  block) moved to module scope, per `unicorn/consistent-function-scoping`.
- `npx oxfmt --check tools/planner/web/src tools/planner/web/test`: clean
  after `npm run format`.
- `npx vitest run tools/planner/web/test/plan-view.test.tsx`: 63 tests, all
  passing (59 prior + 4 new, all in `describe("an unanswered budget that
gets stuck (gate 2)")`).
- `npx vitest run --project planner`: 75 files, 1,291 tests, all passing.
- `npx playwright test -c tools/planner/playwright.config.ts`: 5 specs, all
  passing.
- `npm run check`: exit 0.
- `node scripts/citations-gate.mjs --against origin/main`: 113 enforced, 0
  failing. This round moved or superseded 16 citations across pl-45 (1),
  pl-46 (1), pl-48 (13, one of them requiring a new anchor rather than a
  moved one — see the `PLAN_INFEASIBLE from a dropped pin` test, whose
  literal fixture and expected text became identical once the fix landed,
  so the citation now anchors on the test's own title over the full range
  instead) and pl-53 (1, pinned).

**2026-09-27 — landed (gate 3, PASS at `f1bde60..4cb75e3`).** A Haiku fixer's
attempt at this landing pushed nothing and left records that fail the
citations gate; ignored entirely, per instruction. This round started fresh
from the pushed `4cb75e3`, confirmed with `git fetch` and `git status` (clean,
matching `origin/pl-48-edit-dates-budget`).

**The lander-edited `## Review` was withdrawn and re-landed from the
reviewer's own re-resolved text**, in four commits: the withdrawal, then
gates 1, 2 and 3 spliced with `scripts/review-record.mjs` and each checked
byte for byte against the reviewer's file with `cmp` before committing —
`records.md:63` and `:148` are why: rounds 2 and 3 had pinned two of the
reviewer's own citations to branch-only shas (`ac00b8d`, `f1bde60`), which
fail once this branch is squash-merged and deleted, and in doing so edited
text that was not a lander's to edit. The reviewer's re-resolved gates 1 and
2 carry the same two facts as **prose** instead (naming the sha in words,
never as a citation), which is why `4 unchecked` shows up in every citations
run over this ticket from here on — counted, not failing, per
`citations.mjs`'s own accounting.

**The Log's own two branch pins, added by this same lander in the same two
rounds, had the identical defect** and are fixed the same way: the first
(the pre-existing `Day {…}:` prefix, real before this ticket) is now pinned
to `c87153d` — `origin/main`'s own commit, and its line there is 192, not
199 or `ac00b8d`'s line either, since the code above it grew between then and
now. The second (pl-53's Log sentence) names its sha in prose rather than as
a pin, because pl-53's file does not exist on `origin/main` at any commit —
there is no ancestor-of-`main` sha a pin into it could ever point at.

**Gate 3's two new lows, fixed in the landing, no fourth gate — the owner's
decision, matching the reviewer's own recommendation:**

- The remount behind "Leave the budget as it was" had no test that could see
  it fail: every prior case started from an unanswered budget, where an empty
  field already equals the seed. A new test seeds an answered 1500 CAD
  amount, clears it, resets, and asserts the field reads `1500` again, not
  empty. Reproduced red first — deleting `key={budgetResetKey}` failed it
  with `''` where `'1500'` was expected — then restored.
- Pressing that button unmounted the element holding focus with nothing
  telling the browser where to go next, dropping it to `document.body` — a
  keyboard user's lost place in the form. A `ref` on the div wrapping
  `BudgetEntry`, focused in `resetBudget`, takes it back. A new test asserts
  `document.activeElement` is that div, not the body; reproduced red first by
  removing the `.focus()` call, which left the active element `BODY`.

Both tests are appended at the end of `plan-view.test.tsx`, in their own
`describe`, so no existing citation's line moved on their account; the
`PlanView.tsx` change itself (the import, the ref, the wrapping `div`) did
move seven of gate 1/2/3's own citations, each repointed by coordinate only —
no anchor text and no word touched, per this round's own instruction.

**Verification at the final head**, each figure from the command beside it:

- `npx vitest run tools/planner/web/test/plan-view.test.tsx`: 65 tests, all
  passing (63 prior + 2 new), and each new test's stated mutation reddens it
  and only it, restored after.
- `npx vitest run --project planner`: 75 files, 1,293 tests, all passing.
- `npm run check`: exit 0.
- `npx playwright test -c tools/planner/playwright.config.ts`: 5 of 5.
- `node scripts/citations-gate.mjs --against origin/main`: exit 0.
- `node scripts/citations.mjs <this ticket> --section Review
--require-anchors --require-distinct-anchors`: exit 0, 0 unanchored (4
  unchecked: gate 1's own Done-when row and its day-doubling low each carry
  one prose line reference, and gate 2's stuck-budget med and pl-53 low each
  carry the other one).
- Every `@<sha>` in `git diff origin/main...HEAD` (`c87153d`, `d224afc`, the
  latter pre-existing from pl-46's own merged record) passes
  `git merge-base --is-ancestor <sha> origin/main`.
- `node scripts/preflight.mjs --base origin/main --title "feat(planner):
change a plan's dates or budget from the plan page (pl-48)"`: exit 0.
- `git diff --stat 4cb75e3 HEAD`: touches only `PlanView.tsx`,
  `plan-view.test.tsx` and this ticket.

Ship authority for this round was conditional on all of the above holding.
They did; pushed and opened the pull request.
