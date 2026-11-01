---
id: repo-142
tool: repo
title: A release merge re-runs every gate its pull request already ran
kind: chore
status: done
milestone: null
depends_on: []
awaiting: Done when 1 — the first release merged after this lands shows `test` (CI) and `e2e`/`docker` (ledger, downloader, planner) skipped on its `main` push and `release` green, while this pull request's own merge push runs them
---

# repo-142 — A release merge re-runs every gate its pull request already ran

## Why

Merging `chore(ledger): release 0.6.0 (#712)` (11e21945) started six workflow
runs on `main`: `release`, `CI`, `security`, `ledger`, `downloader` and
`planner`. Only `release` does work the merge is for. Pull request #712 had
already run the rest on the same tree — `gh pr checks 712`: `test
(ubuntu-latest)` 5m22s, `test (windows-latest, informational)` 7m40s, three
`docker` builds of 1m10s–1m43s and four `e2e` jobs of 52s–1m57s, about 25
runner-minutes — and the squash merge pushes that tree again.

`downloader` and `planner` ran on a ledger release at all because the commit
touches `package-lock.json`: release-please writes the released version there
(`extra-files` in `release-please-config.json`), and every tool's path filter
lists the lockfile so that a real dependency change rebuilds every image.

The owner asked why the six are not one workflow. Combining them is one row in
the Actions list for the same compute, and loses per-tool path filters, a
`release` that is never cancelled and has its own permissions, and per-tool
re-runs. Asked on 2026-11-01, the owner chose to skip the redundant jobs on
release commits over that, over also trimming the release pull request's own
runs, and over leaving it.

## Build

1. In `ci.yml`, the `test` matrix gains a condition; in `ledger.yml`,
   `downloader.yml` and `planner.yml`, every job does: skip when the head commit
   opens `chore(` and carries `): release ` — the shape of
   `pull-request-title-pattern`. `head_commit` exists only on `push`, so pull
   requests, the nightly and `workflow_dispatch` are untouched. `check`,
   `security` and `release` are not touched.
2. The trap: each of those four workflows cancels in progress per ref. A
   release merged straight after a code merge would cancel the code's `main`
   run and then skip its own, leaving the code's merged state unrecorded. So the
   concurrency group gets a `-release` suffix for the same commits.
3. The values contain `: `, so they are double-quoted YAML scalars.

## Done when

- A `push` of a `chore(<tool>): release <version>` commit skips `test` in `CI`
  and every job in `ledger`, `downloader` and `planner`; every other event and
  every other commit runs them as before.
- A release run cannot share a concurrency group with a non-release run on the
  same ref.
- `npm run check` and the suites that read these files pass.

## Review

**Gate: PASS** — 2026-11-01 · `11e21945..aa4e7233` (the base is `origin/main`, which is also the merge base) · Sonnet 5.5, depth medium

| Done when                                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `push` of a `chore(<tool>): release <version>` commit skips `test` in `CI` and every job in `ledger`, `downloader` and `planner`; every other event and every other commit runs them as before | **awaiting** — the first release merged after this lands: its `main` push shows `test` (CI) and `e2e`/`docker` (ledger, downloader, planner) skipped and `release` green, while this pull request's own merge push, a non-release commit, shows the same jobs run. Nothing on the branch asserts it, and no event before the merge can produce a release `push`. The pull-request clause is already read: at `aa4e7233` the `ledger`, `planner` and `downloader` jobs ran and passed, and `CI`'s `test` matrix started (run 41332510416). |
| A release run cannot share a concurrency group with a non-release run on the same ref                                                                                                            | **verified** — by construction, not by a test: the group string differs by the `-release` suffix. Re-run offline over all 797 commits on `main`, 31 subjects take the suffix (all 31 are release-please commits) and 766 do not. The workflow-level `concurrency.group` expression parsed and evaluated on GitHub: all four workflows started at `aa4e7233`. The suffix on a real release payload is the reading in the row above.                                                                                                        |
| `npm run check` and the suites that read these files pass                                                                                                                                        | **verified** — `npm run build` exit 0, then `npm run check` exit 0; `npx vitest run scripts/test/preflight.test.ts scripts/test/status.test.ts tools/downloader/api/test/ytdlp-in-the-image.test.ts`: 3 files, 280 passed, 1 skipped (281); `node scripts/status.mjs --json` exit 0; `oxfmt --check` clean on the four workflows and the ticket; `check` job green on the pull request at `aa4e7233`.                                                                                                                                     |

- **low** · F1 · no `Done when` line depends on it · `ci.yml`'s note makes two absolute claims that the mechanism does not keep, both in the safe direction. "A manual re-run [is] untouched" holds for `workflow_dispatch` only; the Re-run button replays the original `push` event of the release commit (GitHub's doc says the re-run keeps the original event's sha and ref; it does not say the payload is kept, so this is inferred, not read), and would skip again. "In its own group the release run cancels no one" is false for an earlier release run: a second release merge cancels the first one's `check` (same `-release` group), which the second's tree supersedes. Same mechanism, one bullet.
- **low** · F2 · no `Done when` line depends on it · `nfr:reliability` — the condition is a shape match, so any subject that opens `chore(` and carries `): release ` skips the push gates, whether or not release-please wrote it. Positive controls on the harness: `chore(core): release the lock on exit (repo-1)` evaluates true; a `fix(...)` subject does not. On `main`'s 94 `chore(` subjects the harness finds 31 matches, all release-please commits, so there is no live call site. `contains` reads the whole message, not the subject, so a `chore(` commit whose body carries `): release ` also matches; none on `main` does, because every one of the 31 matches is a release-please commit. The Log records the subject case as accepted; the acceptance is the builder's, not the owner's.
- **low** · F3 · no `Done when` line depends on it · `nfr:maintainability` — the condition is hand-copied eleven times across four files (two in `ci.yml`, three each in the others), byte-identical today, and the safety argument ("every file that skips also splits its group") rests on no copy drifting. Nothing checks it. No live call site. Direction, not a remedy: a `scripts/test` spec that reads the four files and asserts the copies are identical and that each file with an `if` copy also has the `concurrency.group` copy.
- **low** · F4 · no `Done when` line depends on it · the ticket's `awaiting:` line lacks the `<what is owed> — <the reading>` shape and names only the release merge, not the non-release push that is its negative control. The lander writes the line from the row above.
- **dropped** · script injection through `head_commit.message`: it appears only inside `${{ }}` expressions in `if` and `concurrency.group`, never in a `run:` body. Not a defect.
- **dropped** · merge skew on a release squash (the tree no `test` job ran): the release diff is the changelog, `version.txt`, the manifest and two version fields, `check` still runs on the push, and the split group lets the preceding code merge's run finish. Not a defect.
- **dropped** · a required status check named `e2e`/`docker` blocking on a skipped job: a skipped job reports success to a required check, and `downloader.yml`'s own comment records no `required_status_checks` rule on `main`. Not a defect.
- **dropped** · the `docker` job's `cache-to` is no longer written on a release push: the layers a release changes are the version fields, and the next code merge writes the cache. No effect worth a bullet.
- **findings** · the hunt returned 8; 4 carried, 4 dropped.
- NFR: security ✓ (the message is attacker-influenced only inside expressions; the PR-time run of every skipped gate already happened) · performance ✓ (22.8 runner-minutes per release by `gh pr checks 712`'s durations, against the ticket's "about 25") · reliability ✓ with F1 and F2 · maintainability — F3.

## Log

- 2026-11-01: built directly in the session that measured it. The condition
  matches by message because nothing else marks a release-please commit on a
  `push`: the squash is authored by whoever merges, and the branch name is
  gone. A hand-written `chore(x): ...): release ...` subject would also skip, on
  `push` only, after its pull request already ran — accepted. The proof is only
  on `main` (a `push` filter), hence `awaiting`.
- 2026-11-01, gate 1 (Sonnet, PASS, four lows). F1: the `ci.yml` note now says
  the Re-run button skips again, and that a release run cancels an earlier
  release run. F3: `scripts/test/release-merge-skip.test.ts` holds every copy
  to one string, requires each skipping file to split its group, every tool
  job to skip, and the title pattern in `release-please-config.json` to be the
  shape matched. F4: `awaiting` rewritten from the gate's row. F2, the shape
  match, is put to the owner.
- 2026-11-01: F2 answered by the owner — keep the shape match. A false match
  skips gates only on a `push` to `main`, after its pull request ran them; the
  alternative, naming each tool, made the condition three times longer in
  eleven places.
