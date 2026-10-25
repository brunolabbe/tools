---
id: repo-123
tool: repo
title: Move the web test environment from jsdom 27 to 30
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-123 — jsdom 27 to 30

## Why

The three web workspaces declare `jsdom ^27` (27.4.0) as their vitest
environment; 30.0.0 shipped 2026-07-27 (30.1.3 latest). Three majors of DOM
behaviour sit under every web unit test, and a test that passes on a DOM that
changed under it is the failure to look for.

## Build

1. Read the 28, 29 and 30 release notes for removed or changed behaviour this tree
   leans on: layout stubs, `matchMedia`, form validation, events.
2. Bump it in the three `package.json` files together; if repo-121 has landed,
   check vitest 5 states a jsdom range that admits 30.
3. `npm test -- --project downloader`, `planner`, `ledger`; in the Log, name every
   test that needed a change and why.

## Done when

- One jsdom 30.x in the lockfile and all three tools' suites pass.

## Log

- 2026-10-24: filed from the dependency audit.
- 2026-10-25: built on `origin/repo-121-vite-8-vitest-5` at 64ddcb0c, branch
  `repo-123-jsdom-30`, stacked as the owner chose (PR #643 merges first). Brief
  corrections are at the end of this entry.
  - **Version, against the seven-day rule** (today 2026-10-25, cutoff 2026-10-18):
    jsdom **30.1.3**, published 2026-10-15 (`npm view jsdom time --json`). It is
    inside the ticket's "30.1.3 latest" and is the newest version on or before the
    cutoff; 30.0.0 is 2026-07-27, 30.0.1 2026-07-29, 30.1.0 2026-09-17, 30.1.1
    2026-09-22, 30.1.2 2026-10-04. The three `web/package.json` files now read
    `"jsdom": "^30.1.3"` (were `^27.4.0`).
  - **Lockfile.** `npx -y npm@11.21.1 install --package-lock-only --ignore-scripts
    --before=2026-10-18`, then a plain `npm install --package-lock-only
    --ignore-scripts` on npm 10.9.9, as `dependency-updates.md` says. Against
    `HEAD` (repo-121's 64ddcb0c): 2 entries added, 9 changed, 9 removed. Added:
    `jsdom/node_modules/undici` 8.12.2 (2026-10-15), `@bramus/specificity` 2.4.3
    (2026-10-05). Changed: `jsdom` 27.4.0→30.1.3 (2026-10-15), `@asamuzakjp/css-color`
    4.1.2→7.1.7 (2026-10-17), `@asamuzakjp/dom-selector` 6.8.1→10.0.4 (2026-10-17),
    `data-urls` 6.0.1→8.0.0 (2026-10-04), `html-encoding-sniffer` 6.0.0→7.0.0
    (2026-09-21), `tr46` 6.0.0→7.0.0 (2026-10-04), `w3c-xmlserializer` 5.0.0→6.0.0
    (2026-09-21), `whatwg-mimetype` 4.0.0→5.0.0 (2026-01-20), `whatwg-url`
    15.1.0→17.3.0 (2026-10-14). Removed: `@acemir/cssom`, `@asamuzakjp/nwsapi`,
    `agent-base`, `cssstyle`, `data-urls/node_modules/whatwg-mimetype`,
    `http-proxy-agent`, `https-proxy-agent`, `symbol-tree`, `ws`. Every added or
    changed entry was checked with `npm view <name> time --json`: **none is
    younger than 2026-10-18** (0 of 11). No advisory exemption was needed.
    `node scripts/check-lockfile-sync.mjs` exit 0. One `"node_modules/jsdom"`
    entry, at 30.1.3.
  - **Audit.** `npm audit --package-lock-only`: one high, `node-forge`, no fix
    available. That is dl-132's advisory, as at the base; this branch adds none.
  - **Release notes, read before the bump** (the GitHub release pages for 28.0.0,
    29.0.0, 30.0.0 and 30.1.0, read through a summarising fetch, so not verbatim;
    the tarball ships no changelog). Changes that could reach this tree:
    - 30.0.0: **Node minimum `^22.22.2 || ^24.15.0 || >=26.0.0`** (the breaking
      change); `getComputedStyle()` now converts lengths to pixels.
    - 30.1.0: `window.close()` keeps the document; `volumechange` and `ratechange`
      fire asynchronously; `storage` delivery; named access on `document`
      (`document.myForm`); a fix for borderless elements reporting a 16px computed
      border, a regression that 30.0.0 introduced.
    - 29.0.0: `MediaList` parses with css-tree and an invalid query becomes
      "not all"; the `selectorText` setter rejects invalid selectors; the
      `XMLHttpRequest` `response` getter returns `null` during `LOADING`; Node
      minimum v22.13.0 (superseded by 30.0.0).
    - 28.0.0: `<iframe>`, `<frame>` and `<img>` fire `load`, not `error`, on a
      non-OK response; XHR and WebSocket interception.
    - None of the four names a change to layout (`getBoundingClientRect`,
      `offsetWidth`), `window.matchMedia`, or form validation (`checkValidity`,
      `reportValidity`, `required`, `:invalid`).
  - **What the web suites reach.** `grep` over the three `web/test` trees finds no
    `matchMedia`, `getComputedStyle`, `getBoundingClientRect`, `offsetWidth`,
    `checkValidity`, `reportValidity`, `volumechange`, `ratechange`, `window.close`
    or XHR call in a test. The only hits are comments and the ledger's
    `clientWidth` stubs, which jsdom 30 does not touch.
  - **Peer and engine checks.** `vitest@5.0.5` declares `jsdom: "*"` as an optional
    peer (`peerDependenciesMeta.jsdom.optional: true`), so it admits 30. `jsdom@30.1.3`
    declares `engines.node` `^22.22.2 || ^24.15.0 || >=26.0.0`; this sandbox runs
    v22.23.3, which satisfies it. The repo's root `engines` stays `>=22.0.0`, so a
    Node 22.0 to 22.22.1 install gets an `EBADENGINE` warning and jsdom 30 is untested
    there. CI's `node-version: 22` and the Dockerfiles' `node:${NODE_VERSION}`
    (`22-bookworm`) both float to the newest 22.x, which is above 22.22.2.
  - **Build.** `npm run build` exit 0; the three webs each print `vite v8.3.4`.
  - **Tests that needed a change: none.** The three web suites pass unchanged on
    jsdom 30.1.3, run from the worktree's own `node_modules` (`require.resolve('jsdom')`
    from `tools/planner/web` resolves to the worktree's `node_modules/jsdom`, 30.1.3):
    - `npm test -- tools/downloader/web`: 22 of 22 files, 311 of 311 tests.
    - `npm test -- tools/ledger/web`: 19 of 19 files, 241 of 241 tests.
    - `npm test -- tools/planner/web`: 7 of 7 files, 131 of 131 tests.
  - **`npm run check`**: exit 0. oxlint printed 18 warnings and no errors (all in
    files this branch does not touch); `oxfmt --check` "All matched files use the
    correct format"; typecheck clean.
  - **`npm test` (full)**: exit 1, `Test Files 1 failed | 312 passed | 1 skipped
    (314)`, `Tests 1 failed | 6905 passed | 2 skipped (6908)`. The one failure is
    `tools/downloader/engine/test/parallel-ranges-limits.test.ts` › "dl-98: the
    feeder's own limits" › "bytes held ahead never exceed 4 x 4 MB, measured at
    the defaults with ffmpeg not reading": `expected 'fallen-back' to be 'parallel'`
    at line 75. That spec is a 50 ms throughput window (`measureMs: 50`) that falls
    back when the process is CPU-starved; the full run shared the machine with the
    test gate's other run (`1 of 2 runs active`) and another session's vitest.
    It does not touch jsdom or the lockfile's changed entries. **Alone, three
    times on this same tree, it passed 14 of 14 each time** (`npx vitest run
    tools/downloader/engine/test/parallel-ranges-limits.test.ts`, exit 0). Not run
    at the base: a second tree at 64ddcb0c was not built, so whether it flakes
    there under the same load is unmeasured.
  - **Brief corrections.** The brief's "30.1.3 latest" is correct and its date is
    2026-10-15, inside the week. The brief did not say that jsdom 30 raises the
    Node floor to `^22.22.2`; that is the one change here the release notes name
    that the repo's own `engines` does not follow (see above). Step 3's
    `npm test -- --project downloader` would also run the downloader's api and
    engine suites; the web suites were run by path, as the dispatch asked.
  - **Not changed here**: the root `engines.node` (`>=22.0.0`), against jsdom 30's
    Node floor above. The Build does not name it, so it is left for the
    orchestrator to put to the owner.
- 2026-10-25 — Owner's answers, put by the orchestrator, all 2026-10-25.
  - **Root engines.** jsdom 30.1.3 needs `^22.22.2 || ^24.15.0 || >=26.0.0` and
    the root said `>=22.0.0`. The owner first proposed Node 24, the LTS; asked
    again with scope, they chose (a): file a Node 24 ticket and have repo-123
    raise the floor to `>=22.22.2`. Done here in the root `package.json` and in
    `package-lock.json` at `packages[""].engines.node`. The Node 24 move is
    filed as repo-126, on PR #650.
  - **The engine timing test** that failed once under load (above): CI grades
    the line, and `test (ubuntu-latest)` passed at 8b96fbd9. jsdom cannot reach
    it, since the downloader project uses the `node` environment (gate 1,
    attack 2). Accepted, nothing changed, nothing filed.
  - **Gate 1's low**: fix at landing, next entry.
- 2026-10-25 — Fixed at landing by owner choice: gate 1, the first low — "does not read these properties back". `git diff 8b96fbd9 HEAD -- tools/ledger/web/test/stats-layout.test.ts | grep -c '^-.*does not read these properties'` → `1`. The header comment now says jsdom reads a declared value back on 30.1.3 and still says nothing about a width; the test is untouched.
