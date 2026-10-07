---
id: dl-84
tool: downloader
title: A request with a malformed percent escape gets a 400 and no log line
kind: fix
status: done
milestone: null
depends_on: [dl-76]
difficulty: standard
---

# dl-84 — a malformed percent escape is answered and never logged

**Packages:** `api` (`server.ts`, where the Fastify instance is built, and
`request-log.ts`).

## Why

`registerRequestLogging` writes its `request` line from hooks that Fastify runs
once a request has been routed. A URL whose percent escape cannot be decoded is
refused by Fastify's router before any hook runs, with a 400, so the service
answers it and writes nothing. An operator reading the log cannot see that the
request happened, from whom, or how often. A scan that sends these is invisible,
and so is a client that builds a broken link.

This is not a leak: no line is written, so no token reaches one. It was found by
dl-76's gate 1 (`7072830`) while probing for leaks, and it is the same at the
base, so dl-76 did not cause it and left it alone, being outside that ticket's
range. dl-76 is the dependency because the fix will log a URL, and the only safe
way to log one that may carry a capability token is `redactLoggedUrl` as dl-76
leaves it.

## Reproduction

Run on 2026-10-06 on the dl-76 branch at `7072830` plus a comment-only change, and
by dl-76's gate 1 at `7072830` and at its base. The real app (`createHarness`),
logger at debug with every written line captured, `server.listen` on `127.0.0.1`,
and a raw `net.connect` socket sending `GET <target> HTTP/1.1`, because
`server.inject` normalises the target first and would not reach this path. The
token below is a made-up stand-in.

| Target                                   | Status | Log lines written |
| ---------------------------------------- | ------ | ----------------- |
| `/api/health` (control)                  | 200    | 1 (`request`)     |
| `/api/nope` (control)                    | 404    | 1 (`request`)     |
| `/api/files/<token>%E0%A4%A` (truncated) | 400    | **0**             |
| `/api/files/<token>%` (a lone `%`)       | 400    | **0**             |
| `/api/files/<token>%zz` (not hex)        | 400    | **0**             |
| `/api/files/<token>%C0%AF` (overlong)    | 400    | **0**             |

Calling `redactLoggedUrl` directly on each of those four targets does not throw
and returns `/api/files/[redacted]`. So the function is safe to call on them;
nothing calls it, because nothing logs them.

Fastify 5.11.2 builds this refusal in `fastify.js` and hands it to
`options.frameworkErrors` when that option is set (`FST_ERR_BAD_URL`). Whether
that handler can write the line without changing the 400 the client sees was
**not measured**; it is a lead, not a design.

## Build

1. Reproduce the four red rows above as a test in `api/test/logging.test.ts` that
   reads the raw serialised log lines over a real socket, as that file's
   `on a real socket` cases do. It fails on the current code with zero lines.
2. Write one log line for such a request, through `redactLoggedUrl`, so that no
   spelling of a token reaches it. Say on this ticket which fields the line
   carries and at what level, and why: a scanner can send these at will, so a line
   at `info` per request is a volume question to answer, not assume.
3. Leave the response unchanged: still a 400, with the body it has now.

## Done when

1. A test over a real socket fails on the current code, with 0 `request` lines,
   for each of `%E0%A4%A`, a lone `%`, `%zz` and `%C0%AF` after
   `/api/files/<token>`, and passes after the fix with exactly one.
2. The same test asserts, for the same four targets, that no written line
   contains the token, for the `files` and the `thumbnail` route.
3. The same test asserts the status is still 400 and the body is the one the
   current code returns.
4. The ticket's Log states the level the line is written at and the reason.
5. `npm run check` and the downloader's suite pass.

## Review

**Gate: PASS** — 2026-10-07 · `1aece87d..5c1954d2` · Opus 5.5, depth standard

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Real-socket test, 0 `request` lines on the current code for the four tails after `/api/files/<token>`, exactly one after | `api/test/logging.test.ts` › "a request the router refuses before any hook runs" › "on /api/files/:token" › "%s is logged once, redacted, and still answered 400" ✓. The `toHaveLength(1)` carries "exactly one". With the `frameworkErrors` line taken out of `createApp`, 9 of 9 cases went red, every one on `timed out waiting for the request line; last value: 0`, with no assertion errors. A mutation that writes a second line made 9 of 9 fail on `got 2` |
| 2. Same four targets: no written line contains the token, for `files` and `thumbnail`                                       | Same test, run for both routes by `describe.each`. The check that no line contains `token.slice(1)` carries the clause, and `toHaveLength(1)` before it is the guard that fails on empty output ✓. Logging `error.message` as an extra field made 8 of 8 go red on this assertion                                                                                                                                                                                   |
| 3. Status is still 400 and the body is the one the current code returns                                                     | Same test: status, `contentType` and the body's `toEqual` are asserted before the line is awaited. In the run with the wiring removed, all of them passed, so the expected values are the base's ✓. Also checked by a byte-for-byte diff of the raw responses at base and at head: 0 of 54 differ                                                                                                                                                                   |
| 4. The Log states the level and the reason                                                                                  | **verified**: the Log says `info`, and gives the reason (same class as a scanner's 404s, `debug` hides the signal, `warn` pages someone)                                                                                                                                                                                                                                                                                                                            |
| 5. `npm run check` and the downloader suite pass                                                                            | **verified**: `npm run check` exits 0. `npm test -- --project downloader` gives 2072 passed and 2 skipped of 2074 at the head, against 2063 and 2 of 2065 at the base, so +9 with no deletions in the test diff. On PR #387 at `5c1954d2`, `check`, `test (ubuntu-latest)`, `e2e (direct)`, `e2e (sniffer)` and `docker` are green                                                                                                                                  |

- **low** · no `Done when` line depends on it · **The 414 test checks only the status and the body.** It does not check `Content-Type` or any other header. A mutation that answers through `reply.code(status).type("application/json").send(body)` instead of `reply.raw` failed 8 of 8 `FST_ERR_BAD_URL` cases, on `'application/json; charset=utf-8'` against `'application/json'`. "a parameter longer than the router allows is logged too, and still 414" still passed. Reproduction: `mutate.sh m3-reply-send`.
- **low** · `nfr:maintainability` · **The 414 fold-in never fires when the UI is served, which is the shipped image's configuration.** The image's `Dockerfile` sets `WEB_DIR`. With `webDir` set, a 200-character parameter on `/api/files`, `/api/thumbnail` or `/api/jobs` gets a **404 through the normal path**, and it was already logged at the base (1 line at the base, 1 at the head, all five 414 rows). The Log's "0 lines on the base: the same blindness" is true only with no UI, and so is the `createFrameworkErrorHandler` doc comment's 414 sentence. Neither says so. Reproduction: `probe.mts … web`, rows `414 *`.
- **low** · `nfr:maintainability` · **`durationMs` on a refused request is always 0, not a measurement.** Fastify's `Reply.elapsedTime` returns `0` when no start time was recorded, and that is always the case for a `frameworkErrors` reply. All 50 of 50 refused-request lines read `0`. The figure is roughly true, because routing happens before any body is read, but the Log lists it among "the same fields as an ordinary request", and a reader will take it as measured. A comment, or `null`, would make it honest.
- **low** · **open decision** · no `Done when` line depends on it · **A malformed escape in or before the route prefix now writes the token into a log line, where the base wrote no line at all.** Examples: `/api/files%zz/<t>`, `/api/fi%les/<t>`, `/api/%zz/files/<t>`, each a 400 with 1 line holding the token verbatim. `redactLoggedUrl` (unchanged by this branch) does not find a capability prefix in those paths. This is the class dl-76 named and left open, "a spelling no normaliser would turn into the route". The escape-free versions, `/api/zz/files/<t>` and `/api/filez/<t>`, already log the token on a 404 at the base. So it is not graded high: this branch adds no new exposure _policy_, but it does add new lines.
  - (a) **Recommended:** accept, and add this case to dl-84's Log next to dl-76's named class.
  - (b) In `createFrameworkErrorHandler` only, when `redactLoggedUrl` finds no prefix, cut the path at the first escape that does not decode. That closes all three shapes, for about one regular expression, and loses nothing a reader needs.
- **dropped** · signed-URL query strings (`X-Amz-Signature=…&sig=…`) are logged verbatim on the refused line. That is dl-76's named open class, "a credential carried in the query string", and served requests at the base do the same. `Cookie` and `Authorization` reached no line (0 hits in 50 refused lines).
- **dropped** · `x-request-id` is not echoed on a refused response, so a client cannot quote the line's `requestId`. The base sends none either, and Build 3 says to leave the response unchanged.
- **dropped** · `FST_ERR_ASYNC_CONSTRAINT`: it has no live call site, because no constraint is registered. Measured on a throwaway Fastify with a failing async constraint, the handler's 500 response is byte-identical to Fastify's default.
- **dropped** · the handler writes `"Bad Request"` for every status other than 500. Fastify 5.11.2 has three `frameworkErrors` call sites, and both of its non-500 codes write exactly that by default. A future code is hypothetical, with no live call site.
- **findings** · the hunt returned 8: 4 carried, 4 dropped.
- Response fidelity: the real server over a raw socket, at the base and at the head, with and without `webDir`, compared on the full raw response (status line, every header, body), after normalising `Date`, ids and the temp dir. 54 targets: 3 controls, 4 tails × 7 paths (every parameterised route in `printRoutes`, plus a 404 path and an SPA path), placement variants, `HEAD`, `POST`, an absolute-form target, keep-alive pipelining and six 414s. 0 of 54 differ in either configuration. Every refused request wrote exactly 1 `request` line at the head and 0 at the base.
- NFR: security — the low above, everything else ✓ · performance n/a (one line per refused request, the same class as 404s) · reliability ✓ (keep-alive pipelining is unchanged; `redactLoggedUrl` does not throw on these inputs) · maintainability — the lows above.
- Invariants checked: no cross-tool import ✓, contract untouched ✓, `redactLoggedUrl` on the logged URL ✓, test file already registered ✓, style ✓. Skipped as not touched: shell, SSRF, progress, `Dockerfile` closure.

### Gate 2

**Gate: PASS** — 2026-10-07 · `5c1954d2..2fd182cb` · Opus 5.5, depth standard

Gate 1's findings:

- **low, 414 test checked no headers — fixed.** "a parameter longer than the router allows is logged too, and still 414" now asserts `Content-Type: application/json`. The `reply.send` mutation (`m3-reply-send`), re-run at this head, makes it fail: 9 failed of 17, 414 included, on `'application/json; charset=utf-8'`. At gate 1 it stayed green.
- **low, 414 fold-in not taken with the UI served — fixed.** The Log carries a correction, and the `createFrameworkErrorHandler` doc comment now says that with `webDir` set the over-long parameter is a 404 on the normal path. Re-measured with `webDir`: 5 of 5 over-long-parameter targets answered 404 with 1 line each, at the base and at this head.
- **low, `durationMs` a constant 0 — fixed** by dropping the field from refused lines. 75 of 75 refused lines at this head carry no `durationMs`, and served lines still do. Putting it back (`m6-duration-back`) fails 8 of 17, on `to not have property "durationMs"`.
- **open decision, malformed escape in or before the route — resolved by the owner as (b), and built as `redactRefusedUrl`.**
  - The three gate-1 shapes now log `/api/files[truncated]`, `/api/fi[truncated]` and `/api/[truncated]`, with 0 token windows in any line.
  - Swapping `redactRefusedUrl` for `redactLoggedUrl` (`m5-logged-not-refused`) fails 8 of 17, which matches the Log's "8 of 8". Dropping the UTF-8 run check (`m7-no-utf8-check`) fails the 2 overlong cases.

Done when 1–5 still hold.

- **Suite:** `npm test -- --project downloader` gives 2080 passed and 2 skipped of 2082 (gate 1 head: 2072 of 2074, so +8, the new cases).
- **Check:** `npm run check` exits 0.
- **Re-run of gate 1's mutations at this head:** dropping redaction fails 17 of 17. Logging `error.message` fails 17 of 17. A second line fails 17 of 17 (3 distinct `got 2` messages).
- **PR #387 at `2fd182cb`:** every leg is green — `check`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, both `e2e` legs, `docker` and `codeql`. The rollup also lists one `check` as CANCELLED. `gh pr checks` shows both `check` entries passing, so it is a superseded run.

Attack on `redactRefusedUrl`, over a real socket at the base, at gate 1's head and at this head (84 targets, 30 of them new):

- **Fuzz:** 200,000 random paths, compared against find-my-way's own `safeDecodeURI`. Of the 48,446 it refuses, the handler's line is cut or redacted for 48,446 and verbatim for 0. A marker placed after a `%zz` survived in 0 of 100,000 paths.
- **Closed by the cut:** a lone `%` in the route, `%zz` after or before it, an overlong `/` in or after the prefix, an overlong 3-byte sequence, an encoded surrogate, truncated UTF-8, and a cut whose signed query is dropped along with the path.
- **Read by `redactLoggedUrl` first:** double encoding (`%2566iles`, `files%252F`), `;x` after the prefix, and `%zz/../files/<t>`.
- **Served lines unchanged:** 10 of 10 served targets wrote identical lines at the base, at gate 1's head and at this head. That includes the `FILE_EXPIRED` error line and a 404 with a signed query. 0 of 84 responses differ apart from a job body's timestamps.

- **low** · `nfr:maintainability` · **The `redactRefusedUrl` doc comment over-states what happens to the query.** It says "otherwise the path cut at the first percent escape that does not decode, with the query dropped". A refused path with no such escape (every 414 off a capability route) comes back verbatim, query included: `GET /api/jobs/<token×3>` is logged whole, at 414. No credential route is affected, since a capability path goes through `redactLoggedUrl` first. The comment needs one clause.
- **dropped** · a token placed _before_ the first bad escape, in a spelling `redactLoggedUrl` cannot read, still reaches the line. Measured shapes:
  - `/api/filez/<t>%zz` and `/api/thumbnails/<t>%zz`;
  - four layers of encoding, a full-width slash, a trailing dot, `%00` in the route;
  - `/api/%C3%A9/files/<t>%zz` and `/<t>/api/fi%les/x`.

  This is what option (b) leaves by construction, and the Log says so with `/api/filez/<token>%zz` as its example. Each one's escape-free version is already logged verbatim on a 404 at the base. Not a defect against the owner's decision.

- **dropped** · the signed query kept after a redacted capability path (`/api/files/[redacted]?X-Amz-Signature=…`). This is dl-76's class, unchanged by this round and identical on served lines.
- **findings** · the hunt returned 3: 1 carried, 2 dropped.
- NFR: security ✓ (fuzz above) · performance n/a (one linear regex pass and one `decodeURIComponent` per escape run, refused requests only) · reliability ✓ (`decodes` catches `URIError`; nothing throws on 48,446 refused paths) · maintainability — the low above.

## Log

- 2026-10-06 — Filed from dl-76's gate 1 (`7072830`), at the owner's choice to
  file it over leaving it recorded only. Reproduced again on the dl-76 branch
  with the table above (6 of 6 targets answered as shown, `redactLoggedUrl` on
  the 4 malformed ones returned `/api/files/[redacted]` and did not throw). Not
  built.
- 2026-10-07 — Built. `Fastify({ frameworkErrors })` is the hook the ticket's lead
  pointed at: `createFrameworkErrorHandler` in `request-log.ts` writes the line, then
  writes the refusal itself.
  - **Level and fields.** One `request` line at **`info`**, the same message and fields
    as an ordinary request (`method`, `url` through `redactLoggedUrl`, `status`,
    `durationMs`, `ip`, plus `requestId`) and one more, `code` (`FST_ERR_BAD_URL`).
    Level reason: every request that is not a health check is already `info`, and a
    scanner's 404 probes already cost one `info` line each, so this adds no new volume
    class; `debug` would hide the one signal the ticket exists to surface, and `warn`
    would make a client's broken link page someone. `code` is how a reader tells these
    from a 404. The error's `message` is never logged: Fastify builds it by quoting the
    raw path, token included.
  - **Response unchanged, measured.** Setting the option hands Fastify's whole answer to
    the handler, so it is rewritten to the byte: `Content-Type: application/json`,
    `Content-Length`, body `{error:"Bad Request",code,message,statusCode}` via `reply.raw`.
    The tests assert the response _before_ waiting for the line, and on the base the
    response assertions pass and only `the request line` times out with `last value: 0`
    (9 of 9 red for that reason), so the 400 body is the one the current code returns.
    Not echoed: `X-Request-Id`, which the base does not send for these either.
  - **Folded in.** The same hook also takes `FST_ERR_MAX_PARAM_LENGTH` (a path parameter
    over 100 characters, 414, 0 lines on the base **only with no UI served**; see the
    correction below: the same blindness, and it would have lost its default body to the
    new option otherwise). Covered by one test.
    `FST_ERR_ASYNC_CONSTRAINT` is unreachable here (no async constraint is registered);
    its default body is kept so the handler cannot change it if one is added.
  - The brief's `Packages: api (server.ts, request-log.ts)` was right.
- 2026-10-07 — Round 2, after gate 1 (PASS at `5c1954d2`, four lows).
  - **Decision, with the owner, 2026-10-07.** Question: a malformed escape in or before
    the route prefix (`/api/fi%les/<token>`, `/api/files%zz/<token>`,
    `/api/%zz/files/<token>`) put the token into the new line, where the base wrote none,
    because `redactLoggedUrl` finds no capability prefix in such a path. Options: (a)
    accept it and record it as dl-76's named open class, which was the gate's
    recommendation; (b) in the `frameworkErrors` handler only, when no capability prefix is
    found, cut the logged path at the first escape that does not decode. **Chosen: (b)**,
    over the gate's recommendation. Built as `redactRefusedUrl`: `redactLoggedUrl`'s answer
    when it finds a prefix, else the path up to the first `%` not followed by two hex
    digits or the first run of escapes that is not UTF-8 (an overlong `%C0%AF`, a truncated
    `%E0%A4`), then `[truncated]`, query dropped. A served request's line is untouched.
    It over-cuts on purpose: a run is cut at its start, not at the single bad byte.
    What it does not close: a token _before_ the bad escape in a spelling `redactLoggedUrl`
    cannot read (`/api/filez/<token>%zz`), the class dl-76 names, which the base already
    logs on a 404.
  - **Tests.** 8 new cases (4 spellings × `files` and `thumbnail`), over a real socket:
    status 400, exactly one line, its `url` equal to the cut form, and no 8-character
    window of the token in any line. Red first, with the cut replaced by `redactLoggedUrl`:
    `Received: "/api/fi%les/44JuZ…"`, 8 of 8, and green after.
  - **`durationMs` dropped from these lines.** Fastify's `Reply.elapsedTime` reads 0 for
    a `frameworkErrors` reply because no start time is recorded (gate: 50 of 50 lines
    read 0). Measuring it ourselves would time only the handler. A constant reads as a
    measurement and `null` breaks a numeric aggregate, so the field is absent, and a test
    asserts that. The first entry's "the ordinary request fields" therefore means those
    minus `durationMs`.
  - **Correction: the 414 claim.** "0 lines on the base" holds only with no UI served.
    With `webDir` set, which the image's `Dockerfile` does, an over-long parameter reaches
    the not-found handler as a 404 and was logged at the base; the 414 path is then never
    taken. The doc comment on `createFrameworkErrorHandler` now says so. The 414 test now
    also asserts `Content-Type: application/json`, which a `reply.send` rewrite changed
    (gate mutation `m3-reply-send`).
  - Dropped by the gate and left as is: query-string credentials (dl-76's class),
    `X-Request-Id` not echoed (the base sends none), the async-constraint and
    non-`Bad Request` text (no live call site).
