# tools

A repo of small, independent web tools that share a toolchain, a CI pipeline and
a set of conventions. They do not share a domain — each one is its own service,
its own image and its own version, and none of them imports from another.

| Tool                                           | What it does                                              | State                                                                  |
| ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| [**downloader**](./tools/downloader/README.md) | Page URL in, video stream found and downloaded, link out  | Complete and deployable · [changelog](./tools/downloader/CHANGELOG.md) |
| [**planner**](./tools/planner/docs/)           | Describe a trip, plan it with an assistant, keep the plan | In flight — `npm run status` for what is open                          |

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

### From the registry, instead of building

Every release publishes an image per tool to GHCR, so a host can run a version
that was built once rather than compile one, and needs neither the toolchain nor
the source:

```
ghcr.io/<owner>/downloader:0.2.0
```

**A package's visibility is its own setting.** The first push creates it
private, and making the repository public does not change that — so
authenticate once, with a **classic** personal access token carrying
`read:packages` and nothing else. Classic rather than fine-grained is forced:
`read:packages` has no fine-grained equivalent, so a fine-grained token cannot
be given the scope at all.

```bash
echo "$TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

Then run the image on its own — the same three settings `compose.yaml` explains
at length, and the loopback bind for the same reason:

```bash
docker run --init --shm-size=1g \
  -p 127.0.0.1:8080:8080 \
  -v downloader-data:/data \
  -e BROWSER_NO_SANDBOX=true \
  ghcr.io/<owner>/downloader:0.2.0
```

Or let compose name the version, which is what a deployment host does.
`compose.prod.yaml` pulls instead of building and reads `GHCR_OWNER` and an
exact `DOWNLOADER_TAG` from `.env` — it also stands up the Cloudflare Tunnel, so
it is the whole deployment rather than a way to pull one image:

```bash
cp .env.prod.example .env      # GHCR_OWNER, DOWNLOADER_TAG, TUNNEL_TOKEN
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

The tag is an exact version rather than `latest` on purpose: a host following a
moving tag cannot answer what it is running, and `/api/health` reports the
version so the two can be compared. Which versions exist, and how one is cut,
are in [docs/03-RELEASING.md](./docs/03-RELEASING.md); the tunnel and the login
in front of it are in [docs/02-DEPLOYMENT.md](./docs/02-DEPLOYMENT.md).

Publishing takes no setup of its own — merging a release pull request pushes the
image.

## Commands

```bash
npm run check                 # lint + format check + typecheck — the gate
npm test                      # vitest, every project
npm test -- --project <tool>  # one tool's suite: seconds, not a minute
npm run build                 # every workspace
npm run e2e:downloader        # whole stack in a real browser
npm run e2e:planner           # the intake, likewise (`npm run e2e:install` once first)
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
  api                  Fastify, SQLite persistence, HTTP, run orchestration, the UI
  web                  React + Vite UI
  e2e                  Playwright: the intake, in a browser, against the built bundle
```

The two ports differ from each other on purpose, so both tools can run at once
without either being reconfigured.

Each tool's documentation lives with its code, on the same spine — analysis,
architecture, roadmap, and one file per ticket. Where a tool stands is
`npm run status`, computed from those tickets rather than written down. The root
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
