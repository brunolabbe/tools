---
id: pl-43
tool: planner
title: A re-plan re-packs only its named days, an edit never packs, and a diff is derived by candidate
kind: work-package
status: done
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

## Review

**Gate: PASS** — 2026-09-14 · `origin/main...1a9ffff` · defect hunt run directly by the reviewer (ticket-reviewer, sonnet; the builder ran opus), to code-review's medium depth, plus 7 independent mutation reproductions

| Done when                                                                                                                                                             | Proof                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose`'s first drafts are byte-identical: baseline commit, six shapes x two tables plus the transition case                                                        | `itinerary/test/first-draft-baseline.test.ts:59 "test.each(Object.keys(RESULTS))"` (proven)                                                                                                                      |
| `ComposeInput.previous` is gone; existing re-planning and pl-23 tests pass through `replan` with unchanged assertions                                                 | `itinerary/test/compose.test.ts:34 "function everyDay(previous: PlanRevision)"`, `itinerary/test/compose.test.ts:683 "toContain(winterOnly.id)"` (proven)                                                        |
| Naming every day of a pin-free plan in `replan` packs the same days as `compose` over the same pool, table and `now`                                                  | `itinerary/test/replan.test.ts:108 "withoutIds(again.revision.days)"` (proven)                                                                                                                                   |
| `replan`: frozen days identical apart from ids, stored `travelFromPrevious` included                                                                                  | `itinerary/test/replan.test.ts:117 "come back as previous holds them"` (proven)                                                                                                                                  |
| `replan`: a spy `TravelTable` is only ever asked about pairs within `replanPool`                                                                                      | `itinerary/test/replan.test.ts:187 "keeps pins and released items on named days"` (proven)                                                                                                                       |
| `replan`: a candidate on a frozen day is never placed again                                                                                                           | `itinerary/test/replan.test.ts:175 "candidate on a frozen day that would fit"` (proven)                                                                                                                          |
| `replan`: the critic never drops a frozen or pinned item                                                                                                              | `itinerary/test/replan.test.ts:217 "never drops a frozen or a pinned item"` (proven)                                                                                                                             |
| `replan`: a pin on a named day keeps its day and leads it                                                                                                             | `itinerary/test/replan.test.ts:271 "keep their day and lead it"` (proven)                                                                                                                                        |
| `replan`: capacity on a named day counts its pins                                                                                                                     | `itinerary/test/replan.test.ts:287 "count against the day"` (proven)                                                                                                                                             |
| `replan`: adjacent pins over capacity are `PLAN_INFEASIBLE`                                                                                                           | `itinerary/test/replan.test.ts:239 "adjacent pins whose new transition"` (proven)                                                                                                                                |
| `replan`: an empty named day ships with `empty-day`                                                                                                                   | `itinerary/test/replan.test.ts:303 "an empty named day ships with empty-day"` (proven)                                                                                                                           |
| `replan`: a booking deadline passed since the draft excludes a released item                                                                                          | `itinerary/test/replan.test.ts:312 "a booking deadline that passed since the draft"` (proven)                                                                                                                    |
| `replan`: gaps are at most one per specialist, one contradicted by the days is dropped                                                                                | `itinerary/test/replan.test.ts:335 "at most one per specialist, incoming before derived"` (proven)                                                                                                               |
| `replan`: `note` and `specialists` change nothing                                                                                                                     | `itinerary/test/replan.test.ts:369 "note and specialists change nothing"` (proven)                                                                                                                               |
| `applyEdit`: move across days, and within a day                                                                                                                       | `itinerary/test/edit.test.ts:61 "a move across days lands at the position"` (proven)                                                                                                                             |
| `applyEdit`: a moved pin stays pinned                                                                                                                                 | `itinerary/test/edit.test.ts:114 "a moved pin stays pinned"` (proven)                                                                                                                                            |
| `applyEdit`: a move onto a full day and an over-effort day are `PLAN_INFEASIBLE`                                                                                      | `itinerary/test/edit.test.ts:168 "a move onto a day that already holds MAX_ITEMS_PER_DAY"`, `itinerary/test/edit.test.ts:194 "a move onto a day with too little effort left"` (proven)                           |
| `applyEdit`: a remove creating a transition that over-fills its own day is `PLAN_INFEASIBLE`                                                                          | `itinerary/test/edit.test.ts:215 "a remove whose new transition over-fills"` (proven)                                                                                                                            |
| `applyEdit`: unchanged transitions keep their stored value                                                                                                            | `itinerary/test/edit.test.ts:293 "unchanged transitions keep their stored value"` (proven)                                                                                                                       |
| `applyEdit`: `gaps`, `coverage` and `reading` are carried untouched                                                                                                   | `itinerary/test/edit.test.ts:333 "gaps, coverage and reading are carried untouched"` (proven)                                                                                                                    |
| `editTransitions`: at most one pair for a remove, three for a move; a spy proves exact calls                                                                          | `itinerary/test/edit.test.ts:398 "a remove in the middle returns the one pair"`, `itinerary/test/edit.test.ts:421 "over every edit this plan admits"` (proven)                                                   |
| `restoreRevision`: copies days, pins, `travelFromPrevious`, re-keys every id, stamps `restore`                                                                        | `itinerary/test/restore.test.ts:39 "copies days, pins, notes, start times"`, `itinerary/test/restore.test.ts:48 "re-keys every id"`, `itinerary/test/restore.test.ts:56 "stamps the restore operation"` (proven) |
| `diffRevisions` passes the twelve-row table; `revisionDiffs` pairs by `parentRevisionId`, oldest first                                                                | `itinerary/test/diff.test.ts:101 "a removal and a move on one day"`, `itinerary/test/diff.test.ts:191 "returns one diff per revision after the first"` (proven)                                                  |
| The `moved` rule is on `RevisionDiff`'s doc comment, the only `contract` change                                                                                       | `contract/src/plan.ts:641 "What counts as"` (verified — `git diff 95c6403 1a9ffff -- tools/planner/contract` is comment-only)                                                                                    |
| Package index exports `replan`, `replanPool`, `applyEdit`, `editTransitions`, `restoreRevision`, `diffRevisions`, `revisionDiffs`; usage block shows the re-plan path | `itinerary/src/index.ts:64 "replan, replanPool, type ReplanInput"` (verified by reading, not test-asserted)                                                                                                      |
| `purity.test.ts` passes unchanged; `npm run check` and `npm test -- --project planner` pass                                                                           | verified — `npm run check` exit 0; `npm test -- --project planner` 61 files / 1014 tests                                                                                                                         |

- **low, repaired at `1a9ffff`** · `edit.ts`'s `applyOperation` threw `day-not-in-revision` when `operation.fromDayIndex` (the _source_ day) was not on the revision, with no test exercising that branch — every `fromDayIndex` in `edit.test.ts` at `2f101f3` was `0` or `1`, both valid. Reproduction (`2f101f3`): guard replaced with `if (false)`, `npx vitest run --project planner tools/planner/itinerary` — 229 of 229 still passed, file restored byte-identical. The builder's fix adds a case at `itinerary/test/edit.test.ts:258 "const noSource = refusal"` that edits from day 9 and asserts `details.precondition` is `day-not-in-revision` by name, not just the `AppError` code — needed because without the guard the same input throws a bare `TypeError` instead. I re-ran the same mutation against `1a9ffff`: 1 of 229 now fails, that new case; restored byte-identical afterwards. Repair confirmed.
- **dropped** · none — the defect hunt (conditionals in `replan.ts`, `edit.ts`, `restore.ts`, `diff.ts`, `preconditions.ts`; the repo invariants list; the four NFRs) turned up nothing else worth carrying.
- **findings** · 1 returned, 1 carried, 0 dropped.
- **scope** · the conditional/`??` enumeration across `replan.ts`, `edit.ts`, `restore.ts`, `diff.ts` and `preconditions.ts` found about 55 sites (replan 8, edit 14, restore 0, diff 29, preconditions 4). Only 2 were flipped individually — `diff.ts:171 "child.parentRevisionId !== parent.id"` and `edit.ts:136 "source === undefined"` (the low finding above, now repaired) — the remaining roughly 53 were not mutated. A scope limit of this gate, disclosed rather than a defect found; it does not change the verdict.
- NFR: security n/a (no credentials or URLs touched) - performance proven-in-place (`diff.ts`'s kept-set search is the documented O(n^2)-per-day dynamic programme, not the exponential subset enumeration the ticket warns against) - reliability see the `low` finding above - maintainability proven-in-place (the dense `diff.ts` tie-break logic is exercised by the twelve-row table plus three extra rule tests, and every new file still passes `purity.test.ts`).

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

**2026-09-14 — built; `ready` until the gate runs.** Branched from `origin/main` at
`95c6403` (on the remote), dispatched as Opus. Built against pl-42 as merged.

**Two commits, in the order step 0 requires.** `94e881b` holds the baseline
alone: `test/fixtures/first-draft-baseline.json`, the case builder
`test/first-draft-cases.ts` and the comparison `test/first-draft-baseline.test.ts`,
with no `src` change. The refactor is its direct child on this branch. Both
shas stop being reachable once the branch is squash-merged and deleted.

- The JSON was written by a scratch script (not checked in) importing the case
  builder, run with `node --import tsx` on the unmodified tree. Before running
  it, `git diff --stat HEAD -- tools/planner/itinerary/src tools/planner/contract/src`
  was empty. `npx vitest run tools/planner/itinerary/test/first-draft-baseline.test.ts`
  then passed at 14 of 14: 13 cases plus a check that the case names match.
- **The first mutation I chose did not go red, and that is recorded rather than
  skipped.** `ACTIVITY_MINUTES_PER_DAY.moderate` 300 → 301 stayed at 14 of 14.
  The transition case needs 360 minutes for its third activity, and no fixture
  comes near the limit. At 360 the same command failed 3 of 14 (both
  `multi-city` cases and the transition case). `limits.ts` was `cmp`-identical
  to its backup afterwards, and the suite was 14 of 14 again.
- After the refactor, the same command passes at 14 of 14. So `compose`, now
  running through `packWithCritic`, `rekeyDays`, the critic's transition charge
  and `fixed`, and `pack`'s `frozen`, still produces the first drafts the
  unmodified package did.

**What landed.**

- `ids.ts`: `rekeyDays`, the one id scheme. It deep-copies each
  `travelFromPrevious`.
- `critic.ts`: `CritiqueInput.fixed`; transitions charged through
  `transitionMinutes` exactly as `charge` does; `packed` narrowed to
  `Pick<PackResult, "days">`.
- `pack.ts`: `PackInput.frozen`.
- `compose.ts`: `ComposeInput.previous` is gone, and the shared internals are
  exported to the package but not from its index.
- `replan.ts` (`replan`, `replanPool`), `edit.ts` (`applyEdit`,
  `editTransitions`), `restore.ts` (`restoreRevision`) and `diff.ts`
  (`diffRevisions`, `revisionDiffs`).
- `preconditions.ts`: the `INTERNAL` checks, each naming itself in
  `details.precondition`.
- The `moved` rule on `RevisionDiff`'s doc comment, which is the only `contract`
  change.
- Tests: `replan`, `edit`, `restore`, `diff` and `critic` suites, a frozen-days
  case in `pack.test.ts`, and the three `compose.test.ts` re-planning tests
  (including pl-23's) moved to `replan` with every day named. Their assertions
  are unchanged.

**What the brief had wrong, or did not say.**

- **Without `fixed`, the frozen hotel is not deleted — the re-plan is refused.**
  Frozen days are emitted from `previous`, never from the pack, so no pack can
  remove anything from them. The critic keeps naming an id the packer has no
  way to exclude, the rounds stall, and `over-budget` survives as
  `PLAN_INFEASIBLE`. That is still a broken promise, and the test still catches
  it (mutation M7 below). It is just not the failure _Traps_ describes.
- **`fixed` on a per-day drop candidate cannot be observed through `replan` or
  `applyEdit`.** A re-plan discards per-day findings on frozen days, and an edit
  refuses rather than dropping. So the brief's `replan` tests cannot prove
  "the critic never names a frozen item". `critic.test.ts` asserts it on
  `critique` directly, together with the transition charge.
- **An edit has no `PackResult`**, which is why `CritiqueInput.packed` is
  narrowed. The change is additive: every existing caller passes a
  `PackResult`.
- **`EditResult.unchecked` appends `previous.coverage`**, and `applyEdit` throws
  `BRIEF_INCOMPLETE` for a brief with no dates. Both mirror
  `uncheckedForRevision`; the brief specified neither.
- **Which day counts as "in season" for an exclusion reason on a re-plan.** A
  pool candidate is now `no-day-in-season` when no _named_ day is in season for
  it, even if a frozen day is. That also chooses `gapsFor`'s wording. It is
  reported to the orchestrator as a question, not settled here.
- **pl-23's test composes a four-day brief over a one-day `previous`.** Through
  `replan` the span is `previous`'s, so the test now packs one day where
  `compose` packed four. Its assertions do not depend on the span, and they
  pass unchanged.
- **Row 9's entries are listed unordered in the table.** The test asserts them
  in the sorted order the brief defines: `moved` C at (0,0), then `removed` B
  at (0,1).
- **One more precondition than the brief listed**: `applyEdit` and
  `editTransitions` also refuse a `previous` that places one candidate twice,
  because an operation that names a candidate means nothing if the name
  matches two items.

**Recorded as the brief asks.** A move onto a day outside the item's season
window ships silently, as a pinned out-of-season item already does. An edit
whose touched day already violates a limit edited since is refused, even
though the edit did not cause it. That is rare and honest, and it is not
special-cased.

**Fold-in: nothing.** `readPlanView`'s `diffs: []` becoming `revisionDiffs`
is pl-44's, and `api/src/runs/orchestrator.ts` is pl-49's this batch.

**Environment, not repo:** this worktree had no `@anthropic-ai/sdk`, although
the lock declares it (since pl-39). `npm run typecheck` failed with 8 errors,
all in `agent/src/providers/anthropic.ts` and its test. The six packages it
needs were extracted from the npm cache into this worktree's `node_modules`
only, at the lock's versions. `npm run build` and `npm run check` then exited 0.

### Verification

**Unmutated.** `npx vitest run tools/planner/itinerary` passed at 13 files and
229 tests.

**Nineteen mutations**, each applied alone to `src` by a scratch script that
runs that same command, restores the file and compares it byte for byte. All 19
restores were identical. Each mutation failed the tests written for it:

| Mutation                                                       | Failed   |
| -------------------------------------------------------------- | -------- |
| M1 critic sums durations without transitions                   | 4 of 229 |
| M2 `over-budget` drop ignores `fixed`                          | 2        |
| M3 `heaviestOn` ignores `fixed`                                | 1        |
| M4 `replanPool` keeps frozen candidates                        | 7        |
| M5 `pack` offers frozen days                                   | 5        |
| M6 per-day findings on frozen days kept                        | 2        |
| M7 `packWithCritic` passes no `fixed`                          | 1        |
| M8, M9, M10 tie-breaks 3.1, 3.2, 3.3                           | 1, 1, 3  |
| M11 diff accepts a non-child                                   | 1        |
| M12 `revisionDiffs` keeps input order                          | 1        |
| M13 `rekeyDays` shares stored travel                           | 1        |
| M14 restore keeps the target's ids                             | 1        |
| M15 edit refuses on the destination only                       | 3        |
| M16 edit re-derives every transition on a touched day          | 3        |
| M17, M18 gap rules (contradicted kept; not one per specialist) | 1, 1     |
| M19 pins honoured on frozen days                               | 1        |

- **M1 is step 2's proof.** Under a critic that does not count transitions, the
  adjacent-pins re-plan ships instead of being refused. That is the brief's 360
  of 300.
- **M19 stayed green on its first run**, at 229 of 229. A pin on a frozen day
  leaves no trace in days or exclusions, so the only thing that can show it is
  `durationUnknown`, and the test's pin had a stated duration. The test now uses
  a pin with no stated duration and asserts `durationUnknown` stays empty. Re-run,
  M19 failed 1 of 229 and the unmutated run was 229 of 229.

`npm run build` exited 0, and `npm run check` exited 0 with no `error TS`.
`npm test -- --project planner` passed at 61 files and 1,014 tests, run once
at the end.

**2026-09-14 — the gate's one finding, reproduced and repaired.** The gate
(dispatched as Sonnet) passed at `2f101f3` and found one low gap:
`applyOperation`'s guard for a `fromDayIndex` the revision does not have had no
test. Every `fromDayIndex` in `edit.test.ts` was valid.

- **Reproduced first.** I replaced the guard with `if (false)` and ran
  `npx vitest run tools/planner/itinerary`: 229 of 229 still passed, and the
  file was byte-identical after its restore.
- **Repaired.** The precondition test in `edit.test.ts` now removes from day 9
  and asserts `details.precondition` is `day-not-in-revision`. It checks the
  name and not only the code, because without the guard the same input fails as
  a `TypeError`.
- **The same command on the repaired tree** passed at 13 files and 229 tests.
  With the guard disabled again it failed 1 of 229, the precondition test, and
  the file was byte-identical after its restore.

**Status stays `ready` until the gate record lands, settled by the
orchestrator, not the owner.** It is a convention question, not a product one.
`done` goes into the same commit as `## Review`, never one without the other,
because `scripts/status.mjs`'s `reviewedButReady` fails CI on a ticket that is
`ready` and carries a review.

**The out-of-season scope, decided by the owner on 2026-09-14.** The question:
when a re-plan cannot place a pool candidate, does "in season" read the named
days only, or every day of the plan? The gate measured both on a fixture where
the candidate is in season only on a frozen day. Placement is identical under
both; only the reason and the gap text differ.

- **Named days only** (as built; recommended): `no-day-in-season`, and the gap
  reads "…everything it found is out of season for these dates."
- **Every day of the plan:** `no-day-had-room`, and the gap reads "…nothing it
  found fitted the days this trip has."

The orchestrator put both options to the owner, who chose **named days only**,
matching the recommendation. `pack.ts` is unchanged. The Build's "When nothing
fits" paragraph does not decide this, so the question was a real one.

**2026-09-14 — gated, and done.** The gate (dispatched as Sonnet) passed at
`1a9ffff`. Its record is `## Review` above, transcribed from its message with
nothing altered by me; `npm run format` then padded its table and rewrote its one `*source*` emphasis as `_source_`, and changed nothing else (compared with whitespace ignored).
`status: done` lands in the same commit, as the orchestrator settled. The same
commit pins pl-42 record line 370 to `contract/src/plan.ts@95c6403:555`, because
this branch's doc comment moved `export interface RevisionDiff {` from line 555
to 571.

**2026-09-15 — rebased onto `8894b75`** after #242 (pl-49) merged. The one
conflict was pl-42's record: resolved by taking `origin/main`'s version and
re-applying this branch's pin (`contract/src/plan.ts@95c6403:555`) on top of
#242's three pins, then `npm run format`. No other file conflicted. The shas
named above are the pre-rebase ones: `94e881b`, `2f101f3` and `1a9ffff` are now
`b3c2b87`, `c45af0a` and `d4ad64e`, and the gate record's commit is `a575878`.
