---
id: pl-25
tool: planner
title: Cache grounding with a TTL that varies by kind
kind: work-package
milestone: P3
status: done
depends_on: [pl-24]
---

# pl-25 — A distance is good for a year; an opening time is good for a day

**Packages:** `api` (migration 5, the cache, the config).

## Why

[00-ANALYSIS.md §5](../00-ANALYSIS.md): **grounding is where the latency and the
bill live, and a plan revision re-asks most of the same questions.** Phase 4 is
built entirely out of re-asking them — a re-plan of three days reads the same
brief, the same pinned items and most of the same places — so a cache is not an
optimisation bolted on afterwards, it is what makes revision affordable.

[01-ARCHITECTURE.md](../01-ARCHITECTURE.md) already decided the shape and the
reasoning is worth not re-litigating: **a table, not a service.** It must survive
a restart, because a distance is good for a year and re-measuring the same road
every boot is the whole cost this exists to avoid; and it must be inspectable,
because the first question about a plan citing something surprising is "what did
we read, and when".

## Build

1. **Migration 5 — `grounding_cache`.** Append; never edit a shipped migration,
   and read the note above migration 3 for why that rule is written down. Keyed
   by `(kind, key)` where `kind` is the seam's method and `key` is the
   normalised question — a place name for `locate`, an ordered endpoint pair
   plus mode for `travel`. Columns for the payload, the `Source` behind it,
   `fetched_at`, and `expires_at`.

   **Normalise the key deliberately and write down what the normalisation
   drops.** Case and surrounding whitespace, yes. Anything else and two
   different questions start sharing an answer, which is a cache that lies
   rather than a cache that misses.

   **The key comes from a candidate a model wrote, so any in-memory index over
   it must be a `Map` and never a plain object.** pl-24's review found this the
   expensive way: its gazetteer was `Record<string, Coordinates>`, and
   `{}["constructor"]` is a function rather than `undefined`, so a place called
   "Constructor" came back located, and the leg to it came back measured at
   zero. A SQLite row is not exposed to that, but the read-through map in front
   of it and any per-run memo would be. See pl-24's log.

2. **`expires_at` is computed on write, from the kind.**
   `GROUNDING_CACHE_TTL_*` in the architecture's config table, hours for an
   opening time and months for a distance. Storing the deadline rather than
   computing it on read means a TTL change does not retroactively resurrect or
   kill what is already in there, and it makes the table answerable by a plain
   `SELECT` — which is the inspectable half of the decision above.

3. **`fetchedAt` on the `Source` comes from the cached row, never from `now()`.**
   The single sharpest trap in this ticket. `Source.fetchedAt` is documented in
   `contract/src/candidate.ts` as the thing that decides whether a fact may
   still be shown — stamp a cache hit with the current time and every cached
   fact claims to be fresh, the TTL becomes decorative, and the plan view's
   "verified" marking starts asserting something nobody checked today. A cache
   hit is the same fact, read at the same moment it was read the first time.

4. **A hit is not a call.** `MAX_GROUNDING_CALLS` (pl-24 step 8) is a bill
   control, and a hit costs nothing, so the budget counts misses. Say it in the
   code, because "calls" in the variable name reads the other way.

5. **Eviction is a `DELETE` of expired rows**, on boot and after a run.
   Deliberately not a background timer: this process already has a queue and a
   shutdown path, and a timer is a thing to leak in tests.

6. **Wrap the provider, do not thread the cache through it.** The cache is a
   `GroundingProvider` that holds another one — so pl-28's adapter never learns
   about SQLite, the fixture provider is cacheable for free, and a test can
   assert the wrapped provider was called exactly once for two identical
   questions. That last assertion is the whole ticket in one line.

## Done when

- Two identical lookups in one run hit the underlying provider once; asserted by
  a counting fake, not by timing.
- A cached fact's `Source.fetchedAt` is the original fetch time after a
  round-trip through the table — asserted with an injected clock that has moved
  between the write and the read.
- An expired row is not served, and is gone after eviction runs.
- A cache hit does not decrement the run's grounding budget; a miss does.
- A key of `constructor`, `__proto__` or `toString` misses like any other unknown
  question, rather than returning something that is not an answer.
- `locate` and `travel` for the same place text differing only in case and
  surrounding whitespace share a row; anything else the normaliser touches is
  named in a test.
- Migration 5 applies to a database at `user_version = 4` and the existing
  suites still pass against a fresh one.

## Review

**Gate: PASS** — 2026-08-23, on the third pass. Three gates over two days:
**FAIL** (2026-08-22) → **CONCERNS** (2026-08-23) → **PASS** (2026-08-23), each
`review-ticket` over `origin/main...HEAD`, delegating the defect hunt to
`code-review`. The verdicts are left as they were given rather than rewritten by
the round that fixed them — a gate that edits itself once the work is done
records nothing.

Recorded here by the builder, not the reviewer: a reviewer's worktree is
discarded when it finishes, so a gate that lives only there did not happen.

| Done when                                                                                                                         | Proof                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two identical lookups in one run hit the underlying provider once; by a counting fake, not by timing                              | `api/test/grounding-cache.test.ts:230` "costs one `locate` call, not two", `:241` "costs one `travel` call, not two", `:287` "a matrix it holds in full costs no call at all" ✓                                                                                    |
| A cached fact's `Source.fetchedAt` is the original fetch time, with a clock that moved between write and read                     | `:305` "carries the original fetch time, not the time it was served", `:321` "…through a `travel` cell too" ✓                                                                                                                                                      |
| An expired row is not served, and is gone after eviction runs                                                                     | `:339` "does not serve a row that has aged out", `:382` "an expired row is gone once eviction runs", `:394` "eviction leaves what is still good alone" ✓                                                                                                           |
| A cache hit does not decrement the run's grounding budget; a miss does                                                            | `:502` "a miss spends a call and a hit does not", `:517` "a matrix the table holds in full spends nothing", `:589` "a hit still answers once the budget is spent" ✓                                                                                                |
| `constructor` / `__proto__` / `toString` miss like any other unknown question                                                     | `:657` `test.each(["constructor", "__proto__", "toString", "valueOf"])` "%s misses like any other unknown place" ✓                                                                                                                                                 |
| `locate` **and** `travel` share a row on case and surrounding whitespace; anything else the normaliser touches is named in a test | `:693` "case and surrounding whitespace: one row, one call", `:708` "the same three, on `travel`, at both ends of the leg", `:721` "and one row is what that costs the table, not two"; and `:704`, `:742`, `:750`, `:758`, `:765`, `:770`, `:776` name the rest ✓ |
| Migration 5 applies to a database at `user_version = 4`; existing suites pass against a fresh one                                 | `api/test/migrations.test.ts:58` "migration 5 applies to a database at `user_version = 4`"; `schema.test.ts` and `migrations.test.ts` moved 4→5 with insertions only ✓                                                                                             |

Every claim was reproduced by hand at the third gate: each fix reverted to
confirm its test goes red, the branch-point baseline re-run independently
(574 across 43 files), and the `@ts-expect-error` probes checked in both
directions (`TS2578` when the narrowing is undone).

### Gate 1 — FAIL, 2026-08-22

The design held — migration 5, `PRIMARY KEY (kind, key)`, the normalisation, the
populated-database migration test and all three gate claims reproduced, and two
of the three disclosed decisions were upheld. The defects were in the shape of
one seam and in what was untested.

- **high · fixed** — a budget refusal and "nobody knows" were the same `null` at
  every per-lookup layer; `refused` as a per-run scalar only asks the caller not
  to collapse them. Replaced by a discriminated `GroundingOutcome<T>`.
- **med · fixed** — `FIXTURE_FETCHED_AT` frozen against a 4,320-hour TTL meant
  every fixture `travel` answer arrived already expired from 2027-02-18: cache
  off, every lookup spending budget, no red test and no log line.
- **med · fixed** — the acceptance clause names `locate` **and** `travel`; only
  `locate` was proven.
- **med · fixed** — the TTL clamp was unexercised in both directions.
- **med · fixed** — "however that run ended" ran only the happy path.
- **low · fixed** — the eviction call in the run's `finally` was unguarded.
- **low · fixed** — a dead comment in migration 5 named a `groundingKey` that
  never existed.
- **low · fixed** — `groundingForRun` dispatched on `instanceof` and fell back
  silently.
- **low · fixed** — a test asserted the opposite of its own name.
- **accepted, no action** — not caching negatives (confirmed it cannot hot-loop:
  every re-ask goes through the budget), and the amplified matrix cost that
  comes with it.

### Gate 2 — CONCERNS, 2026-08-23

The seam held under probing: mixed, fully-refused, zero-budget and
hit-plus-refused matrices, with no path found that collapses refusal into
unknown or the reverse. `travelOutcome` throwing `INTERNAL` was judged correct
and idiomatic. All nine prior findings confirmed fixed rather than papered over.
All three new findings were in the **wiring** rather than in the seam.

- **med · fixed** — `RunGroundingSource extends GroundingProvider`, so
  `context.grounding.locate(…)` still compiled and spent no budget: the
  un-budgeted door, one level above the seam that exists to close it.
- **med · fixed** — the boot sweep was unguarded, so a `SQLITE_BUSY` on that
  DELETE stopped the service booting.
- **med · fixed** — `createGroundingProvider` built the fixture provider on its
  _default_ clock while the cache took the injected one, re-arming the time bomb
  the provider had just been fixed for.
- **low · fixed** — "the seam's own methods never refuse" asserted only a call
  count.
- **low · fixed** — the eviction guard had no test and flattened its cause.
- **low · fixed** — `FIXTURE_TABLE_WRITTEN` was a dead export.
- **dropped by the reviewer** — prepare-per-cell in `#travel`'s read loop (house
  style in `db/runs.ts` and `db/intakes.ts`, not introduced here), and
  `UNKNOWN`/`REFUSED` being unfrozen singletons (every consumer is TypeScript).

### Gate 3 — PASS, 2026-08-23

Seven lows, four swept in the round below and three deferred with reasons.

- **low · fixed** — the boot-sweep guard was the only one of six fixes without a
  test.
- **low · fixed** — `cache.ts`'s header still said everything above the seam
  "sees the seam and nothing else", which the narrowing had made the opposite of
  true.
- **low · fixed** — the claim that an unguarded throwing `finally` "would
  discard a completed run's result" was overstated in three places: the run row
  is committed before `execute` returns and the queue releases the slot, so what
  the guard actually buys is the suppression of a spurious, misattributed error
  line.
- **low · fixed** — `answered`, `UNKNOWN` and `REFUSED` were exported with no
  consumer outside the file.
- **low · comment corrected, code unchanged** — the `key` column embeds a NUL,
  so storage, comparison and lookup are exact but `length()`, `substr`, `LIKE`
  and most database browsers truncate at it. Migration 5 sold the table as
  answerable by "one `SELECT` against these five columns"; it now says what is
  true. The separator is deliberately unchanged — pl-27 builds `placeIdentity`
  on this format.
- **low · deferred** — the N×M `#store` log lines, latent until pl-27 calls
  `travel`.
- **low · deferred** — `01-ARCHITECTURE.md`'s `GROUNDING_CACHE_TTL_*` row still
  reads "varies" and predates the two variables that now exist.

- NFR: security — the cache fetches nothing itself; keys come from model-written
  text and every index over them is a `Map` or a SQLite row, with control
  characters stripped so no name can forge a separator; sources are
  schema-validated before storage; no credential reaches a log line ·
  performance — a hit costs one indexed `SELECT`, a partial matrix re-asks only
  the rows and columns it is missing, and eviction is a single indexed `DELETE`
  · reliability — both sweeps are guarded, expiry is enforced on read rather than
  trusted to the sweep, and a row that no longer parses reads as a miss rather
  than poisoning every run that touches it · maintainability — the refused /
  unknown distinction is carried by the type system rather than by comments, and
  the narrowing that keeps it that way is enforced by the same gate that
  typechecks the source

## Log

**2026-08-22 — built.** Migration 5, the caching provider, its TTLs and the two
eviction points. Nothing calls `locate` or `travel` in production yet — that is
still pl-27 — so this ticket's whole surface is the seam it wraps and the table
behind it.

`grounding_cache` is `PRIMARY KEY (kind, key)` with `payload_json`,
`source_json`, `fetched_at` and `expires_at`, plus an index on `expires_at` for
the sweep. `CachingGroundingProvider` in `api/src/grounding/cache.ts` is a
`GroundingProvider` holding another one, wired in `createApp` around whichever
backend the config named — including one a test injected, on purpose, so a test
exercises the path production runs.

**`fetched_at` is the fact's own fetch time, not the row's write time, and
`expires_at` is computed from it.** The brief says the deadline is computed on
write; it does not say from which instant, and the two choices are not
equivalent. Running the TTL from the write time would let an answer a backend
read in January be served as good for a year from whichever boot first asked for
it. Running it from `Source.fetchedAt` gives the row one timestamp that means one
thing — which is also what makes step 3 structurally true rather than carefully
remembered: there is no second candidate for `Source.fetchedAt` on the way out,
because the column _is_ it. It also makes pl-24's note come true as written —
the fixture table's frozen `FIXTURE_FETCHED_AT` ages, and those facts age out
like any others rather than being eternally fresh. The base is clamped to `now`
so a backend with a fast clock cannot extend its own TTL.

**A `null` is not cached, and that is a decision the brief did not make.** It has
no `Source`, so the two columns that make the table inspectable would be empty; a
real backend's `null` is as often a gap in _its_ coverage today as a fact about
the world; and its lifetime is a number nobody has argued for. The cost is
stated in the file header rather than discovered later: a question nobody can
answer is re-asked every time, and there is a test asserting exactly that. If it
shows up as a bill, the fix is a negative TTL argued for in the architecture's
configuration table like every other one.

**"A hit is not a call" needed a shape, because a budget cannot both refuse and
stay silent.** `GroundingBudget.claim` deliberately does not throw and the
planner taxonomy has no code for "out of budget" — correctly, since pl-24 says
what a run skipped for want of budget is a `PlanGap` and not an error. So the
budget is spent _inside_ the cache: `groundingForRun(provider, budget)` returns a
`RunGrounding`, which is a cache whose inner provider claims one call before each
call it makes. A hit never reaches that layer and never spends. The composition
is the argument — a budget wrapped _around_ a cache charges for hits and looks
identical at the call site. A refusal makes no call, answers as the table alone
can, and increments `refused`, which is the number pl-27 needs to tell "we could
not afford to ask" from "nobody knows" — those must not collapse into the same
`null`.

**`travel` caches per cell and re-asks only the sub-matrix it is missing.** Every
missing cell has its row in the wanted-origins set and its column in the
wanted-destinations set, so their product covers all of them in one call, and the
extra cells it picks up are ones the next revision would have paid for. A matrix
it holds in full costs no call at all.

**What the normaliser drops is written down and each item has a test**: case,
surrounding whitespace, repeated whitespace inside, and control characters — the
last because a NUL joins the parts of a key and a name carrying one could
otherwise be answered with a different pair's row. It does **not** strip accents,
punctuation or abbreviations: `placeKey` in the fixture provider strips accents
and that is its business — deciding whether its own small table holds an answer
is not the same act as deciding two questions are one question.

Eviction is a `DELETE`, on boot in `createApp` and in the run task's `finally` in
`startRun` — not inside `execute`, which is pl-27's, and skipped while shutting
down so a closing database cannot turn a finished run into a logged task
rejection. Both are asserted end to end, the boot one against a file database
because the claim under test is that the table outlives the process.

Migration 5's own test winds a fresh database back to `user_version = 4` rather
than hand-writing one, unlike `atVersionOne` in `schema.test.ts`: migration 4 is
an `ALTER TABLE` on top of three others, so a hand-written version-4 schema would
be a fourth copy of the whole thing and the first to rot. What it proves is that
migration 5 is appended and arrives on a database that already ran 1 through 4.

**For pl-27:** `context.grounding` is the cache, typed as the plain seam.
`groundingForRun(context.grounding, groundingBudget(config.maxGroundingCalls))`
is the per-run provider — one entry point whether or not a cache is in the way —
and `refused` on what comes back is the count of lookups the budget would not
pay for. It is a `PlanGap`, not an `UncheckedConstraint` and not a `null`.

**611 in the planner suite (574 before), 1205 repo-wide, `npm run check` green.**
Nothing existing changed meaning; `migrations.test.ts` and `schema.test.ts` moved
from `user_version = 4` to `5` and gained `grounding_cache` in their table lists.

**2026-08-23 — review round.** The gate failed the branch. The design held —
migration 5, `PRIMARY KEY (kind, key)`, the normalisation, the populated-database
migration test and all three gate claims all reproduced — and two of the three
disclosed decisions were upheld. What failed was the shape of one seam and a set
of untested branches.

**A refusal and "nobody knows" were the same `null`, and a per-run counter is not
enough.** `refused` told a caller _how many_ lookups the budget turned down, and
nothing told it _which_. With a ceiling of forty and forty-five places, lookups
forty-one to forty-five came back `null` and pl-27 would have written "nothing
established where this is" against five places nobody asked about — the exact
collapse the first log said must not happen. Asking the caller not to cause it is
not a design.

So the per-run seam no longer answers `T | null`:

```ts
type GroundingOutcome<T> =
  | { readonly kind: "answered"; readonly value: T }
  | { readonly kind: "unknown" }
  | { readonly kind: "refused" };

interface RunGrounding {
  readonly name: string;
  locate(request: LocateRequest): Promise<GroundingOutcome<LocatedPlace>>;
  travel(request: TravelRequest): Promise<TravelOutcomeMatrix>;
  readonly refused: number;
}

function groundingForRun(source: RunGroundingSource, budget: GroundingBudget): RunGrounding;
```

`TravelOutcomeMatrix` is `readonly (readonly GroundingOutcome<TravelEstimate>[])[]`
— **per cell, not per call**, because one call is genuinely mixed: a revision
that adds a stop is answered from the table for the pairs it already holds and
refused for the ones it does not, inside the same matrix. `travelOutcome(matrix,
origin, destination)` is the accessor, and it **throws `INTERNAL`** where
`travelCell` returns `null`: the three outcomes are statements about the world,
and an index nobody sent is a statement about the caller, so folding it into
`unknown` would put "we asked and nobody knew" against a pair nobody asked about.

**None of it touches `@planner/contract` or the seam in `@planner/agent`.**
`GroundingProvider` still answers `T | null` and `CachingGroundingProvider` still
implements it — flattening loses nothing there, because a caller with no budget
has no refusal to lose. The union lives in `api/src/grounding/cache.ts` beside
the thing that produces it.

**`groundingForRun` no longer dispatches on `instanceof`.** It takes a
`RunGroundingSource` — a `GroundingProvider` that can also hand out a per-run
view — and `AppContext.grounding` is typed as one. The old shape fell back to a
plain budgeted wrapper for anything that was not literally the cache, so a second
decorator around the cache would have gone on compiling and quietly started
charging the budget for hits. Now that mistake does not typecheck.

**The fixture provider was a time bomb, and the brief's own reasoning was the
fuse.** pl-24 froze `FIXTURE_FETCHED_AT` at `2026-08-22` and the first round of
this ticket called that a feature — "these facts age out like any others". With a
travel TTL of 4,320 hours it means that on **2027-02-18** every fixture `travel`
answer arrives already expired: nothing caches, every lookup is a miss, every
miss spends budget, and the drop branch in `#store` returned silently. `locate`
would have followed on 2027-08-22. A checked-in date plus a lifetime is a bomb
whichever pair of numbers you pick. `FixtureGroundingProvider` now takes a clock
(defaulted, injected in tests) and stamps `fetchedAt` with it — the honest
reading of the field, since the provider really did consult its table just now,
and nothing about it pretends to be a measurement: the host still cannot resolve
and the title still says what it is. `FIXTURE_TABLE_WRITTEN` remains as
documentation and nothing reads it as a timestamp.

**That silent branch now logs**, `warn` with the `fetchedAt` and the TTL, and
`debug` when the TTL is zero — which is a deployment turning the cache off on
purpose rather than a fault. Both are asserted against a recording logger.

Also fixed, all from the gate:

- **The acceptance clause says `locate` _and_ `travel` share a row on case and
  whitespace**, and only `locate` was proven. `travelKey` now has both the key
  assertion (at both ends of the leg, and on the locality) and a table assertion
  — one row and one call for the same leg spelled two ways.
- **The clamp was never exercised in either direction**, because the counting
  fake stamped every answer with the current clock. It takes a stamp offset now:
  a backend claiming a time in the future cannot extend its own TTL, and one
  claiming a time long past does not get a full lifetime from the moment we
  happened to ask.
- **"However that run ended" only ran the happy path.** There are three now —
  done, failed and canceled — because a `finally` is the easiest block to lose
  and the two unhappy paths are exactly what it is there for.
- **The eviction call in that `finally` is guarded.** A throwing `finally`
  _replaces_ the outcome of the block it guards, so an unlucky `SQLITE_BUSY`
  would have discarded a completed run's result and reported it as "run task
  rejected". Housekeeping does not get to fail a run; the next boot sweeps
  whatever a failed sweep missed.
- **The dead comment in migration 5** pointed at a `groundingKey` that never
  existed. It names `locateKey` and `travelKey` now — worth doing before the
  migration ships, since a shipped one is never edited again.
- **A test asserted the opposite of its own name** (`…rather than answering
null` asserting `toBeNull()`). It is the first thing a pl-27 author would have
  read. Gone, along with the "without a cache in the way" test, whose path the
  type system now forbids.

**Accepted as argued, no change:** not caching negatives (a re-ask cannot
hot-loop — every one goes through the budget), and the amplified matrix cost that
comes with it. **The known cost, for pl-27:** one uncached `null` cell keeps its
row _and_ its column in the "wanted" sets, so a single unanswerable pair pulls a
whole row and column back into the next sub-request. A matrix over eight places
with one permanently unknown pair re-asks 1×8 + 8×1 cells every time rather than
one. It is one call either way — the ceiling counts calls — but it is not free at
a metered backend, and the fix if it bites is a negative TTL, argued for in the
architecture's configuration table like every other one.

**The eviction tests ask about the row they seeded, not about an empty table.**
"Is `grounding_cache` empty afterwards" was only ever the same statement as "the
expired row was deleted" while nothing in a run wrote to the cache — and pl-27
makes a run ground for real, so it would have started failing for a reason that
has nothing to do with eviction. `seededRowSurvives` asks the question the tests
are actually about. The three cases are separate `test(...)` blocks so that
reconciling them with pl-27's edit to the same file is a matter of keeping both.

**For pl-27, concretely:** `whyUnanswered(refusedThisCall)` in
`api/src/runs/travel.ts` can stop diffing `provider.refused` around each call.
The cell says what happened — `travelOutcome(matrix, origin, destination).kind`
is `answered`, `unknown` or `refused` — so the attribution is read rather than
inferred, per cell rather than per call. `RunGrounding.refused` stays as the
run-level tally for a gap's one sentence. `ItemTravel` is a different layer and
is not touched: this says what grounding returned, that says what the plan
asserts about a transition, and `GroundingOutcome<T>` stays generic because
pl-28 will put facts through the same seam that have nothing to do with travel.

**624 in the planner suite (611 before, 574 at the branch point), 1218
repo-wide, `npm run check` green.**

**2026-08-23 — second gate round.** CONCERNS, and all three mediums were in the
**wiring** rather than in the seam: the reviewer probed mixed, fully-refused,
zero-budget and hit-plus-refused matrices and found no path that collapses
refusal into unknown or the reverse. What the seam guaranteed, the assembly gave
back.

**The un-budgeted door was still open one level up.** `RunGroundingSource`
extended `GroundingProvider`, so `AppContext.grounding` carried `locate` and
`travel` and `context.grounding.locate(…)` compiled — answering `T | null` and
spending no budget at all. That is the obvious spelling for pl-27 to reach for,
and it reinstates both halves of what this round existed to close: the ceiling
goes unconsulted and `null` means "nobody knows" and "never asked" again.
`cache.ts` made exactly this argument about `RunGrounding` while the source on
the context was the same door, unlatched.

`RunGroundingSource` is now `{ name, forRun }` and extends nothing.
`CachingGroundingProvider implements GroundingProvider, RunGroundingSource`, and
`server.ts` is the only place that holds it as both, because it is the only place
that builds it. `routes/health.ts` reads `name`; a run calls `groundingForRun`;
nothing in the tool wanted more. **The narrowing is asserted by the compiler** —
two `@ts-expect-error` probes in the suite, which this repo typechecks under the
same gate as the source, so reopening the door fails `npm run check` with TS2578
rather than passing quietly. Verified by doing it: put `extends
GroundingProvider` back and the build fails naming both lines.

**The boot sweep was unguarded** while the identical sweep in the run's `finally`
was wrapped, on the argument that housekeeping must not fail a run. One step
further: a `SQLITE_BUSY` or a full disk on that DELETE rejected `createApp`, so
the _service would not boot_ over work this file itself calls not load-bearing —
an expired row is refused on read whether or not anything deleted it. Wrapped, on
the same terms.

**The time bomb was defused in the provider and re-armed by the wiring, and that
is the transferable half.** `createGroundingProvider` built
`new FixtureGroundingProvider()` on its default clock while the cache around it
took `createApp`'s injected `now`. Pin `now` to 2030 and the provider stamps
answers from the wall clock — later than the moment the cache stores them — the
`Math.min` clamp reads that as already-expired-on-write, nothing is cached, and
every lookup spends budget. It did not bite only because `createRunHarness` pins
`NOW` to 2026-08-15, _behind_ the real clock, where the clamp absorbs it; and
that harness runs `logLevel: "silent"`, so the warn added in the last round would
not have been seen either. One line: `new FixtureGroundingProvider(now)`.

The lesson is worth more than the line. **The test that proves a 2028 provider
stamps 2028 passes precisely because it constructs the provider directly** —
bypassing the assembly that was wrong. A fix inside a component and a test that
instantiates that component are the same blind spot twice, and the bug lives in
the one step neither of them takes. There is a test at the `createApp` level now,
pinned to 2030, and it fails without the one-line fix.

Lows, all three:

- **A test named for a claim it did not make.** "The seam's own methods never
  refuse" asserted only a call count. It now asks the same question two ways at
  once — a run with a spent budget refuses it, the un-budgeted seam still answers
  it — which is the claim in the name.
- **The eviction guard had no test and flattened its cause.** `AppError.from`
  gives everything untyped the same `INTERNAL` code and the same generic
  sentence, so a lock and a full disk logged identically, and that line is the
  only place either is ever mentioned. It carries `cause` now, and there is a
  test: the sweep throws `SQLITE_BUSY`, the run still reaches `done`, the warning
  names the cause, and nothing is filed as "run task rejected". Verified failing
  without the guard.
- **`FIXTURE_TABLE_WRITTEN` was a dead export.** Removed; the reasoning it
  carried moved onto `fixtureSource`, which is what a reader is looking at when
  the question comes up.

**Dropped as argued by the reviewer, no action:** prepare-per-cell in `#travel`'s
read loop (house style in `db/runs.ts` and `db/intakes.ts`, not introduced here),
and `UNKNOWN`/`REFUSED` being unfrozen singletons (every consumer is TypeScript).

**627 in the planner suite (624 before, 574 at the branch point), 1221
repo-wide, `npm run check` green.** Each of the three new tests was confirmed to
fail with its fix reverted.

**2026-08-23 — third gate: PASS, and the sweep that followed it.** The reviewer
reproduced every claim by hand rather than reading for them: each fix reverted to
confirm its test goes red, the branch-point baseline re-run independently
(574/43), and the `@ts-expect-error` probes checked in both directions. Seven
lows; four fixed here, three deferred on purpose and named below so the next
reader does not think they were missed. The gate record for all three rounds is
now the `## Review` section above — **the builder commits it, because a
reviewer's worktree is discarded and an uncommitted gate did not happen.**

**The boot-sweep guard was the only one of six fixes with no test**, and the
previous entry's "each of the three new tests was confirmed to fail" quietly
excluded it. It has one now, spying `Database.prototype.prepare` — the instance
cannot be reached, because `createApp` builds its own — and confirmed failing
without the guard: `createApp` rejects and the service does not boot. The failure
it guards is worse than the run-time one and it was the one left unpinned.

**`cache.ts`'s header had become false.** It said everything above the seam
"sees the seam and nothing else"; after the narrowing, `context.grounding` is
precisely the thing that cannot see it. That was the first paragraph a reader
hits, in the file whose header _is_ the argument — the sentence is now what the
interface's own note has said since the last round.

**The `finally` guard was oversold, in the comment, in the test and in the Log.**
All three said an unguarded throw "would discard a completed run's result and
report it as run task rejected". It would not: `execute` commits the run row
before returning, and the queue catches a rejected task and releases its slot.
The reviewer's proof is the sharper form of the point — `expect(finished.status)
.toBe("done")` **still passes with the guard removed**, so the test's
title-bearing assertion was inert and only the two log assertions ever bit. The
guard is still worth having: it stops an error-level line blaming a run that
succeeded for a DELETE it had nothing to do with. All three places now say that,
and the test is named for what actually bites, with the inert assertion marked as
context rather than claim. **A test whose headline assertion passes under the bug
is a test that reads as coverage and is not** — the same shape as a name
asserting the opposite of its body, found two rounds ago.

**`answered`, `UNKNOWN` and `REFUSED` are no longer exported.** Nothing outside
the file consumed them — not even the suite, which reads `outcome.kind` and
`travelOutcome(...).kind`, which is also what the Log points pl-27 at. Same class
as `FIXTURE_TABLE_WRITTEN` last round; the day pl-28 needs to build an outcome,
exporting them is the change.

**The NUL in `key`: comment corrected, code deliberately unchanged.** The
reviewer checked empirically that storage, comparison and lookup are all exact —
two keys differing only after the separator are two rows, each found by its own
key. What is not true is migration 5's own sales pitch: `length()` returns 4 for
`alma<NUL>québec`, and `substr`, `LIKE` and most database browsers stop at the
first NUL, so that row and `alma<NUL>saguenay` both display as `alma`. The table
is **answerable by query, not readable by browsing**, and the one column that
identifies a row is the one that will not read back by eye. Migration 5 and
`db/grounding-cache.ts` both say so now. The separator itself stays: pl-27 builds
`placeIdentity` on this format and changing it would ripple into a branch
mid-review.

**Deferred, deliberately, both named by the gate:**

- **`#store` logs per cell.** A refused or already-expired `travel` matrix can
  emit N×M lines where one would do. Latent until pl-27 actually calls `travel`,
  and the right fix is a per-call summary rather than a per-cell line — which is
  easier to write against a real caller than against none.
- **`01-ARCHITECTURE.md`'s `GROUNDING_CACHE_TTL_*` row** still says "varies" and
  predates `GROUNDING_CACHE_TTL_LOCATE_HOURS` and
  `GROUNDING_CACHE_TTL_TRAVEL_HOURS`. Left alone on this branch on purpose: the
  configuration table is one table for the whole tool, pl-27 is in review against
  it, and a two-line edit is not worth a conflict in a shared document.

**628 in the planner suite (627 before, 574 at the branch point), 1222
repo-wide, `npm run check` green.** The new boot-sweep test was confirmed failing
with its guard removed, like the three before it.
