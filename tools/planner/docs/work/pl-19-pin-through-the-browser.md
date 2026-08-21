---
id: pl-19
tool: planner
title: Prove pinning through the browser, not at a mocked seam
kind: work-package
status: done
milestone: P2
depends_on: [pl-10]
---

# pl-19 — Pin through the browser

**Packages:** `e2e`

## Why

[pl-10](./pl-10-plan-view-and-provenance.md)'s acceptance said **"pinning from
the UI persists and creates no revision, asserted"**, and its review gate marked
that line `unproven (gate)` rather than proven. The reason is worth stating
precisely, because it is not that the code is suspected of being wrong:

- `web/test/plan-view.test.tsx` proves the **button** — a click calls
  `pinItem(planId, itemId, true)` and the view re-renders from what comes back.
  It cannot prove more, because it mocks `src/api/plan.ts` wholesale, and that
  mock is not a shortcut: this tool's rule is that **the fake is the API client
  module, never `fetch`**, since stubbing `fetch` means re-implementing route
  shapes in the browser suite and keeping a second copy of the server in step.
- `api/test/plan-view.test.ts` proves the **write** — it persists, it appends no
  revision, and the database's own trigger refuses anything else.

Each half is real. **The sentence spans both, and nothing crosses the seam**, so
the two tests compose into the claim only if you assume the client module does
what its type says. That assumption is exactly what an e2e suite exists to
remove, and pl-10 deliberately did not expand its own scope to add one — a
browser launch in CI is a cost someone should choose on purpose.

There is a second reason beyond closing a row. Pinning is the **only write in
this API that mutates a stored revision**, allowed by exactly one column of one
table (`plan_items_only_pinned_is_mutable`). A regression there is a silent
one — the button still depresses — and it is the write most worth having a real
browser exercise.

## Build

1. **A spec beside `e2e/intake.spec.ts`**, in the same style. Read
   `tools/planner/e2e/README.md` and the existing spec first; the fixture server
   and the built-bundle setup are already there and are not this ticket's to
   change.
2. **Drive the whole path in one browser**: answer an intake to the checkpoint,
   draft it, wait for the run to finish against the scripted provider, open the
   plan, pin an item, **reload the page**, and assert the item is still pinned.
   The reload is the assertion that matters — it is what distinguishes a pin
   that reached SQLite from one that only reached React state.
3. **Assert no revision was appended** from the UI's own vocabulary: the
   "Version 1 of 1" line must still read the same after the pin. Do **not** reach
   into the database from the spec — the point of this suite is that it sees what
   a user sees, and a spec that queries SQLite is an integration test wearing a
   browser.
4. **Unpin, reload, assert it stuck** too. A pin that cannot be undone is a
   different bug and costs one more step here.

Traps worth knowing in advance:

- **The spec must not name a question.** `e2e/intake.spec.ts` fills whatever
  control is in front of it and keeps the prompts it was shown, precisely so a
  tree edit is not a red build — the tree is content and is reviewed as content.
  Getting to the checkpoint here has to borrow that approach, not hard-code a
  path through the tree. As of [pl-18](./pl-18-destination-asked-early.md) the
  checkpoint is eight questions asked for a road trip; counting them in a spec is
  the mistake this rule exists to prevent.
- **The scripted provider is what makes this deterministic**, and it is already
  the default. A run against it finishes without a key and without a bill, which
  is the only reason a run is affordable in an e2e at all.
- **A run takes real time.** `runToCompletion` in the API suite polls the store
  because the SSE hub is not a replay log; in the browser the equivalent is
  waiting for the finished state to render, not for a fixed duration.
- **This is the second `e2e` spec in the tool, not a second suite.** No new
  project file, no new `tsconfig` — `tools/planner/e2e/tsconfig.json` already
  covers `*.spec.ts` in that directory. Adding one would be the mistake the root
  `CLAUDE.md` warns about from the other direction.
- **The gate this proves lives in `.github/workflows/planner.yml`** and nowhere
  else, so it does not run in `npm test`. That is the whole reason pl-10's row
  said `unproven (gate)` rather than `unproven`, and it stays true of this
  ticket's own proof.

## Done when

- A Playwright spec pins an item, reloads, and asserts it is still pinned —
  against the built bundle, through the real API, with nothing mocked.
- The same spec asserts the revision count is unchanged after pinning, read from
  the page rather than from the database.
- Unpinning survives a reload, asserted.
- The spec names no question id and counts no questions.
- `npm run e2e:planner` passes, and the planner workflow runs it.
- pl-10's `Done when` row for "pinning from the UI" can be re-gated as **proven**
  — this ticket exists to make that row true rather than to re-word it.

## Log

**2026-08-21 — done.** `e2e/pin.spec.ts`, two specs, in the suite the planner
workflow already runs. Four specs in the tool now, over two paths.

### The walk had to be extracted, not copied

The brief said "in the same style" and "borrow that approach" for getting to the
checkpoint. Borrowing it by copy would have been ~120 lines of `fillField` and
`answerThroughCore` duplicated, and **the duplicated part is the fragile part**:
the rule those helpers encode is that the tree is content and a spec must never
name a question, so a second copy is a second place to get that wrong — and the
one nobody reads before editing the tree. So the walk moved to
`e2e/intake-walk.ts` and both specs import it. `intake.spec.ts` lost its helpers
and kept its two tests unchanged; nothing about the walk itself changed.

A `.ts` and not a `.spec.ts`, so `testMatch: "**/*.spec.ts"` does not try to run
it as a suite with no tests in it. No tsconfig change: `e2e/tsconfig.json`
already includes `**/*.ts`.

### What the specs do

Draft a plan from a fresh intake, read it, pin the first item, **reload**, come
back to it from the plan list, and find it still pinned. Then the same for
unpinning, which the brief asked for and which is worth its extra step — the
column is written through the one route either way, and a route that only ever
wrote `1` passes everything else.

Three things the brief did not anticipate:

**A reload does not land back on the plan.** `App.tsx` remembers which _intake_
was open in `localStorage` and deliberately does not remember which plan is being
read — pl-10 stops at the list and the document, and restoring one would be
guessing at what someone wanted to see. So the reload comes back to the _wizard_
at its checkpoint, and getting to the plan means the crumb out to the list and
then the plan by its title. That is a truer test than the brief's wording
implies: it goes through `GET /api/plans` and `GET /api/plans/:id` as a returning
user would, rather than re-rendering a component with the same props.

**The plan's title is read, never named.** It is derived from the brief, so
writing it into the spec would be the tree's content copied in — the mistake
`intake-walk.ts` exists to prevent. Same for the item: it is found by its own
heading rather than by index, so the assertions after the reload are about the
same item and not merely about the first one on the page.

**The version line carries the reason too.** `p.crumb` renders
`Version 1 of 1 · The first draft.`, and the spec captures the whole string
before the pin and asserts the whole string after. Stronger than matching
"Version 1 of 1", and it is what caught mutation 3 below with a legible message.

An assertion the brief did not ask for and that is cheap here: **only the item
that was pinned is pinned.** A write that set the column on every row of the
revision passes every other assertion in the file.

### Mutation-tested, because nothing was broken to begin with

1. **Reads never report a pin** (`row.pinned === 1` → `false`) — both specs fail
   after the reload; both intake specs still pass.
2. **A pin that only reaches React state** — `pinItem` in `web/src/api/plan.ts`
   re-fetches the plan and returns it with the item flipped locally, never
   calling the route. **This is the one that matters.** Every pre-reload
   assertion passes — the button flips, the label says "Pinned" — and the failure
   lands on the post-reload line. `web/test/plan-view.test.tsx` passes this
   mutation unchanged, because the mock _is_ the client module. That is exactly
   the seam pl-10's gate described, demonstrated rather than argued.
3. **A pin that appends a revision** — `pinItem` in the orchestrator appends a
   real revision through `appendRevision` + `insertRevision`. Fails on
   `Expected: "Version 1 of 1 · The first draft." Received: "Version 2 of 2 · pinned"`.

The first attempt at 3 reused the latest revision's day and item ids and failed
with a 500 from the `UNIQUE` constraint — a red suite for the wrong reason, and
not a proof that the version line does anything. Worth recording: a mutation that
fails somewhere other than the assertion under test proves nothing about it.

### What is not here

No database access from the spec, as the brief required — "no revision was
appended" is read off the page's own version line. It runs only in
`.github/workflows/planner.yml`, not in `npm test`; that is unchanged and is why
pl-10's row said `unproven (gate)` rather than `unproven`, and it stays true of
this proof too.

`npm run e2e:planner` passes, 4 specs in 13 s. `npm run check` green, 1,092 unit
tests pass across 79 files.
