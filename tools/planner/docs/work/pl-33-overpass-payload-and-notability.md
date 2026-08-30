---
id: pl-33
tool: planner
title: Capture a real Overpass payload, and wire up notability
kind: fix
milestone: P3
status: done
depends_on: [pl-29]
---

# pl-33 — The two halves of pl-29 that could not be built here

## Why

[pl-29](./pl-29-detours-along-a-leg.md) built the discovery seam, the Overpass
adapter's query and parser, the geometric filter, the two-pass grounding state,
and the `coverage` taxonomy member — everything that does not depend on a
network this environment could reach. Two things do, and neither could be
built there, for the same reason pl-30 exists beside pl-28: this environment
has no route to `overpass-api.de`, `en.wikipedia.org` or a Wikivoyage dump, and
no runnable Overpass-compatible engine was found on npm within pl-29's
time-boxed search.

**The first is a captured payload.** `nearby`'s tests in
`api/test/grounding-valhalla.test.ts` run against a hand-composed body,
disclosed as such in that file's own header — the same shape `pl-28`'s
`locate` was in before `pl-30`. `overpassQuery` (exported from `valhalla.ts`)
already builds the exact request; what is missing is a real reply to parse.

**The second is `Find.notability`.** The type exists and is tested at the
rendering layer (`agent/test/prompt.test.ts`), but no adapter populates it:
Wikipedia's geosearch API and Wikivoyage's dumps are both unreachable from
here, so `ValhallaGroundingProvider.nearby` always returns `notability: []`.
§5's amendment names both as free, unkeyed signals worth attaching — this
ticket is what actually attaches them.

## Build

1. **Capture `nearby`'s payload.** pl-29's Log carries the exact copy-pasteable
   capture block — the query text (`overpassQuery`, unchanged, so the capture
   uses the real request) and the curl invocation. Run it against a reachable
   Overpass instance (the public one, respecting its usage policy — one
   request, an identifying purpose in a comment — or a self-hosted instance
   over a small regional extract) and check the reply in under
   `api/src/grounding/fixture-data.ts`'s sibling in this file's own package,
   `api/test/fixtures/overpass-nearby.json`. Rewrite
   `grounding-valhalla.test.ts`'s `nearby` tests to parse it, keeping the
   synthetic hostile-name and prototype-key tests exactly as they are — those
   are deliberately hand-composed and pl-29's header says why.
2. **Wikipedia geosearch.** `GET https://{lang}.wikipedia.org/w/api.php` with
   `list=geosearch`, a coordinate and a radius, unkeyed and free. Which
   language to ask is not obvious from a `Find` alone — decide it here, and
   record the decision rather than guessing silently. One call per find is
   the naive shape; consider whether a single call over the whole corridor's
   bounding box (geosearch also accepts a bounding box) is cheaper against
   `MAX_GROUNDING_CALLS`, the same argument pl-29's detour-cost matrix already
   makes for one call over many.
3. **Wikivoyage.** Its own API mirrors Wikipedia's; whether it is worth a
   second call per find or can share the first is this ticket's to decide,
   with the reasoning written down.
4. **Both attach as `Source[]` on `Find.notability`**, per the type's existing
   contract — url, title, fetchedAt, nothing fused into a score.

## Done when

- `nearby`'s core parsing tests run against a payload captured from a real
  Overpass instance, with the same disclosure pl-28's `travel` tests give
  theirs.
- A find near a place with a Wikipedia article carries a `notability` entry
  for it, proven against a captured reply.
- `npm run check` and `npm test -- --project planner` pass.

## Review

**Gate: PASS** — 2026-08-30 · `origin/main...HEAD` (reviewed at `07a62ed`, base `origin/main` at `7a12b8b`; branch cut from `ec1dd6b`) · defect hunt run by me (Sonnet 5), medium depth, no `code-review` delegate available in this seat

Confirmed I landed on the right tree: `git log --oneline -1` → `07a62ed feat(planner): a Wikivoyage entry is about the route, not about a find (pl-33)`, matching the sha given. `git diff --stat origin/main...HEAD` → 28 files, +8541/-47.

| Done when                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nearby`'s core parsing tests run against a payload captured from a real Overpass instance, with the same disclosure pl-28's `travel` tests give theirs | proven — `tools/planner/api/test/grounding-valhalla.test.ts:1093` (`describe("nearby, over a payload a real Overpass wrote"`) and `:1103` (`parses the capture into Finds…`), over `tools/planner/api/test/fixtures/overpass-nearby.json` (657 real elements, `generator: "Overpass API 0.7.62.11"`, real `osm3s` timestamp — not a hand-composed body). Disclosure header at the top of the test file matches pl-28's format. The pre-existing hand-composed `describe("nearby, over a hand-composed (not captured) Overpass reply")` block is untouched (verified: the whole-tool diff for this file shows exactly one deleted line, an import) |
| A find near a place with a Wikipedia article carries a `notability` entry for it, proven against a captured reply                                       | proven — `grounding-valhalla.test.ts:1204` (`describe("notability, from tags a real payload already carries"`) and `:1214` (`attaches the article the map names…`), asserting `Monument à Maisonneuve`'s `notability` against the same captured Overpass reply's `wikipedia=fr:…` tag. The geosearch tier (`articlesNear`) is separately proven against `wikipedia-geosearch.json` (426 real articles from `fr.wikipedia.org`) and wired end-to-end in `tools/planner/api/test/discovery-pass.test.ts:465` (`attaches an article near a find, and leaves a distant one alone`)                                                                    |
| `npm run check` and `npm test -- --project planner` pass                                                                                                | verified, numbers I got rather than the ones the Log/PR claim: `npm run check` → exit 0. `npm test -- --project planner` → **53 files, 789 tests, all passing** (Log/PR say 787). `npm test` (whole repo) → **114 files, 1736 tests, all passing** (Log says 1734; the PR body's 1736 matches what I measured). Re-ran twice, not flaky. I also confirmed by reading the diff of every touched test file that nothing existing was deleted or reworded to pass more easily — the only removed line anywhere under `tools/planner/api/test/` is one import statement                                                                               |

- **low** · The ticket's Log and the PR description undercount the test suite by 2 (787/1734 claimed vs. 789/1736 measured on this tip, `npm test -- --project planner` run twice). Doesn't affect the gate — both commands genuinely pass — but the recorded numbers should be corrected so a future reader diffing counts isn't chasing a phantom 2.
- **low** · `docs/02-DEPLOYMENT.md` has a full walkthrough and an env-var table for `VALHALLA_URL`/`GEOCODER_URL` (Valhalla + Nominatim), but nothing for the new `overpass` service, `OVERPASS_URL`, or `GROUNDING_DISCOVERY_TIMEOUT_MS` — even though `compose.planner.yaml:116/149/186` all point a reader at that same doc for `OSM_EXTRACT_URL`. A deployer following the doc as written would never learn discovery can be turned on.
- **low** · `ValhallaGroundingProvider#articlesNear` (`tools/planner/api/src/grounding/valhalla.ts:357`) calls the shared `#json` helper, which bounds the request with `this.#timeoutMs` (the 5 s routing/geocoding ceiling) — not `this.#discoveryTimeoutMs` (30 s), which `#overpassJson` was given its own path to use two paragraphs above. Everywhere else in this same diff the file is deliberate about Overpass and Wikipedia being different backends needing different clocks; this one wasn't discussed either way. Likely harmless — `notability()`/`corridorReading()` catch a per-tile failure and continue rather than failing the run — but it's an inconsistency worth a one-line note (either "Wikipedia's geosearch is fast enough that 5 s is fine" or give it `discoveryTimeoutMs` too), not something I can resolve without a latency measurement neither of us has.
- **low** · `notability()` and `corridorReading()` (`tools/planner/api/src/runs/discovery.ts:270-271`) now spend budget calls ahead of `detourCosts()` on line 272, where before this ticket `detourCosts` was the only consumer after `nearby`. Up to 8 calls (6 tiles + 2 corridor ends) can now be spent before `detourCosts` gets a turn. Nothing here is proven wrong — the shared budget/refusal machinery is pre-existing and already tested generically — but no test pins what happens to detour costing on a corridor where the budget is tight enough for this reordering to matter, and the Log doesn't discuss the ordering as a decision. Worth a look, not a blocker.
- **dropped** · none — this is the full list from my own pass; nothing was found and discarded.
- **findings** · 4 low, 0 med, 0 high. All four are documentation/consistency notes; none contradicts an acceptance line or an invariant.
- Repo invariants checked and clean: no cross-tool import; `@planner/contract` was edited but the Log shows it surfaced as options with costs first (per root CLAUDE.md's decisions rule) rather than done unilaterally; errors use `AppError` with existing codes (`TIMEOUT`, `UNREACHABLE`, `INVALID_URL`, `CANCELED`) and the `remark`-based code choice is not re-worded at the raise site; no shell spawned; the one URL this ticket builds from untrusted input (`WIKI_LANGUAGE` → hostname) is allow-shape validated with a dedicated adversarial test (`evil.example.com`, `fr/../en`, `a@b`, `fr:8080`) before any fetch; migration 8 is additive with `DEFAULT '[]'` and both the up- and down-migration paths are tested; no new workspace dependency, so the `Dockerfile`/image-closure scan is unaffected (confirmed no Dockerfile diff); style (no `any`, no `console`, `import type`, `node:` builtins) holds throughout the diff I read.
- NFR: security ✓ (SSRF surface is closed off before a URL exists, tested adversarially) · performance ✓ (extensively measured — 2 s/`around:` clause, 149 s worst-case corridor — and acted on) · reliability ✓ (a backend that gives up now fails loud via `assertAnswered`/`TIMEOUT` instead of silently returning an empty corridor; per-tile notability failures degrade gracefully) · maintainability — see the two `low` doc/ordering notes above.

## Log

**2026-08-30 — this Build cannot be started from this environment.** Measured
from a devcontainer session on the `repo-11` branch, which was already editing
planner ticket logs. Nothing here is a finding about the ticket: the Build is
sound and unchanged. It is a finding about where the Build can be run, written
down so the next agent does not spend the same five commands rediscovering it.

Every one of the four Build steps needs one of three hosts. All three are
unreachable, and two control probes show the failure is not general:

| probe                                 | result                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| `https://overpass-api.de/api/status`  | `000`, curl exit 28, `time_connect=0.000000`, 8 s ceiling hit |
| `https://en.wikipedia.org/w/api.php`  | `000`, curl exit 28                                           |
| `https://en.wikivoyage.org/w/api.php` | `000`, curl exit 28                                           |
| `https://api.github.com`              | **`200`**, `time_connect=0.027844`                            |
| `https://registry.npmjs.org`          | **`200`**                                                     |

**The shape is an allowlist — not an outage, and not something misconfigured
locally.** That conclusion is the part worth carrying forward; the individual
failures are a moment in time and will need re-running.

- **DNS resolves.** `overpass-api.de` → `65.109.112.52` / `162.55.144.139`;
  `en.wikipedia.org` and `en.wikivoyage.org` → `208.80.154.224`. Nothing is
  failing to look up.
- **Egress works.** Two hosts answer in tens of milliseconds.
- **No proxy is configured.** No `*_proxy` variables in the environment, and
  `npm config get proxy` and `https-proxy` are both `null`. There is nothing
  local to fix.
- **The blocked hosts are dropped, not refused.** `time_connect` is `0.000000`
  on every one: the TCP connection never completes and the call hangs to the
  timeout. A refusal would return at once with curl exit 7.
- **`https://example.com` fails identically** — `000`, exit 28,
  `time_connect=0.000000`. This is the probe that settles the shape. If only the
  three hosts this ticket needs were dark, that would point at something aimed
  at them, or at three simultaneous outages. A neutral host failing the same way
  means the default is deny and a small set of hosts is permitted.

Both alternatives the Build itself offers are closed, so this is not a matter of
finding another route to the same data:

- Step 1's "a self-hosted instance over a small regional extract" —
  `https://download.geofabrik.de/` → `000`, exit 28. There is no extract to
  import.
- Step 3's Wikivoyage dumps — `https://dumps.wikimedia.org/` → `000`, exit 28.

One door is open and is deliberately _not_ claimed as a way through:
`registry.npmjs.org` answers, so an npm package shipping a recorded Overpass
reply could be fetched. [pl-28](./pl-28-valhalla-adapter.md) searched that avenue
for a Nominatim payload and rejected what it found on provenance grounds —
laundering someone else's hand-written payload through their tarball fails the
fixture standard rather than meeting it — and this ticket's "Done when" points
back at pl-28's disclosure for its own capture, so the same objection applies.
Named as unexplored, not as an option.

**`status` stays `ready`, on purpose.** `ready` means dependencies unblocked, and
an environment limit is not a dependency. Putting one session's network into
frontmatter that every tool reads would make a local fact look like a property of
the ticket, and `npm run status` would then be wrong for whoever _can_ reach
these hosts. The board is right; it simply cannot tell you where to stand, and
this is the place that can.

What this does **not** establish, and nobody should infer it from the above:
whether the allowlist is per-session, per-image or per-organisation, and whether
it can be widened by asking. No one was asked. If you are reading this somewhere
with a route to `overpass-api.de`, disregard all of it and run the capture block
in [pl-29](./pl-29-detours-along-a-leg.md)'s Log, which is still copy-pasteable.

---

**2026-08-30 (later the same day) — the entry above is superseded, and the
hosts are reachable now.** It is kept, not deleted: it was a true measurement
when taken, and the correction belongs where the claim is. What changed is the
environment, not the ticket. `.devcontainer/allowed-domains.txt` gained
`overpass-api.de`, `en.wikipedia.org`, `en.wikivoyage.org` and
`nominatim.openstreetmap.org` (PR #116), and the container was rebuilt — which
is the part that applies an allowlist edit, since `init-firewall.sh` reads a
root-owned copy baked into the image and re-running it never picks up a repo
change.

The entry's own closing sentence answered itself: it named "whether the
allowlist can be widened by asking" as unestablished because nobody had asked.
Somebody asked.

### The capture, written out rather than cited

pl-29's Log gives the block, and its `/tmp/overpass-query.txt` is the shape to
avoid: a Log that cites a scratchpad path is a promise only the session that
wrote it can keep. The procedure, whole:

```bash
# 1. Build the query from the shipped adapter, never a re-typed copy.
npm run build
node --input-type=module -e "
import { overpassQuery } from './tools/planner/api/dist/grounding/valhalla.js';
process.stdout.write(overpassQuery(
  [{ latitude: 45.5019, longitude: -73.5674 },   // Montréal
   { latitude: 46.8139, longitude: -71.208 }],   // Québec City
  6000,                                          // DISCOVERY_RADIUS_METRES
  ['viewpoint', 'waterfall', 'attraction', 'historic-site'],
  180,                                           // server ceiling; see below
));" > query.txt

# 2. POST it as the adapter does: raw body, text/plain, /interpreter.
curl -sS -X POST -H 'content-type: text/plain' \
  -H 'user-agent: webtools-planner/1.0 (fixture capture for pl-33)' \
  --data-binary @query.txt --max-time 240 \
  https://overpass-api.de/api/interpreter \
  -o tools/planner/api/test/fixtures/overpass-nearby.json

# 3. Check for a `remark` BEFORE checking it in. This is the whole lesson.
node -e "const r=require('./tools/planner/api/test/fixtures/overpass-nearby.json');
console.log(r.elements.length,'elements | remark:', r.remark ?? 'none');"
```

Step 3 exists because step 2 succeeded and produced nothing, twice over: HTTP
200, `elements: []`, and a `remark` saying the query timed out. That reply is
checked in as `overpass-timed-out.json` and is the regression test.

### What the capture found, which the Build did not know about

Three defects, none of them about notability, all of them in code pl-29 shipped
through its gates:

|     | defect                                                             | measured                                                                        |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | `groundingTimeoutMs: 5_000` bounded **both** routing and discovery | Overpass needs 28.7 s for Montréal→Québec City and **149 s** for Montréal→Percé |
| 2   | `[timeout:25]` hardcoded in `overpassQuery`                        | below the same numbers                                                          |
| 3   | `elementsOf` read `elements` and ignored `remark`                  | a timed-out reply parsed as a corridor with nothing on it                       |

Defect 3 is the serious one and the ordering matters: today's 5 s abort makes
the failure **loud**. Fixing the timeouts alone would have traded a loud
failure for a silent wrong answer — the planner reporting "nothing worth
stopping for" on a corridor with 657 nodes on it. `assertAnswered` therefore
landed in the same commit as the timeout change, not after it.

**pl-29 shipped `nearby` through two gates and nothing ever ran it against an
Overpass instance, because nothing could.** The gates verified the calling code
faithfully and the machinery underneath had never once done its work. The
lesson generalises past this ticket: a ticket resting on an external service
needs one gate that confirms the service answers, not only that the code
calling it is correct.

### Measurements behind the decisions

Query cost, public instance, `out count`, the adapter's real query shape:

| query                                          | nodes | time                |
| ---------------------------------------------- | ----- | ------------------- |
| four kinds, Montréal→Québec City               | 657   | 28.7 s              |
| the same minus unvalued `node["historic"]`     | 200   | 6.3 s               |
| `historic` narrowed to 9 explicit values       | 424   | 24.0 s              |
| every clause additionally requiring `["name"]` | 276   | **55.5 s** — slower |
| four kinds, Montréal→Percé                     | 492   | **149 s**           |

Cost is roughly **~2 s per `around:` clause** over a long corridor, not tag
selectivity — which is why narrowing buys 16% and costs a product decision, and
why it was not done. Requiring `["name"]` server-side is _slower_ despite
returning fewer rows: it forces a scan rather than using the tag index.

Of the 657 elements, 276 survive `findFrom`'s name filter. **All 163 `cannon`
nodes are unnamed** — they cost ~22 s of the 29 and produce zero `Find`s.

Notability sources, `geosearch`, 10 km around Québec City:

|            | en  | fr      |
| ---------- | --- | ------- |
| wikipedia  | 189 | **426** |
| wikivoyage | 2   | 7       |

### Decisions this ticket was asked to make

**Language: taken from the find's own `wikipedia` tag.** A tag is written
`fr:Title` — the language is in the data, chosen by the mapper who knows the
place, so nothing guesses. 16 of the 18 wikipedia tags in the capture are `fr:`,
which is the same answer the geosearch counts give and reached independently.
`Cénotaphe` in Montréal is tagged `es:`, so any scheme keyed on _where a find
sits_ would have linked to nothing. For the geosearch tier still owed, the
language comes from counting the corridor's own tags rather than from a country
mapping: `Place` carries no country, so country-derivation would need a type
change across the `@planner/agent` seam plus an unmeasured table, and the
corridor's own data already states the answer.

**Wikivoyage: not a per-find call.** 2 to 7 articles for an entire city is
city-level coverage, and a `Find` is a POI. A per-find call would almost always
return nothing while spending budget against `MAX_GROUNDING_CALLS`.

**A single call over the corridor's bounding box — the Build's own suggestion —
is not available.** `geosearch` rejects a corridor-sized `gsbbox` outright with
`toobig`; a ~5 km box is fine. So the choice is not "one call versus many", it
is "many calls versus a different mechanism".

### What is done, and what is not

Done: Build step 1 in full, and step 4 for what the map already states —
`notability` carries `wikipedia`, `wikipedia:<lang>` and `wikidata` tags at no
call cost, covering **34 of 276 finds (12%)**. That is a floor, not the
geosearch tier. `compose.planner.yaml` gains an `overpass` service on the same
regional extract the other two import, because the 149 s measurement means the
public instance cannot serve this feature and no client-side number fixes that.

Not done, and the reason is a design constraint rather than a difficulty:
`nearby`'s own doc comment says it "must stay one call regardless of how many
finds it returns", and a geosearch tier spends N calls. It therefore belongs in
`runs/discovery.ts` as a budgeted pass beside `detourCosts`, which means a new
method on the grounding provider seam rather than more work inside `nearby` —
a change to `@planner/agent`'s interface that should be decided, not assumed.

### Build steps 2 and 3, and the contract change they needed

**Step 2 landed as a budgeted pass, not as more work inside `nearby`.**
`articlesNear` on the grounding seam is one geosearch: one point, one call.
Two measurements forced that shape rather than a corridor-wide method — the
API refuses a corridor-sized `gsbbox` outright, and the run budget is
denominated in calls, so a seam method that quietly made six would stop
`MAX_GROUNDING_CALLS` describing what a run spends. The tiling therefore sits
in `runs/discovery.ts` beside `detourCosts`, bounded at `MAX_NOTABILITY_TILES`
(6, against a budget of 40 that `locate` and `travel` also come out of), and
stops at the first refusal instead of grinding through tiles it has been told
it cannot afford.

The language is counted from the corridor's own `wikipedia` tags. Not
configured, and **not** derived from a country: `Place` carries none, so that
route needed a type change across the `@planner/agent` seam plus a mapping
table with no measurement behind it, while the finds already state the answer.

`WIKI_LANGUAGE` is an allow-shape rather than a sanitiser, because the language
comes from OSM tag text and reaches a _hostname_. `evil.example.com` as a
language is refused before a url exists, and there is a test for it.

**Step 3 needed somewhere to put a corridor-level answer, and that was a
contract change.** `Find.notability` is per-find and Wikivoyage is not: 2
English and 7 French articles for an entire city, every one of them about the
city. Attaching one to a viewpoint inside it asserts a relationship the source
does not have — the fusion §5's amendment exists to refuse.

So `PlanRevision.reading: Source[]`, with migration 8 and
`MAX_REVISION_READING`. Stored rather than derived, for `coverage`'s reason
exactly: it is what a live backend answered once at compose time. It is
deliberately _not_ appended to `unchecked` the way `coverage` is — that list is
what could not be checked, and this is something found and worth reading.

**This was surfaced as options and chosen, not decided here.** The contract
edit, the seam addition and the geosearch tiering were each put as a question
with costs attached; the record of what was picked and what it cost is this
Log. `CLAUDE.md` forbids editing a contract unilaterally, and the sibling cost
showed up exactly where it says it would — four test builders across
`contract`, `itinerary`, `api` and `web` needed the new field, and nothing else
did.

### Gates

```
$ npm run check                  # exit 0
$ npm test                       # 114 files, 1737 tests, all passing
$ npm test -- --project planner  # 790 passing
```

Baseline for the planner project on this branch's `origin/main` (`ec1dd6b`) was
**774**. What this branch adds is 16 tests over two captured payloads and the
two passes that read them.

**These numbers were wrong here until the gate caught it** — recorded as
1 734 and 787, which is what they were before the last two tests were written,
and committed without re-running. The gate's reviewer re-ran both suites twice
rather than reading this block back, which is the only reason it was caught. Its
own figures (1 736 / 789) were right when it measured them and are one behind
now, because closing its fourth finding added a test. Measured again on the tip
that carries the repairs, which is the discipline the finding was actually
about: **re-run, do not remember.**

### The gate's four findings, all closed

The gate is above, and every row of it stands as written. All four `low`
findings were real and none was argued with.

1. **The counts in this Log were stale.** Corrected, and the block above now
   says how it happened. Worth more than its severity: the reviewer caught it
   only because it re-ran both suites instead of reading the numbers back, which
   is exactly what the `verified` verdict exists to force.
2. **`docs/02-DEPLOYMENT.md` never mentioned the new service.** It documented
   Valhalla and Nominatim and said "it is two services", while
   `compose.planner.yaml` pointed readers at it three times. A deployer
   following it would never have learned discovery could be turned on. It now
   names the third service, `OVERPASS_URL` as the one optional endpoint,
   `GROUNDING_DISCOVERY_TIMEOUT_MS`, and the 149 s measurement that says not to
   point it at the public instance.
3. **`articlesNear` used the 5 s clock, not the 30 s discovery one.** The gate
   was right that this file argues at length for two clocks and then never said
   which one Wikipedia belonged on. Measured rather than reasoned about: five
   geosearch calls along this corridor returned in **0.195–0.273 s**, so 5 s is
   ~25x headroom and anything near it is an instance in trouble — the same
   argument `groundingTimeoutMs` already makes for a routing matrix. Kept, with
   the measurement recorded at the call site so the next reader does not have to
   re-derive it.
4. **Nothing pinned what the new ordering costs.** `notability` and
   `corridorReading` now spend up to 8 calls ahead of `detourCosts`, so on a
   tight budget detour costing is what loses. That is the right way round — a
   find with no detour still says `detourMinutes: null`, while a find nobody
   asked about is indistinguishable from one nobody wrote about — and there is
   now a test for it rather than an assumption.

### What a reviewer should look at hardest

Not the parsing — that is proven against real payloads now. The two places
where judgement is load-bearing:

1. **`NOTABILITY_MATCH_METRES = 250`.** It decides whether an article is _about_
   a find. Measured against nothing: it is a guess at how far OSM's node and
   Wikipedia's coordinate can disagree while still meaning the same thing. It
   is the same class of unmeasured constant pl-34 found in the geocoder, and it
   should be treated with the same suspicion.
2. **`MAX_NOTABILITY_TILES = 6`.** Chosen against a budget of 40, not measured
   against corridor lengths. A 950 km corridor gets six 10 km circles and is
   therefore covered in patches; nothing yet says whether that is a sensible
   fraction or a token gesture.
