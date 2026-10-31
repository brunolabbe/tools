---
id: lg-74
tool: ledger
title: A household can hold a person who has no email and never signs in
kind: work-package
status: ready
milestone: P6
depends_on: [lg-71, lg-76]
difficulty: hard
---

# lg-74 — A person without an email

## Why

Every person a household holds comes from a membership, and a membership is an
email: `memberships.address` is `NOT NULL` (`api/src/db/directory-schema.ts`),
`Directory.heldPeople` and `Directory.people` read persons from memberships only
(`api/src/directory.ts`), and the books enrol a person when `people` names them
(`api/src/books.ts`, `forMember` and `#open`). So a person who counts in the books
but never signs in — the partner whose salary sets the mortgage split while one
person keeps the ledger — has to be given an email, and that email has to be
admitted on the Access policy, for no use.

## Decision — answered 2026-10-25 by the owner

Asked whether a person may be added without an email, with options: optional
after the first person, or always required. The owner chose **optional after the
first**: the person lg-71's form creates a household with still needs an email,
since a household nobody can sign in to serves no one; anyone added after may be
a name only, and can be given an email later. Asked in the same session, after
the owner noted that most likely one member of a house keeps the ledger.

## Build

1. **Directory schema**: a new migration adds an append-only `people` table
   (household id, person, `added_at`, `added_by`), refusing update, delete and
   replace the way `memberships` does, with the person rules `memberships`
   applies (1 to 64 characters, trimmed). A person added with an email is still
   a membership and needs no row here; a person added without one gets a row.
2. **Directory** (`api/src/directory.ts`): `addPerson({ household, person, by,
   at })` refuses a person the household already holds, and a name another person
   is shown under (`PERSON_NAME_TAKEN`, as `addMember` does). `heldPeople` and
   `people` return the union of membership persons and this table's, so the
   books enrol a person without an email, `standings` and retirement (lg-35)
   reach them, and renaming (lg-33) works on them. Read every other caller of
   `heldPeople` and `people` and say in the Log which, if any, must still mean
   "has an email". Giving such a person an email later is `addMember` under
   their existing id, which already accepts a held person.
3. **Contract and routes**: `address` becomes optional in
   `addMemberRequestSchema`, for the admin's route and the member's; without it
   the route calls `addPerson`. lg-71's create request keeps it required. The
   history gains a "person added without an email" record. The owner approved
   this contract change in the decision above.
4. **Web** (`web/src/household/MemberForm.tsx`, used on the household page and
   the admin card): Email is optional, with a hint that a person without one
   counts in the books but cannot sign in. The member lists show such a person
   by name with "no email" in place of an address, and the admin's "to admit"
   list leaves them out. A new state gets a case in `e2e/layout.spec.ts`.
5. **Retirement**: lg-35 asks for a person's addresses to be removed before
   they are retired. A person without one has nothing to remove; make sure the
   refusal does not ask for it.

## Done when

- A member and the admin can each add a person with no email, proved by tests in
  `api/test/households.test.ts`; the person is enrolled into the household's
  books on the next request, proved by a test reading the books' people.
- That person can later be given an email and then signs in as the same person
  id, proved by a test.
- lg-71's create request still refuses a missing email, proved by a test.
- Renaming and retiring work on a person without an email, proved by tests.
- The forms and lists behave as in Build step 4, proved by web tests;
  `e2e/layout.spec.ts` passes.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question while lg-71 was being re-scoped.
  Depends on lg-71 because both change the member and create request schemas
  and the admin form; building them in that order avoids one rewriting the
  other.
- 2026-10-25 — Now waits on lg-76 too: a person added without an email gets a
  UUID id and their typed name as their shown name, so `addPerson` follows
  lg-76's rule rather than storing the name as the id.
- 2026-10-25 — lg-78 waits on this: the import screen adds a name the household
  lacks as a person without an email, through `addPerson`.
- 2026-10-31 — Built from `f05108d2`, on branch `lg-74-person-without-email`.
  Directory migration 8 adds `people` (household, person, `added_at`,
  `added_by`) with the triggers the brief names; `Directory.addPerson({
  household, person, by, at, newId? })` returns `{ household, person, name }`,
  the person under a generated id (lg-76) and `person` as their first shown
  name, both written in one transaction. `addMemberRequestSchema`'s `address`
  is optional, with a refinement that one of the two fields is there;
  `createHouseholdRequestSchema` is untouched. The history gains
  `{ action: "add-person", person, at, by }` (`PersonAddedRecord`), read before
  the `name` record written with it.
  - **What the brief had wrong or left out.** (1) Migrations 5 and 6's
    `person_names_held`, `person_names_unique`,
    `memberships_person_not_shown_as_another` and `retirements_held` read "a
    person the household holds" from `memberships` only, so the schema refused a
    no-email person's first shown name, a rename and a retirement whatever
    `heldPeople` said. Migration 8 drops and recreates the four, asking
    `memberships` or `people`, with the sentences they raised before. (2) Build
    step 4's lists need an address-less entry, which the contract had no room
    for: `HouseholdMember.address` is now `string | null`, `null` for a person
    held without an email. That is a response-shape change beside the request
    change the owner approved; nothing reads `members` for an address except the
    screens changed here. (3) `people` is not quite the plain union: it adds the
    no-email people who stand `in` (`Directory.withoutEmail`). A person with an
    email leaves `people` when their last address is removed, which comes before
    any retirement; a no-email person has no such step, so the retire request
    takes them out instead, or a retired partner would still be "the other" on a
    receipt and a workbook import's member. `heldPeople` is the plain union.
    `people`'s household argument is now required: no caller left it out.
  - **Every caller of `heldPeople` and `people`**, re-resolved at `f05108d2`
    with `git grep -n "heldPeople\|directory\.people(" f05108d2 --
    tools/ledger/api/src`; it printed the seam map's list exactly.
    `directory.ts:391` (rename), `:463` (`standings`), `:715` (`#admitByName`)
    and `:764` (`#admit`) take the union: a no-email person can be renamed and
    retired, found by their shown name, and given an email under the id they
    have without the "new person" name check. `books.ts:161,225` enrol from
    `people`, which is how the books get them. `import-command.ts:162,164` and
    `routes/workbook.ts:33` enrol an import's members and name them; an import
    recorded `--as` a no-email person is the operator's choice and harmless.
    `routes/receipts.ts:128` is who "the other's" item means, and the partner
    who never signs in is exactly that person. **None of them has to mean "has
    an email".** The readings that do already read `members()`: the identity
    hook, the retirement refusal (`directory.ts`, `retirePerson`), the admin's
    "Emails to admit" list and `server.ts`'s empty-directory check.
  - **Build step 5.** `retirePerson`'s "Remove every email" refusal reads
    `members()`, so a no-email person is never asked for one; the admin card's
    retire hint now says "Remove their emails first, if they have any."
  - **Fold-in.** `npm run household:ledger -- list` prints a no-email person as
    `<shown> (<id>)  no email` (`household-command.ts`, with a test in
    `household-command.test.ts`): the operator's list is the third member list.
    Not folded in: a host-command verb to add a person without an email, which
    nothing specifies.
  - Measured: `npx vitest run` over `households.test.ts`, `directory.test.ts`,
    `household-command.test.ts`, `person-names.test.ts` (api) and
    `household.test.tsx`, `admin.test.tsx` (web): `Tests 200 passed (200)`.
    `E2E_PORT=8174 npx playwright test -c tools/ledger/playwright.config.ts`:
    `14 passed (23.9s)`, the new case "Household and Admin fit a phone and a
    desktop with a person who has no email" among them; its four screenshots
    were opened and show the person by name with "no email" and nothing to
    admit. Five `user_version` assertions moved from 7 to 8; lg-75 and lg-77
    move them again.
- 2026-10-31 — The owner's answers, recorded at landing. The builder raised as
  an open decision that the response field `HouseholdMember.address` becomes
  nullable for a person with no email, which the 2026-10-25 Decision (request
  schema only) did not name. Options: (a) keep the one field as `string | null`,
  so each list reads one array and the type checker found every reader; (b)
  leave `HouseholdMember` as it was and add a separate no-email list to
  `HouseholdResponse` and `AdminHousehold`. The owner chose (a), the builder's
  recommendation, overriding no one's.
  - The owner declined the builder's proposed `tools/ledger/CLAUDE.md` line; it
    goes to the next review session instead.
  - Gate 1, F2 (`Directory.openReadOnly` does not migrate, so the import command
    against a directory the API has not booted on migration 8 dies with a raw
    SQLite "no such table" error): the owner chose (b) accept, "a deploy boots
    the API, which migrates, before an import runs", over (a) file a ticket for
    a typed `user_version` check in `openReadOnly`, the gate's recommendation,
    overridden by the owner.
- 2026-10-31 — Fixed at landing by owner choice: gate 1, F3 — "stale comments.
  `Books.forMember`'s doc and the `api/src/people.ts` header say the books
  enrol the names of current members". Both comments now also name the people
  held without an email who stand. `git diff defd5294 -- tools/ledger/api/src/books.ts | grep -c '^-.*current members stand under enrolled into'`
  → `1`, and `git diff defd5294 -- tools/ledger/api/src/people.ts | grep -c '^-.*current members stand under that the table does not hold'`
  → `1`.
