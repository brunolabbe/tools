# 004 — One compose fragment per tool, merged on the host

**Status:** accepted · **Date:** 2026-08-22 · **Affects:** every tool

## Context

[`compose.yaml`](../../compose.yaml) is the downloader's, under a name that
claims the repository. It builds one service from the root context and mounts
one volume. [`compose.prod.yaml`](../../compose.prod.yaml) is the deployment
overlay: `cloudflared`, the `edge` network, and the released image pinned by tag
instead of built from source. [00-TOOLS.md](../00-TOOLS.md) already says why
that overlay is repo-wide rather than under a tool — the tunnel, the login
policy and the version scheme are one story for whatever gets published, and the
downloader is their worked example rather than their subject.

That arrangement has held because there was one tool in it.

**The planner has owed a compose service since 2026-08-14.**
[pl-2](../../tools/planner/docs/work/pl-2-container-image.md) steps 5 and 6 were
deliberately not bundled: the image is published and runnable and nothing points
a hostname at it. On its own that is a rename and a paste, which is why it has
been affordable to leave.

**What changed on 2026-08-22 is that the planner is about to bring services of
its own.** [pl-28](../../tools/planner/docs/work/pl-28-valhalla-adapter.md)
settled the grounding backend as self-hosted Valhalla, which arrives with a
regional OSM extract and a tile volume behind it, and its "read first" section
establishes that a router does not geocode. That second half is still open —
pl-28 recommends Nominatim on the same extract but leaves the public instance
and Photon on the table, so the geocoder may cost another container or none.
Either way the planner stops being a container and becomes a subsystem, and that
is what forces the question now: does everything go in one file.

Three properties of the new services decide it, and none of them were true of
anything already in `compose.yaml`.

- **They are not built here.** They are third-party images pulled by tag.
  Nothing about them reaches `npm run build`, a `Dockerfile`, or
  `packages/core/test/image-closure.test.ts`, which walks `@planner/api`'s
  _workspace_ graph and will never have heard of a routing engine.
- **They belong to one tool, today.** Nothing in the downloader wants a distance
  matrix.
- **One of them has a lifecycle compose does not model.** Building Valhalla's
  tiles from a `.pbf` is hours of CPU and tens of gigabytes, run once and then
  rarely. `up -d` is the wrong verb for it and `up --build` is a worse one.

## Decision

**A tool's services are compose fragments of its own, and the host merges the
fragments it wants.**

```
compose.downloader.yaml        the downloader, built from source
compose.planner.yaml           the planner, its routing engine, its geocoder
compose.downloader.prod.yaml   its released image, its TRUST_PROXY
compose.planner.prod.yaml      its released image
compose.prod.yaml              cloudflared and the edge network
```

**The production overlay splits per tool as well, and this is the part that is
easy to get wrong.** A single overlay carrying a `planner:` block is a service
_definition_ — an image and a network are enough to start one — so a
downloader-only host that merged it would stand up the planner and everything
behind it, which is the exact failure the whole decision exists to avoid. What
is left in `compose.prod.yaml` is only what belongs to the host rather than to
any tool: the tunnel, and the network they share.

Five files for two tools is the price, and it is a real one. It buys the
property that no host runs a service it did not name.

`COMPOSE_FILE` in `.env` names the set, so a deployed host still types a bare
`docker compose up -d` rather than a line of `-f` flags it can get wrong during
a rollback.

**The fragments stay at the repository root.** Both `Dockerfile`s state that the
build context is the repository root and not their own directory, and with `-f`
merging, relative paths in _every_ file resolve against the project directory —
the first file's — rather than against each fragment's own. Root placement makes
that distinction unable to matter. `name:` is set explicitly in the same breath,
because the project name otherwise defaults to a directory basename, and a
project renamed by moving a file orphans the volumes holding the tiles.

**A tool's own dependencies live in that tool's fragment until a second tool
wants them.** This is `CLAUDE.md`'s rule about `packages/` applied to
containers, and for the same reason: promoting Valhalla to a host service later
is a URL change, and guessing now that it is one is a shape nothing asked for.

**Nothing about the build changes.** Per-tool `Dockerfile`, per-tool image gate
in `.github/workflows/<tool>.yml`, per-tool release component. The planner's
image gate keeps starting the planner container **alone**, which it can because
`GROUNDING_PROVIDER` defaults to `fixtures` as of
[pl-24](../../tools/planner/docs/work/pl-24-grounding-seam-and-fixtures.md). A
gate that pulls a routing engine and waits for tiles is twenty minutes proving
nothing about the planner.

**Tile building is a compose profile, not a service.** A one-shot builder under
`--profile tiles` writes the tile volume; a routine `up -d` never selects it,
and naming it on the command line enables its profile, which is the whole
interface a one-shot job needs.

**The planner waits on `condition: service_healthy`, and pays for it.** Not for
correctness — pl-28 step 5 already maps an unreachable instance to a retryable
`UNREACHABLE` rather than a thrown run — but so that a host restart is not
several minutes of plans carrying a named travel-time gap that nothing was
actually wrong with. The cost is that compose refuses to start when a
`service_healthy` dependency declares no healthcheck of its own, and neither
upstream image is guaranteed to ship one, so the planner's fragment will
probably have to write a `healthcheck:` block for a container it does not build.

## Alternatives considered

**One `compose.yaml` holding every service.** The cheapest thing today, and the
objection is not tidiness. A host running only the downloader pulls a geocoder
it will never call, and `docker compose down -v` on that host destroys a tile
set that took hours to build. The split above is what makes "only the
downloader" something a host can express at all.

**A fragment under each `tools/<tool>/`,** which is the layout
[001](./001-per-tool-docs-and-tickets.md) would predict and the one worth
wanting. Rejected on mechanics rather than on principle. Because merged
fragments resolve relative paths against the first file's directory, every
`context:` and every bind mount would have to be written `../..`, correct for
exactly one invocation order. `--project-directory .` fixes it properly and has
no `COMPOSE_FILE`-style environment equivalent, so correctness would depend on a
flag being present on every invocation — including the ones typed during a
rollback, by someone who is not reading this file.

**Top-level `include:` of per-tool fragments.** The strongest alternative, and
the one to re-open if the file count above becomes what people complain about.
It fixes the path mechanics outright — paths in an included file resolve against
that file's own directory, so the fragments could live under their tools — and,
combined with a profile per tool, it can express selection too. Rejected because
that moves selection _inside_ the fragments: which tools a host runs stops being
the list of files it merges and becomes a set of profile names matched against
`profiles:` keys spread across the tree. The list of files is the thing an
operator can read off a running host, and here it is worth more than the tidier
layout.

**A separate compose project for the routing engine,** run by hand, on the
grounds that its lifecycle genuinely is different. Rejected because it puts the
endpoint on another network, and the next step from there is host networking or
`allowPrivateAddresses` to make a fetch work — which pl-28 step 7 and
[pl-26](../../tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md) both say
plainly is not the way to reach a LAN address. The profile above buys the
lifecycle separation without buying that.

## Consequences

- **There is no longer a default `compose.yaml`, and that breaks the documented
  first run.** [README.md](../../README.md) says `docker compose up --build` and
  relies on compose finding the file by its default name; after the rename that
  command reports no configuration file at all. The README's one-liner grows a
  `-f`, and this is the change most likely to be forgotten, because it is the
  one path that never touches `.env` — a fresh clone has none, since `.env` is
  gitignored.
- **A deployed host is a rename away from broken too.**
  [02-DEPLOYMENT.md](../02-DEPLOYMENT.md) names `compose.yaml` in two command
  blocks and three lines of prose, and a host that pulls this change keeps
  running until someone types the old command. Cheaper now, with one tool
  deployed, than after a third.
- **`.env.prod.example` grows from three variables to six or more** —
  `COMPOSE_FILE`, `PLANNER_TAG`, and pl-28's endpoint URLs, which have no
  defaults on purpose, beside the `TUNNEL_TOKEN`, `GHCR_OWNER` and
  `DOWNLOADER_TAG` already there. It is the only place a reader will find the
  list.
- **The planner's fragment is the first thing here to name a third-party
  image,** and inherits the question `compose.prod.yaml` already asks about
  `cloudflared:latest`: pin it, or accept that a `pull` can change the routing
  engine under a working deployment.
- **Development is unchanged.** `npm run dev:planner` stays the loop, and the
  fixture provider means no compose file is a prerequisite for working on the
  tool. A routing engine comes up once, by hand, to capture pl-28 step 3's real
  payloads; after that every test parses them offline.
- **This is a decision, not an implementation.** The split and the rename are
  repo-wide and want a `repo-` ticket; pl-2 steps 5 and 6 still own the planner
  service and its Access application; pl-28 step 8 still owns the tile ops that
  an operator will need. Nothing here touches a `<!-- generated:tickets -->`
  region — see [003](./003-the-status-page-is-generated.md).
