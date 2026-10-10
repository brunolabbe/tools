# CLAUDE.md — ledger

Rules for this tool only. The repo-wide conventions are in the root `CLAUDE.md`
and are not repeated here.

**Built a ticket at a time.** The seams exist, and four domains: the pasted
statement (lg-1, lg-2), what files each row (lg-4), what each bucket holds
with the salaries and the ratio (lg-5), and periods closed with their
settlement (lg-6). `docs/02-ROADMAP.md` is what is decided and what comes
next; `npm run status -- --tool ledger` is what is open. Treat anything below
marked _planned_ as design until a ticket says otherwise.

## What this is

A household ledger replacing a spreadsheet: the joint Desjardins account two
people share, split into buckets, with who owes what computed rather than kept
by hand. Both people use it, mostly from a phone.

## Layout

```
contract     types, error taxonomy, zod schemas — no logic
books        pure: the statement parser, its proofs and the rule matching; no model, network or clock
api          Fastify, persistence, HTTP — the only place that reads process.env
web          React + Vite UI, mobile-first
e2e          Playwright specs — none yet; e2e/README.md says what earns the first
```

`books` holds the statement-paste parser and its running-balance proof (lg-1) and
`classify`, which files a row under a rule only on an exact match, the most
specific rule winning (lg-4, lg-16), `fromHistory`, which offers what a person
answered before (lg-16), `autoFile`, which files a row no rule's pattern matches
on its description's three latest answers, within amount limits (lg-17), `spendingCategory`, which gives a row its spending
category (lg-15), and
what each bucket holds as of a date and the ratio from two salaries (lg-5), and
the settlement: the matching rule, cumulative, with charges, and which closed
period's deposit a paste has brought in (lg-6), and the reader of the old
workbook, from plain cell grids `api` builds out of the `.xlsx` (lg-7). The name is `books` because `ledger` is the tool. _Planned_, arriving
with the ticket that first needs it rather than as an empty package now:
**`receipts`**, the one package that talks to a model, reading a receipt photo.

## Commands

```bash
npm run dev:ledger          # API (8100) + web (5193) together, both in watch mode
npm run dev:ledger:api      # just the API
npm run dev:ledger:web      # just the UI
npm test -- --project ledger
npm run e2e:ledger          # "No tests found" until the first spec
npm run import:ledger -- <workbook.xlsx> --as <person>   # the one-off import; a dry run without --write
```

**Every API route but health answers 403 until you name a person.** The API
refuses anything Cloudflare Access has not vouched for, and in development
nothing has. Start it as someone instead — `.env.example` has the rest:

```bash
ACCESS_PEOPLE=alex@example.test=alex DEV_IDENTITY=alex@example.test npm run dev:ledger
```

or put those two in `tools/ledger/.env`, which the API's dev script loads (and
nothing else does — not the e2e server, not the image).

The API's dev script builds before it watches, because `@ledger/contract`
resolves to `dist/` and a fresh checkout has none (lg-12); the reason is on the
`// dev` key in `api/package.json`.

The ports are 8100/5193 so every tool runs at once without reconfiguring any;
the e2e suite takes 8108. `.github/workflows/ledger.yml` builds the image, starts
it, and asks it for both `/api/health` and the page.

## Rules

**Real bank data never enters the repository.** Not in a fixture, not in a
test, not in a ticket's log, not in a commit message. Fixtures are synthetic —
invented descriptions, invented amounts — shaped like the real thing. The one
exception is none: a failing real row is reproduced by writing a synthetic row
that fails the same way.

**Identity comes from Cloudflare Access.** Two people, two addresses, one Access
policy (`docs/02-DEPLOYMENT.md`, step 2). The tool has no login of its own and
must not grow one; who did something is the Access identity on the request.
`api/src/access.ts` verifies the token, a hook in `api/src/identity.ts` runs it
on every API route but health, and a route reads the caller with
`personOf(request)` — never from a header of its own.

**Every API route but health is rate limited, per person.** A route takes
`{ onRequest: rateLimitsFor(context).read }` or `.write` from
`api/src/rate-limit.ts`, over core's token bucket, keyed on `personOf(request)`
and not the address. A route added without one is unlimited, and
`api/test/route-limits.test.ts` walks `ROUTES` so that it fails instead.

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

**A stored row is never edited.** Nothing in `api` issues an `UPDATE` or a
`DELETE` against the books (`docs/00-ANALYSIS.md` §9): a correction is a later
row that supersedes the earlier one. A pasted row that disagrees with a stored
one is refused and named (`STATEMENT_ROW_CONFLICT`), never reconciled. A
migration, once shipped, is never edited either — append the next one.

**Rules and classifications are appended the same way.** A rule is edited by
filing a version that supersedes it and retired by filing a retirement; a row is
reclassified by appending a record, and the latest stands (`current_rules` and
`current_classifications`, in `api/src/db/schema.ts`). Salaries and ratios are
corrected the same way (lg-5, `current_salaries` and `current_ratios`), and a
corrected salary never moves a ratio already confirmed from it. So are period
lines and recurring items (lg-6, `current_period_lines` and
`current_recurring_items`); a period is a row only once closed, and its
recorded settlement is never recomputed, because the next close is cumulative.
`api/test/classification-schema.test.ts` scans the API source for an `UPDATE` or
a `DELETE`.

**A classification history filed is `auto`, and is never an answer** (lg-17).
It names the three person-given classifications it rests on and no person
(`classified_by` is `NULL`), so it stands like any other record — the buckets,
the periods and the stored rows read it — while `answersByDescription` reads only
`manual` and `accepted`, which keeps history from feeding on its own filings. A
person's answer appended after it supersedes it; nothing undoes it otherwise.

**A spending category is not Desjardins' category** (lg-15). `category` on a
row and on a rule is the bank's own text; a _spending_ category is the
household's word from one list (`spending_categories`), for the stats only. Every
table, column, type and screen for the second says "spending". The list, the map
from the bank's text to it (`spending_category_map`), a rule's choice and a row's
own override (`spending_category_overrides`) are all appended and never edited;
a category is referred to by the id of its first version, so a rename keeps
everything that picked it. A row's spending category is **computed on read**,
never stored (`spendingCategory` in `books`: override, then the classifying
rule's, then the map's, then none), and a row without one is filed as ever and
never waits in the inbox for want of it.

**People come from configuration, never the repository.** The `people` table
(lg-5) is filled at boot from `ACCESS_PEOPLE`'s names, and a person's id is that
name — the text lg-4 stores on rules and classifications — so it must stay that
name. Migration 3 also enrols the person ids lg-4 had already stored on rules and
classifications, and nothing else. Why a name is permanent is in
`docs/00-ANALYSIS.md` §7.

**Rules live in the database only.** Caisse names identify a household, so no
rule is seeded from the repository: not in a migration, not in a fixture. A test
names invented descriptions.

**Error `details` carry bank text, so a log carries their names and no values.**
A refused statement's details name the offending row's description, amount and
balance; the response needs them and a log outlives the request. The error
handler in `api/src/server.ts` logs `detailKeys`, and a new log line that
spreads `details` undoes it (`api/test/statements.test.ts` holds it).
