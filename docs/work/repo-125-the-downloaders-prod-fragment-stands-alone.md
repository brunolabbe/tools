---
id: repo-125
tool: repo
title: the downloader's prod fragment stands alone, its volume is renamed, and the planner's and ledger's logs are capped
kind: fix
status: done
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

## Review

**Gate: PASS** — 2026-10-25 · `b9c6c8be..1bf4f5d5` (merge-base of origin/main and the head; the dispatch named 558ce370, and origin/main has since moved to b9c6c8be, the branch's parent) · Sonnet 5.5, depth medium. Seven findings, all `low`. No `high`.

| Done when                                                                                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `-f compose.prod.yaml -f compose.downloader.prod.yaml config` gives `init`, `shm_size`, `restart`, the `downloader_storage` volume, the memory limit, `BROWSER_NO_SANDBOX`, no `build:` | **verified** — `docker compose config` (v5.6.0, dummy env, exit 0) prints `init: true`, `shm_size: "1073741824"`, `restart: unless-stopped`, volume `downloader_storage` → `webtools_downloader_storage`, `memory: "4294967296"`, `BROWSER_NO_SANDBOX: "true"`; `grep -n build` of the output is empty. Positive control: the same command at the base prints none of those keys (the repo-125 fault). No test asserts it (F7). |
| 2. The old three-file line gives the same config as item 1 apart from `build:`                                                                                                             | **verified** — `diff head-two.yaml head-three.yaml` is the three `build:` lines and nothing else. Against the base's three-file line the head's two-file config differs in the volume name (`storage` → `downloader_storage`) and the missing `build:` only.                                                                                                                                                                    |
| 3. The planner's and the ledger's prod fragments each carry a `logging` size cap                                                                                                           | **verified** — `docker compose config` of each tool's two-file line shows `driver: json-file`, `max-file: "3"`, `max-size: 10m`; the base shows none. No test asserts it.                                                                                                                                                                                                                                                       |
| 4. No file still gives the three-file line; the guide has a migration for the volume rename                                                                                                | **verified** — `git grep -F` for the three-file shapes finds 12 matching lines in 6 files at the base and none at the head outside `docs/work` ticket history; the "Renaming the downloader's volume" section exists. The migration is correct and safe in order (F1 to F3 are wording and a stale neighbour). One stale partial in `.devcontainer/Dockerfile` (F5).                                                            |
| 5. `npm run check` passes                                                                                                                                                                  | **proven** — exit 0 at the head, after farm and `npm run build`; its oxlint warnings are in source files, and the diff touches none. The two specs that read compose files, `scripts/test/cloudflare-setup.test.ts` and `tools/downloader/api/test/terms-page.test.ts`, pass: 26 of 26.                                                                                                                                         |

- **low** · no `Done when` line depends on it · F1 — `docs/02-DEPLOYMENT.md`, "Migrating the volumes onto the project name" (the repo-33 section) still prints `webtools_storage` in its step 4 `volume create` and copy, its step 5 check, and its prose "the new project will look for `webtools_storage`". The one-paragraph preface says to substitute `webtools_downloader_storage` by hand. A host that pastes step 4 verbatim, which only a host still on the pre-repo-33 layout does, copies into the old name, and the new container then starts on an empty `webtools_downloader_storage`. Nothing is lost: both volumes hold the data and that section's step 6 says what an empty list means. The ticket's Log says such a host "copies straight into the new name", which holds only after the hand substitution. Direction: write the new name in those three blocks and the one sentence.
- **low** · no `Done when` line depends on it · F2 — the Renaming section says skipping it "costs the job list and every link still inside its window, and nothing older". `jobs.db` also holds `probe_outcomes`, kept `OUTCOME_RETENTION_DAYS` = 90 days by default (`tools/downloader/api/src/config.ts`) and read by the operator report (`api/src/report.ts`). The sentence understates what skipping costs, which is the unsafe direction, and the old volume is still there to recover it from.
- **low** · no `Done when` line depends on it · F3 — step 3 "Check the copy" ends "with `jobs.db` in the listing", and its command prints no listing (`du -sb`, then two `find | wc -l` counts). The sentence was copied from the repo-33 section's step 5, which has the same gap. The counts still catch a stray `-wal` file; the instruction cannot be followed. Direction: add `ls -la /new` to the command.
- **low** · no `Done when` line depends on it · F4 — `.env.prod.example` and the guide say a host that keeps `compose.downloader.yaml` in `COMPOSE_FILE` gets "a `build:` it never uses" and that dropping it "is tidying, not a fix". `docker compose build` and `up --build` on that host do use it, and tag the result with the release image's name, which is the second fault the ticket's own Why describes. Measured: the three-file config at the head carries `build: context … dockerfile: tools/downloader/Dockerfile`. The text understates the risk of keeping the file; Done when 2 only asks that the line run a correct downloader, and it does.
- **low** · no `Done when` line depends on it · F5 — `.devcontainer/Dockerfile` still describes the deployment-overlay check as `docker compose -f compose.downloader.yaml ... config`. The ellipsis keeps it out of the literal three-file shapes, and it opens a deployment check with the source file. A stale comment, no behaviour.
- **low** · no `Done when` line depends on it · F6 — "every tool's log is capped" (the ticket title and the commit subject) holds for the three tools' prod fragments, but in a merge of all six files `nominatim`, `overpass` and `valhalla` (`compose.planner.yaml`, the planner's own optional services, whose first import is hours of CPU) and `cloudflared` carry no `logging` key. The Log names `cloudflared` as left alone and is silent on the other three. Done when 3 asks only for the prod fragments.
- **low** · `nfr:maintainability` · no `Done when` line depends on it · F7 — the five settings the two downloader files share (`init`, `shm_size`, `BROWSER_NO_SANDBOX`, the volume, the memory limit) are now written twice and kept in step by two comments ("change one here and change it there"). Nothing asserts that the prod fragment keeps them, so the fault repo-125 repairs can re-enter when the next setting is added to the source file alone. No live call site today.
- **dropped** · `du -sb` on Alpine (step 3): BusyBox's `du` has `-b`, read in its source on the mirror's master (`OPT_b`, "Apparent size"); the command is also the repo-33 section's. Not a defect.
- **dropped** · the LAN-override sentence ("republish the port … in a local override") merges `ports` by appending, so the override cannot replace the loopback binding. That sentence is older than this branch, which only swapped the file name in it; not measured, out of the reviewed range.
- **dropped** · the old volume is unreferenced once `up -d` recreates the container, so `docker volume prune -a` would take it. The section says to keep it and when to remove it, as the repo-33 section does; not a defect of this diff.
- **findings** · the hunt returned 10; 7 carried (F1 to F7), 3 dropped.
- NFR: security ✓ (the loopback bind, `BROWSER_NO_SANDBOX` and every limit are unchanged in the merged config; no credential added) · performance n/a (the log caps bound disk use only) · reliability — F1, F2 and F3 are the migration's wording, and its order is safe (stop, optional remove, copy, check, up, look, remove) · maintainability — F5 and F7.

Dispositions, 2026-10-25, on the branch after the gate:

- F1 fixed: the repo-33 section's steps 4 and 5, and its prose sentence, now name `webtools_downloader_storage`. The preface no longer asks for a hand substitution.
- F2 fixed: the Renaming section names the probe outcomes, kept for 90 days, beside the job rows.
- F3 fixed: every copy check in both sections ends with `ls -la /new`.
- F4 fixed: the guide, `.env.prod.example` and the fragment's header say that `build:` is still the remaining fault on a three-file host, and tell it to drop the file. They no longer call it unused.
- F5 fixed: `.devcontainer/Dockerfile`'s comment gives the two-file command.
- F6 fixed in the title: it now names the planner and the ledger. The Log names the grounding services and `cloudflared` as uncapped.
- F7 accepted, recorded: nothing asserts that the prod fragment keeps the settings it shares with the source file. A text scan in the style of `image-closure.test.ts` would close it. Neither file has a caller that could reintroduce the gap without someone editing the prod fragment itself.

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

**Left alone.** `cloudflared`'s log is uncapped too, and so are `valhalla`'s, `nominatim`'s and `overpass`'s in `compose.planner.yaml`. The owner's question named the
planner and the ledger, and the tunnel's log is small. `release.yml` still says
`compose.prod.yaml` pins the version, which has been `.env`'s job since repo-33.
That is stale, but in a workflow file outside this change's paths.

**2026-10-25: run on the live host, after the merge.** The owner redeployed
before copying. The new volume mounted under the right name, so the guide's
`docker inspect` check passed, but the downloader was on a fresh database: a
4096-byte `jobs.db` beside a 123 KB `-wal`, and no `out/` or `tmp/` from the old
volume. Step 1's "If `up -d` has already run" path worked as written: stop,
count, remove, copy, check, up. The empty window had collected 0 jobs and 1 probe
outcome, which were lost. After the copy both volumes read 90112 bytes with the
same 77824-byte `jobs.db`, and every service came up healthy.

Two things the guide lacked, added afterwards:

- Compose warns on every `up` that a volume made by `docker volume create`
  `already exists but was not created by Docker Compose`. It is harmless, and
  neither migration section mentioned it.
- Step 4 now says that a correct mount does not prove the data, and how to
  recognise a fresh database.
