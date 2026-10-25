---
id: lg-71
tool: ledger
title: A new household gets a generated UUID instead of an id the admin types
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-71 — A new household gets a generated UUID

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

## Build

1. **Contract** (`tools/ledger/contract/src/api.ts`): `CreateHouseholdRequest` and
   `createHouseholdRequestSchema` lose `id`; the request is `{ name }`. The owner
   approved this contract change in the decision above.
2. **Shape** (`api/src/directory.ts`): `HOUSEHOLD_ID` accepts either a legacy word
   (`[a-z]{1,32}`, the reserved names still refused) or a lowercase UUID as
   `crypto.randomUUID()` prints it. Update the refusal sentence in `addHousehold`
   and the comment on `HOUSEHOLD_ID` to say both. `isHouseholdId` guards the books
   and photo paths (`books.ts`, `receipt-photos.ts`); confirm a UUID still resolves
   under `households/` there, and test it.
3. **Who generates it**: the admin route (`api/src/routes/households.ts`) and the
   host command's `add` (`api/src/household-command.ts`) call `randomUUID()` from
   `node:crypto`. Keep `Directory.addHousehold` taking an `id`, so the many tests
   and `api/test/helpers/households.ts` that pass readable ids keep working, and so
   the directory stays deterministic under test. `add` becomes
   `add <display name>` and prints the id it made; update its usage text.
4. **Rate-limit keys** (`api/src/rate-limit.ts`): the person key is
   `${household}:${person}` and relies on an id holding no `:`; the admin key on it
   holding no `@`. A UUID holds neither. Update the two comments, which say an id
   is one lowercase word.
5. **Web** (`web/src/admin/Admin.tsx`, `web/src/api/households.ts`): drop the Id
   field and its hint; the form sends the name only. The household card shows
   `{name} ({id})` — a UUID there is noise and widens the card; show the id only
   if the screen needs it to tell two same-named households apart, and say which
   you chose in the Log. `e2e/layout.spec.ts` must still pass at 360 px.
6. **Tests**: a household created through the route and through `add` gets a UUID
   and its books file opens; a legacy word id still opens, routes and limits; a
   request carrying `id` is refused by the strict schema; `con` still refused.

## Done when

- `POST /api/admin/households` with `{ name }` creates a household whose id is a
  UUID, proved by a test in `api/test/households.test.ts`.
- The host command's `add <display name>` creates one and prints its UUID, proved
  by a test.
- A household with a legacy word id still loads its books, serves its routes and
  keeps its rate-limit bucket, proved by the existing suites passing unchanged
  where they use word ids.
- The admin form has no Id field, proved by `web/test/admin.test.tsx`, and the
  admin screen passes `e2e/layout.spec.ts`.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question on the admin page ("why does a
  household need an id?"). Decision recorded above.
