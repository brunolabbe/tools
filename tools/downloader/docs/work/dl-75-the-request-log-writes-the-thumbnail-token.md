---
id: dl-75
tool: downloader
title: The request log writes a thumbnail token in full, and the contract calls it a capability
kind: fix
status: needs-decision
milestone: null
depends_on: []
difficulty: standard
---

# dl-75 — the request log writes the thumbnail token in full

**Packages:** `api` (`request-log.ts`), and `contract` only if the answer to the
question below changes what `ROUTES.thumbnail` says about its token.

## Why

`request-log.ts` redacts the path segment after exactly one prefix, `ROUTES.file`,
and says so: its comment on `CAPABILITY_PREFIXES` is "Exactly one qualifies",
because a file token _is_ the authorisation while a job id is deliberately not a
secret. The contract says the same of the other token. `ROUTES.thumbnail`'s
comment in `contract/src/api.ts` reads "Same shape and same reason as `file`: the
token is the capability", and `routes/thumbnail.ts` rate-limits it keyed on the
token "for the same reason" as the file route. So the two are described as the
same kind of thing, and only one of them is redacted in the log.

Found by dl-54's gate 1, which dropped it from that branch as older than it and
outside its diff. Re-run by the dl-54 builder on 2026-10-03, against the
repository at `ebb808b` plus dl-54's branch (none of which touches this):

```
GET /api/thumbnail/<token>  ->  200
{"level":"info", ..., "method":"GET","url":"/api/thumbnail/xnF0d-05png36Wp5txNHQYT6FfTfIvIRgg6iT6RjpDA","status":200,"durationMs":3,"ip":"127.0.0.1","msg":"request"}

GET /api/files/<token>      ->  404
{"level":"info", ..., "method":"GET","url":"/api/files/[redacted]", ... ,"msg":"request rejected"}
```

That is a test harness at `info` with a token minted by `ThumbnailStore.put`, and
the file line is the same request shape on the route that is redacted. A live
`api/dist/main.js` gave the same for a thumbnail path (`GET
/api/thumbnail/aaaa… 404` written verbatim, twice: the `request rejected` line and
the `request` line).

What a logged thumbnail token buys, stated so the question is not mistaken for a
bigger one: the image behind it, up to `MAX_THUMBNAIL_BYTES` (512 KB), for the ten
minutes the token lives in memory. It cannot start a download. The line carries
`ip` and `requestId` beside it.

## The question

**Is the thumbnail token a capability in the sense `request-log.ts` means?**

- **Yes.** It is the only thing that names the image, there is no session or owner
  check, and the contract and the route already say so. Then it joins
  `CAPABILITY_PREFIXES`, and "Exactly one qualifies" is wrong and says what
  changed.
- **No.** It is a name for a harmless, short-lived preview, and a job id is the
  closer comparison. Then the contract comment and the route comment that call it
  "the capability" are what is wrong, and the log is right as it stands.

Decide it before building either half: the code is a one-line change and the
comments are not.

## Build

1. Settle the question above, on this ticket.
2. Make the log, `contract/src/api.ts`'s comment and `routes/thumbnail.ts`'s
   docblock say the same thing. If the answer is yes, add the prefix to
   `CAPABILITY_PREFIXES`, taken from `ROUTES` as the file one is.
3. A test beside `logging.test.ts`'s existing redaction cases for whichever way it
   goes: the `request` line for `/api/thumbnail/<token>` and the
   `request rejected` line for the same path, asserted on the raw serialised line.

## Done when

1. The question has an answer written on this ticket.
2. `ROUTES.thumbnail`'s comment, `routes/thumbnail.ts` and `request-log.ts` agree
   with it.
3. A test fails on the other answer: it reads the raw line for both the served and
   the missed thumbnail request.
4. `npm run check` and the downloader's suite pass.

## Log

- 2026-10-03 — Filed by the dl-54 builder from gate 1's dropped finding, at the
  owner's direction. The measurement above is the builder's own re-run, not the
  gate's. Not built.
