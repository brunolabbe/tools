---
id: dl-52
tool: downloader
title: Size the production limits for anonymous traffic, and rate-limit /api/ at Cloudflare's edge
kind: work-package
status: needs-decision
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

A starting profile to put against those numbers, not a recommendation made
without them:

| Setting                       | Today | Proposed                           |
| ----------------------------- | ----- | ---------------------------------- |
| `MAX_CONCURRENT_BROWSERS`     | 2     | what memory allows at ~300 MB each |
| `MAX_CONCURRENT_JOBS`         | 2     | 2                                  |
| `MAX_FILE_SIZE_MB`            | 4096  | 1024                               |
| `MAX_TOTAL_STORAGE_GB`        | 50    | at most half the free disk         |
| `FILE_RETENTION_HOURS`        | 6     | 2                                  |
| `RATE_LIMIT_PROBE_PER_MINUTE` | 10    | 4                                  |
| `RATE_LIMIT_JOBS_PER_MINUTE`  | 5     | 2                                  |
| `MAX_JOBS_PER_CLIENT` (dl-51) | —     | 1                                  |

**2 — Where the edge rule lives.**

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

Written with the decision. The settings go in `compose.downloader.prod.yaml`'s
`environment`, each with a comment saying which host measurement it came from.
That keeps a later reader from mistaking a sized value for a guess.

## Done when

Written with the decision.

## Log

- 2026-09-13 — Filed as `needs-decision`. The table is a starting point.
  Neither host measurement has been taken.
