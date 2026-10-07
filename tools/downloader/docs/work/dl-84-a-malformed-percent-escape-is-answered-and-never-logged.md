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
    over 100 characters, 414, 0 lines on the base: the same blindness, and it would
    have lost its default body to the new option otherwise). Covered by one test.
    `FST_ERR_ASYNC_CONSTRAINT` is unreachable here (no async constraint is registered);
    its default body is kept so the handler cannot change it if one is added.
  - The brief's `Packages: api (server.ts, request-log.ts)` was right.
