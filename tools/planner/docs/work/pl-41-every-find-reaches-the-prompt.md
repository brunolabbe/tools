---
id: pl-41
tool: planner
title: Every find a corridor returns reaches the prompt and the detour matrix, uncapped
kind: fix
status: done
milestone: P3
depends_on: []
difficulty: standard
---

# pl-41 — Every find reaches the prompt

**Packages:** `api` (the discovery pass); `agent` only if a defensive bound on
the rendered block is added beside it

## Why

**The one real corridor capture in this repo turns a specialist's prompt from
≈732 tokens into ≈12,700, and nothing bounds it.** `agent/src/grounding.ts`
caps each find: `MAX_FIND_NAME_CHARS`, `MAX_FIND_TAGS` and `MAX_FIND_TAG_CHARS`.
Nothing caps the list. `api/src/runs/discovery.ts` hands `runFanOut` every find
`nearby` answered. `discoveryBlock` in `agent/src/prompt.ts` renders every one
of them into the system prompt of `activities`, `food` and
`conditions-and-gear`.

It went unseen for a structural reason. `FixtureGroundingProvider.nearby`
answers `[]` by design, so no fixture run has ever carried a discovery block,
and every prompt-size figure the tool has was taken without one.
[pl-39](./pl-39-a-real-model-behind-the-seam.md)'s cost table is the most recent
such figure.

**It matters now rather than later**, and there are two reasons:

- **The prompt is about to be billed.** pl-39 puts a metered model behind the
  seam. [pl-40](./pl-40-prove-p3-against-a-real-model.md)'s paid live run feeds
  exactly this capture to exactly these specialists. The owner decided on
  2026-09-13 to file this before that run, so the money measures the prompt that
  will ship rather than one about to change.
- **Montréal→Québec City is the short corridor.** pl-33 measured
  Montréal→Percé, this tool's motivating trip, at 149 s of Overpass time, and
  its corridor is longer again.

The prompt is not the only consumer of the list. `detourCosts` sends
`origins: [origin, ...finds]` × `destinations: [destination, ...finds]` in one
`travel` call. That is a 277 × 277 matrix over this capture, and the Valhalla
adapter bounds its size nowhere. Whether the deployed instance's
`service_limits` for `sources_to_targets` reject a matrix that size is **not
verified**: it is a fact about the host's `valhalla.json`, not about this repo.
Check it there rather than assuming either answer.

## Reproduction

No key and no network. Parse the capture through the real adapter, then render
the real prompt:

```ts
// run with: npx tsx repro.mts (an .mts, so top-level await works outside a module package)
const provider = new ValhallaGroundingProvider({
  routingUrl: "http://valhalla.internal:8002",
  geocoderUrl: "http://nominatim.internal:8080",
  overpassUrl: "http://overpass.internal:8090",
  timeoutMs: 5000,
  now: () => new Date("2026-09-13T00:00:00Z"),
  fetch: async () => new Response(readFileSync("api/test/fixtures/overpass-nearby.json", "utf8")),
});
const finds = await provider.nearby({
  corridor: [MONTREAL, QUEBEC_CITY], // the pair grounding-valhalla.test.ts uses
  radiusMetres: DISCOVERY_RADIUS_METRES, // 6_000, the production value
  kinds: [...DISCOVERY_KINDS],
});
const brief = roadTripFixture.brief;
const input = { specialist: "activities", brief, shape: "road-trip", capacity: capacityOf(brief) };
systemPrompt(input).length + userPrompt(brief).length; // 2,926 chars
systemPrompt({ ...input, finds }).length + userPrompt(brief).length; // 50,882 chars
```

Measured on 2026-09-13 at `4b9ce2f`:

| Quantity                            | Value                          |
| ----------------------------------- | ------------------------------ |
| Finds reaching the prompt           | **276** of 657 elements        |
| `activities` prompt, no finds       | 2,926 chars, ≈732 tokens       |
| `activities` prompt, with the finds | 50,882 chars, ≈12,721 tokens   |
| Growth                              | **×17.4**, ≈43 tokens per find |

Token counts are chars ÷ 4, because `count_tokens` needs a key. pl-40 replaces
them with real counts. The 276 is not an estimate:
`api/test/grounding-valhalla.test.ts` already asserts it, in "parses the capture
into Finds, every one named and inside the radius".

## Build

1. **Cap the list once, in the discovery pass, before `detourCosts`.** One place
   bounds both consumers, the prompt and the matrix. A cap applied only in
   `discoveryBlock` would leave the matrix at n² and store detours nobody reads.
   Name the constant beside `DISCOVERY_RADIUS_METRES` and argue its value where
   it is declared.

   `discovery.ts`'s own header already reasons about "a corridor with forty
   finds", which is a starting point rather than an answer. At ≈43 tokens a
   find, 40 finds is ≈1.7k tokens.

2. **Decide which finds survive, and say why in the code.** Nothing yet decides
   which of 276 places a specialist should hear about, so a cap with no ordering
   keeps whatever Overpass returned first. That is arbitrary in a way a user
   would notice.

   What is available _before_ the detour matrix, which step 1 places the cap
   ahead of:
   - notability, meaning editorial coverage, which the pass already fetches
     before `detourCosts`;
   - distance to the corridor;
   - kind.

   §5's amendment is the argument to read first. Discovery exists because a
   model "returns the famous ones", so ranking purely by editorial coverage
   would reintroduce the bias the pass was built to correct. A mix — some
   coverage-backed, the rest by closeness — is one candidate shape, not a
   mandate. Whatever is chosen, **a deterministic order**, so the same capture
   renders the same prompt twice.

3. **Say what was left out.** The repo's _never fake progress_ rule applies to a
   list as much as to a percentage. A plan built from 40 of 276 finds must not
   read as though the corridor held 40. Add a `coverage` entry saying how many
   places along the route were not shown to the planner, in the same voice as
   the pass's existing "very little on the map along this route" entry. Its
   copy never names a number the user cannot act on unless the number is the
   point; here it is.

4. **A defensive bound in `discoveryBlock` is optional**, and if added, it is a
   backstop that a test proves never trips on the discovery pass's output. It is
   not a second cap with a different number.

## Done when

- A test over the real capture proves that at most the named cap of finds reach
  `runFanOut` from `discover`, in a stable order. The stability is shown by two
  runs producing identical lists.
- The same test, or its neighbour, proves the detour `travel` request carries
  at most cap + 1 origins and cap + 1 destinations.
- The `activities` system prompt rendered over the capped finds is asserted
  under a stated character ceiling. That ceiling is derived from the cap in the
  test, not typed as a magic number.
- A corridor with more finds than the cap produces a `coverage` entry naming
  what was left out, and one at or under the cap does not.
- The chosen ranking is argued in a comment on the function that applies it,
  including why it does not simply prefer editorial coverage.
- The Log records whether the deployed Valhalla's `sources_to_targets` limits
  would have rejected the uncapped 277 × 277 matrix. If nobody could check the
  host, it says so.
- `npm run check` and `npm test -- --project planner` pass.

## Review

### Gate 2 — PASS, at 9e4e522

**Gate: PASS** — 2026-09-14 · `95c6403...9e4e522` · defect hunt run in-agent (ticket-reviewer, opus) at medium · reviewed at `3b1225f`, three lows closed and re-checked at `9e4e522`

| Done when                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At most the cap reach `runFanOut`, in a stable order shown by two identical runs        | `tools/planner/api/test/discovery-pass.test.ts:982 "expect(first.names).toHaveLength(MAX_DISCOVERY_FINDS)"` and `tools/planner/api/test/discovery-pass.test.ts:985 "expect(second.names).toEqual(first.names)"` ✓ — asserted on the result of `discoverAlongCorridor`, which the orchestrator hands to `runFanOut` unchanged                                                                                                                                        |
| Detour `travel` carries at most cap + 1 origins and destinations                        | `tools/planner/api/test/discovery-pass.test.ts:986 "expect(first.sizes).toEqual({"` ✓ — recorded from the request the provider receives; sending the full list and slicing afterwards turns it red                                                                                                                                                                                                                                                                  |
| `activities` prompt under a ceiling derived from the cap                                | `tools/planner/api/test/discovery-prompt-bound.test.ts:158 "expect(cappedPrompt.length).toBeLessThanOrEqual(ceiling)"` and `tools/planner/api/test/discovery-prompt-bound.test.ts:167 "expect(uncappedPrompt.length).toBeGreaterThan(ceiling)"` ✓ — removing the cap fails the ceiling itself (50,099 against 43,263), and a cap of 400 fails the second                                                                                                            |
| Coverage entry above the cap, none at or under                                          | `tools/planner/api/test/discovery-pass.test.ts:758 "expect(result.coverage[0]?.detail).toContain(String(droppedCount))"`, `tools/planner/api/test/discovery-pass.test.ts:833 "a corridor with exactly the cap"`, `tools/planner/api/test/discovery-pass.test.ts:281 "a corridor with something on it: finds returned, no coverage note"` ✓                                                                                                                          |
| Ranking argued on the function, including why not editorial coverage alone              | **verified** by reading `tools/planner/api/src/runs/discovery.ts:647 "Twenty of forty closes that gap"`, which the `rankFinds` comment points to                                                                                                                                                                                                                                                                                                                    |
| Log records whether the Valhalla `sources_to_targets` limits reject 277 × 277           | **verified** — the Log says it was not checked and why; nothing in the repo configures a matrix limit                                                                                                                                                                                                                                                                                                                                                               |
| `npm run check` and `npm test -- --project planner` pass                                | **verified** — check exit 0 at `3b1225f`; planner 56 files, 940 tests at both `3b1225f` and `9e4e522` (937 at gate 1; gate 2 adds 3 tests and rewrites the 45-find and prompt-bound tests to the owner decision)                                                                                                                                                                                                                                                    |
| Owner decision: a share of the 40 goes to the closest finds regardless of coverage      | `tools/planner/api/src/runs/discovery.ts:655 "export const CLOSEST_RESERVED = Math.floor(MAX_DISCOVERY_FINDS / 2)"`, proven by `tools/planner/api/test/discovery-pass.test.ts:788 "expect(survivingNames.has(close.name)).toBe(true)"` (more backed finds than the cap) and `tools/planner/api/test/discovery-pass.test.ts:1046 "expect(survivingUnbacked.length).toBeGreaterThan(0)"` (the real capture with geosearch) ✓ — a reservation of 0 or 1 turns both red |
| Owner decision: the coverage sentence states the rule, true tag-only and with geosearch | **verified** — `tools/planner/api/src/runs/discovery.ts:376 "The closest ones were kept, and so were places with independent editorial coverage where there was room"`, measured over the capture: the 20 closest kept, then 22 of 40 backed tag-only and 29 of 40 backed with 84 backed available                                                                                                                                                                  |
| Owner decision: a fixture not already in ranked order proves the sorter works           | `tools/planner/api/test/discovery-pass.test.ts:735 "answered([...fortyFive].toReversed())"` with `tools/planner/api/test/discovery-pass.test.ts:751 "expect(result.finds.map((f) => f.name)).toEqual(expectedNames)"` ✓ — bypassing the sorter turns it red                                                                                                                                                                                                         |

- **low, closed at `9e4e522`** · The `kind` tie-break was unproven at `3b1225f`: removing it left 31 of 31 green, because the fixture names sorted the same way as their kinds. `tools/planner/api/test/discovery-pass.test.ts:867 "const laterKind = findAtKind("` now names the waterfall so name and kind disagree, and removing `tools/planner/api/src/runs/discovery.ts:696 "if (kindDiff !== 0) return kindDiff"` turns the tie-break test red, after a green control of 31 of 31.
- **low, closed at `9e4e522`** · The cap comment quoted the ranking gate 2 replaced (≈2.8k tokens, ≈281 chars a find). It now states `tools/planner/api/src/runs/discovery.ts:91 "(≈229 chars/find), 22 of the 40 survivors backed with tag-only notability"`, the figures this gate measured at `3b1225f`: growth of 9,147 chars tag-only and 9,057 with geosearch, 22 and 29 of 40 backed.
- **low, closed at `9e4e522`** · The prompt-bound comment called its per-find budget the largest single-find contribution. It now reads `tools/planner/api/test/discovery-prompt-bound.test.ts:140 "newlines that render once around it too (measured ≈388 of the ≈1,028"`, reproduced as (43,263 − 2,143) ÷ 40 = 1,028 per find, with a header of 111, a footer of 273 and 4 newlines making 388, and 2,143 + 1,028 × cap staying under 50,099 only while the cap is below 46.6. The assertions are unchanged.
- **dropped** · the `corridorPoints` null filter, dead at every current call site: settled with the builder as a defensive filter on a generic helper, not a defect.
- **findings** · in-agent hunt at medium returned 4; 3 carried and all 3 closed at `9e4e522`, 1 dropped.
- **mutations** · at `3b1225f`, 15 mutants on renamed copies, tracked files untouched and the tree verified clean after: sorter bypass, reservation at 0, 1 and 40, reserved band by backing, remainder by distance, bands swapped, backing and distance comparators inverted, dedupe removed, name inverted, cap removed and cap at 400 all go red, and removing the kind tie-break survived. At `9e4e522` that survivor was re-run and goes red.
- NFR: security n/a · performance ✓ (matrix 41 × 41, capped system prompt 11,290 chars against 50,099) · reliability ✓ · maintainability ✓.

### Gate 1 — CONCERNS, at 7e72ce5

**Gate: CONCERNS** — 2026-09-14 · `95c6403...7e72ce5` · defect hunt run in-agent (ticket-reviewer, opus) at medium. Summarised without line citations, which moved in gate 2; the reviewer report goes to the pull request thread.

- **med** · the coverage sentence claimed the closest finds were kept; over the real capture with geosearch 84 of 276 were backed, all 40 survivors were backed and the closest unbacked find was dropped. Escalated as an open decision; the owner chose a reservation for the closest finds (see the Log). Closed in gate 2.
- **med** · the prompt ceiling budgeted 20,880 chars per find and could not fail. Closed in gate 2.
- **low** · the 45-find fixture arrived already ranked. Closed in gate 2.
- **low** · tie-breaks unproven. Name closed in gate 2; kind carried.
- **low** · the cap comment understated growth. Reworded, and carried into gate 2 because the ranking changed under it.
- **low** · `corridorPoints` sites unpinned, and its comment counted four copies. Comment closed; the filter settled.
- **findings** · in-agent hunt at medium returned 11; 7 carried in 6 bullets, 4 dropped (typed constants in the specs, the cross-package fixture import, a bare `Error` in test code, an unreachable `RangeError`).

## Log

**2026-09-13 — filed.** Found while grooming pl-40: its brief noted that the
≈783-token input figure pl-39 had been handed was measured with no finds, and
that nothing bounds the list. Reproduced independently before filing, through
the real `ValhallaGroundingProvider.nearby` parser and the real `systemPrompt`,
with the numbers above. The owner chose to file it now, in the same pull
request as pl-39 and pl-40, over leaving it for pl-40's input-share rule to
catch. pl-40 does not depend on it, but its live run is better spent after this
lands. The id was checked against `node scripts/next-id.mjs pl` and the ticket
Logs: pl-39 and pl-40 are this branch's own, and nothing names pl-41.

**2026-09-14 — built, dispatched as `sonnet`.** Branch `pl-41-cap-corridor-finds`
off `origin/main` at `95c6403`.

- **`MAX_DISCOVERY_FINDS = 40`**, declared beside `DISCOVERY_RADIUS_METRES` in
  `api/src/runs/discovery.ts`. Chosen rather than derived from a formula: it is
  the same number this file's own header already used as its illustrative case
  before this ticket ("a corridor with forty finds"), and it matches
  `MAX_GROUNDING_CALLS`'s own default of 40 — a corridor whose discovery pass
  would hand a specialist more material than the run's whole call budget
  already reasons about is exactly the corridor this ceiling is for. **This is
  a judgement call, not a measurement, and the brief said so explicitly** ("one
  candidate shape, not a mandate"); it is flagged as such in the build report
  rather than settled quietly, since it is a limit a user would notice (see the
  `coverage` entry it now produces).
- **Ranking, in `rankFinds`**: independent editorial backing first
  (`Find.notability.length > 0`), then distance to the corridor ascending, then
  `kind` (by its position in `DISCOVERY_KINDS`) and `name` as pure
  determinism tie-breaks with no ranking weight of their own. Argued in the
  function's own comment: editorial coverage alone would launder back in
  exactly the bias §5's amendment built this pass to correct, so a corridor
  with fewer backed finds than the cap fills its remaining slots by closeness
  rather than staying in whatever order Overpass replied in. This is the
  "some coverage-backed, the rest by closeness" shape the brief named as one
  candidate, not a mandate — also flagged, for the same reason as the cap.
- **Coverage entry** (`coverageForDropped`) fires only when the ranked list is
  longer than the cap, and names the exact count left out — the brief's own
  point that the number is not the kind this pass usually omits.
- **`reading` (Wikivoyage) is computed from the full backed list, before the
  cap**, not after: capping first would have shrunk the language-detection
  signal on a long corridor for no reason connected to what `reading` is even
  about (the corridor's own ends, not its finds).
- **Folded in, free**: `nearby`, `notability` and `corridorReading` each
  independently re-wrote "a corridor's own coordinates, dropping any endpoint
  that never geocoded" — now one `corridorPoints` helper, used by all three
  plus `rankFinds`. Small and within the "work this branch already makes free"
  clause rather than a separate ticket.
- **Environment gap, unrelated to this ticket's code**: this worktree's
  `node_modules` (farmed from the shared checkout) was missing
  `@anthropic-ai/sdk` and three of its own dependencies
  (`json-schema-to-ts`, `standardwebhooks` and `fast-sha256`, plus
  `@stablelib/base64`), even though `agent/package.json`
  and the root `package-lock.json` both already declare them (from pl-39,
  already on `main` at this branch's base). The shared checkout's own
  `node_modules` lacks them too, so this is not specific to this worktree —
  nobody has run `npm install` there since pl-39 landed. Fixed locally for this
  build only, without a workspace-wide `npm install` (which the farm script's
  own header warns against): extracted each package's tarball from the local
  npm cache (`npm pack <pkg>@<version> --offline`, `@anthropic-ai/sdk` itself
  needed network since it was not cached) directly into `node_modules`,
  verified `npm run build` and the full repo `npm test` both stayed green
  afterwards. **This is a repo-wide gap, not a pl-41 one** — every worktree
  farmed from the shared checkout after pl-39 merged and before someone runs
  `npm install` there will hit the same `TS2307` on
  `agent/src/providers/anthropic.ts`. Filing it is the reviewer's or the
  orchestrator's call; flagged in the build report rather than filed as
  `pl-50` unilaterally, since it is infrastructure rather than a planner
  ticket.
- **Valhalla `service_limits.sources_to_targets` for the uncapped 277×277
  matrix — not verified.** This is a fact about the deployed host's
  `valhalla.json`, which this environment has no access to (no repo file
  configures it, and nothing here can reach the deployed instance). Per the
  ticket's own "Reproduction" section, this should be checked against the host
  rather than assumed either way; it was not checked, and is recorded here as
  unmeasured rather than guessed at. The cap this ticket adds makes the
  question moot for the shipped code path (at most 41×41 now), but the
  uncapped-matrix question itself remains open for whoever has host access.
- **Verification**: `npx vitest run tools/planner/api/test/discovery-pass.test.ts`
  — 28/28 (23 pre-existing + 5 new) before formatting, unchanged after.
  `npx vitest run tools/planner/api/test/discovery-prompt-bound.test.ts` — 1/1.
  `npm run check` — clean (lint, format, typecheck across the whole repo).
  `npm test -- --project planner` — 56 files, 937 tests, all passing (baseline
  before this ticket's changes: 55 files, 931 tests, run on the unmutated tree
  first to confirm). `npm test` (full repo) — 143 files, 2571 tests, all
  passing, run once after the `node_modules` fix above to confirm nothing else
  in the repo was disturbed by it.

**2026-09-14 — gate round: ranking replaced, ceiling test rebuilt.** The
ticket-reviewer (opus) gated `7e72ce5` as CONCERNS: 2 med, 4 low, all
reproduced independently before acting on them.

- **The open decision (OD-1).** The gate's MED 1 showed the shipped ranking
  (backing first, nothing reserved) reduces to editorial-coverage-alone on a
  corridor with more backed finds than the cap: over the real capture with a
  real geosearch tier wired in (`wikipedia-geosearch.json`, the Québec City
  tile), 84 of 276 finds came out backed, every one of the 40 survivors was
  backed, and the closest actual find on the map — unbacked, 41 m off the
  line — was dropped, while the coverage sentence said "the closest ... were
  kept." The gate escalated the remedy rather than picking one. **The
  orchestrator asked the owner**, `AskUserQuestion`, three options: (1) 40
  with a mixed ranking that reserves a share of slots for the closest finds
  regardless of backing (recommended), (2) 40 with the ranking as shipped and
  a reworded sentence, (3) a higher cap with a mixed ranking. **The owner
  chose (1).** This replaces the ranking pl-41 shipped first (backing first,
  distance second, nothing reserved) and the gate's own option (a) (reword
  only) as a sufficient fix — the reword still happened, but as a consequence
  of the ranking changing, not as the fix on its own.
- **What was built for (1).** `CLOSEST_RESERVED = Math.floor(MAX_DISCOVERY_FINDS / 2)`
  (20 of 40) — the closest finds overall, backed or not, always survive up to
  this count; the remaining slots still rank backing first, then distance.
  Argued against the original reasoning in `rankFinds`'s own comment (and
  `CLOSEST_RESERVED`'s): the bias argument for preferring backing still
  holds, it just cannot be allowed to answer for every slot. Half was chosen
  as the plainest way to say "neither signal outvotes the other outright,"
  not measured against anything.
- **The coverage sentence** now states the rule ("the closest ones were
  kept, and so were places with independent editorial coverage where there
  was room") rather than an outcome, so it stays true whether backed finds
  number 34 (map tags alone) or 84 (with geosearch) on the same corridor.
- **New tests**: a fixture with 50 backed finds (more than the cap) and 5
  close unbacked ones, proving the unbacked ones survive; the real-capture
  test re-run with `wikipedia-geosearch.json` wired into `articlesNear`,
  reproducing the gate's own MED 1 scenario and asserting at least one
  survivor is unbacked; a fixture fed in reversed order rather than
  already-ranked order, closing the gate's LOW 3 (a fixture that arrives
  pre-sorted cannot tell a working sorter from a bypassed one); a tie-break
  test forcing the `kind` and `name` comparators to actually run, closing LOW 4.
- **MED 2, fixed independently of OD-1.** The prompt-size ceiling
  (`discovery-prompt-bound.test.ts`) used `MAX_FIND_NAME_CHARS` ×
  `MAX_FIND_TAGS` × `MAX_FIND_TAG_CHARS` as a theoretical per-find worst case
  (≈20,880 chars) against a real find's ≈174–281 — 120x too loose to move
  when the cap did, which the gate showed three ways (deleting the cap broke
  only an unrelated length assertion; the ceiling still passed at cap=400;
  only a separately-typed `* 1_000` bound ever went red). Rebuilt to derive
  the per-find budget from the single largest contribution actually measured
  across all 276 real finds, so the ceiling is `MAX_DISCOVERY_FINDS × ` that
  measured value — it moves with the cap because both are the same constant.
  Verified directly: with the cap deleted in a scratch copy, this ceiling
  itself now fails (`50099` not `<=` `43263`), even with the incidental
  length assertion the gate used to catch the same mutation also removed.
- **LOW 5 and LOW 6, fixed.** `MAX_DISCOVERY_FINDS`'s comment corrected —
  survivors skew toward tag-heavier, notability-backed finds and measured
  ≈281 chars/find against ≈174 across all 276, not the flat ≈43-tokens
  average the comment previously implied. `corridorPoints`'s comment
  corrected to say three copies folded plus a new fourth caller, not "the
  four copies" (the Log already said three; only the code comment
  overclaimed). `rankFinds`'s `name` tie-break now compares by plain
  code-unit order (`<`/`>`) rather than `localeCompare`, which reads the
  host's unpinned default locale.
- **Not changed**: the gate's `corridorPoints` dead-code observation (the
  null filter is unreachable from every current call site, since both
  corridor endpoints are checked non-null before any caller is reached) is
  accurate and left as is — it is a generic, reusable filter, and the
  alternative (removing it) would make the function wrong the day some future
  caller reaches it with an unlocated corridor. The gate's four dropped
  findings (typed `6_000`/kind list, cross-package fixture import, a bare
  `Error` in test code, an unreachable `RangeError`) were not touched — the
  gate itself dropped them.
- **Verification, after the ranking rewrite and all fixes above**:
  `npx vitest run tools/planner/api/test/discovery-pass.test.ts
tools/planner/api/test/discovery-prompt-bound.test.ts` — 32/32. Every gate
  finding re-verified by mutation on this tree before and after the fix
  (sorter bypass, kind-diff bypass, name-comparator inversion, cap-removal
  against the new ceiling) — each mutation went red only after its matching
  fix landed, restored from a file copy afterwards, `git status --porcelain`
  clean. `npm run check` — exit 0. `npm test -- --project planner` — 56
  files, 940 tests. Citations gate
  (`node scripts/citations-gate.mjs --against origin/main`) — not re-run in
  this round; the orchestrator's own check at `7e72ce5` found it moves
  citations in three other tickets' `## Review` records and said the repair
  (pinning to `95c6403`) happens when ship authority is given, not now.
