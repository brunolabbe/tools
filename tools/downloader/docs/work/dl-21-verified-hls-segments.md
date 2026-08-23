---
id: dl-21
tool: downloader
title: Verify the certificates on segment fetches, not only on the manifest
kind: fix
status: done
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

## Gates

Two gates, on different halves, both PASS. Recorded here by the builder because
a reviewer's worktree is thrown away when it reports — the verdicts are the
reviewers' words, the dispositions are mine, and the `file:line` citations were
re-resolved against this branch's tip as the last action before staging.

### Gate A — PASS

**The security claim: real ffmpeg, two TLS origins, the source-level proof.**

| Done-when line                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test fails when the segment origin is untrusted, carrying `TLS_VERIFICATION_FAILED` | **not met, and not meetable from the CLI** — re-assigned to dl-27, whose `Done when` carries it. What ships instead is the characterization test at `two-origin-tls.test.ts:242`, asserting the defect and written to go red when dl-27 lands. Its control — that the _manifest_ connection genuinely is verified — is `two-origin-tls.test.ts:222` |
| The same download succeeds when both origins' CAs are trusted                         | `proven` — `two-origin-tls.test.ts:270`                                                                                                                                                                                                                                                                                                             |
| `01-ARCHITECTURE.md`'s TLS bullet updated to whatever is then true                    | `verified` — gate B read it clause by clause                                                                                                                                                                                                                                                                                                        |
| `npm run check` / `npm test -- --project downloader` green, e2e unchanged             | `verified` — both gates re-ran them independently                                                                                                                                                                                                                                                                                                   |

> **Is the central claim true? Substantially yes.** No missed option was found,
> attacked three independent ways that agree. "There is no ffmpeg option that
> verifies HLS/DASH segment connections" — **TRUE**, proven at a level stronger
> than the ticket claims: on both binaries, empirically (16/16 candidates), by
> exhaustive option-table inspection, _and_ by recovering the propagation array
> from the shipped machine code. "...and there cannot be one" — **overstated**.

Findings and dispositions:

- **A1 — CONCERN, wording: "there cannot be one" contradicts the branch's own
  dl-27.** _Failure scenario: a future agent reads it, treats segment
  verification as impossible, and closes dl-27 as invalid — deleting the one
  route that works._ **Fixed.** The Log now claims only what was established —
  no existing CLI option in 6.1.1 or 7.0.2, a compile-time list with no
  option-level override, therefore an upstream change or verification outside
  ffmpeg — and a paragraph says explicitly why the stronger wording was
  dangerous. `.env.example` was corrected in the same pass.
- **A2 — MINOR: _why_ `seg_format_options` fails is unconfirmed.** At
  `-loglevel verbose`, 6.1.1 emits nothing for a deliberately bogus key, so
  "ignored by the segment demuxer" cannot be told from "never delivered".
  **Fixed by marking, not by re-claiming.** The row and the prose now say the
  result is reproduced 3/3 and the mechanism is an inference. The conclusion is
  untouched.
- **A3 — NOTE: the proxy refusal surfaced as exit 8, not the ticket's 183.**
  The gate's proxy answered a refused `CONNECT` with `502` where the ticket's
  dropped the connection. **No change to the conclusion; recorded in dl-27
  step 4**, which now carries both exit codes and says the load-bearing part —
  no certificate semantics reach ffmpeg — holds in both variants.
- **A4 — the disassembly is stronger evidence than the source.** Not a defect.
  **Adopted into the Log**: the `.text 0x783a0` extraction, the seven names in
  order, the TLS options sitting untouched in their own `AVOption` table, and
  the identical result from 7.0.2 at `.text 0x7ab7c0`.
- **A5 — a third call site (`imfdec`) the ticket did not mention.** Not a
  defect. **Adopted**: the Log now says three call sites, not two.
- **Unverified by gate A, carried forward as such:** FFmpeg master's eight-name
  array (no network to github from its side — 7.0.2 was verified directly
  instead); why `seg_format_options` has no effect (A2); and non-loopback,
  real-hostname behaviour, since everything measured is `127.0.0.1` with IP-SAN
  certificates.

### Gate B — PASS

**The code, the record and the invariants.**

| Done-when line                                                     | Verdict                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two-origin fixture exists and the single-origin helper still works | `proven` — `tls-origin.ts:308` and `tls-origin.ts:342`, proved usable by `two-origin-tls.test.ts:204`; `proxied-https.test.ts` unchanged from `b76dca4` and green              |
| The gap is stated where an operator sees it                        | `proven` — `server.ts:120` pinned by `logging.test.ts:221` and `logging.test.ts:237`; `verified` firing in a real boot via the e2e `[WebServer]` output                        |
| Repo invariants hold (no shell, typed errors, redaction, SSRF)     | `verified` — re-derived independently; `spawn-safety` + `image-closure` green. The branch adds no subprocess spawn and no production error path; `server.ts:120` is a log line |
| Gate commands green                                                | `verified` — all seven re-run by the gate itself                                                                                                                               |

> **There is no configuration in which the gap is silent.** The `else` is keyed
> on `ffmpegAllowUnverifiedTls` alone, so `FFMPEG_CA_FILE` cannot suppress it —
> the warning fires in the default deployment.

Findings and dispositions:

- **F1 — the Log miscounted its own test file**: "five tests … two keep the
  fixture honest" against a file with six and three. The uncounted one is the
  bundle test, added late to kill a surviving mutation — precisely the test
  dl-27's acceptance rests on. **Fixed**, with a note saying why the drift
  happened.
- **F2 — `.env.example` pointed an operator at dl-21**, which this commit closes
  under a title reading as though it fixed the thing. **Fixed**: it now points
  at dl-27 and says in as many words that dl-21 is closed and closed nothing.
- **F3 — `SECURITY.md` never names the gap**, in neither its in-scope nor its
  known-and-accepted list. **No change, and no ticket — deliberately.** It is
  pre-existing, it is not something this branch introduced or worsened in the
  code, and the gap is now stated in the three places a reader actually meets it
  (the architecture page, `.env.example`, and a warning on every boot). Adding a
  fourth claim to a policy document is the kind of restatement this repo
  removed a status page over. **If a maintainer disagrees, it is one bullet and
  worth its own ticket rather than a rider on this one** — I did not take an id
  for it.
- **F4 — bare `.rejects.toThrow()` at the fixture-honesty test.** Passes on any
  rejection. **No change**, and the gate agreed it is not a defect: the two
  positive handshakes immediately above it rule out the wrong-port class, and
  the pair is what makes the assertion meaningful. Asserting
  `DEPTH_ZERO_SELF_SIGNED_CERT` would pin trust rather than any failure and is
  worth doing the day someone touches that test; it is noted in dl-27's Traps
  rather than left only here.
- **F5 — the serial comment overstated its own importance.** Gate B mutated the
  two halves separately: distinct common names alone fix the collision, and
  reverting the serial while keeping them leaves all six tests green. **Fixed**
  in `tls-origin.ts` and in the phrasing dl-27's Traps had inherited. The
  serials stay — two certificates sharing one is wrong on its own terms — but
  they are now described as defence in depth.
- **Checked and cleared, no change:** `commonName` defaulting to the shared
  constant. It cannot default to something unique, because the sole existing
  caller's suite asserts the peer certificate's CN _is_ that constant. Collision
  freedom rests on caller discipline, which is documented on the parameter and
  warned about in dl-27's Traps.
- **Unverified by gate B, carried forward as such:** the entire security claim
  (gate A's scope, taken as given), the two `args.ts` mutation rows in the Log's
  table, and the container/image gate, which nothing in this branch touches.

## Log

**2026-08-23 — Done, and the outcome is the gap, stated rather than closed.**
Build step 4 is what this ticket produced: **no existing ffmpeg CLI option,
alone or in combination, verifies segment connections in 6.1.1 or 7.0.2, and
the propagation list is compile-time with no option-level override. So closing
this gap requires either an upstream source change or verification outside
ffmpeg.** The hole is real, it reproduces exactly as the brief says, and the fix
is a change the brief did not contemplate. It is filed as
[dl-27](./dl-27-verify-segment-origins.md), with a working prototype behind it.

**Read that sentence exactly as written, because an earlier draft of it said
"and there cannot be one" and that would have been actively dangerous.** A fix
does exist — this ticket measured one working — and it lives outside ffmpeg's
argument surface. Someone who reads "impossible" and then meets dl-27
describing a working mechanism has to conclude one of the two is wrong, and the
cheap resolution is to close dl-27 as invalid. That would delete the only route
anyone has demonstrated. **What is exhausted is the CLI, not the problem.**

Every measurement below is the distribution's **ffmpeg 6.1.1-3ubuntu5** (gnutls),
which is what `FFMPEG_PATH` names here, in CI and in the image — except the two
that name `ffmpeg-static` 7.0.2 explicitly.

### The reproduction, confirmed

Two origins on `127.0.0.1`, unrelated self-signed certificates. A (`:8443`)
serves the playlists; `index.m3u8`'s segment URIs are absolute URLs on B
(`:8444`), whose certificate chains to nothing A trusts.

```
$ ffmpeg -tls_verify 1 -ca_file a.crt -allowed_extensions ALL \
    -i https://127.0.0.1:8443/master.m3u8 -c copy out.mp4
[hls @ 0x559ed0d78bc0] Opening 'https://127.0.0.1:8443/index.m3u8' for reading
[hls @ 0x559ed0d78bc0] Opening 'https://127.0.0.1:8444/seg000.ts' for reading
[hls @ 0x559ed0d78bc0] Opening 'https://127.0.0.1:8444/seg001.ts' for reading

EXIT=0  bytes=104610
ffprobe duration=4.040272
```

The brief's own numbers, to the decimal. The three controls hold:

1. `openssl s_client -connect 127.0.0.1:8444 -CAfile a.crt` →
   `verify error:num=18:self-signed certificate`, exit 1. **B really is
   untrusted.**
2. The inverse, `-ca_file b.crt`, → `[tls] Peer certificate failed verification`
   / `Error opening input: Input/output error`, **exit 251**. **`-ca_file` is
   honoured at the top level.**
3. `-user_agent dl21-probe/1.0` and `-headers "Referer: …"` arrived on **every**
   segment request at B. **Propagation exists**; the TLS options are simply not
   in the propagated set.

### Why there is no argv answer, from the source rather than from inference

`hls.c`'s `open_url` builds each segment connection's options from
`c->avio_opts` plus a couple of per-call keys, and `c->avio_opts` is filled by
`ffio_copy_url_options` in `libavformat/aviobuf.c`:

```c
const char *opts[] = {
    "headers", "user_agent", "cookies", "http_proxy", "referer", "rw_timeout", "icy", NULL };
```

A **compile-time array of seven names.** No `tls_verify`, no `ca_file`, no
`cafile`, no `verifyhost`. There is no option, prefix or dictionary that adds to
it. Two things follow that the brief could only guess at:

- **`dashdec.c` calls the same function**, so "DASH behaves identically" is true
  by construction rather than by observation.
- **FFmpeg master has not fixed it.** Its list is eight names — `prefer_libcurl`
  was added — and still neither TLS option. **Upgrading ffmpeg is not the fix**,
  which was worth knowing before anyone proposed it.

**Gate A could not reach the source and proved it a better way — from the
binary this repo actually runs.** No `deb-src` entries and no egress to the
Debian archives or github, so rather than mark the central claim unverified it
recovered the array out of `libavformat.so.60.16.100`. The library is stripped
and the array is stack-local with no relocations, so it found the construction
site at `.text 0x783a0` by scanning for the RIP-relative `lea` cluster:

```
0x10(%rsp) 'headers'     0x30(%rsp) 'referer'
0x18(%rsp) 'user_agent'  0x38(%rsp) 'rw_timeout'
0x20(%rsp) 'cookies'     0x40(%rsp) 'icy'
0x28(%rsp) 'http_proxy'  0x48(%rsp) movq $0x0   <- NULL
```

**The same seven names, the same order, NULL-terminated** — and the four TLS
options do exist 64 bytes apart in the TLS protocol's own `AVOption` table at
`0x2a3040`–`0x2a31c0`, which is where they stay. This is strictly stronger
evidence than a source tag: it is what the binary at `FFMPEG_PATH` does. The
same extraction on ffmpeg-static 7.0.2 (`.text 0x7ab7c0`) yields the identical
seven, so "upgrading is not the fix" is measured for that binary rather than
inferred from master. Master's eight-name list stays **unverified** — no network
to github from the gate's side.

Two corrections to the bullets above, both from that extraction. The helper has
**three** call sites in the whole library, not two: dashdec, hls, and
**imfdec** — the IMF demuxer, which this tool never reaches but which is a third
caller the sentence above did not know about. And there is exactly **one**
decode-side dictionary option across 6.1.1's entire surface (`-seg_format_options`);
the complete HLS demuxer table is ten options with no TLS option, and the DASH
demuxer has **two** (`allowed_extensions`, `cenc_decryption_key`) — no TLS
surface whatsoever.

### Every mechanism tried

Sixteen candidates, each run twice against the same fixture: **NEG** with only
A's CA (a mechanism that works must make this fail) and **POS** with a bundle
holding both (which must still succeed). Run on 6.1.1 with MPEG-TS segments, on
6.1.1 with fMP4 segments, and on ffmpeg-static 7.0.2 with fMP4 segments.

| Candidate                                      | Result                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| baseline (the dl-19 argv)                      | NEG exit 0, 104,610 bytes, B served 2 segments                         |
| `-seg_format_options tls_verify=1`             | no change (why: asserted, not demonstrated — see below)                |
| `-seg_format_options ca_file=<A>`              | no change                                                              |
| `-seg_format_options tls_verify=1:ca_file=<A>` | no change                                                              |
| `-http_persistent 0`                           | no change                                                              |
| `-http_multiple 0`                             | no change                                                              |
| `-http_persistent 0 -http_multiple 0`          | no change                                                              |
| `-cafile <A>` (the alias)                      | no change                                                              |
| `-verifyhost 127.0.0.1`                        | no change                                                              |
| `-tls_verify 1` repeated later in the argv     | no change                                                              |
| `-hls_ca_file <A>`                             | `Unrecognized option`, exit 8 — the option does not exist              |
| `-hls_tls_verify 1`                            | `Unrecognized option`, exit 8 — the option does not exist              |
| `-f hls` (forcing the demuxer)                 | no change                                                              |
| `-max_reload 0`                                | breaks the download outright (exit 183) for both CAs — not a mechanism |
| `-seg_max_retry 0`                             | no change                                                              |
| `-reconnect_on_network_error 0`                | no change — rules out a reconnect masking a refusal                    |

"no change" means NEG exit 0 with a playable file: the video came off the
untrusted origin. **Not one candidate made the untrusted case fail.**

Also ruled out at the option level: `-protocol_opts` and `-http_opts` exist but
are **encode-side only** (`E..........` in `ffmpeg -h full`), so no decode-side
dictionary reaches a child protocol at all.

**A false negative I nearly reported as a result.** The first sweep returned a
uniform `Invalid argument` on every candidate, which reads like a wall of
meaningful failures. The fixture helper was returning the _requested_ port
(`0`) rather than the assigned one, so every run was fetching
`https://127.0.0.1:0/`. Sixteen rows of nothing, and the table above is the
re-run. It is written down because it is precisely the shape of failure this
ticket was told to watch for: a green-looking sweep produced by the test not
exercising the thing.

### What ffmpeg-static 7.0.2 does, which dl-19 recorded as unmeasurable

It has **the same gap**. dl-19 could not measure it because 7.0.2 dumps core in
the MPEG-TS demuxer on this platform. Generating the clip with
`-hls_segment_type fmp4` sidesteps that demuxer entirely, and 7.0.2 then runs
the fixture cleanly: NEG exit 0, 103,971 bytes, B served all three parts
(`init.mp4` and two `.m4s`). 6.1.1 over fMP4 is identical at 103,973 bytes. So
the fMP4 route is the way to measure that binary, and the answer is that it
behaves exactly as 6.1.1 does — consistent with master's source. The MPEG-TS
crash itself is untouched and stays unmeasured.

### The mechanism that does work, and why it is not in this branch

**One of the seven propagated options is `http_proxy`** — and `server.ts`
already puts a loopback guarded proxy in front of every ffmpeg egress,
unconditionally, whether or not `PROXY_URL` is set. So the proxy is on every
segment connection today. Make it **terminate** those connections instead of
tunnelling: it verifies the real origin itself and re-encrypts to ffmpeg under a
locally issued leaf. ffmpeg checks that leaf on the manifest (where
`-tls_verify 1` reaches) and ignores it on the segments (where it never could) —
and either way the origin has been verified, by us.

Prototyped and measured against this ticket's own fixture:

```
### NEG — proxy trusts A only, so B must be refused
    exit=183 bytes=0 B-served=0
    proxy verified: ["127.0.0.1:43643","127.0.0.1:43643"]
    proxy refused:  ["127.0.0.1:43675 DEPTH_ZERO_SELF_SIGNED_CERT", …]

### POS — proxy trusts A and B
    exit=0 bytes=104610 B-served=2
    proxy verified: ["127.0.0.1:43643", …, "127.0.0.1:43675", …]
    proxy refused:  []
```

**It works, and it does not belong in a fix ticket.** Four reasons, and each one
is a decision somebody should take deliberately:

- It **reverses dl-14's design.** That ticket chose a CONNECT tunnel so the
  certificate reaching ffmpeg is the origin's own, and `proxied-https.test.ts`
  asserts the peer fingerprint is the fixture's. Turning the proxy into a MITM
  deletes that property and the assertion with it.
- It needs **certificates issued at runtime**. Node's `crypto` cannot write one,
  so `node-forge` moves from a devDependency to a runtime dependency of
  `@downloader/api`, which changes what the image ships and drags in the image
  gate.
- **The two CA settings swap sides.** `-ca_file` replaces the system store, so
  ffmpeg's bundle becomes the generated root and _the proxy_ becomes the side
  that needs `FFMPEG_CA_FILE` merged with the system store. Getting it backwards
  fails closed on every public origin.
- **The failure is unclassifiable as it stands.** Note the NEG exit above: 183,
  `Invalid data found when processing input`, with no certificate wording
  anywhere. `isTlsVerificationFailure` would call that `DOWNLOAD_FAILED`. Only
  the proxy knows the real reason, so it has to carry it back out of band — a
  stderr matcher cannot reach this one.

The alternative the brief named, the manual segment path in
`download/segments.ts`, is **unmeasured** — I did not prototype it. On
inspection it gives up ffmpeg's native `AES-128` handling, which
`00-ANALYSIS.md` §3 puts explicitly in scope, plus discontinuity handling and
timestamp rebasing, and the engine deliberately does not parse playlists, so the
API would have to feed it URLs from the dl-1 parsers. Both options are written
up in [dl-27](./dl-27-verify-segment-origins.md).

### What is in this branch

- **`api/test/helpers/tls-origin.ts`** gains `splitHlsClip` and
  `createCaBundle`. The single-origin helper is untouched and every existing
  test using it still passes. `createCaBundle` is one PEM holding two
  certificates — the trap this ticket carries is answered by construction, and
  no verification is disabled anywhere in the new fixture.
- **`api/test/two-origin-tls.test.ts`**, **six** tests, real ffmpeg, two TLS
  origins. **Three** of them keep the fixture honest — that the origins
  genuinely disagree about trust, that the playlist genuinely points off-origin,
  and that the both-CAs bundle really holds both and each origin verifies
  against it. Then the pair that matters, same fixture and same argv one PEM
  apart: trusting **only B** fails at the manifest with
  `TLS_VERIFICATION_FAILED` before a byte is served, and trusting **only A**
  downloads the entire video off B. The second is a **characterization test**:
  it asserts the defect, and it is written to go red the day dl-27 lands.

  **This paragraph said "five … two" until gate B counted it**, and the
  uncounted one was the bundle test — added late, to kill a mutation that had
  survived, and therefore the single test **dl-27's acceptance rests on**. The
  prose was written before the fix and not revisited after it, which is exactly
  how a record and a file drift apart: an agent picking up dl-27 would have
  counted six against a claimed five with no way to tell which was stale.

- **`api/src/server.ts`** warns at boot, when verification is on, that it
  reaches the manifest connection only. That is Build step 4's "where an
  operator will see it" — an operator who has read nothing has one line per boot
  saying what they have and what it costs. It is an `else`: a deployment with
  `FFMPEG_ALLOW_UNVERIFIED_TLS` set already gets dl-19's louder line, and two
  warnings would say contradictory things. `logging.test.ts` pins both branches
  and that there is always exactly one.
- **`01-ARCHITECTURE.md`**'s TLS bullet now names the seven-option list and its
  source, says DASH is identical by construction, states the consequence in
  plain words, and points at dl-27.

### What the brief had wrong

**Its Done-when cannot be met, and that is the finding rather than a shortfall.**
"A test … fails when the segment origin is untrusted, with the failure carrying
`TLS_VERIFICATION_FAILED`" presumes a mechanism exists in step 3's list. None
does. The brief hedged correctly in step 4 and the hedge is what shipped; the
acceptance line above it should be read as belonging to dl-27.

**Step 3's first two bullets are dead ends and it is worth saying which kind.**
`hls_`/`dash_`-prefixed TLS options do not exist — ffmpeg rejects them at
argument-splitting time, exit 8. `-http_persistent` and the demuxer's own
pass-through are real options that do nothing here, because the pass-through is
`ffio_copy_url_options` and it is a fixed list. The brief's instinct to read
`hls.c`'s `open_url` was right and one function short: `open_url` copies a dict
somebody else filled, and the filling is where the answer is.

**`-seg_format_options` looks like the answer and is not — and the reason it is
not is asserted rather than demonstrated.** Gate A tried to confirm the
explanation and could not: at `-loglevel verbose`, 6.1.1 emits **nothing** for a
deliberately bogus key (`-seg_format_options bogus_option_xyz=1`) — no "not
found", no warning of any kind. So "delivered to the segment demuxer and ignored
there" cannot be told apart from "never delivered at all". **The result is
reproduced 3/3 on both gates and the conclusion is untouched; only the mechanism
below is an inference.** It is the closest
thing on the demuxer to "options for segments", and on the option table it
configures the segment _demuxer_ — the thing that parses the MPEG-TS once bytes
arrive, rather than the protocol that fetched them. Either way it does not put
the TLS settings on the segment connection, which is the part that was
measured.

### The mutation check, and the one that survived

Four mutations, after a control run over the unmutated tree that exited **0**.

| Mutation                                                       | Result                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `server.ts`: delete the new `else` branch                      | **killed** — "a verifying deployment is told the segments are not covered" |
| `args.ts`: `-tls_verify` always `0`                            | **killed** — the manifest-verified control stops failing                   |
| `args.ts`: stop emitting `-ca_file`                            | **killed** — two tests, both downloads lose their trust anchor             |
| `tls-origin.ts`: `createCaBundle` drops the second certificate | **survived**                                                               |

**The survivor was the useful one.** It survived for a reason that is the defect
itself: with only the manifest connection verified, trusting origin A alone is
already enough for the "both CAs" download, so that test could not tell a
two-certificate bundle from a one-certificate one. It would have passed for
dl-27 to inherit as proof of a helper nothing had checked.

Fixing it turned up **a real bug in the new helper**. Both fixture certificates
were self-signed with the same subject (`CERTIFICATE_COMMON_NAME`) and the same
serial `01`, and **a CA bundle is indexed by subject**: the two collided and the
bundle verified origin A while refusing origin B with
`DEPTH_ZERO_SELF_SIGNED_CERT` — which reads like a network failure, not a trust
one. `createFixtureCertificate` now takes an optional `commonName` and issues a
distinct serial per call, the two-origin fixture names its two apart, and a test
asserts the bundle holds two `BEGIN CERTIFICATE` blocks **and** that each origin
completes a real handshake against it. That mutation now dies.

Worth stating plainly: without the mutation run this branch would have shipped a
CA bundle helper that silently trusted one origin of two, and dl-27's entire
acceptance rests on that helper.

### Two things suggested at review and deliberately not done

**The `ffio_copy_url_options` finding does not also go in `00-ANALYSIS.md`.**
The suggestion was that a future reader will otherwise re-derive it from FFmpeg
source. They will not have to: it is on `01-ARCHITECTURE.md` with the seven
names inline, in this Log with the disassembly that proves it, and in dl-27's
brief. A fourth copy is a fourth thing that has to stay true, and this repo's
whole posture on that — `repo-1`, `repo-2`, and the reason there is no status
page — is that a fact restated where nothing keeps it true becomes a liability
rather than an aid. `01-TICKETS.md` reserves `00-ANALYSIS.md` for "where the
design was overruled by building it", and this does not overrule the analysis:
§3's premise that ffmpeg handles AES-128 natively is untouched. It constrains
how far ffmpeg's _verification_ reaches, which is an architecture fact and is on
the architecture page. This ticket's `Done when` names `01-ARCHITECTURE.md` and
only that.

**`dl-27` does not gain `depends_on: [dl-26]`.** dl-26 is merged, so the edge
would no longer dangle and CI would stay green — the objection is not mechanical.
It is that `depends_on` means "must land first" and dl-26 already landed, so the
edge would be vacuous on the day it was written, while `npm run status --ready`
would carry it forever. What dl-26 actually gives dl-27 is a **constraint on how
it must be built** — three outcomes converging on one socket instead of two — and
that is prose. It is in dl-27's step 4, with the strings read out of the merged
tree and the tripwire re-measured on this branch rather than relayed.

### Gates

**Measured on this branch rebased onto `b76dca4`, and nothing here is carried
across from the pre-rebase run.** `main` gained three merges during review
(dl-26 #84, repo-3 #85, dl-20 #86) and the earlier figures are stale twice over.

| Command                            | Result                      |
| ---------------------------------- | --------------------------- |
| `npm run build`                    | exit 0                      |
| `npm run check`                    | exit 0                      |
| `npm test -- --project downloader` | **50 files / 722 tests**    |
| `npm test`                         | **103 files / 1,508 tests** |
| `npm run e2e:downloader`           | 3 passed                    |

**The baseline was re-measured rather than assumed**, by checking `b76dca4` out
and running the suite on it: **102 files / 1,500 tests.** So the branch is
**+1 file and +8 tests, all of it this branch's** — six in
`two-origin-tls.test.ts`, two in `logging.test.ts`. The pre-rebase numbers
(1,416 → 1,424) described a different `main` and are kept here only to show the
delta is unchanged. Gate B predicted "~103 files and >1424 tests" post-rebase:
the file count was right and the test count was far short, because `main` gained
76 tests rather than a handful — which is why this was measured.

`logging.test.ts` was re-run on its own after the rebase (14 passed) and checked
for any assertion on the egress proxy's message text, because dl-26 rewrote
those strings. There is none, so the two changes do not interact.

Its `[WebServer]` output is where the new warning was seen firing in a real boot
rather than only in a unit test:

```
{"level":"warn", … ,"msg":"ffmpeg verifies the manifest connection only: HLS and DASH segment certificates are not checked"}
```

The container gate is untouched and unrun here, as always: nothing in this branch
changes what the image ships.
