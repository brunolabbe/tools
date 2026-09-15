---
id: pl-45
tool: planner
title: Revise a plan, pick a version, and read the diff
kind: work-package
status: done
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
`ROUTES.planRevisions`, `REVISION_STALE` and `PLAN_BUSY`. **It merged to `main`
as PR #228 (`caeeb44`) before this ticket was built** — the line that used to
stand here said it had not been, which was true only at filing time. Every
claim below was checked against the merged code rather than against pl-42's
Build section as a specification, and held.

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

## Review

### Gate 3 — PASS

**Gate: PASS** — 2026-09-14 · `95c6403...c8d46ee` · reviewer (Opus) re-ran the
gates and the four mutations named by gate 2 over `52bf582...c8d46ee`, which
changes tests and the ticket only; builder was Sonnet

| Done when                                                                                                    | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A reader moves through every revision, read-only past the latest, and restores an older one                  | proven — `planner/web/test/plan-view.test.tsx:906 "Editing works on the latest version"`, `planner/web/test/plan-view.test.tsx:867 "baseRevisionId: second.id,"`, `planner/web/test/plan-view.test.tsx:909 "Restore this version is absent when the latest"`, `planner/web/test/plan-view.test.tsx:952 "restoring from an older page moves the reader to the new latest"`                                                                                                                                                                                                                                                                                                                                    |
| Crumb text unchanged at the latest, literal string                                                           | proven — `planner/web/test/plan-view.test.tsx:842 "Version 2 of 2 · Moved the hike to Thursday."`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Re-plan, move and remove reachable, keyboard-only, absent with copy on older revisions                       | proven — `planner/web/test/plan-view.test.tsx:1145 "toDayIndex: 1,"`, `planner/web/test/plan-view.test.tsx:1150 "removing an item sends the latest baseRevisionId"`, `planner/web/test/plan-view.test.tsx:1194 "submits the chosen days, specialists and note"`, `planner/web/test/plan-view.test.tsx:1266 "objectContaining({ specialists: [], note: null })"`, `planner/web/test/plan-view.test.tsx:905 "Re-plan some days"`, `planner/web/test/app.test.tsx:91 "a re-plan shows the run screen, not the list"`, `planner/web/test/app.test.tsx:116 "Watch it shows the run screen too"`. Keyboard-only is verified by reading: native controls, no pointer handler or tabIndex, and no test presses a key |
| A re-plan with no specialists renders an honest sentence                                                     | proven — `planner/web/test/run-view.test.tsx:212 "Re-packing the existing days…"`, `planner/web/test/run-view.test.tsx:213 "queryByText(/of 0/)"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Diff as three short lists, captioned by reason and note, resolved by revisionId against disagreeing order    | proven — `planner/web/test/plan-view.test.tsx:1073 "expect(headings).toEqual("`, `planner/web/test/plan-view.test.tsx:1107 "What was asked"`, `planner/web/test/plan-view.test.tsx:1024 "diffs: [diffForRev3, diffForRev2],"` under `planner/web/test/plan-view.test.tsx:997 "resolves by revisionId, not by array index"`                                                                                                                                                                                                                                                                                                                                                                                   |
| `REVISION_STALE`, `PLAN_BUSY`, `PLAN_INFEASIBLE`, `ITEM_NOT_FOUND` each render distinctly, asserted per code | proven — `planner/web/test/plan-view.test.tsx:1346 "findByText(/Someone else changed it"`, `planner/web/test/plan-view.test.tsx:1375 "expect(onWatchRun).toHaveBeenCalledWith("`, `planner/web/test/plan-view.test.tsx:1411 "Day 1: Over capacity."`, `planner/web/test/plan-view.test.tsx:1434 "queryByText(/item-1/)"`, rendered by `planner/web/src/plan/PlanView.tsx:175 "function ActionErrorDetails("`                                                                                                                                                                                                                                                                                                 |
| `npm run check` and `npm test -- --project planner` pass                                                     | verified — reviewer run at `c8d46ee`: check exit 0; planner 56 files and 962 tests, none failing (931 at `95c6403`); web 6 files and 91 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The e2e spec is out of scope                                                                                 | n/a — `e2e/pin.spec.ts` not run; its selectors read against the new DOM in gate 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- The three gate-2 lows are closed, each by a test that goes red when its fix
  is reverted: deleting `planner/web/src/plan/RunView.tsx:156 "kind: event.run.kind,"`
  reddens `planner/web/test/run-view.test.tsx:278 "real kind, never a guess"`;
  deleting the reset in `submitEdit` reddens the restore-from-an-older-page
  test; putting the form reset back, or swallowing the `startReplan`
  rejection, each redden `planner/web/test/plan-view.test.tsx:1276 "a re-plan that fails keeps the form"`.
- **findings** · gate 3 returned 0: 0 carried, 0 dropped.
- NFR: security n/a · performance n/a · reliability ✓ · maintainability ✓.

### Gate 2 — PASS

**Gate: PASS** — 2026-09-14 · `95c6403...52bf582` · reviewer (Opus) defect
hunt at medium over the fix round, plus 20 single-file source mutations,
each restored. Coordinates from this gate were superseded by gate 3's
lines, so it is recorded by test name.

- Every gate-1 med fixed and pinned: the run screen is reachable from a plan
  opened off the list; the diff is three lists; `PLAN_INFEASIBLE` renders its
  findings and `ITEM_NOT_FOUND` its message alone; Watch it opens an honest
  attaching state with a bounded timeout, the option the owner chose; the
  re-plan form keeps its input on failure.
- **low** · The attach-kind test named the same kind as the fallback, so it
  could not see a missing copy (closed in gate 3).
- **low** · The reset-after-edit test never left the latest revision (closed
  in gate 3).
- **low** · No test rejected `startReplan`, leaving the form fix unpinned
  (closed in gate 3).
- **dropped** · The draft fallback for `kind` is unreachable in practice: the
  events route writes the snapshot synchronously right after subscribing.
- **withdrawn from gate 1** · The zero-specialist progress bar and the
  doubled comment above `Unchecked` both predate this ticket (identical on
  `origin/main` and at `95c6403`); both builder objections reproduced.
- **findings** · gate 2 returned 4: 3 carried, 1 dropped; 2 gate-1 lows
  withdrawn.
- The Watch it decision was settled by the owner, as relayed by the builder
  and the orchestrator; the reviewer did not see the ruling itself.

### Gate 1 — FAIL

**Gate: FAIL** — 2026-09-14 · `95c6403...f796e8b` · reviewer (Opus) defect
hunt at medium, plus 30 single-file source mutations and five render
probes. Coordinates from this gate were superseded, so it is recorded by
finding.

- **med** · **unproven** · Three short lists: every entry under Added, or
  the group headings deleted, left plan-view green.
- **med** · **unproven** · `PLAN_INFEASIBLE` and `ITEM_NOT_FOUND` rendered
  byte-identical banners and dropped `details`, against Build step 9.
- **med** · Re-plan and Watch it never reached the run screen from a plan
  opened off the plans list.
- **med** · **open decision** · The Watch it placeholder run showed a status
  nothing measured, and its guessed `kind` was never corrected.
- **med** · The re-plan form cleared on submit, before a `PLAN_BUSY` answer.
- **low** · The revisionId test comment named the wrong diff, and its
  fixture did not defeat the index mapping the brief names.
- **low** · The zero-specialist progress bar rendered `max=0` (withdrawn in
  gate 2).
- **low** · Doc comments on `startReplan` and `editPlan` overstated a
  compile-time narrowing.
- **low** · Four new branches were unasserted.
- **low** · A second, identical specialist label map.
- **low** · Two doc comments above the wrong declaration (the `Unchecked`
  half withdrawn in gate 2).
- **low** · The Log verification figures described a worktree without
  `@anthropic-ai/sdk`.
- **dropped** · `e2e/pin.spec.ts` locator collisions (none, by reading);
  heading tests losing assertions (none); the option-text collision (real);
  the placeholder epoch `startedAt` (rendered nowhere).
- **findings** · gate 1 returned 16: 12 carried (5 med, 7 low), 4 dropped.

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

**2026-09-14 — built (dispatched as Sonnet).** Branched from `origin/main` at
`95c6403`. pl-42 merged to `main` as PR #228 (`caeeb44`) before this ticket was
picked up; the Why section's "has not been built in this worktree yet" line
was stale and is now corrected in place, citing the merge.

Every Build claim about pl-42's actual shape held against `caeeb44`'s code:
`ReviseRequest`/`ReviseResponse`'s discriminated shape, `RevisionOperation`'s
five members, `RevisionDiff`/`DiffEntry`/`DiffPlacement`, `ROUTES.planRevisions`
and `planRevisionsUrl`, `REVISION_STALE`/`PLAN_BUSY` (with `details: { run }`
on the latter), `MAX_REVISION_NOTE_CHARS`, and `PlanView.unchecked`'s
latest-only doc comment.

**What the brief did not fully specify, decided here and recorded rather than
asked, because neither touches `contract`/`api`/`agent`:**

- **`PLAN_BUSY`'s "Watch it" button** has no route to fetch a `Run` by id —
  pl-42 added none, and none is this ticket's to add. It opens `RunView` with a
  placeholder `Run` (`status: "queued"`, `rosterSize: null`), exactly the shape
  `RunEvent.snapshot`'s own doc comment already describes for a late attacher:
  the first frame off the SSE connection corrects it before `status` could ever
  reach `"done"` on stale data. Built in `App.tsx`'s new `watch` callback.
- **The version picker's `<option>` text is `Version N · reason`, not the
  crumb's `Version N of M · reason`.** Repeating the crumb's exact sentence in
  an `<option>` collided with the crumb `<p>` itself whenever the selected
  option was the one shown — `screen.findByText` found two elements with
  identical text, caught by the version-picker test below. The crumb keeps the
  literal string pl-19's e2e depends on; the picker says less.
- **Two pre-existing `plan-view.test.tsx` tests became ambiguous, not wrong.**
  `dayHeading(day)` is reused on the re-plan form's own day checkboxes (the
  ticket's own instruction), so a bare `findByText("Day 1")` /
  `findByText("Day 1 · 2027-07-05")` started matching both the day's `<h3>` and
  a checkbox label once that form was on the page. Changed to
  `findByRole("heading", { name, level: 3 })`, which is what those two tests
  were actually asserting about.

**Fold-in considered and declined.** The brief's own fold-in instruction (the
stale pl-42 line) is done above. No other already-specified, already-free work
surfaced while building this.

**Verification**, each figure from the command beside it:

- `npx vitest run tools/planner/web` on the unmutated tree at the start:
  5 files, 60 tests, all passing (baseline).
- Same command after the change: 5 files, **79 tests**, all passing — 19 new
  (`plan-view.test.tsx` 24 → 40, `run-view.test.tsx` 8 → 11).
- `npx tsc --build tools/planner/web tools/planner/web/test`: clean, no output.
- `npx oxlint tools/planner/web/src tools/planner/web/test`: clean, no output.
- `npx oxfmt --check tools/planner/web/src tools/planner/web/test`: "All
  matched files use the correct format."
- `npm run check`: exits 2, solely on `tools/planner/agent`'s
  `Cannot find module '@anthropic-ai/sdk'` — reproduced on the unmutated tree
  before any edit in this worktree (same error, same package, `npm install`
  never reaches the network here), and outside this ticket's `web`-only
  Packages line.
- `npm test -- --project planner`: 25 test files fail and 30 pass, identical
  set on the unmutated tree and after the change (all 25 are `agent`/`api`,
  all the same missing-dependency error); **501 tests pass**, up from the
  unmutated tree's 482 — the same 19 new tests, none newly failing.
- Not run: e2e (`e2e/pin.spec.ts`, `e2e/revise.spec.ts`) — out of scope per
  this ticket's `Done when` and [pl-46](./pl-46-revise-through-the-browser.md);
  not runnable from this worktree regardless.

Files: `web/src/api/plan.ts` (`startReplan`, `editPlan`), `web/src/plan/PlanView.tsx`
(version picker, move/remove controls, the re-plan form, the diff, error
banners), `web/src/plan/RunView.tsx` (`progressLine`'s zero-specialist case,
`Finished`'s `run.kind` branch), `web/src/App.tsx` (`onReplan`, `onWatchRun`
wiring), `web/src/styles.css` (minimal rules for the above), `web/test/plan-fixtures.ts`
(multi-revision `revision()` overrides, `diffPlacement`/`addedEntry`/`removedEntry`/`movedEntry`/`revisionDiff`
builders), `web/test/plan-view.test.tsx` and `web/test/run-view.test.tsx` (new
coverage, two ambiguity fixes).

**2026-09-14 — gate round one (Opus, `f796e8b`): FAIL, 2 Done-when clauses
unproven, 5 med, 7 low.** Full findings and reproductions are in the gate's
message to the orchestrator; not duplicated here. Fixed in this round:

- **The Log's own verification was wrong.** `npm run check`/`npm test` had
  been run in a worktree missing `@anthropic-ai/sdk` (a farm-then-network-block
  gap, not a branch defect), and the figures above described that tree, not
  this branch. Re-run with the SDK unpacked into this worktree (see below):
  `npm run check` exits 0; `npm test -- --project planner` is 56 files, 960
  tests, none failing (55/950 before this round's own new tests); `npx vitest
run tools/planner/web` is 6 files, 89 tests.
- **Re-plan and Watch it were unreachable from a plan opened off the Plans
  list (med).** `App.tsx` rendered `RunView` only inside its open-intake
  branch; a plan opened from the list has none, so clearing `reading` fell
  through to the trips-and-plans list with the run going on unseen. Fixed by
  checking `watching !== null` before `openIntake === null`. New
  `web/test/app.test.tsx`, mocking `api/plan.ts` rather than any component,
  proves both paths reach the run screen.
- **The "Watch it" placeholder (med, open decision) — resolved by the owner,
  not by this session: an honest attaching state.** `RunView` now accepts a
  `Run` (a freshly started run — unchanged) **or** an `AttachTarget` (`{id,
planId}`, all "Watch it" has, pl-42 having added no route to fetch a `Run`
  by id). `Progress.status`/`kind` are nullable; before the first `snapshot`
  the screen says "Connecting…" with an indeterminate bar and no fabricated
  status or count, and `Finished`'s wording now reads `progress.kind` (set
  only by a `snapshot`) rather than a prop that could never be corrected. A
  15 s timeout with no frame renders the existing failed-state screen, so an
  attach that never resolves has a way out. `App.tsx`'s comment claiming the
  old placeholder "cannot leak into `Finished`'s copy" is removed — it did,
  and the gate's own probe (a `snapshot` naming `kind: "draft"`, then `done`)
  is now `run-view.test.tsx`'s own test, alongside the timeout and a
  no-false-failure case. Stayed `web`-only throughout.
- **`PLAN_INFEASIBLE` and `ITEM_NOT_FOUND` rendered the same banner and
  dropped `details` (med).** Step 9 asked for `details`, gracefully degraded.
  Added `ActionErrorDetails`, which renders `PLAN_INFEASIBLE.details.findings`
  (`@planner/itinerary`'s `compose.ts` shape) as a list; `ITEM_NOT_FOUND`'s
  `{ item: <id> }` has no reader-facing shape and degrades to the message
  alone, which is now itself a real branch rather than the absence of one.
  Both tests now use the identical message text on purpose, so a passing
  assertion cannot be message-text coincidence.
- **The re-plan form cleared itself before the request answered (med).**
  `ReplanForm.submit` cleared its own state unconditionally; on `PLAN_BUSY` —
  retryable by design — that meant retyping the whole form. A successful
  re-plan already unmounts `PlanView` entirely (control leaves it, Build step
  5), so the reset was never needed on success and only harmful on failure.
  Removed.
- **The revisionId-diff test proved less than its comment claimed (low).**
  `diffs[1]` in the old fixture was `diffForRev2`, not `diffForRev3` as
  written, so `diffs[revisions.indexOf(shown)]` passed it by coincidence.
  Rebuilt around `shown = rev3` (the latest) so every plausible positional
  scheme — raw index, `revision - 2`, `indexOf - 1` — lands on the wrong
  entry or out of bounds; only a `revisionId` lookup is right. Reproduced
  both wrong mutations red before restoring the real code.
- **The three-lists Done-when clause was unasserted (med).** The test read
  each `<li>`'s text, which does not depend on which group renders it (the
  text comes from the entry's own `kind`, not its list). Added a structural
  check: exactly three `<h4>`s reading "Added", "Removed", "Moved", each
  scoped with `within` to assert it owns exactly one `<li>`. Reproduced the
  gate's two mutations (everything through one group; headings deleted) red
  before restoring.
- **`SPECIALIST_LABELS` duplicated the file's own `SPECIALISTS` map (low).**
  Step 5 said to label through the existing map; now it does.
- **`ReplanForm`'s doc comment sat above `type ReplanDraft`, not the function
  it describes (low).** Reordered. (`Unchecked`'s own two-comment layout
  predates this ticket — see the reply to the gate.)
- **Four branches had no assertion (low):** added tests for the reset to the
  new latest after a successful edit, `Restore this version` absent on the
  latest, the submit button disabled with no day ticked, and a ticked day
  being untickable.
- **The `startReplan`/`editPlan` doc comment overstated compile-time
  narrowing as "rather than a runtime surprise" (low).** `requestJson` casts
  rather than validates a successful response, same as every function in the
  file; the comment now says so.

**Getting the SDK into this worktree** (the farm ran before
`@anthropic-ai/sdk` reached the shared checkout, 22:46 UTC): `npm pack
--offline @anthropic-ai/sdk@0.125.0 json-schema-to-ts@3.1.1
standardwebhooks@1.1.1 ts-algebra@2.0.0 @stablelib/base64@1.0.1
fast-sha256@1.3.0` in a scratch dir, then `mkdir -p node_modules/<name>` and
`tar -xzf <tgz> -C node_modules/<name> --strip-components=1` per package,
confirmed with `readlink -f` to resolve inside this worktree, then `npm run
build`.

Left as found, on the reviewer's own read and not disputed here: the
`Unchecked` function's two consecutive doc comments (pre-existing), and the
zero-specialist `<progress value=0 max=0>` HTML-validity note (pre-existing
code this ticket's own change to the _text_ beside it did not touch).

**2026-09-14 — gate round two (Opus, `52bf582`): PASS, 3 lows.** All five med
findings from round one held on re-verification, pinned by a test that goes
red on revert; both pushbacks (the pre-existing zero-bar line, the
pre-existing `Unchecked` comments) were accepted. Three lows named a test
that did not actually pin its own fix; fixed all three rather than record
them, since each was cheap once named:

- **The attach-kind test's snapshot named `"draft"`, the same value as the
  `?? "draft"` fallback**, so deleting `kind: event.run.kind` in the reducer
  passed anyway. Changed the snapshot to name `"replan"` instead — a value
  the fallback disagrees with — and reproduced the deletion red before
  restoring.
- **The reset-after-edit test started and ended on the only revision**,
  where `shownRevisionNumber` was already `null` before the edit, so nothing
  needed resetting and the assertion held with or without the fix. Added a
  second test that restores from an explicitly-selected older revision
  (`shownRevisionNumber` a concrete non-null number beforehand) and asserts
  the crumb shows the _new_ latest afterward. Reproduced deleting the reset
  red before restoring.
- **No test rejected `startReplan`, so the re-plan form's fix from round one
  was unpinned.** Added a test: fill the form, `startReplan` rejects with
  `PLAN_BUSY`, assert the banner shows the message _and_ the day, specialist
  and note the reader entered are still on screen. Reproduced both of the
  gate's named mutations (putting the reset back; swallowing the rejection
  with `void error`) red before restoring.

Re-verified after these three fixes: `npm run check` exit 0; `npm test --
project planner` 56 files, 962 tests, none failing; `npx vitest run
tools/planner/web` 6 files, 91 tests. Every mutation reproduced above was
restored and `diff`-confirmed identical to the pre-mutation file before the
next one.

**2026-09-15 — the `## Review` section above was transcribed verbatim from
the reviewer's own text at `c8d46ee` (its final, corrected Gate 1 block, sent
after an earlier muddled correction that this session was told to ignore).**
Nothing in it was altered beyond what `npm run format` did to the tables'
padding — no wording, no citation, no finding count. Committed on the
orchestrator's ship authority, given after both sessions agreed gate 3 was a
PASS with no open findings.

**The owner's decision on the "Watch it" placeholder, recorded here because
it is the one open decision this ticket raised.** Gate 1 found that the
placeholder `Run` `App.tsx` built for "Watch it" showed a status nothing had
measured and a guessed `kind` no `snapshot` could correct, and put it to the
orchestrator as an open decision rather than settling it. The orchestrator
checked the gate's premises against the code at `f796e8b` — the snapshot
reducer copying only `status` and counts, `Finished` reading `kind` from the
original prop, `App.tsx`'s hard-coded `kind: "replan"`, `RunView` mounted
only inside the open-intake branch, `watchRun` with no error listener — then
put four options to the owner through `AskUserQuestion`:

1. An honest attaching state: no status label and no fabricated count until
   the first real `snapshot`, `kind` read from that frame and never guessed
   (marked recommended).
2. Drop "Watch it" for now.
3. An attaching state, plus a ticket for a route that fetches a `Run` by id.
4. Keep the placeholder and only fix the comment that claimed it was safe.

The owner chose **option 1**, matching the recommendation. Built as
`RunView`'s `AttachTarget` and the nullable `Progress.status`/`kind`
described in the 2026-09-14 gate-round-one entry above, with a bounded
timeout so an attach that never resolves still has a way out.

**2026-09-15 — dl-15's citation fix split into its own pull request, and this
branch rebased onto it.** Committing the `## Review` section added
`tools/planner/web/test/app.test.tsx`, which collides with the downloader's
own `tools/downloader/web/test/app.test.tsx` and made ten of dl-15's bare
`app.test.tsx` citations ambiguous. This PR (#246) squash-merges as one
`feat(planner): …` commit, and release-please routes a merged commit to a
tool by the files it touched rather than its scope — so a `feat`-typed
commit touching a path under `tools/downloader/` would have cut a
downloader minor release headed by a planner feature line. The orchestrator
put three options to the owner: split the dl-15 fix into its own `docs`
pull request (recommended), rename the new planner test so nothing
collides, or accept the false downloader release. The owner chose the
split. It landed first as `#247` (`a9d2617`), ahead of `#242`'s merge
(`8894b75`); this branch was then rebased onto `8894b75`, `dl-15` dropped
out of its diff with no further edit, and pl-36's citation pins (moved by
this ticket's own tip) were re-applied over `#242`'s own pins on the same
record.
