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
