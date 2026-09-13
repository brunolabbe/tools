---
id: pl-43
tool: planner
title: A re-plan re-packs only its named days, an edit never packs, and a diff is derived by candidate
kind: work-package
status: ready
milestone: P4
depends_on: [pl-42]
difficulty: hard
---

# pl-43 — Re-pack the named days, apply an edit, diff two revisions

**Packages:** `itinerary` only, plus one doc comment in `contract` that
[pl-42](./pl-42-the-revision-contract.md) assigns here (the definition of
`moved` on `RevisionDiff`). No model, no network, no clock:
`itinerary/test/purity.test.ts` scans every file under `src` recursively, so a
new `diff.ts` or `revise.ts` is covered with no change to the scan.
[pl-44](./pl-44-the-replan-run-and-edits.md) calls everything below;
[pl-45](./pl-45-revise-and-read-the-diff.md) only reads `RevisionDiff` through
the contract.

## Why

**§6 has two mechanisms, and the composer implements half of one.** `compose`
takes a `previous` revision and keeps its pins, so pinning works. But it
re-packs **every** day. A slice ("a revision names the days it may touch") is not
expressible, and nothing in the package can produce a revision without packing.
The same goes for a diff. `01-ARCHITECTURE.md`'s package table has listed
`diff` under `itinerary` since the start, and no diff has ever existed.

pl-42 fixes the vocabulary: `RevisionOperation`, `RevisionDiff`,
`PlanRevision.operation`. The owner's decisions of 2026-09-13 fix the behaviour.
This ticket is the arithmetic between the two, and it is arithmetic in the
sense §2 means: exact, deterministic and unit-tested. It has to be `itinerary`
for the reason travel time was (pl-27): the package that decides which days an
item may land on cannot also be the package that fetches anything.

### Decided by the owner, 2026-09-13 — not reopened here

- **v1 operations:** re-plan named days, with optional specialists and an
  optional note; move one item; remove one item; restore revision _n_ as a new
  revision. Brief edits are deferred.
- **No specialists named** means the named days are re-packed from the plan's
  existing candidate pool, with no model call. **Named specialists run again**,
  and their new candidates join the pool. That fan-out is pl-44's; composing
  over the resulting pool is this ticket's.
- **Re-plans always build on the latest revision.** History is linear.
- **Adopted in pl-42:**
  - The diff is derived and never stored.
  - Days outside a re-plan's slice are **frozen**, every item on them included.
  - The diff function lives here, and `api` serves it in `PlanView.diffs`.
  - A `move` that breaks a day is refused here, with the existing
    `PLAN_INFEASIBLE`.

## Build

**Read these three before writing code**, because each one produces a
plausible-looking wrong plan and no test fails:

- A candidate already on a frozen day must never enter the pool.
- The critic must never name a frozen item as the thing to drop.
- The critic does not count transitions today, although the packer charges
  them.

All three are argued in _Traps_.

### 0. Capture the byte-identity baseline first, before touching `src`

`compose` must keep producing exactly the first drafts it produces today. The
proof is a checked-in baseline, and it is only a proof if it is written by the
unmodified package.

On the branch base, with pl-42 merged, write
`itinerary/test/fixtures/first-draft-baseline.json`. It holds the full
`ComposeResult` (revision, `unchecked`, `findings`, `excluded`) for:

- each of the six `TRIP_SHAPES` fixtures under `NOTHING_MEASURED`;
- each of them under `measuredEverywhere(travelled())`;
- the one-constraint case `pack.test.ts` already uses to show a 45-minute
  transition turning three activities into two, composed through `compose`.
  **This case is what guards step 2.** The six sets never put two chargeable
  items on one day (`compose.test.ts` asserts that), so without it the critic
  change below cannot show up in the baseline at all.

**Commit the baseline alone, before the refactor commit**, and name both commits
in the Log. `**/test/fixtures/` is ignored by oxfmt, so the JSON stays as
written. Do not use `toMatchFileSnapshot`: it writes on a first run, so a
builder who runs it after refactoring baselines the refactor. **Make the
comparison fail once on purpose** before trusting it: change one limit in
`limits.ts`, watch it go red, then revert.

### 1. One id scheme, used by every revision this package produces

`toPlanDays` in `compose.ts` derives `<revision>-day-<n>` and
`<revision>-item-<candidateId>`. `plan_days.id` and `plan_items.id` are global
primary keys, so **every** new revision needs fresh ids: a re-plan, an edit,
and a restore that copies days verbatim. A restore that kept revision _n_'s ids
would collide on insert.

Lift the id derivation into one internal helper that re-keys a `PlanDay[]` for a
revision id and changes nothing else. `compose`, `replan`, `applyEdit` and
`restoreRevision` all go through it. `api` must not learn the scheme.

### 2. The critic: fixed points, and transitions

Two changes to `critique`, both defaulting to today's behaviour.

- **`CritiqueInput.fixed?: ReadonlySet<string>`** lists candidate ids the critic
  may never name as `dropCandidateId`, in addition to pinned items, which
  `heaviestOn` and the `over-budget` search already skip. A re-plan passes every
  frozen id. An edit passes every id, since an edit drops nothing.
- **Count each item's `travelFromPrevious` exactly as `charge` in `pack.ts`
  does.** The minutes go to a drive's drive budget where the shape has one, to
  the activity budget otherwise, and nowhere for an anchor. Today the critic
  sums `durationMinutes` alone. That was harmless while only a pin could
  over-fill a day, because `fits` had already charged transitions for
  everything else. It stops being harmless here, for two reasons:
  - **An edit never goes through `fits`**, so the critic is the only check an
    edit gets.
  - **A re-plan re-measures transitions between pins** that were not adjacent
    before (_Traps_).

  Use `transitionMinutes` from `travel.ts`. A second reading of "which
  transitions cost minutes" is how the packer and the critic would start to
  disagree.

A first draft has no pins and no fixed ids, and every day it packs already
satisfies `fits` with transitions included. So neither change can add a finding
to one, and step 0's baseline proves that rather than trusting this sentence.

### 3. `replan` — re-pack only the named days

**A separate function, not a `slice` on `ComposeInput`.** Three reasons:

- **An optional `slice` makes invalid inputs typeable.** A slice with no
  `previous` would be one, and so would a `previous` with no slice that still
  has to stamp a `replan` operation.
- **pl-42's refine makes `compose({ previous })` unshippable.** `first-draft`
  is valid if and only if `revision === 1`, and `compose` has no operation to
  stamp but `first-draft`. So a re-pack through `compose` yields a revision 2
  that `planRevisionSchema` rejects.
- **Nothing outside tests passes `previous`.** pl-42's Log checked
  `api/src/runs/orchestrator.ts`, and it never does.

So **`ComposeInput.previous` is removed**. `compose` becomes exactly the first
draft. The existing re-planning tests move to `replan` with every day named,
including pl-23's pinned out-of-season currency case, which keeps its
assertions.

```ts
export interface ReplanInput {
  brief: TripBrief;
  /** The plan's whole pool: every stored candidate, plus this run's new ones, in a stable order. */
  candidates: readonly Candidate[];
  /** The latest revision. Its day count and dates are the span; the brief's are not re-derived. */
  previous: PlanRevision;
  /** Stamped onto the revision as given. `days` is the slice; `specialists` and `note` are never read. */
  operation: Extract<RevisionOperation, { kind: "replan" }>;
  /** Must answer ordered pairs among `replanPool(...)`. Nothing else is ever asked of it. */
  travel: TravelTable;
  /** What the run knows about specialists this time. See "Gaps" below. */
  gaps?: readonly PlanGap[];
  /** Defaults to `previous.coverage` and `previous.reading`: evidence persists until something re-asks. */
  coverage?: readonly UncheckedConstraint[];
  reading?: readonly Source[];
  revision: { id: string; reason: string; createdAt: string };
  now: Date;
  maxCriticRounds?: number;
}

export function replan(input: ReplanInput): ComposeResult;

/** Every candidate that may appear on a named day: the pool minus everything on a frozen day. */
export function replanPool(input: {
  candidates: readonly Candidate[];
  previous: PlanRevision;
  days: readonly number[];
}): Candidate[];
```

**What it does, in order**, sharing `compose`'s internals rather than copying
them:

1. **The `BRIEF_INCOMPLETE` guards, unchanged.**
2. **Frozen days.** Every day whose index is not in `operation.days` is emitted
   exactly as `previous` holds it, with ids re-keyed only: same items, order,
   `pinned`, `note` and `startsAt`, and **the stored `travelFromPrevious`**. It
   is evidence, and nothing on a frozen day was re-packed, so nothing
   re-measures it. `travel.between` is never called for a pair on a frozen day.
3. **The pool** is `replanPool`. A candidate on a frozen day is not in it, so it
   cannot be placed a second time. Pinned items on named days go to the packer
   as `pinned` placements, exactly as today. They keep their day and their
   order among pins, and they lead the day (pl-9). Unpinned items on named days
   are released into the pool beside everything never placed. **`api` uses the
   same function** to decide which candidates' places to measure, so the
   measured table and the packed days agree by construction.
4. **Season filter over the pool**, with pins outranking it as today.
5. **`pack`, restricted to the named days.** Add
   `PackInput.frozen?: ReadonlyMap<number, readonly PackedItem[]>`. A frozen
   day is emitted as given and offered to no candidate. Pins are honoured only
   on non-frozen days. The span is built from `previous.days` (count and
   dates), so a named day keeps its date annotation and `inSeasonOnDay` reads
   the right one. A plan whose `tripSpan` would now compute differently does
   not reshape itself behind a re-plan.
6. **Critic rounds**, with `fixed` set to every frozen candidate id. The rounds
   feed back what they drop, as today.
   - **Per-day findings on a frozen day are discarded, soft and hard alike.**
     This revision did not judge that day and may not change it. A hard finding
     there could only ever produce `PLAN_INFEASIBLE` for an operation that was
     never allowed to fix it (_Traps_, "limits move").
   - **Plan-wide findings stand.** `over-budget` is about the whole trip, and
     its drop candidate is already restricted by `fixed`.
7. **`PLAN_INFEASIBLE`** when a hard finding survives the rounds, on a named day
   or plan-wide. Details carry the findings, exactly as `compose`'s do.
8. **The revision**, with its parts:
   - `operation` as given;
   - `excluded` covering the pool only, since a frozen candidate was never a
     contender;
   - `unchecked` from `uncheckedFor` over the whole days, since the list is a
     derivation, and `interDayTransitions` still names every overnight hop,
     including the ones into and out of the slice;
   - `coverage` and `reading` as given, or `previous`'s.

**When nothing fits, follow pl-9's rule and nothing new.** A named day that ends
up empty ships with an `empty-day` finding. A specialist with nothing placed
anywhere in the revision gets `no-candidates-found` from `gapsFor`, reading the
whole days. `nothing-placed` means the whole revision is empty, frozen days
included, and is `PLAN_INFEASIBLE` as it is for a first draft. A re-plan of a
plan with anything on a frozen day therefore never hits it.

**Gaps.** `gapsFor` runs over the whole revision. The fan-out itself emits
`no-candidates-found` for a specialist that returned nothing
(`runFanOut` in `agent/src/orchestrator.ts`), so incoming gaps cannot simply be
stripped of that reason. Two rules instead:

- **An incoming gap of any reason is dropped for a specialist that has an item
  placed in the result.** The days contradict it: a re-run that found nothing
  new does not un-place yesterday's lodging.
- **At most one gap per specialist, incoming before derived.** `planRevisionSchema`
  bounds `gaps` at `SPECIALISTS.length`, and a carried-forward gap plus a
  re-derived one is exactly how it would overflow.

Which of `previous.gaps` to carry forward (a `specialist-failed` for a
specialist not re-run, say) is the caller's decision, and is pl-44's.

**Preconditions are `api`'s checks, not user-facing refusals from here.** pl-42
assigns "within this plan's day count" to `api`. If a caller still hands
`replan` any of the following, it throws `AppError("INTERNAL")` naming the
precondition in `details`:

- a day index `previous` does not have;
- a candidate on `previous` that is missing from `candidates`;
- a `previous` that holds one candidate twice.

`INVALID_ANSWER` and `ITEM_NOT_FOUND` are copy about a user's request, and
reaching this far means `api` did not check. The one user-facing code this
package raises is `PLAN_INFEASIBLE`.

### 4. `applyEdit` and `editTransitions` — a new revision without packing

```ts
export type EditOperation = Extract<RevisionOperation, { kind: "move" } | { kind: "remove" }>;

/** A transition this edit creates, which the caller must measure before `applyEdit`. */
export interface TransitionPair {
  dayIndex: number;
  fromCandidateId: string;
  toCandidateId: string;
}

export function editTransitions(previous: PlanRevision, operation: EditOperation): TransitionPair[];

export interface EditInput {
  brief: TripBrief;
  candidates: readonly Candidate[];
  previous: PlanRevision;
  operation: EditOperation;
  /** Asked about exactly the pairs `editTransitions` returned, and nothing else. */
  travel: TravelTable;
  revision: { id: string; reason: string; createdAt: string };
}

export interface EditResult {
  revision: NewRevision;
  unchecked: UncheckedConstraint[];
  findings: CriticFinding[];
}

export function applyEdit(input: EditInput): EditResult;
```

**The operation, applied.** `remove` takes the candidate off `fromDayIndex`.
`move` takes it off `fromDayIndex` and inserts it into `toDayIndex` at
`toPosition`, and it may be the same day.

`toPosition` is **the index in the destination day's list after the item has
left its source**, so `0..length` of that list inclusive. pl-42 states this on
the contract, added at filing after this brief raised it, so this ticket
applies the definition and does not restate it.
Positions are then re-derived densely on both touched days.

- **A pinned item may be moved or removed, and a moved pin stays pinned.** A pin
  constrains what a _re-plan_ may touch (§6), not what the user may do by hand.
- No `now` and no season or booking check. The item is already on the plan,
  and a user's own placement outranks a season window for the reason a pin
  does (pl-9, pl-23). The Log records that this ships silently, as a pinned
  out-of-season item already does.

**Which transitions change** is one rule, not a case analysis. An item's
`travelFromPrevious` is re-derived if and only if **its predecessor on its day
differs from its predecessor in `previous`**, or it changed day. The first item
of a day becomes `null` with no lookup. Every other item keeps its stored value
untouched. As a consequence:

- a `remove` returns at most **one** pair (old predecessor → old successor);
- a `move` returns at most **three** (the source's closed gap, new predecessor →
  item, item → new successor).

The anchor is not special. Its arrival is recorded (pl-27), so a pair into an
anchor is returned like any other.

**`editTransitions` and `applyEdit` share one internal "apply the operation to
the days" function**, and `editTransitions` is its list of changed pairs. That
is what makes "the lookup pl-44 does" and "the lookups this function uses" one
list rather than two careful implementations.

**Refusal.** Run `critique` over the result with `fixed` set to every placed
id. **If any day the edit touched carries a hard per-day finding**
(`day-over-drive`, `day-over-effort`, `day-over-items`), throw
`PLAN_INFEASIBLE` with the findings in `details`, as `compose` does.

- **Both touched days are checked, not only the destination.** A `remove` can
  over-fill its own day: a ferry or a one-way road can make A → C longer than
  A → B → C, so the transition it creates can exceed the two it replaces.
- Moving onto a day that already holds `MAX_ITEMS_PER_DAY` is `day-over-items`.
  Plan-wide findings cannot be caused by an edit: a move leaves the total
  alone, and a remove lowers it. So they are not grounds for refusal (see the
  open decision in the Log about emptying a plan).

`findings` returns the soft findings for the touched days.

**Everything else is carried untouched:** `gaps`, `coverage` and `reading` from
`previous`, `startsAt`, `note`. `gapsFor` does not run. A specialist whose last
item the user removed has not "found nothing that fitted", and that sentence
would be false. Preconditions (a candidate not on `fromDayIndex`, a day or
position out of range) are `INTERNAL`, as in step 3. pl-42 makes `api` check
that `fromDayIndex` agrees with the base revision.

### 5. `restoreRevision` — yes, a function

Copying days sounds like a caller's one-liner, and it is not one, because of
step 1's ids.

```ts
export function restoreRevision(
  target: PlanRevision,
  revision: { id: string; reason: string; createdAt: string },
): NewRevision;
```

It copies `target.days` with ids re-keyed and every other field untouched,
**`travelFromPrevious` included**. pl-42 says so, and the evidence is still what
those days were packed against. `gaps`, `coverage` and `reading` are copied too.
It stamps `operation: { kind: "restore", revision: target.revision }`. No
critic, no `now` and no travel: the target shipped once. **Pins are copied as
revision _n_ holds them**, which pl-22 froze when _n_ was superseded; see the
open decision in the Log. "Earlier than the revision it produces" is `api`'s
check.

### 6. `diffRevisions` — and what `moved` means

```ts
export function diffRevisions(parent: PlanRevision, child: PlanRevision): RevisionDiff;
/** One per revision after the first, oldest first, each against its parent by `parentRevisionId`. */
export function revisionDiffs(revisions: readonly PlanRevision[]): RevisionDiff[];
```

`revisionDiffs` is what `api` calls for `PlanView.diffs`. It pairs by
`parentRevisionId`, not by array adjacency, so `api` cannot mis-pair two
revisions. `diffRevisions` throws `INTERNAL` when
`child.parentRevisionId !== parent.id`: a diff captioned with the wrong pair is
a claim about two revisions that were never parent and child. A missing parent
in `revisionDiffs` is also `INTERNAL`.

**By `candidateId`.** A candidate in the child and not the parent is `added`,
and one in the parent and not the child is `removed`. A candidate in both is
`moved` or absent under the rule below. Positions in `from`/`to` are the raw
positions in each revision.

**The rule: a position is not a placement, and relative order is.**

1. **A candidate whose `dayIndex` differs is `moved`.**
2. **Otherwise, a same-day move is a change of relative order among the items
   that stayed.** For each day _d_, the **stayers** are the candidates on day
   _d_ in both revisions. Order them by parent position. A **kept set** is a
   largest subset whose child order agrees with its parent order: a longest
   increasing subsequence of child positions, read in parent order. Every
   stayer outside the kept set is `moved`. An item added, removed or moved to
   another day is not a stayer, so **it cannot make a neighbour look moved**:
   removing B from `[A, B, C]` leaves A before C, so there is nothing to report.
3. **Ties between largest kept sets break in this order**, and they are real.
   An adjacent swap `[A, B, C] → [B, A, C]` has two largest kept sets, `{A, C}`
   and `{B, C}`, and "A moved down one" is the same pair of revisions as "B
   moved up one".
   1. **When `child.operation` is a `move`, prefer a kept set without its
      `candidateId`.** The edit names what moved, so the diff agrees with the
      caption. The operation is a stored field of the child, so this is still
      derived from the two revisions (pl-42 put it there for exactly this kind
      of question).
   2. **Then prefer the set keeping more items pinned in the child.** A
      re-pack leads a day with its pins, and a diff calling the pin "moved"
      would read as the pin having been overruled.
   3. **Then the lexicographically smallest list of parent positions.** Keep
      what came first.

**Entry order is deterministic.** Sort by `(dayIndex, position)`: `to` for
`added` and `moved`, `from` for `removed`. Ties go `removed`, `moved`, `added`,
then `candidateId` by code unit (`<`), never `localeCompare`, whose answer
depends on the ICU build.

**Cost.** `PlanView` derives every diff on every read, so the work is up to
`MAX_REVISIONS_PER_PLAN` × `MAX_PLAN_DAYS` days, with at most
`MAX_ITEMS_PER_DAY` stayers each. **An O(n²) dynamic programme per day is
right, and enumerating subsets is not**: 2¹² per day across 60 days and every
revision is a read that visibly stalls.

**The test table** is `itinerary/test/diff.test.ts`, one row per line:

| #   | Parent (day: items)  | Child                   | `child.operation` | Entries                                                       |
| --- | -------------------- | ----------------------- | ----------------- | ------------------------------------------------------------- |
| 1   | `0:[A,B,C]`          | `0:[A,B,C]` (re-keyed)  | restore           | none                                                          |
| 2   | `0:[A,B,C]`          | `0:[A,C]`               | remove B          | removed B — **C is not moved**                                |
| 3   | `0:[A,C]`            | `0:[A,B,C]`             | replan [0]        | added B — **C is not moved**                                  |
| 4   | `0:[A,B] 1:[C]`      | `0:[B] 1:[C,A]`         | move A → 1@1      | moved A (0,0)→(1,1) — **B not**                               |
| 5   | `0:[A,B,C]`          | `0:[B,A,C]`             | move A → 0@1      | moved A only                                                  |
| 6   | `0:[A,B,C]`          | `0:[B,A,C]`             | replan [0]        | moved B only (rule 3.3)                                       |
| 7   | `0:[A,B,C,D]`        | `0:[B,C,D,A]`           | move A → 0@3      | moved A only                                                  |
| 8   | `0:[D,P]` (P pinned) | `0:[P,D]`               | replan [0]        | moved D only (rule 3.2)                                       |
| 9   | `0:[A,B,C,D]`        | `0:[C,A,D]`             | replan [0]        | removed B, moved C                                            |
| 10  | `0:[A] 1:[B]`        | `0:[] 1:[A,B]`          | move A → 1@0      | moved A (0,0)→(1,0) — B not moved                             |
| 11  | `0:[A,B] 1:[C,D]`    | `0:[B,D] 1:[E,C]`       | replan [0,1]      | sorted by day, position, kind, id; identical across two calls |
| 12  | `0:[A,B]`            | revision from elsewhere | —                 | `INTERNAL`                                                    |

## Traps

- **A candidate on a frozen day is placed a second time.** This is the
  obvious implementation: pass `PlanDetail.candidates` to the packer, frozen
  days alongside. The packer knows nothing about frozen ids, so the frozen
  lodging on day 0 lands on named day 3 as well. pl-42 adds a refine refusing a
  candidate placed twice, but **the API never validates a stored revision
  against the schema** (pl-42's gate record). So nothing refuses the duplicate
  at runtime: the refine catches it in a test, not in production.
  **`replanPool` is the fix, and a test proves it**: a candidate on frozen day 0 that would fit empty
  named day 2 is not on day 2 and is not in `excluded`.
- **The critic drops a frozen item.** `over-budget` picks "the most expensive
  unpinned line, wherever it is", and that is usually a lodging, very likely on
  a frozen day. A re-plan that quietly deleted Tuesday's hotel to re-pack
  Thursday has broken the one promise a slice makes. `fixed` is the fix, and a
  test proves the frozen day is byte-identical (ids aside) when the dearest
  item overall sits on it.
- **The critic cannot see transitions, and a re-plan re-measures them.** A
  named day holding `[P1 (pinned), U, P2 (pinned)]` releases U, so P1 and P2
  become adjacent. Their new transition comes from the new table. Under today's
  critic, a 60-minute P1 → P2 hop on a moderate day of 150 + 150 minutes ships
  at 360 of 300. Under step 2 it is `PLAN_INFEASIBLE` naming the day, since
  nothing on it is droppable. That is the right answer: the user unpins
  something. **This is the test that proves step 2.**
- **Day capacity on a named day that holds pins.** The packer charges pins
  first (with their transitions), and the pool competes for what is left.
  Because only named days are eligible, a pool candidate that no named day
  holds is `no-day-had-room`, even with room on a frozen day. A test puts a
  240-minute pin on a moderate named day and shows a 120-minute pool candidate
  excluded rather than placed elsewhere.
- **Pool order is placement order.** The packer walks candidates in input order
  within a bucket, and with one named day that order decides what gets on it.
  `api` must pass `PlanDetail.candidates` in stored order with new ones
  appended, or two re-plans of one plan disagree for no reason a reader can
  see. Say so on `ReplanInput.candidates`.
- **`now` has moved since the first draft.** A released item whose booking lead
  time has since passed does not come back. It is `booking-deadline-passed` in
  `excluded`, and its specialist may gain `no-candidates-found`. That is
  correct, and it is the one way re-planning a day can lose something without
  any new candidate competing for the room. A test says so, so nobody "fixes"
  it.
- **Limits move under a frozen day.** `limits.ts` is content and gets edited. A
  frozen day that met yesterday's numbers can fail today's, and step 3.6
  discards per-day findings there for that reason. The same edge reaches an
  edit: a touched day that already violated the new numbers refuses an edit
  that did not cause it. That is rare and honest, and the Log notes it rather
  than special-casing it.
- **The note and the specialists never reach the composer.** Roadmap Phase 4:
  a note "is never an instruction to the composer". A test composes one
  re-plan twice, with `note: null` and with a note, and with different
  `specialists`, and asserts identical days. `replan` reads `operation.days`
  and nothing else of it.
- **A re-plan can change nothing.** Same pool, same table, no new candidates:
  the named days can come back identical, and the diff is empty. That is a true
  diff, not a bug, and pl-45 has to render it.
- **Measured-travel objects on frozen days are copies.** pl-24's finding:
  `Object.freeze` is shallow, and returning a stored object lets a caller that
  adjusts it corrupt `previous`. A test deep-clones `previous`, runs `replan`,
  `applyEdit` and `restoreRevision`, and asserts `previous` is unchanged.

## Done when

- **`compose`'s first drafts are byte-identical**: step 0's baseline, committed
  before the refactor, matches for six shapes × two tables plus the transition
  case. The Log names the baseline commit and the mutation that made the
  comparison fail first.
- `ComposeInput.previous` is gone. The existing re-planning and pl-23 tests pass
  through `replan` with every day named, with their assertions unchanged.
- Naming **every** day of a pin-free plan in `replan` packs the same days (ids
  aside) as `compose` over the same pool, table and `now`, which proves the
  slice machinery is additive.
- **`replan`** has tests proving each of:
  - frozen days are identical to `previous` apart from ids, stored
    `travelFromPrevious` included;
  - a spy `TravelTable` is only ever asked about pairs within `replanPool`;
  - a candidate on a frozen day is never placed again;
  - the critic never drops a frozen or pinned item;
  - a pin on a named day keeps its day and leads it;
  - capacity on a named day counts its pins;
  - adjacent pins over capacity are `PLAN_INFEASIBLE`;
  - an empty named day ships with `empty-day`;
  - a booking deadline passed since the draft excludes a released item;
  - gaps are at most one per specialist, and one contradicted by the days is
    dropped;
  - `note` and `specialists` change nothing.
- **`applyEdit`** has tests proving each of:
  - move across days, and within a day;
  - a moved pin stays pinned;
  - a move onto a full day and onto an over-effort day are `PLAN_INFEASIBLE`;
  - a remove creating a transition that over-fills its own day is
    `PLAN_INFEASIBLE`;
  - unchanged transitions keep their stored value;
  - `gaps`, `coverage` and `reading` are carried untouched.
- **`editTransitions`** returns at most one pair for a remove and at most three
  for a move. A spy table proves `applyEdit` calls `between` for exactly those
  pairs, no more and no fewer.
- **`restoreRevision`** copies days, pins and `travelFromPrevious`, re-keys every
  id so no id collides with the target's, and stamps the `restore` operation.
- **`diffRevisions`** passes the twelve-row table in step 6. **`revisionDiffs`**
  pairs by `parentRevisionId` and returns one diff per revision after the first,
  oldest first.
- The `moved` rule is written on `RevisionDiff`'s doc comment in
  `contract/src/plan.ts`. That doc comment is the only `contract` change.
- The package index exports `replan`, `replanPool`, `applyEdit`,
  `editTransitions`, `restoreRevision`, `diffRevisions`, `revisionDiffs` and
  their types, and its header's usage block shows the re-plan path beside
  `compose`.
- `itinerary/test/purity.test.ts` passes unchanged. `npm run check` and
  `npm test -- --project planner` pass.

## Log

**2026-09-13 — filed**, in the pl-42 grooming batch, beside pl-44 and pl-45.
Facts checked against the worktree at `323eaa7` with pl-42 uncommitted:

- `critique` sums `durationMinutes` alone and never reads `travelFromPrevious`.
  `pack`'s `charge` adds `transitionMinutes`. So step 2 is a change to the
  critic, not a restatement.
- `over-budget`'s drop candidate is "the most expensive unpinned line, wherever
  it is", which can name any unpinned item on any day.
- `runFanOut` pushes `no-candidates-found` for a specialist whose accepted
  candidates are empty. `gapsFor` pushes the same reason for a specialist whose
  candidates were all unplaced. The two differ only in `detail`, which is why
  step 3's gap rules key on what the days contradict and not on the reason.
- `planRevisionSchema` has two refines, parent and dense day indexes, and no
  uniqueness check on `candidateId`.
- `api/src/runs/travel.ts`'s `tableFor` answers `not-established` for a
  candidate it holds no ends for. So a table built over `replanPool` answers a
  stray pair honestly rather than throwing.
- The only `compose` call in `api` passes no `previous`.
- No core or planner code means "a caller broke a precondition" except
  `INTERNAL`. `api/src/routes/plans.ts` refuses malformed bodies with
  `INVALID_ANSWER` and re-worded copy, which is not this ticket's to change.

**Against pl-42, for whoever builds it or answers these:**

- **`toPosition` has no stated meaning.** Before or after the item leaves its
  source changes every same-day move by one. This brief assumes _after_
  (step 4). pl-44 validates the range and pl-45 computes it, so the sentence
  belongs on the contract whichever ticket writes it.
- **pl-42's "`contract` only" cannot compile alone.** `compose` returns
  `NewRevision`, which gains a required `operation`. So `itinerary/src/compose.ts`
  needs `operation: { kind: "first-draft" }` in pl-42's own commit, the same
  mechanical move as `toRevision`'s literal.

**Both points above were taken into pl-42 at filing, the same day.** pl-42's
Packages line now names the `first-draft` stamp in `compose.ts`, and its step 3
defines `toPosition`. pl-42 also gained a refine refusing a candidate placed
twice in one revision. The filing session verified independently that
`critic.ts` never reads `travelFromPrevious`, which is what step 2 rests on.

**Answered on 2026-09-13; the Build above already assumes each answer.**

- **1 and 3** were put to the owner, who took the recommendation both times: an
  edit that empties the plan ships, and a move onto an out-of-season day is
  allowed and silent.
- **2** was taken by the filing session as the recommended default and named to
  the owner beside those questions: a restore carries revision _n_'s pins as
  stored.

The options as they were posed are kept below:

1. **An edit that empties the whole plan.** Removing the last item leaves a
   revision the composer would refuse as `nothing-placed`.
   - _(a, recommended)_ Ship it. The user did it, restore undoes it, and
     `PLAN_INFEASIBLE`'s copy, "cannot be planned as described", would be false
     about a deletion.
   - _(b)_ Refuse with `PLAN_INFEASIBLE` anyway.
   - _(c)_ Refuse with a new code, which pl-42's taxonomy would need.
2. **Which pins a restore carries.**
   - _(a, recommended)_ Revision _n_'s, as stored. A restore is a copy, and a
     latest pin may name a candidate _n_ never placed.
   - _(b)_ The latest revision's pins, applied to every candidate present in
     both.
3. **A move onto a day outside the item's season window.**
   - _(a, recommended)_ Allowed and silent, like a pinned out-of-season item
     today (pl-23).
   - _(b)_ Refused with `PLAN_INFEASIBLE`.
   - _(c)_ Allowed and named, which needs a new `UncheckedConstraintKind` in the
     contract and a ticket of its own.
