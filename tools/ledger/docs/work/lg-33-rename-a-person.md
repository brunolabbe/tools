---
id: lg-33
tool: ledger
title: An admin renames a person, and the books keep the id
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-18 · `029641b4..a151ea9a` (the head merges `origin/main` at `45856244`; the branch's own diff is `45856244..a151ea9a`, 46 files) · Sonnet 5.5, depth full

| Done when                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A rename appends one `person_names` record; `UPDATE`, `DELETE`, `INSERT OR REPLACE` are each refused                                          | `api/test/person-names.test.ts` › "appends one record, keeps the id, and the latest record is how the person is shown" (three renames, three rename records) and › "the schema keeps every record: an UPDATE, a DELETE and an INSERT OR REPLACE are each refused" (asserts the `appended, never` message, one row before, the same row after) ✓. Also run on a real file built at the base and migrated: `UPDATE`, `DELETE`, `INSERT OR REPLACE`, `REPLACE INTO`, `OR IGNORE`, an upsert, `OR ROLLBACK`, `OR FAIL` and `recursive_triggers = ON` all refused, 0 rows changed, a plain insert allowed as control |
| 2. A name another person is shown under, or another person's id, is refused; the same name in another household is accepted                      | `api/test/person-names.test.ts` › "renaming to a name another person is shown under, or to another person's id, is refused" (class and schema) and › "the same name in a different household is accepted" ✓. Same on the real file, both directions                                                                                                                                                                                                                                                                                                                                                             |
| 3. After `bruno` → `Bruno`, `people` unchanged, `names.bruno === "Bruno"`, a rule, a classification and a salary stored before read back `bruno` | `api/test/rename-person.test.ts` › "and GET /api/people keeps the ids, shows the name, and the books still read bruno" ✓. Over files, every books table identical before and after the rename                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4. `authority.test.ts` walks the route as every identity that must be refused; `route-limits.test.ts` finds its limiter                          | `api/test/authority.test.ts` › "has a request for every admin and household route…" (6 routes), › "every admin route refuses a member who is no admin, and changes nothing" (probe and malformed twin), › "control: an admin in no household is answered by POST adminPersonRename"; `api/test/route-limits.test.ts` › "adminPersonRename refuses the second request in a minute, as RATE_LIMITED" ✓. Guard removed: both red (2 failed of 80)                                                                                                                                                                  |
| 5. A person no membership has named answers `PERSON_NOT_FOUND`                                                                                   | `api/test/rename-person.test.ts` › "for a person no membership has named, as PERSON_NOT_FOUND, and nothing changes" (a books-only `casey`) ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6. Salaries and admin screens print the shown name after a rename                                                                                | `web/test/salaries.test.tsx` › "prints a person's shown name after a rename, never the id, and sends the id" and `web/test/admin.test.tsx` › "renames a person, and prints the shown name after the rename, not the id" ✓. Each goes red when its screen prints the id (1 of 8, 1 of 6)                                                                                                                                                                                                                                                                                                                         |
| 7. `npm run check` and `npm test -- --project ledger` pass                                                                                       | **verified** — `npm run check` exit 0; ledger project exit 0, 1271 of 1271 in 64 files; PR #541 checks all green at `a151ea9a` (both `check`, `docker`, `codeql`, `CodeQL`, `test (ubuntu-latest)`, `test (windows-latest, informational)`)                                                                                                                                                                                                                                                                                                                                                                     |

- **F1 · med** · no `Done when` line depends on it · the periods screen still prints a raw id. `LineForm` confirms a charge with the id (`Charged to alex.`), where Build 5 names periods in the list of screens that print through the helper; its existing test asserts the id with no names provider, so it cannot see it. Direction: print `other` through `shownName(names, …)` like the two lines beside it; applied in my tree it clears the hit and `periods.test.tsx` stays 16 of 16.
- **F2 · med** · no `Done when` line depends on it · `Directory.history` now orders by `at, kind, id`, so `GET /api/households/:id` answers a different order than the base for membership-only data when a clock stepped back (base: `add@12:00, remove@11:59`; head: `remove@11:59, add@12:00`). Migration 1 chose id order on purpose ("rather than by a timestamp two writers could tie"). Direction: merge the two id-ordered lists by time without re-sorting inside a table.
- **F3 · med** · no `Done when` line depends on it · **open decision** · two people can still be shown alike through the route: the books hold `casey` only from migration 3, the directory never named them, and renaming `bruno` to `casey` answers 200 with `names {bruno: casey, casey: casey}`. Build 2's "held" and Done when 2 are met; the Log discloses it ("Not covered"), but the failure the brief names stays reachable. Options and recommendation in the full report.
- **F4 · low** · **open decision** · Build 7 asks the admin screen for the household's history showing the rename; the admin listing carries none, so only a member's household screen shows the rename line, and an admin in no household never sees it. Disclosed in the Log, left to the owner.
- **F5 · low** · **open decision** · `Directory.heldPeople` lets a member who has left be renamed, where Build 3 points at `Directory.people` (who stands now). It matches Done when 5, Build 2's "held" and the analysis ("a name stays in the books"); the admin screen cannot offer such a person.
- **F6 · low** · the folded-in `addMember` refusal (`PERSON_NAME_TAKEN` for a new id equal to a shown name) has no HTTP-level test, only the class and the schema; its sentence says "Pick them from the list" where the admin screen's list holds current members only.
- **F7 · low** · the Log states two things the diff contradicts: "four other suites' `{ people }` expectations became `toMatchObject`" (three: `books`, `directory-identity`, `rules`) and the three extra contract types "each forced" (`RenamePersonRequest` and `PersonName` follow convention; the compiler forces neither). Nothing relies on either.
- **dropped** · `addMember`'s new refusal as a change to an answer that worked at the base: 0 of 22,000 random writes differ from the base while no rename exists (the harness sees the divergence once one does).
- **dropped** · migration 5 loses or blocks a row: a real file built at the base keeps every row, every view result and every object, and gains the new ones only.
- **dropped** · a stranger or a non-admin reaching the route, or a trigger variant slipping past: every probe answered 403; every write variant refused.
- **dropped** · names with an embedded newline or look-alike letters are accepted (exact-text uniqueness, admin only, the Log says exact text): a product decision, no live call site.
- **dropped** · `addMember`'s `PERSON_NAME_TAKEN` as a new oracle on which addresses are taken: it is raised only after the taken-address check, and the owner accepted that oracle on 2026-10-13.
- **findings** · the hunt returned 12; 7 carried, 5 dropped.
- NFR: security ✓ (hook and handler guard, per-admin limiter, strict body, planted failure caught) · performance ✓ (one directory read per `GET /api/people`, one extra read per tab change against a 120 a minute bucket) · reliability — F2, F3 · maintainability — nothing enforces "never print the id", F1 is the first miss (low).

## Log

- 2026-10-17 — Filed from the owner's request to edit household members, after
  a local setup where `bruno` had to be wiped and recreated as `Bruno`. The
  owner chose three tickets (this, lg-34, lg-35), admin only. lg-31 is skipped
  on purpose: lg-30's Log calls it "held elsewhere" and no file or branch holds
  it, so it is left alone rather than reused.
- 2026-10-18 — Built (builder, base `029641b4`). Directory migration 5
  (`person_names`, `current_person_names`, the held, unique and append-only
  triggers), `Directory.renamePerson`, `names` and `heldPeople`,
  `POST /api/admin/households/:id/people/rename` (`adminWrite`, `adminOf` again
  in the handler), `PERSON_NOT_FOUND` 404 and `PERSON_NAME_TAKEN` 409,
  `PeopleResponse.names`, `HouseholdMember.name`, and `web/src/people.tsx`:
  `shownName` over the map the shell fetches from `GET /api/people` on every
  change of tab, used by home, salaries, periods (lines, recurring, settlement,
  deposits), rules, inbox and auto-filed, receipts, stats (own money,
  contributions, salaries and ratio, settlements, card lines), household and
  admin. A chart's colour still comes from the id's place in the list. The
  admin screen lists each household's people with a Rename beside each.
  Measured: `npm test -- --project ledger` 1271 of 1271 in 64 files;
  `npm run check` exit 0. The new salaries spec run against the base's
  `Salaries.tsx` in a second tree, with only `people.tsx` copied in, fails
  1 of 8 (the new test, "Unable to find … Ratio in effect: Alex 60.0000 %"):
  the auto-mode classifier refused a source mutation in this tree, so that
  replaced the red step.
  - **What the brief had wrong.** Build 3 points at `Directory.people`, which
    is who stands _now_; "a person the directory has held" and Done when 5's
    "no membership has named" are ever-named, so the check is the new
    `Directory.heldPeople` (every person a membership record of the household
    names), and a member who has left can be renamed. Build 7's admin screen
    shows no history, and the admin listing carries none: the rename is its own
    line in `Directory.history`, so `HouseholdResponse.history` and the member's
    household screen show it ("alex renamed Alex, by …"); the admin screen does
    not. Showing it there needs `history` on `AdminHousehold`, left to the
    owner. The contract moved by three types more than Build 4 names: one
    forced, `PersonNameRecord` in `HouseholdResponse.history` (the rename line),
    and two by the contract's convention rather than the compiler,
    `RenamePersonRequest` (the schema's type, as every request schema has one)
    and `PersonName` (the route's answer, as every route's body is typed).
  - **Folded in.** The reverse of Build 2's rule: a new person id equal to a
    name another person is shown under is refused, by `addMember`
    (`PERSON_NAME_TAKEN`) and by a trigger in migration 5, since adding
    `Bruno` beside `bruno` shown as `Bruno` is the same two-alike failure. The
    member form maps a typed shown name back to its id, so picking an existing
    person never meets it. The header of `contract/src/errors.ts` said "five"
    directory codes, stale since lg-23 dropped `HOUSEHOLD_FULL`; it says four.
  - **Changed beside it.** lg-30's API test "GET /api/people still answers the
    one key, people" now expects `people` and `names` and is renamed for it;
    three other suites' exact `{ people }` expectations (`books`,
    `directory-identity`, `rules`) became `toMatchObject`.
  - **Not covered.** Uniqueness is exact text, as person ids are (`bruno` and
    `Bruno` were already two ids). An id the books hold only from migration 3
    is not in the directory, so a shown name is not checked against it: the
    admin route reads no books. (Round 1, F3: `GET /api/people` now shows both
    such people under their ids.) `household:ledger list` still prints ids, which
    is what its `member` command takes.
- 2026-10-18 — Round 1, on gate 1's findings at `029641b4..a151ea9a`
  (CONCERNS, nothing high). Each fix's test failed at a151ea9a and passes
  after it.
  - **F1, fixed.** The period line form confirmed a charge with the id
    (`Charged to alex.`). It now prints the shown name. `web/test/periods.test.tsx`
    › "a charge to a renamed person is confirmed under their shown name, and
    sends the id (lg-33)": 1 failed of 17 before ("Unable to find … Charged to
    Alex."), 17 of 17 after.
  - **F2, fixed.** `Directory.history` sorted the union by `at`, so a clock that
    stepped back reordered two memberships (`remove@11:59, add@12:00`). Each
    table is now read in its own id order and the two lists are merged by time
    without re-sorting either. `api/test/person-names.test.ts` › "the history
    with renames in it › keeps each table's records in the order they were
    written, a clock that stepped back included": before, it received
    `remove@11:59, add@12:00, …`; after, it passes. The gate's
    `history-order.mts` on this tree now prints `add@12:00 , remove@11:59`.
  - **F3, fixed by the owner's choice.** A rename could take an id the books
    hold only from migration 3, and `GET /api/people` answered
    `{bruno: casey, casey: casey}`. The question: two people can still be shown
    alike through a books-only id; what should be done? Options: (1) accept and
    write it down; (2) `GET /api/people`, which has the books, falls back to
    the id for any name two of its `people` would share, with no contract
    change; (3) let the rename route read the books. **The owner chose 2** on
    2026-10-18. The gate recommended 2 if any real household holds a
    books-only id, and 1 otherwise. `distinctNames` in `api/src/routes/rules.ts`
    does it. `api/test/rename-person.test.ts` › "the people answer never shows
    two people alike › a shown name that is a books-only id falls back to the
    id, for both": before, it received `bruno: "casey"`; after, it passes. The
    directory's own listings (admin, household) still show bruno as `casey`,
    since no books-only person is listed there.
  - **F4, owner's answer, no code.** The question: should the rename line also
    show on the admin screen? Options: (a) keep it on the household screen only,
    with nothing added to `AdminHousehold`; (b) add `history` to
    `AdminHousehold` and render it on the admin card. **The owner chose (a)**
    on 2026-10-18, as the builder and the gate both recommended.
  - **F5, owner's answer, no code.** The question: Build 3 points at
    `Directory.people`, who stands now; should renaming be limited to that?
    Options: keep `heldPeople` (ever-named), or limit renames to current
    members. **The owner chose to keep `heldPeople`** on 2026-10-18, as the
    builder and the gate both recommended.
  - **F6, recorded, not fixed.** `addMember`'s `PERSON_NAME_TAKEN` branch has
    no HTTP-level test, and its "Pick them from the list" reads oddly where the
    admin's datalist holds current members only.
  - **F7, fixed in place.** Two statements in the entry above were corrected
    where they stand: three suites, not four; and of the three extra contract
    types, one is forced and two follow the contract's convention.
