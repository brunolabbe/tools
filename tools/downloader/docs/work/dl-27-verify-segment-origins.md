---
id: dl-27
tool: downloader
title: Verify the certificates on HLS and DASH segment connections
kind: fix
status: ready
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
