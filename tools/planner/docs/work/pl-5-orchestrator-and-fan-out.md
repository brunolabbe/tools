---
id: pl-5
tool: planner
title: The orchestrator and the specialist fan-out
kind: work-package
status: done
milestone: P2
depends_on: [pl-4, pl-15]
---

# pl-5 — The orchestrator and the specialist fan-out

**Packages:** `agent`, `api` (and `web` for run progress)

## Why

This is the ticket where the tool becomes what it claims to be: a brief goes in,
the specialists that trip actually needs run on it, and candidates come out. The
roster being **a pure function of the brief** rather than a chain of conditionals
is the whole design ([00-ANALYSIS.md §4](../00-ANALYSIS.md)) — a resort week does
not need a route specialist, a skidoo weekend lives or dies on conditions, and a
specialist with nothing to say costs money and pads the plan.

It stops before composing. Packing days is arithmetic and belongs in
`itinerary`, in ordinary TypeScript with ordinary tests (§2).

## Build

1. **The roster as a table.** `rosterFor(brief)` maps trip shape and brief
   contents to a specialist list, as data — a table a test asserts against. If it
   becomes conditionals inside the orchestrator, "which agents ran and why" stops
   being answerable, which is the question anyone debugging a bad plan asks first.
2. **The specialists**, sharing one shape: brief in, `Candidate[]` out, prompt and
   output schema per specialist. Start with the three that carry the most trips —
   **route & logistics**, **lodging**, **activities** — and add conditions & gear,
   food, budget and practicalities behind the same interface. A specialist that
   proposes a schedule is a bug, not a feature.
3. **Fan out in parallel, join once.** The specialists depend on the brief and not
   on each other, so the run costs the slowest rather than the sum. The join
   before composing is a real barrier — the composer cannot pack a day without
   every candidate.
4. **The run is a job**, on `@webtools/core`'s transition machinery, with SSE:
   `queued → fanning-out → composing → reviewing → done | failed | canceled`.
   Progress is per-specialist and genuinely knowable, because the roster's size is
   fixed before the fan-out starts. Report `null` where a total is not known
   rather than inventing one.
5. **A per-run budget, enforced before the fan-out, not during it.** Cap the
   roster, the grounding calls and the tokens; degrade the roster to fit and record
   which specialists were dropped (§9). Discovering the ceiling mid-fan-out means
   paying for half a plan.
6. **Partial results are shipped with the gap named.** One specialist failing or
   timing out must not fail the run: the plan says "lodging was not checked". The
   repo's _never fake progress_ rule in this domain — a quietly invented hotel is
   worse than an admitted hole (§7).
7. **Every specialist reply is schema-validated** before anything acts on it, with
   a bounded re-ask inside the agent and `AGENT_MALFORMED_REPLY` past it. Specialists
   get no credentials and no write tools; from Phase 4 on they are reading hostile
   text (§5), and the habit has to exist before the grounding does.
8. **Scripted specialists for CI.** Extend the scripted provider so each
   specialist has a deterministic answer for the checked-in briefs from pl-3. The
   whole fan-out must run offline with no key.

Traps worth knowing in advance:

- **A specialist sees the brief and only the brief** — not the raw answers, not
  the tree, not another specialist's output. There is no transcript to be
  tempted by any more, but the rule predates that and outlives it: threading
  anything larger multiplies the bill by the roster size, and the `TripBrief`
  indirection is what makes a specialist testable from a fixture at all.
- **A brief arrives with its `refine` slots unknown**, and that is the normal
  case rather than a degraded one. The wizard stops at core-complete and offers
  the draft there (decided 2026-08-14, see the roadmap's _Still open_), so the
  first plan is usually built from the minimum. Specialists must read an unknown
  slot as unknown and say what they could not account for — never guess a value
  and never refuse to propose. pl-3's three-state slot makes this identical to
  the declined case, which is the point: there is one path, not two.
- **Season filtering happens before the composer**, not inside it: a candidate
  outside its own season window should never reach packing (§7).
- **A specialist that ignores the brief's appetite answers writes candidates the
  composer throws away.** Found by [pl-9](./pl-9-composer-and-critic.md) on
  2026-08-16, composing the six checked-in fixture sets: the route candidates are
  routinely over the day's drive budget and get dropped. The road-trip fixture
  proposes a 5½-hour leg to a party that answered `half-day`, and the resort
  fixture a 5-hour transfer — so a road trip comes out with no drives in it and a
  `no-candidates-found` gap where its route should be. The composer is right to
  refuse them; the fix is upstream. **`driveAppetite`, `pace` and `effort` are
  constraints on what a specialist may propose, not context for its prose**, and
  the numbers those answers translate into are in `itinerary/src/limits.ts`. A
  leg longer than the day allows has to be split or not proposed.
- **The composer is built and it takes the gaps from here.** `compose()` in
  `@planner/itinerary` accepts a `gaps` array and carries it onto the revision
  untouched, because it cannot tell "never on the roster" from "failed" — those
  are this ticket's to know. It adds only `no-candidates-found`, for a
  schedulable specialist that returned candidates and got none of them onto a
  day. It also returns an `unchecked` list that **does not persist**; see
  [pl-10](./pl-10-plan-view-and-provenance.md).
- **A route candidate is a leg, and a leg has two ends.** `Candidate.location`
  is a union as of [pl-15](./pl-15-candidate-legs.md): `at` a place, or
  `between` two. A route specialist that returns `at` has put its endpoints in
  its prose, which is the shape the fixtures had before pl-15 and the shape a
  model will produce again unless the prompt and the output schema both say
  otherwise. Travel time, a detour off a leg, and conditions along one corridor
  rather than another are all unbuildable without both ends — none of them is in
  this ticket, and all of them are foreclosed by getting this wrong here.
- **Cancel must kill the whole fan-out.** In-flight provider calls take the
  `AbortSignal` that `ModelRequest` already carries.

## Done when

- `rosterFor` is table-driven and tested per trip shape, including a shape where a
  specialist is deliberately absent.
- **Every candidate the route specialist returns is a `between`**, asserted per
  checked-in brief. The fixture side of this is already asserted in
  `contract/test/fixtures.test.ts`; this is the same rule held against the
  fan-out's own output.
- A run against the checked-in briefs produces candidates from every rostered
  specialist, streams per-specialist progress, and survives one specialist being
  made to fail — with the gap present in the output and no fabricated content.
- The budget path is tested: a roster that exceeds the cap is degraded before the
  fan-out and the drop is recorded.
- Nothing in this ticket packs a day or writes a schedule.
- **The candidates a specialist returns are placeable.** For each checked-in
  brief, `compose()` over the fan-out's output places at least one candidate from
  every rostered schedulable specialist, or the test says which one it dropped and
  why. This is the assertion that catches a specialist ignoring `driveAppetite`,
  and it is cheap because the composer is already pure.
- `npm run check` and `npm test -- --project planner` pass.

## Review

**Gate: CONCERNS** — 2026-08-18 · `origin/pl-17-image-closure...origin/pl-5-close-and-pl-21` (PR #50, commits `bcb46fe`, `c36ad74`) · code-review at medium

Range reviewed is docs-only: `tools/planner/docs/02-ROADMAP.md`, `tools/planner/docs/03-STATUS.md`, `tools/planner/docs/work/pl-5-orchestrator-and-fan-out.md`, and new `tools/planner/docs/work/pl-21-name-the-bare-fields.md`. `packages/core/test/image-closure.test.ts` and the Dockerfile edits belong to pl-17 and were not touched here.

| Done when                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rosterFor` table-driven, tested per shape incl. one deliberately absent                                                                                           | `agent/test/roster.test.ts:20` (per-shape), `agent/test/roster.test.ts:86` (food absent, backcountry) ✓                                                                                                                                                                                                                                             |
| Every route candidate returned is `between`, per checked-in brief                                                                                                  | `agent/test/placeable.test.ts:112,123` ✓                                                                                                                                                                                                                                                                                                            |
| Run over checked-in briefs: candidates from every rostered specialist, per-specialist progress, survives one specialist failing with gap named, nothing fabricated | `agent/test/fan-out.test.ts:51` (candidates), `:85` (progress), `:105,:122` (failure → gap, no fabrication) ✓ — wire-level SSE progress is pl-16's, landed on `main` (`09bd161`), outside this diff                                                                                                                                                 |
| Budget path tested: over-cap roster degraded before fan-out, drop recorded                                                                                         | `agent/test/budget.test.ts:26,47,74`; `agent/test/fan-out.test.ts:206` ✓                                                                                                                                                                                                                                                                            |
| Nothing in this ticket packs a day or writes a schedule                                                                                                            | `agent/test/fan-out.test.ts:75` ✓                                                                                                                                                                                                                                                                                                                   |
| Candidates placeable: `compose()` over fan-out output places ≥1 candidate from every rostered schedulable specialist, or names the drop                            | `agent/test/placeable.test.ts:77` ✓                                                                                                                                                                                                                                                                                                                 |
| `npm run check` and `npm test -- --project planner` pass                                                                                                           | Verified directly: `npm run check` exit 0; `npm test -- --project planner` → 40 files / 526 tests passed, matching `03-STATUS.md`'s own count — but only after `npm run build`; a bare `npm test` on the fresh worktree failed 35/40 files on `@planner/contract` resolution, exactly the "build before you test" trap `docs/01-TICKETS.md` names ✓ |

- **med** · `pl-5-orchestrator-and-fan-out.md:325-330` contradicts itself: "Every `Done when` line on this ticket was already met by the 2026-08-16 entry" is followed three sentences later by "What that entry could not claim — that a run streams per-specialist progress over a wire — is pl-16's." The Done-when line at `:117-118` requires streaming, and the entry it cites explicitly says that was _not_ built by pl-5. The underlying substance is fine (pl-16 landed it, verified on `main`), but a reader taking the opening sentence at face value believes pl-5 met its own acceptance unaided. Two finders converged on this independently.
- **med** · `02-ROADMAP.md:197-210`'s "Still open" list has broken nesting — the replacement paragraph is indented two spaces with no blank line and no `- ` marker, so CommonMark treats it as a lazy continuation of the preceding bullet ("Whether a specialist streams"). Rendered, the resolved `RunStatus`/`RunProgress`/`MAX_SPECIALISTS` answers appear to belong to that bullet, making the one item that is genuinely still open (streaming) read as answered. Three finders independently confirmed this by rendering it. Fix is a `- ` prefix or a blank line before the paragraph.
- **med** · `pl-21-name-the-bare-fields.md`'s trap "`number-list` renders more than one input" is factually wrong — `web/src/wizard/controls.tsx`'s `NumberList` renders exactly one `<input>` parsing comma-separated values, the same shape as `TextList`. A future implementer either re-verifies a false claim or builds an unneeded per-item `aria-labelledby` scheme.
- **med** · The `RunProgress`/`RunEvent` contract shape and the `MAX_SPECIALISTS = 5` "kept" verdict are each now restated in full in four places (`pl-16`'s Log, `03-STATUS.md`, the new `02-ROADMAP.md` prose, and pl-5's new Log), against `docs/01-TICKETS.md`'s "02-ROADMAP links to tickets; it does not describe work" and root `CLAUDE.md`'s "roadmap and status pages are deliberately too thin to hold it." `03-STATUS.md`'s bare-fields paragraph is likewise now a second copy of `pl-21`'s own Why section, which is content's rightful home as of this diff.
- **low** · The Done-when bullet at `pl-5:117-118` is left unstruck/unannotated while `status` flips to `done`, so a reader checking that specific line against pl-5's own work has to first find the log entry rather than the ticket telling them directly.
- **low** · `pl-21`'s Why section says pl-12 left the accessible-name gap alone "rather than widening that ticket's diff"; pl-12's actual stated reason was that pl-16 was editing `web/src` in parallel — a concrete, now-moot reason that got dropped in the retelling.
- **low** · `pl-5:317-323` argues the same close-vs-rescope point twice in consecutive sentences.
- **dropped** · A finder flagged `status: in-flight → done` with no `## Review` section as bypassing `docs/01-TICKETS.md`'s review gate. A second finder rebutted it with direct precedent: `docs/01-TICKETS.md`'s "a review appends... and never moves status" restricts _reviews_, not authors, and `pl-16` is `status: done` with no Review section either, closed the same way by a dated Log entry. The rebuttal is correct — dropped.
- **dropped** · A finder noted the ROADMAP edit drops the analogy "a number to argue with as content, the way `limits.ts` is" with no replacement, but flagged it only as a minor rhetorical loss, not a correctness or placement issue — not worth a severity line.

Invariants walked: **contract not edited unilaterally** — this diff touches no contract file; the decision itself is recorded in `pl-16`'s Log (`RunStatus`, `RunProgress`/`RunEvent`, routes, `Run`, all additive), which merged to `main` at `09bd161`, so the record shows the decision being _made_, not just deferred. **Documentation placement** — all edited/added files sit under `tools/planner/docs/`; nothing added to root `docs/`; no cross-tool document. **Ticket format** (`docs/01-TICKETS.md` vs `pl-21`) — frontmatter complete and correctly typed, section order matches, `Review` correctly absent, `depends_on: [pl-12]` satisfied (pl-12 is `done`), id `pl-21` not previously used (ids run `pl-1`…`pl-20` before this). Skipped as n/a for a docs-only diff: spawn safety, credential redaction, SSRF checks, kill-process-trees.

NFR: security n/a (docs-only) · performance n/a (docs-only) · reliability n/a (docs-only) · maintainability — the four `med` findings are all maintainability concerns (a self-contradicting closing narrative, a broken-render doc bug, a wrong technical claim seeding a future ticket, and duplicated content across four files that the repo's own convention says should stay thin and link instead).

## Log

### 2026-08-16 — the library half is built; the run-as-a-job half is blocked on the contract

`@planner/agent` now does everything from the brief to the candidate set. What is
**not** built is the run as a persisted job with an SSE surface, and the reason is
below rather than in a commit message, because it is a decision somebody has to
make rather than work somebody has to do.

**Branched off pl-15 (PR #31), not off `main`.** `Candidate.location` is the
union pl-15 introduced and every route candidate here is `between` two places.

#### What landed

- **`roster.ts` — the roster as a table.** Nine rows, each naming a specialist, the
  shapes it has something to say about, a named condition and the sentence that
  put it there. `rosterFor(brief)` filters; it decides nothing. Every specialist
  that does **not** run comes back with the sentence that kept it out, and those
  become `specialist-not-applicable` gaps — the reassurance half of §7.
- **`budget.ts` — the cap, enforced before the fan-out.** `applyBudget` cuts from
  the back of `SPECIALIST_ORDER`, which is the judgement about what a plan loses
  least by losing; `rosterGaps` turns the cut into
  `specialist-dropped-for-budget`. A cap of zero is honoured rather than clamped.
- **`specialists.ts` — one shape for all seven**, plus `TripCapacity` and
  `CANDIDATE_LIMIT_OF`.
- **`prompt.ts` — the brief, and only the brief**, rendered with every unanswered
  slot shown as `not answered` and nothing defaulted.
- **`ask.ts` — one specialist call**, with the reply validated against
  `candidateSchema.omit({id, specialist})` and a bounded re-ask that feeds the
  parse failure back. `AGENT_REFUSED` is terminal, a `length` stop is re-asked
  with that said, and past the attempts it is `AGENT_MALFORMED_REPLY`.
- **`orchestrator.ts` — `runFanOut`.** Parallel, joined once, per-specialist
  progress, gaps for everyone who did not contribute, and cancellation that kills
  the whole thing.
- **`providers/scripted-fan-out.ts` — 48 checked-in candidates**, keyed by trip
  shape and specialist, so the whole fan-out runs offline with no key.

#### Decisions worth carrying

**`agent` does not import `@planner/itinerary`, and the ceilings are an
argument.** The brief is right that the numbers a specialist must respect are in
`itinerary/src/limits.ts`, and `01-ARCHITECTURE.md`'s dependency table says
`agent` depends on `contract`. Both are kept: `runFanOut` takes a **required**
`TripCapacity`, and a caller writes
`{ dayCount: tripSpan(dates).dayCount, ...dayCapacity(brief) }`. Required rather
than optional on purpose — a caller who forgets it writes the exact bug pl-9
found, and forgetting should be a compile error.

The one thing that had to be restated is which of the day's two budgets a
specialist's output is charged to, which is `itinerary`'s `BUCKET_OF` seen from
the proposing side. It is `CANDIDATE_LIMIT_OF`, and the drift is not left to
care: `placeable.test.ts` imports both tables and asserts they agree.
`@planner/itinerary` is therefore a **devDependency** of `agent`, used by two
test files and by no production file.

**The scripted provider answers by name.** Every specialist prompt opens with
`Trip shape: <shape>` and `Specialist: <id>`, which the model needs anyway — a
specialist that does not know which specialist it is answers as all of them — and
which `readMarkers` reads back. `ScriptedProvider` looks the pair up in
`SCRIPTED_FAN_OUT` and falls through to its plain reply list for anything else,
so the existing script behaviour is untouched. A pair with no entry gets an empty
list, never a plausible one.

**The turn counter is not advanced for a fan-out reply.** Specialists run
concurrently, so "the third reply" would depend on which of them the event loop
reached first, and a script that differs per run is not a script.

**Ids are derived, not generated.** `<runId>-<specialist>-<n>`, the same argument
the composer's day ids make: this package has no clock and no randomness, so the
same run composed twice produces the same plan.

**A cancellation is not a gap.** "Lodging was not checked because you stopped the
run" would leave a canceled draft looking like a completed one with holes, so the
per-specialist catch rethrows a cancellation instead of recording it.

#### What the brief got wrong, and what composing turned up

- **`depends_on` said `[pl-4]`.** It is `[pl-4, pl-15]` in practice and the
  front matter now says so — every route candidate here is `between` two places
  and none of this compiles against `Candidate.place`.
- **pl-4's resort fixture has a `route-and-logistics` candidate, and §4 says it
  should not exist.** "A resort week needs lodging, food and practicalities, and
  a route specialist would produce noise about airport transfers" is the
  analysis's own sentence, so the roster has no route row for `resort` — which
  means the fixture's 5-hour Ottawa→Cancún transfer is a candidate this fan-out
  would never propose. pl-9 separately found that the composer drops it. Two
  independent mechanisms agreeing that a candidate should not be there is a
  reason to believe the roster, not the fixture; the fixture is pl-4's realistic
  _candidate set_ rather than a claim about who ran, so it is left alone.
- **At the architecture's `MAX_SPECIALISTS` default of 5, the budget specialist
  is dropped on every six-specialist shape** — backcountry, motorised-touring and
  multi-city. That is the cap working as designed and it is recorded as a gap on
  each of those plans, but it is worth a content review: the default was chosen
  before there was a roster to apply it to, and "budget is always the one we
  cannot afford" is a sentence somebody should either accept or change the number
  over.
- **`empty-day` is common and it is honest.** Composing the scripted fan-out
  leaves five empty days of eight on the resort week and six of thirteen on the
  multi-city trip, because the script proposes a handful of good options rather
  than one per day. Soft findings, they ship, and they are a fair description of
  what a scripted provider knows.
- **A plan can still be `PLAN_INFEASIBLE` from the cost side and it very nearly
  was.** The resort script proposes two properties, the packer places each as its
  own day's anchor, and the party is charged for both — two low ends summed past
  the 7,000 CAD budget. The critic's first round drops the dearest and the plan
  ships, so nothing fails; but "propose two hotels for one week and be billed for
  both" is a real modelling gap between what a lodging specialist means and what
  the packer does with it. Not this ticket's to fix — it is a property of
  `BUCKET_OF`'s one-anchor-per-day rule — and it is written down here because the
  next person to see a doubled hotel bill should not have to rediscover it.

#### What is not built, and why it stopped here

Build steps 4 (the run as a job with SSE) and the `web` progress view are **not
done**. Both need `@planner/contract` to grow, and the preamble for this ticket
is explicit that the contract is not to be edited unilaterally — the repo's rule
and this ticket's instructions agree, so the work stopped at the seam rather than
crossing it.

Concretely, the remaining half needs four additions to the contract, none of
which changes anything that exists:

1. **`RunStatus` and its `TransitionTable`** — `queued → fanning-out → composing
→ reviewing → done | failed | canceled`, on `@webtools/core`'s machinery. It
   belongs in `contract` for the reason the downloader's job FSM does: `web`
   renders the state and `api` enforces it, and neither should own it.
2. **A `RunEvent` union and its zod schema** — the SSE frames. The
   per-specialist shape is already settled and tested as `FanOutProgress` in
   `@planner/agent`; the wire type is the same information plus a run id and a
   timestamp, and the agent's version should probably be dropped in favour of it
   rather than mapped between.
3. **`ROUTES.plans`, `ROUTES.plan`, `ROUTES.runEvents`** and their url helpers.
4. **A `Run` summary type** for `POST /api/plans`'s response.

The api-side work behind those is: migration 4 for a `plan_runs` table (migration
2 already has `plans`, `plan_candidates`, `plan_revisions`, `plan_days` and
`plan_items`, and its comments already anticipate pl-5 adding the run a candidate
came from), an in-process queue bounded by `MAX_CONCURRENT_RUNS`, the SSE route,
and `createModelProvider`'s existing seam passing `RUN_TOKEN_BUDGET` and
`MAX_SPECIALISTS` down as the `RunBudget` this package already takes. None of it
is large; all of it is downstream of the contract question.

It is [pl-16](./pl-16-the-plan-run.md), split out rather than left as a checklist
on a ticket whose other seven steps are done — the format doc's own advice.
**Which of the four the contract should carry is that ticket's first step and is
deliberately not answered there either**: it names the options and the argument
each way, which is as far as this work can honestly go.

The brief above is left as it was written rather than trimmed to match, the way
§3 and §7 are kept and overridden rather than rewritten. This ticket stays
`in-flight` until somebody who owns the roadmap decides whether it closes here,
with step 4 and the `web` half now pl-16's.

#### Green

`npm run check` passes. `npm test -- --project planner` is 421 tests across 31
files, 85 of them new here.

#### The fence pattern was a ReDoS, and CodeQL caught it

CodeQL failed the PR on `extractJson`: `/```(?:json)?\s*\n(...)/` is polynomial,
because `\s` matches a newline and so `\s*\n` gives the engine two ways to consume
every line of a fence that never closes. Measured before the fix, on `"```\n"`
followed by `"\n "` repeated: 20k repetitions took 226ms, and it is quadratic, so
60k is seconds and the reply size that stalls the event loop is not large.

The run of whitespace is now `[^\S\n]*` — horizontal only, `\r\n` still handled —
and the ambiguity is gone. What makes this worth a paragraph rather than a
one-line diff is that it is _this package's own rule_ biting: a model reply is
untrusted input, and the pattern that reads it was one a stranger's reply could
choose the cost of. The regression test in `agent/test/ask.test.ts` asserts a
time bound rather than a result, which is the only thing that would fail if the
`\s*` came back.

### 2026-08-18 — closed here, with step 4 and the `web` half owned by pl-16

The previous entry left this `in-flight` on one open question and named who had
to answer it: _"until somebody who owns the roadmap decides whether it closes
here"_. Decided on 2026-08-18 — **it closes here.**

Nothing was built for this entry and nothing needed to be. The two things this
ticket stopped short of are both done, under the ticket that was split out to
carry them: [pl-16](./pl-16-the-plan-run.md) answered the contract question
(`RunStatus` and its transition table, one `RunProgress` payload the agent emits
and `web` renders, the `RunEvent` envelope `api` stamps a clock onto, the routes
and the `Run` summary), then built `plan_runs`, the queue, the SSE route and the
progress view on top of it. Phase 2 is complete as of pl-10.

**Why this is a close-out and not a re-scope.** The alternative was to widen this
ticket's `Done when` to say "or pl-16 does it", which would leave two files
claiming the same work and neither able to be read on its own. The split was the
right call and the format doc recommends it; what was left undone was the
bookkeeping. So the brief above is unchanged — including its Build steps 4 and the
`web` half, which this ticket did not do — and this entry is the record that they
were done elsewhere rather than dropped.

Every `Done when` line on this ticket was already met by the 2026-08-16 entry:
`rosterFor` is table-driven and tested per shape, every route candidate is a
`between`, the budget path degrades and records it, nothing here packs a day, and
`placeable.test.ts` composes the real fan-out for all six briefs. What that entry
could not claim — that a run streams per-specialist progress over a wire — is
pl-16's, and it holds there.

The one finding this ticket raised and left open was resolved elsewhere too:
**`MAX_SPECIALISTS = 5` drops the budget specialist on every six-specialist
shape**, reviewed as content in pl-16 and **kept**, because the cap has to stay a
constraint something actually reaches, the composer sums the cost bands in code
regardless, and the drop is a `specialist-dropped-for-budget` gap on the stored
revision rather than a silence.
