---
id: dl-73
tool: downloader
title: Prove in CI that the shipped yt-dlp trusts the terminating proxy, now that YouTube depends on it
kind: work-package
status: ready
milestone: null
depends_on: [dl-72]
---

# dl-73 — the shipped yt-dlp, a real TLS fetch, and a gate that runs it

**Packages:** `.github/workflows/downloader.yml` (the container gate) and
possibly `e2e/`. The resolver code (`resolvers/src/resolvers/ytdlp.ts`) should
need no change.

**Related:** [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md) closed this
same gap on cost, and named what would reopen it.
[dl-72](./dl-72-youtube-finds-no-video-because-the-image-has-no-yt-dlp.md)
triggered it.

## Why

When the API's egress proxy terminates TLS, the yt-dlp child trusts the
operator CA only through `SSL_CERT_FILE` **together with**
`--compat-options no-certifi`. That was measured once, by hand, against
2025.09.26 (see dl-39's `## Why`). dl-39 left it without a gate for two reasons:
the yt-dlp tier was optional, and a failure degrades rather than crashes. An
unrecognised compat option becomes `NO_MEDIA_FOUND`, and the chain falls
through to the sniffer.

dl-72 removed both reasons. yt-dlp now ships in every released image, pinned at
2026.08.19. The sniffer cannot resolve YouTube, so on YouTube "degrades" means
the user sees "no video found" again, with nothing in CI to catch it.
`ytdlp-bump.yml` will also change the version on a schedule. That is dl-39's
second trigger ("a `YTDLP_VERSION` bump landing without anyone re-running the
manual measurement"), and it now fires automatically.

## Build

1. In the container gate, run the shipped yt-dlp through the terminating proxy
   against a local TLS origin whose certificate is issued by the operator CA,
   using the flags the resolver passes. The gate must fail if the pair stops
   verifying. No third-party site: the fixture origin the e2e suite already
   runs is the natural target.
2. Make the check fail first. Drop `--compat-options no-certifi`, or pass only
   `SSL_CERT_FILE`, and show the gate going red.
3. Settle dl-39's two open questions, and record the answers:
   - **The version floor for `--compat-options no-certifi`.** At least confirm
     2026.08.19.
   - **Whether the CI runner can reach the yt-dlp releases host.** dl-72's
     container gate now downloads the binary, so its first green run answers
     this. Record the run.

## Done when

1. The downloader container gate performs a proxied TLS fetch with the shipped
   yt-dlp and fails when the trust flags are removed. Show the failing run as
   well as the passing one.
2. A `ytdlp-bump.yml` pull request runs that gate before it can merge.
3. dl-39's two unanswered questions are answered in this ticket's Log.

## Log

- **2026-09-22** — Filed from dl-72's gate. The reviewer found that dl-72 sets
  off dl-39's reopening trigger. The owner chose, through `AskUserQuestion`, to
  file this ticket and open dl-72 without waiting for it, rather than fold the
  work into dl-72 or record it as an accepted risk.
