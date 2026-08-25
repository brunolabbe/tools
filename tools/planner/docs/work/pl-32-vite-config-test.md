---
id: pl-32
tool: planner
title: Pin the planner dev server's HOST, port and strictPort in a test
kind: chore
status: ready
milestone: null
depends_on: [pl-31]
---

# pl-32 — nothing asserts what the planner's dev server binds

## Why

`tools/planner/web/vite.config.ts` decides three values that fail silently when
they are wrong: `host` (from `HOST`), `port` (5183) and `strictPort`. The
docblock in the file says what each is for — inside the dev container
`localhost` resolves to `::1`, so Docker's IPv4 port forwarding reaches nothing
and the page is simply blank, with no error anywhere — and `tools/planner/Dockerfile`
sets `HOST=0.0.0.0` for exactly that reason.

pl-31 put the file into a tsconfig project, so a _type_ error in it is now
caught. Nothing catches a _value_ regression: `host: "localhost"`,
`strictPort: false`, or a port that is no longer the 5183
`.devcontainer/devcontainer.json` forwards, all typecheck perfectly.

The downloader has this test —
`tools/downloader/web/test/vite-config.test.ts`, added by dl-22 — and the
planner does not, which matters beyond symmetry: **repo-5 is open and asks
whether the `HOST` resolution lifts to `packages/`.** Its acceptance says the
behaviour dl-22 pinned must survive the move "proven by the tests that pinned
it". Only the downloader has such tests, so a lift could change what the planner
binds and the whole suite would stay green.

Decided while building pl-31, which was scoped to the tsconfig line and says in
its Log that a test was wanted and filed rather than grown into it.

## Build

1. **`tools/planner/web/test/vite-config.test.ts`**, modelled on
   `tools/downloader/web/test/vite-config.test.ts`. It is a near-twin, and the
   mechanism is the part worth copying rather than re-deriving: `HOST` is read at
   module scope, so each case must `vi.resetModules()` before
   `await import("../vite.config.ts")` or the second import returns the first
   one's answer. Restore the ambient `HOST` in `afterEach`.
2. Assert the three values that fail silently, with the planner's own numbers:
   `host` is `"0.0.0.0"` when `HOST=0.0.0.0`; `host` is `false` (Vite's
   "localhost only", not the string `"localhost"`) when `HOST` is unset; `port`
   is `5183` and `strictPort` is `true`.
3. Do not assert the proxy target or `build.outDir`. They are not silent — a
   wrong proxy target fails loudly on the first request and a wrong `outDir`
   fails the build — and a test that pins every field of a config is a test that
   has to be edited every time the config is edited.
4. No new project file is needed. `tools/planner/web/test` is already a tsconfig
   project and already inside the `planner` vitest project's include, and pl-31
   put `../vite.config.ts` on the same compiler surface — which is what lets the
   test import it.

## Done when

- `npm test -- --project planner` covers the three values above, and the
  unset-`HOST` case asserts `false` rather than a string.
- `npm run check` and `npm test` pass.
- Changing `strictPort` to `false` in `vite.config.ts` fails the suite —
  measured, not assumed.

## Log

_Not started._
