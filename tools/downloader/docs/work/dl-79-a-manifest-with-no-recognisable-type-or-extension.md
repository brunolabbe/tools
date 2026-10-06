---
id: dl-79
tool: downloader
title: A manifest served with no recognisable type or extension is never captured
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-79 — A manifest with no recognisable type or extension is never captured

## Why

`classifyMedia` in `resolvers/src/browser/media-match.ts` recognises a manifest
by its content type (`HLS_CONTENT_TYPE`, `DASH_CONTENT_TYPE`) or by its path
(`HLS_PATH`, `DASH_PATH`), and returns `undefined` for anything else. A player
that fetches its playlist from `/api/playlist?id=1` served as `text/plain` or
`application/octet-stream` therefore records no manifest hit, because nothing in
the collector ever reads a response body that hasn't already been classified
(`#captureBody` in `intercept.ts` runs only for `hls` and `dash`). The
segments it then fetches (`.ts`, `.m4s`) _are_ recorded, and are then dropped by
the ranking, so the probe ends in `NO_MEDIA_FOUND`, with nothing in the outcome
saying segments were seen.

Found by reading the code during a review of the resolver chain's false
"no video" cases, 2026-10-06. **Not yet reproduced**: building the fixture is
the first step.

## Build

1. **Reproduce first**: a fixture page that loads hls.js (or a hand-rolled MSE
   loader, if the fixtures already have one, so no new dependency) pointed at
   `/api/playlist?id=1`, served `text/plain; charset=utf-8`, whose segments are
   ordinary `.ts`. Expect an `hls` outcome. Record what `origin/main` returns.
2. In `intercept.ts`, for a response that `classifyMedia` leaves `undefined`,
   whose type is absent, `text/plain` or `application/octet-stream`, whose
   resource type is `fetch`/`xhr`, and which is small (pick and justify a cap,
   e.g. 256 KB; never read an unbounded body), read the start of the body and
   classify as `hls` on a leading `#EXTM3U` and as `dash` on an `<MPD` root.
   Then record it like any other manifest hit, so `#captureBody` and the rest of
   the pipeline see it unchanged.
3. Bound the cost: the sniff must not hold up network-quiet detection or the
   probe deadline (look at how `#pending` and `drain` already bound body
   reads).
4. When a probe ends with segment hits and no playable candidate, set a
   distinct `details.reason` on the `NO_MEDIA_FOUND` (e.g.
   `segments-without-manifest`), so the case can be diagnosed from the record
   instead of guessed. Check `@downloader/contract` for whether `reason` values
   are enumerated there. If they are, adding one is a contract change: **stop
   and say so** rather than editing it.

## Done when

- The step-1 fixture yields an `hls` outcome.
- A test proves an untyped, extensionless body beginning `<MPD` is classified
  `dash`, and that a large or non-`fetch`/`xhr` response is never read.
- A test proves a probe that saw only segments reports the new reason.
- `npm run check` and `npm test -- --project downloader` pass.

## Log
