---
id: lg-33
tool: ledger
title: An admin renames a person, and the books keep the id
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-33 — An admin renames a person, and the books keep the id

## Why

A person's name is their id in the books: lg-4 stores it on rules and
classifications, lg-5 on salaries and ratio shares, and the directory on every
membership (`docs/00-ANALYSIS.md` §7). So it cannot change, and a name typed
wrong at setup (`bruno` for `Bruno`) is there for good. The owner hit exactly
that while setting up locally on 2026-10-17, before any data was imported, and
asked for members to be editable from the admin screen.

lg-5 kept `people(id, added_at)` with no display name (owner, 2026-10-05, "kept
as built"). **This ticket reverses that answer**, by the owner on 2026-10-17: a
person gets a shown name on top of an id that never changes. Nothing the books
store is rewritten.

## Build

1. **The name lives in the directory, not the books.** An admin route never
   opens a household's books (the ledger `CLAUDE.md`, "being an admin reads no
   books"), and an admin may be in no household. Add directory migration 5 in
   `api/src/db/directory-schema.ts`: a `person_names` table (`id`,
   `household_id`, `person`, `name`, `named_at`, `named_by`), appended and never
   edited — the same `never_updated` / `never_deleted` / `never_replaced`
   triggers as `memberships` — and a `current_person_names` view, the latest
   record per household and person by `id`. A person with no record is shown
   under their id, so every household today reads exactly as before.
2. **A shown name is unique in its household**, against every other person's
   current name and every person id the household has held (a trigger, as
   `memberships_one_household` does). Two people shown as `Bruno` is the
   failure this prevents. The same `CHECK` as `memberships.person`: 1 to 64
   characters, trimmed.
3. **Only a person the directory has held can be renamed** —
   `Directory.people(household)`. A person id migration 3 enrolled from an old
   rule and no membership ever named is not renameable; say so in the refusal.
4. **The route is the admin's only** (owner, 2026-10-17):
   `POST /api/admin/households/:id/people/rename`, body `{ person, name }`, with
   `adminWrite` in `onRequest` and `adminOf` asked again in the handler, as in
   `api/src/routes/households.ts`. Add it to `ROUTES` in
   `contract/src/api.ts`, its zod schema beside `removeMemberRequestSchema`, and
   two ledger codes with their statuses in `api/src/http-errors.ts`:
   `PERSON_NOT_FOUND` (404) and `PERSON_NAME_TAKEN` (409). This is a contract
   change the owner asked for; nothing else in the contract moves.
5. **The shown name reaches every screen through one map.** `PeopleResponse`
   gains `names: Record<string, string>` (id → shown name, every person, the id
   where there is no record) beside `people`, filled from the directory by
   `GET /api/people`. `HouseholdMember` and the admin listing gain `name`.
   Every web screen that prints a person — home, salaries, periods and their
   settlement, rules, inbox, receipts, stats, household, admin — prints it
   through one helper over that map, never the id. A chart keeps its colour by
   the person's place in the list (the ledger `CLAUDE.md`, stats), so a rename
   changes no colour.
6. **What still takes the id**: `import:ledger --as`, `household:ledger member`,
   and the member form's person field. The member form offers the household's
   existing people by shown name and submits the id; a new person is typed as
   today and their id is what was typed.
7. **The admin screen** (`web/src/admin/Admin.tsx`) gets a Rename beside each
   person, with the household's history (`Directory.history`) showing the
   rename as its own line.
8. Amend `docs/00-ANALYSIS.md` §7: the id is permanent, the shown name is not,
   and why the record is in the directory.

## Done when

1. A directory test: a rename appends one `person_names` record, and `UPDATE`,
   `DELETE` and `INSERT OR REPLACE` against it are each refused by the schema.
2. A directory test: renaming to a name another person of the household is
   shown under, or to another person's id, is refused; the same name in a
   different household is accepted.
3. An API test: after `bruno` is renamed `Bruno`, `GET /api/people` answers
   `people` unchanged and `names.bruno === "Bruno"`, and a rule, a
   classification and a salary stored before the rename read back with
   `bruno` as their person id.
4. `api/test/authority.test.ts` walks the new route as every identity that
   must be refused — a member included — and `api/test/route-limits.test.ts`
   finds its limiter.
5. An API test: renaming a person no membership has named answers
   `PERSON_NOT_FOUND`.
6. A web test: the salaries screen and the admin screen print the shown name
   after a rename, not the id.
7. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-17 — Filed from the owner's request to edit household members, after
  a local setup where `bruno` had to be wiped and recreated as `Bruno`. The
  owner chose three tickets (this, lg-34, lg-35), admin only. lg-31 is skipped
  on purpose: lg-30's Log calls it "held elsewhere" and no file or branch holds
  it, so it is left alone rather than reused.
