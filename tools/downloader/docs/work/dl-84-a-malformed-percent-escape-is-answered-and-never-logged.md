---
id: dl-84
tool: downloader
title: A request with a malformed percent escape gets a 400 and no log line
kind: fix
status: ready
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
