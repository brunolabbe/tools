---
id: dl-71
tool: downloader
title: YouTube finds no video, because the released image ships without yt-dlp and its pin is stale
kind: fix
status: in-flight
milestone: null
depends_on: []
---

# dl-71 — YouTube finds no video, because the released image has no yt-dlp

## Why

The owner reported that `https://www.youtube.com/watch?v=-PGMCBCTSfE` says "no
video found" on downloader.oludoi.com. Three facts, each measured, explain it —
and together they make false a claim the repo repeats in four places: that
without yt-dlp "every request falls through to the browser sniffer and still
works" (the `Dockerfile` comment above `INSTALL_YTDLP`, the
`compose.downloader.yaml` comment beside it, `02-ROADMAP.md`'s "yt-dlp is never
a dependency", and `01-ARCHITECTURE.md`'s "remove every extractor tier and the
system still works"). For YouTube, the extractor tier is the only tier that
finds anything.

## Reproduction

Measured 2026-09-22 by the orchestrator, against `main` at `20eb8ba`.

1. **The released image has no yt-dlp.** `tools/downloader/Dockerfile:94` was
   `ARG INSTALL_YTDLP=false`, and its `curl` install runs only when that is
   `true`. Neither `docker/build-push-action` step in
   `.github/workflows/release.yml` (the `publish` matrix and the `rebuild`
   escape hatch) passes `build-args`, so the published image takes the default.
   The only explicit settings anywhere were `compose.downloader.yaml:37` and
   `.github/workflows/downloader.yml:148`, and both said `false`. So every
   YouTube URL reaches the sniffer.
2. **The sniffer cannot resolve YouTube.** The API run locally from `20eb8ba`
   with `PORT=18080 ENABLE_YTDLP_RESOLVER=false`, then
   `POST /api/probe {"url": "https://www.youtube.com/watch?v=-PGMCBCTSfE"}`,
   returned `422 NO_MEDIA_FOUND` in about 10 s. The attempts: `browser`
   `NO_MEDIA_FOUND` in 8900 ms, then `direct` `NO_MEDIA_FOUND` in 1017 ms.
3. **The pinned version is broken too.** yt-dlp `2025.09.26`, the pin and the
   binary installed in the devcontainer, fails on that URL with
   `ERROR: [youtube] -PGMCBCTSfE: The page needs to be reloaded.` The current
   release, `2026.08.19`, succeeds: `yt-dlp -J` returned 54 formats, 43 of them
   video, up to 1080p. With `YTDLP_PATH` pointing at `2026.08.19`, the same
   local API resolved the probe via `resolver: "yt-dlp"` in 3.4 s.

So shipping the binary is not enough on its own: a pin that nothing moves goes
stale in exactly the way `2025.09.26` did, and the symptom is the same silent
fallthrough to a tier that cannot help.

## The decision

Taken by the owner through `AskUserQuestion` on 2026-09-22: **enable yt-dlp in
the released image and add an update policy for its pin**, over "enable and bump
the pin only" and "just file a ticket".

**No deno, deferred rather than refused.** The owner asked what deno adds, so it
was measured on the same video. yt-dlp `2026.08.19` without deno: 54 formats, 43
video, 1080p maximum, and one deprecation warning ("No supported JavaScript
runtime … YouTube extraction without a JS runtime has been deprecated, and some
formats may be missing"). With deno 2.9.7: the same 54 / 43 / 1080p and no
warning. The deno binary is 96 MB. **A future bump that starts losing formats is
where deno gets added** — the warning is the notice that it will one day be
needed, and today it buys nothing measurable.

## Build

1. **Ship yt-dlp in the released image.** Both `release.yml` build steps must
   produce an image with the binary, and so must the pull-request container gate
   in `.github/workflows/downloader.yml` and `compose.downloader.yaml` — a gate
   that builds without the layer is the "first release is the first real build"
   trap `docs/03-RELEASING.md` warns about. Decide between flipping the
   `Dockerfile` default and passing `build-args`. Read
   [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md) first: it discusses the
   gate's `INSTALL_YTDLP=false`, and if it records a reason the gate must stay
   false, that is an open decision rather than something to override.
2. **Bump the pin to `2026.08.19` everywhere it is pinned** — at least
   `tools/downloader/Dockerfile`, `.devcontainer/Dockerfile` and
   `.devcontainer/devcontainer.json`. Add a source-scan unit test, in the style
   of `packages/core/test/image-closure.test.ts`, asserting that every pin
   agrees and that the image installs yt-dlp. Make it fail first.
3. **An update policy** that keeps the pin from going stale — for example a
   scheduled workflow that checks yt-dlp's latest GitHub release and opens a
   bump pull request. Known constraints: a pull request opened with the default
   `GITHUB_TOKEN` triggers no other workflow, so no check would run on it; its
   title must pass `scripts/commit-message.mjs` **and** be a releasing type that
   touches `tools/downloader/`, or release-please never ships the new image;
   and Dependabot cannot track a `Dockerfile` `ARG` that names a GitHub release.
   If the workable designs differ materially in cost or permissions, build the
   least-privileged one and report the rest as an open decision.
4. **Correct the documentation** that says the sniffer covers everything: the
   `Dockerfile` and compose comments, `02-ROADMAP.md`, `01-ARCHITECTURE.md`
   where relevant, and `docs/03-RELEASING.md`. Say plainly that YouTube needs
   yt-dlp.
5. **Measure the image-size delta** if the image can be built here; otherwise
   say it could not be.

No test may reach YouTube, or any live host.

## Done when

1. The downloader `Dockerfile` installs yt-dlp by default, and no workflow or
   compose file builds it with `INSTALL_YTDLP` set to anything else — asserted
   by a unit test that fails against `20eb8ba`.
2. Every `YTDLP_VERSION` pin in the repo reads `2026.08.19`, and a unit test
   fails when any two pins disagree.
3. The pull-request container gate proves the built image carries a runnable
   yt-dlp at the pinned version, not only that it boots.
4. A scheduled workflow opens a bump pull request when yt-dlp publishes a newer
   release, rewriting every pin, under a title that `scripts/commit-message.mjs`
   accepts and that is a releasing type — the title asserted by a unit test.
5. The documents listed in Build 4 no longer say yt-dlp is optional for
   coverage, and say that YouTube needs it.
6. `npm run check` and `npm test` pass.

## Log

- **2026-09-22** — Filed from the orchestrator's reproduction above, with the
  owner's decision already taken, and built on the same branch.
