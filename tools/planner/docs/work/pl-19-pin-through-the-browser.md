---
id: pl-19
tool: planner
title: Prove pinning through the browser, not at a mocked seam
kind: work-package
status: ready
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

_Not started._
