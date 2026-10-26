---
id: lg-71
tool: ledger
title: A new household is created by adding its first person, under a generated UUID and the name "Home"
kind: work-package
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-25 · `53bb5d0f..fb78e9a5` (the merge-base is the dispatch's base, `53bb5d0f`) · Sonnet 5.5, depth full

| Done when                                                                                                                      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/households` with `{ address, person }` creates a household named "Home", id a UUID, one member                | `api/test/households.test.ts` › "creates a household, adds its members, and they sign in to empty books of their own" ✓ — asserts the id matches the v4 shape and the answer is the household "Home" holding robin as its one member; `api/test/households.test.ts` › "gets a new UUID each time, and two of them are both Home"                                                                                                                                                                                                                         |
| A refused first address leaves no household behind                                                                             | `api/test/households.test.ts` › "is refused, and nothing is made, when the first address cannot be added" ✓ (directory snapshot equal, 2 households); `api/test/directory.test.ts` › "createHousehold leaves no household behind when the first address is refused"; `api/test/household-command.test.ts` › "makes no household when the first address is refused". All three go red with the household insert planted outside the transaction                                                                                                           |
| The host command's `add <address> <person>` does the same and prints the UUID                                                  | `api/test/household-command.test.ts` › "creates a household by adding its first person, named Home under a UUID it prints" ✓ — asserts the printed `Created the household <id>, "Home", with <address> as alex.` and the stored row                                                                                                                                                                                                                                                                                                                      |
| A legacy word id still loads its books, serves its routes and keeps its rate-limit bucket                                      | **proven** by the existing suites: the ledger project is 81 files, 1,701 tests, all green at this head; only seven api test files changed, none of them the route, books-isolation or `api/test/route-limits.test.ts` suites; `rate-limit.ts` changed in comments only. Measured as well: `home:alex` is limited on the 4th read at a limit of 3                                                                                                                                                                                                         |
| Admin form has Email and Person, no Id or Name; no screen labels an address field "Address"; admin passes `e2e/layout.spec.ts` | `web/test/admin.test.tsx` › "asks a new household for its first person's email and name, and for no id or name" ✓ (labels `toEqual` `["Email", "Person"]`, no Id or Name); › "labels no address field Address, the change-address form included" ✓ (companion: exactly 3 "Email" labels); `web/test/household.test.tsx` › "labels no address field Address" ✓ (companion: contains "Email"). My enumeration of `web/src` finds the same. e2e: CI `e2e` of ledger.yml succeeded on this head (run 40245252055) and 12 of 12 locally at 360 px and 1280 px |
| `npm run check` and `npm test -- --project ledger` pass                                                                        | **verified** — my runs: `npm run check` exit 0; `npm test -- --project ledger` 81 files, 1,701 of 1,701. CI on this head: `check`, `test (ubuntu-latest)` and the informational Windows leg all green                                                                                                                                                                                                                                                                                                                                                    |

- **med** · no `Done when` line depends on it · `.github/workflows/ledger.yml`, step "The household command runs inside the image, and a household gets its books", still runs the old verb shape (`household add ci "CI household"`, `member ci …`, `test -f /data/households/ci.db`). With `add <email> <person>` it fails on its first line, so the `docker` check of the ledger workflow is red on `fb78e9a5` (run 40245252055, job 121325334058: "That is not an email address."). The workflow ran green on `main` at `f69e9b2c`. The same check will be red on `main` after the merge. The build's Log lists the stale users of the old shape and omits this one. Direction (not run, no docker here): take the UUID from `add`'s printed line and use it for the later steps.
- **low** · `nfr:maintainability` · the old `add <household> <display name>` recipe survives in two more shipped places besides `tools/ledger/CLAUDE.md` (which the owner already chose to fix at landing): `docs/02-DEPLOYMENT.md` (the production recovery block, and "A household id is one lowercase word") and `tools/ledger/.env.example` (the `DEV_IDENTITY` comment). False in the safe direction: a reader gets the command's usage text and exit 2.
- **low** · `tools/ledger/playwright.config.ts` still says `e2e:ledger:serve` makes alex "a member of the household `home`"; the household is now "Home" under a generated UUID. Safe direction; nothing relies on it. No live call site.
- **dropped** · migration 7's CHECK accepts any lowercase 8-4-4-4-12 hex (nil UUID, version-1 shape) where `isHouseholdId` accepts version-4 only. The directory's header says the schema checks less than the code, and only a raw SQL writer can store one.
- **dropped** · two households with the same people get the same card heading ("Home: alex"). The brief says to tell cards apart by their members; the cards differ by email. No live call site.
- **dropped** · rolling back to an image older than lg-71 after a UUID household exists makes the old `isHouseholdId` refuse it. Inherent in the owner's UUID decision, not a defect of this diff.
- **findings** · the hunt returned 6; 3 carried, 3 dropped. The two items the owner already settled (the `CLAUDE.md` dev recipe; `ADDRESS_ALREADY_A_MEMBER` naming the id) are not graded.
- **CI** · `gh pr checks 669` and `gh pr view 669 --json statusCheckRollup` at `fb78e9a5`: every check green except `docker` of ledger.yml. The verdict depends on that one check going green on a head that fixes the step above; nothing else on this head is pending.
- NFR: security ✓ (only an admin creates; a UUID cannot leave `households/`) · performance n/a · reliability — above (CI) · maintainability — above.

### Gate 2

**Gate: PASS** — 2026-10-26 · `fb78e9a5..bd9972ac` (the round: `0d002845`, `94a6119f`, `bd9972ac`; base `53bb5d0f`) · Sonnet 5.5, depth narrow

| Done when                                                                | Proof                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 to 4 (create route, refused first address, host `add`, legacy word id) | stands from Gate 1. The round touched no code a Done when test reads: one workflow step, four comments and docs, two ticket files. `tools/ledger/playwright.config.ts` changed by comment lines only |
| 5 · admin form, no "Address" label, `e2e/layout.spec.ts`                 | stands from Gate 1; CI `e2e` of ledger.yml SUCCESS on `bd9972ac` (run 40247237415)                                                                                                                   |
| 6 · `npm run check` and `npm test -- --project ledger`                   | CI `check` and `test (ubuntu-latest)` SUCCESS on `bd9972ac`. Not re-run locally (the round cannot reach either)                                                                                      |

- **fixed** · Gate 1's **med** (the `docker` step of ledger.yml ran the old verb shape). The step's text was run verbatim against the built CLI, with `docker` and `curl` stood in by scripts that run the same CLI on a scratch data dir: real output, exit 0, every later command names the printed UUID, and the closing `test -f "/data/households/$id.db"` passes; an `add` that prints nothing, an `add` that prints a one-word id, and an `add` refused (address taken) each exit 1. CI: the `docker` check of ledger.yml is SUCCESS on `bd9972ac`, and its step "The household command runs inside the image, and a household gets its books" is `success` (it was red on `fb78e9a5`).
- **fixed** · Gate 1's **low** (the old `add <household> <display name>` recipe in `docs/02-DEPLOYMENT.md` and `tools/ledger/.env.example`). Both now show `add <address> <person>` / `add alex@example.test alex`, and the deployment sentences are true at the head (a household is "Home" under a printed UUID, `member` takes it, `list` prints a UUID and a legacy `home` alike). Ran through `npm run household:ledger` and then `DEV_IDENTITY=alex@example.test` on the API: `/api/me` answers 200 with the UUID household; a non-member `DEV_IDENTITY` is refused at start.
- **fixed** · Gate 1's **low** (`playwright.config.ts` named household `home`). The comment is true: `e2e:ledger:serve` runs `add alex@example.test alex`.
- **owner answer 1, applied as stated** · `tools/ledger/CLAUDE.md` now shows `npm run household:ledger -- add alex@example.test alex` then `DEV_IDENTITY=…`; the sentences around it are still true.
- **owner answer 2, applied as stated** · `lg-77` gains Build 7 (`ADDRESS_ALREADY_A_MEMBER` names the household by its name); the diff is those four lines. Its Done when, frontmatter and Log are unchanged.
- **low** · `nfr:maintainability` · no `Done when` line depends on it · `docs/02-DEPLOYMENT.md`, the recovery paragraph the round rewrote, still says "A household holds two people … a name it has held stays one of its two". A third `member` on the new household was accepted (exit 0), and `directory.ts` says "A household holds any number of names (lg-23)". The sentence pre-dates the round and the README already says "any number"; the round dropped the clause before it and left it standing. False in the safe direction: nobody relies on a cap that does not exist. No live call site.
- **dropped** · the second comment line in `playwright.config.ts` now runs to 115 columns; oxfmt does not wrap comments and `check` is green. Cosmetic.
- **dropped** · `tools/ledger/README.md`'s import example `--household home` is not an old-shape `add` recipe and is valid for a legacy id; the round did not touch it.
- **dropped** · Build 7 of lg-77 names `contract/src/errors.ts` beside `api/src/directory.ts`; the id-bearing message is raised at two sites in `directory.ts`, the contract holds the generic default. Both files are named, so a builder finds both.
- **findings** · the hunt returned 4 new candidates; 1 carried, 3 dropped. Gate 1's three findings are given verdicts above, not counted.
- **CI** · `gh pr view 669` at `bd9972ac`: every check SUCCESS except `test (windows-latest, informational)` (run 40247237333), 1 of 314 files failed: downloader `resolvers/test/browser/browser-resolver-capture.test.ts`, `net::ERR_NO_BUFFER_SPACE` on `page.goto`, in code this diff cannot reach. The latest push reading of that leg on `main` with the matrix run is `f69e9b2c`, success (`53bb5d0f` skipped it). Informational; not a finding against this diff.
- **No `high`; no third gate asked for.**
- NFR: security n/a · performance n/a · reliability ✓ (the image step now fails on a missing id, a failed `add` and a missing books file) · maintainability — above.

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
- 2026-10-25 — Built on branch `lg-71-first-person-create`, off `53bb5d0f`.
  - **What the brief had wrong.** The schema refused a UUID: migration 1's
    `CHECK` on `households.id` takes `[a-z]` only, and Build 2 named
    `directory.ts` alone. A `CHECK` cannot be altered, so directory migration 7
    (`api/src/db/directory-schema.ts`) rebuilds the table with one that takes a
    word or an 8-4-4-4-12 lowercase hex UUID, by the recipe lg-24 measured
    (migration 3's comment): rows copied aside, table dropped and made again,
    rows copied back under `defer_foreign_keys`, then migrations 1 to 3's four
    triggers made again. Four existing assertions of the directory's
    `user_version` moved from 6 to 7 (`directory.test.ts` three,
    `person-names.test.ts` one); nothing else in them changed. Second: the
    e2e server's script (`e2e:ledger:serve`, root `package.json`), both
    READMEs and the ledger `CLAUDE.md` made the dev household with
    `add home "Test household"` then `member home …`. The script now runs
    `add alex@example.test alex`, and the layout spec's seed adds sam through
    `POST /api/households/:id/members` as alex, since the script cannot name a
    UUID to a second command. `CLAUDE.md`'s two-line dev recipe is left stale
    on purpose: a tool's `CLAUDE.md` is edited only when the Build names it,
    so the replacement line goes to the owner through the orchestrator.
  - **Build 6, how two "Home" cards are told apart.** The card's heading is the
    household's name and the shown names of **everyone it has named**, a member
    who has left included (`AdminHousehold.people`): "Home: alex and sam",
    joined by `Intl.ListFormat`, and the People list's label follows it. Why
    people and not the current members: a name stays in a household's books
    once there, so the list only grows and a card keeps its label as emails
    come and go, and a household whose every email was removed still has one.
    A household that has named nobody, which only one made before lg-71 can be,
    is labelled `{name} ({id})`, since nothing else tells it apart. The UUID is
    shown nowhere else.
  - **The response** is `CreateHouseholdResponse`, an alias of `AdminHousehold`:
    the household holding its first member, so the admin screen inserts the
    card where the list would put it (by id) and asks for nothing again.
  - **Email, not Address**: the member form's label, the change-address label
    ("New email for …"), the admin's "Emails to admit" card, its sentence and
    its empty line, `ACCESS_POLICY_NOTE`, the removal and retirement hints, the
    form's own refusal sentence, and `NoHousehold`'s sentence. Server: the three
    contract messages that said "That address" (`ADDRESS_ALREADY_A_MEMBER`,
    `MEMBER_NOT_ADDED`, `MEMBER_NOT_FOUND`), and every `directory.ts` sentence a
    person can reach. A guard reached only past the schema ("The address is not
    a string.") and the route's body-shape sentences are left: no person reads
    them. `ADDRESS_ALREADY_A_MEMBER` still names the household's id, so for a
    UUID household the admin reads the UUID there: `households.test.ts`'s
    lg-22 test holds that an admin is told which household holds the email,
    and the card no longer shows an id to match it against. Naming it by its
    people instead is a sentence for lg-77, which gives a household a name.
  - **"No screen labels an address field Address", enumerated.**
    `grep -rn "<label" web/src` finds 61 labels; the three on an email input
    (`type="email"`) are `household/MemberForm.tsx` ("Email", on the Household
    screen and on every Admin card), `admin/Admin.tsx`'s `ChangeAddress`
    ("New email for {address}") and its `NewHousehold` ("Email"). The screens
    are Household and Admin. `web/test/admin.test.tsx`, "labels no address
    field Address, the change-address form included", opens all three on the
    admin screen and finds no label matching `/address/i`;
    `web/test/household.test.tsx`, "labels no address field Address", does the
    same on the Household screen.
  - **Rollback, proved by mutation.** With `createHousehold`'s insert moved out
    of its transaction, three tests fail and the rest of the three files pass
    (`npx vitest run` on `directory.test.ts`, `households.test.ts`,
    `household-command.test.ts`: 3 failed, 124 passed of 127), each a refused
    first address leaving a household behind; restored from `e8d0693c`.
  - **Fold-in.** `NoHousehold`'s "This address" sentence and the `--household`
    refusal in the import and backfill commands ("one lowercase word"), which
    the change made wrong. Not folded: `LEDGER_ADMINS`' "is not an address" in
    `config.ts`, an operator's configuration sentence rather than copy on a
    screen.
  - **Commands.** `npm run check`: exit 0. `E2E_PORT=8171 npm run e2e:ledger`:
    12 passed of 12, Admin at 360 px and 1280 px included; the 360 px
    screenshot shows "Home: alex and sam" over its members and the New
    household card holding Email and Person. `npm test -- --project ledger`:
    1,701 passed of 1,701 in 81 files, once `authority.test.ts`'s admin
    probe of `POST adminHouseholds` sent `{ address, person }` (its first run
    was 1 failed of 1,701, that probe still sending `{ id, name }`).
- 2026-10-25 — Round 1, after gate 1 (head `fb78e9a5`), by the fixer.
  - **Gate 1's med, fixed in `0d002845`.** `.github/workflows/ledger.yml`'s step
    "The household command runs inside the image, and a household gets its
    books" still ran `household add ci "CI household"`, which fails on its
    first line with "That is not an email address." (run 40245252055). The
    owner chose a fix in a round (2026-10-25). The step now runs
    `household add ci@example.test ci | tee /tmp/add.txt`, takes the UUID from
    the `Created the household` line with `grep -oE` on an 8-4-4-4-12 lowercase
    hex pattern, fails with "add printed no household id" if it finds none,
    names that id in `member`, and asserts `test -f "/data/households/$id.db"`.
    The parse was run on the command's real output from the built
    `household-ledger.js` (a UUID found) and on lines naming a one-word id and
    on empty input (nothing found, so the step would exit 1); docker was not
    available here, so the job itself is read from the pull request's checks.
  - **Gate 1's two lows, fixed in `94a6119f`.** `docs/02-DEPLOYMENT.md`'s
    recovery block now shows `add <address> <person>` and says the household
    is named "Home" under a generated UUID the command prints, that `member`
    takes that id, and that an older household keeps its one-word id.
    `tools/ledger/.env.example`'s `DEV_IDENTITY` comment shows the one-line
    `add alex@example.test alex`. `tools/ledger/playwright.config.ts`'s comment
    no longer says household `home`.
  - **`tools/ledger/CLAUDE.md`'s dev recipe, fixed in `94a6119f`, on the
    owner's answer of 2026-10-25.** Asked, because the Build entry above left
    the recipe stale on purpose, whether to fix it in lg-71's PR (the
    recommendation), have the owner edit it, or file a ticket; the owner chose
    **fix in lg-71's PR**. The two lines `add home "Test household"` and
    `member home alex@example.test alex` became
    `npm run household:ledger -- add alex@example.test alex`; no adjacent
    sentence in that file said anything the change made false.
  - **`ADDRESS_ALREADY_A_MEMBER` names the household by id, on the owner's
    answer of 2026-10-25.** Asked, because for a new household that id is a UUID,
    whether to leave it until lg-77 (the builder's recommendation) or change it
    now; the owner chose **leave until lg-77**. Nothing changed here; lg-77's
    Build 7 carries the line.
- 2026-10-26 — Fixed at landing by owner choice: gate 2, the low — "`docs/02-DEPLOYMENT.md`,
  the recovery paragraph the round rewrote, still says 'A household holds two
  people … a name it has held stays one of its two'. It is false at the head."
  The sentence now reads "A household holds any number of people, each behind
  any number of addresses", as `directory.ts` and the README state it.
  `git diff bd9972ac HEAD -- docs/02-DEPLOYMENT.md | grep -c '^-.*A household holds two people, each'`
  → `1`.
