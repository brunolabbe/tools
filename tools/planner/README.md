# planner

Describe a trip — a road trip, a hiking weekend, a skidoo ride up north, a slow
week of history in Europe — answer a guided set of questions about it, have the
specialists that trip actually needs draft a plan, and keep the plan.

> **Released, and still growing.** Where it stands is
> `npm run status -- --tool planner`, computed from the tickets rather than
> written here; [docs/work/](./docs/work/) is what each piece of work did.

## Why this is not a chat

A language model is excellent at producing a beautiful, confident, **infeasible**
itinerary: three towns six hours apart in one day, a museum on the day it closes,
snowmobile trails in April, a budget that does not add up to its own lines. Every
one of those is a checkable fact, so the planner is built around checking them.
Full reasoning in [docs/00-ANALYSIS.md](./docs/00-ANALYSIS.md).

- **The intake is an authored question tree, and no model is in it.** Which
  questions are asked depends on the trip's shape, and once a draft has what it
  needs the wizard offers one rather than marching to the end of the tree.
- **The roster is data.** Which specialists work on a plan is a pure function of
  the trip, not a conversation with a model about it.
- **Models propose; code schedules and checks.** A specialist returns candidates
  — what, where, how long, what it costs, when it is in season — and never which
  day they fall on. Packing days, drive times, budgets and seasons are ordinary
  TypeScript with ordinary tests.
- **A plan names its gaps.** A specialist that failed leaves a plan that says so,
  and every plan lists the constraints nothing was able to check.
- **A plan is a document, revised by operations rather than by utterances.**
  Pinning an item is built today; re-planning named days around the pins, and
  reading the diff, is the phase in progress.
- **It never books, never pays, and never claims a safety clearance.** It plans
  and hands off, and for backcountry, marine and winter trips it points at the
  authoritative local source.

## How it works

```
answers → intake: the authored tree, no model       → TripBrief
        → roster: the specialists this trip needs, within a run budget
        → discovery along the route                 (grounding, optional)
        → specialists, in parallel                  → candidates, from a model
        → the legs between them, measured           (grounding)
        → itinerary: pack the days, check time · money · hours · season, critic
        → a plan revision, with its gaps and unchecked constraints named
```

The model and the map data each sit behind a seam with an offline default — a
scripted model and a checked-in table of distances — so a fresh clone plans a
trip with no key, no account and no bill, and CI asserts against the same thing.
`/api/health` names both providers, so a scripted plan is never mistakable for a
real one.

## Getting started

Every command below runs from the **repo root**.

### From source

```bash
npm install
npm run dev:planner              # API on :8090 and UI on :5183, both watching
npm run check                    # lint (oxlint) + format (oxfmt) + typecheck
npm test -- --project planner
npm run e2e:planner              # the intake and pinning in a real browser (npm run e2e:install first)
```

Settings are environment variables, listed with their defaults in
[`.env.example`](./.env.example). Nothing loads a `.env` file, so set what you
change in the shell — a real model, for instance:

```bash
MODEL_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run dev:planner:api
```

Requires Node ≥ 22. The UI's dev server proxies `/api` to the API on 8090, which
keeps the two same-origin; [`web/.env.example`](./web/.env.example) changes
where it points.

### With Docker

No compose fragment builds the planner from source; its image is published to
GHCR on every release. To run a released one on its own — after the one-time
registry login in the [root README](../../README.md#deploying-a-set-of-tools):

```bash
docker run --init -p 127.0.0.1:8090:8090 -v planner-data:/data \
  ghcr.io/<owner>/planner:0.5.1                                  # http://localhost:8090
```

Or build one from a checkout — the build context is the repo root, not this
directory:

```bash
docker build -f tools/planner/Dockerfile -t planner:local .
```

It binds to loopback on purpose. There is no login and no owner model, so every
visitor shares one store of plans, and on a real model every visitor spends your
budget.

### Deploying it

Beside the other tools, on the same host and the same tunnel — the
[root README](../../README.md#deploying-a-set-of-tools) for the shape, and
[docs/02-DEPLOYMENT.md](../../docs/02-DEPLOYMENT.md) for the walkthrough and
[its planner section](../../docs/02-DEPLOYMENT.md#the-planner). Three things
about the planner matter there:

- **Its login gets no Bypass rule**, unlike the downloader's. Nothing in it is
  safe to serve unauthenticated.
- **Real distances are a routing engine, a geocoder and a discovery index** built
  once from an OpenStreetMap extract — hours of CPU, and optional.
- **A real model is a key and a budget**, and a budget chosen before pl-39 buys a
  quarter of what it used to.

## Docs

This tool's documentation lives with its code, in [docs/](./docs/):

|                                                |                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| [00 — Analysis](./docs/00-ANALYSIS.md)         | What makes a trip hard to plan, and where AI plans fail. **Read first.**            |
| [01 — Architecture](./docs/01-ARCHITECTURE.md) | Packages, pipeline, data model, configuration, security — design, ahead of the code |
| [02 — Roadmap](./docs/02-ROADMAP.md)           | Phases and milestones, and what is still open                                       |
| [work/](./docs/work/)                          | One file per ticket: the brief and what it did                                      |
| [e2e/](./e2e/README.md)                        | What the browser specs prove, and why there are so few                              |

[CLAUDE.md](./CLAUDE.md) beside this file is the rules specific to this tool and
the commands that run it — and `npm run status -- --tool planner` is where it
stands, computed from the tickets rather than written down; the repo-wide
conventions are in the [root CLAUDE.md](../../CLAUDE.md), and
[../../README.md](../../README.md) is the repo itself.
