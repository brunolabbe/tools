---
id: lg-76
tool: ledger
title: A new person gets a generated UUID, and the name typed becomes only how they are shown
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: hard
---

# lg-76 — A new person gets a generated UUID

## Why

A person's id is the first name typed into the Person field, and it is permanent:
the books store it on every rule, classification, salary, ratio share and period
line, and `docs/00-ANALYSIS.md` §7 says changing it is not safe. lg-33 already
separates how a person is shown from that id, so a rename never touches the
books; what it cannot do is change the id itself. A typo, a nickname, or a name
the household would rather not see stays underneath, in the books, in the host
command's arguments and in the import's `--as`. lg-71 gives a household a UUID
for the same reason.

## Decision — answered 2026-10-25 by the owner

Asked whether a new person should get a generated UUID as their id, with the
typed name becoming their shown name, with options: yes, as its own ticket; yes,
inside lg-71; no, keep name ids since lg-33 already separates the shown name. The
owner chose **yes, its own ticket**.

Existing people keep their name ids. Moving them would rewrite every record in
the books that names them, which the books' append-only rule forbids; both
shapes stay valid, as household ids do under lg-71. The owner approved the
contract change this makes.

Asked in the same session what a person is called when the Person field is left
empty, with options: from the email; numbered, "Person 1", "Person 2"; keep the
field required. The owner chose **from the email**: the part before the `@`,
suffixed with the lowest free number when the household already shows someone
under it. A person added with no email (lg-74) has nothing to take it from, so
their name stays required.

## Build

1. **Where a person is made** (`api/src/directory.ts`): when `addMember`, and
   lg-71's create, are given a name the household does not hold, they generate
   the person's id with `randomUUID()` from `node:crypto` and record the typed
   name as the person's shown name (`person_names`) in the same transaction, so
   no UUID person ever exists without one; `shownName` falls back to the id, and
   a UUID must never reach a screen. Given a name the household already shows,
   they add the address to that person, as the form already resolves it
   (`web/src/household/MemberForm.tsx`). Let the generator be injected, so
   tests stay deterministic, the way `now` is.
2. **Schema**: read the `person_names` triggers (`person_names_held`,
   `person_names_unique` in `api/src/db/directory-schema.ts`) against a person
   whose id is a UUID and whose first shown name is written in the same
   transaction as their first membership; a new migration only if one refuses
   that. Never edit a shipped migration.
3. **Contract**: the add-member request's `person` is the name typed, matched
   against shown names; a request may still name a legacy id. Say in the Log
   how the request tells the two apart, if it must.
4. **Order**: about a dozen places order people by id — screen lists
   (`web/src/admin/Admin.tsx`, `web/src/household/Household.tsx`,
   `api/src/routes/rules.ts`, `web/src/api/rules.ts`), the stats' series and
   colours (`books/src/stats.ts`), and the odd cent and ratio rounding's tie
   (`books/src/buckets.ts`, `books/src/ratio.ts`, `books/src/split.ts`,
   `books/src/settlement.ts`, `api/src/mortgage-splits.ts`). Lists a person reads
   sort by shown name. The arithmetic's ties keep sorting by id: arbitrary for a
   UUID but fixed, which is what they need, and changing them would move
   amounts already computed for legacy ids. Update the comments that say the tie
   goes to the person "whose id sorts first" only if they become wrong.
5. **Host command and import**: `household-command.ts`'s `member` and
   `import-command.ts`'s `--as` take a shown name and resolve it, still
   accepting a legacy id; `list` prints shown names beside ids.
   The workbook reader resolves a name in the file to a person id by folding it
   against the ids (`People` in `books/src/workbook.ts`): a UUID person would
   never match, and every row naming them would be refused. It resolves against
   shown names too, so the import needs the directory's names beside its
   people (`directoryPeople` in `api/src/import-command.ts`).
6. **A name from the email**: `person` becomes optional in the add-member
   request and in lg-71's create request. Left out, the shown name is the
   address's part before the `@`, cut to the 64 characters a name may hold; when
   another person in the household is shown under it or has it as their id,
   append " 2", " 3", the lowest free. The web form's Person field says it may be
   left empty, and how the person will be shown. Left out with no email (lg-74's
   name-only person), the request is refused.
7. **Rules**: rewrite the ledger `CLAUDE.md` paragraph that says "a person's id
   is that name … so it must stay that name", and §7 of `docs/00-ANALYSIS.md`,
   to say a new person's id is a UUID and a legacy one is the name.

## Done when

- A person added under a new name gets a UUID id and that name as their shown
  name, in one transaction, proved by a test in `api/test/households.test.ts`;
  every component the Log's enumeration lists (each `web/src` component that
  renders a person, found by the grep the Log names) shows the name, proved by a
  web test covering exactly that list that no UUID is rendered.
  - _Superseded 2026-10-26 by the owner's answer below:_ "every screen shows the
    name, proved by a web test that no UUID is rendered."
- Adding an address for an existing person, legacy or UUID, by their shown name
  reuses their id, proved by tests.
- A household with legacy name ids computes the same buckets, ratios and
  settlements as before, proved by the existing suites passing unchanged.
- The host command and the import resolve a shown name, proved by tests.
- A person added with no name is shown under the email's local part, suffixed
  when it is taken, proved by tests, including two addresses sharing a local part
  in one household.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question while lg-71 was re-scoped: "why
  not a UUID for a person, as for a household?" lg-74 waits on it, so a person
  added without an email gets a UUID from the start.
- 2026-10-26 — Owner's answer, relayed by the orchestrator in the build
  dispatch (asked 2026-10-25 at intake). The Done when line "every screen shows
  the name, proved by a web test that no UUID is rendered" named no screens,
  and Build 4 says about a dozen places. Options: the builder enumerates first
  (the orchestrator's recommendation); a fixed list now; not running lg-76. The
  owner chose **the builder enumerates first**: grep every
  `tools/ledger/web/src` component that renders a person, list them (file and
  component) in the Log with the grep that found them, and the web test covers
  exactly that list; the gate grades against the list and re-runs the grep. The
  Done when line is reworded to name that list; the line it supersedes is kept
  beside it.
- 2026-10-26 — Built on branch `lg-76-person-uuid`, cut from lg-71's landed head
  `680e6c55` while #669 was open; #669 merged as `be8d9c0e` during the build and
  was merged in (`f901793e`, a merge: the squash's tree equals `680e6c55`, so every
  conflict resolved to this branch's side and the merge changed no file).
  - **The screen list, enumerated (the owner's answer above).** The grep, from the
    repository root:
    `grep -rlE "shownName|usePeopleNames|personLabel|answerLabel|historyLabel|partsLabel|splitLabel|endedSentence" tools/ledger/web/src | sort`
    finds 20 files: `people.tsx` (`shownName` itself), `labels.ts` and
    `mortgage.ts` (helpers built on it, no component), and 17 component files.
    A second grep for a person field printed raw in JSX or a template,
    `grep -rnE "\{[a-zA-Z.?]*(personId|\.person|payerId|payer|chargedTo|classifiedBy|enteredBy|uploadedBy|recordedBy|createdBy|\.by)\}" tools/ledger/web/src`,
    finds no person id printed outside `shownName`: its 18 hits are React keys,
    a select's or an option's value, element ids and one component prop. The list, file and component, each a case of
    `web/test/generated-ids.test.tsx` named after it:
    1. `home/Home.tsx` — `Home`
    2. `history/History.tsx` — `History`
    3. `inbox/Inbox.tsx` — `Inbox`, `InboxItem`
    4. `inbox/AutoFiled.tsx` — `AutoFiled`, `AutoFiledItem`
    5. `rules/Rules.tsx` — `Rules`
    6. `rules/RuleForm.tsx` — `RuleForm`
    7. `periods/Periods.tsx` — `Periods`
    8. `periods/LineForm.tsx` — `LineForm`
    9. `periods/Recurring.tsx` — `Recurring`
    10. `salaries/Salaries.tsx` — `Salaries`
    11. `salaries/MortgageSplit.tsx` — `MortgageSplitCard`
    12. `receipts/Receipts.tsx` — `Receipts`
    13. `stats/Cards.tsx` — `MortgageOwnCard`, `ContributionCards`, `SalaryCards`, `SettlementsCard`
    14. `stats/PeriodLines.tsx` — `PeriodLines`
    15. `admin/Admin.tsx` — `Admin`, `HouseholdCard`, `RenamePerson`
    16. `household/Household.tsx` — `Household`
    17. `household/MemberForm.tsx` — `MemberForm`

    Each case renders the component with alex and sam under generated ids, waits
    for a sentence naming someone, and reads the text, every field's value and
    every `aria-label`, `title`, `placeholder` and `alt`: no UUID, and the names.
    `LineForm` and `Recurring` are rendered inside `Periods`, `RuleForm` by
    opening a rule to edit, `AutoFiled` by opening the review, as a person
    reaches them: 13 cases for the 17 files. A fourteenth holds `people.tsx`'s fallback (below).
    Measured: with `shownName` mutated to print the id, 14 of 14 fail; restored
    from `7f1916e3`, 14 of 14 pass.

  - **Build 2: no migration.** `person_names_held` asks that a membership name the
    person, so the name is written after the membership, in the same
    `.immediate()` transaction; `person_names_unique` refuses a name another
    person is shown under or has as an id, which the resolution below has
    already ruled out; `memberships_person_not_shown_as_another` cannot meet a
    UUID; and both `person` columns take 1 to 64 trimmed characters, which a
    36-character UUID is. `directory.test.ts`, "a name nobody has is a person
    under a generated id, shown under that name", runs it against the real
    triggers; "the membership and the first shown name are written in one
    transaction" plants a trigger refusing the name and finds no membership
    left.
  - **Build 3: how the request tells a legacy id from a typed name.** It does not
    need to. `person` is matched against the household's shown names first, then
    against the ids of the people it has held; a legacy person's id is the name
    first typed for them, so typing it reaches them, renamed or not. The two
    matches cannot disagree: lg-33's triggers keep every shown name off every
    other person's id and every new id off every shown name. A generated id
    typed in full also matches, which is what an open tab built before lg-76
    sends. Text that matches nobody is a new person.
  - **What the brief had wrong.**
    1. `addMember` does not generate the id; a new method, `addMemberByName`,
       does, and the routes and the host command call it. `addMember` stays as
       it was, as lg-71 kept `addHousehold`: 69 calls in `directory.test.ts`,
       `api/test/helpers/households.ts` (which the dispatch asked to keep
       working) and every suite built on it make people under readable ids, and
       those are the legacy households whose books must compute as before.
    2. The household's history needed a third record. The first shown name is a
       `person_names` row, which `history()` read as a rename, so the household
       screen would have printed "<uuid> renamed casey". The contract gains
       `PersonFirstNameRecord` (`action: "name"`), the first `person_names` row of
       a person whose id is generated; the screen prints no line for it and uses
       it to name the person, including one removed before the books ever
       enrolled them.
    3. "A UUID must never reach a screen" reaches past `shownName` falling back to
       the id. Before `GET /api/people` answers, or when it fails, every screen
       printed ids (lg-33's note in `people.tsx`). `shownName` in the web now
       says "Someone" for a generated id the map lacks; a legacy id is still
       shown as itself. And `distinctNames` (`routes/rules.ts`, lg-33's gate 1,
       F3) shows a person under their id when a book-only id shares their name,
       which a person added by name can now do; a generated id takes the lowest
       free " 2", " 3" there instead. Both are tested.
    4. Build 4 names the stats' series and colours among the lists to sort.
       They keep sorting by id: lg-9's rule colours a person by their place in
       the list of ids "so a rename changes no colour" (`people.tsx`), which
       sorting by shown name would break. Reported to the orchestrator as an
       open decision; the owner chose the id order (entry below). The arithmetic's ties keep the id, as the brief says;
       their comments say "sorts first", still true. Sorted by shown name now:
       `GET /api/people`'s `people` and `retired`, the household and admin
       routes' members and people, the member form's people on both screens,
       the household screen's members, and `fetchPeople(…, "everyone")`.
    5. `GENERATED_ID` moved to the contract: the API checks a generated id with
       it, and the web needs the same shape for the fallback above.
    6. `ADDRESS_ALREADY_A_MEMBER` printed the person's id ("as <uuid>") on the
       admin screen and in the host command; it prints the shown name. The
       household is still named by its id, which is lg-77's Build 7.
    7. The import's `--as` and the workbook reader resolve shown names as the
       brief says; the report the import prints still names people by id in its
       figures (an operator's console, not a screen, and the import is lg-7's
       one-off for a legacy household). Not changed.
  - **Fold-in.** `spending-backfill-command.ts`'s `--as` resolved ids the way the
    import's did, through the same `directoryPeople`; it now takes a shown name
    too (`memberNamed`). The host command's `remove` and `add` print the shown
    name; `README.md` and `docs/02-DEPLOYMENT.md` show `[person]` as optional.
    The household id for a create comes from the same injected generator as a
    person's (`AppContext.newId`), so one test hands both in.
    `tools/ledger/CLAUDE.md`'s paragraph and §7 are rewritten per Build 7.
  - **Existing tests whose expectations changed**, because each asserted the old
    behaviour this ticket replaces (a new name became the id): in
    `directory.test.ts` one (lg-71's `createHousehold` test), in
    `household-command.test.ts` seven, in `households.test.ts` three, in
    `books.test.ts` two, in `web/test/admin.test.tsx` one (the refusal
    sentence) and in `web/test/household.test.tsx` one (the form sends the name
    as typed). No suite of the buckets, ratios, settlements, periods, salaries
    or stats changed.
  - **Commands.** `npm run check`: exit 0.
    `npx vitest run tools/ledger/api/test tools/ledger/books/test`: 1,446 of
    1,448 in 59 files, the two `books.test.ts` cases above; after their fix
    `books.test.ts` 11 of 11. `npx vitest run tools/ledger/web`: 260 of 260 in
    20 files. Import mutation: with the workbook reader's shown-name lookup
    disabled and `books` rebuilt, `workbook-import.test.ts`'s "--as and the
    workbook's names reach people under generated ids by their shown names"
    fails (1 of 3 lg-76 cases); restored from `b7bde38c`, passes. The full
    `npm test -- --project ledger` was not run (a first build runs no full
    suite; CI runs it on the draft).
- 2026-10-26 — Owner's answer, relayed by the orchestrator in the build's resume.
  Asked, because Build 4 lists the stats' series and colours (`books/src/stats.ts`)
  among the places that sort by shown name while lg-9's and lg-33's rule colours a
  person by their place in the list of ids "so a rename changes no colour"
  (`web/src/people.tsx`), whether the stats keep their id order. Options: (a) keep
  the stats ordered by id (the builder's recommendation, and what the build
  did); (b) sort them by shown name, which recolours a person on a rename. The
  owner chose **(a)**. No code changes; item 4 of the build entry's "What the
  brief had wrong" stands as built.
