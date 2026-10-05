---
id: repo-91
tool: repo
title: CodeQL's missing-rate-limiting check cannot see `@webtools/core/rate-limit`, so how does the repo satisfy it
kind: chore
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# repo-91 — CodeQL cannot see the shared rate limiter

## Why

On PR #345 (lg-4, the ledger's rule classifier and inbox), the `CodeQL` check
(the code-scanning result check of the advanced-setup `security.yml` workflow,
not GitHub's default setup; see the Log) failed with **"Missing rate limiting (High)"** on
two ledger routes: `routes/inbox.ts` (line 21) and `routes/rules.ts` (line 57)
at 0e6bb53. The ledger then added `@webtools/core/rate-limit` to every route,
with `tools/ledger/api/test/route-limits.test.ts` proving the 429s, and the
check **still failed** at 6a5a73b (the same two files, lines 24 and 60). The
owner dismissed both alerts as false positives on 2026-10-03, and asked for this
ticket in the same answer.

**The cause.** `js/missing-rate-limiting` models a fixed list of libraries
rather than the behaviour. CodeQL's `MissingRateLimiting` library documents
`express-rate-limit`, `express-brute`, `express-limiter` and
`rate-limiter-flexible` (the classes `RateLimiterFlexibleRateLimiter` and
`RouteHandlerLimitedByRateLimiterFlexible`), plus a general
`RateLimitingMiddleware` class for a middleware that "acts as a rate limiter"
(<https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/security/dataflow/MissingRateLimiting.qll/module.MissingRateLimiting.html>,
read by this ticket's builder on 2026-10-03). **That list was incomplete.** The
file at the tag the run used, `codeql-cli/v2.27.1`, also models Fastify's own
limiter twice: `FastifyRateLimiter` matches an import of `@fastify/rate-limit` or
`fastify-rate-limit`, and `FastifyPerRouteRateLimit` matches an options object,
passed as the second argument of a Fastify shorthand route call with three or
more arguments, that carries `config.rateLimit` or `rateLimit` (found by the
2026-10-04 gate and re-read by the builder; the file was read through a
summarising fetch, not a clone). The repo's own limiter is none of those, so it
is invisible to the query, and **every Fastify route that touches a database or
the filesystem can trip it, in any tool**.

**What the repo has, measured here at the base (ebb808b):**

- `@webtools/core/rate-limit` is imported from `tools/downloader/api/src` (its
  `server.ts`, `context.ts`, `rate-limit.ts`, `thumbnails.ts` and routes
  `probe.ts` and `files.ts`) and from `tools/planner/api/src` (`server.ts`,
  `context.ts`, `rate-limit.ts`). `grep -rn "webtools/core/rate-limit"
tools/*/api/src` lists them. The ledger imports it too, in `server.ts`,
  `context.ts` and `rate-limit.ts`, since #345 merged (corrected 2026-10-04; see
  the Log).
- `rate-limiter-flexible` appears in no `package.json` in the repo
  (`grep -n "rate-limiter-flexible" package.json packages/*/package.json
tools/*/*/package.json` prints nothing), so adopting it is a new dependency.
- Neither the downloader nor the planner has been reported by this check. That
  is **unmeasured**, not evidence they are clean: CodeQL's alert list for those
  tools was not read.

## The decision

**The owner's question, in their words, was "what rate-limiter-flexible
advantages?"** What follows is the orchestrator's answer from its own knowledge,
**unverified** (the library's documentation was not read for this ticket):

- CodeQL recognises it, which is the only advantage that bears on the alert.
- Shared or persistent stores (Redis, Postgres, SQLite and others), so a limit
  survives a restart and holds across more than one process.
- Block durations, an insurance limiter that takes over when the primary store
  fails, and unions of limiters.
- The cost: a new dependency, and moving off the tested shared
  `@webtools/core/rate-limit`, which three tools use (the ledger since #345) and
  which has its own suite.

**The measurement that came first, and what it found.** Does CodeQL recognise
`rate-limiter-flexible`'s `consume()` when it is called from a Fastify
`onRequest` hook? The `CodeQL` check is a code-scanning result check, which
`security.yml` produces on a pull request, on a push to `main`, weekly and on
dispatch; it is answerable only by a CI run on a throwaway branch, so it was run
twice (the Log, 2026-10-04 and 2026-10-05; probe pull requests #352 and #356,
both closed). In short, one run per variant:

- `consume()` from a hook passed as the route's `{ onRequest }` option: **alerts**.
  From a hook added with `app.addHook("onRequest", fn)`: **no alert**.
- `@fastify/rate-limit` registered once with `register`, the route left as the
  tools write it today (`{ onRequest: read }`, core's hook): **no alert**, in the
  same function and when registered in another file. Imported and never
  registered: **alerts**.
- A bare `rateLimit` key, or `config: { rateLimit }`, in a route's options beside
  core's hook, with no plugin registered: **no alert**. The model matches the key,
  not whether anything limits. Both literals also failed `npm run check` and
  `npm run build` with TS2353 in the probe's CI, with the plugin not installed;
  see option 4.

**Options, re-posed 2026-10-05 against that.** No recommendation is set. Each
cost below is either measured (with its variant in the Log) or marked
**unmeasured**.

1. **Adopt `rate-limiter-flexible` in `@webtools/core`, behind the existing
   `RateLimiter` interface.** The interface holds, but the call sites **do move**:
   the limited routes in all three tools attach their limiter as a route option,
   `{ onRequest: ... }` (`git grep -c "onRequest" origin/main --
'tools/*/api/src/routes/*.ts'` lists 10 route files, and no `addHook` in
   `tools/*/api/src` is a limiter; they are CORS, request logging, identity and
   `onSend`), and that is the shape variant B alerted on. What cleared was a
   hook added with `app.addHook`. So the option means moving every limited route
   to one hook per instance, which gives up the per-route attachment that
   `tools/ledger/api/src/rate-limit.ts` documents and that
   `route-limits.test.ts` walks every route to check, plus a new dependency in a
   shared package and a migration of core's suite. **Unmeasured:** whether a hook
   that keys on the Access identity, a function of `request` and not a read of one
   of its properties, is recognised (the model requires a read of a `request`
   property to flow into `consume()`, and F's `request.ip` is exactly that);
   and core's limiter wrapped around `consume()`.
2. **Keep core's limiter and excuse each alert in code, under adr/005.** Not the
   UI dismissal #345 used: adr/005 > "Alternatives considered" rejects "Dismiss
   each recurrence in the GitHub UI", because the reason lives outside version
   control and does not survive an alert moving. The repo's path is a
   `// codeql[js/missing-rate-limiting]` comment on the line above the alert
   carrying five fields (the query id, the file, the date, the reasoning, and the
   test that would catch the true positive; rule 3 there is "no test, no
   excuse"), with `security.yml` dismissing on a push to `main`. Under it a pull
   request touching the file **still gets a red `CodeQL` check** until then.
   The cost lands per route, in any tool that trips it: a comment of five fields,
   a red check on every PR whose diff introduces or relocates the alert (adr/005
   > Context), which includes editing anything above the route in the same file
   > and not only the route itself, and a push to `main` before it clears. **Unmeasured:** where the comment goes, since the annotation sits on
   > the closing line of the `app.get(...)` call (every alert in the Log), and
   > whether the suppression matches an alert there.
3. **Add a CodeQL model, a pack or an extension, teaching it core's
   `RateLimiter`.** The "leaving default setup for an advanced one" cost is
   void: the repo already runs the advanced workflow, with `packs:` already
   used for `AlertSuppression.ql`. What is left is a model extension and owning
   it across query-pack upgrades (the run used `codeql/javascript-queries`
   2.4.6). **Unmeasured:** whether an extension can teach the Fastify route
   option, and the cost of keeping it current.
4. **Adopt `@fastify/rate-limit`, which CodeQL models.** The tools' routes can
   stay as they are: registering the plugin once on the instance cleared a route
   written `{ onRequest: read }` (variants G4 and G6), so no call site moves for
   CodeQL's sake. Costs: a new dependency; and what it does to the tools is
   **unmeasured**, since its documentation was not read here: whether it can keep
   each tool's `RATE_LIMITED` `AppError` body and `RateLimit-*` headers, key on the
   Access identity as the ledger does and not on an address, and leave health
   unlimited as the ledger does. **Unmeasured, from recollection of the plugin
   and not from its documentation:** that registered with its defaults it would
   also apply to every route on its instance, and so stack with core's limiter
   unless core's moves out of those routes. **Measured, with a narrower remainder:** variants
   G1 and G2 show CodeQL is satisfied by a `rateLimit` or `config.rateLimit` key
   beside core's hook with no plugin registered, so by itself the model would let
   a route go green with nothing added that limits, which adr/005's rule 3 calls
   worse than an open alert. But the probe's own CI refused both literals: with
   the plugin installed nowhere, `npm run check` and `npm run build` failed on
   G1 (run 37257413673, `probe.ts(19,34): error TS2353: Object literal may only
specify known properties, and 'rateLimit' does not exist in type
'FastifyContextConfig'`) and on G2 (run 37257508695, `probe.ts(20,24):
error TS2353: ... 'rateLimit' does not exist in type 'RouteShorthandOptions<...>'`).
   So the literal forms do not get past `npm run check`. **Unmeasured:** a form
   that gets past TypeScript's excess-property check, such as an options object
   held in a variable or a cast (the class uses `flowsTo`, so CodeQL may still
   match it), and, under this option, whether the plugin's own type augmentation
   makes `config.rateLimit` typecheck, which would reopen G1.

## Reproduction

The alerts are visible **only in the PR check run**, not through any command that
works here (`gh api` is denied):

- At 0e6bb53 the check run was
  <https://github.com/brunolabbe/tools/runs/111242886503> (relayed by the
  orchestrator, not re-read: a run this old was not fetched).
- Find the current one with `gh pr view 345 --json statusCheckRollup` and read the
  `CodeQL` entry's `detailsUrl`. At #345's head 42eee99 it was
  <https://github.com/brunolabbe/tools/runs/111258200380>, `conclusion: FAILURE`,
  measured on 2026-10-03; the annotations are on that page.

## Build

Not until the decision is answered. First, whichever option is chosen: the
measurement above, on a throwaway branch (never `main`), with the result written
into this ticket's Log. Then the option's own work.

## Done when

- The ticket's Log records whether CodeQL recognises `consume()` from a Fastify
  `onRequest` hook, with the run URL, and the owner's choice among the options
  is recorded here.
- A new ledger route (or any route) that is limited by the repo's chosen limiter
  passes the `CodeQL` check without a dismissal, or the Log says why the chosen
  option is a dismissal instead.

## Log

- 2026-10-03: filed by the 2026-10-03 batch's close-out, from the owner's
  decision on #345. `needs-decision` rather than `ready`: it poses a question
  its own page says must not be settled by whoever picks it up, and
  `docs/01-TICKETS.md` makes that the status of a filing like this. Verified
  here: the import list and the absent dependency above, the CodeQL
  documentation's class list, #345's current `CodeQL` check run. Relayed, not
  verified: the first run URL, the line numbers at 0e6bb53 and 6a5a73b, the
  owner's dismissal, and every claim about `rate-limiter-flexible` itself.
- 2026-10-04: **the measurement, taken at the owner's choice ("Run the
  measurement") and no option chosen; `status` stays `needs-decision`.** Probe
  pull request #352 (draft, closed unmerged, branch deleted), base 3a7d8a9, one
  commit per variant, each a ledger route doing `readFileSync("/etc/hostname")`.
  `rate-limiter-flexible` and `express` were in no `package.json` and installed
  nowhere in any variant; the CodeQL job runs no install.

  | Variant (head sha)                                                                                | `CodeQL` check | Alert                                         |
  | ------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------- |
  | A, core's `RateLimiter` in `{ onRequest }`, the tools' way today (2b3977e), positive control      | FAILURE        | Missing rate limiting (High), `probe.ts` 19   |
  | B, Fastify, `consume()` in a hook passed as the route's `{ onRequest }` option (75e5b89), subject | FAILURE        | Missing rate limiting (High), `probe.ts` 23   |
  | C, Fastify, `consume()` inside the handler (442f65b)                                              | FAILURE        | Missing rate limiting (High), `probe.ts` 20   |
  | D, Express, `consume(req.ip)` inside the handler (54c0c27), control                               | FAILURE        | Missing rate limiting (High), `probe.ts` 23   |
  | E, Express, `consume(req.ip)` in a separate middleware before the handler (69879bf), control      | SUCCESS        | none ("No new alerts in code changed by ...") |
  | F, Fastify, `consume(request.ip)` in a hook added with `app.addHook("onRequest", fn)` (7c72dc3)   | SUCCESS        | none                                          |

  **Read plainly:** CodeQL does **not** recognise `consume()` called from a hook
  passed as a route's `{ onRequest }` option (B), nor inside a Fastify handler
  (C). It **does** recognise it from a hook registered with
  `app.addHook("onRequest", fn)` (F), and from a separate Express middleware (E).
  A alerted, so the control holds for the `{ onRequest }` shape. F's own route
  is a different shape (`app.get(path, handler)`, no options), so A does not
  prove F's pass is not an absent route; C, the same two-argument shape, alerted,
  and F's run log shows `probe.ts` extracted and the query evaluated, and those
  are what do (the 2026-10-04 gate's evidence; the builder did not read that
  log). E's pass shows the library is matched by its import name with the package
  uninstalled, so B and C are not failing for want of `node_modules`. Why B
  differs from F is **not explained**: `Fastify.qll` was not read, only the
  `MissingRateLimiting.qll` class text and the query's own test
  (`MissingRateLimit/tst.js`, an Express middleware, which is the shape E copies).
  Each variant is one run; no repeat.

  **Not tested**, so unknown: `preHandler` or a `{ onRequest: [fn] }` array; a hook
  added inside a child plugin scope; a route registered before the `addHook`
  call or on a different instance than the hook; `RateLimiterRedis` or any store
  other than `RateLimiterMemory`; core's limiter wrapped around `consume()`.

  **What the brief had wrong.** `.github/workflows/security.yml` is an
  **advanced-setup** CodeQL workflow (`github/codeql-action/init@v4` and
  `analyze@v4`, `queries: security-extended`, pack `codeql/javascript-queries`
  2.4.6 on CodeQL 2.27.1 per run 37141901816's log), not GitHub's default setup.
  The `CodeQL` check with no workflow name is the code-scanning result check
  fed by that upload; the `codeql` job in the `security` workflow passes either
  way. So option 3's cost line, "probably means leaving default setup for an
  advanced one", describes a step already taken, and adr/005's SARIF-suppression
  register is the path this repo already has for an excused finding. The
  ticket's "Why", its measurement paragraph, its options and its `Done when` said
  "default setup" (and that it "runs only on a pull request", which `security.yml`'s
  triggers contradict); they are corrected on 2026-10-05, below. The other stale claim, that the ledger's
  import of core's limiter was "not on `main` yet", is corrected above:
  `tools/ledger/api/src/server.ts:13` is
  `import { RateLimiter } from "@webtools/core/rate-limit";`.

  **The commands.** The check conclusions are in `gh pr view 352 --json
statusCheckRollup`, filtered to `CodeQL` and `codeql`, and the alert text is
  not in `gh` output at all: it was read by fetching each check run's
  `detailsUrl` as a web page, which worked without authentication on this public
  repository. Run URLs: A <https://github.com/brunolabbe/tools/runs/111550841424>,
  B <https://github.com/brunolabbe/tools/runs/111551252163>, C
  <https://github.com/brunolabbe/tools/runs/111551619044>, D
  <https://github.com/brunolabbe/tools/runs/111552085454>, E
  <https://github.com/brunolabbe/tools/runs/111552638732>, F
  <https://github.com/brunolabbe/tools/runs/111553034085>. The alert line is the
  closing line of the `app.get(...)` call, not its first. Cleanup:
  `git ls-remote --heads origin | grep -c repo-91-codeql-probe-scratch` printed
  `0`. The probe's other checks (`check`, `docker`, `test`) went red from B on,
  because the probe imports an uninstalled package; that is the probe, not a
  finding. The probe PR's title is `test(ledger): DO NOT MERGE — repo-91 CodeQL
measurement`, not the dispatch's bare `DO NOT MERGE — ...`, because
  `.claude/hooks/check-pr-title.sh` refuses a title that is not a conventional
  commit.

- 2026-10-05: **second probe, #356 (draft, closed unmerged, branch deleted), after
  the 2026-10-04 gate (CONCERNS) and the owner's choice to re-pose the options
  and probe once more.** `status` stays `needs-decision`; no option is chosen.
  Base 3a7d8a9, one commit per variant, each replacing the last, each a ledger
  route reading `/etc/hostname`, and `@fastify/rate-limit` installed nowhere.
  **What the class text says**, read from `codeql-cli/v2.27.1`'s
  `MissingRateLimiting.qll` through a summarising fetch (not a clone), before
  choosing variants:
  `FastifyRateLimiter` is `this = DataFlow::moduleImport(["fastify-rate-limit",
"@fastify/rate-limit"])`; `FastifyPerRouteRateLimit` requires a
  `Fastify::RouteSetup` whose method is not `route` or `addHook`, with three or
  more arguments, where an object flowing to argument 1 has
  `getAPropertySource("config").getAPropertySource("rateLimit")` or
  `getAPropertySource("rateLimit")`. Neither checks that anything limits.

  | Variant (head sha)                                                                                                                                               | `CodeQL` check | Alert                                                                                                    |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
  | H, four routes, core's hook in `{ onRequest }`: H1 fs/no parameter (**the positive control, A**), H2 fs/`request`, H3 db/no parameter, H4 db/`request` (9913cde) | FAILURE        | four alerts, `probe.ts` 22 (H1, file system), 27 (H2, file system), 32 (H3, database), 37 (H4, database) |
  | G4, `app.register(rateLimit)` in the route's function, route left as `{ onRequest: read }` (13074f6)                                                             | SUCCESS        | none                                                                                                     |
  | G1, `{ onRequest: read, config: { rateLimit: {...} } }`, no plugin (3410b9d)                                                                                     | SUCCESS        | none                                                                                                     |
  | G2, `{ onRequest: read, rateLimit: {...} }`, no plugin (e54ac72)                                                                                                 | SUCCESS        | none                                                                                                     |
  | G5, `@fastify/rate-limit` imported and never registered, route as G4 (25eed13)                                                                                   | FAILURE        | Missing rate limiting (High), `probe.ts` 20                                                              |
  | G6, `await server.register(rateLimit, ...)` in `server.ts` before any route, route in `routes/probe.ts` which never mentions it (74cc5e3)                        | SUCCESS        | none                                                                                                     |

  **Read plainly.** G5 alerting beside G4 and G6 passing is the control for the
  plugin cases: the same route fails with the import and passes with the
  registration, so it is the registration, not the import, that the model keys
  on, and it reaches a route in another file on the same instance (G6). G1 and G2
  pass with no plugin at all, as the class text predicts: the model matches the
  key. **But the probe's own CI rejected both literals** (run 37257413673 for
  G1: `probe.ts(19,34): error TS2353 ... 'rateLimit' does not exist in type
'FastifyContextConfig'`; run 37257508695 for G2: `probe.ts(20,24): error
TS2353 ... 'rateLimit' does not exist in type 'RouteShorthandOptions<...>'`,
  both from `npm run check` and `npm run build`; found by the 2026-10-05 gate and
  reproduced with `gh run view <id> --log-failed | grep -m2 "error TS"`). So with
  no plugin installed the literal forms do not pass the repo's own checks. Not
  measured: an options object held in a variable or a cast, which could pass
  TypeScript and which CodeQL's `flowsTo` may still match, and the plugin's own
  type augmentation, which may make `config.rateLimit` typecheck. **No variant sets whether a registration inside a child plugin scope,
  after the route, or on another instance clears; `preHandler` and arrays were
  not tried.** One run per variant.

  **The lg-5 gate's data point, recorded and unexplained.** The lg-5 gate on #354
  (#354's head was ce0a97b when the builder looked) observed: "all the handlers flagged on
  this PR are `async () =>` with no parameter, and the two database-reading `GET`s
  here that take `request` (`/api/buckets`, `/api/ratios`) are not flagged".
  Variant H tested the parameter directly, with core's hook on all four: H2 and H4,
  which take and read `request`, **alerted** like H1 and H3, for file system
  and database access alike. So a `request` parameter alone does not explain
  it. What is left is **untested**: `/api/buckets` and `/api/ratios` themselves
  (not on `main` at 3a7d8a9), a handler that reaches its database through a
  helper in another module as the real routes do (H3 and H4 call `prepare`
  in the handler), and whether those handlers' database access is modelled at
  all.

  **The commands.** Same as 2026-10-04: conclusions from `gh pr view 356 --json
statusCheckRollup` filtered to `CodeQL` and `codeql` (the `codeql` job was
  SUCCESS on every head), alert text from fetching each `detailsUrl` as a web
  page. Run URLs: H <https://github.com/brunolabbe/tools/runs/111596813723>, G4
  <https://github.com/brunolabbe/tools/runs/111597212755>, G1
  <https://github.com/brunolabbe/tools/runs/111597548195>, G2
  <https://github.com/brunolabbe/tools/runs/111597947397>, G5
  <https://github.com/brunolabbe/tools/runs/111598343364>, G6
  <https://github.com/brunolabbe/tools/runs/111598769570>. The G4 and G6
  pages read "No new alerts in code changed by this pull request"; G1 and G2 were
  read by conclusion only. Cleanup: `git ls-remote --heads origin | grep -c
repo-91-codeql-probe-scratch` printed `0`. The 2026-10-04 gate's other
  findings are folded into the body above (the cause, options 1 and 2) and were
  reproduced: `git grep -c "onRequest" origin/main --
'tools/*/api/src/routes/*.ts'` lists 10 route files, and `git grep -n "addHook"
origin/main -- tools packages` lists seven calls, none a limiter (CORS in all
  three servers' `registerCors`, request logging, identity, `onSend`).
