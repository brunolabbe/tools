Playwright specs for the planner, driven against the bundle the API serves —
not against Vite's dev server, because the bundle off disk is the thing that
ships. The configuration and the reasoning are a directory up, in
`tools/planner/playwright.config.ts`.

- `intake.spec.ts` (pl-13) — describe a trip, be told the essentials are done,
  come back to it after a reload, and be told what changing an early answer
  costs.
- `pin.spec.ts` (pl-19) — draft a plan from that intake, pin an item, reload,
  find it still pinned and no revision appended, then take the pin back.
- `intake-walk.ts` — the walk down the tree, which both of the above need. Not a
  spec: `testMatch` is `**/*.spec.ts`, so the runner never collects it.

**No spec here names a question or counts them.** The tree is authored content
and is reviewed as content, so a spec that types into
`#field-road-trip.drive-appetite` turns a content edit into a red build. The walk
fills whatever control is in front of it and keeps the prompts it was shown.

**Nothing here reads the database.** What these prove is what a user sees; a spec
that queried SQLite would be an integration test wearing a browser, and the
suites that should query it already do.

```bash
npm run e2e:install    # once, for the browser
npm run e2e:planner
```

They do not run in `npm test`. Their gate is `.github/workflows/planner.yml`, so
a green local tree is silent about them.
