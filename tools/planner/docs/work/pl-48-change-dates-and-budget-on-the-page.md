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

**2026-09-27 — built (dispatched, model not stated in the dispatch).** Branched
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
