# downloader

Give it a web page URL. It finds the video stream behind the page, downloads it,
and hands back a link to the file.

> **Status: complete and deployable.** `docker compose up` gives a working
> service on <http://localhost:8080>. See [docs/04-STATUS.md](./docs/04-STATUS.md)
> for what shipped and what is still rough.

## Why this is not trivial

Modern players use Media Source Extensions: JavaScript fetches media in chunks
and feeds them to the player in memory, so the `<video>` element ends up with a
`blob:` URL that is meaningless outside that browser tab. There is nothing on
the page to right-click.

The bytes still cross the network though — so the stream is caught at the
**network layer**, by driving a real browser and watching what the page's own
player requests. Full reasoning in
[docs/00-STREAM-CAPTURE-ANALYSIS.md](./docs/00-STREAM-CAPTURE-ANALYSIS.md).

## How it works

```
URL → resolvers (site-specific → yt-dlp → browser sniffer → direct)
    → ProbeResult (variants, subtitles, request headers, DRM status)
    → re-probe (signed URLs expire in seconds)
    → download (HLS / DASH / progressive)
    → ffmpeg mux → file + expiring download link
```

Resolvers are tried in priority order and the first usable answer wins.

The **Playwright sniffer is the foundation** — it works on sites nobody has ever
written code for, which is what "any website" actually requires. The `yt-dlp`
tier in front of it is purely a fast path for the ~1800 sites it has extractors
for: better metadata, ~2 s instead of ~15 s. It is optional by design, and the
service is fully functional without it. An extractor-only tool was considered and
ruled out — on an unknown site its coverage is not degraded but zero. See
[docs/02-ROADMAP.md](./docs/02-ROADMAP.md).

## Scope

**In:** HLS, DASH, progressive MP4/WebM, HLS AES-128 transport encryption,
split audio/video muxing, subtitles, live capture with a duration limit.

**Out:** Widevine / PlayReady / FairPlay DRM. These are detected and reported as
`DRM_PROTECTED`, and the pipeline stops there by design — see analysis §3. That
boundary costs the major subscription streaming services and leaves the large
majority of the web in scope.

## Getting started

### With Docker

```bash
docker compose up --build      # http://localhost:8080
```

One container: the UI, the API behind it, ffmpeg, Chromium, and a volume that
keeps downloads and the job database across restarts. It binds to loopback on
purpose — this service fetches URLs a client names, so publishing it on every
interface by default would be handing out an open proxy. `compose.yaml`
documents what to change before putting it behind anything.

### From source

```bash
npm install
cp .env.example .env
npm run dev       # API on :8080 and UI on :5173, both watching
npm run check     # lint (oxlint) + format (oxfmt) + typecheck
npm test          # vitest
npm run e2e       # whole stack in a real browser (npm run e2e:install first)
```

Requires Node ≥ 22. `ffmpeg` ships bundled via `ffmpeg-static`; `yt-dlp` is
optional and the system degrades to browser-sniffing without it.

The UI defaults to a **mocked** API in development, so it runs with no backend
at all — copy `apps/web/.env.example` to `apps/web/.env.local` to point it at a
running API. A production build defaults the other way.

## Docs

|                                                                      |                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| [00 — Stream capture analysis](./docs/00-STREAM-CAPTURE-ANALYSIS.md) | How video is delivered and how to catch it. **Read first.** |
| [01 — Architecture](./docs/01-ARCHITECTURE.md)                       | Packages, pipeline, decisions, config, security             |
| [02 — Roadmap](./docs/02-ROADMAP.md)                                 | What was ruled out, the recommendation, phases, milestones  |
| [03 — Agent briefs](./docs/03-AGENT-BRIEFS.md)                       | Ready-to-paste work packages                                |
| [04 — Status](./docs/04-STATUS.md)                                   | What shipped, decisions taken, known gaps                   |
| [CLAUDE.md](./CLAUDE.md)                                             | Conventions every agent follows                             |

## Layout

```
packages/shared      types, error taxonomy, job FSM, zod API schemas
packages/resolvers   URL → ProbeResult
packages/engine      ProbeResult → file on disk
apps/api             Fastify, orchestration, SSE, file serving, the UI
apps/web             React + Vite UI
e2e                  Playwright: the whole stack, one fixture HLS origin
```
