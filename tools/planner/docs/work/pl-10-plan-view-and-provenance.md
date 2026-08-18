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

## Review

**Gate: CONCERNS** — 2026-08-16 · `origin/main...HEAD` · code-review at medium

| Done when                                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plan list and a plan detail render from real data, list not loading revisions                                 | `api/test/plan-view.test.ts:137` (list omits `revisions`/`candidates`/`brief`), `api/test/plan-view.test.ts:56` (detail) ✓                                                                                                                                                                                                                                                                |
| Open-dates brief renders correctly, no invented dates                                                           | `web/test/plan-view.test.tsx:69` ✓                                                                                                                                                                                                                                                                                                                                                        |
| Every item shows grounded/model-asserted; cost provenance divergence rendered honestly                          | `web/test/plan-view.test.tsx:137` (grounded place + guessed cost), `:166` (ungrounded) ✓                                                                                                                                                                                                                                                                                                  |
| A `PlanGap` shows in the plan body, distinct sentence per `PlanGapReason`                                       | `web/test/plan-view.test.tsx:235`, `:262` — 3 of 4 reasons exercised directly; the 4th (`specialist-dropped-for-budget`) is covered only by `GAP_LABELS`'s TS-exhaustive `Record`, not a render assertion ✓                                                                                                                                                                               |
| Every plan says travel time was not checked, asserted on a plan loaded from the database, not one just composed | `api/test/plan-view.test.ts:79` — real SQLite, over HTTP, after `runToCompletion`, read twice ✓ (strong; exactly the trap named)                                                                                                                                                                                                                                                          |
| Pinning from the UI persists and creates no revision, asserted                                                  | **unproven (gate)** — `web/test/plan-view.test.tsx:376` mocks `../src/api/plan.ts` wholesale, so it only proves the button calls `pinItem(planId, itemId, true)` and re-renders a fabricated response; "persists, appends no revision" is proven only at `api/test/plan-view.test.ts:178`, which never touches the UI. The two tests don't compose into the claim as written.             |
| No cost is displayed as a single figure anywhere                                                                | **unproven (gate)** — `format.ts:68-74` renders `low === high` as `"20 EUR, a posted price"`, a bare single figure with a label. No test anywhere exercises this branch: the one cost test uses `low:40/high:60` (`plan-view.test.tsx:187`), and the default candidate fixture has `cost: null`. The interpretation is defensible but untested and, read literally, contradicts the line. |
| `web/test/tsconfig.json` exists, referenced from root, glob excludes exactly that path                          | Verified independently, not from the Log: file created in pl-12 (`7dde7ba`), `tsconfig.json:29` references it, `tsconfig.tests.json`'s `exclude` names exactly `tools/downloader/web/test/**` and `tools/planner/web/test/**`. Untouched by this diff (`git diff` on the three files is empty) ✓                                                                                          |
| `npm run check` and `npm test -- --project planner` pass                                                        | Verified directly: `npx tsc --build --force` clean, `npm run check` exit 0, `vitest run --project planner` → 512/512 passed, 40 files ✓                                                                                                                                                                                                                                                   |

- **med** · `describeCost` bends "no cost as a single figure": a fixed price (`low === high`) prints as one number, and the acceptance line's only interesting branch has zero test coverage. `web/src/plan/format.ts:68-74`.
- **med** · The "from the UI" half of the pinning acceptance line is not actually proven from the UI — the web test mocks the API client, so persistence/no-revision is only checked at the HTTP layer. `web/test/plan-view.test.tsx:375-401` vs `api/test/plan-view.test.ts:178-207`.
- **low** · `uncheckedFor`'s currency detection silently changed behavior: the removed code looked placed ids up in `season.kept`, dropping a pinned-out-of-season candidate's currency; the new code looks the same ids up in the full candidate list, so it now counts. Very likely more correct, but unacknowledged in the Log and untested (no `compose.test.ts` case combines `previous`/pinned items with mixed currencies). Unreachable today — nothing calls `compose()` with `previous` outside tests, since re-plan is Phase 4. `tools/planner/itinerary/src/unchecked.ts:194-206`.
- **low** · `updateItemPin` scopes only by `plan_id`, not by latest revision, so a pin aimed at an item on a superseded revision succeeds silently while `pinnedPlacements` only ever reads pins off the revision passed as `previous` — a write that looks successful but has no effect once Phase 4 exists. Unreachable today (no revise flow, no multi-revision plan in production). `tools/planner/api/src/db/plans.ts:239-256`.
- **info** · `UncheckedConstraint`/`UncheckedConstraintKind` moved from `@planner/itinerary` into `@planner/contract`, plus `ITEM_NOT_FOUND` and three new wire types added to `contract/src/api.ts`. All additive and well-justified in the Log and in-file docs; the root `CLAUDE.md`'s "not unilateral" rule is satisfied by the ticket recording the decision, but it's the kind of package-boundary move worth a second pair of eyes given this was reviewed by the same model class that wrote it. Not a gate issue.
  **Follow-up, 2026-08-18 —** the `unproven (gate)` row for "pinning from the UI
  persists and creates no revision" is now **proven**, by
  [pl-19](./pl-19-pin-through-the-browser.md)'s `e2e/pin.spec.ts`: one browser from
  the intake to a drafted plan, pin, reload, re-open from the plan list, still
  pinned, "Version 1 of 1" unchanged, and the unpin surviving the same round trip
  with nothing mocked. The gate table above is left as it was written — it was
  true on 2026-08-16, and a review that edits itself later is not a record. The
  second `med` finding below is closed by the same spec. **The other
  `unproven (gate)` row is not**: `describeCost` still renders `low === high` as a
  single figure and no test exercises that branch. The proof of this one runs in
  `.github/workflows/planner.yml` and nowhere else, so `npm test` stays silent
  about it.

- Structural note (not a finding): the core "same list" claim between `compose()`'s own `unchecked` and `uncheckedForRevision` is not merely tested on 6 shapes — it's guaranteed by construction, since both call sites route through the identical `uncheckedFor` over the same candidate pool and semantically-identical `placedIds`. The dead-branch removal (`untilDeparture === null ⟺ dates.kind === "open"`) checks out independently against `daysUntilDeparture` in `dates.ts:103-109`.
- `selectPlans`' `GROUP BY plans.id` with non-aggregated `title`/`created_at`/`updated_at` is safe: those columns are functionally dependent on `plans.id` (one row per id on the "one" side of the join), so SQLite's bare-column extension can't pick an inconsistent value.
- Untrusted input (candidate titles, summaries, source titles/URLs) reaches the DOM only through React text nodes (auto-escaped) and a schema-restricted `https?` `href`; no `dangerouslySetInnerHTML` anywhere in `PlanView.tsx`/`Provenance.tsx`. No `console`, no `any`, `import type` and relative `.ts` extensions used throughout the diff.
- NFR: security ✓ (no new subprocess/fetch of user URLs; existing SSRF/redaction paths untouched; DOM escaping verified) · performance ✓ (derivation is O(candidates), no re-pack, indexed list query) · reliability ✓ (transactional pin, defensive `REVISION_NOT_FOUND` mapping) with the two low-severity latent gaps noted above for Phase 4 · maintainability ✓ with the currency-behavior-change note above being the one place the Log's account is incomplete.

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

**`03-STATUS.md` was held, then rebased onto and written.** PR #42 was rewriting
that file's ticket table when this branch opened, so it was left alone until #42
merged; this branch then rebased onto it and wrote the pl-10 half — Phase 2
complete, the routes, the plan-view paragraph, and the unchecked-list paragraph
that pl-10 made false.

**What is left in that file belongs to pl-18 (#43) and is unclaimed at the time
of writing:** line 40's "version 2, 37 questions" (version **3** now, same 37),
line 52's "stops at the core questions" (which wants the same softening the
`CLAUDE.md` rule got, because `core` no longer means needed), and the
"`REQUIRED_SHAPE_SLOTS` and the tree's `core` marking now agree ... in both
directions" claim at 243-248, which is the one most likely to be missed because
it sits far from the summary. Agreed with the pl-18 session that **whoever lands
last writes them**, and that is the right rule for a second reason: an amendment
describes code, so it cannot land before the branch that moves the code.

**The test-count line is branch-local and must be re-measured, not copied.**
This branch's `**512 unit tests pass across 40 files**` is true of #44 alone;
pl-18's is 491 over 37, true of #43 alone. Main was 479 over 37 before either.
Whoever lands second **runs the suite and reads the number off it** — the
arithmetic says 524 over 40, and arithmetic is not a measurement of the thing
anyone can check in thirty seconds.

**Not done: an e2e spec.** The brief did not ask for one and the suite is two
specs over the intake on purpose — branch coverage costs milliseconds in a
component test and a browser launch there. The plan view's claims are asserted in
`web/test/plan-view.test.tsx` (15 tests) against the real components.

512 tests pass in the planner project, 1078 across the repo, `npm run check`
green.

### 2026-08-16 — answering the review

The gate above came back **CONCERNS** and is appended unedited. What I changed
in response, and what I did not.

**Two defects the gate's own `code-review` pass surfaced that did not make the
section, both real and both fixed.** Recording them here rather than editing the
reviewer's table, which is not mine to rewrite.

- **`App.read()` cleared `watching`, so closing a plan reached from a finished
  run re-opened the wizard.** The two ways into a plan are the list and a
  finished run's "Read the plan"; clearing the run meant backing out fell
  through to `openIntake` still being set, and an already-drafted trip started
  asking its questions again with the run's outcome no longer reachable. One
  line, and it was mine — I added that path. **Fixed with no regression test:**
  `App.tsx` has never had a suite, and standing one up needs three client-module
  mocks and would collide with pl-18's `Wizard.tsx`. A known gap, stated rather
  than papered over.
- **A failed pin threw the whole loaded document away.** The `.catch` reused the
  page-level `failed` state, so one stale item replaced the rendered plan with a
  bare message — and the error most likely to arrive there is `ITEM_NOT_FOUND`,
  whose own copy tells the reader to _reload the plan and see the current
  draft_. That was the one response making its own advice impossible to follow.
  Now a separate `pinFailed` reports beside the document. Asserted in
  `web/test/plan-view.test.tsx`.

**The two `med` findings.**

- **The fixed-price branch is now tested, and the interpretation is stated.**
  `low === high` renders as "20 EUR, a posted price". The acceptance line is
  about no _estimate_ being shown as one figure, and the contract allows
  `low === high` deliberately as a **different claim** — a museum's posted
  admission is a quote, legitimately. The reviewer is right that this was an
  untested reading of the line; it is a decision, so it now has a test naming it
  as one. Keeping the figure and labelling it beats rendering "20–20", which
  would read as an estimate.
- **"Pinning from the UI" stays `unproven (gate)`, and that is the honest
  state.** The web test mocks the API client, because this repo's rule is that
  the fake is the client module and never `fetch`; the HTTP test proves persist
  and no-revision. The two meet at a mocked seam, so neither proves the sentence
  end to end. Closing it properly means an e2e spec, which the brief did not ask
  for and which costs a browser launch in CI — **that is a scope call for a human,
  not one to take quietly**, so the row stays as the reviewer wrote it.

**The two `low` findings, both accepted and neither fixed.**

- **The currency behaviour did change, and the Log was incomplete.** The old code
  looked placed ids up in `season.kept`; the new code uses the full candidate
  list. They differ for exactly one input — a candidate pinned in a previous
  revision whose season falls outside the trip, which is placed because a pin
  outranks the season filter but is absent from `kept`. The new answer is the
  correct one: a placed item's currency counts. It is unreachable until Phase 4
  wires re-plan, which is why no test covers it, and it should get one when that
  lands.
- **`updateItemPin` scopes by plan, not by latest revision**, so once a second
  revision exists a pin aimed at a superseded item will succeed and do nothing.
  Also Phase 4's, and left deliberately: narrowing it now would be guessing at
  what re-plan wants from pinning, and the affordance is unreachable today
  because the UI only ever renders the latest revision's items.

**One reuse point from the same pass, fixed:** `humanise` had been copied into
`web/src/plan/format.ts` from `web/src/wizard/format.ts`. Now re-exported, so
the rule has one home.

514 tests in the planner project, 1080 across the repo, `npm run check` green.

### 2026-08-16 — the status page, as the branch landing last

pl-18 (#43) merged and main came into this branch, which settles the hand-off
the two sessions agreed: **this branch is last, so the pl-18 half of
`03-STATUS.md` is written here.** Four sites — the tree is version 3 (37
questions unchanged), "stops at the core questions" is now "stops at the
checkpoint" because `core` no longer means needed, pl-18 has a ticket-table row,
and the "`core` marking and `REQUIRED_SHAPE_SLOTS` agree in both directions"
paragraph is rewritten: pl-18 kept one direction and deliberately dropped the
other, so a `core` node whose slot is not required is legal now rather than a
tree error.

**The counts were measured, not copied, and it is as well.** The agreement was
that whoever landed last runs the suite; the two branches' own figures were 512
over 40 here and 491 over 37 there, my arithmetic predicted 524, and the real
answer after the merge is **526 over 40** in the planner project and **1092 over
79** repo-wide. Every one of the three numbers on offer was wrong.
