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
npm run dev            # all apps in watch mode
npm run check          # lint + format check + typecheck — must pass before done
npm run lint:fix       # oxlint --fix
npm run format         # oxfmt
npm test               # node:test
```

Tooling: **oxlint** and **oxfmt** (not eslint/prettier). Config in
`.oxlintrc.json` and `.oxfmtrc.json`.

`oxfmt` is opinionated in the gofmt sense — at the pinned version the only
setting it honours is `ignorePatterns`. Style keys like `quoteStyle` and
`lineWidth` parse without error but are silently ignored, so do not add them and
do not argue with its output (it uses double quotes). Run `npm run format` and
move on. Lint rules, by contrast, are fully configurable in `.oxlintrc.json`.

## Layout

```
packages/shared      types, error taxonomy, job FSM, zod API schemas — no logic
packages/resolvers   URL → ProbeResult (registry + resolver implementations)
packages/engine      ProbeResult → file on disk (ffmpeg, storage, GC)
apps/api             Fastify, job orchestration, SSE, file serving
apps/web             React + Vite UI
docs/                analysis, architecture, roadmap, agent briefs
```

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

Fixtures, not live network calls — real sites change, rate-limit, and geo-vary,
which makes CI failures meaningless. Check in real manifests under
`test/fixtures/` and parse them offline. E2E runs against a local fixture server
serving a genuine HLS stream.

## Style

TypeScript strict, ESM, `.ts` extensions in relative imports (NodeNext),
`import type` for type-only imports, `node:` protocol for builtins. No `any`.
No `console` — use the logger. Comment _why_, not _what_.
