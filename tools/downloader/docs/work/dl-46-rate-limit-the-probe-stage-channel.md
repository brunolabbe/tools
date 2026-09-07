---
id: dl-46
tool: downloader
title: Rate-limit the probe stage channel, which is the one open endpoint without a bucket
kind: fix
status: ready
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
