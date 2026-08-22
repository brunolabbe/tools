---
id: pl-22
tool: planner
title: A pin is scoped to the plan, not to the revision the reader was looking at
kind: fix
status: ready
milestone: null
depends_on: []
---

# pl-22 — A pin lands on a revision nobody is reading

**Packages:** `api`

## Why

`updateItemPin` in `api/src/db/plans.ts:239` scopes its `UPDATE` by **plan**:

```sql
UPDATE plan_items SET pinned = ?
 WHERE id = ?
   AND day_id IN (
     SELECT plan_days.id FROM plan_days
     JOIN plan_revisions ON plan_revisions.id = plan_days.revision_id
     WHERE plan_revisions.plan_id = ?
   )
```

Every revision of that plan is in scope, so an item id belonging to a
**superseded** revision matches, the row is written, `result.changes > 0`, and
the route answers 200 with a `PlanView` in which nothing appears to have
changed. The read side does not meet it halfway: `pinnedPlacements`
(`itinerary/src/compose.ts:97`) only ever reads pins off the revision handed to
it as `previous`, which is the latest. So the write succeeds and has no effect —
the failure mode the repo's _never fake progress_ rule is about, one layer down.

**It cannot happen today, and that is exactly why it is a ticket.** There is one
revision per plan because re-plan is Phase 4, so no item id can name a
superseded one. Phase 4 is where a second revision first exists, and it is also
where the diff view makes it natural to be reading revision _n_ while _n+1_ is
being written — which is the moment this becomes reachable, by a reader doing
nothing wrong. Finding it then means finding it as "the pin button sometimes
does nothing", from the UI, in the middle of building the revision experience.

Found by the `code-review` pass behind
[pl-10](./pl-10-plan-view-and-provenance.md)'s review gate, recorded there as
`low` and left as a note because it was unreachable. It is a ticket now rather
than a fix-in-passing for the reason pl-20 is: the file belongs to a merged
ticket, and it is a decision about behaviour rather than a typo.

**It is not the same rule as the database's.** `plan_items_only_pinned_is_mutable`
guarantees a pin cannot move an item; it says nothing about _which_ item, and it
is working correctly here. Do not reach for a trigger.

## Build

1. **Decide what a pin on a superseded revision means**, and write it down. Two
   defensible answers and they are not close:
   - **Refuse it.** `ITEM_NOT_FOUND` already exists and its copy already tells
     the reader to reload the plan to see the current draft — which is exactly
     the right advice here, and `PlanView.tsx` already renders a failed pin
     beside the document rather than instead of it. This is the recommendation.
   - **Accept it and carry it forward**, which means deciding what a pin on a
     day that no longer exists pins, and is a Phase 4 design question rather
     than a repair.
2. **Scope the `UPDATE` to the plan's latest revision**, in the statement rather
   than in a check before it — two statements is a race the moment a re-plan can
   append while a pin is in flight.
3. **Make the miss and the truly-missing case indistinguishable to the caller.**
   `result.changes === 0` already maps to `ITEM_NOT_FOUND` for an item id that
   does not exist at all; a stale one should arrive at the same place, because
   "reload the plan" is the same advice.
4. **A test with two revisions on one plan.** Pin an item on the older one and
   assert it is refused; pin one on the latest and assert it still works. Both
   go in `api/test/plan-view.test.ts`, beside the existing pin tests.

Traps worth knowing in advance:

- **Do not fix this in the route.** The route has a plan id and an item id and
  no way to know which revision the item is on without asking the store, so a
  check there is the second statement of the race in step 2.
- **`latestRevision` is on the contract and `plans.latest_revision` is in the
  table.** Prefer the column the write can join against; a helper that reads the
  document to find the number defeats the point.

## Done when

- Pinning an item that belongs to a superseded revision is refused with
  `ITEM_NOT_FOUND`, asserted against a plan with two revisions in it.
- Pinning an item on the latest revision still works, asserted in the same test
  file, and the existing pin tests are unchanged.
- The refusal is one statement — there is no read-then-write between the
  decision and the update.
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-08-22 — done.** `updateItemPin` now scopes its `UPDATE` to the plan's
latest revision, in the same statement, and the two new tests are in
`api/test/plan-view.test.ts` beside the existing pin ones. Nothing outside `api`
was touched.

**Step 1, decided: refuse it, with `ITEM_NOT_FOUND`** — the brief's own
recommendation, taken as written. Nothing argued against it. The alternative
needs an answer to "what does a pin on a day that no longer exists pin", and
that answer belongs with the re-plan that first makes the question askable, not
with a repair to a write that currently reports success and does nothing. The
copy on `ITEM_NOT_FOUND` already says to reload to see the current draft, which
is the correct advice for a reader looking at a superseded revision, so a stale
id and an id that never existed now arrive at the same place and are
indistinguishable at the caller — the test asserts equal status _and_ equal
message, not merely equal code.

**The brief got one thing wrong, and it is the trap.** There is no
`plans.latest_revision` column to join against — the `plans` table is
`id · title · brief_json · created_at · updated_at` and nothing else
(`api/src/db/schema.ts`, migration 2, never altered since). `latest_revision` is
an _alias_ for `COALESCE(MAX(plan_revisions.revision), 0)` inside `selectPlans`,
which is where the `PlanListRow` field of that name comes from. So the scope is a
correlated `MAX` over the plan's own revisions:

```sql
AND plan_revisions.revision = (
  SELECT MAX(sibling.revision) FROM plan_revisions AS sibling
  WHERE sibling.plan_id = plan_revisions.plan_id
)
```

Correlated rather than a second bound `?` so the plan id is still passed once,
and it is the read `plan_revisions_plan (plan_id, revision DESC)` was indexed
for. The spirit of the trap holds and was followed: the write never reads the
document to find the number, and there is no statement between the decision and
the update.

**Making a second revision in a test costs a helper**, because re-plan is Phase
4 and no route appends one. `supersedeDraft` does what the orchestrator's
`persist` does — `appendRevision` from the contract for the number and the
parent, `insertRevision` for the rows — and copies the superseded draft item for
item with fresh day and item ids and the same candidate ids, which the
`plan_items.candidate_id` foreign key requires. Delete it when a re-plan route
exists and the test can use that instead.

**Confirmed the test fails without the fix**, by reverting the `AND` and running
the file: the refusal test fails 200-vs-404. The companion test (pinning on the
latest revision, with an older one present) passes either way by design — it is
the guard against over-scoping, not a second reproduction.

Gates: `npm run check` and `npm test -- --project planner` both pass (528 tests,
40 files). Neither runs the planner's e2e suite or the container build, and
neither needed to — the change is one SQL statement inside `api`, no route, no
contract, no bundle and no image content moved.
