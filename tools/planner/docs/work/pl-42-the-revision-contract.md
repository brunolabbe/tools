---
id: pl-42
tool: planner
title: The contract for revising a plan — operations, the re-plan run, and the diff
kind: work-package
status: done
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

### Step 7's ceiling, decided by the owner, 2026-09-13

Raised by the build, after step 7's measurement (in the Log). Enforcing a
revision ceiling means refusing a well-formed revise request, and no code in the
planner's taxonomy or in `@webtools/core` means that. So step 7's own stop
applied. The orchestrator put it to the owner with these options, in this order:

- **A:** a new planner code, `REVISION_LIMIT_REACHED`, not retryable, mapped to
  409 by pl-44, with `MAX_REVISIONS_PER_PLAN` in `plan.ts`.
- **B:** a generic limit code in `@webtools/core`.
- **C:** a window of revisions on `PlanView`, with no refusal.
- **D:** no ceiling for now.

**The owner chose A**, and, asked separately between 50, 20 and 100, **chose
50**. The reason is the measurement: at 50 revisions every checked-in fixture's
`PlanView` is under 100 KiB with worst-case diffs, while a plan at the schema's
maximum reaches ~14 MiB. The contract carries the code and the constant. The
check, its 409 and the re-check inside `persist` are pl-44's (its checks 6 and
`persist`'s transaction).

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

## Review

**Gate: PASS** — 2026-09-13 · Sonnet · `origin/main` (`8849c14`)...`9138ddc` · defect hunt run directly at medium depth (subagent context, no `code-review` delegate)

| Done when                                                                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RevisionOperation`, `RevisionDiff`, `ReviseRequest`, `ReviseResponse`, `ROUTES.planRevisions`/`planRevisionsUrl` exist, schema'd, exported from the index                                                        | proven — `contract/src/plan.ts:320 "export type RevisionOperation ="`, `contract/src/plan.ts@95c6403:555 "export interface RevisionDiff {"`, `planner/contract/src/api.ts:349 "export type ReviseRequest ="`, `planner/contract/src/api.ts:414 "export type ReviseResponse = { kind:"`, `planner/contract/src/api.ts:78 "/plans/:id/revisions"`; runtime-imported all 22 new exports off `dist/index.js` myself, all resolved |
| Schema tests prove every named bound (days rules, unique specialists, note bound, `restore.revision >= 1`, first-draft iff revision 1, candidate-once, `baseRevisionId` per kind), each with its own failing case | proven — independently reproduced with 22 of my own source mutations, one at a time, each run against its narrowest file and restored to a byte-identical file after; every bound this line names went red on exactly its own test, including `contract/test/revise.test.ts:43 "a $kind request without a base revision is refused"`, parameterised over all four request kinds                                               |
| `appendRevision` carries `operation`; existing append-only test covers it                                                                                                                                         | proven — `contract/test/plan.test.ts:119 "the operation is carried through as given"`                                                                                                                                                                                                                                                                                                                                         |
| `queued → composing` legal, argued in the comment, covered by `canRunTransition` tests                                                                                                                            | proven — `contract/src/run.ts:121 "and it is the same argument a third time"`, `contract/test/run.test.ts:97 "lets a run go straight from"`                                                                                                                                                                                                                                                                                   |
| `REVISION_STALE`/`PLAN_BUSY` in the taxonomy with copy, retryability matching step 6                                                                                                                              | proven — `contract/test/errors.test.ts:31 "a busy plan is worth retrying and a stale base is not"`                                                                                                                                                                                                                                                                                                                            |
| `MAX_REVISIONS_PER_PLAN` set, with the measurement in the Log                                                                                                                                                     | verified for the code that consumes it (constant, code, copy, retryability); **not independently re-measured** — the sizing script is not checked in — `contract/src/plan.ts:80 "export const MAX_REVISIONS_PER_PLAN = 50;"`                                                                                                                                                                                                  |
| `toRevision`/`toRun` compile with literal values naming pl-44; Log says why they're true of every row                                                                                                             | proven — `api/src/db/plans.ts@20c8fd1:411 "pl-44 replaces this with the"`, `api/src/db/runs.ts@95c6403:79 "pl-44 takes the kind as input"`                                                                                                                                                                                                                                                                                    |
| `npm run check` and `npm test -- --project planner` pass; no field made optional                                                                                                                                  | proven — ran both myself at `9138ddc`: `check` exit 0, `--project planner` 888/888                                                                                                                                                                                                                                                                                                                                            |

Three low findings from the first pass, all found and fixed within this pull request, before merge — not open:

- **low, fixed at `9138ddc`** · six `.min(1)`/`.max` bounds had no failing case (`DiffPlacement.position`'s upper bound; `candidateId` on `diffEntrySchema`'s three variants; `revisionDiffSchema.revisionId`/`.parentRevisionId`; `moveOperationSchema.candidateId`; the request's `itemId`). I independently reproduced all six as green before the fix (mutate, run `--project planner`, confirm no failure, restore, `md5sum` match), and independently reproduced three of them as red after the fix. Closed by `contract/test/plan.test.ts:422 "a diff with one entry of each kind parses"` through `:446 "expect(parses(at(MAX_ITEMS_PER_DAY))).toBe(false)"` (the new "the diff schema" block), `contract/test/plan.test.ts:361 "expect(refused({ ...move, candidateId:"`, and `contract/test/revise.test.ts:71 "item id is not empty"`.
- **low, fixed at `9138ddc`** · `api/src/runs/orchestrator.ts@95c6403:560 "diffs: [],"`'s comment claimed "every plan that exists"; `api/test/plan-view.test.ts`'s `supersedeDraft` helper falsifies that inside the test suite's own database. Now reads `api/src/runs/orchestrator.ts@95c6403:554 "every plan the API can write"`, naming the helper, with the ticket's Log corrected the same way.
- **correction to my own first-pass record, not the builder's code** · I had cited the tested `remove`-with-empty-`candidateId` case as neighbouring `contract/test/plan.test.ts:384 "a candidate is placed at most once in a revision"`. It is a different test, `contract/test/plan.test.ts:347 "a move and a remove name a candidate and the day it left"`, not adjacent to it. No code changed for this one; my citation was wrong, not the ticket's test.
- **dropped** · none.
- **findings** · 3 returned, 3 carried (2 of them since fixed), 0 dropped.
- NFR: security n/a · performance n/a · reliability ✓ (retryability re-verified unchanged) · maintainability — both fixed comments now correctly scope their universal claim to what the API can write versus what a test can construct by hand.

**Not done:** did not re-run the Step 7 sizing measurement (script not checked in); did not run `code-review` (this hunt substitutes for it per the gate's own instruction); no e2e/image gate applies to this ticket's `Done when`.

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

**2026-09-13 — built; `ready` until the gate runs.** Branched from
`origin/main` at `8849c14`, dispatched as Opus. Steps 1 to 6 landed in the first
commit. Step 7 was held there: enforcing a ceiling needs a new error code, and
the owner's instruction for this build was to commit no code, constant or
refusal path in that case. The owner then chose option A with 50 (_Step 7's
ceiling, decided by the owner_, under _Why_), and step 7 landed in a second
commit on the same branch. See _Step 7_ below.

What landed:

- `plan.ts`: `RevisionOperation` and a schema per member, `PlanRevision.operation`,
  `operation` in `NewRevision`, `MAX_REVISION_NOTE_CHARS`, and the two refines
  (first draft if and only if revision 1; a candidate placed at most once).
  `RevisionDiff`, `DiffEntry` and `DiffPlacement` with schemas. The `moved`
  definition is left to pl-43, as assigned, and the doc comment says so.
- `api.ts`: `ROUTES.planRevisions`, `planRevisionsUrl`, `ReviseRequest` and
  `ReviseResponse` with schemas, and `PlanView.diffs`. The request doc comment
  names `ITEM_NOT_FOUND`, `REVISION_NOT_FOUND`, `PLAN_NOT_FOUND` and core's
  `NOT_FOUND`. `unchecked`'s comment now says it covers only the latest revision.
- `run.ts`: `RUN_KINDS` and `Run.kind`, and `queued → composing`, argued in
  the `RUN_TRANSITIONS` comment as a third application of the existing skip
  argument, with no existing edge relabelled.
- `errors.ts`: `REVISION_STALE` (not retryable) and `PLAN_BUSY` (retryable,
  `details.run`), each argued in its comment. The comment on `PLAN_BUSY` says it
  is the document's invariant rather than the job runner's.

**Additions the brief did not name**, each needed to build what it did:

- **More exports than the Done-when list.** The request schema is built from
  the operation schemas, so each bound is written once. That means exporting
  `firstDraftOperationSchema`, `replanOperationSchema`, `moveOperationSchema`,
  `removeOperationSchema` and `restoreOperationSchema`. The response schema
  needs `planViewSchema`, which did not exist. `diffPlacementSchema` and
  `diffEntrySchema` are exported beside `revisionDiffSchema`.
- **`move.toPosition` is bounded at `MAX_ITEMS_PER_DAY`, not one lower.** The
  brief gave no schema bound. `0..length` of a full day ends at 12, and a bound
  of 11 would refuse that one move as a malformed request (`INVALID_ANSWER` in
  pl-44) while every other move onto the same full day reaches pl-43's
  `PLAN_INFEASIBLE`. That would be two answers to one cause. `DiffPlacement.position`
  keeps an item's bound, because it describes a placement that exists.

### The literals, and why they are true

`toRevision` returns `operation: { kind: "first-draft" }`, and `toRun` and
`insertRun` return `kind: "draft"`. Each carries a comment naming pl-44. This is
true of every row production can write. `startRun` creates a new plan for every
`POST /api/plans`, with exactly one run. `persist` is only ever handed
`compose`'s result for that run, and `FIRST_DRAFT_REASON` is the only reason the
orchestrator writes. So every stored revision is revision 1 of its plan and a
first draft, and every stored run drafts one. **For the same reason,
`readPlanView` returns `diffs: []`**, with a comment naming pl-44 and pl-43: no
route can append a second revision to diff. The one plan with two revisions is
the test row below, and it reads an empty list too.

**One row is not a first draft: a test's.** `supersedeDraft` in
`api/test/plan-view.test.ts` writes a revision 2 by hand to prove pin
scoping. It now stamps `{ kind: "restore", revision: previous.revision }`,
which is what a copy of a draft is, but `toRevision` reads it back as
`first-draft`. Nothing on that read path validates, and the test asserts
nothing about the operation. pl-44's stored column makes the read honest.

### What the brief had wrong

- **"Three lines" was five sites, and one of them is outside the named files.**
  The brief did name `toRevision`, `toRun` and `compose`. It missed these:
  - `insertRun` in `api/src/db/runs.ts` builds a `Run` by hand as well.
  - A required `PlanView.diffs` is a compile error in `readPlanView`
    (`api/src/runs/orchestrator.ts`) and in `planView` in
    `web/test/plan-fixtures.ts`. The brief's "nothing else outside `contract`
    changes" cannot hold with step 4 as written.
  - `api/test/plan-view.test.ts` builds a `NewRevision` by hand, as noted above.

  `npm run typecheck` found every one of them. None is in pl-39's files
  (`agent/src/*`, `api/src/{config,server}.ts`).

- **`run.test.ts` asserted `queued → composing` was illegal**, as its example of
  "a way back". It now uses `composing → queued`, and a separate test covers the
  new edge along with the two skips it does not open (`queued → done`,
  `queued → reviewing`).
- **Trap 1's "every stored revision _is_ a first draft"** is true of
  production, and false of the one test row above.

**Fold-in: nothing.** The brief names two adjacent pieces of work, and neither
is free from here. The `moved` definition is pl-43's, and needs pl-43's
algorithm. `PLAN_INFEASIBLE → 409` is pl-44's, and lives in `http-errors.ts` on
a route that does not exist yet.

### Verification

`npx vitest run` on each narrowest file: `contract/test/{plan,run,errors,revise}.test.ts`,
and then `itinerary/test/compose.test.ts`, `api/test/{plan-view,runs}.test.ts`
and `web/test/{run-view,plan-view}.test.tsx`. **Each new rule was run red**:
twelve mutations, applied one at a time to the source from a backup.
Each failed exactly the test written for it and nothing else: candidate
once; first draft if and only if revision 1 (two tests); days unique; days
ascending; days non-empty; specialists unique; note bound; `restore >= 1`;
`queued → composing`; `PLAN_BUSY` retryable; `baseRevisionId` on `replan`;
`baseRevisionId` on `restore`. All four sources were `cmp`-identical to the
backup afterwards. The `toPosition` bound, changed after that run, was run red
on its own: restoring `MAX_ITEMS_PER_DAY - 1` fails the move test, 1 of 29.

### Step 7 — the measurement, the stop, and what landed

Measured with a scratch script that is not checked in. For each checked-in trip
fixture it runs `compose` with `NOTHING_MEASURED`, then appends _n_ copies of
that revision through `appendRevision`. Each copy has re-keyed ids and a
`replan` operation, and the chain is validated by `planDetailSchema`. It then
builds `PlanView` with *n*−1 diffs and validates it by `planViewSchema`. The
empty-diffs column is the smallest a diff can be. The worst-diff column has
every parent item `removed` and every child item `added`, the largest entry
list two revisions can produce. `node --import tsx measure.ts` printed:

```
fixture file sizes (bytes) and one composed revision:
  road-trip          file= 4776  days= 9  items= 3  view@1=  6123
  backcountry        file= 4856  days= 4  items= 2  view@1=  5636
  motorised-touring  file= 4601  days= 4  items= 1  view@1=  4936
  city-and-culture   file= 5155  days= 8  items= 3  view@1=  6195
  resort             file= 4153  days= 8  items= 1  view@1=  5253
  multi-city         file= 4965  days=13  items= 2  view@1=  6281

PlanView JSON bytes for city-and-culture:
  revisions= 1  diffs-empty=    6195  diffs-worst=    6195  (6.0 KiB)
  revisions=10  diffs-empty=   18710  diffs-worst=   22913  (22.4 KiB)
  revisions=50  diffs-empty=   74910  diffs-worst=   97793  (95.5 KiB)
  marginal bytes per revision, worst diff: 1855

PlanView JSON bytes for multi-city:
  revisions= 1  diffs-empty=    6281  diffs-worst=    6281  (6.1 KiB)
  revisions=10  diffs-empty=   20330  diffs-worst=   23129  (22.6 KiB)
  revisions=50  diffs-empty=   83490  diffs-worst=   98729  (96.4 KiB)
  marginal bytes per revision, worst diff: 1869
```

`city-and-culture` is the largest fixture file and `multi-city` the largest
view. **The fixtures place one to three items each**, so they measure a thin
plan, not a full one. A second scratch script builds one schema-valid revision
at the schema's own maximum: 60 days of 12 items, every leg `not-established`,
which is the smallest non-null travel (a measured leg is larger). It printed:

```
max revision: 720 items, 154843 bytes (schema-valid=true; every leg not-established, the smallest non-null travel; a measured leg is larger)
worst diff for it: 136934 bytes
  revisions= 1  ~154843 bytes (0.15 MiB), candidates and brief excluded
  revisions=10  ~2780836 bytes (2.65 MiB), candidates and brief excluded
  revisions=50  ~14451916 bytes (13.78 MiB), candidates and brief excluded
```

So 50 revisions is under 100 KiB for every fixture, and about 14 MiB at the
schema maximum before candidates, the brief, or any measured travel.

**Enforcing a ceiling on writes needs a new error code.** A revise request on a
plan at the ceiling is well formed and has to be refused, and no code in the
taxonomy means that:

- `SIZE_LIMIT_EXCEEDED` is core's artifact cap. Its copy, "The result is larger
  than the configured size limit", would have to be re-worded at the raise
  site, which is the rule's own tell.
- `PLAN_INFEASIBLE` is about the trip's constraints.
- `INVALID_ANSWER` is about a malformed answer.
- `RATE_LIMITED` is about time, and `PLAN_BUSY` clears on its own.

So the first commit had no `MAX_REVISIONS_PER_PLAN`, and the decision went back
to the orchestrator as options. The owner chose A with 50.

**Step 7, built** in the second commit:

- `REVISION_LIMIT_REACHED` is in `PLANNER_ERROR_CODES`. It is not retryable,
  because nothing makes a plan shorter. Its copy sends the user to a new plan
  from the same trip, which `POST /api/plans` from the same intake already does.
  Its comment argues each near-miss code, as above.
- `MAX_REVISIONS_PER_PLAN = 50` is in `plan.ts`, beside the other bounds, with a
  comment citing this measurement. It counts the first draft, so the request
  refused is the one that would append revision 51. A restore appends too, so it
  is refused the same way.
- Tested in `contract/test/errors.test.ts`, in the same form as `REVISION_STALE`
  and `PLAN_BUSY`. Run red by adding the code to `RETRYABLE_CODES`, which fails
  that test.

**Deliberately not built:** a `.max(MAX_REVISIONS_PER_PLAN)` on
`planDetailSchema.revisions`. Step 7 specifies no schema check, and nothing
reads a stored plan through that schema (_Traps_). The refusal is pl-44's check
6 with its 409, plus the re-check inside `persist`.

**2026-09-13 — the gate's three low findings, reproduced and repaired.** The
gate (Sonnet, PASS at `19f1810`) found schema bounds with no failing case, and
an overstated comment. Each was reproduced before it was fixed:

- **Untested bounds.** I applied eight mutations one at a time and ran
  `npx vitest run tools/planner/contract/test`. All eight stayed green at 127
  of 127, which reproduced the finding:
  - `DiffPlacement.position`'s maximum;
  - the `candidateId` minimum on each of `added`, `removed` and `moved`;
  - the minimums on `revisionId` and `parentRevisionId`;
  - `move.candidateId`'s minimum;
  - the request's `itemId` minimum.

  New tests are in `contract/test/plan.test.ts` (_the diff schema_, and one line
  in the move/remove test) and in `contract/test/revise.test.ts` (an empty
  `itemId` on `move` and `remove`). The same eight mutations then each failed
  exactly their own test, at 135 tests, and every source was byte-identical
  after its restore.

- **`diffs: []`'s comment said "every plan that exists".** The test helper
  `supersedeDraft` appends a second revision by hand, so that was false inside
  the suite. The comment now says "every plan the API can write" and names the
  helper. The Log sentence above that made the same claim is corrected the same
  way.

**2026-09-13 — gated, and done.** The gate (dispatched as Sonnet) passed at
`9138ddc`. Its record is `## Review` above, committed verbatim in the commit
that sets `status: done`. **A note on that record from me, the builder
(dispatched as Opus), not from the reviewer:** its first finding says "six"
bounds had no failing case and then lists eight. The eight are the bounds
counted one by one: `DiffPlacement.position`, `candidateId` on each of `added`,
`removed` and `moved`, `revisionId`, `parentRevisionId`, `move.candidateId`,
and the request's `itemId`. Those are the eight I mutated. The six is the
reviewer's first-pass count, which mutated only `added`'s `candidateId` as
representative of all three variants ("6 of 22 stayed green" in its long form).
The citations are unaffected.
