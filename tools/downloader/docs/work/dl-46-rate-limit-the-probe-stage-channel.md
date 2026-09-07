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

## Review

### Gate — 2026-09-07, Sonnet reviewer

**Gate: PASS** — 2026-09-07 · `origin/main...HEAD` (`4fad5f8...8c965c5`, code
unchanged through `76076ac`) · manual defect hunt at medium, self-run (no
`code-review` tool available to the reviewing subagent)

| Done when                                                             | Proof                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Client over its limit refused with JSON error, no `text/event-stream` | `api/test/rate-limit.test.ts:703-742` (`:722-736`) ✓                                                                              |
| Refused probe still completes and answers normally                    | `api/test/rate-limit.test.ts:744-779` (`:762`, `:769-775`) ✓                                                                      |
| Client under its limit unaffected                                     | `api/test/rate-limit.test.ts:781-808` ✓                                                                                           |
| Default on, bucket covered like the other three                       | `api/test/rate-limit.test.ts:834-854` (probe-events), `:969-971` (thumbnail) ✓                                                    |
| `npm run check` and `npm test -- --project downloader` pass           | verified — both re-run at `8c965c5`: `npm run check` exit 0 (unpiped); `npm test -- --project downloader` 1167 passed, 71 files ✓ |

- **low** · The Log's earlier "tsc caveat" paragraph claimed an incremental
  `tsc --build` reported clean before catching a reintroduced `mediaUrl` error.
  The builder's own re-reproduction traced it to two shell mistakes, not a tsc
  or scope issue: the exit code was read after `| tail -5` (without `pipefail`,
  `$?` is `tail`'s status, always 0 — confirmed independently:
  `false | tail -5; echo $?` → `0`), and an earlier `| grep ... | head -20`
  truncated the TS2339 line out of the filtered stream (line 35 of 40).
  `tsc --build` caught the error on the first run it was given every time either
  of us tried it unpiped; `npm run check` was never at risk. Corrected on the
  branch at `76076ac`.
- **settled, two findings one mechanism** · Named per the ticket's own
  instruction, not raised as defects. (a) `POST /api/probe` has used the
  identical key (`clientKey(request.ip)`) and identical default (10/min) since
  dl-6, and the two endpoints are spent one-for-one by construction — so there
  is no configuration in which a CGNAT-shared address is refused by
  `probeEvents` that the `probe` bucket was not already refusing in the same
  breath; the narration is refused alongside an analysis that is itself being
  refused and told properly. (b) confirmed via
  `grep -rn probeGate tools/downloader/api/src/` (`server.ts:493`,
  `routes/probe.ts:105,109`) — nothing gates the SSE hub globally, so two
  distinct addresses suffice to fill all 64 channels between them, each
  individually under its own ~40-channel ceiling. Both inherent to the owner's
  per-IP decision and the ticket's own scope; not this branch's to fix.
- **dropped** · "8 s" vs my measured 60017–60019 ms was not a discrepancy: the
  builder's red check used `--testTimeout=8000` to keep it cheap; mine used the
  project default (60000ms). Both correct at their configuration.
- **dropped** · Whether the three probe-events red-run tests "genuinely bind the
  limit or merely observe sockets hang": reproduced the causal chain directly —
  without the hook, the over-limit subscribe is served and holds its socket until
  the test times out, because nothing ever posts the matching probe. Traceable
  consequence of removing the limiter, not an unrelated hang. Legitimate, just
  slower/less specific than an assertion. Builder concurs, no disagreement.
- **findings** · manual hunt returned 4; 2 carried (1 low, 1 settled/informational
  merged from 2), 2 dropped.
- Invariants walked: `AppError`/`RATE_LIMITED` from core taxonomy ✓;
  redact-before-log ✓ (hashed key, pinned by test); no cross-bucket spending ✓
  (five separate `RateLimiter`s); style (no `any`/`console`, `import type`,
  `node:` protocol) ✓. Skipped as not applicable: no-shell, SSRF, faked-progress,
  contract-package edit, new-test registration, Dockerfile workspace list — diff
  touches none of them.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability ✓
  (`capabilityBucketKey` extraction on its second real consumer).

## Log

- **2026-09-07 — Build step 5's key answered by the owner: the token, as
  built.** The builder read the earlier "per IP" answer as governing step 1
  only, implemented step 5 on the token, and surfaced the reading rather than
  letting it merge unremarked. Options put: **A, the token key** (the builder's
  recommendation, listed first — it matches this ticket's own "the token is the
  likelier key", it matches `/api/files/:token`, a leaked token cannot buy more
  allowance by being fetched from more addresses, and it survives CGNAT and
  `TRUST_PROXY` being off); **B, per IP**, if the earlier answer was meant to
  reach step 5, at the cost of one test rewrite. **A was chosen**, so **the
  "per IP" answer below governs Build step 1 only** and no code changed. The
  entry below stands as written, including its own note that this was the one
  place the two readings diverged.

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
    reads, and surfaced as an open decision rather than settled in the commit —
    **the owner has since confirmed the token key and that reading; see the
    entry above it.**
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

  **What this does not close, named by the gate and stated here rather than
  left implicit** — both inherent to the per-IP decision, neither a defect in
  it:

  - **Behind CGNAT, with `TRUST_PROXY` off, a crowd sharing one address shares
    one bucket.** True, and **this endpoint adds nothing to it**: `POST
/api/probe` has had the identical key and the identical number since dl-6,
    and the two are spent one-for-one, so the analysis behind a throttled
    narration is being refused in the same breath. There is no configuration in
    which this bucket bites a real user that the probe bucket was not already
    biting. That is the property the equal default was chosen for, read from the
    other end.
  - **A distributed fill of `MAX_CHANNELS` is still possible.** Nothing gates
    the hub globally the way `probeGate` gates `POST /api/probe` — verified,
    `context.probeGate` is referenced only in `routes/probe.ts`. Two addresses
    are enough for 64 channels, since one holds 40. This ticket's subject is the
    single unauthenticated address, and that is closed; the distributed case
    costs an attacker addresses and still only denies narration, which is the
    blast radius **Why** already bounds. Left open deliberately, not overlooked.

  Two things caught late, both worth the space:

  - **A green assertion that proved nothing**, caught by `tsc` and not by the
    run: `expect(probed.json().probe.mediaUrl).toBe(probeResult().mediaUrl)`
    compared `undefined` to `undefined`, because `ProbeResult` has no
    `mediaUrl` and `.json()` is untyped. It passed. `npm run check` failed on
    the right-hand side, which is the argument for tests being typechecked by
    the same gate the source is. Replaced with `title`, the variant count and
    `cached === false`.
  - **The builder reported that gate clean once while it was failing, and the
    fault was the builder's, not the toolchain's.** The first draft of this
    entry blamed `tsc --build`'s incremental cache. The gate's reviewer could
    not reproduce that and asked for the literal commands, which settled it in
    one run. Two shell mistakes, both reproduced on this branch with the bug
    deliberately reintroduced:

    - `npm run check 2>&1 | tail -5; echo "EXIT:$?"` prints **`EXIT:0` while
      the real exit code is 1**. Without `pipefail`, `$?` after a pipeline is
      the _last_ command's status — `tail`'s, which always succeeds. The
      unpiped `npm run check >/dev/null 2>&1; echo $?` on the same tree prints
      `1`.
    - `npm run check 2>&1 | grep -E "error|…" | head -20` hid the message
      itself: `--verbose` prints a per-project line for all nineteen projects,
      so `TS2339` was **line 35 of a 40-line filtered stream** and `head -20`
      cut it off.

    So `tsc` never lied and the standard gate is not at risk. **Never read an
    exit code through a pipe**, and do not filter a gate's output with a
    fixed-height `head` when the thing you are looking for is at the end.
    `--force` was not the fix and was never needed; the numbers below are from
    unpiped runs.

  Gates, all from unpiped runs: `npm run check` exit 0,
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
  endpoint's red, not a weaker one substituted for it. **The timeout is 60 s,
  the project's `testTimeout`.** The builder's red runs passed
  `--testTimeout=8000` to shorten them and reported "8 s" from that; the gate
  ran the suite unmodified and got 60 s. Both numbers are real, the flag is the
  whole difference, and the second is the one anyone re-running this will see.

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
