# ledger

A household ledger for a joint bank account two people share: statements in,
split into buckets, and who owes what computed rather than kept by hand in a
spreadsheet.

> **A scaffold.** The seams exist — contract, API, a web shell, the image — and
> the books do not yet. What is decided and what comes next is in
> [docs/02-ROADMAP.md](./docs/02-ROADMAP.md); where it stands is
> `npm run status -- --tool ledger`.

## Getting started

Every command below runs from the **repo root**.

### From source

```bash
npm install
npm run dev:ledger               # API on :8100 and UI on :5193, both watching
npm run check                    # lint (oxlint) + format (oxfmt) + typecheck
npm test -- --project ledger
```

Settings are environment variables, listed with their defaults in
[`.env.example`](./.env.example). Nothing loads a `.env` file, so set what you
change in the shell. Requires Node ≥ 22. The UI's dev server proxies `/api` to
the API on 8100, which keeps the two same-origin;
[`web/.env.example`](./web/.env.example) changes where it points.

### With Docker

Its image is published to GHCR on every release. To run a released one on its
own — after the one-time registry login in the
[root README](../../README.md#deploying-a-set-of-tools):

```bash
docker run --init -p 127.0.0.1:8100:8100 -v ledger-data:/data \
  ghcr.io/<owner>/ledger:<version>                               # http://localhost:8100
```

Or build one from a checkout — the build context is the repo root, not this
directory:

```bash
docker build -f tools/ledger/Dockerfile -t ledger:local .
```

It binds to loopback on purpose: the tool has no login of its own, and its
identity comes from Cloudflare Access in front of it.

### Deploying it

Beside the other tools, on the same host and the same tunnel — the
[root README](../../README.md#deploying-a-set-of-tools) for the shape, and
[docs/02-DEPLOYMENT.md](../../docs/02-DEPLOYMENT.md) for the walkthrough and
[its ledger section](../../docs/02-DEPLOYMENT.md#the-ledger). Its Access policy
admits two people rather than one, and gets no Bypass rule.

## Docs

This tool's documentation lives with its code, in [docs/](./docs/):

|                                      |                                                     |
| ------------------------------------ | --------------------------------------------------- |
| [02 — Roadmap](./docs/02-ROADMAP.md) | What is decided, what comes next, and in what order |
| [work/](./docs/work/)                | One file per ticket: the brief and what it did      |
| [e2e/](./e2e/README.md)              | What the browser specs will prove, and when         |

The analysis and the architecture arrive when there is something true to put in
them. [CLAUDE.md](./CLAUDE.md) beside this file is the rules specific to this
tool and the commands that run it; the repo-wide conventions are in the
[root CLAUDE.md](../../CLAUDE.md), and [../../README.md](../../README.md) is the
repo itself.
