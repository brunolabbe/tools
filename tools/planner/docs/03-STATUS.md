# Status — planner

Where the planner stands. Phases live in [02-ROADMAP.md](./02-ROADMAP.md); what
each piece of work did lives in its ticket under [work/](./work/).

**Last updated:** 2026-08-22 · **Phase 0 (scaffold) ✅ · Phase 1 ✅ — the
`TripBrief`, the question tree, and the persistence and wizard over them, driven
end to end in a browser. The tool produces a brief with no model involved
anywhere. Phase 2 now produces a plan: as of [pl-16](./work/pl-16-the-plan-run.md)
a run started over HTTP fans out, composes and persists a revision, streams its
progress over SSE, and can be canceled in a way that reaches the provider, and as
of [pl-10](./work/pl-10-plan-view-and-provenance.md) that plan can be read — its
days, which lines were verified, what it does not cover and what nothing checked.
Phase 2 is complete. What is missing is grounding (Phase 3), whose travel-time
slice was ticketed on 2026-08-22 as pl-24 through pl-28 and none of which is
started.**

---

## Where things stand

| Phase                    | State                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold       | ✅ complete           | `0f8583e`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Phase 1 — The intake     | ✅ complete           | [pl-3](./work/pl-3-trip-brief-contract.md), [pl-6](./work/pl-6-question-tree-and-engine.md) and [pl-7](./work/pl-7-intake-persistence-and-wizard.md) — the brief, the tree, and an intake that survives a reload                                                                                                                                                                                                                                                    |
| Phase 2 — The first plan | ✅ complete           | [pl-4](./work/pl-4-plan-document-contract.md), [pl-9](./work/pl-9-composer-and-critic.md), [pl-16](./work/pl-16-the-plan-run.md) and [pl-10](./work/pl-10-plan-view-and-provenance.md) and [pl-5](./work/pl-5-orchestrator-and-fan-out.md) all done — the plan document, the composer, the fan-out, the run that joins them over HTTP and stores what comes back, and the view that reads it honestly                                                               |
| Phase 3 — Grounding      | ticketed, not started | [pl-24](./work/pl-24-grounding-seam-and-fixtures.md) the seam and its fixture default, [pl-25](./work/pl-25-grounding-cache.md) the cache, [pl-27](./work/pl-27-travel-time-reaches-the-composer.md) travel time into the composer, [pl-28](./work/pl-28-valhalla-adapter.md) Valhalla behind it, [pl-29](./work/pl-29-detours-along-a-leg.md) detours along a leg — plus [pl-26](./work/pl-26-lift-the-ssrf-guard.md) filed but deliberately not part of the slice |
| Phase 4 — Revision       | designed only         | no tickets yet, on purpose                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**The tool is not a chat, as of 2026-08-14.** It was scaffolded as one. The
intake now asks predetermined questions from an authored, versioned tree, and no
model participates in it — a model is involved later, in the fan-out. The
reasoning, including what the decision costs, is an amendment to
[00-ANALYSIS.md §3](./00-ANALYSIS.md), which had argued the opposite; the
argument was kept and overridden rather than rewritten.
[pl-1](./work/pl-1-conversation-loop.md) was dropped without being started.

**526 unit tests pass across 40 files, plus 4 e2e specs.** `npm run check` is
green. Seven of the repo-wide tests in `packages/core` are
[pl-17](./work/pl-17-dockerfile-workspace-scan.md)'s — see the paragraph below.
The repo-wide CI runs the unit suite on every push, and
`.github/workflows/planner.yml` now carries two gates — the e2e suite in a real
browser, and the image, which is built, started, and asked for both `/api/health`
and the page. Both are path-filtered, so downloader work does not pay for them.

What exists: the error taxonomy, the `TripBrief` and its schemas, the question
tree and the engine over it (`@planner/intake` — version 3, 37 questions, reachability,
invalidation, brief assembly, answer validation, all pure), the plan document —
`Candidate`, `Provenance`, `Plan`, `PlanRevision`, `PlanDay`, `PlanItem`,
`PlanGap`, with migration 2 behind it and a checked-in candidate set per trip
shape — the `ModelProvider` seam with the scripted provider behind it, **the
fan-out: `@planner/agent`'s roster table, seven specialists behind one interface,
a per-run budget that degrades the roster before anything is sent, and
`runFanOut` over them** — an API
that opens SQLite, answers `/api/health` and serves the UI same-origin, **an
intake that persists — `intakes` and `answers` from migration 3, four routes over
them, and a wizard that stops at the checkpoint and never discards an answer
without saying so** — a container image the release pipeline publishes, and **the
composer: `@planner/itinerary`, which turns a brief and a candidate set into a
plan revision** (season filter, day packer, budget arithmetic over bands,
constraint check, bounded critic, all pure) — and **the run: `plan_runs` from
migration 4, an in-process queue with `MAX_CONCURRENT_RUNS`, `POST /api/plans`
behind a per-client rate limit, `GET /api/plans/:id`, `POST /api/runs/:id/cancel`
and `GET /api/runs/:id/events` over SSE, with the whole `runFanOut` → `compose` →
`appendRevision` sequence persisted and a progress view over it** — and **the
plan view: `GET /api/plans` for the list, a `PlanView` on the detail route
carrying what nothing checked alongside the document, `POST
/api/plans/:id/items/:itemId/pin` for the one write that appends no revision, and
the React view over all three**.

**P1 is reached.** Someone can answer into a branch, be told the essentials are
done, go back and change an early answer, be shown exactly what that costs, and
reload to find the intake where they left it — with no model involved anywhere,
which is what makes the whole claim checkable without a key. Two Playwright specs
assert that whole paragraph against the built bundle.

**A plan can be read, as of [pl-10](./work/pl-10-plan-view-and-provenance.md).** A
list of plans, and one document: the latest revision's days in order — a dateless
day rendering by its index, because a flexible-dates trip has no calendar and
inventing one is the thing `PlanDay.date` is nullable to prevent — each item
resolved against the plan's candidates, legs carrying both ends, provenance
marked separately on a candidate and on its cost because a real place with a
guessed price is the common case, costs as bands and never as a figure, the gaps
in the plan's own body, and what nothing checked beside the days. Pinning is
there and appends no revision, which the database enforces from below. The diff
is Phase 4 and is deliberately absent; the revision count is surfaced read-only.

What does not exist: grounding of any kind, and any hostname pointing at the
image.

**Nothing in the contract describes a conversation any more.**
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) deleted the
`Conversation` / `Message` types, their three zod schemas, `MAX_MESSAGE_CHARS`
and `CONVERSATION_NOT_FOUND` — the vocabulary that outlived the tables migration
3 dropped. An unknown URL now answers `NOT_FOUND` from `@webtools/core`, which is
about a route rather than a document. Migration 1 still creates the tables and
migration 3 still drops them: applied migrations are history and are not edited.

**The documentation leads the code by one phase**, down from four: Phases 1 and 2
are built, and a plan is produced and read end to end. That gap is the intended state after a design
pass and a liability if it lasts, so read
[00-ANALYSIS.md](./00-ANALYSIS.md) and
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md) as _design_ rather than as
description — everything they say about specialists, grounding and revision is
still unwritten.

## Open tickets

<!-- generated:tickets -->

<!-- Written by `node scripts/status.mjs --write`, which runs on `main` after a merge.
     Do not edit this region: a ticket's frontmatter is what it is generated from, and a
     branch that edits it here is the merge conflict ADR 003 exists to end. -->

### Milestones

| Milestone      | Done | Open | Dropped | State       |
| -------------- | ---- | ---- | ------- | ----------- |
| P1             | 5    | 0    | 0       | complete    |
| P2             | 7    | 0    | 0       | complete    |
| P3             | 0    | 6    | 0       | not started |
| _no milestone_ | 9    | 1    | 1       | in progress |

### Open tickets

| Ticket                                                    | Kind         | Status    | Milestone | What it is                                                                  |
| --------------------------------------------------------- | ------------ | --------- | --------- | --------------------------------------------------------------------------- |
| [pl-2](./work/pl-2-container-image.md)                    | chore        | in-flight | —         | Ship the planner as a released image on its own subdomain                   |
| [pl-24](./work/pl-24-grounding-seam-and-fixtures.md)      | work-package | ready     | P3        | The grounding seam, its fixture default, and the state a run grounds in     |
| [pl-25](./work/pl-25-grounding-cache.md)                  | work-package | ready     | P3        | Cache grounding with a TTL that varies by kind                              |
| [pl-26](./work/pl-26-lift-the-ssrf-guard.md)              | work-package | ready     | P3        | Lift the SSRF guard to packages/core when a second tool actually fetches    |
| [pl-27](./work/pl-27-travel-time-reaches-the-composer.md) | work-package | ready     | P3        | Measure the legs, pack under them, and stop naming travel time as unchecked |
| [pl-28](./work/pl-28-valhalla-adapter.md)                 | work-package | ready     | P3        | A real routing backend behind the seam, self-hosted                         |
| [pl-29](./work/pl-29-detours-along-a-leg.md)              | work-package | ready     | P3        | Find what is worth stopping for along a leg                                 |

<details>
<summary>Closed — 22 tickets</summary>

| Ticket                                                      | Kind         | Status  | What it was                                                                       |
| ----------------------------------------------------------- | ------------ | ------- | --------------------------------------------------------------------------------- |
| [pl-1](./work/pl-1-conversation-loop.md)                    | work-package | dropped | The conversation loop, end to end                                                 |
| [pl-3](./work/pl-3-trip-brief-contract.md)                  | work-package | done    | The trip brief, in the contract                                                   |
| [pl-4](./work/pl-4-plan-document-contract.md)               | work-package | done    | The plan document — candidates, days, revisions, pinning                          |
| [pl-5](./work/pl-5-orchestrator-and-fan-out.md)             | work-package | done    | The orchestrator and the specialist fan-out                                       |
| [pl-6](./work/pl-6-question-tree-and-engine.md)             | work-package | done    | The question tree, and the engine that walks it                                   |
| [pl-7](./work/pl-7-intake-persistence-and-wizard.md)        | work-package | done    | The intake — persistence, routes, and the wizard over them                        |
| [pl-8](./work/pl-8-model-provider-seam.md)                  | chore        | done    | Rename the chat seam to a model seam                                              |
| [pl-9](./work/pl-9-composer-and-critic.md)                  | work-package | done    | The composer and the critic — the itinerary package                               |
| [pl-10](./work/pl-10-plan-view-and-provenance.md)           | work-package | done    | The plan view — days, gaps, and what was actually verified                        |
| [pl-11](./work/pl-11-retire-the-conversation-vocabulary.md) | chore        | done    | Retire the conversation vocabulary, and name an unknown endpoint properly         |
| [pl-12](./work/pl-12-render-the-wizard-in-tests.md)         | chore        | done    | Render the wizard's components in tests, not only the routes under them           |
| [pl-13](./work/pl-13-drive-the-intake-end-to-end.md)        | chore        | done    | Drive the intake end to end, and gate it in CI                                    |
| [pl-14](./work/pl-14-tree-content-review.md)                | work-package | done    | Review the question tree as content — budget, drive appetite, vehicle             |
| [pl-15](./work/pl-15-candidate-legs.md)                     | work-package | done    | A candidate is at a place or runs between two                                     |
| [pl-16](./work/pl-16-the-plan-run.md)                       | work-package | done    | The plan run — a job, its progress, and the plan it writes                        |
| [pl-17](./work/pl-17-dockerfile-workspace-scan.md)          | chore        | done    | A Dockerfile's workspace list is maintained by memory                             |
| [pl-18](./work/pl-18-destination-asked-early.md)            | work-package | done    | Ask where they are going third, and let it be blank                               |
| [pl-19](./work/pl-19-pin-through-the-browser.md)            | work-package | done    | Prove pinning through the browser, not at a mocked seam                           |
| [pl-20](./work/pl-20-intake-fixture-builders.md)            | chore        | done    | One builder for a saved intake, instead of three copies of its SQL                |
| [pl-21](./work/pl-21-name-the-bare-fields.md)               | chore        | done    | Four field kinds render an input a screen reader cannot name                      |
| [pl-22](./work/pl-22-pin-scoped-to-the-revision-shown.md)   | fix          | done    | A pin is scoped to the plan, not to the revision the reader was looking at        |
| [pl-23](./work/pl-23-pinned-out-of-season-currency.md)      | chore        | done    | A pinned out-of-season candidate's currency changed meaning, and nothing tests it |

</details>

<!-- /generated:tickets -->

## Known gaps and risks

**Pinning is proven across the middle as of
[pl-19](./work/pl-19-pin-through-the-browser.md).** It was proven at each end and
not between them: the component test proves the button and mocks the API client —
this tool's rule, not a shortcut — and the route test proves the write persists
and appends no revision, so the two composed into the claim only if the client
module did what its type said. `e2e/pin.spec.ts` pins through a real browser
against the real API, **reloads**, comes back to the plan from the list, and finds
it still pinned with the version line unchanged. The seam was real: a mutation
that flips the item in React state and never calls the route passes the component
test unchanged and is caught only after the reload.

Pinning remains the **only write in this API that mutates a stored revision**,
permitted by one column of one table, which is why it is the write most worth a
browser. The proof is a gate rather than a suite — it runs in
`.github/workflows/planner.yml` and not in `npm test` — which is what pl-10's row
meant by `unproven (gate)` rather than `unproven`, and it stays true of the proof.

**The image serves the UI as of
[pl-13](./work/pl-13-drive-the-intake-end-to-end.md).** `WEB_DIR` had been parsed
in `api/src/config.ts` and set by the `Dockerfile` since pl-2, and nothing read
it, so the container was an API with a bundle it never handed out — invisible
throughout, because `/api/health` answered perfectly and that was all anything
asked for. `api/src/routes/web.ts` now serves it same-origin, and the workflow
asks the running container for the page as well as for health. That closes
[pl-2](./work/pl-2-container-image.md)'s "serves the UI" acceptance, which was
the thing this had falsified.

**The image's workspace list is no longer kept by memory.**
[pl-17](./work/pl-17-dockerfile-workspace-scan.md) added
`packages/core/test/image-closure.test.ts`, which walks the workspace graph from
each tool's `api` manifest and asserts both hand-kept `Dockerfile` lists against
it — the manifests copied **before `npm ci`**, and the `package.json` + `dist`
pair per workspace in the runtime stage — in both directions, plus the rule that
makes the walk trustworthy: a workspace imported under `src` is declared in that
package's own `dependencies`. It found nothing to fix, because pl-16 had already
fixed the planner by hand and the downloader was correct, so its value is
prospective and it was proved by breaking both Dockerfiles on purpose — see the
ticket's log for the mutations. **It does not replace the image gate**: a scan
over text cannot prove the container boots.

The scan is also written not to pass by having looked at less. It reads without
asserting, so a `Dockerfile` it cannot parse is a named failing test rather than
a suite that will not load; a `readdir` that fails for any reason other than the
directory not existing is raised rather than read as empty; and two workspaces
claiming one name are reported rather than shadowing each other. Those three
came out of the ticket's own review gate, which found the scan making the
mistake the ticket was written about.

**The wizard's components render in tests as of
[pl-12](./work/pl-12-render-the-wizard-in-tests.md).** `tools/planner/web/test`
holds 21 tests over the wizard and all eight controls, on the same `web`
compiler surface the downloader's suite uses and with the DOM arriving per file
as `// @vitest-environment jsdom`. The two rules that live in the UI are now
asserted in both places and for different reasons: pl-13's e2e proves the seams
over one path through the tree, and these prove the branches — a `core` question
offering no way to decline it, a discarded answer with no prompt reading as a
sentence rather than an id, and a half-filled `dates` or `budget` staying
unsubmittable.

**No owner model.** Every visitor shares one store and can read and edit
everyone's intakes, and the list route shows all of them. That is the honest gap
rather than one to paper over with an unguessable id — see the traps in
[pl-2](./work/pl-2-container-image.md).

**The plan's constraints are enforced, and the plan says which ones were not.**
`@planner/itinerary` filters on season before packing, bounds a day by the
party's own effort and drive answers, sums cost bands without ever collapsing
one to a figure, drops anything past its booking deadline, and refuses to ship a
plan that violates a hard constraint — `PLAN_INFEASIBLE`, kept carefully
distinct from a plan with a `PlanGap`, which ships. What it _cannot_ evaluate
comes back as `UNCHECKED_CONSTRAINTS` on the result rather than as silence.

**Phase 2 does not pack under travel time, and that is now decided rather than
open.** `Place.coordinates` is null until grounding and §5 puts distances in
Phase 3, so a leg has no measured length. (Until
[pl-15](./work/pl-15-candidate-legs.md) it had no ends either; that half is
closed and this one is not.) Decided 2026-08-16: **pack without it
and name the gap**, which narrowed the P2 milestone's wording — see the
roadmap. Every plan carries `travel-time` on its unchecked list, without
exception, and a test per trip shape says so. Daily distance (backcountry) and
machine range (motorised) are unchecked for the same reason.

**The unchecked list survives a reload, and is not stored.** It was the
composer's return value and nothing else until
[pl-10](./work/pl-10-plan-view-and-provenance.md), so a plan read back out of the
database had lost it — and since travel time is on every plan, losing it turned
an honest plan into one that merely looks finished. pl-9 left two ways to close
that: persist it behind a new `PlanGapReason` member that is about a constraint,
or re-derive it by re-composing on read. **Neither was taken.** The list is a
function of the brief, the candidates and which of them were _placed_, and a
stored revision says which were placed — so `uncheckedForRevision` derives it
from the revision being read. That beats storing it, which would let a stored
list disagree with the days beside it, and beats re-composing, which re-runs the
packer against today's `limits.ts` and today's date. It also made the derivation
clock-free, which is what makes the claim hold at all. The argument for why
`PlanGap` still cannot carry it is in
[pl-9](./work/pl-9-composer-and-critic.md)'s log, and it is unchanged — the two
types stay separate.

**Deal-breakers are not machine-checkable, and §7 assumed they were.**
`dealBreakers` is free text, so no arithmetic decides whether a candidate
violates one, and a keyword match would fail both ways while looking like a
check. The composer states it as unchecked and the specialists that read the
brief carry it. Making it real means a structured constraint on the brief, not a
cleverer string search over the free-text one. Recorded as an amendment to
[00-ANALYSIS.md §7](./00-ANALYSIS.md), which had claimed otherwise — the second
section of the analysis to be overridden by building the thing it describes.

**A candidate can now say where it goes, not only where it is.**
[pl-15](./work/pl-15-candidate-legs.md) replaced `Candidate.place` with
`Candidate.location`, a union of `at` a place and `between` two, and moved the
six checked-in sets onto it. Nothing consumes the endpoints yet — `travel-time`
is still unchecked on every plan — so this is a claim about what is
representable and not about what is true. It was taken before pl-5 because a
route specialist that puts its endpoints in prose is the shape the fixtures had,
and fixing it afterwards would cost a re-run of every stored candidate rather
than six files. Three things it unblocks and none of which is built: travel
time between consecutive items, a detour weighed off a leg, and conditions along
one corridor rather than another.

Two findings from it are worth carrying: **the field had no reader anywhere in
the tool** before this — the packer buckets by `specialist`, so a candidate's
location was written and never consulted, which is why a breaking union was
cheap — and **the fixtures already carry coordinates on eleven places**, four of
them on route candidates. "Coordinates are null until Phase 3" is true of what
the tool produces, not of what pl-4 checked in.

**Something produces candidates now, and they are placeable.**
[pl-5](./work/pl-5-orchestrator-and-fan-out.md) closed the half of this that was
about the fan-out: a roster table, seven specialists behind one interface, and
`runFanOut` over them, answered offline by 48 checked-in scripted candidates. The
finding that came with it is closed too — **an appetite answer bounds what a
specialist may propose**, so a leg longer than the day allows is split rather
than written, and the fan-out refuses one that is not. `agent/test/placeable.test.ts`
composes the real output for all six briefs and asserts that every rostered
schedulable specialist gets at least one candidate onto a day; it also asserts
that `CANDIDATE_LIMIT_OF` and `@planner/itinerary`'s `BUCKET_OF` still agree,
which is the one thing `agent` had to restate to avoid depending on `itinerary`.

**The run exists, and the two halves of Phase 2 now meet over a wire rather than
in a unit test.** [pl-16](./work/pl-16-the-plan-run.md) added `RunStatus` and its
transition table, one `RunProgress` payload the agent emits and `web` renders,
the `RunEvent` envelope `api` stamps a clock onto, `plan_runs`, the queue, the
routes and the progress view. `agent/test/placeable.test.ts` still composes the
real fan-out for all six briefs; what changed is that it is no longer the only
place that does.

**`core` marks when a question is asked, not whether it is needed** — changed by
[pl-18](./work/pl-18-destination-asked-early.md), and the reason this paragraph
no longer says the two agree in both directions. It used to: a `core` question
whose slot was not required failed `validateTree`, and so did a required slot no
`core` question filled. pl-18 kept the second direction and **deliberately
dropped the first**, because `destination` has to be asked early and be
declinable at the same time — a combination the old equivalence made
unrepresentable. So `stage` is position and `isRequiredSlot(node.fills)` is
need, and a `core` node whose slot is not required is now legal rather than a
tree error. The half that still holds is enforced: a required slot nothing asks
for still fails the tree, and a route test still asserts the checkpoint and
`missingRequiredSlots` agree on the same intake. Anything reading `node.stage`
to infer "the user had to answer this" is wrong as of pl-18.

**A model reply is untrusted input**, and from Phase 3 a grounded source is
hostile text. As of pl-5 this is enforced rather than intended: `askSpecialist`
validates every reply against `candidateSchema.omit({id, specialist})`, re-asks
once with the parse failure fed back, and raises `AGENT_MALFORMED_REPLY` past the
attempt budget. `id` and `specialist` are omitted deliberately — a model that
named its own would be able to lie about who proposed something, which is the one
field `Candidate` carries so that question stays answerable. A specialist still
has no credentials and no tools, so there is nothing yet for a hostile page to
reach; that is Phase 3's to keep true.

**The budget is in force, both halves of it.** `RunBudget` is a required argument
to `runFanOut` and `applyBudget` degrades the roster from the back of
`SPECIALIST_ORDER` before anything is sent, recording each cut as a
`specialist-dropped-for-budget` gap. As of pl-16 `api` fills it from
`MAX_SPECIALISTS` and `RUN_TOKEN_BUDGET` — the latter **divides down into a
specialist count** rather than stopping a run partway, because a run that
discovered its ceiling halfway through would have paid for a plan it cannot ship
— and `MAX_CONCURRENT_RUNS` bounds the queue. The DoS half is in force too:
`POST /api/plans` is rate-limited per client, and the token bucket behind it
moved to `@webtools/core` when this tool became its second real consumer.

**At `MAX_SPECIALISTS = 5` the budget specialist is always the one dropped**, on
each of the three shapes that roster six. Reviewed as content in pl-16 and
**kept**: the cap has to stay a constraint something actually reaches (§9 — "run
every specialist every time is not the design"), the composer sums the cost bands
in code whether or not a budget specialist ran, and the drop is a
`specialist-dropped-for-budget` gap on the stored revision rather than a silence.
A test asserts the degradation on a `multi-city` brief, so the path stays
exercised rather than becoming theoretical.

**The transcript risk is gone**, not deferred — there is no transcript, so nothing
is re-sent turn over turn. The per-run budget replaces it as the cost control, and
`MAX_MESSAGE_CHARS` — the ceiling that bounded one turn of the thing that no
longer exists — went with pl-11.

**The error codes the design needs are all in.** The intake's half: `BRIEF_INCOMPLETE`
for a brief too thin to draft from (pl-3), `INVALID_ANSWER` for an answer that
does not fit its question (pl-6, mapped to 400), `INTAKE_NOT_FOUND` for a missing
intake (pl-7, mapped to 404 — deliberately not `PLAN_NOT_FOUND`, which is a
different aggregate that fails at a different time), and a recorded decision that
the flexible-date cases need no code beyond `INVALID_DATES` — same cause, same
sentence, different `details`. The plan's half arrived with pl-4:
`PLAN_INFEASIBLE` (the composer could not build one at all, as distinct from
building one with holes) and `REVISION_NOT_FOUND` (a stale link to an addressable
revision sends a user to the plan, not to the list). A failed specialist is
deliberately **not** an error: it is a `PlanGap` on the revision, and the plan
ships.

`TRIP_NOT_FOUND` and `CONVERSATION_NOT_FOUND` are both gone. The first because
the vocabulary is settled (a trip is the journey, a plan is the document) and the
code is now `PLAN_NOT_FOUND`; the second with
[pl-11](./work/pl-11-retire-the-conversation-vocabulary.md), which could only
remove it by giving `registerNotFoundHandler` something true to raise instead.
That is `NOT_FOUND`, and it is **core's**: this tool and the downloader had each
re-worded their nearest domain code to describe a missing route, which is the
second consumer the lifting rule asks for. The downloader's call site is still
wrong and is [dl-17](../../downloader/docs/work/dl-17-name-an-unknown-endpoint.md),
not this tool's to fix.

**The `AGENT_*` codes are the planner's, provisionally.** They belong in
`@webtools/core` the day a second tool talks to a model.

**The SSRF guard is the downloader's.** The planner becomes its second real
consumer the first time it fetches a URL a search result handed it; that is when
it lifts to `packages/core`, not by copy-paste before then.

**The rate limiter is no longer the downloader's.** pl-16 answered the
second-consumer question the other way, because a plan run is a roster of model
calls and needed one for real: `RateLimiter`, `clientKey` and `ConcurrencyGate`
now live in `@webtools/core/rate-limit`, and each `api` keeps its own
`createRateLimitHook` — refusing means throwing _that_ tool's `AppError` through
_that_ tool's logger, which is the part that was never shared. It has its own
subpath rather than the barrel because it imports `node:net` and core's root is
in every `web` bundle's graph by way of the contracts.

**The run queue was weighed for the same lift and stayed put.** The downloader's
`InProcessJobQueue` is the same shape, but its `QueuedTask` is keyed on a job and
it aborts with the downloader's `AppError` — and the error a cancellation carries
is the one thing about a queue that is not generic. `01-ARCHITECTURE.md` had
already committed this tool to "an in-process queue, as the downloader chose",
which is the same decision rather than the same code. A third consumer is when to
pay for the type parameter.

## Running things

```bash
npm run dev:planner            # API (8090) + web (5183), both in watch mode
npm run dev:planner:api        # just the API
npm run dev:planner:web        # just the UI
npm test -- --project planner
npm run check

npm run e2e:install            # once, for the browser
npm run e2e:planner            # the intake, in Chromium, against the built bundle
```

Ports are 8090/5183 rather than 8080/5173 so both tools can run at once. The e2e
suite takes 8098 and its own database under `e2e/.artifacts/`, so it does not
collide with either, and it starts the API itself — there is nothing to have
running first.
