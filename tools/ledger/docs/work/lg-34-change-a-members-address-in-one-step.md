---
id: lg-34
tool: ledger
title: An admin changes a member's address in one step
kind: work-package
status: done
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

## Review

**Gate: PASS** — 2026-10-18 · `b16d4489..372ea89e` · Opus 5.5, depth standard

| Done when                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `changeAddress` leaves `to` under the same person, `from` in no household, history remove then add                                | `api/test/directory.test.ts` › "changing a member's address" › "leaves the new address standing under the same person, the old in no household, and records remove then add" ✓ — `membershipOf(SAM)` undefined, `membershipOf(CASEY)` is sam in home, `history("home").slice(-2)` is remove then add                                                                                                                                                                     |
| 2. `to` in another household is refused and `current_members` is unchanged                                                           | `api/test/directory.test.ts` › "with the new address in another household is refused, and the old one still stands" ✓ — `members()` (read from `current_members`) equal before and after. The rollback past the class's own checks is "rolls the remove back when the add fails after it, past every check the class makes", which goes red (1 of 61) with the transaction replaced by bare calls                                                                        |
| 3. The authority sweep walks the new route as every identity that must be refused, a member included; route-limits finds its limiter | `api/test/authority.test.ts` › "every admin route" › "refuses a member who is no admin, and changes nothing" ✓ (the `adminMemberAddress` probe; red, 1 of 15, with the route's `adminWrite` and `adminOf` taken off) and "every route" › "refuses an address Access admits that is neither member nor admin" ✓; `api/test/route-limits.test.ts` › "adminMemberAddress refuses the second request in a minute, as RATE_LIMITED" ✓ (red, 1 of 67, under the same mutation) |
| 4. A web edit sends one request and lists the new address under the same person                                                      | `web/test/admin.test.tsx` › "edits a member's address in one request, and lists the new address under the same person" ✓ — `adminChangeAddress` called once with `{ from, to }`, `adminRemoveMember` and `adminAddMember` never; red against the base's `Admin.tsx`, without the Access note, and with a second request added                                                                                                                                            |
| 5. `npm run check` and `npm test -- --project ledger` pass                                                                           | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 1299 of 1299 in 65 files, exit 0. PR #546's checks all pass on `372ea89e`                                                                                                                                                                                                                                                                                                                          |

- **low** · no `Done when` line depends on it · `nfr:reliability` — `readAddress` in `api/src/directory.ts` accepts a NUL byte, so `POST …/members/address` with `to: "a@b\u0000c"` answers 200 and moves sam onto an address no Access token can carry: an existing member is locked out until an admin changes it back. Older than this branch: `addMember` and the host command go through the same `readAddress` (by reading, not run at the base). lg-34 makes it reachable against an address that works today. Graded `low` because only an admin can send it, and only in a hand-built request: the web input is `type="email"`. Direction: refuse control characters in `ADDRESS`, for every writer.
- **low** · no `Done when` line depends on it · `nfr:maintainability` — nothing pins `changeAddress`'s `.immediate()`. Changed to `.deferred()`, `directory.test.ts` and `change-address.test.ts` stay green (67 of 67). Under a second connection holding the write lock, the route then answers 500 at once instead of waiting and answering 409 `ADDRESS_ALREADY_A_MEMBER`. `current_members` is unchanged either way, so the cost is the answer the admin gets, not data.
- **dropped** · lg-33's migration-5 triggers as a way to make the add fail after the remove. The add's person is `from`'s, so the person is always one the household has held, and `memberships_person_not_shown_as_another` cannot fire. Measured: a `to` equal to another person's shown name, and one equal to another person's id, both answered 200.
- **dropped** · history order across renames when the clock steps back: a change timed 12:05 and written after a rename timed 12:14 is listed before that rename. That is `Directory.history`'s merge by time, lg-33's work and outside this range. A change's remove and add are never split by a rename: they share one instant, and at the same instant a membership is listed first.
- **dropped** · a request with no identity is not swept route by route. The identity hook in `api/src/identity.ts` runs for the whole app, and the probe answered 403 `UNAUTHENTICATED` with nothing changed. Older than this branch.
- **dropped** · the two refusal choices as open decisions. Build step 2 names both: `MEMBER_NOT_FOUND` for "a `from` not in this household" and `ADDRESS_ALREADY_A_MEMBER` for "a `to` in any household". The Log's "Decision recorded, not asked" overstates a choice the brief had already made, and nothing relies on that wording.
- **findings** · the hunt returned 6; 2 carried, 4 dropped.
- NFR: security ✓ (admin-only `onRequest` guard asked again in the handler, limiter, member refused) · performance n/a · reliability ✓ (one immediate transaction; a concurrent writer is waited for and its address refused) and the first low above · maintainability: the second low above.

## Log

- 2026-10-17 — Filed with lg-33 and lg-35 from the owner's request to edit
  household members. Independent of both in schema: it adds no migration. (Not
  in files: see the 2026-10-18 entry.)
- 2026-10-18 — Built (builder, stacked on lg-33's branch at `b16d4489`, because
  of the files below). `Directory.changeAddress` (one immediate transaction:
  `remove` of `from`, then `add` of `to` under the same person), the contract's
  `adminMemberAddress` route and `changeAddressRequestSchema`,
  `POST /api/admin/households/:id/members/address` (`adminWrite`, `adminOf`
  asked again, `namedHousehold`), `adminChangeAddress` in the web client, and an
  Edit beside each member's Remove in `Admin.tsx` that opens the address in place
  with the Access policy note. Refusals reuse `MEMBER_NOT_FOUND` (a `from` that
  stands in no household, or in another one), `ADDRESS_ALREADY_A_MEMBER`,
  `HOUSEHOLD_NOT_FOUND` and `BAD_REQUEST` (a `to` equal to `from`, compared
  after lower-casing and trimming, or not an address).
  Measured: `npm test -- --project ledger` 1299 of 1299 in 65 files (lg-33's tip
  is 1271 in 64); `npx oxlint tools/ledger` exit 0.
  - **Red/green.** With `changeAddress`'s transaction replaced by a bare call,
    `directory.test.ts` fails 1 of 61, "rolls the remove back when the add fails
    after it, past every check the class makes". With the new route's
    `adminWrite` and `adminOf` taken off, `authority.test.ts` fails 2 of 15
    ("control: an admin in no household is answered by POST adminMemberAddress",
    "refuses a member who is no admin, and changes nothing") and
    `route-limits.test.ts` 1 of 67 ("adminMemberAddress refuses the second
    request in a minute, as RATE_LIMITED"). Both mutations were committed over
    and restored from the commit. The web test was not run against the base's
    `Admin.tsx`: the base has no Edit button, so it cannot find one.
  - **What the brief had wrong.** Its Log said the ticket is "independent, can be
    built alongside" lg-33. That holds for schema and migrations and not for
    files: the two share `api/src/directory.ts`, `api/src/routes/households.ts`,
    the contract's `api.ts`, `web/src/admin/Admin.tsx`,
    `api/test/authority.test.ts` and `api/test/route-limits.test.ts` (here
    through `api/test/helpers/routes.ts`'s `VERBS`, which it reads). Built
    alongside lg-33 they conflict in all six; this one is stacked on it.
    `authority.test.ts`' "has a request for every admin and household route"
    counts the routes (6 became 7) and `isolation.test.ts` lists the admin POSTs
    it does not sweep, so each gained a line too.
  - **Decision recorded, not asked.** A `from` in another household is
    `MEMBER_NOT_FOUND`, as `removeMember` with a `household` does, so a stale
    screen cannot move an address out of a household it has left. A `to` already
    in this household is `ADDRESS_ALREADY_A_MEMBER`, not a no-op.
  - **Folded in:** nothing. No other already-specified piece became free.
