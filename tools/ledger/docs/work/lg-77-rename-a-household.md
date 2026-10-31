---
id: lg-77
tool: ledger
title: A household's members and the admin can rename it
kind: work-package
status: done
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

## Review

**Gate: PASS** — 2026-10-31 · `c7bdef21..a87da359` (the merge-base is the base itself) · Sonnet 5.5, depth full

| Done when                                                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member renames their own household and the admin renames any, each proved in `api/test/households.test.ts`; a member of another household and a caller who is neither get the same 403 | `api/test/households.test.ts` › "a household renamed (lg-77)" › "by a member of it, signed with their address, and every listing shows the new name" ✓, › "by an admin, any household, signed with the admin's address" ✓, › "is refused to a member of another household and to a caller who is neither, with the same 403" ✓ (asserts 403 and `FORBIDDEN` for a member of another household, an admin on the member route, a member on the admin route and a signed-in stranger). Byte-identity, which that test does not assert, measured by my own probe: 6 identities × 6 URLs × 3 bodies = 108 requests; all 69 `FORBIDDEN` answers are one body, the same one the existing members route gives, and the no-identity answer is `UNAUTHENTICATED` as everywhere. **Proven**, byte-identity **verified**                                        |
| A rename is a `household_names` row, never an update of `households`, proved by a test that the `households` row is unchanged                                                            | `api/test/households.test.ts` › "a household renamed (lg-77)" › "is a household_names row, and the households row is as it was made" ✓ (`SELECT * FROM households` equal before and after a member's and an admin's rename; both `household_names` rows read back). `api/test/household-names.test.ts` › "the schema keeps every record and the households row: an UPDATE, a DELETE and a REPLACE are each refused" ✓. Also run by me on a populated v8 file after migration 9: `UPDATE households` (all rows, and one row) refused with "a household is appended, never edited". **Proven**                                                                                                                                                                                                                                                        |
| The household's history lists the rename with who made it                                                                                                                                | `api/test/households.test.ts` › "by a member of it, signed with their address, and every listing shows the new name" ✓ (`history.at(-1)` has `by` the member's address) and › "by an admin, any household, signed with the admin's address" ✓ (`by` the admin's); `web/test/household.test.tsx` › "titles the page by the household's name, and a member renames it there" ✓ (the line "Household renamed Our place, by sam@example.test"). **Proven**                                                                                                                                                                                                                                                                                                                                                                                              |
| The household page and the admin card show the current name and rename it, proved by web tests; `e2e/layout.spec.ts` passes                                                              | `web/test/household.test.tsx` › "titles the page by the household's name, and a member renames it there" ✓ and › "a refused rename keeps the field open with the server's sentence, and an empty one sends nothing" ✓; `web/test/admin.test.tsx` › "renames a household from its card, the field opening on its name alone" ✓ and › "a refused household rename shows the server's sentence on its card, and Cancel closes it" ✓. `e2e/layout.spec.ts`: **verified from a local run**, not a scratch merge of lg-81 — `E2E_PORT=18577` and `RATE_LIMIT_READS_PER_MINUTE=0` exported in the shell, `npm run e2e:ledger`: 17 passed of 17, no "rate limited" line in the server log, including the three new cases. CI's `e2e` on this head is red (run 41223738914, reads limit, as the owner settled); the lander reads it once lg-81 is on `main`. |
| `npm run check` and `npm test -- --project ledger` pass                                                                                                                                  | **Verified**, both run by me on this head: `npm run check` exit 0; `npm test -- --project ledger` 1965 passed of 1965 in 88 files. CI on this head: `check`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker`, `CodeQL`, `dependency-review` pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **low** · no `Done when` line depends on it · `nfr:reliability` — `Directory.openReadOnly` still hands out a handle whose `households()`, `household()` and `history()` fail with a raw `SqliteError: no such table: current_household_names` (`household_names` for `history`) on a directory at version 8; only the import was moved to `holdsHousehold`. No live call site: the one read-only opener, `directoryPeople` (the import and the spending backfill), reads `households`, `memberships`, `people` and `person_names` only, and `household:ledger list` opens through `Directory.open` and migrates (measured: a populated v8 file, exit 0, version 9, every household listed). Direction, not remedy: `openReadOnly` could refuse a file below the current version with a typed error, or its comment could say which methods need migration 9.
- **low** · no `Done when` line depends on it · `renameHouseholdRequestSchema` counts the untrimmed text (`.max(80)`) where `Directory.renameHousehold`, the rule the brief says to share with `addHousehold`, trims first and counts UTF-16 units. As a member over HTTP, `{name: 80 × "H" + " "}` answers 400 "Send the name to call the household by, 1 to 80 characters." (the Directory would take it as 80 after the trim, read from the code and not run); `41 × "😀"` (41 code points, 82 units) passes the schema and is refused by the Directory with its other sentence, "A household's name is 1 to 80 characters."; `40 × "😀"` answers 200. The refusal runs in the safe direction, and the web trims and caps typing at 80, so only a direct API caller sees it. Same shape as `renamePersonRequestSchema`.
- **low** · no `Done when` line depends on it · `nfr:security` — a household's name takes any character after the trim: ESC, BEL, NUL, a newline, a name that is one U+200B. A member can now set it, and `household:ledger list` prints it raw: as ALEX, a rename to `ESC[2J ESC]0;pwned BEL Home` answers 200 and the `list` output holds the raw ESC byte. The same sink already takes a member-typed person name (`POST /members` with `person` starting with ESC answers 200, and `list` prints the ESC), so this ticket adds a second member-writable field to an existing path and opens none. The admin's taken-address sentence quotes the name too. **Open decision** (two remedies, not a `Done when`): (a) refuse the characters `UNSEEN` already names for addresses, in `renameHousehold` and `addHousehold`, which leaves person names as they are; (b) escape at the sinks, `list` and the sentence. Recommend (a) for household names now and a ticket for person names. Neither was run.
- **dropped** · the member non-disclosure test marks the other household's id (`AWAY`) and not its name, which is what the message now carries. With the member route's `MEMBER_NOT_ADDED` throw mutated to `throw error`, `households.test.ts` › "is told only that an address cannot be added, the same for every reason" went red (1 of 39, through the marks "belongs" and "kim"). The test holds.
- **dropped** · at one instant the history returns membership, person added, person rename, household rename, whatever the write order (written rename, add, rename; returned add, rename, rename). It is deterministic (200 calls on the class and 10 over HTTP identical), stated in `history()` and the Log, and how person renames already merge.
- **dropped** · two households may share a name (accepted on both routes), so the admin's taken-address sentence can name an ambiguous "Home". That is the owner's decision of 2026-10-25 (the name, not the id), and the brief asks for no uniqueness.
- **dropped** · `renameHousehold`'s `HOUSEHOLD_NOT_FOUND` sentence (`There is no household "nowhere".`) differs from the contract default `namedHousehold` gives. It is admin-only and the wording `renamePerson` and `retirePerson` already use.
- **findings** · the hunt returned 7; 3 carried (all low), 4 dropped.
- NFR: security ✓ (low above; a member is never told another household's name, 5 add shapes) · performance ✓ (`household()` 0.08 ms with 2,000 households and 50,000 renames; `households()` 47 ms for all 2,000; no base comparison run) · reliability ✓ (low above; migration 9 on a populated v8 file, and from each of the 8 earlier versions 0 to 7) · maintainability ✓.

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
- 2026-10-31 — Owner answers at landing, each the builder's recommendation.
  - **The rename record carries only the new name, no `from` field.** The
    options were "add `from`", "refuse same-name rename" and "both".
  - **A rename to the current name is accepted and recorded**, as person
    renames are.
  - **Both routes answer `HouseholdSummary`, with the action named
    `"rename-household"`.** The contract shape is approved.
  - **The builder's proposed `tools/ledger/CLAUDE.md` line is left out.** The
    options were "leave out; log it" and "add it in lg-77's PR"; it goes to the
    orchestration log for the review session.
  - **Gate 1's third low (household names take terminal-control characters,
    which `household:ledger list` prints raw) is filed as lg-82**, on the
    owner's choice of "file one ticket" over "record only" and "fix in lg-77
    now"; it covers household and person names. The finding stays in the gate's
    record as written.
  - **CI `e2e` is red at `a87da359`** (run 41223738914) on the reads limit
    alone, as gate 1 verified with a local 17 of 17 run. lg-81 (#687) carries
    the e2e read-limit setting and merges first.
