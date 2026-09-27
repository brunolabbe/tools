---
id: pl-53
tool: planner
title: A plan's title keeps the first draft's dates and length after a brief edit
kind: fix
status: ready
milestone: P4
depends_on: [pl-47]
difficulty: standard
---

# pl-53 — Retitle a plan after a brief edit

## Why

[pl-47](./pl-47-edit-the-dates-and-budget.md) lets a plan's dates and budget
change after the first draft, and [pl-48](./pl-48-change-dates-and-budget-on-the-page.md)
puts a control on the page for it. Neither touches the plan's `title`, which
`api/src/intakes/title.ts`'s `intakeTitle` derives once, from the first
draft's brief, and `runs/orchestrator.ts`'s `startRun` writes into `plans` at
draft time (`insertPlan(..., title: intakeTitle(brief) ?? UNTITLED, ...)`).
Nothing under `runs/revise.ts` writes it again.

`intakeTitle`'s own words are dates- and length-sensitive: an `open` trip's
title names its nights ("… for 5 nights"), an `exact` or `window` trip names
its departure month. Both a dates edit — pl-47's own worked example — and,
less often, one that crosses a month boundary leave the stored title
describing a trip that no longer exists, on the plans list
(`Plans.tsx`) and on the plan page's own heading (`PlanView.tsx`'s
`<h2>{plan.title}</h2>`).

**Reproduced**, off `pl-48`'s own e2e walk (`e2e/revise.spec.ts`,
`e2e/intake-walk.ts`): a draft answers the destination "Montréal", the dates
question in `open` mode with 5 nights, and reaches `intakeTitle`'s
"Montréal — a road trip for 5 nights". `pl-48`'s new step extends the trip to
6 nights (7 days) through a brief edit. After it, `GET` on the plan still
answers `plan.title` of "Montréal — a road trip for 5 nights" — five, not six
— because nothing recomputed it. The page's heading renders `plan.title`
verbatim, so a reader sees the stale count beside a draft that has moved on.

## Build

**Recommended shape: retitle on write, in the brief-edit route.** The plan's
row already carries a stored `title`, and every other write to it — pl-49 or
pl-50's cost bookkeeping aside — goes through `runs/orchestrator.ts` or
`runs/revise.ts`; keeping `title` a stored column that a write updates, rather
than something `readPlanView` derives, means the list route
(`fetchPlans`/`Plans.tsx`) and the detail route stay the same shape and neither
grows a dependency on `currentBrief` it does not otherwise have.

1. In `runs/revise.ts`'s brief-edit handler (pl-47's Build step 3.4's run),
   after the edited brief is known and before — or alongside — the revision it
   writes, compute `intakeTitle(editedBrief) ?? UNTITLED` and update
   `plans.title` in the same transaction the revision is appended in. `pl-49`
   or `pl-50` may have already added a write to `plans` in this path for cost
   bookkeeping; if so, this joins it rather than opening a second one.
2. **An open decision worth raising rather than assuming: derive at read time
   instead.** `readPlanView` already calls `currentBrief(plan)` for other
   purposes (pl-47); a title computed there from `currentBrief(plan)` needs no
   write path and cannot drift, at the cost of `Plans.tsx`'s list route
   needing the same call per row (it reads `Plan`, not `PlanView`, today) and
   losing the stored column's simplicity. Worth a line in the Log on whichever
   way this lands and why, since the alternative is real rather than a straw
   option.
3. **`title.ts`'s own bound and edge cases are unchanged.** `MAX_TITLE_CHARS`,
   `truncate`, and the destination/no-destination branches are pl-7's, not
   this ticket's to revisit — the same function, called again with a
   different brief.
4. Tests: a brief edit that changes the day count (open mode, nights) updates
   `plans.title`'s stored nights; one that only moves the departure across a
   month boundary updates the month clause; a budget-only edit leaves it
   unchanged (nothing in `intakeTitle` reads budget). Read back through
   `selectPlan`/`fetchPlans`, not only the revise route's own response, since
   the list route is the other reader.

## Done when

- A brief edit that changes the day count or the departure's month is
  followed by a `GET` on the plan (and on the plans list) whose title reflects
  the edited brief, not the first draft's.
- A budget-only edit's title is unchanged, asserted directly (not merely
  absent of a failure).
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-09-27 — filed** from [pl-48](./pl-48-change-dates-and-budget-on-the-page.md)
gate 1's low finding (an open decision, not a verdict): the owner chose
option (a), file a ticket for the API to retitle on a brief edit, over (b)
folding a page-side derivation into pl-48. Checked against the code at
`origin/main` `c87153d`:

- `intakeTitle` (`api/src/intakes/title.ts`) is called three places, not one
  — this Log first said one, and gate 2 of [pl-48](./pl-48-change-dates-and-budget-on-the-page.md)
  caught it: `api/src/intakes/state.ts:173` and `:338`, for the intake's own
  title before it is a plan, beside `runs/orchestrator.ts:201`'s
  `startRun`. **Only `startRun`'s call writes a `plan`'s title**, at draft
  time — the other two write an intake row, a different table this ticket
  does not touch.
- `runs/revise.ts` writes no `title`; grepping it for the word finds only a
  candidate's own `title` field, unrelated.
- The reproduction above was read off `pl-48`'s own e2e fixtures
  (`e2e/intake-walk.ts`'s destination and dates answers, `pl-48`'s new
  extend-by-a-night step), not run against a live server for this filing —
  this ticket's own Build step 4 is where that read becomes a test.
