---
id: pl-25
tool: planner
title: Cache grounding with a TTL that varies by kind
kind: work-package
milestone: P3
status: ready
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
