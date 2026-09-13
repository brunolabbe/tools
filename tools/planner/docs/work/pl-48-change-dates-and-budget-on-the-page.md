---
id: pl-48
tool: planner
title: Change a plan's dates or budget from the plan page, and prove it through a browser
kind: work-package
status: ready
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
