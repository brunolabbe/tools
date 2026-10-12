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
   closed like `personOf`.
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
6. Gates green, including the ledger image's boot.

## Log

- 2026-10-12 — Filed with lg-20, lg-22 and repo-98 from the owner's design
  discussion. The owner said the existing `ledger.db` can be wiped, so nothing
  migrates it.
