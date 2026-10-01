---
id: lg-3
tool: ledger
title: Verify the Cloudflare Access token on every request
kind: work-package
status: ready
milestone: P2
depends_on: []
difficulty: hard
---

# lg-3 — Verify the Cloudflare Access token on every request

## Why

Who did something — whose receipt this is, who classified a row — is the Access
identity, and the tool has no login of its own
([00-ANALYSIS.md §7](../00-ANALYSIS.md)). Reading the plain email header would
trust anything that reaches the origin, and the loopback port reaches it without
passing through Access.

## Build

1. Verify `Cf-Access-Jwt-Assertion` on every route except `/api/health`:
   - the signature, against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`);
   - the audience, which is the application's AUD tag;
   - the expiry.
     The team name and the AUD tag are configuration, read in `api/src/config.ts`
     only.
2. **Map email to person in configuration**, never in a table seeded from the
   repository. An address the configuration does not know gets a 403. A request
   with a missing or invalid token gets a 401. _Superseded by decision A3
   below: it gets a 403, as `UNAUTHENTICATED`, still distinct from the
   unmapped address's `FORBIDDEN`._
3. **Cache the JWKS, and refresh it when a key id is unknown.** A request never
   makes an unbounded number of fetches. The fetch goes to a fixed host built
   from configuration, never from anything in the request.
4. **Development:** a configured fixed identity. The production image refuses
   to start when both that and a production mode are set.
5. **Never log the token or the header.** `logger.ts` already censors both; do
   not rely on that alone.
6. Expose the person on the request context for later tickets.

## Done when

1. A valid token, signed by a test key the test serves as JWKS, reaches a
   route as the mapped person.
2. Each of these gets a 401: a missing token, a token with a bad signature, one
   with the wrong audience, and an expired one. _Superseded by decision A3
   below: each gets a 403 with the code `UNAUTHENTICATED`._
3. A valid token for an unmapped email gets a 403.
4. `/api/health` answers without a token.
5. The development identity cannot be enabled in production mode; a config
   test proves it.
6. Gates green, the container-build workflow included.

## Decisions — answered 2026-10-01 by the owner at intake, not open

Both asked by the orchestrator through `AskUserQuestion`, each with the
orchestrator's recommendation first, and each answered with it.

**1. The question was:** lg-3's 401 and 403 have no error code anywhere — where
should they live? Options: add to `@webtools/core` / ledger-local in
`@ledger/contract` / the builder brings it back as options.

**The answer: add them to `@webtools/core`.** They describe the transport — who
is at the door — and not the ledger's domain; any tool behind an
identity-aware proxy has them.

**2. The question was**, asked after the orchestrator measured that the
downloader maps every `ErrorCode` exhaustively (`Record<ErrorCode, …>` in
`tools/downloader/api/src/http-errors.ts` and
`tools/downloader/web/src/lib/error-presentation.ts`), so a new core code forces
edits under `tools/downloader`, and release-please routes changelogs by path:
how should lg-3 land? Options: two PRs, `refactor(core)` first / one PR
accepting a downloader release / ledger-local codes instead.

**The answer: two PRs, `refactor(core)` first.** The first carries only the
codes and the entries every exhaustive map needs to compile; `refactor` is
`hidden` in `release-please-config.json`, so the downloader paths it touches cut
no release. The second, this ticket's build, is `feat(ledger)` stacked on it.

## Decisions after the first build — answered 2026-10-01 by the owner, not open

The builder's report carried five open decisions. The orchestrator checked their
premises first: Access covers the whole ledger hostname at the edge
(`scripts/cloudflare-setup.mjs:85 "extraEmailFlag"`), `.github/workflows/ledger.yml:97 "Accept: text/html"`
fetches `/` with no token,
and `registry.npmjs.org` answers 200 from the container. It then put four of
them to the owner through `AskUserQuestion`, numbered here as asked.

**A1. The question was:** keep `node:crypto`, or move to `jose`? **The answer:
keep `node:crypto`**, the orchestrator's recommendation.

**A2. The question was:** should the static UI sit behind the origin check?
Options: API only except health / everything except health. **The answer: API
only except health**, the orchestrator's recommendation.

**A3. The question was:** the brief says 401, but RFC 9110 requires
`WWW-Authenticate` on every 401 and Access has no standard scheme. What should
lg-3 answer? Options: 401 without the header / 401 with a custom scheme / 403
for both, like the downloader.

**The answer: 403 for both, like the downloader.** This overrode the
orchestrator's recommendation, which was 401 without the header. As the option
was put to the owner, `UNAUTHENTICATED` maps to 403: the two codes stay distinct,
and only the status changes. Branch 1 maps it to 403 in the downloader too, for
the same reason. **This supersedes the 401 in Build step 2 and Done-when 2**,
which are marked rather than rewritten.

**A4. The question was:** what should a production start with no Access settings
do? Options: start and refuse every API call / refuse to start. **The answer:
start and refuse**, the orchestrator's recommendation.

The fifth open decision was not put to the owner: the root-level deployment
edits riding in the `feat(ledger)` PR. They touch no other tool's path, so they
stay as built.

## Log

### 2026-10-01 — built, as two stacked branches (Opus 5.5 builder)

**Branch 1, `lg-3-core-auth-codes`** (`refactor(core)`, on `main` at `b7fb3fb`):
core gains `UNAUTHENTICATED` and `FORBIDDEN`, neither retryable, and the
downloader's two exhaustive maps gain entries: 401 and 403 in its status table,
and presentation copy that says plainly the downloader has no sign-in and raises
neither. The planner's and the ledger's status tables are `Partial`, so they
needed nothing there. `tools/downloader/web/test/mock-api.test.ts`'s coverage
test lists the pair as never raised there. Nothing raises either code on that
branch.

- **The names.** `FORBIDDEN` is HTTP's own reason phrase for 403, the same
  convention as core's `BAD_REQUEST` and `NOT_FOUND`. 401's phrase is
  "Unauthorized", which names the wrong failure — it is _authentication_ that
  failed — so the code is `UNAUTHENTICATED`, which is also what gRPC calls it.
  An `UNAUTHORIZED` would also have read too close to the downloader's own
  `AUTH_REQUIRED`, which is about a _source site_ wanting a session.
- **Not `HUMAN_CHECK_FAILED`**, the nearest core code: that one asks _whether_ a
  person is there, this asks _which_ person. The downloader maps that code to
  403 rather than 401 because a 401 must carry `WWW-Authenticate` (RFC 9110
  §15.5.2), and the ledger's 401 here sends none either: Access has no
  registered scheme to name, and §7 and this brief both say 401. A gate may
  want to weigh that.
- The test that checks every code has presentation copy failed before the copy
  existed. Before the build was rebuilt, it compared stale `dist` codes against
  the source table — `npx vitest run tools/downloader/web/test/error-presentation.test.ts`
  failed with `+ "FORBIDDEN"` and `+ "UNAUTHENTICATED"`. After `npm run build`:
  `14 passed (14)` files, `273 passed (273)` tests across the touched downloader,
  ledger and planner suites.
- `node scripts/preflight.mjs --base origin/main --title "refactor(core): add UNAUTHENTICATED and FORBIDDEN to the shared taxonomy (lg-3)"`
  → `preflight passed (exit 0)`, its title check reporting that `refactor` is
  hidden in `release-please-config.json`, so no changelog line. It reports 19
  moved citations in 12 records this branch does not change, and fails none of
  them. One of the 19 is caused by this branch: `dl-53`'s
  citation of line 296 in `error-presentation.ts`, which the new entries push
  down.

**Branch 2, `lg-3-verify-access-identity`** (`feat(ledger)`, on branch 1):

- **Verified with `node:crypto`, not a JWT library.** Nothing in the lockfile
  verifies JWTs. Adding one would have meant an `npm install` this worktree may
  not run, and a `package-lock.json` change that lg-1 may also touch. Access
  signs with RS256 only, so `api/src/access.ts` accepts that algorithm and
  nothing else, and checks it before looking up any key. That closes off
  `alg: none` and the HMAC-with-a-public-key confusion, which is the part of JWT
  a library mostly exists to negotiate. The signature check itself is Node's.
  Checked: signature, `aud` (a string or an array), `exp`, `nbf` when present,
  **and `iss`**, which the brief did not ask for. `iss` costs one comparison
  against the issuer the team name already fixes, and refuses a token minted
  for another team with the same audience.
- **The key set** comes from `https://<ACCESS_TEAM>.cloudflareaccess.com/cdn-cgi/access/certs`.
  `ACCESS_TEAM` must be a single DNS label, so its own value cannot steer the
  host anywhere else. The fetch refuses redirects and times out after 5 s. The
  set is cached for an hour, and refreshed sooner when a token names a key id
  the set lacks, which is how a rotation is picked up. Concurrent callers share
  one fetch, and no fetch starts within 30 s of the last attempt, so a flood of
  forged key ids costs one fetch per window. If the key endpoint fails, a key
  already held stays in use. A key never seen gets `UNREACHABLE` (502), not a
  401, because that failure is not the caller's.
- **Every token failure is one `UNAUTHENTICATED`**, carrying no details. The
  reason is logged as a `reason` field and never sent to the caller. An address
  that verifies but is not mapped gets `FORBIDDEN`, and the address is logged
  for the operator.
- **What the check covers is decided by the route the request matched**
  (`request.routeOptions.url`), not by the URL it arrived with. That turned out
  to matter. Measured with `inject`: `/%61pi/me` and `/api/%6de` both reach
  `GET /api/me`, and `//api/me` and `/api/me/` reach no route. With the hook
  mutated to read `request.url`, the test for this fails with
  `expected 401 to be 403`, because the request then reaches only `personOf`'s
  fail-closed fallback.
- **The UI's own files are not behind the check** — every API route but
  `/api/health` is. This is a reading of "every route", and the dispatch report
  carries it as an open decision. The bundle is this public repository's build
  output and holds no data. `ledger.yml` asks the image for `/` with no token,
  and gating the page would fail that step with nothing gained.
- **With no Access settings, the API still starts and refuses every API route
  but health**, logging a warning at boot. It does not refuse to start, so
  `ledger.yml`'s smoke run, which sets nothing, still passes.
  `compose.ledger.prod.yaml` refuses instead: it reads
  `LEDGER_ACCESS_{TEAM,AUD,PEOPLE}` with `:?`. Without that, the first release
  would have deployed as a ledger that refuses both people. Measured:
  `docker compose -f compose.prod.yaml -f compose.ledger.prod.yaml config` exits
  1 naming all three when they are unset, and renders them when they are set.
- **Development:** `DEV_IDENTITY=<address>`, which must be in `ACCESS_PEOPLE`.
  `loadApiConfig` refuses it when `NODE_ENV=production`, after the overrides
  are applied, so a test cannot build a configuration the process would refuse.
- **For later tickets:** `GET /api/me` is the first route behind the check, and
  `Person` and `MeResponse` are new in `@ledger/contract`. A route reads the
  caller with `personOf(request)`, which throws `UNAUTHENTICATED` rather than
  hand back `null`. `person.id` is the configured name that lg-5's `people`
  table can key on.
- **Folded in:** `docs/02-DEPLOYMENT.md` still said "how the API reads and checks
  it is still to be designed", which became false with this branch.
  `.env.prod.example` and `tools/ledger/.env.example` gain the new settings.
- `npx vitest run --project ledger` → `7 passed (7)` files, `53 passed (53)`
  tests, 28 of them new in `api/test/access.test.ts` and
  `api/test/config-access.test.ts`. Each guarding check was mutated to prove its
  test can fail:
  - Removing the signature, audience, expiry and algorithm checks together
    failed 6 of 20 access tests.
  - Setting the refetch floor to 0 failed the flood test with
    `expected … to have a length of 2 but got 3`.
  - Disabling the production refusal failed both config tests that cover it.
- **The container itself was not built:** this sandbox has no Docker daemon.
  Instead, the built `dist` was run the way the image runs it (`NODE_ENV=production`,
  `WEB_DIR` set, nothing else). Health answered `200`, `/` with `Accept: text/html`
  served `<div id="root">`, and `/api/me` answered `401`. The same run with
  `DEV_IDENTITY` set exited 1 with `"msg":"failed to start"` and
  `DEV_IDENTITY is set in production mode`. Done-when 6's container leg is
  `ledger.yml` on the pull request.

### 2026-10-01 — UNAUTHENTICATED answers 403 (decision A3) (Opus 5.5 builder)

The entry above says 401 for the token failures. That was the brief's status
until decision A3, and is now 403, carried by `UNAUTHENTICATED`. FORBIDDEN
stays the unmapped address's code.

- **Branch 1** gains a commit mapping `UNAUTHENTICATED` to 403 in
  `tools/downloader/api/src/http-errors.ts`. The owner's reason is the one
  that table already gives for `HUMAN_CHECK_FAILED`, and nothing in the
  downloader argues otherwise: it raises neither code. Core's doc comment
  now says every tool here answers 403. Branch 2 is rebased onto it.
- **Branch 2:** `tools/ledger/api/src/http-errors.ts` maps it to 403, and
  every 401 expectation in `api/test/access.test.ts` is now 403. The test
  that proves the hook runs on a path spelled another way told the two
  failures apart by status. It now tells them apart by code. Re-proved by
  mutating the hook to read `request.url`, which fails it with
  `expected { code: 'UNAUTHENTICATED', … } to deeply equal { code: 'FORBIDDEN', … }`.
- `npx vitest run --project ledger` → `7 passed (7)` files, `53 passed (53)`
  tests.
