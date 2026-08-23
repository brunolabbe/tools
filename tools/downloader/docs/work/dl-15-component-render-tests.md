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
- The "no component-render tests in `web`" entry leaves
  [03-STATUS.md](../03-STATUS.md).

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
- **`ThemeToggle`.** Mounted only with `value="dark"`, so a `checked` hard-coded
  against one value would have passed. Now loops over every `THEME_CHOICES`
  entry, both for the marking and for the controlled-ness check.
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
