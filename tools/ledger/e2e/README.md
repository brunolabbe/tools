Playwright specs for the ledger, driven in Chromium against the bundle the API
serves — which is how the container runs it, and what `WEB_DIR` points at.

There is one spec, and it is the layout check (repo-109):

- `layout.spec.ts` — every screen at 360×740 and at 1280×800, asserting the page
  never scrolls sideways (`scrollWidth <= innerWidth`) and keeping a full-page
  screenshot of each in `.artifacts/layout/`. The rule it keeps is
  `.claude/rules/responsive-layout.md`. **A screen is a tab**: the shell has no
  router, so each of the twelve tabs in `web/src/App.tsx` (Home, Stats, Period,
  History, Receipt, Paste, Inbox, Rules, Categories, Salaries, Household, Admin)
  is a case, and Paste is measured twice — previewed, then stored — and Receipt
  with a photo kept and an item typed in. A new tab is a new line in the spec, in
  the same pull request.

  Each screen is opened onto rows. The spec fills the household's books through
  the API before it starts — three rules, a pasted statement, salaries and their
  ratio, a closed period and an open one with lines and a recurring item — because
  an empty screen does not prove a full one fits. Open the screenshots: a width
  assertion over a page that rendered nothing passes.

It is the first spec, so it is also the answer to what earns a spec here: a seam
the unit suites cannot reach. The next candidate is a pasted statement surviving
a reload, which needs a real `fetch`, a real server and SQLite at once.

```bash
npm run e2e:install     # once, for the browser
npm run e2e:ledger
```

The API is started by the config itself, on port 8108 — not 8100, where a dev
API usually is, and not the downloader's 8099 or the planner's 8098 — over its
own data directory under `e2e/.artifacts/`, so nothing needs to be running first.
The server's command (`e2e:ledger:serve` in the root `package.json`) makes the
household first: the API refuses `DEV_IDENTITY` unless the directory already holds
that address, so `home`, `alex` and `sam` are added by the household command
before the API boots, and every request is `alex`, who `LEDGER_ADMINS` makes an
admin too, so the household and admin screens exist to be looked at.

It runs in the `e2e` job of `.github/workflows/ledger.yml`, which also uploads the
screenshots, and **not** in `npm test`.
