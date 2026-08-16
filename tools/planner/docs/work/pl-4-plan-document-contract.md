---
id: pl-4
tool: planner
title: The plan document — candidates, days, revisions, pinning
kind: work-package
status: done
milestone: P2
depends_on: [pl-3]
---

# pl-4 — The plan document — candidates, days, revisions, pinning

**Packages:** `contract` (and the migration in `api`)

## Why

A plan is a long-lived, revisable document, and revising it is the product
([00-ANALYSIS.md §6](../00-ANALYSIS.md)). That is only possible if the plan is
structured data with pinning and provenance — a markdown blob can be regenerated
but not amended, cannot say which of its lines were verified, and produces an
unreadable diff.

Contract-first, and on its own, because `agent`, `itinerary`, `api` and `web` all
depend on this shape and pl-5 cannot start without it.

## Build

1. **`Candidate`** — what a specialist returns and the only thing it returns:
   what and where, duration, cost band (not a price), season window, booking lead
   time, the specialist that proposed it, and its `sources`. **Nothing about which
   day it falls on** — that seam is what stops two specialists writing two
   itineraries (§4).
2. **`Provenance`** — source URL and fetch time for a grounded fact, and an
   explicit marker for "the model asserted this". Model-asserted is the default
   until Phase 4 exists, and the UI must be able to say so; that is the honest
   answer to prices being wrong (§5).
3. **`Plan`, `PlanRevision`, `PlanDay`, `PlanItem`.** Revisions **append** — a
   revision is never overwritten, so the plan the user liked is always
   retrievable. An item carries `pinned` and points at the candidate it came from.
4. **Keep the settled vocabulary.** A **trip** is the journey — `TripBrief`,
   `TripShape`. A **plan** is the document this tool keeps about it, so the
   aggregate, its tables, its routes and `PLAN_NOT_FOUND` all say plan. The rename
   from `TRIP_NOT_FOUND` already landed with the design; do not reintroduce
   `Trip` for the document.
5. **Error codes the design needs**, if the review agrees they are right: a brief
   that cannot support a draft, a plan whose constraints cannot be satisfied, a
   revision not found. Propose them in the ticket log before adding — the repo's
   rule is that a code nobody agreed on is not invented locally, and
   `PLAN_INFEASIBLE` in particular is a user-facing promise about what the tool
   checked.
6. **The migration**, in `api`'s existing numbered sequence: plans, revisions,
   days, items, and the brief link. Index what the UI lists by.
7. **Fixtures.** Check in one brief and one candidate set per trip shape under
   `test/fixtures/`. pl-5 and the `itinerary` package are both specified against
   these, so they are part of this ticket's deliverable rather than an afterthought.

## Done when

- The types and schemas exist with `satisfies z.ZodType<T>` throughout, the
  migration applies to an existing database, and the fixtures are checked in.
- A test proves a revision can be added without mutating its predecessor, and
  that a pinned item round-trips.
- The `Trip`/`Plan` naming is consistent across contract, errors and messages,
  and the log says which was chosen and why.
- No composing, no fan-out, no prompts. This ticket adds no runtime logic.

## Log

### 2026-08-15 — landed

`tools/planner/contract/src/candidate.ts` and `plan.ts`, exported from
`index.ts`; migration 2 in `tools/planner/api/src/db/schema.ts`; fixtures under
`contract/test/fixtures/` behind a loader in `contract/test/fixtures.ts`. Four
new suites. `npm run check` is green and the planner suite is **96 tests, up
from 37**; the whole repo is 659.

**What is in the contract.** `Candidate` — what a specialist proposes and the
only thing it proposes — with `Place`, `CostEstimate`, `SeasonWindow`,
`Provenance`, `Source` and the `SPECIALISTS` roster beside it. `Plan` /
`PlanDetail` / `PlanRevision` / `PlanDay` / `PlanItem` / `PlanGap`, with
`appendRevision`, `latestRevision`, `revisionItems` and `pinnedCandidateIds`.
Every schema is `satisfies z.ZodType<T>`.

#### Step 5 — the error codes, proposed

**Two new codes, and the reasoning is the same shape as pl-3's.**

`PLAN_INFEASIBLE` — the plan's own constraints cannot all be satisfied: a day
that cannot hold its legs and its activities, a deal-breaker nothing survives, a
budget no candidate set fits inside. It has to exist because the composer needs
a way to say "I could not build one" that is **distinguishable from "I built one
with holes"** — the holes case is `PlanGap` and it ships, and collapsing the two
would make the promise in §7 ("a plan that violates a hard constraint is not
shipped") unfalsifiable. `details` carries which constraints failed, so the UI
can offer the one useful next step.

`REVISION_NOT_FOUND` — separate from `PLAN_NOT_FOUND` because the two send a
user to different places. A missing plan means the list; a missing revision
means the plan's current draft, which is still there. Revisions are addressable
by design — §6's whole point is getting back the draft you liked — so a stale
link to one is an ordinary thing to happen, and answering it with "that plan
could not be found" is a lie.

**Nothing was added for a failed specialist**, and that is considered rather
than overlooked. A specialist that fails does not fail the request: §7 says ship
the plan with the gap named. So it is `PlanGap` with
`reason: "specialist-failed"` — data on the revision, not an error — and the
only thing that raises an error is a plan that could not be built at all.

#### Decisions worth knowing before pl-5

**A `Candidate` cannot express a day, and a test asserts it.** §4's seam is the
one thing in this ticket a future change could quietly undo, so
`candidate.test.ts` asserts the parsed object has no `day`, `dayIndex`, `date`,
`startsAt` or `position`. A specialist that could name a day would be writing
the schedule.

**`null` never means a default.** A duration nobody measured is `null`, not a
plausible ninety minutes. The sharp case is `season`: `null` means _not
established_ and `ALL_YEAR` means open year-round, and they must not collapse —
if they did, a hut nobody checked would read as open in February. The composer
filters on a known window and leaves an unknown one to the critic.

**Provenance is on the candidate _and_ separately on its cost.** §5 ranks prices
last of the four things worth grounding and calls them the fastest to age, so
the UI has to be able to say "this cost is the model talking" about a candidate
whose existence was verified. `MODEL_ASSERTED` is the default and stays the
default until Phase 3 — that is not a placeholder to tidy away.

**A `grounded` provenance carries at least one source, by schema.** A grounded
fact with an empty source list claims we checked something with nothing to show
for it, which is worse than admitting the model said it.

**`PlanDay.date` is nullable, and `dayIndex` is the identity.** This falls
straight out of pl-3's flexible dates: a brief whose dates are `open` ("ten
nights, whenever is best") has no calendar, and a `NOT NULL` here would force
the tool to invent a departure date and then plan against it as though the user
had chosen it. Every reader has to handle a dateless day — that is the cost of
the intake being honest, paid here rather than by making the intake lie.

**Candidates hang off the plan, not off a revision.** One the composer did not
place is what the next revision draws on when the user says they cannot afford
the second hotel, and one that two revisions both place must not be stored
twice.

**The brief is stored on the plan as a snapshot, not a link.** The intake stays
editable after a draft exists — refining is re-entrant, per pl-7 — so the live
brief drifts from the one the fan-out actually read. This is what lets the UI
answer "why is there no lodging in here?" honestly, and what lets a stored plan
be replayed. **pl-7 may add a reference to the live intake beside it; that link
does not replace the snapshot.**

#### The migration, and how it does not collide with pl-7

**Migrations append, so there is no conflict — only an order.** This took index
1 and shipped as `user_version = 2`; pl-7's intake migration appends and becomes 3. Whichever had landed first would have taken 2. Nothing here touches
migration 1's `conversations` / `messages` tables: they are superseded, but
dropping them belongs with the intake that replaces them, and a migration here
doing half of that job would be worse than leaving them.

**Rows where something is addressed, JSON where a value is read whole.** Days
and items get columns because they are what a revision is _edited_ by — pinning
is an `UPDATE` of one row, and §6's slicing names days. The brief, a candidate
and the gap list are only ever read and written entire, are schema-validated on
the way out, and have no field SQL would filter on, so they are JSON and adding
a field to one of them is not a migration. `specialist` is the one field lifted
out of a candidate's JSON, because "which agents ran" should not cost a scan.

**Append-only is enforced by the database, not by convention.** Three triggers:
`plan_revisions` and `plan_days` reject any `UPDATE`, and `plan_items` rejects
an update of `day_id`, `candidate_id`, `position`, `starts_at` or `note`.

**That last trigger is where the design has a real tension, and this is how it
was resolved.** `01-ARCHITECTURE.md` puts `pinned` on the item, because it is
the composer's input constraint — but a revision is supposed to be frozen, and
pinning writes to one. Making a pin create a new revision would fill the history
with intent and no content; moving pins to plan level would contradict the
architecture and lose which _placement_ was blessed. So `pinned` is the single
mutable column on a placed item, and it is named column by column in the trigger
rather than left as a gap, so the exception cannot silently widen. **A pin is a
statement about what the next re-plan may touch, not an edit to this draft.**

#### The fixtures

**Six files, one per shape, in `contract/test/fixtures/`, as JSON.** JSON has no
import graph, so pl-5 and `@planner/itinerary` read them with a path and no
build step — a `.ts` fixture would have needed a cross-package import into
another package's `test/` directory. `loadFixture(shape)` in
`contract/test/fixtures.ts` parses them through the _real_ schemas, so a fixture
that drifts out of the contract fails at load rather than in whichever suite
used it next.

`fixtures.test.ts` asserts the set is complete in both directions (a shape with
no file, and a file for no shape), that **every fixture is draftable** —
`missingRequiredSlots` is empty, so pl-5's roster tests are never asserting
against a brief the orchestrator would have rejected — that candidate ids are
unique within a fixture, and that the set covers both provenance kinds. That
last one is deliberate: grounding does not exist, so almost everything is
model-asserted, but the UI has to render a grounded line too and an all-asserted
fixture set would let that path rot unnoticed.

#### What the brief got wrong, or left out

- **The brief lists the tables as "plans, revisions, days, items, and the brief
  link" — five things, and one of them is not a table.** There is no intake
  table to link to yet (pl-7 owns it), so the brief is a JSON snapshot on the
  plan and there is no foreign key. And a `plan_candidates` table the brief does
  not mention is unavoidable: an item "points at the candidate it came from",
  which needs the candidate persisted.
- **"This ticket adds no runtime logic" is not quite true, and the same
  exception pl-3 took applies.** `appendRevision` derives the revision number
  and the parent rather than accepting them, because the append-only rule is the
  one thing in §6 a caller can break by accident. `api` writes revisions and
  `web` renders them; both need the rule and neither should own it.
  `latestRevision`, `revisionItems` and `pinnedCandidateIds` came along on the
  same reasoning.
- **`latestRevision` returns `null` rather than throwing**, because a plan with
  no revisions is a real state: pl-5 creates the plan when the run starts so the
  run has somewhere to report progress to, and the first revision arrives when
  the composer is done.
- **`appendRevision` shares the predecessor revision objects rather than cloning
  them.** Safe precisely because nothing ever writes to one, and it is what
  keeps a long history from copying every day of every draft on each append. The
  test asserts both: the input is untouched, and `revisions[0]` is the same
  object.
- **`updatedAt` follows the new revision's `createdAt`**, not a clock read
  inside the contract. The contract has no clock, deliberately — and a plan
  whose `updatedAt` disagrees with its own latest revision is a bug nobody would
  find.
- **`COST_BASES` drops `per-day`, which `TripBudget` has.** A budget is a rate
  the user thinks in; a candidate's cost is what that one thing costs. Offering
  the basis would invite a specialist to divide something by a day count it was
  never told.
- **A `SeasonWindow` may have `to` before `from`**, and that is the wrapping
  case rather than an error. A ski season is `12-01` to `04-15`; a schema that
  ordered the pair would make winter unrepresentable.

#### Working notes for whoever is next

- **CI could not run this.** GitHub Actions has been failing repo-wide since
  ~00:46Z on 2026-08-15 — every workflow on every branch, including `main`,
  jobs completing in ~2s with zero steps, which is a billing/spending-limit
  block and not a test failure. Diagnosed with another session, which took it to
  the user. Everything here was gated locally instead: `npm run check` and
  `npm test` both pass in full. **Do not read a red check on this PR as a
  finding.**
- A fresh worktree needs `npm install` **and `npm run build`** before
  `npm test` will resolve anything: every workspace is consumed through its
  `dist`, so an unbuilt tree fails on `@webtools/core` with a Vite resolve
  error that looks nothing like the actual cause.
- Backticks inside the migration's SQL comments terminate the template literal.
  Cost one confusing `TS1005`; the comments use double quotes now.

#### Amended 2026-08-16 by pl-15

**`Candidate.place` is now `Candidate.location`**, a discriminated union of
`at` a place and `between` two — see [pl-15](./pl-15-candidate-legs.md). The
shape this ticket shipped could not say where a drive started and ended, so the
six candidate sets checked in here carried a leg's endpoints in its title and a
corridor in its `Place`. Travel time, a detour and conditions along a route all
need both ends as structure, and none of them was buildable until this changed.

Two things this ticket got away with that pl-15 had to pay for: the field had
**no reader anywhere in the tool** — the packer buckets by `specialist`, so a
candidate's location was written and never consulted — and four of the six route
candidates here carry real coordinates, which the first pass at the migration
overwrote with `null`. The fixtures are more grounded than the roadmap's
"coordinates are null until Phase 3" suggests; that sentence is about what the
tool _produces_.

#### Amended 2026-08-16 by pl-5

**The six candidate sets are realistic candidate sets and are not claims about
who ran.** Read as the latter they are wrong twice over, and both were found by
building the thing that consumes them.

**The resort set has a `route-and-logistics` candidate that §4 says should not
exist.** "A resort week needs lodging, food and practicalities, and a route
specialist would produce noise about airport transfers" is the analysis's own
sentence, so [pl-5](./pl-5-orchestrator-and-fan-out.md)'s roster has no route row
for `resort` — which makes the fixture's five-hour Ottawa→Cancún transfer a
candidate the fan-out would never propose. [pl-9](./pl-9-composer-and-critic.md)
had already found that the composer drops it, for an unrelated reason: a resort
brief has no drive appetite, so a transfer is charged to a `gentle` day's 180
activity minutes and does not fit. Two mechanisms disagreeing with the fixture
independently is a reason to believe them rather than it.

**Its route candidates are routinely over the day the brief asked for**, which is
pl-9's finding in full and is now a rule: an appetite answer bounds what a
specialist may propose, stated in the prompt and enforced after the reply. The
road-trip set's 5½-hour leg to a party who answered `half-day` is the worked
example of what not to write, and pl-5's scripted answers split the same journey
into legs that fit.

**Neither is a defect in this ticket and neither was changed.** These sets exist
so the composer could be built and tested before a fan-out existed, and they did
that job — including by being wrong in a way that taught pl-5 what to enforce.
Anyone reaching for them as "what a roster produces" should reach for
`SCRIPTED_FAN_OUT` in `@planner/agent` instead, which is keyed by shape _and_
specialist and is written against these same six briefs.
