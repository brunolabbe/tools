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
receipts     the receipt reader: a photo in, proposals out; the only package that talks to a model
api          Fastify, persistence, HTTP — the only place that reads process.env
web          React + Vite UI, mobile-first
e2e          Playwright specs — the layout spec; e2e/README.md says what earns the next
```

`books` holds the statement-paste parser and its running-balance proof (lg-1) and
`classify`, which files a row under a rule only on an exact match, the most
specific rule winning (lg-4, lg-16), `fromHistory`, which offers what a person
answered before (lg-16), `autoFile`, which files a row no rule's pattern matches
on its description's three latest answers, within amount limits (lg-17), `spendingCategory`, which gives a row its spending
category (lg-15), and
what each bucket holds as of a date and the ratio from the salaries (lg-5), and
the settlement: the matching rule, cumulative, with charges, between any number
of people (lg-23), and which closed
period's deposit a paste has brought in (lg-6), and the reader of the old
workbook, from plain cell grids `api` builds out of the `.xlsx` (lg-7), and the history's series, one per chart on the stats screen (lg-9), and the
receipt check — whether a proposal's subtotal, GST and QST make its total — and
which stored rows a receipt may document (lg-8), and what a receipt's items take
off its shared amount, at the GST and QST rates in effect on its date
(`splitReceipt` and the dated `SALES_TAX_RATES` table, lg-10: a rate change is an
entry added there). The name is `books` because
`ledger` is the tool. **`receipts`** is the receipt reader (lg-8): Claude Haiku
5.5 through Anthropic's SDK, given its key and model by `api`, and reading no
environment itself.

## Commands

```bash
npm run dev:ledger          # API (8100) + web (5193) together, both in watch mode
npm run dev:ledger:api      # just the API
npm run dev:ledger:web      # just the UI
npm test -- --project ledger
npm run e2e:ledger          # the layout spec: every screen at 360px and 1280px
npm run import:ledger -- <workbook.xlsx> --household <id> --as <person>   # the one-off import; a dry run without --write
npm run household:ledger -- <add | member | remove | list>  # the household directory, from the host
npm run backfill-spending:ledger -- --household <id> --as <person>   # lg-53's one-off: categories from text; a dry run without --write
```

**Every API route but health answers 403 until you are a member.** The API
refuses anything Cloudflare Access has not vouched for, and in development
nothing has; and an address must be a member in the household directory. Put
an invented one there, then start as it — `.env.example` has the rest:

```bash
npm run household:ledger -- add home "Test household"
npm run household:ledger -- member home alex@example.test alex
DEV_IDENTITY=alex@example.test npm run dev:ledger
```

or put `DEV_IDENTITY` in `tools/ledger/.env`, which the API's dev script loads
(and nothing else does — not the household command, not the e2e server, not
the image).

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

**Identity comes from Cloudflare Access; membership from the household
directory** (lg-20). Access's policy admits every household's addresses
(`docs/02-DEPLOYMENT.md`, step 2), and the tool has no login of its own and must
not grow one. `api/src/access.ts` verifies the token, then looks the address up
in the directory **on every request** — never cached, so a removal applies to
the next request — and a hook in `api/src/identity.ts` leaves the result on the
request: the address, whether it is an admin (`LEDGER_ADMINS`), and its
household and person, or none for an admin in no household. An address that is
neither member nor admin is refused at the hook. A route reads the caller with
`personOf(request)`, which refuses an identity with no household — never from a
header of its own. Only `adminOf` reads the admin flag: being an admin reads no
books. **The directory is managed from the app** (lg-22, `api/src/routes/households.ts`):
the admin routes under `/api/admin/` ask `adminOf`, and a household's own routes
under `/api/households/:id` ask `memberOf`, which refuses a member of another
household and an admin in none; both guards run in the route's `onRequest`
hooks, before the body is parsed. A member adds and never removes, and is told
only that an address cannot be added (`MEMBER_NOT_ADDED`), never why: the reason
would say which household holds it. **It does not hide that an address is
taken** — a free address added under a name the household holds succeeds — and
the owner accepted that on 2026-10-13: any answer that tells an add from a
refusal carries it, and an add that succeeds is a record naming the member who
made it. `api/test/authority.test.ts` walks every one of those routes as each
identity that must be refused.

**A route reads its books from `booksOf(request)`, never from a handle of its
own** (lg-21). Each household's books are a SQLite file of their own,
`households/<id>.db` in the data directory (`DATABASE_PATH`), opened by
`api/src/books.ts` and attached to the request by the identity hook for the
caller's household; an identity with no household has none, and `booksOf`
refuses it as `personOf` does. `AppContext` holds no handle, so the compiler
finds a route that reaches for one, and `api/test/isolation.test.ts` writes
through every write route as two households, reads every read route back, and
reads every table of both files directly, since a write can land where no read
shows it. It takes its list of routes from the server itself, whatever the
method and whether `ROUTES` names it, so a route added later is swept too. A
route given another household's handle, or the one handle for both, is the leak
it catches.

**Every API route but health is rate limited, per person.** A route takes
`{ onRequest: rateLimitsFor(context).read }` or `.write` from
`api/src/rate-limit.ts`, over core's token bucket, keyed on the household and
the person `personOf(request)` gives, and not the address — two households can
each have an alex (lg-21). An admin route takes `.adminRead` or `.adminWrite`
instead, keyed on the admin's address, since an admin may have no person; it asks
`adminOf` first and never logs the address (lg-22). A route added without one is unlimited, and
`api/test/route-limits.test.ts` walks `ROUTES` so that it fails instead. The
one route that costs money, a receipt read, takes a bucket of its own instead,
five a minute (`RATE_LIMIT_RECEIPT_READS_PER_MINUTE`, lg-8).

**Never log a request's headers.** Behind Access every request carries a signed
identity token in a header and a cookie, and `logger.ts` censors both as a
backstop — not as permission.

**`/api/health` never says where the data is.** It reports whether every
household's books and the household directory are open, never their paths,
which households there are, or how many. The contract's
`HealthResponse` has no field for either, and `api/test/health.test.ts` holds the
route to that with real files.

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
The household's word on its mortgage is the same (lg-55,
`current_mortgage_record`: live, ended on a day, or none); it decides which views
are shown and never what is counted.
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

**The stats store nothing, and a chart is coloured by the entity, never by its size**
(lg-9). Every series is computed on read from the stored rows (`books/src/stats.ts`,
gathered by `api/src/stats.ts`), a range trims what is shown and never what is counted
(a cumulative total starts at the first row ever), and each series answers its own
route. On the screen, a person, a spending category and a fixed item each keep the
colour their place in a list gives them whatever range is chosen, so the API sends
the whole list and not only what has an amount; past seven of a kind the rest share
the eighth. The chart tokens (`--series-*` in `web/src/styles.css`) are the `dataviz`
skill's categorical order, validated against this page's own two surfaces; every chart
has a table twin, and a figure is never only in a hover.

**People come from the household directory, never the repository.** The
directory (`api/src/directory.ts`, a SQLite file of its own with its own
migrations in `api/src/db/directory-schema.ts`) holds households and who belongs
to each: appended, never edited, with the schema refusing an `UPDATE` or a
`DELETE`. An address is in at most one household, and **a household holds any
number of person names** (lg-23; lg-20's cap of two, `HOUSEHOLD_FULL`, is gone):
the books settle between everyone in them, and a name stays in them once there.
Removing an address never removes a name. **A person is retired from the books
only at a close** (lg-35), only once no address stands under them, and no
address is added under them again until a close has applied their return (bar
a close whose echo failed; a retire cancelled by a return before the close lets
the add through):
`people_retirements` says from which day, `peopleOn` in `books` answers who is
in, and the history keeps everyone. **People change only at a close**: a
ratio whose people differ from the open period's is refused if it would take
effect inside it (`confirmRatio` in `api/src/salaries.ts`), so every period is
weighed with the same people. A settlement between two is recorded in its
`periods` row as it always was; one between more writes `settlement_deposits`
and `settlement_transfers` beside it. Each household's
`people` table (lg-5), in its own books, is filled from its members' names when
the file is opened and whenever a request shows a name it lacks
(`createEnroller` in `api/src/people.ts`, never waiting on another process's
write lock: a name the books cannot take refuses only that person, lg-21), and
a person's id is
that name — the text lg-4 stores on rules and classifications — so it must stay
that name. Migration 3 also enrols the person ids lg-4 had already stored on
rules and classifications, and nothing else. Why a name is permanent is in
`docs/00-ANALYSIS.md` §7. `ACCESS_PEOPLE` is retired: boot refuses it.

**Rules live in the database only.** Caisse names identify a household, so no
rule is seeded from the repository: not in a migration, not in a fixture. A test
names invented descriptions.

**A receipt photo leaves the house only when the person asks** (lg-8). Upload
keeps the photo, at `<data>/receipts/<household>/<uuid>.<ext>` under a name the
API made — never one a request gave — and reads nothing; only
`POST /api/receipts/:id/read` hands it to the reader, and the screen names the
model beside that button; a receipt with anything filed from it is not read
again. Filing is a third request and the only one that writes the books: a line
paid by **whoever uploaded the photo**, or the receipt attached to the row it
documents. A photo of several receipts files each as its own `part`, once; a row
is documented by one receipt (`ROW_ALREADY_DOCUMENTED`). **A receipt's items
must make its total or it is not filed** (`RECEIPT_DOES_NOT_ADD_UP`, lg-10): the
line is what the card was charged less what the books compute its not-shared and
someone else's items to cost, and each charged person's part is a charge line of
its own; on a row every item is shared. **A `theirs` item names whose it is**
(`chargedTo`, lg-30): with one other current member it may name nobody and means
them, with more it must name one, and a name is anyone the books hold who is not
the payer, a member who has left included. The model proposes each item's category from the list and
nothing else; a category not in it is dropped, never refused. A photo is never
logged, and **no test calls a real model**: `createApp` takes a
`receiptReader`, and every test that reads hands in a fake
(`api/test/receipts.test.ts`); `receipts/test` answers the real reader from
fixtures through its `fetch`; and the ledger's vitest project clears the host's
`ANTHROPIC_*` variables before every file
(`api/test/helpers/no-model-environment.ts`).

**Error `details` carry bank text, so a log carries their names and no values.**
A refused statement's details name the offending row's description, amount and
balance; the response needs them and a log outlives the request. The error
handler in `api/src/server.ts` logs `detailKeys`, and a new log line that
spreads `details` undoes it (`api/test/statements.test.ts` holds it).
