# Releasing — commits in, tagged images out

How a change becomes a version, a changelog entry and a container image the
mini-PC can pull. The reasoning behind the shape is in
[adr/002](./adr/002-releases-from-conventional-commits.md); this page is how to
work it.

---

## Shape

```
   a commit on a branch
           │  feat(downloader): …
           ▼
   ┌────────────────────┐
   │  pull request      │   the *title* is checked, because a squash
   │                    │   merge lands the title, not the commits
   └─────────┬──────────┘
             │ merged
             ▼
   ┌────────────────────────────────────────────────┐
   │  main                                          │
   │  release-please reads the commits and keeps     │
   │  an open release PR *per tool that changed*    │
   │                                                 │
   │   ┌──────────────────────┐  ┌────────────────┐ │
   │   │ chore: release       │  │ chore: release │ │
   │   │ downloader 0.2.0     │  │ planner 0.1.1  │ │
   │   └──────────┬───────────┘  └────────────────┘ │
   └──────────────┼──────────────────────────────────┘
                  │  you merge one — this is the release
                  ▼
       tag downloader-v0.2.0  ·  CHANGELOG.md  ·  version.txt
                  │
                  ▼
       ghcr.io/<owner>/downloader:0.2.0
                  │  docker compose pull && up -d
                  ▼
              the mini-PC
```

Two tools changed means two release PRs. Merge either, both, or neither — a tool
with no unreleased commits has no PR and is never rebuilt.

---

## Writing a commit

```
type(scope): subject
```

`.githooks/commit-msg` checks it as you commit, and
[`.github/workflows/pr-title.yml`](../.github/workflows/pr-title.yml) checks the
pull request title. Both run [`scripts/commit-message.mjs`](../scripts/commit-message.mjs),
which is the actual specification — this table is a summary of it.

| Type                                                      | Version                            | In the changelog |
| --------------------------------------------------------- | ---------------------------------- | ---------------- |
| `feat`                                                    | minor                              | yes              |
| `fix`                                                     | patch                              | yes              |
| `perf`, `revert`                                          | none                               | yes              |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore`        | none                               | no               |
| any of the above with `!`, or a `BREAKING CHANGE:` footer | minor, while a tool is below 1.0.0 | yes              |

Only `feat`, `fix` and a breaking change move a version — that is release-please's
rule, not a choice made here. **A `perf:` commit on its own therefore releases
nothing**; it is listed in the changelog of whatever release comes next. If a
performance fix needs to ship by itself, it is a `fix`.

**Scopes** are the tool directories — `downloader`, `planner` — plus `core`,
`repo`, `ci` and `deps`. The list is read off `tools/` at runtime, so a new tool
is a valid scope the moment its directory exists. `feat` and `fix` require one:
they are the two that reach a changelog, and a changelog line that does not say
which tool it belongs to is noise.

**There is no `security` type**, although this repo's history has one. A
security fix is a `fix` — it should bump the patch version and appear in the
changelog, which is exactly what an invented type prevents.

**Ticket ids go in the subject**, in parentheses: `fix(downloader): stop
re-probing in place (dl-9)`. That is what the `dl-`/`pl-` prefix is for — see
[01-TICKETS.md](./01-TICKETS.md).

### What routes a commit to a tool

**The files it touched, not its scope.** A commit that edits
`tools/planner/api/**` belongs to the planner's changelog even if someone typed
`(downloader)` in the scope. The scope is for the reader; the path is for the
machine. A commit touching both tools appears in both changelogs, which is
correct and is also a hint that it should have been two commits.

The worked example is downloader 0.2.0, whose only entry reads
`**planner:** run the fan-out as a job (pl-16)`. That commit lifted the rate
limiter into `packages/core` and rewired `tools/downloader/api` to use it while
adding the planner's feature — so the downloader genuinely changed and genuinely
owed a release, and the line describing it was written for another tool. Two
commits would have given each tool a sentence that was true of it.

### The one case that needs a footer

A change to `packages/core` alone touches no tool's path, so it releases
nothing — while both images embed it. Normally this is a non-problem, because
core exists to serve a tool and the change ships with the tool commit that
wanted it.

When it genuinely is core-only and a tool needs to go out anyway, force it:

```
fix(core): reject a redirect to a private address after the first hop

The downloader has to ship this on its own; nothing in tools/downloader
changed.

Release-As: 0.2.1
```

---

## Merging a pull request

**Squash, and nothing else.** The repository allows one merge method, and the
squash commit is titled by the pull request title with an empty body. That is
what makes the title the message and a branch's own commits working notes —
everything on this page assumes it. In API terms, and these four are the whole
arrangement:

```bash
gh api repos/<owner>/<repo> --jq \
  '{squash: .allow_squash_merge, merge: .allow_merge_commit,
    title: .squash_merge_commit_title, body: .squash_merge_commit_message}'
# {"squash":true,"merge":false,"title":"PR_TITLE","body":"BLANK"}
```

**It was not always configured that way, and the gap was invisible.** Until
2026-08-16 `allow_squash_merge` was off and every pull request landed as a merge
commit, with `merge_commit_message: PR_TITLE` writing the title into the body:

```
Merge pull request #34 from brunolabbe/worktree-pl-16-the-plan-run

feat(planner): run the fan-out as a job (pl-16)
```

release-please does not stop at a merge commit's subject — it reads the body,
and counts every line there that parses as a conventional commit as a commit in
its own right. So that entry landed twice, once for the branch commit and once
for the merge, and downloader 0.2.0 shipped with its single feature listed under
two SHAs. Every merged pull request had been doing it; nothing failed, and the
release is where it became visible.

**The body could not be blanked.** GitHub accepts only three title/message
combinations for a merge commit — `PR_TITLE`+`PR_BODY`, `PR_TITLE`+`BLANK`,
`MERGE_MESSAGE`+`PR_TITLE` — and all three put the pull request title into the
merge commit, as subject or as body. With conventional branch commits landing
alongside it, every one of them duplicates. There is no merge-commit
configuration that avoids this, which is the argument for squash and not merely
a preference for it.

**`squash_merge_commit_message` matters as much as the method.** The default is
`COMMIT_MESSAGES`, which writes every branch commit message into the squash
commit's body — reproducing the same duplication through the other door. `BLANK`
is not decoration.

**The hook keeps a backstop.** `scripts/commit-message.mjs` skips a merge
commit's subject, as it always did, and rejects a conventional line in its body.
Nothing routine produces a merge commit now, but a `git merge --no-ff` done by
hand still reaches the hook — and the failure mode is silent enough to have cost
a release once.

---

## Cutting a release

1. Land the work on `main`.
2. release-please opens or updates a release PR titled
   `chore(<tool>): release <version>`. Read the changelog diff in it.
3. Merge it. That is the release.
4. [`release.yml`](../.github/workflows/release.yml) tags, publishes a GitHub
   release, and pushes the image.

That title is a `pull-request-title-pattern` in
[`release-please-config.json`](../release-please-config.json), and it is not the
default. release-please would title it `chore(main): release planner 0.2.0` —
the _target branch_ in the scope position — which `pr-title` rejects, because
`main` is not a scope. The release PR is a pull request and is held to the same
rule as any other. The pattern needs `component-no-space` per package, or
`${component}` is rendered with the leading space the default relies on and the
title reads `chore( planner)`. `scripts/test/commit-message.test.ts` builds the
title out of that config and validates it, so this cannot regress quietly.

**`CHANGELOG.md` is ignored by `oxfmt`**, in
[`.oxfmtrc.json`](../.oxfmtrc.json). release-please writes it in its own
markdown — `*` bullets, a blank line the formatter would collapse — and rewrites
it from scratch every release, so `format:check` failed on every release PR and
reformatting it would only be undone by the next one. A generated file is not
ours to format.

**`always-update` is on**, so release-please rebuilds the release branch on
every push to `main` rather than only when the changelog or the title changed.
Without it, a release PR that went red keeps its red checks after the fix lands
— its branch still points at the `main` that was broken, and nothing re-runs
until someone presses **Update branch**. It costs a force-push per release PR
per push to `main`, which buys a release PR whose green checks were earned
against the `main` it will merge into.

Published tags, per release:

| Tag          | Use                                              |
| ------------ | ------------------------------------------------ |
| `0.2.0`      | What a host pins. The only one worth deploying   |
| `0.2`        | Convenience for a local `docker run`             |
| `latest`     | Convenience. Deliberately not what the host runs |
| `sha-1a2b3c` | Tracing an image back to a commit                |

Nothing is published for a push that releases nothing, and the downloader's
two-gigabyte image is not rebuilt when only the planner was released.

---

## Deploying what came out

On the mini-PC, in the checkout described by [02-DEPLOYMENT.md](./02-DEPLOYMENT.md):

```bash
$EDITOR .env                       # DOWNLOADER_TAG=0.2.0
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up -d
curl -s http://127.0.0.1:8080/api/health | jq .version   # expect 0.2.0
```

No `--build`. The host stopped building in
[adr/002](./adr/002-releases-from-conventional-commits.md); it pulls a released
artifact now, and the `/data` volume survives as it always did.

**Rolling back is the same three commands with the previous version**, and it
takes as long as a pull. That is the thing the whole pipeline buys.

`DOWNLOADER_TAG` is required rather than defaulted to `latest`, on purpose: a
host following a moving tag cannot answer "what is it running", and the answer
changes underneath you at the next pull. `/api/health` reports the version and
it agrees with `.env`, because release-please stamps both `version.txt` and
`api/package.json`.

### Registry access

The images are private, so the host authenticates once:

```bash
echo "$TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

A **classic** personal access token with the **`read:packages`** scope and
nothing else. Classic rather than fine-grained because that is what GitHub
documents for the container registry, and `read:packages` is a classic scope
name with no fine-grained equivalent that is as well trodden. It is the one
credential this arrangement costs, and it cannot write anything.

---

## Setup, once

**`RELEASE_PLEASE_TOKEN`** — **optional, and reasonable to skip.** Without it
everything works, but the release pull request arrives with **no checks run
against it**: GitHub does not trigger workflows from events created with the
default `GITHUB_TOKEN`, as a loop-prevention rule. A release PR only ever
touches `CHANGELOG.md`, `version.txt` and `api/package.json` — nothing
executable — so this is a small hole. Add the token the day an unchecked release
PR actually bothers you.

To add it, a fine-grained personal access token scoped to this repository alone,
with **Contents: read and write** and **Pull requests: read and write**, and
nothing else:

```bash
gh secret set RELEASE_PLEASE_TOKEN --repo <owner>/<repo>
```

Fine-grained tokens expire — a year at most. When one does, release-please stops
opening pull requests **silently**: the workflow still succeeds, it just does
nothing. A GitHub App avoids that (same two permissions, mint a token per run
with `actions/create-github-app-token`) at the cost of more setup. For a
single-maintainer repo, the token and a calendar reminder is the honest trade.

**Package visibility** — the first push creates the GHCR package as private.
Nothing else is required; the host's read-only token is enough.

---

## Things that will bite you

**A merge with a bad title lands a bad changelog entry, permanently.** The PR
title check is the last gate, and squash-merging is what makes the title the
message. There is no rewriting `main`, so the entry is fixed by hand in the next
release PR — which is allowed: the changelog in an open release PR is a normal
file and can be edited before merging. downloader 0.2.0 is the standing example
of what does not get fixed afterwards.

**`INSTALL_YTDLP` is decided in CI now, not on the host.** It was a build arg,
and a host that pulls an image no longer runs a build to pass it to. Changing it
means changing the workflow and cutting a release.

**A rebuilt image at the same version is a different image.** The
`workflow_dispatch` path exists for exactly one case — the source is unchanged
and an _input_ was patched, typically a base image CVE — and it overwrites the
tag. Anything else deserves a version.

**The first release of a tool is the first time its image is built for real.**
The planner's image gate in [`planner.yml`](../.github/workflows/planner.yml)
and the downloader's in [`downloader.yml`](../.github/workflows/downloader.yml)
exist to stop that being true, by building on every change to the tool. If you
add a tool, add its gate before its first release, not after.

**Adding a tool needs nothing in `release.yml`.** One entry in
[`release-please-config.json`](../release-please-config.json), a matching line
in [`.release-please-manifest.json`](../.release-please-manifest.json), a
`version.txt`, and a `tools/<name>/Dockerfile`. The build matrix is whatever was
released, resolved at runtime.
