# Status and handoff

Living document. Updated at the end of each work session so the next agent can
start without re-deriving where things stand. Roadmap and phase definitions live
in [02-ROADMAP.md](./02-ROADMAP.md); this file records what actually happened.

**Last updated:** 2026-08-05 · **Phase 0 ✅ · Phase 1 ✅ · Phase 2 next**

---

## Where things stand

| Phase                    | State          | Evidence                                   |
| ------------------------ | -------------- | ------------------------------------------ |
| Phase 0 — Foundations    | ✅ complete    | `5ab843f`                                  |
| Phase 1 — Parallel build | ✅ complete    | `5662f95`, `725740c`, `ca35a55`, `b876906` |
| Phase 2 — Integration    | ⬜ not started | WP-5, `apps/api`                           |
| Phase 3 — Hardening      | ⬜ not started | WP-6 security, WP-7 ops                    |

**330 tests pass. `npm run check` is green.** 75 source files, 44 checked-in
fixtures, zero live-network tests.

### Milestones

- **M1 — Vertical slice ✅.** Proven by `packages/engine/test/hls-e2e.test.ts`,
  which generates a real HLS stream with the bundled ffmpeg, serves it from an
  origin that 403s any request missing `Referer`/`Cookie`/`User-Agent`, and
  asserts the output MP4 has `moov` before `mdat`, re-decodes cleanly, and that
  **every `.ts` segment** carried the replayed headers.
- **M2 — Any-site probe ⬜ deferred to WP-5** by decision. The components exist
  but nothing composes them: `ResolverRegistry` deliberately ships no default
  resolver set, because which tiers exist is a deployment choice. Rather than
  build a throwaway CLI, M2 gets proven once `apps/api` composes the registry
  for real. **Acceptance still requires `ENABLE_YTDLP_RESOLVER=false` against a
  site with no yt-dlp extractor** — a probe that only works with the extractor
  tier enabled has not demonstrated the capability.
- **M3, M4** — after WP-5 and WP-6/WP-7 respectively.

---

## What Phase 1 delivered

| WP       | Package              | Tests | Commit    |
| -------- | -------------------- | ----- | --------- |
| **WP-1** | `packages/resolvers` | 91    | `5662f95` |
| **WP-2** | `packages/resolvers` | 52    | `725740c` |
| **WP-3** | `packages/engine`    | 119   | `ca35a55` |
| **WP-4** | `apps/web`           | 68    | `b876906` |

**WP-1** — `registry.ts` (ascending priority, falls through on
`NO_MEDIA_FOUND`, rethrows every other `AppError` immediately, one chain-wide
`AbortSignal` budget), `manifest/hls.ts` and `manifest/dash.ts` (pure parsers,
and the DRM detectors), `resolvers/direct.ts` (priority 90),
`resolvers/ytdlp.ts` (priority 20), `common.ts` (shared label/codec helpers).
The expendability invariant is tested, not merely asserted: with yt-dlp
disabled — and separately, with the binary absent — resolution still succeeds
via the next tier.

**WP-2** — `resolvers/browser.ts` (priority 50) plus `src/browser/*`: pooled
browser, fresh `BrowserContext` per probe, interception on both `request` and
`response` matching Content-Type as well as extension, DRM detection by
wrapping `navigator.requestMediaKeySystemAccess` in an init script, playback
provocation (consent banners, scroll, click, `video.play()`, same-origin
iframes), hit ranking, and precise failure classification. Parsers are injected
(`hlsParser`/`dashParser`) and a throwing parser degrades to an opaque manifest
variant rather than failing the probe.

**WP-3** — `ffmpeg/*` (runner, args, headers, progress, process-tree kill),
`download/*` (progressive, hls, dash, retry, pool, segments), `mux.ts`,
`storage.ts`, `estimate.ts`, `config.ts`, `logger.ts`, `redact.ts`, and
`scripts/download.ts`.

**WP-4** — React + Vite on a mocked API, transport behind a one-line switch
(`VITE_API_MOCK=false`), pure logic in `src/lib/*`, components in
`src/components/*`. A **Demo scenarios** panel makes all 20 `ErrorCode`s
clickable; a test asserts every one is reachable.

### Three fixes worth remembering

- **WP-2 found a real hang.** An abandoned `fetch()` response — where the page
  never reads the body — makes Playwright's `response.text()` never settle. It
  pinned a browser concurrency slot forever. All body/header reads are now
  bounded and the probe has a hard outer timeout.
- **The ffmpeg protocol whitelist excludes `file:`**, so a hostile manifest
  cannot pull `file:///etc/passwd` into the output.
- **`Range` is stripped from replayed headers**, because an MSE capture's
  `Range` would silently truncate the download.

---

## Decisions taken during Phase 1

**Test runner is vitest, not `node:test`.** The pinned Node (22.15) cannot strip
TypeScript types without a flag, so `.ts` tests failed outright under
`node --test`. Config in `vitest.config.ts`; globals are off so oxlint's
`no-undef` keeps working.

**`packages/resolvers/src/manifest/types.ts` is the parser seam.**
`ParsedManifest`, `HlsParser`, `DashParser` — fixed up front so WP-1 and WP-2
could build against it simultaneously. Owned by the integrator, not either WP.

**`react/react-in-jsx-scope` is disabled at the root**, not in a nested config:
the automatic JSX runtime makes the import dead code. `no-await-in-loop` is off
in tests, where sequential awaits are usually the thing under test.

**ClearKey is currently terminal** (`DRM_PROTECTED`) — see the pending change
below, which reverses this.

---

## Next up — do these first

Phase 1 is done, so **`packages/shared` is unfrozen.** Five changes are approved
and should land **before WP-5 starts**, because WP-5 consumes all of them.

### 1. Add a resolver-level `CANCELED` error code

`shared/errors.ts`. Two agents independently hit this gap and diverged: WP-1's
registry used `JOB_CANCELED`, WP-2's browser resolver used `TIMEOUT`, for the
same condition — the caller's `AbortSignal` fired. Resolvers know nothing about
jobs, so `JOB_CANCELED` is the wrong vocabulary leaking downward.

- Add the code, its `DEFAULT_ERROR_MESSAGES` entry, and decide its
  `RETRYABLE_CODES` membership (an explicit cancel is **not** retryable).
- Then update `packages/resolvers/src/registry.ts` and
  `packages/resolvers/src/browser/classify.ts` to use it, and the tests that
  currently assert `JOB_CANCELED` / `TIMEOUT` for aborts.

### 2. Add response and event zod schemas to `shared/api.ts`

Today `api.ts` validates **requests only**. `Job`, `JobProgress`, `JobResult`,
`JobEvent`, `AppErrorPayload`, `ProbeResult`, `MediaVariant`, `SubtitleTrack`,
`DrmInfo` and `RequestContext` are plain interfaces with no runtime counterpart,
so anything crossing an untrusted boundary needs a hand-written guard. WP-4
already wrote one (`apps/web/src/lib/contract-guards.ts`) for SSE frames and
rehydrated `localStorage`; WP-5 will need the same thing for the server side.

- Add the schemas, satisfying the existing interfaces (`satisfies z.ZodType<T>`,
  as `jobOptionsSchema` already does) so the types stay authoritative.
- Then delete `apps/web/src/lib/contract-guards.ts` and use the schemas.

### 3. Let `JobEvent` carry a cancellation reason

There is no `canceled` event type and `status` frames carry no payload, so a
client that only listens learns the job was canceled but never receives the
`JOB_CANCELED` `AppErrorPayload`. WP-4 synthesises that copy locally. WP-5
implements SSE next, so this is cheapest to fix now — either add a `canceled`
variant to the `JobEvent` union, or give `status` frames an optional payload.

Related: `Job.error` is `AppErrorPayload | null` **and** `canceled` is a separate
terminal status, so "canceled" is representable two ways. WP-4 treats status as
authoritative. Pick one and document it.

### 4. Move redaction into `shared`

`Cookie`/`Authorization` redaction is now implemented independently in
`packages/resolvers/src/browser/redact.ts` and `packages/engine/src/redact.ts`,
and `apps/api` will need a third. One helper in `shared` means no consumer can
forget it separately. Note the engine's version also strips query strings, since
signed URLs carry credentials there — keep that behaviour.

### 5. Treat ClearKey as in scope

Reverses the current behaviour, where any EME key system including ClearKey is
terminal `DRM_PROTECTED`.

⚠️ **Define the boundary before writing code — this one abuts a hard stop.**
`CLAUDE.md` forbids licence acquisition and key extraction, and that does not
change. The defensible reading, and the one to implement unless the owner says
otherwise:

- ClearKey where **the key is directly fetchable from a URI in the manifest** is
  transport encryption, like HLS AES-128 — in scope, `protected: false`.
- ClearKey that requires an **EME licence exchange** is still a hard stop —
  `DRM_PROTECTED`, no attempt to acquire the key.

Files: `packages/resolvers/src/manifest/hls.ts` (`KEYFORMAT` mapping),
`manifest/dash.ts` (`DRM_UUIDS`), `src/browser/drm.ts` (key-system mapping).
Fixtures and assertions in `test/hls.test.ts` and `test/dash.test.ts` change
with them. **Confirm the boundary above with the owner before starting.**

### Then: WP-5 (`apps/api`)

Brief in [03-AGENT-BRIEFS.md](./03-AGENT-BRIEFS.md). One agent, alone — it is
the join point. It also carries **M2 and M3**. The engine seam it consumes is
documented at the top of `packages/engine/src/index.ts`:

```ts
const engine = createEngine({ storageDir, maxFileSizeBytes, logger, fetchImpl?, proxyUrl? });
await engine.init();
const outcome = await engine.download({ jobId, variant, requestContext, … , signal?, onProgress?, onStage? });
await engine.collectGarbage(now?);
await engine.removeJob(jobId);
```

The engine throws only `AppError`, does **not** re-probe, and does **not**
SSRF-check — both belong to the caller.

---

## Known gaps and risks

**No SSRF guard exists anywhere.** Both resolver agents flagged this
independently. `DirectUrlResolver` follows redirects via `fetch` without
re-validating the host, and the browser sniffer's output is the most
attacker-influenced data in the system. Formally WP-6, but WP-5 is the first
code that exposes it to the internet — do not ship the API without it.

**Test files are not typechecked.** Each project's `include` is `src/**`, so
`tsc --build` never sees `test/**`. Vitest transpiles without typechecking, so
type errors in tests go undetected. Fix with a per-package `tsconfig.test.json`
when convenient.

**403 is ambiguous.** The engine maps 403/404/410 → `VARIANT_GONE` uniformly per
analysis §7. On a job's _first_ request this can misattribute a header problem
as an expiry. Both are retryable so the orchestrator re-probes either way, but
WP-5 should know.

**ffmpeg failures on a manifest surface as `DOWNLOAD_FAILED`, not
`VARIANT_GONE`**, because ffmpeg does the fetching and only reports status in
text (the 403 evidence lands in `details.stderr`). For automatic re-probe on
expiry, WP-5 should treat `DOWNLOAD_FAILED` during `downloading` as
re-probe-worthy once.

**No proxy for direct fetches.** Node's global `fetch` has no proxy support and
no dependency was added. ffmpeg _is_ proxied via its environment, so HLS/DASH is
covered; progressive, segment and subtitle fetches are not.
`EngineConfig.fetchImpl` is the injection point, and the engine warns when
`PROXY_URL` is set without one. Adding `undici` would close this.

**No logger.** `no-console` is in force and no logging package exists yet, so
the engine takes an injectable `Logger` and defaults to `NOOP_LOGGER`;
resolvers emit nothing and put diagnostics in `AppError.details`. WP-7 brings
`pino` — wire these seams to it then.

**`ParsedManifest` cannot carry segment addressing.** `$Number$`/`$Time$`/
`SegmentTimeline` are parsed and used, but the mode, init URL and media template
cannot be surfaced. Fine while ffmpeg gets handed manifests whole; it bites the
moment the engine's manual segment-fetch fallback needs to enumerate segments
itself. The fallback currently takes an explicit `segmentUrls` list instead.

**`MediaVariant.url` is documented as the manifest URL**, so per-representation
DASH selection is expressible only through `id`. WP-1's parser therefore returns
the MPD as `url` for segment-templated representations and lets ffmpeg map both
streams.

**No component-render tests** in `apps/web` — no jsdom or testing-library by
decision. Accessibility is enforced statically by `jsx-a11y` and by
construction. The WP-7 Playwright E2E is the right place for interaction
coverage.

**Vite output goes to `dist/app/`**, not `dist/`, because `tsc --build` emits
declarations into `dist/` and `emptyOutDir` would wipe them.

---

## Running things

```bash
npm run check                       # lint + format + typecheck — must pass
npm test                            # vitest run, all 330
npx vitest run packages/engine      # one package
npm run dev -w @downloader/web      # UI against the mock, no backend needed
```

`npx vitest run packages/resolvers` includes the browser suite, which launches
Chromium and takes ~35 s. Playwright's Chromium is installed; `ffmpeg-static`
provides ffmpeg. `yt-dlp` is **not** installed — which is by design, and the
tests prove the system works without it.
