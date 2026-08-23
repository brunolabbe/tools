---
id: dl-21
tool: downloader
title: Verify the certificates on segment fetches, not only on the manifest
kind: fix
status: ready
milestone: null
depends_on: [dl-19]
---

# dl-21 — The manifest is verified. The video is not.

**Packages:** `engine` (`ffmpeg/args.ts`, and probably the manual segment path),
`api/test` (a fixture that can express this at all).

## Why

[dl-19](./dl-19-ffmpeg-verifies-tls.md) put `-tls_verify 1` on every remote input
and shipped. It works — for the connection ffmpeg opens to the **manifest**.
**libavformat does not propagate the TLS options to the connections the HLS and
DASH demuxers open for segments**, so every segment of every download still
arrives over a certificate nobody checked.

That is not a small residue. The manifest is a few kilobytes of text; the
segments are the entire video. **An attacker on the path lets the verified
manifest through untouched and intercepts only the segment connections; the
substituted video is remuxed into the user's file and the download reports
success.** dl-19 narrowed the hole and did not close it, and its own acceptance
could not see the difference.

### The reproduction, verbatim

Two origins on the same hostname `127.0.0.1`, different ports, unrelated
certificates. Origin A (`:8443`) serves `master.m3u8`; that playlist points at an
absolute `https://127.0.0.1:8444/seg0.ts` on origin B, whose certificate chains
to nothing A trusts.

```
ffmpeg -tls_verify 1 -ca_file a.crt -allowed_extensions ALL -i https://127.0.0.1:8443/master.m3u8
[hls @ …] Opening 'https://127.0.0.1:8444/seg0.ts' for reading
EXIT=0    93694 bytes written, ffprobe duration=4.040272
```

A clean exit, a playable file, and B's certificate never checked.

Three controls make it airtight:

1. `openssl s_client -connect 127.0.0.1:8444 -CAfile a.crt` gives
   `verify error:num=18:self-signed certificate` — **B really is untrusted.**
2. The inverse, `-ca_file b.crt`, **rejects the manifest**
   (`Peer certificate failed verification`, exit 251) — **`-ca_file` is honoured
   at the top level**, so the flag is not being ignored outright.
3. `-user_agent` and `-headers` **did** reach B on every segment — **option
   propagation to segments exists**; the TLS options simply are not in the set
   libavformat propagates.

DASH behaves identically. Measured on ffmpeg 6.1.1 — the binary the image, CI and
`FFMPEG_PATH` all point at.

### Why no test caught it

`api/test/proxied-https.test.ts` serves the manifest and the segments from **one**
origin with **one** certificate, so an untrusted chain kills the run at the
manifest — which is exactly what the dl-19 test asserts happens. A single-origin
fixture is structurally incapable of exercising this: the two connections have to
be able to disagree about trust before the difference between them can be
observed.

## Build

1. **A two-origin TLS fixture.** `api/test/helpers/tls-origin.ts` already
   generates a certificate and starts an origin; this needs two of each, with a
   playlist on A whose segment URIs are absolute URLs on B. Keep the existing
   single-origin helper working — every current test uses it.
2. **A test that fails today.** Manifest on A with A's CA, segments on B: assert
   the download **fails**. Watch it pass first, on the current code, so the test
   is known to be measuring the thing.
3. **Then find the mechanism that fixes it**, and measure rather than assume.
   Candidates, cheapest first, none of them verified yet:
   - a per-protocol option that does propagate (`-tls_verify` inside
     `-headers`-style child options, `hls_` / `dash_`-prefixed forms);
   - the demuxers' own option pass-through (`-http_persistent`, and whatever
     `avio_opts` the hls demuxer copies) — read `hls.c`'s `open_url`, which is
     where the copying is decided;
   - failing both, the manual segment path in `download/segments.ts`, which
     fetches through `guardedFetch`/undici and therefore verifies already. That
     is a much larger change and it gives up ffmpeg's native AES-128 handling, so
     it is the last resort and needs its own argument.
4. **If no mechanism exists**, say so in the Log and make the gap explicit where
   an operator will see it, rather than leaving the architecture page to imply a
   guarantee. That is a legitimate outcome of this ticket and must not be dressed
   up as anything else.

## Done when

- A test drives real ffmpeg against a two-origin fixture and **fails when the
  segment origin is untrusted**, with the failure carrying
  `TLS_VERIFICATION_FAILED`.
- The same download succeeds when both origins' CAs are trusted, so the failure
  above is about trust and not about the second origin existing.
- `tools/downloader/docs/01-ARCHITECTURE.md`'s TLS bullet is updated to whatever
  is then true — it currently states this gap explicitly and links here.
- `npm run check` and `npm test -- --project downloader` green,
  `npm run e2e:downloader` unchanged.

## Traps

- **Do not turn verification off to get a two-origin fixture working.** The trap
  dl-14 and dl-19 both carry, unchanged. Pass each origin's CA explicitly; a
  `-ca_file` takes one bundle, so a fixture trusting both origins means one PEM
  containing both certificates, not verification disabled.
- **`-ca_file` replaces the system trust store rather than adding to it.** A
  fixture that sets it is trusting the fixture CA _and nothing else_, which is
  fine for a test and is a real constraint on any operator-facing answer.
- **Prove the negative before you fix anything.** A test written after the fix
  that has never been seen failing is a guess about what was wrong.
- **`ffmpeg-static` 7.0.2 cannot run this fixture at all** — it dumps core in the
  MPEG-TS demuxer on this platform, so its segment behaviour is unmeasured and
  will stay that way until it is fixed or dropped. See dl-19's Log for the 2×3
  matrix.
