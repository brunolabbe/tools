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
     selects every current membership and filters in JavaScript, and the
     identity hook calls it on every request: 10 ms at 6000 members, against
     0.02 ms for `membershipOf`. Filter by household in the SQL.

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
