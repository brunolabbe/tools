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
(the `USER_AGENT` constant, `webtools-planner/1.0 (+https://github.com/webtools)`).
Overpass was never given one.

What the plan shows for it. `discoverAlongCorridor` in
`tools/planner/api/src/runs/discovery.ts` calls the `nearby()` helper in that file, whose
`catch` logs only `code` (`UNREACHABLE`), drops the status, and returns an answer of
no finds. The pass then emits the coverage sentence "There is very little on the map
along this route." So a refused backend reads to the traveller as
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
   end of the file. Use the existing `answering()` helper (near the top of the file) and
   `discoveryProvider()` (`function discoveryProvider(`, beside the `nearby` cases), and
   read the header the way the Nominatim `User-Agent` case does:
   `const headers = calls[0]?.init?.headers as Record<string, string> | undefined;`. The
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
7. `tools/planner/api/src/runs/lodging.ts`, the two warns in the town pass: `locateTown`'s
   `catch` and `queryTown`'s `catch`. The warn calls read:
   ```
   input.logger.warn("the town pass could not locate a town", {
     provider: input.provider.name,
     code: AppError.from(error).code,
   });
   ```
   and
   ```
   input.logger.warn("the town pass could not query a town", {
     provider: input.provider.name,
     code: AppError.from(error).code,
   });
   ```
   Add `status` to both, read from `AppError.from(error).details` when that carries a numeric
   `status`, the same way step 6 does for the corridor warn; omit the field when there is none.
   Keep `code` as it is. Do not log the URL. Do not change what either `catch` returns (`null`
   and `[]`). The test drives `discoverLodging` over a `ValhallaGroundingProvider` built on a
   stubbed `fetch`, with a spy `AppLogger` whose `warn` records its fields. Put it in
   `tools/planner/api/test/lodging-pass.test.ts`, which already drives `discoverLodging` (its
   existing cases use a fixture provider and a silent logger).
8. Owner's decision, 2026-10-24, folded in (see the Log): four more `warn` calls in
   `tools/planner/api/src/runs/discovery.ts` drop the HTTP status the same way step 6
   describes. They are `a notability lookup failed, continuing with the rest` (`notability`),
   `a corridor reading lookup failed, continuing` (`corridorReading`), `discovery could not
locate a corridor endpoint` (`locate`) and `a detour cost could not be measured`
   (`detourCosts`). Each gets step 6's field: `status` read from `AppError.from(error).details`
   when it is a numeric `status`, omitted otherwise. Keep `code`, every return and the
   no-URL rule. Each catch wraps a call that goes through `#json`, which is where the status
   is set. One test each goes at the end of `tools/planner/api/test/discovery-pass.test.ts`,
   which drives all four paths through `discoverAlongCorridor`.

## Done when

1. The `nearby` case added to `tools/planner/api/test/grounding-valhalla.test.ts`
   asserts the Overpass `POST` carries a non-empty `user-agent` header, through the
   stubbed `fetch`. It fails on the base and passes after the change. Offline.
2. A stubbed `fetch` answers the discovery pass's Overpass `POST` with HTTP 406,
   `discoverAlongCorridor` runs over a `ValhallaGroundingProvider` built on that stub with
   a spy logger, and the recorded `warn` for `the corridor could not be queried` carries
   `status: 406`. It fails on the base, where the field is absent, and passes after the
   change. Offline.
3. A stubbed `fetch` that refuses one town's geocoder query and another town's Overpass query,
   both with HTTP 406, so that both warns fire in one run. `discoverLodging` runs over a
   `ValhallaGroundingProvider` built on that stub with a spy logger, and the recorded `warn`s
   for `the town pass could not query a town` and `the town pass could not locate a town` each
   carry `status: 406`. They fail on the base, where the field is absent, and pass after the
   change. Offline.
4. `npx vitest run` on each spec file that Build steps 2, 6, 7 and 8 name passes in full.
5. `npm run check` passes.
6. A stubbed `fetch` that refuses, with HTTP 406, the request each of the four lookups named by
   Build step 8 makes: the article queries behind `a notability lookup failed, continuing with
the rest` and `a corridor reading lookup failed, continuing`, the geocoder query behind
   `discovery could not locate a corridor endpoint`, and the routing `POST` behind `a detour cost
could not be measured`. `discoverAlongCorridor` runs over a `ValhallaGroundingProvider` built
   on that stub, once per lookup, with a spy logger, and each recorded `warn` carries
   `status: 406`. Each fails on the base, where the field is absent, and passes after the
   change. Offline.

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

### 2026-10-24 — scope answer recorded: lodging.ts's two town-pass warns folded in (builder, maintenance dispatch)

Owner's answer, given at an intake checkpoint on 2026-10-24 and relayed to this branch by the
orchestrator. Question: "pl-61 fixes only the corridor nearby() warn. pl-60's town pass in
lodging.ts (lines 203 and 228) drops the 406 status in the same way. Should pl-61 cover it?"
Options: (1) "Fold lodging.ts in (Recommended)": same defect, same fix, two more warn sites, and
one added Done-when line naming lodging.ts's two warns; otherwise pl-62 extends the town pass
and inherits the gap. (2) "Corridor only, as filed": the lodging.ts warns stay, recorded as a
known gap. (3) "File it separately": a new planner ticket. Chosen: (1). The orchestrator
recommended (1); nothing was overridden.

Checked against `origin/main` at `aa834403`. Both warns are in `tools/planner/api/src/runs/lodging.ts`.
The one at line 228 reads `the town pass could not query a town`. The one at line 203 is not the
text the intake note gave for it: it reads `the town pass could not locate a town`, and sits in
`locateTown`, not `queryTown`. Both are in Build step 7 and in the one added Done-when line,
because the answer covers both. Both drop the status the same way the corridor warn does
(`code` alone).

The locate request already sends `USER_AGENT` (the `locate` request in `valhalla.ts`, with
`headers: { "user-agent": USER_AGENT, accept: "application/json" }`). A 406 from it is therefore not
the Overpass cause this ticket fixes. The `locate` warn gets the same log-field change for
consistency, and its Done-when case is driven by a stub, not by a measured 406 from that backend.

Line references that went stale when pl-60 landed, and that this branch touches, are replaced with
the content they point at: `USER_AGENT` (now `valhalla.ts` line 113, not 112), `nearby()` (now
about line 809, not 736), the coverage sentence (`discovery.ts` line 393, not about 322), and the
`answering()`, `discoveryProvider()` and headers-read references (lines 220, 1426 and 548 of
`grounding-valhalla.test.ts`, not 1420–1445 and 544). Not touched, and still stale: Build step 5's
`sources_to_targets` call, which is at `valhalla.ts` line 356, not about 358.

Difficulty left as `mechanical`. The builder's view is that the addition stays mechanical: two
more field reads with the same narrow, and one more stub test. The lodging test also needs a
Nominatim stub, not only an Overpass one; if the owner reads that as more than mechanical, it is
the owner's call to change the field.

Ticket edited only. No source changed. `status` is still `ready`.

### 2026-10-24 — built on `pl-61-overpass-user-agent` (builder, build dispatch)

Base `89a38d30`. Farm, then `npm run build` in this worktree: exit 0.

**Step 2, red on the base.** The three new cases were written and run before any source change:

`npx vitest run tools/planner/api/test/grounding-valhalla.test.ts tools/planner/api/test/discovery-pass.test.ts tools/planner/api/test/lodging-pass.test.ts`

```
× the POST names its client, because node's default user-agent gets HTTP 406 from the public instance
× a 406 from the geocoder and from Overpass reaches each warn with its status, and the towns are still asked about
× a 406 reaches the corridor warn with its status, and the coverage sentence is unchanged
Tests  3 failed | 159 passed (162)
```

The failures are the ones the ticket predicts. The header is absent: `TypeError: .toMatch() expects to receive a string, but got undefined`. The warns carry no `status`: `expected { provider: 'valhalla', …(1) } to match object { code: 'UNREACHABLE', status: 406 }`, with `- "status": 406` missing from the received fields. The lodging case's title was shortened to "a 406 from the geocoder and from Overpass reaches each town-pass warn with its status" after this run; no assertion changed.

**The fix**, located by content:

- `valhalla.ts`, `#overpassJson`: `headers: { "content-type": "text/plain", "user-agent": USER_AGENT }`, the existing constant.
- `discovery.ts`, `nearby()`'s `catch`: the corridor warn adds `status` from `AppError.from(error).details?.status` when it is a number, omitted otherwise. `code`, the return value and the coverage sentence are unchanged. The URL is not logged.
- `lodging.ts`, `locateTown`'s and `queryTown`'s `catch`: the same field, same narrow. `null` and `[]` returns unchanged.

**Step 2, green.** The same command after the fix:

```
Test Files  3 passed (3)
Tests  162 passed (162)
```

Placement: the step-2 case is the last block of `grounding-valhalla.test.ts`. The step-6 corridor case is the last block of `discovery-pass.test.ts`, which step 6 permits, and it builds its `RunGrounding` over a real `ValhallaGroundingProvider` with a helper `overValhalla`. The step-7 case is the last block of `lodging-pass.test.ts`, one stub for both refusals: Percé's geocoder query is refused (the locate warn) and Gaspé's Overpass query is refused (the query warn). Both assert `{ code: "UNREACHABLE", status: 406 }`. The new imports are `type AppLogger` in `discovery-pass.test.ts` and `ValhallaGroundingProvider` in `lodging-pass.test.ts`.

**`npm run check`:** exit 0. Its oxlint output shows warnings only, all `no-await-in-loop` or `prefer-array-find` in lines this change does not touch. `npx oxfmt --check` on the six touched files: `All matched files use the correct format.`

**Step 4, live, once** (2026-10-24, serial, no retries, `node live-check.mts` in the scratch `build/` directory). The adapter's `nearby` on the Gaspé point with `[point, point]`, radius 2000, kind `viewpoint`, which renders the same `around:2000,…` query the probe logged:

```
{"ok":true,"ms":41435,"finds":2,"names":["Du Sanatorium","Le Belvédère"]}
```

The base reading for this query is the 406 in the curl entry above, from the same day. This session did not re-run the base live.

**Not done, and why:**

- Step 5, `#json`'s `sources_to_targets` POST: not checked, so no reading exists. Unchanged.
- Four more warns in `discovery.ts` drop the status in the same way: `a notability lookup failed, continuing with the rest`, `a corridor reading lookup failed, continuing`, `discovery could not locate a corridor endpoint` and `a detour cost could not be measured`. The Build names only the corridor warn, and the owner's answer covered the two lodging warns. Folding the four in would be the same one-line change, but it is not already specified, so it was not folded in. Nothing was filed. This is an open decision for the orchestrator: fold them into pl-61, or file a follow-up.

Status stays `ready`; the lander sets it with the gate record.

### 2026-10-24 — two owner answers applied on the same branch (builder, follow-up round)

**Question 1: four more warns in `discovery.ts`.** Four warns drop the status the way the
corridor warn did: `a notability lookup failed, continuing with the rest`, `a corridor reading
lookup failed, continuing`, `discovery could not locate a corridor endpoint` and `a detour cost
could not be measured`. Options: (1) fold them into pl-61; (2) file a follow-up ticket; (3)
leave them. The builder recommended (2). **The owner chose (1), fold in. That overrode the
builder's recommendation of (2).** Recorded as Build step 8 and Done when 6, with the same
`status` field as step 6 and one test each at the end of `discovery-pass.test.ts`.

None of the four can never carry an HTTP status. Each catch wraps a call that goes through
`#json` (`articlesNear`, `locate` and `travel` all do, in `valhalla.ts`), and `#json` is the path
that sets `details.status` on a non-2xx. A timeout or a cancel has no status, so the field is
omitted there, as the step says. The tests drive a 406 for each.

Red, then green. On the base source, `npx vitest run tools/planner/api/test/discovery-pass.test.ts`:

```
× a refused notability lookup reaches its warn with the status
× a refused corridor-reading lookup reaches its warn with the status
× a refused endpoint lookup reaches its warn with the status
× a refused routing matrix reaches its warn with the status
Tests  4 failed | 32 passed (36)
```

Each failure reads `expected { provider: 'valhalla', …(1) } to match object { code: 'UNREACHABLE', status: 406 }`.
After the four warns were given the field: `npx vitest run` on the three touched spec files,
`Test Files  3 passed (3)`, `Tests  166 passed (166)` (162 before, plus four).

Test-design note. The first draft of the test stub answered `articlesNear` with `[]` and
`travel` with all-`UNKNOWN`. Under that stub the notability, reading and detour warns never fired,
and the base read `expected 0 to be greater than 0`. That was the stub's fault, not the defect. The
stub now delegates `articlesNear` and `travel` to the real provider, and the base then fails on
the missing field, as above.

**Question 2: Done when 3's single 406 stub.** Options: (1) reword it to a two-stub form; (2) keep
the wording. The builder's view was that (2) cannot be satisfied. **The owner chose (1).** The
wording is now "a stubbed `fetch` that refuses one town's geocoder query and another town's
Overpass query, both with HTTP 406, so that both warns fire in one run."

Why the old wording cannot pass. A single stub that answers every request with 406 fires only
`the town pass could not locate a town`. `locateTown`'s `catch` returns `null`, and `discoverLodging`
then takes the `located === null` branch of its town loop (`if (located === "refused" || located ===
null) { … continue; }`), so `queryTown` never runs for that town and its warn never fires. The
test uses one stub that refuses Percé's geocoder query and Gaspé's Overpass query, so both warns
fire in one run.

Done when 4 now names Build step 8 as well, and Done when 6 covers the four warns.

Commit and push: the change is a second commit on `pl-61-overpass-user-agent`. Status stays `ready`.
