---
id: dl-15
tool: downloader
title: Render the UI's components in tests, not only its logic
kind: chore
status: ready
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

_Not started._
