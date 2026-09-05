---
id: dl-37
tool: downloader
title: Move Chromium and yt-dlp onto the terminating egress proxy
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: hard
---

# dl-37 — the resolver tiers get the operator's trust, by moving proxies

**Packages:** `api` (`server.ts`, `egress-proxy.ts`, `tls-interception.ts`),
`resolvers` (`browser/pool.ts`, `resolvers/ytdlp.ts`).

This is **half one of [dl-34](./dl-34-resolver-tiers-and-the-operator-ca.md)**,
filed separately when dl-34 closed on its built half. dl-34 has the full
reproduction and the operator-facing symptom; this ticket has the decision, its
cost, and what a builder must not repeat. Read dl-34's `## Why` first — it is
not copied here.

## Why

An operator whose origins chain to a private root sets `EGRESS_CA_FILE`. It
reaches this process's own fetches, ffmpeg, and the egress proxy that verifies
on ffmpeg's behalf. It does **not** reach Chromium or yt-dlp, which are handed a
_tunnelling_ proxy and verify against their own trust stores — stores nothing in
this repo writes to. So the two tiers that actually load the page fail on a
deployment the setting exists to serve.

Since dl-34 they at least **say so**: both tiers now raise
`TLS_VERIFICATION_FAILED` with a hint naming the setting, and boot warns which
components the CA file reaches. That is the whole of what naming can do. This
ticket is the part that makes it work.

## The decision, answered 2026-09-03 — not open

**Move both resolver tiers onto dl-27's terminating proxy.** dl-27 already built
a proxy that terminates TLS and mints leaves from a generated root, and ffmpeg
is on it; putting the tiers on it too gives them the operator's trust for free,
with no per-tier trust-anchor flag at all.

**Superseded, and do not build it: the per-tier anchor.** dl-34's Build step 1
described wiring each tier to the operator's root directly — `NODE_EXTRA_CA_CERTS`
for Chromium's Node-side fetches, `--ca-certificate` or `SSL_CERT_FILE` /
`REQUESTS_CA_BUNDLE` for yt-dlp's Python stack. Those are three different
mechanisms with three different failure modes, and the user chose the proxy move
instead. They are recorded here only so nobody rediscovers them and builds one.

### The cost that came with the answer

This is the part that must survive into the implementation, because the branch
that does this work has to **rewrite a decline that is still in the tree**:

- **Every HTTPS page Chromium loads would cross this process in plaintext.**
  [`downloader/api/src/server.ts:118-130`](../../api/src/server.ts) says so in
  the first person and refuses on exactly that ground: _"a `CONNECT` is
  tunnelled, the origin's own certificate reaches them, and nothing needs a
  trust-store change… Pointing the tiers at this one instead would break every
  HTTPS page Chromium loads, for no gain it does not already have."_ The last
  clause is what the decision overrules — there **is** a gain, and it is the
  private-root deployment. The rest of it is a live objection. **Meet it in that
  comment**, rather than deleting the comment and leaving the next reader to
  wonder what was traded.

- **The exposure is larger than dl-27's ffmpeg case on _breadth_, not on
  cookies.** This distinction cost two review rounds on dl-34 and the wrong
  version is the intuitive one, so it is written down: a captured session cookie
  **already** crosses this process in plaintext today, through ffmpeg's own
  terminating proxy, by default. `tools/downloader/CLAUDE.md:115` requires
  `RequestContext` replayed on every fetch unconditionally, segments included;
  [`engine/src/ffmpeg/args.ts:162`](../../engine/src/ffmpeg/args.ts) calls
  `buildRequestContextArgs` on every invocation with no gate; `Cookie` and
  `Authorization` are absent from that function's `DROPPED_HEADERS`
  ([`engine/src/ffmpeg/headers.ts:28-42`](../../engine/src/ffmpeg/headers.ts));
  and `ffmpegTlsIntercept` defaults to `true`
  ([`downloader/api/src/config.ts:377`](../../api/src/config.ts)). What is
  genuinely new is **breadth of resources**: a whole rendered page — its
  scripts, its subresources, whatever third-party origins it talks to — against
  a handful of manifest and segment URLs a `ProbeResult` names. Argue the move
  on that. **Do not write "and now cookies pass through this process", which is
  false.**

## Build

1. **Point the tiers at the terminating proxy instead of the tunnelling one.**
   `server.ts` builds both today (`tierProxy` and, when interception is on,
   `ffmpegProxy`); the tiers take `tierProxy.url` via `egressProxyUrl`. What
   this step must settle and record: whether the tiers share ffmpeg's proxy
   instance or get their own, and what happens when `FFMPEG_TLS_INTERCEPT=false`
   — there is no terminating proxy at all in that configuration, so the tiers
   need a defined answer rather than an undefined one.
2. **Give Chromium and yt-dlp the generated root.** They must trust the leaf the
   proxy mints, which is a different problem from trusting the operator's root
   and is the one thing the decision does not make free. **Show it working
   rather than assuming it**: dl-34 established that Chromium in this container
   has no reachable trust store to write to without `certutil`, which is not
   installed — so the mechanism here is unproven and finding it is part of the
   work, not a detail.
3. **Rewrite the decline** at `downloader/api/src/server.ts:118-130` so it states the new
   arrangement and the cost, per the section above.
4. **Update the documentation that this changes**: `.env.example` and
   `01-ARCHITECTURE.md` both currently say `EGRESS_CA_FILE` does **not** reach
   Chromium or yt-dlp, and dl-34's boot warning says the same thing at every
   start. All three become wrong the moment this lands.

## Done when

1. A resolver tier meeting an origin signed by an operator-supplied root
   **succeeds**, proven end to end against a locally-issued certificate — the
   `Done when 2` dl-34 could never prove, since it was never built there.
2. A tier meeting a certificate that genuinely does not verify still raises
   `TLS_VERIFICATION_FAILED`, so dl-34's half two is not regressed by this. Its
   tests exist and must stay green.
3. Chromium loading an ordinary **public** HTTPS page still works with the
   generated root in place — the merge, not the replacement. dl-31 hit the same
   trap on the undici side and its answer was `[...tls.rootCertificates,
operatorCa]`; the failure mode is that an operator root handed over on its
   own fails every public origin.
4. The boot line, `.env.example` and `01-ARCHITECTURE.md` say what is true after
   this change, not before it.
5. `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05** — **Built.** Branch `dl-37-tiers-onto-terminating-proxy`, off
  `origin/main` at `c37cab9`. All four Build steps; both Build-step-1 questions
  settled below with their reasons, and Build step 2's mechanism found by
  measurement rather than assumed, which is what the ticket asked for. One
  unrelated defect found while measuring is fixed here too, by owner decision
  against the builder's recommendation to file it — see below, where the trade
  is named.

  **The `server.ts` citation the ticket carried is correct, re-resolved before
  it was relied on.** At `c37cab9` the tunnel-versus-terminate comment runs
  exactly 118–130 and line 96 is the dispatcher construction, as the filing entry
  says. It has moved: the rewritten decline is `downloader/api/src/server.ts:109-174` on this
  branch, and the paragraph that answers dl-27's objection in its own words is
  120–138.

  ### The two things Build step 1 left open, and what they were settled as

  **The tiers get their own proxy and their own interception, not ffmpeg's.**
  Sharing would have been two RSA keygens and one listener cheaper, and the
  reason not to is a flag: `FFMPEG_ALLOW_UNVERIFIED_TLS` sets
  `verifyOrigins: false` on the interception it is given, and it is named for
  ffmpeg. One shared interception would have turned "stop checking the
  certificates ffmpeg downloads video over" into "and also stop checking the
  certificates behind every probe" — a widening of the last-resort setting that
  nothing asked for and that would have regressed Done-when 2 in that
  configuration. Two interceptions cost **237 ms for four RSA keygens** measured
  here, so ~120 ms of extra boot, and only when a tier is registered: with both
  tiers off there is nothing to hand the root to, so none is minted. That gate is
  also why the ~90 API harness boots in this suite pay nothing.

  **`FFMPEG_TLS_INTERCEPT=false` takes the tiers back to a tunnel too.** One
  switch, because it selects one property — whether this process sits inside the
  TLS — and an operator who turns interception off to stop a plaintext hop has
  not asked to keep the larger of the two hops. The cost is that
  `EGRESS_CA_FILE` stops reaching the tiers in that configuration, which is
  dl-34's world exactly; the boot warning now has three states and says which one
  it is in, and `TIER_TRUST_STORE_HINT` was reworded because dl-34 wrote it as a
  flat denial that is now true of one configuration out of two. **What this
  leaves unavailable**: an operator who wants ffmpeg tunnelled _and_ the tiers
  terminated has no way to say so. A second knob was the alternative and was not
  built — it is operator-facing configuration surface for a combination nobody
  has asked for, and `config.ts` records that the name is now narrower than the
  setting rather than renaming it on this branch.

  ### Build step 2, measured rather than assumed

  Both mechanisms were found by running the real clients. The ticket was right
  that this was unproven, and right that it was the work rather than a detail —
  the first two things tried do nothing at all and fail silently.

  - **Chromium takes `--ignore-certificate-errors-spki-list=<base64 SHA-256 of
the root's SPKI>`.** Measured with the pinned Chromium (Google Chrome for
    Testing 151.0.7922.34) through a real terminating proxy: no flag →
    `net::ERR_CERT_AUTHORITY_INVALID`; the **leaf's** SPKI listed → page loads;
    the **root's** SPKI listed → page loads. Chromium matches against every SPKI
    in the chain it built, and the proxy sends leaf-then-root. The root is what
    ships, because `leafFor` shares one key across hosts as an issuing
    optimisation and pinning that would break silently the day it stops.
    dl-34's finding held: there is no trust store to write to here, and
    `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` reach Chromium not at all.
  - **yt-dlp takes `SSL_CERT_FILE` _and_ `--compat-options no-certifi`, and one
    without the other does nothing.** Four states run against a self-signed
    loopback origin with the real 2025.09.26 binary: `SSL_CERT_FILE` alone fails,
    `REQUESTS_CA_BUNDLE` fails, `CURL_CA_BUNDLE` fails, and only the pair
    verifies. The shipped binary is a PyInstaller ELF carrying its own `certifi`,
    which it prefers over the system store, so OpenSSL loads the file and nothing
    consults it. That is the failure mode this ticket exists to avoid repeating:
    plumbing that looks applied and is not.
  - **The bundle merges.** `SSL_CERT_FILE` replaces OpenSSL's default file
    exactly as `-ca_file` replaces ffmpeg's store, so `trustBundlePath` is
    `withSystemRoots(rootCaPem)` — dl-31's answer, reused, which is what
    Done-when 3 points at.

  ### What the ticket did not anticipate, and it is the largest thing here

  **Moving the tiers behind a terminating proxy silently regresses dl-34, and
  the ticket's Done-when 2 is the only place that shows.** After this change the
  tier never meets an origin certificate — the proxy does — so the classifiers
  dl-34 built cannot fire. dl-27's answer to that for ffmpeg was the `CONNECT`
  status line, and it half works here: yt-dlp quotes it verbatim
  (`Tunnel connection failed: 502 TLS certificate verification failed
(DEPTH_ZERO_SELF_SIGNED_CERT)`, measured), and **Chromium collapses every
  non-200 `CONNECT` response to `net::ERR_TUNNEL_CONNECTION_FAILED` and keeps
  nothing else** (measured). A refused certificate, a blocked target and a dead
  upstream are one string by the time the browser tier sees them.

  Measured, with the real binaries, what that costs without a fix: the browser
  tier returns `UNREACHABLE` — "The site could not be reached", **retryable** —
  and yt-dlp returns `NO_MEDIA_FOUND` — "No downloadable video stream was found
  on that page", the sentence dl-34's `## Why` calls the worst available one. So
  dl-37 would have deleted dl-34's fix in the default configuration while leaving
  every one of its tests green, because those tests exercise the classifiers and
  the tunnelling arrangement.

  The fix is `api/src/tls-rejections.ts`: the tiers' proxy files what it refused
  by host, and `resolvers.ts` reattaches the verdict to a tier failure that
  happened inside the same call's window — restricted to `UNREACHABLE` and
  `NO_MEDIA_FOUND`, the two raw verdicts that mean "learned nothing", never to a
  code the tier established as a fact about the source. (A first version
  excluded only `TLS_VERIFICATION_FAILED` itself; a gate finding below is why
  that was wrong and how it was fixed.) `egress-proxy.ts`'s header already
  states that one proxy serves every download and nothing in a request
  identifies the caller, so host-and-window is all the attribution available,
  and only a certificate verdict is worth that much machinery. Where it still
  gives up is written down in `tls-rejections.ts`: a page that redirects to
  another host and is refused _there_ files under the second host and matches
  nothing, so the tier keeps its own verdict. Under-matching, the same direction
  `tls-verification.ts` argues for.

  **Three alternatives were considered and are recorded so they are not
  rediscovered.** (1) Add the proxy's own phrase to `YTDLP_CERTIFICATE_MARKERS` —
  works for yt-dlp, does nothing for Chromium, and would have left the foundation
  tier wrong. (2) Have the proxy complete the client handshake and answer the
  inner request with a marked 502 — in-band for both tiers, and it breaks
  `terminateTls`'s stated invariant that the origin handshake completes before
  the client is told 200, and means serving content under a certificate for a
  host whose real certificate was just refused. (3) Accept the new verdicts and
  document them — that is shipping the regression.

  ### Gate finding (med): the side channel could reattach a fact, or the wrong host's cause

  The reviewer found this by mutation and reasoning, independently reproduced it
  by re-deriving it against the built `TlsRejectionLog` before either side saw
  the other's write-up, and it forked into two parts.

  **Part one: the allowlist was a denylist of one.** `namingRefusedOrigins`
  excluded only `error.code === "TLS_VERIFICATION_FAILED"`, so `DRM_PROTECTED`,
  `CANCELED`, `TIMEOUT`, `AUTH_REQUIRED` and `GEO_BLOCKED` — every one of them a
  fact the tier established about the source, not an absence of one — would
  have been overwritten by a coincidental host-and-window match with a
  certificate rejection. Fixed by inverting it to an allowlist of the two
  verdicts that mean "learned nothing" (`UNREACHABLE`, `NO_MEDIA_FOUND`).
  `api/test/resolvers.test.ts` is new and pins this directly against a fake
  resolver — `buildRegistry` has no injection point for a stub in place of the
  real tiers, and driving a real `DRM_PROTECTED` through a live tier would test
  Chromium or yt-dlp rather than this wrapper. Red before green: reverted to
  the single exclusion, all five codes' tests failed with the certificate code
  in place of their own.

  **Part two, which the reviewer named and I measured: the allowlist alone does
  not close the identity gap.** Two concurrent probes of the _same host_ can
  each produce `UNREACHABLE` for genuinely different reasons — one a real
  certificate refusal, one an SSRF block or a dead upstream — and
  host-and-window correlation cannot tell them apart. Measured, not reasoned:
  a bare CONNECT proxy handed a real Chromium a 403 (SSRF-shaped), a 500
  (leaf-issuance-shaped), a 502 (dead-upstream-shaped) and two different 502
  certificate refusals, and Playwright reported the identical
  `net::ERR_TUNNEL_CONNECTION_FAILED` for all five — confirming what
  `tls-rejections.ts`'s own header already argued from the proxy's status-line
  mechanism, now from the client side too.

  The reviewer offered two remedies as an open decision rather than a verdict:
  (a) ship the allowlist, document the residual ambiguity honestly, accept a
  narrow non-zero risk; (b) additionally suppress reattachment whenever more
  than one request to a host is in flight, for zero residual risk at a
  complexity cost. Neither was built as proposed. Reasoning through (b): the
  common case this ticket serves is an operator's _one_ broken private-root
  origin, probed twice concurrently — both genuinely cert-refused, both wanting
  the same enrichment — and "suppress on any concurrency" degrades that case
  for both callers even though no non-certificate outcome was ever produced for
  that host at all. That is a worse trade than the gap it closes.

  **What was built instead:** track _outcome kinds_ per host, not just
  concurrency. `TlsRejectionLog.recordOtherFailure` and a new
  `EgressProxyOptions.onOtherConnectFailure` hook, fired from every non-cert
  refusal path in `egress-proxy.ts` — the SSRF-policy catch, `serverSocket`'s
  own `error`, `terminateTls`'s `onFailed` and `onUnavailable`, and the chained
  upstream's refusal — record that _some_ non-certificate outcome happened for
  a host. `since` now returns the certificate code only when no non-certificate
  outcome was also recorded inside the caller's window; two genuine certificate
  refusals on one host with nothing else recorded still both enrich correctly.
  This closes the gap precisely rather than trading it for a different one, at
  the cost of four new call sites rather than a docblock caveat — judged
  worthwhile because the alternative (b) breaks the primary use case and the
  alternative (a) leaves a real, measured ambiguity live and merely named.

  **The one thing this could have gotten wrong, and the test for it.** `fail()`
  in `egress-proxy.ts` is the function every one of those paths _and_ the
  certificate-rejection path itself route through — so hooking
  `onOtherConnectFailure` into `fail()` generically, rather than into the three
  non-certificate call sites individually, would make every certificate
  rejection immediately record itself as ambiguous too, permanently blinding
  the whole mechanism. `api/test/egress-proxy.test.ts`'s new
  `"a genuine certificate rejection fires onCertificateRejected ONLY"` test
  exists for exactly this, and reverting to the generic hook was run against it
  to confirm: red, `expected [ 'untrusted.test' ] to deeply equal []`.

  **A flakiness bug found and fixed in the process, worth the line because it
  is a repeat of a documented failure shape.** The first draft of
  `resolvers.test.ts` recorded a rejection with the real `Date.now()`, then
  immediately called the wrapper, which also reads real `Date.now()` — relying
  on both landing in the same millisecond tick to pass. It usually did. A
  reversion mutation (denylist restored) still only failed 4 of the 5 new
  `test.each` cases, with `CANCELED` passing by coincidence rather than
  correctness — the tell. Fixed by recording _from inside_ the fake resolver's
  own `resolve()`, which runs strictly after the wrapper captures `startedAt`,
  making the ordering true by construction; re-ran the mutation and all 5
  failed. `TlsRejectionLog`'s own tests were never at risk the same way — they
  test the class directly with one shared fake clock on both sides of the
  comparison, never a fake clock against the wrapper's real one.

  ### The outcome-kind design ships, after two round trips through the owner

  The finding above (both parts) is a defect in code `tls-rejections.ts` itself
  introduces on this branch, not a pre-existing one dl-37 merely inherited — so
  "does the branch ship a defect in its own new code" is the right frame for it,
  not "does the branch defer an old one." It **ships**: the allowlist narrowing
  and the outcome-kind tracking above are both in the tree this branch commits,
  `resolvers.test.ts` and the concurrency tests in `tls-rejections.test.ts` and
  `egress-proxy.test.ts` are all committed, and the Chromium measurement the
  design rests on is a committed test
  (`egress-proxy.test.ts`'s `"what Chromium reports for a refused CONNECT
(dl-37)"`) rather than only a docblock's paraphrase of one — the reviewer
  asked to see the actual output, not a summary of it.

  It did not arrive there in one step. The owner's first answer, given the
  question as originally framed ("ship the known defect, or spend more here"),
  was to ship as-is and file the fix as a separate ticket — the standard,
  correct answer to "should this branch defer to a follow-up" when the
  candidate fix is a design that does not yet exist. The coordinator took the
  decision back a second time with a fact that was not in front of the owner
  the first time: the design was **already written, measured and independently
  validated** by the reviewer as closing the gap precisely rather than
  over-suppressing, before either side had told the owner it existed. That is a
  materially different trade than "spend more to fix this" — reverting
  finished, gated work to re-file it as a someday-ticket is not the same
  decision as declining to write it, and the owner reversed on exactly that
  distinction once it was named.

  **Why the design was built before either answer came back, rather than
  waiting.** The reviewer's original finding (the allowlist gap) had an
  uncontested fix — nobody, at any point, defended overwriting `DRM_PROTECTED`
  with an inferred certificate cause — so building that half was never in
  question. The concurrency half is where waiting would have been the safer
  default, and it was not waited on for a specific reason: the reviewer had
  already posed two remedies as an _open decision_ rather than a settled
  finding, which is exactly the shape of question this repo's own convention
  says a builder should bring a measurement to rather than an opinion. Sitting
  idle while that measurement could be taken would have cost a round trip for
  nothing — the Chromium reproduction (403/500/502/two-cert-shapes all
  collapsing to one message) was cheap, decisive, and was going to be needed
  whichever remedy was eventually chosen, including "ship as-is" (which still
  benefits from knowing precisely how bad the gap is). Building the actual
  outcome-kind mechanism on top of that measurement, rather than stopping once
  the measurement was in hand, was the one-step-further call: it is what let
  "the fix already exists" become a fact the coordinator could put in front of
  the owner at all. Had the owner's first answer held, that work would have
  moved into dl-38's Build section nearly verbatim rather than being wasted —
  which is the same reasoning that makes "measure now, decide the shape of the
  fix once the ambiguity is quantified" cheap here specifically: the cost of
  being wrong about which remedy ships was a doc rewrite, not a re-derivation.
  The uncommitted worktree is what made this safe to do without pre-empting
  either gate: nothing was pushed or committed while the decision was open, so
  the reviewer's and owner's read of "the tree as it stood" was never in
  question.

  **The residual the reviewer found on top of the shipped design, filed rather
  than closed here.** `recordOtherFailure` tracks failures, never a success — a
  load-balanced origin with one broken backend and one healthy one can still
  misattribute a healthy backend's own, legitimate `NO_MEDIA_FOUND` to the
  broken backend's certificate refusal, because the healthy connection's
  success is never recorded anywhere to contradict it. Real, agreed by both
  sides, narrower than the gap this design closes, and closing it would mean
  recording successes too — a materially larger surface than the failure-only
  tracking above for a narrower edge case. Named in `tls-rejections.ts`'s own
  docblock and filed as [dl-38](./dl-38-tls-rejection-log-does-not-track-successes.md)
  rather than built here.

  ### What the brief and the ticket had wrong, or under-stated
  - **"There is no terminating proxy at all in that configuration" is right, and
    the ticket implies the tiers need a _third_ state.** They do not: with
    interception off the tiers' proxy is the tunnel it always was, and the
    answer is that the whole arrangement reverts. The question was worth asking
    and the answer turned out to be one line of gating rather than a new mode.
  - **Build step 2 says "the generated root", and Chromium never gets a root.**
    It gets a hash of one, and the flag says "ignore certificate errors for
    chains carrying this key" rather than "trust this root". The distinction is
    what makes it safe — what bounds it is that the key is generated per process
    and never written to disk, which `tls-interception.ts` now says next to the
    field rather than leaving to a reader.
  - **Done-when 3 names the merge trap and it does not apply to Chromium at
    all**, which is worth saying because it looks like it should. The flag
    replaces no store, so the failure mode dl-31 hit cannot occur there. It
    applies squarely to yt-dlp's `SSL_CERT_FILE`, and that is where the merge
    is. Both halves are asserted anyway.
  - **The `Packages:` line omits `api/src/config.ts` and `api/src/context.ts`**,
    both of which carried prose that this makes false, and
    `resolvers/src/tls-verification.ts`, whose hint did too. Step 4's "the
    documentation that this changes" turned out to include four docblocks as well
    as the two files it names.

  ### Red before green

  Every acceptance line has a red partner in the same file rather than a claim.
  Two mutations were also run against the tip and both went red as intended:
  removing the `--ignore-certificate-errors-spki-list` push from
  `pool.ts` failed Done-when 1's test, and making the verdict wrapper a no-op
  failed Done-when 2's with `expected 'UNREACHABLE' to be
'TLS_VERIFICATION_FAILED'` — the exact regression, named by the assertion.

  ### What is not measured, stated as unmeasured
  - **No private-root deployment and no container build.** Everything is
    self-signed fixtures on loopback, and the image was not built, so nothing
    here says the shipped `Dockerfile`'s yt-dlp is the same PyInstaller build
    this container has. If it were a `pip` install without `certifi`,
    `--compat-options no-certifi` would be unnecessary rather than wrong.
  - **The yt-dlp version floor for `--compat-options no-certifi` is unknown.**
    What _is_ measured is the failure shape if a binary does not know it: yt-dlp
    exits on a usage error, `classifyFailure` returns `NO_MEDIA_FOUND`, and the
    chain falls through to the browser tier — the roadmap's own rule that
    removing yt-dlp must not remove coverage. Reproduced against a stand-in
    emitting this container's verbatim `wrong OPTS for --compat-options` stderr.
  - **Chromium's flag was exercised on one version only**, the pinned one.
  - **The tiers were not run behind a _chained_ upstream proxy** with
    interception on. `chainConnect` runs before `terminateTls` either way and
    ffmpeg's proxy already covers that combination, but it is not exercised for
    the tiers.

  ### Found here and fixed here: a `TypeError` on a null codec, by owner decision

  **`mapYtDlpInfo` threw a bare `TypeError` on `vcodec: null`, which the real
  binary emits from its generic extractor** — the path taken for every page
  yt-dlp has no site-specific extractor for, so the common one. `realCodec`
  ([`downloader/resolvers/src/resolvers/ytdlp.ts:365`](../../resolvers/src/resolvers/ytdlp.ts))
  filtered `undefined`, `""` and `"none"` and not `null`, so `null` was the one
  value that survived as a _real_ codec: `hasVideo` went true on it and
  `codecLabel` then called `.trim()` on `null`. The caller gets `INTERNAL`,
  "Something went wrong on our end", and — the part that makes it a defect rather
  than an untidiness — an `INTERNAL` **stops the resolver chain**, where the
  `NO_MEDIA_FOUND` this tier is supposed to degrade to would have fallen through
  to the browser tier. A page the sniffer would have handled failed outright.

  **Present at `origin/main`**: `git show origin/main:tools/downloader/resolvers/src/resolvers/ytdlp.ts`
  has the identical three-value check, so nothing on this branch caused it.
  Reproduced twice before the fix — once through the whole stack, where the real
  yt-dlp fetched a fixture page successfully over the new trust plumbing and the
  probe then failed `INTERNAL`, and once directly on `mapYtDlpInfo`.

  **Folded into this branch rather than filed, and that was the owner's call.**
  The builder's recommendation was to file it: `docs/01-TICKETS.md`'s rule is
  that size is not the test and a defect earns a ticket because the reproduction
  is the deliverable, and this has nothing to do with trust anchors. The
  coordinator put that reasoning to the owner along with the cost — this repo
  squash-merges, so one changelog line now covers a TLS change and an unrelated
  mapper fix — and the owner chose to fold. Recorded rather than left implicit,
  because the commit does not say it and the next reader would otherwise read a
  scope violation.

  **The route taken, and why it is not the shortest one.** The root cause is that
  `YtDlpFormat` is hand-written over parsed JSON and said `vcodec?: string` about
  a field that arrives `null` — a lie the compiler then enforced on every reader,
  which is why nothing caught this. So the declared types were widened to what
  was **measured**, across three shapes against the real 2025.09.26 binary (a
  `<video src>` page, a direct `.mp4`, a direct `.mp3`): `vcodec`, `vbr`, `abr`,
  `tbr` and `filesize_approx` all come back JSON `null`. Widening all five and
  rebuilding is what **proves** the other four were already safe — their `??` and
  `typeof` guards handle `null` — rather than leaving that as an assertion.
  `acodec` was **not** observed null in any of the three and is deliberately not
  widened; `realCodec` accepts it regardless because it is the same call.
  `null` is treated exactly as an absent key, which is what the code already did
  for `undefined` and is the honest reading: `"none"` is yt-dlp stating a stream
  is absent, `null` is yt-dlp saying it did not determine one.

  **Red before green, on the reproduction rather than on a rewrite of it.**
  `resolvers/test/fixtures/ytdlp/generic-null-vcodec.json` is real captured
  output with the host rewritten and unread fields dropped, kept as a payload
  because the value under test is `null` versus an absent key and that is exactly
  the distinction a hand-written fixture loses. Reverting only the `null` clause
  of the guard turns all three new tests red with
  `TypeError: Cannot read properties of null (reading 'trim')`, and the third
  with `expected TypeError … to match object { code: 'NO_MEDIA_FOUND' }` —
  the chain-stopping half, named by the assertion. Tests at
  `downloader/resolvers/test/ytdlp.test.ts:172`.

  It is also why Done-when 1's yt-dlp measurement below is stated as "reached the
  origin" rather than "returned a probe": that measurement was taken **before**
  this fix, and it is left as it was taken.

  ### The measurements behind each `Done when`
  1. **Browser: proven** by a real Chromium through the real proxy,
     `api/test/tiers-on-the-terminating-proxy.test.ts:200`. **yt-dlp: accepted
     on a one-time real-binary measurement, not on committed CI — see the scope
     note below, which the owner settled.** What the committed suite proves is
     that `buildRegistry` constructs exactly the argv/env combination that
     measurement found necessary; it exercises the stand-in binary, because no
     CI runner here installs the real one (same constraint dl-34 states for its
     own yt-dlp coverage, accepted there on the identical evidentiary shape).
  2. **Browser: proven**, `api/test/tiers-on-the-terminating-proxy.test.ts:242`,
     red at `:267`. **yt-dlp: same accepted scope as line 1** — measured
     with the real binary (`TLS_VERIFICATION_FAILED` / `DEPTH_ZERO_SELF_SIGNED_CERT`
     wired, `NO_MEDIA_FOUND` bare), not committed as CI. dl-34's own tests are
     untouched and green either way.
  3. **Proven three ways.** The non-replacement property, in a test:
     `api/test/tiers-on-the-terminating-proxy.test.ts:288`. The yt-dlp bundle's
     merge: `api/test/tls-interception.test.ts:111`. And the literal line — a
     real public HTTPS page, with the generated root's SPKI on the command line:
     `https://registry.npmjs.org/` and `https://github.com/` both returned **200**
     to a real Chromium. That one is a network call and stays a measurement here
     rather than a test.
  4. **Proven.** `downloader/api/test/logging.test.ts:451`, `:473` and `:494` cover the boot
     line's three states; `.env.example` and `01-ARCHITECTURE.md` rewritten.
  5. **Proven.** `npm run check` exit 0. `npm test -- --project downloader`:
     **65 files / 1027 tests**, from 62 / 979 at `origin/main`. Three layers,
     each counted against the actual per-file test count rather than assumed:
     +20 tests for dl-37's own build (2 new files); +3 for the folded
     null-codec regression (no new file — it lives in the existing
     `ytdlp.test.ts`, its fixture is a `.json`); +25 for the shipped
     concurrency-gate design (+14 in a new `resolvers.test.ts`, +6 in
     `tls-rejections.test.ts`, +5 in `egress-proxy.test.ts` — 4 wiring tests
     plus the committed Chromium measurement — no new file for any of the three
     beyond `resolvers.test.ts`). 999 + 3 + 25 = 1027; 64 + 1 = 65. Full
     `npm test`: 125 files / 2014 tests.

  ### Scope note, settled by the owner: the yt-dlp halves of Done-when 1 and 2

  **Accepted on a one-time manual measurement against the real binary; no gate
  in this repo can reproduce that measurement today, and that was known before
  the owner accepted it, not discovered after.**

  The reviewer's original read: Done-when 1 and 2's yt-dlp halves are
  "unproven" rather than "proven" — the committed suite proves only that
  `buildRegistry` constructs the argv/env combination a real yt-dlp 2025.09.26
  needed once, against a stand-in binary, never the real one. Two citations the
  reviewer verified pin exactly how absent that coverage is:
  [`.github/workflows/downloader.yml:143`](../../../.github/workflows/downloader.yml)
  sets `build-args: INSTALL_YTDLP=false` on the container-build job — CI does
  not merely fail to cover yt-dlp, it explicitly builds the image **without**
  it — and [`tools/downloader/Dockerfile:90-93`](../../Dockerfile) states the
  repo's own reason that is acceptable: _"yt-dlp is a latency optimisation,
  never a dependency. Without it every request falls through to the browser
  sniffer and still works."_

  The builder's counter-argument, given to the reviewer rather than settled
  with it: dl-34's own accepted gate (CONCERNS, not FAIL) rested on the
  identical evidentiary shape for the identical resolver — a real binary run
  once, its output captured verbatim, and a committed suite testing only that
  the classifier parses the captured string correctly against a stand-in.
  Neither claim is automatable in this repo's CI today. The honest
  complication in that argument: dl-34's claim is about yt-dlp's _output
  wording_, which changes slowly, where dl-37's is about whether a flag
  combination still makes yt-dlp _behave_ correctly against a proxy-issued
  leaf — a more actively load-bearing claim. Neither side could settle which
  reading governs a `hard` ticket's Done-when, since it is this repo's own
  evidentiary bar rather than a fact about the code.

  **The owner's answer: accept it, on the strength of the Dockerfile's own
  stated position that yt-dlp is optional rather than load-bearing** — the
  untested half is an accelerator, not the required path, which is why this is
  CONCERNS rather than FAIL. A follow-up ticket,
  [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md), carries the reproduction
  (the exact flag pair, the PyInstaller/`certifi` reason, the version floor
  that was not established) and poses whether closing the gap is worth its own
  costs — a release binary pulled into CI, a container build, a network path —
  as its own open decision, rather than assuming the answer.

- **2026-09-04** — Filed on dl-34's branch as it closed, carrying dl-34's
  answered decision rather than re-opening it. dl-34 could not stay `ready` to
  hold this work: `status: ready` plus a `## Review` gate record is a state
  `scripts/status.mjs` rejects with a non-zero exit, and PR #142 went red on it.
  So the unbuilt half becomes its own ticket, which is also the honest shape —
  it has a decision and a cost of its own.

  **Id picked by the documented union of two lists**, not by incrementing.
  `git ls-tree origin/main tools/downloader/docs/work/` tops out at `dl-36`, and
  a tree-wide grep for `\bdl-[0-9]+\b` adds only `dl-999`, which is
  `scripts/status.mjs`'s dangling-`depends_on` sentinel in dl-25 and dl-36 and
  not a reservation — dl-36's own Log records the same check and the same
  conclusion. Highest of both is 36, so this is 37.

  **The `server.ts` citation here is `118-130`, and dl-34's `96-104` was already
  wrong at `origin/main`.** Verified with `git show origin/main:…` rather than
  against this branch, so it is not something dl-34's own changes moved: line 96
  is the dispatcher construction and the tunnel-versus-terminate comment runs
  118 to 130. `scripts/citations.mjs` passes the old form — a citation whose
  content moved still resolves, which the tool says of itself. Worth the line
  because this is the single citation a builder of this ticket must follow.

  **Not decided here, deliberately:** whether the tiers share ffmpeg's proxy
  instance or get their own, and what `FFMPEG_TLS_INTERCEPT=false` means for
  them. Both are Build step 1's to settle with the code in front of it; naming
  them as open is not the same as leaving the ticket's own decision open, which
  is answered above.
