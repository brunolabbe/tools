---
id: lg-35
tool: ledger
title: An admin retires a person, from the next close
kind: work-package
status: ready
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
