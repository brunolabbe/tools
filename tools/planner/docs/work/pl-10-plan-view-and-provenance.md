---
id: pl-10
tool: planner
title: The plan view — days, gaps, and what was actually verified
kind: work-package
status: ready
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

_Not started._
