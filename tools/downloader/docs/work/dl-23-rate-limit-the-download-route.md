---
id: dl-23
tool: downloader
title: Meter the download route, without breaking a seeking video player
kind: fix
status: done
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
2. **The realistic scrub minute** measured in Build step 1 — 274 `Range`
   requests, the worst of the _interrupted_ drag patterns and the one measured
   with a 40 ms round trip in the way — completes without a 429 at the shipped
   default, proven by a test. **Not every number step 1 measured.** An unbroken
   60-second drag of the scrub bar is 965 requests (1211 when gate A reproduced
   it), which is over the limit and is a deliberate exclusion, not an oversight:
   see the tradeoff recorded in the Log. Amended on 2026-08-31 from "a burst of
   `Range` requests of the size measured in Build step 1", which read as a claim
   over all of step 1's numbers and was not one any test made.
3. `RATE_LIMIT_FILES_PER_MINUTE=0` disables the limit, proven by a test.
4. The limiter is keyed as Build step 2 decides, and a second token from the
   same client is unaffected by the first token's exhausted bucket — proven by
   a test.
5. `npm run check` and `npm test -- --project downloader` pass.

## Gates

Two gates ran in parallel on 2026-08-31, split by setup: **A** on the
measurement, with real browsers; **B** on the code and this repo's invariants.
Both ran on Sonnet against an Opus build. Both returned **CONCERNS**.

Both records below are **written from the coordinator's relay of the reviews, by
the builder — they are not the reviewers' own text.** Symbol and path names are
preferred over `file:line` spans so the record cannot drift as the code moves.

### Gate A — the measurement (2026-08-31, Sonnet on an Opus build) — CONCERNS

Reproduced the central claim independently with real browsers: **6 requests /
121 MB** for a load plus five deliberate seeks, matching the builder's table. Read
the `delivered`-bytes caveat out of the measurement rig and confirmed it accurate.

Extended the measurement to the other engines, favourably: **Firefox issues 3
requests for a full continuous drag** — it barely re-requests at all — and WebKit
~883 raw, ~560 with the latency control. **No engine fans out per seek.** Chromium
is the demanding one, so sizing to Chromium sizes to all three.

- **med — Done-when 2 over-claimed.** It read "a burst of `Range` requests of the
  size measured in Build step 1", but step 1 measured several numbers including
  965, and gate A reproduced an unbroken 60-second drag at **1211 req/min** with
  the builder's own 40 ms control — over the limit. The only number any test pins
  is 274. **Resolved by the user: keep 600, tighten the wording.** Done-when 2 is
  amended to name the interrupted-scrub scenario it actually covers, and the
  continuous-drag exclusion is recorded as a deliberate tradeoff in the Log.
- **low — a wording error in the Log.** The claim that the 120-default test
  "fails at seek 120" was wrong: it fails at the guard that opens the test,
  before the request loop runs. Corrected.
- **Gap stated rather than papered over:** gate A could not capture a 429 on a
  request the `<video>` element itself issued, as opposed to a direct Node fetch.
  It showed the route refusing a real client and the player degrading immediately
  afterwards. Nothing to fix; recorded so the evidence is not overstated.

### Gate B — code and invariants (2026-08-31, Sonnet on an Opus build) — CONCERNS

Confirmed, so it need not be re-checked: `RATE_LIMITED` is the shared
`@webtools/core` code with no re-wording at the call site; the 429 travels the
real Fastify stack via `.inject()` on `createApp()`; the hook is genuinely wired
per route; every citation in `.env.example`, `docs/02-DEPLOYMENT.md`,
`tools/downloader/CLAUDE.md` and the Log resolves; the dl-29 trap-note edit is
accurate and leaves nothing dangling. It also confirmed by counting — not
estimating — that leaving `RATE_LIMIT_FILES_PER_MINUTE` un-zeroed in
`playwright.config.ts` was right: `download.spec.ts` makes exactly one
`GET /api/files/:token` per run under `workers: 1`, `fullyParallel: false`,
`retries: 0`.

- **high — the file token reached unredacted log lines on every request to this
  route.** Pre-existing, not introduced here; `redactUrl` and `redactHeaders`
  were imported nowhere in the downloader API. The reviewer reproduced a line
  containing a literal token on an ordinary 200. The user chose to **fold the fix
  in here rather than file it**. Fixed: `redactLoggedUrl` in `request-log.ts`,
  applied at both global sites. `redactUrl` was measured to be the wrong
  instrument and was not used; the reasoning is on the function and in the Log.
  `@webtools/core` is untouched.
- **med — the shared seam was unpinned.** Mutating `createRateLimitHook`'s
  default key to a constant produced zero failures. Reproduced, and found worse
  than reported: the mutant survives **all 228 tests in the api suite**, not just
  the 29 in `rate-limit.test.ts`. Two tests now inject distinct `remoteAddress`
  values through the wired hook; both go red against the mutant.
- **low — `fileBucketKey`'s comment overstated its fallback.** `isWellFormedToken`
  checks length and charset, not existence, so well-formed guesses still mint a
  bucket each; `maxKeys` is what bounds the map. Comment corrected to describe
  what actually protects it.
- **resolved, no action — key truncation.** 16 base64url characters is 96 bits;
  forcing a collision needs a ~2^96 preimage, and the worst outcome is two files
  sharing a bucket, never an authorisation bypass.

## Log

- **2026-08-23** — Filed from CodeQL alert 3 (`js/missing-rate-limiting`, high,
  `routes/files.ts:69`) during a triage of the four open code-scanning alerts.
  The alert text names the `fs.stat`; the read stream is the actual cost and the
  brief above says so. The other three alerts from that run: two dismissed as
  false positives (the egress proxy's SSRF, which `guard.assertAllowed` and the
  pinning lookup already answer, and a `startsWith` inside a test double), and
  one filed as [dl-24](./dl-24-classify-wvtt-as-webvtt.md).
- **2026-08-30** — Built. `files` bucket keyed on the file token, default 600
  per minute, wired the way the other two are.

  **Step 1, the measurement, and what it overturned.** Driven with real
  Chromium 1234 (`/ms-playwright`, via `playwright-core`) against a Node origin
  reimplementing this route's `parseRange` and headers byte for byte, serving a
  120 s / 39.6 MB H.264 clip generated by the same `ffmpeg-static` the engine
  uses. Rig in `scratchpad/dl-23/` (`measure.mjs`, `drag.mjs`, `attacker.mjs`) —
  scratch, not committed.

  | client                                   | requests / 60 s | requested bytes | delivered bytes |
  | ---------------------------------------- | --------------: | --------------: | --------------: |
  | load + 5 deliberate seeks (`+faststart`) |               6 |          121 MB |          121 MB |
  | same, non-`faststart` mp4                |               8 |          161 MB |          161 MB |
  | six 2 s scrub-bar drags + playback       |             207 |         4.35 GB |         1.44 GB |
  | same, 40 ms of simulated round trip      |             274 |         5.92 GB |          428 MB |
  | one unbroken 60 s drag                   |             965 |         18.7 GB |         7.08 GB |
  | a plain loop, 8 sockets, 1 MB slices     |          24,132 |         25.3 GB |         25.3 GB |

  **The brief's model of the burst is wrong, and wrong in the safe direction.**
  It expects "a burst of `Range` requests to build its seek index, and one more
  every time the user scrubs". Chromium does not build a seek index over HTTP
  for a progressive mp4: it issues **one open-ended `bytes=N-` request per
  completed seek** and abandons the response when the next seek arrives. Loading
  a `+faststart` file is a single `bytes=0-`; a non-`faststart` file costs three
  (head, tail for `moov`, then re-open at the data). So the _per-seek_ burst is
  1, not many.

  What that understates is the _rate_: because one request is one seek and a
  seek completes in tens of milliseconds, a user dragging the scrub bar issues
  requests as fast as the link allows. Hence 207–274 in a realistic heavy minute
  and 965 in a pathological one. **The brief's own suggested number, 120, breaks
  playback**, and I proved it rather than argued it: with
  `API_DEFAULTS.rateLimitFilesPerMinute` temporarily set to 120, the
  "measured burst passes at the shipped default" test goes red. It fails at the
  guard `expect(MEASURED_SCRUB_BURST).toBeLessThan(API_DEFAULTS.…)` that opens
  the test, before the request loop under it runs at all — corrected on
  2026-08-31 from "fails at seek 120", which described a loop that never got the
  chance. Set back to 600 and it passes.

  Two smaller corrections to the brief. `Content-Disposition: attachment` plus
  `Content-Type: application/octet-stream` — the headers this route actually
  sends — do **not** stop a `<video>` element playing the link; measured
  identical to a `video/mp4` origin. And the "retention sweep deletes the file
  mid-stream" trap never fired: nothing here writes range tests against a
  sweeping harness.

  **Decision 1 — the key: the token alone, hashed.** The pair `(token, ip)` was
  the rejected reading, and it is rejected for the reason step 2 exists: a
  leaked link fetched from a thousand addresses would get a thousand fresh
  allowances, so the pair meters exactly nobody in the case worth metering.
  Token alone also survives CGNAT and a reverse proxy with `trustProxy` off,
  which is its default. The cost is that a person watching one link on two
  devices shares one bucket — at 600/min that is two heavy scrubbers' worth, so
  it is not a real cost. Token acquisition is already bounded by the `jobs`
  bucket at 5/min per IP, so "hold N tokens for N×600" composes correctly rather
  than being a hole.

  The key is `sha256(token)` truncated to 16 base64url characters, not the token.
  `createRateLimitHook` puts the key in its `logger.warn` line, and a file token
  is a live credential — writing one to a log is the same defect `redactUrl`
  exists to prevent. A malformed token cannot name a file, so it falls back to
  `ip:<clientKey>`: a scanner then shares one allowance instead of minting a
  bucket per guess, and its noise stays out of every real file's bucket. Both
  are tested.

  **Decision 2 — size by request count, not bytes.** The rejected reading is a
  byte meter, and the measurement kills it on its own terms. _Requested_ bytes
  are meaningless here: every Chromium seek asks for the whole tail and
  abandons it, so an honest 39 MB file "requested" 5.92 GB in a minute — any
  budget clearing that meters nothing. _Delivered_ bytes are the real cost but
  swing 17× with the client's link (428 MB to 7.08 GB for identical user
  behaviour), can only be counted after the fact, and would need a spend-N API
  on `@webtools/core`'s `RateLimiter`, which the planner shares. That is a
  contract-adjacent change to shared code for one route. The brief's instruction
  was to prefer the simpler of the two that survives step 1; the count survives
  at 600 rather than at 120, so 600 it is.

  **Say plainly what 600 does and does not buy.** It bounds request _rate_ — the
  `fs.stat`, the open, and how many read streams one link can churn — and cuts
  the measured unmetered hammer by roughly forty. It does **not** bound egress:
  a caller inside 600/min can still ask for whole-file ranges. Nothing in this
  ticket changes that, and the things that actually bound bytes are
  `MAX_FILE_SIZE_MB`, `MAX_TOTAL_STORAGE_GB` and the retention window. If egress
  is the worry, the answer is a byte meter in core, which is its own ticket.

  **Step 4, checked rather than assumed.** `RateLimiter` treats `perMinute: 0`
  as disabled — asserted via `context.rateLimits.files.enabled` and by 50
  unrefused requests, and the `RateLimit-*` headers are absent in that state.

  **Step 5, proven rather than reasoned about.** A 429 from this route carries
  no `Content-Disposition`, no `Accept-Ranges` and no `Content-Range`, and its
  `Content-Type` is `application/json`. The `onRequest` hook fires before the
  handler sets any of them.

  **`createRateLimitHook` gained an optional `key`.** Three lines, defaulting to
  `clientKey(request.ip)`, so probe and jobs are unchanged. This is the one seam
  a future non-IP bucket needs.

  **Folded in, and left out.** Corrected the note on `ApiConfig.trustProxy`,
  which claimed _every_ per-IP limit is keyed on `request.ip` — now true of two
  of three, and the third is deliberately outside that dependency. Corrected
  dl-29's trap note, which cites `context.rateLimits` as `{ probe, jobs }`; its
  recommendation to add no bucket for the thumbnail route still stands and the
  Log there should still say so. Deliberately **not** set
  `RATE_LIMIT_FILES_PER_MINUTE=0` in `playwright.config.ts` alongside the other
  two: an e2e run downloads a handful of times, nowhere near 600, so leaving it
  on means the e2e exercises the shipped default instead of a disabled limiter.
  Deliberately **not** touched CodeQL alert 3 — dismissing or closing it is not
  this branch's to do.

- **2026-08-31** — Gate findings applied. Three code changes, two corrections to
  the entry above, and one tradeoff that was implied and is now written down.

  **The file token was reaching log lines on every request to this route, and
  that is now fixed here rather than filed.** Pre-existing, not introduced by the
  metering. Both hooks that log `request.url` for _every_ route wrote the token
  verbatim: the `onResponse` line in `request-log.ts` and the error handler in
  `server.ts`. `redactUrl` and `redactHeaders` were imported nowhere in the
  downloader API. Reproduced by removing the redaction after writing it and
  counting the leaked lines: **3** on a served-then-refused pair (the 200's
  request line, the 429's rejection line, the 429's request line) and **2** on an
  ordinary 410 expiry. So it leaked on success, on the pre-existing
  `FILE_EXPIRED` and `JOB_NOT_FOUND` paths, and on the `RATE_LIMITED` this
  ticket added.

  **`redactUrl` is the wrong instrument, and reaching for it would have made
  things worse in two directions at once.** It parses an _absolute_ URL and drops
  its _query string_, because the credential it was built for is a signed URL's
  HMAC. Here the credential is a **path segment**, and a Fastify `request.url` is
  origin-relative — so `new URL` throws and its `catch` returns
  `[unparsable-url]`, which would have blanked the URL on every log line in the
  service while still not addressing a path-segment secret had it parsed. The fix
  is `redactLoggedUrl` in `request-log.ts`: it replaces the segment after
  `ROUTES.file("")` and leaves every other URL byte-identical. The prefix is read
  off `ROUTES` rather than written out, so a route that moves takes its redaction
  with it. **No `@webtools/core` change was needed** — the shared package is
  untouched, which is why this did not have to come back as a question.

  Job ids are deliberately _not_ redacted. `jobs/tokens.ts` already states the
  distinction this reads off: the file token is the authorisation, and a job id
  is not a secret precisely because it already appears in URLs the client holds
  and on every orchestrator line. Redacting it would cost the request log its
  reason to exist. There is a test asserting `/api/jobs`, `?limit=5` and
  `/api/jobs/:id` survive untouched, so the cure cannot quietly become the
  disease.

  **The shared seam was unpinned, and worse than reported.** Mutating
  `createRateLimitHook`'s default key to a constant passed not just the 29 tests
  in `rate-limit.test.ts` but **all 228 tests in the api suite** — every
  `inject()` in the repo shares one simulated loopback address, so "clients have
  separate buckets" was only ever proven against the bare `RateLimiter`, never
  through the hook that has to ask it the right question. Two tests now inject
  distinct `remoteAddress` values through the wired `jobs` hook: one for two IPv4
  clients, one asserting a /64 is a single customer. Both go red against the
  mutant and green against the real default.

  **`fileBucketKey`'s fallback comment overstated itself.** It claimed the
  malformed-token branch stops a scanner minting a bucket per guess.
  `isWellFormedToken` checks length and charset, not existence, so a _well-formed_
  guess — the realistic case — still mints one. What bounds the map is
  `RateLimiter`'s `maxKeys` (10,000, least-recently-seen eviction), not that
  branch. The comment now says so, and says what the fallback does buy: junk
  shares one allowance, and no guess of any shape lands in a real file's bucket.
  Not exploitable either way; the claim was simply in the wrong place.

  **The continuous-drag exclusion, stated rather than implied.** 600/min clears
  every _interrupted_ scrub pattern measured — 274 at the top, with a 40 ms round
  trip — and does **not** clear an unbroken 60-second drag, measured at 965 here
  and 1211 on the gate's reproduction. Clearing that would need ~1500/min, at
  which point the bucket is 6% of the 24,132/min an unmetered hammer achieved and
  has stopped being a limit. The tradeoff taken: a user who drags the scrub bar
  continuously for a full minute without pausing gets a 429 and their player
  stops. That is a real cost, it is not hypothetical, and `RATE_LIMIT_FILES_PER_MINUTE`
  is the operator's answer if their audience does it. Done-when 2 above is
  amended to name the scenario the test actually covers.

  **The truncation question was raised and closed with no change**: 16 base64url
  characters is 96 bits, forcing a collision needs a ~2^96 preimage, and the worst
  outcome of one is two files sharing a bucket — never an authorisation bypass.

  Two claims in the entry above were checked by the gates and held: no engine
  fans out per seek (Firefox issues **3** requests for a full continuous drag,
  WebKit ~560 with the latency control — Chromium is the demanding one), and
  leaving `RATE_LIMIT_FILES_PER_MINUTE` un-zeroed in `playwright.config.ts` was
  right, confirmed by counting rather than estimating: `download.spec.ts` makes
  exactly one `GET /api/files/:token` per run under `workers: 1`,
  `fullyParallel: false`, `retries: 0`.
