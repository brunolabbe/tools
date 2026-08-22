Playwright specs for the planner: the intake (pl-13) and pinning (pl-19), driven
in Chromium against the bundle the API serves — which is how the container runs
it, and what `WEB_DIR` points at.

Four specs over two paths. They exist to prove the seams the unit suites cannot
reach, and nothing else: the API suite proves the server through `inject()` and
the web suite proves the browser against a faked client, so what is left over is
whether the two are wired to each other. Branch coverage belongs in those suites,
where it costs milliseconds instead of a browser launch.

- `intake-walk.ts` — getting to the checkpoint without naming a question. Shared
  by both specs on purpose; read the note at the top of it before copying it.
- `intake.spec.ts` — describe a trip, be told the essentials are done, come back
  to it after a reload, and be told what changing an early answer costs.
- `pin.spec.ts` — draft a plan, pin an item, reload, and find it still pinned
  with no revision appended. The reload is the assertion: it is what separates a
  pin that reached SQLite from one that only reached React state.

```bash
npm run e2e:install     # once, for the browser
npm run e2e:planner
```

The suite starts its own API on 8098 over its own database under `.artifacts/`,
builds the UI first so it is never testing a stale `dist`, and talks to no model
— the scripted provider is the default and `playwright.config.ts` names it
anyway. There is nothing to have running first.

It runs in `.github/workflows/planner.yml` and **not** in `npm test`, which is
why a claim proven only here is proven at a gate rather than in the suite anyone
runs locally.
