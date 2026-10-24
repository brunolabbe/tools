---
id: pl-61
tool: planner
title: Overpass discovery sends no user agent, and the public instance answers 406
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# pl-61 — Overpass discovery sends no user agent

## Why

`ValhallaGroundingProvider.#overpassJson` in `tools/planner/api/src/grounding/valhalla.ts`
POSTs to `${overpassUrl}/interpreter` with `content-type: text/plain` and no
`user-agent`. Node's `fetch` then sends its own default, `user-agent: node`, and the
public instance `overpass-api.de` answers **HTTP 406 Not Acceptable**. The adapter
turns that into `UNREACHABLE` with `details: { status: 406 }`.

The sibling `locate` request in the same file already sends `USER_AGENT`
(`webtools-planner/1.0 (+https://github.com/webtools)`, line 112). Overpass was
never given one.

What the plan shows for it. `discoverAlongCorridor` in
`tools/planner/api/src/runs/discovery.ts` calls `nearby()` (around line 736), whose
`catch` logs only `code` (`UNREACHABLE`), drops the status, and returns an answer of
no finds. The pass then emits the coverage sentence "There is very little on the map
along this route." (around line 322). So a refused backend reads to the traveller as
a thin map. An unset `OVERPASS_URL` gets the same sentence, because `nearby()`
returns `[]` before any request is made. The sentence cannot tell the two apart.

Found while measuring pl-60's discovery (branch `pl-60-lodging-discovery`, PR #607),
which did not introduce it. `.env.example` leaves `OVERPASS_URL` unset and says to
point it at a self-hosted instance because the public one is slow (pl-33). It names
no instance, and no self-hosted instance was measured here, so whether one refuses
this request is unknown.

## Build

1. `tools/planner/api/src/grounding/valhalla.ts`, `#overpassJson`: add
   `"user-agent": USER_AGENT` to the `headers` beside `content-type`. Reuse the
   existing `USER_AGENT` constant. Do not add a second string. The constant has not
   been sent to Overpass; see step 4.
2. `tools/planner/api/test/grounding-valhalla.test.ts`: add one `nearby` case at the
   end of the file. Use the existing `answering()` and `discoveryProvider()` helpers
   (around lines 1420–1445) and the `calls[0]?.init?.headers` read at line 544. The
   case asserts the outgoing POST carries a non-empty `user-agent`. Run it on the base
   first and confirm it fails with the header absent, then apply the change and confirm
   it passes.
3. Do not change what the `catch` in `discovery.ts` returns, the coverage sentence, or the
   way `#overpassJson` is shaped. The one thing changed in that `catch` is the warn line,
   by step 6. Whether a refused backend should say "could not ask" rather than "very little
   on the map" was decided on 2026-10-24: keep it. Do not re-raise it here.
4. Live check, once, after the change: run the adapter against the public instance the
   way the Log's probe did, serially, with no retries. The `adapter` result must be
   `ok: true`, not `UNREACHABLE`/406. Log the reading with its date. This check is
   network-dependent, so it is not a Done-when line.
5. Not in scope, unmeasured: `#json`'s routing `POST` to `sources_to_targets`
   (valhalla.ts, around line 358) also sends no `user-agent`. Whether a public Valhalla
   refuses it has not been measured. Name it in the Log if you check it; do not fix it here.
6. `tools/planner/api/src/runs/discovery.ts`, `nearby()`'s `catch`. The warn call currently
   reads:
   ```
   logger.warn("the corridor could not be queried", {
     provider: provider.name,
     code: AppError.from(error).code,
   });
   ```
   Add `status` to it, read from `AppError.from(error).details` when that carries a numeric
   `status`. `details` is `Record<string, unknown>`, so narrow with `typeof`, and omit the
   field when there is none rather than logging `undefined`. Keep `code` as it is. Do not
   log the URL. The test for it drives `discoverAlongCorridor` over a `ValhallaGroundingProvider`
   built on a stubbed `fetch`, with a spy `AppLogger` (the interface in
   `packages/core/src/logger.ts`) whose `warn` records its fields. Put it in the file step 2
   names, or in a planner api test that already drives `discoverAlongCorridor`.

## Done when

1. The `nearby` case added to `tools/planner/api/test/grounding-valhalla.test.ts`
   asserts the Overpass `POST` carries a non-empty `user-agent` header, through the
   stubbed `fetch`. It fails on the base and passes after the change. Offline.
2. A stubbed `fetch` answers the discovery pass's Overpass `POST` with HTTP 406,
   `discoverAlongCorridor` runs over a `ValhallaGroundingProvider` built on that stub with
   a spy logger, and the recorded `warn` for `the corridor could not be queried` carries
   `status: 406`. It fails on the base, where the field is absent, and passes after the
   change. Offline.
3. `npx vitest run` on each spec file that Build steps 2 and 6 name passes in full.
4. `npm run check` passes.

## Log

### 2026-10-24 — filed on `pl-61-file-overpass-user-agent` (builder, maintenance dispatch)

Claim: the Overpass adapter sends no user agent, Node sends `user-agent: node`, and
the public instance answers 406 to that and 200 to a named agent.

Commands and output, on the base `8a6dcf9a`, built in this worktree with `npm run build`
(the output is abridged where it reads `...`):

`node ua-echo.mjs` (a local server; sends only `content-type`, as `#overpassJson` does):

```
POST /interpreter
{ ... "content-type": "text/plain", ..., "user-agent": "node", ... }
node v22.23.3
```

`node probe.mts <worktree> <raw-dir>` (pl-60's probe, run once here: one adapter query
and one confirming query, serial, no retries; `probe.json` written to the scratch raw
directory):

```
adapter: {"ok":false,"code":"UNREACHABLE","details":{"status":406},"seen":[{"status":406,"ua":null,"ms":445}]}
same query, identifying UA: {"status":200,"ms":24118,"elements":3,"head":"{\n  \"version\": 0.6, ...
overpass queries: 2
```

The query is the one `overpassQuery` builds for Gaspé's point, kind `viewpoint`,
radius 2000 m, timeout 58:
`[out:json][timeout:58]; ( node["tourism"="viewpoint"](around:2000,48.8317223,-64.4837569,48.8317223,-64.4837569); ); out body;`

Measured independently with curl on 2026-10-24 by the orchestrating session, not re-run
here (the same query saved as `query.ql`):

```
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://overpass-api.de/api/interpreter -H 'content-type: text/plain' --data-binary @query.ql
406
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://overpass-api.de/api/interpreter -H 'content-type: text/plain' --data-binary @query.ql -A 'webtools-planner/0.9 (pl-60 probe)'
200  (27.7 s)
```

Read off the code, not run: `discovery.ts` `nearby()` catches the `UNREACHABLE`,
logs `code` alone, and returns an empty answer; the pass then emits the coverage
sentence. An unset `OVERPASS_URL` returns `[]` from `valhalla.ts` `nearby()` before
any request, so it gets the same sentence.

Filing only: no source changed in this branch.

### 2026-10-24 — two decisions recorded, owner answers relayed by the orchestrator

Decision A, the warn line. Question: when `nearby()` in `api/src/runs/discovery.ts` hits an
Overpass error, it logs only the error `code`, so the 406 status never reaches the log.
What should happen to it? Options: (1) fold it into pl-61, with a Done-when making the warn
line carry `details.status`, fixed by pl-61's builder together with the user agent; (2) a
separate follow-up ticket, which the builder recommended; (3) leave it. Chosen: (1). The
owner's answer overrode the builder's recommendation of (2). Recorded here as the answer.

Decision B, a refused backend reads as a thin map. Question: a 406 and an unset
`OVERPASS_URL` both produce "There is very little on the map along this route." Options:
(1) keep it, which the comment in `nearby()`'s `catch` says is deliberate, with no second
kind; (2) add a distinct "could not ask" sentence, which needs copy and reverses that
comment. The builder recommended (1). Chosen: keep it for now. Nothing is filed for it. The
next agent should not re-raise it unless a measurement changes the premise.

Difficulty: `mechanical`, unchanged by the addition. The warn change is one field read with
a type narrow, and the test follows the stub pattern step 2 already names.
