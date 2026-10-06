---
id: dl-76
tool: downloader
title: The request log misses a capability token behind a non-canonical path
kind: fix
status: done
milestone: null
depends_on: [dl-75]
difficulty: standard
---

# dl-76 — the request log misses a capability token behind a non-canonical path

**Packages:** `api` (`request-log.ts`, and wherever the error handler in
`server.ts` calls it). `contract` only if the fix changes what `ROUTES` exposes.

## Why

`redactLoggedUrl` in `request-log.ts` redacts the path segment after a prefix
taken from `ROUTES` (`CAPABILITY_PREFIXES`: the file route and, since dl-75, the
thumbnail route). It does a prefix match on the **raw** `request.url`. Fastify's
router matches the path **after** normalising it, so a path that is not in
canonical form can reach the handler, or miss every route, and still not match the
prefix. The token then reaches the log in full, which the root `CLAUDE.md`'s
redaction rule forbids for a bearer credential in a URL path.

Found by dl-75's gate 1 at `f1a43cc`, as its first low, and left out of dl-75
because it predates that ticket and the fix changes the file route as well. The
file route has done the same since dl-23.

### Reproduction

From dl-75's gate 1 at `f1a43cc` ("Attack 2: path shapes"), pasted as the gate
wrote it. It ran the real app (`createHarness` and `server.inject`, logger at
debug, raw lines captured), and tried each shape on both `/api/thumbnail/` and
`/api/files/`; the two prefixes behave identically:

| Shape                                                                        | Status                | Token in log?          |
| ---------------------------------------------------------------------------- | --------------------- | ---------------------- |
| Query string                                                                 | 200                   | no                     |
| Trailing slash                                                               | 404                   | no                     |
| Percent-encoded first character of the token                                 | 200                   | no                     |
| Semicolon                                                                    | 404                   | no                     |
| Fragment                                                                     | 200                   | no                     |
| `HEAD`                                                                       | 200                   | no                     |
| `POST`, `DELETE`, `OPTIONS`                                                  | 404                   | no                     |
| Malformed percent-encoding                                                   | 400                   | no line written at all |
| **`/api/%74humbnail/<t>`**                                                   | **200, image served** | **yes, in full**       |
| `//api/…`, `/api//thumbnail/…`, `/api/thumbnail%2F<t>`, `/API/THUMBNAIL/<t>` | 404                   | yes, in full           |
| `/api/thumbnail//<t>`                                                        | 404                   | yes: `[redacted]/<t>`  |

The gate's text: "The file route has the same gap: `/api/%66iles/<t>` reached the
file handler and both lines leaked. This is the first low. Every client in the
repo builds `ROUTES.thumbnail(token)`. Whether any proxy re-encodes a path like
this was not measured."

The gate's finding, as it recorded it: `GET /api/%74humbnail/<token>` serves the
image (200) and its `request` line reads `url=/api/%74humbnail/ogbfEj9z…`, with
the token in full. `/api/%66iles/<token>` reached the file handler (410) and
logged the token in both lines (`request` and `request rejected`).

**Unmeasured:** whether any proxy in front of the service re-encodes a path this
way. Every client in the repo builds the canonical form, so the live exposure is a
caller who chooses the encoded spelling, not the product's own traffic.

## Build

**A proposal from the gate, not a settled design.** Its words: "redact on the
matched route (`request.routeOptions.url` plus `params.token`) instead of the raw
prefix", which would cover both routes at once.

A note for whoever builds it, from reading the table rather than from a
measurement: the `//api/…`, `/API/…` and `/api/thumbnail%2F<t>` shapes return 404,
so they match no route and there is no matched route to redact on. Whether those
need a second mechanism (for instance redacting the whole path of an unmatched
request) or are left as accepted, is the builder's call to make and to record on
this ticket.

1. Reproduce the table's red rows (at least `/api/%74humbnail/<t>` and
   `/api/%66iles/<t>`) as tests that read the raw serialised log lines, as
   `logging.test.ts`'s existing redaction cases do.
2. Change the redaction so those pass, for both routes, and for the `request`,
   `request rejected` and error-handler lines.
3. Say on this ticket which of the 404 shapes are covered and which are not, and
   why.

## Done when

1. A test fails on the current code for `/api/%74humbnail/<t>` and
   `/api/%66iles/<t>`, reading the raw log lines, and passes after the fix.
2. The 404 shapes in the table (`//api/…`, `/api//thumbnail/…`,
   `/api/thumbnail%2F<t>`, `/API/THUMBNAIL/<t>`, `/api/thumbnail//<t>`) are each
   either covered by a test or named on this ticket as left open, with the reason.
3. `npm run check` and the downloader's suite pass.

## Review

**Gate: PASS** — 2026-10-06 · `4907d9a..7072830` · Opus 5.5, depth standard

| Done when                                                                                                          | Proof                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A test fails at the base for `/api/%74humbnail/<t>` and `/api/%66iles/<t>`, reading raw lines, and passes after | `api/test/logging.test.ts` › "a capability token never reaches a log line, however its path is spelled" › "on /api/thumbnail/:token" and "on /api/files/:token" › "an encoded first letter of the route" ✓ — the serialised-line filter carries it; both red with the base `request-log.ts`, green at head |
| 2. Each 404 shape in the table covered by a test or named as left open                                             | Same describe › "a doubled leading slash", "a doubled slash inside the prefix", "an encoded slash before the token", "an upper-cased route", "a doubled slash before the token", on both routes ✓ — all ten red at the base, so `inject` did not normalise them away                                       |
| 3. `npm run check` and the downloader's suite pass                                                                 | verified — `npm run check` exit 0; `npm test -- --project downloader` 1634 passed, 2 skipped of 1636; PR #366's CI green on `7072830`, Windows leg included                                                                                                                                                |

- **low** · no `Done when` line depends on it · one mechanism, two misreadings.
  `capabilityPrefixOf` in `api/src/request-log.ts` matches a prefix anywhere in
  the path, and with no segment after it. So a request that is not a capability
  request is logged as one. With `webDir` set, `GET /docs/api/files/readme`
  (`Accept: text/html`) is served `index.html` 200 and logged
  `url=/api/files/[redacted] status=200`. That line cannot be told apart from a
  successful download. `GET /api/files` (404) is logged as `/api/files/[redacted]`,
  which says a token was presented when none was. The function's comment says the
  over-redacted `/x/api/files/y` is a path "which no route answers". That is
  false when the UI is served, because the SPA fallback answers it.
  Reproduction: `spa.mts` in the gate's scratch directory, run from
  `tools/downloader/api` with `node --import tsx`. It uses `createHarness` with
  `config.webDir` pointing at a directory that holds an `index.html`, and
  `inject` with `accept: text/html`. Output:
  `/docs/api/files/readme -> 200 text/html | logged: /api/files/[redacted] 200`
  and `/api/files -> 404 application/json | logged: /api/files/[redacted] 404`.
  **Open decision:** (a, recommended) correct the comment and accept the
  conflation, because no credential is at stake and an odd 200 on a capability
  route is rare. (b) Redact only when something follows the prefix in the raw
  path, which fixes the bare `/api/files` line but not the SPA one. Matching only
  at the root would give the SPA case back, but it would also lose the
  absolute-form coverage.
- **low** · no `Done when` line depends on it · an absolute-form target with a
  `?` in its authority, `http://localhost:<port>?/api/files/<t>`, **is served**
  (200 on both routes). find-my-way's `FULL_PATH_REGEXP` strips through the first
  `/`. `redactLoggedUrl` cuts at that `?`, finds no prefix and returns the URL
  unchanged. The token stays out of the line only because `redactUrlsInText` in
  `logger.ts` drops the query from any `https?://` substring. The line reads
  `http://localhost:<port>/?[redacted]`: the route is lost, and no test pins this
  shape's reliance on that second mechanism. Reproduction: `probe.mts`, row
  "absolute-form ? in authority".
- **low** · `nfr:maintainability` — the comment on "a traversal attempt is
  redacted, not resolved" in `api/test/logging.test.ts` still says "the segment
  after the prefix is replaced". Since this change the whole remainder is
  replaced, which is what its assertion now pins.
- **dropped** · four spellings still log the token, each on a 404 that reaches
  no handler: a raw `?` or `#` straight after the prefix (`/api/files?/<t>`,
  `/api/files#/<t>`, `/x?/api/files/<t>`), four layers of encoding
  (`/api/%25252566iles/<t>`), a full-width slash (`/api/files%EF%BC%8F<t>`) and a
  trailing dot (`/api/files./<t>`). The ticket's Log names each class as left
  open: a credential in the query string, more than three layers, a confusable,
  and "a spelling no normaliser would turn into the route". The trailing dot is
  not named on its own but belongs to the last class. Not a defect against this
  brief.
- **dropped** · a malformed escape (`%E0%A4%A`, a lone `%`, `%zz`, an overlong
  `%C0%AF`) gets a 400 and **no log line at all**. This is the same at the base
  (`probe-base.out`, `lines=0`): Fastify refuses the URL before `onRequest`, so
  `redactLoggedUrl` never runs. It is out of the reviewed range. Called
  directly, `redactLoggedUrl` does not throw on any of these inputs.
- **dropped** · `registerNotFoundHandler` echoes `request.url` in the 404
  response body (`details.path`). That is the caller's own input going back to
  them, not a log line. The Log names it too.
- **findings** · the hunt returned 6. 3 were kept and 3 dropped.
- Log sites enumerated in `api/src`, 8 of 8: the `request` line
  (`registerRequestLogging`) and `request rejected`/`request failed`
  (`registerErrorHandling`) both go through `redactLoggedUrl`, and their
  `details` carry no path on either capability route. The not-found handler logs
  nothing. `rate limited` logs `capabilityBucketKey`, which reads the router's
  `params`, so the spelling cannot reach it. The `files.ts` refusals log a client
  key and counts. `web.ts` logs no URL. `egress-proxy.ts` logs outbound
  subprocess targets, not inbound paths. Fastify's own logger is off.
- Rewritten assertions: the four that pinned "the rest of the path is kept as it
  came" came from dl-23. No `Done when` line in dl-23 or dl-75 relies on the
  suffix being kept. dl-75's thumbnail tests and "leaves identifiers alone" are
  unchanged, and every new assertion is an exact `toBe`, which fails on empty
  output. Nothing was weakened.
- Positive control: removing the case fold from `capabilityPrefixOf` in a
  scratch copy turned 3 of 94 red (both "an upper-cased route" tests, and
  "resolves what a normaliser would…"). The base `request-log.ts` under the
  branch's tests turned 40 of 94 red, which matches the Log. The gate's
  socket probe leaked on 48 of 64 targets at the base and on 12 of 64 at head.
- Invariants: redaction checked, as above. The contract is untouched. The tests
  sit in an existing, registered spec. There is no new dependency and no style
  breach (`npm run check` passed). Skipped as untouched: SSRF, shell and process
  trees, progress, Dockerfile, cross-tool imports.
- NFR: security ✓, with the two lows above · performance ✓ (decoding is bounded
  at three linear passes; 60,000 `%25` took 15 ms and 100,000 `a/../` took
  53 ms, both far above Node's header limit) · reliability ✓ (the decoder cannot
  throw) · maintainability: see the comment lows above.

## Log

- 2026-10-05 — Filed from dl-75's gate 1 (`f1a43cc`), first low, at the owner's
  choice over folding it into dl-75 or recording it only; the gate recommended
  filing. The table and the proposed direction are the gate's, not measured again
  here. Not built.
- 2026-10-06 — Built (branch `dl-76-noncanonical-path`, base `4907d9a`).

  **The table, re-measured at the base.** Every row held: `server.inject` against
  the real app (`createHarness`, logger at debug, raw lines read), both routes.
  `/api/%74humbnail/<t>` 200 and `/api/%66iles/<t>` 410, token in the `request`
  line (and in both lines for the file route); `//api/…`, `/api//thumbnail/…`,
  `/api/thumbnail%2F<t>`, `/API/THUMBNAIL/<t>` 404 with the token in full;
  `/api/thumbnail//<t>` logged `/api/thumbnail/[redacted]/<t>`; the query-string,
  fragment, trailing-slash, semicolon-suffix, `HEAD`, `POST` and
  percent-encoded-token-character rows did not leak; a malformed escape (`%zz`)
  was a 400 with no line. **The table was short**, because `inject` normalises
  the target before Fastify sees it: over a real socket (`net.connect`, Node's
  server on 127.0.0.1) these also logged the token in full, on both routes, and
  were not in the table: `/api/./thumbnail/<t>` and `/api/x/../thumbnail/<t>`
  (404), `/api/%2e/…` (404), `/api\thumbnail/<t>` (404), the absolute-form target
  `http://localhost/api/thumbnail/<t>` (**200, served**, and 410 on the file
  route), plus, over `inject`, `/api/thumbnail%3F<t>` and `%23<t>` (404) and the
  twice-encoded `/api/%2574humbnail/<t>` (404).

  **The design, and the one the ticket proposed.** Not "redact on the matched
  route": the five 404 shapes match no route, so that needs a second mechanism for
  them anyway, and the route-matched one would leave the absolute-form, dot-segment
  and backslash targets that 404 or are served just the same. So one mechanism
  that does not consult the router: `redactLoggedUrl` splits off the raw query
  string and fragment, then reads the path as a normaliser would and asks "does it
  end in a capability prefix" **after every segment** (percent escapes undone up to
  three passes, `\` as `/`, empty and `.` segments dropped, `..` popping, case
  folded, a `;…` path parameter and a decoded `?`/`#` cut off a segment). The first
  hit logs the route's canonical prefix plus `[redacted]` and **drops the rest of
  the path** (the old code kept everything after the first segment, which is the
  `/api/thumbnail//<t>` leak). It looks for the prefix anywhere in the path, not
  only at the root, which is what catches the absolute-form target. `ROUTES` and
  the contract are unchanged, so there was no decision to put to the owner.

  **Which 404 shapes are covered: all five**, on both routes, by
  `logging.test.ts > a capability token never reaches a log line, however its path is
spelled` (`a doubled leading slash`, `a doubled slash inside the prefix`, `an
encoded slash before the token`, `an upper-cased route`, `a doubled slash before
the token`), plus every other shape above, the wire-only ones under `on a real
socket`. **Left open, named:** a spelling no normaliser would turn into the route
  (a NUL or a Unicode confusable inside the route name, more than three layers of
  encoding), which reaches no handler and so can only land a token the caller chose
  to mangle in a 404 line; and a credential carried in the query string, which is
  not what this ticket redacts. **Unmeasured:** whether a proxy in front of the
  service re-encodes a path (the ticket's own gap); all measurements are Node's
  server on loopback.

  **Costs, recorded.** A non-canonical spelling now reads
  `/api/files/[redacted]` with its status beside it, so the line no longer says
  which odd shape the caller chose. A path like `/x/api/files/y` is redacted
  though no route answers it. Four assertions in the existing `redactLoggedUrl`
  tests pinned "the rest of the path is kept as it came" (`…/[redacted]/extra`,
  `…/[redacted]/`, `…/[redacted]/abc`, `…/[redacted]/etc/passwd`) and were changed
  to the whole-remainder form, with a comment saying why.

  **Red before green.** 40 of 94 in `logging.test.ts` fail against the base
  `request-log.ts` (restored from `origin/main`, test file as written), 0 of 94
  after. The two the ticket names, `on /api/thumbnail/:token > an encoded first
letter of the route` and the `files` twin, fail on `expected [ Array(1) ] to deeply
equal []` with the `request` line's `url":"/api/%74humbnail/<t>"` in it. A first
  red run of the socket cases failed for the wrong reason (a misused `waitFor`) and
  was not counted; the 40 is the second run, after that was fixed.

  **Fold-in.** `routes/thumbnail.ts` named `CAPABILITY_PREFIXES` in a comment; the
  constant is now `CAPABILITY_ROUTES`, so that comment was updated in the same
  commit. Not folded: `registerNotFoundHandler` echoes the raw path in the 404
  _response_ body (`details.path`), which is the requester's own input going back
  to them and not a log line, and nothing specifies changing it.

- 2026-10-06 — Gate 1 (Opus 5.5, `7072830`) PASS. **Question put to the owner,
  from its first low:** `capabilityPrefixOf` matches a prefix anywhere in the path
  and with nothing after it, so a request that is not a capability request is
  logged as one. With `webDir` set, `GET /docs/api/files/readme`
  (`Accept: text/html`) is served `index.html` 200 and logged
  `url=/api/files/[redacted] status=200`, which cannot be told apart from a
  download; `GET /api/files` (404) is logged as `/api/files/[redacted]`, saying a
  token was presented when none was. The comment said the over-redacted
  `/x/api/files/y` is a path "which no route answers", which is false when the UI
  is served. **Options:** (a) correct the comment and accept the conflation,
  because no credential is at stake and an odd 200 on a capability route is rare
  (the gate's recommendation); (b) redact only when something follows the prefix
  in the raw path; or leave it recorded only. **Answer, 2026-10-06, owner via
  AskUserQuestion: (a).** The comment in `request-log.ts` now states the SPA case;
  no behaviour changed. The gate's other low (a stale comment in
  `logging.test.ts`) is fixed. The malformed-escape 400 with no log line, which
  the gate measured at the base too, is filed as dl-84.
