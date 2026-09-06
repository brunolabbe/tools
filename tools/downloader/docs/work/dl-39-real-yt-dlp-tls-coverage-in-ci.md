---
id: dl-39
tool: downloader
title: No gate in this repo proves the real yt-dlp binary trusts the terminating proxy's leaf
kind: work-package
status: done
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

Written once the decision was taken, as this section said it would be. Option 3
was chosen, so there is one line and it is met:

- The decision is recorded in the Log with the costs that drove it, **and** with
  the flag combination and the PyInstaller/`certifi` reason carried across from
  `## Why` — because closing this ticket is what would otherwise leave that
  knowledge with nowhere to live. No code, no workflow and no spec changes.

## Log

- **2026-09-05** — **Closed as option 3: neither a CI job nor an e2e spec.** The
  decision is the repo owner's, taken on the costs this ticket's own
  `## What this ticket does not pre-judge` section named rather than on a
  re-derivation of them. Recorded here because the ticket's Build section asks
  for exactly this — _"say so in the Log and close this rather than leaving it
  `ready` indefinitely"_ — and because closing it is what would otherwise make
  the knowledge below homeless.

  **The costs that decided it**, all three from the ticket:

  - **A yt-dlp version floor maintained by hand in a commit.** `YTDLP_VERSION`
    in the `Dockerfile` pins `2025.09.26`, the only version any of this was
    measured against, and a gate that asserts a flag combination still works
    only means anything against a pin somebody keeps current. That is recurring
    manual work on a tier the repo calls optional.
  - **A container build per run that wants the coverage.** `INSTALL_YTDLP=true`
    is a build-arg, so there is no cheaper way in than building the image —
    either on every run or behind another path filter in
    `.github/workflows/downloader.yml`.
  - **An outbound network path to `github.com/yt-dlp/yt-dlp/releases` from
    inside the build.** The ticket flagged the CI runner's policy as unchecked
    and it stays unchecked: nothing here measured it, and a gate whose failure
    mode is "the release download was blocked" is a flaky gate rather than a
    coverage gain.

  **Against which:** the roadmap already states it —
  `tools/downloader/docs/02-ROADMAP.md:59` "- **yt-dlp is never a dependency.**"
  — the [`Dockerfile`](../../Dockerfile) says the same at lines 90-93 in the
  place the image is built ("yt-dlp is a latency optimisation, never a
  dependency"), and
  `.github/workflows/downloader.yml:143` "build-args: INSTALL_YTDLP=false"
  already sets it off deliberately rather than by omission. All three
  re-resolved against this branch's tip before this entry
  was committed; the `Dockerfile` range is prose because that filename carries
  no extension for `scripts/citations.mjs` to recognise. dl-37's scope note was
  judged sufficient to carry the residual.

  **What is being given up, stated plainly so nobody later reads this as free.**
  The `SSL_CERT_FILE` + `--compat-options no-certifi` combination stays
  **unproven by any automated gate in this repo**, and closing this ticket does
  not make it proven — it decides not to prove it. Carried here from this
  ticket's `## Why` so it survives the close:

  - **Both flags are required, not either.** `SSL_CERT_FILE` must point at a
    bundle carrying the generated root **and** `--compat-options no-certifi`
    must be passed.
  - **Why `SSL_CERT_FILE` alone does not work.** The shipped yt-dlp binary is a
    PyInstaller build carrying its own `certifi` bundle, which it prefers over
    the system store — so `SSL_CERT_FILE` is read and then never consulted.
    `--compat-options no-certifi` is what makes it consult the system store at
    all.
  - **What was measured, once, by hand**, against the real 2025.09.26 binary and
    a self-signed loopback origin: `SSL_CERT_FILE` alone failed,
    `REQUESTS_CA_BUNDLE` failed, `CURL_CA_BUNDLE` failed, and only the pair
    verified.
  - **The blast radius if it silently stops holding.** An unrecognised compat
    option is a yt-dlp usage error, `classifyFailure` returns `NO_MEDIA_FOUND`,
    and the chain falls through to the browser tier — so a version mismatch
    degrades rather than crashes. That is what makes this affordable to leave
    ungated, and it is the reason to revisit rather than a reason not to: the
    degradation is silent.

  **What would reopen this**, so the decision has a trigger rather than being
  permanent by default: the yt-dlp tier ceasing to be optional, or a
  `YTDLP_VERSION` bump landing without anyone re-running the manual measurement
  above. Neither is true today.

  **Not measured here.** Nothing in this session ran yt-dlp, built the image
  with `INSTALL_YTDLP=true`, or tested the CI runner's outbound policy — this
  ticket is closed on cost, not on new evidence, and the two open questions in
  `## What was not established` (the version floor for
  `--compat-options no-certifi`, and whether CI can reach the releases host)
  remain unanswered. They are recorded as unanswered rather than resolved.

  Closed on the branch that built
  [dl-38](./dl-38-tls-rejection-log-does-not-track-successes.md), as its own
  commit — the two are unrelated beyond sharing a filing moment, and a separate
  dispatch and pull request for one frontmatter field was not worth it.

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
