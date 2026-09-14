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
