---
id: dl-19
tool: downloader
title: Make ffmpeg verify the certificates it is already encrypting to
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-19 — Encrypted is not authenticated

**Packages:** `engine` (`ffmpeg/args.ts`), `api` (config, and the image).

## Why

`tls_verify` defaults to `0` in libavformat and nothing in
`buildNetworkInputArgs` sets it, so **every manifest and segment ffmpeg fetches
is encrypted to a certificate nobody checked.** A MITM on the path to a CDN can
serve whatever it likes and ffmpeg will remux it into the user's download. Found
by [dl-14](./dl-14-proxied-https-coverage.md), which proved the capability works
and deliberately did not turn it on — see its Log's "What this turned up" for the
measurement.

Two things make this worth a ticket rather than a line in a gap list.

**The tool already verifies on its other download path.** Progressive downloads
and the engine's own segment fetches go through `guardedFetch` → undici, which
verifies by default; `EgressDispatcherOptions.requestTls` is a test seam and is
unset in production. So HLS and DASH — the paths that exist because MSE made
them the common case — are the unverified half, and nothing about the shape of a
URL tells a user which half they got.

**The egress proxy neither causes nor fixes it.** It tunnels rather than
intercepts, so the certificate arriving at ffmpeg is the origin's own — dl-14
asserts exactly that. Turning verification on is therefore orthogonal to
[dl-11](./dl-11-guarded-egress-proxy.md) and [dl-12](./dl-12-tiers-behind-the-egress-proxy.md),
and neither closes it.

## Build

**The substance of this ticket is the CA bundle, not the flag.** `-tls_verify 1`
is one line; the question dl-14 refused to answer from where it stood is _what
ffmpeg trusts once it starts checking_, and the answer differs between the two
ffmpeg builds this repo runs.

1. **Establish what each build's default trust store is, by measuring it.**
   - The **image** installs the distribution `ffmpeg` with `apt-get` on the
     Playwright `noble` base (`tools/downloader/Dockerfile`), so its TLS backend
     is the distribution's and should find `/etc/ssl/certs`. Should is not a
     finding: check it against a real public HTTPS origin inside the built
     container, and check whether `ca-certificates` is present because Playwright's
     base installs it or because `curl` pulled it in — an implicit dependency that
     a base-image bump can remove is not a trust store.
   - **Dev and CI** use `ffmpeg-static` by default and `FFMPEG_PATH` where the
     static build segfaults (see [dl-3](./dl-3-download-engine.md)'s Log). A
     statically linked build may carry no default CA path at all, in which case
     `-tls_verify 1` fails _every_ HTTPS download locally while the image is fine.
     That asymmetry is the trap: it makes the change look correct in CI and break
     for a developer, or the reverse.
   - Record both measurements in the Log. If the two disagree, the fix is an
     explicit `-ca_file`/`CA_FILE` resolved at boot, not a shrug.
2. **Turn it on in `buildNetworkInputArgs`**, beside `-protocol_whitelist` and
   for the same reason — a per-input security default, in the one function that
   builds every remote input. `buildLocalInputArgs` is unaffected.
3. **Give it an escape hatch, and make it loud.** An operator behind a
   TLS-intercepting corporate proxy has a legitimate reason to need this off, and
   will otherwise reach for the thing dl-14's traps forbid. One config flag,
   default on, refused silently by nothing: log a warning at boot when it is off,
   the way `SSRF_ALLOW_PRIVATE_ADDRESSES` is treated. Name it for what it does.
4. **Classify the failure.** A verification failure comes back as ffmpeg text on
   stderr and surfaces as `DOWNLOAD_FAILED`, indistinguishable from a dead link —
   the same ambiguity dl-11 hit and wrote up. Detect the certificate-failure
   strings and raise something a user can act on. **If no existing code fits, say
   so rather than inventing one locally** (root `CLAUDE.md`); this is plausibly a
   core-worthy code, since a second tool that fetches will meet it.
5. **Test it against the fixture CA**, extending
   `api/test/proxied-https.test.ts` rather than adding a file — it already has a
   per-run certificate, a TLS fixture origin and the passing
   `-tls_verify 1 -ca_file` case. The new assertions are the negative ones: an
   origin whose certificate does not chain to what ffmpeg trusts must fail, and
   fail _as a certificate problem_, not as a dead link.

## Done when

- `buildNetworkInputArgs` emits `-tls_verify 1`, and a test asserts it is on
  every remote input — including the audio input `manifest.ts` builds for a
  separate-track download.
- An HLS download from the fixture origin **fails** when ffmpeg is not given the
  fixture CA, and succeeds when it is. Both against real ffmpeg, in the same
  suite that already runs one.
- The failure carries a code and a message that say "certificate", distinct from
  a 404'd variant.
- The escape hatch turns verification off, logs a warning when it does, and has
  a test proving the argv changes.
- Both ffmpeg builds are measured and the result is in the Log, whichever way it
  came out.
- `npm run check` and `npm test -- --project downloader` are green, and
  `npm run e2e:downloader` passes unchanged — its origin is plain HTTP, so this
  must not touch it.

## Traps

- **`NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere in this repo is a finding, not a
  fix** — dl-14's trap, unchanged, and it applies to `-tls_verify 0` used as a
  debugging shortcut too.
- **A self-signed fixture fails for trust reasons that read exactly like the bug
  this ticket is about.** Pass the CA explicitly (`-ca_file`, and undici takes a
  `ca` in its connect options) rather than disabling verification to get green.
- **This is a behaviour change.** A site whose chain is broken or whose CDN
  serves an incomplete chain downloads today and stops downloading after this.
  That is the point, but it wants a line in the changelog written for a user
  rather than for us.
- **Do not touch the proxy.** It tunnels and must keep tunnelling; a proxy that
  terminated TLS to inspect it would break the very property dl-14 proved.

## Review

### Gate 1 — 2026-08-23 — **CONCERNS**

Reviewed at `96b6f22`; every `file:line` below is re-resolved against the tip of
this branch, which moved when the findings were addressed.

| #   | Done when                                                                                                           | Verdict           | Proven by                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `buildNetworkInputArgs` emits `-tls_verify 1`, asserted on every remote input including `manifest.ts`'s audio input | **proven**        | `engine/test/ffmpeg-args.test.ts:134`, `:237` (both inputs), `:252` (both under the hatch)                                                                                    |
| 2   | An HLS download fails without the fixture CA and succeeds with it, both against real ffmpeg in the same suite       | **proven**        | `api/test/proxied-https.test.ts:397` (fails), `:421` (succeeds)                                                                                                               |
| 3   | The failure carries a code and a message saying "certificate", distinct from a 404'd variant                        | **proven**        | `api/test/proxied-https.test.ts:397`, `:433` (404 stays `DOWNLOAD_FAILED`), `:474` (classifier)                                                                               |
| 4   | The escape hatch turns verification off, logs a warning, and has a test proving the argv changes                    | **partly proven** | argv and behaviour at `api/test/proxied-https.test.ts:451` and `engine/test/ffmpeg-args.test.ts:145`; **the boot warning at `api/src/server.ts:103` has no test** — finding 3 |
| 5   | Both ffmpeg builds measured, result in the Log whichever way it came out                                            | **verified**      | Log, "The two trust stores, measured"; re-run by the reviewer and reproduced                                                                                                  |
| 6   | `npm run check` and `npm test -- --project downloader` green; `npm run e2e:downloader` passes unchanged             | **verified**      | Reviewer's own baseline, below                                                                                                                                                |

**Verdict: CONCERNS**, as given and not softened. The implementation is correct,
the argv layer is well tested and the measurements reproduced independently; the
gap is finding 1, which is not this branch's doing, plus a config-and-wiring
layer that nothing pins.

#### Findings, all nine, with dispositions

1. **`-tls_verify` does not reach HLS/DASH segment fetches.** Proved by
   construction with two origins on one hostname, different ports, unrelated
   certificates: the manifest verifies, the segments do not, `EXIT=0` and 93,694
   bytes written. Three controls make it airtight — `openssl s_client` confirms
   the segment origin is genuinely untrusted, the inverse `-ca_file` _rejects_
   the manifest so the flag is honoured at the top level, and `-user_agent`
   reached the segment origin, so propagation exists and the TLS options are
   simply not in the propagated set. The repo's fixture is single-origin and
   structurally cannot see this. — **Doc corrected here**
   (`01-ARCHITECTURE.md:168`, `.env.example`, and this Log's opening);
   **[dl-21](./dl-21-verified-hls-segments.md) filed** carrying the reproduction
   verbatim. Not fixed on this branch: `main` verified nothing at all, so this
   narrows a pre-existing hole rather than creating one, and the owner's decision
   was to land it as a partial.
2. **Flipping the default at `api/src/config.ts:281` so a stock deployment ships
   with verification off survived** — all 651 tests stayed green under exactly
   the regression this ticket exists to prevent. — **Fixed here**:
   `api/test/queue-and-shutdown.test.ts:99`, which also covers reading override
   and env for both `ffmpegAllowUnverifiedTls` and `ffmpegCaFile`. Watched fail
   and recovered; see the mutation record below.
3. **The boot warning (`api/src/server.ts:103`) has no test.** — **Not fixed**,
   deliberately. The reviewer verified the behaviour at boot, so this is a
   missing test rather than a missing warning, and testing it means either
   asserting on a logger spy through `createApp` — which builds a database, an
   engine and two proxies to observe one line — or extracting the warning into a
   seam that exists only to be tested. Neither is worth it against a line whose
   failure mode is "an operator is not told something they typed themselves".
   Recorded here so the next person decides on the evidence rather than assuming
   it was missed.
4. **The classifier's `&&` is untested** (`engine/src/ffmpeg/runner.ts:96`):
   changing it to `||` keeps all tests green, so the "two halves, not a sentence
   list" design is unprotected — a `||` would classify any stderr containing the
   word "verify" as a certificate failure. — **Not fixed.** `:474` tests the
   inputs but no case separates `&&` from `||`; a killing test needs a string
   with one half and not the other (`"Invalid data found"` plus `"verify"`).
   Cheap, and it belongs with dl-21's work on this classifier rather than in a
   branch that is landing as a partial.
5. **`FFMPEG_CA_FILE` is not validated at boot.** A typo'd path fails every
   download as `TLS_VERIFICATION_FAILED` and blames the site, where `PROXY_URL`
   is refused at boot for exactly this class of mistake
   (`api/src/config.ts:188`). Also, **`-ca_file` replaces the system trust store
   rather than adding to it** — the code comment said so, `.env.example` did not.
   — **Half fixed**: both facts are now documented in `.env.example`, including
   that a corporate root means public CAs stop being trusted. The boot check is
   **not** added; it is a `statSync` and an `AppError` in `config.ts`, and it
   wants to land with a test rather than as an untested afterthought here.
6. **`engine/src/config.ts:138` says "Only the exact words" and then accepts
   `1`/`yes`/`0`/`no`** — three of four branches survive mutation. — **Not
   fixed.** The comment is describing the intent (a typo must not read as
   consent) rather than the implementation, and it is misleading as written. The
   function is also near-dead: `api` is the only caller in production and it
   passes an explicit override, so `loadEngineConfig`'s env reading is a CLI
   convenience. Worth a comment fix and three assertions; not worth reopening
   this branch.
7. **"The container gate is where that gets proven" was false.** — **Fixed here**
   in the Log: that job builds the image and polls `/api/health`, never
   performing an HTTPS download, so the image trust store stays unmeasured after
   CI is green. Noted as wanting a follow-up.
8. **The `ffmpeg-static` diagnosis was wrong.** — **Fixed here**, and the
   correction is itself a correction: re-measurement produced a 2×3 matrix
   showing **two** independent crashes, name resolution _and_ the MPEG-TS
   demuxer. Gate 1's counterexample was a `.ts` file, so it demonstrated the
   second crash rather than disproving the first. The CONNECT-proxy method was
   judged sound and the measurement stands.
9. **Cosmetic: `opensTls`'s catch branch emits the flag for a malformed or
   relative URL** (`engine/src/ffmpeg/args.ts:100`). — **Not fixed**, and the
   behaviour is deliberate and documented in the function's own comment: a parse
   failure defaults to _more_ verification, not less. A relative URL never
   reaches it, since every variant URL is absolutised before the engine sees it.

#### Mutation testing

**38 branches enumerated / 38 applied / 17 killed / 21 survived.** Nothing was
abandoned — the baseline, both e2e runs and every trust-store measurement
completed, so those counts are complete rather than partial. The survivor pattern
is one shape and worth naming: **the entire config-and-wiring layer between
`.env` and ffmpeg is untested.** The argv builder and the classifier's inputs are
well covered; everything that carries a value from an environment variable to
`buildNetworkInputArgs` was not, which is why a one-character change to the
shipped default went unnoticed.

The harness control was sound: on a clean tree it exited 0 with 46 files and 651
tests. My own re-verification of finding 2 followed the same discipline —
**control 0 (46 files, 652 tests) → mutation applied → red (1 failed, and the
mutation confirmed present in `api/dist/config.js`) → reverted → green (652)**.

**The stale-`dist` trap caught the reviewer too, and it caught itself.** Restoring
a mutated file with `mv "$F.bak" "$F"` preserves the original mtime, so
`tsc --build` skips the project and the _mutated_ `dist` survives the restore — a
false "survived" for every subsequent mutation. This is the second independent
occurrence in this batch. Restore by rewriting the file, `touch` the source
afterwards, and grep the built `dist` to confirm which version is actually in it.

#### Independently measured baseline

|                            | Test files | Tests | e2e             |
| -------------------------- | ---------- | ----- | --------------- |
| `origin/main`              | 46         | 640   | 3 passed        |
| this branch (at `96b6f22`) | 46         | 651   | 3 passed, twice |

My figures were confirmed exactly. The reviewer ran the e2e suite three times
with **no stall**, which is further evidence that the single stall recorded in
the Log was environmental rather than this change.

#### The core addition

**Judged justified**, with its blast radius enumerated across every code table in
the repo: `packages/core/src/errors.ts`, both tools' `DEFAULT_ERROR_MESSAGES`
(exhaustive `Record`, satisfied by the spread),
`downloader/api/src/http-errors.ts` (exhaustive — updated),
`planner/api/src/http-errors.ts` (`Partial` — correctly untouched),
`downloader/web/src/lib/error-presentation.ts` (exhaustive — updated) and the
mock scenario table. `UNREACHABLE` was confirmed wrong for it on both counts: its
copy is false on all three clauses, and it is retryable, so a certificate failure
would be retried against a certificate that cannot change.

#### What nothing proves

- **The image trust store.** No container runtime here, and the container gate
  does not perform an HTTPS download either (finding 7).
- **`ffmpeg-static` 7.0.2's segment behaviour.** It dumps core in the MPEG-TS
  demuxer on every successful local read on this platform, so it cannot run the
  fixture at all.
- **Windows/SChannel and OpenSSL classifier wordings.** Only gnutls's two
  messages were measured; the rest are covered on inspection.

## Log

**2026-08-23 — Done, and landing as a partial.** `-tls_verify 1` on every remote
input, a `TLS_VERIFICATION_FAILED` code in `@webtools/core`, and two settings:
`FFMPEG_CA_FILE` for an operator with a private root,
`FFMPEG_ALLOW_UNVERIFIED_TLS` for the one who has neither. `npm run check` green,
`npm test -- --project downloader` 652 tests in 46 files (up from 640/46),
`npm test` 1,378 green, `npm run e2e:downloader` 3 passing.

**Read the scope of this narrowly, because Gate 1 found it is narrower than the
ticket assumed.** What is verified is **the connection ffmpeg opens to the
manifest**. HLS and DASH **segment** connections are still unverified —
libavformat does not propagate the TLS options to the child connections its
demuxers open, though it does propagate `-headers` and `-user_agent`, so this is
an omission in the propagated set rather than a missing feature. A manifest on a
trusted origin whose segments live on an untrusted one downloads clean today.
[dl-21](./dl-21-verified-hls-segments.md) carries the reproduction and is the
ticket for it.

Landing anyway, and the reasoning is worth recording: **this branch regresses
nothing.** `main` verified no certificate at all, on either connection. The
segment gap is pre-existing, and this narrows it rather than creating it. What
could not ship was the sentence in `01-ARCHITECTURE.md` claiming HLS and DASH
"are no longer the unverified half of the same tool" — a guarantee an operator
would have believed and did not have. That bullet now states both limits
explicitly, and this Log's own broader phrasings were corrected with it.

### The two trust stores, measured

The brief's central question — what each build trusts once it starts checking —
has one answer for both builds: **the system store, and they agree.** So no
`-ca_file` is resolved at boot, and `FFMPEG_CA_FILE` exists for the operator
case rather than to paper over a disagreement.

- **`ffmpeg-static` 7.0.2** (`--enable-gnutls`, johnvansickle static build):
  verified a real public HTTPS origin with `-tls_verify 1` and no `-ca_file`,
  reading 101,147 bytes of body before failing on `Invalid data found when
processing input` — which is the demuxer's complaint about JSON, i.e. after a
  completed, verified handshake.
- **The distribution's ffmpeg 6.1.1** (Ubuntu noble, also `--enable-gnutls`):
  same command, same 101,147 bytes, same demuxer complaint. This is the binary
  `FFMPEG_PATH` names in CI, in the dev container, and in the image.

Both were then pointed at the fixture's self-signed origin and both refused it
with `Peer certificate failed verification`, so the successes above are the
trust store answering rather than verification being quietly off.

**Measuring `ffmpeg-static` took a detour worth writing down, and the first
version of this paragraph got it half wrong.** It claimed the crash was
`getaddrinfo` and nothing else. Gate 1 rebutted that with a counterexample —
7.0.2 dumps core on a plain `http://127.0.0.1/seg0.ts`, numeric, no TLS, so
resolution demonstrably worked. Re-measured properly, **both of us had one
crash and neither had both.** The same binary, same host, same server, `-c copy
-f null -`:

| ffmpeg-static 7.0.2 | `notes.txt` | `clip.mp4`  | `clip.ts`   |
| ------------------- | ----------- | ----------- | ----------- |
| `127.0.0.1`         | exit 183    | exit 0      | **SIGSEGV** |
| `localhost`         | **SIGSEGV** | **SIGSEGV** | **SIGSEGV** |

The distribution's 6.1.1 is clean in all six cells. So there are **two
independent crashes**: the `localhost` row dies whatever the payload, which is
name resolution; and `127.0.0.1 / clip.ts` dies with no name involved at all,
which is the MPEG-TS demuxer. A local `.ts` file with no network whatsoever
crashes too, which is what kills the resolution-only story outright — and since
every HLS segment is a `.ts`, that second crash is the one that actually explains
[dl-3](./dl-3-download-engine.md)'s "every hls-e2e case". Gate 1's counterexample
was a `.ts`, so it demonstrated the demuxer crash rather than disproving the
resolution one.

**What survives from the original claim is the part this ticket needed: it is not
TLS.** `127.0.0.1 / clip.mp4` over plain HTTP is clean, and the CONNECT-proxy
handshake below read 101,147 bytes over TLS without incident. dl-3's Log records
the SIGSEGV without locating it, and "on Linux CI" understates it — it is every
Linux host, this dev container included.

The trust-store measurement was taken by pointing the static build at a local
`CONNECT` proxy, and that method was judged sound by the gate: with
`-http_proxy`, libavformat resolves nothing itself and puts the hostname only in
the CONNECT line, so SNI and the hostname check still see the real name. It also
sidesteps both crashes, because a JSON body is neither a name lookup nor an
MPEG-TS stream.

**The image-side trust store is UNMEASURED.** There is no container runtime in
this environment — no `docker`, `podman`, `nerdctl` or socket — so the built
image was never run, and nothing here should be read as having checked it. What
_was_ checked, on the same `mcr.microsoft.com/playwright:v1.62.1-noble` base the
image uses, is the half of the brief's question that is answerable from a
package database: **`curl` cannot be the reason `ca-certificates` is there.**
`curl` 8.5.0-2ubuntu10.11 does not name it at all, and `libcurl4t64` only
_recommends_ it, which the `--no-install-recommends` in that same `RUN` declines.
So it was being inherited from the base image, which is exactly the implicit
dependency the brief refuses to call a trust store. Rather than infer whether
the base still ships it, `ca-certificates` is now **named explicitly in the
runtime stage** — free if it is already there, and no longer something a base
bump can take away.

**And nothing currently proves it, CI included.** An earlier draft of this
paragraph said the container gate in `.github/workflows/downloader.yml` "is where
that gets proven". It is not: that job builds the image and polls `/api/health`,
and never performs an HTTPS download. The image trust store is still unmeasured
after that gate is green, and it wants a follow-up — either a smoke step that
downloads over TLS inside the container, or an explicit acceptance that this is
checked by hand at release.

### What the brief had wrong

**`-tls_verify 1` cannot go on every remote input. `avformat_open_input` fails
on an option nothing consumed**, so a plain-`http://` manifest with the flag set
fetches the playlist, fetches the first segment, and then exits non-zero with
`Option tls_verify not found`. Measured on both builds. The e2e origin is plain
HTTP by [dl-14](./dl-14-proxied-https-coverage.md)'s deliberate choice, so the
"must not touch it" line in `Done when` and the step-2 instruction were in direct
conflict; the flag is now gated on the input URL's scheme, and
`ffmpeg-args.test.ts` pins both halves. Nothing is lost by the gate: a manifest
fetched in the clear can be rewritten in flight by whoever could have substituted
the segments, so authenticating the segments it names is a lock on a door with no
wall.

**Turning verification on breaks dl-14's own headline test**, which downloads
from the self-signed fixture through the proxy. That is the acceptance working as
intended, but it means the engine needed a way to be _given_ a CA — the ticket
only contemplated `-ca_file` as the answer to two builds disagreeing. So
`EngineConfig` gained `tlsCaFile` as well as `tlsVerify`, and the pair of tests
is now the proof: same origin, same argv, one setting apart.

**`SSRF_ALLOW_PRIVATE_ADDRESSES` is not "treated" any way at boot.** Step 3 says
to log a warning "the way `SSRF_ALLOW_PRIVATE_ADDRESSES` is treated" — there is
no such warning anywhere in the API; the flag is read in `config.ts` and passed
to the guard in silence. `FFMPEG_ALLOW_UNVERIFIED_TLS` now warns in `createApp`,
and it is the first setting here that does. Whether the SSRF flag should join it
is a ticket, not a line in this one.

### The error code, and where it lives

**`TLS_VERIFICATION_FAILED` is a new code in `@webtools/core`,** not in the
downloader's taxonomy. It describes the transport, and the repo's own tell
applies: reporting a rejected certificate as `UNREACHABLE` means replacing the
copy — "the site could not be reached" is wrong when the site answered — at the
raise site, which is how `NOT_FOUND` was found to be missing. A second tool that
fetches over TLS meets this without ever having heard of a video stream. It is
**not retryable**, which `UNREACHABLE` is: an identical request gets an identical
certificate, and retrying spends the budget to learn nothing.

`UNREACHABLE`'s doc comment lost "TLS failure" and gained the distinction. The
planner picks the code up through its own `[...CORE_ERROR_CODES]` spread and
maps it nowhere, which its `Partial<Record<…>>` status table allows; the
downloader maps it to 502 and gives it UI copy and a mock scenario, because its
`Record<ErrorCode, …>` tables are exhaustive by design.

Detection is by stderr, in `runner.ts`, because **libavformat gives every TLS
failure the same exit path** — `Input/output error`. The real line, from the
engine, through the guarded proxy, against the fixture:

```
[tls @ 0x561921ae4f40] Peer certificate failed verification
[tls @ 0x561921b38d00] Peer certificate failed verification
[tls @ 0x561921c74800] Peer certificate failed verification
[tls @ 0x561921d5d740] Peer certificate failed verification
[tls @ 0x561921e6bcc0] Peer certificate failed verification
[in#0 @ 0x561921b2c1c0] Error opening input: Input/output error
Error opening input file https://allowed.test:44285/master.m3u8.
Error opening input files: Input/output error
```

Five times over, once per `-reconnect` attempt. The matcher is two halves — the
word "certificate" and a verification/trust word — rather than a list of
sentences, because the sentence belongs to the TLS backend and this repo runs two
ffmpeg builds on three platforms. Only gnutls's wordings were measured; OpenSSL's,
SChannel's and SecureTransport's are covered on inspection and named as unmeasured
in the comment. The negative half of that test matters as much as the positive:
a 404, a bad manifest and a refused protocol must all stay `DOWNLOAD_FAILED`, and
there is a live test that a 404'd manifest still is.

### What proves it, and what does not

The certificate test is not one that would also pass with the origin switched
off. It asserts ffmpeg's own word for the failure, and it is paired with two
runs against the _same_ origin that succeed — one given the fixture CA, one with
`tlsVerify: false`. Verification off is tested because it is the documented
escape hatch, not as a way to get to green: no `NODE_TLS_REJECT_UNAUTHORIZED` was
set and no `-tls_verify 0` was used as a debugging shortcut anywhere. The proxy
is untouched and still tunnels; dl-14's assertion that the peer certificate's
fingerprint is the fixture's own still passes unchanged, which is what says so.

**`npm run e2e:downloader` failed once and then passed three times**, twice with
this change and once on `origin/main` in between. The failure was a download
stalled at 0 bytes for the full 120 s, on the first run of the session and
seconds after a whole-repo `npm test` had finished; it did not reproduce. It is
recorded here rather than dropped, but the change cannot be its cause: for a
plain-`http://` input the argv is byte-identical, since the only insertion is
inside the scheme gate, and every other change in the download path is reached
only on a non-zero exit.

Windows is the platform this could not check. `ci.yml` runs `npm test` on
`windows-latest` against `ffmpeg-static`'s win32 build, whose TLS backend was not
measured — dl-14's `-ca_file` test passes there, which rules out SChannel and
says little else. The certificate assertion in the new test is on the word rather
than the sentence for that reason.

**That assertion and the `code` assertion beside it are not independent, and an
earlier draft wrongly called `code` "the strict half".** `runner.ts` _derives_
the code from the stderr through `isTlsVerificationFailure`, so if a TLS backend
reworded its message the classifier would miss it, `code` would come back
`DOWNLOAD_FAILED`, and both halves of that test would fail together. There is one
assertion there wearing two coats. What genuinely is independent is the pair of
positive runs against the same origin — CA passed, and verification off — since
neither goes anywhere near the classifier.
