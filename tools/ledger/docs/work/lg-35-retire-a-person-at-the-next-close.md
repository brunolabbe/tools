---
id: lg-35
tool: ledger
title: An admin retires a person, from the next close
kind: work-package
status: done
milestone: P6
depends_on: [lg-33]
difficulty: hard
---

# lg-35 — An admin retires a person, from the next close

## Why

Nothing removes a person from the books (`docs/00-ANALYSIS.md` §7), so someone
who leaves a household stays a person: listed by `/api/people`, asked for on
the salaries screen, offered on rules and receipts, and given a share of the
mortgage's joint rows. §7 calls retiring "future work, for when someone first
needs it". The owner asked for it on 2026-10-17, with member editing.

The money side is mostly there already. A person a period's ratio does not name
has no share of that period, someone who has left keeps what they are owed, and
a close that owes someone with no share now is settled by transfers alone (§5,
lg-23, lg-29). What is missing is a record saying the person is gone, and the
screens and the next ratio obeying it.

## Decisions (owner, 2026-10-17)

- **From the next close.** An admin records "retire at the next close". The
  person takes part in the open period, it settles with them in it, and every
  period after leaves them out. This keeps "people change only at a close"
  (§5) and needs no books read by the admin route, which an admin route never
  does. The other two readings — the admin route opening the books to take the
  open period's first day, or a member recording it — were offered and not
  chosen.
- **Refused while an address stands under the name.** The admin removes every
  address first; nobody who can still sign in is retired by mistake.
- **Reversible, the same way.** A later record brings the person back from the
  next close after it.
- **Admin only.**

## Build

1. **The request lives in the directory** (migration 6, after lg-33's 5, in
   `api/src/db/directory-schema.ts`): `retirements` (`id`, `household_id`,
   `person`, `action` `'retire' | 'return'`, `recorded_at`, `recorded_by`),
   appended, with the same never-updated, -deleted and -replaced triggers as
   `memberships`. A trigger refuses a `retire` while `current_members` holds an
   address under that person, and a `retire` or `return` that does not change
   the person's latest state.
2. **The close applies it to the books.** When a period closes
   (`api/src/periods.ts`), the API reads the household's directory records
   recorded before the close and not yet applied, and appends them to the
   books — a new books migration with a `people_retirements` table (`person_id`,
   `action`, `from_date` = the closed period's `end_date` plus one day,
   `period_id`), appended, never edited. The books stay whole on their own:
   a backup of the data directory restores who was in each period without the
   directory. A request recorded while no period is open waits for the next
   close.
3. **Who is in a period** is a function in `books`, over `people` and
   `people_retirements` as of a date. Every reader that uses `knownPeople`
   today — `api/src/buckets.ts`, `api/src/stats.ts`, `api/src/routes/rules.ts`,
   `api/src/workbook-import.ts` — is checked against it: the history (stats,
   past periods, past settlements) keeps every person who was there, while
   anything about the open period or after (the salaries screen, the people
   rules and receipts offer, the mortgage's joint-row shares from `from_date`)
   asks who is in.
4. **The ratio.** A ratio confirmed from a date on or after a retirement's
   `from_date` that names the retired person is refused, and closing a period
   whose ratio names a person retired from it is refused, both with a new
   ledger code, `PERSON_RETIRED` (409). The salaries screen says a ratio
   without them is needed. No ratio is changed for the admin.
5. **The route** is `POST /api/admin/households/:id/people/retire`, body
   `{ person, action }`, `adminWrite` in `onRequest` and `adminOf` again in the
   handler; in `ROUTES`, with its zod schema, and `PERSON_NOT_FOUND` from lg-33
   for a person the directory never held. The admin screen shows each person's
   state — in, retiring at the next close, retired, returning at the next close
   — beside lg-33's Rename.
6. Amend `docs/00-ANALYSIS.md` §7: replace "Retiring a person is future work"
   with what was built and these decisions.

## Done when

1. A directory test: `retire` is refused while an address stands under the
   person, accepted after it is removed, and `UPDATE`, `DELETE` and
   `INSERT OR REPLACE` on `retirements` are refused.
2. An API test: a person retired while a period is open still takes part in
   that period's settlement; after the close, `people_retirements` holds one
   record with `from_date` the day after its `end_date`, and the salaries
   screen's people no longer include them.
3. An API test: after that close, confirming a ratio from `from_date` that
   names the retired person is refused as `PERSON_RETIRED`; one without them is
   confirmed.
4. An API test: a joint mortgage row dated on or after `from_date` gives the
   retired person no share; one dated before it still does.
5. An API test: a `return` recorded after the retirement brings the person back
   from the next close after it, and stats over the whole history list them in
   every period they were in.
6. `api/test/authority.test.ts` walks the new route as every identity that must
   be refused, and `api/test/route-limits.test.ts` and
   `api/test/isolation.test.ts` find it.
7. `npm run check` and `npm test -- --project ledger` pass.

## Review

**Gate: CONCERNS** — 2026-10-20 · `00977771..84502ed9` · Sonnet 5.5, depth full

| Done when                                                                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Directory test: retire refused while an address stands, accepted after; UPDATE, DELETE, INSERT OR REPLACE refused                                                                          | `api/test/retire-person.test.ts` › "a retire is refused while an address stands under the person, and taken once it is removed" and "the schema refuses the same, and an UPDATE, a DELETE and an INSERT OR REPLACE" ✓. The literal line is met at the time of the request; the sequence retire, then add an address, is F1.                                                                              |
| 2. A retiree takes part in the open period's settlement; after the close one `people_retirements` record with `from_date` the day after `end_date`; the salaries screen's people exclude them | `api/test/retire-person.test.ts` › "takes part in its settlement, and from the day after its close is no longer offered" (settlement shares name casey; one record `from_date` 2026-04-01 for `end` 2026-03-31; `GET /api/people`) ✓; `web/test/salaries.test.tsx` › "asks only for the people in, and says a ratio without a retired person is needed" ✓                                                |
| 3. After that close a ratio from `from_date` naming them is `PERSON_RETIRED`; one without them is confirmed                                                                                   | `api/test/retire-person.test.ts` › "a ratio from from_date naming them is refused, the period is not closed at the old one, and one without them is confirmed" (409 `PERSON_RETIRED`, then 200) ✓                                                                                                                                                                                                        |
| 4. A joint mortgage row dated on or after `from_date` gives the retiree no share; one before still does                                                                                       | `api/test/retire-person.test.ts` › "a joint mortgage row dated on or after from_date gives them no share; one before still does"; `books/test/people.test.ts` › "a row dated on or after the retirement gives them no share; one before still does" ✓. Positive control run: both go red (see the bullets).                                                                                              |
| 5. A `return` brings them back from the next close after it; stats list them in every period they were in                                                                                     | `api/test/retire-person.test.ts` › "brings them back from the next close after it, and the stats list them in every period they were in" (settlements `[alex,casey,sam]`, `[alex,sam]`, `[alex,casey,sam]`) ✓                                                                                                                                                                                            |
| 6. `authority.test.ts` walks the new route; `route-limits.test.ts` and `isolation.test.ts` find it                                                                                            | `api/test/authority.test.ts` › "has a request for every admin and household route, with every method the server answers" (8 routes) and its admin-route sweeps ✓; `api/test/route-limits.test.ts` › "every route in the contract is accounted for, so a new one cannot be forgotten" ✓; `api/test/isolation.test.ts` › "covers every route the app answers, so a route added later cannot be left out" ✓ |
| 7. `npm run check` and `npm test -- --project ledger` pass                                                                                                                                    | **verified** — run on this head: `npm run check` exit 0; `npm test -- --project ledger` exit 0, 1584 of 1584 tests in 73 of 73 files. PR check `test (ubuntu-latest)` is red on this head for a test outside the diff's reach (see the CI bullet).                                                                                                                                                       |

- **med** · no `Done when` line depends on it · **open decision (builder's open point 1, wider than the builder says)** · An address can be added under a person who is **retiring** (request recorded, no close yet) as well as one who is **retired**. Reproduced through the routes: remove casey's address, retire casey, `POST …/members` an address under casey (200), close: casey is retired from the books with an address standing; that address signs in, `GET /api/people` answers `retired:["casey"]`, files a period line for casey (200). Direct SQL: an `add` into `memberships` under a person with a retirement is accepted. The brief's Decision ("refused while an address stands … nobody who can still sign in is retired by mistake"), `docs/00-ANALYSIS.md` §7 ("so nobody who can still sign in is retired by mistake"), the `retirements_no_address` trigger's comment and the Log's receipts reasoning ("nobody is retired with an address") all state a guarantee that holds at the moment of the request only; the Log discloses the retired case, not the retiring one. Options, not settled: (a) refuse an add under a retiring or retired person until they return, which needs the same check for the retiring state; (b) allow it and reword the §7 sentence, the trigger comment and the Log claim; (c) the close skips applying a retire while an address stands. The retired-person-with-an-address state is read by receipts' charge-to list (`members` is the directory's current members, read from source, not run).
- **low** · `nfr:reliability` · two-store write at a close, three cases run with `markApplied` made to throw once after the books commit. (1) Applied exactly once, never twice: `people_retirements` held one record after the failed close and still one after the second close (`directory_id` is `UNIQUE`, and `applyRetirements` skips ids the books hold); `markApplied` ran twice and the second wrote the missing echo. (2) Until that second close the admin screen says "casey: retiring" while `GET /api/people` already answers `retired:["casey"]`. (3) A `return` filed in that window is accepted as a cancel (the screen offers "Keep in", answer `standing:"in"`, listing `casey:in`), yet the books keep casey retired through the open period: a ratio naming casey from the period's first day is `PERSON_RETIRED`, the close at the old ratio is `PERSON_RETIRED`, and casey is back only from the next close (settlements `[alex,casey,sam]`, `[alex,sam]`, `[alex,casey,sam]`). The screen's "retiring at the next close" and "Keep in" are false text in the unsafe direction for that window. Condition: a directory write failure after the books commit (the builder's test reaches it with a mock); no `Done when` line depends on it. Direction, not a remedy: the admin screen's state comes from an echo that can be stale.
- **low** · **open decision (builder's open point 2)** · The inbox's "belongs to" picker and the history filter call `fetchPeople(signal, "everyone")`, so a retired person is offered for any row, including one dated after `from_date`; the API accepts any person the books hold (read from the Log and `ruleContext`, not run). No `Done when` line covers it, and Build 3 names the history as keeping everyone and "the people rules and receipts offer" as asking who is in, but not this picker. Options, not settled: keep as built; offer a retired person only for a row dated before `from_date`; show them in a separate group. The history filter has no live reason to be anything but everyone.
- **low** · **open decision (builder's open point 3)** · Contract additions, claim checked. `RetirePersonRequest` and its schema are named by Build 5 ("in `ROUTES`, with its zod schema"). `AdminHousehold.people`, `AdminPerson` and `PersonStanding` are needed by Build 5's "each person's state": `members` lists addresses, and the only person who can be retired has none. `PeopleResponse.retired` is not forced: on the run's `GET /api/people`, `names` already holds every person (`{"alex","casey","sam"}` beside `people:["alex","sam"]`), so the retired are `names` minus `people`; a query parameter or a second route would also do. It is a choice among shapes that the ticket does not record, and it changes what `people` means for every consumer. The Log discloses the additions.
- **low** · open decision · The two directory refusals (an address stands; the state would not change) are `BAD_REQUEST` with a sentence naming the person, as 23 other `refuse` calls in `directory.ts` at the base are. Root `CLAUDE.md` says a re-worded message at the raise site is the tell that the code is wrong, and "If no existing code fits, say so". The Log says none fits. Every exhaustive map handles `PERSON_RETIRED`: `DEFAULT_ERROR_MESSAGES` in `contract/src/errors.ts`, the `ErrorCatalog` `satisfies`, `STATUS_BY_CODE` in `api/src/http-errors.ts` (409); the ledger web has no per-code map. Options, not settled: keep `BAD_REQUEST`; add domain codes in the ledger contract (two codes, two status rows, two messages).
- **low** · `nfr:maintainability` · `retirements_applied` is not tied to the books: nothing checks `from_date` against `people_retirements`, and a row there changes the admin screen's state. A retire cannot be taken through it (it needs a `retirements` row, whose triggers held under INSERT, INSERT OR REPLACE, REPLACE INTO, INSERT OR IGNORE with and without an explicit id), and its own UPDATE, DELETE and REPLACE are refused. No live call site; only hand-written SQL writes a wrong echo, and it is never deletable.
- **CI** · `test (ubuntu-latest)` is red on `84502ed9`: `repo` project, `scripts/test/preflight.test.ts` › "--only mergeTree runs the probe alone: no suite, no other check (repo-104)", `ENOTEMPTY: directory not empty, rmdir '/tmp/preflight-umt9tH/.git/objects'`. The diff touches nothing under `scripts/`; the same run passed the ledger project, `retire-person.test.ts` included. The latest reading of that test on `main` is unmeasured. `check`, `docker`, `CodeQL`, `codeql`, `dependency-review` and the informational `test (windows-latest)` leg passed. Not a finding on the diff; the lander re-reads the leg.
- **dropped** · "Isolation of a person with addresses in both households": the directory does not allow it (`memberships_one_household`: an address belongs to at most one household). The same person id in both households was run instead, both directions; nothing crossed.
- **dropped** · the stats settlement list omitting a period whose `end` is outside a `from`/`to` range that overlaps its start (a range 15 March to 15 May lists March and April, not May): pre-existing filter by `end`, in `stats.ts` code this diff does not change.
- **findings** · the hunt returned 8; 6 carried (F1 the address sequence together with the false guarantee text, the stale echo, the picker, the contract additions, the error code, `retirements_applied`), 2 dropped (above). The red CI leg is recorded beside them, not counted.
- **Positive controls** · (1) `JointTotals.add` read as if every joint row were dated after every retirement (the `from_date` filter dropped for the split only): 3 of 14 red in `books/test/people.test.ts` and `api/test/retire-person.test.ts` (the three tests named in rows 4 and 5). (2) `retiredOn` comparing `fromDate < date` (a retirement one day late): 6 of 14 red. Both restored; tree clean.
- **Sweeps** · 12 cases per retiree (3 people to 2, joint rows the day before, on and the day after `from_date`, at 1, 2, 10 000 and 10 001 cents), run for each of the 3 people as the retiree and both signs: 72 of 72 sum to the row and give the retiree 0 from `from_date`; 54 of 54 agree with `mortgageOwnSeries`; retire, return, retire across three periods equals a by-hand split. Isolation: 6 of 6 readings of household A unchanged by household B's retirement, and the reverse 4 of 4.
- NFR: security ✓ (admin-only route, prepared statements, triggers hold) · performance ✓ (`retiredOn` per joint row, a handful of records) · reliability — above · maintainability — above.

### Gate 2

**Gate: PASS** — 2026-10-20 · `84502ed9..eb73ad2e` (one commit; merge `2817844e` not reviewed) · Sonnet 5.5, depth medium

| Done when                                      | Proof                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7. `npm run check` and the ledger project pass | **verified** — on this head `npm run check` exit 0; `npm test -- --project ledger` exit 0, 1586 of 1586 tests in 73 of 73 files (gate 1: 1584; the round adds 2). PR #583 on `eb73ad2e`: `test (ubuntu-latest)`, `test (windows-latest, informational)`, `check` (4 runs), `docker`, `codeql`, `CodeQL`, `dependency-review` all SUCCESS. |

Rows 1 to 6 are not re-traced: the round touches the directory's add path and text, and the named tests of those rows pass in the run above.

**Gate 1's findings**

- **F1 (med), an address under a retiring or retired person: fixed.** Gate 1's probe, re-run on this head: the add under a retiring casey is 400 `BAD_REQUEST` ("casey is retiring at the next close. Keep them in first, then add the address."), the direct-SQL `memberships` add under a retired person is refused ("an address is added under a retired person only once their return is applied"), and the second address's holder gets 403 where gate 1 had 200. The four sequences the dispatch names, each through the route and by direct SQL, are in the full report; the code check and the trigger agree in 6 of 6 states a request and an applied record can leave. No finding in them.
- **Stale admin echo after a failed `markApplied` (low): not fixed**, recorded unfixed by the owner. Gate 1's probe output is identical to its `probe.out` on those lines. It now has a consequence, below.
- **`retirements_applied` not tied to the books (low): not fixed**, recorded unfixed by the owner; unchanged.
- **Pickers offering retired people, contract additions (`PeopleResponse.retired` included), `BAD_REQUEST` for the directory refusals (low, open decisions): settled by the owner**, kept as built; the round changes none of them, and F1's refusal is `BAD_REQUEST` too (400, code `BAD_REQUEST`, measured).
- **CI leg red at `84502ed9` (`repo` project, `preflight.test.ts`): green on `eb73ad2e`.**

**New, in the lines the round touched**

- **low** · `nfr:reliability` · no `Done when` line depends on it · **the new rule is bypassed through the recorded-unfixed echo, and `tools/ledger/CLAUDE.md` states it without the exception.** With `markApplied` made to throw once after the books commit, then a `return`, then an add: retire, close (200, books hold `retire 2026-04-01`), return (200, screen says casey "in"), add `casey2@example.test` under casey (**200**); `GET /api/people` as that address answers `retired:["casey"]` and a period line for casey is filed (200), until the next close applies the return. Direct SQL, retire then return recorded and nothing applied: the add is accepted (`ACCEPTED`). The state F1 graded med (an address signing in under a person the books have retired) is reachable again, but only behind a directory write failing after the books commit, and `docs/00-ANALYSIS.md` §7 and the trigger's comment both state the gap, as does the Log. The `CLAUDE.md` line ("no address is added under them again until a close has applied their return") does not, and it loads in every ledger session. Direction: the cause is the recorded-unfixed two-store write; the text can say "bar a close whose echo failed". Unsafe direction for a reader who trusts the line, narrow because the condition is a failure.
- **low** · `nfr:maintainability` · **the edge the builder takes has no test.** A retire and a return both waiting for one close leave the person in and an add is taken; the trigger's comment and the Log say so, and I measured it (retire, return, add: 200; close; books hold `retire 2026-04-01` then `return 2026-04-01`, `GET /api/people` `retired:[]`, a ratio naming casey from 2026-04-01 is 200, the April settlement lists casey). No test asserts it: a trigger rewritten to refuse that case leaves `retire-person.test.ts` and `directory.test.ts` at 95 of 95. Its wording is also loose in `CLAUDE.md` and §7 ("until a close has applied their return"), since here the add precedes any close, though the retirement it follows was cancelled. No live defect.

- **dropped** · "migration 6 was edited in place" as a defect: migration 6 exists only on this branch (`origin/main`'s directory schema holds 5 migrations and no `retirements`; no `ledger-v*` tag contains `84502ed9`; no open branch touches `directory-schema.ts` but this one; `lg-57`, which edits `directory.ts` beside it, merges clean). Only a directory file migrated by an earlier head of this branch would lack the trigger; no live call site.
- **dropped** · a writer that skips `Directory.addMember` gets the SQLite abort, not a sentence (with the code check removed the route answers 500 for both callers): by the class's own header, the triggers are the backstop for such a writer.
- **findings** · the hunt returned 4; 2 carried, 2 dropped. Nothing is a `high`; no `Done when` line depends on either low.
- **Positive controls** · (1) gate 1's `mutate.mjs` (joint-row split reads every row as dated after every retirement): 3 of 16 red across `books/test/people.test.ts` and `api/test/retire-person.test.ts`. (2) gate 1's `mutate2.mjs` (a retirement one day late): 6 of 16 red. (3) trigger removed, `Directory.addMember`'s check kept: 1 of 10 red in `retire-person.test.ts`, the direct-SQL test "is refused by the schema too, in each of those states, and taken after a return is applied" (`retiring: expected [Function add] to throw an error`); the route test stays green. (4) the check removed, trigger kept: 1 of 10 red, the route test (`expected { admin: 500, member: 500 } to deeply equal { admin: 400, member: 400 }`). (5) both removed: 2 of 10 red with the two messages the Log quotes. (6) a trigger that refuses the documented edge: 95 of 95 green (the second low). All restored from the head; tree clean.
- NFR: security ✓ (the member route now refuses and names the person's standing, which `GET /api/people` already shows a member) · performance ✓ (`standings` per add; the trigger reads `retirements_person`) · reliability, maintainability — above.

## Log

- 2026-10-17 — Filed with lg-33 and lg-34. Depends on lg-33 because both add a
  directory migration, and on lg-33's `PERSON_NOT_FOUND`. The boundary was
  first answered as "the open period's first day, or the day after a close";
  that date is in the books, which the admin route cannot read, so the owner
  was asked again and chose the next close.
- 2026-10-20 — Built (builder, base `00977771`). Directory migration 6
  (`retirements`, with held, no-address, changes-state and the never-updated,
  -deleted and -replaced triggers; and `retirements_applied`), books migration
  13 (`people_retirements`), `PERSON_RETIRED` 409,
  `POST /api/admin/households/:id/people/retire`, `AdminHousehold.people`
  (`AdminPerson`, `PersonStanding`), `PeopleResponse.retired`, and the admin,
  salaries, periods, history and inbox screens. §7 of `00-ANALYSIS.md` amended.
  Measured: `npm run check` exit 0; `npm test -- --project ledger` 1584 of 1584
  in 73 files; `api/test/retire-person.test.ts` 8 of 8. Red: with `buckets.ts` passing no
  retirements and `confirmRatio`'s check disabled, that spec failed 3 of 8 (Done
  when 3, 4, 5: "expected 200 to be 409", the April payment split in thirds);
  with the close applying nothing, 5 of 8.
  - **Where "who is in on a date" lives**, for lg-63: `peopleOn` and `retiredOn`
    in `books/src/people.ts`, over the people and `people_retirements` read by
    `retirementsOf` in `api/src/people.ts`; `peopleInOpenPeriod` there is the
    open period's answer. The mortgage's joint-row split by who was in is
    `JointTotals` in `books/src/buckets.ts`, used by `mortgageAsOf` and
    `mortgageOwnSeries`. Nothing was built for lg-63's split of a payment.
  - **What the brief had wrong.** (1) Build 5's admin screen states cannot be
    told from the directory alone: "retiring at the next close" and "retired"
    differ only by whether a close has run, which is in the books. The close
    now echoes to the directory which requests it applied
    (`retirements_applied`, `Directory.markApplied`, after the books commit);
    an echo that fails is logged and written by the next close, which writes
    every applied id the directory lacks, and the close still stands
    (`retire-person.test.ts` › "the directory's echo of a close"). (2) The admin
    screen listed people from current members, so a person whose addresses are
    gone — the only person who can be retired — was not on it; it now lists
    every person the household has named (`AdminHousehold.people`). (3) The
    contract moved more than Build names: `PeopleResponse.retired` (the history
    filter needs everyone, the salaries screen only who is in), `AdminPerson`,
    `PersonStanding`, `RetirePersonRequest` and its schema. (4) The retire and
    return refusals Build 1 puts in triggers (an address stands; the state
    would not change) have no code in the brief and none fits: they are
    `BAD_REQUEST` with a sentence naming the person. (5) "A request recorded
    while no period is open waits for the next close": there is always an open
    period here, so every request waits for the next close and nothing more
    was needed.
  - **Each `knownPeople` reader, checked.** `buckets.ts` and stats'
    mortgage-own series keep every person and pass the retirements, so a
    retired person keeps their deposits and their share of earlier joint rows.
    The rest of `stats.ts` (salaries, contributions) is history and is
    unchanged. `routes/rules.ts`: `GET /api/people` answers who is in and the
    retired; `ruleContext`'s `people`, which validates a person named on a
    write, still holds everyone, so a correction to a line or a rule from a
    period the person was in is still taken. `workbook-import.ts` imports the
    whole history into empty books and is unchanged. Receipts already offer
    current members only (lg-30); nobody is retired with an address, and from
    round 1 no address is added under a retiring or retired person, but for the
    stale-echo window (round 1, below).
  - **Folded in.** Screens that list the past list the retired: the history's
    person filter and the inbox's "belongs to" (a row may predate the
    retirement) ask `fetchPeople(signal, "everyone")`; the open period lists a
    retired person's line entered late into a period they were in.
  - **Changed beside it.** Every exact expectation of `GET /api/people` gained
    `retired: []` (receipts' lg-30 key list included), the admin listing's
    `people`, and the migration counts moved to 13 and 6. lg-55 (#581) also
    takes books migration 13; whichever lands second renumbers. `authority.test.ts`'s probes take a `setup` (the retire probe
    needs a person with no address), and `directorySnapshot` reads the
    retirements and standings, which are no line of `Directory.history`.
  - **Not covered.** A retirement is no line of the household's history
    screen. (Corrected in round 1: this entry said an address could still be
    added under a retired person and left it open; it could under a retiring one
    too, and both are now refused, below.) The admin's retire control has no confirmation step: it is
    undone the same way before the close.
- 2026-10-20 — Round 1, on gate 1's findings at `00977771..84502ed9`
  (CONCERNS, nothing high), with the owner's answers of 2026-10-20. `main` had
  moved to `da4673e1` for other work (repo-106, repo-107, repo-108, pl-59), so
  it was merged first; #581 had not merged, and books migration 13 stays as it
  is until it does.
  - **F1 (med), the owner chose (a).** The question: an address can be added
    under a person who is retiring or retired, so the "nobody who can sign in
    is retired" promise held only at the moment of the request; what should
    hold? Options: (a) refuse the add until they return, recommended; (c) the
    close skips a retire while an address stands; (b) allow it and reword. The
    owner chose (a), widened by the gate to the retiring state: the directory
    refuses an address under a person whose retirement waits or is applied,
    until a return is applied. `memberships_not_under_retired` in directory
    migration 6 (edited in place: it has not shipped) refuses an `add` when the
    person's latest request is a retire or the latest a close applied is;
    `Directory.addMember` refuses first, as `BAD_REQUEST`, with a sentence
    naming the person. A retire and a return both waiting for one close leave
    the person in, so an add is taken. `api/test/retire-person.test.ts` › "an
    address under a retired person": "is refused while they are retiring,
    retired or returning, and taken once the return is applied" (admin and
    member routes) and "is refused by the schema too, in each of those states,
    and taken after a return is applied" (direct SQL). Both failed before the
    fix (`expected { admin: 200, member: 409 } to deeply equal { admin: 400,
member: 400 }`; "retiring: expected [Function add] to throw an error") and
    pass after: the spec is 10 of 10. Gate 1's `gate1-lg35.test.ts`, re-run on
    this tree with its output sent elsewhere, now logs the SQL add as
    "refused: an address is added under a retired person only once their
    return is applied", the add under a retiring casey as 400, and casey's
    second address as never admitted (403). §7, the `retirements_no_address`
    comment and two lines of the entry above, which promised more, now say
    so; the one gap left is the stale echo (the low below).
  - **The inbox's and the history's pickers, the owner chose to keep them as
    built.** The question: a retired person is offered for any row, one dated
    after `from_date` included. Options: keep as built, recommended; offer
    them only for a row dated before `from_date`; show them in a group of
    their own. No change.
  - **The contract additions, signed off by the owner** on 2026-10-20, as
    lg-33's `names` was: `RetirePersonRequest` and its schema,
    `AdminHousehold.people`, `AdminPerson`, `PersonStanding`, and
    `PeopleResponse.retired`. The other option for the last was to drop it and
    derive the retired as `names` minus `people`. Accepted as built.
  - **The two directory refusals stay `BAD_REQUEST`** (an address stands; the
    state would not change), the owner's choice of the recommendation. The
    other option was two ledger codes. F1's new refusal is `BAD_REQUEST` too,
    the same kind.
  - **`tools/ledger/CLAUDE.md`, the owner asked for the line**, under "People
    come from the household directory". Reworded for F1: it says a person is
    retired only at a close and only with no address, and gets none back
    until a return is applied.
  - **Recorded, not fixed, by the owner's answer:** the admin screen's state
    after a failed `markApplied` reads from an echo that can be stale, so for
    that window "retiring at the next close" and "Keep in" are wrong and a
    return reads as a cancel (and, from this round, lets an address be added);
    and `retirements_applied` is not tied to the books, so only hand-written
    SQL could write a wrong echo. Neither fix is fully stated.
- 2026-10-20 — Renumbered at landing, owner-ordered maintenance after both
  gates (merge order: #581 first, then lg-35). `main` at `5c6077f3` carried
  lg-55's books migration 13 ("what the household says about its mortgage"),
  so `git merge origin/main` (`c554ebbd`) conflicted in
  `tools/ledger/api/src/db/schema.ts` and nowhere else: lg-55's stays 13, this
  ticket's `people_retirements` is now books migration 14 (the comment is its
  only mention of a number; no `user_version` is set by hand). Nine
  `user_version` asserts moved from 13 to 14: `schema.test.ts` 5,
  `auto-file.test.ts` 2, `spending-backfill.test.ts` 2; `00-ANALYSIS.md` §7's
  "books migration 13" is 14. The directory's migration 6 is untouched. The
  Build and Round 1 entries above say "13" as written before the merge.
  `npx vitest run` over `schema.test.ts`, `retire-person.test.ts`,
  `mortgage.test.ts`, `auto-file.test.ts` and `spending-backfill.test.ts` →
  `Test Files 5 passed (5)`, `Tests 71 passed (71)`.
- 2026-10-20 — Fixed at landing by owner choice: gate 2, low 1
  (`nfr:reliability`) — "the new rule is bypassed through the recorded-unfixed
  echo, and `tools/ledger/CLAUDE.md` states it without the exception". The
  line the branch added now says "(bar a close whose echo failed)" after "until
  a close has applied their return"; the rest is kept.
  `grep -c "whose echo failed" tools/ledger/CLAUDE.md` → 1 (0 at `HEAD` before
  the fix).
- 2026-10-20 — Fixed at landing by owner choice: gate 2, low 2
  (`nfr:maintainability`) — "the edge the builder takes has no test". A retire
  and a return both waiting for one close leave the person in and an add is
  taken; `retire-person.test.ts` gained, at its end, "an address under a person
  whose retire a return cancelled before any close" → "is taken, and the close
  leaves them in the books and in the settlement" (retire, return, add under
  casey 200, close, `GET /api/people` gives `retired: []`, the settlement lists
  casey). `tools/ledger/CLAUDE.md` and `00-ANALYSIS.md` §7 now say a retire a
  return cancels before the close lets the add through. Red against a trigger
  that refuses the case (`memberships_not_under_retired`'s first condition
  rewritten to "a retire no close has applied exists"): `npx vitest run
tools/ledger/api/test/retire-person.test.ts tools/ledger/api/test/directory.test.ts`
  → `Tests  1 failed | 95 passed (96)`, the new test failing on `expected 500 to
be 200`; restored → `Tests  96 passed (96)`.
