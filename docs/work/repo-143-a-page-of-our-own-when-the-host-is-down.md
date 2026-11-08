---
id: repo-143
tool: repo
title: A page of our own when the host is down, from a Worker the setup script deploys
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-143 — A page of our own when the host is down

## Why

When the mini-PC is off, `cloudflared` is stopped, or a tool's container is
down, a visitor to `downloader.`, `planner.` or `ledger.<domain>` gets
Cloudflare's generic error page: **1033** (HTTP 530) when the tunnel has no
connector, **502** when the tunnel is up but the service behind it is not
answering. That includes the stale-connector case in
[02-DEPLOYMENT.md](../02-DEPLOYMENT.md). Neither page says which tool it is, that
the outage is expected to be short, or what to do. The owner wants a page of
our own.

The project's zone is on Cloudflare's **Free plan**. The documentation (read
through search results on 2026-11-03; developers.cloudflare.com would not load
from the devcontainer) says:

- **Custom Errors** (error pages, error rules, uploaded assets) is for paid
  plans only. The plan table gives Free 0 rules, 0 assets and no Error Pages
  ([rules/custom-errors](https://developers.cloudflare.com/rules/custom-errors/)).
- Custom pages for 5xx responses the origin itself returns are Enterprise only.
- Free does get structured error responses, but those only switch the format
  of Cloudflare's own page (HTML or JSON). Its look stays Cloudflare's.

A **Worker** runs on Free (about 100,000 requests a day and 10 ms of CPU per
request, both to re-check). It sits in front of the origin, so it can see the
failed subrequest and answer with its own HTML, and it keeps working when the
host is unreachable.

## Decision — answered 2026-11-03 by the owner

1. **Where it lives and how it deploys.** Options were (a) source in the repo,
   deployed by `scripts/cloudflare-setup.mjs`; (b) source in the repo, deployed
   by hand with wrangler; (c) pasted into the dashboard, with the code in
   02-DEPLOYMENT.md. **Chosen: (a).** The script already turns the Cloudflare
   half of a deployment into reviewable, plan-by-default calls. Wrangler would
   add a dependency and a second credential path, and a dashboard paste is
   untested and drifts.
2. **What API calls get.** Options were (a) only browser page loads get the page
   and `/api/*` keeps Cloudflare's own response; (b) `/api/*` also gets a JSON
   error body. **Chosen: (a).** A JSON body would have to match each tool's
   `AppError` shape, which is a contract-adjacent change in three tools, and the
   web apps already handle a failed request.

## Build

1. **The Worker.** Write it as a plain ES module with no build step, for example
   `scripts/cloudflare-down-page.mjs`, exporting `default { fetch }` plus the
   pure helpers the tests need. For each request it does `fetch(request)` to the
   origin. It answers with the down page when **all** of these hold:
   - the subrequest throws, or its status is 502, 504 or 530;
   - the incoming request is a page load (`Accept` includes `text/html`, method
     `GET` or `HEAD`).

   Anything else passes through untouched, streaming included.

   **Trap:** a 502 the _app_ returns on purpose must not be replaced. A tool's
   HTML routes do not do that today, but say in a comment why the status set is
   safe, and don't widen it to every 5xx.

2. **The page.** One self-contained HTML document: inline CSS, no request to the
   origin (it is down), no external fonts. It names the tool from the hostname,
   says the home server is unreachable and to try again in a few minutes, and
   respects `prefers-color-scheme`. It fits a 360 px phone with no horizontal
   scroll (root `CLAUDE.md`). It takes its colours from `packages/ui`'s base
   tokens, read and inlined at deploy time or copied with a comment naming the
   source; the builder chooses which and says why in the Log. Respond with
   **503**, `Retry-After: 60` and `Cache-Control: no-store`, so neither a browser
   nor a crawler keeps the outage.

3. **Routes.** One route per hostname in `TOOLS` (`<subdomain>.<domain>/*`)
   pointing at the Worker. Add **exclusion routes with no Worker** for
   `<subdomain>.<domain>/api/*` and for the built static assets (`/assets/*`,
   and `theme.js` where a tool emits one, as in
   `tools/{downloader,ledger}/web/vite.config.ts`). That keeps API traffic, file
   streams, SSE and the edge rate limit on `/api/` (02-DEPLOYMENT.md, _The edge
   rate limit on `/api/`_) off the Worker entirely. Decision 2 means the Worker
   would only pass those requests through anyway, and excluding them saves the
   daily quota. Confirm that a route with no script is still how the API
   expresses an exclusion. Set the Worker to **fail open**, so going over quota
   bypasses it and does not break the sites.

4. **`scripts/cloudflare-setup.mjs`.**
   - Upload the Worker script (`PUT /accounts/{id}/workers/scripts/{name}`,
     multipart, `main_module`) and plan the routes.
   - Keep the script's existing rules. Without `--apply` it only prints a plan.
     It never deletes. A route already pointing at a **different** Worker is
     reported as a conflict with an exit code, never replaced.
   - Re-running with nothing changed reports `nothing to do`. Re-uploading
     identical script content must not count as a change.
   - The header's token list grows from four permissions to six: Account ·
     Workers Scripts · Edit, and Zone · Workers Routes · Edit. Follow the
     existing pattern at the Turnstile read: a host whose token predates this
     gets a message naming the missing permission, not a bare 403.

5. **Tests** in `scripts/test/`, using the existing fake fetch
   (`scripts/test/fixtures/cloudflare-fake-fetch.mjs`):
   - the Worker's decision over (subrequest outcome × `Accept` × method),
     including a thrown fetch, a 530 and a 200 that must pass through;
   - the route plan: added, kept, the conflict on a foreign Worker, and the
     exclusions present for every tool in `TOOLS`;
   - the script upload being idempotent.

6. **Docs.** In [02-DEPLOYMENT.md](../02-DEPLOYMENT.md), add the down page to
   _Steps 2 and 3, in one command_ and the two new token permissions to wherever
   the token is described. Add a line to _Verifying_ that stops a tool's
   container, loads its hostname, and expects the page.

**Facts to verify, not assume** (record each in the Log with how it was
checked):

- **Order of Access and Workers.** It is believed that Access runs before
  Workers, so a planner or ledger visitor who is not logged in sees the login
  page, not the down page. Either outcome is acceptable. Write down which one
  happens.
- **The visitor's IP reaching the origin.** `CF-Connecting-IP` must still carry
  the visitor's address on a Worker's pass-through subrequest. The downloader's
  per-client limits depend on it through `TRUST_PROXY`. The exclusion routes
  keep `/api/*` off the Worker, which makes this matter less, but check it.
- **The free-plan quota and CPU limit** as they stand today.

## Done when

1. With the Worker deployed, loading a tool's hostname while its container is
   stopped shows the down page with status 503. Loading it while `cloudflared` is
   stopped also shows the down page. The owner runs this on the live host.
2. Under the same outage, `/api/health` on any tool still returns Cloudflare's
   own response, not the page.
3. Unit tests prove the Worker's decision table, the route plan (additions,
   exclusions, the conflict on a foreign Worker) and the idempotent upload.
4. `node scripts/cloudflare-setup.mjs` with no `--apply` prints the Worker and
   its routes in the plan. A second `--apply` run reports `nothing to do`.
5. The page fits a 360 px viewport with no horizontal scroll and reads in both
   colour schemes. A screenshot of each goes in the pull request.
6. 02-DEPLOYMENT.md names the two new token permissions and the verification
   step.
7. `npm run check` and `npm test -- --project repo` pass.

## Log

- 2026-11-03 — Filed after the owner asked whether a free-plan zone can have a
  custom 502 page. The answer is no for Custom Errors and yes for a Worker. The
  owner answered both decisions above when the ticket was filed.
- 2026-11-08 — Built (branch `repo-143-down-page-worker`, base `64185876`). The
  sandbox's firewall blocks `developers.cloudflare.com` and `api.cloudflare.com`
  (dispatch measured exit 28 on both), so **nothing below was checked against
  Cloudflare**: Build 1–6 are written against the fake fetch and the API shapes
  this ticket names. Where it landed:
  - `scripts/cloudflare-down-page.mjs` — the Worker: `default { fetch }` plus the
    pure helpers (`shouldShowDownPage`, `isPageLoad`, `renderDownPage`,
    `downPageResponse`, `DOWN_STATUSES`, `PALETTES`). No import, no build step.
  - `scripts/cloudflare-setup.mjs` — `planWorker`, `planRoutes`,
    `workerFromSource`, `deployedHash`, `desiredState(...).routes`, `applyOrder`
    gains `worker` and `route` ops (after DNS, before the widget, so the widget
    stays last), `TOOLS[].staticPaths`, a multipart branch in `call`, the six-
    permission header, and two 401/403 messages naming `Account · Workers
    Scripts · Edit` and `Zone · Workers Routes · Edit`.
  - `scripts/test/cloudflare-down-page.test.ts` (59 cases), the shared fake
    `scripts/test/fixtures/cloudflare-workers-fake.mjs`, and two small edits
    to existing tests/fixtures so their fake accounts answer the two new reads
    (`cloudflare-turnstile.test.ts`'s `fakeAccount`, `cloudflare-fake-fetch.mjs`).
  - `docs/02-DEPLOYMENT.md` — the permissions table (six), the down page under
    _Steps 2 and 3_, and a _Verifying_ paragraph.
- 2026-11-08 — **Choices the brief left to the builder.**
  - _Colours: copied, not read at deploy time._ The brief assumed
    `packages/ui`'s base tokens hold values to inline; `tokens.css` holds **no
    colour value** (its header: palettes are per tool, owner 2026-10-18), so
    there was nothing to read. The page instead carries each tool's own six
    roles (`--bg --surface --border --text --text-muted --accent`), light and
    dark, chosen by the hostname's first label, so a visitor sees the palette of
    the tool they were going to. A build step would be a second thing to keep
    working for the one page that must work when everything else is down.
    Drift is caught by `cloudflare-down-page.test.ts` › _the palettes are the
    tools' own_, which parses each `tools/<tool>/web/src/styles.css`.
  - _Idempotence by a marker line, not Cloudflare's etag._ The upload appends
    `// repo-143-content-sha256: <hash of the source>`; a re-run downloads the
    script and greps the raw text for the marker, so it does not matter whether
    the download is bare or multipart. No marker means the script is not ours,
    and that is a **conflict** (never overwritten), the same rule as a foreign
    route. The brief only asked for the route conflict; this is the same rule
    applied to the one other thing the script could clobber.
  - _The page's wording_ says the home server is not answering and to try again
    in a few minutes, and nothing more: a first draft promised that nothing open
    is lost by waiting, which no tool has been shown to guarantee.
  - _`TOOLS[].staticPaths`_ lists `/theme.js` for the downloader and the ledger
    only; a test reads each `vite.config.ts` and fails if a config mentions
    `theme.js` the table lacks (or the reverse), or sets `assetsDir`.
- 2026-11-08 — **Web check of the eight assumptions** (second dispatch, on head
  `467bf2a0`, against Cloudflare's current documentation). `developers.cloudflare.com`
  and `api.cloudflare.com` answered `curl` this time (200 on both), so the API
  reference pages were read as markdown with `curl` (`<page>/index.md`, verbatim) and the published
  OpenAPI schema (`cloudflare/api-schemas`, `openapi.json`, 27.8 MB) was searched
  for field names, not a search snippet. Nothing was measured against an account.
  Eight verdicts; **no code changed**, because no fact contradicts a field name or
  a request shape the code is sure of. Two need an owner decision (5 and 8).
  1. **Access versus Workers: verified, as believed.** Access runs first.
     Read: Cloudflare blog, _Secure all your internal vibe-coded applications_
     (`blog.cloudflare.com/workers-protected-by-access`), which says Access
     "traditionally ran before all Workers logic in the request pipeline" and that
     routing had to be moved ahead of Access to let it target one Worker; and
     `developers.cloudflare.com/workers/configuration/cloudflare-access/`, which
     says a hostname or path Access application controls the URL it matches over
     a Worker-level one. A logged-out planner or ledger visitor therefore sees
     the Access login, never the down page. That is the right order for a page
     that must not be shown to someone Access would refuse. Both through WebFetch, which returns
     its model's summary of a page, so the phrases are quoted as that summary gave them; the first source is a blog post, not a reference page.
  2. **`CF-Connecting-IP` through `fetch(request)`: verified.**
     `developers.cloudflare.com/fundamentals/reference/http-headers/` (read):
     "In same-zone Worker subrequests, the value of `CF-Connecting-IP` reflects the
     value of `x-real-ip`" (the client's address), and `x-real-ip` is only changed
     if the Worker script changes it, which this one does not. The origin is a
     hostname in the same zone, so it receives the visitor's address. Also read,
     `workers/configuration/routing/`: "Custom Domains can also be invoked within
     the same zone via `fetch()`, unlike Routes", consistent with `fetch(request)` in a
     Route Worker going to the origin and not back into the Worker (the page does not say so in terms).
  3. **Free-plan limits: verified.** `developers.cloudflare.com/workers/platform/limits/`
     (read): 100,000 requests per day, resetting at midnight UTC, Error 1027 past
     it; 10 ms CPU per HTTP request (time awaiting `fetch()` not counted), Error
     1102 past it; 50 subrequests per invocation. The brief's figures stand.
  4. **A route with no `script` as an exclusion: verified for create, partly for
     list.** `workers/configuration/routing/routes/` (read): "A route can be
     specified without being associated with a Worker. This will act to negate any
     less specific patterns", with `*example.com/images/cat.png -> <no script>`
     as its example. API reference, _Create Worker Route_ (`api/resources/workers/
     subresources/routes/methods/create/index.md`, read) and the OpenAPI
     `workers_route` schema: `pattern` is required, `script` is _optional_ string,
     and the body is that and nothing else. _List Worker Routes_ documents
     `result: array of {id, pattern, script}` with `script: optional string` and no
     example of a route without one, so whether it comes back absent, `null` or
     empty is **not settled**; `routeScript` already reads all three as "no
     Worker". Stays as built.
  5. **`request_limit_fail_open`: the field exists, whether POST takes it is not
     settled, and the OpenAPI schema does not document it. Open decision, below.**
     The name is right. Cloudflare's changelog, _Fixed and documented Workers
     Routes and Secrets API_ (2025-04-15, read as markdown), shows it in the route
     object the API returns, `"request_limit_fail_open": false`; `cloudflare/
     cloudflare-go` issue 828 shows `GET /zones/$ZONE_ID/workers/routes` listing it
     and `PUT /zones/$ZONE_ID/workers/routes/$ROUTE_ID` setting it to `true`,
     "not documented explicitly in api docs" (GitHub issue, read). But
     `request_limit_fail_open` has **zero hits in the published OpenAPI schema**,
     and the _Create Worker Route_ body documents `pattern` and `script` only; the
     `workers_route` schema is the same for POST and PUT, so a request that sets
     the flag on POST rests on a field the schema does not list. The default is
     `false`, which `workers/writing-workers/resource-limits/` (read) calls _fail
     closed_: "Returns a Cloudflare `1027` error page", and it says the mode is
     configured "by toggling the corresponding route" without naming a field. The
     code sends the flag on POST. **If POST ignores it, the routes fail closed and
     past 100,000 requests a day every page load of the three tools answers 1027
     (`docs/02-DEPLOYMENT.md` says the opposite). If POST rejects it, the first
     `--apply` stops at the first Worker route with the exclusions already made.**
  6. **Upload and download shapes: upload verified, download verified for what the
     marker needs, 404 not documented.** Upload, _Upload Worker_ (`PUT /accounts/
     {account_id}/workers/scripts/{script_name}`, read in full, and the OpenAPI
     operation): `multipart/form-data`, "a JSON `metadata` part whose
     `main_module` field names the entrypoint file", "JavaScript ES module parts
     use the `application/javascript+module` content type", and (`workers/
     configuration/multipart-upload-metadata/`, read) `main_module` is "the part
     name that contains the module entry point", which is `worker.mjs` here, the
     metadata part name _and_ the form field of the module. `compatibility_date`
     is an optional metadata string. Download, _Download Worker Script_ and the
     OpenAPI operation: "Fetch raw content for a Worker script. Note this is the
     original script content, not JSON encoded", and the 200 is described as
     "Returns script content as a multipart form, with no metadata part and no JSON
     encoding applied", with content types `application/javascript` and
     `multipart/form-data`. So the response may be bare or multipart; the marker is
     found in the raw text either way (`deployedHash` anchors on a line start and
     tolerates a trailing `\r`), which is the reason the code reads text. **404 is
     not in the reference:** the schema says only `4XX`, `application/json`. Third
     parties report 404 with error 10007, "Worker not found", for an absent
     script (search snippets of a connector site, not Cloudflare); `callScript`
     takes 404 as absent and anything else not-ok as a failure. Not settled by
     reading; the owner's first `--apply` settles it.
  7. **A Worker's `fetch` with no tunnel connector: not settled by the docs.**
     `support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/`
     (read) says 1033 is the tunnel with no healthy `cloudflared`, and says nothing
     of Workers. The closest statement is `workers/platform/known-issues/` (read):
     a Worker `fetch()` to a hostname Cloudflare cannot resolve "will lead to 530
     status code" and "will fail with status code 530 (1016)", which describes a
     status, not a throw, for the neighbouring case. Likely a 530 response, but
     this is inference, not the 1033 case. The Worker handles both, so nothing
     changes; the live outage test (Done when 1) is the proof.
  8. **`workers.dev` by default: documented for created Workers, not for an
     upload; an open decision, below.** `workers/configuration/routing/workers-dev/`
     (read): "All Workers are assigned a `workers.dev` route when they are created
     or renamed", "when enabled, your `workers.dev` URL is available publicly".
     The reference has `POST /accounts/{id}/workers/scripts/{name}/subdomain` with
     `{ "enabled": boolean, "previews_enabled"?: boolean }` ("Enable or disable a
     Worker script on the workers.dev subdomain", no default stated) and a `GET`
     on the same path. The first `--apply` creates the script, so unless the
     account has no `workers.dev` subdomain registered it is likely reachable at
     `down-page.<subdomain>.workers.dev`; the script does not turn it off.
     **Open decisions (the dispatch could not settle them, so nothing was changed).**
     _Fail open (5):_ (a) keep the flag on POST and have the first live `--apply` be
     the test, the cost being a possible rejection or a silent fail-closed;
     (b) POST `{ pattern, script }` as documented, then `PUT .../routes/{id}` with
     the flag, the one shape a source shows working, at one more call per Worker
     route and a second write that can fail between the two; (c) drop the flag and
     say in `docs/02-DEPLOYMENT.md` that past the quota the pages answer 1027 (the
     default). Recommended: (b). _`workers.dev` (8):_ (a) leave it, the Worker only
     forwards to the hostname in the request; (b) after the upload `POST` the
     `/subdomain` endpoint with `enabled: false`, one more call, whose permission
     requirement this check did not read. Recommended: (b), since a public URL for a script
     nobody asked to publish is an exposure with no use.
- 2026-11-08 — **Done when, as built.**
  1. _Owner's, on the live host — owed._ Needs `--apply` against the real
     account, then a container stop and a `cloudflared` stop.
  2. _Owner's, same outage — owed._ `/api/health` is excluded by construction
     (`planner.example.com/api/*` is a route with no Worker; test `an exclusion is
     created with no script, a Worker route with fail-open`), which is the
     part this build can show; the live answer is the owner's.
  3. Met: `npx vitest run scripts/test/cloudflare-down-page.test.ts` → 72 of 72 at `08c44f0b` (59 at the first build; the file grew with the two owner answers and round 1).
     The decision table is `the decision over (outcome x Accept x method)`; the
     route plan `the route plan` (additions, exclusions for every tool in
     `TOOLS`, the conflict on a foreign Worker, and the two exclusion/Worker
     inversions); the idempotent upload `--apply uploads once and adds each
     route once; the second run has nothing to do` (no PUT on the second run).
     Mutants: `DOWN_STATUSES` widened to 500 failed 4; `planWorker`'s `ok`
     branch disabled failed 2; the non-page-load guard removed failed 1.
  4. _Plan half met, live half owed._ The dry run printed (fake account):
     `ADD worker down-page (sha256 2dfb2786b825)`, then `ADD route` for
     `<host>/api/*`, `<host>/assets/*` (both with `(no Worker)`),
     `<host>/theme.js` (downloader and ledger) and `<host>/* -> down-page` for
     each of the three tools, `22 change(s). Re-run with --apply` (21 at the first build, plus the `DISABLE  worker  down-page on workers.dev` line the second answer added); against the
     fake, `--apply` twice printed `applied …` then `nothing to do.` **A real
     `--apply` twice on the live account is the owner's.**
  5. Met: Playwright, 360×640, each of three tools in light and dark, from
     `renderDownPage()`: `scrollWidth` 360 against `innerWidth` 360 in all six.
     Screenshots are attached to the draft pull request.
  6. Met: `docs/02-DEPLOYMENT.md` names both permissions (table, and the
     paragraph under it) and the verification step.
  7. Met: `npm run check` exit 0, and `npm test -- --project repo` exit 0
     (16 files, 704 passed and 1 skipped of 705 at `08c44f0b`; 691 of 692 at the first build).
- 2026-11-08 — **Not folded in:** `docs/02-DEPLOYMENT.md`'s _edge rate limit_
  paragraph still says a WAF rule "would need a fourth permission on a token
  whose header argues for three". It is a dated owner decision (dl-52,
  2026-09-28) and was true when written; rewording another ticket's recorded
  decision is not this change's to make.
- 2026-11-08 — **Owner answers to the two open decisions above (5 and 8)**,
  relayed by the coordinator, recorded before the code that follows them.
  - _Fail open (5)._ Question: what should the setup script do about fail open?
    Options: (a) POST `{ pattern, script }` as documented, then PUT the route with
    `request_limit_fail_open: true`; (b) keep the flag on POST and let the first
    live `--apply` test it; (c) drop the flag and document 1027 in
    `docs/02-DEPLOYMENT.md`. Recommended: (a) (builder-web and the coordinator).
    **Chosen: (a)** (owner, 2026-11-08). A re-run must repair a route left fail
    closed by a failure between the two writes: a kept route whose flag is false is
    a change, not "nothing to do"; a route already fail open is nothing to do.
    Supersedes the build entry's "the code sends the flag on POST".
  - _workers.dev (8)._ Question and options: (a) disable it after upload through the
    `/subdomain` endpoint with `enabled: false`; (b) leave it and document it.
    Recommended: (a). **Chosen: (a)** (owner, 2026-11-08). It must be idempotent
    like the upload (already disabled is nothing to do), and if the endpoint needs
    a permission outside the header's six the builder stops and reports instead
    of adding a seventh.
- 2026-11-08 — **Built the two answers** (`scripts/cloudflare-setup.mjs`,
  `scripts/test/fixtures/cloudflare-workers-fake.mjs`,
  `scripts/test/cloudflare-down-page.test.ts`, `docs/02-DEPLOYMENT.md`).
  - _Fail open._ The route is POSTed with `pattern` and `script` only, then
    `PUT /zones/{zone}/workers/routes/{id}` with `{ pattern, script,
    request_limit_fail_open: true }` (the PUT replaces the route, so it restates
    the two). `planRoutes` returns a `repair` list for a Worker route whose
    `request_limit_fail_open` is not `true`; the plan prints `REPAIR route …`
    and counts it as a change. Exclusions carry no flag and are never repaired.
    Read from the reference (curl, 2026-11-08): _Update Worker Route_ takes
    `pattern` and `script`, permission `Workers Routes Write`, one of the six.
  - _workers.dev._ After the upload (and before the routes) the script `POST`s
    `{ enabled: false }` to `/accounts/{id}/workers/scripts/down-page/subdomain`;
    for a script it uploaded earlier it first `GET`s the same path and plans a
    `DISABLE` only if `enabled` is true. **Permission: `Workers Scripts Write`
    for both the GET and the POST** (the reference's "Accepted Permissions" for
    _Get_ lists it among several and for _Update Worker Script Subdomain_ lists it
    first), which is the header's `Account · Workers Scripts · Edit`. No seventh
    permission; no stop. A 401/403 on the GET names that permission.
  - _Two things that are still unproven, and the first live `--apply` shows both._
    (1) The route list must return `request_limit_fail_open` for a Worker route:
    the changelog (2025-04-15) says it does, but the schema omits it, and if the
    list left it out every re-run would print `REPAIR` and never reach `nothing
    to do`. (2) The `/subdomain` call on an account that has registered no
    `workers.dev` subdomain: the reference does not say whether it answers or
    errors, and an error would stop the apply after the upload.
  - _Tests that fail without each change_ (`cloudflare-down-page.test.ts`): _a
    Worker route is POSTed as documented, then PUT with the flag_; _a Worker route
    that exists fail closed is a repair, not 'nothing to do'_; _a Worker route
    already fail open is nothing to do_; _a run that fails between the POST and
    the PUT is finished by the next run_ (a 500 on the first PUT, then a re-run
    that prints `REPAIR` and a third that reports `nothing to do.`); _a new Worker
    is switched off workers.dev right after its upload, once_; _a Worker already
    off workers.dev is nothing to do; one that is on is switched off_;
    `planWorkersDev` and the apply order. The fake now drops everything but
    `pattern` and `script` on POST, as the create call documents, so a build that
    still sent the flag there would leave the routes fail closed and fail the
    repair assertions.
- 2026-11-08 — **Owner answer to gate 1's F1** (round 1), relayed by the
  coordinator, recorded before the code that follows it. Finding: a `/subdomain`
  answer that is not 2xx and not 401/403 stops the first `--apply` right after the
  upload and wedges every later run, dry runs included, before a plan prints, so
  the routes are never made (reproduced on `49971a53` with the gate's `f2.sh`:
  `apply-1` exit 1 after `applied  worker  down-page`; `apply-2` and a dry run
  exit 1 with 0 stdout lines; routes in the account 0, script uploaded 1).
  Question: what should happen with F1? Options: (a) keep the order and print the
  manual recovery in the error; (b) run the workers.dev step after the routes and
  make its failure a printed `FAILED` line with a non-zero exit at the end; (c)
  land as recorded. Recommended: (b) (gate and coordinator). **Chosen: (b)**
  (owner, 2026-11-08). The workers.dev step runs after the routes and repairs; a
  non-2xx, non-401/403 answer from `/subdomain`, on the GET while planning or the
  POST while applying, prints a `FAILED` line naming the call and status; the plan
  and the routes still go through, a dry run prints its whole plan, and the run
  exits non-zero at the end. A 401/403 on the GET keeps its permission message.
  Supersedes the earlier build entry's "right after the upload" ordering.
- 2026-11-08 — **Round 1 (gate 1 at `49971a53`, CONCERNS): F1, F2, F3 applied,
  F4 left recorded.**
  - _F1, reproduced then fixed as the owner chose (b)._ Before: `f2.sh` (gate 1's
    script, run against this tree at `49971a53`): `apply-1` exit 1 with `POST
    …/down-page/subdomain -> 404` after `applied  worker  down-page`, `apply-2` and
    `dry-3` exit 1 with `GET …/subdomain -> 404` and 0 stdout lines, no route
    written. After (`08c44f0b`): `apply-1` makes the upload, all 11 routes and the 3 fail-open PUTs,
    prints `FAILED   worker  down-page workers.dev: POST …/subdomain ->
    404 (no detail)` and exits 1; `apply-2` prints its plan (28 lines) and exits 1;
    `dry-3` prints the whole plan (28 lines) and exits 1. In `applyOrder` the
    `workersdev` op now follows the routes and the repairs, a non-2xx answer other
    than 401/403 on the GET (planning) or the POST (apply) becomes a `FAILED` line
    counted by `finish()`, and `finish()` throws a `CliError` after the plan, the
    apply or `nothing to do.`. A refused connection (no status) still throws, as
    does a 401/403 on the GET before anything is written. The cost of the order,
    stated: the Worker's `workers.dev` address is public for the length of the
    route calls instead of one call.
  - _Tests that fail without it_ (the five that fail on `49971a53`'s source,
    `cloudflare-down-page.test.ts`): _a /subdomain answer that is not 2xx does not
    keep the routes from being made_; _a re-run past that failure prints its plan,
    keeps the routes ok, and still fails_; _a dry run past that failure still
    prints the whole plan, then exits non-zero_; _a new Worker is switched off
    workers.dev once, after the routes_; _order: upload, then routes, then
    repairs, then workers.dev off_. The fake gained `subdomainStatus`.
  - _F2._ `docs/02-DEPLOYMENT.md` now says what a `REPAIR` on every run means (the
    route list is not returning `request_limit_fail_open`, so the script cannot
    see the flag; the repeated PUTs change nothing). No code change: it has no live
    call site until the first apply.
  - _F3._ The "Done when, as built" figures above are refreshed at `08c44f0b`: 72
    of 72 in the down-page file, `22 change(s)` in the dry run, 704 passed and 1
    skipped of 705 in the repo project. The pull request body is the lander's.
  - _F4_ (no committed test reads the page's width) stays recorded, untouched.
- 2026-11-08 — Owner answered the landing question (which of gate 2's lows to fix at landing, no re-gate), relayed by the orchestrator. Options: (a) F2 and N2 at landing, N1 and F4 recorded; (b) F2, N2 and N1 at landing; (c) land as gated. Chosen: (b), over the recommended (a). F4 stays recorded.
