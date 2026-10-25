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
  every screen shows the name, proved by a web test that no UUID is rendered.
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
