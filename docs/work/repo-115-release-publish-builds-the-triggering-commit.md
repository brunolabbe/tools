---
id: repo-115
tool: repo
title: release publish builds the commit that triggered the run, not the one released
kind: fix
status: done
milestone: null
depends_on: []
awaiting: the next release run's publish job on main — green through Build and push, with a sha- tag of the released sha's first 7 characters in its summary and org.opencontainers.image.revision equal to the released sha in the Compute tags log
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
4. Take the `sha-` tag and the revision label from the released sha rather
   than from `github.sha`: a `type=raw` tag and a custom
   `org.opencontainers.image.revision` label. (This step first said
   `context: git`, which a detached checkout refuses; see the 2026-10-25 Log.)

## Done when

- `publish` builds and tags the commit release-please released, whichever push
  triggered the run.
- A mismatch between the checkout and release-please's sha or version fails the
  job instead of pushing an image.

## Review

**Gate: PASS** — 2026-10-25 · `b9c6c8be..ac1907f0` (merge-base is `origin/main`, `b9c6c8be`) · Sonnet 5.5, depth medium

| Done when                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish` builds and tags the commit release-please released, whichever push triggered it | **awaiting** — the next release run on `main` whose `publish` job reaches `Compute tags` (planner 0.10.0 via #614 is the open one); the reading is that job green through `Build and push`, a `sha-` tag of the released sha's first 7 characters in the run summary, and `org.opencontainers.image.revision` equal to the released sha in the `Compute tags` log |
| A mismatch between the checkout and release-please's sha or version fails the job         | **verified** — no test exists for a workflow; I ran the Resolve step's own `run` text against a throwaway repo: matching sha exits 0 and writes five outputs, a wrong `RELEASED_SHA` exits 1 with the `::error::checked out …` line. The guard is unchanged by the diff (two `echo` lines after it)                                                               |

- **low** · no `Done when` line depends on it · the PR body's recovery for ledger
  0.4.1 ("after merge, dispatch `rebuild` with `tool: ledger`") builds whatever `main`
  is at dispatch, with no sha guard. #636 (`chore(deps)`, better-sqlite3 13) is open and
  touches `tools/ledger/api/package.json` and `package-lock.json`, both inputs of the
  ledger image; merged first, `:0.4.1` and `:latest` carry unreleased code, the class of
  defect repo-115 closes. The rebuilt image also gets no `sha-` tag and no OCI labels,
  because `rebuild` skips metadata-action. Direction, not a remedy: dispatch before
  merging #636, or dispatch with the workflow ref set to the tag `ledger-v0.4.1` (the
  tag's `release.yml` has the `rebuild` job; I did not run a dispatch). Owner's call.
- **low** · `docs/work/repo-115-…md` `awaiting:` has no `<owed> — <reading>` separator
  and its reading omits the revision label, the clause the fix rests on. Wording that
  fits the shape (not run through `status`): `the next release run's publish job on main — green through Build and push, with a sha- tag of the released sha's first 7 characters in its summary and org.opencontainers.image.revision equal to the released sha in the Compute tags log`.
  `npm run status -- --json` exits 0 with the current line.
- **low** · the ticket's `## Build` step 4 still says to give metadata-action
  `context: git`; the new Log entry says it was wrong. False in the unsafe direction for
  a reader who follows the Build list, but the Log is the next section and the
  workflow comment now says why. Strike or amend step 4.
- **low** · the Log and PR body call `dc802804` "the pinned" metadata-action; the
  workflow says `docker/metadata-action@v6`, a floating tag. The failed run's own log
  confirms it resolved to `dc802804…` and `git ls-remote` shows `v6` = `v6.2.0` = that
  sha today, so the source read is the code that ran. Wording only; a later `v6.x` is
  not pinned out.
- **low** · no live call site · the meta step's `annotations`, `json` and `bake-file*`
  outputs still carry the triggering sha as `revision`, because custom `labels` do not
  reach annotations and `type=sha`'s replacement does not either. Nothing reaches the
  image or tags today: the build step passes only `tags` and `labels`, and
  build-push-action's `src/context.ts` reads no `DOCKER_METADATA_*` env. A later
  `annotations: ${{ steps.meta.outputs.annotations }}` would reintroduce the wrong sha.
- **dropped** · `docs/03-RELEASING.md` shows the tag as `sha-1a2b3c` (6 characters) where
  the real tag is 7; pre-existing and outside the diff.
- **findings** · the hunt returned 6; 5 carried, 1 dropped.
- CI at `ac1907f0`: `check` (two), `changes`, `codeql`, `dependency-review` and `CodeQL`
  pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still
  pending when read. No row above depends on them.
- NFR: security ✓ (the new `with:` values are hex from `git rev-parse`, not shell-interpolated) · performance n/a · reliability — the recovery finding above · maintainability — the Build step 4 and `awaiting` findings above.
- **After the gate, at landing:** the `awaiting:` wording, Build step 4, the
  "pinned" wording and the annotations comment were fixed as the gate worded
  them, and so was the dropped `sha-1a2b3c` in `docs/03-RELEASING.md`. The
  recovery finding is the owner's call, put to them as a question.

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
  action's `src/meta.ts` at `dc802804`, which `@v6` resolved to in the failed run: custom labels go into a
  `Map` after the generated ones, so the last one wins. The `awaiting:` line now
  names the pushed image and its revision label, not just the check. Recovery for 0.4.1 is the
  owner's: dispatch the `rebuild` job for `ledger`, which builds from `main`
  and does not use `metadata-action`.
