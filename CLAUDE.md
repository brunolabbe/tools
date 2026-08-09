# CLAUDE.md

Conventions for every agent working in this repo. Read
`docs/00-STREAM-CAPTURE-ANALYSIS.md` before touching resolver or engine code —
most non-obvious decisions here are justified there, not repeated.

## What this is

A service that takes a web page URL, finds the video stream behind it, downloads
it, and hands back a link to the resulting file. The interesting problem is the
finding: modern players use MSE, so the `<video>` element carries a `blob:` URL
that means nothing outside the tab. Streams must be caught at the **network
layer**.

## Commands

```bash
npm install            # workspaces
npm run dev            # API (8080) + web (5173) together, both in watch mode
npm run dev:api        # just the API
npm run dev:web        # just the UI
npm run check          # lint + format check + typecheck — must pass before done
npm run lint:fix       # oxlint --fix
npm run format         # oxfmt
npm test               # vitest run
npm run test:watch     # vitest
npm run e2e            # Playwright: whole stack in a real browser
npm run e2e:install    # once — fetches the browser the e2e run needs

docker compose up --build   # the service on :8080, UI included
```

`npm run e2e` builds the UI itself before starting the API, because the bundle
bakes its transport in at build time — testing a stale `dist` is testing the
mock. The suite runs the direct resolver only and talks to a local fixture
origin it generates with ffmpeg; it never touches a third-party site.

`npm run dev` runs the two through `concurrently`. It cannot be
`npm run dev --workspaces`: npm runs workspace scripts **serially**, so the
API's watcher never exits and the web app is never reached.

The UI defaults to a **mocked** API — that is what let it ship before the
backend existed. `cp apps/web/.env.example apps/web/.env.local` to point it at
the real one. Until you do, the UI works but talks to nothing.

The API's dev script is `node --watch --import tsx`, not `tsx watch`. On Windows
`tsx watch` spawned by `concurrently` starts, prints nothing and never binds its
port — silently, which costs an afternoon if you do not know. Node's own
watcher does the restarting and tsx only transforms.

Tooling: **oxlint** and **oxfmt** (not eslint/prettier). Config in
`.oxlintrc.json` and `.oxfmtrc.json`.

`oxfmt` is opinionated in the gofmt sense — at the pinned version the only
setting it honours is `ignorePatterns`. Style keys like `quoteStyle` and
`lineWidth` parse without error but are silently ignored, so do not add them and
do not argue with its output (it uses double quotes). Run `npm run format` and
move on. Lint rules, by contrast, are fully configurable in `.oxlintrc.json`.

## Layout

```
packages/shared      types, error taxonomy, job FSM, zod schemas, redaction — no logic
packages/resolvers   URL → ProbeResult (registry + resolver implementations)
packages/engine      ProbeResult → file on disk (ffmpeg, storage, GC)
apps/api             Fastify, job orchestration, SSE, file serving, SSRF guard
apps/web             React + Vite UI
e2e/                 Playwright specs + the fixture HLS origin they run against
docs/                analysis, architecture, roadmap, agent briefs, status
```

The API also serves the built UI when `WEB_DIR` is set, which is how the
container ships them on one origin — same-origin means no CORS to configure and
an `EventSource` that just works.

`apps/api` is the only place that reads `process.env`. The engine and the
resolvers are libraries and take their configuration as arguments.

## Rules

**`packages/shared` is the contract.** Import all cross-package types from
`@downloader/shared`. Never redefine them locally. If you think the contract is
wrong, stop and say so — do not edit it unilaterally; three sibling packages
depend on it.

**Errors are typed.** Throw `AppError` with a code from `shared/errors.ts`.
Never a bare `Error`, never an ad-hoc string code. If no existing code fits,
say so rather than inventing one locally.

**DRM is a hard stop.** Widevine / PlayReady / FairPlay → detect, report
`DRM_PROTECTED`, stop. Never attempt licence acquisition or key extraction. HLS
`AES-128` with an in-manifest key URI is _not_ DRM — ffmpeg handles it natively
and it is fully in scope. See analysis §3.

**Re-probe before downloading.** Signed media URLs commonly expire in 30–300 s.
The `probing` job state exists for this reason; never download using a probe
result from the original API request. See analysis §5.

**Replay `RequestContext` on every fetch**, not just the manifest — segments are
gated too. Missing `Referer` is the single most common cause of a 403.

**Never invoke a shell.** Spawn with argument arrays, `shell: false`. User URLs
and titles reach ffmpeg and yt-dlp arguments.

**Redact `Cookie` and `Authorization`** anywhere a `RequestContext` is logged.
Captured headers routinely contain live session credentials.

**SSRF-check every URL**, including ones that came out of a resolver and
including after each redirect. Resolver output is attacker-influenced.

**Kill process trees**, not processes. On Windows use `taskkill /T /F`; a bare
`child.kill()` leaves orphaned ffmpeg and Chromium behind.

**Never fake progress.** When the total is unknown (live streams, no
`Content-Length`), report `null` and let the UI show an indeterminate state.

## Testing

**vitest**, configured once in the root `vitest.config.ts`; tests live in
`<package>/test/**/*.test.{ts,tsx}`. Import `test`/`expect`/`vi` explicitly —
globals are off on purpose, so oxlint's `no-undef` keeps working. Do not reach
for `node:test`: the pinned Node (22.15) cannot strip TypeScript types without a
flag, so `.ts` tests fail under it outright.

Fixtures, not live network calls — real sites change, rate-limit, and geo-vary,
which makes CI failures meaningless. Check in real manifests under
`test/fixtures/` and parse them offline. E2E runs against a local fixture server
serving a genuine HLS stream.

## Style

TypeScript strict, ESM, `.ts` extensions in relative imports (NodeNext),
`import type` for type-only imports, `node:` protocol for builtins. No `any`.
No `console` — use the logger. Comment _why_, not _what_.
