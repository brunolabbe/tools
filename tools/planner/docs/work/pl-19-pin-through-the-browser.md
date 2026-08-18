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

**2026-08-18 — done.** `tools/planner/e2e/pin.spec.ts`, one test, one browser:
answer the intake to the checkpoint, draft, wait for the run against the scripted
provider, open the plan, pin the first item, reload, come back to it, unpin,
reload, come back again. `npm run e2e:planner` is green — three specs, 10.6s
locally, of which the new one is 2.3s. `npm run check` is green. **Neither runs
in CI's default gate**: this proof lives in `.github/workflows/planner.yml`, which
is the same thing pl-10's row said about the claim it replaces.

**The walk down the tree moved to `e2e/intake-walk.ts`.** The brief said "a spec
beside `intake.spec.ts`, in the same style" and the style is 120 lines of
question-agnostic filling that the new spec needs before it has anything to pin.
Copying it would have put a second copy of _the rule_ — never name a question —
in a file where the next person to edit the tree would not think to look, which
is the failure the rule exists to prevent. So the helpers moved unchanged and
both specs import them. It is not a spec file, so Playwright's `testMatch`
ignores it while `e2e/tsconfig.json`'s `**/*.ts` still type-checks it; the
file-level `oxlint-disable no-await-in-loop` moved with the loop that earned it,
and `intake.spec.ts` no longer needs one.

**What the brief did not know: getting back to a plan is not one screen, and it
is not the same number of screens twice.** A plan being open is deliberately not
remembered across a reload (`App.tsx` — a plan is addressable and the list is one
click away), while the open _intake_ is, in `localStorage`. So the first reload
lands on the wizard at its checkpoint and needs "← All trips" before the plan
list; clicking that is what forgets the intake, so the second reload lands on the
trip list already and there is no such button. The first version of the helper
clicked it unconditionally and hung for the full timeout on the second reload —
which is the whole four minutes of the first red run. It now reads which screen
it is on rather than counting its own calls, because asserting either would be
asserting the last thing the helper did.

**The plan list had to be scoped.** A plan's title and its intake's title are
both `intakeTitle` over the same brief, so "Montréal — a road trip for 5 nights"
matches a button in `Your trips` and a button in `Plans`. The reopen is scoped to
`ul.plans`, and the title is read off the plan's own `h2` rather than composed
from the answers — it is made of the shape, the dates and the destination, all
three of which are tree content.

**The revision count is read from `p.crumb` inside `section.panel.plan`**, not
from the database and not from the plan list. The whole line is captured before
the pin and compared after each pin, unpin and reload, so the `· first draft`
reason is part of the assertion too. There is a second `p.crumb` on the page —
the `← Back` breadcrumb — which is why it is scoped rather than global.

Traps in the brief that held up exactly as written: the scripted provider needed
no configuration, the spec names no question and counts none, and no new project
or `tsconfig` was needed.

**pl-10 re-gated.** Its `unproven (gate)` row for pinning is now marked proven in
a dated follow-up appended under its Review, and its second `med` finding closed
with it. The gate table itself is left as written — it was true when it was
written. Its _other_ `unproven (gate)` row, `describeCost` rendering
`low === high` as a single figure, is untouched and still unproven.

`tools/planner/docs/03-STATUS.md`: spec count 2 → 3, this row to `done`, and the
"Pinning is proven at each end and not across the middle" gap rewritten as
closed. `tools/planner/e2e/README.md` was still the placeholder written before
pl-13 landed a spec in it, and now lists what is there.

**2026-08-18, after the pull request was open — two corrections.**

The re-gate note first appended to pl-10 said its _other_ `unproven (gate)` row,
`describeCost` rendering `low === high` as a single figure, was still open. It is
not: `web/test/plan-view.test.tsx:219` asserts exactly that branch — "a genuinely
fixed price is labelled as posted, not shown as a bare figure" — and it arrived in
pl-10's own merge (`6291ee5`, #44), after the review was written against an
earlier state of the branch. So both `med` findings and both gate rows are closed,
one by this ticket and one by pl-10 itself, and the note now says so. **The lesson
is narrow and worth writing down: a review gate is a statement about the branch it
was read on, not about the ticket**, and a follow-up that quotes it has to re-check
it rather than trust it.

`tools/planner/CLAUDE.md` also described the suite it no longer had — "two specs
over one path", with `e2e/intake.spec.ts` named as the file that carries the
never-name-a-question rule. That rule now lives in `intake-walk.ts`, which is the
whole reason the walk was extracted, so the page pointing at the old file was the
one sentence most likely to send the next agent to the wrong place.
