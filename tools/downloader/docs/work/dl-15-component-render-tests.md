---
id: dl-15
tool: downloader
title: Render the UI's components in tests, not only its logic
kind: chore
status: done
milestone: null
depends_on: []
---

# dl-15 — Nothing renders a component

**Area:** `tools/downloader/web/test/`, `vitest.config.ts`, and `web`'s
devDependencies.

## Why

`web/test` has seven files and they are all logic: the reducer, the store, the
stream, the backoff, the error presentation, the mock. Every one of them tests a
function. **No component in `web/src/components/` is ever rendered**, there is no
testing-library dependency in the repo, and the `downloader` vitest project runs
in `environment: "node"`, so nothing could render one today.

That leaves 925 lines of `.tsx` — ten components and `App.tsx` — covered by
exactly one thing: the Playwright suite. And that suite drives **one happy path**
and one error path, takes minutes, and needs ffmpeg to segment a clip before it
can begin. It is the right tool for "the pieces are wired to each other"; it is
the wrong tool for "what does a job with an unknown total render", which is a
question about one component and a prop.

So the branches that never get exercised are the ones a user hits when something
goes wrong — which, for this product, is most of the time. A probe that finds
nothing, a DRM refusal, a live stream, a cancelled job, a retryable failure with
its `retryAfterSec`, a variant list with audio-only renditions. `job-reducer`
tests prove the _state_ is right. Nothing proves the state reaches the screen.

There is one rule this ticket exists to defend directly. **Never fake progress:**
when the total is unknown the API reports `null` and the UI must show an
indeterminate state. That is a repo-wide rule, it lives or dies in
`ProgressBar.tsx` and `JobCard.tsx`, and today the only thing standing behind it
is that someone once looked at it.

## Build

1. **Pick the DOM environment per file, not per project.** The `downloader`
   vitest project is `environment: "node"` and it should stay that way — the
   engine and the resolver suites have no business paying for a DOM. Vitest 4
   has removed `environmentMatchGlobs`, so the two live options are a
   `// @vitest-environment jsdom` docblock at the top of each rendering test, or
   a separate project entry. Choose, and say why in the Log; the docblock keeps
   `vitest.config.ts` honest, a project entry keeps the docblocks out of the
   tests.
2. **The dependencies, and no more.** `@testing-library/react` (v16 for React
   19), `@testing-library/user-event`, and `jsdom`. Add
   `@testing-library/jest-dom` only if you actually use its matchers — an
   unused matcher package is a setup file nobody reads.
3. **Query the way the e2e specs do.** `getByRole`, `getByLabel`, accessible
   names. The e2e suite already finds the variant table by `getByRole("table")`
   and the renditions by `getByRole("radio")`; a component test that reaches for
   a class name will pass while the e2e one goes red, which is the worst of both.
   It also means these tests notice an accessibility regression, which is the
   second reason to prefer them.
4. **Cover the branches, not the happy path.** The happy path has e2e. What is
   worth a test:
   - **`ProgressBar` / `JobCard` with `total: null`** — indeterminate, and
     visibly not "0%". This is the rule above, and it is the one assertion in
     this ticket that is not negotiable.
   - **`JobCard` across the statuses**, including the terminal ones and the
     `downloading → probing` back edge that [dl-9](./dl-9-fsm-reprobe-back-edge.md)
     made legal — a re-probe must not read as the job going backwards.
   - **`VariantTable`** — selection changes, an audio-only rendition, a variant
     with no resolution, and the default selection matching
     `lib/variants.ts`.
   - **`ErrorPanel`** against real `AppErrorPayload`s from the taxonomy,
     including a retryable one with `retryAfterSec` and a `DRM_PROTECTED` — the
     hard stop the user must be told about plainly.
   - **`UrlForm`** — submit disabled on an empty or invalid URL, and the
     `sourceUrlSchema` rejection surfacing rather than being swallowed.
   - **`App`** — the `USING_MOCK_API` banner (the e2e suite asserts it is
     _absent_; nothing asserts it appears when it should), and a late probe
     response from an abandoned analysis not overwriting the current one. That
     `probeToken` ref in `App.tsx` guards a real race and has no test.
5. **Use `contract` fixtures, not hand-typed objects.** Props are
   `Job`, `ProbeResult`, `MediaVariant`, `AppErrorPayload` from
   `@downloader/contract`. Build them through the zod schemas or through the
   existing mock's scenarios so a contract change breaks these tests loudly
   instead of leaving them testing a shape that no longer exists.

**Traps.**

- Do not test the mock API as though it were the product.
  `web/src/api/mock.ts` exists so the UI could ship before the backend did;
  `mock-api.test.ts` already covers it. A component test that only ever sees
  mock data proves the mock renders.
- `useElapsed`/`useNow` are clock-driven, and `web/test/helpers.ts` already has
  a fake clock. Use it. A rendering test with a real timer is a flake with a
  delay fuse.
- `jsdom` has no `EventSource`. `job-stream.test.ts` already deals with this;
  whatever it does, do the same rather than inventing a second fake.
- Keep this out of the e2e suite's way. If a component test starts needing a
  server, it has become an e2e test and belongs there instead.

## Done when

- Every component in `web/src/components/` is rendered by at least one test, and
  each of the branches listed in step 4 has one.
- A test fails if a `null` total renders as a determinate bar or as `0%`.
- The node-environment suites are unaffected: `npm test -- --project downloader`
  runs the engine, resolver and api tests in the same environment as before, and
  the whole project's wall-clock does not visibly move.
- `npm run check` is green — including the test typecheck, if
  [dl-13](./dl-13-typecheck-the-tests.md) has landed. If it has not, the `.tsx`
  test files are written as though it had.
- The gap is closed by flipping this ticket's frontmatter to `done` in the
  commit that earns it. Nothing else records it: `03-STATUS.md` is generated
  from that frontmatter and carries no hand-written gap list (repo-1).

## Review

Five gates: four **CONCERNS**, then **PASS**. Every finding addressed on this
branch before the pull request opened.

Recorded here because the reviewer's own worktree is discarded: dl-15's first
gate existed only in a scrollback and was already unrecoverable when the second
reviewer went looking for it, which is how a carried-or-dropped finding goes
missing. **The builder commits the gate.**

### Acceptance

A row per line of `## Done when`, naming what proves it. Line numbers are as of
the branch tip.

| Acceptance line                                                       | Proven by                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every component in `web/src/components/` rendered at least once       | `ProgressBar` `progress-bar.test.tsx:40` · `JobCard` `job-card.test.tsx:95` · `JobList` `job-card.test.tsx:411` · `VariantTable` `variant-table.test.tsx:56` · `ProbePanel` `probe-panel.test.tsx:86` · `ErrorPanel` `error-panel.test.tsx:60` · `UrlForm` `url-form.test.tsx:52` · `AnalysingPanel` `chrome.test.tsx:52` · `ScenarioHints` `chrome.test.tsx:123` · `ThemeToggle` `chrome.test.tsx:150` · `App` `app.test.tsx:119` |
| Step 4 — `ProgressBar`/`JobCard` with `total: null`                   | `progress-bar.test.tsx:40`, `job-card.test.tsx:95`                                                                                                                                                                                                                                                                                                                                                                                 |
| Step 4 — `JobCard` across the statuses, terminal ones included        | `job-card.test.tsx:170` (active four), `job-card.test.tsx:199` (all three terminal)                                                                                                                                                                                                                                                                                                                                                |
| Step 4 — the `downloading → probing` back edge (dl-9)                 | `job-card.test.tsx:213`; today's step-list defect pinned separately at `job-card.test.tsx:260`                                                                                                                                                                                                                                                                                                                                     |
| Step 4 — `VariantTable` selection changes                             | `variant-table.test.tsx:191`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Step 4 — `VariantTable` audio-only rendition                          | `variant-table.test.tsx:77`                                                                                                                                                                                                                                                                                                                                                                                                        |
| Step 4 — `VariantTable` variant with no resolution                    | `variant-table.test.tsx:162`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Step 4 — default selection matching `lib/variants.ts`                 | `variant-table.test.tsx:199`, and the panel actually opening there at `probe-panel.test.tsx:86`                                                                                                                                                                                                                                                                                                                                    |
| Step 4 — `ErrorPanel` retryable with `retryAfterSec`                  | `error-panel.test.tsx:76`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Step 4 — `ErrorPanel` `DRM_PROTECTED`                                 | `error-panel.test.tsx:60`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Step 4 — `UrlForm` submit disabled on empty                           | `url-form.test.tsx:52`. **Partial by design:** an _invalid_ URL does not disable submit, and should not — `url-form.test.tsx:137` pins the native `type="url"` guard that stops it instead. See the first Log entry.                                                                                                                                                                                                               |
| Step 4 — `sourceUrlSchema` rejection surfacing, not swallowed         | `url-form.test.tsx:119` (reaches the parent), `app.test.tsx:263` (becomes an `INVALID_URL` panel)                                                                                                                                                                                                                                                                                                                                  |
| Step 4 — `App`'s `USING_MOCK_API` banner                              | `app.test.tsx:119` (present when mocked), `app.test.tsx:129` (absent when not)                                                                                                                                                                                                                                                                                                                                                     |
| Step 4 — `App`'s `probeToken` race                                    | **Both arms, since gate 4.** Resolve: `app.test.tsx:142`, and the abandon path at `:239`. Reject — the likelier arm, and unproven until gate 4: `app.test.tsx:177`, and the abandon path at `:216`. Deleting either guard alone now reddens 2                                                                                                                                                                                      |
| A test fails if a `null` total renders determinate or as `0%`         | `progress-bar.test.tsx:40`, `job-card.test.tsx:95`, `chrome.test.tsx:52` — watched failing: an unconditional `value` on `ProgressBar` reddens 4 across 3 files                                                                                                                                                                                                                                                                     |
| Node-environment suites unaffected; wall clock unmoved                | `vitest.config.ts` unchanged; jsdom is a per-file docblock. Measured at gate 1: 38.25 s without the new files, 38.03 s with                                                                                                                                                                                                                                                                                                        |
| `npm run check` green, test typecheck included                        | Green at the tip. dl-13 had landed, so the `.tsx` suites are typechecked — it caught two real errors during the build                                                                                                                                                                                                                                                                                                              |
| `status: done` in this ticket's frontmatter, `03-STATUS.md` untouched | Frontmatter reads `done`; `git diff origin/main -- tools/downloader/docs/03-STATUS.md` is empty                                                                                                                                                                                                                                                                                                                                    |

### Gate 1 — 2026-08-22 — CONCERNS

Every acceptance line proven. All three gate claims reproduced, both mutation
checks confirmed, no `src` file changed.

| #   | Sev | Finding                                                                                                                                                                                                | Disposition                                                                                                                                                                                                                                                            |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | med | `variant-table.test.tsx` never exercised the component's sort: `fixtures.ts`'s `variants()` was already best-first, so deleting `sortVariantRows` from `VariantTable.tsx` left all 140 web tests green | **fixed** — position-dependent assertions mount a reversed list via `shuffled()`; the mutation now reddens 4                                                                                                                                                           |
| 2   | low | Same blind shape in `ProbePanel`'s subtitle wiring — one track per language made the `Set` dedupe untestable                                                                                           | **fixed** — third track duplicating `en`, plus a toggle-off test that `subtitleLanguages` is omitted, not `[]`                                                                                                                                                         |
| 3   | low | `ProbePanel`'s live duration asserted in the input but never on the wire                                                                                                                               | **fixed** — default asserted as `liveDurationSec: 300`; post-edit assertion moved to `toHaveBeenLastCalledWith`                                                                                                                                                        |
| 4   | low | `ThemeToggle` mounted only with `value="dark"`                                                                                                                                                         | **fixed** — loops every `THEME_CHOICES` entry                                                                                                                                                                                                                          |
| 5   | low | `JobCard`'s `active` covered at the two ends but not per status                                                                                                                                        | **fixed** — Cancel asserted inside the active loop; new test over all three terminal statuses                                                                                                                                                                          |
| 6   | low | `retryAfterSec` reached the client and nothing rendered it                                                                                                                                             | **fixed, scope grown by decision** — `presentError` surfaces it, new `formatRetryAfter`, `ErrorPanel` renders it                                                                                                                                                       |
| 7   | low | The `downloading → probing` step list walking backwards was logged as a design question                                                                                                                | **deferred** — ruled a defect, filed as [dl-18](./dl-18-pipeline-high-water-mark.md); characterization test added here so dl-18 goes red when it lands                                                                                                                 |
| 8   | low | `fixtures.ts` claimed every builder parsed through a contract schema; `progress()` and `result()` returned bare literals                                                                               | **fixed** — all seven parse                                                                                                                                                                                                                                            |
| 9   | low | `App`'s `startError`/`retryJob` shell paths uncovered; the jsdom native-validation assertion is environment-dependent                                                                                  | **accepted, and unmarked in the code** — the only trace of the uncovered paths is the string "not exercised by this suite" in `app.test.tsx`'s fake client, which names neither. The jsdom assertion _is_ commented, at `url-form.test.tsx:137`. Recorded here instead |
| 10  | —   | `03-STATUS.md` edits collide with `repo-1-retire-the-narrative`                                                                                                                                        | **reverted** — file restored byte-identical to `origin/main`; acceptance row rewritten to close by frontmatter alone                                                                                                                                                   |

Note on #6: `error-panel.test.tsx` previously asserted `not.toContain("20")` —
it pinned the _absence_ of a wait as the current answer. That test was inverted,
not deleted. An existing assertion changing meaning is worth knowing about.

### Gate 2 — 2026-08-23 — CONCERNS

Sort fix independently reproduced (4 red here, 0 red at the previous commit).
All four audit fixes mutation-tested and caught. Every bad input run against
`formatRetryAfter`; rounding confirmed never short. `03-STATUS.md` confirmed
byte-identical.

| #   | Sev | Finding                                                                                                                                                                                                                                                                                                    | Disposition                                                                                                                                                                         |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | med | A hard stop could carry a wait: `presentError` read `details.retryAfterSec` for every code, so a `DRM_PROTECTED` carrying one would print "there is nothing to retry" above "wait 20 s before trying again". Not reachable from today's API                                                                | **fixed** — vetoed in `presentError` (`entry.allowRetry ? … : null`), not gated in the panel, so one place decides; tests cover DRM specifically and every `allowRetry: false` code |
| 2   | med | Fifth blind assertion: `fixtures.ts`'s `job()` always supplied a variant, so `JobCard`'s title fallback chain never left its first branch. The API inserts `variant_json` as `NULL`, so every real job is `variant: null` until the probe fills it — the fixture emitted a shape the server cannot produce | **fixed** — `job()` gives `queued` a null variant; three tests, one per branch; the `?? "untitled"` mutation now reddens 2                                                          |
| 3   | low | `formatRetryAfter` unclamped: `1e9` → `"16666667 min"`, `Number.MAX_VALUE` → exponential notation as UI copy                                                                                                                                                                                               | **fixed** — capped at 24 h with "more than a day" past it, hours unit added, `59.6` → `"1 min"` boundary settled                                                                    |
| 4   | low | The Log overstated the `ThemeToggle` gap — the `system` case was already caught; the real gap was `light`, never mounted                                                                                                                                                                                   | **fixed** — sentence corrected in the Log                                                                                                                                           |
| 5   | low | An existing test changing meaning (gate 1 #6) should be findable                                                                                                                                                                                                                                           | **fixed** — recorded under gate 1 above                                                                                                                                             |
| 6   | —   | Acceptance row still referenced editing `03-STATUS.md`                                                                                                                                                                                                                                                     | **fixed** — replaced with repo-1's wording; closes by frontmatter alone, no contact with the file                                                                                   |

### Gate 3 — 2026-08-23 — CONCERNS

Every mutation claim from gate 2 reproduced. The full `formatRetryAfter` battery
re-run: nothing throws, no output matches `/e[+-]/i`, and every numeric output
re-parsed is `>=` its input — the bucketing rewrite did not make it round short.
The `allowRetry` veto loop confirmed to have per-code granularity by leaking one
code and getting exactly 1 red. The gate-1 record checked against branch history
and found accurate.

| #   | Sev  | Finding                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                   |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | med  | Sixth blind assertion: `JobList.tsx`'s `streamState={streamStates[job.id]}` proven by nothing — the fixture said `{ "job-1": "open" }`, and `"open"` is the one value that renders nothing, so `streamState={undefined}` passed all 154 tests | **fixed** — `job-card.test.tsx:449` uses `{ "job-2": "reconnecting" }` and asserts the pill in the second card and absent from the first; `undefined` and an index-keyed lookup each redden 1 |
| 2   | low  | Same shape at `ProbePanel.tsx`'s `cached` badge — only the true branch asserted                                                                                                                                                               | **fixed** — `probe-panel.test.tsx:107`                                                                                                                                                        |
| 3   | low  | Same shape at `VariantTable.tsx`'s `row.hasVideo && row.fps !== "—"` guard                                                                                                                                                                    | **fixed** — `variant-table.test.tsx:98` and `:109`, both directions                                                                                                                           |
| 4   | low  | `retryable` and `retryAfterSec` gated on different expressions, so a `RATE_LIMITED` the server marked `retryable: false` still rendered a wait                                                                                                | **fixed** — one `retryable` const now gates both; `error-panel.test.tsx:156` pins the combination                                                                                             |
| 5   | low  | `## Review` had no acceptance table, which `docs/01-TICKETS.md` says is what the section is                                                                                                                                                   | **fixed** — added above, a row per `## Done when` line with `file:line`                                                                                                                       |
| 6   | low  | Gate 1 row #9's disposition overstated: nothing names `App`'s uncovered `startError`/`retryJob` paths                                                                                                                                         | **fixed** — row corrected below                                                                                                                                                               |
| 7   | low  | First Log entry's figures stale at the tip                                                                                                                                                                                                    | **fixed** — marked as dated to their own commit rather than re-corrected                                                                                                                      |
| 8   | info | `ErrorPanel.tsx`'s "only ever a phrase the server supplied" — it is _derived_ from the server's number                                                                                                                                        | **fixed** — comment corrected                                                                                                                                                                 |

**The sweep asked for found three more, all the same shape**, and one of them is
not cosmetic:

- `VariantTable.tsx`'s `row.hasAudio ? row.audioCodec : "none"` — every fixture
  variant had audio one way or another, so dropping the guard left the suite
  green. **Corrected at gate 4:** this entry originally claimed the mutant would
  advertise a codec for a silent file. It cannot — `toVariantRow` derives
  `audioCodec` and `hasAudio` from the same predicate, so a row with no audio
  always has `audioCodec === UNKNOWN` and the mutant renders `—`. The true and
  smaller reason to keep the test: `—` means "we do not know", which is a
  different claim from "this has no sound". Fixed at `variant-table.test.tsx:121`.
- `JobCard.tsx`'s `segmentsTotal === null` branch — collapsing it printed the
  literal string `"null"` at a user. Fixed at `job-card.test.tsx:145`.
- `JobCard.tsx`'s `result.durationSec !== null` branch — a trailing ` · —`.
  Fixed at `job-card.test.tsx:161`.

That is eight instances of one shape across the gates so far: **a fixture whose
value makes a branch unobservable.** Every one was a green suite over an untested
seam, and none was found by reading the tests — only by mutating the source and
watching what stayed green. (Written at gate 3, when three had run. The running
count is reconciled in the gate-4 entry below.)

### Gate 4 — 2026-08-23 — CONCERNS

**79 branch sites, 89 mutations, 31 survivors.** All five prior-gate claims
reproduced. The gate-3 `JobList` fix confirmed load-bearing by a second route:
replacing its two-sided assertion with a single "pill exists somewhere" check
under the index-keyed mutant went 21/21 green, so the `toBeNull()` on the other
card is the half doing the work.

| #   | Sev  | Finding                                                                                                                                                                                                                                                                                               | Disposition                                                                                                                                                                                        |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | med  | `JobCard.tsx`'s pill _value_ unproven — gate 3 proved the lookup, not the comparison. `streamState !== undefined` left 162 green, which would put a permanent "reconnecting…" pill on every healthy stream. The irony is exact: the gate-3 fix removed the only fixture that supplied a healthy value | **fixed** — `job-card.test.tsx:371` mounts all four healthy states plus `undefined`; the mutant reddens 1                                                                                          |
| B   | med  | `JobCard.tsx`'s `segmentsDone === null → UNKNOWN`, the twin of the branch fixed at gate 3. Collapsing it renders `Segmentsnull`, and `fixtures.ts` defaults `segmentsDone: null` so nearly every card takes it                                                                                        | **fixed** — `job-card.test.tsx:133`; a new `stat()` helper reads a named row rather than hunting a dash anywhere on the card                                                                       |
| C   | med  | The probe race half-proven: both race tests only ever _resolved_. Deleting the `catch`-side `probeToken` guard alone left 162 green — and a slow probe is likelier to reject than to succeed late                                                                                                     | **fixed** — `app.test.tsx:177` and `:216`; the catch-side mutant reddens 2. Log sentence and acceptance row both corrected                                                                         |
| D   | low  | The gate-3 headline claim — that the `hasAudio` mutant advertises "AAC" for a silent file — is not reachable: `toVariantRow` derives `audioCodec` and `hasAudio` from the same predicate, so the mutant renders `—`                                                                                   | **claim corrected, test kept** — verified by rendering the mutant (`Received: "—"`). The vacuous `not.toContain("AAC")` is gone; the assertion now targets the audio cell and pins `none` over `—` |
| E   | low  | `chrome.test.tsx`'s "narration follows the clock" did not assert the narration — all five stage texts render at every elapsed time. Freezing `activeIndex` left 162 green                                                                                                                             | **fixed** — an `activeStage()` helper reads the marked stage across three points on the clock; the mutant reddens 1                                                                                |
| F   | low  | The dated-figures marking was itself stale at the commit that wrote it                                                                                                                                                                                                                                | **fixed** — it names no live figure now, and says why                                                                                                                                              |
| G   | low  | The pipeline's `--done`/`--active` classes asserted nowhere positively; both predicates could be `false` with 162 green                                                                                                                                                                               | **fixed** — `job-card.test.tsx:238` pins all five steps for a forward-running job; the mutant reddens 1                                                                                            |
| —   | info | `ProbePanel.tsx`'s default-variant `useEffect` untested; `App.tsx`'s `url.trim() !== ""` half and its `busy=` wiring survive                                                                                                                                                                          | **recorded, not fixed** — see the survivor paragraph in the Log                                                                                                                                    |

### Gate 5 — 2026-08-23 — PASS

All three gate-4 mediums reproduced independently, plus four further mutations.
The D correction verified by rendering the mutant a second time
(`Expected: "none" / Received: "—"`). `stat(label)` confirmed to read a genuinely
named `<dt>`/`<dd>` pair rather than a positional guess. No source file changed.
**All 36 citations in this section resolved**, not the six the gate asked for.

| #   | Sev  | Finding                                                                                                                                                                                                                        | Disposition                                                                                                                                                           |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | info | Three citations in the gate-3 subsection stale — this round's own `+66` lines moved their targets, landing two of them mid-body in other tests                                                                                 | **fixed** — `:379` → `:445`, `:122` → `:145`, `:139` → `:161`. Not a dating convention: the other gate-3 citations _were_ refreshed, so these three were an oversight |
| 2   | info | The healthy-stream test's "not passing because the pill row vanished" over-credited its assertion — deleting the whole `pills` block left that test green, since a progressbar proves the card body rendered, not the pill row | **fixed by making it true** — asserts the status label appears twice (pipeline + pill). Deleting the block now reddens 3 where it reddened 2                          |
| 3   | info | "Eight instances across four gates" (gate 3) and "1, then 4, then 3, then 3" (gate 4) disagree; the per-gate tally is not reconstructible from these tables                                                                    | **reconciled in the Log** — neither number is load-bearing, no third invented, and what survives is stated plainly                                                    |

**PASS.** Every acceptance line proven; nothing outstanding above `info`.

## Log

### 2026-08-22 — built

Eight rendering suites under `web/test/`, plus a `fixtures.ts` that builds every
prop through the contract's own zod schemas. Every component in
`web/src/components/` and `App` itself is now rendered by at least one test:
`progress-bar`, `job-card` (with `JobList`), `variant-table`, `probe-panel`,
`error-panel`, `url-form`, `chrome` (`AnalysingPanel`, `ScenarioHints`,
`ThemeToggle`) and `app`. 543 tests across 37 files → **611 across 45**, and the
project's wall clock did not move: 38.25 s without the new files, 38.03 s with
them. The suite's time is the browser sniffer's and always was.

**Every figure in this entry is as of its own commit** (`29e2710`) and is not
maintained afterwards. Later review rounds added tests; for the count at any
point, run the suite. A Log entry is a record of what was true when it was
written, and re-editing its numbers each round would turn it into a status page —
the one thing a ticket Log is not.

(The first attempt at this marking quoted the then-current tip figure, which was
stale in the same commit that wrote it. Naming a live number is the failure the
marking exists to prevent, whichever paragraph it appears in.)

**The environment is a docblock, not a project** (step 1). `// @vitest-environment
jsdom` at the top of each rendering file. A project of its own would have had to
be carved back out of the `downloader` project's glob or both would collect the
same files — two owners and no authoritative answer, which is the shape
`tsconfig.tests.json` already warns about for the compiler. It is also what
pl-12 chose, so the two tools' `web` suites read the same way. The node suites
are untouched and still `environment: "node"`.

**Dependencies:** `@testing-library/react`, `@testing-library/user-event`,
`@testing-library/dom` and `jsdom`, at the versions `@planner/web` already
pins, so the lockfile gained nothing new. No `jest-dom` — no matcher from it is
used.

**Config: nothing needed changing.** The brief's area line names
`vitest.config.ts` and `web`'s devDependencies; only the second moved.
`tools/downloader/web/test/tsconfig.json` already existed, the root
`tsconfig.tests.json` already excluded that path, and the root `tsconfig.json`
already referenced it — dl-13 landed the whole `web` compiler surface ahead of
this ticket, and its own comment says so ("The DOM half starts paying when
dl-15's component tests land"). It now pays: two real type errors surfaced at
`npm run check` and were fixed in the tests, `JobListResponse.total` missing
from a fake and `JobCardProps.streamState` being required-but-`undefined`
rather than optional under `exactOptionalPropertyTypes`.

**Both non-negotiables were watched failing.** Replacing `ProgressBar`'s
conditional `value` with an unconditional one turns four tests red across three
files; deleting the two `probeToken.current !== token` guards in `App.tsx` turns
both race tests red. The sources were restored — this ticket changed no
component.

### What the brief had wrong

- **`helpers.ts`'s fake clock does not reach these components.** The trap says to
  use it for `useElapsed`/`useNow`. `createFakeClock` implements the injectable
  `Clock` from `lib/clock.ts`, which `job-stream` takes as an option — but both
  hooks call `Date.now()` and `setInterval` directly and accept no clock. The
  equivalent is `vi.useFakeTimers()` + `vi.setSystemTime`, which `job-card` and
  `chrome` use. The warning was right, the mechanism was not.
- **`retryAfterSec` is not a field on `AppErrorPayload`.** It rides in `details`,
  which `api/src/http-errors.ts` allowlists through to the client. And nothing
  renders it: `presentError` never reads `details`, so a rate-limited user is
  told to try again without being told when. **Fixed in this ticket** on review —
  see the second Log entry below.
- **An invalid URL does not disable submit.** Step 4 asks for "submit disabled on
  an empty or invalid URL"; the button is disabled by an _empty_ field and by
  `busy`, and that is right — a button that silently refused to depress explains
  nothing. Two other guards do the work instead, and both are now pinned: the
  field is `type="url"`, so native constraint validation stops a string that is
  not a URL before React sees the submit, and a scheme the browser accepts but
  `sourceUrlSchema` does not (`ftp://…`) reaches `App` and comes back as an
  `INVALID_URL` panel.
- **The `downloading → probing` back edge does move the pipeline list backwards.**
  The card marks "Downloading" as no longer done while the job re-probes. What
  the test pins is the claim that can be defended without changing the
  component: the bytes already fetched are still reported, the stage carries
  dl-9's own copy about expiring links, and nothing on screen reads as a failure
  or a reset. I called the step list a design question; on review it was ruled a
  defect and filed as
  [dl-18](./dl-18-pipeline-high-water-mark.md) — see the second Log entry below.
- **`FILE_EXPIRED` is not `final`,** so an expired result renders `role="alert"`
  rather than `role="status"`. Worth knowing before writing the assertion.
- Testing `App` needs `vi.resetModules()` and a dynamic import, because
  `USING_MOCK_API` is a module-level const and one `vi.mock` can only express
  one answer. The consequence is subtle and cost a debugging pass: `AppError`
  imported statically by the test is then a _different class object_ from the
  app's, `instanceof` fails inside `AppError.from`, and every rejection reaches
  the screen as `INTERNAL`. The fake client takes its `AppError` from the same
  fresh registry; the comment in `app.test.tsx` says so.

### 2026-08-23 — review round (CONCERNS → addressed)

Reviewed at CONCERNS: one med, five low, every acceptance line proven and both
mutation checks reproduced. Five things came back; all five are done.

**The med: one blind assertion, and it was the interesting kind.** The reviewer
ran eleven mutations and caught ten. The eleventh — deleting
`sortVariantRows(...)` from `VariantTable.tsx` — left all 140 web tests green,
because `fixtures.ts`'s `variants()` is written best-first (the order a resolver
returns) and every row-index assertion in `variant-table.test.tsx` inherited
that. The component's _use_ of the sort was the one seam only a render test can
see, and the suite was not looking at it.

Fixed by mounting a deliberately reversed list — a `shuffled()` helper — in
every assertion that depends on row position. Re-ran the mutation: **4 tests now
fail** where 0 did. `presentation-helpers.test.ts` still covers the sort
function itself; these now cover the component calling it.

**The audit that came with it** turned up four more assertions of the same
shape, three of them named by the reviewer:

- **`ProbePanel` subtitles.** The fixture had one track per language, so
  `map(t => t.language)` and `[...new Set(map)]` return the same array and the
  dedupe was untestable. Added a third track duplicating `en` — three tracks,
  two languages — plus a new test that turning the checkbox off omits
  `subtitleLanguages` entirely rather than sending `[]`, which is what
  `JobOptions` documents.
- **`ProbePanel` live duration.** The default was asserted as a number in the
  box but never on the wire. Added an assertion that the untouched default
  emits `liveDurationSec: 300`, and changed the post-edit assertion to
  `toHaveBeenLastCalledWith` — with two calls on the spy, "some call matched"
  would have passed even if the edit changed nothing.
- **`ThemeToggle`.** I first wrote this up as "a `checked` hard-coded against one
  value would have passed", which overstates it: the controlled-ness half already
  mounted with `system`, so that case was caught before the fix. The real gap was
  narrower — `light` was never mounted at all, so nothing exercised the middle
  choice in either direction. Now loops over every `THEME_CHOICES` entry, for
  both the marking and the controlled-ness check.
- **`JobCard`'s `active`.** Covered at the two ends but not per status. Cancel's
  presence is now asserted inside the active-status loop, and a new test walks
  all three terminal statuses asserting no Cancel, no pipeline, no bar and a
  surviving Remove.

**`retryAfterSec` is now rendered** (`ErrorPanel`, `presentError`, and a new
`formatRetryAfter` in `format.ts`), rather than deferred as the first Log entry
proposed. `presentError` reads exactly one allowlisted field out of `details`,
by name and only when it is a positive finite number — which is not the
"rendered verbatim" that `AppErrorPayload` warns against. Rounded up, because
telling someone to wait 20 s when the server said 20.4 buys one more refusal.
`null` when the server said nothing usable, and the panel then renders no line
at all: guessing a wait is the never-fake-progress rule failing sideways.
Watched failing — deleting the line from `ErrorPanel` reddens 3 tests.

**dl-18 filed** at
[`dl-18-pipeline-high-water-mark.md`](./dl-18-pipeline-high-water-mark.md),
`kind: fix`, `status: ready`. The back edge un-marking "Downloading" is a defect,
not a design question, and the specified behaviour is a high-water mark. The
ticket also carries the smaller thing found while writing it: the step list has
**no accessible state at all** — done/active/pending are CSS classes with no
`aria-current` and no name change — which is why the characterization test has
to assert on `className` and says so. `job-card.test.tsx` now carries an
explicit `CHARACTERIZATION (dl-18)` test pinning today's wrong behaviour, so
dl-18 has something that goes red when it lands; the ticket says to replace it
with its inverse rather than delete it. **dl-18 is not implemented here.**

**Fixture honesty.** `progress()` and `result()` returned bare literals under a
docblock claiming every builder parses through a contract schema. They now go
through `jobProgressSchema` and `jobResultSchema`, and the hand-assembled
`reprobing` Job literal in `job-card.test.tsx` is built with `job("probing", …)`
instead. All seven builders parse; the docblock says so and is now true.

**The `03-STATUS.md` half of "Done when" was retired, not satisfied — and that
is deliberate.** This ticket's acceptance says the "no component-render tests"
entry leaves `03-STATUS.md`. It does not leave it here: every edit I made to
that file has been reverted to `origin/main`. `repo-1`, on
`repo-1-retire-the-narrative`, deletes the whole `## Known gaps and risks`
section — that stale sentence included — and rewrote this ticket's acceptance so
it closes by frontmatter alone. Two branches editing the same prose would have
collided for no gain. So the sentence stays visibly false on `main` until repo-1
lands, which is accepted rather than overlooked: a future reader comparing the
criteria to the diff has not found a skipped step.

No `src` file was changed for testability. The three source files this entry
does touch — `ErrorPanel.tsx`, `error-presentation.ts`, `format.ts`, plus a
style rule — are the `retryAfterSec` feature the review asked for, not test
scaffolding.

### 2026-08-23 — second review round

Both med findings fixed and mutation-verified, plus the clamp and the process
change. Details are in `## Review` above; what is worth writing down here is the
reasoning, not the list.

**A hard stop must not carry a wait, and the veto belongs in one place.**
`presentError` read `details.retryAfterSec` for every code, so a `DRM_PROTECTED`
carrying one would have printed _"There is nothing to retry — the answer will not
change."_ directly above _"Wait 20 s before trying again."_ Today only
`RATE_LIMITED` sets the field, so it was not reachable — but `details` is
server-supplied and the whole point of `ERROR_PRESENTATION`'s `allowRetry` is
that a buggy or hostile server must not be able to put a retry in front of a
refusal. The gate went in `presentError`
(`entry.allowRetry ? readRetryAfterSec(…) : null`) rather than in `ErrorPanel`,
so the same table vetoes the button and the wait together and a second renderer
of an `ErrorView` cannot reintroduce the contradiction. Tested twice: DRM
specifically, and a loop over every `allowRetry: false` code in the taxonomy —
the veto is a property of the table, not of one entry.

**The fifth blind assertion had a production tell, which is what made it worth
more than a test fix.** `job()` always supplied a variant, so `JobCard`'s
`variant?.label ?? result?.filename ?? sourceUrl` never left its first branch —
replacing the whole chain with `?? "untitled"` left all 147 web tests green. The
API inserts its `variant_json` column as a literal `NULL`, so **every real job is
`variant: null` from creation until the probe fills it in**: the branch a queued
card actually takes in production was the one nothing reached, and the fixture
was emitting a shape the server cannot produce. `job()` now gives `queued` a null
variant and three tests cover one branch each. The mutation reddens 2.

**`formatRetryAfter` was numerically fine and typographically not.** It never
told anyone to wait less than the server asked — the reviewer ran the bad inputs
and confirmed it — but `1e9` rendered as `"16666667 min"` and
`Number.MAX_VALUE` rendered in **exponential notation, as user-facing copy**.
The value comes off the network, so that is a server bug or a hostile response
away. Capped at 24 h with "more than a day" past it, an hours unit added that
carries its minutes the way `formatExpiry` does, and the `59.6` boundary settled
by rounding to whole seconds once up front — so nothing reads "60 s" or
"60 min". Every rounding step is still upward: coarse near a boundary (61 s is
"2 min"), never short.

**The gate record is now committed, and that is a process change rather than a
fix to this ticket.** Reviews were being written in throwaway worktrees and
discarded with them — dl-15's first gate no longer existed anywhere by the time
the second reviewer looked for it, so nothing could be checked for findings
carried or quietly dropped between rounds. `## Review` above records both gates,
one line per finding with its disposition. `docs/01-TICKETS.md` already describes
that section and says it is written by the review; what was missing was anyone
committing it.

**The `03-STATUS.md` acceptance row is now repo-1's wording** rather than my
paragraph explaining why I could not satisfy the old one. The line closes by
frontmatter, which is what ADR 003 says state is, and it touches the file not at
all — so it stays true whichever of the two branches lands first.

### 2026-08-23 — third review round

One med, several lows, and a sweep. Dispositions are in `## Review`; the part
worth keeping is what the sweep showed.

**The blind-fixture shape is not a series of accidents.** Four gates have now
found it eight times, and every instance is the same sentence: _the fixture
supplies the one value that makes the branch unobservable._ `variants()` was
already sorted, so the sort was never exercised. `job()` always carried a
variant, so the title fell through its first branch. `streamStates` said
`"open"`, and `"open"` is precisely the value that renders nothing — only
`"reconnecting"` produces a pill, so `streamState={undefined}` passed all 154
tests. Every variant in the fixture had audio, so a silent rendition never
rendered "none". `segmentsDone` and `segmentsTotal` were always set together, so
the half-known case never printed. And so on.

What makes this worth writing down rather than just fixing: **none of the eight
was findable by reading the tests.** Each one reads as a perfectly good
assertion, and each one passes for the wrong reason. The only thing that found
them was mutating the source and watching what stayed green. A component test
suite that has never been mutation-checked should be assumed to contain this
shape, because a fixture is written to look plausible and "plausible" is exactly
the state in which every branch agrees with the default.

The tell to look for, next time: **a fixture value that is also the component's
no-op.** `"open"` for a stream state, a sorted list for a sorter, a present
optional for a fallback chain, `null` on both halves of a pair. Where the
default and the interesting case coincide, the seam is invisible.

**On the three the sweep found** — and one sentence here was wrong, corrected in
the entry below. I argued that dropping
`row.hasAudio ? row.audioCodec : "none"` makes a rendition advertise a codec, so
a user picks "AAC" and gets a silent file. It does not: `toVariantRow` computes
`audioCodec` and `hasAudio` from the identical predicate, so no-audio implies
`audioCodec === UNKNOWN` and the mutant renders `—`. I reached for the most
alarming reading of a mutant without rendering it. The real reason the test
earns its place is quieter: `—` says "we do not know", `none` says "there is no
sound", and only the second answers the question a user is asking. The other two
are as described — `"120 / null"` rendered at a user, and a trailing ` · —` on a
finished file of unknown duration.

**`retryable` and `retryAfterSec` now read one expression**, which is what my
gate-2 Log entry claimed and the code did not quite do. The taxonomy veto was
there; the payload flag was not, so a `RATE_LIMITED` the server itself marked
`retryable: false` still rendered "wait 20 s before trying again" with nothing to
press. Both are the same question — should this error offer another attempt? —
so both read the same answer now. The deliberate case survives untouched: a
panel with no `onRetry` wired still shows the wait, because the view says a retry
is possible and only this particular renderer has no button for it.

**`## Review` gained the acceptance table** `docs/01-TICKETS.md` says the section
is. Two gates of finding tables were half the record: a later reader could see
what was wrong but not what was covered, which is the half that makes the
section worth committing. One row per `## Done when` line, with `file:line`.
One row is honest about being partial — "submit disabled on an empty or invalid
URL" is only true of the empty half, and the row says which test pins the guard
that handles the other.

### 2026-08-23 — fourth review round

Three mediums, all the hunted shape; four lows; and the first sweep large enough
to say where it stopped.

**A: closing one seam removed the fixture that exercised another.** Gate 3 proved
`JobList` looks the stream state up by job id, and to do it the fixture changed
from `{ "job-1": "open" }` to `{ "job-2": "reconnecting" }`. That deleted the
only healthy value in the suite — so `streamState === "reconnecting"` could be
mutated to `streamState !== undefined` with all 162 tests green, putting a
permanent orange "reconnecting…" pill on every job with a working stream.
`useJobs` writes every `StreamState` into that record, so healthy is the common
case and the mutant is a permanently-on warning. This is worth more than its fix:
**a fix can create the next blind spot**, because a fixture edited to exercise
one branch stops exercising the branch it used to cover. Nothing in a green suite
says so.

**B is the twin of a branch I fixed last round**, and I did not think to look
next door. `segmentsTotal === null` got a test; `segmentsDone === null` did not,
though it is the arm the default fixture takes on nearly every card. The mutant
renders `Segmentsnull`. When a ternary turns out to be untested, its sibling
arm and its neighbouring ternary are the two cheapest next places to look.

**C: I tested the easy half of a race and wrote the Log as though I had tested
both.** Both probe-race tests resolve; neither rejected, so the `catch`-side
`probeToken` guard was unguarded by anything. And the reject arm is the _likelier_
one — a slow site times out more often than it succeeds late, which is exactly
the case the user creates by pressing "Stop waiting" or pasting a second URL.
Unguarded, that late rejection wipes the live analysis and shows an error
belonging to an abandoned one. Two tests added; the first Log entry's "deleting
the two guards turns both race tests red" was true of the pair and false of
either alone, and the acceptance row now names all four tests and both arms.

**D: I reached for the most alarming reading of a mutant instead of rendering
it.** I claimed dropping `hasAudio ? audioCodec : "none"` makes a user pick "AAC"
and get a silent file. `toVariantRow` computes both from the same predicate, so
that cannot happen — the mutant renders `—`, which I would have seen in a second
by running it. The test survives on the true and smaller argument: `—` means "we
do not know", `none` means "there is no sound", and only the second answers what
the user is asking. **A test justified by a story is only as good as the story,
and mine was not checked.**

### Where the sweep stopped

**31 of 89 mutations survived**, and I am deliberately leaving them. The classes:

- **CSS-only classes already covered semantically** — `variants__row--on`
  (the radio's `checked` covers it), `themetoggle__on` (likewise),
  `notice--final` (`role` covers it), `pill--${status}`, `job--${status}`. Each
  is a class name carrying no information a test can get at except by naming the
  class, and in each case the meaning is asserted at role level already.
- **Defensive branches nothing feeds a hostile value** — clamping and
  `Number.isFinite` guards reachable only from a malformed payload, several of
  them already covered at the `lib/` level where they live.
- **Three named in the gate-4 record as info**: `ProbePanel`'s default-variant
  `useEffect` (analysing a second page keeps the first page's `variantId` — a
  real gap, and the most likely next ticket), `App`'s `url.trim() !== ""` half,
  and `App`'s `busy=` wiring.

The reviewer's own conclusion, plainly: **"none left" is not true, and "none left
of the kind that reaches a user" is not true either.** Every gate so far has found
more of this shape, and the rate is not obviously falling. What is written down
here is where this sweep stopped, not that it finished.

**On the running count:** this entry first said "1, then 4, then 3, then 3", and
the gate-3 entry says "eight". Both are defensible and they disagree, because
they count different things — whether an audit sweep requested _by_ a gate counts
as that gate's finding or the next round's work — and the per-gate tally is not
reconstructible from the gate tables, which record dispositions rather than
classifications. So neither number is load-bearing and I am not inventing a third.
What holds regardless: **each of the four gates found more, none found none, and
the last one still found three.** A record of the boundary is worth more than a claim of completeness,
because the next person to touch these tests can start from the survivors instead
of rediscovering them.

### 2026-08-23 — fifth gate: PASS

Three informational notes, two fixed and one reconciled. Two are worth a sentence
each.

**The rot this ticket is about turned up inside the record that exists to prevent
it.** Three citations in the gate-3 subsection were true when written and stopped
being true when this round added 66 lines above their targets — two of them now
landed mid-body in unrelated tests. Not a dating convention, and I cannot claim it
was: I refreshed the _other_ gate-3 citations in the same edit and missed these
three. A `file:line` citation is a fixture in exactly the sense the rest of this
ticket has been about — correct at the moment of writing, silently wrong
afterwards, and never noticed by anything that runs. The lesson is small and
mechanical: **when a round adds tests, re-resolve every citation in the record,
not the ones it happens to touch.**

**A negative assertion needs something positive beside it.** The healthy-stream
test said "this is not passing because the pill row vanished" and the progressbar
assertion beside it did not prove that — deleting the entire `pills` block left
that test green, because a progress bar proves the card body rendered and nothing
about the row the pill lives in. The suite still caught the deletion elsewhere, so
this was over-crediting rather than a hole; the fix was to make the sentence true
rather than soften it, by asserting the status label appears twice — once in the
pipeline, once in the pill. Deleting the block now reddens three tests instead of
two. The general form is worth keeping: **`queryBy…()).toBeNull()` passes just as
happily when the markup is gone, so it needs a companion that fails in that case.**

The running-count discrepancy is reconciled in the gate-4 entry above rather than
resolved: the two numbers count different things, the per-gate tally cannot be
rebuilt from tables that record dispositions rather than classifications, and
inventing a third number to make them agree would be worth less than saying so.
