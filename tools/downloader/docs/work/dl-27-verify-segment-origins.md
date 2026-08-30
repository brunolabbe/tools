---
id: dl-27
tool: downloader
title: Verify the certificates on HLS and DASH segment connections
kind: fix
status: done
milestone: null
depends_on: [dl-21]
---

# dl-27 — Someone has to check the segment origin, and ffmpeg will not

**Packages:** `api` (`egress-proxy.ts`, `server.ts`), `engine` (`ffmpeg/args.ts`,
`ffmpeg/runner.ts`), `api/test`.

## Why

[dl-19](./dl-19-ffmpeg-verifies-tls.md) made ffmpeg verify the manifest.
[dl-21](./dl-21-verified-hls-segments.md) established, by measurement and from
the source, that **the segment connections cannot be made to verify from the
argv at all** — `ffio_copy_url_options` in `libavformat/aviobuf.c` copies seven
named options onto a demuxer's child connections and the TLS settings are not
among them. It is a compile-time array; FFmpeg master has eight names and still
not these two. dl-21 left the hole open on purpose and wrote down what it tried.

The hole is the whole video. The manifest is a few kilobytes of text; an
attacker on the path lets it through verified and untouched, intercepts only the
segment connections, and the substituted video is remuxed into the user's file
while the job reports success. `api/test/two-origin-tls.test.ts` pins exactly
that today, and **it is written to go red when this ticket lands**.

## Build

**The mechanism, measured working in dl-21.** Of the seven options libavformat
does propagate, one is `http_proxy` — and this API already puts a loopback
guarded proxy in front of every ffmpeg egress, unconditionally, whether or not
`PROXY_URL` is set (`server.ts` passes `egressProxy.url` to the engine). So the
proxy is on every segment connection already. Make it **terminate** those
connections instead of tunnelling them:

```
ffmpeg --TLS(the proxy's own leaf)--> egress proxy --TLS(verified)--> origin
```

ffmpeg's manifest connection has `tls_verify 1` and a `-ca_file` naming the
proxy's generated root, so it checks the leaf. Its segment connections have
`tls_verify 0` — nothing can change that — and accept the leaf without looking,
but the proxy has already verified the **real** origin for both. dl-21
prototyped this against its own two-origin fixture: with only origin A trusted
the proxy refused B with `DEPTH_ZERO_SELF_SIGNED_CERT` and the download produced
zero bytes; with both trusted it produced a playable file and B served every
segment. The prototype is in that ticket's Log.

1. **Decide whether to do it at all, and record the decision.** This reverses a
   deliberate choice. [dl-14](./dl-14-proxied-https-coverage.md) chose a CONNECT
   tunnel precisely so the certificate reaching ffmpeg is the origin's own, and
   `proxied-https.test.ts` asserts the peer certificate's fingerprint is the
   fixture's. That assertion has to change, and a reviewer needs to see the
   argument rather than the diff. The trade in one line: the tool gains real
   verification of every segment origin and gives up ffmpeg ever seeing an
   origin certificate, in exchange for the API holding every media byte in
   plaintext. Worth an amendment in `00-ANALYSIS.md` at least.
2. **Issue the certificates.** A root generated per process and a leaf per
   CONNECT target. Node's `crypto` cannot write a certificate, so this needs
   `node-forge` — today a **devDependency** used only by the fixture. Promoting
   it to a runtime dependency of `@downloader/api` changes what the image must
   ship: `packages/core/test/image-closure.test.ts` will name the missing lines,
   and the per-tool image gate still has to run.
3. **Keep `FFMPEG_CA_FILE` working.** `-ca_file` **replaces** the system store
   rather than adding to it, so ffmpeg's bundle becomes the generated root and
   nothing else — while the _proxy_ is the side that now needs the operator's
   private root, merged with the system store. The two CA settings swap sides,
   and getting this wrong fails closed on every public origin.
4. **Report the failure as what it is, and mind what dl-26 just did to this
   exact function.** In dl-21's prototype a refused segment origin surfaced to
   ffmpeg as `Invalid data found when processing input`, exit 183 — no
   certificate wording anywhere, so `isTlsVerificationFailure` in `runner.ts`
   classifies it `DOWNLOAD_FAILED`. A second gate run of the same prototype saw
   exit 8 (`Server returned 5XX Server Error reply`) because its proxy answered
   the refused `CONNECT` with `502` where dl-21's dropped the connection; the
   exit code is an artefact of refusal style, and **the load-bearing part is
   identical in both — no certificate semantics reach ffmpeg at all.** So the
   proxy is the only party that knows the real reason and has to carry it back
   out of band. A stderr matcher cannot do this one.

   **[dl-26](./dl-26-refusal-is-not-a-connect-failure.md) (#84) landed in
   `egress-proxy.ts` while dl-21 was in review, and it lands on this ticket's
   weakest point.** `createPinningLookup` reports its verdict through
   `callback(error)`, which node surfaces as the socket's `error` event — the
   same event `ETIMEDOUT` arrives on. A `BLOCKED_TARGET` from a DNS rebind and a
   dead network are therefore **indistinguishable by call site**, and dl-26
   splits them on `error instanceof AppError` for exactly that reason. A
   terminating proxy makes this worse rather than better: certificate
   verification failure becomes a **third** outcome converging on that one
   socket, and per the paragraph above it is the outcome whose only surviving
   evidence is the log line. Getting the three-way split right is part of this
   ticket, not a detail after it.

   The current strings, read out of the merged tree at `b76dca4` rather
   than taken on report:
   `refused a subprocess fetch` (keeps the `AppError` code),
   `a subprocess fetch could not connect` (carries `errno`/`syscall`/`reason`,
   no `code`), and `the upstream proxy refused a subprocess fetch` (chained
   only). **`refused an ffmpeg fetch` no longer exists in the tree** — it
   survives only in dl-26's own prose, describing what it replaced.

   **Use dl-26's tripwire rather than adding assertions.** It pinned the
   discrimination with a mutation: collapse `connectFailed` back into a single
   `refused` call and exactly one test fails while the rest stay green.
   Re-measured on this branch at `b76dca4`: **1 failed, 17 passed** in `egress-proxy.test.ts` — the failing one is _"an allowed host we
   cannot reach is not reported as a refusal"_. If restructuring that function
   for a terminating proxy leaves the suite green under a collapsed
   implementation, **the split has been silently lost** and no assertion you add
   will say so.

5. **Turn `two-origin-tls.test.ts`'s middle test around.** It currently asserts
   the download succeeds over an untrusted segment origin. It should assert it
   fails, with `TLS_VERIFICATION_FAILED`, against the same fixture and with the
   both-CAs case beside it still succeeding.

**The alternative, if step 1 says no.** Take fetching away from ffmpeg: the
engine's `download/segments.ts` path fetches through `guardedFetch`/undici,
which verifies already. It is a much larger change and it gives up ffmpeg's
native `EXT-X-KEY:METHOD=AES-128` handling, which `00-ANALYSIS.md` §3 puts
explicitly in scope, along with discontinuity handling and timestamp rebasing.
The engine also does not parse playlists by design, so the API would have to
feed it segment URLs from the dl-1 parsers in `resolvers`. dl-21 did not
prototype this one — it is named here as unmeasured, not as a fallback known to
work.

## Done when

- A test drives real ffmpeg against a two-origin fixture and the download
  **fails** when the segment origin is untrusted, carrying
  `TLS_VERIFICATION_FAILED`.
- The same download succeeds when both origins' CAs are trusted, so the failure
  is about trust and not about the second origin existing.
- Whatever `proxied-https.test.ts` asserted about the origin's certificate
  reaching ffmpeg is replaced by an assertion of what is then true, not deleted.
- `01-ARCHITECTURE.md`'s TLS bullet and `server.ts`'s boot warning both say what
  is then true; the warning dl-21 added should be gone or narrowed.
- `npm run check` and `npm test -- --project downloader` green,
  `npm run e2e:downloader` unchanged, and the container gate re-run if
  `node-forge` moved into `dependencies`.

## Traps

- **Do not turn verification off anywhere to get a fixture working.** The trap
  dl-14, dl-19 and dl-21 all carry. Trusting two origins is one PEM with two
  certificates in it.
- **A CA bundle is indexed by subject, and the subject is the only half that
  matters.** Two self-signed fixture certificates sharing a common name collide,
  and the bundle silently trusts only the first — refusing the other with
  `DEPTH_ZERO_SELF_SIGNED_CERT`, which reads like a network failure. dl-21
  shipped the fix: `createFixtureCertificate` takes a `commonName`, and a test
  pins that the bundle holds two certificates **and** that each origin completes
  a real handshake against it. It also issues a distinct serial per call, and
  **that part is defence in depth rather than the fix** — gate B mutated the two
  halves separately and reverting the serial alone leaves every test green.
  Distinct names are what you need. **This ticket's acceptance rests on that
  bundle**, so if you add a third origin, give it its own name. The helper sets
  no `subjectKeyIdentifier`/`authorityKeyIdentifier`, which is why a subject
  collision is fatal here rather than merely ambiguous.
- **An IP has no SNI.** RFC 6066 forbids it, so a leaf minted for a numeric
  CONNECT target needs the address in `subjectAltName`, not the name. dl-21's
  prototype hit this; Node's failure for it reads like a network error.
- **`ffmpeg-static` 7.0.2 has the same gap and can now be measured.** dl-19
  recorded its segment behaviour as unmeasurable because it dumps core in the
  MPEG-TS demuxer. dl-21 measured it anyway by generating **fMP4** segments,
  which avoid that demuxer entirely — the technique is worth reusing, and the
  answer was that 7.0.2 behaves exactly as 6.1.1 does.

## Gates

**A settled record can gain context but must never gain it silently.** These
sections are amended when a later round resolves something they left open, and
every such amendment is marked inline where it sits — because a reader cannot
otherwise tell what a gate said from what a subsequent round added, and a record
that quietly absorbs the outcome it was uncertain about stops being evidence of
anything. Verdicts are never edited. Gate 3 found this practice applied to one
amendment and not another in the same commit, which is how it comes to be written
down here rather than assumed.

### Gate 1 — 2026-08-30 — PASS

Reviewed at `ff12315`. The reviewer's report is posted to the pull request
thread; this section is the record of it, relayed rather than read first-hand —
what follows is the dispatching agent's summary of that report, and where this
record adds a measurement of its own it says so.

**Scope: the security claim, reproduced adversarially.** This gate did not
review the code, the packaging or the repo's invariants. Its question was
whether the branch's central claim survives someone actively trying to break it.

| #   | Claim under test                                                           | Verdict | Proof                                                                                                                              |
| --- | -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every mutation in the Log's table is killed                                | proven  | All twelve re-run with `tsc --build` between each — **12 run, 12 killed, 0 survived**                                              |
| 2   | The positive control is real, not a green harness                          | proven  | Rebuilt two independent ways, one a standalone script driving the production `buildManifestDownloadArgs` and `runFfmpeg`           |
| 3   | The POS byte count is the branch's, not a coincidence                      | proven  | **104,610 bytes to the byte** through that path; 104,667 through the full `engine.download()` pipeline, +57 from `-metadata title` |
| 4   | `-loglevel` is what carries the refusal reason                             | proven  | The Log's table reproduced row for row against ffmpeg 6.1.1                                                                        |
| 5   | Raising the level costs nothing on the happy path                          | proven  | Zero bytes of stderr on a clean run at `warning`, independently confirmed                                                          |
| 6   | The sticky classifier is load-bearing and the fixture cannot show it       | proven  | Asymmetry reproduced exactly: survives `two-origin-tls.test.ts`, killed only by `ffmpeg-runner.test.ts`                            |
| 7   | The wiring mutation is not silent                                          | proven  | Confirmed caught                                                                                                                   |
| 8   | The operator root is merged with the system store rather than replacing it | proven  | Arithmetic pinned on this machine: **145 roots, 146 after the merge**                                                              |

**Findings.**

- **1 (low) — the mutation table understates the kill breadth on three rows.
  Addressed in this commit, and not by taking the gate's numbers.** Every
  discrepancy runs in the direction of more tests catching a mutation than the
  table claimed, so nothing about the branch is weaker than recorded; what was
  wrong was the table's usefulness to whoever re-measures. **The cause is that
  "N failed" had no denominator** — the original rows were each scoped to
  whatever spec files that row needed, and this gate's rows were scoped to its
  own run, so the two sets of numbers differ from each other and from the
  project. All twelve are re-measured in the Log at one stated scope,
  `vitest run --project downloader`, 771 tests. Three rows moved upward: the
  operator root 3 → 7, `rejectUnauthorized: false` 4 → 8, the AKID 2 → 6. The
  gate reported 5 and 4 for the latter two, which is neither the old figure nor
  the new one and is not a contradiction — a narrower run. **Its third named row,
  `-loglevel` → `error`, is recorded as not reproduced**: the relay carried no
  figure for it and at project scope it measures 4, which is what the table
  already said. Correcting it to a number nobody measured would be the same
  defect the finding is about.

**What this gate did not do.** It could not reach a live public certificate
authority — outbound egress is blocked in this environment and it confirmed that
directly, `curl https://example.com` timing out — so the system-store merge is
proven as arithmetic and **not** as a handshake against a real CA. It did not
review code, packaging or repo invariants; those were gate 2's and are not
covered by this PASS.

### Gate 2 — 2026-08-30 — CONCERNS

Reviewed at `ff12315`. Relayed rather than read first-hand, as above. The verdict
is recorded as given.

**The concern is not a defect and not an unmeasurable.** `node-forge` moving to
`dependencies` cannot be proven by anything `npm test` runs, because the failure
mode is an image that builds, boots, and throws `ERR_MODULE_NOT_FOUND`. The
branch's Log already said so; this gate's contribution is to split that into the
half that can be settled here and the half that cannot.

| #   | Question                                                                 | Verdict         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does `npm prune --omit=dev` keep `node-forge` after the manifest change? | proven          | Scratch copy outside the repo mirroring the Dockerfile's build-stage manifest list: `npm ci` → 324 packages; prune → **160 packages, 342M → 152M**, node-forge surviving while `@types/node-forge` and `typescript` are dropped. Run twice from clean copies                                                                                                                                                                                                                                                                            |
| 2   | Does the image itself boot and answer `/api/health`?                     | unproven (gate) | Docker cannot run in this environment. This is the actual gate and it is the pull request's `docker` job                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Does that job run on a pull request from this branch?                    | proven          | `.github/workflows/downloader.yml:29` is the `pull_request` trigger, path-filtered to a set matching every non-`.md` file this branch touches                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Does it do real work rather than skip?                                   | proven          | `docker` and `e2e` executed 2m9s and 1m19s on `main` at `790c4a2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | Is `FFMPEG_ALLOW_UNVERIFIED_TLS` genuinely the only knob?                | proven          | Confirmed; and recorded **only** in this ticket's Log, not in `01-ARCHITECTURE.md`'s env table and not in the boot warning's hint. **— Added at `0fc4353`, after this gate:** that gap is what the user weighed in deciding to add `FFMPEG_TLS_INTERCEPT`, and the env table now carries both rows. The verdict cell is gate 2's own word, restored: an earlier edit had made it read `proven, and since acted on`, which put a later round's outcome in the column reserved for what the gate said. See the Log entry of the same date |

Points 3 and 4 were re-verified independently while writing this record, by
reading the workflow rather than taking it on report: the `pull_request` trigger
carries `tools/downloader/**`, `packages/**`, `package.json`,
`package-lock.json`, with `!**.md` last so a docs-only change is excluded; and
the `docker` job at `.github/workflows/downloader.yml:93` builds this tool's
image, runs `docker compose up -d --no-build`, and polls `/api/health` for five
minutes. A missing `node-forge` surfaces there as **"the service never became
healthy"** — `.github/workflows/downloader.yml:133` — followed by a
`docker compose logs` dump, not as a named module error. So that job going red
has to be read, not glanced at.

**Findings.**

- **1 (concern) — the packaging change has no local gate. Not addressed in code;
  addressed by opening the pull request.** Nothing in `npm test` can see it:
  `packages/core/test/image-closure.test.ts:114` filters every manifest's
  dependencies down to the repo's own scopes, so an ordinary npm package like
  `node-forge` is outside what that scan looks at by construction. What decides
  whether the image carries it is `tools/downloader/api/package.json:23` and
  `tools/downloader/Dockerfile:65`. Disposition: the branch is not
  merged on a green `npm test`; the `docker` job on the pull request is the
  gate, and its result is read before anything else happens.
- **2 (low) — this ticket had zero `file:line` citations, so `citations.mjs`
  reported 0/0 and nothing could go stale. Partly addressed, and the shortfall is
  recorded rather than papered over.** Both gates reached this builder as prose
  and neither relay carried a single `file:line`, so writing the records
  reproduced the problem: `citations.mjs` over the first draft of them still said
  **0/0**. Manufacturing line numbers to make that count non-zero would invent
  precision and attribute it to a gate that never claimed it — the same defect
  pointing the other way. What is cited above is therefore only what **this
  builder verified first-hand while writing the record**: the workflow trigger,
  the `docker` job and the message it fails with, and the three lines that decide
  whether the image carries `node-forge`. The gates' own findings stay in prose,
  because prose is what they were. `node scripts/citations.mjs` is run as the
  last action before the commit that carries this section, and its count is in
  the Log's gate commands.

**What this gate did not do.** It re-ran none of the ffmpeg work, none of the
mutations and none of the `-loglevel` measurements — those were gate 1's, and
this CONCERNS says nothing about them. It could not run Docker, which is the
whole reason its central question is deferred rather than answered.

### Gate 3 — 2026-08-30 — PASS

Reviewed at `0fc4353`, the commit that added `FFMPEG_TLS_INTERCEPT`. Relayed
rather than read first-hand, as above.

**Scope: the knob, and specifically the two risks adding it created.** Neither
reproduced. This gate did not re-review the mechanism gate 1 covered, and the
relay carries no statement about the packaging, the image, or the documentation —
so this PASS should be read as covering the flag and nothing else.

| #   | Risk under test                                                                                   | Verdict   | Proof                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does the flag blind the suite to a **broken** wiring, now that a tunnelling ffmpeg is legitimate? | disproven | Gate 1's original mutation — split pair, tunnelling proxy with the generated root — **still dies**, killed by two tests. All six knob mutations run, all six killed               |
| 2   | Does an unparseable value fail closed for the reason the Log claims?                              | proven    | By execution: `bool("flase", true) → true` and `bool("flase", false) → false`. The parser is **direction-agnostic**; the safety comes entirely from which default each flag chose |
| 3   | With the flag off, is the terminating proxy really not started?                                   | proven    | `ffmpegProxyUrl === egressProxyUrl`, `ffmpegProxyTls === "tunnel"`, and `createTlsInterception` genuinely does not run                                                            |
| 4   | Does the off state actually reopen the hole it warns about?                                       | proven    | Segments served from the untrusted origin at >10 KB — dl-21's hole reproduced deliberately, which is what makes the boot warning true rather than cautious                        |
| 5   | Does the conditional second proxy leak a listener?                                                | proven    | No leaked listener and no port-reuse failure across the suite                                                                                                                     |

Row 2 is the one worth keeping. The Log claimed the typo case fails closed
_because of the default rather than the parser_, and that was reasoning; this
gate turned it into two measurements pointing opposite ways from the same
function.

**Findings.**

- **1 (low) — one settled record gained context with a marker and another gained
  it without one, in the same commit. Fixed in this commit.** `0fc4353` left the
  superseded "no second knob" bullet standing with an explicit inline
  `— OVERRULED the same day` marker, which is right, and in the same breath
  edited **gate 2's verdict table, row 5** from `proven` to
  `proven, and since acted on` with an appended explanation and no marker at all.
  The content was accurate and the verdict was not softened, so this is an
  inconsistency rather than a fabrication — but it is the inconsistency that
  matters, because a reader of that row could not tell what gate 2 said from what
  a later round added. Addressed by applying the bullet's practice to the row
  rather than by deleting the context: the addendum is now marked
  `— Added at 0fc4353, after this gate:`, and the verdict cell is restored to
  gate 2's own `proven`, since a later round's outcome does not belong in the
  column reserved for what the gate concluded. The general rule is now stated
  once at the top of this section.

**An environment finding worth more than the gate's own verdict.** Gate 3's
worktree had **no `node_modules` farm and no built `dist`**, so
`@downloader/engine` resolved through Node's parent-directory lookup to the
**shared checkout's stale `dist`, built from a different branch**. Three or four
tests came back `DOWNLOAD_FAILED` where they should have said
`TLS_VERIFICATION_FAILED` — which is **precisely the symptom of the `-loglevel`
and sticky-classifier mutations succeeding**. It caught this and rebuilt before
measuring anything; had it not, the sweep would have reported two of this
branch's engine changes as unnecessary, with every number in the table looking
plausible. This is the same defect class as the Log's own "three first-sweep
results were invalid", arriving from the opposite direction: there, a mutation
was not rebuilt into `dist`; here, `dist` was somebody else's entirely. Both are
in the Log's re-measurement note, because anyone re-measuring this branch needs
both.

## Log

**2026-08-30 (later) — `FFMPEG_TLS_INTERCEPT` added, overruling this Log's own
recommendation.** "Deliberately not done" below argued against a second knob and
the user weighed it and decided the other way. The argument that beat mine is
better than mine: gate 2 established that "there is only one knob" was recorded
**only here**, not in `01-ARCHITECTURE.md`'s environment table and not in either
boot hint — so the realistic path for an operator broken by the interception was
to find `FFMPEG_ALLOW_UNVERIFIED_TLS`, the one escape the table did name, and
give up the manifest check as well. **Trading all verification for a proxy
problem is the worst of the three states this service can be in**, and a smaller
escape that is documented next to the larger one is what stops it. The bullet
below is left standing rather than rewritten, and this paragraph is what
overrules it.

**Interception stays the default.** `FFMPEG_TLS_INTERCEPT=true` unless an
operator says otherwise, and `bool()` falls back to the default on anything it
cannot parse — so `FFMPEG_TLS_INTERCEPT=flase` leaves interception **on**. That
direction is not luck and it is not the parser: `FFMPEG_ALLOW_UNVERIFIED_TLS`
gets the same fallback and is safe because its default is `false`. For a flag
whose _off_ state reopens a hole, only a default of `true` makes an unparseable
value fail closed. Pinned in `queue-and-shutdown.test.ts`, both spellings.

**With interception off, no second proxy is started at all.** A tunnelling proxy
is what `tierProxy` already is, so a second one would be an identical listener
and two RSA keygens to no purpose; `ffmpegProxyUrl` and `egressProxyUrl` are then
the same string, and both are `null` at shutdown. The trust store swaps back with
it — ffmpeg is meeting the origin again, so `FFMPEG_CA_FILE` returns to ffmpeg,
which is dl-19's arrangement unchanged.

### How the flag was kept from costing gate 1's kill

**This is the part that needed care, and the coordinator was right to name it.**
Gate 1 verified the two-proxy wiring by mutating `server.ts` so ffmpeg receives
the tunnelling proxy, and confirmed a test went red. The flag makes that state
**legitimately reachable**, so a test asserting "ffmpeg is never on the tunnelling
proxy" would now fail on a correct deployment and gate 1's kill would become a
false positive.

What separates the two causes is that the proxy and the trust store are only ever
correct **as a pair**, and the two legitimate pairings have _opposite_ outcomes on
the two-origin fixture while both split pairings have a third outcome that is
neither:

| ffmpeg's proxy | ffmpeg's `-ca_file` | outcome with `FFMPEG_CA_FILE` = origin A    |
| -------------- | ------------------- | ------------------------------------------- |
| terminating    | generated root      | fails at the **segments**; A served, B not  |
| tunnelling     | operator root       | **succeeds**; B serves the whole video      |
| tunnelling     | generated root      | fails at the **manifest**; A served nothing |
| terminating    | operator root       | fails at the **manifest**; A served nothing |

So there are two end-to-end tests through a real `createApp`, differing only in
the flag, asserting opposite results — and each asserts that origin A _was_
served, which is the assertion that tells a manifest failure from a segment one.
A split pair fails both; an operator-requested tunnel fails neither. `server.ts`
now also chooses the pair in **one** place, a single `ffmpegEgress` object, so
the split states are harder to reach by accident than by mutation.

Six mutations, over `two-origin-tls`, `logging` and `queue-and-shutdown`:

| Mutation                                     | Result                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| split pair: tunnelling proxy, generated root | **killed** — 2, incl. the intercepting wiring test   |
| split pair: terminating proxy, operator root | **killed** — 1, the intercepting wiring test only    |
| the flag ignored, interception always off    | **killed** — 4                                       |
| the flag ignored, interception always on     | **killed** — 3, incl. the **tunnelling** wiring test |
| the default flipped to off                   | **killed** — 4                                       |
| the off-state boot warning deleted           | **killed** — 1                                       |

**The first and the fourth rows are the whole answer.** Gate 1's original
mutation is row 1 and it still dies, so nothing was lost. Row 4 — a build that
ignores the flag and always intercepts — dies on the _other_ test, which is the
half that did not exist before. Neither test alone can tell the two tunnelling
causes apart; the pair can, and each row above proves one direction of it.

Two smaller notes. `AppContext` gains `ffmpegProxyUrl` beside `egressProxyUrl`,
because equality between them is now meaningful rather than a bug — it is how a
test says "the operator asked for the tunnel" without running a download. And
`FFMPEG_ALLOW_UNVERIFIED_TLS` still outranks the new flag: both set produces
dl-19's single louder line, never two lines describing the same deployment at
different sizes, which is `logging.test.ts`'s standing invariant.

**2026-08-30 — Built, with step 1 answered yes and the mechanism measured both
ways.** The proxy terminates ffmpeg's TLS, verifies each origin itself, and
re-encrypts under a leaf it issues. The middle test in `two-origin-tls.test.ts`
is turned around and the download that used to arrive from an untrusted origin
with exit 0 now fails with `TLS_VERIFICATION_FAILED`.

### Step 1, decided and why

**Yes, and the deciding fact is not in the brief: `dl-14`'s tunnel is not
uniform, so reversing it does not have to be either.** This proxy serves three
subprocesses — ffmpeg, Chromium and yt-dlp — and only one of them cannot verify
its own connections. Chromium and yt-dlp verify natively, and a terminating
proxy in front of Chromium would refuse every HTTPS page it loads, because the
generated root is in no browser trust store and the only ways round that are
`--ignore-certificate-errors` or an NSS database. So `server.ts` starts **two**
proxies: the tiers keep the tunnel `dl-14` chose, with the origin's own
certificate reaching them, and ffmpeg gets the terminating one. That makes the
trade narrow rather than wholesale — the plaintext hop is the media bytes only,
which is where they were going anyway — and it turns "we gave up end-to-end
certificates" into "we gave them up for the one client that could not use them".

The alternative in the brief — take fetching away from ffmpeg — is still
unmeasured and is now further away rather than nearer: it costs native
`EXT-X-KEY:METHOD=AES-128`, which `00-ANALYSIS.md` §3 puts explicitly in scope,
plus discontinuity handling and timestamp rebasing, and the API would have to
feed the engine segment URLs from the `dl-1` parsers.

The decision is recorded as an amendment in `00-ANALYSIS.md` §3, under the
sentence it overrules ("treat it as ordinary transport, because it is"), and the
consequences are on `01-ARCHITECTURE.md`'s TLS bullet. Neither is a copy of the
other: the analysis says what changed about the scope, the architecture says what
an operator now has.

### What the brief had wrong

**1. "A stderr matcher cannot do this one" is wrong, and the reason is a
`-loglevel` this repo sets to `error`.** The brief reads dl-21's prototype
correctly — a dropped tunnel is exit 183 `Invalid data found`, a `502` is exit 8
`Server returned 5XX`, and neither says anything about a certificate — but
neither prototype chose the reason phrase, and nobody raised the log level.
Measured here, on ffmpeg 6.1.1-3ubuntu5, against a proxy answering
`502 TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)`:

| `-loglevel` | what reaches stderr                                                         |
| ----------- | --------------------------------------------------------------------------- |
| `error`     | `Error opening input: Invalid data found when processing input` — no reason |
| `warning`   | `[httpproxy @ …] HTTP error 502 TLS certificate verification failed (…)`    |
| `verbose`   | the same, plus the connection trace                                         |

**ffmpeg logs a proxy's status line verbatim, at `AV_LOG_WARNING`**, and it does
it on the _segment_ connections as well as the manifest — which is the case the
brief was right to say has no other channel. So `GLOBAL_ARGS` now asks for
`-loglevel warning`, one word, and `isTlsVerificationFailure` reads the phrase
without being taught anything new: it already matches "certificate" and
"verif". The cost was measured rather than assumed — **a clean HLS download
through the terminating proxy emits zero bytes of stderr at `warning`**.

That is a strictly better answer than the out-of-band channel the brief asks
for, and the difference is attribution. A record on the proxy would have to be
matched to a job by time window, and one proxy serves every download; the status
line arrives on the failing run's own stderr, so there is no attribution problem
to get wrong.

**2. It needed a second half, which the fixture could not have shown.** The
reason phrase is three lines per refused segment. `runFfmpeg` classified off a
4 KB stderr **tail**, so on any playlist longer than ~25 segments the sentence
naming the reason has scrolled out before ffmpeg exits, and the job is
`DOWNLOAD_FAILED` again — in production, while the two-segment fixture stays
green. `runner.ts` now sets a sticky flag per stderr line over the whole stream,
keeping dl-19's tail check beside it because that one can still match across two
lines. A mutation removing the sticky flag **survived** `two-origin-tls.test.ts`;
`engine/test/ffmpeg-runner.test.ts` exists to kill it, and does.

**3. `packages/core/test/image-closure.test.ts` does not fail, and expecting it
to is the wrong model of that scan.** It walks _workspace_ dependencies —
`@downloader/*`, `@webtools/*` — because those are what the Dockerfile lists by
hand. `node-forge` is an ordinary npm package inside `node_modules`, which the
runtime stage copies wholesale after `npm prune --omit=dev`, so promoting it to
`dependencies` in `tools/downloader/api/package.json` (and clearing `"dev": true`
in `package-lock.json`, which is what `prune` actually reads) is the entire
change. **No Dockerfile line moves, and no scan in this repo would have caught
it if I had forgotten** — the failure mode is `ERR_MODULE_NOT_FOUND` at boot, in
the image only. That gap is worth a ticket and is named in the report rather than
filed here.

**4. The `Traps` section is right about IP SANs and understates one thing.** A
CA bundle is indexed by subject, as it says; what bit here instead was
`authorityKeyIdentifier`. forge resolves `keyIdentifier: true` against **the
certificate being signed**, so a leaf gets its own key's identifier where the
issuer's belongs, and OpenSSL then reports `UNABLE_TO_VERIFY_LEAF_SIGNATURE` —
"unable to verify the first certificate" — on a signature that is perfectly
good and an issuer that is in the store. It cost the first end-to-end run, which
is written up below because of _how_ it failed.

**5. `Node`'s TLS error does not carry the certificate.** The obvious test for
"did we refuse the certificate" is `"cert" in error`; measured, a rejected chain
gives `{ message: "self-signed certificate", code: "DEPTH_ZERO_SELF_SIGNED_CERT" }`
with `code` as its **only** own key — the same shape an `ECONNREFUSED` has. Only
`ERR_TLS_CERT_ALTNAME_INVALID` attaches one. What does say so is the socket:
`TLSSocket.authorizationError`, set before the socket is destroyed, for the chain
check and the name check alike. So the site holding the socket wraps it in an
`OriginCertificateError` and `connectFailed` splits on the type, which is the
move dl-26 made with `AppError`.

### The positive control, and the run that had none

**The first end-to-end run failed identically in both directions**, and that is
the finding worth recording, not the bug behind it. NEG (proxy trusts origin A
only) and POS (proxy trusts both) both produced `TLS_VERIFICATION_FAILED`, zero
bytes, and the same five lines of `Peer certificate failed verification`. A
sweep read only for "the untrusted case fails" would have called that a pass. It
was the `authorityKeyIdentifier` defect above: **ffmpeg was rejecting our own
leaf**, so nothing in the run had anything to do with origin B at all.

What separated them was a control that asks the opposite question — can this
harness _succeed_? Once the AKID was right:

```
### NEG  proxy trusts A only
    code=TLS_VERIFICATION_FAILED  bytes=0  B-served=0
    [httpproxy @ …] HTTP error 502 TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)
    [hls @ …] Failed to open segment 0 of playlist 0
### POS  proxy trusts A and B
    code=null  bytes=104610  stderr=0 bytes
```

**104,610 bytes is dl-21's own figure for this fixture, to the byte.** So the
refusal is about trust and the fixture is a working HLS download, not a broken
one — and both are asserted in the suite rather than only measured here.

The same shape is kept inside the suite. `two-origin-tls.test.ts` runs the
positive control **first** ("an untrusted manifest origin is refused before a
byte is served"), and keeps dl-21's characterization test as its last case,
against a _tunnelling_ proxy, where the whole video still arrives from the
untrusted origin with exit 0. That is what says the three tests above it measure
the interception rather than a fixture that quietly lost its second origin.

### The mutation run

Twelve mutations, **every count below re-measured at one scope**:
`npx vitest run --project downloader`, 771 tests. The first table mixed
scopes — each row was "N failed" over whatever spec files that row happened to
need — which is how a mutation table under-reports without anyone lying. Gate 1
found three rows understated and it was right about the shape; the numbers below
are not its numbers either, for the same reason. **A kill count without a
denominator is not a measurement**, so the denominator is now stated once and
every row shares it.

| Mutation                                                        | Failing tests | Where the strongest one is                    |
| --------------------------------------------------------------- | ------------- | --------------------------------------------- |
| `connectFailed` collapsed to one `refused` (dl-26's tripwire)   | **3**         | `egress-proxy.test.ts`, incl. dl-26's own     |
| the certificate leg folded into `unreachable`                   | **2**         | `egress-proxy.test.ts`                        |
| `server.ts` hands ffmpeg the tunnelling proxy                   | **1**         | `two-origin-tls.test.ts`, the wiring test     |
| the CA swap reverted (engine gets `FFMPEG_CA_FILE`)             | **1**         | the same wiring test, its only other guard    |
| the proxy loses the operator root entirely                      | **7**         | four suites at once                           |
| the proxy **replaces** the system store instead of merging      | **1**         | `tls-interception.test.ts`, written for it    |
| the proxy stops verifying origins (`rejectUnauthorized: false`) | **8**         | the broadest — it is the whole mechanism      |
| `-loglevel warning` back to `error`                             | **4**         | `two-origin-tls.test.ts` × 3                  |
| the sticky stderr classifier removed                            | **1**         | `ffmpeg-runner.test.ts`, written for it       |
| the leaf's AKID back to `keyIdentifier: true`                   | **6**         | reproduces the historical both-directions bug |
| every leaf SAN forced to `DNS:` (the IP-has-no-SNI trap)        | **4**         | `tls-interception.test.ts` + three downloads  |
| the root's private key written beside its certificate           | **1**         | `tls-interception.test.ts`                    |

Twelve run, twelve killed, none survived.

**dl-26's tripwire now fails three tests where its own ticket measured one, and
that is the correct evolution rather than a loss of precision**: collapsing
`connectFailed` takes out dl-26's test (_"an allowed host we cannot reach is not
reported as a refusal"_) plus the two dl-27 added for the third leg. The split is
still the only thing holding the three apart.

**Three rows moved on re-measurement and all three moved upward** — the operator
root 3 → 7, `rejectUnauthorized: false` 4 → 8, the AKID 2 → 6. Gate 1 named
`rejectUnauthorized` and the AKID too, with 5 and 4 against this table's 4 and 2,
which are different again: its run and the first one here were both narrower than
the project. **The three sets of numbers do not contradict each other and none of
them was wrong; they answered three different questions.** Gate 1 also named
`-loglevel` as understated and the relay carried no figure for it; at project
scope it is **4**, which is what this table already said, so that one is recorded
as not reproduced rather than corrected to a number nobody measured.

Two rows are worth reading for their shape rather than their size. The AKID
mutation kills **6**, and it is the one that matters most to a later reader:
reverting it reproduces exactly the historical defect described above, where NEG
and POS failed identically because ffmpeg was rejecting our own leaf. And the
two `1`s at the top — the wiring and the CA swap — are single-test kills on
purpose: **one test is the only thing standing between this branch and silently
restoring dl-21's hole**, which is a reason to treat it as load-bearing rather
than to add company for it.

**Three mutations in the first sweep were invalid and reported green.** `-loglevel`
and the sticky classifier live in `engine/src`, and the API suites import
`@downloader/engine` — which resolves to its **`dist`**. An engine mutation that
is not rebuilt is a mutation the suite never sees. Re-run with
`tsc --build` in the loop, both die. Anyone re-measuring these on this branch
has to rebuild the engine between mutation and run; that is the single most
likely way to conclude, wrongly, that this branch's engine changes are
unnecessary. Gate 1 reproduced all twelve with a build between every one and got
twelve kills.

**Gate 3 hit the same defect from the opposite direction, and its version is
worse because nothing about it looks wrong.** Its worktree had no `node_modules`
farm and no built `dist`, so `@downloader/engine` did not fail to resolve — it
resolved **through Node's parent-directory lookup to the shared checkout's
`dist`, built from a different branch entirely**. Three or four tests returned
`DOWNLOAD_FAILED` where they should have said `TLS_VERIFICATION_FAILED`, which is
**exactly what a successful `-loglevel` or sticky-classifier mutation looks
like**. It caught this and rebuilt before measuring anything; a sweep that had
not would have reported two of this branch's engine changes as dead code, with
every figure in the table looking entirely plausible.

So the instruction for anyone re-measuring this branch has two halves, and
missing either produces confident wrong numbers in the same direction:
**run the `node_modules` farm and `npm run build` first**, so `dist` is this
branch's rather than whatever the shared checkout last built, and **rebuild the
engine between a mutation and its run**, so a mutation is one the suite can
actually see. The first is invisible — there is no error, just a different
branch's answers.

The third was `server.ts` handing ffmpeg the wrong proxy. It survived
**legitimately**: every test built its own proxy, so nothing looked at the
production wiring, and `logging.test.ts`'s check read `ffmpegProxy.tls` — the
object, not what the engine was given. The answer is the last test in
`two-origin-tls.test.ts`, which boots a real `createApp` with
`FFMPEG_CA_FILE` set to origin A's certificate and drives a download through
`app.context.engine`. It is also the only thing that pins the CA swap.

### What is in this branch

- **`api/src/tls-interception.ts`** (new). A root generated per process — **its
  private key is never written anywhere**, only the certificate, which is what
  `-ca_file` needs a path for — and a leaf per CONNECT host, all sharing one key
  so issuing one is a signature rather than an RSA keygen in front of a download.
  Node's `generateKeyPairSync` makes the keys (native, milliseconds) and forge
  only signs, which is the narrowest use of the dependency that does the job.
  `originCa` is `[...tls.rootCertificates, operatorRoot]`: the merge is the thing
  the brief's step 3 is about.
- **`api/src/egress-proxy.ts`**. `interceptTls` and `EgressProxy.tls`, a
  `terminateTls` that completes the origin handshake **before** the client is
  told `200` — which is what lets a refusal be a refused `CONNECT` carrying a
  reason rather than a tunnel that opens and dies — and the third leg of
  `connectFailed`.
- **`api/src/server.ts`**. Two proxies, the CA swap, the boot warning rewritten,
  and `FFMPEG_CA_FILE` now validated at boot: the proxy needs it as a trust
  anchor before it can verify anything, and carrying on with the system store
  would refuse the operator's own origins in a way that reads like a compromised
  CDN. dl-19 recorded that gap; it closes here because the design forces it, not
  as a side quest.
- **`engine/src/ffmpeg/args.ts`**, `-loglevel warning`, and
  **`engine/src/ffmpeg/runner.ts`**, the sticky per-line classifier.
- **`api/package.json` + `package-lock.json`**: `node-forge` to `dependencies`.
- Tests: `tls-interception.test.ts` (10) and `engine/test/ffmpeg-runner.test.ts`
  (4) are new; `two-origin-tls` 6 → 8, `proxied-https` 14 → 18, `egress-proxy`
  18 → 20, `logging` 14 → 15.

### The boot warning, which is still a warning

`dl-21`'s line said the segments were **not** covered. It is gone, and what
replaced it is still a `warn` rather than an `info`, for the opposite reason it
was one: the surprising fact is no longer a hole but the shape of the fix.
`dl-14` chose a tunnel so ffmpeg would see the origin's own certificate, and an
operator who deployed this tool for that property is entitled to one line per
boot saying it changed and that media now crosses the process in plaintext.
`logging.test.ts`'s real invariant — **exactly one** of these lines, always, so a
deployment is never left inferring a guarantee from silence — is untouched.

**The alternative was to make it an `info`,** on the grounds that warning about
correct behaviour trains people to ignore warnings. It is a real argument and it
loses to this one: the noise is unchanged from what dl-21 already shipped, and
the fact is a security posture rather than a status.

### Deliberately not done

- **No new environment variable for the interception. — OVERRULED the same day;
  see the entry at the top of this Log.** Kept as written because the reasoning
  is the input the user weighed, not because it is still what the code does.
  `FFMPEG_ALLOW_UNVERIFIED_TLS` now means "the proxy does not verify origins" and
  stays the single escape hatch; a second knob would multiply the states an
  operator can be in and each one needs its own boot line. The consequence is
  real and worth stating: **an operator whom interception breaks for some other
  reason has no way back to a tunnel**, and would have to set the escape hatch,
  which turns off more than they want. If that turns up, it is a ticket. — It
  turned up immediately, in gate 2's observation that the constraint was
  documented nowhere an operator reads, and it became `FFMPEG_TLS_INTERCEPT`
  rather than a ticket.
- **`proxied-https.test.ts`'s tunnel assertions are kept, not repointed.** The
  origin-certificate-reaches-the-client test is still true — of the tiers, which
  is now says — and deleting it would delete the coverage Chromium and yt-dlp
  depend on. Its ffmpeg-facing counterpart is a new test asserting the opposite,
  because the opposite is what is true there.
- **A mid-stream socket error after a tunnel opens is no longer logged as a
  connect failure.** `settled` is needed anyway, so the pre-existing wart —
  where such an error wrote a `502` status line into a live tunnel — is fixed by
  construction. It could have gained its own log line and did not; `joinSockets`
  tears the pair down and nothing about it is a _connect_ failure.
- **No scan for a runtime import of a devDependency.** Point 3 above found that
  nothing in this repo catches one, and this branch is exactly the case that
  needed it. Writing that scan is a repo-wide gate with its own allowlist
  problem, not dl-27, and it is named in the report as a ticket to file.

### Gate commands

Measured on this branch, based on `origin/main` at `1d420b7`. `origin/main`
moved to `6b6c785` during the work and this branch is **not** rebased onto it.

| Command                                  | Result                      |
| ---------------------------------------- | --------------------------- |
| `npm run build`                          | exit 0                      |
| `npm run check`                          | exit 0                      |
| `npm test -- --project downloader`       | **52 files / 775 tests**    |
| `npm test`                               | **110 files / 1,642 tests** |
| `npm run e2e:downloader`                 | 3 passed                    |
| `node scripts/citations.mjs <this file>` | **5/5 resolve**             |

Counted at `0fc4353`. The four tests above the figures this table carried at
`ff12315` — 771 and 1,638 — are `FFMPEG_TLS_INTERCEPT`'s: two boot-warning
states, one config test and the tunnelling half of the wiring pair.

The citations line is new and was **0/0 until the gate records above were
written** — this ticket had no `file:line` in it at all, which is why nothing in
it could go stale and also why nothing in it could be checked. The five are the
claims verified first-hand rather than relayed; see gate 2's finding 2. One more
citation in that section, `tools/downloader/Dockerfile:65`, is **not** counted by
the script: its path matcher requires a file extension, so a `Dockerfile`
reference is invisible to it and can rot unnoticed. Verified by hand at the tip
(`RUN npm prune --omit=dev`) and recorded here as the one that has no automatic
guard.

**The baseline was re-measured rather than derived**, by checking `1d420b7` out
in this worktree and running both: **108 files / 1,615 tests** and **50 files /
748 tests**. So the branch is **+2 files and +23 tests, all of it this
branch's**, and the arithmetic matches the per-file counts above.

The e2e run is the only place the new boot line was seen firing in a real boot:

```
{"level":"warn", … ,"msg":"ffmpeg's egress proxy terminates TLS: this process verifies
 every manifest and segment origin, and ffmpeg sees a certificate issued here"}
```

Its fixture origin is plain **HTTP**, so it exercises the absolute-form path and
not the `CONNECT` path this ticket changed — which is why it is unchanged, and
why it is not evidence about the interception.

**The container gate is unrun here and this is the branch that most needs it.**
`node-forge` moving into `dependencies` is precisely a change whose failure mode
is an image that builds, boots, and throws `ERR_MODULE_NOT_FOUND` — and nothing
in `npm test` can see it. `npm ls node-forge` resolving through
`@downloader/api` and the lockfile no longer marking it `dev` are the two things
checked here; whether `npm ci && npm prune --omit=dev` keeps it in the image is
**not measured on this machine**.
