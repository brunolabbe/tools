---
id: repo-125
tool: repo
title: the downloader's prod fragment stands alone, its volume is renamed, and every tool's log is capped
kind: fix
status: in-flight
milestone: null
depends_on: []
difficulty: standard
---

# repo-125 — the downloader's prod fragment stands alone

## Why

adr/004 gives each tool its own compose fragments. The planner's and the ledger's
prod fragments define their service outright, so a host runs either one with two
files: `compose.prod.yaml` and the tool's prod fragment. The downloader's prod
fragment is an **overlay** on `compose.downloader.yaml`, the build-from-source file,
because the downloader had a `compose.yaml` before the split. Its host line needs
three files.

That difference costs two things. Both were measured with `docker compose config`
(Compose v5.6.0) on `origin/main@558ce370`.

**The two-file line, written by analogy with the other tools, starts a broken
downloader and exits 0.** `docker compose -f compose.prod.yaml -f
compose.downloader.prod.yaml config` validates. Its `downloader` service has seven
keys (`command`, `entrypoint`, `environment`, `image`, `logging`, `networks`,
`pull_policy`), so the downloader comes up with:

- no named volume: the job database is in an anonymous volume and is lost when the
  container is recreated;
- no `BROWSER_NO_SANDBOX`: Chromium does not launch;
- no `init`: forked ffmpeg and Chromium processes are never reaped;
- Docker's default 64 MB `/dev/shm`, no restart policy and no memory limit.

A missing tag or key makes the planner's and the ledger's fragments refuse to
start. This one starts and does nothing useful.

**The overlay brings `build:` into production.** Compose cannot unset a key
inherited from an earlier file. `pull_policy: always` covers `up -d`, but `docker
compose build` or `up --build` on the host builds from source and tags the result
with the release image's name.

A third, separate gap is in scope by the owner's choice: **only the downloader caps
its log.** dl-54 capped it for the terms page's retention promise. The planner's and
the ledger's logs use `json-file` with no rotation and grow until the disk fills.

## Decision — answered 2026-10-25 by the owner

Asked as a result of a review of why the root compose files differ.

1. **The downloader's prod fragment:** self-contained, and its volume renamed from
   `storage` to `downloader_storage` to match `planner_storage` and
   `ledger_storage` (chosen). Rejected: self-contained with the volume name kept
   (no host migration); leave the overlay and document the trap.
2. **Log caps:** cap the planner's and the ledger's logs, in the same pull request
   (chosen). Rejected: leave them unbounded.
3. **File names:** keep them (chosen). Rejected: rename `compose.planner.yaml` to
   `compose.planner.grounding.yaml`.

The planner's grounding wiring, found during the same review, is pl-63.

## Build

1. `compose.downloader.prod.yaml` defines the service outright. It copies `restart`,
   `init`, `shm_size`, `ports`, the volume, the memory limit, `LOG_LEVEL` and
   `BROWSER_NO_SANDBOX` from `compose.downloader.yaml`. It declares its own
   top-level `volumes:`.
2. Rename the volume key to `downloader_storage` in both downloader fragments, so
   the dev file and the prod file agree and the old three-file line still merges
   into one service with one volume.
3. Give `compose.planner.prod.yaml` and `compose.ledger.prod.yaml` a `json-file`
   size cap. Say that it guards the disk and is not a retention promise, unlike
   dl-54's.
4. Update the host line everywhere it is written: `.env.prod.example`, `README.md`,
   `docs/02-DEPLOYMENT.md`, the fragments' headers. Rewrite the deployment guide's
   "not an inconsistency" paragraph. Add the volume migration to the guide.
5. Add a dated amendment to adr/004. Its decision table describes
   `compose.planner.yaml` as holding the planner, which it never has, and leaves
   out the ledger.

## Done when

1. `docker compose -f compose.prod.yaml -f compose.downloader.prod.yaml config`
   gives a `downloader` service with `init`, `shm_size`, `restart`, the
   `downloader_storage` volume, the memory limit and `BROWSER_NO_SANDBOX`, and no
   `build:`.
2. The old three-file line gives the same config as item 1 apart from `build:`, so
   a host that has not edited its `.env` still runs a correct downloader.
3. The planner's and the ledger's prod fragments each carry a `logging` size cap.
4. No file in the repo still gives the three-file line as the way to run the
   downloader in production, and the guide has a migration for the volume rename.
5. `npm run check` passes.

## Log

**2026-10-25: built.** Measured with `docker compose config`, with dummy values for
the required variables:

- The two-file line (`compose.prod.yaml`, `compose.downloader.prod.yaml`) now
  differs from the three-file line only by the three `build:` lines the source
  file adds. Done when 1 and 2.
- Against `origin/main`'s three-file line it differs in the volume (`storage` to
  `downloader_storage`, so `webtools_storage` to `webtools_downloader_storage`)
  and in losing `build:`. Nothing else moved.
- The planner and the ledger each carry `json-file` with `max-size: 10m`,
  `max-file: 3`. Done when 3.

The volume rename is the only change a host has to act on. The guide's new
"Renaming the downloader's volume" section is copy, check, up, look, and is
written from these files, not run against a host. The repo-33 section now points
at it, so a host still before repo-33 copies straight into the new name.

**Not in the brief, fixed here.** `.devcontainer/README.md` gave the three-file line
as its `config` example. The guide's "On the LAN as well" told a host to override
`compose.downloader.yaml`, which a host no longer merges.

**Left alone.** `cloudflared`'s log is uncapped too. The owner's question named the
planner and the ledger, and the tunnel's log is small. `release.yml` still says
`compose.prod.yaml` pins the version, which has been `.env`'s job since repo-33.
That is stale, but in a workflow file outside this change's paths.
