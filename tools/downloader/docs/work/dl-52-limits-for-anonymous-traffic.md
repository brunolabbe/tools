---
id: dl-52
tool: downloader
title: Size the production limits for anonymous traffic, and rate-limit /api/ at Cloudflare's edge
kind: work-package
status: ready
milestone: M5
depends_on: [dl-51]
difficulty: standard
---

# dl-52 — Limits for anonymous traffic

**Packages:** `compose.downloader.prod.yaml`, `docs/02-DEPLOYMENT.md`, and
possibly `scripts/cloudflare-setup.mjs`. No application code.

## Why

`docs/02-DEPLOYMENT.md` ("Operating it") says the defaults in
`compose.downloader.yaml` "assume a single trusted user on a laptop". It lists
what to tighten "once it is reachable by more than you", and it recommends a
Cloudflare WAF rate-limiting rule on `/api/` as a second layer. None of that is
done. `compose.downloader.prod.yaml` overrides only the image, `TRUST_PROXY` and
the health-check dependency.

The in-process limiter lives in memory, so a redeploy resets every bucket (see
[dl-6](./dl-6-security-and-limits.md)'s Log). An edge rule is the only limit
that survives a restart and costs the host nothing.

## The decision

**1 — The numbers.** They depend on the host, which this repo cannot see. Take
two measurements on the host before asking:

- `docker stats` while one browser probe and one HLS download run together:
  peak memory and CPU.
- The free disk under the `/data` volume.
- **The home connection's upload speed.** Added 2026-09-14: under
  [dl-53](./dl-53-finished-files-and-the-tunnel.md), every finished file streams
  to its visitor as it is produced, so this caps how many downloads can run at
  a useful rate. It probably binds harder than CPU or memory.

A starting profile to put against those numbers, not a recommendation made
without them:

| Setting                       | Today  | Proposed                                                          |
| ----------------------------- | ------ | ----------------------------------------------------------------- |
| `MAX_CONCURRENT_BROWSERS`     | 2      | what memory allows at ~300 MB each                                |
| `MAX_CONCURRENT_JOBS`         | 2      | upload speed ÷ one stream's bitrate, and no more than 2           |
| `MAX_CONCURRENT_FRAME_GRABS`  | = jobs | follows `MAX_CONCURRENT_JOBS` unless CPU says otherwise           |
| `MAX_FILE_SIZE_MB`            | 4096   | 1024; refused on the estimate, and a longer stream is cut (dl-53) |
| `RATE_LIMIT_PROBE_PER_MINUTE` | 10     | 4                                                                 |
| `RATE_LIMIT_JOBS_PER_MINUTE`  | 5      | 2                                                                 |
| `MAX_JOBS_PER_CLIENT` (dl-51) | 2      | 1                                                                 |

"Today" is `API_DEFAULTS` in `tools/downloader/api/src/config.ts` on `a084170`;
`compose.downloader.prod.yaml` still sets none of these. `MAX_TOTAL_STORAGE_GB`
and `FILE_RETENTION_HOURS` were in this table until dl-53 removed both.

**Part 1, measured and answered 2026-10-05.** The owner took these on the host
running the released `downloader-v0.8.0` (dl-53's streaming included), with the
hls.js demo page (`https://hlsjs.video-dev.org/demo/`, Big Buck Bunny, 10:35, five
renditions) as the stream:

| Measurement                      | Value                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `docker stats`, 2 probes at once | peak **250% CPU, 800 MiB** of the 4 GiB container limit; both fell when analysis ended      |
| Per browser probe                | about **125% CPU, 400 MiB** (the peak halved, node's baseline included)                     |
| One 1080p job                    | **3.6 MB/s ≈ 29 Mbps**, about 5× real time; the file was 465 MB, so the stream is ~5.9 Mbps |
| Line, idle                       | **199 Mbps down, 329 Mbps up** (speed.cloudflare.com, Montreal)                             |
| Line, during one download        | **178 Mbps down, 289 Mbps up**, so one job took about 40 Mbps of upload                     |
| Free disk under `/data`          | not taken: since dl-53 the volume holds only the job database, which dl-54 prunes           |

**What the numbers say.** The browser is what limits the host: two probes at
once already use 2.5 cores. A job, once analysed, is cheap. It runs as fast as
its source allows, not at the stream's bitrate. So "upload ÷ one stream's
bitrate" was the wrong formula. Upload is not the binding limit: 329 Mbps
covers about ten jobs at the measured rate.

**The owner's choices**, made via `AskUserQuestion` with these numbers attached:

| Setting                       | Production | Source                                                                                        |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `MAX_CONCURRENT_BROWSERS`     | 2          | owner, recommended: 800 MiB and 2.5 cores at full probe load                                  |
| `MAX_CONCURRENT_JOBS`         | 2          | owner, recommended. The table's "no more than 2" holds, and upload is not what binds          |
| `MAX_CONCURRENT_FRAME_GRABS`  | unset      | follows `MAX_CONCURRENT_JOBS`. Nothing measured says otherwise; a frame grab was not isolated |
| `MAX_FILE_SIZE_MB`            | **4096**   | owner, **against** the 1024 recommendation: about 90 min of 1080p, so a whole film fits       |
| `RATE_LIMIT_PROBE_PER_MINUTE` | 4          | the table's proposal. Stated to the owner with the questions, not separately asked            |
| `RATE_LIMIT_JOBS_PER_MINUTE`  | 2          | as above                                                                                      |
| `MAX_JOBS_PER_CLIENT`         | 1          | as above                                                                                      |

The three rate limits are policy, not something a host measurement sizes. If the
owner overrides them later, that changes this table, not the Build.

**2 — Where the edge rule lives. Answered 2026-09-28 by the owner: A.**

- **A — On the dashboard, documented in `02-DEPLOYMENT.md` (recommended).**
  There is one rule, and it changes rarely.
- **B — In `scripts/cloudflare-setup.mjs`.** It becomes reproducible, but the
  API token needs a fourth permission. The script's header says a token with
  more than its three permissions "is a token doing more than this". So B
  changes that argument, not just a list.

For either option, confirm what this zone's plan allows (how many
rate-limiting rules, which periods, which actions) before writing the rule. The
repo has no record of it.

## Build

1. **`compose.downloader.prod.yaml`.** Under `environment`, set the six values
   from the Production column above. Set them explicitly, even where they equal
   `API_DEFAULTS`, so that a later change to a default does not silently move
   production. Each one gets a comment naming its source: the measurement and
   its date, or "the owner's choice". That keeps a later reader from mistaking a
   sized value for a guess. Leave `MAX_CONCURRENT_FRAME_GRABS` unset, with a
   comment saying it follows jobs and why. Update the file's header list ("It
   changes four things") to match.
2. **`docs/02-DEPLOYMENT.md`, the downloader section.** Write the edge rule as
   option A: on the dashboard, documented here. Give its expression (the
   downloader hostname, path starting with `/api/`), its threshold, period and
   action. Size the threshold from dl-54's measured first visit (7 API requests
   with no page, 11 lines with it), with headroom for the event streams'
   reconnects. Leave room for what this zone's plan allows (number of rules,
   periods, actions). No agent can read the dashboard, so the owner fills
   that in. Mark it as unconfirmed until they have.
3. Land with `awaiting:` set to the owner's two steps after merge: redeploy, and
   create the dashboard rule with the plan's allowances recorded in
   `02-DEPLOYMENT.md`. Per repo-88's answer, those lines are PASS when built
   faithfully.

## Done when

1. `compose.downloader.prod.yaml` sets the six values above. Each comment names
   its measurement or the owner's choice. `docker compose -f
compose.downloader.yaml -f compose.prod.yaml -f compose.downloader.prod.yaml
config` renders them, quoted in the Log.
2. `docs/02-DEPLOYMENT.md` gives the edge rule's expression, threshold, period
   and action, with the threshold derived from dl-54's per-visit count in a
   sentence.
3. `npm run check` passes.

## Log

- 2026-09-13 — Filed as `needs-decision`. The table is a starting point.
  Neither host measurement has been taken.
- 2026-09-14 — dl-53 chose streaming with no stored files. Added the upload
  speed measurement, and marked `MAX_TOTAL_STORAGE_GB` and
  `FILE_RETENTION_HOURS` as removed by it. Still `needs-decision`: no host
  measurement has been taken.
- 2026-09-28 — Re-read against `a084170` before asking. dl-51 and dl-53 are
  done: `MAX_JOBS_PER_CLIENT` exists with a default of 2, the storage and
  retention settings are gone, and `MAX_CONCURRENT_FRAME_GRABS` is new. The
  table is corrected to match. The prod overlay still sets no limit. **Part 2
  answered by the owner: A**, the rule on the dashboard, documented in
  `02-DEPLOYMENT.md` with what the zone's plan allows. **Part 1: the owner
  will take the three host measurements and paste them.** The ticket stays
  `needs-decision` until they arrive.
- 2026-10-05 — **Part 1 measured and answered; `status: ready`.** The owner took
  the measurements on `downloader-v0.8.0` and chose browsers 2, jobs 2, and
  `MAX_FILE_SIZE_MB` 4096 (keeping today's value over the 1024 recommendation).
  They also chose to record now and build later. **The brief was wrong in one
  place:** it expected upload speed to bind ("probably binds harder than CPU or
  memory"). It does not. A job runs at its source's speed (29 Mbps measured), not
  at the stream's bitrate, and 329 Mbps of upload covers about ten of them. The
  browser is what limits the host. The free-disk measurement was dropped, since
  dl-53 left the volume holding only the job database.
