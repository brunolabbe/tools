---
id: lg-71
tool: ledger
title: A new household is created by adding its first person, under a generated UUID and the name "Home"
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-71 — A new household is created by adding its first person

## Why

The admin page's "New household" form asks for an id, "one lowercase word, a to
z", next to the display name. The id is the household's key everywhere but the
screen: its books file is `households/<id>.db` (`api/src/books.ts`), its receipt
photos sit in a directory of that name (`api/src/receipt-photos.ts`), it is the
`:id` in `/api/households/:id`, the prefix of every person's rate-limit key
(`api/src/rate-limit.ts`), and the argument of the host command. Its shape,
`[a-z]{1,32}` minus `con`, `prn`, `aux` and `nul`, exists because lg-21 made it a
file name.

A word the admin chooses is usually the family's name, so it shows the household
in URLs, logs, rate-limit keys and file names on the host. A generated UUID tells a
reader of any of those nothing. It is not a secret and does not need to be: a
household's routes are gated on the Access identity being one of its members, so
guessing an id opens nothing. The cost is readability: the host command and a
directory listing name households by UUID.

## Decision — answered 2026-10-25 by the owner

Asked how a new household's id should be chosen, with options: generated from the
name (a slug, suffixed on a collision); a generated UUID; keep the field; file a
ticket. The owner chose **a UUID**, for privacy, and **a ticket** rather than
building it in the session that asked.

Asked what happens to households that already exist, with options: leave them, or
migrate them to UUIDs with a one-off command that renames each books file and
photo directory and rewrites the directory rows. The owner chose **leave them**:
both shapes stay valid, and no migration is written.

Asked again the same day, once the UUID left the form holding only a name, how a
household should start. The owner's reading: a name that can be changed at any time
does not earn a step of its own, so default it to "Home" and start with the first
person. Options: the first person creates the household, in one request; a button
with no fields that creates an empty "Home", then the member form; keep the Name
field, prefilled. The owner chose **the first person creates it**: no household
exists without a member, so no empty one is left behind, which matters because a
household is never deleted (`households_never_deleted`). The owner approved the
contract change this makes.

The same answer renames the form's **Address** label to **Email**: "address" read
as a postal address.

A household's name is not editable today: `households_never_updated` refuses any
update. Renaming is lg-77, filed with this decision; the owner chose that members
and the admin can both rename. Until lg-77 lands, every household made here is
"Home".

## Build

1. **Contract** (`tools/ledger/contract/src/api.ts`): `CreateHouseholdRequest`
   and `createHouseholdRequestSchema` become `{ address, person }`, the same two
   fields and limits as `addMemberRequestSchema`, strict, so a request still
   carrying `id` or `name` is refused. The response carries the household and
   its first member, so the admin screen needs no second request to show them.
   Field names stay `address`: the Email wording is copy, not contract.
2. **Shape** (`api/src/directory.ts`): `HOUSEHOLD_ID` accepts either a legacy
   word (`[a-z]{1,32}`, the reserved names still refused) or a lowercase UUID as
   `crypto.randomUUID()` prints it. Update the refusal sentence in `addHousehold`
   and the comment on `HOUSEHOLD_ID` to say both. `isHouseholdId` guards the books
   and photo paths (`books.ts`, `receipt-photos.ts`); confirm a UUID still
   resolves under `households/` there, and test it.
3. **One transaction** (`api/src/directory.ts`): a new method, say
   `createHousehold({ id, address, person, by, at })`, inserts the household as
   "Home" and its first membership in one `.immediate()` transaction, so a
   refused address (`ADDRESS_ALREADY_A_MEMBER`, not an email, unseen characters)
   leaves no household behind. Prove that rollback with a test: the household
   count is unchanged after the refusal. Keep `addHousehold` and `addMember` as
   they are, so the many tests and `api/test/helpers/households.ts` that pass
   readable ids keep working and the directory stays deterministic under test.
   "Home" is one constant, not a literal at each caller.
4. **Who generates the id**: the admin route (`api/src/routes/households.ts`)
   and the host command (`api/src/household-command.ts`) call `randomUUID()` from
   `node:crypto`. The host command's `add` becomes `add <address> <person>`,
   creating the same way the route does and printing the UUID it made along with
   the Access-policy reminder `member` prints; update `USAGE`.
5. **Rate-limit keys** (`api/src/rate-limit.ts`): the person key is
   `${household}:${person}` and relies on an id holding no `:`; the admin key on
   it holding no `@`. A UUID holds neither. Update the two comments, which say an
   id is one lowercase word.
6. **Web** (`web/src/admin/Admin.tsx`, `web/src/api/households.ts`): the "New
   household" card holds Email and Person and nothing else; submitting it creates
   the household. On an admin screen with no household it is the only form, so
   it reads as the first step. The household card shows `{name} ({id})` today: a
   UUID there is noise and widens the card, and every new card says "Home", so
   tell two cards apart by their members, and say in the Log what you chose.
   `e2e/layout.spec.ts` must still pass at 360 px.
7. **Email, not Address**, in the copy only: the label in
   `web/src/household/MemberForm.tsx` (used on both the household page and the
   admin's), the admin's "Addresses to admit" heading and its sentence,
   `ACCESS_POLICY_NOTE`, and the Change-address form on the admin card. The
   server's sentences that say "address" where a person reads them (the
   `ADDRESS_ALREADY_A_MEMBER` message, `NOT_AN_ADDRESS` already says "email
   address") get the same pass. Do not rename code identifiers, routes or
   error codes.
8. **Tests**: a household created through the route and through `add` gets a
   UUID, is named "Home", holds the first member, and its books file opens; a
   refused first address creates nothing; a legacy word id still opens, routes
   and limits; a request carrying `id` or `name` is refused by the strict schema;
   `con` still refused by `addHousehold`.

## Done when

- `POST /api/admin/households` with `{ address, person }` creates a household
  named "Home", whose id is a UUID and whose one member is that address as that
  person, proved by a test in `api/test/households.test.ts`.
- A refused first address leaves no household behind, proved by a test.
- The host command's `add <address> <person>` does the same and prints the UUID,
  proved by a test.
- A household with a legacy word id still loads its books, serves its routes and
  keeps its rate-limit bucket, proved by the existing suites passing unchanged
  where they use word ids.
- The admin form has Email and Person and no Id or Name field, and no screen
  labels an address field "Address", proved by `web/test/admin.test.tsx` and the
  household page's test; the admin screen passes `e2e/layout.spec.ts`.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question on the admin page ("why does a
  household need an id?"). Decision recorded above.
- 2026-10-25 — Re-scoped before any build, on the owner's second decision above:
  the Name field goes too, the first person creates the household, and the form
  says Email. The host command's `add` was `add <display name>` in the first
  brief; it follows the route to `add <address> <person>` so the operator cannot
  make an empty household either. Renaming split out as lg-77. The first
  person's email stays required here; lg-74 makes it optional for anyone added
  after, and lg-75 marks an email that has never signed in. lg-76 makes `person`
  optional in this create request later, naming the person from the email; build
  it required here.
- 2026-10-25 — Re-rated `standard` to `hard` on the owner's answer at intake.
  Asked by the orchestrator, once the seam map found the ticket wider than its
  rating (the contract schema, a `directory.ts` transaction, the host command,
  the web form, copy across several screens, and Build 6's design choice), with
  the options keep `standard` (the orchestrator's recommendation) or re-rate to
  `hard`. The owner chose **re-rate to `hard`**, overriding the recommendation.
