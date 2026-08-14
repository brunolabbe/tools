---
id: dl-10
tool: downloader
title: Release from conventional commits, and ship a tagged image to the registry
kind: chore
status: done
milestone: null
depends_on: [dl-7]
---

# dl-10 — Releases, changelogs, and an image the host can pull

**Packages:** none. This is repo tooling, `.github/workflows/`, and this tool's
`Dockerfile`.

> **Why this is a downloader ticket.** Most of what it builds — the commit
> convention, release-please, the release workflow — belongs to no tool. `work/`
> exists only under a tool and ids are prefixed per tool, and inventing a
> `repo-` namespace for one piece of work would be guessing at a format decided
> a day earlier. The repo's own rule is that shared things are lifted on the
> **second** real consumer, so the machinery was written here, for the tool that
> actually deploys today, and [pl-2](../../../planner/docs/work/pl-2-container-image.md)
> is the second consumer that proves it generalises. If a third piece of
> repo-wide work turns up with nowhere to live, that is the signal to give
> `docs/` a `work/` of its own.

## Why

Nothing here has ever been released. Every workspace is `private: true`, so the
eleven `version` fields are decoration — except `api/package.json`, which
`/api/health` reports with a comment claiming it "cannot drift from the one that
was released", describing a process that did not exist.

[02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md) had the mini-PC building
from a checkout, and called the absence of a registry a virtue. It was one,
while the host was the only builder. With CI it costs the two things a version
is for: the host cannot say what it is running, and a rollback is
`git checkout <sha>` plus a ten-minute Playwright rebuild on a small machine.

Commits are written by agents, which changes what enforcement works. A rejection
at commit time lands back in the loop that produced it; a CI failure arrives
after that context is gone.

Full reasoning in [adr/002](../../../../docs/adr/002-releases-from-conventional-commits.md).

## Build

1. **`scripts/commit-message.mjs`** — the convention, once, as dependency-free
   `.mjs` so the hook works in a clone nobody has `npm install`ed yet. Scope
   list read off `tools/` at runtime. `feat`/`fix` require a scope. No
   `security` type — that is a `fix`.
2. **`.githooks/commit-msg`**, installed by a root `prepare` script pointing
   `core.hooksPath` at it. Fails **open** when node is missing: a fresh clone
   that cannot commit at all is worse than a bad message, and CI is the real
   gate.
3. **`.github/workflows/pr-title.yml`** — the same validator against the pull
   request title, because this repo squash-merges and the title is what lands.
4. **release-please, manifest mode**, one `simple` component per tool.
   `extra-files` also stamps `api/package.json` so `/api/health` stops lying.
   `packages/core` is deliberately not a component.
5. **`tools/downloader/Dockerfile`** — moved off the root, build context still
   the repo root. `compose.yaml` gains a `dockerfile:` pointer.
6. **`.github/workflows/release.yml`** — release-please, then a matrix over
   `paths_released` that builds and pushes only what was actually released.
7. **`compose.prod.yaml`** pulls `ghcr.io/<owner>/downloader:<version>` instead
   of building, with `pull_policy: always` because `compose.yaml`'s `build:`
   section cannot be unset by an overlay.

Traps worth knowing in advance:

- **A PR opened with the default `GITHUB_TOKEN` triggers no workflows.** The
  release PR arrives unchecked unless a `RELEASE_PLEASE_TOKEN` secret exists.
- **release-please routes by path, not by scope.** A commit is the planner's
  because it touched `tools/planner/**`, whatever the scope says.
- **GHCR paths are case sensitive and GitHub logins are not.** Lowercase the
  owner in the workflow.

## Done when

- A conventional-commit violation is rejected by the hook locally and by
  `pr-title` in CI, and `npm test -- --project repo` proves the rule.
- Merging a release PR produces the tag `downloader-vX.Y.Z`, a `CHANGELOG.md`
  entry, and `ghcr.io/<owner>/downloader:X.Y.Z` in the registry.
- A push that releases only the planner does **not** rebuild the downloader's
  image.
- On the mini-PC, `docker compose pull && up -d` runs that version and
  `/api/health` reports it.

## Log

**2026-08-14 — landed, unproven end to end.**

Everything in Build is written and on the branch. `npm run check` and the full
suite pass; the commit-message rule has 15 tests under the new `repo` vitest
project.

What is **not** verified, and cannot be from here: no Docker in the dev
container, so neither image was built locally, and nothing has been released, so
no release PR, tag or registry push has ever happened. The first release is the
first exercise of `release.yml`. The narrow-manifest copy the planner's
Dockerfile mirrors is proven, though — `downloader.yml`'s docker job is green on
`main` with the planner already in the lockfile.

Two decisions worth recording because the brief did not settle them:

- **Zero-dependency validator over commitlint.** commitlint would drag its tree
  into a repo that deliberately picked oxlint and oxfmt over eslint and
  prettier, and the rules here — scope from disk, ticket ids, the
  `BREAKING CHANGE` footer typo check — are custom anyway. The cost is that
  `scripts/` sits outside the `tsc --build` graph: oxlint and the `repo` vitest
  project cover it, `tsc` does not.
- **`CHANGELOG.md` at the tool root, not in the `docs/` spine.** The spine is
  hand-written and read by agents; a file release-please rewrites every release
  does not belong in the middle of it.

**2026-08-14 — the first release PR failed its own title check.**

The planner's first release PR ([#4](https://github.com/brunolabbe/tools/pull/4))
opened as `chore(main): release planner 0.2.0` and `pr-title` rejected it:
`"main" is not a known scope`. release-please's default title pattern puts the
**target branch** where a conventional scope goes, so the two halves of this
ticket — the commit convention and release-please — were fitted to each other
only in the documentation, which already claimed the title was
`chore(<tool>): release <version>`. Nothing else on the PR failed; CI and the
planner image job were green.

Fixed in the config rather than by widening the rule, because `main` as a scope
would be meaningless in a changelog and would have to be allowed forever:
`pull-request-title-pattern` is now `chore(${component}): release ${version}`,
with `component-no-space: true` on each package — without it release-please
renders `${component}` with a leading space (that is how the default gets
`release planner`) and the title becomes `chore( planner)`. The pattern still
round-trips through release-please's own parser, which is what reads the merged
PR to cut the tag; the `${scope}` token it warns about being absent only carries
the target branch, and releases here only ever come off `main`.

The regression guard is in `scripts/test/commit-message.test.ts`: it builds each
tool's release title from the config and runs the validator over it. Worth
knowing that this class of failure is invisible until the first release — the
title is generated by an action, so nothing local can produce it.

**2026-08-14 — and then `check` failed on the changelog release-please wrote.**

Second gate the release PR did not survive, and the same shape of mistake: the
repo's own tooling applied to a file the repo does not write. `oxfmt --check`
reformats `tools/planner/CHANGELOG.md` — release-please emits `*` bullets and a
double blank line before each section — so `npm run check` failed on the release
PR under both the `push` and the `pull_request` event, which is the two red
checks. The tests were green on both platforms; only `check` failed, and it
failed at `format:check`, before `typecheck` ever ran.

`**/CHANGELOG.md` is now in `.oxfmtrc.json`'s `ignorePatterns`. Formatting it
instead would be undone by the next release, since release-please rewrites the
whole file every time.

The general lesson for anything added to this pipeline later: every gate this
repo runs on a human's pull request also runs on a **generated** one, and
release-please's output was written to satisfy neither.

Fixing that on `main` does not clear the red on an open release PR, which is the
third thing this taught: release-please skips the branch entirely when the title
and body come out identical (`maybeUpdateExistingPullRequest`, "PR remained the
same"), so the PR keeps checks that ran against the broken `main` until someone
presses **Update branch**. `always-update: true` takes the other branch of that
condition and rebuilds the release branch on every push to `main`. The cost is a
force-push per open release PR per push; the gain is that a release PR's green
checks were earned against the `main` it merges into.

`RELEASE_PLEASE_TOKEN` is set on the repository, so release pull requests will
run the normal checks rather than arriving unverified. It is a fine-grained PAT
and will expire: when it does, release-please stops opening pull requests
**silently** — the workflow still succeeds and simply does nothing.
[03-RELEASING.md](../../../../docs/03-RELEASING.md) covers the renewal and the
GitHub App alternative that has no expiry.

**2026-08-14 — the first release ran, and the pipeline holds.**

`chore(downloader): release 0.1.1` ([#7](https://github.com/brunolabbe/tools/pull/7))
merged, and everything that had never executed executed: the tag
`downloader-v0.1.1`, the GitHub release `downloader: v0.1.1`, a `CHANGELOG.md`
release-please wrote from the two `fix(downloader)` commits since 0.1.0, and
`publish (tools/downloader)` green in 3m13s — resolve, compute tags, build,
push to `ghcr.io/brunolabbe/downloader`. `.release-please-manifest.json` and
`api/package.json` both read `0.1.1`, so `/api/health` reports the version that
was released rather than a decoration.

Nothing needed fixing this time, which is the first release PR of which that is
true — the two earlier entries above are why.

**One acceptance criterion is a host action and stays open.**
`docker compose pull && up -d` on the mini-PC, with `/api/health` reporting
`0.1.1`, cannot be checked from CI or from here. The credential it needs is not
new: the first push creates the GHCR package **private**, which
[03-RELEASING.md](../../../../docs/03-RELEASING.md) already anticipated and
[02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md) already covers with a
`read:packages` login on the host. Worth knowing that a package staying private
is the expected state, not a misconfiguration to go hunting for.

**The other one is half-proven and finishes itself.** The criterion is that a
planner-only release does not rebuild the downloader's image; what this release
showed is the same mechanism in the other direction — only
`publish (tools/downloader)` ran, because the publish matrix comes from
release-please's own outputs and the planner was not in them. The stated
direction gets its evidence when the planner's release PR merges, at no cost to
anyone.

Marking this ticket done regardless: the machinery is built, exercised and
correct, and what remains is one `docker compose pull` on hardware this repo
does not reach.
