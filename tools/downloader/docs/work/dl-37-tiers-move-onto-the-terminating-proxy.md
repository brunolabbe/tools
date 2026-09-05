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
  measurement rather than assumed, which is what the ticket asked for.

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
  happened inside the same call's window. It is deliberately not a general
  failure hook — `egress-proxy.ts`'s header already states that one proxy serves
  every download and nothing in a request identifies the caller, so host-and-window
  is all the attribution available, and only a certificate verdict is worth it.
  Where it gives up is written down in that file: a page that redirects to
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

  ### Found here, not fixed here, and not dl-37's

  **`mapYtDlpInfo` throws a bare `TypeError` on `vcodec: null`, which the real
  binary emits from its generic extractor.** `realCodec`
  ([`ytdlp.ts:328`](../../resolvers/src/resolvers/ytdlp.ts)) filters `undefined`,
  `""` and `"none"` but not `null`, so `null` survives as a "real" codec and
  `lookup` calls `.trim()` on it. Reproduced twice: once through the whole stack
  (real yt-dlp fetched a fixture page successfully and the probe then failed
  `INTERNAL`, "Something went wrong on our end") and once directly on
  `mapYtDlpInfo`. **Present at `origin/main`** — `git show
origin/main:…/ytdlp.ts` has the identical three-value check — so it is not
  something this branch caused. Not folded in: it is a defect, so the
  reproduction is the deliverable and it earns its own ticket, and it has nothing
  to do with trust anchors. It is also why Done-when 1's yt-dlp measurement below
  is stated as "reached the origin" rather than "returned a probe".

  ### The measurements behind each `Done when`
  1. **Proven, both tiers.** Browser, real Chromium through the real proxy:
     `api/test/tiers-on-the-terminating-proxy.test.ts:200`. yt-dlp, real binary,
     not committable because no CI runner here installs one — through
     `buildRegistry` against an operator-root origin the fixture served **1
     request** to, where the same registry without the plumbing served 0 and
     failed `TLS_VERIFICATION_FAILED` / `certificate_verify_failed`.
  2. **Proven, both tiers.**
     `api/test/tiers-on-the-terminating-proxy.test.ts:242` for the browser, with
     its red at `:267`. yt-dlp measured with the real binary:
     `TLS_VERIFICATION_FAILED` / `DEPTH_ZERO_SELF_SIGNED_CERT` wired, against
     `NO_MEDIA_FOUND` bare. dl-34's own tests are untouched and green.
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
     **64 files / 999 tests**, from 62 / 979 at `origin/main` — +2 files
     (`tls-rejections.test.ts`, `tiers-on-the-terminating-proxy.test.ts`) and +20
     tests, counted against the `test(` blocks added rather than assumed.

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
