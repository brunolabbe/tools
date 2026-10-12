---
id: dl-107
tool: downloader
title: Keep the least visitor data the law allows
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-107 — Keep the least visitor data the law allows

## Why

The owner asked on 2026-10-12 whether the terms page's 14 and 90 days could
come down to about two hours, and then set the goal more widely: **keep as
little visitor data as possible, for as short as possible, while staying
legal.** [dl-54](./dl-54-terms-takedown-and-what-is-logged.md) chose its
periods for one purpose, answering an abuse report ("keep 14 days", option A,
2026-09-13), and sized the log by bytes rather than age (2026-10-03). It did
not ask, field by field, what each piece of data is for and what the law
requires as a minimum. This ticket does that, and it should be answered before
[dl-49](./dl-49-open-without-a-login.md) takes the login off, because that is
when the terms page starts to speak to strangers.

Moving every period to two hours was examined first and is the wrong tool. The
download record could be cut to the minute, but the log is capped by size and
Docker cannot expire it by age, and cutting both turns dl-54's option A into
its option B (keep no address) without saying so. Most of the privacy gain is
available without touching a single period, by not keeping what no purpose
needs. That is what the inventory below shows.

## What the service holds about a visitor, measured at `7a331e0`

Read from the code, not from the terms page. "Person" means the data says
something about who asked or what they asked for.

| #   | Data                                                                                                                          | Where                                                                                                                                                                                                   | Person?                        | Lives                                                                                                                              | Read by                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Visitor's network address, on every request's `request` line, with `requestId`, method, path, status, duration                | `registerRequestLogging` and `createFrameworkErrorHandler` in [request-log.ts](../../api/src/request-log.ts)                                                                                            | **yes**                        | Docker `json-file`, 5 × 10 MB, about 14 days at the traffic it was sized for ([compose](../../../../compose.downloader.prod.yaml)) | abuse tracing; dl-51/dl-52 limit tuning                                              |
| 2   | Page origin and path, never the query, on `probe complete` and `request rejected` lines sharing that `requestId`              | [probe.ts](../../api/src/routes/probe.ts), `registerErrorHandling` in [server.ts](../../api/src/server.ts); query stripped by `redactUrlsDeep` in [logger.ts](../../api/src/logger.ts)                  | yes, joined to 1               | as 1                                                                                                                               | debugging                                                                            |
| 3   | `jobId` on the `job accepted` line sharing that `requestId`                                                                   | [jobs.ts](../../api/src/routes/jobs.ts)                                                                                                                                                                 | joins 1 to 4                   | as 1                                                                                                                               | debugging                                                                            |
| 4   | `jobs.source_url`: the full page address, **query included**                                                                  | [schema.ts](../../api/src/db/schema.ts) migration 1                                                                                                                                                     | **yes**                        | 14 days, exact (`JOB_RETENTION_DAYS`, [links.ts](../../api/src/jobs/links.ts); `runSweep` every minute)                            | the job while it runs; the browser, which already has it                             |
| 5   | `jobs.variant_json`: the chosen media URL, `alternateUrls`, `audioUrl` — often **signed**, a live credential until it expires | as 4                                                                                                                                                                                                    | yes                            | as 4                                                                                                                               | the job while it runs                                                                |
| 6   | `jobs.result_json.filename`, derived from the video's title                                                                   | `JobResult` in [job.ts](../../contract/src/job.ts)                                                                                                                                                      | yes, it names what was fetched | as 4                                                                                                                               | the browser at completion                                                            |
| 7   | `jobs.error_json.details`: some resolvers put the **full** `url.href` there, query included                                   | e.g. [registry.ts](../../resolvers/src/registry.ts), [direct.ts](../../resolvers/src/resolvers/direct.ts), [ytdlp.ts](../../resolvers/src/resolvers/ytdlp.ts) — redacted in the log, **not** in the row | yes                            | as 4                                                                                                                               | the browser at failure; the report reads only the error's code                       |
| 8   | `jobs.host`, status, timestamps, options                                                                                      | as 4                                                                                                                                                                                                    | only the site, not who         | as 4                                                                                                                               | [report.ts](../../api/src/report.ts) (`status, error_json, created_at, finished_at`) |
| 9   | `probe_outcomes`: hostname, resolver, timings                                                                                 | migration 5                                                                                                                                                                                             | no                             | 90 days, `OUTCOME_RETENTION_DAYS`; **`0` disables pruning**, it does not mean "keep none"                                          | report.ts                                                                            |
| 10  | Rate-limit buckets and per-client counts, keyed by `clientKey(ip)`                                                            | `@webtools/core/rate-limit`, [per-client-gate.ts](../../api/src/per-client-gate.ts)                                                                                                                     | yes                            | memory only: a bucket goes once it refills (checked on the next request) or past 10,000 keys; a count goes at release              | the limits                                                                           |
| 11  | Probe cache (keyed by page URL), preview images                                                                               | `ProbeCache`, `ThumbnailStore`                                                                                                                                                                          | yes                            | memory only: 30 s, 10 min                                                                                                          | double-click, preview                                                                |
| 12  | Video bytes                                                                                                                   | streamed to whoever opens the link (dl-53)                                                                                                                                                              | —                              | not stored                                                                                                                         | —                                                                                    |
| 13  | Human-check token                                                                                                             | [human-check.ts](../../api/src/human-check.ts) sends it to Cloudflare **without** `remoteip`                                                                                                            | Cloudflare's, under its terms  | Cloudflare's                                                                                                                       | —                                                                                    |
| 14  | Everything at the edge, and the login while the Access policy stands                                                          | Cloudflare Tunnel and Access                                                                                                                                                                            | yes                            | Cloudflare's                                                                                                                       | —                                                                                    |
| 15  | The visitor's own list of downloads, page URLs included                                                                       | the browser's storage                                                                                                                                                                                   | yes, on their device           | until they clear it                                                                                                                | the visitor only                                                                     |

**The seam.** No database row holds an address. Who asked for which page is
joinable only through the log: row 1's address, by `requestId`, to row 2's path
or row 3's `jobId`, and from that to row 4. Remove or weaken the address on
row 1 and the join is gone everywhere at once.

**What no purpose needs after the job ends.** Rows 4–7 exist so a running job
can run. The browser has its copy before the job finishes, and on reload it
re-fetches only unfinished jobs (`useJobs.ts`'s restore). The report reads
none of them (row 8). So the most sensitive data the service holds, a full
page address and a signed media URL, could be cleared within minutes of a job
ending instead of kept 14 days. One reader would notice: a tab closed while a
job ran, reopened after the clearing, fetches the finished row, and
`reconcileJob` would replace the card's page URL and filename with blanks
unless it keeps the local copy's.

## The law

A research pass on 2026-10-12, for an operator in Québec with visitors from
Canada, the EU and the US. **Not legal advice**: each line names the source it
was read from, and the questions at the end are for a lawyer. LégisQuébec,
CanLII and EUR-Lex refused the fetch, so the Québec act was read from an
unofficial English consolidation (Lavery) and the GDPR from gdpr-info.eu.

**No law found obliges keeping an address or a URL before a notice or an order
arrives.** Every floor below starts at receipt and covers only what is still
held then.

| Law                                                 | Floor                                                                                                   | Ceiling or duty                                                                                                                                                                                                               | Applies here?                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Copyright Act ss. 41.25–41.27                       | From a notice's receipt: forward it, keep identifying records 6 months (1 year if suit). Nothing before | Statutory damages $5k–$10k for not forwarding                                                                                                                                                                                 | Unclear, probably not: not an ISP or a host; "information location tool" is literally broad               |
| Québec private-sector act (Law 25)                  | None                                                                                                    | s. 23 destroy or anonymise once the purpose is met; s. 3.1 publish the person in charge; s. 8.2 publish a policy; s. 3.3 impact assessment for a new system; s. 17 assessment before sending data outside Québec (Cloudflare) | Unclear: turns on whether a free hobby service is an "enterprise" (Civil Code art. 1525)                  |
| PIPEDA                                              | None                                                                                                    | Sch. 1 cl. 4.5: keep only as long as necessary; an address is personal information when it can be tied to a person                                                                                                            | Probably not: no commercial activity (no ads, no fees)                                                    |
| GDPR                                                | None                                                                                                    | Art. 5(1)(c) minimisation, 5(1)(e) storage limitation; Art. 27 EU representative                                                                                                                                              | Probably not: reachability is not targeting (Recital 23), the UI is English (`lang="en"`), nothing tracks |
| DMCA § 512                                          | None. A § 512(h) subpoena reaches only what is held                                                     | Safe harbour needs a registered agent and a repeat-infringer policy; it is a defence, not a duty                                                                                                                              | Optional, if US exposure matters                                                                          |
| Criminal Code ss. 487.012–487.0194                  | From a preservation demand (21 days) or order (90 days): what is held when it arrives                   | Destroy afterwards what would not otherwise be kept                                                                                                                                                                           | Yes, if one is served                                                                                     |
| Cloudflare Self-Serve Agreement, Turnstile addendum | None                                                                                                    | Comply with law; the operator is controller for Turnstile's data (address, TLS fingerprint, User-Agent)                                                                                                                       | Yes                                                                                                       |
| Bill C-22 (Lawful Access Act 2026), pending         | **Possibly**: its regulations could require "core providers" to keep metadata up to 6 months            | —                                                                                                                                                                                                                             | Unknown: in the Senate per LEGISinfo; who is "core" is set by a schedule not yet seen                     |

Sources opened: laws-lois.justice.gc.ca (Copyright Act page 14; PIPEDA;
Criminal Code s. 487.012), lavery.ca (consolidated P-39.1), cai.gouv.qc.ca,
priv.gc.ca bulletins, gdpr-info.eu, EDPB Guidelines 3/2018, CNIL deliberation
2021-122 (6–12 months for logs of _authorised users_, a ceiling, not visitor
logs), law.cornell.edu (17 USC 512), cloudflare.com/terms, parl.ca LEGISinfo.

**What this means for the decision.** The legal pressure points one way: keep
less. The only floors are "preserve on notice", which question 4 answers, and
a bill that has not passed. Whichever way the "enterprise" question falls, the
recommended options below would also satisfy Québec's s. 23 and the GDPR's
Art. 5 if they applied.

**For a lawyer.**

1. Is a free, unmonetised service run by one person an "enterprise" under
   Civil Code art. 1525, which decides whether the Québec act applies?
2. Is it an "information location tool" or a host under Copyright Act
   s. 41.25?
3. Does routing visitors through Cloudflare (US) trigger the s. 17 assessment?
4. Would Bill C-22's schedule of core providers reach it, if enacted?

## The decision — all six answered by the owner on 2026-10-12

**Every question took its recommended option, A.** 1A includes approving the
contract change it names: `Job.sourceUrl` may be empty on a cleared row. The
options not taken stay below, so the reasons can be read later.

**1 — The download record's URLs and title (rows 4–7).**

- **A — Clear them when the job ends (recommended).** `source_url`,
  `variant_json`, `result_json.filename` and `error_json.details` are blanked
  by the sweep once `finished_at` is older than a short grace (the link's 15
  minutes covers a late reconcile). The row keeps its host, status, error code
  and times for the report, for its 14 days. Costs: `Job.sourceUrl` is a
  required string in the contract, so a cleared row needs either an empty
  string or a contract change (a contract change is the owner's to approve);
  and an abuse report can no longer name the exact page, only the site.
- **B — Shorten the row to hours, as first asked.** Simpler, same privacy for
  these fields, but the report loses its 7-day window.
- **C — Leave at 14 days.**

**2 — The address on the `request` line (row 1).**

- **A — Keep it, shortened (recommended).** IPv4 to its /24, IPv6 to its /48,
  before it is written. Still enough to see that a burst came from one network,
  which is what limit tuning needs; no longer one household. Rate limiting is
  unaffected: it runs on the full address in memory (row 10).
- **B — Replace it with a keyed hash whose key changes daily.** The same
  visitor is the same token within a day and unlinkable across days.
  Pseudonymous, which is still personal data under GDPR, and the key's
  rotation is new code that must never log the key.
- **C — Drop it.** dl-54's option B: nothing to disclose and nothing to trace
  with. Tuning loses its per-client view.
- **D — Keep it whole (today).**

**3 — How long the log lives.** Under question 2's A or B the log no longer
holds a full address, so its period matters less.

- **A — Keep the size cap, resized to about 7 days (recommended).** Halve
  `max-size`. One edit, no host work; the terms keep saying "about".
- **B — An age limit**, through `journald` on the host
  ([docs/02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md), "Log
  retention"). Exact, but host setup this repo cannot do, and the owner
  declined it on 2026-10-03.
- **C — Leave at about 14 days.**

**4 — When a legal notice arrives.**

- **A — A written hold procedure (recommended).** The deployment doc says what
  to copy (the log files, the rows for the named site) and where, when a
  notice or a preservation demand arrives, and the terms page says notices are
  answered this way. No code.
- **B — Nothing written down.**

**5 — What the terms page publishes.** Québec's s. 3.1 and s. 8.2 ask for the
person in charge and a confidentiality policy, if the act applies.

- **A — Publish both now (recommended).** A name or title and the existing
  abuse alias as the contact, and the terms page already is most of a policy:
  add what each record is for and that Cloudflare (US) carries the traffic.
  Text only, and harmless if the act turns out not to apply.
- **B — Wait for the lawyer's answer to question 1.**

**6 — The page's path on log lines (row 2).** Asked after the first five,
when the owner asked whether they were the most the rules allow. They were
not: 2A shortens the address on the `request` line only, and row 2's lines
still carry the page's origin and path under the same `requestId`, so the log
would still join a /24 network to the exact page for its lifetime.

- **A — Site only (taken).** Every page or media URL a log line carries is cut
  to its origin, never its path. Costs: debugging a page that fails means
  asking the visitor for its address; the analysis record (row 9) already
  answers "which sites fail" without one.
- **B — Keep origin and path (2A as first answered).**

**Further steps offered at the same time and not taken:** dropping the address
entirely instead of 2A; deleting the job row at job end and keeping daily
totals instead of rows; expiring the browser's saved list. Each was declined
for its cost (abuse tracing and limit tuning; the report's per-failure detail;
visitors' history), not for a legal reason. **The largest remaining holder is
Cloudflare**, which sees all traffic and, with the human check on, the address,
a TLS fingerprint and the User-Agent, under its own retention; the only lever
on this side is leaving that check off.

The analysis-outcome record (row 9) holds nobody and stays at 90 days. Its
`0`-means-forever trap is fixed in the build whatever is chosen.

## Build

Written for the options taken: 1A, 2A, 3A, 4A, 5A, 6A.

1. Rows 4–7: in `runSweep` ([server.ts](../../api/src/server.ts)), a new
   `JobStore` statement clears the four fields on rows whose `finished_at` is
   older than `LINK_TTL_MS`. Settle the contract question first, and make
   `reconcileJob` ([job-reducer.ts](../../web/src/lib/job-reducer.ts)) keep
   the local `sourceUrl` and filename when the server's copy has been cleared.
2. Row 7, independently: `error_json` should not hold a query even while the
   row is live. Run `details` through `redactUrlsDeep` before it is stored, as
   the logger already does before it is written.
3. Row 1: shorten the address in `registerRequestLogging` and
   `createFrameworkErrorHandler` with one helper; `clientKey` in core is the
   model for the IPv6 grouping.
4. Row 9: refuse `OUTCOME_RETENTION_DAYS=0` at boot, or make it mean "do not
   record", but not "keep forever".
5. Log cap: `compose.downloader.prod.yaml` and the comment deriving it.
6. The terms page, `terms-page.test.ts` and `job-retention.test.ts` say what
   is now true; a new test plants a finished job and proves the four fields
   are gone after one sweep while host, status and code remain.
7. The hold procedure in `docs/02-DEPLOYMENT.md`.
8. The person in charge and the purposes on the terms page (question 5).
9. Row 2 (question 6): in the logger's deep walk (`redactUrlsDeep`,
   [logger.ts](../../api/src/logger.ts)), cut every absolute URL to its
   origin. Give the logger its own matcher rather than changing
   `redactUrlsInText`, which ffmpeg's stderr and stored errors also use. The
   `request` line's own `url` is an API path, not a page, and stays.

## Done when

1. A finished job's row holds no page URL, media URL, title or error URL one
   sweep after its link's lifetime, and still holds host, status, error code
   and times — proven by a test through `runSweep`.
2. No `request` line holds a full network address — proven by a test reading
   the line both handlers write, for an IPv4 and an IPv6 client.
3. A stored `error_json` holds no query string — proven by a test.
4. `OUTCOME_RETENTION_DAYS=0` cannot keep rows forever — proven by a test.
5. The terms page states each period and what it holds, and its test fails
   when one disagrees with the code.
6. No log line holds a page or media URL's path — proven by a test that logs
   a `details.url`, a nested `requestContext` URL and a URL inside a sentence,
   and finds only their origins.

## Log

- 2026-10-12 — Filed as `needs-decision` from the owner's question about two
  hours. The inventory was read at `7a331e0`; the legal floors come from a
  research pass on the same day, with sources, and are not legal advice.
- 2026-10-12 — All five decisions answered by the owner, each option A, with
  1A's contract change approved; moved to `ready`. The first push and pull
  request were refused by a permission prompt and retried with the owner's
  approval.
- 2026-10-12 — Question 6 added and answered A when the owner asked whether
  the first five were the most the rules allow. The other further steps were
  offered and declined; the decision section records them and why.
- 2026-10-12 — Built to 1A, 2A, 3A, 4A, 5A, 6A on branch `dl-107` from
  `bb4d2044`. What the brief had wrong or left open, and what was done:
  - **The contract change is a doc comment, not a schema change.** `sourceUrl`
    and `filename` are `z.string()` in `api.ts` and already accept `""`, so a
    cleared row parses with no edit to a schema. `Job.sourceUrl`, `Job.variant`
    and `JobResult.filename` now say they are blank or null on a cleared row
    (`contract/src/job.ts`), which is the change the owner approved.
  - **`details` is cleared to its `reason` and `retryAfterSec`, not to nothing.**
    The card reads `details.reason` to say a link expired
    (`error-presentation.ts`), and a tab reopened after the clearing fetches the
    row with the server's copy winning, so blanking the whole bag would turn
    "link expired" into a bare "canceled". Only a short token (`[\w-]{1,40}`) or
    a number survives under those two keys, too little room for an address. The
    brief said "blanked"; Done-when 1 holds either way.
  - **The address was on two more lines than the brief's inventory.**
    `rate limited` logs the bucket's `key` (`ip:<address>`, or an IPv6 `/64`) and
    `download refused: per-client cap reached` logs `clientKey(request.ip)`.
    Both go through `shortenKey` now (`api/src/log-address.ts`); Done-when 2 names
    only the `request` line, and it would have been met with these two still
    writing the whole address.
  - **`probe complete` carries no `requestId`** (`log-fields.test.ts` already
    pinned that), so the brief's "row 2 shares that `requestId`" is true of
    `request failed` and `request rejected` and not of the success line. The path
    is cut from all of them regardless.
  - **Row 2's cut covers the message, a child's bindings and an `Error`'s message
    and stack too**, not only `fields`: the logger runs one function over all of
    them (`createLogger`'s `redactMessage`, the `redactError` copy). A request
    line's own absolute-form `url` (`http://host/api/files/<t>`, a scanner's
    shape) is now cut to its origin like any other URL.
  - **Row 9: refused at boot**, the first of the brief's two options. `0`, `-5`
    and any override under 1 throw `INTERNAL` naming the variable; `abc` still
    falls back to 90 as the other integers do. The sweep's `<= 0` branch is gone,
    so the table cannot be told to keep everything by any route.
  - **Row 7's redaction is at the one place the row is written**
    (`JobStore#write`), through `redactUrlsInText` (the query goes, the path
    stays while the row is live), not through the logger's `redactUrlsDeep`,
    which is private, handles errors and cycles a stored payload cannot have,
    and now cuts to the origin.
  - **The log cap is `5m` x 5 and the figure was not re-measured.** The 6 KB a
    visit comes from dl-54's measurement before two fields got shorter; the page
    quotes the arithmetic's result (7), and `terms-page.test.ts` recomputes it
    from the compose file, so a cap that moves without the page fails.
  - **The hold procedure's commands were written from the compose files and not
    run against a host**, and the deployment doc says so. The image keeps the
    database at `/data/jobs.db` (`STORAGE_DIR`) with no write-ahead log, which
    is what makes one file copy whole.
  - **Question 5 is published with a title, not a name:** "the operator of this
    service, one person", at the abuse alias. If the owner wants a name, it is
    one line in `web/public/terms.html`.
  - Existing tests whose assertions named a path were turned over, not deleted:
    `logging.test.ts`, `logging-routes.test.ts`, `log-fields.test.ts` and
    `egress-proxy.test.ts` now assert the origin and that the path is absent;
    `probe-outcomes.test.ts` replaces "0 disables pruning" with the refusal;
    `job-retention.test.ts`'s premise is the redacted `details.url`.
  - **Fold-in:** none. dl-49 and dl-108 are the pieces this work makes nearer
    and the dispatch holds both behind this ticket; neither was started.
