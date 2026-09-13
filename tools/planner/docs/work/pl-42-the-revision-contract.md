---
id: pl-42
tool: planner
title: The contract for revising a plan — operations, the re-plan run, and the diff
kind: work-package
status: ready
milestone: P4
depends_on: []
difficulty: hard
---

# pl-42 — The revision contract

**Packages:** `contract`, plus the three lines elsewhere that keep the tree
compiling once `operation` and `Run.kind` are required: `operation: { kind:
"first-draft" }` in `itinerary/src/compose.ts`, and the literals in `api`'s
`toRevision` and `toRun` (_Traps_). Nothing else outside `contract` changes.
`api`, `itinerary` and `web` build on it in
[pl-43](./pl-43-repack-named-days-and-diff.md),
[pl-44](./pl-44-the-replan-run-and-edits.md) and
[pl-45](./pl-45-revise-and-read-the-diff.md), and none of them may redefine what
this ticket puts here.

## Why

**P4 is "Pin, re-plan a slice, read the diff", and one of those three exists.**
Pinning landed in P2 ([pl-19](./pl-19-pin-through-the-browser.md),
[pl-22](./pl-22-pin-scoped-to-the-revision-shown.md)). The groundwork for the
other two is real:

- `PlanRevision` carries `parentRevisionId` and a `reason`, and `reason` is the
  diff's caption.
- `appendRevision` makes a revision append-only by construction.
- `compose` takes a `previous` revision and keeps its pins in place.
- `PlanItem` points at a `Candidate`, which is what makes a diff by identity
  possible.

**Nothing can write a second revision.** The API's only plan write is
`POST /api/plans` from an intake, which drafts revision 1. `compose` re-packs
every day. No diff exists anywhere. The architecture's diagram already names
`POST /api/plans/:id/revisions`, and nothing answers on it.

§6's amendment decided the shape: **a plan is revised through structured
operations on the document, and a revision names what it may touch.** This
ticket is those operations as types, contract-first because three packages
build on them in parallel.

### Decided by the owner, 2026-09-13

Each was chosen from options:

- **The first operations:** _re-plan these days_, with an optional note the
  specialists read as context, and _move_ or _remove_ one item, as pure edits.
  **Brief edits** (budget, dates) are **deferred**: changing dates changes the
  day count, which breaks "a revision names its days". **That is a deliberate
  gap against §6's own examples.** Its amendment maps "we cannot afford the
  second hotel" to "lower the budget slot on the brief and re-plan", and "add a
  day in Trieste" to "extend the dates and re-plan the slice that opens". Neither
  is expressible after this ticket. A reader of `00-ANALYSIS.md` should not
  expect them, and the ticket that adds them has the day-count question to
  answer first. **That ticket is [pl-47](./pl-47-edit-the-dates-and-budget.md)**,
  filed the same day with its page in
  [pl-48](./pl-48-change-dates-and-budget-on-the-page.md). The owner's answers
  to the day-count question are recorded there.
- **What a re-plan spends:** the user names specialists. **None named means
  re-pack the named days from the plan's existing candidates**, with no model
  call. Named specialists run again, and their new candidates join the plan's
  pool.
- **Going back:** re-plans always build on the **latest** revision. _Restore
  revision n_ appends a copy of n as a new revision. History stays linear, and
  pl-22's latest-only pin rule is untouched.
- **The cut:** this contract ticket first; then pl-43 (`itinerary`), pl-44
  (`api`) and pl-45 (`web`, against a mocked API) in parallel.

### Adopted rather than asked, and why

- **The diff is derived, never stored.** A stored diff can disagree with the
  two revisions beside it. [pl-10](./pl-10-plan-view-and-provenance.md) made the
  same call for `UncheckedConstraint`, for the same reason.
- **Days outside a re-plan's slice are frozen**, every item on them included,
  pinned or not. That is what "a revision names what it may touch" means.
- **A revision records the operation that made it.** §6's amendment promises
  that "which days did this revision touch, and why" is "answerable from the
  revision itself". A free-text `reason` cannot answer that, and a structured
  field can.
- **The diff function lives in `itinerary`, and `api` serves its result.**
  `web` may import only `contract`, which rules out importing `itinerary`. And
  `01-ARCHITECTURE.md`'s package table already puts `diff` in `itinerary`. So
  `PlanView` carries the diffs, derived on read, the way it already carries
  `unchecked`.

## Build

1. **`RevisionOperation` in `plan.ts`**, a discriminated union on `kind`, and
   **`PlanRevision.operation`**:

   ```ts
   type RevisionOperation =
     | { kind: "first-draft" }
     | { kind: "replan"; days: number[]; specialists: Specialist[]; note: string | null }
     | {
         kind: "move";
         candidateId: string;
         fromDayIndex: number;
         toDayIndex: number;
         toPosition: number;
       }
     | { kind: "remove"; candidateId: string; fromDayIndex: number }
     | { kind: "restore"; revision: number };
   ```

   - **It names candidates, never item ids.** An item id belongs to one revision.
     A stored operation must still mean something when read beside the next
     revision, and a candidate is the identity that survives. A candidate is
     placed at most once per revision (`pack.ts` places each candidate once or
     excludes it), so the name is unambiguous.
   - **`fromDayIndex` is redundant with that, and kept on purpose.** A stored
     operation should read on its own: "moved from day 2 to day 4" without first
     resolving the parent revision, in the same spirit that `PlanRevision.revision`
     is stored although the chain could derive it. `api` derives it from the
     item the request names on the base revision. The request carries no
     `fromDayIndex`, so there is nothing for a client to get wrong (pl-44
     step 2).
   - **`days`** are day indexes: non-empty, unique, ascending, each in
     `0..MAX_PLAN_DAYS-1`. "Within this plan's day count" is a check against the
     base revision, which a schema cannot see, so it is `api`'s check and is
     named there.
   - **`specialists`** is unique and may be empty. Empty is the free re-pack,
     not an error.
   - **`note`** is bounded by a new `MAX_REVISION_NOTE_CHARS` (500, beside
     `MAX_REVISION_REASON_CHARS`). **It is context, never an instruction.**
     Whoever renders it into a prompt renders it the way `discoveryBlock`
     renders a find: as text a user typed.
   - **`restore.revision`** must be earlier than the revision it produces. The
     schema can only check `>= 1`; the rest is `api`'s.
   - `reason` stays and stays required, since it is the caption. **It is
     derived from the operation server-side, never taken from the client**; a
     note is not a caption. The copy is pl-44's.

   Add `operation` to `NewRevision`'s `Pick` so `appendRevision` carries it, and
   extend `planRevisionSchema` with two refines:
   - **`first-draft` if and only if `revision === 1`**, the same shape as the
     existing parent rule.
   - **A candidate is placed at most once in a revision.** Today that is true
     only because `pack.ts` places each candidate once or excludes it. A
     re-plan and an edit are two new ways to write a revision, and pl-43's
     first trap is exactly a candidate placed on a frozen day and again on a
     named one. The schema is where "at most once" stops being an accident of
     one implementation.

2. **`RevisionDiff` in `plan.ts`**, one per revision after the first, against
   its parent:

   ```ts
   interface RevisionDiff {
     revisionId: string;
     parentRevisionId: string;
     entries: DiffEntry[]; // unchanged candidates are absent
   }
   type DiffPlacement = { dayIndex: number; position: number };
   type DiffEntry =
     | { kind: "added"; candidateId: string; to: DiffPlacement }
     | { kind: "removed"; candidateId: string; from: DiffPlacement }
     | { kind: "moved"; candidateId: string; from: DiffPlacement; to: DiffPlacement };
   ```

   **What counts as `moved` is pl-43's to define and test, and the definition
   goes in this type's doc comment when pl-43 lands.** The trap: a `position`
   that shifted only because a neighbour was removed is not a move a reader
   cares about. A diff reporting it makes every edit look like a reshuffle.
   Items only; gap changes are out of scope, and the doc comment says so.

3. **`api.ts` — the request, the route and the response.**
   - `ROUTES.planRevisions` = `/api/plans/:id/revisions`, plus a
     `planRevisionsUrl(id)` helper, in the same style as `planItemPinUrl`.
   - `ReviseRequest`, a discriminated union on `kind`, **every member carrying
     `baseRevisionId`**:

     ```ts
     | { kind: "replan"; days; specialists; note }
     | { kind: "move"; itemId; toDayIndex; toPosition }
     | { kind: "remove"; itemId }
     | { kind: "restore"; revision }
     ```

     **`toPosition` is the index in the destination day's item list _after_
     the item has left its source day**, so `0..length` of that list
     inclusive. A same-day move is ambiguous by one without this sentence. It
     goes on both `ReviseRequest` and `RevisionOperation`, because pl-44
     validates the range, pl-45 computes it and pl-43 applies it.

     Requests name **`itemId`**, which is the client's handle on the revision it
     is looking at, exactly as the pin route does. The server resolves the id to
     a candidate before storing the operation. `first-draft` is not requestable.
     It has its own route, and that route stays.

   - `ReviseResponse`:
     - `{ kind: "run"; run: Run }` for `replan`, answered 202;
     - `{ kind: "revision"; view: PlanView }` for `move`, `remove` and
       `restore`, answered 200.

     **Every re-plan is a run, including one with no specialists named.**
     Re-packed days have new transitions, which means grounding lookups, which
     belong in a run that can report them and be canceled. The edits are synchronous, with a lookup sized to the edit: one call per place that never located, plus one matrix. That is usually a single cached matrix (pl-44 step 5).

   - Zod schemas for both, with the bounds from step 1.

4. **`PlanView.diffs: RevisionDiff[]`**, one per revision after the first, oldest
   first, derived on read. The doc comment says "derived on read", as
   `unchecked`'s does. **`unchecked` still describes only the latest revision.**
   If a version picker shows an older one, what that version did not check is
   not in the view, and the comment says so rather than implying otherwise.

5. **`run.ts`.**
   - `Run.kind: "draft" | "replan"`.
   - **One new legal edge: `queued → composing`.** A re-plan with no specialists
     and no transition to measure goes straight to composing, and the
     `RUN_TRANSITIONS` comment has argued twice already that emitting a state a
     run spent no time in is decoration. Add the paragraph; do not relabel an
     existing edge.
   - **`RunProgress` gains nothing.** A re-plan with no specialists sends a
     `roster` frame with `total: 0`, which is true.

6. **`errors.ts` — two new planner codes, argued here because the rules require
   it.** No existing code fits either, and both are about this tool's document
   rather than transport, so neither belongs in core:
   - **`REVISION_STALE`**: `baseRevisionId` is not the latest revision. Two tabs
     on one plan is the ordinary case. Copy along the lines of "This plan
     changed since you opened it — reload to see the current version." Not
     retryable: retrying the same request is exactly the wrong move.
   - **`PLAN_BUSY`**: another write to this document is already in progress.
     **The invariant is the document's, not the job runner's**: a plan's
     revisions are one linear, append-only chain, `UNIQUE (plan_id, revision)`.
     A second writer building on the same latest revision while a run is
     composing would produce two children of one parent, and the database would
     refuse one of them after its whole bill was spent. A non-terminal run is how
     `api` detects the condition. It is not what the code means, and **this is
     not a generic "job busy" code** for a future reader to cite as precedent for
     moving job-runner concepts into a tool. Copy says to wait for the current
     change to finish. Retryable, because it clears on its own. **Its `details`
     carry `{ run: <runId> }`**, the in-progress run, so a client can point at
     the run rather than only say one exists (pl-45 renders that link).

   `NOT_FOUND` versus `ITEM_NOT_FOUND` versus `REVISION_NOT_FOUND`: an unknown
   `itemId` is `ITEM_NOT_FOUND`, which already means "reload", and an unknown
   `restore.revision` is `REVISION_NOT_FOUND`. **Write both into the
   request's doc comment**, since CLAUDE.md's rule on those codes exists because
   this confusion recurs.

7. **A revision ceiling.** Revisions append forever, and `PlanView` returns every
   one of them and now a diff each. Measure the JSON size of `PlanView` for the
   largest checked-in fixture at 1, 10 and 50 revisions, record it in the Log,
   and set `MAX_REVISIONS_PER_PLAN` from the number. **If a refusal needs a
   code, say so in the Log and stop**; do not stretch `SIZE_LIMIT_EXCEEDED`'s
   copy over it, because re-worded copy at the raise site is the rule's own
   tell.

## Traps

- **A required `operation` breaks the build before it breaks a read.** The API
  never validates a stored revision against `planRevisionSchema`. Grep it: no
  schema is used under `api/src` or `web/src`. `toRevision` in
  `api/src/db/plans.ts` and `toRun` in `api/src/db/runs.ts` build each object
  field by field. So making `operation` and `Run.kind` required is a compile
  error in those two mappers, and that surfaces in `npm run check`, not in
  production.
  - **The runtime risk is the column.** Once pl-44 reads `plan_revisions.operation`
    and `plan_runs.kind`, a database without pl-44's migration fails in SQL.
    Rows written before the migration need a backfill (`first-draft`, `draft`).
  - **What this ticket does about it:** keeps the mappers compiling with a
    literal `first-draft` / `draft` and a comment naming pl-44 as the ticket that
    replaces it. That way this ticket merges alone without lying about any row
    that exists: every stored revision _is_ a first draft, and every stored run
    _is_ a draft, until a re-plan can write anything else. **State that in the
    Log.**
- **The scripted fan-out and every fixture that builds a `PlanRevision` or a
  `Run` by hand** (`web/test/plan-fixtures.ts`, `contract/test/fixtures.ts` and
  the API's tests) gain the field. That is mechanical and expected. Do not make
  the field optional to avoid it.
- **`move` onto a day that would break it** is not this ticket's to check, but
  its doc comment must say who refuses it: pl-43's composer check, with the
  existing `PLAN_INFEASIBLE`. Otherwise pl-44 and pl-45 each invent an answer.
- **A restore copies the old days, including their stored `travelFromPrevious`.**
  That is correct: the evidence is still what those days were packed against.
  Say so on the operation, because "restore re-measures" is the obvious wrong
  assumption.

## Done when

- `RevisionOperation`, `RevisionDiff`, `ReviseRequest`, `ReviseResponse`,
  `ROUTES.planRevisions` and its URL helper exist with zod schemas, and are
  exported from the package index.
- Schema tests prove the bounds and invariants: every `days` rule, unique
  `specialists`, the `note` bound, `restore.revision >= 1`, `first-draft` if and
  only if revision 1, a candidate placed twice in one revision refused, and
  each request kind carrying `baseRevisionId`. Each rule
  has its own failing case.
- `appendRevision` carries `operation`, and its existing append-only test covers
  it.
- `queued → composing` is legal and argued in the `RUN_TRANSITIONS` comment;
  `canRunTransition` tests cover it.
- `REVISION_STALE` and `PLAN_BUSY` are in the taxonomy with copy, and their
  retryability matches step 6.
- `MAX_REVISIONS_PER_PLAN` is set, with the payload measurement that set it in
  the Log.
- `toRevision` and `toRun` compile with literal `first-draft` / `draft` values,
  each carrying a comment that names pl-44 as the ticket that replaces it with
  a stored column. The Log says why those literals are true of every row that
  exists.
- `npm run check` and `npm test -- --project planner` pass. Fixtures gained the
  field; no field was made optional to spare them.

## The gate on this filing

**2026-09-13, Sonnet, read-only, asked to falsify every checkable claim and to
look for contradictions against the code.** The brief was written on Opus. It is
recorded here and not under `## Review`, because there is no work yet to review.

19 claims were checked; 18 held. Among them: every code fact in _Why_ and the
Log; that `web` depends on `contract` alone; that no conflict-like code exists in
core or the planner; that `planItemPinUrl` exists; that a candidate is placed at
most once per revision; and §6's "answerable from the revision itself", word for
word.

Findings, all fixed in the filing commit:

- **med — the migration trap described the wrong failure.** It said a required
  `operation` would make `planRevisionSchema` fail on a read. No schema is used
  on any read path: `toRevision` and `toRun` build rows by hand. It is a compile
  error in those mappers, and the Trap and a Done-when line now say what this
  ticket does about it. The concurrently grooming pl-44 agent was sent the
  correction before its migration section was final.
- **low — deferring brief edits cuts against §6's own lead examples.** Now said
  outright under the owner's decisions.
- **low — `PLAN_BUSY` was argued from job status**, which is core's category.
  It is now argued from the document's `UNIQUE (plan_id, revision)` chain.
- **low — `fromDayIndex` looked redundant and nothing said why.** Kept, with the
  reason and an agreement check assigned to `api`.

One item was unverifiable at filing: whether a zero-specialist run's `roster`
frame sets `rosterSize` correctly. That wiring does not exist yet, and it is
pl-44's to prove.

## Log

**2026-09-13 — filed.** From a roadmap review after pl-39 through pl-41 were
filed. The owner chose Phase 4 over smaller loose ends, then chose the
operations, the re-plan spend, the restore model and the cut from options.
Facts checked against `origin/main` at filing:

- `compose` takes `previous` and has no slice input.
- The API orchestrator only ever writes `FIRST_DRAFT_REASON` and never passes
  `previous`.
- `PlanView.tsx` renders only `latestRevision`.
- The pin route refuses a superseded item with `ITEM_NOT_FOUND` (pl-22).
- `web` depends on `contract` alone, which is why the diff is served rather than
  imported.
