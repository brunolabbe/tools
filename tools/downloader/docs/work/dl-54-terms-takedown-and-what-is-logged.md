---
id: dl-54
tool: downloader
title: Publish terms and a takedown contact, and decide what the operator keeps about who fetched what
kind: work-package
status: done
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

## Review

### Gate 1

**Gate: FAIL** — 2026-10-03 · `ebb808b...b47d5a4` (`origin/dl-54-terms-and-takedown`; `origin/main` still `ebb808b` after the fetch) · code-review at medium, by hand · e2e and the container build not run (no docker here)

Re-issued at `8f131d8` and again at `cb37835`, with words, rows and verdicts unchanged; unpinned coordinates resolve at `cb37835`. Citations into text a later round removed or corrected are prose naming `b47d5a4`, the sha this section gated: row 2's boundary test, row 5's draft banner, and in H1, M1, L1, L2, L3 and L5. The log capture is a running instance (`api/dist/main.js`, real direct resolver and ffmpeg, a local origin that redirects `/page?sig=…` to `/m.mp4?sig=…`) at `info`, the level `compose.downloader.yaml@ebb808b:59 "LOG_LEVEL: info"` sets, then again at `debug`. 29 factual sentences on the terms page checked of 29; the four usage-rule sentences and the draft banner are not claims about behaviour.

| Done when                                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The UI links to a same-origin terms page stating use, the DRM line, no video stored, the 14-day address and page URL, the outcome record's hostname-only 90 days, and the alias | link `tools/downloader/web/test/terms-link.test.tsx:44 "expect(href).toBe("` ✓ · same CSP as the app `tools/downloader/api/test/terms-page.test.ts:58 "style-src 'self';"` ✓ · use `tools/downloader/api/test/terms-page.test.ts:93 "Use it for video you have the right to save"` ✓ · DRM `tools/downloader/api/test/terms-page.test.ts:90 "toMatch(/DRM/u)"` ✓ · no video `tools/downloader/api/test/terms-page.test.ts:91 "No video is stored"` ✓ · 14 days `tools/downloader/api/test/terms-page.test.ts:83 "about ${JOB_RETENTION_DAYS"` ✓ · 90 days, hostname only `tools/downloader/api/test/terms-page.test.ts:81 "API_DEFAULTS.outcomeRetentionDays} days"`, `tools/downloader/api/test/terms-page.test.ts:92 "the page's domain only"` ✓ · alias `tools/downloader/api/test/terms-page.test.ts:89 "abuse@oludoi.com"` ✓. The log is stated as "about 14 days" (the Log's open decision), and one other sentence on the page is false — H1 |
| 2. A job row older than 14 days is gone after the sweep, a younger one untouched                                                                                                   | `tools/downloader/api/test/job-retention.test.ts:27 "the sweep deletes a job older than the limit"` and `tools/downloader/api/test/job-retention.test.ts:56 "?.sourceUrl).toBe(SIGNED)"` ✓, through the real `runSweep`; the boundary the boundary test at `b47d5a4`, a job exactly at the limit is kept, ✓. Re-run by hand at 14 d − 1 ms (kept), 14 d (kept), 14 d + 1 ms (gone, its `job_links` row with it); red when the cutoff is doubled (2 of 4 fail); the production timer pruned a planted 15-day row within one `GC_INTERVAL_MS`                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3. `compose.downloader.prod.yaml` pins log retention, with a comment deriving the size                                                                                             | **verified** — a valid `json-file` block, `max-size: "10m"`, `max-file: "5"`, on the one service that writes request lines; the arithmetic from its own numbers holds (50 MB ÷ 2.5 KB = 20,000; ÷ 14 ≈ 1,400). Its per-visit figure is wrong — M1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4. The fields that reach a log line during one probe and one download are in the Log                                                                                               | **verified** — the Log's fields match my capture line for line, and nothing past them carries an address, a query string, a cookie or an authorization header. It misses one line the real engine writes — M1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5. The owner has approved the terms text and the draft label is gone                                                                                                               | **unproven (owner)** — the draft banner at `b47d5a4`, Draft. The operator has not yet approved this text, still there, as expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. `npm run check` and the downloader's suite pass                                                                                                                                 | **verified** — `npm run check` exit 0; `npm test -- --project downloader` 1577 passed, 2 skipped of 1579 in 97 files, against 1564 and 2 of 1566 in 93 at `ebb808b`: +13, the 13 tests of the four new files. No existing test file touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

- **high** · H1 · The preview sentence of `terms.html` at `b47d5a4`, held in memory for ten minutes and then dropped, is false. `ThumbnailStore` evicts lazily: an entry goes only when its own token is asked for after expiry (`tools/downloader/api/src/thumbnails.ts@ebb808b:210 "this.#entries.delete(token)"`) or when 400 newer previews push it out (`tools/downloader/api/src/thumbnails.ts@ebb808b:152 "const MAX_THUMBNAIL_ENTRIES = 400"`); the store is built once (`tools/downloader/api/src/server.ts@ebb808b:457 "const thumbnails = new ThumbnailStore"`) and the sweep this branch extends never touches it. Reproduced against the built store with an injected clock: `size` is 1 at 11 minutes and still 1 at 7 days. On a quiet instance a visitor's preview stays in memory until 400 others replace it or the process restarts. Open decision, below.
- **med** · M1 · two findings, one mechanism: the per-visit measurement behind the log cap is the stub-engine harness with API-only requests. (a) The real engine writes a seventh line at `info`, `tools/downloader/engine/src/stream.ts@ebb808b:622 "engine stream complete"` (`jobId`, `bytes`), so a probe, a job and an opened link measured 7 lines, 1,812 bytes, 2,552 in Docker's envelope, against the 6, 1,540 and 2,184 in the compose comment's six lines and the deployment doc's measured 2,184 against 1,540 (both at `b47d5a4`) and the Log. (b) A browser's visit also writes request lines for `/`, the script, the stylesheet, `/favicon.ico`, `/api/config`, `/api/thumbnail/…` and the two event streams: 7 more, 2,524 bytes measured. So a first visit is about 5 KB, twice the compose comment's 2.5 KB a visit at `b47d5a4`, and at the stated 1,400 visits a day the 50 MB holds about 7 days, not 14. Shorter, not longer, so no visitor is harmed, but the operator who sizes from the comment is wrong by half, and Done-when 3 is that comment. The procedure the deployment doc gives (`docker compose logs --since 24h`, times 14, against 50 MB, plus the 40% envelope) is right and unaffected.
- **low** · L1 · The architecture sentence at `b47d5a4`, in a log line a URL keeps its origin and path, is not true of the `request` line, whose `url` keeps the request's own query string by design (`tools/downloader/api/src/request-log.ts@ebb808b:74 "strings, job ids, the health path"`); measured `/?sig=…`, `/api/nope?sig=…` and `/terms.html?sig=…` verbatim. No page URL reaches it, since the client sends none in a query.
- **low** · L2 · The terms sentence at `b47d5a4`, every request writes one line: `/api/health` is logged at `debug` (`tools/downloader/api/src/request-log.ts@ebb808b:95 "function isNoisy"`), and a request the client aborts writes none (an event stream closed by the client left no line). Errs toward recording less.
- **low** · L3 · The download-record sentence of `terms.html` at `b47d5a4` does not say the same row also holds the chosen video's own address, query included (`variant_json`, measured with its `?sig=…`), and the page's hostname. Deleted with the row, so the 14 days holds.
- **low** · L4 · `nfr:maintainability` — the retention tests pin the cutoff only to between 14 and 15 days: moving it to 14 d + 23 h passes all 4. A planted pair at ±1 ms around the limit would close it.
- **low** · L5 · stale comments: the compose header's it changes three things at `b47d5a4` (four now, with `logging`), and the `pruneJobs` comment's every few minutes at `b47d5a4` (every 60 s by default, `tools/downloader/api/src/config.ts@ebb808b:320 "gcIntervalMs: 60_000"`).
- **low** · L6 · "It never tries to obtain a key or a licence" is true of this service's code (`tools/downloader/api/src/jobs/orchestrator.ts@ebb808b:218 "Never attempt licence acquisition"`), but the browser tier lets the page's own player call EME (`tools/downloader/resolvers/src/browser/drm.ts@ebb808b:56 "Observe only. Blocking here"`), so a ClearKey page could request a licence inside the service's browser before the probe stops. Not reproduced; Chromium's behaviour unmeasured.
- **low** · L7 · `cloudflared` (`compose.prod.yaml@ebb808b:38 "image: cloudflare/cloudflared:latest"`) has no log cap. Whether its default-level lines carry a request path or an address is not verified here (no cloudflared); the page's sentence about Cloudflare's own records covers the edge, not this container.
- **dropped** · the `request` line logs `/api/thumbnail/<token>` unredacted, though the contract calls that token a capability (`tools/downloader/api/src/request-log.ts@ebb808b:59 "const CAPABILITY_PREFIXES"`). Measured, but older than this branch and outside its diff; worth a ticket of its own.
- **dropped** · a live link deleted with its swept job: cannot occur, since a link expires 15 minutes after its job is made (`tools/downloader/api/src/jobs/links.ts@ebb808b:22 "export const LINK_TTL_MS = 15 * 60_000"`). Planted anyway: the cascade takes it.
- **dropped** · a running job swept mid-write: a job runs at most 15 minutes plus its stage timeout after it is made, never 14 days.
- **dropped** · a restored, unfinished job whose row was swept: `restore` already fails it locally on the 404.
- **findings** · code-review at medium returned 14; 10 carried in 9 bullets (M1 is two), 4 dropped.
- Invariants: no cross-tool import, no contract change, no spawn, no new workspace dependency; redaction measured on every line at `info` and `debug` (no page query, media query, cookie, authorization header or userinfo password on any line); new tests registered (13 ran in the downloader project). AppError, SSRF and progress rules not touched.
- NFR: security — H1, L1 · performance n/a (one prepared `DELETE` a minute) · reliability ✓ (the sweep runs in production wiring, `tools/downloader/api/src/server.ts@ebb808b:577 "startSweep(context, config.gcIntervalMs)"`, and pruned a planted row live) · maintainability — L4, L5.
- Gates at `b47d5a4`: `node scripts/citations-gate.mjs --against origin/main` exit 0 (148 enforced, 0 failing); `node scripts/preflight.mjs` with the dl-54 title exit 0, "type and paths agree". `feat(downloader)` releases the downloader alone: `compose.downloader.prod.yaml` and `docs/02-DEPLOYMENT.md` sit under no package in `release-please-config.json`, which lists only `tools/*`, so they route nowhere. The deployment doc's new section sits under its "The downloader" heading and names no other tool.
- Open decision · H1's remedy: purge expired previews in the sweep (recommended — one method on `ThumbnailStore`, called from `runSweep`, makes the sentence true within a minute), or reword the sentence to say the image is served for ten minutes and stays in memory until newer previews replace it or the service restarts.

### Gate 2

**Gate: PASS** — 2026-10-03 · `b47d5a4..8f131d8` only · re-gate of gate 1's findings, by hand · e2e and the container build not run (no docker here)

Re-issued at `cb37835` with words, rows and verdicts unchanged; unpinned coordinates resolve at `cb37835`. The round changed three sentences of the terms page and added none; all 3 checked against code, and the preview sentence H1 called false is now true. Owner decisions recorded by the orchestrator: purge in the sweep (H1), the size cap as built with M1's figures corrected, the page behind Access until dl-49, the thumbnail token filed as dl-75.

| Finding                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 · previews outlived their ten minutes | **fixed** — `tools/downloader/api/src/thumbnails.ts:232 "entry.storedAtMs < this.#ttlMs) continue"` is the negation of `get`'s own `tools/downloader/api/src/thumbnails.ts@ebb808b:209 "entry.storedAtMs >= this.#ttlMs"`, so it drops nothing `get` would still serve; called from `tools/downloader/api/src/server.ts:794 "context.thumbnails.purgeExpired()"`, inside `runSweep`, which is the only thing the production timer runs. Through `runSweep` against the built app with a moving clock: an entry at 9:59.999 kept, at 10:00.000 gone while a 5-minute one stays and still serves, all gone at 7 days. Tests `tools/downloader/api/test/thumbnail-purge.test.ts:31 "expect(thumbnails.size).toBe(0)"`, `tools/downloader/api/test/thumbnail-purge.test.ts:52 "thumbnails.get(young)).not.toBeNull()"`; red with the call replaced by `0` (2 of 2) and with the comparison loosened to `<=` (1 of 2) |
| M1 · the per-visit figure behind the cap | **fixed** — re-measured on a live `api/dist/main.js` at `info`: a first visit with a preview hit wrote 15 lines, 3,848 bytes raw, 5,452 enveloped; the builder's miss adds the one `request rejected` line, which accounts for their 16 and 5,848. The figures hold from their own numbers: 50 MB ÷ 6 KB ≈ 8,300, ÷ 14 ≈ 600; 5,848 ÷ 4,138 and 2,551 ÷ 1,811 are both 1.41, the stated 40%. Consistent in `compose.downloader.prod.yaml:60 "wrote 16 lines: 11"`, `compose.downloader.prod.yaml:68 "Call a visit 6 KB"`, `docs/02-DEPLOYMENT.md:740 "measured: 5,848 bytes against 4,138"` and the Log                                                                                                                                                                                                                                                                                                          |
| L1                                       | **fixed** — `tools/downloader/docs/01-ARCHITECTURE.md:257 "keeps that request's query by"`, matching the measured `request` lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| L2                                       | **fixed** — `tools/downloader/web/public/terms.html:50 "apart from the host's routine health check"`. A request the client aborts still writes nothing, measured again; "when it finishes" covers it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L3                                       | **fixed** — `tools/downloader/web/public/terms.html:62 "the full address of the video file that was chosen"`, which is `variant_json` as measured in gate 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L4                                       | **fixed** — `tools/downloader/api/test/job-retention.test.ts:124 "toEqual(["` plants the limit and ±1 ms; the 14 d + 23 h cutoff now fails it (1 of 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| L5                                       | **fixed** — `compose.downloader.prod.yaml:17 "It changes four things"`, `tools/downloader/api/src/db/job-store.ts:565 "minute by default, and keeping"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| L6                                       | **fixed** — `tools/downloader/web/public/terms.html:31 "The service's own code never asks for a key or"`, which is what the code shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| L7                                       | **not fixed, left** — the builder places it with the shared overlay's owner, outside this tool; agreed, and it stays below the floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| dropped · thumbnail token logged in full | **filed** as `tools/downloader/docs/work/dl-75-the-request-log-writes-the-thumbnail-token.md:33 "GET /api/thumbnail/<token>"`, carrying the reproduction (matching gate 1's own line) and the question with both answers at `tools/downloader/docs/work/dl-75-the-request-log-writes-the-thumbnail-token.md:53 "Is the thumbnail token a capability"`, per docs/01-TICKETS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

- **low** · the Log says the builder's event streams each wrote a line "when curl's `-m 3` closed them". Measured twice here, a stream the client closes writes no line; a stream the server closes, when its probe or job ends, writes one. The figures do not move, since both streams in a real visit end server-side; only the stated cause is wrong.
- **low** · `purgeExpired` runs after the two database prunes in the same `try`, so a pass whose database call throws skips the purge as well, and previews outlive their ten minutes while that lasts. Logged as `sweep failed` each pass.
- **findings** · 2 new in the round's lines, both low and carried; gate 1's 9 finding bullets and its dropped token: 8 fixed, 1 left (L7), 1 filed (dl-75).
- Gates at `8f131d8`: `node scripts/preflight.mjs` with the dl-54 title exit 0 (it runs `npm run check`, the downloader suite and the citation gate against `origin/main`, all ok, "type and paths agree"); `npm test -- --project downloader` exit 0, 1579 passed, 2 skipped of 1581 in 98 files: +2 over gate 1, the two cases of the new `thumbnail-purge.test.ts`. No log line in the live run carried a page query, a media query, a cookie or a password.

### Gate 3

**Gate: PASS** — 2026-10-03 · `8f131d8..cb37835` only · Done-when 5's verdict, by hand · coordinates resolve at `cb37835`

| Done when                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5. The owner has approved the terms text and the draft label is gone | **verified** — the approval is recorded in this ticket's Log, the 2026-10-03 entry for Done-when 5: approved as written, through AskUserQuestion, against the text at `8f131d8` (the answer itself is the orchestrator's relay; I saw the record, not the question). The banner is gone: the round's only change to the page is the four lines of the draft paragraph, so what ships is the approved text with nothing else moved, and `tools/downloader/web/public/terms.html:13 "<h1>Terms, and what this service records"` now runs straight into the first section. `docs/02-DEPLOYMENT.md:697 "The owner approved the text on 2026-10-03"` says the same, line-neutral |

- **low** · `tools/downloader/web/public/terms.css:12 "--warn-bg: #fff4d6;"` and the three lines like it are dead now that `.draft` is gone. Harmless.
- **findings** · 1 in the round's lines, low, carried; none dropped. `dl-75` is `needs-decision` now, which `docs/01-TICKETS.md` asks of a ticket that poses a question.
- Gates at `cb37835`: `npm run check` exit 0; `terms-page.test.ts` and `terms-link.test.tsx` 5 passed of 5; `node scripts/citations-gate.mjs --against origin/main` exit 0 (148 enforced, 0 failing); `node scripts/status.mjs --json` exit 0. Preflight and the full suite not re-run: the round touches no source and no test.

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
- 2026-10-03 — Done-when 5, the owner's approval of the terms text.
  - **Approved as written.** The owner was shown the full terms text as it stood at
    `8f131d8` and asked, through AskUserQuestion, to approve it. The options were:
    approve as written (recommended); approve with edits; not yet. The owner chose
    **approve as written**, and the draft banner is removed in this commit: the
    `<p class="draft" id="draft">` paragraph in `terms.html`.
  - **Two files beyond the banner, as the approval implies.** The `.draft` rule in
    `terms.css`, which only that paragraph used, is deleted; its `--warn-bg` and
    `--warn-border` custom properties are now unused and were left. The
    `docs/02-DEPLOYMENT.md` sentence that called the page a draft and named the
    paragraph to delete now says the owner approved it on 2026-10-03, kept to the
    same number of lines. No test asserted the banner either way.
  - **`dl-75` is now `needs-decision`, not `ready`.** It poses a question, whether
    `ROUTES.thumbnail`'s token is a capability to redact or not, and
    `docs/01-TICKETS.md` says a ticket that poses a question starts as
    `needs-decision`. It was filed `ready` on the orchestrator's instruction, which
    was wrong.
