---
id: repo-115
tool: repo
title: release publish builds the commit that triggered the run, not the one released
kind: fix
status: done
milestone: null
depends_on: []
awaiting: the next release run's publish job on main pushing its image, tagged `sha-` with the released commit's short sha, after passing its sha and version check
---

# repo-115 — release publish builds the commit that triggered the run, not the one released

## Why

`release.yml`'s `publish` job checked out `github.sha` and read the image version
off that tree's `version.txt`. release-please reads `main` as it stands when the
job starts, not as it stood at the triggering push, so a run can release a commit
that landed after it was triggered. When it does, `publish` builds the older tree
and tags it with the older version.

Reproduced on 2026-10-22. #465 (planner 0.9.0) and #459 (downloader 0.10.0) were
merged about a minute apart:

| Run         | Triggered by      | release-please released                                          | publish built        |
| ----------- | ----------------- | ---------------------------------------------------------------- | -------------------- |
| 39706562482 | `60c14993` (#465) | planner 0.9.0 at `60c14993`, **downloader 0.10.0 at `162f17b3`** | both from `60c14993` |
| 39706672711 | `162f17b3` (#459) | nothing: the tag already existed                                 | skipped              |

The run triggered by `60c14993` started release-please at 01:36:33, the same
second #459 merged. Its log reads
`release for path: tools/downloader, version: 0.10.0, sha: 162f17b3…`, and its
`publish (tools/downloader)` job succeeded. At `60c14993`,
`tools/downloader/version.txt` reads `0.9.0`. So the downloader image went out
as `:0.9.0`, `:0.9`, `:latest` and `sha-60c1499`. That image holds the 0.10.0
code except for the version-bump commit, and it overwrote the real 0.9.0 image's
tags. `ghcr.io/brunolabbe/downloader:0.10.0` was never pushed.

(The publish job's own log was not readable from the devcontainer, because the
log blob host is outside the firewall. The tags above follow from the workflow
and from `version.txt` at `60c14993`.)

## Build

In `.github/workflows/release.yml`:

1. Expose every release-please output as one JSON job output (`all`). A job
   output has to be named in advance, and the per-path names are not known
   until a tool is released.
2. In `publish`, check out `<path>--sha` instead of the default ref.
3. Before tagging, fail if `HEAD` is not that sha or `version.txt` is not
   `<path>--version`. Without this, an empty `ref` would silently fall back to
   `github.sha`, which is the original bug.
4. Give `docker/metadata-action` `context: git`, so that the `sha-` tag and the
   revision label come from the checkout rather than from `github.sha`.

## Done when

- `publish` builds and tags the commit release-please released, whichever push
  triggered the run.
- A mismatch between the checkout and release-please's sha or version fails the
  job instead of pushing an image.

## Log

- 2026-10-22: filed and fixed in the same PR, by owner decision. The race cannot
  be reproduced on a branch: `release-please` runs only on a push to `main`. So
  the proof is the guard in step 3, which runs on every release from now on.
  Recovery was left to the owner: rebuild the downloader through the
  `workflow_dispatch` `rebuild` job, which pushes `:0.10.0` and `:latest` from
  `main`. Restoring the original `:0.9.0` tag is optional and done in the GHCR UI.
- 2026-10-25: the first release under this fix, ledger 0.4.1 (run
  40208629662, released `b9c6c8be`), passed step 3's check and then failed
  in `Compute tags` with `Cannot infer ref from detached HEAD`. Step 4 was
  wrong: checking out a bare sha leaves HEAD detached, and
  `docker/metadata-action`'s `context: git` refuses that. No image was pushed.
  Fixed by going back to the default context, writing the `sha-` tag as
  `type=raw` from the released sha, and overriding
  `org.opencontainers.image.revision` with a custom label. Read off the
  action's `src/meta.ts` at the pinned `dc802804`: custom labels go into a
  `Map` after the generated ones, so the last one wins. The `awaiting:` line now
  names the pushed image, not just the check. Recovery for 0.4.1 is the
  owner's: dispatch the `rebuild` job for `ledger`, which builds from `main`
  and does not use `metadata-action`.
