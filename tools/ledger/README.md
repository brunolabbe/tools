# ledger

A household ledger for a joint bank account two people share: statements in,
split into buckets, and who owes what computed rather than kept by hand in a
spreadsheet.

> **Under construction.** The seams exist — contract, API, a web shell, the
> image — and the books arrive a ticket at a time: so far a pasted statement,
> stored and chained onto what is stored, its rows filed by rule, with an
> inbox for the rest, and what each bucket holds and whose it is, with the
> salaries and the ratio, and periods of personal-card spending closed with
> the settlement they compute, and the old workbook's history imported once,
> by a command (below). Receipts and the charts are not built. What is decided
> and what comes next is in
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

Started like that, every API route but health answers 403: the API trusts only
Cloudflare Access. In development, name a person instead —
`ACCESS_PEOPLE=alex@example.test=alex DEV_IDENTITY=alex@example.test npm run dev:ledger`
— or put those two lines in `.env` — and see `.env.example` for the rest.

Settings are environment variables, listed with their defaults in
[`.env.example`](./.env.example). Copy it to `.env` beside it and
`npm run dev:ledger` loads that; a variable set in the shell wins over the file.
Requires Node ≥ 22. The UI's dev server proxies `/api` to
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

### Importing the old workbook

Once, from the repo root, into the database the API is configured with
(`DATABASE_PATH`), as a command rather than a route (lg-7):

```bash
ACCESS_PEOPLE=… npm run import:ledger -- ~/classeur.xlsx --as alex [--corrections ~/corrections.json] [--write]
```

Without `--write` it is a dry run. It copies the database file and its
write-ahead log into a private temporary directory, never opening the
originals, and imports into the copy. Then it prints the report — rows imported,
repaired, skipped and corrected, each bucket's figures beside the workbook's,
the catch-up — and deletes the copy. `--write` runs that rehearsal first, and
opens the real database only when every verification held there; a refused
import leaves the books as they were, schema version included, and creates no
file where there was none. Keep the workbook and the corrections file **outside
the repository**: both are bank data. `--corrections` is the owner's JSON: rows
to file otherwise, workbook names that are not already a person's id, and the
ratio a closed period was settled at when it was not Accueil's; its shape is on
`readCorrections` in `books/src/workbook.ts`. In the image, where nothing can
build, run `node tools/ledger/api/dist/import-ledger.js` with the same arguments
and the workbook mounted in.

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
