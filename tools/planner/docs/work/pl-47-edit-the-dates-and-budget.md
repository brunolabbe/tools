---
id: pl-47
tool: planner
title: A plan's dates and budget can be edited — each version keeps its brief, and the day count follows
kind: work-package
status: done
milestone: P4
depends_on: [pl-42, pl-43, pl-44]
difficulty: hard
---

# pl-47 — Edit the dates and the budget

**Packages:** `contract` (a `brief` operation and request, `PlanRevision.brief`,
a stored unchecked kind), `itinerary` (resizing a revision to new dates, and
re-packing under a new budget), and `api` (the route, the run, a migration). The
page is [pl-48](./pl-48-change-dates-and-budget-on-the-page.md). This ticket
builds on [pl-42](./pl-42-the-revision-contract.md),
[pl-43](./pl-43-repack-named-days-and-diff.md) and
[pl-44](./pl-44-the-replan-run-and-edits.md) and redefines nothing they put
there. If one of them is wrong, stop and say so.

## Why

**§6's amendment leads with three intents, and after Phase 4's first five
tickets only one of them is expressible.** "Move the hike to Thursday" is a
move. "We cannot afford the second hotel" maps to "lower the budget slot on the
brief and re-plan", and "add a day in Trieste" to "extend the dates and re-plan
the slice that opens". pl-42 deferred both on purpose, because changing the
dates changes the day count, and "a revision names its days" had no answer for
a day that stops existing. It said the ticket that adds them has that question
to answer first. This is that ticket, and the owner answered it.

**The brief cannot be edited where it is stored today.** `plans.brief_json` is
one snapshot per plan, and `PlanDetail.brief` says why it is a snapshot: "why
is there no lodging in here?" has to be answerable against the brief the plan
was built from. Once a version can change the dates, a single copy answers that
question only for whichever version wrote it last, and restoring version 1 would
show version 1's days under version 3's dates. Neither `plans` nor `plan_runs`
links back to the intake, so editing the intake is not a route either, and pl-44
already forbids a re-plan from reading it.

### Decided by the owner, 2026-09-13

Each was chosen from options:

- **Scope: dates and budget only.** These are the two examples §6's amendment
  gives, and both already have a control in the wizard. Every other slot
  (party size, drive appetite, pace, shape) stays a new draft from the intake,
  because several of them change the roster, and an edit that re-runs the
  roster is a redraft that looks like a revision.
- **Storage: a copy of the brief per version.** Each revision stores the brief
  it was built from. Restoring a version brings back its dates and budget too.
- **The day count: day numbers are kept, and losing a pin is refused.**
  - Day 3 stays day 3.
  - A longer trip appends days at the end, and those days are planned.
  - A shorter trip drops days from the end, with everything on them.
  - **A shorter trip that would drop a pinned item is refused**, so the user
    unpins first.
  - Moving the start re-dates every kept day. An item that is now out of
    season stays, silently, as the owner already decided for a move (pl-43's
    Log).
- **The budget: a budget change re-packs every unpinned item.** A lower budget
  is plan-wide, and the critic's `over-budget` repair drops the dearest
  unpinned item wherever it is. That is what a budget cut means, so the slice
  is every day.
- **Booking lead time: keep the item, and say so.** When new dates leave less
  time before departure than a placed item needs to be booked, the item stays,
  and the revision stores a notice naming it. Measured at filing: 12 of the 23
  candidates in the checked-in JSON fixtures need booking between 7 and 180
  days ahead, so moving a departure earlier trips this routinely.
- **The cut: this ticket for `contract`, `itinerary` and `api`, then pl-48 for
  the page.**

### Decided by the owner, 2026-09-19

Asked after the build and the gate, with the measurement attached. Each was
chosen from options, and each took the builder's and the reviewer's
recommendation:

- **The revision ceiling stays at 50, documented.** At 50 revisions the
  worst-diff plan view measures up to 168,514 bytes (road-trip), not the
  "under 100 KiB" pl-42 wrote, and road-trip was already at 105,214 before this
  ticket. Nothing in the repo consumes the view's size. `MAX_REVISIONS_PER_PLAN`'s
  comment carries the six-fixture table. The other options were lowering it to
  about 30 and storing the brief once rather than per revision.
- **A dates-only edit that changes the day count under a `per-day` budget is
  captioned `Changed the dates, and re-packed every day.`**, not step 3.5's
  `Changed the budget, …`. The table's row was wrong: it named a change nobody
  made. The other option was the table's literal wording.
- **A request that names a budget re-packs every day, even at the same
  value.** An equal value can still change the plan: the reviewer re-packed
  500 → 500 and an unplaced candidate came onto day 0. The other option was
  comparing by value. pl-48 sends only what changed.

### Adopted rather than asked, and why

- **Under a per-day budget, a change in day count is a budget edit.**
  `budgetCeiling` multiplies a `per-day` amount by the day count, so a longer or
  shorter trip moves the ceiling without the budget slot changing. The owner's
  budget answer is about the ceiling moving, so the slice is every day in that
  case too. A same-length shift leaves the count, and so the ceiling, where it
  was, and stays a plain dates edit.
- **A brief edit names no specialists and never re-discovers.** A budget cut
  draws on the pool the plan already has. Asking for new lodging after a cut is
  a re-plan naming `lodging`, which pl-44 already builds, and keeping the two
  apart keeps this run free of model calls.
- **Every brief edit is a run, `Run.kind: "replan"`.** Added and re-packed days
  need grounding, and pl-42 made every re-plan a run for exactly that reason. A
  dates edit that only shortens or re-dates has nothing to measure and goes
  `queued → composing`, the edge pl-42 added.
- **The pin refusal is `PLAN_INFEASIBLE`**, raised before the run starts. Its
  copy, "This trip cannot be planned as described — something has to give.", is
  true of it without re-wording. If building this shows the copy has to change
  at the raise site, that is the root `CLAUDE.md`'s tell that the code is wrong:
  stop and say so rather than re-wording it.
- **The notice is `booking-deadline-passed`, stored in its own field.** The
  name is the packer's exclusion reason for the same fact. It is stored for
  `coverage`'s reason: it reads a clock, and `uncheckedForRevision` reads none.
  It does not go into `coverage`, whose name and doc comment are about a thin
  corridor, and overloading it would make that name lie.

## Build

### 1. `contract`

1. **`PlanRevision.brief: TripBrief`**, required. It and step 5's `deadlines`
   both join `NewRevision`'s `Pick`, because every writer stamps a revision
   through it (`ComposeResult.revision` is a `NewRevision`), and a required
   field outside the `Pick` has no writer. `compose` stamps the brief it composed from, and every other writer
   stamps the brief it was given.
   - **`PlanDetail.brief` stays, as the first draft's brief.** Its doc comment
     now says that, and points at `revision.brief` for the brief any given
     version was built from.
   - **Add `currentBrief(plan): TripBrief`** beside `latestRevision`:
     the latest revision's brief, or `plan.brief` for a plan with no
     revision yet. `api` and `web` both need that rule, and it is the same
     exception `appendRevision` already takes for the same reason.
2. **`RevisionOperation` gains a member:**

   ```ts
   | {
       kind: "brief";
       dates: { from: TripDates; to: TripDates } | null;
       budget: { from: Slot<TripBudget>; to: TripBudget } | null;
       /** The days this edit re-packed, ascending. Possibly empty. */
       days: number[];
     }
   ```

   - **It carries both ends of each change**, so a stored operation reads on
     its own, as `move`'s `fromDayIndex` does (pl-42).
   - **`dates.from` is a value and `budget.from` is a slot.** `dates` is a
     required slot, and `uncheckedForRevision` already throws for a stored
     revision without it, so a revision always has one. `budget` may have been
     declined or never asked.
   - **`days` is derived and stored, never requested.** §6's amendment promises
     that "which days did this revision touch" is answerable from the revision
     itself.
   - **A refine: at least one of `dates` and `budget` is non-null.**
   - **`to` is a value, never a slot.** Clearing a budget back to declined is
     not an edit this ticket offers.

3. **`ReviseRequest` gains `{ kind: "brief"; baseRevisionId; dates?: TripDates;
budget?: TripBudget }`**, with a refine that at least one is present. The
   response is `{ kind: "run"; run }`, 202. An edit whose values equal the
   current ones is legal and gives an empty diff, as restoring the latest
   revision does (pl-44 step 2).
4. **`UNCHECKED_CONSTRAINTS` gains `"booking-deadline-passed"`**: a placed item
   whose booking lead time was longer than the time left before departure, when
   the dates were last edited. `candidateIds` names the items. The doc comment
   says it is stored, why, and that it is a fact about the moment of the edit.
5. **`PlanRevision.deadlines: UncheckedConstraint[]`**, holding only that kind,
   with a doc comment in `coverage`'s style. Empty is the ordinary answer.
6. **Schema tests** for each rule above, each with its own failing case.

### 2. `itinerary`

1. **`briefEditSlice({ previous, brief, change })`** returns the resized
   revision to re-pack from and the slice:
   1. **The span** is `tripSpan(change.dates)` when the dates change.
      Otherwise it is `previous`'s count and dates, per pl-43's rule that a
      plan does not reshape itself behind a re-plan.
   2. **Kept days** are `previous.days` below the new count, each re-dated from
      the span. Their items, pins and stored `travelFromPrevious` are
      untouched.
   3. **Dropped days** are those at or above the new count. A pinned item on
      one throws `PLAN_INFEASIBLE` (step 3 below). `api` has already refused
      it, so reaching this throw means a pin was set while the run was queued.
   4. **Added days** are empty days above the old count, dated from the span.
   5. **The slice** is every day when the budget changes, or when the day
      count changes under a `per-day` budget. Otherwise it is the added days,
      which may be none. A same-length shift under a `per-day` budget re-packs
      nothing, because its ceiling did not move.

   `api` calls it to decide what to measure, and `reviseBrief` calls it to
   pack, so the measured table and the packed days agree by construction
   (pl-44 step 4.5's argument).

2. **`reviseBrief(input): ComposeResult`**, where `input` is the edited brief,
   the pool, `previous`, the change, `travel`, `{ id, reason, createdAt }`,
   `now`, and optional `gaps`, `coverage` and `reading` defaulting to
   `previous`'s:
   1. Call `briefEditSlice`.
   2. **Re-pack the slice through pl-43's re-pack core, not a fork of
      `replan`.** If `replan`'s operation parameter is too narrow for a `brief`
      operation, widen it to take the slice separately from the operation it
      stamps. Two packing paths that agree today are how two views of one plan
      start disagreeing.
   3. **The critic reads the edited brief**, so the ceiling is the new budget
      over the new day count, and `fixed` is every candidate on a day outside
      the slice, as in pl-43.
   4. Stamp `operation: { kind: "brief", dates, budget, days: slice }` and
      `brief: input.brief`.
   5. **`deadlines`:** when `daysUntilDeparture(brief.dates, now)` is not
      `null`, one entry naming every placed item whose `bookingLeadTimeDays`
      exceeds it, or `[]` when there are none. Re-packed days rarely contribute,
      because the packer already excludes such a candidate unless it is pinned.
      Frozen days are where this finds something. `open` dates give `null`, and
      the derived `booking-no-departure` already covers that.
3. **`droppedPins(previous, dayCount)`** returns the pinned items on days at or
   above `dayCount`, and **`droppedPinsRefusal(items)`** returns the
   `PLAN_INFEASIBLE` error, with `details: { findings: [{ kind:
"pin-on-dropped-day", dayIndex, detail }] }`. That is `compose`'s shape, so
   pl-45's rendering path needs nothing new. The kind is not a
   `CriticFindingKind` and must not be added to `CRITIC_FINDINGS`, because no
   critic produced it.
4. **`deadlines` is carried by every other writer.** `compose` writes `[]`.
   `replan` and `applyEdit` carry `previous.deadlines`, filtered to candidates
   still placed, and drop the entry when nothing is left. `restoreRevision`
   copies the target's as stored, as it copies pins.
5. **`uncheckedForRevision` loses its `brief` parameter** and reads
   `revision.brief`, then appends `revision.deadlines` after `revision.coverage`.
   Passing a brief separately invites passing `plan.brief`, which is the wrong
   brief for every revision after an edit.
6. **`diffRevisions` is unchanged.** Items on dropped days come out `removed`,
   and items on added days `added`, by pl-43's definition. The brief's own
   change is on the operation, and pl-48 renders it from there.

### 3. `api`

1. **Migration: take the next free number** (pl-49 took 9; pl-44 takes the
   next, 10 at the time of writing).

   ```sql
   ALTER TABLE plan_revisions ADD COLUMN brief_json TEXT;
   ALTER TABLE plan_revisions ADD COLUMN deadlines_json TEXT NOT NULL DEFAULT '[]';
   ```

   - **`brief_json` is nullable, and `NULL` means `plans.brief_json`.** Every
     row written before this migration was built from the plan's snapshot, and
     a column `DEFAULT` cannot read another table. The backfill cannot be an
     `UPDATE` either: `plan_revisions_append_only` refuses every one (pl-44
     step 7).
   - **`toRevision` takes the plan's brief as its fallback**, and
     **`insertRevision` writes `brief_json` on every insert**, the first draft
     included. A writer relying on `NULL` would silently attach the first
     draft's brief to a dates edit, so a test reads a brief-edited revision
     back and asserts its brief.
   - `deadlines_json` is JSON by migration 2's rule, parsed with the contract's
     schema, and a failure is a fatal corrupt read, as `coverage_json` is.
   - The migrations tests move their `user_version` expectation by one, and
     gain the cases in _Done when_.

2. **Every `plan.brief` read moves to the right revision's brief.** Grep `api/src`
   for `.brief`:
   - `readPlanView` calls `uncheckedForRevision({ candidates, revision })`.
   - pl-44's re-plan run reads the base revision's brief (pl-44 carries the
     same note).
   - `startRun` keeps writing `plans.brief_json`, and its first revision's
     `brief` is the same value.
3. **The route: kind `brief`**, after pl-44's checks 1–6, in this order:
   1. **Dates, when present**, go through `validateAnswer` from
      `@planner/intake`, with the tree node whose `fills` is `{ scope: "core",
slot: "dates" }` looked up from `QUESTION_TREE`, and the API's clock. That
      is `INVALID_DATES` for a past departure, a trip past `MAX_TRIP_NIGHTS`, or
      a window too short for its nights. Look the node up by what it fills,
      never by its id: the tree is content, and an id is not the thing this
      check is about.
   2. **A budget needs nothing past the schema.** `validateAnswer`'s `budget`
      case already says the schema is the whole check.
   3. **Dropped pins:** `droppedPins(latest, tripSpan(dates).dayCount)`. When
      that is non-empty, throw `droppedPinsRefusal`, synchronously, with
      409, and start no run. pl-44 adds that mapping; without it `STATUS_BY_CODE` falls back to 500. A
      refusal that is knowable before the run must not arrive after a 202.
   4. **Then 202 `{ kind: "run", run }`**, spending the runs bucket (pl-44
      step 9).
4. **The run**, on pl-44's re-plan pipeline with no specialists named:
   1. A `roster` frame with `total: 0`. No discovery and no fan-out.
   2. **The brief:** the base revision's brief, with the edited slots replaced
      by `slot.answered(value)`.
   3. **Measure** `replanPool` over `briefEditSlice`'s resized revision and
      slice. Enter `grounding` only when there is something to measure.
   4. **Compose:** re-read the latest and check it is the base (pl-44 step 4.6.1),
      then `reviseBrief` with the pool, the table, `now`, and `previous.gaps`,
      `coverage` and `reading` verbatim. A `PLAN_INFEASIBLE` from it fails the
      run with its `details` untouched.
   5. `persist`, then `done`.
5. **`reason.ts` gains its rows** (pl-44 step 6 owns the file and its rules):

   | Operation                                | Reason                                                                        |
   | ---------------------------------------- | ----------------------------------------------------------------------------- |
   | dates, longer                            | `Changed the dates, and planned days 9–10.`                                   |
   | dates, shorter                           | `Changed the dates, and dropped days 7–8.`                                    |
   | dates, same length                       | `Changed the dates.`                                                          |
   | budget, or day count under a per-day one | `Changed the budget, and re-packed every day.`                                |
   | dates and budget                         | `Changed the dates and the budget, and re-packed every day.`                  |
   | dates shorter and budget                 | `Changed the dates and the budget, dropped days 7–8, and re-packed the rest.` |

   No date or amount goes in the caption. Formatting a date or a currency is
   the page's job, and the operation carries both ends (pl-48 renders them).

6. **Docs that say `coverage` is the only stored kind.** Update
   `.claude/rules/planner-unchecked-constraints.md` ("`coverage` is the one
   exception") and **both** matching sentences in `tools/planner/CLAUDE.md`:
   "the one `UncheckedConstraintKind` that is stored rather than derived" under
   `coverage`'s rule, and "derived rather than stored save for `coverage`" under
   _Name what you did not check_. Each names both stored kinds and the one reason they share: a fact from outside,
   or from a clock, cannot be re-derived on read.

## Traps

- **`plan.brief` is the obvious spelling, everywhere, and it is wrong after the
  first edit.** It reads correctly on every plan that exists at merge, because
  none has been edited. So a test edits the dates, then reads the view, and
  asserts that `trip-truncated`, `season-no-calendar` and the budget kinds
  follow the edited brief.
- **The `NULL` fallback hides a forgotten write.** It is the same trap as pl-44's
  `DEFAULT` on `operation_json`, and the read-back test is the guard.
- **A pin set while the run is queued can land on a day about to be dropped.**
  The route's check has already passed by then. `briefEditSlice` throws, the run
  fails with `PLAN_INFEASIBLE`, and a test proves it rather than trusting the
  pre-check.
- **Kept days keep their stored travel.** Re-dating a day changes no distance,
  so re-measuring it spends budget on nothing. Only the slice is measured.
- **A shorter `per-day` trip can refuse itself.** The ceiling shrinks with the
  day count. If the pinned items alone cost more than the new ceiling, nothing
  is left to drop, and the run fails `PLAN_INFEASIBLE` through the critic's
  existing hard `over-budget`. That is correct, and a test says so.
- **`deadlines` reads a clock, so its tests pass `now`.** Nothing under
  `itinerary` may read one (pl-9's purity rule).
- **If pl-43 or pl-44 land with a different shape than filed**, this ticket
  follows what landed, and records the difference in its Log. It does not
  restate their functions locally.

## Done when

- **Contract.** `PlanRevision.brief`, `deadlines`, the `brief` operation and
  request, `currentBrief` and `booking-deadline-passed` exist with schemas and
  exports. Each refine has its own failing test.
- **Resizing** (`itinerary`, one test each):
  - a longer exact trip keeps days 0..n-1 byte-identical apart from ids, and
    packs only the added days;
  - a shorter trip drops the trailing days and their unpinned items, which
    `diffRevisions` reports as `removed`;
  - a pinned item on a dropped day throws `PLAN_INFEASIBLE` with the
    `pin-on-dropped-day` finding;
  - a same-length shift re-dates every day and moves no item;
  - an `exact` to `open` change nulls every date.
- **Budget.** A lower budget re-packs every day, drops the dearest unpinned
  item on a day outside any earlier slice, and never drops a pin. Under a `per-day`
  budget, a longer or shorter trip re-packs every day, and a same-length shift
  moves no item.
- **Deadlines.** An earlier departure stores one entry naming a frozen item
  whose lead time no longer fits. `open` dates store none. A later move keeps
  the entry while the item is placed, and a remove of that item drops it.
  Restore copies the target's. `uncheckedForRevision` returns it after
  `coverage`.
- **Route.** A brief edit answers 202 with a `replan` run. It is refused with
  `INVALID_DATES` for a past departure and for a window too short, and with
  `PLAN_INFEASIBLE` for a dropped pin. A spy proves no refused request starts
  a run.
- **The run** makes zero model requests, asks grounding only about the slice's
  pool, and writes a revision whose `brief`, `operation` and `reason` match
  step 3.5's table.
- **Migration**, from the previous `user_version`: an existing revision reads
  back the plan's brief and `deadlines: []`, the append-only trigger does not
  fire, and a revision written afterwards reads back its own brief.
- **The rules file and the planner `CLAUDE.md`** name both stored kinds.
- `npm run check` and `npm test -- --project planner` pass. The e2e suite and
  the image gate do not run locally, and the gate says so rather than reporting
  green.

## The gate on this filing

**2026-09-13, Sonnet, read-only, asked to falsify every checkable claim in this
ticket and pl-48** against the code and against pl-42 to pl-46. Both briefs
were written on Opus. It is recorded here and not under `## Review`, because
there is no work yet to review.

28 claims were checked, and 24 held. Among them: every export, signature and
copy string the Log names; the dates node's `fills`; `slot.answered`;
`insertRevision`; the missing `PLAN_INFEASIBLE` status; that migration 9 is
the next free number; and the step references into pl-43, pl-44 and pl-45.

Findings, each checked by hand before it was fixed, all in the filing commit:

- **high — pl-48's browser step read a return date that does not exist.**
  `e2e/intake-walk.ts` answers the dates question in `open` mode, and
  `DatesEntry` renders its return input only in `exact` mode. pl-48 now extends
  the trip through the Nights field.
- **high — the per-day slice fired on any dates edit.** `budgetCeiling` reads
  only the day count, so a same-length shift would have re-packed every day,
  against this ticket's own "moves no item" line. The rule now keys on the day
  count changing.
- **med — `deadlines` was required but not in `NewRevision`'s `Pick`**, which
  left no writer able to stamp it. Now it is.
- **med — the fixture count was 11 of 22, and is 12 of 23.** A truncated
  listing; the Log says so.
- **low — `tools/planner/CLAUDE.md` has two sentences about the one stored
  kind, and step 3.6 named one.** It names both.

## Review

**Gate: PASS** — 2026-09-19 · `origin/main...HEAD` (fb15bc9) · code-review at medium, self-run (ticket-reviewer subagent, no Skill tool)

| Done when                                                                                                                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract: `PlanRevision.brief`, `deadlines`, the `brief` operation and request, `currentBrief`, `booking-deadline-passed`, each refine's own failing test                                                       | `contract/test/brief-edit.test.ts:67 "is required, and is a whole brief"`, `:109 "either change alone is accepted, and days may be empty"`, `:171 "names at least one"`, `:225 "is the plan's snapshot while no revision exists"`, `:238 "names booking-deadline-passed"` ✓                                                                                                                                                                            |
| Resizing: longer keeps 0..n-1, packs only added; shorter drops trailing + unpinned, reported `removed`; dropped pin throws `PLAN_INFEASIBLE`; same-length shift re-dates, moves nothing; exact→open nulls dates | `itinerary/test/brief-edit.test.ts:101 "keeps days 0..n-1 as they were, ids aside"`, `:133 "drops the trailing days and their unpinned items"`, `:150 "throws PLAN_INFEASIBLE with the pin-on-dropped-day finding"`, `:173 "re-dates every day and moves no item"`, `:193 "an exact to open change nulls every date"` ✓                                                                                                                                |
| Budget: lower budget re-packs every day, drops dearest unpinned, never a pin; per-day longer/shorter re-packs every day, same-length moves nothing                                                              | `itinerary/test/brief-edit.test.ts:229 "drops the dearest unpinned item wherever it is, and never a pin"`, `:270 "re-packs every day, because the ceiling moved"`, `:278 "a shorter trip re-packs every day it keeps"`, `:286 "moves no item, because the ceiling did not"` ✓                                                                                                                                                                          |
| Deadlines: earlier departure stores one entry; open stores none; later move keeps it while placed, remove drops it; restore copies target's; `uncheckedForRevision` after `coverage`                            | `itinerary/test/brief-edit.test.ts:346 "naming a frozen item whose lead time no longer fits"`, `:356 "open dates store none"`, `:362 "and a remove of it drops it"`, `:411 "a restore copies its target's, as stored, and its brief"`, `:423 "uncheckedForRevision returns it after coverage"` ✓                                                                                                                                                       |
| Route: 202 with a `replan` run; `INVALID_DATES` for a past departure and a too-short window; `PLAN_INFEASIBLE` for a dropped pin; a spy proves no refused request starts a run                                  | `api/test/brief-edits.test.ts:230 "answers 202 with a replan run"`, `:269 "and starts no run"` (parameterised over the three `INVALID_DATES` cases, `enqueue` spy asserted not called), `:289 "would drop a pinned item is PLAN_INFEASIBLE, 409, before any run"` ✓                                                                                                                                                                                    |
| The run: zero model requests, grounding only on the slice's pool, revision `brief`/`operation`/`reason` match step 3.5's table                                                                                  | `api/test/brief-edits.test.ts:366 "asks grounding only about the slice's pool, and writes what step 3.5 says"` (asserts `f.model.sent === 0`, grounding asked == pool, `revision.reason` literal), `:411 "re-packs every day, and measures the whole pool with no model call"` ✓                                                                                                                                                                       |
| Migration: existing revision reads back the plan's brief and `deadlines: []`, trigger silent; a later revision reads its own                                                                                    | `api/test/migrations.test.ts:433 "an existing revision reads back the plan's brief and no deadlines, and the append-only trigger does not fire"`, `:449 "a revision written afterwards reads back its own brief, never the plan's"` ✓ — independently reproduced: built a DB at `user_version = 10` (columns absent), inserted a revision the old way, ran `migrate`, read back through `selectPlan`/`toRevision` (the real reader, not a test double) |
| Rules file and planner `CLAUDE.md` name both stored kinds                                                                                                                                                       | verified by hand — `.claude/rules/planner-unchecked-constraints.md:62 "are the two exceptions, and they"`, `tools/planner/CLAUDE.md:154 "the other is"`, `tools/planner/CLAUDE.md:222 "It is keyed on"` ✓                                                                                                                                                                                                                                              |
| `npm run check` and `npm test -- --project planner` pass; e2e/image not run locally                                                                                                                             | verified — reproduced independently: `check` exit 0; `--project planner` 74 files, 1,264 tests (matches the Log). e2e and image gate: **unproven (gate)** — not run, said so rather than reported green                                                                                                                                                                                                                                                |

- **finding, informational, not a defect** · The "owner's list" I was asked to check the contract diff against (`PlanRevision.brief`, `.deadlines`, the `brief` `RevisionOperation`, the `brief` `ReviseRequest`, `booking-deadline-passed`) is a partial paraphrase, not the ticket's own scope. The actual diff also exports `briefOperationSchema` (the zod schema backing the `brief` `RevisionOperation` member — needed for `revisionOperationSchema`'s `satisfies z.ZodType<RevisionOperation>`) and `currentBrief` (a new function). Both are explicitly named in the ticket's own Build 1.1–1.2 and in Done-when's own first line ("`PlanRevision.brief`, `deadlines`, the brief operation and request, `currentBrief` and `booking-deadline-passed` exist with schemas and exports"). So the diff matches the ticket; it just doesn't match the shorter five-item list the orchestrator handed me. Not carried as a defect.
- **open decision, not a verdict** · `MAX_REVISIONS_PER_PLAN`'s "under 100 KiB" rationale (`contract/src/plan.ts:69 "under 100 KiB"`) was always a doc comment, not an enforced bound — no test asserts a `PlanView` byte size anywhere in the repo, and pl-42's own gate record disclosed its sizing script was never checked in ("not independently re-measured"). This branch's own empty-diff figure (~127–130 KiB at 50 revisions, per the Log) already exceeds the original number by ~30%, and the _worst-diff_ column pl-42 actually sized the ceiling against (95.5–96.4 KiB) was not re-measured here. I built a throwaway worst-diff analogue (3 items/8 days, 50 revisions, non-overlapping placements forcing every item removed+added, brief attached) and measured 112,891 bytes for a thinner-than-real fixture with a smaller synthetic brief (749 B vs. the real fixtures' 994–1,242 B) — consistent with, and probably an underestimate of, what the real worst-diff column would show. Two defensible answers: (a) leave 50 as is — the number was advisory, and the comment is now honest about the new figure; (b) lower the ceiling now that the practical size is roughly 30–50% over the original design point. I recommend (a), but it's contract-adjacent (`MAX_REVISIONS_PER_PLAN` is exported) and someone could reasonably pick (b) — sending to the orchestrator, not deciding it here.
- **measurement disagreement, unsettled** · I could not reproduce your reported near-timeout runtime for the revision-ceiling test at base `fb15bc9`. Checked out `fb15bc9` in this same worktree, rebuilt, and ran `npm test -- --project planner --reporter=verbose` twice: the test ("the revision ceiling is REVISION_LIMIT_REACHED, 409, for an edit and a re-plan alike") took 1545ms then 1540ms — nowhere near your cited 3067ms/5299ms. Isolated runs of just that test: 966ms, 969ms. This doesn't make the fix wrong — a 15s timeout on a 50-restore test is reasonable regardless — and I independently confirmed the citation-integrity claim (the diff touches only the closing `});` line, net zero line-count change, so nothing else moved). Flagging as a fact for the record, not a finding to act on: possibly machine/load-dependent, and two runs on my end can't rule your measurement in or out.
- **dropped** · none — nothing I found was rejected as wrong or already-fixed; the three items above are informational/open/unsettled, not "found and dismissed."
- **findings** · hunt run directly at medium depth by me (no Skill tool); 3 returned, 3 carried (0 med/high, 3 informational/open/measurement), 0 dropped.
- NFR: security n/a (no URL/header handling touched) · performance — see the open decision above · reliability ✓ (migration's `NULL`-fallback path traced through every reader; one-writer/transaction invariants unchanged) · maintainability ✓ (`repack` is the one shared packing path for `replan` and `reviseBrief`, confirmed not re-implemented and not exported from `itinerary`'s index).

## Log

**2026-09-13 — filed**, after pl-42 to pl-46 merged in #225, on the owner's
answers above. Facts checked against the code at `origin/main` `d3fca5e`:

- **The brief is stored once per plan.** `plans.brief_json` exists, and no
  column on `plan_revisions` holds one. Neither `plans` nor `plan_runs` has an
  intake id.
- **The critic's `over-budget` is hard and plan-wide.** It is in `HARD`, and
  its repair names the dearest unpinned item across every packed item, not a
  day's.
- **`budgetCeiling` multiplies `per-day` by `dayCount`**, and reads no date,
  which is why a change in day count moves the ceiling and a same-length shift
  does not.
- **The packer excludes a candidate as `booking-deadline-passed`** when its lead
  time exceeds `daysUntilDeparture`.
- **`uncheckedForRevision` takes `brief` as an input** and appends
  `revision.coverage`. Its header says it reads no clock.
- **`validateAnswer` is exported from `@planner/intake`.** Its `dates` case
  checks a past departure, `MAX_TRIP_NIGHTS` (60) and a narrow window, and its
  `budget` case adds nothing to the schema.
- **Lead times in the fixtures:** 12 of the 23 candidates in the six
  `contract/test/fixtures` trip-shape files carry a non-zero
  `bookingLeadTimeDays` (7, 21, 30, 45, 60, 90 ×2, 120 ×2, 150 ×2, 180), 3
  carry `0` and 8 `null`. The first count read 11 of 22, because its listing was
  piped through `head` and dropped the `180` from `resort.json`. The filing gate
  caught it.
- **`PLAN_INFEASIBLE` has no entry in `STATUS_BY_CODE`**, so over HTTP it
  would answer 500. pl-44's route section now maps it to 409. Its copy is "This trip cannot be planned as described —
  something has to give."
- **`web` has no per-kind label for unchecked entries**, so a new kind needs no
  change there to compile.

**2026-09-19 — built.** Branched from `origin/main` at `fb15bc9` (on the
remote), dispatched as Opus. pl-42, pl-43 and pl-44 were merged on that base
with the shapes this brief names, so nothing here follows a different landing.
**Migration 11 was the next free number**: pl-44 took 10, and
`gh pr list --state open` showed no open planner pull request but a release.

**What landed.**

- `contract`: `PlanRevision.brief` and `PlanRevision.deadlines`, both in
  `NewRevision`'s `Pick`; the `brief` member of `RevisionOperation` and of
  `ReviseRequest`, each with its refine; `booking-deadline-passed` in
  `UNCHECKED_CONSTRAINTS`; `currentBrief`. `PlanDetail.brief`'s doc comment now
  says it is the first draft's.
- `itinerary`: `brief-edit.ts` (`briefEditSlice`, `reviseBrief`, `droppedPins`,
  `droppedPinsRefusal`) and `deadlines.ts` (`deadlinesFor`,
  `carriedDeadlines`). `replan`'s body is now `repack`, which takes the slice
  apart from the operation it stamps, and `replan` and `reviseBrief` both call
  it. `compose` stamps its brief and `[]`; `applyEdit` and `replan` carry
  `previous.deadlines` for the items still placed; `restoreRevision` copies the
  target's brief and deadlines. `uncheckedForRevision` takes no brief and
  appends `deadlines` after `coverage`.
- `api`: migration 11; `toRevision` falls back to `plans.brief_json` on `NULL`
  and `insertRevision` writes both columns on every row; the `brief` route
  checks and run in `runs/revise.ts`; `reason.ts`'s brief captions; a brief
  edit spends the runs bucket. The re-plan run and the edits read the base
  revision's brief, never `plan.brief`.
- **`orchestrator.ts` changed in one hunk**, `readPlanView`'s call to
  `uncheckedForRevision`, which lost its `brief` argument. pl-50 also edits that
  file; the two touch different functions.
- Docs: the rules file and both sentences in `tools/planner/CLAUDE.md` name both
  stored kinds and their shared reason; `01-ARCHITECTURE.md`'s rate-limit bullet
  says a brief edit spends the runs bucket.

**What the brief had wrong, or did not say.**

- **Step 3.5's per-day row says "Changed the budget" for a change nobody made.**
  "Budget, or day count under a per-day one → `Changed the budget, and re-packed
every day.`" would caption a dates-only edit under a `per-day` budget as a
  budget change. I built the rule the other rows follow: the subject is what the
  user changed, the action is what the tool did. That case reads `Changed the
dates, and re-packed every day.`, or `…, dropped days 7–8, and re-packed the
rest.` when it is shorter. Every other row of the table is reproduced word for
  word, and `reason.test.ts` says why the one differs.
- **`droppedPinsRefusal(items)` cannot name an item from a pin alone.** A
  `PinnedPlacement` carries a candidate id, and pl-48 renders each finding's
  `detail` as the sentence naming the item. So it takes the candidates too,
  `droppedPinsRefusal(dropped, candidates)`, and `briefEditSlice` takes
  `candidates` for the same reason. The detail reads `“<title>” is pinned to day
4, which the new dates drop. Unpin it to shorten the trip.`, one finding per
  pin. `PLAN_INFEASIBLE`'s own copy needed no re-wording.
- **An empty slice would still have measured.** `replanPool` over no days
  returns every unplaced candidate, because nothing is frozen away from it. A
  shift or a shortening re-packs nothing, so the run measures nothing when the
  slice is empty, and goes `queued → composing`.
- **"A budget change" is the request naming a budget, not the value moving.**
  I built it as written: a budget sent equal to the current one still re-packs
  every day. Its diff is empty only when the re-pack reproduces the days, which
  a plan hand-edited since its last pack need not. An equal dates edit with no
  budget re-packs nothing and its diff is empty, and a test says so. pl-48
  already sends only the slots that changed, which is where this matters.
- **The draft's budget is `unknown`, not a band.** The budget question is not
  asked before a draft, so a first edit's `budget.from` is `{ state: "unknown" }`
  on every plan the API has made. The trap test asserts `budget-band` appearing
  after a band edit, since there was none to disappear.
- **`deadlines` is bounded at one entry**, beside the kind refine. Step 2.2.5
  writes one entry naming every item, and a second would be a second sentence
  about the same moment.
- **A revision now weighs about 1.1 KiB more.** Each carries its brief: 994 to
  1,242 bytes of JSON across the six fixtures. A scratch script that composes
  each fixture, appends 49 restores with a `replan` operation, and validates the
  plan and the view printed `city-and-culture … revisions=50 diffs-empty=130020`
  and `multi-city … revisions=50 diffs-empty=129429`. pl-42 measured the same
  column at 74,910 and 83,490 bytes. So the 50-revision ceiling's "under
  100 KiB" is now about 127 KiB with empty diffs; `MAX_REVISIONS_PER_PLAN`'s
  comment says so. I did not re-run pl-42's worst-diff column.

**Fold-in.**

- **The revision-ceiling test in `revisions.test.ts` is flaky on `origin/main`.**
  It makes fifty restores. On `fb15bc9` unmodified, two full planner runs gave it
  3,067 ms and then 5,299 ms, the second a timeout at vitest's 5 s. It now has a
  15 s timeout, on its closing line so that no cited line moves.
- The architecture's rate-limit bullet, stale the moment a brief edit became a
  run.
- **Four merged gate records cite lines this branch moves.**
  `node scripts/citations-gate.mjs --against origin/main` failed on pl-42, pl-43,
  pl-44 and pl-49. Each citation is repointed to the line its anchor now sits on.
  None of them was deleted. Two new test titles first repeated a cited anchor
  (`with the trigger silent`, `fits the schema's bound`), which the
  distinct-anchor rule refuses; they were renamed rather than the old records
  touched.

I saw nothing else this branch made free.

**Not measured, and said so.**

- The e2e suite and the image gate do not run locally. `api/package.json` is
  unchanged, since `@planner/intake` was already a dependency, so the
  `Dockerfile` is too.
- **Grounding over an edit's added days asked one place.** The scripted draft
  leaves one candidate unplaced, so the longer-trip test's pool is one
  candidate; it asserts that pool is non-empty and smaller than the plan's, and
  that grounding heard exactly its places.

### Verification

**Narrowest specs, green:**

| File                                          | Tests |
| --------------------------------------------- | ----- |
| `contract/test/brief-edit.test.ts` (new)      | 22    |
| `contract/test/plan.test.ts`                  | 35    |
| `itinerary/test/brief-edit.test.ts` (new)     | 19    |
| `itinerary/test/first-draft-baseline.test.ts` | 27    |
| `api/test/brief-edits.test.ts` (new)          | 14    |
| `api/test/migrations.test.ts`                 | 17    |
| `api/test/reason.test.ts`                     | 17    |
| `api/test/revisions.test.ts`                  | 33    |

**The first-draft baseline was not rewritten.** It predates both fields, so the
comparison drops `brief` and `deadlines` from each result, key order otherwise
unchanged, and a new block asserts `compose` stamps the case's brief and `[]`.

**Twenty-eight mutations**, each applied alone by a scratch script that
rebuilds the mutated package, runs the named files, restores the source and
compares it byte for byte. Every restore compared identical. Each count is failed
of total. They ran before the last two edits, a doc comment in `plan.ts` and the
equal-values test.

| Mutation                                                     | Failed       |
| ------------------------------------------------------------ | ------------ |
| M1 a day-count change under per-day re-packs only added days | 2 of 18      |
| M2 a budget change does not re-pack every day                | 1 of 18      |
| M3 per-day re-packs every day on any dates edit              | 1 of 18      |
| M4 `briefEditSlice` does not refuse a dropped pin            | 2 of 32      |
| M5 kept days not re-dated                                    | 2 of 18      |
| M6 `reviseBrief` stores no deadlines                         | 5 of 18      |
| M7 `carriedDeadlines` does not narrow                        | 2 of 18      |
| M8 `replan` drops deadlines                                  | 1 of 18      |
| M9 `restoreRevision` drops deadlines                         | 1 of 18      |
| M10 `uncheckedForRevision` omits deadlines                   | 1 of 18      |
| M11 `toRevision` always reads the plan's brief               | 6 of 31      |
| M12 `insertRevision` leaves `brief_json` NULL                | 6 of 31      |
| M13 the route skips `validateAnswer`                         | 3 of 14      |
| M14 the route skips the dropped-pin check                    | 1 of 14      |
| M15 a re-plan reads `plan.brief`                             | 1 of 14      |
| M16 an edit stamps `plan.brief`                              | 1 of 14      |
| M17 a brief edit spends the edits bucket                     | 1 of 14      |
| M18 the run measures the whole pool                          | 1 of 14      |
| M19 no re-read before composing                              | 1 of 14      |
| M20 the per-day caption names the budget                     | 1 of 17      |
| M21–M25 each contract refine removed, one at a time          | 1 of 22 each |
| M26 `currentBrief` reads `plan.brief`                        | 1 of 22      |
| M27 `compose` stamps a different brief                       | 13 of 27     |
| M28 `deadlines` bounded at 9 rather than 1                   | 1 of 22      |

**M16 was never run without its test.** While writing the list I saw that
nothing did a move or a remove after an edit over HTTP, so no test could see
M16, and I added "a remove after an edit keeps the edited brief" before the
first mutation run. That M16 would have survived is reasoning, not a run.

**Gates, at the end.** `npm run check` exited 0. `npm test -- --project planner`
passed at 74 files and 1,264 tests. `node scripts/citations-gate.mjs --against origin/main`
reports 89 enforced and 0 failing.

**2026-09-19 — gated, PASS at `ced256c`, and the owner answered three
questions.** `## Review` above is the ticket-reviewer's text, committed
verbatim. Its open decision on the ceiling has since been answered: the owner
kept 50, with the measurement below attached. The owner also took the caption
and the budget-presence calls as built. All three are under _Decided by the
owner, 2026-09-19_.

**The worst-diff measurement.** I reconstructed pl-42 step 7's method from its
Log in a scratch script that is not checked in. It composes each fixture with
`NOTHING_MEASURED` and appends copies with new ids and a `replan` operation.
It validates the plan with `planDetailSchema` and the view with
`planViewSchema`. The worst diff is written entry by entry: every parent item
removed, every child item added. The same file ran against both trees'
`dist`. At fb15bc9 the empty-to-worst step matches pl-42's printed figures to
the byte, 22,883 bytes for city-and-culture and 15,239 for multi-city. The rest
runs about 1.2% under pl-42's figures. The reviewer re-ran the script in its own
worktree and got identical numbers on both trees. The table is in
`MAX_REVISIONS_PER_PLAN`'s comment. Its largest figure is road-trip, whose worst
diff at 50 revisions is 168,514 bytes here and was already 105,214 at fb15bc9.
pl-42 printed only two fixtures. A grep of the planner's `src`, `test` and
`e2e` found nothing that consumes a view's size. The one `bodyLimit` caps
request bodies.

**The timeout measurement stays unsettled.** Mine was
`npx vitest run --project planner --reporter=verbose` at fb15bc9, run twice while
six other builders shared this 12-core machine. I did not record the load. The
reviewer's quieter runs gave 1,545 and 1,540 ms. The 15 s timeout stays.

**`## Review` differs from the reviewer's text in one place.** Its
open-decision bullet cited `contract/src/plan.ts:69` with no fragment, and
`node scripts/citations-gate.mjs --against origin/main` refused it as
unanchored. It now reads `contract/src/plan.ts:69 "under 100 KiB"`, the text
already on that line. This is a mechanical anchor qualification, made on the
coordinator's instruction, and it changes no verdict, row or severity. pl-44's
record carries the same kind of change.

**2026-09-19 — rebased onto `2e5bd9f`**, after pl-46 (#276), pl-50 (#274) and
the rest of that batch merged, so this branch lands last. One conflict, in
pl-49's citation table, where pl-50 and this branch had repointed the same two
citations: pl-50's landed version was kept and repointed on top of it. Three
citations moved and were repointed, coordinates only, with no verdict, row,
severity or wording touched:

- **pl-46's record** cites `tools/planner/CLAUDE.md` for the e2e spec count.
  The two lines this branch adds above it move that text from 181 to 183.
- **pl-49's record** cites two migration tests, which migration 11's tests move
  from 149 and 158 to 156 and 165.

After them `node scripts/citations-gate.mjs --against origin/main` reports 97
enforced and 0 failing.
