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
