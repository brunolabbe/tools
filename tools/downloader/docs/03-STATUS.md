# Status

Where the downloader stands right now. Phases and milestones are defined in
[02-ROADMAP.md](./02-ROADMAP.md); what each piece of work actually did is in its
ticket under [work/](./work/). This page is a dashboard, not a log — if you find
yourself writing a paragraph here, it belongs in a ticket.

**Last updated:** 2026-08-14 · **Phases 0–3 ✅ · M1–M4 ✅ · Phase 4 (coverage)
is what remains**

---

## Where things stand

| Phase                    | State       | Evidence                                                                                                                                                               |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Foundations    | ✅ complete | `5ab843f`                                                                                                                                                              |
| Phase 1 — Parallel build | ✅ complete | [dl-1](./work/dl-1-resolver-registry-and-parsers.md) · [dl-2](./work/dl-2-browser-sniffer.md) · [dl-3](./work/dl-3-download-engine.md) · [dl-4](./work/dl-4-web-ui.md) |
| Phase 2 — Integration    | ✅ complete | [dl-5](./work/dl-5-api-and-orchestration.md)                                                                                                                           |
| Phase 3 — Hardening      | ✅ complete | [dl-6](./work/dl-6-security-and-limits.md) · [dl-7](./work/dl-7-ops-and-e2e.md)                                                                                        |

**509 tests pass across 33 files, plus 3 Playwright end-to-end tests.
`npm run check` is green.** Zero live-network tests.

### Milestones

- **M1 — Vertical slice ✅.** Proven by `tools/downloader/engine/test/hls-e2e.test.ts`.
- **M2 — Any-site probe ✅.** `api/src/resolvers.ts` composes the registry, and
  `api/test/queue-and-shutdown.test.ts` asserts the expendability invariant
  directly — with `ENABLE_YTDLP_RESOLVER=false` the chain still resolves.
- **M3 — Functional goal ✅.** Probe → job → SSE → download link → file, against
  an origin that 403s any request missing the captured `Referer`. Details in
  [dl-5](./work/dl-5-api-and-orchestration.md).
- **M4 — Deployable ✅.** `docker compose up` gives a working service, verified
  by doing it rather than by reading the Dockerfile. Details in
  [dl-7](./work/dl-7-ops-and-e2e.md). The Dockerfile now lives under this tool
  rather than at the repo root, and the deployed host pulls a released image
  instead of building one — [dl-10](./work/dl-10-release-pipeline.md).

## Open tickets

| Ticket                                    | Status    | Note                                                 |
| ----------------------------------------- | --------- | ---------------------------------------------------- |
| [dl-10](./work/dl-10-release-pipeline.md) | in-flight | Landed but unproven — the first release exercises it |

Phase 4 adds a ticket per site-specific resolver, as and when the sniffer misses
one.

## Open questions for the owner

1. **`attempts` semantics.** Currently "how many probe-and-download attempts this
   job has made", so a first-time success reports `1`. Worth confirming that is
   what the UI wants to render.
2. **The rate-limit defaults** — see the closing section of
   [dl-6](./work/dl-6-security-and-limits.md).

---

## Known gaps and risks

**Rate limiting is per-process, not per-deployment.** The buckets live in
memory, so two replicas behind a load balancer grant two allowances. Correct for
the single-container deployment this targets; a shared store (the same Redis
BullMQ would want) is the fix if it is ever scaled out.

**DNS rebinding: closed, except through ffmpeg.** `api/src/dispatcher.ts` pins
the vetted address into the socket, so the check and the connection can no
longer disagree — see [dl-8](./work/dl-8-address-pinning-and-proxy.md). What
remains is the ffmpeg gap below.

**ffmpeg fetches outside the guard.** `guarded-fetch.ts` covers the direct
resolver and the engine's own fetches, but ffmpeg does its own HTTP and cannot
be wrapped. This is why the guard vets **every URL in a `ProbeResult`** before
the engine is handed anything — that check is load-bearing, not belt-and-braces,
TOCTOU and all.

**Proxy mode does not pin, by design.** With `PROXY_URL` set, the target name is
resolved by the proxy and there is no local resolution to pin; what bounds
egress there is the proxy's own policy. The pre-flight check still runs, and
`SSRF_ALLOW_PRIVATE_ADDRESSES` exists for the deployment whose DNS view differs
from its proxy's.

**Test files are still not typechecked.** Each project's `include` is `src/**`.
`api/test` is the largest untypechecked surface here, and `e2e/` is in the same
position — Playwright transpiles it without type checking, so a stale selector
helper fails at run time rather than at build.

**Interrupted jobs are failed, not resumed.** A job running when the process
died cannot be resumed — the engine's tmp state is gone and the probe is stale —
so `reconcileInterruptedJobs` fails them with a retryable `INTERNAL` at boot
rather than leaving a progress bar that never moves.

**403 is ambiguous** and **ffmpeg failures surface as `DOWNLOAD_FAILED`** —
both handled rather than solved: `DOWNLOAD_FAILED` during `downloading` is
treated as re-probe-worthy exactly once.

**No component-render tests** in `web`, and **the E2E suite drives only the
direct resolver** — so nothing exercises sniffer → engine → UI in one piece, and
**the container's browser tier is only smoke-tested**. See
[dl-2](./work/dl-2-browser-sniffer.md) and [dl-4](./work/dl-4-web-ui.md).

---

## Running things

```bash
npm run check                         # lint + format + typecheck — must pass
npm test -- --project downloader      # this tool's suites
npx vitest run tools/downloader/api   # one package

npm run e2e:install                   # once: fetches the browser
npm run e2e:downloader                # whole stack in a real browser

docker compose up --build             # the service, on http://localhost:8080

npm run dev                           # API on 127.0.0.1:8080, UI on 5173
npm run dev:downloader:api            # or one at a time
npm run dev:downloader:web
```

`web` defaults to the **mock** transport. To point it at a running API, copy
`tools/downloader/web/.env.example` to `.env.local` (it sets
`VITE_API_MOCK=false`). The Vite dev server proxies `/api`, so the setup is
same-origin and needs no CORS configuration.

**Two dev-tooling traps, both fixed, both worth not re-introducing.**
`npm run dev --workspaces` runs workspaces _serially_, so the API's watcher held
the chain and the web app never started — the root script goes through
`concurrently` now. And on Windows, `tsx watch` under `concurrently` starts,
prints nothing and never binds: no error, no exit, just a dead port. The API dev
script is `node --watch --import tsx` for that reason.

To exercise the real pipeline without a browser tier, as the M3 verification did:

```bash
ENABLE_BROWSER_RESOLVER=false ENABLE_YTDLP_RESOLVER=false \
  SSRF_ALLOW_HOSTS=127.0.0.1 STORAGE_DIR=./storage \
  npm run dev -w @downloader/api
```

`SSRF_ALLOW_HOSTS` is the escape hatch for a local fixture origin; it is empty
by default and must stay that way in production.

A load test will trip the limits long before it finds anything interesting.
Turn them off for that, and only that:

```bash
RATE_LIMIT_PROBE_PER_MINUTE=0 RATE_LIMIT_JOBS_PER_MINUTE=0 \
  npm run dev -w @downloader/api
```
