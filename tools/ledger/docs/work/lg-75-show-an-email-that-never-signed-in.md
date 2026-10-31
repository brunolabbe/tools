---
id: lg-75
tool: ledger
title: The admin card marks an email that has never signed in
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-75 — Mark an email that has never signed in

## Why

An email the admin mistypes into a household is never confirmed and never
refused: Cloudflare Access proves an address at every sign-in (one-time PIN, or
an identity provider), so a typo cannot sign in as anyone, but nothing in the
ledger says it has never been used. The admin learns of it when the person says
they cannot get in. The fix for a typo already exists, changing the address in
place (lg-34); finding it does not.

## Decision — answered 2026-10-25 by the owner

Asked whether an email should be confirmed before a household is created, with
options: no, but mark an email that has never signed in; no, leave it; yes, by a
confirmation email (a mail provider, its secrets, a pending household state, and
a repeat of what Access already proves). The owner chose **the mark**.

## Build

1. **Directory**: a new migration adds a `first_sign_ins` table, one row per
   address with the instant it was first seen, written with `INSERT OR IGNORE`
   and never updated. Only the first sign-in is kept: this is not an activity
   log, and it must not become one.
2. **Where it is written**: the identity hook resolves the caller's membership
   on every request (`api/src/access.ts`, `directory.membershipOf`). Record the
   first sign-in there, for an address that is a member, remembering in memory
   which addresses are already recorded, so a request after the first writes
   nothing — the shape `createEnroller` uses in `api/src/people.ts`. A failed
   write (the directory busy) must not fail the request; the next one retries.
3. **Contract and route**: each member in `AdminHouseholdsResponse` carries
   whether its address has signed in (and when, first). Admin only: the
   household's own route does not carry it. The owner approved this contract
   change in the decision above.
4. **Web** (`web/src/admin/Admin.tsx`): an address that has never signed in
   reads "Never signed in" beside it, on the household card and in the "to
   admit" list. After an address is changed (lg-34), the new one starts unmarked
   as signed in, which is right: it has not been used. `e2e/layout.spec.ts`
   passes at 360 px with the mark showing.

## Done when

- A member's first request records its address, and later requests write
  nothing, proved by tests.
- The admin listing reports a never-used address as such and a used one as
  signed in, proved by a test in `api/test/households.test.ts`; the household's
  own route does not carry it, proved by a test.
- A busy directory does not fail the request, proved by a test.
- The admin card shows the mark, proved by `web/test/admin.test.tsx`;
  `e2e/layout.spec.ts` passes.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question while lg-71 was being re-scoped.
- 2026-10-31 — Built, stacked on lg-77 (PR #686, head `aaf6828c`), so migration 10 follows
  its migration 9.
  - **Directory**: `first_sign_ins (address PRIMARY KEY, first_seen_at)`, with
    never-updated and never-deleted triggers and a `BEFORE INSERT` trigger that
    `RAISE(IGNORE)`s a second row for an address. That makes the writer's
    `INSERT OR IGNORE` and the other spellings leave the first row standing without
    the abort the other tables use, which `INSERT OR IGNORE` would not survive
    (`first-sign-in.test.ts`, "keeps the first row").
  - **Hook** (`access.ts`): `identityFor` calls `directory.recordFirstSignIn` for a
    member's address, once per address per process (a `Set`). The method reads
    first and writes only when the row is absent, with `busy_timeout` at 0, as
    `createEnroller` does: a write takes the lock even when it changes nothing, so a
    restarted process would otherwise write once per address, and a wait would be
    spent on the event loop. Any error is logged at warn (`first sign-in not
    recorded`, with the SQLite code) and not remembered, so the next request retries.
    An admin in no household and a stranger are never recorded.
  - **Contract**: `AdminHouseholdMember extends HouseholdMember { firstSignIn: string | null }`,
    on `AdminHousehold.members` only. The household's own route and every mutation
    answer keep `HouseholdMember`; the Admin screen refetches after each change, so it
    does not need the field on those. A person with no address is `null` and is not
    marked.
  - **Read-only path**: no new read on `Directory.openReadOnly`'s callers. The import
    (`directoryPeople`) reads `holdsHousehold`, `names`, `people`, `heldPeople`, none of
    which touch `first_sign_ins`; a test opens a directory at migration 9 read-only,
    reads it through `directoryPeople`, and finds it still at 9.
  - **Web**: a `NeverSignedIn` span on the card's member row, beside the `<strong>`, and
    in "Emails to admit". `.never-signed-in` is an inline pill that wraps on its own
    (`overflow-wrap: anywhere`, `max-width: 100%`), not through lg-80's rule.
  - **Brief, not wrong, but wider**: seven `user_version` assertions moved to 10, not six:
    five in `directory.test.ts`, one in `person-names.test.ts`, and lg-77's own
    migration-9 test in `household-names.test.ts`. A directory at 8 is migrated to the
    latest there, so it reads 10 now. Existing admin-listing expectations in
    `households.test.ts`, `rename-person.test.ts`, `admin.test.tsx` and
    `generated-ids.test.tsx` gained `firstSignIn`.
  - **Not folded in**: nothing small and specified came free.
  - **Checked** (worktree at this commit): `npm test -- --project ledger`, 1976 of 1976
    in 89 files; `npm run check`, exit 0; `npx oxlint` on the four ledger packages, exit 0; the
    ledger e2e suite, 18 of 18 on port 8175 with `RATE_LIMIT_READS_PER_MINUTE=0`
    exported in the shell (not committed), including the new `Admin fits a phone and a
    desktop with an email marked never signed in, beside long names`; its 360 px
    screenshot was opened, with the mark wrapping under a 64-character person name and
    a 111-character address.
- 2026-10-31 — Fixed at landing by owner choice: gate 1, the first low — "writes with `INSERT OR IGNORE`".
  It is a plain `INSERT` now. Before, `recordFirstSignIn("  SAM@example.test ")` printed
  `returned normally, rows: 0`; after, it throws `SQLITE_CONSTRAINT_CHECK` (a scratch script, both
  states on this tree). The removed line: `git diff e4882175 -- tools/ledger/api/src/directory.ts | grep -c '^-.*OR IGNORE INTO first_sign_ins'` → `1`.
  The comment beside the trigger in migration 10 now says "plain INSERT and an INSERT OR IGNORE alike".
- 2026-10-31 — Fixed at landing by owner choice: gate 1, the second low — "A doc comment like
  `holdsHousehold`'s would warn the next read-only caller". `firstSignIns` and `recordFirstSignIn`
  each say they are not for `openReadOnly`: `git diff e4882175 -- tools/ledger/api/src/directory.ts | grep -c '^+.*Not for .openReadOnly'` → `2`.
- 2026-10-31 — Fixed at landing by owner choice: gate 1, the third low — "claims an admin, but the body
  sends only as `ALEX`". The title says what the body asserts and no assertion moved:
  `git diff e4882175 -- tools/ledger/api/test/households.test.ts | grep -c '^-.*to an admin alike'` → `1`.
- 2026-10-31 — Fixed at landing by owner choice: gate 1, the fourth low (the open decision) — the
  owner chose (a), per address, as built. A removed and re-added address keeps its first instant,
  in the same household and in another; no source change. Pinned by `api/test/first-sign-in.test.ts`
  › "keeps the instant it first signed in, in the same household and in another", at the end of the file.
