---
id: pl-30
tool: planner
title: Capture a real geocoder payload and hold locate's parser to it
kind: fix
milestone: P3
status: done
depends_on: []
---

# pl-30 — The half of pl-28 step 3 that could not be captured

> **On the id.** pl-29 was already taken by
> [detours along a leg](./pl-29-detours-along-a-leg.md); this is pl-30 and not
> pl-29, and the two are unrelated.

## Why

[pl-28](./pl-28-valhalla-adapter.md) step 3 asked for fixtures captured from a
real running Valhalla **and a real geocoder**, and said why in terms that leave
no room to negotiate: _a hand-written fixture for a routing engine is a fixture
that agrees with your parser by construction._ The same sentence is true of a
geocoder.

Half of it was done. `api/test/fixtures/valhalla-sources-to-targets.json` came
out of Valhalla 3.7.0's own matrix serialiser, and it settled the one thing
nobody could have guessed — an unroutable pair is a cell that is **present**
with `"time": null, "distance": null`, not an omission, not a zero and not an
error.

**The geocoder half was not, and nothing was written in its place.** Nominatim
wants PostgreSQL, PostGIS and an import of the same extract; the environment
pl-28 was built in had no PostgreSQL, no Docker, no route to geofabrik.de and
no route to the public instance either. Rather than hand-write a payload and
call it captured, `locate`'s reply parsing was written against Nominatim's
documented shape and **asserted by nothing**. Only its transport behaviour —
unreachable, slow, empty result, nothing to ask about — has a test.

So there is one function in this tool whose correctness rests on somebody's
memory of a JSON document: `firstCoordinates` in
`api/src/grounding/valhalla.ts`. That is exactly the position pl-28 step 3
exists to prevent, and it is worth a ticket rather than a paragraph.

**How thin, exactly.** Its whole body can be replaced with `return null;` and
the planner suite stays green. None of its seven branches is pinned by anything,
and no test on that branch ever receives a non-null `LocatedPlace`.

**And the failure it hides looks like an honest answer, which is the hardest
kind to notice.** `runs/travel.ts` calls `locate` for every place a run's
candidates name, so with `GROUNDING_PROVIDER=valhalla` the first plan a
deployment builds executes this code. If Nominatim answers a shape it does not
expect, it returns `null`; every place stays uncoordinated; `pointsOf` drops all
of them; `travel` short-circuits before any request goes out. The operator then
has a service reporting `{"grounding":{"provider":"valhalla"}}` at `/api/health`
and producing plans that every single time carry a `travel-time` unchecked
constraint — which is precisely the sentence an honest plan says when a backend
genuinely could not measure something. Nothing distinguishes the two from
outside. That is the cost of this ticket staying open, and it is why it is a
`fix` rather than a `chore`.

## Build

1. **Stand up a geocoder and capture `/search`.** A machine with Docker and
   network is all it takes: the `mediagis/nominatim` image imports a `.pbf` and
   serves. A **city-sized** extract is plenty — this fixture is about the shape
   of one reply, not about coverage. `docs/02-DEPLOYMENT.md`'s grounding section
   is the procedure.

2. **Capture at least three replies**, because the interesting ones are not the
   hit:
   - a place that matches — the shape of a result, and whether `lat`/`lon` are
     the strings the documentation says they are;
   - a name that matches **nothing** — is it `[]`, or an object, or a 404? The
     adapter answers `null` for the first and would answer `UNREACHABLE` for the
     third, and those are different sentences on a plan;
   - a name that matches **more than one place** — "Saint-Jean" with no locality.
     `place-key.ts` names this as the ambiguity nothing in the tool can resolve
     today, and says a seam that could answer "more than one place matches" is
     where the fix would go. A captured payload is what makes that arguable
     rather than hypothetical.

3. **Hold the parser to them, offline**, beside the travel tests in
   `api/test/grounding-valhalla.test.ts`, and fix whatever the payload disagrees
   with. Expect it to disagree with something: it always does, and that is the
   whole reason for this ticket.

4. **Amend pl-28's Log rather than editing its brief**, in the shape pl-24's Log
   already uses for an amendment. The gap is recorded there and a reader who
   finds it must be able to find the answer.

## Done when

- A real Nominatim `/search` reply is checked in under `api/test/fixtures/`,
  with its provenance written where the fixture is read.
- `locate` parses it into `LocatedPlace` offline, with no network in any test.
- A no-match reply yields `null` — not an error, and asserted against whatever
  Nominatim actually returns rather than against `[]` assumed.
- pl-28's Log says the gap is closed and by what.

### Gate 1 — 2026-08-29

**Verdict: CONCERNS**

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Severity | Disposition                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fabricated citation. `tools/planner/docs/work/pl-30-geocoder-payload.md:193-194` **as reviewed at `c689216`** — pinned to that commit rather than repointed, since it is the finding's own evidence — claimed the root `CLAUDE.md` documents `repo-1` preparing this repo for public release. `git grep -i "public release" HEAD` at `c689216` matches nothing but that sentence itself, and `repo-1`'s own title (`docs/work/repo-1-generated-status-tables.md`) is "Generate the status tables from ticket frontmatter, and stop branches editing them" — the status page, not publication. | high     | Fixed. The sentence is rewritten to name the false claim and withdraw it, resting the licensing argument on the MIT fact alone (`LICENSE`, read directly). Mechanism below.                                                                                                                                                                             |
| 2   | Test-delta arithmetic. `tools/planner/docs/work/pl-30-geocoder-payload.md:148` **as reviewed at `c689216`** — same pinning rule — computed `702 = 698 + 4`, inheriting pl-28's Log's `698/698` without rerunning it and crediting pl-31 with 4 new tests it does not have.                                                                                                                                                                                                                                                                                                                    | med      | Fixed. Reproduced pl-28's tip (`60e48e7`) twice: `699/699`. `git show --stat` on `aa59377` (pl-31) shows no test file touched; on `e56d093` (pl-32) shows `vite-config.test.ts` added with 3 `test(` blocks. Corrected identity: `702 = 699 + 3`. pl-28's own Log carries the same correction, appended in this commit in its existing amendment shape. |

**What produced finding 1** — named because the mechanism is worth more than the
corrected sentence. The false sentence did not come from rereading `CLAUDE.md`
at the point it was written. It came from this session's first orientation
command, run to confirm the worktree state before any ticket work started:
`git branch -vv`, which listed a stale, deleted-remote branch named
`repo-1-prepare-for-public` (`[origin/repo-1-prepare-for-public: gone]`) whose
head commit read `docs(repo): license the repo, add a security policy, split
the READMEs`. That branch shares a numeral and a naming convention with the
real ticket `repo-1` and nothing else — `repo-1`'s actual, merged scope is the
generated status tables, per its own file. Many tool calls later, writing the
licensing paragraph, I retrieved the branch-name memory instead of opening
either `CLAUDE.md` or `repo-1`'s ticket file, and wrote it as if `CLAUDE.md`
said it. Two failures stack: crediting a branch name as a fact about a document
never reopened, and treating an abandoned, never-merged branch as evidence of
anything true about the repo's current state. This ticket's whole subject is
code asserted from memory instead of measured; the same failure reappeared one
level up, in prose about that code rather than in the code itself.

**What this gate did not do.** It did not itself attempt or evaluate the
feasibility of the `@mailwoman/nominatim` capture path — that call (an
AGPL/commercial dual-licensed engine's output landing in an MIT repo) is
named as outside this ticket's authority, not resolved by it. It did not
independently re-verify `sister-software/mailwoman`'s license text beyond the
GitHub API's SPDX field and the repo's own `LICENSE.md` prose already quoted in
the Log. Its `699/699` measurement at `60e48e7` was reproduced independently in
this pass rather than taken on faith; its mutation-control confirmation
(`702/702` with `firstCoordinates` gutted) was not rerun here since nothing
about that function changed on this branch.

### Gate 2 — 2026-08-29

**Verdict: PASS**

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Severity | Disposition                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Coverage claim overstated. `tools/planner/docs/work/pl-30-geocoder-payload.md:45` **as reviewed at `0f604e3`** (pinned, not repointed — it is the finding's own evidence) states "None of its seven branches is pinned by anything"; `:334` **at the same commit** then says `firstCoordinates` "needed no change" without walking that claim back. Gate 2 mutated all eight `firstCoordinates`/`asNumber` branches individually: the happy path and `[]` no-match are pinned, the non-array case is TypeScript-enforced, the empty-array and non-finite-parse cases are equivalent mutants, and four (non-object first result, missing `lat`/`lon`, a value neither a usable string nor a number, an out-of-range coordinate) were pinned by nothing. A *Why*→Log skim reads as full coverage without that gap being stated anywhere. | med      | Closed rather than only described. Added `describe("firstCoordinates, against malformed input no capture could justify")` — four tests over `[null]`, `[{}]`, `[{lat:"",lon:""}]`, `[{lat:"999",lon:"0"}]` — and a dated Log entry naming exactly what was and wasn't pinned before this. Each of the four verified load-bearing with its own targeted mutation (below), not merely written. |
| 2   | Unsourced id claim. `tools/planner/docs/work/pl-34-locality-free-query-confident-wrong-place.md:143` **as reviewed at `0f604e3`** says "`pl-33` is in use elsewhere" as if it were a fact about this repository. `git log --all`, every branch and every open pull request carry zero references to `pl-33` — reported by the gate as unverifiable, not false, since an id reserved but not yet landed is expected to be invisible here.                                                                                                                                                                                                                                                                                                                                                                                               | low      | Fixed. Rewritten to state the sourceable version: the coordinator reserved `pl-33` for another in-flight planner ticket at filing time, it is expected to be absent from this repo's history for exactly that reason, and it will be reclaimed if unused — attributed to the coordinator's own claim rather than asserted as a fact this repository can confirm.                             |

**Also from this gate, needing no further action:** verified both pl-30's
four and pl-28's seven Done-when lines against the tree (all eleven met);
proved the dangling-`depends_on` check fails when it should (`exit 1`,
`"kind": "dangling-dependency"`); and overwrote
`nominatim-search-no-match.json` with a non-empty payload to confirm the
no-match test genuinely reads the file rather than asserting a hardcoded
`[]` — the test failed as it should have, so all four fixtures are
load-bearing and none were changed in response.

**What this gate did not do.** It did not choose between folding the four
missing branches in versus only correcting the Log — it named the option and
left the choice to the builder, with reasoning for why folding them in does
not violate the ticket's own no-hand-written-fixture rule. It did not itself
resolve the ODbL/attribution gap the previous round surfaced — that is filed
as [pl-35](./pl-35-travel-source-unattributed.md), separately, per the
coordinator's instruction not to fold it into pl-34 either. It did not re-run
gate 1's earlier mutation sweep or citation checks; its scope this round was
the two findings above plus the Done-when/dangling-dependency verification
named here.

## Log

**2026-08-29 — `depends_on` was circular; dropped `pl-28`.** pl-28's own Log
says it cannot go `done` until this ticket lands, while this ticket's
frontmatter waited on pl-28 — a cycle `npm run status` can't resolve, and it
was also handing pl-29 a blocker that could never clear. Before:

```
$ npm run status -- --show pl-30
  depends on  pl-28
  blocked by  pl-28 (ready)
$ npm run status -- --tool planner
  · pl-30  ... (waits on pl-28)
```

pl-28's code is already on `main`:

```
$ git log --oneline --all | grep pl-28
60e48e7 feat(planner): measure legs against a real routing engine, self-hosted (pl-28) (#74)
```

So the edge is satisfied in substance; only pl-28's own ticket bookkeeping
waits on this one. Set `depends_on: []`. After:

```
$ npm run status -- --show pl-30
  depends on  nothing
  unblocked
$ npm run status -- --tool planner
  • pl-30  Capture a real geocoder payload and hold locate's parser to it
```

pl-28's frontmatter stays `status: ready` — closing it is still gated on this
ticket producing a fixture, which did not happen (below).

**2026-08-29 — baseline reproduced before touching anything.** `firstCoordinates`
in `api/src/grounding/valhalla.ts` replaced with `return null;` (scratch script,
restore via `trap ... EXIT INT TERM` doing `cp` then `touch` then rebuild, so a
kill mid-mutation can't leave a stale mutated `dist` behind):

```
$ npm run build --workspace=@planner/api   # 0.385s
$ npm test -- --project planner
 Test Files  50 passed (50)
      Tests  702 passed (702)
```

702/702. **Reproduced pl-28's own baseline at its actual merged tip rather
than trusting its Log's 698/698**, which turned out to be stale:

```
$ git archive 60e48e7 | tar -x -C <scratch>   # same symlinked node_modules
$ npm run build
$ npm test -- --project planner   # run twice
 Test Files  49 passed (49)
      Tests  699 passed (699)
```

699/699, both runs — not 698/698. `pl-28`'s Log is amended below with the same
evidence. The sibling arithmetic is therefore 699 + 3, not 698 + 4:

```
$ git show --stat aa5937705ec42b28f7af60d2a4df72bb4f93e3fa   # pl-31, #91
 .../pl-31-vite-config-in-no-tsconfig-project.md    | 241 ++-
 tools/planner/docs/work/pl-32-vite-config-test.md  |  69 ++
 tools/planner/web/test/tsconfig.json               |   8 +-
$ git show --stat e56d0935e1750f15063dfcd810568e5ec5d08660   # pl-32, #97
 tools/planner/docs/work/pl-32-vite-config-test.md | 342 ++-
 tools/planner/web/test/vite-config.test.ts        |  65 ++
$ grep -c "test(" tools/planner/web/test/vite-config.test.ts
3
```

pl-31 touches no test file at all — zero new tests. pl-32 adds
`vite-config.test.ts`, three `test(` blocks. 699 + 3 = 702. Confirms the gap
pl-30 exists to close is still open: the harness cannot fail on this function.
File restored and rebuilt by the trap; diff against `git status` after was
empty.

**2026-08-29 — Phase A: no capture, and not for the reason pl-28 hit.** Probed
connectivity per host (the sandbox refuses a chained/looped command as
"too complex to verify... stays inside the worktree", so one `curl` per host):

```
$ curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org
200
$ curl -s -o /dev/null -w "%{http_code}" https://nominatim.openstreetmap.org
(times out)
$ curl -s -o /dev/null -w "%{http_code}" https://photon.komoot.io
(times out)
$ curl -s -o /dev/null -w "%{http_code}" https://api.mapbox.com
(times out)
```

Confirms the brief: only npm and GitHub are reachable, no public or self-hosted
geocoder is.

Searched `registry.npmjs.org/-/v1/search?text=nominatim` (and a second pass on
`offline geocoding server`) for this ticket's equivalent of
`@valhallajs/valhallajs` — a package shipping a _runnable_ engine rather than a
client of the public API. Everything else in both result sets is a thin HTTP
wrapper around `nominatim.openstreetmap.org`. One is not:
`@mailwoman/nominatim` — `npx @mailwoman/nominatim serve` stands up a genuine
Nominatim-compatible `/search` over the "Mailwoman" engine
(`github.com/sister-software/mailwoman`, 2 stars, commits as of today — a real,
maintained project, not a placeholder). Its own repo shows the analogue of
pl-28's synthetic-`.pbf`-through-the-real-pipeline move:
`packages/resolver-wof-sqlite/test/integration/build-candidate.test.ts` builds a
tiny fixture gazetteer and runs it through the project's own production
`buildCandidateTable`, not a hand-written reply.

**Stopped there — deliberately, on a licensing finding this ticket's brief
never anticipated, not on feasibility.**

```
$ curl -s https://api.github.com/repos/sister-software/mailwoman/license
"license": {"spdx_id": "NOASSERTION", ...}   # LICENSE.md: AGPL-3.0-only OR LicenseRef-Commercial
```

This repo's own `LICENSE` is MIT — confirmed by reading it, not by the
sentence this replaces, which claimed the root `CLAUDE.md` documents `repo-1`
preparing this repo for public release. `git grep -i "public release"` at
`HEAD` returns nothing, and `repo-1` is titled "Generate the status tables from
ticket frontmatter, and stop branches editing them" — about the status page,
not about releasing the repo. That sentence was mine and unsourced; withdrawn,
and the argument below rests on the MIT fact alone, which is the only one
checked. Generating a fixture by running an AGPL/commercial dual-licensed
engine, then checking that output into an MIT tree, is a different question
from the laundering pl-28's builder rejected — nothing here would be hand-written or lifted from a test
suite, the payload would be genuinely produced by real code — but whether an
AGPL tool's _output_, embedded in an otherwise-MIT repo, carries any of that
license's obligations forward is a real, unsettled question and not mine to
resolve unilaterally mid-ticket. So the capture was not attempted.

**What a networked, licensing-cleared machine would need**, either path: (a)
the brief's own — `mediagis/nominatim` over Docker against a small `.pbf`, per
`docs/02-DEPLOYMENT.md`'s grounding section, needing Docker and a route to
`download.geofabrik.de` (or an extract already on disk); or (b) `npx
@mailwoman/nominatim serve` against a hand-built tiny WOF SQLite admin table run
through `@mailwoman/resolver-wof-sqlite`'s own `buildCandidateTable`, once
someone with standing over this repo's licensing has cleared it — the
engineering shape is a near-direct copy of pl-28's Valhalla capture and would
not be the long pole.

Both tickets stay open. `firstCoordinates` and
`api/test/grounding-valhalla.test.ts` are unchanged on this branch.

**2026-08-29 — real captures arrived; closed.** The user captured four real
`nominatim.openstreetmap.org/search` replies on a networked machine
(`PROVENANCE.txt`, reproduced in this file's own header): a match
(`q=Percé, Québec`), a no-match (`q=Zzqqxv Nonexistent, Québec`), and an
ambiguous bare name (`q=Saint-Jean`) at both `limit=1` and `limit=10`. All
four HTTP 200, `application/json; charset=utf-8`. Checked in under
`api/test/fixtures/`; provenance is the doc comment at the top of
`api/test/grounding-valhalla.test.ts`, which is where the fixture is read, per
Done-when.

**Re-verified every claim independently rather than trusting the transcription:**

```
$ cat tools/planner/api/test/fixtures/nominatim-search-no-match.json
[]
$ node -e 'const j=require("./tools/planner/api/test/fixtures/nominatim-search-match.json"); console.log(typeof j[0].lat, typeof j[0].lon)'
string string
$ node -e 'const j=require("./tools/planner/api/test/fixtures/nominatim-search-ambiguous-limit10.json"); console.log(j.map(r=>r.importance))'
[
  0.5847674618973391,
  0.5813204991715637,
  0.6016125880228743,
  0.371773638720501,
  0.30093685344584264,
  0.3363461829037416
]
$ node -e 'const j=require("./tools/planner/api/test/fixtures/nominatim-search-ambiguous-limit1.json"),
  k=require("./tools/planner/api/test/fixtures/nominatim-search-ambiguous-limit10.json");
  console.log(j[0].osm_id===k[0].osm_id, j[0].place_id, k[0].place_id)'
true 85350419 85534243
```

All five of the coordinator's claims confirmed: no-match is a literal `[]`;
`lat`/`lon` are strings; the highest importance (0.6016, index 2) is not
first; `place_id` differs (85350419 vs 85534243) for the same `osm_id`
(120280); every row carries a `licence` field (visible in the raw JSON,
checked in verbatim). The `place_id` finding is informational here — nothing
in `api/src` reads that field (`grep -rn "place_id" tools/planner/api/src`,
no output) — recorded on pl-34 rather than acted on. The `licence`/ODbL
attribution point is judged out of scope for this ticket: it is a UI-rendering
question (does the plan display travel/locate's `Source`, which already
carries the OSM attribution URL, anywhere a user sees it?), not a fixture or
parser question, and `grep -rl "fetchedAt" tools/planner/web/src` shows only
`Provenance.tsx` — which renders a candidate's or a cost's sources, never
`PlanItem.travelFromPrevious`'s. That gap is real and distinct enough that it
should be its own ticket rather than folded into pl-34; flagged for the
coordinator to assign an id rather than one invented here. Filed as
[pl-35](./pl-35-travel-source-unattributed.md) once the coordinator assigned
it.

**`firstCoordinates` needed no change.** Both things nobody could have
verified without a real reply — a no-match's exact shape and `lat`/`lon`
being strings — were already handled. Pinned rather than patched:
`describe("locate, over a payload a real Nominatim wrote")` in
`api/test/grounding-valhalla.test.ts` adds a match test and an
ambiguous-name test; the existing no-match test now asserts against
`NOMINATIM_NO_MATCH` instead of `answering([])`.

**Mutation control, proving the new tests can fail before trusting that they
pass** (`trap ... EXIT INT TERM`, `cp` then `touch` then rebuild):

```
$ npx vitest run tools/planner/api/test/grounding-valhalla.test.ts --project planner
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

Then `firstCoordinates`'s body replaced with `return null;`, rebuilt:

```
$ npx vitest run tools/planner/api/test/grounding-valhalla.test.ts --project planner
 Test Files  1 failed (1)
      Tests  2 failed | 25 passed (27)
```

Both new positive-path tests died; file restored by the trap, `git status`
after clean.

**What the captures exposed is not in `firstCoordinates` — filed as
[pl-34](./pl-34-locality-free-query-confident-wrong-place.md).** `q=Saint-Jean`
with no `locality` returns Saint-Jean, **Toulouse, France**, not the
Québec/New-Brunswick near-miss this ticket's Build predicted, and raising
`limit` to 10 recovers no Québec result at all. Reproduced as tests, not
fixed — pl-34 carries the evidence and three options, choice left open.

**All four Done-when lines are met:**

- Real reply checked in under `api/test/fixtures/`, provenance at the point
  of read. ✓
- `locate` parses each offline: `npm test -- --project planner`, no network
  in any test (all three geocoder fixtures go through `answering()`, a mocked
  `fetch`). ✓
- No-match reply yields `null`, asserted against the real `[]` rather than
  one assumed. ✓
- pl-28's Log says the gap is closed and by what — amended there in this
  commit. ✓

`status: done`.

**2026-08-29 — gate 2's finding 1: the coverage claim above overstated what
landed, and this ticket's own _Why_ made the gap easy to miss.** This
ticket's _Why_ diagnoses the original problem as "none of its seven branches
is pinned by anything" — true when written, and still true of the commit
this Log's closing entry describes as done. Gate 2 mutated `firstCoordinates`
and `asNumber` case by case and found: the happy path and the `[]` no-match
are genuinely pinned; the non-array-body case is TypeScript-enforced (the
mutation does not compile); the empty-array and non-finite-parse cases are
equivalent mutants (the neighbouring guard and `coordinatesSchema` already
catch them independently); and **four branches — a non-object first result,
missing `lat`/`lon`, a value that is neither a usable string nor a number,
and a coordinate `coordinatesSchema` should reject as out of range — were
pinned by nothing.** A reader skimming _Why_ then the closing Log entry above
would have read "fully covered" without that being written anywhere.

**Closed rather than only described**, because none of the four needs a
captured payload: the "no hand-written fixture" rule is about a real reply's
_happy-path shape_, which nobody could have guessed — it says nothing about
testing this function's own guards against input no geocoder would need to
send. `describe("firstCoordinates, against malformed input no capture could
justify")` in `api/test/grounding-valhalla.test.ts` adds four tests over
`[null]`, `[{}]`, `[{lat:"",lon:""}]` and `[{lat:"999",lon:"0"}]`.

**Verified each one is load-bearing, not merely written**, with a control run
first and one targeted mutation per test (`trap ... EXIT INT TERM`, `cp` then
`touch` then rebuild, narrowest spec per run):

```
$ npx vitest run tools/planner/api/test/grounding-valhalla.test.ts --project planner
 Test Files  1 passed (1)
      Tests  31 passed (31)
```

Mutation A — drop `first === null` from the object guard:

```
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
```

(`[null]` — a `TypeError` destructuring `lat` off `null`, correctly turning
into a rejected promise rather than the `null` the test expects.)

Mutation B — default a missing/unparseable number to `0` instead of
`undefined`:

```
 Test Files  1 failed (1)
      Tests  2 failed | 29 passed (31)
```

(`[{}]` and `[{lat:"",lon:""}]` — both would silently resolve to Null
Island, `{latitude:0, longitude:0}`, instead of `null`.)

Mutation C — bypass `coordinatesSchema`'s range check and trust `asNumber`'s
parse directly:

```
 Test Files  1 failed (1)
      Tests  1 failed | 30 passed (31)
```

(`[{lat:"999",lon:"0"}]` — `999` would be accepted as a latitude.)

All three restored by the trap; a fourth check confirmed `[{}]`'s `lat` being
`undefined` also kills a mutant that drops the "not a string" half of
`asNumber`'s guard (`undefined.trim()` throws), so the "non-string,
non-number" branch gate 2 named is covered by the same test as "missing
`lat`/`lon`" rather than needing a fifth. Final control after every restore:

```
$ npx vitest run tools/planner/api/test/grounding-valhalla.test.ts --project planner
 Test Files  1 passed (1)
      Tests  31 passed (31)
$ git status --porcelain tools/planner/api/src/grounding/valhalla.ts
(no output)
```

`api/src/grounding/valhalla.ts` is otherwise untouched — this is test-only.
