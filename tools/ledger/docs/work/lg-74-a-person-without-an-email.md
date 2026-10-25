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
