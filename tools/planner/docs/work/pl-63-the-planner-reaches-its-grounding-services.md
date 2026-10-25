---
id: pl-63
tool: planner
title: merging compose.planner.yaml stands up three grounding services the planner cannot reach
kind: fix
status: needs-decision
milestone: null
depends_on: [repo-125]
difficulty: standard
---

# pl-63 — the planner reaches its grounding services

## Why

`docs/02-DEPLOYMENT.md` and `.env.prod.example` both say that appending
`compose.planner.yaml` to a host's `COMPOSE_FILE` makes the planner's distances
real. It does not. Measured with `docker compose config` (Compose v5.6.0) on
`origin/main@558ce370`, merging `compose.prod.yaml`, `compose.planner.prod.yaml`
and `compose.planner.yaml`:

```
planner networks: {'edge': None}
planner env: (no GROUNDING_PROVIDER, VALHALLA_URL, GEOCODER_URL or OVERPASS_URL)
valhalla networks: {'planner': None}
```

So the host pulls three images, spends hours importing the extract into each, and
the planner stays on `GROUNDING_PROVIDER=fixtures`. It could not reach them even
with the variables set: it is not on the `planner` network, so `valhalla` does not
resolve from inside it. The guide's step 3 lists the variables but never says where
they go, or that the planner has to join that network.

How it happened: `compose.planner.yaml` was written before the planner service
existed, with a comment saying the service "joins this file" when pl-2 put it
there. pl-2 put it in `compose.planner.prod.yaml` (adr/004 split the prod
fragments), and the comment was never acted on.

Found while answering why the root compose files differ; repo-125 is the other
half of that review.

## Decision — open

**Should the planner wait for Valhalla to be healthy, or only started?**

adr/004 planned `condition: service_healthy`, so that a host restart is not several
minutes of plans reporting gaps. But `cloudflared` waits on the planner's own
health (`compose.planner.prod.yaml`). A healthy-wait therefore chains: an unhealthy
Valhalla keeps the planner from starting, which keeps `cloudflared` from starting,
which takes **every tool on the host** off the internet. The guide already warns
that Valhalla's health check shells out to `curl`, and nobody has checked whether
the image ships it.

1. **`service_started` (recommended, and what the branch builds).** Compose
   starts the planner as soon as the Valhalla container is up. Until the graph
   answers, a leg comes back as a retryable `UNREACHABLE` and a named gap. Costs a
   few minutes of gaps after a host restart. Nothing else is coupled.
2. **`service_healthy`, as adr/004 planned.** No gaps after a restart. If
   Valhalla's health check fails, for a missing `curl`, a bad graph or a
   too-short `start_period`, the downloader and the ledger go down with it.
3. **No `depends_on` at all.** Same behaviour as 1 in practice, but `docker compose
   up planner` would no longer bring Valhalla up with it.

## Build

1. `compose.planner.yaml` gets a `planner:` block that adds `networks: [edge,
   planner]`, `GROUNDING_PROVIDER=valhalla`, `VALHALLA_URL`, `GEOCODER_URL` and
   `OVERPASS_URL`, and a `depends_on` on `valhalla` set as decided above.
2. That makes the file an overlay. `-f compose.planner.yaml` alone becomes an
   invalid project (`service "planner" has neither an image nor a build context`).
   Every command the guide gives for these services runs through the host's full
   `COMPOSE_FILE` instead: the tile build, `up`, `logs`, the rebuild and the
   restart.
3. Replace the comment block describing the wiring "when pl-2 puts it here".
4. Update the guide's steps 2–4, `compose.planner.prod.yaml`'s note, and
   `.env.prod.example`'s description of the file and its `-f` sentence.

## Done when

1. Merging `compose.prod.yaml`, `compose.planner.prod.yaml` and
   `compose.planner.yaml` gives a planner on both `edge` and `planner`, with the
   four variables set.
2. Merging only the first two still gives a planner on `edge` alone, with
   `GROUNDING_PROVIDER` unset (fixtures), so a host without grounding is
   unchanged.
3. `--profile tiles config --services` over the three files lists
   `valhalla-tiles`.
4. No doc gives a `-f compose.planner.yaml` command on its own.
5. `npm run check` passes.

## Log

**2026-10-25: built on repo-125's branch.** It is stacked because both change the
same paragraph of `.env.prod.example`. Measured with `docker compose config`:

- Three files: the planner is on `edge` and `planner`, with
  `GROUNDING_PROVIDER=valhalla`, `VALHALLA_URL=http://valhalla:8002`,
  `GEOCODER_URL=http://nominatim:8080` and `OVERPASS_URL=http://overpass`, plus a
  `depends_on` on `valhalla` (`service_started`). Done when 1.
- Two files: the planner is on `edge` only, with no `GROUNDING_PROVIDER`. Done
  when 2.
- With `--profile tiles`, the services are `valhalla`, `planner`,
  `valhalla-tiles`, `cloudflared`, `nominatim` and `overpass`. Done when 3.
- The network list merges: writing `[planner]` alone also gives both networks.
  `edge` is written anyway so the file states the whole membership.

Nothing was run against a host or a registry. The environment has the compose CLI
and no daemon, so the open question in the guide is still open: does Valhalla's
image ship the `curl` its health check calls? With `service_started` the answer no
longer gates the tunnel. It still decides whether `docker compose ps` reports
Valhalla correctly.
