---
id: dl-39
tool: downloader
title: No gate in this repo proves the real yt-dlp binary trusts the terminating proxy's leaf
kind: work-package
status: ready
milestone: null
depends_on: []
---

# dl-39 — real yt-dlp, real TLS, and no gate that runs it

## Why

[dl-37](./dl-37-tiers-move-onto-the-terminating-proxy.md) moved yt-dlp behind a
proxy that terminates its TLS and hands it a locally-issued leaf. Trusting that
leaf needs `SSL_CERT_FILE` pointed at a bundle carrying the generated root
**and** `--compat-options no-certifi` — both, not either, because the shipped
binary is a PyInstaller build carrying its own `certifi` bundle that it prefers
over the system store, so `SSL_CERT_FILE` alone is read and never consulted.
Measured once, manually, against the real 2025.09.26 binary run against a
self-signed loopback origin: `SSL_CERT_FILE` alone failed,
`REQUESTS_CA_BUNDLE` failed, `CURL_CA_BUNDLE` failed, and only the pair
verified.

**No gate in this repo runs that measurement, or any measurement of the real
binary, ever.** Two facts, not one:

- [`.github/workflows/downloader.yml:143`](../../../.github/workflows/downloader.yml)
  sets `build-args: INSTALL_YTDLP=false` on the container-build job. CI does
  not merely fail to cover yt-dlp — it explicitly builds the image **without**
  it.
- [`tools/downloader/Dockerfile:90-93`](../../Dockerfile) states the repo's own
  position on why that is acceptable: _"yt-dlp is a latency optimisation, never
  a dependency. Without it every request falls through to the browser sniffer
  and still works."_

dl-37's own committed suite proves only that `buildRegistry` constructs the
right argv and environment — tested against a stand-in binary, because no CI
runner here installs the real one (the same constraint dl-34 states for its
own yt-dlp coverage, and dl-34's Done-when 1 was accepted on the identical
evidentiary shape: a real binary run once, captured, tested thereafter against
a stand-in). Whether that bar is the right one for a **behavioural** claim
(does a flag combination still make yt-dlp _work_ against a proxy-issued leaf)
rather than an **output-format** claim (what string does yt-dlp print) was an
open question between dl-37's builder and reviewer; the owner accepted it for
dl-37 and asked for this ticket to close the gap going forward rather than
block on it.

## What this ticket does not pre-judge

**Whether closing this gap is worth its cost is this ticket's decision, not a
premise it starts from.** The costs, named rather than assumed away:

- **Pulling a release binary from GitHub into CI**, against whatever tag-pinning
  discipline this repo otherwise holds for its dependencies — `YTDLP_VERSION`
  in the `Dockerfile` already pins a version (`2025.09.26`, the one this
  ticket's own measurements were taken against), but a CI job that fetches it
  fresh on every run is a different trust surface than a version bumped by hand
  in a commit.
- **A container build**, on every run that wants this coverage, or gated behind
  a path filter the way `.github/workflows/downloader.yml` already gates its
  other slow jobs.
- **A network path.** `INSTALL_YTDLP=true` needs `curl` to reach
  `github.com/yt-dlp/yt-dlp/releases/download/...` from inside the build, which
  is a path this environment's own outbound firewall does not allow by default
  in an interactive session — whether the CI runner's network policy differs is
  this ticket's to check, not this brief's to assume.

## Build

Not prescribed — this is the open question the ticket exists to answer, with
options rather than a chosen path:

1. **A new CI job** (or an addition to the existing container-build job) that
   builds with `INSTALL_YTDLP=true --build-arg YTDLP_VERSION=2025.09.26`,
   starts the tiers' terminating proxy against a generated root, and runs the
   real binary against a self-signed fixture origin — proving the
   `SSL_CERT_FILE` + `--compat-options no-certifi` combination still works, the
   way this ticket's `## Why` measured it manually.
2. **An e2e spec** under `tools/downloader/e2e/`, conditional on the binary
   being present (mirroring `ENABLE_YTDLP_RESOLVER`'s own fallthrough
   philosophy — a missing binary skips the check rather than failing the
   suite), run only where a runner has installed it.
3. **Neither, decided explicitly.** If the version-floor and network-path costs
   outweigh the benefit, say so in the Log and close this rather than leaving
   it `ready` indefinitely — the roadmap already states yt-dlp is optional, and
   a scope note living permanently on dl-37 may be judged sufficient.

Whichever is chosen, carry into it the two things this ticket's `## Why`
establishes that a builder should not have to re-derive: the exact flag
combination (`SSL_CERT_FILE` + `--compat-options no-certifi`, both required),
and the PyInstaller/`certifi` reason `SSL_CERT_FILE` alone does not work.

## What was not established, and would need to be for option 1 or 2

- **The yt-dlp version floor for `--compat-options no-certifi`.** Only
  2025.09.26 was measured. What _is_ known: an unrecognised compat option is a
  yt-dlp usage error, `classifyFailure` returns `NO_MEDIA_FOUND`, and the
  resolver chain falls through to the browser tier — reproduced against a
  stand-in emitting this container's verbatim `wrong OPTS for --compat-options`
  stderr — so a version mismatch degrades rather than crashes, which lowers the
  cost of getting this wrong but does not answer when the flag was introduced.
- **Whether the CI runner's outbound network policy actually blocks
  `github.com/yt-dlp/yt-dlp/releases`.** Untested from this environment.

## Done when

Depends on which option is chosen — this ticket's Build section is the
decision, so its own `Done when` cannot be written until that decision is
recorded in the Log.

## Log

- **2026-09-05** — Filed from dl-37's gate exchange, and its own attribution is
  corrected in place rather than left as first drafted — worth the line because
  the citation's whole value is that a future builder does not re-derive it,
  which needs the origin right. The chain: the builder had read
  `.github/workflows/downloader.yml` and `e2e/*.ts` as carrying zero yt-dlp
  references and concluded there was simply no gate to run against. The
  reviewer (`a2250d43499fa92f1`) reported that same "zero references" claim to
  the orchestrator. **The orchestrator** ran `grep -in
'yt-dlp\|ytdlp\|YTDLP' .github/workflows/downloader.yml` directly, found the
  `INSTALL_YTDLP=false` build-arg the claim had missed, read
  `Dockerfile:90-93` for the "latency optimisation, never a dependency"
  sentence neither builder nor reviewer had surfaced, and corrected both of
  them — a materially different finding from an absent reference: CI does not
  fail to test yt-dlp, it deliberately ships without it. Both citations above
  are the orchestrator's, independently re-verified by the builder before
  filing. Id picked
  by the documented union of two lists, alongside
  [dl-38](./dl-38-tls-rejection-log-does-not-track-successes.md) — see that
  ticket's Log for the check.
