---
id: pl-2
tool: planner
title: Ship the planner as a released image on its own subdomain
kind: chore
status: in-flight
milestone: null
depends_on: [dl-10]
difficulty: standard
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
- **There is no owner model at all.** No table the design proposes carries a user
  column — not migration 1's `conversations`, and not the `intakes` and `answers`
  that supersede it in [pl-7](./pl-7-intake-persistence-and-wizard.md). So every
  visitor shares one store and can read and edit everyone's trips. Until a user
  model lands, an Access allowlist is not a precaution around the data model; it
  is the only configuration in which that model is coherent.
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

**2026-08-14 — the env var in step 2 is now `MODEL_PROVIDER`.** Renamed by
[pl-8](./pl-8-model-provider-seam.md) along with the seam behind it. The brief
above is left saying `CHAT_PROVIDER` because that is what landed; the argument
for setting it explicitly in the image is unchanged, and so is the value. Nothing
that reads it broke, because `scripted` is the default and the fallback both.

**2026-08-16 — the first half of _done when_ is closed, by
[pl-13](./pl-13-drive-the-intake-end-to-end.md).** "`docker run` of the published
image serves the UI" was written as an acceptance and was never true: `WEB_DIR`
was set here in step 2 and parsed in `config.ts`, and `server.ts` registered no
static handler, so the image shipped a bundle it never handed out. Nothing caught
it because the CI gate asked only for `/api/health`, which answered perfectly
throughout — an acceptance criterion that no check was pointed at.

`api/src/routes/web.ts` serves it now, and `planner.yml` asks the running
container for `/` and greps for the bundle's own root element rather than
trusting a 200. **So do not re-verify that half when picking this ticket up** —
it is gated. What is left is genuinely steps 5 and 6: the compose service, the
subdomain and the Access application, all of which still need the user model
argument in the first trap resolved or accepted.

**2026-09-07 — step 5 is done, in a file the brief did not name; step 6 is the
operator's and cannot be done from here.**

**The brief's step 5 is superseded.** It says "a `planner` service in
`compose.prod.yaml`", written 2026-08-14. [adr/004](../../../docs/adr/004-one-compose-fragment-per-tool.md)
was accepted eight days later and calls that specific move "the part that is
easy to get wrong": a `planner:` block in the shared overlay is a service
definition, so a downloader-only host merging `compose.prod.yaml` would stand up
the planner without naming it. The service is therefore in a fragment of its
own, [`compose.planner.prod.yaml`](../../../compose.planner.prod.yaml), and the
host merges three files instead of two.

Verified rather than asserted, with `docker compose config` over both merges —
there is Docker in this environment now, which there was not on 2026-08-14:

- three-file merge — `cloudflared` depends on `downloader` **and** `planner`,
  `planner` is on `edge`, `planner_storage` is added.
- two-file merge — `downloader` and `cloudflared` only, `storage` only. The
  additive claim is the one worth checking and it holds.
- `PLANNER_TAG` unset refuses the boot naming the variable, rather than
  resolving to something nobody chose.

**What ADR 004 asks for and this does not do is the rename**, now filed as
[repo-33](../../../docs/work/repo-33-adr-004-rename-and-the-project-name.md).
It is not a paste: `compose.yaml` sets no `name:`, so the compose project is the
clone's directory basename, and setting the explicit `name:` the ADR requires
renames the project under a running host and orphans the `storage` volume
holding `jobs.db`. That is a migration with a live-data step, and bundling it
with this would have made the diff unreadable at exactly the moment an operator
needs to read it.

**Step 6 is not done and cannot be, from a repository.** The Access application
is a dashboard object. What was owed here was that the four differences from the
downloader's policy stop being a trap paragraph and become the numbered step
somebody follows, and
[02-DEPLOYMENT.md](../../../docs/02-DEPLOYMENT.md)'s `## Adding the second tool`
is now that walkthrough rather than the prose delta it was.

**So this ticket stays `in-flight` on purpose.** Two of its three _Done when_
lines are closed — the image was gated by pl-13, and a planner-only release
builds only the planner. The third is "`planner.<domain>` serves the UI behind an
Access login", which is true of a machine and not of a branch. Whoever brings the
hostname up closes it. Marking it `done` here would be
[repo-32](../../../docs/work/repo-32-done-can-hide-an-outstanding-obligation.md)'s
exact failure with a live unauthenticated endpoint on the other side of it.

One thing the brief got right and is worth restating: the trap about the
downloader's policy not being a template is the most valuable paragraph in this
ticket, and the reason it now appears in the deployment page in full.
