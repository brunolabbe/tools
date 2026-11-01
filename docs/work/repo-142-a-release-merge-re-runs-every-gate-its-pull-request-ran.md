---
id: repo-142
tool: repo
title: A release merge re-runs every gate its pull request already ran
kind: chore
status: done
milestone: null
depends_on: []
awaiting: the first release merged after this lands shows `test`, `e2e` and `docker` skipped on its `main` push, and `release` green
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

## Log

- 2026-11-01: built directly in the session that measured it. The condition
  matches by message because nothing else marks a release-please commit on a
  `push`: the squash is authored by whoever merges, and the branch name is
  gone. A hand-written `chore(x): ...): release ...` subject would also skip, on
  `push` only, after its pull request already ran — accepted. The proof is only
  on `main` (a `push` filter), hence `awaiting`.
