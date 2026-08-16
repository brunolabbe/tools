# 002 — Each tool releases itself, from conventional commits

**Status:** accepted · **Date:** 2026-08-14 · **Affects:** every tool

## Context

Nothing in this repo has ever been released. Every workspace is `private: true`
and cross-package dependencies are `"*"`, so the `version` field in eleven
`package.json` files is decoration: no resolver reads it and no consumer exists.
The one place a version is observed is `/api/health`, which reports what it
finds in its own manifest — with a comment saying it does that "so the reported
version cannot drift from the one that was released", which until now described
a release process that did not exist.

Deployment matched. [02-DEPLOYMENT.md](../02-DEPLOYMENT.md) put a checkout on
the host and built there, and said so as a virtue: "there is no registry in this
setup, which is one less credential and one less thing to keep in sync". That
was right while the host was the only builder. It costs two things once there is
CI: the host cannot say which version it is running, and a rollback is
`git checkout <sha>` plus a ten-minute Playwright rebuild on a small machine.

Commits are written almost entirely by agents. That changes which enforcement
mechanisms work — an agent that gets a rejection while it still holds the
context fixes it; one that gets a CI email has moved on — and it raises the cost
of an unenforced convention, because there is no author who will notice drift.

## Decision

**A tool is the unit of release.** The two tools version independently, tag
independently (`downloader-v0.2.0`), and produce one container image each.
Packages do not version at all.

**Versions come from conventional commits**, via release-please in manifest
mode with one component per tool. It routes each commit to a component by the
**files it touched**, not by its scope, which is the same rule the repo already
uses to decide what a tool is.

**A release is triggered by merging a pull request.** release-please keeps an
open release PR per tool, accumulating the changelog as work lands. Merging it
cuts the tag and publishes the image. This is the manual trigger, and a better
one than a button: the changelog and the version bump are reviewed as a diff.

**Images are published to GHCR and pulled by the host**, pinned to an exact
version in `.env`. `compose.yaml` still builds from source, because that is what
a developer wants; `compose.prod.yaml` pulls, because a deployed host wants an
artifact it can name and roll back to.

**The convention is enforced twice**: `.githooks/commit-msg` for immediate
feedback, and a check on the pull request title, which is what a squash merge
actually lands and therefore what release-please reads. Both call
`scripts/commit-message.mjs`, so they cannot disagree.

> **Amendment, 2026-08-16.** The squash merge in that paragraph never existed:
> `allow_squash_merge` was off from the start and every pull request landed as a
> merge commit, so the commits on the branch — not the title — are what
> release-please reads. The decision above is unaffected, and the enforcement is
> still two calls into one file; which of the two is load-bearing is what
> changes, and `.githooks/commit-msg` is the one. The rest of the correction,
> including why a merge commit's body must be empty, is in
> [03-RELEASING.md](../03-RELEASING.md).

## Alternatives considered

**Changesets.** Designed for publishing packages, and its value is the intent
file an author writes per change. Here the conventional commit already carries
that intent, so adopting it would mean every agent writing the same description
twice, in two formats, with nothing checking they agree.

**One repo-wide version and one changelog.** Simpler, and genuinely defensible
with two tools and one maintainer. Rejected because the version's real job is to
tag a container image: a shared number means a planner-only change republishes
the downloader's image under a new tag with identical contents, and "what
changed in 0.4.0" stops having an answer.

**semantic-release.** Releases on every push to `main`. That removes the review
step this design is built around, and its monorepo story is a plugin rather than
a model.

**Giving `packages/core` its own version.** It has no external consumer and
ships inside both images; a number on it would be recorded nowhere that anyone
reads. See the consequence below, which is the price of not having one.

**A self-hosted runner on the mini-PC that deploys on release.** Removes the
manual pull, and puts an agent with repository credentials — running code from
pull requests — on the machine that hosts the tunnel. The pull is one command.

## Consequences

- **A change to `packages/core` alone releases nothing.** It touches no tool's
  path, so release-please routes it nowhere, while both images embed it. The
  rule this repo adopts is that a core change ships with the tool commit that
  motivated it, which is already how core came to exist. For the genuine
  exception — a core fix both tools need, with no tool-side change — the escape
  hatch is a `Release-As:` footer, documented in
  [03-RELEASING.md](../03-RELEASING.md).
- **The root `Dockerfile` and its `compose.yaml` build arg move.** Each tool
  owns its own Dockerfile now, and the planner's is a plain Node base rather
  than Playwright's — a twentieth of the size. The consequence is that
  `INSTALL_YTDLP` stops being a knob the host can turn: it is baked when the
  image is built, so it is decided in CI.
- **`version.txt` and `api/package.json` are both stamped** on release, the
  second so `/api/health` reports the version that was actually shipped. Neither
  is edited by hand.
- **The release pull request arrives without checks** unless a
  `RELEASE_PLEASE_TOKEN` secret exists, because a PR opened with the default
  `GITHUB_TOKEN` does not trigger other workflows. It only ever touches
  changelogs and version files, so this is a real but small hole.
- **Repo-level tooling has no ticket of its own.** `work/` exists only under a
  tool and ids are prefixed per tool, so the shared machinery was filed as the
  first half of [dl-10](../../tools/downloader/docs/work/dl-10-release-pipeline.md),
  with [pl-2](../../tools/planner/docs/work/pl-2-container-image.md) as the
  second consumer that proves it generalises. If a third piece of repo-wide work
  arrives with nowhere to live, that is the signal to give `docs/` a `work/` of
  its own — not before.
