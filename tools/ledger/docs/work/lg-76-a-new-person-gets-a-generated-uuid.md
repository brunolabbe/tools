---
id: lg-76
tool: ledger
title: A new person gets a generated UUID, and the name typed becomes only how they are shown
kind: work-package
status: done
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
   _(Added at landing, 2026-10-26, owner's answer: a list of pairs — the
   settlement's "Or directly: A pays B" and "Paid directly:", and Stats `who` —
   keeps the settlement's order, and a console list, the CLI `--as` refusal
   list, is not a screen.)_
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
  name, proved by a test in `api/test/households.test.ts`; the two are written in
  one transaction, proved by `api/test/directory.test.ts` › "the membership and
  the first shown name are written in one transaction"; every component the
  Log's enumeration lists (each `web/src` component that renders a person, found
  by the grep the Log names) shows the name, proved by a web test covering
  exactly that list that no UUID is rendered.
  - _Superseded 2026-10-26 by the owner's answer below:_ "every screen shows the
    name, proved by a web test that no UUID is rendered."
  - _Superseded 2026-10-26 by the owner's answer to gate 1's F5 (Log, round
    1):_ "A person added under a new name gets a UUID id and that name as their
    shown name, in one transaction, proved by a test in
    `api/test/households.test.ts`; every component the Log's enumeration lists
    (each `web/src` component that renders a person, found by the grep the Log
    names) shows the name, proved by a web test covering exactly that list that
    no UUID is rendered."
- Adding an address for an existing person, legacy or UUID, by their shown name
  reuses their id, proved by tests.
- A household with legacy name ids computes the same buckets, ratios and
  settlements as before, proved by the existing suites passing unchanged.
- The host command and the import resolve a shown name, proved by tests.
- A person added with no name is shown under the email's local part, suffixed
  when it is taken, proved by tests, including two addresses sharing a local part
  in one household.
- `npm run check` and `npm test -- --project ledger` pass.

## Review

**Gate: CONCERNS** — 2026-10-26 · `be8d9c0e..e34208a3` (merge-base `be8d9c0e`; the branch's merge of main at `f901793e` changed no file) · Sonnet 5.5, depth full

| Done when                                                                                                                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A person added under a new name gets a UUID id and that name as their shown name, in one transaction (`households.test.ts`); every component the Log's enumeration lists shows the name, proved by a web test covering exactly that list that no UUID is rendered | **proven.** `api/test/households.test.ts` › "a member adds a new name: a person under a generated id, shown under the name, in one step" asserts the id, the `names` map and the `name` history record. The one-transaction clause is asserted in `api/test/directory.test.ts` › "the membership and the first shown name are written in one transaction" (a planted trigger refuses the name, no membership is left), not in the file the line names (F5). Web: `web/test/generated-ids.test.tsx`, 13 component cases for the 17 files, a fallback case and two ordering cases. The Log's grep re-run gives the same 20 files (17 components, `people.tsx`, `labels.ts`, `mortgage.ts`); my wider grep found no component outside the list that prints a person. Controls I planted: `shownName` printing the id, 15 of 16 red (the 16th is the "Someone" case, which that plant does not touch); one raw id in `Home.tsx`, exactly 1 of 16 red; restored, 16 of 16 |
| Adding an address for an existing person, legacy or UUID, by their shown name reuses their id                                                                                                                                                                     | **proven.** `api/test/households.test.ts` › "an address for an existing person, by their shown name, reuses their id, legacy or generated"; `api/test/directory.test.ts` › "an existing person is named by their shown name, or by the id they were added under". My probe 1 against a real directory file: Nina by shown name, alex by id, alex renamed "Alexandra" by both, a UUID typed in full, `"  Nina  "`, tab/newline and NBSP around the name: all resolved to the one existing person                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A household with legacy name ids computes the same buckets, ratios and settlements, proved by the existing suites passing unchanged                                                                                                                               | **proven.** No file under `books/src` but `workbook.ts` changed; no buckets, ratios, settlements, periods, salaries or stats suite is in the diff. Probe 4, one seeded word-id household (odd-cent salaries, a close, recurring item, period lines), 26 parameterless GET routes, base `be8d9c0e` vs head: 24 of 24 that answer 200 identical (22,549 bytes; two 404 on both sides); with alex renamed "Zoe", only `/api/people` differs, in order (Build 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The host command and the import resolve a shown name                                                                                                                                                                                                              | **proven.** `api/test/household-command.test.ts` › "member resolves a shown name, an older person's id, and a person with a generated id", "list prints each person as shown, with a generated or renamed person's id beside the name"; `api/test/workbook-import.test.ts` › "--as and the workbook's names reach people under generated ids by their shown names", "--as names a person from before lg-76 by their shown name or by their id", "--as that names nobody lists the members as shown, never by a generated id". I also ran the built host command on a scratch directory file (output in the full report). The spending backfill's `--as`, which the Log folds in, is not asserted anywhere (F3)                                                                                                                                                                                                                                                       |
| A person added with no name is shown under the email's local part, suffixed when taken, including two addresses sharing a local part in one household                                                                                                             | **proven.** `api/test/households.test.ts` › "with no name, the person is shown under the email's part before the @, numbered when taken" (robin, robin 2; sam taken by an id, sam 2); `api/test/directory.test.ts` › "with no name, a new person is shown under the email's part before the @, numbered when taken", "a name from a long email is cut to the 64 a name holds, the number included". Probe 1: `sam` (an id) gave "sam 2", "sam 3", "sam 4"; an 80-character local part gave 64, then 62 + " 2" = 64                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check` and `npm test -- --project ledger` pass                                                                                                                                                                                                           | **proven.** CI on `e34208a3`: `check` SUCCESS, `test (ubuntu-latest)` SUCCESS; locally `npm test -- --project ledger`: 82 files, 1,740 of 1,740, exit 0. `check` was read from CI, not re-run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

CI on `e34208a3`: all ten entries of `statusCheckRollup` SUCCESS (check, test ubuntu, test windows informational, e2e ledger, docker ledger, pr-title, codeql, CodeQL, changes, dependency-review). Nothing the verdict rests on is pending.

- **F1 · med** · no `Done when` line depends on it · Build 4's closing rule, "lists a person reads sort by shown name", is bent with no reason given for per-person rows that still come in the books' id order: Home's "each person's own money" rows and the buffer's "Put in by …" rows (`web/src/home/Home.tsx` maps `mortgage.own` and `buffer.contributions` as the API gives them) and the settlement sentence that lists deposits for three people or more (`web/src/periods/Periods.tsx`, `settlementSentence`). For generated ids the order is arbitrary per household. Reproduction: probe 4's `p4-head-rename.json` (alex renamed "Zoe"): `buckets` is identical to base, `mortgage.own` is alex then sam, while `/api/people` is sam then alex. Build 4's words cover these rows; the arithmetic-tie exemption is about who takes the odd cent, not the order rows are shown in. **Open decision**: (a) order the three render sites with `inShownOrder`, as the Log did for sentences — no amount changes, the books' order stays (recommended; a direction, not run); (b) leave them and reword Build 4 to say display of books-ordered rows is excepted.
- **F2 · low** · the Log says the period's "Paid by" groups "still come in the API's order, which … is by id". They do not: `Periods.tsx` takes them from `fetchPeople`, which is `/api/people`'s `people`, sorted by shown name in this very change (`api/test/households.test.ts` › "people are listed by how they are shown, not by id"). The text is false in the safe direction; the behaviour is the better one. Only a person retired at a close who has a line in the open period is appended after, in line order.
- **F3 · low** · `api/src/spending-backfill-command.ts`' shown-name `--as` (`memberNamed`, `membersListed`) has no test; `spending-backfill.test.ts` is not in the diff. Planted: `--as` reverted to ids only (`found.people.includes(as)`); `spending-backfill.test.ts` and `workbook-import.test.ts` stay green, 47 of 47. Restored. The shared helper is covered through the import; the backfill's own wiring is not.
- **F4 · low** · `nameFromAddress` (`api/src/directory.ts`) cuts the local part at 64 UTF-16 units, so an astral character straddling unit 64 is split: the stored name ends in U+FFFD, `shownAs` then holds a different string from the database's, the numbering misses the clash, and the second such address reaches `person_names_unique`. Reproduction (probe-surrogate.mts, `POST /api/households/home/members` as alex, address `"e"×63 + U+1F600 + "@one.test"`, no person): first 200 with name `e…�`, `@two.test` and `@three.test` both 500 `INTERNAL`; an ordinary address after them is 200. Needs a local part of 64+ units with an emoji at the boundary: no realistic caller. Direction: cut by code points, not units (not run).
- **F5 · low** · Done when 1 names `api/test/households.test.ts` for "in one transaction"; the only test that asserts it is in `directory.test.ts`. With the name write planted after the transaction commits, exactly one test goes red (`directory.test.ts` › "the membership and the first shown name are written in one transaction"); `households.test.ts` and `household-command.test.ts` stay green (146 of 147 pass). The property is proven by a mechanism the words do not name: the owner may reword the line.
- **F6 · low** · the workbook reader and the directory resolve one typed text in opposite orders (unverified: read from `books/src/workbook.ts` `People.peek`, not run). The directory, `--as` and the member form take the exact shown name first, then the id; the reader takes the corrections map, then a folded id, then a folded shown name. Two people can hold a pair lg-33's triggers allow (an id `bob` and a person shown `Bob`, or two shown names that fold alike: `Zoé`, `Zoe`); a workbook cell "Bob" then goes to the id's person while `--as Bob` is the shown one, and the first of two alike-folding shown names wins silently. No live call site beyond a household holding such a pair; the import is lg-7's one-off.
- **F7 · low** · `Directory.history` marks a person's first `person_names` row `name` by the id's shape (`GENERATED_ID`) and order, not by anything stored. A person whose id is UUID-shaped but who was made by `addMember` (no `src` caller; tests only) or typed as one before lg-76 would have their first admin rename classed `name`, which the household screen prints no line for. No live call site.
- **F8 · low** · an older web bundle (a tab open across the deploy) reads the new `name` history record as a removal: the base `describeAll` falls through to `${record.address} removed as …` with no address. Only the History list of a stale tab, only for people added after the deploy; the Log considers an old tab for the member form (a UUID typed in full) but not for History. Read from the base source, not run in a browser.
- **dropped** · (1) the import's printed report names people by id (UUIDs for new people) and `workbook-import.ts`'s second `--as` check lists ids: the Log discloses it (item 7), it is an operator's console, not a screen. (2) A name differing only in case ("NINA" for "Nina", or an address `nina@…` beside "Nina") makes a second person, not a suffix: exact matching is what Build 3, Build 6 and the pre-lg-76 form say; a product decision. (3) "Someone": a real person is shown so only while `GET /api/people` has not answered or has failed with no earlier map held (`App.tsx` refetches on every tab change); every person the books hold is in that map (`people` and `retired`), and the household screen names the rest from its own history. By design (`people.tsx`). (4) `GENERATED_ID` and `PersonFirstNameRecord` are additions to the contract beyond Build 3's text: additive, logged under "What the brief had wrong", inside the Decision's "the owner approved the contract change this makes".
- **findings** · the hunt returned 12; 8 carried (1 med, 7 low), 4 dropped.
- NFR: security ✓ (names are trimmed, bound as parameters, resolved and written inside one `.immediate()` transaction; no raw SQL error reaches a caller except through F4) · performance n/a (one extra read of the household's names per add) · reliability — F4 · maintainability — F1, F3, F6; `byShownName` is written twice (api and web), harmless.

### Gate 2

**Gate: PASS** — 2026-10-26 · `e34208a3..66479a7d` (the round: `b1b756d3`, `bb978490`, `d1be80ab`, `272fb965`, `66479a7d`; first-parent, no merges) · Sonnet 5.5, depth narrow

| Done when                                                                                                                                                                                                         | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A person added under a new name gets a UUID id and that name as their shown name, in one transaction; every listed component shows the name, no UUID rendered (re-traced; the line was reworded in this round) | **proven.** The reworded line names three proofs and each exists and runs: `api/test/households.test.ts` › "a member adds a new name: a person under a generated id, shown under the name, in one step" (id, `names` map, `name` record); `api/test/directory.test.ts` › "the membership and the first shown name are written in one transaction" (the test exists under that exact name; `directory.test.ts` 100 of 100 at the head; gate 1 planted the name write outside the transaction and exactly this test went red); `web/test/generated-ids.test.tsx` (13 component cases for the 17 files, a fallback case and two ordering cases, unchanged by the round). The superseded wordings are kept beside the live one, each marked with the owner's answer. The round removed no assertion: the only test line it deleted is an import |
| 2. Adding an address for an existing person by their shown name reuses their id                                                                                                                                   | stands from gate 1; the round did not touch the resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3. A household with legacy name ids computes the same buckets, ratios and settlements                                                                                                                             | stands from gate 1; the round changed two web files (`Home.tsx`, `Periods.tsx`, five lines), both display order, and `home.test.tsx` with `periods.test.tsx` pass (24 of 24, the two new tests included, no existing assertion changed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4. The host command and the import resolve a shown name                                                                                                                                                           | stands from gate 1; the spending backfill's `--as`, which gate 1 found unasserted, now has `api/test/spending-backfill.test.ts` › "--as names a person under a generated id by their shown name" (F3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5. A person added with no name is shown under the email's local part, suffixed when taken, including two addresses sharing a local part (re-traced; `nameFromAddress` changed)                                    | **proven.** `api/test/households.test.ts` › "with no name, the person is shown under the email's part before the @, numbered when taken"; `api/test/directory.test.ts` › "with no name, a new person is shown under the email's part before the @, numbered when taken", "a name from a long email is cut to the 64 a name holds, the number included", and the new "a name from an email with an emoji at the cut is cut by characters, and numbered when taken". With the UTF-16 cuts planted back in `nameFromAddress` the new test goes red (`SqliteError: a shown name is unique in its household`, 1 of 100 failed) and no other does. Over HTTP at the head, gate 1's probe answers `200 200 200` and an ordinary address `200`, where gate 1 had `200 500 500`. Holds for every well-formed address; the remainder is F4 below      |
| 6. `npm run check` and `npm test -- --project ledger` pass                                                                                                                                                        | **proven by CI at the head**: `check` and `test (ubuntu-latest)` SUCCESS, with the other eight entries SUCCESS too (ten of ten). Not re-run locally. The two lint and type commits are inside that `check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Verdicts on gate 1's findings:

- **F1 · fixed in part.** The three sites the finding named, with the owner's option (a), are done: `Home.tsx` (own-money rows, "Put in by" rows) and `Periods.tsx` (`settlementSentence` deposits) order with `inShownOrder`. Planted one site at a time, `own`, `buffer` and `deposits` each turn exactly one test red (`home.test.tsx` or `periods.test.tsx`, 1 of 24 each, with the assertion messages the Log quotes); restored from the head, tree clean. The same data rendered at the head and with the two round sources checked out from the gated sha (a UUID person sorting first; Zoe, Alex, Maya): every figure beside every name is identical, only the order moved, and the markup and class names are identical; the round's whole diff in `web/src` is those two files, so no colour or chart order can have moved. **Remaining clause, same mechanism, low, no `Done when` line depends on it, open decision:** the transfer pairs ("Or directly: A pays B …", "Paid directly: …") in `settlementSentence`, and the same pairs in the Stats `who` (read from `Cards.tsx`, not run), still come in `transfersOf`'s order, which is by the payer's id. Build 4's closing sentence, "Lists a person reads sort by shown name", covers them in its words; its one exemption is the arithmetic's ties, and `transfersOf`'s pairing order is such a tie while the order a finished list of pairs is shown in is not. Build 4 neither names nor excepts them, so its text does not settle it, and the Log's reason ("pairs … were not in the finding") is about the finding, not the rule. Rendered at the head for three people, the lead reads "Alex deposits …, Maya deposits … and Zoe deposits …" and the hint "Or directly: Zoe pays Maya … and Alex pays Maya …": two lists, two orders. **Open decision:** (a) order the pairs by the payer's then the payee's shown name at both sites, one assertion each (recommended, for the sentence's consistency; a direction, not run); (b) reword Build 4 to say a list of pairs keeps the settlement's order. `membersListed` (the CLI refusal list, in `heldPeople` order, which is `ORDER BY person`) is a console: Build 4 names screens and the API, Build 5 says nothing of order, and gate 1 noted the host command's `list` the same way without grading it. I did not grade it either; it can ride on the same answer.
- **F2 · fixed.** The Log's "still come in the API's order" entry is marked "_(Corrected 2026-10-26, round 1 below …)_" in place, and round 1's F2 item gives the cause; the old text is kept, not rewritten.
- **F3 · fixed.** `spending-backfill.test.ts` › "--as names a person under a generated id by their shown name". Gate 1's plant (`--as` ids only) re-run: 1 failed, 47 passed of 48 across `spending-backfill.test.ts` and `workbook-import.test.ts` (`--as names "Casey", who is not a member of home in the household directory (Casey, alex).`); baseline before the plant 48 of 48; restored from the head, tree clean.
- **F4 · fixed in part.** The straddling emoji is fixed, over HTTP too (above). The clause that remains, same mechanism (the stored name differs from the string in memory, so the numbering misses the clash and the second address reaches `person_names_unique`): a **lone surrogate** anywhere in the local part. `POST /api/households/home/members` as alex with the JSON address `"e"×63 + "\ud83d" + "@one.test"`, and `"ab\ud83dcd@…"`, no person: first `200`; `two.test` and `three.test` both `500 INTERNAL`; an ordinary address after them `200`. The stored name reads back with U+FFFD where SQLite's `length()` counts 64 and JS counts 66. **Low**, no live call site: a well-formed address cannot carry one, the 500 rolls that add back, nothing is lost. Direction, not run: make the address well-formed (`String.prototype.toWellFormed`, in Node since 20) in `readAddress` or before the cut.
- **F5 · fixed.** Done when 1 now names the `directory.test.ts` test for the one-transaction clause; the previous wording and the original are both kept beside it, marked "Superseded 2026-10-26" with the owner's answer, and round 1 of the Log records the owner's answer (F1 option (a); F2 to F5 chosen; F6 to F8 left recorded).
- **F6, F7, F8** stay recorded, as the owner's answer says; not re-raised.

- **low** · F1's remaining clause above (open decision: the pairs, and `membersListed` on the same answer).
- **low** · F4's remaining clause above (lone surrogate, HTTP 500).
- **dropped** · (1) `membersListed` in id order: carried inside the F1 bullet as a console, not graded. (2) The ZWJ-sequence attack cannot reach the cut: U+200D is in `UNSEEN`, so `readAddress` refuses such an address with `400 BAD_REQUEST` (lg-57, by design); the cut is covered by the other multi-code-point shapes (combining marks, skin-tone pairs, flags, VS16, a dotted capital I that lower-cases to two code points), all `200 200 200`, every stored name `length()` 64 in SQLite with the " 2" and " 3" suffixes. (3) Mixed-case legacy ids can now list in a different order from the books' code-unit order on Home (`localeCompare`): the owner's option (a) asks for shown-name order.
- **findings** · the narrow attacks returned 5; 2 carried (both low), 3 dropped. Nothing is a `high`, nothing a `med`.
- NFR: security ✓ (the surrogate case is a 500, not a leak) · performance n/a · reliability — F4's lone surrogate · maintainability — F1's pairs.

CI at `66479a7d`: ten of ten entries of `statusCheckRollup` SUCCESS (`check`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `e2e / ledger`, `docker / ledger`, `pr-title`, `codeql`, `CodeQL`, `changes`, `dependency-review`). `test (ubuntu-latest)` and the Windows leg were still running at my first read and had completed at my second; the verdict rests on `check` and `test (ubuntu-latest)` for Done when 6. The `mergeTree` conflict with #670 on `workbook-import.ts` is expected (merge order: #670 first) and is not a finding.

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
- 2026-10-26 — Round after CI at `8ec55069`, on the orchestrator's resume.
  - **The ledger e2e failed in its seed** (run 40257617170, job 121362759490):
    `layout.spec.ts`'s `beforeAll` posted rules, salaries, a recurring item and
    period lines naming `"alex"` and `"sam"`, and both are now added by name
    (alex by `e2e:ledger:serve`'s `add alex@example.test alex`, sam by the
    seed's own member request), so each has a generated id and `/api/rules`
    answered "That person is not one of the household." The build's Log had
    named `layout.spec.ts`'s Admin and Household expectations but not its
    seed, and the e2e suite was not run before the push. The seed now reads the
    household's members after adding sam and names each person by the id the
    household answers for the name; the screens' expectations, which read
    names, are unchanged.
  - **The next e2e run found a sentence in id order.** With the seed fixed, 11 of
    12 passed and Salaries failed: "Ratio in effect: sam 42.8571 % · alex
    57.1429 %". A ratio's shares (and a split's parts) come from the books in
    person-id order, and sam's UUID sorted first. Build 4's rule, lists a person
    reads sort by shown name, covers a sentence listing people, so
    `inShownOrder` (`web/src/people.tsx`) now orders the ratio's shares on the
    salaries screen and the stats' ratio text, a split's parts and the people of
    an equal split (`labels.ts`), and the salaries screen's records within a
    year. The books and every amount are untouched, and the charts keep their
    id order (the owner's answer above). `web/test/generated-ids.test.tsx`
    gains "a ratio's shares on the salaries screen" and "a split's parts on the
    mortgage split card", whose shares are given in id order; with
    `inShownOrder` mutated to keep the given order both fail, and restored from
    `b568490b` both pass (16 of 16 in the file). Per-person rows elsewhere (the
    home screen's own money, the period's "Paid by" groups) still come in the
    API's order, which for two people with generated ids is by id; the e2e
    expects none of them in an order, and none was changed. _(Corrected
    2026-10-26, round 1 below: the "Paid by" groups come from `/api/people`,
    which is by shown name; the home rows are now ordered too.)_
  - **Commands.** `E2E_PORT=8176 npm run e2e:ledger` after `npm run build`: 12
    passed of 12 (this branch's spec has 12 cases; #670 adds a thirteenth). The
    360 px screenshots of Admin, Household, Home, Salaries, Period, Inbox,
    Rules, History, Stats, Receipt and Categories were opened: every person is
    shown as alex or sam, and no UUID is on any of them. `npx vitest run
    tools/ledger/web`: 262 of 262 in 20 files.
- 2026-10-26 — Round 1, on gate 1's findings (`e34208a3`). Owner's answers,
  2026-10-26, relayed by the orchestrator in the fixer dispatch: F1, options (a)
  sort the three render sites by shown name with `inShownOrder` (the gate's
  recommendation) or (b) leave them and reword Build 4: chosen **(a)**. The
  lows, options F2 to F5 (recommended), F2 and F5 only, or none: chosen **F2 to
  F5**; F6 to F8 stay recorded, unfixed.
  - **F1, fixed (`b1b756d3`).** `inShownOrder` now orders Home's "each person's
    own money" rows (`mortgage.own`), its "Put in by" rows (`buffer.contributions`)
    and the deposits `settlementSentence` lists for three people or more
    (`Periods.tsx`). No amount, colour or books order changes. Tests, each with
    the rows given in id order and a UUID person sorting first: `home.test.tsx`
    "lists each person's own money and what they put in by shown name, not by
    id" (two assertions, one per site) and `periods.test.tsx` "lists three
    people's deposits by shown name, not by id". With one site's `inShownOrder`
    removed from the committed tree, exactly that test fails and the other 23 of
    24 pass: `mortgage.own` ("expected [ 'Zoe149.99 $', 'Alex50.00 $' ] to deeply
    equal [ 'Alex50.00 $', 'Zoe149.99 $' ]"), `buffer.contributions` (the
    "Put in by" rows), deposits ("Received: Zoe deposits 10.00 $, Alex deposits
    20.00 $ and Maya deposits 30.00 $ ..."). The transfers a sentence lists
    ("Or directly: A pays B ...") are pairs and were not in the finding; they
    still come in the settlement's order.
  - **F2, corrected.** The sentence above that says the period's "Paid by"
    groups "still come in the API's order, which … is by id" is false: they come
    from `fetchPeople`, which is `/api/people`'s `people`, sorted by shown name
    in this change (`api/test/households.test.ts` › "people are listed by how
    they are shown, not by id"). Only a person retired at a close who has a line
    in the open period is appended after, in line order. The old entry is
    marked, not rewritten.
  - **F3, fixed (`bb978490`).** `api/test/spending-backfill.test.ts` › "--as
    names a person under a generated id by their shown name": a household with a
    person under a generated id shown as "Casey"; `--as Casey --write` records
    4 overrides, and a refusal lists the members as shown ("(Casey, alex)") with
    no UUID in it. With `memberNamed(found, as)` replaced by
    `found.people.includes(as) ? as : undefined` in
    `spending-backfill-command.ts` (the gate's plant) the test fails ("--as names
    "Casey", who is not a member of home ..."), 1 of 9 failed; restored from
    `bb978490`, 9 of 9 pass.
  - **F4, fixed (`bb978490`).** `nameFromAddress` cut the local part by UTF-16
    units. The bound the column holds is in characters: `person_names.name` is
    `CHECK (length(name) BETWEEN 1 AND 64 ...)` and SQLite's `length()` counts
    characters of a TEXT, so the cut is now by code points (`firstCharacters`,
    `Array.from`), for the first cut and the one that makes room for " 2", " 3".
    Test in `api/test/directory.test.ts`, at the end of "a new person gets a
    generated id": three addresses whose local part is 63 `e`, an emoji and 5
    `x`, added with no name; the names are the 63 `e` and the emoji whole, then
    62 `e` + " 2" and + " 3". Before the fix, on `b1b756d3`'s source: `SqliteError:
    a shown name is unique in its household`, 1 of 100 failed; after, 100 of 100.
    The reproduction was run at the Directory, not over HTTP, where the same
    method answers the 500.
  - **F5, reworded.** Done when 1 now names `api/test/directory.test.ts` › "the
    membership and the first shown name are written in one transaction" for the
    one-transaction clause; the line it supersedes is kept beside it, marked
    with the owner's answer.
- 2026-10-26 — Fixed at landing by owner choice: gate 2, the transfer-pairs
  low — "(b) reword Build 4 to say a list of pairs keeps the settlement's
  order". Owner's answer, 2026-10-26, on the options reword Build 4 at landing
  (recommended), order the pairs by shown name in a new round, leave recorded:
  chosen the reword. Build 4 now carries a marked, dated sentence naming the
  pairs ("Or directly: A pays B", "Paid directly:", Stats `who`) and saying a
  console list, the CLI `--as` refusal list, is not a screen. No code changed,
  so `membersListed` stays in `heldPeople` order. Proof: `git diff 66479a7d HEAD
  -- tools/ledger/docs/work/lg-76-a-new-person-gets-a-generated-uuid.md | grep
  -c '^+.*answer: a list of pair[s]'` → 1. Gate 2's other low, the lone
  surrogate in an address's local part (a 500 from `POST
  /api/households/:id/members`, nothing lost), stays recorded: the owner chose
  to leave it.
- 2026-10-26 — `origin/main` (`02ecde16`, with #670, lg-66) merged into the
  branch, a merge and not a rebase, so the head moves past the gated
  `d4578eeb`; the gates read the code before it. Two files conflicted and both
  were additive on each side, so both sides were kept and no behaviour was
  chosen between them. **`api/src/workbook-import.ts`, `run()`**: the options
  object handed to `readWorkbook` holds lg-76's `names` line and lg-66's `layout`
  line, in that order; the rest of the function (the unfiled refusal, the `--as`
  check against `knownPeople`, the `via: "screen"` message in `importWorkbook`)
  merged without a hunk. **`api/test/workbook-import.test.ts`, end of file**: lg-76's
  `describe("the import and a person's shown name (lg-76)")` and lg-66's
  `describe("a described layout (lg-66)")` both stood in the same place; each
  keeps its own closing `});`, in that order, and the imports (`layoutFixtures`,
  `NO_CORRECTIONS`, `importWorkbook`, lg-76's `Directory`) merged without a hunk.
  `ledger/e2e/layout.spec.ts`, `CLAUDE.md`, `.env.example` and the contract files
  auto-merged. Counts: `workbook-import.test.ts` has 40 `test(` calls, main's 37
  (36 + lg-66's one) plus lg-76's 3, none dropped; `npx vitest run
  tools/ledger/api/test/workbook-import.test.ts` 40 of 40; `npm test -- --project
  ledger` 1840 of 1840 in 86 files; `E2E_PORT=18476 npx playwright test -c
  tools/ledger/playwright.config.ts tools/ledger/e2e/layout.spec.ts` 13 of 13,
  lg-66's "Import fits a phone and a desktop, before sending and once read"
  included; no UUID appears in its 360 px screenshots (before sending, read).
