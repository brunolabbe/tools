---
id: dl-9
tool: downloader
title: Give the job FSM a back-edge so a re-probe can be modelled honestly
kind: chore
status: ready
milestone: null
depends_on: [dl-5]
---

# dl-9 — A back-edge for re-probing

**Package:** `tools/downloader/contract` (and one call site in
`tools/downloader/api`)

## Why

`JOB_TRANSITIONS` is strictly forward. [dl-5](./dl-5-api-and-orchestration.md)
required "on `VARIANT_GONE`, re-probe once and retry", but `downloading →
probing` is not a legal move, so the retry re-probes **in place**: the job stays
in `downloading`, `attempts` increments, and a fresh `probed` event is emitted.

That works and is tested. It is still a workaround: the job is doing one thing
and reporting another.

**This needs an owner decision before it can start.** The root `CLAUDE.md`
forbids editing a contract unilaterally, and this is a contract change with
siblings depending on it.

## Build

1. Add `probing` to `downloading`'s legal targets in
   `contract/src/job.ts`.
2. Have the orchestrator use it — see the note above `MAX_REPROBE_RETRIES` in
   `jobs/orchestrator.ts` — instead of re-probing in place.
3. Check the UI renders the resulting `downloading → probing → downloading`
   sequence sensibly. It should already: since
   [dl-7](./dl-7-ops-and-e2e.md), the client applies a status frame as a report
   rather than gating it on FSM adjacency.

## Done when

A job that hits `VARIANT_GONE` mid-download is observably in `probing` while it
re-probes, and the existing retry tests still pass against the new path.

## Log

_Not started._

Note from dl-7: the client no longer depends on the FSM's adjacency to interpret
a status frame, so the workaround is now invisible to the UI rather than merely
tolerable — a re-probe in place renders as a job still working. This is a
modelling improvement, not a bug the UI is papering over, which is why it is not
urgent.
