---
id: dl-52
tool: downloader
title: Size the production limits for anonymous traffic, and rate-limit /api/ at Cloudflare's edge
kind: work-package
status: ready
milestone: M5
depends_on: [dl-51]
difficulty: standard
awaiting: the owner's two steps after merge — redeploy the host, then either create the dashboard rate limiting rule (Free plan, path starts with /api/, 20 per 10 s) or decide to create none, and fill in the allowances table in docs/02-DEPLOYMENT.md from the rule form
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

| Setting                              | Production | Source                                                                                               |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| `MAX_CONCURRENT_BROWSERS`            | 2          | owner, recommended: 800 MiB and 2.5 cores at full probe load                                         |
| `MAX_CONCURRENT_JOBS`                | 2          | owner, recommended. The table's "no more than 2" holds, and upload is not what binds                 |
| `MAX_CONCURRENT_FRAME_GRABS`         | unset      | follows `MAX_CONCURRENT_JOBS`. Nothing measured says otherwise; a frame grab was not isolated        |
| `MAX_FILE_SIZE_MB`                   | **4096**   | owner, **against** the 1024 recommendation: about 90 min of 1080p, so a whole film fits              |
| `RATE_LIMIT_PROBE_PER_MINUTE`        | 4          | the table's proposal. Stated to the owner with the questions, not separately asked                   |
| `RATE_LIMIT_JOBS_PER_MINUTE`         | 2          | as above                                                                                             |
| `MAX_JOBS_PER_CLIENT`                | **2**      | owner, asked separately, **against** the 1 recommendation (see below)                                |
| `RATE_LIMIT_PROBE_EVENTS_PER_MINUTE` | 4          | owner, 2026-10-06, asked separately: the probe's number (added by the build, not in the first brief) |

The two per-minute rate limits are policy, not something a host measurement
sizes. If the owner overrides them later, that changes this table, not the Build.

**`MAX_JOBS_PER_CLIENT` = 2 is a trade the owner chose knowingly.** It equals
`MAX_CONCURRENT_JOBS`, so one address can hold both global slots. While it does,
every other visitor's download waits in line or is refused. At the measured
29 Mbps, a 4096 MB file holds a slot for about 20 minutes. The cap is keyed on
the client address, so a household behind one router shares it. The
alternative, 1, keeps a slot free for a stranger, and the owner declined it.
The comment in `compose.downloader.prod.yaml` says so, so that the value does
not read as an oversight next to dl-51's "one client should not be able to hold
both of the default two running slots".

**2 — Where the edge rule lives. Answered 2026-09-28 by the owner: A.**

- **A — On the dashboard, documented in `02-DEPLOYMENT.md` (recommended).**
  There is one rule, and it changes rarely.
- **B — In `scripts/cloudflare-setup.mjs`.** It becomes reproducible, but the
  API token needs a fourth permission. The script's header says a token with
  more than its three permissions "is a token doing more than this". So B
  changes that argument, not just a list.

For either option, confirm what this zone's plan allows (how many
rate-limiting rules, which periods, which actions) before writing the rule. The
repo has no record of it. **The zone is on the Free plan** (the owner,
2026-10-06), whose published allowances are one rule, the fields Path and
Verified Bot only, a 10 s period and block, and Block as the action: no Host, so
the rule cannot be scoped to the downloader (see the Log).

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
- 2026-10-05 — `MAX_JOBS_PER_CLIENT` put to the owner on its own, after they
  asked whether a visitor can download several videos at once. They chose **2**
  (today's default) over the recommended 1, knowing that one address can then
  hold both job slots. The table and its note are corrected. The same answer
  raised a probable UX gap: a download refused by the per-client cap starts
  from a plain `<a href download>`, so it may surface only as a failed browser
  download. That is being reproduced for its own ticket, not folded in here.

- 2026-10-06 — **Built on `4907d9a`** (branch `dl-52-production-limits`).
  `compose.downloader.prod.yaml` now sets the values below, each with a comment
  naming its measurement or "the owner's choice"; `MAX_CONCURRENT_FRAME_GRABS` is
  left unset with a comment saying it follows jobs. Its header now says "six
  things" and lists the limits and the Turnstile keys, which the old "four" had
  not counted. `docs/02-DEPLOYMENT.md` gains a production-values table under
  "Tightening it past one user" and a section, "The edge rate limit on `/api/`",
  with the rule's expression, threshold, period and action. Rendered with the
  command in Done-when 1, the placeholders set **in that command's environment
  only, never in a committed `.env`**: `GHCR_OWNER=placeholder-owner`,
  `DOWNLOADER_TAG=0.0.0-placeholder` (also a required variable) and
  `TUNNEL_TOKEN=placeholder`. Exit 0, and the lines that matter:

  ```
  MAX_CONCURRENT_BROWSERS: "2"
  MAX_CONCURRENT_JOBS: "2"
  MAX_FILE_SIZE_MB: "4096"
  MAX_JOBS_PER_CLIENT: "2"
  RATE_LIMIT_JOBS_PER_MINUTE: "2"
  RATE_LIMIT_PROBE_EVENTS_PER_MINUTE: "4"
  RATE_LIMIT_PROBE_PER_MINUTE: "4"
  TRUST_PROXY: 172.30.42.0/24
  ```

- 2026-10-06 — **The brief counted six values; the build sets seven, and that is a
  fold-in.** `RATE_LIMIT_PROBE_EVENTS_PER_MINUTE` does not follow
  `RATE_LIMIT_PROBE_PER_MINUTE`: it is its own default of 10
  (`API_DEFAULTS.rateLimitProbeEventsPerMinute`), pinned equal to the probe's by
  `rate-limit.test.ts` ("`shipped.rateLimitProbeEventsPerMinute` `toBe`
  `shipped.rateLimitProbePerMinute`") and by the comment on the field ("Deliberately
  the same number"). Setting the probe limit to 4 and leaving events at 10 would
  have broken dl-46's stated invariant in production while the test, which reads
  defaults, stayed green. It is set to 4. Not a new decision: it is the probe's
  number, by dl-46's rule. If the owner would rather it stay at 10, delete that
  line; the invariant still holds from the safe side (events at least the probe's).
- 2026-10-06 — **The edge rule's numbers are derived, and the plan's allowances
  are unconfirmed.** Threshold 60 requests per 60 s per IP, with a 20 per 10 s
  fallback if the plan offers only a 10 s period, action Block. Derived from
  dl-54's 7 `/api/` requests per first visit (11 request lines with the page), not
  from any dashboard counter. No agent can read the dashboard, so the
  allowances table in `02-DEPLOYMENT.md` says `unconfirmed` in every row and the
  rule is "not created yet". Those are the owner's two steps after merge:
  redeploy, and create the rule and fill that table in.
- 2026-10-06 — **Not folded in: dl-77** (a refused download fails silently). It is
  `needs-decision` and the answer chooses between a change in `web`, in `api`, and
  possibly `contract`; none of that is free here. The deployment doc names it
  where the edge rule would trigger it. **Found while reading the brief:** the
  header's "four things" was already stale before this ticket (it omitted the
  Turnstile keys, dl-50); corrected in the same edit.

- 2026-10-06 — **Gate 1 (CONCERNS) answered; the owner's answers via
  `AskUserQuestion`, 2026-10-06.** (1) The rule section is rewritten for a
  fields-limited plan, with a fields row in the allowances table: option **A**, the
  gate's recommendation. (2) **The zone is on the Free plan**, chosen from Free /
  Pro or higher / not sure. (3) `RATE_LIMIT_PROBE_EVENTS_PER_MINUTE` stays **4**,
  chosen over deleting the line, so the compose comment now traces to that answer
  and the ticket's table has a row for it.
  - **M1 reproduced, and it changes the rule.** Cloudflare's rate limiting page,
    fetched 2026-10-06, gives Free: 1 rule, fields "Path, Verified Bot", period
    10 s, mitigation 10 s, action Block; Pro: 2 rules, "Host, URI, Path, Full URI,
    Query, Verified Bot", periods to 1 min, blocks to 1 h. So on Free the Host
    clause cannot be written, and the rule is `Path starts with /api/` at 20 per
    10 s per IP, **spanning every hostname in the zone** (the planner's and the
    ledger's `/api/` too). The doc now leads with that and keeps the Pro form as a
    column, says whether to create it at all is the owner's choice at the
    dashboard, and says the planner's and ledger's request counts were not
    measured. Whether Free offers a `starts with` operator on Path is **not
    published** on that page, and is a row in the table the owner fills in.
  - **L1** — the compose comment now names the owner's answer, not "the ticket's
    table".
  - **L2 reproduced** — no core count is recorded anywhere (`grep -rn "cores"` on
    the ticket finds only the 2.5 cores used by two probes). The comment now says
    "the owner's choice, recommended with those numbers attached".
  - **L3 reproduced.** Rendered without the downloader overlay
    (`docker compose -f compose.downloader.yaml -f compose.prod.yaml config`,
    placeholders in the environment) it already has `MAX_CONCURRENT_BROWSERS "2"`,
    `MAX_CONCURRENT_JOBS "2"` and `MAX_FILE_SIZE_MB "4096"`; the three-file render
    adds exactly `MAX_JOBS_PER_CLIENT` and the three rate limits. So the render
    cannot prove the overlay sets those three; this was verified by reading the
    overlay. The header and the comment now say what each guards, and count three
    rate limits plus the cap. The Done-when 1 render therefore proves four values,
    not seven.
  - **L4 reproduced by reading `createJobStream`.** `maxAttempts` is 8 and
    `DEFAULT_BACKOFF` is 500 ms, factor 2, cap 15,000 ms, jitter 0.25, so the
    delays are 500 + 1,000 + 2,000 + 4,000 + 8,000 + 15,000 + 15,000 + 15,000 =
    60,500 ms without jitter, and the ninth failure calls `stop()`. A 60 s block
    outlasts that; Free's 10 s does not. The doc now says so, sets the Pro block to
    10 s, and counts a reconnect that opens as two requests (the stream and the
    reconcile `GET /api/jobs/:id`).
  - **L5 accepted.** "7 lines" in dl-54's "the API alone" counts log lines from
    three requests. The 7 holds by a second count: seven of dl-54's eleven request
    lines are under `/api/`. The doc says that. **This ticket's own Build text
    carries the old wording ("7 API requests with no page, 11 lines with it") and is
    left as written**, since the Build records what was asked.
  - Not changed: the 60 per 60 s and 20 per 10 s thresholds. The gate found them
    sound for the downloader (about 19 `/api/` requests a minute at the in-process
    ceiling).
