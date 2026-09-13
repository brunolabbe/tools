---
id: pl-45
tool: planner
title: Revise a plan, pick a version, and read the diff
kind: work-package
status: ready
milestone: P4
depends_on: [pl-42]
difficulty: standard
---

# pl-45 — Revise, pick a version, and read the diff

**Packages:** `web`, built against a mocked API client — [dl-4](../../downloader/docs/work/dl-4-web-ui.md)'s
approach, which the roadmap names by name for this ticket.

## Why

[pl-10](./pl-10-plan-view-and-provenance.md) built the honest read of one
document and stopped on purpose: _"the diff is Phase 4 and is out of
scope … what is rendered is the latest draft."_ `PlanView.tsx` today hard-codes
`latestRevision(plan)` and renders one crumb line — `Version X of Y · reason` —
with no way to see an older draft, let alone change anything. Analysis §6 and
its amendment call revision "the whole product": pinning already reached the
browser in P2 ([pl-19](./pl-19-pin-through-the-browser.md)), and this ticket is
what makes the other two roadmap promises — re-plan a slice, read the diff —
reachable by a person rather than only by a test.

[pl-42](./pl-42-the-revision-contract.md) is the seam this builds against:
`RevisionOperation`, `RevisionDiff`, `ReviseRequest`/`ReviseResponse`,
`ROUTES.planRevisions`, `REVISION_STALE` and `PLAN_BUSY`. It has not been built
in this worktree yet — only filed — so everything below is written against its
**Build** section as a specification, the same way pl-43 and pl-44 are. If
anything here disagrees with pl-42's text, that is this ticket's problem to
raise, not to paper over.

## Build

1. **Two new functions in `web/src/api/plan.ts`**, beside `pinItem`, both
   hitting `ROUTES.planRevisions` / `planRevisionsUrl(id)`:
   - `startReplan(planId, request)` — POSTs a `{ kind: "replan", ... }`
     `ReviseRequest` and returns the `Run` from a `{ kind: "run" }`
     `ReviseResponse`, 202. Same shape as `startRun`.
   - `editPlan(planId, request)` — POSTs a `{ kind: "move" | "remove" | "restore",
... }` `ReviseRequest` and returns the `PlanView` from a
     `{ kind: "revision" }` `ReviseResponse`, 200. Same shape as `pinItem`.

   Two functions, not four, because the response shape is what actually
   differs — a run to watch, or a document to render — and that is the
   distinction a caller needs, not the operation's name.

2. **`PlanView.tsx` stops assuming "the shown revision is the latest one".**
   Today `Document` reads `latestRevision(plan)` once. Replace it with a
   `shownRevision` selection (default: the latest) over `plan.revisions`, which
   `PlanDetail` already carries in full — **no second fetch for an older
   version**, it is already on the document. A **version picker** lets a
   reader move through `plan.revisions`, each labelled `Version N of M ·
reason`; older ones are read-only and carry a **"Restore this version"**
   button.

   **Trap: do not touch the existing crumb line's text or its place in the
   DOM.** [pl-19](./pl-19-pin-through-the-browser.md)'s `e2e/pin.spec.ts`
   reads `p.crumb`'s whole text before the pin and asserts it contains
   `Version 1 of 1`. After the reload it asserts `toHaveText(version)`, which is
   the full captured string, so a picker rendered _inside_ `p.crumb`, or any
   copy added to it, breaks that spec. The spec runs against a real browser, in a
   suite this ticket cannot run locally. The version picker is a new control **beside** that line, not
   a replacement for it — when `shownRevision` is the latest, the line must
   still read exactly `Version {revision} of {latestRevision} · {reason}`.

3. **Restore is `editPlan(planId, { kind: "restore", revision: n,
baseRevisionId })`, and `baseRevisionId` is always the _current_ latest
   revision's id, never the one being viewed.** Restoring copies an old
   revision forward as a new one; the concurrency check is against what the
   plan actually is right now, not against the page someone is looking at.
   After it succeeds, `shownRevision` resets to the new latest — the user
   asked to bring version n back, and what comes back should be in front of
   them, not the old page they were reading.

4. **Move and remove act on items on the latest revision only** (pl-22's rule,
   extended: pins and edits both apply to the latest, never to history). Each
   placed item on the latest revision's `Day` gets, beside the existing Pin
   button:
   - **Move** — opens an inline, keyboard-operable control: a day selector
     (`Day 1` … `Day N`, 1-based per `format.ts`'s `dayHeading` convention) and
     a position selector, scoped to the chosen day's current item count.
     Submits `editPlan(planId, { kind: "move", itemId, toDayIndex, toPosition,
baseRevisionId })`. No drag-and-drop: every other control in this file is
     a button, a select or a checkbox, and a reorder that only a mouse can do
     would be the one interaction on the page that is not.
   - **Remove** — a direct button, submitting `{ kind: "remove", itemId,
baseRevisionId }` immediately, the same directness pin already has.
     Unlike a pin toggle this is not instantly reversible from the same
     control, but it is never destructive: the old revision still exists and
     "Restore this version" undoes it in one step, so a confirmation dialog
     would be guarding against a cost that does not exist.

5. **Re-plan named days**, on the latest revision only. A `<fieldset>` with:
   - A day checkbox per day of the latest revision — the `days` the operation
     may touch, non-empty to submit.
   - A specialist checkbox per member of `@planner/contract`'s `SPECIALISTS`
     list, labelled through this file's own `SPECIALISTS` map. That map is a
     `Record<string, string>` from id to display label, not the list, so iterate
     the contract's tuple and look labels up in the map. The boxes are
     **optional**, and the copy beside it says so: leaving every
     box unchecked re-packs the selected days from candidates the plan already
     has, with no model call and no new lookups. This is not the absence of a
     choice, it is one of the two choices, and the empty state must not read
     as "you forgot something".
   - An optional note, a `<textarea>` bounded by `MAX_REVISION_NOTE_CHARS` through
     `maxLength`, as the wizard's `text` control in `wizard/controls.tsx` does.
     That control shows no visible count, so adding one is this ticket's choice
     and not a pattern to copy,
     labelled as context — the copy says the specialists will read it, not
     that it is an instruction, matching §6's amendment on what a free-text
     note is and is not.

   Submits `startReplan(planId, { kind: "replan", days, specialists, note,
baseRevisionId })`. **On success this is a `Run`, and control leaves
   `PlanView` entirely** — hand it to a new `onReplan: (run: Run) => void`
   prop, wired at `App.tsx`'s level beside `Wizard`'s `onDraft`, which is
   `(run) => setWatching(run)`. A re-plan also needs `setReading(null)` first,
   because `App` renders `PlanView` for as long as `reading` is set, and the run
   would otherwise never be shown. Re-plan reuses the
   existing `RunView` and its SSE plumbing rather than inventing a second
   progress screen — the whole reason `Run.kind` exists on the contract is so
   one component can tell the two apart.

6. **`RunView.tsx` has to stop assuming every run is a first draft**, now that
   `Run.kind` (pl-42) can be `"replan"`:
   - `Finished`'s copy — `"A first draft is ready — …"` — is wrong for a
     re-plan and must branch on `run.kind`. Something like "This version is
     ready — …" for `"replan"`.
   - **The zero-specialist case named in this ticket's brief is real and
     reachable**: a re-plan naming no specialists re-packs with `rosterSize:
0`, and `progressLine`'s existing arithmetic renders that as `"0 of 0
specialists done."` — technically true and useless. Render **"Re-packing
     the existing days…"** (or equivalent) whenever `total === 0`, before
     falling through to the specialist-count sentence, regardless of status.
     Leaving `progressLine` as it is would be the n-of-n-of-nothing sentence the
     repo's _never fake progress_ rule is about, so this change is required.
   - Nothing else about the run/progress machinery changes — `queued →
composing` (pl-42's new edge) already renders correctly with no code
     here: `LABELS` has an entry for every `RunStatus`, and the bar's
     indeterminate state already covers "no roster frame has arrived yet".

7. **The diff**, rendered once a revision after the first is shown. Look up
   `view.diffs.find((d) => d.revisionId === shownRevision.id)` — never assume
   `diffs[i]` lines up with `revisions[i]` by index, since revision 1 has no
   entry and an off-by-one there would silently show the wrong diff for every
   later revision. Render **three short lists, never prose**: Added, Removed,
   Moved, each entry naming the candidate (`plan.candidates.find` by id, the
   same resolution `Day`/`Item` already do) and its placement as `Day N`
   (1-based `dayIndex`, no date — a diff's `DiffPlacement` carries no date and
   a removed entry's "from" day belongs to a revision this component is not
   necessarily showing, so inventing one would repeat pl-10's "no invented
   dates" rule in a new place). Caption the whole section with
   `shownRevision.reason` — already rendered above it in the crumb line, so do
   not repeat it — plus, when the operation is a `replan` and carries a note,
   the note itself, visibly marked as what the user wrote rather than as the
   tool's own words.

   **What counts as `moved` is pl-43's definition, not this ticket's to
   second-guess.** Render whatever `RevisionDiff.entries` says.

8. **Controls absent on an older revision, and copy says why.** When
   `shownRevision.revision !== plan.latestRevision`, render neither the
   re-plan fieldset nor the per-item Move/Remove buttons; in their place, one
   line: something like "Editing works on the latest version. Restore this one
   to bring it back, or open the latest to keep going." **`Unchecked` (§7's
   "what was not checked") only ever describes the latest revision** —
   pl-42's contract says so on `PlanView.diffs`'s doc comment — so it must
   render only when `shownRevision` **is** the latest; do not carry the
   latest's list onto an older page by leaving the existing unconditional
   render in place.

9. **Errors**, at the two seams that can fail:
   - **The synchronous seam** (`editPlan`, and the initial `startReplan` POST
     before a run exists) — a banner beside the document, the same pattern
     `pinFailed` already is: never replacing the loaded plan, per pl-10's own
     finding that doing so makes `ITEM_NOT_FOUND`'s own advice impossible to
     follow.
     - `REVISION_STALE` — the banner's copy is the server's, plus a **"Reload
       the plan"** button that re-fetches and replaces `state`. No retry on
       its own; the code means "retrying this exact request is wrong; look
       again first."
     - `PLAN_BUSY` — copy says a change is already running on this plan and to
       wait. No reload button is forced: it is retryable, so a plain "Try
       again" on the same action is reasonable, but nothing resubmits
       automatically. **Its `details` carry `{ run: <runId> }`** (pl-42 step 6),
       so the banner offers "Watch it", which opens `RunView` for that run.
     - `PLAN_INFEASIBLE` (on `move`) and `ITEM_NOT_FOUND` — render `message`
       plus whatever `details` carries, gracefully degrading to the message
       alone if `details` is absent or not the shape expected; pl-43/pl-44 own
       what `PLAN_INFEASIBLE.details` actually contains and this ticket cannot
       assume a shape that does not exist yet.
   - **The run seam** (a `replan` that fails mid-fan-out or mid-compose,
     including with `PLAN_INFEASIBLE`) — already handled: it is a `RunEvent`
     of type `failed`, and `RunView`'s existing `failed` branch renders
     `progress.message`. Nothing new here; naming it so nobody re-invents a
     second error path for the same failure.

10. **Tests**, component-level against fixtures and a mocked `../api/plan.ts`
    module — this tool's fixed rule since pl-12: fake the client, never
    `fetch`. `web/test/plan-fixtures.ts` gains builders for `RevisionOperation`
    and `RevisionDiff`, and its existing `PlanRevision`/`Run` builders gain
    `operation`/`kind` — mechanical, and per pl-42's own trap 3, **not made
    optional to dodge it**. Cover at minimum:
    - The version picker moves between revisions, and the crumb line's exact
      text is unchanged when showing the latest (a literal string assertion,
      because that string is what pl-19's e2e depends on).
    - Restoring an older version sends `baseRevisionId` from the _latest_
      revision, not the one on screen — assert the call's arguments, not just
      that a request happened.
    - A zero-specialist re-plan renders "Re-packing the existing days…" (or
      whatever the final copy is) and never "0 of 0 specialists done."
    - `Unchecked` renders when the latest revision is shown and does not when
      an older one is.
    - Each error code's rendering: `REVISION_STALE` reload button present,
      `PLAN_BUSY` present without a forced reload, `PLAN_INFEASIBLE` and
      `ITEM_NOT_FOUND` render their message.
    - The diff section resolves by `revisionId`, not by array index — a test
      fixture with `diffs` deliberately out of step with `revisions`' order
      is the one to prove this with.

## Traps

- **The crumb string is load-bearing outside this package.** Said above,
  repeated here because it is the single easiest thing to break by accident
  while adding a picker next to it.
- **`plan.revisions` already holds every version.** Do not add a per-revision
  fetch — the document sent to the browser already has what a version picker
  needs, which is exactly what pl-10's "`PlanDetail` carries the brief, the
  candidates and every revision" already promised.
- **A re-plan is a `Run`; move, remove and restore are not.** Routing a
  `replan` response through the synchronous banner, or an edit response
  through `RunView`, is a type error the discriminated `ReviseResponse` should
  catch at compile time — but only if `editPlan`/`startReplan` are typed to
  their one response kind each rather than both returning `ReviseResponse`
  and leaving the caller to narrow it.
- **`Unchecked` was previously always the latest's.** The bug this ticket must
  not introduce is the opposite one: showing an older revision and _silently
  keeping_ the previous unchecked list on screen because nothing cleared it.

## Done when

- A reader can move through every revision of a plan, read-only past the
  latest, and restore an older one as a new revision.
- The crumb line's text is provably unchanged when the latest revision is
  shown (a literal-string assertion, not a substring one).
- Re-plan (naming days, specialists optional, note optional), move and remove
  are reachable from the plan page, keyboard-only, and are absent — with copy
  saying why — on any revision but the latest.
- A re-plan with no specialists renders an honest sentence, never "0 of 0
  specialists done" or any other n-of-n-of-nothing.
- The diff for a shown revision renders as three short lists captioned by
  `reason` and, where present, the operation's note — never as prose — and is
  resolved by `revisionId`, proven against a fixture where array order and id
  order disagree.
- `REVISION_STALE`, `PLAN_BUSY`, `PLAN_INFEASIBLE` and `ITEM_NOT_FOUND` each
  render distinctly, asserted per code.
- `npm run check` and `npm test -- --project planner` pass.
- **The e2e spec is out of scope for this ticket's `Done when`.** It is
  [pl-46](./pl-46-revise-through-the-browser.md), which depends on this ticket
  and pl-44.

## Decisions raised at filing

Both are answered. The first was settled as convention; the second was put to
the owner on 2026-09-13, who took option **A** and had
[pl-46](./pl-46-revise-through-the-browser.md) filed in the same pull request.
The options are kept as posed.

1. **Settled at filing, 2026-09-13: `PLAN_BUSY` carries the run's id.** This
   was raised here as a question and settled by the filing session as
   convention rather than put to the owner: every planner error's `details`
   already names the ids involved. pl-42 now specifies `details: { run }`,
   pl-44 was told while it was being written, and step 9 uses it.

2. **Whether the through-a-browser e2e spec belongs to this ticket, to pl-44,
   or to a follow-up filed once both land.** [pl-19](./pl-19-pin-through-the-browser.md)
   is the precedent, and its own log calls the equivalent call on pl-10 "a
   scope call for a human, not one to take quietly." Concretely:
   `e2e/revise.spec.ts` would draft a plan, re-plan a day with no specialists
   named (deterministic, no model variance to script around), move an item,
   check the version picker and the diff, restore, and reload — the pl-19
   walk extended rather than duplicated. It cannot be written or run until
   **both** pl-44 (the route, the migration) and this ticket (the controls)
   exist, so it structurally cannot be either parallel ticket's own `Done
when`. Options:
   - **A. A follow-up ticket** (`pl-4x`, filed once pl-44 and pl-45 are both
     merged), exactly pl-19's relationship to pl-10. Keeps the parallel cut
     the owner already chose — pl-43/pl-44/pl-45 do not serialise on each
     other — and the e2e cost (a browser launch in CI) stays a decision made
     on purpose rather than inherited by whichever of the two lands second.
   - **B. Fold it into whichever of pl-44/pl-45 lands second**, the way pl-10
     absorbed its own missing pieces from pl-18 at the hand-off. Cheaper by
     one ticket file; couples two tickets the owner deliberately cut apart to
     run in parallel, and whoever lands second inherits scope they did not
     plan for.
     Recommendation: **A**, for the same reason pl-19 exists rather than being a
     forgotten line in pl-10's `Done when`.

## Log

**2026-09-13 — filed.** Groomed by a subagent against pl-42's Build section,
then checked by the filing session. Each claim below was checked against the
code at `323eaa7`, and four were corrected before commit:

- **The crumb assertion.** `e2e/pin.spec.ts` checks `toContain("Version 1 of 1")`
  before the pin and `toHaveText(version)` after the reload. The trap now names
  both, and the reason it holds is that the second is a full-text match.
- **Specialist names.** `PlanView.tsx`'s `SPECIALISTS` is an id→label map, not
  the list, so the checkboxes iterate the contract's tuple.
- **The note's bound.** The wizard's textarea bounds by `maxLength` and shows
  no count, so there is no count pattern to copy.
- **The re-plan wiring.** `Wizard`'s `onDraft` is `(run) => setWatching(run)`
  alone. A re-plan also clears `reading`, and the brief now says why.

The four other code facts the brief rests on held: the hard-coded
`"A first draft is ready"`, `progressLine`'s `of … specialists done.`, `LABELS`
typed over every `RunStatus`, and `RunView`'s `failed` branch rendering the
error's message.
