# Architecture

Derived from [00-ANALYSIS.md](./00-ANALYSIS.md). Every structural choice below
traces back to a constraint in that document, and the section it comes from is
named.

Phase 0 built four packages and one seam; most of this page is not built yet.
What is true today is in [03-STATUS.md](./03-STATUS.md) — read that before
assuming any of it exists.

---

## System shape

Every package named below lives under `tools/planner/`.

```
┌──────────────┐  POST /api/conversations        ┌────────────────────────────┐
│              │ ──────────────────────────────► │                            │
│     web      │  POST /api/conversations/:id/turns            api            │
│  React+Vite  │ ──────────────────────────────► │          Fastify           │
│              │  POST /api/plans/:id/revisions  │                            │
│  interview   │ ──────────────────────────────► │  ┌──────────────────────┐  │
│  plan view   │  GET  /api/runs/:id/events      │  │    run orchestrator  │  │
│  revise+pin  │ ◄────────── SSE ─────────────── │  │  queue · FSM · SSE   │  │
└──────────────┘                                 │  └──────┬───────────────┘  │
                                                 └─────────┼──────────────────┘
                              ┌────────────────────────────┴──────────┐
                              ▼                                       ▼
        ┌─────────────────────────────────────┐   ┌──────────────────────────────┐
        │               agent                 │   │          itinerary           │
        │  ─────────────────────────────────  │   │  ──────────────────────────  │
        │  interviewer   → TripBrief          │   │  composer  packs days        │
        │  orchestrator  → roster from brief  │   │  constraints  time · money   │
        │  specialists   → Candidate[]        │   │               hours · season │
        │  ChatProvider seam ─ scripted       │   │  critic  feasibility pass    │
        │  GroundingProvider seam ─ fixtures  │   │  diff  revision → revision   │
        └─────────────────────────────────────┘   └──────────────────────────────┘
                              └──────────── contract ───────────────┘
                       conversation · brief · candidate · plan · errors · schemas
                                             │
                                     @webtools/core
                               error machinery · transitions · redaction
```

## Packages

| Package     | Responsibility                                                                                      | Depends on                 |
| ----------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| `contract`  | Types, error taxonomy, zod schemas, routes. **No runtime logic.**                                   | `@webtools/core`           |
| `agent`     | Everything that talks to a model: prompts, interviewer, roster, specialists, seams.                 | contract                   |
| `itinerary` | Everything that must be exact: composer, constraint checks, critic, diff. **No model, no network.** | contract                   |
| `api`       | Fastify surface, persistence, run orchestration, SSE, provider selection.                           | contract, agent, itinerary |
| `web`       | Interview, plan, revision and diff UI.                                                              | contract                   |

`itinerary` does not exist yet, and it is the one addition Phase 0's shape did
not anticipate. It exists because of the analysis's central decision (§2):
**models generate candidates, code schedules and checks.** Keeping the arithmetic
in its own package with no model and no network dependency is what makes it
ordinary testable TypeScript — give it a fixture brief and a fixture candidate
list and its output is deterministic, which is not a property anything in `agent`
can have.

`contract` is the seam that lets several agents build in parallel without
colliding. Treat changes to it as interface changes requiring coordination, not
routine edits.

---

## The pipeline

```
answers ─► [interview turn] ─► TripBrief ─── slots still empty? ─► ask more
                                   │
                                   ▼  enough for a first draft (§3)
                            [orchestrator]  roster + run budget (§4, §9)
                                   │
              ┌────────────────────┼────────────────────┐   parallel: specialists
              ▼                    ▼                    ▼   depend on the brief,
        [route]              [lodging]           [conditions]  not on each other
              └────────────────────┼────────────────────┘
                                   ▼   Candidate[]  ── a real barrier: the
                             [composer]                composer needs them all
                                   │
                                   ▼
                              [critic] ──► findings ──┐
                                   │  ◄───────────────┘  bounded rounds
                                   ▼
                          Plan revision (append-only)
```

Two properties of this pipeline are load-bearing:

**A specialist never writes a schedule.** It returns `Candidate`s — location,
duration, cost band, season window, lead time, sources — and says nothing about
which day they fall on (§4). Two specialists that each write itinerary produce
two itineraries to reconcile.

**A revision re-runs a slice, not the fleet.** It names the days it may touch and
may not move a pinned item, so "move Tuesday's hike" is two specialists over one
day rather than seven over two weeks (§6).

---

## Data model

Four aggregates, deliberately separate.

```
Conversation ──1:n── Message          exists today; how a plan gets edited
TripBrief                             the interview's structured output; one per plan
Plan ──1:n── PlanRevision             append-only; a revision is never overwritten
                └── PlanDay ──1:n── PlanItem ──► Candidate (with provenance, pinned?)
```

- **The conversation is not the plan.** It is the medium the plan is edited
  through. Fusing them means re-reading a chat log to find out what Tuesday is
  (§6).
- **Revisions append.** The plan the user liked is always retrievable, and the UI
  shows a diff rather than a wall of new prose.
- **Provenance lives on the item**, not in a log: source and fetch time for a
  grounded fact, and an explicit "the model said so" marker otherwise (§5). The
  UI can then be honest about which lines were verified.
- **`pinned` is on the item**, because it is the composer's input constraint.

**The vocabulary, settled:** a **trip** is the journey the user is taking, so
`TripBrief` and `TripShape` describe a trip; a **plan** is the document this tool
keeps about it, so the persisted aggregate and its error code are the plan.
`TRIP_NOT_FOUND` was renamed `PLAN_NOT_FOUND` accordingly.

---

## A plan run is a job

A fan-out with grounding takes tens of seconds to minutes, which is too long for
a request. So a run is a job: queued, transitioned through states, streamed over
SSE — the same machinery `@webtools/core` already provides and the downloader
already uses. This is the second real consumer of it, which is exactly when the
repo's rules say shared code is allowed to be shared.

```
queued ─► interviewing ─► fanning-out ─► composing ─► reviewing ─► done
                              │              │            │
                              └──────────────┴────────────┴──► failed | canceled
```

Progress here is genuinely knowable — the roster's size is decided before the
fan-out starts — so the UI reports "4 of 7 specialists done" rather than a
spinner. Where a stage's total is not knowable, report `null`; the repo rule
against faking progress applies (§7).

## Configuration

All via environment, parsed and validated once at boot with zod, `api` only.

| Variable                | Default    | Why it matters                                                 |
| ----------------------- | ---------- | -------------------------------------------------------------- |
| `PORT`                  | `8090`     | 8090/5183 so both tools run at once                            |
| `CHAT_PROVIDER`         | `scripted` | The only place a model backend is named                        |
| `GROUNDING_PROVIDER`    | `fixtures` | Same seam, same default: a fresh clone plans with no key       |
| `MAX_SPECIALISTS`       | `5`        | The roster cap the orchestrator degrades to (§9)               |
| `MAX_GROUNDING_CALLS`   | `40`       | Per run. Grounding is where the bill lives                     |
| `GROUNDING_CACHE_TTL_*` | varies     | Hours for an opening time, months for a distance (§5)          |
| `MAX_CRITIC_ROUNDS`     | `2`        | Bounded, or the critic and composer argue on the clock         |
| `RUN_TOKEN_BUDGET`      | —          | Hard ceiling per run; degrade the roster rather than exceed it |
| `MAX_CONCURRENT_RUNS`   | `2`        | Each run is itself a fan-out                                   |

## Key decisions and why

**No vendor above a seam — now twice.** `ChatProvider` already does this for the
model. `GroundingProvider` does it for search and the data APIs: one interface,
a fixture implementation as the default, and `api/src/server.ts` as the only file
that knows a backend by name. The fixture default is what keeps `npm test` free,
offline and deterministic, and it is why the analysis could choose grounding
without making a key a prerequisite for running the tool.

**Grounding implementations live in `api`, the interface in `agent`.** The real
one needs `process.env`, a cache and a guarded fetch, all of which are `api`'s
job. The fixture one lives beside the scripted chat provider, because that pair
is what a fresh clone runs.

**One SSRF guard, lifted when the planner earns it.** The downloader's
`api/src/ssrf.ts` and `guarded-fetch.ts` are the working implementation. The day
the planner fetches a URL a search result gave it, that is the second real
consumer and the guard moves to `packages/core` — not before, per the repo's rule
on lifting shared code, and not by copy-paste either.

**Specialists get no credentials and no write tools.** They read hostile text
(§5). Their output is schema-validated from `@planner/contract` before anything
acts on it, and `AGENT_MALFORMED_REPLY` is what a failure past the retry budget
raises.

**The roster is data, not code paths.** Which specialists run is a pure function
of the brief, so it is a table a test can assert against. The alternative — a
chain of conditionals inside the orchestrator — is where "which agents ran and
why" stops being answerable.

**SQLite and an in-process queue, as the downloader chose.** Runs are
long-running and low-throughput; the queue is not the bottleneck. Keep it behind
an interface, do not pay for Redis now.

**SSE, not WebSockets.** Run progress is server→client only.

---

## Runtime layout

```
storage/planner/planner.db   conversations, messages, briefs, plans, revisions, runs
                             grounding cache (separate table, TTL'd, evictable)
```

The grounding cache is a table rather than a service: it must survive a restart
(a distance is good for a year) and it must be inspectable when a plan cites
something surprising.

## Security posture

- **Model and grounding output are untrusted input.** Schema-validate before
  storing, rendering or acting. Never interpolate a model reply into SQL or into
  another prompt as if it were an instruction.
- **SSRF-check every URL** the tool did not author itself, after each redirect,
  including URLs that came back out of a specialist.
- **Never log a key.** `logger.ts` censors `apiKey` and auth headers as a
  backstop; `redactUrl` from `@webtools/core` for anything with a query string,
  since a search API key travels there.
- **Bound the spend.** A per-run budget is a security control as much as a cost
  one: without it, one endpoint turns an open form into someone else's bill.
- **Rate-limit run creation per client.** A plan run is expensive enough to be a
  trivial DoS vector.
- **No booking, no payments, no logged-in sessions on travel sites** — §8, and
  permanent.
