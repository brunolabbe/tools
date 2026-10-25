---
id: pl-61
tool: planner
title: Overpass discovery sends no user agent, and the public instance answers 406
kind: fix
status: done
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
9. Owner's decision, 2026-10-24, folded in (see the Log): two more `warn` calls in
   `tools/planner/api/src/runs/travel.ts` drop the HTTP status the same way step 6 describes.
   They are `a place could not be located` (the locate loop in `measureTravel`) and
   `the travel matrix could not be measured` (its matrix call). Each gets step 6's field, and
   each catch wraps a `#json` call (`locate` and `travel`), so each can carry a status. Keep
   `code` and every return. One test each goes at the end of
   `tools/planner/api/test/travel-measure.test.ts`, which drives `measureTravel`.

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
4. `npx vitest run` on each spec file that Build steps 2, 6, 7, 8 and 9 name passes in full.
5. `npm run check` passes.
6. A stubbed `fetch` that refuses, with HTTP 406, the request each of the four lookups named by
   Build step 8 makes: the article queries behind `a notability lookup failed, continuing with
   the rest` and `a corridor reading lookup failed, continuing`, the geocoder query behind
   `discovery could not locate a corridor endpoint`, and the routing `POST` behind `a detour cost
   could not be measured`. `discoverAlongCorridor` runs over a `ValhallaGroundingProvider` built
   on that stub, once per lookup, with a spy logger, and each recorded `warn` carries
   `status: 406`. Each fails on the base, where the field is absent, and passes after the
   change. Offline.
7. A stubbed `fetch` that refuses, with HTTP 406, the geocoder query behind `a place could not
   be located` and the routing `POST` behind `the travel matrix could not be measured`.
   `measureTravel` runs over a `ValhallaGroundingProvider` built on that stub, with a spy logger,
   and each recorded `warn` for those two messages carries `status: 406`. Each fails on the
   base, where the field is absent, and passes after the change. Offline.

## Review

**Gate: PASS** — 2026-10-24 · `89a38d30..a8954049` · Sonnet 5.5, depth narrow

| Done when                                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The `nearby` case asserts the Overpass `POST` carries a non-empty `user-agent`; fails on the base, passes after                                   | `api/test/grounding-valhalla.test.ts` › "nearby, the Overpass request's own headers (pl-61) the POST names its client, because node's default user-agent gets HTTP 406 from the public instance" ✓. The assertion is `headers?.["user-agent"]` matching `/\S/u`. Planting the revert of only the `user-agent` entry in `#overpassJson` turns exactly this test red (1 of 166).                                                                                                                                                      |
| 2. A 406 on the Overpass `POST` puts `status: 406` on the `the corridor could not be queried` warn                                                   | `api/test/discovery-pass.test.ts` › "discoverAlongCorridor, when the Overpass request is refused (pl-61) a 406 reaches the corridor warn with its status, and the coverage sentence is unchanged" ✓. Removing only the `nearby()` status spread turns exactly this test red (1 of 166).                                                                                                                                                                                                                                             |
| 3. One stub refuses one town's geocoder query and another town's Overpass query; both town-pass warns fire in one run and each carries `status: 406` | `api/test/lodging-pass.test.ts` › "the town pass, when the backend refuses (pl-61) a 406 from the geocoder and from Overpass reaches each town-pass warn with its status" ✓. Asserts one `could not locate a town` warn and one `could not query a town` warn, each `{ code: "UNREACHABLE", status: 406 }`, and `finds` equal to `[]`. Removing either spread turns this one test red (1 of 166 each). Breaking either stub matcher so it matches no request also turns it red, so it does not pass on a stub that matches nothing. |
| 4. `npx vitest run` on each spec file Build steps 2, 6, 7 and 8 name passes in full                                                                  | **verified** — `npx vitest run` on `grounding-valhalla`, `discovery-pass`, `lodging-pass`: `Test Files 3 passed (3)`, `Tests 166 passed (166)`, exit 0. The Log's "162 plus four" reconciles.                                                                                                                                                                                                                                                                                                                                       |
| 5. `npm run check` passes                                                                                                                            | **verified** — exit 0 at `a8954049`. The warnings are `no-await-in-loop` on `await` lines the diff does not touch.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. A 406 on each of the four lookups reaches its own warn with `status: 406`, once per lookup                                                        | `api/test/discovery-pass.test.ts` › "discoverAlongCorridor, when a backend refuses a lookup (pl-61)" — "a refused notability lookup …", "a refused corridor-reading lookup …", "a refused endpoint lookup …", "a refused routing matrix reaches its warn with the status" ✓. Each asserts `toMatchObject({ code: "UNREACHABLE", status: 406 })` after a `length > 0` companion. Removing each site's spread turns exactly that site's own test red and no other (1 of 166 each, positive control green at 166 of 166).              |

Does any `Done when` line depend on Build step 5 (the unmeasured `sources_to_targets` user agent)? No. Done when 1 asserts only the Overpass `POST`; Done when 6's routing case stubs a 406 and does not depend on a user agent.

- **low** · no `Done when` line depends on it · `nfr:maintainability` and shape · `api/src/runs/travel.ts` has two more warns with the same shape the ticket fixes, `a place could not be located` and `the travel matrix could not be measured`. Each logs `code` alone for a refusal that went through `#json`, where `details.status` is set. They are outside the owner's folded scope (seven warns, named), so this is recorded, not required. **Open decision**: (a) leave and record, (b) fold both into pl-61 with a test each (recommended: same defect, same one-line change, the branch's helpers `overValhalla` and the spy logger already exist), (c) file a ticket. Nothing here settles it.
- **low** · no `Done when` line depends on it · after this change two adapter requests still go out with Node's default `user-agent: node`: `travel`'s `sources_to_targets` `POST` (Build step 5, left unmeasured by design) and `articlesNear`'s Wikipedia/Wikivoyage geosearch `GET` (named nowhere in the ticket). Whether either is refused is unmeasured. Also the `USER_AGENT` doc comment in `valhalla.ts` still reads "Sent on every geocoder request", which is true but no longer says Overpass sends it too. False in the safe direction; no live call site.
- **low** · `nfr:maintainability` · the same three-line narrowing (`const status = AppError.from(error).details?.status` plus the conditional spread) is written seven times, and `AppError.from(error)` is evaluated twice at each site. A tool-local helper would hold the `typeof` narrow in one place. The test files carry two different `overValhalla` helpers (one in `discovery-pass.test.ts`, one in `lodging-pass.test.ts`) and the first corridor test builds its spy logger inline beside the new `recordingLogger` helper. No defect.
- **dropped** · "the lodging test's stub refuses all Overpass queries, not one town's". Only Gaspé is located, so only Gaspé's Overpass query is ever sent; the stub is equivalent to the reworded line, which the owner settled. Not a defect.
- **dropped** · "Build step 5 is logged as unmeasured, so the ticket is incomplete". It is a Build step that says not to fix and to name it only if checked; the Log says it was not checked. Consistent, and no `Done when` rests on it.
- **findings** · the hunt returned 5; 3 carried, 2 dropped.
- NFR: security ✓ (no URL, body or header reaches any new warn; only a `typeof number` `details.status` is read, `details` is never spread; `details` in `valhalla.ts` carries `status`, `timeoutMs`, `reason`, `language`, `backend`/`remark`, never a URL) · performance n/a · reliability ✓ (every `catch` return is unchanged in the diff) · maintainability — above.
- CI at head `a8954049` (PR #618): `check`, `test (ubuntu-latest)`, `e2e`, `docker`, `codeql`, `dependency-review`, `CodeQL`, `changes` pass; `test (windows-latest, informational)` still pending when read, not graded.
- Unmeasured: Build step 4's live Overpass reading (network-dependent, not a Done-when line); the Log's `ok: true` is the builder's, not re-run here.

### Gate 2

**Gate: PASS** — 2026-10-24 · round `a8954049..510e5f78` (one commit, `510e5f78`), base `89a38d30` · Sonnet 5.5, depth narrow

| Done when                                                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The `nearby` case asserts the Overpass `POST` carries a non-empty `user-agent`; fails on the base, passes after                                                                       | `api/test/grounding-valhalla.test.ts` › "nearby, the Overpass request's own headers (pl-61) the POST names its client, because node's default user-agent gets HTTP 406 from the public instance" ✓. **Re-run**: gate 1's `mutate.mjs`, unchanged, on the new head. Control 166 of 166; dropping only the `user-agent` entry in `#overpassJson` turns exactly this test red (1 of 166).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2. A 406 on the Overpass `POST` puts `status: 406` on the `the corridor could not be queried` warn                                                                                       | `api/test/discovery-pass.test.ts` › "discoverAlongCorridor, when the Overpass request is refused (pl-61) a 406 reaches the corridor warn with its status, and the coverage sentence is unchanged" ✓. **Re-run**: removing only the `nearby()` spread turns exactly this test red (1 of 166).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3. One stub refuses one town's geocoder query and another's Overpass query; both town-pass warns carry `status: 406`                                                                     | `api/test/lodging-pass.test.ts` › "the town pass, when the backend refuses (pl-61) a 406 from the geocoder and from Overpass reaches each town-pass warn with its status" ✓. **Re-run**: removing either spread turns this one test red (1 of 166 each); `plant-stub.mjs`, unchanged: either stub matcher changed to match no request turns it red (`expected [] to have a length of 1 but got +0`, and `expected { provider: 'valhalla', …(1) } to match object { code: 'UNREACHABLE', status: 406 }`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4. `npx vitest run` on each spec file Build steps 2, 6, 7, 8 and 9 name passes in full                                                                                                   | **verified** — `npx vitest run` on `grounding-valhalla`, `discovery-pass`, `lodging-pass` and `travel-measure`: `Test Files 4 passed (4)`, `Tests 180 passed (180)`, exit 0. The four files are the population the five steps name (steps 6 and 8 share `discovery-pass`). 166 in the first three, unchanged from gate 1, plus 14 in `travel-measure`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. `npm run check` passes                                                                                                                                                                | **verified** — exit 0 at `510e5f78`; 17 warnings, the count gate 1 read at `a8954049`. The one that names `travel.ts` is `no-await-in-loop` on the `provider.locate` await, a line the round does not touch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6. A 406 on each of the four lookups reaches its own warn with `status: 406`, once per lookup                                                                                            | `api/test/discovery-pass.test.ts` › "discoverAlongCorridor, when a backend refuses a lookup (pl-61)" — "a refused notability lookup …", "a refused corridor-reading lookup …", "a refused endpoint lookup …", "a refused routing matrix reaches its warn with the status" ✓. **Re-run**: each of the five `discovery.ts` spreads removed alone turns exactly that site's test red (1 of 166 each).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7. A 406 on the geocoder query behind `a place could not be located` and on the routing `POST` behind `the travel matrix could not be measured` each reaches its warn with `status: 406` | `api/test/travel-measure.test.ts` › "the measuring pass, when the backend refuses (pl-61)" — "a refused locate reaches the place warn with its status" and "a refused routing matrix reaches the matrix warn with its status" ✓. The locate test asserts a `length > 0` companion, then `toMatchObject({ code: "UNREACHABLE", status: 406 })` on every `a place could not be located` warn; the matrix test asserts exactly one `the travel matrix could not be measured` warn and the same `toMatchObject`. **Plants (2)**: removing the locate spread alone turns exactly the locate test red (1 of 14); removing the matrix spread alone turns exactly the matrix test red (1 of 14); control 14 of 14. **Stub non-vacuity (2)**: the geocoder matcher changed to match no request turns the locate test red (`expected 0 to be greater than 0`); the routing matcher changed to match no request turns the matrix test red (`expected { provider: 'valhalla', …(1) } to match object { code: 'UNREACHABLE', status: 406 }`). Neither passes on a stub that matches nothing. |

Does any `Done when` line depend on Build step 5 (the unmeasured `sources_to_targets` user agent)? No, as at gate 1: row 7's matrix case answers 406 from a stub.

- **fixed** · gate 1 finding 1 (low, two more `travel.ts` warns). The owner chose (b). Both sites carry `status` read through the same `typeof number` narrow, Build step 9 and Done when 7 record it, and the two plants above show each site is pinned by its own test. Verified by the plants in row 7, not by the Log's red-on-base run.
- **fixed** · gate 1 finding 2 (low), to the extent the owner chose: the `USER_AGENT` doc comment in `valhalla.ts` now reads "Sent on every geocoder request and on every Overpass request", which the census re-run bears out. The header is deliberately not added to `#json`; settled, not re-raised. The census still shows `travel`'s `sources_to_targets` `POST` and `articlesNear`'s `GET` going out as Node's default `user-agent: node`, as gate 1 measured.
- **not fixed, by owner's choice** · gate 1 finding 3 (low, one helper for the seven narrowings). Settled. The round writes the narrowing at two more `travel.ts` sites, and the test files now carry `overValhalla` three times (`discovery-pass`, `lodging-pass`, `travel-measure`) and `recordingLogger` three times (`discovery-pass`, `travel-measure`, and `grounding-cache`, which predates the branch). Recorded as a count, not a new finding.
- Ticket edits read: Done when 4 now names steps 2, 6, 7, 8 and 9, and each of the four files exists and ran; Done when 7 is met by its two tests (row above). The Log's follow-up entry records finding 1 as (b), the owner's choice and the gate's recommendation, and finding 2 as "the comment only", with the header not added to `#json` and the third low not applied. It attributes the Wikipedia measurement to the orchestrator and says "This branch did not re-run it". I re-ran that curl at this head: `-A node` 200, the planner's own agent 200, no user agent 403, the three numbers the Log gives.
- **findings** · the hunt in the round's lines returned 0 new; gate 1's three get verdicts above and are not counted again. Nothing in the round is a `high`.
- NFR: security ✓ (the two new warns read `AppError.from(error).details?.status` only, narrowed `typeof number`; `details` is never spread; no URL, body or header reaches either; where `details` is set in `valhalla.ts` no value is a URL) · performance n/a · reliability ✓ (both `catch` bodies keep their `code` field and their returns; the diff adds one field to each warn) · maintainability — the settled third low.
- CI at head `510e5f78` (PR #618), read once: `CodeQL`, `codeql`, `check` (both runs), `e2e`, `docker`, `dependency-review` pass; `changes` pending, and neither `test (ubuntu-latest)` nor the informational Windows leg is registered yet. No `Done when` line rests on those legs: rows 4 and 5 were run here.
- Unmeasured: the public Valhalla endpoint's reaction to Node's default user agent. Build step 4's live `ok: true` Overpass reading is the builder's: one serial `POST` with `-A node` returned 406 here, and the one with the planner's agent timed out at 25 s (curl exit 28), so no `ok` reading was taken and none was retried.

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

### 2026-10-24 — gate 1's two lows, applied on the same branch (builder, round 1 follow-up)

Gate 1 (the narrow Sonnet gate) graded `a8954049` PASS and recorded three lows. The owner answered
two of them on 2026-10-24. The third stays recorded and is not applied.

**Finding 1: two more warns in `travel.ts`.** Gate 1 found that `measureTravel` in
`tools/planner/api/src/runs/travel.ts` has two warns with the same shape the ticket fixes: `a place
could not be located` (the locate loop) and `the travel matrix could not be measured` (the matrix
call). Each logs `code` alone for a refusal that went through `#json`, where `details.status` is set.
Options: (a) leave them and record it; (b) fold both into pl-61, with a test each; (c) file a
ticket. Gate 1 recommended (b). **The owner chose (b), fold in, which is the gate's recommendation.**
Recorded as Build step 9 and Done when 7. Neither catch is a path that can never carry a status:
both wrap `provider.locate` and `provider.travel`, which go through `#json`. The same narrow `status`
field as the other warns, one test each at the end of `travel-measure.test.ts` (the spec that drives
`measureTravel`), with the spy logger and a `ValhallaGroundingProvider` on a refusing stub.

Red on the base, before the fix: `npx vitest run tools/planner/api/test/travel-measure.test.ts`,
with `travel.ts` as committed at `a8954049`:

```
× a refused locate reaches the place warn with its status
× a refused routing matrix reaches the matrix warn with its status
Tests  2 failed | 12 passed (14)
```

Both read `expected { provider: 'valhalla', …(1) } to match object { code: 'UNREACHABLE', status: 406 }`.
Both warns fired, so the failures are the missing field and nothing else. After the fix, the same
file: `Test Files  1 passed (1)`, `Tests  14 passed (14)`.

**Finding 2: the `USER_AGENT` comment.** After this change two adapter requests still go out with
Node's default `user-agent: node`: the `sources_to_targets` `POST` in `#json` (Build step 5, unmeasured
by design) and `articlesNear`'s Wikipedia and Wikivoyage geosearch `GET`, which the ticket names
nowhere. Gate 1 also noted that the `USER_AGENT` doc comment in `valhalla.ts` still read "Sent on every
geocoder request", which is true but no longer says Overpass sends it too. The question was whether to
send the header from `#json` as well, or to correct the comment. **The owner chose the comment only.**
The header is not added to `#json`. The comment now reads "Sent on every geocoder request and on every
Overpass request", with the 406 reason.

Context, recorded and not acted on in this branch. On 2026-10-24 the orchestrator measured
fr.wikipedia.org's geosearch with three user agents, using this command:

```
curl -s -o /dev/null -w '%{http_code}' -A node 'https://fr.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=48.83%7C-64.48&gsradius=2000&format=json'
```

It gave 200 for `user-agent: node` and 200 for the planner's own agent, and 403 with no user agent.
This branch did not re-run it. So the Wikipedia `GET` is not refused by Node's default, at least on
that measurement, and the `sources_to_targets` `POST` remains unmeasured.

**The third low, not applied.** Gate 1 also noted that the seven narrowings across these files could
share one helper. The owner did not ask for it, so it stays recorded here and is not applied.

`status` stays `ready`.
