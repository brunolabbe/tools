---
id: lg-75
tool: ledger
title: The admin card marks an email that has never signed in
kind: work-package
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-75 — Mark an email that has never signed in

## Why

An email the admin mistypes into a household is never confirmed and never
refused: Cloudflare Access proves an address at every sign-in (one-time PIN, or
an identity provider), so a typo cannot sign in as anyone, but nothing in the
ledger says it has never been used. The admin learns of it when the person says
they cannot get in. The fix for a typo already exists, changing the address in
place (lg-34); finding it does not.

## Decision — answered 2026-10-25 by the owner

Asked whether an email should be confirmed before a household is created, with
options: no, but mark an email that has never signed in; no, leave it; yes, by a
confirmation email (a mail provider, its secrets, a pending household state, and
a repeat of what Access already proves). The owner chose **the mark**.

## Build

1. **Directory**: a new migration adds a `first_sign_ins` table, one row per
   address with the instant it was first seen, written with `INSERT OR IGNORE`
   and never updated. Only the first sign-in is kept: this is not an activity
   log, and it must not become one.
2. **Where it is written**: the identity hook resolves the caller's membership
   on every request (`api/src/access.ts`, `directory.membershipOf`). Record the
   first sign-in there, for an address that is a member, remembering in memory
   which addresses are already recorded, so a request after the first writes
   nothing — the shape `createEnroller` uses in `api/src/people.ts`. A failed
   write (the directory busy) must not fail the request; the next one retries.
3. **Contract and route**: each member in `AdminHouseholdsResponse` carries
   whether its address has signed in (and when, first). Admin only: the
   household's own route does not carry it. The owner approved this contract
   change in the decision above.
4. **Web** (`web/src/admin/Admin.tsx`): an address that has never signed in
   reads "Never signed in" beside it, on the household card and in the "to
   admit" list. After an address is changed (lg-34), the new one starts unmarked
   as signed in, which is right: it has not been used. `e2e/layout.spec.ts`
   passes at 360 px with the mark showing.

## Done when

- A member's first request records its address, and later requests write
  nothing, proved by tests.
- The admin listing reports a never-used address as such and a used one as
  signed in, proved by a test in `api/test/households.test.ts`; the household's
  own route does not carry it, proved by a test.
- A busy directory does not fail the request, proved by a test.
- The admin card shows the mark, proved by `web/test/admin.test.tsx`;
  `e2e/layout.spec.ts` passes.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

- 2026-10-25 — Filed from the owner's question while lg-71 was being re-scoped.
