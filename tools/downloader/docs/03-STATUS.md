# Status

Where the downloader stands. The tables below are written from the tickets'
frontmatter by `node scripts/status.mjs --write`, which runs on `main` after a
merge — so this page cannot disagree with the tickets, and a branch never edits
it. `npm run status` prints the same thing without opening a file.

Nothing else here is state. If you are about to write a paragraph, it belongs
somewhere that something keeps true:

| What you want to say                     | Where it goes                                              |
| ---------------------------------------- | ---------------------------------------------------------- |
| A ticket is done, or blocked, or open    | its own frontmatter. The tables below are the view         |
| What a piece of work did, and got wrong  | that ticket's `## Log`, in [work/](./work/)                |
| A gap the tool still has                 | the ticket that closes it — and if there is none, file one |
| Why the code is shaped the way it is     | a comment beside the code                                  |
| A decision that binds more than one tool | an [ADR](../../../docs/adr/)                               |
| What a phase or a milestone means        | [02-ROADMAP.md](./02-ROADMAP.md)                           |

The reasoning is in [adr/003](../../../docs/adr/003-the-status-page-is-generated.md):
a status page restating what the tickets already record is a file every branch
edits and no branch owns, and it goes wrong quietly rather than loudly.

## Where things stand

<!-- generated:tickets -->

<!-- Written by `node scripts/status.mjs --write`, which runs on `main` after a merge.
     Do not edit this region: a ticket's frontmatter is what it is generated from, and a
     branch that edits it here is the merge conflict ADR 003 exists to end. -->

### Milestones

| Milestone      | Done | Open | Dropped | State       |
| -------------- | ---- | ---- | ------- | ----------- |
| M1             | 1    | 0    | 0       | complete    |
| M2             | 2    | 0    | 0       | complete    |
| M3             | 2    | 0    | 0       | complete    |
| M4             | 2    | 0    | 0       | complete    |
| _no milestone_ | 7    | 3    | 0       | in progress |

### Open tickets

| Ticket                                            | Kind  | Status | Milestone | What it is                                                   |
| ------------------------------------------------- | ----- | ------ | --------- | ------------------------------------------------------------ |
| [dl-15](./work/dl-15-component-render-tests.md)   | chore | ready  | —         | Render the UI's components in tests, not only its logic      |
| [dl-16](./work/dl-16-e2e-through-the-sniffer.md)  | chore | ready  | —         | Drive the browser sniffer end to end, through the UI         |
| [dl-17](./work/dl-17-name-an-unknown-endpoint.md) | fix   | ready  | —         | Answer an unknown endpoint with NOT_FOUND, not JOB_NOT_FOUND |

<details>
<summary>Closed — 14 tickets</summary>

| Ticket                                                 | Kind         | Status | What it was                                                                |
| ------------------------------------------------------ | ------------ | ------ | -------------------------------------------------------------------------- |
| [dl-1](./work/dl-1-resolver-registry-and-parsers.md)   | work-package | done   | Resolver registry, manifest parsers, yt-dlp fast path                      |
| [dl-2](./work/dl-2-browser-sniffer.md)                 | work-package | done   | Browser sniffer resolver                                                   |
| [dl-3](./work/dl-3-download-engine.md)                 | work-package | done   | Download engine — ffmpeg, HLS/DASH/progressive, mux, storage               |
| [dl-4](./work/dl-4-web-ui.md)                          | work-package | done   | Web UI against a mocked API                                                |
| [dl-5](./work/dl-5-api-and-orchestration.md)           | work-package | done   | API and job orchestration                                                  |
| [dl-6](./work/dl-6-security-and-limits.md)             | work-package | done   | Security and limits — rate limiting, quotas, path confinement              |
| [dl-7](./work/dl-7-ops-and-e2e.md)                     | work-package | done   | Ops and end-to-end tests — Docker, logging, health, CI                     |
| [dl-8](./work/dl-8-address-pinning-and-proxy.md)       | fix          | done   | Pin vetted addresses into the socket, and proxy direct fetches             |
| [dl-9](./work/dl-9-fsm-reprobe-back-edge.md)           | chore        | done   | Give the job FSM a back-edge so a re-probe can be modelled honestly        |
| [dl-10](./work/dl-10-release-pipeline.md)              | chore        | done   | Release from conventional commits, and ship a tagged image to the registry |
| [dl-11](./work/dl-11-guarded-egress-proxy.md)          | fix          | done   | Put ffmpeg's own fetches behind a guarded egress proxy                     |
| [dl-12](./work/dl-12-tiers-behind-the-egress-proxy.md) | fix          | done   | Point the browser and yt-dlp tiers at the guarded egress proxy             |
| [dl-13](./work/dl-13-typecheck-the-tests.md)           | chore        | done   | Bring the test files and the e2e specs into the typechecker                |
| [dl-14](./work/dl-14-proxied-https-coverage.md)        | fix          | done   | Cover the proxied-HTTPS path with a TLS fixture origin                     |

</details>

<!-- /generated:tickets -->

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
