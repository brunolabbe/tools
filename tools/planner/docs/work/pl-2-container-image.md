---
id: pl-2
tool: planner
title: Ship the planner as a released image on its own subdomain
kind: chore
status: in-flight
milestone: null
depends_on: [dl-10]
---

# pl-2 — A released image, and a hostname to serve it from

**Packages:** none. `tools/planner/Dockerfile`, `.github/workflows/planner.yml`,
`compose.prod.yaml`, and the Cloudflare half that cannot live in this repo.

## Why

[dl-10](../../../downloader/docs/work/dl-10-release-pipeline.md) built the
release machinery against one tool. This is the second consumer, and the point
of it: if the planner needs anything in `release.yml` changed, the design was
wrong and the generality was imagined rather than earned.

It is also the tool's first artifact. Today the planner exists only as a
`npm run dev:planner` on somebody's laptop.

## Build

1. **`tools/planner/Dockerfile`** — a plain Node base. Explicitly _not_ the
   downloader's: that one is built on Playwright's image and carries Chromium
   and ffmpeg for the browser sniffer, which is two gigabytes this tool would
   never open. Build stage on `node:22-bookworm` because `better-sqlite3` is a
   native addon whose fallback path needs python3, make and g++; runtime on
   `-slim`, same Debian release so the compiled binary meets the glibc it was
   linked against.
2. **`CHAT_PROVIDER=scripted` set explicitly in the image**, although it is also
   the default. An unset value gives a service that boots, reports healthy, and
   answers every question from a fixed script — the right default for a fresh
   clone, the wrong thing to arrive at by omission on a deployed host.
3. **`.github/workflows/planner.yml`** — build the image and wait for
   `/api/health`, path-filtered to this tool and `packages/**`. Started, not
   just built: a native addon crossing build stage to runtime stage fails at the
   first query, not at compile.
4. **A release component** in `release-please-config.json` and a `version.txt`.
5. **A `planner` service in `compose.prod.yaml`**, on the `edge` network, and a
   public hostname pointing at `planner:8090`. The tunnel does not change — one
   tunnel per host, one subdomain per tool.
6. **Its own Cloudflare Access application.** This does not carry over from the
   downloader's and must not be copied.

## Done when

- `docker run` of the published image serves the UI and answers `/api/health`
  with the version that was released.
- A planner-only release builds the planner image and **not** the downloader's.
- `planner.<domain>` serves the UI behind an Access login, and an
  unauthenticated request never reaches the host.

## Traps

**The downloader's Access policy is not a template.** Four differences, and the
first is not a hardening preference:

- **No Bypass rule.** The downloader's on `/api/files/*` is bought by a 256-bit
  capability token. Nothing here is safe to serve unauthenticated.
- **There is no owner model at all.** Migration 1 is
  `conversations (id, title, created_at, updated_at)` — no user column — so
  every visitor shares one conversation store and can read and edit everyone's
  plans. Until a user model lands, an Access allowlist is not a precaution
  around the data model; it is the only configuration in which that model is
  coherent.
- **No rate limiting and no `TRUST_PROXY`.** `ApiConfig` has neither. This
  matters more once `CHAT_PROVIDER` is real: an open endpoint is a stranger
  spending a token budget, with `MAX_OUTPUT_TOKENS` capping one reply and
  nothing capping the number of replies. A Cloudflare WAF rate limiting rule is
  the only layer available until the tool grows its own.
- **Streaming replies will meet Cloudflare's 100-second idle timeout.** The
  downloader survives it only because of the 15-second heartbeat in
  `routes/events.ts`. Build the same thing in with the streaming rather than
  diagnosing it after.

## Log

**2026-08-14 — steps 1–4 landed with dl-10.**

The image, its CI gate and the release component are written. `release.yml`
needed **no** change to cover a second tool, which is the thing this ticket
existed to check: the build matrix is `paths_released` resolved at runtime, so
the planner joined by adding a component, a `version.txt` and a Dockerfile.

Not done, and deliberately not bundled: steps 5 and 6. The compose service and
the Access application are deployment decisions with a Cloudflare-dashboard half
that no file in this repo can hold, and the tool has no user model yet — see the
first trap. The image is published and runnable; nothing points a hostname at it.

Unverified: no Docker in the dev container, so the image has not been built
locally. `planner.yml` is the first real build.
