---
id: pl-44
tool: planner
title: A plan is revised over HTTP — re-plans run as jobs, edits write synchronously
kind: work-package
status: done
milestone: P4
depends_on: [pl-42, pl-43]
difficulty: hard
---

# pl-44 — The re-plan run and the edits

**Packages:** `api` (the route, the run, the edits, the migration), plus a
small `agent` input: the fan-out learns to run a named subset and to carry a
note. It builds on [pl-42](./pl-42-the-revision-contract.md)'s types and on
[pl-43](./pl-43-repack-named-days-and-diff.md)'s functions. It redefines
neither. If either is wrong, stop and say so.

## Why

**The contract can describe a second revision, and nothing can write one.**
After pl-42 and pl-43, `RevisionOperation`, `ReviseRequest` and `RevisionDiff`
exist, and `itinerary` can re-pack named days, apply an edit, copy a revision
and diff two of them. `POST /api/plans/:id/revisions` still answers nothing.
The run orchestrator only knows how to draft revision 1 from a live intake.
Every stored revision reads as `first-draft`, and every run as `draft`, because
pl-42 wrote those as literals in `toRevision` and `toRun` and named this ticket
as the one that replaces them.

This ticket is where §6's two mechanisms meet the database and the job runner.
The owner's decisions below are fixed. What is left is the API's own work:

- the checks a schema cannot make, and `itinerary` deliberately does not;
- keeping the one-writer rule on the chain race-free;
- what a re-plan spends;
- what an edit may look up inside a request;
- the columns that record all of it.

### Decided by the owner, 2026-09-13

Recorded in pl-42 and restated here only as far as this ticket acts on them:

- **v1 operations:** re-plan named days (specialists optional, note optional),
  move one item, remove one item, restore revision _n_ as a new revision.
  Brief edits are deferred.
- **No specialists named** re-packs the named days from the plan's existing
  pool, with no model call. **Named specialists run again**, and their new
  candidates join the pool.
- **Re-plans build on the latest revision.** History is linear, and pl-22's
  latest-only pin rule stands.
- **Adopted in pl-42:**
  - diffs are derived on read and served in `PlanView.diffs`;
  - days outside a slice are frozen;
  - every re-plan is a run, even with zero specialists;
  - move, remove and restore are synchronous and answer a fresh `PlanView`,
    acting only on the latest revision.

## Build

### What this ticket calls from pl-43

These are pl-43's exports as filed. Call them; do not re-implement any part of
them in `api`, because a second composer in the API is the drift
`db/plans.ts`'s header warns about. `api` never learns the id scheme.

| Export                                                    | Used for                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `replan(input: ReplanInput): ComposeResult`               | The re-plan's revision: frozen days copied with fresh ids and stored travel, named days re-packed, `PLAN_INFEASIBLE` on a hard finding |
| `replanPool({ candidates, previous, days }): Candidate[]` | The candidates whose places the measuring pass asks about, which is exactly what `replan` may place                                    |
| `editTransitions(previous, operation): TransitionPair[]`  | The pairs an edit must measure, `{ dayIndex, fromCandidateId, toCandidateId }`: at most 1 for a remove, 3 for a move                   |
| `applyEdit(input: EditInput): EditResult`                 | The edit's revision, `{ revision, unchecked, findings }`, with `PLAN_INFEASIBLE` when a touched day breaks                             |
| `restoreRevision(target, { id, reason, createdAt })`      | The restore's `NewRevision`, which stamps its own `restore` operation                                                                  |
| `revisionDiffs(revisions): RevisionDiff[]`                | `PlanView.diffs`, pairing by `parentRevisionId`                                                                                        |

**These checks are `api`'s, not `itinerary`'s.** `itinerary` throws
`INTERNAL` when a bad value reaches it, because reaching it means `api` did not
check:

- a day index or `toPosition` out of range;
- a `fromDayIndex` that disagrees with the base revision;
- a restore target that is not earlier.

Step 2 is where each check is made, with a user-facing code.

### 1. The agent: a named subset, and a note

Both changes go in `@planner/agent`, and both are additive.

- **`FanOutInput.only?: readonly Specialist[] | undefined`.** `undefined`
  keeps today's behaviour, the whole roster. When `only` is set:
  - The roster is still `rosterFor(brief)`, so applicability stays a pure
    function of the brief (**the roster is data**). Then `running` and
    `notApplicable` are each filtered to the named set.
  - **Budget:** `applyBudget` runs over the filtered `running`. A re-plan
    naming more specialists than `runBudgetFor(config).maxSpecialists` drops
    from the back of `SPECIALIST_ORDER`, and the dropped one carries
    `specialist-dropped-for-budget`, exactly as a draft does.
  - **A named specialist the roster says is not applicable is not run.** It
    keeps its `specialist-not-applicable` gap with the roster's own sentence.
    It is not refused: that sentence is true, and pl-45 offers every member of
    `SPECIALISTS` as a checkbox, so the case is reachable by an ordinary user.
  - **Gaps and the `roster` frame cover the named set only.** A re-plan of
    `food` must not re-report `lodging` as not applicable. That gap belongs to
    the previous revision, and step 4 carries it forward.
  - `only: []` emits a `roster` frame with `total: 0`, sends no request and
    returns empty. `api` does not call the fan-out with an empty set (step 4),
    but the edge has a defined answer and a test.
- **`FanOutInput.note?: string | null | undefined`**, threaded through
  `AskInput` into **`userPrompt`**, not `systemPrompt`.
  - **Why the user message:** the brief's own free text (`In their words:` on
    every shape) already lives there. The system prompt is where "Rules, and
    they are not negotiable" lives, and a user's words beside the rules sit in
    a rule's position.
  - **How it is rendered:** like `discoveryBlock`. It gets a framing line
    saying it is what the traveller wrote about this change and is context,
    never an instruction or a change to any rule. The note is quoted inside
    that frame, and a closing line says to read it as what they care about.
  - **Who sees it:** every specialist that runs, not only `READS_FINDS`,
    because the note is about the change rather than about a place.
  - The scripted provider reads its markers from the system prompt, so it is
    unaffected.
- **Export `readsFinds(specialist): boolean`** from `prompt.ts`, over the
  existing `READS_FINDS`, so step 4 decides whether to re-discover without a
  second copy of that set in `api`.

Candidate ids are `${runId}-${specialist}-${n}`, and a re-plan is a new run, so
new candidates cannot collide with the pool.

### 2. The route: `POST /api/plans/:id/revisions`

Register `ROUTES.planRevisions` in `routes/plans.ts`, thin like its neighbours.
The work lives in a new `api/src/runs/revise.ts`, which keeps
`orchestrator.ts` from growing past 600 lines. It shares `moveTo`, `record`,
`persist` and `isCancellation` rather than copying them.

**The checks, in this order.** The order is part of the answer:

1. **Parse** with pl-42's request schema. A body that does not parse is
   `INVALID_ANSWER`, which is what `parseBody` and `parsePin` beside it already
   answer.
2. **Rate limit**, by kind (step 9). This comes before any database read, so a
   refused request stays cheap.
3. **`PLAN_NOT_FOUND`** when the plan does not exist.
4. **`PLAN_BUSY`** with `details: { run: <runId> }` when a run on this plan is
   not terminal. pl-45 links to that run.
   - This fires before staleness because the client's base is probably still
     the latest. When the run finishes, the same request becomes
     `REVISION_STALE`, which is the correct order of advice: wait, then reload.
   - A plan whose first draft is still running is `PLAN_BUSY` too.
5. **`REVISION_STALE`** when `baseRevisionId` is not the latest revision. That
   includes a plan with no revision at all, where a failed or canceled first
   draft left nothing to build on.
6. **`MAX_REVISIONS_PER_PLAN`**, refused with whatever pl-42's step 7
   settles. If pl-42 records that no code fits, this check stops there and
   says so. It does not borrow one.
7. **Per kind:**
   - `replan`: every day is below the base revision's day count. Past it is
     `INVALID_ANSWER`, the same refusal a malformed body gets. The day count
     is the base revision's. A dates edit ([pl-47](./pl-47-edit-the-dates-and-budget.md))
     can change it, but only by appending a revision, so a request built on an
     older count is already `REVISION_STALE` at check 5. This is not
     staleness, and a correct client cannot send it.
   - `move` / `remove`: `itemId` is an item on the latest revision, otherwise
     `ITEM_NOT_FOUND`. Resolve it to its candidate and its day in one query
     scoped the way `updateItemPin` scopes its `UPDATE`, never by trusting the
     id alone. The stored operation's `fromDayIndex` is that day. The request
     carries none (pl-42), so there is no mismatch to refuse.
   - `move`: `toDayIndex` is below the day count, and `toPosition` is in
     `0..length` of the destination day **after the item has left its source**
     (pl-42's definition), otherwise `INVALID_ANSWER`. On a same-day move, that
     length is one fewer than the day holds now.
   - `restore`: `1 <= revision <= latest`, otherwise `REVISION_NOT_FOUND`.
     Restoring the latest is legal under pl-42's "earlier than the revision it
     produces" and gives an empty diff (pl-43's table, row 1). pl-45 only
     offers restore on older versions, and this ticket does not invent a
     refusal for it.

Then `replan` answers **202** `{ kind: "run", run }`, and the other three answer
**200** `{ kind: "revision", view }` with a fresh `readPlanView`.

**`http-errors.ts`:** `REVISION_STALE → 409` and `PLAN_BUSY → 409`. The
request conflicts with the document's current state, and neither is the
caller's malformed input. `PLAN_BUSY`'s retryability is the catalog's.
**Map `PLAN_INFEASIBLE → 409` too.** `STATUS_BY_CODE` has no entry for it, and
the table falls back to 500, because until now it was only ever raised inside a
run. A synchronous move (step 5) is its first HTTP caller, and without the entry
it reports a server fault for a day the user overfilled. The same argument
applies: the request is well formed and conflicts with the plan's own
constraints. [pl-47](./pl-47-edit-the-dates-and-budget.md)'s dropped-pin refusal
relies on this entry.

### 3. `PLAN_BUSY` without a race

The invariant is the chain's (pl-42's step 6): **one writer building on the
latest revision at a time.** A non-terminal run is how `api` detects it.

- **Check and insert in one synchronous transaction.** The re-plan's "is any
  run on this plan live?" check and its `insertRun` run in a single
  `db.transaction(...)()` with no `await` inside. `better-sqlite3` is
  synchronous, and the architecture has one process owning the database and
  its in-process queue, so no other handler can run between the check and the
  insert. `startRun` already writes its plan and run together this way.
- **The database backstops it.** Migration 10 adds
  `CREATE UNIQUE INDEX plan_runs_one_live ON plan_runs (plan_id) WHERE finished_at IS NULL`,
  the same move `UNIQUE (plan_id, revision)` makes for `appendRevision`.
  - The rule holds even against a writer that forgets the check.
  - A constraint failure on that index maps to `PLAN_BUSY`, never `INTERNAL`.
  - `finished_at` is set by `updateRunStatus` exactly when a status is
    terminal, so the index's predicate and `TERMINAL_RUN_STATUSES` agree by
    construction.
  - Every plan has exactly one run before this ticket, so creating the index
    cannot fail on existing data.
- **An orphaned run must not wedge a plan.** Nothing sweeps runs on boot.
  `db/runs.ts` leaves a row stuck in `fanning-out` after a restart visible on
  purpose, so with the index above that plan would be `PLAN_BUSY` forever.
  - Before the check, a live-by-status run that `context.runs.has()` does not
    know is closed out exactly the way `cancelRun` closes one (same code path,
    not a copy).
  - There is no `await` between that close and the transaction. `startRun`
    inserts and enqueues in one tick, so a real queued run is never mistaken
    for an orphan.
- **Edits re-check inside their write.** An edit does an async lookup between
  its checks and its write (step 5), so the pre-checks alone are a race. The
  write transaction re-checks both that no run is live and that the latest is
  still `baseRevisionId`, and refuses with `PLAN_BUSY` or `REVISION_STALE`.
  Two concurrent moves then land one revision and one `REVISION_STALE`, never
  two revision `n+1`s.
- **A run's `persist` re-checks as well.** That the latest is still the base,
  and that the ceiling holds, is checked inside `persist`'s transaction. While
  the busy rule holds this is unreachable, and it is asserted defensively the
  way `persist` already checks that the appended revision appears.

### 4. The re-plan run

Queue, SSE and cancel are exactly a draft's. `Run.kind` is `"replan"`, set on
`insertRun`, and the run goes through `context.runs.enqueue`, `record` and
`cancelRun` unchanged.

**The brief is the plan's snapshot**, `plan.brief`, and never `readIntake`.
The intake stays editable, and the snapshot is what every revision of this
plan was built against.

**[pl-47](./pl-47-edit-the-dates-and-budget.md) moves that snapshot onto each
revision**, so a dates or budget edit can change it, and `plan.brief` stays the
first draft's. Whichever of the two lands second changes this read, and every
other `plan.brief` in this ticket, to the base revision's `brief`.

**The pipeline.** Every edge is legal after pl-42:

```
queued ─┬─► grounding (discover) ─► fanning-out ─┬─► grounding (measure) ─► composing ─► done
        ├─► fanning-out ─────────────────────────┤
        ├─► grounding (measure) ─────────────────┘   zero specialists named
        └─► composing                                zero specialists, nothing to measure
```

1. **Roster frame first.** With no specialists named, `record` a `roster`
   frame `{ running: [], droppedForBudget: [], total: 0 }` yourself. This does
   not call the fan-out, so it makes no model call. `record` writes
   `roster_size = 0`, so `Run.rosterSize` reads `0`, not `null`: "nobody is
   running" rather than "not decided yet". pl-42's filing gate named this as
   unverifiable until now, and a test proves it.
2. **Discovery re-runs only when it would change a prompt.** It runs when
   `hasCorridor(brief)` holds and at least one _named_ specialist
   `readsFinds`. Otherwise it is skipped.
   - **Why re-run at all:** finds are not stored anywhere, only `coverage` and
     `reading` are. Re-planning `food` without its discovery block would give
     a worse specialist than the one that drafted, and the diff would present
     that regression as the user's choice.
   - **The cost is real, and the dispatcher's premise that the cache makes it
     cheap is wrong.** `RunGrounding.nearby` and `articlesNear` are uncached by
     design (pl-29, pl-33); only the two corridor-end `locate`s and the detour
     `travel` hit the cache. So a re-discovery pays for the corridor query and
     its tiles again, inside the run's one `MAX_GROUNDING_CALLS` budget, which
     the measuring pass shares exactly as it does on a draft.
   - **Storing finds per plan was rejected.** It is a new table for a list that
     pl-41 is about to cap and reorder, and a corridor query is a live answer.
   - **Coverage and reading:** when discovery ran, pass its `coverage` and
     `reading` to `replan`. When it did not, **pass neither**; `replan`
     defaults both to `previous`'s ("evidence persists until something
     re-asks").
3. **Fan out only the named specialists:** `runFanOut({ only: specialists,
note, finds, brief: plan.brief, capacity: capacityFor(brief), budget:
runBudgetFor(config), runId, signal, onProgress })`.
   - `capacity` is the whole trip's, not the slice's. A candidate belongs to
     the plan's pool rather than to a day, and "this trip has 2 days" would be
     false.
4. **Read the plan once, after the fan-out.**
   - **The pool:** `plan.candidates` in the order `selectPlan` returns them,
     with this run's new candidates **appended** in fan-out order. The packer
     places in input order, so pl-43's trap requires a stable order; do not
     re-sort and do not re-read the pool after inserting.
   - **`previous`:** the latest revision, checked equal to `baseRevisionId`.
5. **Measure only what the slice may place:**
   `runPlaces(replanPool({ candidates: pool, previous, days }))`, handed to
   `measureTravel` with the run's one `RunGrounding`.
   - `replanPool` is the same function `replan` packs from, so the measured
     table and the packed days agree by construction.
   - Frozen days have nothing to ask: `replan` copies their stored
     `travelFromPrevious` and never calls the table for them.
   - Enter `grounding` only when there are places to measure, per the
     _never fake progress_ argument on `RUN_TRANSITIONS`.
6. **Compose, with no `await` from here to the write.**
   1. **Re-read the latest revision** and check it is still the base. A pin set
      while the specialists ran or grounding measured is on that revision in
      place (pl-22), and `replan` must honour it. Nothing else can change the
      revision while the run holds the plan.
   2. **Insert the new candidates** with this run's id (`insertCandidates`),
      then call `replan`. A run that fails inside `replan` leaves them in the
      pool on purpose: they were paid for, and a later free re-pack can draw on
      them. Only new candidates are inserted, because pool candidates are
      already rows (primary key).
   3. **Call `replan`** with:
      - `candidates`: the pool from 4;
      - `previous`: the revision just re-read;
      - `operation: { kind: "replan", days, specialists, note }`, storing what
        was **asked**;
      - `travel`: the table from 5;
      - `coverage` and `reading` per 2;
      - `revision: { id, reason, createdAt }`, with the id minted from the run
        id as the draft's is, and the `reason` from step 6 built from what
        **ran**;
      - `now`;
      - **`gaps`**, which this ticket decides (pl-43 leaves "which of
        `previous.gaps` to carry" to the caller): `previous.gaps` minus every
        entry for a named specialist, plus the fan-out's gaps, which cover only
        the named set. A zero-specialist re-plan passes `previous.gaps`
        verbatim. `replan` then drops any gap its days contradict and keeps at
        most one per specialist.
   4. **`persist`**, then `done`, exactly as a draft.
7. **Cancel and failure** are a draft's. A canceled re-plan writes no revision
   and ends `canceled`, with the abort reaching the provider. A
   `PLAN_INFEASIBLE` from `replan` fails the run with its `details` untouched,
   and pl-45 renders that through `RunView`'s existing `failed` branch.

### 5. The synchronous edits

**Move and remove.**

1. **`editTransitions(previous, operation)`** returns the pairs to measure: at
   most one for a remove and three for a move.
2. **Measure them.** Take the candidates the pairs name, their places as
   `runPlaces`, and `measureTravel` over them with
   `groundingForRun(context.grounding, groundingBudget(min(config.maxGroundingCalls, places.toLocate.length + 1)))`.
   - That is one call per place still to locate, plus one matrix. The budget
     is sized to the edit, so an ordinary edit is never refused for budget, and
     only the deployment's own ceiling can cut it.
   - `tableFor` answers `not-established` for a pair whose ends it does not
     hold (pl-43's Log), so a table built over just these candidates is honest
     about anything else it is asked.
   - **A lookup the budget refused lands `over-budget`. A lookup made and
     answered unknown lands `not-established`. Never collapse the two.**
     `ItemTravel` exists so that a road nobody mapped and a question nobody
     asked read differently. A place whose earlier locate answered unknown is
     asked again, because a negative answer is not cached, and lands
     `not-established` honestly.
3. **`applyEdit({ brief, candidates, previous, operation, travel, revision })`.**
   Its `revision` goes to the write; `unchecked` and `findings` are not
   persisted, exactly as a draft's `ComposeResult` is not, since
   `readPlanView` derives `unchecked` on read. Unchanged transitions, `gaps`,
   `coverage` and `reading` are carried by `applyEdit`, not by `api`.
4. **Write the revision** in the re-checking transaction from step 3, with
   `touchPlan`, and answer `readPlanView`.

**The lookup is usually free.** The draft wrote located coordinates back onto
the candidates before storing them, so the ordinary edit is one matrix call,
most often a cache hit.

**The lookup is bounded.** The worst case is
`(toLocate + 1) × GROUNDING_TIMEOUT_MS` inside a request. The lookup's
`signal` aborts when the request's socket closes, and an aborted edit writes
nothing.

**Restore** is `restoreRevision(revisionN, { id, reason, createdAt })`, then
the same write. It makes no grounding call and no lookup of any kind.
`restoreRevision` stamps the operation and copies days, pins and
`travelFromPrevious` (pl-42's trap). Which pins: revision _n_'s, as stored — the
answer to question 2 recorded in [pl-43](./pl-43-repack-named-days-and-diff.md)'s
Log, in its entry answered on 2026-09-13.

An edit emits no SSE frame and creates no run.

### 6. `reason` — the copy

**Derived server-side, never from the client**, in one pure function in a new
`api/src/runs/reason.ts`, with one unit test per branch:

| Operation                 | Reason                                            |
| ------------------------- | ------------------------------------------------- |
| replan, ≥1 specialist ran | `Re-planned days 3–4 with food and lodging.`      |
| replan, nothing ran       | `Re-packed day 3 from what was already proposed.` |
| move, across days         | `Moved “Chute Montmorency” from day 2 to day 4.`  |
| move, within a day        | `Moved “Chute Montmorency” within day 2.`         |
| remove                    | `Removed “Chute Montmorency” from day 2.`         |
| restore                   | `Restored version 3.`                             |

- **Day numbers are 1-based**, which is what a reader sees. A contiguous run
  is written with an en dash, and a scattered set as `days 2, 4–5 and 7`.
- **Specialists** use `SPECIALIST_DEFINITIONS[s].title`, in `SPECIALIST_ORDER`,
  joined `a, b and c`.
- **"Ran" means `FanOutResult.roster.ran`.** A named specialist that was not
  applicable or was dropped for budget is not in the caption, so the caption
  never says "with food" about a meal plan that already covers the meals. Its
  gap says why, and the operation still records what was asked.
- **The note is never in the reason.** A note is not a caption (pl-42).
- **A candidate title is model-written and bounded.** It is rendered as text,
  and at `MAX_CANDIDATE_TITLE_CHARS = 200` every branch fits
  `MAX_REVISION_REASON_CHARS = 500` by arithmetic. A test builds the reason
  from the longest title and parses the revision with `planRevisionSchema`.
- Say "version", matching `REVISION_NOT_FOUND`'s copy and the plan page's
  crumb line.

### 7. Persistence — migration 10

Take the next free number at build time, and never renumber a shipped one.
Today's last is 9, which pl-49 took, so this is 10 at the time of writing (or
whatever is next free when pl-44 is built).

```sql
ALTER TABLE plan_revisions ADD COLUMN operation_json TEXT NOT NULL DEFAULT '{"kind":"first-draft"}';
ALTER TABLE plan_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'draft';
CREATE UNIQUE INDEX plan_runs_one_live ON plan_runs (plan_id) WHERE finished_at IS NULL;
```

- **pl-42 lands first and alone**, with `toRevision` and `toRun` returning the
  literals `first-draft` and `draft`. Those are true of every stored row,
  because nothing could write a second revision or a re-plan run before this
  ticket. No read path validates a stored revision or run against a schema,
  so pl-42's change is a compile-time matter only.
- **The runtime risk is SQL, and it lives entirely in this ticket.** Code that
  selects `operation_json` or `kind` fails against a database without them. So
  **the migration and the column reads land in the same commit.** `migrate`
  runs at boot before the server listens, so no image of this tool ever holds
  that SQL without the migration that makes it valid.
  - In that commit, `toRevision` parses `operation_json` and `toRun` reads
    `kind`, replacing pl-42's literals and their comments naming this ticket.
  - `insertRevision` and `insertRun` write both columns explicitly.
- **The backfill is a column `DEFAULT`, not an `UPDATE`, and it cannot be.**
  `plan_revisions_append_only` raises on _any_ `UPDATE` of `plan_revisions`, so
  an `UPDATE … SET operation_json` would abort the migration, roll it back and
  refuse the boot. Migrations 7 and 8 used the same `DEFAULT` shape for the
  same kind of column, and the defaults are the values pl-42's literals
  already assert.
- **The `DEFAULT` is for old rows only.** A writer relying on it would silently
  store `first-draft` on revision 2, so a test reads a revision 2 back and
  asserts its operation.
- **`operation_json` is JSON by migration 2's rule:** read whole, validated on
  the way out, and never filtered on. `toRevision` parses it with pl-42's
  operation schema and treats a failure as a fatal corrupt read, the way
  `gaps_json` already is.
- **`kind` is plain text with no `CHECK`**, for `status`'s reason: the legal
  values are the contract's. `toRun` reads it the way it reads `status`.
- **An image older than this ticket still boots against a migrated database.**
  It ignores the new columns, its inserts take the defaults (true of every
  revision 1 and every draft it could write), and it never creates a second
  live run for a plan.
- **The migrations tests** move their `user_version` expectations from 9 to 10
  (`api/test/migrations.test.ts`), and gain the cases in _Done when_.

### 8. `PlanView.diffs`

`readPlanView` returns `diffs: revisionDiffs(plan.revisions)`. It pairs by
`parentRevisionId`, one diff per revision after the first, oldest first. It is
derived on every read, and nothing is stored. The pin route answers
`readPlanView`, so its response gains `diffs` with no change of its own.

### 9. Rate limiting

**Every re-plan spends from `runLimiter`**, with or without specialists named.

- **The scarce thing is a queue slot, not only a model call.** A
  zero-specialist re-pack still holds one of `MAX_CONCURRENT_RUNS` slots while
  it grounds.
- A cheaper bucket for free re-packs would let one client hold every slot and
  starve other people's drafts, which is the DoS the architecture files under
  security.
- A re-plan with specialists spends what a draft spends, so it shares a
  draft's allowance rather than doubling it.

**Move, remove and restore spend from a second per-client bucket,
`RATE_LIMIT_EDITS_PER_MINUTE`** (default 30; zero disables, as its sibling
does).

- They take no queue slot, and a person rearranging a day makes several a
  minute, which a budget of 5 would refuse.
- They are not free either: each appends a revision, and an edit can spend a
  few grounding calls.
- Leaving them unmetered would make the revision ceiling the only bound, and
  that is per plan, not per client.

**The existing hook cannot do this as written.** `createRateLimitHook` is an
`onRequest` hook, and it runs before the body is parsed, so it cannot know the
kind. Factor out the check it performs, with the same headers, the same
`RATE_LIMITED` and the same log line. The hook keeps using it for
`POST /api/plans`, and the revisions handler calls it after parsing, with the
bucket the kind selects.

- `context.ts` gains `editLimiter`, and `server.ts` builds it.
- `config.ts` reads `RATE_LIMIT_EDITS_PER_MINUTE`, with a `config.test.ts`
  case.
- `01-ARCHITECTURE.md`'s configuration table gains the row beside
  `RATE_LIMIT_RUNS_PER_MINUTE`, and its security posture line on run creation
  is widened to cover revision.

## Traps

- **Build this after [pl-39](./pl-39-a-real-model-behind-the-seam.md) and
  [pl-41](./pl-41-every-find-reaches-the-prompt.md) land, or rebase onto them
  before gating.** The files overlap:
  - **pl-39:** `agent/src/ask.ts` (it passes `replySchema`, and this ticket
    threads `note` through the same call), `api/src/config.ts` and
    `api/src/server.ts` (its provider settings, and this ticket's
    `editLimiter`), plus `agent/src/budget.ts` and `agent/src/provider.ts`,
    which this ticket reads but should not need to edit.
  - **pl-41:** `api/src/runs/discovery.ts` (this ticket calls
    `discoverAlongCorridor` unchanged) and possibly `agent/src/prompt.ts`
    (its optional backstop in `discoveryBlock`, beside this ticket's note
    block and `readsFinds` export).

  **Neither is in `depends_on`**, because nothing here needs anything they
  add. Every overlap is textual, and the one semantic coupling works either
  way: after pl-41, a re-discovered revision carries pl-41's "places not
  shown" `coverage` entry, and before it, it does not. Serialise to avoid a
  three-way conflict in `ask.ts` and `config.ts`, not because the build
  breaks.

- **`fromDayIndex` is derived, never sent.** When this brief was written, pl-42
  read two ways: its step 1 said `api` checks that `fromDayIndex` agrees with
  the base revision, while its request named only `itemId`. That was corrected
  at filing: pl-42 now says `api` derives the day from the item, and the
  request carries no `fromDayIndex`. Do not add the field to the request
  locally.

- **`PLAN_INFEASIBLE`'s `details` shape is `compose`'s:**
  `{ findings: [{ kind, dayIndex, detail }] }` (`itinerary/src/compose.ts`,
  the hard-findings throw), which pl-43 says `replan` and `applyEdit` reuse.
  `api` passes it through untouched, for the synchronous move and for the
  failed run alike, and pl-45 renders it with a fallback to the message. A
  re-shaping in `api` would be a second definition of the finding.

- **Do not reach for `readIntake` in a re-plan.** It is the obvious spelling,
  because `startRun` uses it, and it plans against the live intake rather than
  the snapshot this plan was drafted from.

- **Do not re-sort the pool, and do not re-read it after inserting.**
  `selectPlan` orders candidates by id, so reading the plan back after
  `insertCandidates` interleaves the new ones instead of appending them. The
  packer places in input order, so two re-plans of one plan would then differ
  for no reason a reader can see (pl-43's trap).

- **Do not measure outside `replanPool`, and do not hand `measureTravel` the
  whole pool.** "The pass already measures a candidate set" makes it tempting.
  It spends budget on transitions `replan` never reads, and the measured table
  and the packed days stop agreeing by construction.

- **A named specialist that did not run must not appear in the caption, and
  must still appear in the operation.** The caption says what happened, and
  the operation says what was asked. Collapsing them in either direction loses
  one of the two.

- **`record`'s `roster` case resets `specialists_done`.** Emitting the
  zero-specialist frame through it is correct, because nothing has finished.
  Emitting it a second time later in the run would erase a count.

- **The `DEFAULT` on `operation_json` hides a forgotten write.** See step 7.
  The read-back test is the guard, not care.

## Done when

- **Route refusals.** `POST /api/plans/:id/revisions` refuses each of these
  with its code and status, one test each:
  - an unparseable body (`INVALID_ANSWER`);
  - a plan that does not exist (`PLAN_NOT_FOUND`, 404);
  - a live run on the plan (`PLAN_BUSY`, 409, with `details.run` equal to that
    run's id);
  - a base that is not the latest (`REVISION_STALE`, 409);
  - a day past the plan's day count, and an out-of-range `toDayIndex` and
    `toPosition`, including a same-day `toPosition` equal to the day's current
    length (`INVALID_ANSWER`);
  - an unknown item, and an item from a superseded revision
    (`ITEM_NOT_FOUND`);
  - a restore of a revision that does not exist (`REVISION_NOT_FOUND`);
  - the revision ceiling, with pl-42's settled refusal.

  **None of them reaches `itinerary`**: a spy proves no refused request calls
  `replan`, `applyEdit` or `restoreRevision`.

- **Busy is race-free and cannot wedge.**
  - Two re-plan requests issued together land one 202 and one `PLAN_BUSY`.
  - Inserting a second live run for one plan directly is refused by the
    database.
  - A live-by-status run absent from the queue is closed out, and the next
    request proceeds.
  - Two concurrent moves land one revision and one `REVISION_STALE`.
- **A re-plan with named specialists** is a `replan` run over SSE that ends
  `done`, with every one of these asserted against the scripted provider:
  - it sends model requests only for the named specialists;
  - it stores their candidates with its run id;
  - it passes `replan` the stored pool with the new candidates appended;
  - it records `operation` as asked and `reason` as ran.
- **A re-plan naming a not-applicable or over-budget specialist** stores its
  `specialist-not-applicable` or `specialist-dropped-for-budget` gap. The
  caption leaves that specialist out, and gaps for unnamed specialists are
  carried from the base.
- **A re-plan with no specialists:**
  - makes zero model requests;
  - sends a `roster` frame with `total: 0`;
  - reads back `rosterSize: 0`;
  - goes `queued → composing` when the slice has nothing to measure, and
    `queued → grounding → composing` when it does, each asserted from the
    status frames.
- **A pin set while a re-plan is running** is honoured by the revision it
  writes.
- **The note** reaches each running specialist's user message inside its
  framing, and appears nowhere in any system prompt. An injection string in
  the note arrives quoted as data (an `agent` test).
- **`only`** is tested in `agent`: a subset runs, a not-applicable name is not
  run, the budget cap drops from the back, and `[]` runs nothing and reports
  `total: 0`.
- **Discovery:**
  - A re-plan naming `food` on a corridor brief calls `nearby`, and the new
    revision carries its `coverage` and `reading`.
  - One naming only `lodging` never calls it, and its revision's `coverage`
    and `reading` equal the base's.
- **The measuring pass is asked only about places from `replanPool`**, asserted
  from the grounding requests.
- **A canceled re-plan** writes no revision, ends `canceled`, and its
  in-flight model requests saw the abort.
- **A move and a remove:**
  - each answers 200 with a fresh `PlanView` whose latest revision carries the
    operation, naming a candidate and `fromDayIndex`;
  - grounding is asked only about the candidates `editTransitions` named;
  - separate tests prove that a budget-refused lookup records `over-budget`
    and an asked-and-unknown one records `not-established`.
- **A move that breaks a day** answers `PLAN_INFEASIBLE` with
  `details.findings` in `compose`'s shape, and writes nothing.
- **A restore** answers 200 and makes zero grounding calls, and its revision is
  `restoreRevision`'s.
- **`PlanView.diffs`** equals `revisionDiffs(plan.revisions)` on a plan with
  at least three revisions, and is empty on a plan with one.
- **Migration 10, from `user_version = 9`** (pl-49 took 9; the next free
  number when pl-44 is built)**:**
  - A database holding a revision and a run reads back `operation:
first-draft` and `kind: draft`.
  - The append-only trigger does not fire.
  - A revision 2 written afterwards reads back its own operation.
  - pl-42's literals are gone from `toRevision` and `toRun`.
- **Rate limiting.** Re-plans, with and without specialists, spend the runs
  bucket that `POST /api/plans` spends. Edits spend the edits bucket and leave
  the runs bucket untouched. Each is refused past its burst with 429 and
  `Retry-After`.
- **`reason`** has a unit test per branch in step 6, including a scattered
  day set and the longest candidate title.
- **Gates.** `npm run check` and `npm test -- --project planner` pass. `api`
  gains no workspace dependency, so the `Dockerfile` does not change. The
  image gate and the e2e suite still do not run locally, so say so rather than
  reporting green.

## Log

**2026-09-13 — filed**, groomed against pl-42 and pl-43 as corrected and filed
on this branch, at `origin/main` `323eaa7`. Facts checked against the code:

- **No read path validates a stored revision or run against a schema.**
  `toRevision` and `toRun` build them field by field. `web` parses only
  `runEventSchema`, whose snapshot frame carries `runSchema`, and `web` ships
  in the same image as `api`.
- **Candidates already carry located coordinates.** `insertCandidates` runs
  after grounding (`orchestrator.ts`), which is what makes an edit's lookup
  usually one cached matrix.
- **`plan_revisions_append_only` refuses every `UPDATE`**, so no backfill can
  be an `UPDATE`.
- **Nothing sweeps runs on boot.** `cancelRun` is the only thing that closes
  an orphan.
- **`createRateLimitHook` is `onRequest`** and cannot see a body.
- **`RunGrounding.nearby` and `articlesNear` are uncached.** The dispatcher's
  premise that a re-discovery is cheap because of the cache was wrong, and
  step 4.2 argues the cost instead.
- **`selectPlan` orders candidates by id**, which is why the pool is read once
  and the new candidates appended rather than read back.
- **`compose` throws `PLAN_INFEASIBLE` with `details.findings`**
  `[{ kind, dayIndex, detail }]`.
- **pl-45 offers every `SPECIALISTS` member** as a re-plan checkbox, which is
  why a named not-applicable specialist is handled rather than refused.

**pl-42 says "at most one small travel lookup" for an edit.** Step 5 sizes it
as one call per unlocated place at the ends of `editTransitions`' pairs plus
one matrix. In practice that is the one matrix, but a candidate whose place
never located makes it more, and saying "one" would make that case an
over-budget refusal of a lookup the edit plainly needed.

**Three choices here were the groomer's, argued in Build.** How each was
settled on 2026-09-13:

- **3, re-running discovery:** put to the owner with the uncached 149 s corridor
  cost attached. The owner chose to re-run it.
- **1, the edits bucket, and 2, `INVALID_ANSWER`:** taken by the filing session
  as defaults that follow existing precedent, and named to the owner beside
  those questions.

As raised:

1. **The edits bucket** (step 9), a new environment variable.
2. **`INVALID_ANSWER` for an out-of-range day or position** (step 2.7).
   `routes/plans.ts` already uses it for malformed bodies, rather than a new
   code in pl-42.
3. **Re-running discovery** when a finds-reading specialist is named
   (step 4.2), rather than re-planning without finds.

**From pl-43's Log, answered on 2026-09-13.** An emptying edit ships, a
restore carries revision _n_'s pins as stored, and an out-of-season move is
allowed and silent. What each answer asks of `api`:

1. **An edit that empties the whole plan.** If it ships (pl-43's
   recommendation), `api` writes it like any other edit. If it is refused with
   `PLAN_INFEASIBLE`, `applyEdit` throws it and step 5 passes it through. If
   it needs a new code, pl-42 adds it and `http-errors.ts` maps it here.
2. **Which pins a restore carries.** `restoreRevision` decides, and `api`
   passes the target either way.
3. **A move onto a day outside the item's season window.** Allowed and silent,
   or refused through `applyEdit`, costs `api` nothing. Named through a new
   `UncheckedConstraintKind`, it reaches the view through `readPlanView`'s
   existing derivation.

**2026-09-17 — built.** Branched from `origin/main` at `20c8fd1` (on the
remote), dispatched as Opus. pl-39 and pl-41 were both `done` on that base, so
the _Traps_ ordering held without a rebase. **Migration 10 was still next
free:** migration 9 is the last on `origin/main`, and `gh pr list --state open`
showed one open pull request, a downloader release.

**What landed.**

- `agent`: `FanOutInput.only` and `FanOutInput.note`, `AskInput.note`, the note
  block in `userPrompt`, and `readsFinds`.
- `api/src/runs/revise.ts`: the checks, the re-plan run, move, remove and
  restore. `api/src/runs/reason.ts`: the caption.
- `orchestrator.ts` now exports `moveTo`, `record`, `persist`, `recordUsage`,
  `isCancellation` and `capacityFor`. It also gains `enqueueRun`, which holds a
  run's cancel, failure and eviction path once for a draft and a re-plan.
  `persist` takes the base it re-checks and the ceiling. `readPlanView` serves
  `revisionDiffs`.
- `db`: migration 10. `toRevision` parses `operation_json`, and `toRun` reads
  `kind`. `insertRevision` and `insertRun` write both. `insertRun` maps the
  `plan_runs_one_live` refusal to `PLAN_BUSY`. New queries: `selectLiveRun` and
  `selectLatestItem`.
- `rate-limit.ts`: `enforceRateLimit`, which the hook now calls.
- `editLimiter`, `RATE_LIMIT_EDITS_PER_MINUTE`, and four `http-errors.ts`
  entries: `REVISION_STALE`, `PLAN_BUSY`, `REVISION_LIMIT_REACHED` and
  `PLAN_INFEASIBLE`, all 409.
- The route in `routes/plans.ts`. `01-ARCHITECTURE.md` gains the table row and
  the widened security line. oxfmt re-padded the whole configuration table,
  because the new variable name is one character wider than the column.

**What the brief had wrong, or did not say.**

- **Step 6's example contradicts its own rule.** The table says
  `with food and lodging`. The rule beside it orders by `SPECIALIST_ORDER`,
  where lodging comes first. I built the rule, so the caption is
  `with lodging and food`, and `reason.test.ts` says why.
- **`REVISION_LIMIT_REACHED → 409` was not in step 2's `http-errors.ts`
  paragraph.** pl-42 assigns that mapping to this ticket, so it landed here.
- **An over-budget or not-applicable gap for a specialist with an item on a
  frozen day does not survive.** `replan` drops a gap its days contradict, and
  the frozen day still places that specialist. The test therefore names
  `budget`, which placed nothing. This is `replan` working as pl-43 built it,
  and it is worth knowing for pl-45's rendering.
- **A pin set during the fan-out cannot prove step 6.1's re-read.** Step 4.4
  reads the plan after the fan-out, so a pin set before then is already in that
  read. My first pin test stayed green with the re-read removed (M9 below). The
  test now pins at both moments, and the grounding case is the one that goes
  red.
- **The orphan close runs before the check transaction, not inside it.**
  `cancelRun` emits a `canceled` frame, and a rolled-back transaction cannot
  un-send one. It is still synchronous, with no `await` before the transaction.
- **`applyEdit` runs inside the write transaction, against the latest revision
  re-read there**, not against the one read before the lookup. Step 5 lists
  `applyEdit` before the write. The pairs measured before the `await` are still
  the pairs it asks about, because only a pin changes a revision in place and a
  pin moves nothing. Without this, a pin set during an edit's lookup would be
  silently dropped from the edit's revision. A `PLAN_INFEASIBLE` thrown there
  rolls the transaction back.
- **`persist` now asserts a base on the first draft too**, `null`. It is
  unreachable in the same way the re-plan's check is.
- **`orchestrator.ts` was already 669 lines on the base**, so "keeps it from
  growing past 600" no longer described it. It is 718 now. The growth is
  `enqueueRun` (the draft's catch and eviction, moved rather than copied) and
  `persist`'s checks.

**Not measured, and said so.**

- **The request-socket abort.** The route aborts the edit's signal on
  `reply.raw` `close` when the reply has not finished. `app.inject` has no socket
  to close, so the wiring itself is untested. What is tested is `revisePlan`
  with an aborted signal, which writes nothing.
- **A `PLAN_INFEASIBLE` from `replan` failing the run with its details
  untouched** goes through the shared catch in `enqueueRun`. It is not in
  _Done when_, and I wrote no test for it.
- The image gate and the e2e suite do not run locally. `api/package.json` is
  unchanged, so the `Dockerfile` is too.

**Fold-in.** Four pieces were free and are on this branch:

- The stale _Open with the owner_ pointer in step 5, replaced with the pl-43 Log
  answer, by the owner's decision on 2026-09-17.
- `tools/planner/.env.example` gains `RATE_LIMIT_EDITS_PER_MINUTE`.
- The rate-limit sentence in `docs/02-DEPLOYMENT.md`, which this change made
  stale.
- Two comments in `api/test/plan-view.test.ts` that said no route appends a
  revision.

I saw nothing else this branch made free.

**Three merged gate records cite lines this branch moves or removes.**
`node scripts/citations-gate.mjs --against origin/main` failed on all three,
and passes now, at 84 enforced and 0 failing.

- **pl-42's record** cited the `toRevision` literal comment this ticket was
  told to delete. It is now pinned to `20c8fd1`, the base, where the line still
  reads as cited. The same record already pins `runs.ts` the same way.
- **pl-49's record** cited two migrations tests that moved down by 17 lines. It
  is repointed to their current lines.
- **dl-57's record** cites a line of `docs/02-DEPLOYMENT.md` below the paragraph
  I edited. I kept that paragraph's line count unchanged rather than editing a
  downloader ticket, since touching a `tools/downloader/` path would put this
  branch in the downloader's changelog.

### Verification

**Cost of a run, measured once.** `npx vitest run tools/planner/api/test/runs.test.ts`
took 2.14 s for 16 tests. `npx vitest run tools/planner/api` took 4.06 s for 399
tests, with 9 of them failing on the stale `user_version` expectations this
ticket then moved. Each change below was run against its own file.

**Narrowest specs, green:**

| File                          | Tests |
| ----------------------------- | ----- |
| `agent/test/fan-out.test.ts`  | 23    |
| `agent/test/prompt.test.ts`   | 19    |
| `api/test/migrations.test.ts` | 14    |
| `api/test/schema.test.ts`     | 13    |
| `api/test/plan-view.test.ts`  | 13    |
| `api/test/revisions.test.ts`  | 32    |
| `api/test/reason.test.ts`     | 8     |
| `api/test/config.test.ts`     | 28    |

**Twenty mutations**, each applied alone by a scratch script that runs that
file, restores the source from a backup and compares it byte for byte. All
restores compared identical. Each count is failed of total:

| Mutation                                                        | File       | Failed  |
| --------------------------------------------------------------- | ---------- | ------- |
| M1 `only` ignored                                               | fan-out    | 5 of 23 |
| M2 the note not rendered                                        | fan-out    | 1 of 23 |
| M3 the busy check removed from the checks                       | revisions  | 2 of 31 |
| M4 the orphan sweep removed                                     | revisions  | 1 of 31 |
| M5 a same-day `toPosition` not adjusted                         | revisions  | 1 of 31 |
| M6 the stale check removed                                      | revisions  | 1 of 31 |
| M7 the pool read back after inserting                           | revisions  | 1 of 32 |
| M8 the whole pool measured                                      | revisions  | 2 of 31 |
| M9 the pre-compose re-read removed                              | revisions  | 1 of 32 |
| M10 the zero-specialist roster frame not recorded               | revisions  | 2 of 31 |
| M11 discovery run regardless of `readsFinds`                    | revisions  | 1 of 31 |
| M12 `diffs: []`                                                 | revisions  | 1 of 31 |
| M13 `PLAN_INFEASIBLE` unmapped                                  | revisions  | 1 of 31 |
| M14 a re-plan spends the edits bucket                           | revisions  | 2 of 31 |
| M15 the operation left to the DEFAULT                           | migrations | 1 of 14 |
| M16 `kind` read as a literal                                    | migrations | 1 of 14 |
| M17 the one-live refusal not mapped                             | migrations | 1 of 14 |
| M18 the edit's re-check and `persist`'s base check both removed | revisions  | 1 of 31 |
| M19 the caption ignores `SPECIALIST_ORDER`                      | reason     | 1 of 8  |
| M20 the base's gaps not carried                                 | revisions  | 1 of 31 |

- **M7 and M9 stayed green on their first run**, at 31 of 31. M7's test
  compared the pool against a slice of itself, and it passed whenever the new
  run's UUID sorted after the draft's. It now asserts fan-out order, which id
  order cannot produce, because `food` sorts before `lodging`. M9 is the pin
  finding above. After both repairs, M7 and M9 each failed 1 of 32, and the
  unmutated file passed 32 of 32.
- **M3 fails 2, not 3.** With the check gone, two re-plans issued together are
  still one 202 and one `PLAN_BUSY`, because `plan_runs_one_live` refuses the
  second insert. That is the backstop doing its job. The two tests that go red
  are a restore and a remove against a live run, which insert no run.
- **M18 removes two checks** because either one alone still refuses the second
  concurrent move: the edit's own re-check, and `persist`'s base assertion.

**Gates, at the end.** `npm run check` exited 0. `npm test -- --project planner`
passed at 69 files and 1,144 tests.
