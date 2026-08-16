---
id: pl-10
tool: planner
title: The plan view — days, gaps, and what was actually verified
kind: work-package
status: done
milestone: P2
depends_on: [pl-4, pl-9]
---

# pl-10 — The plan view

**Packages:** `web`, `api` (the read routes)

## Why

Two of this tool's honesty mechanisms are built and neither is visible, which
means neither is doing its job yet.

**Provenance** ([00-ANALYSIS.md §5](../00-ANALYSIS.md)) exists on every candidate
and separately on every cost, and §5 calls showing it "the honest answer to the
prices being wrong": the UI can mark which lines were verified and which are the
model talking. Until something renders that distinction, storing it is bookkeeping.

**Gaps** (§7, and the repo's _never fake progress_ rule) are structured data on
every revision — a specialist that failed, was dropped for budget, or was never
on the roster. A plan that says "we could not check lodging" is useful; the same
plan with the gap silently omitted is the failure the rule exists to prevent.
The plan document can express it, and nothing shows it.

**And a third arrived with [pl-9](./pl-9-composer-and-critic.md):** the list of
constraints the composer **could not evaluate**. Travel time on every plan,
because `Place.coordinates` is null until grounding — §2's failure 1, unchecked
— plus opening hours, deal-breakers, daily distance, machine range, an assumed
effort appetite, a band budget with no figure to sum against, mixed currencies.
This is the one of the three that matters most and is easiest to lose, because
**a packed plan looks equally finished whether every constraint was enforced or
three were skipped for want of data.** The reader cannot see the difference, so
silence about it is the most consequential thing this view could get wrong.

[pl-7](./pl-7-intake-persistence-and-wizard.md) owns the intake wizard and stops
at the brief. Nothing owns rendering the plan, which leaves Phase 2 able to
_produce_ a document nobody can read.

## Build

1. **The read routes.** `GET` a plan list from the `plans` table — that is what
   `plans_updated_at` is indexed for — and `GET` one `PlanDetail`. Note the split
   in the contract: `Plan` is the thin list row and `PlanDetail` carries the
   brief, the candidates and every revision, so the list must not load the
   documents.
2. **The plan view.** The latest revision's days in order, each with its items,
   each item resolved against `PlanDetail.candidates`. **Handle a dateless day** —
   `PlanDay.date` is null whenever the brief's dates were a window or open, and
   the day's identity is its `dayIndex`. A UI that assumes a calendar breaks on
   every flexible-dates trip, which is a normal trip.
3. **Mark provenance on every line that has one.** A grounded fact shows its
   sources and when they were fetched; a model-asserted one says so plainly. The
   candidate's provenance and its cost's provenance are **separate** and may
   disagree — a real place with a guessed price is the common case, and the view
   must be able to say exactly that.
4. **An item is at a place or runs between two.** `Candidate.location` is a
   union as of [pl-15](./pl-15-candidate-legs.md) — `at` a place, or `between`
   two — and a drive, a transfer, a flight or a traverse is the second. Rendering
   only `location.place` type-errors; rendering only a leg's `from` silently
   drops where it goes. Both kinds appear in the checked-in fixtures, so this is
   not a case that waits for pl-5.

   **A leg can be half-grounded, and that is new.** `Provenance` is on the
   candidate as a whole, but coordinates are per-`Place`: the multi-city rail leg
   has them on its origin station and not on its destination. So one item can be
   partly located and partly not, which no earlier item could be. Decide what
   that renders as rather than letting it fall out of the template — the honest
   answer is probably to say nothing about coordinates at all until Phase 3 uses
   them, but it is a decision.

5. **Show costs as bands, never as figures.** A `CostEstimate` is `low`/`high`
   with a basis. Rendering the midpoint, or the low end, turns an estimate into a
   quote — which is the thing §5 says ages fastest and the reason the contract has
   no field for a single number.
6. **Show the gaps as part of the plan, not as an error.** A `PlanGap` names a
   specialist and a reason, and each reason is a different sentence: "not
   applicable to this trip" is reassurance, "we tried and could not" is a warning.
   They belong in the document's flow where the missing section would have been —
   not in a toast that disappears.
7. **Show what was not checked, beside the days.** `ComposeResult.unchecked` from
   `@planner/itinerary` — each entry a kind, a sentence already written for a
   reader, and the candidate ids it applies to when it applies to particular
   items rather than to the whole plan. Travel time is on every plan and is the
   one to render most plainly.

   **It does not survive a reload, and that is the trap.** Every `PlanGapReason`
   is about a _specialist_ — failed, dropped, not applicable, found nothing — and
   "nothing measured the distance" is not: route-and-logistics ran perfectly and
   returned good candidates. So the list has nowhere to live on `PlanRevision`
   and comes back only from the `compose()` call, which means a plan read back
   out of the database has lost it. Two ways to close that, and it is a decision
   rather than a detail:
   - **Persist it**, which needs a `PlanGapReason` member that is about a
     constraint rather than about a specialist — a contract change, coordinated,
     and pl-9 deliberately did not make it unilaterally.
   - **Re-derive it** on read by re-composing from the stored brief and
     candidates. The composer is pure and deterministic, so this genuinely
     works; it costs a re-pack per read and drifts the moment `limits.ts`
     changes under a stored plan.

   Rendering it only on the run that produced it is the third option and it is
   the one to refuse: it makes the honesty a property of how you arrived at the
   page.

8. **Pinning, from the UI.** Pin and unpin an item. This is the one write that
   does **not** create a revision, and the database enforces it: `plan_items`
   rejects an update of every column but `pinned`. A pin is a statement about what
   the next re-plan may touch.
9. **Surface the revision list, read-only.** Which revision is showing, and how
   many there are. **The diff is Phase 4 and is out of scope here** — this ticket
   is the honest read of one document, not the revision experience.

Traps worth knowing in advance:

- **`no-candidates-found` has two producers and two sentences**, as of
  [pl-5](./pl-5-orchestrator-and-fan-out.md). The orchestrator raises it for a
  specialist that ran and returned nothing at all; the composer raises it for one
  that returned candidates and got none of them onto a day. Same
  `PlanGapReason`, and the `detail` is already written for a reader in both
  cases. A view that renders a sentence per _reason_ rather than the gap's own
  `detail` throws away the half that says which happened — which is the
  difference between "there is nothing there" and "there was, and none of it
  fitted".
- **A plan can hold two hotels for one week, and the view must not pretend
  otherwise.** `BUCKET_OF` makes a lodging candidate one day's anchor, so a
  specialist that proposes two properties gets both placed on different days and
  the cost arithmetic charges for both — visible in pl-5's resort fan-out, where
  the critic drops one to bring the total back under budget. It is a real gap
  between what a lodging specialist means and what the packer does with it, and
  it is not pl-10's to fix; it _is_ pl-10's not to render as though the party
  were staying in both.
- **A `web` package's tests need their own compiler surface.** The root
  `CLAUDE.md` is explicit and the trap is live: `tsconfig.tests.json`'s glob picks
  up `tools/planner/web/test/**` and it will fail against the node surface with no
  DOM lib and no JSX. Give it a `test/tsconfig.json` beside the downloader's, add
  **that one path** to the glob's `exclude`, and reference it from the root. Do
  not widen the exclude to `tools/*/web/test/**` — that pattern drops a future
  tool's web tests into no project at all and passes green while checking nothing.
- **Everything rendered here is untrusted.** A candidate's title, summary and
  source titles came out of a model that was reading web pages. It is schema-bounded
  by pl-4, but a source URL still reaches the DOM as a link — the `https?` check
  in `sourceSchema` is a floor, not a reason to skip escaping.
- **Never present a plan as a clearance to go.** For backcountry, marine and
  winter motorised trips the view points at the authoritative local source —
  avalanche bulletin, trail authority, marine forecast — and never implies the
  tool has checked conditions. §8, and it is permanent.

## Done when

- A plan list and a plan detail render from real data, with the list not loading
  revisions.
- A plan whose brief had open dates renders correctly, asserted in a test — no
  invented dates anywhere in the view.
- Every item shows whether it was grounded or model-asserted, and a candidate
  whose cost provenance differs from its own is rendered honestly, asserted.
- A revision carrying a `PlanGap` shows it in the plan body, with a distinct
  sentence per `PlanGapReason`.
- **Every plan says travel time was not checked**, and the assertion is on a plan
  loaded from the database rather than on one just composed — that is the half
  that can silently go missing. Whichever of the two options above is taken, this
  test is what proves it was.
- Pinning from the UI persists and creates no revision, asserted.
- No cost is displayed as a single figure anywhere.
- `tools/planner/web/test/tsconfig.json` exists, is referenced from the root, and
  the glob excludes exactly that path.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-08-16 — done

The plan is readable: a list, a document, provenance on every line, the gaps in
the body, what nothing checked beside the days, and pinning. Branched off
`origin/main` at `abe2397`, alongside pl-18 in another session — the overlap was
agreed up front and came to almost nothing (see _Coordination_ below).

**`unchecked` survives a reload by being derived, which was neither of the two
options the brief offered.** Bullet 7 named persisting it — a `PlanGapReason`
member, a contract change — or re-composing on read. There is a third, and it is
better than both: **the list is a function of the brief, the candidates and which
of them were placed**, and a stored revision says which were placed. So
`uncheckedFor` was lifted out of `compose.ts` into `unchecked.ts`, given the
placed set instead of a `PackResult`, and a `uncheckedForRevision` wrapper reads
that set off a stored revision.

- Against **persisting**: a stored list can disagree with the days it is printed
  beside. A derived one cannot.
- Against **re-composing**: no re-pack per read, and no drift. Re-composing runs
  the packer against today's `limits.ts` _and today's date_ — a booking deadline
  that has since passed changes what packs — so it would print a list about a
  plan the reader is not looking at. The brief called out the `limits.ts` half;
  the clock half is worse and was not mentioned.

`itinerary/test/unchecked.test.ts` asserts the two lists are equal across six
shapes of trip, and `api/test/plan-view.test.ts` asserts travel-time on a plan
read back **over HTTP from the database**, twice, which is the assertion the
brief said was the one that can silently go missing.

**A dead branch fell out of that.** `uncheckedFor` took `untilDeparture` and only
ever tested it for `null` — which happens exactly when the dates are `open`,
which the branch above it had already handled. It was unreachable. Removing it is
what makes the derivation clock-free, which is what makes deriving-on-read
honest rather than merely cheap.

**Four contract additions, all additive.** Nothing existing changed shape, was
renamed or was removed.

1. **`ROUTES.plans` answers `GET` too**, and **`ROUTES.planItemPin`** is new
   (`/plans/:id/items/:itemId/pin`), with `planItemPinUrl`. The pin is under the
   plan because an item id is only meaningful within the plan that owns it.
2. **`PlanListResponse`**, **`PlanView`** (`{ plan, unchecked }`) and
   **`PinItemRequest` + `pinItemRequestSchema`**. `PinItemRequest` is absolute
   rather than a toggle so two tabs on one plan converge.
3. **`contract/src/unchecked.ts`** — `UNCHECKED_CONSTRAINTS`,
   `UncheckedConstraintKind`, `UncheckedConstraint` and a zod schema, **moved
   from `@planner/itinerary`**, which now imports and re-exports them. It became
   a wire type the moment the API sent it, and a wire type defined in the package
   that computes it would have to be redefined by every reader. The deriving
   stayed in `itinerary`; only the vocabulary moved.
4. **`ITEM_NOT_FOUND`** in `PLANNER_ERROR_CODES`. Neither `PLAN_NOT_FOUND` nor
   `REVISION_NOT_FOUND` fits — the plan _is_ there and so is the revision, so
   both would have to be re-worded at the raise site, which the root `CLAUDE.md`
   names as the tell that the code is wrong. It is also a different next step for
   the reader: reload the plan, not go back to the list.

**A bug found on the way, unrelated to the view.** `REVISION_NOT_FOUND` had no
entry in `api/src/http-errors.ts`'s status table, so the table's `?? 500`
fallback would have reported a server fault for a stale link the first time
anything raised it. Mapped to 404 beside the new `ITEM_NOT_FOUND`. Nothing raises
it yet; that is why nothing had noticed.

**Decisions the brief asked for by name.**

- **The half-grounded leg** renders _nothing_ about coordinates. The brief
  guessed this was the honest answer and it is: a reader cannot act on "we know
  where one end of this is", and Phase 3 is when coordinates start meaning
  something. Asserted negatively, so a future template that starts leaking them
  turns the suite red.
- **Two hotels in one week** is not rendered as a continuous stay. Items belong
  to the day they are on and nothing says a stay continues into the next one.
  Fixing the packer's side of it is still not pl-10's.
- **A fixed price** (`low === high`) reads as "20 EUR, a posted price" rather
  than bare. The rule is that no _estimate_ is shown as one figure, and the way
  to keep it while honouring `low === high`'s distinct meaning is to say which of
  the two a figure is. A band is `40–60 EUR`; the midpoint appears nowhere, and a
  test asserts its absence.
- **The revision list is the count and the current one**, read-only. Switching to
  an older revision was left out on purpose: the API sends one `unchecked` list
  and it describes the latest, so a revision picker would have shown the wrong
  list against an older draft. `uncheckedForRevision` already takes any revision,
  so Phase 4 gets this for the price of a second field.

**Two things in the brief were already true.**
`tools/planner/web/test/tsconfig.json` exists — pl-12 created it, and the brief's
bullet about creating it and narrowing the glob is stale. Neither it nor the root
`tsconfig.tests.json` needed touching. And the plan _detail_ route already
existed from pl-16; what was missing was the list, the pin, and `unchecked` on
the response.

**Coordination.** pl-18 (PR #43) was in flight in a parallel session and the
overlap was checked before either of us was deep in: it touches
`contract/src/tree.ts` and `brief.ts` comments, `web/src/wizard/Wizard.tsx` and
`api/test/intakes-routes.test.ts`, none of which this ticket goes near. Its one
reach into here is that **`stage` no longer implies required** — use
`isRequiredSlot(node.fills)`. Nothing in the plan view reads `stage`. Plan-view
fixtures went in a new `web/test/plan-fixtures.ts` rather than into
`web/test/fixtures.ts`, whose `BASE` pl-18 changes.

**Not done, deliberately: `03-STATUS.md`.** PR #42 is rewriting that file's
ticket table and pl-18's log records further edits it needs, so all three of us
editing it now is three conflicts for one paragraph. Agreed with the pl-18
session that whoever lands last rewrites it. That is the follow-up.

**Not done: an e2e spec.** The brief did not ask for one and the suite is two
specs over the intake on purpose — branch coverage costs milliseconds in a
component test and a browser launch there. The plan view's claims are asserted in
`web/test/plan-view.test.tsx` (15 tests) against the real components.

512 tests pass in the planner project, 1078 across the repo, `npm run check`
green.
