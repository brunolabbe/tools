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
