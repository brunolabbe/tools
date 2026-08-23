---
id: dl-23
tool: downloader
title: Meter the download route, without breaking a seeking video player
kind: fix
status: ready
milestone: null
depends_on: []
---

# dl-23 — The one route that serves bytes is the one route with no bucket

**Packages:** `api` (`routes/files.ts`, `config.ts`, `context.ts`, `server.ts`).

## Why

`GET /api/files/:token` stats and streams from disk with no `onRequest` hook.
`/api/probe` and `/api/jobs` both carry one — `createRateLimitHook` exists, is
tested, and is wired into two of the three routes that cost anything. This one
was never wired up.

Found by CodeQL (`js/missing-rate-limiting`, alert 3), which is right about the
shape and understates why it matters here: the expensive part is not the
`fs.stat` the query saw, it is the read stream underneath it. A caller holding
one live token can ask for arbitrary `Range` slices of a multi-gigabyte file as
fast as the socket drains, forever, until the retention sweep takes it. That is
disk and egress rather than CPU, which is exactly the budget this service has
least of.

It is genuinely lower risk than probe or jobs, and the ticket should say so: the
token is the whole authorisation model, it is checked for shape before the
database is touched, and an attacker without one gets a `JOB_NOT_FOUND` for the
same cost as any 404. This is metering a capability that has been handed out,
not closing a hole.

## Build

**The substance of this ticket is the key, not the hook.** Adding a third
`RateLimiter` is four lines copied from `jobs`. The question worth answering is
what a bucket does to the client this route actually has — and the answer rules
out the obvious implementation.

1. **Establish what a real client does to the route.** A `<video>` element
   pointed at a download link issues a burst of `Range` requests to build its
   seek index, and one more every time the user scrubs. `parseRange` already
   exists to serve them and `Accept-Ranges: bytes` already advertises them, so
   this is the designed behaviour, not an edge case. Measure it if you can —
   the e2e fixture server plus a browser will tell you the real burst size —
   and write the number into the Log. **A per-IP, per-minute bucket sized like
   `jobs` (5) turns an ordinary scrub into a 429 mid-playback.**

2. **Key the bucket by token, not only by IP.** `clientKey(request.ip)` is what
   the other two routes use because the thing being protected there is the
   service. Here the thing being protected is a _file_, and the token is the
   identifier that both names it and bounds who may ask. Keying on the token
   means one leaked link cannot outrun its own bucket while every other user's
   link is untouched — and it survives a client behind CGNAT, which an IP key
   does not. Decide whether to key on the token alone or on the pair; say which
   in the Log and why.

3. **Size it for bytes, not for requests.** A request count is the wrong meter
   for a route whose cost is proportional to the range served. Either pick a
   per-minute count high enough to swallow a seek burst (and say what number you
   measured in step 1), or meter bytes and let a request count stay generous.
   Prefer the simpler of the two that survives step 1's measurement — do not
   build a byte meter if a count of 120 demonstrably does not break playback.

4. **Wire it the way the other two are wired.** `rateLimitFilesPerMinute` in
   `ApiConfig` with a `RATE_LIMIT_FILES_PER_MINUTE` env override and a default
   in `API_DEFAULTS`; a `files` limiter in `context.rateLimits`; the hook on the
   route with `scope: "files"`. `RateLimiter` already treats `perMinute: 0` as
   disabled, which is the escape hatch for an operator who serves large files to
   a small audience — check that, do not assume it.

5. **Watch the error path.** The hook throws `RATE_LIMITED`, which the error
   handler renders as a 429 with `Retry-After`. Confirm that is still true when
   it fires on this route, and that a 429 arriving _before_ any body is written
   does not leave the `Content-Disposition` and `Content-Type` headers set from
   a previous attempt — the route sets those before it reads `Range`, and an
   `onRequest` hook runs before all of it, so this should be clean. Prove it
   rather than reasoning about it.

Traps worth knowing in advance:

- **`trustProxy` decides whether an IP key means anything.** It is off by
  default, and with it off `request.ip` behind a reverse proxy is the proxy.
  That is another argument for the token key in step 2; the note on
  `ApiConfig.trustProxy` has the reasoning.
- **The retention sweep can delete the file mid-stream.** Unrelated to this
  ticket, but you will be writing range tests and may trip it. `FILE_EXPIRED`
  is the intended answer.

## Done when

1. `GET /api/files/:token` refuses with 429 and a `Retry-After` header once its
   limit is exhausted, proven by a test in `tools/downloader/api/test/`.
2. A burst of `Range` requests of the size measured in Build step 1 completes
   without a 429 at the shipped default, proven by a test.
3. `RATE_LIMIT_FILES_PER_MINUTE=0` disables the limit, proven by a test.
4. The limiter is keyed as Build step 2 decides, and a second token from the
   same client is unaffected by the first token's exhausted bucket — proven by
   a test.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-08-23** — Filed from CodeQL alert 3 (`js/missing-rate-limiting`, high,
  `routes/files.ts:69`) during a triage of the four open code-scanning alerts.
  The alert text names the `fs.stat`; the read stream is the actual cost and the
  brief above says so. The other three alerts from that run: two dismissed as
  false positives (the egress proxy's SSRF, which `guard.assertAllowed` and the
  pinning lookup already answer, and a `startsWith` inside a test double), and
  one filed as [dl-24](./dl-24-classify-wvtt-as-webvtt.md).
