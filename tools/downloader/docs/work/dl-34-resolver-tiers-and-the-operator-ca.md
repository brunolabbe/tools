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

## Review

**Gate: CONCERNS** — 2026-09-03/04, Sonnet (`ac44c9254b58eb601`), on Sonnet's
own build (`ab57a4f543849d651`) — `origin/main...HEAD`, `91c117b...01c23dd`, two
passes: an initial review at `21bc1f9` and a confirmation at `01c23dd` after the
findings below were fixed. Both from the reviewer's own detached worktree, both
with `worktree-farm.sh` + build first, printed `pwd` before every suite run.

| Done when                                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A resolver meeting a certificate it cannot verify raises `TLS_VERIFICATION_FAILED`, not `UNREACHABLE` and not `NO_MEDIA_FOUND` — for both tiers, against a fixture | **proven.** Browser tier, unit: `resolvers/test/browser/capture-rules.test.ts:359`. Browser tier, real Chromium: `api/test/tier-tls-verdict.test.ts:77`. yt-dlp tier: `resolvers/test/ytdlp.test.ts:220`. Reviewer reverted each raise in turn and named the old verdict each returned to (`UNREACHABLE`, `NO_MEDIA_FOUND`) before restoring.                                                                                                                                            |
| 2. An operator-supplied root reaches whichever tiers step 1's decision says it should, end to end against a locally-issued certificate                                | **unproven — out of scope for this slice, by design.** Half one (giving the tiers the anchor) was never built here; see `## Decision`. Not counted as a defect: the dispatch that produced this build explicitly excluded half one, the reviewer's own dispatch said not to gate it as missing work, and the orchestrator confirmed the rubric has no row for a deliberately sliced ticket.                                                                                              |
| 3. `npm run check` and `npm test -- --project downloader` pass                                                                                                        | **proven.** `npm run check` exit 0, both passes. `npm test -- --project downloader`: 61 files / 966 tests at `01c23dd`, reproduced independently by the reviewer from a separate worktree with an identical count. Baseline at `origin/main` (`91c117b`): 59 files / 939 tests, per the reviewer's first pass; the deltas across both rounds (+1 file/+17 tests, then +1 file/+10 tests) reconcile exactly against the new `test(` blocks each round added, counted rather than assumed. |

- **med, Finding A — the yt-dlp certificate marker matched an ambiguous phrase,
  fixed.** `ytdlpCertificateMarker`'s generic "certificate verify failed" match
  also fired on Python's message for an **incomplete chain**
  (`"unable to get local issuer certificate"`), which is unrelated to a private
  root and which Chromium frequently recovers from via AIA chasing where
  yt-dlp's default backend does not. Since yt-dlp runs before the browser tier
  and `TLS_VERIFICATION_FAILED` now stops the chain (`registry.ts:71`), an
  ordinary public-site misconfiguration would have hard-stopped instead of
  falling through to a tier likely to succeed. Reproduced on both sides: the
  reviewer measured the regex match; the builder built a real two-level chain
  (root → intermediate → leaf) served with only the leaf and got the exact
  ambiguous stderr from the real yt-dlp binary, and pointed real Chromium at
  the same fixture with no AIA data available, confirming it fails identically
  to the self-signed case there (not counter-evidence — AIA chasing needs
  something to chase). Chromium's actual AIA recovery remains **unmeasured**,
  named as such, same evidentiary bar as the existing `curl_cffi` caveat. Fixed
  by excluding the ambiguous phrase in `resolvers/src/tls-verification.ts`;
  tests in the new `resolvers/test/tls-verification.test.ts`, a
  `tls-incomplete-chain` fixture mode in `fake-ytdlp.mjs`, and a registry-level
  assertion in `ytdlp.test.ts:259`. The reviewer additionally checked the
  mirror risk — over-narrowing swallowing a genuine private-root signal — by
  adding `"self-signed"` to the exclusion list and watching six tests across
  three files go red; restored, clean. The sub-case the fix does not
  solve — a genuinely broken chain where the browser tier also fails — is
  documented in the Log as an accepted cost of under-matching, not an
  oversight: it degrades to `NO_MEDIA_FOUND`, unchanged from pre-ticket
  behaviour.
- **low, Finding B — the operator hint overclaimed a private-root cause for
  certificate-policy codes, fixed.** `ERR_CERT_WEAK_SIGNATURE_ALGORITHM`,
  `ERR_CERT_VALIDITY_TOO_LONG`, `ERR_CERT_NON_UNIQUE_NAME`,
  `ERR_CERT_NAME_CONSTRAINT_VIOLATION` and `ERR_CERT_SYMANTEC_LEGACY` all match
  the `net::ERR_CERT_*` prefix and are correctly coded `TLS_VERIFICATION_FAILED`,
  but they are policy violations no trust anchor changes, and
  `TIER_TRUST_STORE_HINT` asserted "fails here with EGRESS_CA_FILE set and
  correct" unconditionally. Reworded to a conditional that points at
  `details.reason` for the actual cause. Both reviewer and builder ran the
  matcher against all five codes independently.
- **low, Finding C — a Log sentence overstated coverage by one, fixed.** The
  build's own Log claimed the operator-copy constant was shared by all three
  certificate-failure raises; `guarded-fetch.ts`'s (the direct/undici tier's)
  raise carries no `hint` at all, correctly — it already has the operator's CA
  directly, so a refusal there is not a reachability gap the hint needs to
  explain. Corrected in place next to the original claim.
- **med, Finding D — the Decision section's exposure argument had a backwards
  premise, fixed.** The first draft framed a captured session cookie reaching
  Chromium's traffic as new exposure relative to ffmpeg. `CLAUDE.md:115`
  requires `RequestContext` replayed on every fetch unconditionally, segments
  included; `engine/src/ffmpeg/args.ts:162` calls `buildRequestContextArgs` on
  every ffmpeg invocation with no gate; `Cookie` and `Authorization` are absent
  from that function's `DROPPED_HEADERS`
  (`engine/src/ffmpeg/headers.ts:28-42`); and `ffmpegTlsIntercept` defaults to
  `true` (`downloader/api/src/config.ts:377`) — so a captured cookie already crosses this
  process in plaintext through ffmpeg's existing terminating proxy, by default,
  today. Both reviewer and builder independently verified all four citations.
  The conclusion (Chromium's exposure is larger) stands on **breadth of
  resources**, not cookies, and the `## Decision` section is rewritten in place
  — the Log is not the only place this correction lives, because half one's
  builder reads the Decision section directly and would otherwise inherit the
  wrong objection to answer.

**On the verdict.** Every finding above is closed — zero open findings on
either side. The one `unproven` acceptance line (Done-when 2) reads as `FAIL`
by the rubric's letter, and the reviewer named that reading explicitly rather
than silently reinterpreting it: this ticket was dispatched as a deliberate
two-thirds slice (half two only), the reviewer's own dispatch said not to gate
half one as missing work, and the orchestrator confirmed this is a gap in the
rubric for a sliced ticket rather than a judgment call available to redo.
**CONCERNS**, not **PASS**, because two findings were `med` before the fix —
the verdict records what the gate found, not only what remains after it.

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

- **Every HTTPS page Chromium loads crosses this process in plaintext, and that
  is a larger exposure than ffmpeg's — but not for the reason first written
  here.** Gate finding D, corrected: the first draft framed the session cookie
  as new to Chromium's exposure, and it is not. `CLAUDE.md:115` requires
  `RequestContext` replayed on every fetch, unconditionally, segments included;
  `engine/src/ffmpeg/args.ts:162` calls `buildRequestContextArgs` on every
  ffmpeg invocation with no gate; `Cookie` and `Authorization` are absent from
  that function's `DROPPED_HEADERS`
  (`engine/src/ffmpeg/headers.ts:28-42`); and `ffmpegTlsIntercept` defaults to
  `true` (`downloader/api/src/config.ts:377`). So a captured session cookie already
  crosses this process in plaintext through ffmpeg's terminating proxy, today,
  by default — moving the tiers changes nothing about that half. What is
  actually larger is **breadth**: a whole rendered page — its scripts, its
  other subresources, whatever third-party origins it talks to — is a bigger
  surface than the handful of manifest and segment URLs a `ProbeResult` names,
  even though both can carry the same cookie.
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

- **2026-09-04** — **`## Review` above is builder-written, which is the
  convention and not a shortcut.** [`docs/01-TICKETS.md:239`](../../../../docs/01-TICKETS.md):
  "the reviewer reports and the builder writes the section down, with the date,
  the verdict, and **both halves named above**". It is transcribed from the
  reviewer's two reports — the initial gate at `21bc1f9` and the confirmation at
  `01c23dd` — and the reviewer confirmed its content accurate. Recorded because
  the point was raised and cost a round: verbatim reproduction of a reviewer's
  own text is **not** what the rule asks for, and the section deliberately does
  one thing a verbatim block could not, which is attribute which side measured
  what (the reviewer measured Finding A's regex match; this build produced the
  two-level chain). The line underneath that is worth keeping: transcribing
  findings you were **given** into the required structure is the convention;
  writing a reviewer's words you never received would be fabrication, whatever
  it is labelled.

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
    there is no shared matcher to lift. **Correction, gate finding C:** what
    follows in the first version of this entry said the operator copy was
    shared by all three; it is shared by two. `guarded-fetch.ts`'s raise
    (`api/src/guarded-fetch.ts:122`) carries no `hint` at all — correctly, since
    the direct tier gets the operator's CA directly and a refusal there is not
    a reachability gap the hint needs to explain. `TIER_TRUST_STORE_HINT`
    (`resolvers/src/tls-verification.ts`) is the constant shared by the two
    tiers this ticket is actually about.
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

- **2026-09-03 (same day, gate exchange)** — CONCERNS from the first gate, two
  `med` findings and two `low`. Both `med` findings reproduced; both fixed here.
  Both `low` findings reproduced and folded in as doc corrections above.

  **Finding A, fixed: `ytdlpCertificateMarker` matched an ambiguous phrase.**
  The gate found that the generic "certificate verify failed" match also fires
  on `"unable to get local issuer certificate"` — Python's message for an
  **incomplete chain** (server sent the leaf, not the intermediate), which has
  nothing to do with a private root. It reproduced the regex match; I went
  further and produced the message itself, live: a two-level chain (root →
  intermediate → leaf) built for this exchange, served with only the leaf, gives
  the real yt-dlp binary the exact stderr `…certificate verify failed: unable
to get local issuer certificate (_ssl.c:1032)…`. I also pointed the real
  Chromium this repo pins at the same fixture with no AIA data available, and it
  fails identically to the self-signed case (`ERR_CERT_AUTHORITY_INVALID`) —
  expected, since AIA chasing needs something to chase, and not evidence
  against the gate's claim, which is about a certificate a real CA issued.
  Chromium's own AIA recovery was **not** exercised — building a correct
  Authority Information Access extension and serving the intermediate at its
  URL is next week's fixture — so that half of the finding stays at the gate's
  own evidentiary bar: reasoned from well-documented client behaviour, not
  observed here, same bar as the `curl_cffi` caveat above.

  Fixed by excluding `"unable to get local issuer certificate"` and
  `"unable to get issuer certificate"` from the match even when the generic
  phrase is also present — `ytdlpCertificateMarker` in
  `resolvers/src/tls-verification.ts`, tests in the new
  `resolvers/test/tls-verification.test.ts` and a `tls-incomplete-chain`
  fixture mode in `fake-ytdlp.mjs` carrying the verbatim measured stderr. Red
  before green at both layers: the raw function and the real resolver via
  `ytdlp.test.ts`, each reverted and each caught.

  **Why the ambiguity was invisible from inside the change, which is worth more
  than the fix.** The Chromium side has a closed, named vocabulary —
  `net_error_list.h`'s `ERR_CERT_*` range — so auditing it member-by-member for
  an exception was a matter of reading a header file, and I did that once and
  found `ERR_CERTIFICATE_TRANSPARENCY_REQUIRED`. yt-dlp's stderr has no such
  enum: it is free English text, and the only instance of it I had ever
  produced was the one self-signed fixture from the first build round. I
  verified "this string means a certificate verify failure" and stopped, never
  asking "what else does OpenSSL's verify-failed wrapper wrap around that I
  have not produced" — because there was no list to iterate, the audit had to
  be imagined rather than read, and I substituted the discipline stated in this
  same file's own docblock ("under-matching is the safe direction") for having
  actually applied it below the top-level "is this a cert failure" decision. A
  single fixture is a demonstration that a classifier works, never a survey of
  what else it might match; the gate is what supplied the second case.

  **The sub-case the narrowing does not solve, and it is an accepted cost, not
  an oversight.** An operator whose origin genuinely has an incomplete chain,
  where the browser tier _also_ fails (no reachable AIA data, or a corporate
  proxy that strips it) now gets `NO_MEDIA_FOUND` — the pre-dl-34 diagnosis,
  no better than before — rather than a `TLS_VERIFICATION_FAILED` naming the
  cause. Under-matching accepts this on purpose: the alternative is telling
  every operator hitting an ordinary public-site misconfiguration to check a
  trust setting that has nothing to do with their problem, which is the exact
  failure mode half two exists to fix. `TIER_TRUST_STORE_HINT`'s docblock and
  the marker's own comment both say so; this is the line that names the cost.

  **Finding D, fixed: the Decision section's cookie argument was backwards.**
  I had framed a captured session cookie reaching Chromium's traffic as new
  exposure. `CLAUDE.md:115` requires `RequestContext` replayed on every fetch
  unconditionally, `engine/src/ffmpeg/args.ts:162` calls
  `buildRequestContextArgs` on every ffmpeg invocation with no gate, `Cookie`
  and `Authorization` are absent from that function's `DROPPED_HEADERS`
  (`engine/src/ffmpeg/headers.ts:28-42`), and `ffmpegTlsIntercept` defaults to
  `true` (`downloader/api/src/config.ts:377`) — all four re-verified here, not
  transcribed. So a captured cookie already crosses this process in plaintext
  through ffmpeg's existing terminating proxy, by default, today. The
  conclusion (Chromium's exposure is larger) still holds, on breadth rather
  than on cookies: a whole rendered page is a bigger surface than the handful
  of URLs a `ProbeResult` names. The Decision section above is corrected in
  place, not narrated only here, since half one's builder reads that section
  and would otherwise inherit the wrong objection to answer.

  **Finding B, fixed: `TIER_TRUST_STORE_HINT` overclaimed causation for
  certificate-policy codes.** `ERR_CERT_WEAK_SIGNATURE_ALGORITHM`,
  `ERR_CERT_VALIDITY_TOO_LONG`, `ERR_CERT_NON_UNIQUE_NAME`,
  `ERR_CERT_NAME_CONSTRAINT_VIOLATION` and `ERR_CERT_SYMANTEC_LEGACY` all match
  the `net::ERR_CERT_*` prefix (confirmed by running the matcher against each)
  and are correctly coded `TLS_VERIFICATION_FAILED`, but they are policy
  violations a trust anchor does not change, and the hint asserted "fails here
  with EGRESS_CA_FILE set and correct" unconditionally. Reworded to a
  conditional ("if this is an origin chaining to a private root…") that points
  at `details.reason` for the actual cause rather than asserting one. Asserted
  in the new unit test.

  **Finding C, fixed: a Log sentence overstated coverage by one.** Corrected in
  place above, next to the claim it corrects, rather than only here.

  **What changed nothing.** The premises this ticket rests on — that
  `TLS_VERIFICATION_FAILED` needed no new code, that both real failure strings
  were now produced rather than inherited, that the yt-dlp behaviour change is
  real and tested at the registry level — were not touched by any finding; the
  gate's own acceptance table found Done-when 1 `proven` for both tiers and
  Done-when 3 `proven`, and said so before any of the above was fixed.

  **Gates re-run after the fix**, in this worktree: `npm run format`,
  `npm run check` (exit 0), `npm test -- --project downloader`. Numbers in the
  final report below.

- **2026-09-01** — Filed from dl-29's branch, alongside dl-35, on the precedent
  of dl-32/dl-33 riding dl-23's. Not folded into dl-29: it is a different tool
  area, it carries an open architectural decision, and dl-29 was explicitly told
  to stay out of `config.ts` while dl-31 was in gate.
