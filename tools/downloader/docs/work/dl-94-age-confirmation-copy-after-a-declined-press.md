---
id: dl-94
tool: downloader
title: The age-confirmation copy says the server is not set to confirm, also when it was and declined to press
kind: fix
status: ready
milestone: null
depends_on: [dl-83]
difficulty: standard
---

# dl-94 — Make the `AGE_CONFIRMATION_REQUIRED` copy true when a press was declined

## Why

Until dl-83, `AGE_CONFIRMATION_REQUIRED` meant one thing: a recognised age gate
was showing, and the operator had left `ENABLE_AGE_CONFIRMATION` off. The
copy says exactly that. The contract message
(`contract/src/errors.ts`, `AGE_CONFIRMATION_REQUIRED`) reads "This video asks
the viewer to confirm their age, and this server is not set to confirm it." The
code's docstring there says the same, and so does the UI's detail
(`web/src/lib/error-presentation.ts`): "This server does not confirm that on
anyone's behalf unless its operator has turned it on."

dl-83 adds a second way to the code. With the setting **on**, the press
declines when the choice leaves no single control to press, for example two
entries standing or a lone exit. The probe then reports
`AGE_CONFIRMATION_REQUIRED` "as if the setting were off" (dl-83's Build, step
3). Then all three texts above tell the user something false about the
server's configuration, on a server whose operator did turn it on.

**Decided by the owner, 2026-10-06**, from the options dl-83's builder put in
its report: (a) leave the copy as dl-83's step 4 required, or (b) file this
ticket to make it neutral as its own contract change. The owner chose **(b)**,
over the builder's recommendation of (a). dl-83 does not touch the copy.

## Build

1. Reproduce first. On `main` after dl-83, a probe with `confirmAge: true`
   against dl-83's `age-gate-overlay.html?second` fixture fails
   `AGE_CONFIRMATION_REQUIRED` (dl-83's test "two candidates still standing
   after the choice presses nothing and fails AGE_CONFIRMATION_REQUIRED"). Record
   the message it carries.
2. Make the copy true in both cases: the setting off, and the setting on with
   the press declined. Do it in the contract message, the code's docstring in
   `contract/src/errors.ts`, and the web presentation's `detail`. The words must
   not claim what the server is or is not set to do. They should still tell
   the user that the page wants an age confirmation the server did not make.
   This is a contract change, so check every consumer of the message
   (`api`, `web`, the mocked `web/src/api/scenarios.ts`) and their tests.
3. Don't change the code itself, its HTTP status (422), its non-retryable
   classification, or `ENABLE_AGE_CONFIRMATION`'s default. If telling the two
   cases apart in the message turns out to be worth a `details` field (for
   example `reason: "declined"`), that is a decision: report it as options
   rather than adding it.

## Done when

- The contract message, its docstring and the web detail make no claim about
  the server's setting, and a test pins the new contract message.
- The dl-83 declined-press test still reports `AGE_CONFIRMATION_REQUIRED`.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

**2026-10-06 — filed** on `dl-83-age-gate-phrasings` by dl-83's builder, on the
owner's choice of option (b) above, relayed by the orchestrator after dl-83's
gate round 1. Not built against.

**2026-10-07 — built** on `dl-94-declined-press-copy` (base `1aece87d`).

- **Reproduced** (Build 1): with `confirmAge: true` against the `?second`
  fixture, the error carried "This video asks the viewer to confirm their age,
  and this server is not set to confirm it." — pinned by a new assertion
  `expect(error.message).not.toMatch(/not set/i)` in dl-83's test "two
  candidates still standing after the choice presses nothing and fails
  AGE_CONFIRMATION_REQUIRED"; before the fix, `npx vitest run
tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "two
candidates still standing"` failed with `Received: "This video asks the viewer
to confirm their age, and this server is not set to confirm it."`, after it
  passes (1 passed, 137 skipped).
- **New copy**, none of it naming the setting: contract message "This video asks
  the viewer to confirm their age, and the server did not confirm it."; web
  detail "The page asks the viewer to confirm they are an adult before it plays
  the video. The server did not make that confirmation on anyone's behalf."; the
  docstring in `contract/src/errors.ts` now names both causes and says the
  wording is true of both. The mocked scenario's description in
  `web/src/api/scenarios.ts` ("this server is not set to press") said the same
  false thing and now reads "the server did not press" (a consumer of the copy,
  step 2).
- **Pinned by** `contract/test/contract-schemas.test.ts` "says the server did
  not confirm, and claims nothing about its setting" and
  `web/test/error-presentation.test.ts` "age confirmation says the server did
  not make it, and claims nothing about its setting"; both failed on the old
  copy (`Tests 2 failed | 34 passed (36)`) and pass now. No `api` test and no
  other `web` test pinned the old text (grep of `api`, `web`, `e2e` for the old
  strings found only the two source lines changed here).
- **Not done:** the `details.reason` field (Build 3) is an open decision, left
  to the orchestrator. `docs/01-ARCHITECTURE.md`'s `ENABLE_AGE_CONFIRMATION` row
  still says only "with it off, such a page fails `AGE_CONFIRMATION_REQUIRED`";
  it is true but does not mention the declined press, and the ticket does not
  name it.
