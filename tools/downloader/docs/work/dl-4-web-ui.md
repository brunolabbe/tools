---
id: dl-4
tool: downloader
title: Web UI against a mocked API
kind: work-package
status: done
milestone: M3
depends_on: []
---

# dl-4 — Web UI

**App:** `tools/downloader/web` · **Was:** WP-4 · **Ran parallel with:**
[dl-1](./dl-1-resolver-registry-and-parsers.md),
[dl-2](./dl-2-browser-sniffer.md), [dl-3](./dl-3-download-engine.md)

## Why

The UI is mocked from the zod schemas in `@downloader/contract`, which is what
lets it ship without waiting on [dl-5](./dl-5-api-and-orchestration.md). That is
the payoff for freezing the contract in Phase 0.

## Build

React + Vite + TypeScript. **Mock the API from the zod schemas in
`@downloader/contract`** so this ships without waiting on dl-5.

Flow: paste URL → _Analyse_ (with a real progress indication — browser probes
take 10–20 s, and silent waiting reads as a hang) → variant picker table
(resolution, codec, size, audio present) → _Download_ → live progress via
`EventSource` on `ROUTES.jobEvents(id)` → completed card with the download link
and its expiry.

Requirements:

- Render `ErrorCode` distinctly. `DRM_PROTECTED` in particular gets a calm,
  final explanation — it is not a retryable error and must not offer a retry.
- Indeterminate progress when `percent` is `null`. Never fake a percentage.
- `EventSource` reconnect with backoff; reconcile by re-fetching the job on
  reconnect, since events may have been missed while disconnected.
- Persist the job list in `localStorage` so a refresh does not lose in-flight work.
- Keyboard accessible, responsive, light + dark.

## Done when

The full flow is demonstrable against mocks, including every error state.

## Log

Shipped in `b876906`.

**Three real bugs in this package's event handling survived until
[dl-7](./dl-7-ops-and-e2e.md)** and are written up in that ticket's log. All
three were invisible to the unit suites here, which mock the transport — the
bugs lived in the _ordering_ of a real one, and only appear when a job finishes
fast enough for the race to run every time. Each now has a regression test in
`tools/downloader/web/test/`.

Still missing: **no component-render tests.** The Playwright suite covers the
paths that matter most end to end, but there is nothing between "pure function"
and "whole stack in a browser", so a broken component that happens not to be on
the E2E path fails silently.

`VITE_API_MOCK` now defaults by mode rather than to the mock unconditionally —
dev still mocks, a production build does not. An image that silently mocked
every download would look perfectly healthy and do nothing.
