# CLAUDE.md — ledger

Rules for this tool only. The repo-wide conventions are in the root `CLAUDE.md`
and are not repeated here.

**This tool is being built ticket by ticket.** What exists is the seams —
contract, API, web shell, image — and, so far, one domain: a pasted statement,
parsed (lg-1) and stored (lg-2). `docs/02-ROADMAP.md` is what is decided and
what comes next; `npm run status -- --tool ledger` is what is open. Treat
anything below marked _planned_ as design until a ticket says otherwise.

## What this is

A household ledger replacing a spreadsheet: the joint Desjardins account two
people share, split into buckets, with who owes what computed rather than kept
by hand. Both people use it, mostly from a phone.

## Layout

```
contract     types, error taxonomy, zod schemas — no logic
books        pure: the statement parser and its proofs; no model, network or clock
api          Fastify, persistence, HTTP — the only place that reads process.env
web          React + Vite UI, mobile-first
e2e          Playwright specs — none yet; e2e/README.md says what earns the first
```

`books` holds the statement-paste parser and its running-balance proof (lg-1);
the split arithmetic and the classification rules join it as their tickets
land. The name is `books` because `ledger` is the tool. _Planned_, arriving
with the ticket that first needs it rather than as an empty package now:
**`receipts`**, the one package that talks to a model, reading a receipt photo.

## Commands

```bash
npm run dev:ledger          # API (8100) + web (5193) together, both in watch mode
npm run dev:ledger:api      # just the API
npm run dev:ledger:web      # just the UI
npm test -- --project ledger
npm run e2e:ledger          # "No tests found" until the first spec
```

The ports are 8100/5193 so every tool runs at once without reconfiguring any;
the e2e suite takes 8108. `.github/workflows/ledger.yml` builds the image, starts
it, and asks it for both `/api/health` and the page.

## Rules

**Real bank data never enters the repository.** Not in a fixture, not in a
test, not in a ticket's log, not in a commit message. Fixtures are synthetic —
invented descriptions, invented amounts — shaped like the real thing. The one
exception is none: a failing real row is reproduced by writing a synthetic row
that fails the same way.

**A stored row is never edited.** Nothing in `api` issues an `UPDATE` or a
`DELETE` against the books (`docs/00-ANALYSIS.md` §9): a correction is a later
row that supersedes the earlier one. A pasted row that disagrees with a stored
one is refused and named (`STATEMENT_ROW_CONFLICT`), never reconciled. A
migration, once shipped, is never edited either — append the next one.

**Error `details` carry bank text, so a log carries their names and no values.**
A refused statement's details name the offending row's description, amount and
balance; the response needs them and a log outlives the request. The error
handler in `api/src/server.ts` logs `detailKeys`, and a new log line that
spreads `details` undoes it (`api/test/statements.test.ts` holds it).

**Identity comes from Cloudflare Access.** Two people, two addresses, one Access
policy (`docs/02-DEPLOYMENT.md`, step 2). The tool has no login of its own and
must not grow one; who did something is the Access identity on the request.
`api/src/access.ts` verifies the token, a hook in `api/src/identity.ts` runs it
on every API route but health, and a route reads the caller with
`personOf(request)` — never from a header of its own.

**Never log a request's headers.** Behind Access every request carries a signed
identity token in a header and a cookie, and `logger.ts` censors both as a
backstop — not as permission.

**`/api/health` never says where the data is.** It reports whether the database
is open, never its path. The contract's `HealthResponse` has no field for it, and
`api/test/health.test.ts` holds the route to that with a real file.

**Ledger error codes live in `contract/src/errors.ts`**, in
`LEDGER_ERROR_CODES`, and grows on purpose one ticket at a time. A code arrives
with the ticket that first throws it, with its status in `api/src/http-errors.ts` in the
same change.
