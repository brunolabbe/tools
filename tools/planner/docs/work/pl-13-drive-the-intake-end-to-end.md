---
id: pl-13
tool: planner
title: Drive the intake end to end, and gate it in CI
kind: chore
status: done
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

**2026-08-15 — done.** Built on pl-7's branch, which is where the flow it drives
lives.

**The prerequisite was taken, not dodged.** Step 2 offered two ways: serve the
bundle from the API, or drive Vite's dev server and say so. The first was worth
more and cost about ninety lines — `api/src/routes/web.ts`, modelled on the
downloader's and not imported from it, plus `@fastify/static` and three lines in
`server.ts`. So the suite drives the thing that ships. Confirming the brief: the
image really did serve no UI. `WEB_DIR` was set in the `Dockerfile` and parsed in
`config.ts` and read by nothing, and `/api/health` answered perfectly the whole
time, which is why nothing noticed.

`registerNotFoundHandler` had to change shape anyway to take `servingWeb`, and
its `CONVERSATION_NOT_FOUND` was deliberately left alone —
[pl-11](./pl-11-retire-the-conversation-vocabulary.md) owns that rename, and
carrying a bug across one is how it survives.

**The static route got a unit suite of its own**, `api/test/web-serving.test.ts`,
10 tests. Not scope creep: the interesting cases are boundary ones — an unknown
`/api` path must still return a typed error rather than a page, a dotfile swept
into the bundle must not be fetchable, a traversal must be refused — and paying a
browser launch and a Vite build to learn any of them would be absurd. The e2e
suite is left proving only what needs a browser.

**What the brief had right.** Both traps were real and both were hit in the
writing. Driving by prompt rather than by id fell out well: the walk keeps the
prompts it was shown, and the discard assertion checks the warning's list against
_those_, so a content edit moves both sides at once and `road-trip.drive-hours`
appearing in the dialog fails it. No number of questions is pinned anywhere —
the loop ends when the checkpoint arrives, and 64 is a runaway bound with an
error message, not an expectation.

**What the brief did not mention, and cost the most time.** Synchronisation. The
obvious loop — "answer, then look for the next question" — races the round trip
and reads the card it just submitted. The progress line is the fix: it is
`aria-live`, it counts answers the server accepted, and waiting for it to tick to
_n_ is a guarantee the next iteration sees the next question. Worth knowing
before pl-12, which will have the same problem without a network to blame.

**One bug found in writing the spec, and it was the spec's.**
`locator.filter({ hasNot: ... })` searches _descendants_, and an `<input>` has
none — so "a radio that is not checked" matched every radio, the already-chosen
one got re-checked, no `change` fired, and the save button stayed disabled until
the 120-second timeout. `:not(:checked)` in the selector instead. Noted because
the failure mode is generic: a `hasNot` filter over leaf elements silently
matches everything.

**Verified, rather than assumed:** removing `localStorage` resume from `App.tsx`
was tried, and the reload step fails on it — at the checkpoint assertion, with
the trip list showing instead. That is the ticket's second _done when_, measured.
The suite asserts it is not merely on _a_ page after reload but back inside the
intake, because the trip stays listed either way and a laxer check would pass.

**Not verified here: the image.** No Docker in this environment, so the new `/`
assertion in `planner.yml` has never run. It greps for `<div id="root">` rather
than trusting a 200, and the bundle's own `index.html` was checked to contain it.
First real proof is CI.

**A red suite that was not this ticket's, and is now gone.** Most of this work
was done on pl-7's branch, where `api/test/schema.test.ts` had 11 failures from
the pl-4/pl-7 migration-numbering seam — verified as pre-existing by reproducing
them with this work stashed, rather than assumed. pl-7 merged mid-ticket and
`c1012f6` fixed it; this rebased onto main and the planner suite is 212 green.
Worth recording only because the instinct on finding a red suite is to fix it,
and here that would have been two people editing one migration.

**Still stale, and deliberately not patched here:** `03-STATUS.md`'s ticket table
has pl-4 as `ready` when it is merged, and no rows for pl-9 or pl-10. A note now
says so. Three tickets in a row have each fixed the paragraph they touched, which
is how a status page ends up half-true in a different place every time.

**Costs.** The suite is ~7s for both specs after the Vite build. It takes port
8098 and a database under `e2e/.artifacts/` that is removed at config load, so it
never touches `storage/planner/planner.db`. The `e2e:serve` script stayed the
downloader's unprefixed name and the planner's is `e2e:planner:serve`; renaming
the downloader's for symmetry would have been a change to a tool this ticket has
no business in.
