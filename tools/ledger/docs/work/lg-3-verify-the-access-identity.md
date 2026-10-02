---
id: lg-3
tool: ledger
title: Verify the Cloudflare Access token on every request
kind: work-package
status: done
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

## Decisions after gate 1 — answered 2026-10-02 by the owner, not open

Gate 1 found four points that needed an owner's answer. The orchestrator
checked two premises first: `config.ts` compared `env["NODE_ENV"] ===
"production"`, and no ledger ticket at `b7fb3fb` named a `/me` route. It then
put all four to the owner through `AskUserQuestion`. They are labelled here by
the gate's finding numbers.

**F2. The question was:** how should the dev-identity production guard work?
Options: invert it, accepting `DEV_IDENTITY` only when `NODE_ENV` is unset,
`development` or `test` / normalise `NODE_ENV` (trim, lower-case) before
comparing. **The answer: normalise `NODE_ENV`.** This overrode both the gate's
recommendation and the orchestrator's, which were to invert it.

**F3. The question was:** keep `GET /api/me`, `ROUTES.me`, `Person` and
`MeResponse` in the contract? Options: keep as built / a probe route in tests
only / the route stays and the types move to the API package. **The answer:
keep as built**, the gate's and the orchestrator's recommendation.

**F4. The question was:** cap how long a stale key set may be used while the
key endpoint is down? Options: cap at about a day / leave it unbounded. **The
answer: cap at about a day**, the gate's and the orchestrator's
recommendation. After about 24 hours without a successful refresh, requests are
refused rather than checked against the old keys.

**F7. The question was:** answer 403 before 404 under `/api/`? Options: leave
it / 403 before 404. **The answer: leave it**, the gate's and the
orchestrator's recommendation. A path under `/api/` that matches no route still
gets the typed 404, which tells an unauthenticated caller nothing the public
repository does not.

## Review

**Gate: CONCERNS** — 2026-10-02 · branch 1 `b7fb3fb...dc4bd12` (`refactor(core)`) and branch 2 `dc4bd12...736aa7a` (`feat(ledger)`), gated together at tip `736aa7a` · code-review at medium, run by hand · `origin/main` was still `b7fb3fb` at the last fetch

Acceptance is read with owner decision 5 applied: a missing or invalid token and an unmapped address both answer 403, the codes staying `UNAUTHENTICATED` and `FORBIDDEN`. The brief's 401 in Build 2 and Done-when 2 is superseded and is not what was graded. Re-issued at gate 2 and re-resolved against `4b9ae7b`, branch 2 tip after the fix round (branch 1 is `bfdac13`); citations into content these branches introduce are unpinned and resolve there. Twelve citations whose text the round deleted, or whose claim it corrected though some anchors survive, are prose naming the sha this section gated (`736aa7a` for branch 2, `dc4bd12` for the branch 1 sentence in F9), in F1, F2, F4, F5, F6, F8 and F9; the verdicts and rows are unchanged, and row 5's first citation takes a different anchor because the round's own test repeats the old one. The 95-token matrix, the route sweep and the revoked-key timeline were run from a harness in the gate scratch directory, driving the real `createApp`.

| Done when                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. A valid token, signed by a test key the test serves as JWKS, reaches a route as the mapped person                                               | `tools/ledger/api/test/access.test.ts:92 "email: ALEX } });"` — proven. The test serves its own key set (`tools/ledger/api/test/helpers/access.ts:103 "Response.json({ keys: keys().map"`) and asserts the one URL fetched (`tools/ledger/api/test/access.test.ts:94 "expect(harness.urls).toEqual([JWKS_URL])"`). Also sent over a real listening socket: 200 with the mapped person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2. A missing token, a bad signature, the wrong audience and an expired token each get a 401 — superseded by decision 5: 403 with `UNAUTHENTICATED` | Proven as 403. The shared assertion asserts status, code, the taxonomy sentence and `retryable: false` (`tools/ledger/api/test/access.test.ts:74-82 "const { error } = response.json<ErrorResponse>()"`); then missing (`tools/ledger/api/test/access.test.ts:113 "expectRefused(await me(harness),"`), bad signature (`tools/ledger/api/test/access.test.ts:120 "me(harness, forged)"`), wrong audience (`tools/ledger/api/test/access.test.ts:128 "some-other-application"`) and expired (`tools/ledger/api/test/access.test.ts:135 "nowSec() - 7200"`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3. A valid token for an unmapped email gets a 403                                                                                                  | `tools/ledger/api/test/access.test.ts:140-144 "a valid token for an address the configuration does not know"` — proven; the assertion in that test is `FORBIDDEN` with 403.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4. `/api/health` answers without a token                                                                                                           | `tools/ledger/api/test/access.test.ts:146-154 "answers without a token, and fetches no keys"` — proven. Also 200 with no token and no Access settings against the built `dist` started in production mode, and for `HEAD` through `inject`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. The development identity cannot be enabled in production mode; a config test proves it                                                          | `tools/ledger/api/test/config-access.test.ts:58 "refusal({ ...env, NODE_ENV:"` and `tools/ledger/api/test/config-access.test.ts:65-78 "and the app built from that configuration refuses to start"` — proven for `NODE_ENV=production` spelled exactly so, and built `dist` exits 1 with `failed to start` when given it. **Not proven for any other spelling of the variable** — F2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6. Gates green, the container-build workflow included                                                                                              | **Verified**: `npm run check` and `npm test` pass at both heads (preflight check 1, exit 0 each); `npm test` at `736aa7a` is 192 files passed, 1 skipped (193) and 3571 tests passed, 2 skipped (3573); the ledger project is 7 files and 53 tests, against 5 files and 25 tests with the two new specs excluded. The two new ledger spec files and one helper add 558 lines and delete none; the two downloader test files gain 20 lines and delete none: one new test in `routes.test.ts`, and 5 lines inside the existing coverage test in `mock-api.test.ts` that add the two codes to its never-raised allow-list, which widens that test and weakens nothing. **Container leg unproven (gate)**: `.github/workflows/ledger.yml@b7fb3fb:97 "Accept: text/html"` is the step that would run, and this container has no Docker daemon. Substituted, not equivalent: the built `dist` started as the image starts it (`NODE_ENV=production`, `WEB_DIR` set, nothing else) answered health 200, `/` with `Accept: text/html` 200 and `/api/me` 403, and `docker compose config` (client only) exits 1 naming all three `LEDGER_ACCESS_*` variables when unset, exits 0 when set, and renders neither `NODE_ENV` nor `DEV_IDENTITY`. |

- **med** · (F1) A key Cloudflare has dropped is still trusted for one burst of requests after the hour. the fallback `return this.#keys.get(kid) ?? cached` in `JwksCache.key` at `736aa7a` falls back to the key held before the refresh even when the refresh succeeded and the new set lacks it, so the comment on `JWKS_MAX_AGE_MS` at `736aa7a` (an hour bounds how long a key Cloudflare revoked) is false by that burst. Reproduced: key cached, upstream set changed to drop it, clock moved 61 minutes, the next token signed by that key got 200, five concurrent ones all got 200, the one after got 403. Nothing in `access.test.ts` exercises the one-hour age. A three-line change, measured, closes it and leaves the 28 specs green: remember whether the awaited refresh completed, and fall back to the held key only when it did not.
- **med** · (F2) The production guard is a literal match: the `production` field of `loadApiConfig` at `736aa7a` (`overrides.production ?? env[NODE_ENV] === production`) is true only for the exact lowercase word. Measured over 13 `NODE_ENV` values, `DEV_IDENTITY` was refused for one (`production`) and accepted for the other twelve, `Production`, `PRODUCTION`, a padded ` production` and `production ` among them; `overrides.production: false` also beats `NODE_ENV=production`. The shipped image sets the lowercase word and the rendered compose overlay passes neither `NODE_ENV` nor `DEV_IDENTITY`, so nothing reachable today spells it wrong; that is why this is med and not high. **Open decision**: (a) normalise `NODE_ENV` (trim, lower-case) before comparing; (b) invert the guard so the identity is accepted only when `NODE_ENV` is unset, `development` or `test`, which fails closed for any spelling and for any environment name added later. Recommend (b).
- **med** · (F3) A public route and two contract types the brief does not name. `tools/ledger/contract/src/api.ts:33 "export interface Person {"` and `tools/ledger/api/src/routes/me.ts:15 "app.get(ROUTES.me"` add `GET /api/me`, `ROUTES.me`, `Person` and `MeResponse`; Build 6 asks only for the person on the request context and Done-when 1 only for a route a valid token reaches, and no ledger ticket at the base names a `/me` route. The Log records the addition without a decision, and none of the six owner decisions covers it — a contract-adjacent change that the repo's own rule says is not settled unilaterally. **Open decision**: (a) keep as built and tell the owner; (b) keep `Person` in the contract but register the probe route only in the test; (c) keep the route and move `Person` into the API package. Recommend (a): it is additive, it is the smallest honest route behind the check, and the UI needs exactly this; (b) rewrites 15 tests.
- **low** · (F4) A key-set outage is blamed on the caller after the first request. the rethrow in `JwksCache.key` at `736aa7a` (`if (cached === undefined) throw error`) rethrows only for the request that made the fetch; with nothing cached, the next request inside the 30 second floor finds no key and answers 403 `UNAUTHENTICATED`. Measured over eight failure shapes (fetch throws, 503, HTML, `{}`, empty `keys`, `keys` not an array, `null`, a redirect): the first request 502 `UNREACHABLE`, a second at the same instant 403 `UNAUTHENTICATED`, which the code comment there (a key already held stays usable through an outage) and the test `tools/ledger/api/test/access.test.ts:266 "an unreachable key endpoint is not reported as"` promise otherwise, and the test asserts only the first request. The 502 body also hands a caller who proved nothing the upstream status (`details` `status` 503 from `details: { status: response.status }` at `736aa7a`) and, for an empty set, the sentence about the key set holding no usable key at `736aa7a`. It fails closed in every shape. **Open decision on a second point**: a key already held is used for as long as the outage lasts (measured: still accepted 27 hours on), so with F1 the only revocation bound is the hour while the endpoint is up and none while it is down; (a) leave it, which favours availability; (b) cap how long a stale key set may be used, say a day. Recommend (b).
- **low** · (F5) Two guards the builder added have no test. The redirect refusal (the comment on the redirect option at `736aa7a`) and the five second timeout (`signal: AbortSignal.timeout(JWKS_TIMEOUT_MS)` at `736aa7a`) can each be deleted with the two ledger specs staying 28 of 28. Both work when exercised by hand: the fetch is called with `redirect: "error"` and a signal, and a hung endpoint answers 502 after 5001 ms. Also unexercised: the one-hour age and the stale-key fallback (F1), a token with no `kid`, and a real HMAC forgery — `tools/ledger/api/test/access.test.ts:162 "const hmac = signToken("` signs an HS256-labelled token with the RSA private key, which proves the label is refused (the pin) and forges nothing.
- **low** · (F6) `nbf` is enforced with no clock leeway. the `nbf` check in `access.ts` at `736aa7a` (`if (nbf !== undefined`) refuses a token whose `nbf` is one second ahead of the origin clock (measured: 403 `not-yet-valid` at +1 s, 200 at +0 s). Access stamps `nbf` equal to `iat` — the test helper copies that at `tools/ledger/api/test/helpers/access.ts:76 "nbf: nowSec"` — so an origin clock slightly behind Cloudflare's turns a fresh sign-in into a transient 403. The shape of a real Access token is from recollection, not verified here: WebFetch is blocked in this container. Remedy: a leeway of a few seconds on `nbf` only.
- **low** · (F7) A 404 tells an unauthenticated caller which API routes exist. The hook keys on the matched route (`tools/ledger/api/src/identity.ts:39 "const route = request.routeOptions.url"`), so a path that matches no route never meets it and reaches `tools/ledger/api/src/server.ts:159 "function registerNotFoundHandler"`. Measured over 32 method and path pairs, with and without a token, headless and with `WEB_DIR` set: `GET` and `HEAD /api/me` 403; `POST`, `PUT`, `DELETE`, `PATCH` and `OPTIONS /api/me`, `/API/me`, `/api/nope` and `/api/me/` 404; `/%61pi/me`, `/api/%6de`, `/api/./me`, `/api/%2e%2e/api/me` and `/api/me?x=1` reach the route and are checked; `/api/me/`, `/api//me`, `/api/me%2F` and `/api/me;x=1` reach none. Nothing leaks that the public repository does not already say. **Open decision**: (a) leave it; (b) answer 403 before 404 for any URL path under `/api/`, at the cost of a typo in an API path reading as an identity failure. Recommend (a).
- **low** · (F8) The signature segment is decoded leniently. the decode `Buffer.from(encodedSignature,` in `access.ts` at `736aa7a` accepts a valid signature with `!!!` appended, a space inserted, `=` padding, or the standard `+/` alphabet in place of `-_` (measured: all 200). Not a bypass — the signed bytes are the literal header and payload segments, and a tampered one fails — but the token string is no longer canonical, which matters the day anything keys on the string (a replay cache, a revocation list). Remedy: refuse a segment with a character outside `A-Z a-z 0-9 - _`.
- **low** · (F9) Branch 1: the sentence `Answered with a 403 by every tool here` in `packages/core/src/errors.ts` at `dc4bd12` is wrong for the planner, whose status table is `Partial` and falls back to 500 (`tools/planner/api/src/http-errors.ts@b7fb3fb:12 "const STATUS_BY_CODE: Partial<Record<ErrorCode, number>>"`); measured, the planner answers 500 for both codes. It raises neither, so nothing is wrong at runtime, the sentence is. Remedy: name the downloader and the ledger, or give the planner the two lines its own comment says an unraised code deserves.
- **branch 1 on its own** · only codes, their messages, the two maps that must list them, and tests: `b7fb3fb...dc4bd12` is 5 files, 86 insertions, 0 deletions — core's code list and message map, the downloader's status table and presentation table, one api test and one web coverage entry (the planner's and the ledger's status tables are `Partial` and needed nothing). The downloader copy is honest that it raises neither code (`tools/downloader/web/src/lib/error-presentation.ts:101 "This service has no sign-in of its own, so this page does not know how to answer"` and `tools/downloader/web/src/lib/error-presentation.ts:108 "This service has no accounts of its own"`), and `tools/downloader/api/src/http-errors.ts:36 "UNAUTHENTICATED: 403"` carries the 403 decision. `node scripts/preflight.mjs --base origin/main --title "refactor(core): add UNAUTHENTICATED and FORBIDDEN to the shared taxonomy (lg-3)"` at `dc4bd12`: exit 0, its title check reporting `"refactor" is hidden in release-please-config.json — no changelog line either way`, its `npm run check` and `npm test` ok, and a clean merge-tree probe against #330, #294 and #284. It reports 19 moved citations in 12 records the branch does not change, a displaced `dl-53` citation among them: reported, not failed.
- **branch 2 preflight** · `node scripts/preflight.mjs --base origin/lg-3-core-auth-codes --title "feat(ledger): verify the Cloudflare Access token on every API request (lg-3)"` at `736aa7a`: exit 0, title check `type and paths agree`, check 1 ok including `npm test -- --project ledger`, merge-tree clean against #294 and #284. #330 (lg-1) was not open when it ran, so `git merge-tree --write-tree 736aa7a origin/lg-1-parse-accesd-paste` was run by hand: exit 0, a tree and no conflicts.
- **mutations** · control: the two ledger specs, 28 of 28. Each removed alone, each failing on an assertion and none at load: signature check 2 failed, audience check 2, expiry check 1, algorithm pin 1 (`expected 200 to be 403` on the HS256-labelled token; the alg-none half of that test is still refused by the signature check, so the pin is defence in depth), route-based gating swapped for `request.url` 1 (`expected { code: 'UNAUTHENTICATED', … } to deeply equal { code: 'FORBIDDEN', … }`; not a bypass, because `personOf` fails closed — only the code differs), issuer check 1. Two survive: the redirect refusal and the timeout (F5). The Log's "6 of 20" for the first four together equals the 2+2+1+1 measured separately.
- **method** · the verifier was driven through the real `createApp` and `inject` with a fake key-set fetch, plus a real socket for a duplicated header: 95 token variants (algorithm 17, `kid` and key-set shape 13, `aud` 9, `iss` 5, time claims 15, email 9, payload shapes 6, encodings 21), 8 carrier variants, 9 key-set failure shapes, 128 route requests, a 1000-token flood, a hung endpoint, a concurrent cold start and the revoked-key timeline. Every refusal not listed above is a 403 `UNAUTHENTICATED` or `FORBIDDEN`, and nothing was accepted that should not be bar F1, F2 and F8. Carriers: only `Cf-Access-Jwt-Assertion` is read; the `CF_Authorization` cookie alone, `Authorization: Bearer` and the plain `Cf-Access-Authenticated-User-Email` header are all refused, a valid header beside a garbage cookie is accepted, and two header lines (joined by Node) are refused. That the header is the carrier Access sends to the origin is from recollection and **unverified** here (WebFetch is blocked). **Not done**: no container build, no live Cloudflare, no ledger e2e (the ledger has no spec yet), and the 404-versus-403 behaviour and the response bodies were read from `inject`, not from a tunnel.
- **dropped** · four candidates, one mechanism: duplicate JSON keys in a signed payload (last wins), an email that folds to a mapped one under `toLowerCase` (U+212A KELVIN SIGN to `k`), `exp` of `1e20` or a future `iat`, and a 512-bit or one-byte-modulus RSA key accepted into the key set. Each needs Access's signing key or control of the fixed key-set host, which is what the check trusts; none is a bypass.
- **dropped** · two candidates, both owner decisions: a file under `WEB_DIR/api/` would be served with no token (the static wildcard is the matched route, decision 4), and `DEV_IDENTITY` overrides a real Access configuration outside production (brief Build 4, warned at boot). With `WEB_DIR` set, a browser's `Accept: text/html` on a path matching no route gets `index.html`, as decision 4 intends.
- **dropped** · two candidates, neither this branch's to fix: the error handler logs `request.url` unredacted (`tools/ledger/api/src/server.ts@b7fb3fb:118 "url: request.url"` is pre-existing and the ledger's API has no signed URLs; no new line logs a header, a cookie or a token, and `redactHeaders` is not called because no header is logged), and branch 1 displaces `dl-53`'s citation, which preflight reports and does not fail.
- **findings** · code-review at medium, run by hand (the role page forbids dispatching finders): 17 candidates, 9 carried (F1 to F9), 8 dropped in the three bullets above.
- NFR: security — F1, F2, F7 and F8; otherwise every forgery tried was refused (alg none and a missing alg, HS256 keyed with the public key as PEM, DER and the JWK `n`, PSS, RS384, RS512, a sha384 or sha1 signature under an RS256 label, the other key's `kid`, no `kid`, an unknown `kid`, an embedded `jwk`, `jku` and `x5u`, a wrong or missing `aud` or `iss`, expired, not yet valid, a tampered payload) and no log line carried a token, header, cookie or signature (8 lines read, over requests that included a token in the query string) · performance ✓ — 1000 unknown key ids cost 1 fetch at a fixed clock and 34 over 1000 simulated seconds, 500 concurrent cost 1, and 20 concurrent cold-cache valid tokens share 1 fetch · reliability — F4 and F6 · maintainability — F5; the Log's first entry still says the dist run answered 401, and says a never-seen key gets a 502 because that failure is not the caller to blame, which F4 shows holds for the first request of each 30 second window only; the later entry corrects the status only.

### Gate 2

**Gate: CONCERNS** — 2026-10-02 · branch 1 `dc4bd12..bfdac13` and branch 2 `54278d2..4b9ae7b` (`git range-diff dc4bd12..736aa7a bfdac13..4b9ae7b`: the first two commits unchanged, one added, `4b9ae7b`) · gated at tip `4b9ae7b` · code-review at medium, scoped to the lines the round touched · `origin/main` still `b7fb3fb` · CONCERNS only because the container leg of Done-when 6 is still **unproven (gate)**; nothing med or high remains

Owner answers applied this round: F2 normalise `NODE_ENV` (overriding the gate's recommendation to invert the guard), F3 keep `GET /api/me` and its types, F4 second point cap stale-key use at about a day, F7 leave the 404. Every verdict below was measured against a rebuilt `dist` at the head it names, not read off the builder's Log. Citations resolve at `4b9ae7b`; the round appended its tests below every line gate 1 cited, so those did not move.

| Finding                                                                          | Verdict                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 med: a dropped key trusted for one burst after the hour                       | **fixed**                                                           | A successful refresh is now the whole answer (`tools/ledger/api/src/access.ts:181 "return this.#keys.get(kid);"`). Test `tools/ledger/api/test/access.test.ts:348 "a key Cloudflare dropped is refused once the hour is up"` sends five concurrent tokens after 61 minutes and gets five 403 with two fetches. Gate 1's timeline, re-run: 61 minutes 403, the five-token burst 403, the replacement key 200. Restoring `?? cached` fails that test (`expected 200 to be 403`); the pre-round `access.ts` swapped back in fails 6 of the 29 access specs, this one among them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F2 med: the production guard matched one spelling                                | **fixed per the owner's decision (a), which overrode gate 1's (b)** | `tools/ledger/api/src/config.ts:117 "function isProduction"` trims and lower-cases. Measured over the same 13 `NODE_ENV` values: `production`, `Production`, `PRODUCTION`, ` production` and `production ` refuse the development identity; `prod`, `prd`, `live`, `staging`, `development`, `test`, empty and unset do not, which is decision (a) as taken. Test `tools/ledger/api/test/config-access.test.ts:117 "refuses the development identity for any spelling of production"`; the literal comparison put back fails it. **The builder's note, judged: `overrides.production` still beating the environment does not matter.** `createApp` has one caller outside the tests, and it passes nothing (`tools/ledger/api/src/main.ts@b7fb3fb:16 "const app = await createApp();"`), so a running process cannot be handed an override; an embedder that can pass `production: false` can equally pass `access.devIdentity` and every other field, and already owns the process.                                                                                                                                                                                                                                                          |
| F3 med: `/api/me`, `Person` and `MeResponse` unrequested                         | **closed by decision**                                              | The owner kept them as built, and the ticket records it under its decisions after gate 1. The round touches neither `tools/ledger/contract` nor `tools/ledger/api/src/routes/me.ts` (`git diff --stat 54278d2 4b9ae7b` lists five files, none of them those).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F4 low: an outage blamed on the caller, details in the 502, unbounded stale keys | **fixed, both points**                                              | First point: `tools/ledger/api/src/access.ts:202 "if (this.#lastAttemptFailed) throw"` answers every caller in the window, not only the one that fetched; tests `tools/ledger/api/test/access.test.ts:366 "with nothing cached and the endpoint down"` and `tools/ledger/api/test/access.test.ts:376 "a key set with no usable key is the endpoint"`. The eight failure shapes re-run: the first and the second request at the same instant are both 502 `UNREACHABLE`, and the body is the code, the default sentence and `retryable: true`, with no `details`. The reason, the status and the error name go to the log only; four shapes read, none carried the token, the URL or the error message. Second point: `tools/ledger/api/src/access.ts:195 "JWKS_STALE_LIMIT_MS) return held"` with `tools/ledger/api/src/access.ts:63 "const JWKS_STALE_LIMIT_MS"`; test `tools/ledger/api/test/access.test.ts:381 "a held key outlives an outage of the key endpoint by a day"`. Measured: 3 hours into an outage 200, 24 hours less a second 200, 24 hours and a second 502, 27 hours 502, and the first successful refresh ends it. Removing the cap, raising it to 30 hours and removing the never-seen-key branch each fail an assertion. |
| F5 low: two guards untested                                                      | **fixed differently; one residue, N1**                              | The redirect and the signal are now asserted (`tools/ledger/api/test/access.test.ts:409 "is fetched refusing redirects, with a deadline"`): removing either fails it. The deadline value is not pinned (N1). A token with no key id has a test (`tools/ledger/api/test/access.test.ts:428 "a token with no key id is a 403"`), and so does a real HMAC forgery (`tools/ledger/api/test/access.test.ts:435 "an HMAC forgery keyed with the published public key"`), judged below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F6 low: no `nbf` leeway                                                          | **fixed**                                                           | `tools/ledger/api/src/access.ts:71 "const NBF_LEEWAY_SEC = 10"` and `tools/ledger/api/src/access.ts:345 "nowSec + NBF_LEEWAY_SEC < nbf"`; test `tools/ledger/api/test/access.test.ts:449 "a not-before a few seconds ahead of this clock"`. Measured at the edge: `nbf` of now+9 and now+10 are 200, now+11 and now+600 are 403, and `exp` still has none (equal to now is 403). Leeway of 0 and of 3600 each fail the test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F7 low: a 404 shows which routes exist                                           | **closed by decision**                                              | Left as is by the owner. The 128-request route sweep re-run is identical to gate 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F8 low: lenient signature decoding                                               | **fixed**                                                           | `tools/ledger/api/src/access.ts:313 "!parts.every((part) => SEGMENT.test(part))"` with `tools/ledger/api/src/access.ts:79 "const SEGMENT"` checks all three segments; test `tools/ledger/api/test/access.test.ts:460 "a valid token written any other way is refused"`. Re-run: `!!!` appended, a space inserted, `=` padding, the standard alphabet, and leading or trailing whitespace are each 403 `malformed` with no key fetch (they were 200 or 403 `signature` with a fetch). Removing the check fails the test. A real client is unaffected: a header value is trimmed before it reaches the code, and Access signs unpadded base64url.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F9 low, branch 1: the core comment said every tool                               | **fixed**                                                           | `packages/core/src/errors.ts:109 "Answered with a 403, never a 401, by the ledger and the downloader"` now names the two and says the planner maps neither and would answer 500; re-measured at this tip, the planner answers 500 for both codes, so the sentence is true. Branch 1 `dc4bd12..bfdac13` is that comment and nothing else (1 file, 7 insertions, 5 deletions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

- **low** · (N1, new, in a line this round added) The test named `tools/ledger/api/test/access.test.ts:409 "is fetched refusing redirects, with a deadline"` asserts that a signal is present, not that it carries a deadline: with `tools/ledger/api/src/access.ts:54 "const JWKS_TIMEOUT_MS = 5000"` raised to 5,000,000 the two ledger specs stay 39 of 39, so the five second bound is unpinned and the title says more than the assertion. The builder disclosed this. The behaviour is right when measured by hand: a hung key endpoint answers 502 `UNREACHABLE` after 5002 ms, and 20 concurrent callers on a cold cache share one fetch. **Open decision**: (a) rename the test to say it checks the redirect option and a signal, and leave the constant, which is one visible line; (b) inject the timeout as `fetch` and `now` already are, and test a hung fetch at 50 ms. Recommend (a): (b) adds a configuration seam to production code for one assertion.
- **builder limits, judged** · (1) The timeout test checks presence, not firing at 5 s: a real limit, recorded as N1 and nothing more, because the fire is measured above. (2) The HMAC test passing without the algorithm pin: true, and it does not make the test weak. Removing the pin alone fails only the older label test (`expected 200 to be 403`). Reintroducing the vulnerability itself — no pin, and an HS256 branch that keys an HMAC with the published public key — fails only the new HMAC test (`expected 200 to be 403`) and leaves the older one green, so the two are complementary, each catching what the other cannot, and the new one catches the confusion it is named for.
- **re-run, whole matrix** · the 95 token variants against the new build: 17 algorithm, 13 `kid` and key-set shape, 9 `aud`, 5 `iss`, 15 time, 9 email and 6 payload rows are unchanged except `nbf` of now+1 (403 to 200, F6); of the 21 encoding rows, `!!!`, an inserted space, the standard alphabet, `==` padding, a trailing space and a trailing newline went from accepted to 403 `malformed`, and padded segments, an empty signature and a leading space stay 403 under a different reason with no fetch (F8). The 8 carrier variants, the 128 route requests, the 1000-token flood (1 fetch at a fixed clock, 34 over 1000 simulated seconds, 1 for 500 concurrent), the hung endpoint and the cold-start concurrency are identical to gate 1. From seed states the round tests do not start from: a refresh failing for an unknown key id from a fresh set (the unknown id is 502 while a known id stays 200, and the unknown id is 403 once the endpoint is back), a cold start with the endpoint down recovering 31 seconds later (200), an outage ending with the held key dropped (403, replacement 200), 300 unknown key ids one per second through an outage (all 502, 10 fetches, so the 30 second floor holds), and 20 concurrent callers on a cold cache with a slow failing endpoint (one fetch, all 502).
- **side effect, not a finding** · during an outage every never-seen key id now answers 502 rather than 403, so an unauthenticated caller can tell that the key endpoint is failing. That is F4 as the owner decided it; the 502 body says only that the site could not be reached.
- **mutations** · control 39 of 39 for the two ledger specs, 64 of 64 for the ledger project. Each of these fails on an assertion and none at load: the round's own guards (the `?? cached` fallback restored, the 24 hour cap removed, the cap set to 30 hours, the never-seen-key outage branch removed, the segment check removed, `nbf` leeway 0 and 3600, the literal `NODE_ENV` compare, the redirect option removed, the signal removed) and gate 1's five again (signature 2 failed, audience 2, expiry 1, route-based gating 1, issuer 1) plus the algorithm pin (1). The deadline value survives (N1). Reproduced in the Log: the pre-round `access.ts` fails 6 of the 29 access specs.
- **preflight** · `node scripts/preflight.mjs --base origin/main --title "refactor(core): add UNAUTHENTICATED and FORBIDDEN to the shared taxonomy (lg-3)"` at `bfdac13`: exit 0, title check `"refactor" is hidden in release-please-config.json — no changelog line either way`, `npm run check` and `npm test` ok, merge probe clean against #330, #294 and #284. `node scripts/preflight.mjs --base origin/lg-3-core-auth-codes --title "feat(ledger): verify the Cloudflare Access token on every API request (lg-3)"` at `4b9ae7b`: exit 0, `type and paths agree`, `npm run check` and `npm test -- --project ledger` ok, merge probe clean against #330, #294 and #284 (the scratch merge with #330 reports 21 moved citations in 14 records the branch does not change, reported and not failed). Both runs report the same 19 moved citations in 12 records that gate 1 saw.
- **did not** · re-sweep what gate 1 settled beyond the matrix above; build or run the container (still no Docker daemon, so Done-when 6 stays **unproven (gate)** as in gate 1); reach Cloudflare or read a real Access token; run `review-record.mjs --verify` against a committed record (nothing is committed here).
- **findings** · code-review at medium over the round's lines, run by hand: 4 candidates, 1 carried (N1), 3 dropped — the 502 an unauthenticated caller sees during an outage (the side effect above, by decision), `prod`, `prd`, `live` and `staging` still not counting as production (decision (a)), and the HMAC test importing `node:crypto` inside the test body rather than at the top (style, and `npm run check` passes).
- NFR: security ✓ — F1 and F8 closed and every forgery from gate 1 still refused, the new log lines carry no token, header, cookie, URL or error text · performance ✓ — fetch cost unchanged, and malformed tokens no longer cost a key fetch · reliability ✓ — a cold start and an outage both recover on the next successful refresh, bounded by the 24 hour cap · maintainability — N1.

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

### 2026-10-02 — gate 1's round fixed (Opus 5.5 builder)

Each finding was reproduced before it was fixed. The reproduction was a
throwaway spec, written fresh rather than taken from the gate's harness, run
against the tip the gate reviewed, after a rebuild:

- F1: the dropped key still got `200` after 61 minutes.
- F2: `"production"` was refused, while `"Production"`, `"PRODUCTION"`,
  `" production"` and `"production "` were all accepted.
- F4: the first request got `502` with `"details":{"status":503}`, and the
  second got `403`. A key held 27 hours into an outage still got `200`.
- F6: `nbf` one second ahead got `403`.
- F8: a valid token with `!!!` appended got `200`.

The same spec after the fixes printed `403`, all five spellings refused,
`502` and `502` with no `details`, `502`, `200` and `403`. No finding was
refuted.

- **F1, fixed.** When a refresh succeeds, the new set is now the whole answer
  (`tools/ledger/api/src/access.ts`, `JwksCache.key`). The held key stands in
  only when no refresh succeeded.
- **F2, fixed per the owner's answer:** `isProduction` trims and lower-cases
  `NODE_ENV`. One part of the finding is left as it was: `overrides.production`
  still beats the environment. That is how every field of `loadApiConfig`'s
  overrides works, and the overrides reach only tests and embedders, never the
  environment of a running process.
- **F3, kept as built**, per the owner.
- **F4, fixed.**
  - While the last fetch failed, a key never seen answers `UNREACHABLE` for
    every caller in the window, not only the one that made the fetch.
  - A held key is trusted for at most 24 hours without a successful refresh,
    per the owner's answer. After that, requests answer `UNREACHABLE`.
  - The 502 body no longer carries the upstream's status, and no longer says
    the key set "held no usable key". The reason is logged instead.
- **F5, fixed.** New tests cover:
  - the fetch being made with `redirect: "error"` and an `AbortSignal`;
  - a token with no `kid`;
  - a real HMAC forgery keyed with the published public key's PEM.

  These guard against deletion rather than a live defect. With
  `redirect: "error"` removed, the new test fails, and the same holds with the
  signal removed. **The test checks that a signal is present, not that it fires
  at 5 s.** That would need a real five-second wait or an injectable timeout,
  and this round adds neither. The HMAC test passes even without the algorithm
  pin, because the verifier only ever calls RSA-SHA256. It proves the forgery
  fails, not which check stops it. The pin itself is still guarded by the
  existing test that labels a token HS256.

- **F6, fixed:** `nbf` gets 10 s of leeway. `exp` gets none.
- **F7, left**, per the owner.
- **F8, fixed:** all three segments must be strict base64url.
- **F9, fixed on branch 1 by correcting the sentence**, not by giving the
  planner two status lines. The comment in `packages/core/src/errors.ts` now
  names the ledger and the downloader, and says the planner maps neither and
  would answer 500. The dispatch kept branch 1 to the codes and the entries an
  exhaustive map needs. The planner's table is `Partial`, and the planner
  raises neither code, so the defect was the sentence. Branch 2 is rebased onto
  branch 1.
- **Two corrections to the first entry above.**
  - It says the production-mode run of the built `dist` answered `/api/me` with
    `401`. That was true at the time; since decision A3 the same call answers
    `403`.
  - It says a key never seen gets `UNREACHABLE` "because that failure is not
    the caller's". Until this round, that held only for the request that made
    the fetch. Others in the same 30-second window got `403 UNAUTHENTICATED`
    (gate 1, F4).
- New tests were added at the end of their specs, below every line the gate
  cited.
  - On the fixed code, `npx vitest run tools/ledger/api/test/access.test.ts
tools/ledger/api/test/config-access.test.ts` gives 2 of 2 files and 39 of 39
    tests, and `npx vitest run tools/ledger` gives 7 of 7 files and 64 of 64
    tests.
  - With the old `access.ts` swapped back in, 6 of the 29 access tests fail:
    every new one that targets a live defect.
  - With the old literal `NODE_ENV` comparison, the spelling test fails.
