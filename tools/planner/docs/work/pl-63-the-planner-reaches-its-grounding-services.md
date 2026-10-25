---
id: pl-63
tool: planner
title: merging compose.planner.yaml stands up three grounding services the planner cannot reach
kind: fix
status: done
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

## Decision — answered 2026-10-25 by the owner

**Should the planner wait for Valhalla to be healthy, or only started?** Answered: **option 1, `service_started`**, chosen from the three below.

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

**When it matters: `docker compose up`, not a reboot.** The gate pointed this
out. `depends_on` orders what compose starts. After a host reboot, the Docker
daemon restarts `restart: unless-stopped` containers itself and never reads
`depends_on`. So option 2 avoids gaps only after an `up -d`, and its coupling
bites only on an `up -d`: a deploy, a rollback, a config change. Those are the
moments an operator is already at the keyboard, and also the moments a down
tunnel is least welcome. After a reboot, options 1 and 2 behave the same. This is
reasoned from Docker's documented behaviour and was not run, because there is no
daemon here.

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

## Review

**Gate: CONCERNS** — 2026-10-25 · `1bf4f5d5..366cbea8` (the top commit only; `1bf4f5d5` is repo-125, gated separately; the ticket was filed on this branch, so its brief is read at the head down to `## Log`) · Sonnet 5.5, depth medium

| Done when                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Three files give a planner on `edge` and `planner`, with the four variables set | **verified** — `docker compose -f compose.prod.yaml -f compose.planner.prod.yaml -f compose.planner.yaml config --format json`: planner networks `["edge","planner"]`; `GROUNDING_PROVIDER=valhalla`, `VALHALLA_URL=http://valhalla:8002`, `GEOCODER_URL=http://nominatim:8080`, `OVERPASS_URL=http://overpass`. No test on the branch asserts it (F5). |
| 2. Two files still give a planner on `edge` alone, `GROUNDING_PROVIDER` unset      | **verified** — the same command over the first two files: networks `["edge"]`; env carries only `LOG_LEVEL`, `MODEL_PROVIDER`, `TRUST_PROXY`; no `depends_on` on the planner; services `cloudflared,planner`. Nothing asserts it (F5).                                                                                                                  |
| 3. `--profile tiles config --services` over the three files lists `valhalla-tiles` | **verified** — output `valhalla planner cloudflared nominatim overpass valhalla-tiles`; the `COMPOSE_FILE=a:b:c` form the guide uses gives the same six. Nothing asserts it (F5).                                                                                                                                                                       |
| 4. No doc gives a `-f compose.planner.yaml` command on its own                     | **verified** — `grep -rnE "\-f[ =]+\S*compose\.planner\.yaml"` over every tracked file: two hits, both prose that says the command is invalid (the file's own header, guide step 2), plus the ticket. Control: `docker compose -f compose.planner.yaml config` exits 1, `service "planner" has neither an image nor a build context`.                   |
| 5. `npm run check` passes                                                          | **verified** — run once in the detached tree at `366cbea8`, exit 0 (lint, `oxfmt --check`, `tsc -b`).                                                                                                                                                                                                                                                   |

- **med** · no `Done when` line's words depend on it, but the ticket's title and Why do · F1: `OVERPASS_URL` is shipped as `http://overpass`, and the planner POSTs to `${OVERPASS_URL}/interpreter`, which is `http://overpass/interpreter`. The `wiktorn/overpass-api` image serves the interpreter only under `/api/` (its README: `http://localhost:80/api/interpreter`; its nginx config has `location /api/` rewriting to cgi-bin and `location /` as a static root; this file's own health check hits `/api/status`). Run through the repo's adapter (`ValhallaGroundingProvider.nearby`) against a stand-in for that nginx: `OVERPASS_URL=http://overpass -> POST http://overpass/interpreter -> threw UNREACHABLE {"status":405}`; `OVERPASS_URL=http://overpass/api -> POST http://overpass/api/interpreter -> answered, 0 finds`. The failure is silent by design: `runs/discovery.ts` turns it into `answered []` plus one `warn`, so every plan on a host built from this guide carries the coverage sentence a genuinely empty answer gets. The value is also in the guide's step 3 table and in the base file's old comment, so it predates the branch, but this branch is the one that makes it live. Direction: `http://overpass/api` in `compose.planner.yaml` and the guide's table row; the second run above is that input.
- **low** · `nfr:maintainability` · F2: two sentences are now false. `compose.planner.yaml`'s "Merging this file with the downloader's is safe, as of repo-33" and the guide's "merging the grounding fragment with the downloader's is an ordinary thing to do". `-f compose.prod.yaml -f compose.downloader.prod.yaml -f compose.planner.yaml config` exits 1 with `service "planner" has neither an image nor a build context`. False in the safe direction: compose refuses and nothing starts.
- **low** · F3: the guide's step 3 table still marks `GROUNDING_PROVIDER`, `VALHALLA_URL` and `GEOCODER_URL` "Required: yes", and the section above it still says `OVERPASS_URL` "may be left unset", though the file now sets all four on every merge (leaving discovery off now takes an override that sets it empty). False in the safe direction.
- **low** · F4: `docs/adr/004-one-compose-fragment-per-tool.md` says "The planner waits on `condition: service_healthy`". The build ships `service_started` and neither the commit nor the ticket's Build step 4 touches the ADR. Part of the open decision: whichever option the owner takes, the ADR either stays true or needs a dated note (it already carries one banner of that kind).
- **low** · F5: nothing on the branch pins Done when 1–3 (no test reads a compose merge). The defect this ticket fixes sat from pl-28 to now for want of one. Direction only: `scripts/test/` could run `docker compose config` over the three files.
- **dropped** · `tools/planner/api/src/config.ts` comment says "`compose.yaml` now brings up" (a stale filename since repo-33). Predates the branch and is outside the commit's files.
- **dropped** · the comment block left at the foot of `compose.planner.yaml` ("Why these addresses take no SSRF guard") now sits below the services rather than beside the env block it explains, and lost the `GROUNDING_DISCOVERY_TIMEOUT_MS` sizing sentence; the guide carries both. A placement preference, nothing relies on it.
- **findings** · the hunt returned 7; 5 carried (F1–F5), 2 dropped.
- **open decision, premise check (no recommendation, per the dispatch)** · the ticket's chain claim is **right**: with `compose.downloader.prod.yaml`, `compose.planner.prod.yaml`, `compose.ledger.prod.yaml` merged, `cloudflared` carries `depends_on` on all three tools at `service_healthy`, so a `service_healthy` on Valhalla would chain to the tunnel. The ticket's **account of the benefit is incomplete**: `depends_on` orders `docker compose up`. After a host reboot the Docker daemon restarts `restart: unless-stopped` containers itself, without reading it. So option 2's "no gaps after a restart" (and adr/004's stated reason) holds for an `up -d` and, by that reasoning, not for a power cycle; option 1's cost is then the same as option 2's at reboot. Not measured here: there is no daemon. Option 1's "nothing else is coupled" is also unmeasured: whether compose fails the planner's start when a `service_started` dependency exits straight after starting.
- NFR: security ✓ (no new port; the services stay on the private `planner` network, planner still on loopback 8090) · performance n/a · reliability — F1 above, and the unmeasured daemon behaviour · maintainability — F2–F5 above.

Dispositions, 2026-10-25, on the branch after the gate:

- F1 fixed: `OVERPASS_URL` is `http://overpass/api` in the fragment and in the guide's table. Checked by hand: `valhalla.ts` posts to `${overpassUrl}/interpreter`, the fragment's own health check reads `/api/status`, and pl-33 used `overpass-api.de/api/interpreter`. Not run against the image.
- F2 fixed: the fragment's header and the guide say that merging beside the downloader's needs the planner's prod fragment too.
- F3 fixed: the guide's table says which variables the planner requires and which the fragment sets, and how to turn discovery off (an empty override, which `config.ts` treats as unset).
- F4 fixed after the owner answered option 1: adr/004 has a dated note on its `service_healthy` paragraph.
- F5 accepted, recorded: no test merges compose files. A `scripts/test` case running `docker compose config` would need the compose CLI on every runner, and adds a CI dependency that nothing here has needed so far.

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

**2026-10-25: decided and closed.** The owner chose `service_started`, which is
what the branch already built. adr/004 has a dated note saying so, and why.
