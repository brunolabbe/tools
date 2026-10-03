---
id: dl-54
tool: downloader
title: Publish terms and a takedown contact, and decide what the operator keeps about who fetched what
kind: work-package
status: ready
milestone: M5
depends_on: []
difficulty: standard
---

# dl-54 — Terms, takedown, and what is logged

**Packages:** `web` (a terms page and a link to it), `api` (log fields and
retention, if that changes), and `docs/02-DEPLOYMENT.md`.

## Why

[00-ANALYSIS.md](../00-ANALYSIS.md) §8 says what is legal to download "depends
on the content and the site's terms — that is a decision for whoever operates
it". The code enforces one line, `DRM_PROTECTED`, and leaves everything else to
the operator. For a public instance, the operator is the owner, answering for
strangers' requests.

A public service is expected to say three things. Today it says none of them:

1. **What it may be used for.** The UI has no terms and no statement at all.
2. **Who to contact** when a rights holder, or the owner of a site being
   hammered through it, wants something stopped.
3. **What it records.** `request-log.ts` logs every request's `ip` next to its
   redacted path. Whether a probed page's URL also reaches a log line, and how
   long the host keeps those logs, is not written down. That is also what the
   owner would need to answer an abuse report.

This is not legal advice, and the ticket must not pretend otherwise. It records
the owner's choices, and the build makes the service say them.

## Decisions — all three answered by the owner

**1 — answered 2026-09-13: keep 14 days, option A below.** The client address
and the probed page URL are kept for 14 days and then deleted, and the terms
page says so. It was the recommendation, so nobody was overridden.

**2 — answered 2026-09-28: `abuse@oludoi.com`,** an alias created with
Cloudflare Email Routing and forwarded to a private inbox. The inbox behind it
is never published, and the alias can be retired without touching it.

**3 — answered 2026-09-28: an agent drafts, the owner approves.** The builder
drafts the text from the decisions on this page. The page stays marked as a
draft until the owner approves it in the pull request. It is not legal advice
and does not say it is.

The answer covers the database as well as the logs. That makes two pieces of
work the build owns:

- **Job rows.** A sweep deletes job rows older than 14 days, or at least clears
  their `source_url`. Nothing deletes a job row today.
- **Docker logs.** Docker's default `json-file` logging driver rotates by size
  (`max-size`, `max-file`), not by age. So "14 days" in the logs is a size
  measured from a day's traffic, or a driver that can expire by time. It is not
  one setting in `compose.downloader.prod.yaml`.

## The decision

**1 — Logging retention.** Answered above.

- **A — Keep `ip` and the probed URL for a short, fixed period (recommended),**
  such as 14 days. That is long enough to answer "who asked for this", and it
  is stated on the terms page.
- **B — Keep no address at all.** Nothing to disclose and nothing to answer an
  abuse report with. It also blinds dl-51's and dl-52's tuning, which reads
  these logs.
- **C — Leave logs as they are.** Retention is then whatever the host's Docker
  logging driver does, which today nothing pins.

**Whichever option is chosen, it has to cover the database, not only the
logs.** Every `jobs` row keeps its full `source_url`, and no production code
deletes a job row: `JobStore.delete` has no caller outside the tests, and the
retention sweep removes files, tokens and thumbnails only. So today every page
anyone downloaded from is kept for as long as the `/data` volume lives. That
is longer than any of the options above. The outcome record in
[dl-57](./dl-57-a-record-of-how-probes-and-downloads-end.md) stores hostnames
only, so it adds nothing to this question.

**2 — The contact.** An address the owner is willing to publish. It should not
be the one the Access policy allows, so the login address stays unpublished
while the planner still uses it.

**3 — The terms text itself.** The owner writes it or approves it. An agent
drafts it, and the draft is labelled as a draft until the owner approves it.

## Build

In this order:

- A first step that measures exactly which fields reach a log line during one
  probe and one download.
- A terms page served same-origin, which dl-35's CSP needs no change for. It
  says that no video is stored: dl-53 streams each file to its visitor and
  keeps no copy. That is true only once dl-53 has landed, so the page ships
  after it.
- The retention made explicit in `compose.downloader.prod.yaml`'s logging
  options.
- A sweep that deletes `jobs` rows older than 14 days, or clears their
  `source_url`, alongside the existing prunes in `db/job-store.ts`.
  `JobStore.delete` still has no production caller on `a084170`.
- The page also says what dl-57's outcome record keeps: a hostname and
  resolver timings per probe, for `OUTCOME_RETENTION_DAYS` (90 by default),
  never a path or a query string. A page about what the service records
  cannot leave out a table it records to.
- The alias itself is created on the dashboard by the owner. It is not
  automated in `scripts/cloudflare-setup.mjs`, because that would need a
  permission the token does not have (see dl-52's part 2).

## Done when

1. The UI links to a same-origin terms page that states: what the service may
   be used for, the DRM line, that no video is stored, the 14-day retention of
   address and page URL, the outcome record's hostname-only 90 days, and
   `abuse@oludoi.com`.
2. A test proves a job row older than 14 days is gone, or has no
   `source_url`, after the sweep runs, and that a younger one is untouched.
3. `compose.downloader.prod.yaml` pins log retention, with a comment saying
   how the size was derived from a day's traffic, or which driver expires by
   age.
4. The first step's measurement, the fields that reach a log line during one
   probe and one download, is in this Log.
5. The owner has approved the terms text in the pull request, and the draft
   label is gone.
6. `npm run check` and the downloader's suite pass.

## Log

- 2026-09-13 — Filed as `needs-decision`. The log fields named above were read
  from `request-log.ts` on `origin/main` `1835657`. The per-probe fields have
  not been measured.
- 2026-09-13 — Decision 1 answered: keep 14 days. Parts 2 and 3 are open.
  The Docker `json-file` size-not-age point comes from that driver's options,
  not from a measurement on the host.
- 2026-09-14 — The terms page will say that no video is stored, which follows
  from dl-53's decision.
- 2026-09-28 — Parts 2 and 3 answered by the owner, each the recommendation:
  `abuse@oludoi.com` by Email Routing, and an agent's draft for the owner to
  approve. Moved to `ready`. Re-read against `a084170` before asking: no terms
  page, no logging options in the prod overlay, and still no production
  caller of `JobStore.delete`, so every premise above still holds. Added the
  outcome record's 90-day hostname retention to what the page must say,
  because dl-57 landed after this ticket was filed.
- 2026-10-03 — Built, on `origin/main` `ebb808b`, awaiting a gate. The measurement
  came first, as the ticket orders. **Claim: at `info`, the level
  `compose.downloader.yaml` sets, one probe, one job and one opened link write
  six lines, and these are every field on them.** Command: a throwaway test
  (deleted; `api/test/log-fields.test.ts` is its permanent form) driving the
  stub-resolver harness at `info` with the client address `203.0.113.9`. Output,
  fields beyond pino's `level time pid hostname msg`:
  - `request` (three, one per route): `requestId method url status durationMs ip`.
    `url` is the route called — `/api/probe`, `/api/jobs`, `/api/files/[redacted]`
    — so the page, which travels in the POST body, is never on it.
  - `probe complete`: `resolver variants drm preview previewSource requestContext`.
    **No `requestId`, no `ip`**: it logs through `context.logger`, not the request's
    child. `requestContext.headers.Referer` is the page, as
    `https://site.example/watch/42?[redacted]`, so origin and path are kept and
    the query is not. With the direct resolver the Referer is `origin + "/"`.
  - `job accepted`: `requestId jobId variantId`. `job completed`:
    `jobId requestId sizeBytes container transcodes attempts`. Neither has a URL.
  - At `debug` only, `re-probe complete` carries the same Referer, and
    `/api/health` polling.
  - **A failure is different.** `request failed` (5xx) and `request rejected`
    (4xx) carry `requestId method url code status details`, and `details.url` is
    the page with its path: `http://127.0.0.1/clip/9?[redacted]` for a resolver
    error, `http://127.0.0.1/private/x` for a `BLOCKED_TARGET`. Those lines share a
    `requestId` with the `request` line that holds `ip`, so for a failure the
    address and the page are joined by id. For a success they are joined only by
    timestamp, plus the `jobs` row (`jobId` to `source_url`) and `job accepted`
    (`requestId` to `jobId`).
  - Size: those six lines are 1,540 bytes, 2,184 once wrapped in Docker's
    `json-file` envelope (`JSON.stringify({log, stream, time})`, computed over the
    measured lines; not read from a Docker host).
  - **The database holds more than the log does.** A failed job's `error_json`
    carries `details.url` with its query string intact (`...?sig=SECRETQ`),
    as does `source_url`, so the retention sweep deletes the **row**
    (`JobStore.pruneJobs`); clearing `source_url` alone would have left the
    credential in a second column. `api/test/job-retention.test.ts` asserts the
    premise before it asserts the deletion.
    What was built: the sweep (`runSweep` in `api/src/server.ts`), the terms page
    (`web/public/terms.html`, a static file, so dl-35's policy needed no change and
    `api/test/terms-page.test.ts` asserts it uses nothing that policy refuses), the footer link,
    the compose log cap, and the `docs/02-DEPLOYMENT.md` section.
    **What the brief had wrong or left out:**
  - _Docker cannot express "14 days"._ The ticket said so and offered two
    routes, a size derived from traffic or a driver that expires by age. The first
    holds the lines **longer** on a quiet host, which breaks the promise in the
    direction that matters, and the second (`journald`) fails to start the
    container on a host without it, which nothing here can check. The compose cap
    is therefore a size (5 x 10 MB), its comment says so, and the page says
    "about 14 days" and that a quiet service keeps lines longer. The traffic the
    size assumes (1,400 visits a day) is an assumption, not a measurement of the
    host. Reported as an open decision for the owner; the page is worded to be true
    either way, and goes back to "14 days" if one of the two age routes is taken.
  - _Deleting jobs shortens `LINK_ROW_GRACE_MS`._ `job_links` cascades from `jobs`,
    so the 30-day grace for answering `410` rather than `404` could never take
    effect; it is now `JOB_RETENTION_DAYS` days, and `api/src/jobs/links.ts` says why.
  - _`docs/02-DEPLOYMENT.md` said "neither table carries a path, a query string or
    an address"._ True of `probe_outcomes` and of what `report.js` prints, false of
    `jobs`, which holds the full `source_url`. Corrected there, along with the
    report's download window, which the sweep now caps at 14 days.
  - _The page is behind Access._ A rights holder sent to `/terms.html` meets a login
    until dl-49 removes it. The alias works regardless. The deployment doc says how
    to bypass the path; I did not touch `scripts/cloudflare-setup.mjs`.
    **Could have been folded in, and was not:** a Bypass for `terms.html` in
    `scripts/cloudflare-setup.mjs` (it is a decision about whether the page should be
    public before dl-49, and the script belongs to dl-52's lane); and a UI test that
    the footer is absent from the mock build (nothing asks for it).
    **Not done:** done-when 5 (the owner's approval, and removing the draft
    paragraph); done-when 3's "how the size was derived" rests on an assumed day's
    traffic, not a measured one.
- 2026-10-03 — Gate 1 (FAIL at `b47d5a4`), repaired. Owner decisions that round:
  keep the size cap as built (option A of the three); leave the terms page behind
  Access until dl-49 and build no bypass; purge expired previews in the sweep;
  file the thumbnail-token finding as dl-75.
  - **The 6-line, 1,540/2,184-byte figure above was the stub harness, and was
    wrong as a per-visit number.** Claim: a first visit is 16 lines and 5,848
    bytes in Docker's envelope, not 6 and 2,184. Command: a live
    `node tools/downloader/api/dist/main.js` at `LOG_LEVEL=info`, direct resolver,
    real ffmpeg, a local origin (scratch `origin.mjs`) that 302s `/page` to
    `/m.mp4?sig=SECRETQ`; `POST /api/probe`, `POST /api/jobs`, `GET` the link, then
    a measuring script over the bytes appended to the log. Output: `lines=7
raw=1811 wrapped=2551` for those three calls (the gate saw 1,812 and 2,552), the
    seventh line being `engine stream complete`, which the stub engine omits. Then
    `GET /`, the stylesheet, the script, `/favicon.ico`, `/api/config`, the probe's
    and the job's event streams and `/api/thumbnail/<token>` (a miss) added nine
    more: `lines=16 raw=4138 wrapped=5848`. The gate measured 7 more lines and
    2,524 bytes for the same things; I get 9 and 3,297, because my event streams
    each wrote a line when curl's `-m 3` closed them and my preview miss wrote two.
    A browser's EventSource reconnects, so neither count is exact; call it 6 KB.
    At 6 KB the 50 MB cap holds about 8,300 first visits, 600 a day for 14 days, not
    the 1,400 the first comment stated. The cap is unchanged: the owner chose it
    knowing it is a size, and "about 14 days" on the page is the ordinary-use
    wording, which does not change with this number. `compose.downloader.prod.yaml`
    and `docs/02-DEPLOYMENT.md` carry the new figures. The traffic is still an
    assumption.
  - **H1, previews outlived their ten minutes.** Reproduced as the gate did, from the
    code: `ThumbnailStore.get` is the only expiry and nothing sweeps it. Fixed with
    `ThumbnailStore.purgeExpired`, called from `runSweep`, which tests with `get`'s
    own comparison. `api/test/thumbnail-purge.test.ts`: 2 cases green; with the
    call replaced by `0` both go red (`Tests 2 failed (2)`). The page's sentence is
    unchanged and now true within the sweep's 60 s.
  - **Taken from the low findings:** L1 (the architecture sentence now says the
    `request` line's own `url` keeps the request's query), L2 and L3 (page text:
    health check excepted, and the video file's own address named), L4 (the
    retention test now plants rows at the limit and a millisecond either side; moving
    the cutoff to 14 days 23 hours turns it red), L5 (both stale comments) and L6
    (the page says the service's own code never asks for a key or a licence, which
    is what the code shows, and nothing about the browser tier's page player).
    **Left:** L7 (`cloudflared` has no log cap; its default lines are unmeasured here
    and it is the shared overlay's service, not this tool's, so it belongs to a
    `repo-` ticket if anyone measures it).
  - **The Access login in front of the page** stays until dl-49, by the owner's
    choice. Nothing built; `docs/02-DEPLOYMENT.md` says so.
  - The dropped finding is `dl-75`, not built.
