# CLAUDE.md — downloader

Rules for this tool only. The repo-wide conventions are in the root
`CLAUDE.md` and are not repeated here.

Read `tools/downloader/docs/00-ANALYSIS.md` before touching resolver or engine
code — most non-obvious decisions here are justified there, not repeated. The
rest of this tool's documentation is beside it in `docs/`: architecture,
roadmap, current status, and `docs/work/` where each ticket keeps its brief and
its log.

## What this is

A service that takes a web page URL, finds the video stream behind it, downloads
it, and hands back a link to the resulting file. The interesting problem is the
finding: modern players use MSE, so the `<video>` element carries a `blob:` URL
that means nothing outside the tab. Streams must be caught at the **network
layer**.

## Layout

```
contract     types, error taxonomy, job FSM, zod schemas, redaction — no logic
resolvers    URL → ProbeResult (registry + resolver implementations)
engine       ProbeResult → file on disk (ffmpeg, storage, GC)
api          Fastify, job orchestration, SSE, file serving, SSRF guard
web          React + Vite UI
e2e          Playwright specs + the fixture HLS origin they run against
```

The API also serves the built UI when `WEB_DIR` is set, which is how the
container ships them on one origin — same-origin means no CORS to configure and
an `EventSource` that just works.

`api` is the only place that reads `process.env`. The engine and the resolvers
are libraries and take their configuration as arguments.

## Commands

```bash
npm run dev:downloader          # API (8080) + web (5173) together, both in watch mode
npm run dev:downloader:api      # just the API
npm run dev:downloader:web      # just the UI
npm test -- --project downloader
npm run e2e:downloader          # Playwright: whole stack in a real browser
npm run e2e:install             # once — fetches the browser the e2e run needs

docker compose up --build       # the service on :8080, UI included
```

`npm run e2e:downloader` builds the UI itself before starting the API, because
the bundle bakes its transport in at build time — testing a stale `dist` is
testing the mock. The suite runs the direct resolver only and talks to a local
fixture origin it generates with ffmpeg; it never touches a third-party site.

`dev:downloader` runs the two through `concurrently`. It cannot be
`npm run dev --workspaces`: npm runs workspace scripts **serially**, so the
API's watcher never exits and the web app is never reached.

The UI defaults to a **mocked** API — that is what let it ship before the
backend existed. `cp web/.env.example web/.env.local` to point it at the real
one. Until you do, the UI works but talks to nothing.

The API's dev script is `node --watch --import tsx`, not `tsx watch`. On Windows
`tsx watch` spawned by `concurrently` starts, prints nothing and never binds its
port — silently, which costs an afternoon if you do not know. Node's own
watcher does the restarting and tsx only transforms.

## Rules

**DRM is a hard stop.** Widevine / PlayReady / FairPlay → detect, report
`DRM_PROTECTED`, stop. Never attempt licence acquisition or key extraction. HLS
`AES-128` with an in-manifest key URI is _not_ DRM — ffmpeg handles it natively
and it is fully in scope. See analysis §3.

**Re-probe before downloading.** Signed media URLs commonly expire in 30–300 s.
The `probing` job state exists for this reason; never download using a probe
result from the original API request. See analysis §5.

**Replay `RequestContext` on every fetch**, not just the manifest — segments are
gated too. Missing `Referer` is the single most common cause of a 403. Log one
only through `redactRequestContext` from `@downloader/contract`.

**Video-specific error codes live in `contract/src/errors.ts`**, in
`DOWNLOADER_ERROR_CODES`. The generic half comes from `@webtools/core` — see the
root `CLAUDE.md` for which is which.
