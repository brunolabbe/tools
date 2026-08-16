---
id: pl-12
tool: planner
title: Render the wizard's components in tests, not only the routes under them
kind: chore
status: done
milestone: null
depends_on: [pl-7]
---

# pl-12 — Nothing renders the wizard

**Area:** a new `tools/planner/web/test/`, `vitest.config.ts`,
`tsconfig.tests.json`, the root `tsconfig.json`, and `web`'s devDependencies.

## Why

[pl-7](./pl-7-intake-persistence-and-wizard.md) shipped roughly 1,100 lines of
`.tsx` — the wizard, eight controls, the brief panel, the trip list — and
**`tools/planner/web` has no test directory at all.** The 24 tests that ticket
added are API tests: they prove the server computes the right answer. Nothing
proves the answer reaches the screen.

That gap lands on the two behaviours this tool's `CLAUDE.md` states as rules,
both of which are UI claims:

- **"Never discard an answer silently."** The server returns what a change would
  discard; the browser is what must refuse to write until the user has seen the
  list, by prompt and never by id. `Wizard.tsx` previews before every write but
  the first, and the only thing standing behind that today is that someone once
  read it.
- **"The intake stops at the core questions."** `nextQuestion` returns
  `coreComplete` and a route test asserts it agrees with `missingRequiredSlots`.
  Whether the wizard then renders a checkpoint — rather than marching on — is a
  question about one component and a prop, and no test asks it.

The branches most worth covering are the ones a user only meets when something
is at stake: a `core` question must not offer "Not important" (the engine
refuses a declined core answer, so the button would be a lie), a discarded
answer with a **null** prompt must read as "some earlier answers no longer
apply" rather than printing `road-trip.drive-hours` at somebody, and a partly
filled `dates` or `budget` composite must leave the button disabled instead of
submitting half an answer.

## Build

1. **The compiler surface, which is the part with a documented trap.** A `web`
   test directory needs `moduleResolution: "Bundler"`, the DOM lib and `jsx`, so
   per the root `CLAUDE.md` it gets its own `tools/planner/web/test/tsconfig.json`
   beside the downloader's, a **concrete** path added to `tsconfig.tests.json`'s
   `exclude`, and a reference from the root `tsconfig.json`. Read the comment on
   that `exclude` before touching it: `tools/*/web/test/**` is the tempting
   version and it is the trap, because it silently excludes a `web` suite in a
   tool that has no project to catch it — which is this tool, today.
2. **The DOM environment, per file or per project.** The `planner` vitest project
   is `environment: "node"` and should stay that way; the API suite has no
   business paying for a DOM. Vitest 4 removed `environmentMatchGlobs`, so the
   options are a `// @vitest-environment jsdom` docblock per rendering test or a
   separate project entry. **dl-15 faces exactly this choice for the downloader** —
   whichever of the two tickets lands first sets the pattern, and the second should
   follow it rather than pick again.
3. **The dependencies, and no more.** `@testing-library/react` (v16 for React 19),
   `@testing-library/user-event`, `jsdom`.
4. **Query by role and accessible name**, never by class. The controls were built
   with a `legend` per fieldset and a `label` per input for exactly this.
5. **What to cover**, in the order the risk sits:
   - `QuestionCard` offers no "Not important" on a `core` question and does offer
     it on a `refine` one.
   - `Wizard` renders `ConfirmDiscard` and does **not** call the write until the
     user confirms — fake the client module, assert the call never happened.
   - A `DiscardedAnswer` with `prompt: null` renders the unnamed sentence.
   - `Checkpoint` renders when `coreComplete` is true with a question still to
     ask, and both ways on are offered.
   - Each of the eight kinds round-trips: seed `initial`, read it back, change it,
     and assert the `AnswerValue` handed up. `dates` and `budget` carry the
     weight — the other six are one input each.

## Done when

- `npm test -- --project planner` renders components, and `npm run check`
  typechecks the new suite under the `web` surface rather than the node one —
  provably: a `document` reference in an API test still fails to compile.
- Removing the preview call in `Wizard.tsx` makes a test go red.

## Traps

**Fake the API client, not `fetch`.** `web/src/api/intake.ts` is the seam and it
is one module; stubbing `fetch` means re-implementing route shapes in a test,
which is a second copy of the server to keep in step.

**Do not assert the tree.** Which questions exist and what an edit discards are
the server's, and a component test that builds its own `QUESTION_TREE` is
asserting a fixture. Hand components the `IntakeState` the server would return.

## Log

**2026-08-16 — done.** `tools/planner/web/test/` exists and holds 21 tests over
two files plus a fixture module. `npm test -- --project planner` is 351 tests
across 27 files, up from 330 across 25, and `npm run check` is green.

**The jsdom pattern, since dl-15 has not landed.** A `// @vitest-environment
jsdom` docblock at the top of each rendering file, and **no change to
`vitest.config.ts` at all** — which is the one line of the brief's Area that
turned out to be wrong. The `planner` project's `include` is
`tools/planner/*/test/**/*.test.{ts,tsx}` and it already collects a `.tsx` file
under `web/test`, so the suite needed nothing added; a project entry of its own
would have had to be carved back out of that glob to stop both collecting the
same files, which is the same "two owners and no authoritative answer" shape
`tsconfig.tests.json` warns about for the compiler. The API suite keeps
`environment: "node"` and pays nothing. **dl-15 should follow this** rather than
pick again: its own project's glob has the same shape, and one repo with two
answers to "how does a test get a DOM" is worse than either answer.

**The compiler surface.** `tools/planner/web/test/tsconfig.json` is the
downloader's twin, `tsconfig.tests.json`'s `exclude` gained the concrete second
path, and the root `tsconfig.json` gained the reference. The carve-out is
load-bearing here in a way the downloader's is not, and it was measured rather
than assumed: dropping `tools/planner/web/test/**` from that `exclude` fails the
build with TS17004 (JSX with no `jsx` option), TS2339 on `HTMLInputElement`, and
a TS6307 that spreads into `web/src` — where the downloader's carve-out is still
green when dropped. Its comment now says so, and the header's "four surfaces,
five projects" is now six: the `web` surface has become the second one two tools
share, for exactly the reason the Playwright one does. Root `CLAUDE.md`'s
matching count went from four files to five.

**The negative direction is checked too.** A `document` reference in
`tools/planner/api/test/` still fails TS2584, so the split is enforced in both
directions and not merely declared.

**Removing the preview call turns three tests red**, as the acceptance asked —
verified by deleting the `previewAnswer` block from `Wizard.tsx` and running the
suite, not by reading it.

### What the brief got wrong, or did not know

- **Four devDependencies, not three.** `@testing-library/react` v16 declares
  `@testing-library/dom` as a **peer** rather than bundling it the way v14 did,
  so it has to be named explicitly or the resolver finds nothing. The list is
  `@testing-library/dom`, `@testing-library/react`, `@testing-library/user-event`
  and `jsdom`.
- **`vitest.config.ts` did not need touching** — see above.
- **"A `legend` per fieldset and a `label` per input" is only two-thirds true.**
  The choice controls have their `legend`, and `dates` and `budget` label every
  input. But `text`, `text-list`, `number` and `number-list` render a bare
  `input`/`textarea` with `id={field-...}` and **no `label` at all** — the prompt
  is the `h2` in `QuestionCard`, a level up, which nothing associates with the
  field. Those four have no accessible name to query by, so `controls.test.tsx`
  asks for them by role alone. That is a real accessibility defect and not a
  testing inconvenience; it is left alone here because pl-16 is editing
  `web/src` in parallel and a test can be written without it, and it is written
  up in `03-STATUS.md`'s gaps. The fix is an `aria-labelledby` per field and one
  changed query in this suite.
- **`QuestionCard`, `Checkpoint` and `ConfirmDiscard` are not exported.** The
  brief names them as units to cover, and the honest way to reach them without
  touching `web/src` is through `Wizard` with `src/api/intake.ts` faked — which
  is what the traps ask for anyway, and it covers the wiring between them for
  free. No component was exported and no `web/src` file was changed.
- **The fixtures are typed builders, not a captured payload.** "Hand components
  the `IntakeState` the server would return" reads like a checked-in JSON
  capture, but `web` does not depend on `@planner/intake` and the brief's own
  dependency list says to keep it that way. `test/fixtures.ts` builds the state
  from `@planner/contract` types instead — `emptyBrief()` included, so the slot
  inventory is not restated — which gives the same protection against drift via
  `npm run check` and keeps the tree out of it. No test names a real question id.

### What is deliberately not covered

`Brief.tsx`, `Trips.tsx`, `App.tsx` and `format.ts` render but nothing asserts
them; the brief scoped this to the two rules that are UI claims, and the brief
panel is not one of them. `Wizard`'s edit path — clicking an answer in the aside
to re-open it — is exercised only insofar as the preview gate is; the `editing`
state's own transitions have no test. Error rendering (`AppError.from` reaching
the `bad` paragraph) is untested. None of these is a claim in
`tools/planner/CLAUDE.md`, which is where this ticket's scope came from.
