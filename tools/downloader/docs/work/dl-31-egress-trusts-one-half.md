---
id: dl-31
tool: downloader
title: The operator's CA reaches ffmpeg and the proxy, but never the dispatcher
kind: fix
status: done
milestone: null
depends_on: [dl-27]
---

# dl-31 — half the egress trusts the operator's root and half does not

**Packages:** `api` (`dispatcher.ts`, `server.ts`, `config.ts`, `api/test`).

## Why

An operator whose origins chain to a private root — a corporate TLS-inspecting
middlebox, an internal CDN — sets `FFMPEG_CA_FILE`. On `origin/main` today that
value reaches exactly one consumer:

- [`server.ts:142`](../../api/src/server.ts) → the engine's `tlsCaFile`, which
  becomes ffmpeg's `-ca_file`.

And it reaches the undici dispatcher **nowhere**.
[`dispatcher.ts:94`](../../api/src/dispatcher.ts) has the option and says what it
is for — `requestTls?: { ca: string }`, documented _"Injected for the same reason
`resolve` is… Unset in production, where the system trust store is the right
answer."_ [`server.ts:75-78`](../../api/src/server.ts) builds the dispatcher with
`guard` and `proxyUrl` and nothing else, so the only code that ever passes
`requestTls` is `api/test/proxied-https.test.ts:579`.

So on such a deployment the tool **half works, and the halves are the confusing
way round**: an ffmpeg download succeeds while the probe that set it up fails on
trust. The comment is not wrong about the intent — the system store _is_ the
right default — it is that `FFMPEG_CA_FILE` is the operator saying "and also
this one", and only one client hears it.

**This is pre-existing and nothing has to have changed for it to bite**: the
direct resolver has always fetched manifests through `GuardedFetch`.
[dl-30](./dl-30-measure-a-rendition.md) widens the blast radius rather than
creating it — its size probes now reach _segment_ origins through the same
fetch, so a deployment where only the segment CDN chains to the private root can
newly hit it.

**What [dl-27](./dl-27-verify-segment-origins.md) changes about this, and why
this ticket waits for it.** dl-27 gives `FFMPEG_CA_FILE` a _second_ consumer —
the terminating egress proxy reads it as `caFile` and merges it for origin
verification. Two consequences, and both are the reason `depends_on` names it:

1. **It already solves the trap this fix would otherwise walk into**, and says so
   in a comment worth reading before writing any of this: passing `ca` at all
   **replaces** Node's system store exactly as `-ca_file` does in ffmpeg, so an
   operator root handed over on its own fails every public origin. Its answer is
   `[...tls.rootCertificates, operatorCa]`. Building this before dl-27 lands
   means a second CA-merge in a second place, diverging from the first.
2. **It makes the name wrong rather than merely narrow.** Once `FFMPEG_CA_FILE`
   configures a proxy that is not ffmpeg, it is already the operator's egress
   root under a name that says otherwise. That turns "should the dispatcher read
   it too?" into a naming decision rather than a one-line wiring change, and
   Build 1 is where that gets settled.

## Build

1. **Settle the name first, because it decides the rest.** Two options, and this
   ticket should not be started until one is chosen:
   - **Keep `FFMPEG_CA_FILE` and add the third consumer.** One line in
     `server.ts`, no migration, no documentation churn. The cost is a variable
     named for ffmpeg that configures ffmpeg, a proxy and undici — a name that
     will mislead every operator who reads it after this.
   - **Introduce `EGRESS_CA_FILE`, with `FFMPEG_CA_FILE` as a deprecated alias
     that still works and warns at boot.** Names the thing it now is. Costs a
     config entry, a fallback, a boot warning, and a line in the README. This is
     the recommended one _if_ dl-27 has landed, because dl-27 is what makes the
     old name actively wrong.

2. **Widen `requestTls` to carry the merge.** It is typed `{ ca: string }`
   ([`dispatcher.ts:94`](../../api/src/dispatcher.ts)) and the merged form is an
   array, so this becomes `{ ca: string | string[] }`. Check the undici version
   pinned here accepts an array on `connect.ca` before relying on it — Node's
   `tls.connect` does, and undici forwards, but confirm rather than assume.

3. **Read the file once, at boot, and share it.** `server.ts` already reads it
   for dl-27's proxy; a second `readFile` of the same path in the same function
   is the kind of duplication that later drifts into two different error
   behaviours. Decide there whether an unreadable `FFMPEG_CA_FILE` is fatal —
   today it is silently ignored by the dispatcher because nothing reads it, and
   whatever dl-27 does with an unreadable one is the precedent to match.

4. **Do not reach for the alternatives.** `NODE_TLS_REJECT_UNAUTHORIZED=0` and
   an agent with `rejectUnauthorized: false` both turn off the check this ticket
   exists to make work, repo-wide and invisibly. If the fix seems to need
   either, it is the wrong fix.

## Done when

1. With `FFMPEG_CA_FILE` (or its successor) set to a fixture root, a
   `GuardedFetch` request to an origin signed by that root **succeeds**, proven
   by a test — the failure it replaces should be demonstrated first, so the test
   is known to be able to fail.
2. With the same variable set, a request to an origin signed by a _public_ root
   still succeeds — the merge, not the replacement. This is the regression the
   trap in the Why produces, and it is the one a fix will actually cause.
3. With the variable unset, the dispatcher passes no `requestTls` at all and
   behaviour is byte-for-byte what it is today, proven by a test.
4. Whichever name Build 1 chose is what the README and `.env.example` document,
   and if an alias was kept, a boot warning names it.
5. `npm run check` and `npm test -- --project downloader` pass.

## Gates

### Gate A — 2026-09-01, Sonnet (build was Opus)

**FAIL**, on Done-when 2 alone, and the reviewer labelled it a testability gap
rather than a code defect: `withSystemRoots`
([`operator-ca.ts:36`](../../api/src/operator-ca.ts)) reads the real,
non-injectable `tls.rootCertificates`, and no fixture in this repo can be signed
by a real public root — so the line as worded is unprovable by **any**
implementation under the fixtures-only rule, not by this one in particular.
Everything else passed.

What it reproduced independently, rather than read:

- The positive control, exactly: reverting the `originTls` spread at
  [`server.ts:101`](../../api/src/server.ts) turns 2 of the (then) 9 tests red
  and leaves 7 green.
- The two-root array claim, by mutating the array to a single entry and watching
  the other origin fail — so the test really does show undici honouring every
  element rather than the first or last.
- Both halves of the `NODE_EXTRA_CA_CERTS` finding, including that an explicit
  `ca` is **not** merged with it.
- That the boot test is not vacuous, by re-creating the pre-dl-27 conditional
  read and watching the `FFMPEG_TLS_INTERCEPT=false` case go red.

It called the `tls.rootCertificates.length > 50` floor a tautology, but not
misleading, since the test's own comment already calls it a sanity floor. Left
as is.

**Disposition:** the user accepted the Done-when 2 substitution; see the
2026-09-01 Log entry, which states plainly what is not proven.

### Gate B — 2026-09-01, Sonnet (build was Opus)

**PASS**, with two findings, both taken:

1. **A refused certificate reached the client as a retryable transport error.**
   `unwrapCause` re-threw only an `AppError`, so a TLS rejection stayed a bare
   `TypeError`; `direct.ts`'s `#request` caught any non-abort failure into a
   blanket `UNREACHABLE`; and `UNREACHABLE` is in `CORE_RETRYABLE_CODES`
   ([`errors.ts:115-117`](../../../../packages/core/src/errors.ts)). Not limited
   to "CA unset" — it fires for any origin `EGRESS_CA_FILE` does not cover.
   Fixed on this branch at the user's direction, against both the reviewer's and
   the orchestrator's recommendation to file it.
2. **`engine/src/config.ts`'s `FFMPEG_CA_FILE` fallback is not unreachable**, as
   the first Log entry claimed — it is inert for `api` but live for the M1 CLI at
   [`engine/scripts/download.ts:173`](../../engine/scripts/download.ts), which
   passes no `tlsCaFile`. Fixed and the Log corrected.

Its file:line citations were written against `2715466`; every one was
re-resolved against this branch's tip before being quoted above, and two had
moved.

## Log

- **2026-09-01** — Second round, after two gates. Merged `origin/main` up to
  `6f29eb0` first (#121, #122, #123 all landed under this branch); the merge was
  clean, and dl-23 added no new reference to the renamed field, which I checked
  by grepping the merged tree rather than trusting the pre-merge measurement.

  **The mechanism, which is the part worth keeping.** A trust failure ended up
  on a retryable transport code because **every party that had ever been asked
  to classify one was ffmpeg.** Both existing raises of
  `TLS_VERIFICATION_FAILED` are on ffmpeg's path — `ffmpeg/runner.ts:265` off
  stderr, and `egress-proxy.ts:456` off a socket the proxy owns — because dl-19,
  dl-21 and dl-27 were each about ffmpeg's TLS. undici "verifies without being
  asked", so no ticket ever asked what happens when it refuses, and the answer
  was: nothing looks. `unwrapCause` tests `cause instanceof AppError`, which is a
  test for errors _this repo threw_; Node's is not one, so it fell through as a
  bare `TypeError` and every caller downstream read it as transport.

  Two things made it invisible rather than merely unfixed. First, core's taxonomy
  already forbids it **in words** — `UNREACHABLE`'s own docstring
  ([`errors.ts:34`](../../../../packages/core/src/errors.ts)) says a certificate
  that _did_ arrive belongs on `TLS_VERIFICATION_FAILED` and that the retry
  answer differs — so a reader checking the rule would have found the rule
  correct and never looked at the one client that had no ticket. Second, the
  comment on `OriginCertificateError`
  ([`tls-interception.ts:280`](../../api/src/tls-interception.ts)) reads as "you
  cannot tell a rejected chain from a refused packet", and that is true **of the
  shape** — one own key, `code` — but not of the _value_. The escape it
  documents is owning the socket, which undici does not let you do, so the file
  that knew the most about this problem also read as saying the fix was
  unavailable. It was not; the codes are OpenSSL's and disjoint from errno.

  **What I built for it.** `guarded-fetch.ts:66-131` classifies on a closed set
  of verify codes plus the `ERR_TLS_CERT_` prefix, and raises
  `TLS_VERIFICATION_FAILED`; `direct.ts:170` passes an already-classified
  `AppError` through instead of re-wrapping it. **Both were needed** — fixing
  only the first changes nothing at the route, which the mutation run showed.
  The rest of the path was already built and simply never reached: 502 at
  `http-errors.ts:23`, not-retryable by omission from `CORE_RETRYABLE_CODES`, and
  finished UI copy at `web/src/lib/error-presentation.ts:62`.

  **Three verify codes, produced rather than listed.** Every fixture in this repo
  is self-signed, so a classifier keyed on `DEPTH_ZERO_SELF_SIGNED_CERT` alone
  would pass a suite built only from them. The test now provokes and asserts
  `DEPTH_ZERO_SELF_SIGNED_CERT`, `CERT_HAS_EXPIRED` (a new `expired` knob on the
  fixture, three lines) and `ERR_TLS_CERT_ALTNAME_INVALID` — three causes, three
  codes, one of them exercising the prefix branch rather than the set.

  **A test of mine was passing for the wrong reason and the mutation caught it.**
  The first draft of the `BLOCKED_TARGET` case submitted a blocked address
  directly, which `routes/probe.ts:46` refuses on the pre-flight guard before any
  resolver runs — so it never reached `#request`, and deleting the passthrough
  left it green. It is now a **redirect** to `169.254.169.254`, which only
  `guardedFetch`'s per-hop re-check can raise, with `ssrfAllowHosts` instead of
  `ssrfAllowPrivateAddresses` because the latter exempts every host including the
  metadata address. Recorded because the trap is general: with
  `allowPrivateAddresses` on, an SSRF test cannot fail.

  **A rebuild gotcha worth the line.** `api`'s tests import
  `@downloader/resolvers` from `dist`, so the first mutation of `direct.ts`
  reported "not caught" until `npm run build` ran. A source-only edit to another
  workspace is invisible to a mutation run without it.

  **Correction to my own last entry.** I wrote that
  `engine/src/config.ts`'s `FFMPEG_CA_FILE` fallback was "unreachable". Gate B
  traced it properly: it is unreachable _from `api`_ — `server.ts:259` omits
  `tlsCaFile` only when interception is off **and** `egressCaFile` is undefined,
  which since the alias merge means neither variable is set, and `main.ts:22`
  passes no overrides — but it is live for the M1 CLI, which passes no
  `tlsCaFile` at all. "Inert for `api`" is the true and more useful sentence.
  `engine/src/config.ts:210` now reads `EGRESS_CA_FILE` first and `FFMPEG_CA_FILE`
  second, matching the alias policy, with four tests in a new
  `engine/test/config.test.ts`. **This widens one line past the ticket's declared
  `Packages: api`**, which is said here rather than left to be noticed.

  **The alias is permanent — the user's decision, 2026-09-01.** Option A of the
  three put to them: `FFMPEG_CA_FILE` keeps working with the boot warning, no end
  date and no removal ticket. Recorded so it is not re-litigated: the two
  rejected options were a follow-up ticket to drop it at the next breaking
  release, and dropping it now.

  **Done-when 2 is substituted, not proven, and the user accepted it as such.**
  The line asks that a **public** origin still verifies with the variable set.
  **No test here proves that.** It cannot be proven here by any implementation:
  the merge reads the real `tls.rootCertificates`, which is not injectable, and
  the fixtures-only rule forbids reaching a real origin — Gate A reached the same
  conclusion independently and called it a testability gap rather than a defect
  in this branch. What stands in its place is two claims that _are_ measured, and
  **Gate A mutation-tested both halves itself**: replacing the merge with the
  operator CA alone is caught (`expected 1 to be 146`), and dropping one root
  from the two-root array makes that origin fail. What remains unmeasured is an
  actual handshake against a publicly-signed origin. Also still unmeasured: no
  container was built and no real system trust store was consulted.

  **The sibling survey Gate B's finding prompted — reported, not fixed, because
  the shape recurs and where it lands is not mine to decide.** All three resolver
  tiers end a failed fetch in a catch-all, and they are not equally bad:

  - `direct.ts:150` had **no** `AppError` passthrough. Fixed here.
  - `browser/classify.ts:149` **already** passes an `AppError` through and
    special-cases `TIMEOUT`, then falls back to blanket `UNREACHABLE`. Chromium
    names a certificate failure in the message it throws
    (`net::ERR_CERT_AUTHORITY_INVALID`), so it is classifiable and is not
    classified.
  - `ytdlp.ts:622` string-matches DRM, auth, geo and 429 off stderr and falls
    back to `NO_MEDIA_FOUND`. yt-dlp says `CERTIFICATE_VERIFY_FAILED` on stderr;
    likewise classifiable, likewise unclassified.
  - `size-probe.ts` and `size-sample.ts` swallow to `undefined`. Deliberate — a
    size probe is best-effort — and not the same defect.

  **And a second dimension neither this ticket nor dl-27 touched.** Chromium and
  yt-dlp sit behind the _tunnelling_ proxy and verify against their own stores,
  which are never given `EGRESS_CA_FILE` by any route — I grepped for a
  `--ca-certificate`, an `--ignore-certificate-errors` and a `NODE_EXTRA_CA_CERTS`
  and there is none. So on a private-root deployment those two tiers still fail,
  and now they fail with a code that says "no media found" or "site unreachable".
  That is a bigger claim than a misdiagnosis and it is **unverified**: I did not
  run either tier against a private-root origin. Worth a ticket; not one I filed.

- **2026-08-31** — Built. Branch `dl-31-egress-ca-file`, off `origin/main` at
  `1d2647b`.

  **The premise was unverified and it holds.** Reproduced twice before writing
  any fix, against a fixture origin signed by a private root:

  1. `createEgressDispatcher({ guard })` — what `server.ts` built — plus
     `createGuardedFetch`, fetching that origin: `TypeError: fetch failed`,
     `cause.code === "DEPTH_ZERO_SELF_SIGNED_CERT"`.
  2. A real `createApp` with the CA file set, `POST /api/probe` at the same
     origin: **`502 UNREACHABLE`, "The site could not be reached",
     `retryable: true`.** `two-origin-tls.test.ts` on the same tip was green at
     the same moment, so the ffmpeg half genuinely did work with the same file.

  **The symptom is worse than the Why said, and this is the part worth
  keeping.** "The probe fails on trust" understates it: nothing unwraps the
  rejection. `guarded-fetch.ts`'s `unwrapCause` re-throws only an `AppError`, so
  a refused chain surfaces as a bare `TypeError` and is mapped to a _transport_
  code. The operator is told their CDN is unreachable, on a **retryable** code,
  which is the one diagnosis that will never lead them to a trust setting.

  **One route the ticket did not consider, measured rather than assumed.**
  `NODE_EXTRA_CA_CERTS` _does_ reach the undici dispatcher — a child process with
  it set fetched the fixture origin 200 where the same child without it got
  `DEPTH_ZERO_SELF_SIGNED_CERT`. So a private-root deployment had a workaround,
  but it is a second variable, documented nowhere here, that the operator would
  have to know to reach for after setting the one this repo does document. It
  does **not** rescue the interception proxy either: `originCa` is passed as an
  explicit `ca`, and `tls.rootCertificates` is the compiled-in set, which
  `NODE_EXTRA_CA_CERTS` is not merged into. Not a reason to leave the wiring
  broken; a reason the failure was survivable in the field.

  **Build 1: `EGRESS_CA_FILE`, with `FFMPEG_CA_FILE` as a warning alias.**
  dl-27 is on `origin/main` (`ec1dd6b`) — confirmed by reading, not by relay:
  `tls-interception.ts` takes the operator root and merges it as
  `[...tls.rootCertificates, operatorCa]`. So the recommended branch applied.
  The new name wins if both are set; the old one still works and `server.ts`
  warns once at boot naming it. `ApiConfig.ffmpegCaFile` was renamed to
  `egressCaFile` with it — leaving the field spelled for ffmpeg would have moved
  the wrong name inside rather than fixing it.

  **What the Build section had wrong.**

  - **Step 2 would not have fixed the default deployment.** "Widen `requestTls`
    to carry the merge" misses that `requestTls` is read **only in proxy mode**
    — `createEgressDispatcher` returns a `ProxyAgent` there and a plain `Agent`
    with `connect: { lookup }` otherwise. A deployment with no `PROXY_URL` is
    the pinned branch, and it is the branch both reproductions above ran on. The
    option is now `originTls` and is applied in _both_ modes: `requestTls` on the
    `ProxyAgent`, `connect.ca` on the `Agent`. Had step 2 been followed
    literally, every test in this ticket would still be red.
  - **Step 3's premise about who reads the file.** `server.ts` did not read it;
    `createTlsInterception` did, internally, _and only when `ffmpegTlsIntercept`
    was on_. So dl-27's "validated at boot" was conditional, and
    `FFMPEG_TLS_INTERCEPT=false` still discovered a typo'd path one download at
    a time — dl-19's item 5, still open and believed closed. The read moved to
    `operator-ca.ts`, called unconditionally from `server.ts`, and
    `TlsInterceptionOptions.caFile` became `operatorCa` (PEM text) so there is
    exactly one read and one merge. Two tests now pin the fatal boot, one per
    value of `ffmpegTlsIntercept`; there were none before.
  - `dispatcher.ts:94`'s "Unset in production, where the system trust store is
    the right answer" is the sentence the defect was hiding behind. It is now
    the opposite: set in production whenever the operator set the variable.

  **Undici does take an array on `connect.ca`** — confirmed rather than assumed,
  as step 2 asked. `buildConnector.BuildOptions` extends `tls.ConnectionOptions`
  at undici 7.29.0, and a test reaches two origins with two different private
  roots from one array, which a stack that honoured only the first or last entry
  would fail.

  **What is not measured, named as unmeasured.** Done-when 2 asks that a
  **public** origin still verifies with the variable set. No test here touches
  one — fixtures, not live network, and no public root's key is available to
  sign a fixture with. The claim is split into two things that _are_ measured:
  nothing is dropped from a multi-entry `ca` (the two-root test), and the array
  handed over still contains the whole system store (`withSystemRoots` asserted
  element-wise against `tls.rootCertificates`). An actual handshake against a
  publicly-signed origin was never performed. Nor was a container built, nor any
  real trust store consulted.

  **Folded in rather than filed**, both in `.env.example` and both in the block
  this ticket had to rewrite anyway. Its CA paragraph still said the file
  _replaces_ the system store and that a typo'd path "is not refused at boot
  today" — untrue since dl-27, and the second one now untrue on the
  interception-off path too, which is this branch's doing. The paragraph above it
  still said segment fetches "are NOT yet covered" and named dl-27 as the open
  ticket, three commits after dl-27 merged; and `FFMPEG_TLS_INTERCEPT` was not
  in that file at all, so the escape hatch dl-27 built specifically to keep
  operators away from `FFMPEG_ALLOW_UNVERIFIED_TLS` was undiscoverable in the
  one place an operator looks for settings. Both corrected here.

  **Deliberately left out, so the omission is visible.** `ProxyAgent`'s
  `proxyTls` — the hop to the operator's _own_ proxy — is untouched. An operator
  behind a corporate middlebox plausibly has an `https://` `PROXY_URL` signed by
  the same root, and it is a one-line change. It is out because nobody has
  reported it, it is a different question from "which origins do we trust", and
  there is no fixture here that would make it able to fail. `engine/src/config.ts`
  still falls back to `env["FFMPEG_CA_FILE"]` for `tlsCaFile`; it is unreachable
  from this service (`server.ts` always passes `tlsCaFile` explicitly on the path
  where it matters) and the engine is a library with its own env contract, so
  renaming it there would widen this ticket into the engine for no behaviour.

- **2026-08-30** — Filed from dl-30, and the provenance matters because none of
  it is mine. **The asymmetry was found by dl-27's builder**, in the course of
  answering an unrelated question dl-30 had asked about egress; it reached me
  through that session's orchestrator (`tools-6c`), **explicitly relayed as
  unverified** — that session had not confirmed it either.

  **What I then verified myself, against `origin/main` at `6b6c785`**, rather
  than against the relay: `requestTls` exists at `dispatcher.ts:94` and is
  documented "Unset in production"; `server.ts:75-78` constructs the dispatcher
  without it; `server.ts:142` routes `ffmpegCaFile` to the engine alone; and the
  only `requestTls` caller in the tree is `api/test/proxied-https.test.ts:579`.
  So the mechanism is confirmed by reading.

  **What is still unverified, and should be the first thing done here.** No
  deployment with a private root was exercised — the dev container has no
  network — so the _symptom_ (a probe failing on trust while an ffmpeg download
  succeeds) is inferred from the wiring and has not been observed. Nothing in
  the suite fails today because of it, which is why Done-when 1 asks for the
  failure to be demonstrated before the fix.

  One correction to how this was nearly filed: the first pass at verifying it
  read `tools/downloader/api/src/*.ts` from the shared checkout, which was
  sitting detached on dl-27's tree — so it was reading dl-27's changes and
  believing them to be `main`. The lines above happen to be identical in both,
  so the conclusion survived, but the method did not, and the numbers here are
  re-read from `origin/main` with `git show`. Worth knowing in a repo where
  several sessions share one checkout: `git show origin/main:<path>` is the
  cheap way to be sure what you are reading.
