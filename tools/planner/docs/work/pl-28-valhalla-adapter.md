---
id: pl-28
tool: planner
title: A real routing backend behind the seam, self-hosted
kind: work-package
milestone: P3
status: ready
depends_on: [pl-24, pl-25]
---

# pl-28 — Valhalla behind the seam

**Packages:** `api` (the adapter, the config), plus `docs/02-DEPLOYMENT.md` and
the compose file.

## Why

A fixture provider proves the seam. It does not prove the tool: every distance
in it was written by hand, and a plan built on it is still a claim about
machinery. P3's milestone is _the plan is true_, and this is the ticket that
makes any of it true.

**The backend is Valhalla, self-hosted, decided 2026-08-22.** The record of the
argument, because a cheaper-looking answer will be proposed again:

- **The target is a mini-PC** (Intel N-150, four E-cores, officially capped at
  16 GB DDR5), which is the whole constraint. Valhalla's graph is tiled and
  mmap'd, so resident memory tracks the tiles actually touched rather than the
  size of the extract, and a Québec-or-larger region is untroubled on that
  ceiling. OSRM was the alternative and is fine at runtime — its pinch is
  contraction, which wants several times the `.pbf` in RAM and would mean
  building the graph on another machine and copying artifacts over. A pipeline
  with a second machine in it is a pipeline nobody re-runs.
- **No per-call bill and no metered terms.** Google's Routes API is the most
  accurate option and its terms restrict retaining route data, which collides
  head-on with §5's cache: a distance is good for a year and
  [pl-25](./pl-25-grounding-cache.md) stores it for one. Choosing a metered
  vendor would mean re-deciding the TTL policy, so the cache design is itself an
  argument for self-hosting.
- **Load is trivial and is not the criterion.** `MAX_GROUNDING_CALLS` is 40 per
  run over matrices of a few dozen places, behind a cache. Neither engine would
  notice. The choice is an ops choice, and it was made on ops.

## Read first: this is two services, not one

**Valhalla does not geocode.** It routes. `locate` — a place name in,
coordinates out — is a geocoder's job, and pl-24's seam has both methods, so a
"Valhalla provider" that implements only `travel` leaves half the seam
unimplemented and pl-27's pass with nothing to fill `Place.coordinates` from.

Settle this before writing the adapter. The options, with the recommendation
first:

1. **Nominatim on the same regional extract**, alongside Valhalla. Same data,
   same box, one more container, and the volume behind pl-25's cache is nothing.
2. **The public Nominatim**, whose usage policy is roughly one request a second
   with a real `User-Agent` and caching expected — which the cache already
   satisfies. Cheaper to stand up, and it makes the tool depend on somebody
   else's free service.
3. **Photon or Pelias.** Better at fuzzy names, heavier to run.

Whichever it is, it is a **second implementation behind the same seam**, not a
second seam, and `createGroundingProvider` stays the only file naming either.

## Build

1. **`api/src/grounding/valhalla.ts`** — `travel` over `/sources_to_targets`,
   which answers the whole matrix in one request and is why pl-24's seam is
   matrix-shaped. `locate` over whichever geocoder the section above picks.
2. **Config** — `GROUNDING_PROVIDER=valhalla`, plus the endpoint URLs. Endpoints
   are operator configuration with no default: a routing URL that quietly
   defaults to somebody's public instance is a surprise bill or a surprise
   outage, and there is no sensible localhost guess either.
3. **Fixtures from real payloads.** Capture actual `/sources_to_targets` and
   geocoder responses against the running instance, check them in under
   `api/test/fixtures/`, and parse them offline. The repo rule is not
   negotiable here and the reason is sharper than usual: a hand-written fixture
   for a routing engine is a fixture that agrees with your parser by
   construction.
4. **Index anything keyed by a model-produced string with a `Map`, and hand
   back copies, not internals.** Both are pl-24 review findings and both are
   about a lookup table, which this adapter will have more of than the fixture
   did — a place-id cache, a response index, whatever `/sources_to_targets` gets
   keyed by. A plain object answers for `constructor`, `__proto__` and
   `toString`; and `Object.freeze` is shallow, so returning a table's own entry
   lets a caller that adjusts coordinates in place corrupt it for the rest of
   the process. pl-24's log has the worked example of each.
5. **Failure maps to core codes, and never to a thrown run.** Unreachable is
   `UNREACHABLE`, a slow instance is `TIMEOUT`, both from `@webtools/core`, both
   already retryable there. An unroutable pair — an island, a seasonal road
   closed in the direction asked — is a **`null` cell, not an error**: the
   backend answered, and the answer is that there is no route. pl-27 step 4 is
   what happens next, and it is a plan with a named gap rather than a failure.
6. **A timeout on every request**, and it is short. A run holds a queue slot
   while it grounds, `MAX_CONCURRENT_RUNS` is 2, and an instance rebuilding its
   tiles will hang rather than refuse.
7. **This endpoint does not go through the SSRF guard**, and
   [pl-26](./pl-26-lift-the-ssrf-guard.md) explains why at length: it is an
   address this deployment wrote down, not one a stranger handed us. Do not
   reach for `allowPrivateAddresses` to make a guarded fetch work against a LAN
   address — that switch disables the check for everything.
8. **Ops, written down where an operator will find it** — `docs/02-DEPLOYMENT.md`
   and `compose.prod.yaml`: which extract, how tiles are built and how long it
   takes, roughly what the tiles cost on disk, and what re-running the build for
   fresher OSM data involves. This is the half of a self-hosted decision that
   gets skipped and then has to be rediscovered a year later by whoever notices
   the roads are out of date.
9. **`/api/health` names the provider and never the endpoint.** pl-24 step 7
   already says so; it matters more here, because now there is something behind
   it worth not advertising.

## Done when

- The adapter parses checked-in real payloads into the seam's types, offline,
  with no network call in any test.
- An unroutable pair yields a `null` cell; an unreachable instance yields
  `UNREACHABLE`; a slow one yields `TIMEOUT`. Three tests, none of them touching
  a socket.
- `GROUNDING_PROVIDER=valhalla` with no endpoint configured fails at boot with a
  clear message rather than starting and failing on the first run.
- `/api/health` reports the provider name and no endpoint — asserted on the
  response body, not by reading the code.
- A logged config object contains no endpoint credentials, asserted the way
  `logging.test.ts` already does for the downloader.
- The deployment document tells someone who has never seen Valhalla how to get
  from a `.osm.pbf` to a running instance, and pl-2's compose service names it.
- `npm run check` and `npm test -- --project planner` pass. The image gate in
  `.github/workflows/planner.yml` is what proves the container still boots, and
  it does not run locally — say so rather than reporting green.

## Review

### Gate 1 — 2026-08-23

**Gate: CONCERNS** — landable as a partial, with the Log corrected first ·
`origin/main...e60f5a6` · `review-ticket`, delegating its defect hunt to
`code-review`. Transcribed by the builder, in the branch under review; the
verdict is recorded as it was given and is **not** rewritten to
"CONCERNS, addressed" because a gate that edits itself once the work is done
records nothing. The round that answers it is below, and the findings carry
their dispositions.

Scope of the reviewed commit: 14 files, +1902 / −8. The tip that carries this
section is the **same 14 files** — the insertion count has moved twice since,
because each gate's record is itself part of the diff it describes, so the file
list is the half worth quoting and the number is not.

| Done when                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The adapter parses checked-in **real** payloads into the seam's types, offline, no network       | **unproven**, and deliberately recorded as the weaker of its two halves. `travel` is proven: `grounding-valhalla.test.ts:105`, `:147`, `:166`, `:180` over `fixtures/valhalla-sources-to-targets.json`. `locate` has **no payload at all** — its parser can be replaced with `return null;` and the suite stays green. A row reading `proven` for a line half of which nothing asserts is the failure this table exists to prevent. → [pl-30](./pl-30-geocoder-payload.md) |
| An unroutable pair is a `null` cell; unreachable is `UNREACHABLE`; slow is `TIMEOUT`. No sockets | **proven** · `grounding-valhalla.test.ts:147` (four `null` cells off the captured payload, and the self-pair still a real zero), `:239` (`UNREACHABLE`, retryable), `:262` (`TIMEOUT`, `details.timeoutMs`). Every one drives an injected `fetch`; nothing in the file opens a socket                                                                                                                                                                                      |
| `GROUNDING_PROVIDER=valhalla` with no endpoint fails at boot with a clear message                | **proven** · `health.test.ts:85` (missing) and `:102` (present but not a URL). The reviewer read the actual message rather than the matcher                                                                                                                                                                                                                                                                                                                                |
| `/api/health` reports the provider name and **no** endpoint, asserted on the response body       | **proven** · `health.test.ts:57`. Asserted on the body, as the line requires, and the reviewer additionally grepped the whole payload for every substring of both endpoints — `valhalla.internal`, `nominatim.internal`, `8002`, `8080`, `http` — all absent                                                                                                                                                                                                               |
| A logged config object contains no endpoint credentials, in `logging.test.ts`'s shape            | **proven** · `logging.test.ts:53`, with `:82` holding the fixture default to the same line so it is not a special case. It asserts over **every** boot line rather than the one that was tempted, and the geocoder URL carries a credential in its userinfo — so it covers the credential case and not only the hostname                                                                                                                                                   |
| The deployment document gets an operator from a `.osm.pbf` to a running instance                 | **verified** — prose, re-read rather than executed. `docs/02-DEPLOYMENT.md` §"Grounding the planner", four steps, and `compose.planner.yaml` beside it                                                                                                                                                                                                                                                                                                                     |
| …**and pl-2's compose service names it**                                                         | **unproven**, and unprovable as written: that service does not exist. pl-2 steps 5–6 have been open since 2026-08-14. `compose.planner.yaml` carries the three settings it will need, so pl-2 is a paste — see the Log                                                                                                                                                                                                                                                     |
| `npm run check` and `npm test -- --project planner` pass                                         | **verified** — re-run by the reviewer, which also measured the `origin/main` baseline itself at **669 / 47 files**, agreeing with the Log                                                                                                                                                                                                                                                                                                                                  |
| The image gate does not run locally — say so rather than reporting green                         | **verified** — said, in the Log's Gates block and again in `compose.planner.yaml`. It has not run                                                                                                                                                                                                                                                                                                                                                                          |

**What the gate verified that the builder could not have.** It did not take the
fixture-provenance claim on trust: it ran `npm pack @valhallajs/valhallajs@3.7.0`
itself, confirmed the package ships `valhalla_build_config` and
`valhalla_build_tiles`, wrote its **own** `.osm.pbf`, built its own tiles, took
a matrix through `actor.matrix()`, and structurally diffed its capture against
the checked-in one. **Top-key diff: none. Cell-shape diff: none.** Both carry
exactly the two cell shapes and the four `time: null, distance: null` cells
agree. It also expected `sources`/`targets` to be nested arrays and found them
flat — checking beat remembering, which is the whole argument of step 3.

**The one thing it could not reproduce, said plainly rather than left implied:**
its `.osm.pbf` used four loop nodes, no spur and plain `Node` messages; this
branch's used five with a spur and `DenseNodes`. The replies are structurally
identical, so it does not matter — but this was **not** a byte-for-byte
reproduction and the record should not read as though it were.

**Step 4 passes, and the builder's report was silent on it.** Both tables are
`Map`s — `valhalla.ts:398` and `:354`, and there is no third. `__proto__`,
`constructor`, `toString` and `prototype` as place names all travel as ordinary
query strings and come back as ordinary answers. `from_index: "constructor"` is
rejected by `indexOf` at `valhalla.ts:430`. The shallow-freeze property was
proved by mutating a nested field of a returned cell in place and re-asking:
the second answer was identical.

#### Findings

- **F1 · fixed** — the Log claimed "twelve mutations, twelve red" and named the
  `#reachFailure` ordering among them. The gate performed that exact two-line
  swap and ran the whole planner project: **693/693, exit 0.** The mutation
  survives.

  Chasing it found something larger, and it is recorded in the Log rather than
  here because it is a fact about the work: **all twelve were worthless.** The
  harness passed `--reporter=basic`, which does not exist in vitest 4, fails to
  load, and exits 1 on a clean unmutated tree — so every mutation "died"
  regardless. The second harness opens with a control run over the unmutated
  tree and prints its result; sixteen mutations, sixteen killed, control green.
  The ordering is now asserted at `grounding-valhalla.test.ts:309`, the code
  comment that reasoned about it wrongly is corrected, and the Log says what
  happened.

- **F2 · fixed** — "asserted by nothing" understated the geocoder gap. What is
  true is that the whole of `firstCoordinates` (`valhalla.ts:476`) can be
  replaced with `return null;` and the planner suite stays green — reproduced by
  the builder at 698/698 — with none of its seven branches pinned. The Log now
  says that, and adds the production reachability the gate asked for:
  `runs/travel.ts:295` calls `locate` on every run, so the first plan a
  `valhalla` deployment builds executes unasserted parsing code, and the failure
  it hides is a healthy service reporting `{"grounding":{"provider":"valhalla"}}`
  while every plan carries a `travel-time` unchecked constraint — an answer
  shaped exactly like an honest one. The same paragraph is in pl-30, which is
  where someone picking the gap up will look.

- **F3 · no change, deliberately** — the capture is not reproducible from this
  repo: neither `@valhallajs/valhallajs` nor `protobufjs` is in any manifest and
  no capture script is checked in. Left alone on the gate's own recommendation.
  pl-30 step 1 points at `mediagis/nominatim` under Docker, which is the better
  route for the half that is still missing, and adding a dev dependency plus a
  script to reproduce a capture that has already been made — and independently
  verified above — buys less than it costs.

- **F4 · fixed** — `compose.planner.yaml` sets `name: webtools`;
  `compose.yaml` on `main` sets none and takes the directory basename, so
  merging the two lands in a **different compose project** and the downloader's
  `storage` volume and job database are orphaned. Latent, because nothing
  instructs that merge today, and real, because adr/004 expected `name:` to
  arrive with the repo-wide rename and this fragment landed ahead of it. The
  fragment's "not here yet" block now says so and tells the `repo-` ticket to
  give `compose.yaml` the same `name:` in the same change.

- **F5 · fixed** — the gate's own sweep enumerated **52 decision points, applied
  55 mutations, killed 34, survived 21.** Most survivors are benign or
  equivalent; four were not, and all four now have a test that was watched to
  fail before it was believed:

  | Survivor                                                            | Now killed by                    |
  | ------------------------------------------------------------------- | -------------------------------- |
  | `valhalla.ts:430` — `indexOf`'s validation, **type check included** | `grounding-valhalla.test.ts:450` |
  | `valhalla.ts:450` — `estimate`'s half-a-cell guard (`\|\|`→`&&`)    | `grounding-valhalla.test.ts:478` |
  | `valhalla.ts:451` — the negative time/distance guard                | `grounding-valhalla.test.ts:491` |
  | `valhalla.ts:165` — the Nominatim `User-Agent` header               | `grounding-valhalla.test.ts:363` |

  **Row one is narrower than it looks, and gate 2 caught the overstatement.**
  What `:450` kills is dropping `indexOf`'s validation _entirely_, the
  `typeof value === "number"` check included. Removing only the
  `Number.isInteger(value) && value >= 0` half **survives** — gate 2 applied
  exactly that and got 698/698 — and that half is plausibly an equivalent
  mutant: `from` and `to` reach the lookup as loop counters over the caller's
  own arrays, so a fractional or negative index can only produce a key nothing
  ever looks up. It is left unkilled deliberately rather than chased with a test
  that would assert nothing.

  `:467` is therefore **documentation of intent, not a killer**. It resolves
  `null` with or without the integer guard, and it is kept because "an index
  that is not a whole number is no index at all" is a sentence the next person
  to touch `indexOf` should find written down.

  The first is still the sharpest and gate 1 was right to rank it so: it is the
  defence a twenty-line comment in that file argues for at length, and nothing
  in the suite noticed its removal. The test that pins it is the collision case
  rather than the prototype one — `from_index: "0"` and `from_index: 0` are one
  key the moment nothing checks the type, and the later write wins, so an
  unvalidated cell silently replaces a measured leg.

- **F6 · no change, deliberately** — `.oxfmtrc.json`'s `test/fixtures/` entry is
  root-anchored and exempts nothing, so every checked-in fixture in the repo is
  being formatted despite an entry that says otherwise. Recorded in the Log when
  it was found and left alone: widening it is a repo-wide toolchain change that
  touches both tools and wants a `repo-` ticket, not a line in a planner branch.

**`status` stays `ready`.** The gate agrees with the builder that this is a
partial: step 3's geocoder half is not done, two acceptance rows above are
`unproven`, and a review neither moves `status` nor decides whether the work
stops.

### Gate 2 — 2026-08-23

**Gate: PASS** · `bd3bdbc` · `review-ticket`, narrowly scoped to the gate-1
round: are the five new tests genuinely live, and are the Log's corrections
accurate. One subsection per gate, so this sits **below** gate 1 rather than
replacing it — a ticket through several rounds keeps both, and gate 1's
CONCERNS is part of this ticket's record whatever gate 2 found.

**5 of 5 new tests are live.** Each was reproduced independently — mutation
applied, rebuilt, run **red**, reverted, run **green** — and in every case the
failure _output_ was read rather than the exit code trusted. That distinction is
the whole reason this gate exists: reading an exit code is exactly what produced
the twelve reds that were not there. `grounding-valhalla.test.ts:450` was shown
to fail with the hostile `"0"`-indexed cell displacing the measured 3.339 km leg
and reporting `distanceMeters: 99999000, durationMinutes: 0`.

**The harness root cause was confirmed at the source**, not inferred from the
Log: on the clean tip, `--reporter=basic` against vitest **4.1.10** gives
`Startup Error: Failed to load custom Reporter from basic` and exit 1 — the
process dies before a single test runs. And the replacement control is real:
`npm test -- --project planner` on a clean tree exits 0 at 698 in 49 files.

**Five of the sixteen sweep rows were reproduced independently**, chosen to
include row 5, the pure reorder that gate 1 found green and that this branch
then made die.

**The `indexOf` reasoning was adjudicated, and the builder was upheld.** Gate 1
described that guard as stopping a prototype hit through an array subscript, and
the orchestrator passed that framing down as an instruction; the builder pushed
back, saying the container closes that route and the guard's real work is key
collision. Gate 2 traced `from_index` to `cells.set(cellKey(from, to), cell)` at
`valhalla.ts:398`, confirmed `cells` is a `Map` — never an array subscript,
never a plain-object key — and that `cellKey` joins with `KEY_SEPARATOR`, so
`"0"` and `0` produce the same string key and the later `Map.set` wins. **The
builder was right and gate 1's framing was wrong.** Recorded because a
correction that only travelled through a conversation is a correction the next
reader cannot find.

**F2 was verified independently**: replacing the body of `firstCoordinates`
(`valhalla.ts:476`) with `return null;` still leaves 698 in 49 green. The Log's
strongest claim about its own weakest code holds.

**12 of 12 spot-checked citations resolved.** Two line numbers relayed during
gate 1 — `:388` and `:346` for the two `Map`s — were already stale when they
were sent; `valhalla.ts:398` and `:354` are correct, and are what the record
now carries.

#### What gate 2 did not do

Stated so that the PASS is not read as wider than it is. It did **not** re-derive
the fixture — no second independent capture, no rebuilt tiles — and did not
re-run the 52-branch enumeration or sweep rows 1–4 and 6–12. Those rest on gate
1's own capture and on a control that now demonstrably works, which is a
different thing from being re-proved here. Docker is still absent, so the image
gate, `compose.planner.yaml` and both third-party image tags remain
**unverified by anything**, exactly as the Log says.

#### Findings

- **F-a · med · fixed** — the corrected mutation table still overstated by one
  row, on the branch whose entire correction is about overstated mutation rows.
  Row 13 read "remove the integer / non-negative validation"; gate 2 applied
  precisely that — `Number.isInteger(value) && value >= 0` dropped, the type
  check kept — and got **698/698, exit 0. It survives.** The builder reproduced
  it before rewriting anything.

  What `:450` kills is the _broader_ mutation that drops the type check too. The
  integer/non-negative half alone is plausibly an equivalent mutant, because
  `from` and `to` reach the lookup as loop counters over the caller's own
  arrays, so a fractional or negative index can only key something nothing ever
  looks up. **No test was added**, on the gate's own instruction: a test that
  cannot fail is the thing this ticket has already been wrong about once. Row 13
  and the F5 table now say "entirely, the type check included", `:467` is
  described as documenting intent rather than as a killer, and the equivalence
  argument is written down in both places.

- **F-b · low · fixed** — an `oxfmt` wrap had cut "verified here and
  independently at gate 1." mid-clause, leaving `1. Not one test…` at the start
  of a line, which markdown renders as an ordered list. The Log's strongest
  paragraph rendered truncated. Reflowed so no sentence ends on a bare numeral.

- **F-c · nit · fixed** — the Review's "+2131 / −8" was already stale, because
  each gate's record is part of the diff it describes and so moves the count it
  quotes. The counts are dropped and the file list kept: it is the half that
  does not rot.

- **F-d · nit · fixed** — `cellKey` embedded a **literal NUL byte**, which makes
  the whole module binary to `grep`: every pattern silently returns nothing
  unless you pass `-a`. It cost the reviewer ten minutes and it had already cost
  the builder some during gate 1, when greps for `Number.isInteger` in a file
  that plainly contained it came back empty. It is now `KEY_SEPARATOR` imported
  from `place-key.ts` — the separator that module already owns and documents, so
  the fix removes a duplicated magic value as well as the byte — with a comment
  saying why it is not a literal. Verified: the file is plain text and `grep`
  matches it.

**`status` stays `ready`, and both gates agree it should.** This lands as a
partial: pl-28 step 3's geocoder half is not done, two acceptance rows above are
`unproven`, and [pl-30](./pl-30-geocoder-payload.md) is what closes them.

### Post-gate change — 2026-08-23

**Neither gate reviewed this, and that is the point of recording it here.** Both
gates are claims about `e60f5a6`…`ccf1c95`; this commit is after both, so the
shipped code is outside the reviewed range.

CodeQL (`security-extended`, on the pull request) raised one alert — the only
one across the five pull requests in this batch:

> `js/polynomial-redos`, high — `tools/planner/api/src/grounding/valhalla.ts:312`
> — "This regular expression that depends on library input may run slow on
> strings with many repetitions of `/`."

`trimSlash` was `url.replace(/\/+$/u, "")`. `\/+$` retries from every position in
a run of slashes, so a value that is mostly slashes costs quadratic time. It is
now an O(n) scan backwards from the end.

**The finding is real and the exposure is not.** The input is `routingUrl` /
`geocoderUrl` — an operator's own configuration, read once at construction — so
the only party who can pay the cost is the operator who wrote the value. The
rewrite was taken anyway because it is the same length, no harder to read, and
leaves nothing to argue with; the alternative was dismissing the alert in the
security UI, which would have set this repo's first CodeQL suppression
precedent, and that is not a thing to establish for a case this small.

Verified rather than assumed, since a hand-rolled loop can go wrong where a
regex could not:

- **Control first** — clean tree, `npm test -- --project planner`, **699 passed
  / 49 files**, exit 0.
- The single-trailing-slash case was **already pinned**: the suite's `provider()`
  helper sets `routingUrl: "http://valhalla.internal:8002/"`, so a broken
  `trimSlash` produces `//sources_to_targets`. A comment now says so, because it
  was load-bearing by accident.
- One test added for the boundary a regex could not get wrong — a run of four
  slashes (`endpoint normalisation`).
- **Two mutations, both killed by both tests**: `trimSlash` as a no-op, and an
  off-by-one (`slice(0, end + 1)`) leaving exactly one slash. Each rebuilt before
  running; source restored with `touch` and `dist` re-checked afterwards, per the
  stale-`dist`-on-restore trap.

## Log

**2026-08-23 — built, with one disclosed hole.** Steps 1–9 are implemented. Step
3 is **half** captured, which is why this ticket is not `done`: the routing
payload is real and the geocoder payload could not be obtained at all. Details
below, and the remainder is [pl-30](./pl-30-geocoder-payload.md).

### The geocoder is Nominatim, on the same extract

Option 1, as recommended. It is a second implementation behind the same seam:
`createGroundingProvider` in `api/src/server.ts` still has one `switch` and one
case per backend, and `valhalla` is one case however many services sit behind
it. `/api/health` reports one name.

### The fixture, and exactly what is real about it

**There is no Docker in this environment, no route to geofabrik.de, and no
route to any public Valhalla or Nominatim.** Only the npm registry is
reachable. So the ticket's procedure — download a regional extract, build tiles,
capture — could not be run as written.

What was done instead, and it is worth reading before anyone treats the fixture
as second-best:

1. `@valhallajs/valhallajs@3.7.0` — the Valhalla project's **own** Node package,
   which ships prebuilt `valhalla_build_config`, `valhalla_build_tiles` and the
   engine itself — installs from npm.
2. A tiny `.osm.pbf` was written by hand with `protobufjs`: five nodes in a
   square loop with a spur, plus a two-node fragment deliberately **not**
   connected to it, all at Null Island so nobody reads the numbers as a real
   road. Writing OSM PBF by hand is a `BlobHeader`/`Blob` envelope around a
   `PrimitiveBlock` with dense nodes; the one trap is that `protobufjs`
   camel-cases snake_case field names, and a `zlib_data` that silently does not
   encode produces a 32-byte file and no error.
3. `valhalla_build_tiles` built a real graph from it — the same sixteen-stage
   pipeline a regional extract goes through, finishing in `validate` and
   `cleanup`.
4. The matrix was taken through the actor's raw string path, which is
   `/sources_to_targets`'s own handler and its own serialiser.

**So the geometry is invented and the payload is not.** The four things a parser
can get wrong here — field names, nesting, units, and the shape of an answer
with no route — are all Valhalla's, and a capture over a real Québec extract
would settle exactly the same four. The one that mattered:

```
{"from_index":0,"to_index":2,"time":null,"distance":null}
```

An unroutable pair is a cell that is **present**, with both numbers `null`. Not
omitted, not zero, not an error, not a shorter row. Four plausible guesses, one
answer, and it is the case pl-28 step 5 and pl-27's whole gap vocabulary turn
on. Also settled: `time` is **seconds**, `distance` is in whatever `units` the
request asked for — so the adapter states `units: "kilometers"` rather than
trusting a default — and every cell carries its own `from_index`/`to_index`.

`oxfmt` indents the fixture, and **`test/fixtures/` in `.oxfmtrc.json`'s
`ignorePatterns` does not actually exempt it** — worth knowing, and left alone
rather than fixed here, because widening that pattern is a toolchain change with
no ticket. Every key, value and numeric literal survived, `0.0` and `null`
included; only whitespace moved.

### The geocoder payload is missing, and nothing was written in its place

Nominatim needs PostgreSQL, PostGIS and an import — none available, and neither
is the public instance. Searching npm for a package shipping a _recorded_
Nominatim reply turned up nothing whose provenance could be trusted, and
laundering someone else's hand-written payload through their tarball would fail
this ticket's own standard rather than meet it.

So `firstCoordinates` is written against Nominatim's documented shape and
asserted by nothing. **"Asserted by nothing" is literal and it is worth stating
at full strength, because it reads as "thinly tested" and it is not:** the
entire body of `firstCoordinates` can be replaced with `return null;` and the
planner suite stays green at 698 of 698 — verified here, and independently by
both gates. Not one test on this branch ever receives a non-null
`LocatedPlace`, and none of that function's seven branches is pinned by
anything.

`locate`'s tests cover only what needs no invented payload: the _question_ it
asks (name and locality together — dropping locality is how Saint-Jean in Québec
becomes Saint-Jean in New Brunswick, and an identifying `User-Agent`, which
Nominatim's policy requires), an unreachable geocoder, a slow one, and a blank
place answered without a request.

**And it is reachable in production, which is what makes it matter.**
`runs/travel.ts` calls `provider.locate(...)` for every place a run's candidates
name, so with `GROUNDING_PROVIDER=valhalla` the first plan a deployment builds
runs unasserted parsing code. The failure has a shape worth writing down: if
Nominatim answers something `firstCoordinates` does not expect, it returns
`null` — every place stays uncoordinated, `pointsOf` drops all of them, `travel`
short-circuits before any request, and the operator sees a healthy service
reporting `{"grounding":{"provider":"valhalla"}}` while every plan it produces
carries a `travel-time` unchecked constraint. That is an answer shaped exactly
like an honest one, which is the hardest kind of wrong to notice.

[pl-30](./pl-30-geocoder-payload.md) carries the rest. **Do not mark this ticket
done until that lands.**

### Where the brief was wrong or out of date

- **`docs/02-DEPLOYMENT.md` is repo-wide, at the root**, not
  `tools/planner/docs/02-DEPLOYMENT.md`, which does not exist and would collide
  with `02-ROADMAP.md` if it did. The grounding section went into the root one.
- **"pl-2's compose service names it" cannot be satisfied, because that service
  does not exist.** pl-2 steps 5 and 6 were deliberately not bundled on
  2026-08-14 and are still open. What landed instead is `compose.planner.yaml` —
  the routing engine, the geocoder and the tile-build profile — with the three
  settings the `planner` service will need written at the bottom of it, so pl-2
  is a paste rather than a derivation. This is the shape
  [adr/004](../../../../docs/adr/004-one-compose-fragment-per-tool.md) decided,
  and it is additive: the repo-wide rename that ADR also decided is a `repo-`
  ticket and is **not** started here, so nothing that works today stops working.
- **The brief predates adr/004**, which was written the day after it and which
  reallocates part of step 8: the compose split is repo-wide work, pl-2 owns the
  planner service, and "pl-28 step 8 still owns the tile ops that an operator
  will need" is the sentence this ticket was held to.
- **No new error code was needed, and none was invented.** A boot
  misconfiguration is `AppError("INTERNAL", "<clear operator message>")`, which
  is precisely what the downloader's `PROXY_URL` already does in its own
  `config.ts`. Reaching for `AGENT_UNCONFIGURED` would have meant rewording it
  at the call site, which the root `CLAUDE.md` names as the tell that a code is
  the wrong one. `@planner/contract` is untouched.

### Decisions the brief left open

**`Source.url` is `https://www.openstreetmap.org/copyright`, never the
endpoint.** A source is stored on the plan and rendered to the user as a link
they read as "we checked this". A private routing URL there is a dead link that
publishes the deployment's topology into the plan document — `/api/health`'s
rule, one layer along — and the thing actually behind the number is OSM's data,
whose licence requires that attribution be shown anyway. So the honest citation
and the safe one are the same string.

**A place with no coordinates is not sent.** Valhalla routes between points and
has nothing to snap a bare name onto, so such a place is left out of the request
and its row and column come back `null`. In practice pl-27's pass locates
everything it can first, so this is residue rather than the norm — but a place
that would not locate must not become a guessed point.

**Boot refuses before the database is opened.** `createGroundingProvider` now
runs ahead of `mkdirSync`/`new Database`, so a misconfigured endpoint does not
leave a storage directory and a database file behind for a service that was
never going to start.

**`indexCells` keys the reply in a `Map`, built from validated integers** — step
4, and pl-24's review before it. The reply is not a model's, but it is not ours
either, and `from_index` reaches an array subscript where the string
`"constructor"` would find `Array.prototype.constructor` rather than nothing. It
is also keyed by the reply's own indices rather than by nesting order: the two
agree today, and a caller that assumed the order would have no way to notice the
day they do not.

**A body that is not a `sources_to_targets` reply throws rather than answering a
table of nulls.** Nulls would report "nobody could measure these legs" for a URL
pointing at the wrong service, which is the plan quietly lying about what it
checked. There is a test that breaks if that is softened.

**The timeout is 5 s and both signals are one signal on the wire.**
`AbortSignal.any([caller, AbortSignal.timeout(ms)])`, and `#reachFailure` asks
the **caller's** signal first.

The reasoning in the code comment was sloppy and gate 1 caught it. It is not
true that "both causes surface as an `AbortError`": `AbortSignal.any`
propagates the _aborting_ signal's own reason, so a deadline arrives as
`TimeoutError` and a plain `controller.abort()` as `AbortError`, already
separable by name. The order is therefore not load-bearing for the ordinary
case, and gate 1 proved it by reversing the two lines and watching the suite
stay green.

**What the order does buy is the case where the caller's reason is itself a
`TimeoutError`** — a run bounded upstream by its own `AbortSignal.timeout`,
which is exactly how a caller would bound one. Asking the error's name first
would then call a stopped run a slow backend and hand back a retryable
`TIMEOUT`. That is now asserted, in "a caller's own reason is never
reinterpreted as our deadline", and the pure reordering is mutation 5 below and
now dies.

### One existing test changed meaning, deliberately

`config.test.ts`'s "falls back to the fixture provider when the grounding name
is unknown" used `valhalla` as its example of an unknown name. pl-28 makes that
a real name. The example is now `osrm`; the assertion is about the fallback and
not about that word, and the comment says so.

### Gates

- `npm run check` — exit 0.
- `npm test -- --project planner` — **698 passed, 49 files**, up from **669 in
  47 files** at `origin/main` — measured here against a stash of this branch,
  and measured independently by gate 1, which agreed. 29 new tests, 2 new files.
- `npm test` — **1395 passed, 99 files**.
- `npm run format` — run; the deployment doc, the adapter and the fixture were
  all reformatted by it.
- **The image gate in `.github/workflows/planner.yml` does not run locally and
  has not run.** Nothing here changes what the container ships — no workspace
  dependency was added, and `packages/core/test/image-closure.test.ts` is green
  — but that scan proves the list and never the image. `GROUNDING_PROVIDER` still
  defaults to `fixtures`, so the gate still starts the planner container alone,
  which is what adr/004 says it must keep doing.
- **Nothing about `compose.planner.yaml` has been run.** No Docker here. Neither
  image tag was pulled or verified, the `healthcheck` shells out to `curl` and
  whether that image ships one is unchecked, and both facts are written into the
  file and into the deployment doc rather than left for someone to discover.

### The first mutation sweep was worthless, and that is worse than the one finding

Gate 1 found that one of the twelve claimed reds — reversing the two lines in
`#reachFailure` — was green. Chasing it turned up something larger: **all twelve
were.**

The harness ran `npx vitest run <spec> --reporter=basic` and read the exit code.
`--reporter=basic` does not exist in vitest 4; it fails to load and the process
exits **1 on a clean, unmutated tree**. Every mutation therefore "died", and the
paragraph that reported twelve reds was reporting the reporter.

The transferable half: **a mutation harness needs a control run.** One execution
of the unmutated tree, asserted green, would have caught this before the first
claim was written — the same argument the fixture rule makes one level up, that
a check which cannot fail is not a check. The second harness starts with that
control and prints its result.

**Second sweep, sixteen mutations, sixteen killed, control green.** No reporter
flag, and each run is the whole `--project planner` rather than one spec:

| #   | Mutation                                                                      |        |
| --- | ----------------------------------------------------------------------------- | ------ |
| 1   | `estimate`: drop the null guard, so an unroutable cell measures as zero       | killed |
| 2   | `estimate`: report seconds as minutes                                         | killed |
| 3   | `estimate`: report kilometres as metres                                       | killed |
| 4   | `#reachFailure`: lose the `TimeoutError` branch                               | killed |
| 5   | `#reachFailure`: **pure reorder** — deadline asked before the caller's signal | killed |
| 6   | `indexCells`: answer a wrong body with a table of nulls instead of failing    | killed |
| 7   | `pointsOf`: send a place with no coordinates anyway                           | killed |
| 8   | `placeQuery`: drop the locality from the geocoder query                       | killed |
| 9   | `requiredEndpoint`: start anyway when the endpoint is missing                 | killed |
| 10  | `requiredEndpoint`: accept an endpoint that is not a URL                      | killed |
| 11  | `/api/health`: report the endpoint beside the provider name                   | killed |
| 12  | boot log: log the endpoints beside the provider                               | killed |
| 13  | `indexOf`: remove its validation **entirely, the type check included**        | killed |
| 14  | `estimate`: half-a-cell guard, `\|\|` becomes `&&`                            | killed |
| 15  | `estimate`: remove the negative time/distance guard                           | killed |
| 16  | `locate`: drop the `User-Agent` header                                        | killed |

Rows 13–16 are gate 1's F5 — four survivors its own 55-mutation sweep found and
mine could not have, because mine could not find anything. Row 5 is F1. All five
are covered by tests added in the gate-1 round; every mutation was reverted.

**Row 13 is stated at exactly the width that dies.** Gate 2 found this table
overstating it — the row said "the integer / non-negative validation", and
removing _only_ that half survives at 698/698. What dies is dropping the whole
guard, the type check included. The integer/non-negative half is plausibly an
equivalent mutant and is left unkilled on purpose; the reasoning is in the
Review, under F5. An overstated mutation row on the branch whose whole
correction is about overstated mutation rows is the failure this Log is least
entitled to repeat.
