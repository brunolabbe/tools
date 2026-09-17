---
id: dl-66
tool: downloader
title: A request whose body Fastify cannot parse is reported as `INTERNAL` 500
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-66 — A malformed request body is reported as `INTERNAL`

## Why

Found while reproducing [dl-65](./dl-65-cancel-from-the-ui-never-reaches-the-server.md).
Against the API on `origin/main` at `3be20cf`:

```bash
curl -s -XPOST http://127.0.0.1:8932/api/jobs/<id>/cancel -H 'content-type: application/json'
# {"error":{"code":"INTERNAL","message":"Something went wrong on our end.","retryable":false}}  — HTTP 500
```

Fastify rejects the empty body with `FST_ERR_CTP_EMPTY_JSON_BODY`, which carries
`statusCode: 400`. `toErrorResponse` (`api/src/http-errors.ts`) passes it through
`AppError.from`, which turns anything that is not an `AppError` into `INTERNAL`,
so a client's mistake is answered as a 500, logged at `error` as `request failed`,
and shown to the user as "This one is on us". dl-65 was invisible for exactly this
reason: the log read as a server fault, not a malformed request.

The same path presumably catches Fastify's other content-type-parser and
body-limit errors (malformed JSON, unsupported media type, body too large) —
measure each before relying on that.

## Decision needed

No code in the taxonomy fits "the request itself was malformed":

1. **Add a transport code to `@webtools/core`** (say `BAD_REQUEST`, 400). It
   describes the transport, not the downloader's domain, so by the root
   `CLAUDE.md` rule it belongs in core — which the planner also consumes, and
   every exhaustive copy table (the downloader's `error-presentation.ts`) gains
   an entry.
2. **Map Fastify 4xx errors onto an existing code** in the downloader only — none
   is honest (`INVALID_URL` names the wrong thing), so this re-words at the call
   site, which the root `CLAUDE.md` calls the tell of a wrong code.
3. **Pass the status through but keep `INTERNAL` as the code** — fixes the 500
   and the log level, keeps the wrong copy.

## Build

Once decided: map errors carrying a Fastify `statusCode` in the 4xx range in
`toErrorResponse`, before `AppError.from`; keep `INTERNAL` for everything else.
Check whether the planner's API has the same mapping and the same gap.

## Done when

- An `inject` of `POST /api/jobs/:id/cancel` with `content-type:
application/json` and no body answers 4xx with the chosen code, and logs at
  `info`, not `error`.
- The same for a malformed JSON body on `POST /api/jobs`.
- `npm run check` and `npm test` are green.

## Log

- 2026-09-16 — Filed from dl-65's reproduction. dl-65 removed the one request the
  UI made that hit this; the server-side mapping is still wrong for any other
  client.
