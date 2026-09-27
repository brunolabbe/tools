Playwright specs for the ledger, driven in Chromium against the bundle the API
serves — which is how the container runs it, and what `WEB_DIR` points at.

**There are none yet, on purpose.** The shell has one page and nothing to do on
it, and `ledger.yml`'s image job already asks the container for that page. A
spec earns its place by crossing a seam the unit suites cannot: the first is
likely a pasted statement surviving a reload, which needs a real `fetch`, a real
server and SQLite at once. When it lands, add the `e2e` job to `ledger.yml`
beside the planner's shape, not before — a job that runs no spec is a green
check proving nothing.

```bash
npm run e2e:install     # once, for the browser
npm run e2e:ledger      # "No tests found" until the first spec
```

The API is started by the config itself, on port 8108 — not 8100, where a dev
API usually is, and not the downloader's 8099 or the planner's 8098 — over its
own database under `e2e/.artifacts/`, so nothing needs to be running first.
