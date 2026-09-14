# tools

A repo of small, independent web tools that share a toolchain, a CI pipeline and
a set of conventions. They do not share a domain — each one is its own service,
its own image and its own version, and none of them imports from another.

| Tool                                           | What it does                                              | Released                                     |
| ---------------------------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| [**downloader**](./tools/downloader/README.md) | Page URL in, video stream found and downloaded, link out  | [changelog](./tools/downloader/CHANGELOG.md) |
| [**planner**](./tools/planner/README.md)       | Describe a trip, plan it with an assistant, keep the plan | [changelog](./tools/planner/CHANGELOG.md)    |

**Each tool's README is that tool**: what it does, how to run it on its own, and
where its documentation lives. This page is what they have in common — running
them side by side, deploying a set of them to one host, and working in the repo.
Where any of them stands is `npm run status`, computed from the tickets rather
than written down.

## Running them locally

Requires Node ≥ 22.

```bash
npm install
npm run dev:downloader   # API on :8080, UI on :5173
npm run dev:planner      # API on :8090, UI on :5183
```

The ports differ on purpose, so every tool can run at once without any of them
being reconfigured. `npm run dev` on its own still means the downloader, which
came first.

Nothing here needs an account or a key to start. The planner in particular runs
against a **scripted** model and a checked-in table of distances by default, so a
fresh clone plans a trip with no key and no bill; pointing it at a real provider
is a deliberate act, described in its README.

## Deploying a set of tools

A host runs whichever tools it chooses, from released images at exact versions,
behind one Cloudflare Tunnel — each tool on its own subdomain with a login in
front, and no port opened on the router.

**The list of compose fragments a host merges is the only place it says which
tools it runs** ([adr/004](./docs/adr/004-one-compose-fragment-per-tool.md)), and
the list lives in `COMPOSE_FILE` in `.env`:

| The host runs  | `COMPOSE_FILE`                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| the downloader | `compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml`                           |
| the planner    | `compose.prod.yaml:compose.planner.prod.yaml`                                                      |
| both           | `compose.downloader.yaml:compose.prod.yaml:compose.downloader.prod.yaml:compose.planner.prod.yaml` |

`compose.prod.yaml` is the tunnel and the network and names no tool; each
`compose.<tool>.prod.yaml` adds one tool's released image. With the list set, a
deployment is three commands:

```bash
cp .env.prod.example .env      # TUNNEL_TOKEN, GHCR_OWNER, COMPOSE_FILE, a tag per tool
docker compose pull
docker compose up -d
```

Every tag is an exact version rather than `latest`, on purpose: a host following
a moving tag cannot answer what it is running, and each tool's `/api/health`
reports its version so the two can be compared. The tools release independently,
so `DOWNLOADER_TAG` and `PLANNER_TAG` are unrelated numbers.

**Pulling needs a login, once.** A package's visibility is its own setting — the
first push creates it private, and making the repository public does not change
that — so authenticate with a **classic** personal access token carrying
`read:packages` and nothing else. Classic rather than fine-grained is forced:
`read:packages` has no fine-grained equivalent.

```bash
echo "$TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

The rest is [docs/02-DEPLOYMENT.md](./docs/02-DEPLOYMENT.md): the tunnel, a
hostname and a login policy per tool — and the two tools' policies are
deliberately not the same — then what only one tool needs, including the
planner's optional routing engine and real model. Which versions exist and how
one is cut is [docs/03-RELEASING.md](./docs/03-RELEASING.md); publishing takes no
setup of its own, since merging a release pull request pushes the image.

To run one tool's container without deploying anything, see that tool's README.

## Commands

```bash
npm run check                 # lint + format check + typecheck — the gate
npm test                      # vitest, every project
npm test -- --project <tool>  # one tool's suite: seconds, not a minute
npm run build                 # every workspace
npm run status                # open tickets per tool, computed from the tickets
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
  itinerary            day packing, budgets, seasons, the critic — no model, no network, no clock
  api                  Fastify, SQLite persistence, HTTP, run orchestration, the UI
  web                  React + Vite UI
  e2e                  Playwright: the intake, in a browser, against the built bundle
```

Each tool's documentation lives with its code, on the same spine — analysis,
architecture, roadmap, and one file per ticket. The root [docs/](./docs/) holds
only what is true of the repo: the tool index, the ticket format, deployment,
releasing, and the ADRs for decisions binding more than one tool.

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
