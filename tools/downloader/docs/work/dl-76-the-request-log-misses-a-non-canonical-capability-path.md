---
id: dl-76
tool: downloader
title: The request log misses a capability token behind a non-canonical path
kind: fix
status: ready
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

## Log

- 2026-10-05 — Filed from dl-75's gate 1 (`f1a43cc`), first low, at the owner's
  choice over folding it into dl-75 or recording it only; the gate recommended
  filing. The table and the proposed direction are the gate's, not measured again
  here. Not built.
