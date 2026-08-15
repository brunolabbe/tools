# tools

A repo of small, independent web tools that share a toolchain, a CI pipeline and
a set of conventions. They do not share a domain — each one is its own service,
its own image and its own version, and none of them imports from another.

| Tool                                             | What it does                                              | State                                                              |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| [**downloader**](./tools/downloader/README.md)   | Page URL in, video stream found and downloaded, link out  | Complete and deployable · [0.1.1](./tools/downloader/CHANGELOG.md) |
| [**planner**](./tools/planner/docs/03-STATUS.md) | Describe a trip, plan it with an assistant, keep the plan | In flight — scaffold done, the intake is being built               |

## Getting started

Requires Node ≥ 22.

```bash
npm install
npm run dev              # the downloader: API on :8080, UI on :5173
npm run dev:planner      # the planner:    API on :8090, UI on :5183
```

Or the downloader as the one container that ships it, which needs no toolchain
at all:

```bash
docker compose up --build      # http://localhost:8080
```

It binds to loopback on purpose — this service fetches URLs a client names, so
publishing it on every interface by default would be handing out an open proxy.
To reach it from outside the host,
[docs/02-DEPLOYMENT.md](./docs/02-DEPLOYMENT.md) puts it on a subdomain behind a
Cloudflare Tunnel and a login, without opening a port on the router.

The planner runs against a **scripted** model provider by default, so a fresh
clone answers with no key, no account and no bill. Pointing it at a real
provider is a deliberate act.

## Commands

```bash
npm run check                 # lint + format check + typecheck — the gate
npm test                      # vitest, every project
npm test -- --project <tool>  # one tool's suite: seconds, not a minute
npm run build                 # every workspace
npm run e2e:downloader        # whole stack in a real browser
```

Lint and format are **oxlint** and **oxfmt**, not eslint and prettier.

## Layout

Anything tool-agnostic lives in `packages/`; everything else belongs to exactly
one tool. Shared code moves to `packages/` on the second real consumer, not the
first guess.

```
packages/core          error machinery, job transitions, redaction — no domain
tools/downloader/
  contract             types, error taxonomy, job FSM, zod API schemas
  resolvers            URL → ProbeResult
  engine               ProbeResult → file on disk
  api                  Fastify, orchestration, SSE, file serving, the UI
  web                  React + Vite UI
  e2e                  Playwright: the whole stack, one fixture HLS origin
tools/planner/
  contract             types, error taxonomy, zod API schemas
  intake               the authored question tree — no model, no network, no clock
  agent                prompts, the roster, the specialists, the provider seam
  api                  Fastify, SQLite persistence, HTTP, run orchestration
  web                  React + Vite UI
```

The two ports differ from each other on purpose, so both tools can run at once
without either being reconfigured.

Each tool's documentation lives with its code, on the same spine — analysis,
architecture, roadmap, status, and one file per ticket. The root
[docs/](./docs/) holds only what is true of the repo: the tool index, the ticket
format, deployment, releasing, and the ADRs for decisions binding more than one
tool.

[docs/00-TOOLS.md](./docs/00-TOOLS.md) is the index.
[CLAUDE.md](./CLAUDE.md) is the conventions every agent working here follows.

## Contributing

Commits are conventional and it is enforced — `type(scope): subject`, with the
scope naming a tool or `core` · `repo` · `ci` · `deps`. This repo squash-merges,
so the **pull request title** is the message that lands and the one CI checks.
Versions and changelogs are generated from it, per tool. The taxonomy and the
release flow are in [docs/03-RELEASING.md](./docs/03-RELEASING.md).

Security reports go through GitHub's private vulnerability reporting, not a
public issue — see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE).
