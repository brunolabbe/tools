---
id: lg-34
tool: ledger
title: An admin changes a member's address in one step
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-34 — An admin changes a member's address in one step

## Why

Changing the address a person signs in with is safe (`docs/00-ANALYSIS.md` §7:
"Changing an address is safe; changing the name it stands under is not"), and
the admin screen can already do it — remove the old address, then add the new
one under the same person. But that is two writes. Between them the person
cannot sign in, and if the add fails (the new address is in another household)
they are left with no address at all. The owner asked on 2026-10-17 for members
to be editable from the admin screen, admin only.

## Build

1. `Directory.changeAddress({ household, from, to, by, at })` in
   `api/src/directory.ts`: **one transaction** that appends the `remove` of
   `from` and the `add` of `to` under the same person, through `#record`. If
   the add is refused, the remove is rolled back with it. No new table and no
   migration: the existing triggers (`memberships_one_household`,
   `memberships_remove_what_stands`) already hold both halves. `to` goes
   through `readAddress`, as `addMember`'s does.
2. The route is the admin's only (owner, 2026-10-17):
   `POST /api/admin/households/:id/members/address`, body `{ from, to }`, with
   `adminWrite` in `onRequest` and `adminOf` asked again in the handler, as in
   `api/src/routes/households.ts`. Add it to `ROUTES` in `contract/src/api.ts`
   and its zod schema beside `removeMemberRequestSchema`; it answers the
   `HouseholdMember` that now stands. Refusals reuse the existing codes:
   `MEMBER_NOT_FOUND` for a `from` not in this household,
   `ADDRESS_ALREADY_A_MEMBER` for a `to` in any household, `HOUSEHOLD_NOT_FOUND`.
   A `to` equal to `from` is a `BAD_REQUEST`.
3. `web/src/admin/Admin.tsx`: an Edit beside each member's Remove, opening the
   address in place. The note about admitting every address on the Access
   policy shows with it, since the new address needs admitting too.
4. The person's books do not change: the person id is the same, so nothing in
   their household's file is touched.

## Done when

1. A directory test: `changeAddress` leaves `to` standing under the same person
   and `from` in no household, and the history holds the two records in that
   order.
2. A directory test: with `to` already in another household, the call is
   refused and `from` still stands — `current_members` is unchanged.
3. `api/test/authority.test.ts` walks the new route as every identity that must
   be refused, a member of the household included, and
   `api/test/route-limits.test.ts` finds its limiter.
4. A web test: editing a member's address on the admin screen sends one request
   and lists the new address under the same person.
5. `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-17 — Filed with lg-33 and lg-35 from the owner's request to edit
  household members. Independent of both: it adds no migration, so it can be
  built alongside either.
