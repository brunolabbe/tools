---
id: lg-21
tool: ledger
title: One file of books per household, chosen by who is asking
kind: work-package
status: done
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

## Review

**Gate: FAIL** — 2026-10-12 · `0484ae71..91bcd34e` (head `91bcd34e478ea6a6ce7759d16f053303405196fb`, pull request #452) · Sonnet 5.5, depth full

| Done when                                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each household's requests read and write only that household's file; the sweep proves it over every route in `ROUTES`; the Log records the failing run | **not met** — the Log records the shared-handle failure and I reproduced it, but a planted cross-household write on two of the eighteen write routes (`POST /api/spending-category-map`, `POST /api/spending-category-overrides`) leaves `isolation.test.ts` green and the whole ledger suite at `462 passed (462)` (F1). Reads are proven: handed the other household's handle one route at a time, 42 of the 44 (route, direction) pairs show the other household's marks, which is the sweep's leak assertion, and the other 2 are `me`, which reads no books                                                                                                                                                                                                                                         |
| 2. `AppContext` has no `db`; `npm run check` passes                                                                                                       | **verified** — `AppContext` in `api/src/context.ts` has `booksOpen()` and no handle; `npm run check` exit 0 on a clean tree at this head (no warning in a ledger file); CI `check` success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3. A household added at runtime gets a migrated file and its people on first use                                                                          | `api/test/books.test.ts` › "a household added while the app runs gets a migrated file and its people on first use" ✓ (asserts 200, the people list, the file, and `user_version` equal to home's)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4. Health reports the directory and every household file without naming any                                                                               | `api/test/health.test.ts` › "is ok with every household's books open, and names none of them" ✓ and › "is not ok when any one household's books are closed, and does not say which" ✓. The `named(...)` equals `[]` assertion has its companion in `toMatchObject({ ok: true, database: { open: true }, directory: { open: true } })` beside it, so empty output would fail                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5. The import writes only to the named household's file                                                                                                   | `api/test/workbook-import.test.ts` › "--household names the books the import writes (lg-21)" › "a --write goes to the named household's file, and the other's is not touched" ✓ (sha256 and a full table dump of the other file unchanged; 17 rows in the named one). I also snapshotted every file under the data directory around each run: a dry run created and modified no books file, and `--write` changed only the named household's file                                                                                                                                                                                                                                                                                                                                                        |
| 6. Gates green, including the image's boot and the household command inside it                                                                            | **proven (gate)** — `docker` job success on this head (run 38296503565, `91bcd34e`); its log shows the new step "The household command runs inside the image, and a household gets its books" run `add`, `member`, `list`, `remove`, `list`, then health `"ok":true` and `test -f /data/households/ci.db`. `check`, `test (ubuntu-latest)`, `codeql`, `CodeQL` and `dependency-review` success. `test (windows-latest, informational)` was still in progress when I read it, and is informational                                                                                                                                                                                                                                                                                                        |
| 7. Step 9 holds, each part with a test                                                                                                                    | boot warning: `books.test.ts` › "F4: boot warns when the directory has no members, and not when it has" ✓. Config refusal: `config-access.test.ts` › "refuses a DIRECTORY_PATH inside households/, however it is spelled" ✓ with its companion › "and allows one beside it, or a name that only starts the same" ✓. Write lock: `books.test.ts` › "F5: a write-locked books file refuses only the person it could not enrol" ✓ (alex 200, sam 504 `TIMEOUT` retryable, under 2 s; with enrolment made to wait it failed with `expected 10015 to be less than 2000`), for a household already open — the first-open path is F3. Removal from a second connection: › "F8: the household command, a second connection, removes and adds, and the next request sees each" ✓, and the `ledger.yml` step above |

- **high** · Done when 1 depends on it · **F1 — the sweep passes with a planted write leak on `POST /api/spending-category-map` and `POST /api/spending-category-overrides`.**
  - Reproduction, in a built tree at `91bcd34e`: in `api/src/routes/spending-categories.ts`, add `let pinnedMap: ReturnType<typeof booksOf> | undefined;` as the first line of `registerSpendingCategoryRoutes`, and replace the `ruleContext(context, request)` argument of `setSpendingCategoryMap` in the `POST` map handler with `{ ...ruleContext(context, request), db: (pinnedMap ??= booksOf(request)) }`, so every household's mapping lands in the first caller's books. Then `npx vitest run tools/ledger/api`: `Test Files  27 passed (27)`, `Tests  462 passed (462)`. The same edit on the `setSpendingCategoryOverride` argument (a `pinnedOverride`) passes the same way, and the sweep's writes then leave home's file with 2 rows in `spending_category_overrides` and away's with 0.
  - Population: I mutated each of the 18 write routes alone — away's request to that method and path, and no other, handed home's handle — and ran the sweep's own assertions (a write answered other than 200, a read showing the other household's marks, a read showing none of its own). 16 were caught, 2 were not. The control, nothing mutated, reported no failure, 0 leaks, 0 silent reads. With the map mutation, `spending_category_map` in home's file holds away's row (`"CHALET EPICERIE"`, category 7) and away's own table is empty.
  - Why neither assertion sees it: the sweep writes the two households in lockstep, so every id one names (category 7, the row ids) also exists in the other's books and the write succeeds there; the map read lists only the bank categories of the household's own stored rows, so a row for a category the other household has none of shows nowhere; and `silent` asks only that a read show some own mark, which the unmapped category names supply.
  - The header of `api/test/isolation.test.ts` and `tools/ledger/CLAUDE.md` ("A route given another household's handle, or the one handle for both, is the leak it catches") are false for these two routes.
  - Remedy, one mechanism: after the writes, read every table of each household's file through `app.books.of(id)` and assert none holds the other's marks, and make the two households' ids differ (one extra category and row written first by away), so an id one names is not also valid in the other. That check does not depend on a read route showing the effect.
- **med** · no `Done when` line depends on it (line 1 says "every route in `ROUTES`") · **F2 — "covers every route the app answers" is only true of the contract's `ROUTES`, `GET` and `POST`.** A route registered outside `ROUTES` (`app.get("/api/zz-leak", …)` holding the first caller's handle) and a `PUT` on a `ROUTES` path (`app.put(ROUTES.rules, …)`) both leave `isolation.test.ts`, `route-limits.test.ts` and `access.test.ts` green, and the full suite `462 passed (462)`. A path added to `ROUTES` and registered is caught: the first test fails naming `GET zzLeak`. The population today matches: `printRoutes` on the built app lists 23 `GET`, 23 `HEAD` (Fastify's, one per `GET`), 18 `POST` and nothing else; the sweep's 41 (method, path) pairs are all of the `GET` and `POST` ones. No live call site; what is false is the test's name and the file header ("fails when a route the app answers is in neither table"). Remedy: take the list from `server.printRoutes({ includeHooks: true })` and compare it to the tables.
- **med** · no `Done when` line depends on it as worded · **F3 — a household's first open waits out the lock for 5 s and answers 500, the failure step 9 names for F5, on the path this ticket added.** `Books.#open` enrols with the connection's `busy_timeout`; only `forMember`'s enrol is `wait: false`. State: a household added since boot, whose file the import `--write` has just created and migrated and whose write lock it holds, before any request or health probe has opened it. Reproduction (`lock.mts` in the gate scratch directory, `node --import tsx lock.mts <tree>`): tom, the household's member, gets `500 INTERNAL` after 5006 ms; an anonymous `GET /api/health` in the same state answers `503` after 5007 ms; the probe waited as long as the request had, so each call waits again. For a household already open the same lock gives alex 200 and sam 504 in 1 ms, as step 9 asks. The window is the import's duration and ends when any probe opens the household first (the image probes every 30 s). `better-sqlite3` is synchronous, so the wait should stall every other household's requests too; I measured only the failing requests' own latency. Remedy: enrol with `wait: false` in `#open` too, and keep the handle on `SQLITE_BUSY` so `forMember` enrols on a later request.
- **low** · no live call site · **F4 — the import's `checkDataDir` call has no test.** Deleting `checkDataDir(config.dataDir)` from `import-command.ts` leaves `workbook-import.test.ts` and `books.test.ts` at `35 passed (35)`; the Log says the import refuses a file path, and only boot's refusal (`books.test.ts` › "a data directory that is a file is refused at boot, naming DATABASE_PATH") is tested.
- **low** · no live call site · **F5 — the `DIRECTORY_PATH` refusal is lexical.** Every spelling I tried inside `households/` is refused (dot segments, `..` round trip, doubled slashes, trailing slash, relative, `households` itself, a deeper path, a name like a household's file); a symlink to `households/` (`link-to-households/x.db`), a `DATABASE_PATH` that is a symlink to the real data directory, and `Households/` on a case-sensitive file system are accepted. The image sets both paths literally.
- **low** · `nfr:reliability` · **F6 — a probe repeats a failing open and logs an error line each time.** With `households/away.db` a directory, 501 probes wrote 501 `error` lines (`"a household's books could not be opened"`, no path) at 0.41 ms each, answering `503`. Health is not rate limited by design.
- **open decision, measured only (the health probe creates a new household's books file; no option recommended).**
  - What an anonymous caller can make it do: nothing of its choosing. The probe opens only households the directory already holds and the caller cannot add one; each is opened once (501 further probes created no file), for at most three files (`.db`, `-wal`, `-shm`), one migration, one enrolment. The public hostname answers an Access login page (`docs/02-DEPLOYMENT.md`, the ledger's health line), so the probe is reachable from the host's loopback and the container's own `HEALTHCHECK` (30 s).
  - Cost, in process through `inject` (no socket): steady state 0.14 to 0.67 ms per probe across three runs, flat from 1 to 500 households held. The first probe after households are added since boot: 1 household 23.8 ms, 10 → 206.5 ms, 100 → 1616 ms, 500 → 8792 ms (about 17 to 24 ms each, on the event loop), answered `200` with the same body as any other.
  - What it reveals: status and body are identical whether or not a probe made a file; the first-probe latency tells a timing observer that a household was added since the last probe. A household that cannot be opened gives `503` and `database.open: false` to every probe (F6), without saying which. With one unopenable file, boot refuses for every household, as the brief's "opened at boot" reads.
  - What the alternative would change in the branch: `health.test.ts` › "opens the books of a household added since boot, so it answers for that one too" and the `ledger.yml` step's `docker exec ledger test -f /data/households/ci.db` both assert today's behaviour.
- **dropped** · API responses carry no `Cache-Control`, now more relevant with two households behind one URL: unchanged by this diff, and Cloudflare does not cache extension-less JSON by default.
- **dropped** · the import's dry run creates `directory.db-wal` and `directory.db-shm` (a read-only open of a WAL file): `Directory.openReadOnly` is lg-20's and outside this range; no books file is touched.
- **dropped** · a symlinked books file (`households/away.db -> home.db`) gives away home's books: it needs write access to the data directory, and no API path makes a link.
- **dropped** · a nonexistent `DATABASE_PATH` that looks like the old file (`…/ledger.db`) is taken as a directory: bad configuration, and the layout works.
- **dropped** · one `Database` handle (three descriptors) per household for the process's life: no live call site at household counts a family tool reaches.
- **dropped** · "a household removed while its books are open": no route or command removes one, and the directory's triggers refuse `DELETE` and `UPDATE` on `households`. A member removed or moved between households is read afresh on every request: after `remove` then `member away`, the same address read away's rules and not home's; after `remove` it got `403 FORBIDDEN`.
- **findings** · the hunt returned 12; 6 carried (F1 to F6, with the open decision's measurement beside them), 6 dropped.
- Controls: a leak planted in a read route (`GET /api/people` holding the first caller's handle) fails `isolation.test.ts` with `"away GET people shows home's sam"`; one in `POST /api/statements` fails with `STATEMENT_CHAIN_BROKEN … expected 422 to be 200`; one in `POST /api/spending-categories` fails with `SPENDING_CATEGORY_NOT_FOUND … expected 404 to be 200`. The `Directory.members(household)` fold-in returns the same set as the filter it replaced: 38400 comparisons of `members` and `people` over random add and remove walks with 966 removals, 0 differences; with the `WHERE` clause changed to `<>` the same script reports 76416 mismatches, so it can fail; an address in no household appears in no household's list; and five tests in three files fail if `members(household)` returns everyone. `people(household)` at 6000 members in 3000 households: 0.044 ms against 11.655 ms for the old filter.
- Ids and paths: `householdBooksPath` refused 65 of 70 candidate ids (traversal, absolute, backslash, NUL, newline, fullwidth, Cyrillic, Kelvin sign, reserved device names, `home.db`; the 5 accepted are plain lowercase words) and a brute force over 22764 strings of a 28-character hostile alphabet accepted three, all plain a to z (`a`, `aa`, `aaa`). Household ids come from the host command only, and the directory's own `CHECK` and the code's regex agree. The rate-limit key `<household>:<person>` is injective because a household id is one lowercase word.
- NFR: security — F1, F2; the rest above ✓ · performance ✓ (flat probe cost, measured) · reliability — F3, F6 · maintainability — F1's header and `CLAUDE.md` sentence are false for two routes.
- Invariants checked: no cross-tool import ✓; typed errors (`INTERNAL`, `TIMEOUT`) ✓; no shell ✓; contract untouched ✓; new tests in the registered `ledger/api` package ✓; no new workspace dependency, so no `Dockerfile` edit beyond the `ENV` ✓; style ✓ (`npm run check`). Skipped: redaction, SSRF, progress, spawn (not touched by the diff).

### Gate 2

**Gate: CONCERNS** — 2026-10-12 · the round `91bcd34e..43f2d948` (head `43f2d948b1c25060721a90d008b5f5adadd27fc3`; its commits `b9f95095`, `d0abb5ab`, `c9ed27bb`, with `32f8a994` and the merge that brought it left out) · Sonnet 5.5, the round only

Nothing I found in this round is a `high`. The one reason this is not PASS is Done when 6: `test (ubuntu-latest)` was still running on this head when I read the checks once, so the line stays **unproven (gate)** until that job is green. Everything else I could run is clean.

| Done when                                                                                           | Proof at this head                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Each household's requests read and write only its own file; the sweep proves it over every route | **proven** — `api/test/isolation.test.ts` › "each household reads its own records through every read route, and nothing of the other's" now also asserts `storedLeaks(app)` equals `[]`. Handed the wrong household's handle one route at a time: all 18 write routes caught (away's request to that route given home's handle, then both households' requests swapped), and 42 of the 44 read (route, direction) pairs, the other 2 being `me`, which reads no books. Control with nothing mutated: no failure, 0 leaks, 0 silent reads, 0 stored |
| 2. `AppContext` has no `db`; `npm run check` passes                                                 | **verified** — `npm run check` exit 0 on a clean tree at this head, no warning in a ledger file                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3, 4, 5. Runtime household, health, import                                                          | unchanged by the round; `npx vitest run tools/ledger/api`: `Test Files  27 passed (27)`, `Tests  464 passed (464)` (462 at gate 1, plus the two new first-open tests)                                                                                                                                                                                                                                                                                                                                                                              |
| 6. Gates green, including the image's boot and the household command inside it                      | **unproven (gate)** — on this head `docker` success (run 38300476065; its log shows the household step run and health `"ok":true`), `check`, `codeql`, `CodeQL`, `dependency-review` success; `test (ubuntu-latest)` and `test (windows-latest, informational)` pending at my one read. It becomes proven when `test (ubuntu-latest)` is green on this head                                                                                                                                                                                        |
| 7. Step 9 holds, each part with a test                                                              | **proven** — the five tests of gate 1 still pass, and the first-open path now has its own: `books.test.ts` › "migrated: refuses its member at once, keeps the others served, and opens once unlocked" and › "not yet migrated: …". With the two first opens made to wait again they fail with `expected 5009 to be less than 1000` and `expected 5152 to be less than 1000`                                                                                                                                                                        |

### Verdicts on gate 1's findings

- **F1 (high) — fixed.**
  - Gate 1's source leaks, re-planted on this head (`pinnedMap ??= booksOf(request)` on the `setSpendingCategoryMap` and then on the `setSpendingCategoryOverride` argument), each fail the real sweep: `Tests  1 failed | 463 passed (464)`, `away POST spendingCategoryMap: … SPENDING_CATEGORY_NOT_FOUND … expected 404 to be 200`, and the same for `spendingCategoryOverrides`.
  - With the id offset taken out of a copy of the sweep, so that only the table check can see a leak, the map leak fails with `"home's spending_category_map holds away's Chalet"` and `"spending_category_map holds 2 rows at home, 0 away"`, and the override leak with `"spending_category_overrides holds 2 rows at home, 0 away"`; the copy passes unmutated. So the override leak is named by the row count alone: it carries no mark, and the equal-count assertion is load-bearing.
  - Population: the 18 write routes, mutated one at a time by method and path, in two modes (away to home; both households swapped), with the offset and with it removed: 18 of 18 caught in each of the four runs. The table check names a mismatch on all 18 in the away-to-home mode; in the swap mode it names 7 of 18 with the offset (12 of 18 without) and the rest are caught by a refused write or by silent reads.
- **F2 (med) — fixed.** A `GET /api/zz-leak` outside `ROUTES` and a `PUT` on `ROUTES.rules` each fail "covers every route the app answers…" naming `GET /api/zz-leak` and `PUT /api/rules`. So do a `GET` on a `POST`-only path (`GET /api/rules/:id`), a deeper parametric path, a trailing-slash twin (`GET /api/rules/`), a wildcard and an `OPTIONS`. One case escapes (N1).
- **F3 (med) — fixed.** `lock.mts` from gate 1 on this head: tom, a household's first request while the import holds its file, `504 TIMEOUT` in 1 ms (was `500` after 5006 ms); an anonymous `GET /api/health` in the same state `200` in 1 ms (was `503` after 5007 ms); tom after unlock `200`; the already-open household unchanged (alex 200, sam 504 in 1 ms).
- **F4, F5, F6 (low) — not fixed, by the builder's choice; they stay recorded.** The owner's answer on the health decision is "keep it", which changes nothing in the gate's findings.

### The round's own risks

- **Half-open books.** No request reached books whose migration had not finished. A child process behaving like `import --write` (opens the file, `configure`, `BEGIN IMMEDIATE`, `applyMigrations` inside the transaction, holds 250 ms, then `COMMIT` or `ROLLBACK`) against `Books.forMember` and `Books.check` in a tight loop: 24 import windows, half committing and half rolling back, half with the lock already held and half racing the importer to the file: 2300 requests refused `TIMEOUT`, 3 served, **0 anomalies** — every handle returned had `user_version` 7 (the latest), the caller's name enrolled and the schema's tables, and after each window the household opened at version 7. A migration refused and retried: 3000 refused opens against a locked file, in the unmigrated state and the migrated one, left the process at 32 → 33 and 32 → 34 descriptors (a one-off, not growing with the count), and opened fully, with both names, once unlocked. With a handle kept and a name missing, the unenrolled caller gets `504` and a caller already enrolled is served (gate 1's S1 for an open household, and the first-open tests).
- **Equal row counts as an invariant.** I found no legitimate write in the current fixtures that makes the counts differ, and the sweep passes at 464 of 464. It holds because both households make the same writes in the same shape; a household-specific branch in a future route (an amount-limited filing that fires for one household's figures) would break it for a legitimate reason, which I did not measure. Whether a leak can keep the counts equal: only a symmetric swap does, and all 18 swaps were caught, 8 of them (`spendingCategoryRetire`, `spendingCategory`, `rule`, `spendingCategoryMap`, `spendingCategoryOverrides`, `recurringItem`, `periodLines`, `periodLine`) only by home's write being refused in away's still-empty file, which is the write order and not the invariant. I did not construct a symmetric leak that escapes, and did not run a double-write mode.
- **The `printRoutes` parse.** Copied verbatim and compared against `onRoute` as ground truth on four trial apps: nested and parametric paths to four levels (`/api/a/:id/b/:sub/c`), shared prefixes (`/api/pre`, `/api/prefix`, `/api/prefixed`), a multi-method `route()` and an explicit `HEAD` without a `GET` are read exactly. A wildcard reads as `GET *` and an optional parameter (`:a?`) as its two paths, and both fail the comparison rather than pass it, which is the safe side; the app has neither. The one thing it does not read is N1.

### New findings in the round's lines

- **low** · no live call site · **N1 — an explicit `HEAD` beside a `GET` is dropped, so the text that says otherwise is false for it.** The filter in `answeredRoutes` drops every `HEAD` whose path has a `GET`, Fastify's own and a handler of the author's alike. Reproduction: add `app.head(ROUTES.rules, opts, handler)` with a handler holding the first caller's handle to `routes/me.ts`; `npx vitest run tools/ledger/api/test/isolation.test.ts`: `Tests  2 passed (2)`. The comment on the function ("any other `HEAD` … is kept, so that it fails the comparison") and `tools/ledger/CLAUDE.md` ("whatever the method") overstate it. A `HEAD` sends no body, but its headers are the household's. Remedy: keep the `HEAD` if it is not Fastify's own, for instance by comparing the handler or by registering with `exposeHeadRoutes: false` in the test's app.
- **low** · no live call site · **N2 — the kept handle has no assertion.** Changing `#open` to close the file and answer `TIMEOUT` when the enrolment is refused, instead of keeping the migrated handle, leaves `Test Files  27 passed (27)`, `Tests  464 passed (464)`. The new tests assert `health.status` is not `500`, which `503` satisfies; the behaviour the Log states (the probe answers 200 with the books open and only a name missing) is true, measured above, and unasserted. Remedy: assert `200` for the "migrated" case.
- **low** · `nfr:reliability` · **N3 — while an import holds the lock on books not yet migrated, every probe answers `503` and logs an error line.** Not a regression: at gate 1 the same state was a 5 s wait and then `503`. Same family as F6, and transient for the import's duration; the migrated state answers `200`.
- **findings** · the hunt returned 3 new (N1 to N3), all carried; 0 dropped.
- NFR: security ✓ (F1's route-independent table check, measured) · performance ✓ (a refused open costs 0.11 to 0.23 ms, no descriptor growth) · reliability — N3 · maintainability — N1's overstated comment.
- Not verified: a double-write leak mode; the pull request's `test (ubuntu-latest)` and `test (windows-latest, informational)` results; a symmetric leak outside the 18 write routes' swap.

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
- 2026-10-12 — **The owner answered the build's open decision**, through the
  orchestrator's `AskUserQuestion`: health keeps opening, and if missing
  creating, the books of a household added since boot. The options were (A)
  keep it, the builder's recommendation, and (B) health checks the files
  already open only. Gate 1 had measured it first: a caller cannot choose what
  is created, each household's file is made once, and the first probe costs
  24 ms for one new household and 8.8 s for 500.
- 2026-10-12 — Round 1, on gate 1's F1 (high), F2 and F3 (med). F4 to F6 (low)
  stay recorded and unfixed.
  - **F1, the sweep missed a write leak on the map and override routes.** The
    finding held: the two households wrote in lockstep, so every id one named
    was valid in the other's books, and no read lists a map entry for a bank
    category the reader has no rows in. Two mechanisms now, each enough on its
    own. After the writes the sweep reads every table of both files through
    `app.books.of`: no table may hold the other household's marks, and each
    table holds as many rows in one file as in the other, since both make the
    same writes. And away writes a spare category and a spare row before
    anything else, home after everything, so their ids differ and an id one
    names is not the same record in the other's books.
    - The gate's planted map leak (`pinned ??= booksOf(request)` on
      `setSpendingCategoryMap`): `npx vitest run tools/ledger/api` exit 1,
      `Tests  1 failed | 463 passed (464)`,
      `away POST spendingCategoryMap: {"error":{"code":"SPENDING_CATEGORY_NOT_FOUND"…`.
      The same leak on `setSpendingCategoryOverride`: exit 1, the same count,
      `away POST spendingCategoryOverrides: … SPENDING_CATEGORY_NOT_FOUND`.
    - With the spare category taken out, so that only the table check stands:
      the map leak fails with `"home's spending_category_map holds away's Chalet"`
      and `"spending_category_map holds 2 rows at home, 0 away"`, and the
      override leak with `"spending_category_overrides holds 2 rows at home, 0 away"`.
    - Gate 1's harness, rebuilt on this sweep (each of the 18 write routes
      alone, away's request to that method and path handed home's handle):
      `mutated 18 write routes, caught 18`. The table check reports a
      mismatch on all 18 by itself. Control, nothing mutated:
      `failure=undefined leaks=0 silent=0 stored=0`.
  - **F2, the coverage test saw only `ROUTES`, `GET` and `POST`.** The list now
    comes from `server.printRoutes`. It is a tree, four columns per level, so
    each node's path is its ancestors' segments and its own. The `HEAD` Fastify
    adds beside each `GET` is dropped, and any other method is kept. A
    `GET /api/zz-leak` planted in `routes/rules.ts` fails "covers every route
    the app answers…" with `- "GET /api/zz-leak"`, and so does a
    `PUT ROUTES.rules`, with `- "PUT /api/rules"`. The parse gives the 41
    pairs the tables hold, nested `:id/retire` paths included.
  - **F3, a household's first open waited 5 s and answered 500.** Reproduced
    with the gate's `lock.mts`. The fix: a request or a health probe opens
    books without waiting. The connection starts with no timeout, migrations
    run with `busy_timeout` at 0, and enrolment does not wait. A migration the
    lock refuses closes the file and answers `TIMEOUT`. An enrolment it refuses
    keeps the migrated handle, and `forMember` enrols on a later request. Boot
    still waits, since nothing is served yet. `lock.mts` after the fix:
    `S2 tom (first request of a household whose file is locked): { status: 504, ms: 2 }`,
    `S2 anonymous health probe in the same state: { status: 200, ms: 1 }`
    (the books are open, and only a name is not in them yet),
    `S2 tom after unlock: { status: 200, ms: 2 }`; S1 is unchanged, alex 200
    and sam 504 in 1 to 2 ms. New tests, last in `books.test.ts`: "migrated:
    refuses its member at once…" and "not yet migrated: …", for a file the
    import has migrated and for one still mid-migration in its transaction.
    With both opens waiting again, both fail
    (`expected 5045 to be less than 1000`, `expected 5009 to be less than 1000`).
- 2026-10-12 — **Gate 2's N2 fixed at landing**, in the commit that changes
  `books.test.ts`: the "migrated" case of "the first open of a household whose
  books another process holds locked" now asserts the probe answers `200`; the
  "not yet migrated" case keeps `not.toBe(500)`, since its books are not open.
  The other findings (F4, F5, F6, N1, N3) stay recorded and unfixed.
  - With `Books.#open` closing the file and throwing `busy(error)` on a refused
    enrolment, before the change: `npx vitest run tools/ledger/api/test/books.test.ts tools/ledger/api/test/health.test.ts`
    `Test Files  2 passed (2)`, `Tests  18 passed (18)`. After the change, same
    mutation, `books.test.ts`: `Tests  1 failed | 9 passed (10)`,
    `migrated: refuses its member at once, keeps the others served, and opens once unlocked`,
    `AssertionError: expected 503 to be 200`. Mutation removed:
    `Tests  10 passed (10)`.
- 2026-10-12 — **Reconciled with `main` at `84c899e4`** (lg-19, #449), a merge,
  by the fixer, and not gated: its correctness rests on the isolation sweep and
  preflight. The compile failure was where the build's last Log line said it
  would be.
  - `GET periodLines` in `api/src/routes/periods.ts` reads
    `listLines(booksOf(request), …)`, as `periods` and `periodOpen` beside it.
    lg-19's `periods.test.ts` read `target.context.db` in one test, three
    times; they read `homeBooks(target)` now. Nothing else of lg-19's reads the
    books: `listLines` takes the handle as an argument.
  - The sweep's read table gained `{ route: "periodLines", method: "GET", url: ROUTES.periodLines }`.
    Before it, `npx vitest run tools/ledger/api`: `Tests  1 failed | 483 passed (484)`,
    "covers every route the app answers" missing `GET /api/period-lines`. It
    needed no choice the other rows do not show: no query, so every stored line
    is listed, and the lines carry the household's word and cents.
  - Planted leak (`periodLines` handed the other household's handle through a
    temporary global, then restored): `npx vitest run tools/ledger/api/test/isolation.test.ts`
    exit 1, `Tests  1 failed | 1 passed (2)`,
    `"home GET periodLines shows away's Chalet, kim, 2227"`,
    `"away GET periodLines shows home's Maison, sam, 3119"`. Restored,
    `Tests  2 passed (2)`.
  - `npx vitest run tools/ledger`: `Tests  904 passed (904)`, against 880 before
    the merge; the 24 added are lg-19's, none of the 880 lost.
