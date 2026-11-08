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
- 2026-11-08 — **Unverified — needs web check.** Each is an assumption the code
  makes; each names what would settle it.
  1. **Access versus Workers order** (brief's _Facts to verify_). Believed:
     Access runs first, so a logged-out planner or ledger visitor sees the login,
     not the page. _Settles it:_ Cloudflare's "Workers and Access" / order of
     operations page, or on the live host `curl -sSI -H 'Accept: text/html'
     https://planner.<domain>/` with the container stopped, logged out.
     _Where it shows:_ the _Verifying_ paragraph already tells the owner to note
     it.
  2. **`CF-Connecting-IP` on a pass-through subrequest.** The Worker calls
     `fetch(request)` with the incoming request unchanged and `/api/*` is
     excluded, so the downloader's per-client limits never go through it; the
     page-load path is the only one that does. _Settles it:_ the Workers docs'
     `fetch` / `CF-Connecting-IP` notes, or an `/api/`-less route logging the
     header at the origin.
  3. **Free-plan quota and CPU limit** (brief: about 100,000 requests/day, 10 ms
     CPU). _Settles it:_ `developers.cloudflare.com/workers/platform/limits/`.
     The Worker does no work beyond a `fetch` and a static string, which is far
     inside either figure as the brief states them.
  4. **A route with no `script` is how the API expresses an exclusion** (Build
     3). The code POSTs `{ pattern }` with no `script` key and reads an existing
     route as an exclusion when `script` is absent, null or empty. _Settles it:_
     `POST /zones/{id}/workers/routes` and its list shape in the API reference.
  5. **`request_limit_fail_open: true` on the Worker routes** is the field name
     the builder remembers for "fail open"; whether the route body accepts it,
     or whether failure mode is set elsewhere, is unchecked. If the API rejects
     the unknown field the first `--apply` fails at the first Worker route, with
     the exclusions already made. _Settles it:_ the same API reference.
  6. **Script download and upload shapes.** Upload: `PUT
     /accounts/{id}/workers/scripts/down-page`, multipart with a `metadata` part
     (`main_module`, `compatibility_date`) and the module part
     `application/javascript+module`. Download: `GET` the same path, answers the
     module as text (or multipart), 404 when absent. The marker has to survive
     the round trip for a second run to say `nothing to do`. _Settles it:_ the
     API reference, then the owner's second `--apply` (Done when 4).
  7. **What a Worker's own `fetch` does with no tunnel connector.** The Worker
     handles both a throw and a 530, because which one a Worker sees is not
     known. _Settles it:_ the live outage test (Done when 1).
  8. **A new script's `workers.dev` route.** Not enabled by the script; whether
     a freshly uploaded script is reachable on `*.workers.dev` by default is
     unchecked. The Worker only forwards to the hostname in the request, so it
     would answer a self-fetch error, but the owner may want it off. _Settles
     it:_ the dashboard's Worker settings after the first `--apply`.
- 2026-11-08 — **Done when, as built.**
  1. _Owner's, on the live host — owed._ Needs `--apply` against the real
     account, then a container stop and a `cloudflared` stop.
  2. _Owner's, same outage — owed._ `/api/health` is excluded by construction
     (`planner.example.com/api/*` is a route with no Worker; test `an exclusion is
     created with no script, a Worker route with fail-open`), which is the
     part this build can show; the live answer is the owner's.
  3. Met: `npx vitest run scripts/test/cloudflare-down-page.test.ts` → 59 of 59.
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
     each of the three tools, `21 change(s). Re-run with --apply`; against the
     fake, `--apply` twice printed `applied …` then `nothing to do.` **A real
     `--apply` twice on the live account is the owner's.**
  5. Met: Playwright, 360×640, each of three tools in light and dark, from
     `renderDownPage()`: `scrollWidth` 360 against `innerWidth` 360 in all six.
     Screenshots are attached to the draft pull request.
  6. Met: `docs/02-DEPLOYMENT.md` names both permissions (table, and the
     paragraph under it) and the verification step.
  7. Met: `npm run check` exit 0, and `npm test -- --project repo` exit 0
     (16 files, 691 passed and 1 skipped of 692).
- 2026-11-08 — **Not folded in:** `docs/02-DEPLOYMENT.md`'s _edge rate limit_
  paragraph still says a WAF rule "would need a fourth permission on a token
  whose header argues for three". It is a dated owner decision (dl-52,
  2026-09-28) and was true when written; rewording another ticket's recorded
  decision is not this change's to make.
