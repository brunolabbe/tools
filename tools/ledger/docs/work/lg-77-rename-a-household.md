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
- 2026-10-31 — Built on `c7bdef21`.
  - **Directory.** Migration 9 adds `household_names` (append-only: update,
    delete and replace triggers, a foreign key to `households`, the 1-to-80
    trimmed CHECK) and `current_household_names`. `Directory.household()` and
    `households()` read the latest rename, falling back to the created name;
    `renameHousehold` uses `addHousehold`'s name rule and answers
    `HOUSEHOLD_NOT_FOUND`; `history()` merges the renames in by time, after
    every other record at the same instant, as `rename-household` records. The
    `households` row is never touched (`households_never_updated` still refuses
    it). A rename to the name the household already has is recorded, as
    `renamePerson` records one.
  - **Contract.** `ROUTES.householdRename` (`POST /api/households/:id/rename`)
    and `ROUTES.adminHouseholdRename` (`POST /api/admin/households/:id/rename`),
    `RenameHouseholdRequest` / `renameHouseholdRequestSchema` (strict,
    `name` 1 to 80), and `HouseholdNameRecord` (`action: "rename-household"`,
    `name`, `at`, `by`) in `HouseholdResponse.history`. Both routes answer the
    household as a `HouseholdSummary`. No error code added.
  - **Routes.** The member's route is `[asMember, write]`, the admin's
    `adminWrite`; each signs with the caller's address. Probes added to
    `authority.test.ts` (route count 8 → 10), `helpers/routes.ts` (so
    `route-limits.test.ts` walks them) and `isolation.test.ts` (a write under
    each household's word, and the admin route in the not-swept list).
  - **Web.** `household/HouseholdName.tsx`, used by both screens: the title with
    a Rename beside it, opening a field on the household's name alone. The
    household page's h2 is now the household's name (the "Household" heading
    and the muted name under it are gone); the admin card's h3 keeps its label
    (`Home: alex and sam`). The history says `Household renamed <name>, by
    <who>`. CSS `.titled` in `styles.css`.
  - **Build 6, the host command: no new verb.** The command exists to make the
    first household and to recover when the admin screen is out of reach, and
    a name is no recovery: the admin screen renames any household. `list`
    prints the current name with no change of its own
    (`household-command.test.ts`, "list prints the name it is called by now").
  - **What the brief had wrong.** Build 1: `households_never_updated` is
    migration 7's (lg-71 rebuilt the table and made it again), not migration
    1's. Build 3: the history union also has `PersonAddedRecord` and
    `PersonFirstNameRecord` now (lg-74, lg-76). Build 7: the message in
    `contract/src/errors.ts` names no household; only the sentence
    `directory.ts` raises named it, by id, so that is the one changed (and the
    tests that pinned `"home"`/`"away"` in it, the web fixtures included). Not
    in the brief: `Directory.openReadOnly` does not migrate (lg-74's gate 1,
    F2), so the import's `household()` would have read
    `current_household_names` on a directory the API had not opened since this
    change and failed "no such table". The import now asks `holdsHousehold`,
    which reads `households` alone (`household-names.test.ts`, "the import
    still resolves its household in a directory at migration 8, opened
    read-only").
  - **Layout.** Three cases at the end of `e2e/layout.spec.ts`: Household
    titled by 80 unbroken `H`s, the same with its rename open, and Admin with a
    rename open; each with a `CARDS` entry. `titleInsideWindow` reads the
    title's text box against the window, since `scrollWidth` reads a title an
    ancestor clipped as fitting. lg-80's `nameIsWhole` is the fuller check and
    could replace it once lg-80 is on `main`; not folded in, because it is not
    there yet. The first run with the rename field open was red, `Household
    (renaming) at 360 px: the title ends at 768.65625 in 360` and `is 788 px
    wide in a 360 px window`: the field's label, `New name for <the name>`,
    did not break. `.titled + .member-form label { overflow-wrap: anywhere }`
    fixed it. Screenshots at 360 px read: the title wraps on four lines with
    Rename under it, the label on three lines, nothing cut.
  - **Runs.** `npx vitest run` over the 15 touched spec files, 412 of 412
    passed. `npm run check`, exit 0. `npx oxlint tools/ledger`, exit 0.
    `npx playwright test -c tools/ledger/playwright.config.ts
    tools/ledger/e2e/layout.spec.ts` with `E2E_PORT=8177` and
    `RATE_LIMIT_READS_PER_MINUTE=0` set for that run only: `17 passed`. Without
    the variable, the first run failed one case on the reads limit (`"scope":
    "reads" … "msg":"rate limited"` in the server log), the defect lg-80's
    pull request #684 carries the config line for; it is not on this branch.
