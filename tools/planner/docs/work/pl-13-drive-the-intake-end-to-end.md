---
id: pl-13
tool: planner
title: Drive the intake end to end, and gate it in CI
kind: chore
status: ready
milestone: null
depends_on: [pl-7]
---

# pl-13 — There is now a flow worth driving

**Area:** a new `tools/planner/e2e/`, `tools/planner/playwright.config.ts`, root
`package.json` scripts, and `.github/workflows/planner.yml`.

## Why

The tool's `CLAUDE.md` lists `e2e` as "Playwright specs (empty until there is a
flow worth driving)". [pl-7](./pl-7-intake-persistence-and-wizard.md) made one:
start a trip, answer into a branch, be told the essentials are done, go back and
change an early answer, confirm what that discards, reload, and find the intake
where it was left.

Every part of that is tested today — **and only in halves.** The API suite proves
the server's half through `inject()`, and [pl-12](./pl-12-render-the-wizard-in-tests.md)
will prove the browser's half against a faked client. Neither proves the two are
wired to each other: that the dev proxy forwards `/api`, that a real `fetch`
round-trips an `Answer` through `answerSchema`, that a reload actually resumes.
The reload especially — it is the claim the whole ticket was written for, it
depends on `localStorage` plus a real server, and no unit test can reach it.

This is also the gate that would have caught the finding pl-7 left in
03-STATUS: **the image serves no UI**, because `WEB_DIR` is parsed and never
read. `planner.yml` waits for `/api/health` and nothing asks for `/`.

## Build

1. **`tools/planner/e2e/`, its own `tsconfig.json`** (DOM + Playwright's types,
   the third compiler surface named in the root `CLAUDE.md`), a reference from the
   root `tsconfig.json`, and `tools/planner/playwright.config.ts`. The downloader's
   are the worked example — read them, do not import from them.
2. **Serve the real thing.** `npm run e2e:serve` for the downloader builds the web
   bundle and starts the API; the planner's equivalent needs the API to actually
   serve `WEB_DIR`, which today it does not. **That is a prerequisite, not a
   detail** — either it lands with [pl-2](./pl-2-container-image.md) first, or this
   ticket drives Vite's dev server with its `/api` proxy and says so in the Log.
   The first is worth more: it tests the thing that ships.
3. **A temporary database per run**, `DATABASE_PATH` into a temp directory, and
   the scripted provider — no key, no network. An e2e that shares the developer's
   `storage/planner/planner.db` is one that passes on their machine only.
4. **The spec, one flow and one refusal.** The flow is the paragraph above, end
   to end. The refusal is the discard confirmation: change the shape after the
   checkpoint, assert the named prompts appear, cancel, and assert the answers are
   **still there** — a warning that costs the user their answers whether or not
   they agree is worse than no warning.
5. **The gate**, in `.github/workflows/planner.yml`, path-filtered to this tool
   and `packages/**` the way the image job already is. Add a request for `/` that
   asserts HTML came back, so "the image serves the UI" stops being unverified.

## Done when

- `npm run e2e:planner` passes from a clean checkout with no key and no network.
- The reload step fails if `localStorage` persistence is removed from `App.tsx`.
- `planner.yml` runs the suite and asserts the running container answers `/` with
  the UI, not only `/api/health`.

## Traps

**Do not drive the wizard by its ids.** Questions come from an authored tree that
is expected to change; a spec that types into `#field-road-trip.drive-hours` is a
spec that breaks on a content edit. Read the prompt the server sent and answer
what is on screen, the way `answerThroughCore` in the API tests already does.

**One flow, not a matrix.** Six trip shapes times two date modes is a suite that
takes minutes to say what a component test says in milliseconds. Branch coverage
belongs in pl-12; this suite exists to prove the seams.

**The tree's content decides the path length.** A spec asserting "eight
questions" pins a number the tree is allowed to change. Assert the checkpoint
arrives, not when.

## Log

_Not started._
