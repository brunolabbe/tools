---
id: lg-22
tool: ledger
title: Households and their members, managed from the app
kind: work-package
status: ready
milestone: P6
depends_on: [lg-20, lg-21]
difficulty: hard
---

# lg-22 — Households and their members, managed from the app

## Why

After [lg-20](./lg-20-the-household-directory.md), the directory is changed only by
a command on the host. The owner chose to manage it from the app
(`00-ANALYSIS.md` §7, _Who manages membership_, decided 2026-10-12):

- an admin creates households and adds or removes any member;
- a household's own members can add a member to their household and remove
  nobody, because removal cuts a person off from their own records.

## Build

1. **Who is an admin** is `LEDGER_ADMINS`, which lg-20 reads. An admin need not be
   a member of any household. Being an admin grants directory rights only: an
   admin reads a household's books only by being its member.
2. **Admin routes** live under `/api/admin/`, guarded by an `adminOf(request)` that
   fails closed. An admin can:
   - list households and their current members;
   - create a household, which gets its books file the way lg-21 gives a new
     household one;
   - add a member;
   - remove a member.
3. **Household routes**, for a member of that household only:
   - list the household's members and its membership history (who added or
     removed whom, and when);
   - add a member.

   There is no removal route here, and a test proves a member cannot remove
   anyone through any route.

4. **Every change is an appended directory record naming the person who made it**
   (lg-20). Adding an address that already belongs to another household is
   refused, and so is a third person name (lg-20's cap). **A member is told only
   that the address cannot be added**, whichever the reason: the reason would
   let any member ask whether an address uses the ledger. An admin is told
   which. An address that changes household is a removal by an admin, then an
   add.
5. **Every new route takes a rate limit** (`rateLimitsFor(context).write`/`.read`),
   or `api/test/route-limits.test.ts` fails. An admin route is keyed on the
   admin's address, since an admin may have no person (lg-20), and
   `route-limits.test.ts` accepts that hook as it does the two.
6. **The authority sweep.** It walks every admin route as a non-admin member, and
   every household route as a member of the _other_ household and as an admin
   in no household, and every route as an address Access admits that is
   neither member nor admin. Each must answer 403 and change nothing. Make it
   fail first by loosening one guard, and record the failing run in the Log.
7. **The screens.**
   - An admin sees households and members, with add and remove.
   - A member sees their household's members and history, and adds one.
   - Mobile-first, as the rest of the web is.
   - Each screen tells whoever adds a member that the address must also be
     admitted on the ledger's Access policy, which the operator does in the
     dashboard (`docs/02-DEPLOYMENT.md`, step 2), and the admin screen lists
     every household's addresses so the operator can see which to admit.
8. **Error codes.** A new ledger code arrives with the route that first throws it,
   with its status in `api/src/http-errors.ts` (the ledger `CLAUDE.md`), for
   example an address already in another household. Use core's `FORBIDDEN` for a
   refusal of authority.
9. **What lg-20's gate left on the directory's writers** (gate 1, F2 and F6). This
   ticket adds the first writers in the app, so they are fixed here.
   - **`INSERT OR REPLACE` gets past append-only** (F2). It deletes the old row
     without firing the `DELETE` trigger (`recursive_triggers` is off), so a
     membership's `add` can become a `remove` and a household can be renamed.
     The source scan in `directory.test.ts` has the same blind spot, and misses a
     quoted table too. Add a `BEFORE INSERT` trigger in `directory-schema.ts`
     that refuses an `id` that already exists, and make the scan see `REPLACE`
     and a quoted or qualified table name. Plant each and watch it go red.
   - **The member lookup reads the whole directory** (F6). `Directory.people`
     selected every current membership and filtered in JavaScript, and the
     identity hook calls it on every request: 10 ms at 6000 members, against
     0.02 ms for `membershipOf`. **Done in lg-21**, whose per-household books
     are attached by that hook: `Directory.members(household)` filters in the
     SQL. Nothing is left of it here.

**Traps.**

- A member's history shows other members' addresses. It shows them only within
  their own household, and a test proves that.
- The admin screen lists every household. Showing it to anyone but an admin is the
  leak the sweep exists to catch.

## Done when

1. An admin creates a household, adds and removes members, and the new household
   can sign in to empty books of its own; API and web tests prove it.
2. A member adds a member to their own household and sees its history, and can
   remove nobody; tests prove both.
3. The authority sweep proves every admin route refuses a non-admin, every
   household route refuses a member of another household and an admin in no
   household, and every route refuses an admitted address that is neither,
   with nothing changed. The Log records that it failed with one guard loosened.
4. Every new route is rate limited (`route-limits.test.ts`).
5. The schema refuses an `INSERT OR REPLACE` over an existing membership or
   household, and the source scan fails on a planted `REPLACE` and on a quoted
   table (step 9).
6. Gates green.

## Log

- 2026-10-12 — Filed with lg-20, lg-21 and repo-98. The owner chose the admin
  screen over a host command alone, and chose that members add but do not remove,
  over members adding and removing anyone but the last.
- 2026-10-12 — Reviewed before merge. Access keeps its allowlist, so a member's
  add now tells them the operator must admit the address; a member's refusal
  is one generic answer, because the specific one was an oracle over every
  address; admin routes get a limiter keyed on the address; and the sweep gains
  the two identities lg-20 now lets through the hook without a household.
- 2026-10-12 — Step 9 and Done-when 5 added from lg-20's gate 1 (F2, F6), which
  the owner chose to fold here rather than fix on lg-20.
- 2026-10-12 — The owner answered lg-23's Question 4: "remove a member" removes
  an address, and the person's name stays in the books. This ticket lands
  before lg-23 and keeps refusing a third person name. lg-23 changes that test
  when it lifts the cap.
- 2026-10-12 — Step 9's F6 (the member lookup reading the whole directory) was
  folded into lg-21, which puts that lookup on every request's books path:
  `Directory.members(household)` now filters in the SQL. Measured on the built
  class with 6000 members in 3000 households, `people(household)` went from
  9.853 ms to 0.031 ms a call (`membershipOf` 0.016 ms). F2 stays here.
- 2026-10-13 — Built on `lg-22` from `main` at `6d879b26`.
  - **The routes.** `api/src/routes/households.ts`: a household's own under
    `/api/households/:id` (`GET` its members and history, `POST …/members` to
    add), guarded by `memberOf(request, id)` in `api/src/identity.ts`, which
    refuses a member of another household and, through `personOf`, an admin in
    none; and the admin's under `/api/admin/households` (`GET` every household
    with its members, `POST` a new one, `POST …/:id/members` to add,
    `POST …/:id/members/remove` to remove), guarded by `adminOf`. Every guard runs
    before the body is read. Each change is a directory record whose `by` is the
    caller's lower-cased address. A new household gets its books the way lg-21
    gives any: on the first request or probe that needs them.
  - **Errors.** Four ledger codes, with their statuses in `http-errors.ts`:
    `ADDRESS_ALREADY_A_MEMBER` (409, the admin's, whose sentence names the
    household), `MEMBER_NOT_ADDED` (409, the member's one answer for that and for
    `HOUSEHOLD_FULL`), `HOUSEHOLD_NOT_FOUND` and `MEMBER_NOT_FOUND` (404).
    `Directory` throws the first, third and fourth where it threw `BAD_REQUEST`;
    the host command prints the same sentences and exits 1 as before.
  - **Rate limits.** `rateLimitsFor` has `adminRead` and `adminWrite`, keyed
    `admin:<address>` through `adminOf`, so a non-admin is refused before a token
    is spent, with the limits on or off; the log line carries no key for them.
    `route-limits.test.ts` walks the five new routes as alex made an admin as
    well as a member, `POST adminHouseholds` in the two-verb block, and three
    tests of the admin key.
  - **The authority sweep failed first, once per guard.** `api/test/authority.test.ts`,
    `npx vitest run tools/ledger/api/test/authority.test.ts`, each guard restored
    after:
    - `memberOf` without its household check: exit 1, `Tests  1 failed | 10 passed (11)`,
      "refuses a member of the other household, and changes nothing",
      `+ "GET /api/households/home: 200 {\"household\":{\"id\":\"home\"…`,
      `+ "POST /api/households/home/members: 200 {\"address\":\"casey@example.test\",\"person\":\"sam\"}"`,
      `- "directoryChanged": false` / `+ "directoryChanged": true`. The admin in no
      household stayed refused, by `personOf`.
    - `adminOf` without its admin check: exit 1, `Tests  1 failed | 10 passed (11)`,
      "refuses a member who is no admin, and changes nothing", all four admin
      requests answered 200, the last
      `POST /api/admin/households/home/members/remove: 200 {\"address\":\"sam@example.test\",\"person\":\"sam\"}`,
      `"directoryChanged": true`.
    - Restored: `Tests  11 passed (11)`. Each request in the sweep is one its
      controls see succeed as the right identity, and the sweep compares every
      directory record and every table of both households' books.
  - **"Can remove nobody" failed first too**: with `adminOf` loosened,
    `households.test.ts` › "can remove nobody, through any route" went red with
    a `remove` record `by: "sam@example.test"`. Its first version sent one body
    with extra keys to every route, which the strict schemas refused, and it
    stayed green with the guard off; it now sends each shape a removal takes.
  - **Step 9, F2.** Directory migration 2 adds `BEFORE INSERT` triggers refusing
    a `memberships` id or a `households` id that exists. Before it,
    `npx vitest run tools/ledger/api/test/directory.test.ts`: exit 1,
    `Tests  1 failed | 14 passed (15)`, "the schema refuses an INSERT OR REPLACE…",
    `INSERT OR REPLACE INTO memberships (…) VALUES (1, 'alex@example.test', 'home', 'alex', 'remove', …): expected [Function] to throw an error`.
    After: `Tests  15 passed (15)`, and 16 with a test that a directory at migration 1 takes the trigger on its next open.
    An upsert (`ON CONFLICT DO UPDATE`) meets the same trigger. The scan's pattern
    is `api/test/helpers/append-only.ts`; the old one returned `false` for both
    plants (`node -e`), and with the new one each planted line in `directory.ts`
    took the scan red alone (`Tests  1 failed | 14 skipped (15)`,
    `+ "directory.ts"`): `INSERT OR REPLACE INTO memberships (id) VALUES (1)` and
    `UPDATE "memberships" SET person = 1`. A test holds the pattern to eleven
    planted statements and three innocent sentences.
  - **Step 9, F6: done in lg-21, confirmed in the code.** `Directory.members(household)`
    selects `WHERE household_id = ?` (`api/src/directory.ts`), and `Books.forMember`
    calls `people(household)`. Nothing of it was left here.
  - **The screens.** `web/src/household/Household.tsx` (members, history newest
    first, the add form; no remove button anywhere), `web/src/admin/Admin.tsx`
    (each household with remove behind a confirm and an add form, a new
    household, and "Addresses to admit"), sharing `MemberForm.tsx`, whose note
    says every address must also be admitted on the Access policy. The shell
    gives a member a Household tab and an admin an Admin tab; an admin in no
    household, whom `/api/me` refuses, is shown the admin's screen alone, found
    by asking for the admin's list before saying "no household".
  - `npm test -- --project ledger`: `Test Files  56 passed (56)`,
    `Tests  954 passed (954)`. `npm run check`: exit 0.
  - **What the brief had wrong, or left open.**
    - _A household route refuses a member of the other household with 403_: true
      only if the route names a household, so these take `:id` and a guard. The
      alternative, the household taken from the identity as `booksOf` takes the
      books, needs no guard and so has none to sweep. Recorded as an open decision
      in the build report.
    - _An admin sees households_: an admin in no household is refused by
      `/api/me`, which the web read as "no household". The shell now asks for the
      admin's list on that refusal rather than widening `MeResponse`. Also in the
      build report.
    - A member is told only that an address cannot be added for an address
      already in their own household too, though that one is no oracle: one
      answer is simpler and leaks nothing.
    - `docs/02-DEPLOYMENT.md` and the README said the directory is written from
      the host until lg-22; both now say who manages it from the app.
  - **Fold-in:** the books' own append-only scan in
    `classification-schema.test.ts` had the same blind spot (F2 said so) and now
    uses the same pattern; a planted `INSERT OR REPLACE INTO rules` in
    `api/src/rules.ts` takes it red (`+ "rules.ts"`). The books have no
    `BEFORE INSERT` triggers, and adding them is a migration per table that
    nothing asked for, so it was not folded.
