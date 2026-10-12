---
id: lg-21
tool: ledger
title: One file of books per household, chosen by who is asking
kind: work-package
status: ready
milestone: P6
depends_on: [lg-20]
difficulty: hard
---

# lg-21 — One file of books per household, chosen by who is asking

## Why

After [lg-20](./lg-20-the-household-directory.md), every request carries its
household, but every household still reads the one books file that
`api/src/server.ts` opens at boot and passes to every route as `context.db`. The
owner chose a file per household over a household column (`00-ANALYSIS.md` §7,
_More than one household_). A column reaches 15 tables, 9 views and 71
statements, and one query that forgot it would show one household's bank rows to
the other. A request that holds only its own household's file cannot do that.

## Build

1. **A file per household**, at `<data>/households/<id>.db`, where `<id>` is the
   directory's household id. lg-20 restricts that id to a plain lowercase word.
   Resolve the path and refuse anything that does not land inside
   `households/`, belt and braces with lg-20's check.
   - At boot, each household in the directory gets its file opened, created if it
     does not exist, migrated (`migrate` in `api/src/db/schema.ts`, unchanged)
     and its members enrolled into its `people` table.
   - A household added while the process runs gets its file the same way, the
     first time it is needed.
   - `DATABASE_PATH` becomes the data directory. The image's
     `ENV DATABASE_PATH=/data/ledger.db` in `tools/ledger/Dockerfile` changes with
     it.
   - **The existing data is not migrated.** The owner had not started using the
     ledger, so `/data/ledger.db` is deleted at deploy. Say so in the deployment
     notes, and do not write code that adopts it.
2. **The request carries its books.** The identity hook in `api/src/identity.ts`
   attaches the household's handle, and `booksOf(request)` returns it, failing
   closed like `personOf` — for an identity with no membership, an admin in no
   household included, there is no handle and the route is refused.
   - **`db` is removed from `AppContext`** (`api/src/context.ts`), so the compiler
     finds every remaining use. At filing there were about 88 uses of `context.db`
     across 15 files.
   - The change at each one is mechanical: the domain modules already take `db`
     as an argument (`{ db: context.db, personId: personOf(request).id, … }` in
     `routes/statements.ts`), so a route passes `booksOf(request)` instead.
   - The people list the context holds, read in `classifications.ts`, becomes
     per household.
3. **Rate limits** are keyed on household and person
   (`api/src/rate-limit.ts`, `const key = personOf(request).id`), so two
   households' people with the same name do not share a bucket.
4. **Health** is `ok` only when the directory and every household's file are
   open. It never names a household, a count or a path (the ledger `CLAUDE.md`,
   _`/api/health` never says where the data is_).
5. **The import command** takes `--household <id>` and opens that household's
   file. A dry run copies that file, as `copyBooks` in `api/src/import-command.ts`
   does today.
6. **lg-20's refusal of a second household is removed**, along with its test,
   and replaced by the isolation sweep below.
7. **The isolation sweep**, the ticket's real deliverable.
   - Two households, each with members, write through every write route.
   - Each household then reads through every read route, and nothing of the
     other's appears.
   - It walks `ROUTES` as `api/test/route-limits.test.ts` does, so a route added
     later is covered without anyone remembering to add it.
   - **Make it fail first.** Hand both households the same handle and watch the
     sweep fail, then restore. Record the failing run in the Log.
8. **Docs.** Add a rule to the ledger `CLAUDE.md`: a route reads its books from
   `booksOf(request)`, never from a handle of its own. In
   `docs/02-DEPLOYMENT.md`'s ledger section, say that a backup takes the whole
   data directory.
9. **What lg-20's gate left on the boot and enrol path** (gate 1, F4, F5 and F8).
   This ticket rewrites both, so they are fixed here rather than on lg-20.
   - **A missing directory file looks healthy** (F4). It is created empty, health
     answers `ok`, and every request is 403 with nothing at boot to say why: an
     unmounted volume or a wrong `DIRECTORY_PATH` reads as a service refusing
     everyone. Log a `warn` at boot when the directory holds no household.
   - **The directory and the books can be pointed at one file** (F4). Today
     `DIRECTORY_PATH` equal to `DATABASE_PATH` fails at boot and leaves the file
     half-migrated with both schemas' tables. Once `DATABASE_PATH` is the data
     directory, refuse at config a `DIRECTORY_PATH` inside `households/`.
   - **A failed enrol fails the read** (F5). The identity hook enrols a newly
     added name on the request path. When the books cannot take that write (the
     import command holds the lock), every request from the household returns
     500 after the 5 s `busy_timeout`, spent on the event loop, not only the new
     member's. A failed enrol refuses only the person it could not enrol; the
     household's other members are served.
   - **Nothing crosses a process** (F8). "A removal takes effect without a
     restart" is asserted on the one `Directory` the app and the test share, but
     the documented path is the household command, a second process, writing a
     file the API has open. Test it with two connections on a temp file. Also run
     the household command (`add`, `member`, `list`, `remove`) inside the image in
     `ledger.yml`, beside the image's boot.

**Traps.**

- `better-sqlite3` handles are per file and kept open. Two households are two
  handles, and shutdown closes them all. Check `server.ts`'s close path.
- A test that builds the app with `:memory:` needs one in-memory database per
  household. A shared `:memory:` path would be one connection pretending to be two.

## Done when

1. Each household's requests read and write only that household's file. The
   isolation sweep proves it over every route in `ROUTES`, and the Log records
   that the sweep failed with a shared handle.
2. `AppContext` has no `db`, and `npm run check` passes.
3. A household added at runtime gets a migrated file and its people on first
   use; an API test proves it.
4. Health reports the directory and every household file without naming any; a
   test proves it.
5. The import command writes only to the named household's file; a test proves it.
6. Gates green, including the ledger image's boot and the household command run
   inside the image.
7. Step 9 holds, and a test proves each part: the boot warning, the config
   refusal, a write-locked books file that refuses only the unenrolled person, and
   a removal made from a second connection that the next request sees.

## Log

- 2026-10-12 — Filed with lg-20, lg-22 and repo-98 from the owner's design
  discussion. The owner said the existing `ledger.db` can be wiped, so nothing
  migrates it.
- 2026-10-12 — Reviewed: lg-20 now lets an admin with no household through the
  identity hook, so `booksOf` is named as refusing that identity.
- 2026-10-12 — Step 9 and Done-when 7 added, and Done-when 6 widened, from
  lg-20's gate 1 (F4, F5, F8), which the owner chose to fold here rather than
  fix on lg-20.
- 2026-10-12 — Built on `lg-21` from `main` at `07acbb86`. Each household's books
  are `api/src/books.ts`: `householdBooksPath` resolves `<data>/households/<id>.db`
  and refuses an id that is not a household id or a path that is not directly in
  `households/`; `Books` opens every household at boot and one added since on
  first need, migrates it, enrols its members, and closes them all on shutdown.
  The identity hook attaches the caller's household's handle and `booksOf` in
  `api/src/identity.ts` returns it, refusing as `personOf` does. `AppContext` has
  no `db`; it has `booksOpen()` for health, and `App.books` is for the tests.
  Rate limits are keyed `<household>:<person>`. The import takes `--household`.
  The household command's second-household refusal and its test are gone.
  - **The sweep failed with a shared handle, twice.** Each run edited the source
    or the test, ran `npx vitest run tools/ledger/api/test/isolation.test.ts`,
    and was restored.
    - Every household handed the first household's handle (`Books.#open`
      returning the first one held): exit 1,
      `away POST statements: {"error":{"code":"STATEMENT_CHAIN_BROKEN", … "the newest stored row left 10031.08 $" …}}: expected 422 to be 200`.
      The writes alone show the leak: away's paste was refused against home's
      balance, and told so.
    - The writes on their own books, then every read handed home's
      (`app.books.forMember = () => app.books.of("home")` after the writes):
      exit 1, `expected [ …(21) ] to deeply equal []`, the 21 being every read
      route but `/api/me`, which reads no books, starting
      `"away GET rules shows home's Maison"`, `"away GET people shows home's sam"`,
      `"away GET buckets shows home's sam, 71113"`.
    - Restored, `Tests  2 passed (2)`.
  - **Each new test failed first**, by loosening what it guards, restored after
    each: enrolment waiting on the lock and refusing everyone fails "F5: a
    write-locked books file refuses only the person it could not enrol" (alex
    `expected 504 to be 200`, after 10092 ms); no boot warning fails "F4: boot
    warns…" (`expected [] to have a length of 1`); the verifier caching
    membership fails "F8: the household command, a second connection…"
    (`expected 200 to be 403`); books opened only at boot fails "a household
    added while the app runs gets a migrated file and its people on first use"
    (`expected 500 to be 200`); health ignoring the books fails 2 of the 3 new
    health tests; a rate-limit key of the person alone fails "is the household
    and the person…"; no `DIRECTORY_PATH` check fails "refuses a DIRECTORY_PATH
    inside households/…"; the import writing to another household's file fails
    "a --write goes to the named household's file…" (`expected { n: +0 } to
deeply equal { n: 17 }`).
  - `npx vitest run tools/ledger/api`: `Test Files  27 passed (27)`,
    `Tests  462 passed (462)` (443 at lg-20's landing).
  - **The image step is unmeasured here**: docker is not usable in this
    sandbox (`docker info` exits 1). The new `ledger.yml` step was run instead
    as a script against the built `dist`, with the image's environment
    (`NODE_ENV=production`, `DATABASE_PATH` a directory, `DIRECTORY_PATH` in it):
    boot health `{"ok":true,…,"database":{"open":true},"directory":{"open":true}}`
    with the warning `the household directory has no members…`; `add`, `member`,
    `list`, `remove`, `list` all exit 0 against the running server; health
    `"ok":true` after, and `households/` holding `ci.db`. CI's `docker` leg is
    the measurement.
  - **What the brief had wrong, or left open.**
    - _About 88 uses of `context.db` across 15 files_: 88 is right, but 70 of
      them are the domain modules' own `context` parameter (a `RuleContext`),
      which already took `db` as an argument and did not change. What read
      `AppContext.db` was 18 uses in 8 route files and the stats routes'
      `const { db } = context`.
    - _Health is `ok` only when every household's file is open_: read
      literally, so health opens the books of a household added since boot,
      which makes its file on the probe. Recorded as an open decision in the
      build report; the alternative is to answer only for the files already
      held.
    - _A `warn` at boot when the directory holds no household_: it warns when
      the directory has **no members**, which includes no household. A
      household with nobody in it refuses everyone the same way.
    - _A failed enrol refuses only the person it could not enrol_: the enrol
      also no longer waits on the lock (its `busy_timeout` is 0 for that one
      transaction), so nobody spends 5 s on the event loop; the person refused
      gets core's `TIMEOUT` (504, retryable), as a paste that meets the lock
      does, not a 500.
    - Not asked, and added because the `ENV` change makes it likely: a
      `DATABASE_PATH` that names a file, as every `.env` before this did, is
      refused at boot and by the import, naming the setting, rather than
      failing on the first household with `ENOTDIR`.
    - The config field is `dataDir` now; the variable is still `DATABASE_PATH`,
      as the brief says.
    - The sweep walks `ROUTES` against `server.hasRoute` for both verbs, so the
      second verb of a path (`GET /api/salaries` beside `POST`) is in it too.
  - **Fold-in:** lg-20's gate F6, assigned to lg-22's step 9, was made free
    here: the lookup it is about is on every request's books path now.
    `Directory.members(household)` filters in the SQL; measured on the built
    class with 6000 members in 3000 households, `people(household)` went from
    9.853 ms to 0.031 ms a call. lg-22's Build and Log say so. Nothing else
    became free: lg-22's F2 is the directory's writers, which this does not
    touch.
  - **lg-19** adds a route to `routes/periods.ts` on `context.db`. When it
    merges, the merge from `main` moves it onto `booksOf(request)` and adds it
    to the sweep's tables, which fails until it is.
