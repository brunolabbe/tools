---
id: pl-12
tool: planner
title: Render the wizard's components in tests, not only the routes under them
kind: chore
status: ready
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

_Not started._
