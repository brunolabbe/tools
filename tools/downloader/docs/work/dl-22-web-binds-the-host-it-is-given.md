---
id: dl-22
tool: downloader
title: Bind the web dev server to the host it is given
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-22 — Bind the web dev server to the host it is given

## Why

`npm run dev:downloader` serves a blank page in the dev container, with nothing
in the terminal or the browser console to say why.

`tools/downloader/web/vite.config.ts` never set `server.host`, so Vite fell back
to its `localhost` default. Inside the container that resolves to `::1`, and a
socket bound to `::1` does not accept IPv4 — so the server listened on
`[::1]:5173` while `127.0.0.1:5173` was refused. `devcontainer.json` forwards
5173 over IPv4, so the forwarder reached nothing and returned an empty response.
A blank page, no error.

The container sets `HOST=0.0.0.0` for exactly this reason. The API reads it
(`API_DEFAULTS`, `api/src/config.ts`); this config did not.

The planner already hit this and fixed it — `tools/planner/web/vite.config.ts`
carries the diagnosis in a comment. The fix was never carried across, which is
why this ticket is a port and not a discovery.

## Build

1. In `tools/downloader/web/vite.config.ts`, add `const HOST = process.env["HOST"] ?? false`
   and set `server.host` to it, mirroring `tools/planner/web/vite.config.ts`.
   `false` is Vite's own "localhost only", so off a container nothing is
   published to the network without asking.
2. Add `port: 5173` and `strictPort: true` to the same block. Vite's default is
   to walk to the next free port on a collision, which is the second way to get
   a blank page: 5174 is not what `devcontainer.json` forwards, and the terminal
   still reports ready.
3. Keep the comments. This failure is invisible at every layer — no error, no
   log line — so the config is the only place the reason can live.

Traps:

- The two failure modes look identical from the browser. Fixing only the bind
  leaves the port walk, and the next collision reads as a regression.
- `npm run dev:downloader:web -- --host 0.0.0.0` does **not** work around this:
  the script is a nested `npm run`, so npm consumes `--host` as its own flag and
  passes `0.0.0.0` to vite as a positional root argument. It starts, reports
  ready, and still binds `::1`. `npx vite --host 0.0.0.0` from
  `tools/downloader/web` is the invocation that actually works.

## Done when

- `tools/downloader/web/test/vite-config.test.ts` proves the config binds
  `process.env["HOST"]` when set, and `false` when it is not.
- The same suite proves `strictPort` is on and `port` is 5173.
- `npm run dev:downloader:web` in the container listens on `0.0.0.0:5173`, and
  `curl http://127.0.0.1:5173/` returns 200.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: PASS** — 2026-08-23 · `origin/main...HEAD` · code-review at medium

| Done when                                                                                      | Proof                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `vite-config.test.ts` proves the config binds `process.env["HOST"]` when set, `false` when not | `web/test/vite-config.test.ts:36` (set) ✓ · `:44` (unset) ✓                                                      |
| The same suite proves `strictPort` is on and `port` is 5173                                    | `web/test/vite-config.test.ts:50` (port) ✓ · `:51` (strictPort) ✓                                                |
| `npm run dev:downloader:web` listens on `0.0.0.0:5173`, `curl http://127.0.0.1:5173/` → 200    | **verified** — `ss -ltn`: `0.0.0.0:5173`; curl `200`. Bug reproduced with `HOST` unset: `[::1]:5173`, IPv4 `000` |
| `npm run check` and `npm test -- --project downloader` pass                                    | **verified** — cold `check` exit 0 (tsbuildinfo cleared); 47 files / 643 tests vs 46 / 640 at `0c67b8e`          |

- **low** · `vite.config.ts` is now checked on the `web/test` surface (Bundler + DOM + JSX).
  `tsconfig.tests.json`'s own comment holds that the surface split is what keeps `document`
  out of a node program; a Node-only config file in a DOM project loses that for itself.
  The e2e projects already do this to `playwright.config.ts`, and there is no cheaper home.
- **low** · `tools/planner/web/test/tsconfig.json` still omits `../vite.config.ts`, so the
  config this was ported from remains in no tsconfig project. Pre-existing, outside this
  range — a sibling ticket, not a change here.
- **findings** · code-review at medium returned 0; 0 carried, 0 dropped.
- NFR: security ✓ · performance n/a · reliability ✓ · maintainability — the two lows above,
  plus `HOST` resolution now duplicated with the planner's config: second consumer, lift
  declared and reasoned in the Log rather than smuggled.

## Log

- Found while debugging a blank page on `http://localhost:5173/`. The app was
  never broken: driving the dev server over `[::1]:5173` with headless Chromium
  rendered the full UI with an empty console. `ss -ltnp` was what actually named
  the bug — `[::1]:5173` for the web server against `0.0.0.0:8080` for the API,
  in the same container, from the same `npm run dev:downloader`.
- The asymmetry with the API is the tell, and it is worth keeping in mind for
  the next tool: `HOST` is read in `api/src/config.ts` and was simply never
  wired into the web config. A tool's two halves read the same environment
  variable and only one of them honoured it.
- Ported the planner's comment nearly verbatim rather than writing a new one.
  The wording is load-bearing — it names both failure modes and the reason the
  symptom is silent — and paraphrasing it would have lost the IPv4/IPv6 detail
  that makes it diagnosable.
- `vite.config.ts` was in no tsconfig project at all — the web project includes
  `src/**` only — so importing it from a test failed `npm run check` with
  TS6307. Added it to `web/test/tsconfig.json`'s `include`, the way the e2e
  projects pull in `playwright.config.ts` from a directory up. The config is now
  typechecked for the first time, which is a small bonus of having tested it.
- Filed as dl-20 first, and that was wrong: dl-20 and dl-21 were both already
  taken by tickets sitting in open PRs whose **titles name a different ticket**
  (dl-20 is in #73, titled dl-18; dl-21 is in #76, titled dl-19). Picking an id
  from `docs/work/` on main plus a scan of open PR _titles_ cannot see either.
  The sweep that works is the union of the files on main and the files in every
  open PR, titles ignored:

  ```bash
  { git ls-tree origin/main tools/downloader/docs/work/ --name-only
    for pr in $(gh pr list --state open --json number --jq '.[].number'); do
      gh pr diff "$pr" --name-only
    done
  } | grep -oE 'dl-[0-9]+' | sort -u -t- -k2 -n | tail -1
  ```

- The `HOST` resolution is now duplicated between the two tools' vite configs.
  Left duplicated on purpose: `packages/` is for what the tools ship, and a
  shared dev-server config package would pull a new workspace into the root
  tsconfig, `vitest.config.ts` and the image-closure scan for four lines of
  build tooling. If a third tool arrives, lift it then.
