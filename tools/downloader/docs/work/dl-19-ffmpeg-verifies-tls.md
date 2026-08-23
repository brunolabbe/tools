---
id: dl-19
tool: downloader
title: Make ffmpeg verify the certificates it is already encrypting to
kind: fix
status: ready
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

## Log

_Not started._
