---
id: dl-46
tool: downloader
title: Rate-limit the probe stage channel, which is the one open endpoint without a bucket
kind: fix
status: done
milestone: null
depends_on: [dl-43]
---

# dl-46 — a bucket for `/api/probe/:id/events`

**Packages:** `api` (`routes/probe-events.ts`, `probe-stages.ts`, `config.ts`,
`context.ts`, `server.ts`).

dl-43 added `GET /api/probe/:id/events`, the SSE channel that narrates an
analysis. It is the only client-facing endpoint in this service with no per-IP
bucket of its own, and its global cap can be filled by anyone who can reach it.
**This ticket is about what dl-43 left, not about what dl-43 found** — the cheap
half is closed and has a regression test.

## Why

### What is already fixed, so nobody re-fixes it

Subscribing creates a channel, and until dl-43's second commit the unsubscribe
dropped only the listener — nothing but the 180 s sweep reclaimed the channel
itself. So **64 fire-and-forget requests, connecting and hanging up immediately,
filled `MAX_CHANNELS` with no socket held**. Measured on the unfixed hub by two
readers independently: `channelCount` 64, and the next real probe's
`open()` returned `false`.

That is closed. `Channel.claimed` is set only by the probe route, and an
unclaimed channel whose last listener leaves is reclaimed at once
([`api/src/probe-stages.ts:148 "!current.claimed && current.listeners.size === 0"`](../../api/src/probe-stages.ts)), pinned by
[`api/test/probe-stages.test.ts:127 "frees its channel immediately"`](../../api/test/probe-stages.test.ts) which
was run red against the unfixed hub (`expected 64 to be +0`).

### What is left

**64 concurrently held connections still fill the cap.** The attacker now has to
keep the sockets open, which is bounded by the server's own connection limits
rather than by anything this service decides — and while they are held,
`context.probeStages.open()` returns `false` for every other user's probe.

The blast radius is narrow and worth stating precisely, because it is the reason
this was not urgent enough to fold into dl-43:

- **No analysis fails.** `routes/probe.ts` treats a refused channel as "run
  unnarrated" — `narrating` is false, `onStage` is never attached, the probe
  proceeds and answers normally.
- **What is lost is the narration**, so the visible symptom is the analysing
  panel sitting on _"Sent to the server — waiting for it to start"_ for the whole
  of a browser probe. Which is, exactly, the pre-dl-43 experience.
- **Nothing leaks.** A guessed or squatted id can only subscribe;
  `routes/probe-events.ts` has no write path, and `PROBE_STAGES` is a closed
  vocabulary carrying no URL, title or header.

So this is a denial of a decoration, not of the product — but it is a denial
available to an unauthenticated client for the cost of holding 64 sockets, and
the endpoint is new, which is the argument for closing it rather than living with
it.

## Decision — answered 2026-09-07 by the owner, not open

**The question was:** add the limiter inside dl-43 before its PR, or file it?

**The answer: file it and ship dl-43.** It was both the builder's and the gate's
recommendation, so nobody was overridden, and the owner was told explicitly that
dl-43 is the branch _introducing_ the endpoint — the choice was whether to ship a
new residual, not whether to tolerate an old one.

**The reasoning, so it is not re-opened as an oversight:** a rate-limit policy is
a decision about `rateLimits` in `config.ts`, which is where the buckets that
protect real work are chosen and tuned. It does not belong in a ticket about
progress narration, and dl-43 had already been deliberately widened once — from
pure UI into `contract`, `resolvers` and `api` — to make the narration real at
all. Widening it a second time, into admission control, would have made one
branch answer three unrelated questions.

## Build

1. **Decide the bucket's shape first, and it is the only real decision here.**
   The existing three (`probe`, `jobs`, `files`) are in
   [`tools/downloader/api/src/context.ts:83 "rateLimits: { probe: RateLimiter"`](../../api/src/context.ts), built in `server.ts` from
   `config.rateLimit*PerMinute`. `files` is the interesting precedent: it is keyed
   on the file's capability token rather than the IP, "because what it protects is
   one file rather than the service" (`fileBucketKey` in `routes/files.ts`). Ask
   which this is — per IP, per probe id, or both — rather than assuming per IP.
2. Add the config knob beside its siblings, defaulting **on**. Every existing
   limiter defaults on and is switched off explicitly by the test harness; a new
   one that defaulted off would be the only unprotected endpoint again, silently.
3. Apply `createRateLimitHook` in `registerProbeEventRoutes`, before the
   subscribe. It must run **before** any streaming header is written — the route
   already has this constraint for the hub's cap refusal, and the comment there
   says why: a refusal has to be a normal JSON error rather than an event stream
   that says nothing.
4. Decide what a throttled client is told. `RATE_LIMITED` with a `Retry-After` is
   the house pattern (`GATE_RETRY_AFTER_SEC` in `routes/probe.ts`), but the web
   client currently treats **any** channel failure as "narration stops, analysis
   continues" (`App.tsx`'s `onError` is deliberately empty). Check whether that is
   still the behaviour you want when the reason is a limit rather than a drop; if
   it is, say so in the Log rather than leaving it looking unconsidered.

5. **`GET /api/thumbnail/:token` needs the same call, and it is the same
   question.** It is the other client-facing route with no bucket, and dl-44
   changed what a miss costs it: it used to answer from a `Map`, and now falls
   through to SQLite and a file read
   ([`api/src/routes/thumbnail.ts:25 "Why it is still not rate limited"`](../../api/src/routes/thumbnail.ts)).
   The exposure, as dl-44's gate measured it: **up to 512 KB per request,
   unlimited requests per minute, per valid token, for up to
   `fileRetentionHours` (default 6 h)**. Mitigated but not closed — the token is
   a 256-bit capability, a malformed one is rejected on shape before the
   database is touched, and the response is `private, max-age=300`. Step 1's
   question applies unchanged, and `fileBucketKey` is the same precedent: what
   this protects is one image rather than the service, so the token is the
   likelier key. **Answered as "leave it for now" on dl-44 by the owner, on the
   condition that it be carried here rather than left implicit** — so this step
   is inherited work, not a new finding, and the route's own docblock is the
   honest statement of the exposure in the meantime.

**Do not raise `MAX_CHANNELS` instead.** It is not the defence — that is written
into its own docblock now, in the words this ticket is quoting — and raising it
only raises the number of sockets an attacker has to hold.

## Done when

- A test proves a client over its limit is refused the channel with a normal
  JSON error and no `text/event-stream` header, rather than an empty stream.
- A test proves a probe whose channel was refused still completes and answers
  normally — the analysis is the product, the narration is not.
- A test proves a client under its limit is unaffected, so the limiter cannot
  pass by refusing everyone.
- The default is on, and `api/test/rate-limit.test.ts` covers this bucket the way
  it covers the other three.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-07 — built.** `rateLimitProbeEventsPerMinute` (default **10**,
  `RATE_LIMIT_PROBE_EVENTS_PER_MINUTE`) and a `createRateLimitHook` on
  `registerProbeEventRoutes`, keyed per IP as answered. Step 5's thumbnail
  bucket landed with it: `rateLimitThumbnailPerMinute` (default **60**), keyed
  on the token. What the brief did not settle, and what was decided here:

  - **The limit is 10/min**, copied from `POST /api/probe` — not from `files`,
    which is a video player's rate and would be meaningless here. Two reasons,
    and the second is the one that sizes it: the endpoints are used exactly
    one-for-one (`App.tsx` opens the stream, then POSTs the probe it names), so
    an equal allowance means this bucket can never be what refuses a client
    still inside its probe allowance; and a rate has to be checked against the
    concurrency it is meant to bound. A subscriber's socket is closed after
    `CHANNEL_TTL_MS` (180 s), so the channels one bucket key holds at once are
    the requests it can make in that window — a full bucket's burst **plus** the
    refill over it, `perMinute * (1 + 3)`, which is **40 of `MAX_CHANNELS`'
    64**. Under the cap, so one address cannot fill the hub alone; the ceiling
    for this default is 15. Written here because the first draft of this
    reasoning said 30 and shipped it into three comments: it dropped the burst
    term, which understates the bound by a quarter and is exactly the mistake
    that would make a raised default look safe. The arithmetic is pinned by a
    test now rather than left in prose.
  - **A throttled client is told `RATE_LIMITED` with `Retry-After`**, the house
    pattern, because the hook already is it. What the ticket asked to check is
    below.
  - **Step 4: `App.tsx`'s empty `onError` is still right, and no `web` file
    changed.** The seam map was right that the ticket's `**Packages:** api` does
    not cover `web/src/App.tsx`; the answer is that step 4 is a check whose
    verdict is "no change", not work in `web`. Two reasons it holds. The
    transport already treats every failure identically —
    `web/src/api/http.ts`'s `openProbeEvents` closes the source and calls
    `onError()` with no reconnect, and it cannot do better: `EventSource`
    exposes neither the status code nor the body of a failed handshake to the
    page, so the client **cannot** tell a 429 from a dropped socket even if it
    wanted to. And it should not want to: the analysis is a separate request
    that is still in flight, and a client inside its probe allowance is inside
    this one by construction, so a 429 here means the probe itself is about to
    be refused and told properly. Surfacing "narration was rate limited" would
    be a second error message for a request that has not failed.
  - **Step 5's key is the token, and this is the one place the owner's answer
    may not reach.** The question put to the owner was step 1's, whose options
    were probe-id-shaped; the ticket says step 1's question "applies unchanged"
    to the thumbnail route while itself concluding "the token is the likelier
    key", and `fileBucketKey` is the named precedent. Implemented as the ticket
    reads. If the answer was meant to cover step 5 too, it is one line: drop
    `key:` from `registerThumbnailRoute` and the default IP key applies.
  - **`fileBucketKey` moved to `rate-limit.ts` as `capabilityBucketKey`**, on
    the "second real consumer" rule — its logic (hash the token, fall back to
    the address when it is not well formed) is identical for both routes and its
    docblock is the one place that reasoning lives. Behaviour is unchanged;
    `files.ts` keeps its own comment saying which key it passes and why. The two
    routes hold separate `RateLimiter`s, so a shared key format cannot let one
    spend the other's allowance.

  What the brief and the code had wrong:

  - **`routes/probe-events.ts` said the hub's cap refusal "is a 503".** It is a
    429: the code is `RATE_LIMITED` and `http-errors.ts` maps it to 429, and has
    since before dl-43. A stale sentence in dl-43's own docblock, corrected in
    place rather than filed.
  - **`probe-stages.ts`'s `MAX_CHANNELS` docblock ended "a per-IP limiter … is
    deliberately not decided here"**, which is now false. Rewritten to say what
    the bucket bounds and to keep the load-bearing half — the cap is still not
    the defence on its own.
  - **The load-test escape hatch in `tools/downloader/CLAUDE.md` would have gone
    stale silently.** It turns off three limiters by name; a fourth and fifth
    would have left the load test tripping a limiter it thought it had disabled.
    Updated, along with `.env.example`, `docs/02-DEPLOYMENT.md` and this tool's
    `01-ARCHITECTURE.md`, whose rate-limiting bullet now states the _property_
    ("every client-facing route has a bucket") rather than a list of two that
    goes out of date on the next route.
  - **An asymmetry worth knowing rather than rediscovering:** the advisory
    `RateLimit-*` headers survive a refusal, which is an ordinary Fastify error
    response, but not an _allowed_ subscribe — this route writes its headers
    straight to `reply.raw`, bypassing Fastify's header store. Left alone and
    pinned by an assertion: `EventSource` exposes no response headers to the
    page at all, so nothing can read them.

  Two things caught late, both worth the space:

  - **A green assertion that proved nothing**, caught by `tsc` and not by the
    run: `expect(probed.json().probe.mediaUrl).toBe(probeResult().mediaUrl)`
    compared `undefined` to `undefined`, because `ProbeResult` has no
    `mediaUrl` and `.json()` is untyped. It passed. `npm run check` failed on
    the right-hand side, which is the argument for tests being typechecked by
    the same gate the source is. Replaced with `title`, the variant count and
    `cached === false`.
  - **`tsc --build` reported clean over that file once before it reported the
    error**, on an incremental run. If a typecheck matters to a claim, force it:
    `npx tsc --build --force` is what the numbers below were taken from.

  Gates: `npm run check` exit 0 (after `tsc --build --force`, also exit 0),
  `npm test -- --project downloader` 1167 passed in 71 files, and the whole
  `npm test` — 2273 in 133 files — because this touched repo-level
  `.env.example` and `docs/02-DEPLOYMENT.md`. Not run: the Playwright suites and
  the container build, neither of which this reaches. The six new route tests
  were **run red first**, by replacing
  `{ onRequest: rateLimit }` with `{}` on both routes: the three thumbnail ones
  fail on their assertions, and the three probe-events ones fail by timing out —
  without the hook an over-limit subscribe is _served_, and an allowed subscribe
  holds its socket until the probe it names ends, which for a probe that never
  comes is the whole `CHANNEL_TTL_MS`. That is the honest shape of this
  endpoint's red, not a weaker one substituted for it.

- **2026-09-07 — Build step 1 answered by the owner: per IP, matching the other
  endpoints.** The question was what the new bucket is keyed on. Options put:
  **per IP** (recommended, and chosen); **both per IP and per probe id**;
  **per probe id alone**; **let the builder decide**. The three rejected ones
  all turn on the same fact — a probe id is minted by the client and costs
  nothing to mint, so a bucket named by one is a bucket refilled by changing a
  string, and `fileBucketKey`'s precedent does not transfer because a file token
  is a capability _this service issued_. Recorded here because the answer fixes
  only the **key**: the limit, the window and what a throttled client is told
  were left to the build and are in the entry above.

- **2026-09-07 — Build step 5 added from dl-44**, which persisted thumbnail
  bytes to disk and so changed what a miss on `/api/thumbnail/:token` costs. The
  owner answered dl-44's rate-limit question as "leave it, and fold the
  follow-up into dl-46"; the measured exposure travels with it in the step
  above. Nothing else here is touched — status, decision and scope are
  unchanged, and no part of this ticket has been implemented.

- **2026-09-07 — filed** out of dl-43's gate, which found the exhaustion and
  carried it as a finding. The cheap fire-and-forget half was repaired inside
  dl-43 with a regression test; this ticket is the residual only. The numbers in
  **Why** are measured, not estimated — 64/64 with the next probe refused, by the
  builder and the reviewer independently, before any code moved. Filed rather
  than folded in by the owner's decision, recorded above.
