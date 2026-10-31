---
id: lg-77
tool: ledger
title: A household's members and the admin can rename it
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-77 — Rename a household

## Why

A household's name is set once, when it is created, and never again: migration 1
of the directory (`api/src/db/directory-schema.ts`) refuses any update to a
`households` row (`households_never_updated`), and no route or command offers one.
lg-71 makes every new household "Home" by default and drops the Name field on the
owner's reading that a name you can change at any time does not earn a step of its
own. That reading holds only once the name can actually be changed.

## Decision — answered 2026-10-25 by the owner

Asked who can rename a household, with options: its members and the admin, or the
admin only. The owner chose **members and the admin**. Filed as its own ticket
rather than inside lg-71, so lg-71's creation flow and this new directory table
land in separate pull requests.

## Build

1. **Directory schema** (`api/src/db/directory-schema.ts`): a new migration adds
   an append-only `household_names` table, built the way `person_names` is (lg-33):
   one row per rename with the household id, the name, `named_at` and `named_by`;
   triggers refusing update, delete and replace; and a `current_household_names`
   view picking each household's latest row. The `households` row and its trigger
   stay as they are: its `name` is the name the household was created with, and
   the current name is the latest rename, falling back to that original.
2. **Directory** (`api/src/directory.ts`): `renameHousehold({ household, name, by,
   at })`, with the same name rule `addHousehold` applies (trimmed, 1 to 80
   characters), and `HOUSEHOLD_NOT_FOUND` for an id the directory does not hold.
   `household()` and `households()` return the current name, so every caller,
   the host command's `list` included, shows the latest name with no change of
   its own.
3. **Contract** (`tools/ledger/contract/src/api.ts`): a rename request
   `{ name }`, strict, and two routes: `POST /api/households/:id/rename` for a
   member and `POST /api/admin/households/:id/rename` for the admin. The
   household history's union gains a household-rename record, beside
   `MembershipRecord` and `PersonNameRecord`. The owner approved this contract
   change in the decision above.
4. **Routes** (`api/src/routes/households.ts`): the member's route is guarded by
   `asMember` in `onRequest` and rate-limited as a write; the admin's by
   `adminWrite`, as every other admin route is. Both sign the change with the
   caller's address. `history()` merges the household's renames in by time, the
   way it merges person renames.
5. **Web**: the household page (`web/src/household/Household.tsx`) shows the
   household's name as its heading, where it now says "Household", with a Rename
   beside it; the admin's card (`web/src/admin/Admin.tsx`) offers the same. The
   history list describes a rename. A new screen state gets a case in
   `e2e/layout.spec.ts` at 360 px.
6. **Host command** (`api/src/household-command.ts`): no new verb unless the
   build finds the operator needs one; say which in the Log.
7. **`ADDRESS_ALREADY_A_MEMBER`** (`contract/src/errors.ts`, raised in
   `api/src/directory.ts`): once households have names, its message names the
   household by its name rather than its id (from lg-71's gate, owner answer
   2026-10-25).

## Done when

- A member renames their own household and the admin renames any household,
  each proved by a test in `api/test/households.test.ts`; a member of another
  household and a caller who is neither are refused with the same 403 the other
  household routes give.
- A rename is a row in `household_names`, never an update of `households`,
  proved by a test that the `households` row is unchanged after one.
- The household's history lists the rename with who made it, proved by a test.
- The household page and the admin card show the current name and rename it,
  proved by web tests; `e2e/layout.spec.ts` passes.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from lg-71's second decision: a household named "Home" by
  default has to be renameable. Not blocked on lg-71; either can land first.
- 2026-10-31 — Re-rated `standard` to `hard` by the owner at intake. Asked "Keep
  standard" or "Re-rate to hard", after the seam map noted that lg-71, a
  comparable shape, is `hard`, with no recommendation given; the owner chose
  **re-rate to hard**.
