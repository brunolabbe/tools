---
id: dl-34
tool: downloader
title: The resolver tiers cannot reach the operator's CA, and misreport it when they hit it
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-34 — Chromium and yt-dlp on a private-root deployment

**Packages:** `resolvers` (`browser/pool.ts`, `resolvers/browser.ts`,
`browser/classify.ts`, `resolvers/ytdlp.ts`), `api` (`config.ts`, `server.ts`).

## Why

An operator deploying behind a corporate TLS-inspecting proxy, or against an
internal CDN with a private root, has one setting for it: `FFMPEG_CA_FILE`
(`egressCaFile` after dl-31). It reaches **ffmpeg only**. The two resolver tiers
that actually load the page — Chromium and yt-dlp — are given no route to that
trust anchor at all, and when they consequently fail they report it as something
else entirely.

Two halves, filed as one ticket because an operator meets them as one event and
fixing either alone leaves the report misleading.

### Half one — no route to the anchor

This is **not** an oversight. It is dl-27's tunnel-versus-terminate split working
as designed, and `downloader/api/src/server.ts:96-104` says so in the first person:

> Chromium and yt-dlp verify their own connections without being asked, so they
> keep the one above: a `CONNECT` is tunnelled, the origin's own certificate
> reaches them, and nothing needs a trust-store change.

That sentence is true for a **public** origin. It is false for an origin whose
certificate chains to a root only the operator has, which is exactly the
deployment `FFMPEG_CA_FILE` exists to serve. So the tool has a setting for
"trust this root" that half the pipeline cannot see, and the design note that
justifies the gap does not mention the case.

### Half two — and neither tier can name the failure

**Fixed 2026-09-03; this section is kept as the reproduction, and its line
numbers describe the tree before the fix.** Both tiers could _see_ a certificate
error and both discarded it:

- `classifyNavigationError` (`resolvers/src/browser/classify.ts:149`)
  passes an `AppError` straight through, has one `/timeout/i` branch, and
  returns a blanket `UNREACHABLE` for everything else — including a Chromium
  navigation failure that names the cause.
- `classifyFailure` (`resolvers/src/resolvers/ytdlp.ts:622`)
  string-matches stderr for DRM, sign-in, geo and 429, then falls back to
  `NO_MEDIA_FOUND` — documented as deliberate, so that a broken extractor
  degrades to the browser tier rather than failing the request. A certificate
  refusal takes that same fallback.

So on a private-root deployment the operator is told **"No downloadable video
stream was found on that page"** for a trust-store problem. That is the worst
available sentence: it points at the source, invites a retry, and hides the one
setting that would fix it.

**Not the same defect, do not sweep them in.** `resolvers/src/size-probe.ts:74`
and `resolvers/src/size-probe.ts:98` also swallow a failure to `undefined`, and
`resolvers/src/size-sample.ts:371` swallows one to `unchanged` — the declared
estimate it started from. Different values, same intent, and it is correct and
documented at
`resolvers/src/size-probe.ts:7-11`: "a probe that fails the whole resolve because a CDN would
not answer a HEAD is a regression, and it would be one on the _common_ path".
Those are size estimates degrading to a declared value. This ticket is about a
_verdict_ being wrong, which is a different thing.

## Build

1. ~~**Give the tiers the anchor.**~~ **Superseded by the decision below,
   2026-09-03 — do not build this step as written.** It described a per-tier
   trust-anchor mechanism (`NODE_EXTRA_CA_CERTS` for Chromium's Node-side
   fetches, `--ca-certificate` or `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` for
   yt-dlp's Python stack). The user chose the other option instead: **move both
   tiers onto dl-27's terminating proxy**, which gives them the operator's trust
   for free and needs no per-tier flag at all. Half one is still unbuilt; what
   changed is the mechanism, not the status. See "## Decision" below for the
   objection whoever builds it has to meet.
2. **Classify a certificate failure as `TLS_VERIFICATION_FAILED`** in both
   classifiers. The code already exists in the taxonomy and already maps to 502
   in `api/src/http-errors.ts`, so this costs no new code and no new status.
   The copy must name the setting.
3. **Say it at boot too**, next to the existing `egress configured` line: an
   operator who set a CA file should be told which components it reaches.

**Steps 2 and 3 landed on 2026-09-03** and are what the first Log entry below
records. Step 1 is the whole of what is left.

## Done when

1. A resolver meeting a certificate it cannot verify raises
   `TLS_VERIFICATION_FAILED`, not `UNREACHABLE` and not `NO_MEDIA_FOUND` —
   proven for both tiers against a fixture, not a live origin.
2. An operator-supplied root reaches whichever tiers step 1's decision says it
   should, proven end to end against a locally-issued certificate.
3. `npm run check` and `npm test -- --project downloader` pass.

## Decision — answered 2026-09-03, not open

**The question was:** should Chromium get the operator's root at all, or should
it move to the terminating proxy? dl-27 already built a proxy that terminates
TLS and mints leaves from a generated root; ffmpeg is on it. Putting the tiers on
it too gives them the operator's trust for free and deletes the per-tier wiring —
at the cost of every HTTPS page Chromium loads passing through this process in
plaintext, which `downloader/api/src/server.ts:96-104` explicitly declined.

**The answer, from the user: move the resolver tiers onto dl-27's terminating
proxy.** Not the per-tier trust-anchor wiring Build step 1 described, which is
superseded above. Recorded here rather than in a Log entry because the next
agent reads the Build section first, and step 1 as originally written would
otherwise get built.

**The cost came with the answer and is not a reason to re-open it.** Whoever
builds half one has to meet this objection rather than rediscover it:

- **Every HTTPS page Chromium loads crosses this process in plaintext.** That is
  a strictly larger exposure than the ffmpeg case dl-27 argued: ffmpeg fetches
  media from a CDN, and Chromium fetches whatever the page is — including, on a
  page behind a login the operator supplied cookies for, that session.
- **`downloader/api/src/server.ts:96-104` declined it in the first person**, and the comment is
  still there and still has to be rewritten by the branch that does this: _"a
  `CONNECT` is tunnelled, the origin's own certificate reaches them, and nothing
  needs a trust-store change… Pointing the tiers at this one instead would break
  every HTTPS page Chromium loads, for no gain it does not already have."_ The
  last clause is the part the decision overrules — there **is** a gain, and it is
  the private-root deployment this ticket is about — but the first clause is a
  statement about what Chromium will accept, and a branch that moves the tiers
  has to show Chromium trusting the generated root rather than assume it.
- **It is its own branch, its own gate and its own reviewer.** It was not folded
  into the half-two build for exactly that reason.

The order the earlier recommendation asked for held: half two landed first,
cheap and independent, with the decision still open at the time it was built.

## Provenance of the claims above

Filed from dl-29's coordinator, relaying dl-31's post-PR gate. Because a ticket
carries a reproduction, every citation was re-resolved here before it was
written down. **The relayed paths did not resolve as given** — they named
`browser/pool.ts` and `ytdlp.ts` unqualified, and this repo has two
`size-probe.ts` and two `pool.ts`. The paths above are tool-rooted.

**Verified in this worktree, at `origin/main` + dl-29:**

- `grep -rnE "ca-certificate|ignore-certificate-errors|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|NSS" tools/downloader --include=*.ts`
  (excluding `dist`) → **exit 1, zero hits.**
- `chromium.launch()` at `resolvers/src/browser/pool.ts:256-268` passes exactly
  `headless`, `args`, `proxy`. No `env`, no certificate flag.
- `BASE_ARGS` at `resolvers/src/browser/pool.ts:117-126` — seven flags, none
  about certificates.
- `browser.newContext()` at `resolvers/src/resolvers/browser.ts:148` does
  **not** set `ignoreHTTPSErrors`.
- yt-dlp's `spawn()` at `resolvers/src/resolvers/ytdlp.ts:516-523` passes
  `shell: false`, `windowsHide`, `detached`, `stdio` — **no `env` at all**, so
  the child inherits this process's environment and nothing tier-specific is
  set.
- Both classifiers read exactly as described above.
- `downloader/api/src/server.ts:96-104`'s comment is quoted verbatim.
- The `size-probe` / `size-sample` exclusion is verified, including the docblock
  that makes it deliberate.

**Inherited and NOT verified here** — no browser and no yt-dlp binary was run:

- That Chromium surfaces the failure as `net::ERR_CERT_AUTHORITY_INVALID` and
  that yt-dlp says `CERTIFICATE_VERIFY_FAILED`. Both are plausible and neither
  was observed. **Build step 2 depends on the exact strings, so reproduce them
  before matching on them.**
- That a private-root deployment fails at all in the way described. The argument
  is from the code paths above, not from a running deployment.

**Both of those were reproduced on 2026-09-03**, with a real Chromium and the
real yt-dlp binary against a self-signed loopback origin, before step 2 was
written. Both strings hold; one of the two claims was narrower than the filer
knew. The measurement, and what is still unmeasured, is in the Log entry below —
this section is left as it was written so the difference between an inherited
claim and a produced one stays visible.

## Log

- **2026-09-03** — **Half two built; half one is still unbuilt and the ticket
  stays `ready`.** Branch `dl-34-classify-tls-failures`, off `origin/main` at
  `91c117b`. Steps 2 and 3 only, as a deliberate slice on this ticket's own
  recommendation. Step 1 was **not** started, and its mechanism changed under it
  the same day — see "## Decision", which the user answered while this was being
  built.

  **The exact strings step 2 matches on were produced here, not inherited.** The
  filer flagged them as plausible-but-unobserved and said to reproduce them
  first, which is the instruction that turned out to matter most. Against a
  self-signed loopback HTTPS origin, three certificates (self-signed, expired,
  wrong SAN):

  - Chromium (the version this repo pins, launched through Playwright):
    `page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://127.0.0.1:PORT/…`
    followed by a call log.
  - yt-dlp 2025.09.26, default `urllib` backend: `ERROR: [generic] Unable to
download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify
failed: self-signed certificate (_ssl.c:1032) (caused by
CertificateVerifyError(…))`.

  **What that measurement changed about the design.** All three certificates
  produced `ERR_CERT_AUTHORITY_INVALID` from Chromium — an untrusted issuer is
  decided before expiry and before a name mismatch, so **no fixture in this repo
  can produce a second member of the family**. dl-31 hit the mirror image of
  this and answered it by adding an `expired` knob to get a second OpenSSL verify
  code; that escape is not available here. So the Chromium matcher is a prefix
  over `net::ERR_CERT_*` rather than a closed set, and the other members of the
  family are exercised as strings in `capture-rules.test.ts` rather than as
  handshakes. That is a substitution and it is named as one.

  **What the brief had wrong, or under-stated.**

  - **"Both classifiers" is two of three, and the third is already done.**
    dl-31 fixed the direct tier's passthrough (`direct.ts`) and built the undici
    classifier in `guarded-fetch.ts`. Nothing here duplicates it: the three
    vocabularies are disjoint — OpenSSL codes off a structured `cause`,
    Chromium's `net::` tokens in a message, Python's `ssl` text on stderr — so
    there is no shared matcher to lift, only the shared operator copy, which is
    one constant in `resolvers/src/tls-verification.ts`.
  - **Step 2 is not only a copy change, and the ticket does not say so.**
    `registry.ts:71` falls through on `NO_MEDIA_FOUND` and on nothing else, so
    moving yt-dlp's verdict off that code **stops the resolver chain**. That is
    the right answer — the browser tier verifies against its own store and would
    meet the same private root, so falling through buys a browser launch and
    then reports the wrong thing — but it is a behaviour change, and it is the
    one thing here that could bite a deployment that is not private-root. It has
    its own test in `registry.test.ts`, driving the real `YtDlpResolver` over the
    stand-in binary with a stub second tier that observes not being called.
  - **The ordering inside `classifyFailure` is load-bearing and unmentioned.**
    Its first branch is `text.includes("drm")` on the whole stderr. Measured: a
    stderr carrying both a certificate refusal and the word "drm" came out
    `DRM_PROTECTED` before the certificate branch was moved ahead of it. A
    handshake that failed means yt-dlp never read the page, so no `drm`, `sign
in`, `in your country` or `429` in that buffer can be a fact about the
    source.
  - **"The copy must name the setting" needed a decision the ticket did not
    flag.** `AppError.message` reaches the browser: `presentError` renders the
    server's message next to the UI's own copy. So the setting name would have
    landed in an end user's error panel. It is in `details.hint` instead, which
    `http-errors.ts` logs at `error` for a 502 and its `CLIENT_SAFE_DETAIL_KEYS`
    allowlist does not forward — the operator gets it, the page does not, and the
    finished UI copy for `TLS_VERIFICATION_FAILED` already says the user-facing
    half. Both suites assert the negative as well as the positive.
  - **Two documentation claims contradicted this ticket's premise and are fixed
    here** as free work rather than filed: `.env.example` said "Everything in
    this service that meets an origin is given it" and
    `01-ARCHITECTURE.md`'s environment table said "every client that meets an
    origin gets it". Chromium and yt-dlp meet origins and get nothing, which is
    the ticket. Left uncorrected, an operator's first two references would still
    say the opposite of the boot line step 3 adds.

  **Every premise the dispatch asked me to check held**: `TLS_VERIFICATION_FAILED`
  is in `CORE_ERROR_CODES` with copy and is absent from `CORE_RETRYABLE_CODES`;
  `downloader/api/src/http-errors.ts:23` maps it to 502; both named classifiers read exactly as
  described; and `server.ts` has the `egress configured` line to sit beside.

  **Red before green, on all four claims.** Each fix was reverted in turn and the
  tests named their old verdict: the browser classifier `UNREACHABLE` (and
  `TIMEOUT` for a message carrying both), the live-Chromium probe `UNREACHABLE`
  with the raw message as `reason`, yt-dlp `NO_MEDIA_FOUND` ("No downloadable
  video stream was found on that page" — the sentence the Why calls the worst
  available one) and `DRM_PROTECTED` for the mixed stderr, and the registry
  resolving successfully through the second tier instead of rejecting.

  **A test of mine passed for the wrong reason and was removed rather than kept.**
  The first version of "stops the chain" asserted `retryable === false` on the
  yt-dlp error, which is true of `NO_MEDIA_FOUND` too — it stayed green with the
  fix reverted. It is now the registry test above, and a comment where it used to
  be says why the cheap version is not a proof.

  **And I ran a suite against the wrong tree once.** `/workspaces/tools` is the
  shared checkout, not this worktree; a `vitest` run from there reported 35
  passing tests for a file whose edits were three directories away, and a
  mutation that should have gone red did not. Every timing and every result below
  is from the worktree. Worth the line because the failure mode is silent and
  looks exactly like a passing suite.

  **What is not measured, stated as unmeasured.**

  - **No private-root deployment was run.** Everything here is a self-signed
    fixture on loopback. What is proven is the classification; what is not is
    that a corporate middlebox produces the same strings.
  - **Only yt-dlp's `urllib` backend could be provoked** — neither `curl_cffi`
    nor `requests` is installed in this container. The fourth marker,
    `ssl certificate problem`, is libcurl's wording and is **unmeasured**; it is
    matched, and exercised by a fixture mode that says so in a comment.
  - **Only one member of Chromium's `ERR_CERT_*` family was produced**, for the
    reason above. The prefix branch is argued from `net_error_list.h`, not
    observed across the family.
  - **`ERR_CERTIFICATE_TRANSPARENCY_REQUIRED` is deliberately excluded** by the
    trailing underscore: a private root cannot cause it, so the hint would be
    wrong advice, and under-matching is the direction `guarded-fetch.ts` already
    chose. It stays `UNREACHABLE`, which is asserted.
  - **No container was built and no real trust store was consulted**, so nothing
    here says what Chromium would do with an anchor actually installed. That is
    half one's question and it belongs to half one's branch.

  **Also not done, deliberately.** The boot line is a `warn` and fires only when
  a CA file is set. `info` was the other reading of step 3 — "should be told
  which components it reaches" is informational — but the three neighbouring
  ffmpeg-TLS lines are all `warn` for exactly this shape of fact, so it matches
  its neighbours. Flagged rather than buried in case the gate reads it the other
  way.

- **2026-09-01** — Filed from dl-29's branch, alongside dl-35, on the precedent
  of dl-32/dl-33 riding dl-23's. Not folded into dl-29: it is a different tool
  area, it carries an open architectural decision, and dl-29 was explicitly told
  to stay out of `config.ts` while dl-31 was in gate.
