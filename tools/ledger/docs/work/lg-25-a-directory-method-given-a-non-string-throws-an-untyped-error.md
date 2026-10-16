---
id: lg-25
tool: ledger
title: A directory method given a non-string throws an untyped error
kind: fix
status: ready
milestone: P6
depends_on: []
difficulty: mechanical
---

# lg-25 — A directory method given a non-string throws an untyped error

## Why

`Directory` (`tools/ledger/api/src/directory.ts`) takes its values from its callers
and trusts their type. Given a `null`, an `undefined`, a number or an object where it
expects a string, it fails inside a string method or inside the SQLite driver. The
error is a `TypeError`, a `RangeError` or a `SqliteError`, not an `AppError`; where
it does not throw, it returns an empty or `undefined` result. Nothing that is
reachable today sends one: the routes parse their bodies with
`addMemberRequestSchema`, `removeMemberRequestSchema` and `createHouseholdRequestSchema`
(all `z.string()`), the host command defaults each argument to `""`, and the Access
identity is a JWT claim checked `typeof email === "string"`. So this is the class's
own boundary, not a live route. The next caller that does not come through a schema
(a script, a new route that skips one) gets the untyped error instead of a refusal.

It is the same shape as lg-24's `addHousehold` finding. lg-24's gate 2 checked the
rest of `directory.ts` for it (its finding N3) and found the rows below. The owner
decided on 2026-10-15 to file one ticket for them.

## Decision — answered 2026-10-15 by the owner

Two questions were put to the owner, with the options below. Both are answered;
the choice is recorded here, and the Build follows it.

**1. Are `addHousehold`'s `at` and `by` fields in scope?**

Options as put to the owner:

- **Include at/by** — also `addHousehold`'s `at` and `by`: the same refusal on the two
  fields the table lists, before the transaction opens. Cost: two more checks and two
  more test rows. `at` is a `Date`, so its check is an `instanceof` test, not a
  `typeof` one. Recommended.
- **Methods only** — guard only `addMember` (`household`, `address`, `person`),
  `removeMember` (`address`) and `membershipOf` (`address`). `addHousehold` keeps its
  current behaviour for `at` and `by`: a `TypeError` and a `SqliteError
SQLITE_CONSTRAINT_NOTNULL`, both of which store nothing. Cost: the smallest diff,
  and two rows of the table stay untyped.
- **Leave it open** — file the ticket with this question unanswered.

**Chosen: Include at/by.** Recorded 2026-10-15, the owner's answer to the question above.

**2. Do `history` and `household` refuse a non-string as well?**

Stated to the owner with the options above: `history(null)` returns `[]` and
`household(null)` returns `undefined`; neither throws, and no route reaches them.
**Chosen: they stay as they are.** Recorded 2026-10-15, with question 1.

Under the chosen option, `addMember({ household: null })` keeps its current
`HOUSEHOLD_NOT_FOUND`: it is already typed, and it is a regression row, not a change.

**The error code.** `directory.ts` already refuses a bad household id with
`BAD_REQUEST` (its `refuse()` helper), and the code is defined in
`packages/core/src/errors.ts`. The Build uses it. The owner did not answer the code
separately; it is recorded in the Log as the likely code, not as an answered one.

## Build

The Decision is answered: `addHousehold`'s `at` and `by` are in scope, and
`history` and `household` stay as they are.

1. In `tools/ledger/api/src/directory.ts`, add a type check to each method the
   Decision puts in scope, before any string method or statement runs: `addMember`
   (`household`, `address`, `person`), `removeMember` (`address`), `membershipOf`
   (`address`), and `addHousehold` (`at`, `by`). Strings are checked with
   `typeof value === "string"`; `at` with `instanceof Date`. A failed check goes through the existing `refuse()` helper, so
   it is an `AppError` with `BAD_REQUEST`. The message names the field and does not
   echo the value.
2. Keep `readAddress`'s own refusal for a string that is not an address. The new check
   comes before it and does not replace it.
3. Do not change `contract`, the request schemas or the routes. They already refuse
   these values; this ticket is the class's own boundary.
4. Add the tests at the end of `tools/ledger/api/test/directory.test.ts`, not in the
   middle of the suite: a block inserted mid-file moves the citations of records
   already merged.
5. Each refusal test asserts two things: the error's `code` and that nothing changed.
   Use `members()`, `history()` and `households()` for that, not the return value of the
   call. A test that only checks the throw passes on a method that stores a row first.

## Done when

1. Each of `addMember({ address: null })`, `addMember({ address: undefined })`,
   `addMember({ person: null })`, `addMember({ person: 7 })`, `addMember({ household: {} })`,
   `removeMember({ address: null })`, `membershipOf(null)`, `membershipOf(undefined)`,
   `addHousehold({ at: null })`, `addHousehold({ by: null })` and
   `addHousehold({ by: undefined })` throws an `AppError` with code `BAD_REQUEST`, and
   `members()`, `history()` and `households()` read the same before and after. The test
   is in `tools/ledger/api/test/directory.test.ts`, at the end of the suite, and names
   the call in its title.
2. `addMember({ household: null })` still throws `HOUSEHOLD_NOT_FOUND`. A test asserts it.
3. The reproduction below, rerun on the branch, prints `AppError code=BAD_REQUEST` for
   every row except `history(null) / household(null)`, which stay as they are, and
   `addMember({household: null})`, which keeps `HOUSEHOLD_NOT_FOUND`. Its `rows after:`
   line is unchanged from the output recorded here.
4. `npm run check` exits 0, and `npm test -- --project ledger` passes.

## Reproduction

Run on `origin/main` at `8e49523c`, in a worktree with `worktree-farm.sh` and
`npm run build`. It drives `Directory` directly, on a directory with one household
(`home`). The `tree` argument is the worktree's path. The script is saved as a
`.mts` file, so `node --import tsx` loads it.

```ts
const tree = process.argv[2]!;
const { Directory } = await import(`${tree}/tools/ledger/api/src/directory.ts`);
const CHANGE = { by: "operator", at: new Date("2026-10-15T00:00:00Z") };

function run(fn: () => unknown): string {
  try {
    const r = fn();
    return `returned ${JSON.stringify(r)}`;
  } catch (e: any) {
    return `${e?.constructor?.name ?? typeof e} code=${e?.code ?? "none"} message=${String(e?.message).split("\n")[0]}`;
  }
}

const h = Directory.open(":memory:");
h.addHousehold({ id: "home", name: "Home", ...CHANGE });
const show = (label: string, fn: () => unknown) =>
  console.log(`  ${label.padEnd(52)} ${run(fn).slice(0, 140)}`);
show("addMember({address: null})", () =>
  h.addMember({ household: "home", address: null, person: "alex", ...CHANGE }),
);
show("addMember({address: undefined})", () =>
  h.addMember({ household: "home", address: undefined, person: "alex", ...CHANGE }),
);
show("addMember({person: null})", () =>
  h.addMember({ household: "home", address: "a@example.com", person: null, ...CHANGE }),
);
show("addMember({person: 7})", () =>
  h.addMember({ household: "home", address: "a@example.com", person: 7, ...CHANGE }),
);
show("addMember({household: null})", () =>
  h.addMember({ household: null, address: "a@example.com", person: "alex", ...CHANGE }),
);
show("addMember({household: {}})", () =>
  h.addMember({ household: {}, address: "a@example.com", person: "alex", ...CHANGE }),
);
show("removeMember({address: null})", () => h.removeMember({ address: null, ...CHANGE }));
show("membershipOf(null)", () => h.membershipOf(null));
show("membershipOf(undefined)", () => h.membershipOf(undefined));
show("history(null) / household(null)", () => [h.history(null), h.household(null)]);
show("addHousehold({at: null})", () =>
  h.addHousehold({ id: "away", name: "Away", by: "operator", at: null }),
);
show("addHousehold({by: null})", () =>
  h.addHousehold({ id: "away", name: "Away", by: null, at: CHANGE.at }),
);
show("addHousehold({by: undefined})", () =>
  h.addHousehold({ id: "away", name: "Away", by: undefined, at: CHANGE.at }),
);
console.log("  rows after:", JSON.stringify(h.households()));
h.close();
```

Output (`node --import tsx repro.mts <tree>`, Node v22, `tree` at `8e49523c`):

```
  addMember({address: null})                           TypeError code=none message=Cannot read properties of null (reading 'trim')
  addMember({address: undefined})                      TypeError code=none message=Cannot read properties of undefined (reading 'trim')
  addMember({person: null})                            TypeError code=none message=Cannot read properties of null (reading 'trim')
  addMember({person: 7})                               TypeError code=none message=member.person.trim is not a function
  addMember({household: null})                         AppError code=HOUSEHOLD_NOT_FOUND message=There is no household "null".
  addMember({household: {}})                           RangeError code=none message=Too few parameter values were provided
  removeMember({address: null})                        TypeError code=none message=Cannot read properties of null (reading 'trim')
  membershipOf(null)                                   TypeError code=none message=Cannot read properties of null (reading 'toLowerCase')
  membershipOf(undefined)                              TypeError code=none message=Cannot read properties of undefined (reading 'toLowerCase')
  history(null) / household(null)                      returned [[],null]
  addHousehold({at: null})                             TypeError code=none message=Cannot read properties of null (reading 'toISOString')
  addHousehold({by: null})                             SqliteError code=SQLITE_CONSTRAINT_NOTNULL message=NOT NULL constraint failed: households.created_by
  addHousehold({by: undefined})                        SqliteError code=SQLITE_CONSTRAINT_NOTNULL message=NOT NULL constraint failed: households.created_by
  rows after: [{"id":"home","name":"Home"}]
```

`history(null) / household(null)` prints `[[],null]` because `JSON.stringify` writes
the `undefined` that `household(null)` returns as `null` inside an array. It is
`undefined` in the call itself, which is what the gate's table recorded.

Against the gate's table (lg-24 gate 2, finding N3) the rows read the same, with one
wording difference: the gate wrote `addMember({ person: 7 })` as a `TypeError` at
`.trim`; the message is `member.person.trim is not a function`, which is also a
`TypeError`.

## Log

- 2026-10-15 — Filed from lg-24's gate 2, finding N3, which checked the directory's
  other methods for lg-24's `addHousehold` shape. The owner decided on 2026-10-15,
  answering that finding with "File one ticket". The reproduction is section 4 of
  the gate's script, rewritten above as a standalone file that takes the tree as its
  argument. It was run on `origin/main` at `8e49523c` before filing; the output is the
  one recorded in the Reproduction section. It was not run against lg-24's branch,
  which is not on `main` yet.
- 2026-10-15 — `status: needs-decision` at filing. Two questions were put to the owner
  with options, and the Decision section records both answers. The owner's answer to
  the first, whether `addHousehold`'s `at` and `by` are in scope, was "Include at/by",
  which was the recommended option; the owner's answer to the second, the
  `history` and `household` question, was that they stay as they are. The
  question, the options and the choice are in the Decision section. `status` moves to
  `ready` in the commit that records the answer. The error code `BAD_REQUEST` was
  not asked separately; it is the code `refuse()` already uses for a bad household
  id, and the owner's answer did not change it.
- 2026-10-15 — the difficulty doubt, carried in the filing report to the coordinator:
  `difficulty: mechanical` was set at filing and is not changed here, because ratings
  belong to the owner and the coordinator. Unsure between `mechanical` and
  `standard`: the error message's wording and whether `at` is checked by `instanceof`
  or by a parsed-date check are small judgements. The owner may re-rate it.
- 2026-10-15 — `difficulty: mechanical`. The change is one `typeof` or `instanceof`
  check per field, through the existing `refuse()` helper, with no schema or data
  change. Unsure between `mechanical` and `standard`: the call on the error message's
  wording and on whether `at` is an `instanceof` or a parsed-date check is a small
  judgement, and `standard` is the rating if the owner wants it written down as one.
- 2026-10-15 — `milestone: P6`, from lg-24 and for the same reason: the methods are
  lg-20's household directory, the Phase 6 work. The Phase 6 table in `02-ROADMAP.md`
  does not list lg-24 either, so this file adds no roadmap row.
- 2026-10-15 — `depends_on: []`. The reproduction runs on what is on `main`, and the
  change touches only `directory.ts` and its test, which lg-24 does not.
- 2026-10-16 — Built on `lg-25-directory-type-guards` from `origin/main` at 76ce7d52,
  in commit 817d7527. `directory.ts` refuses a non-string before any string method or
  statement runs, in `addMember` (`household`, `address`, `person`), `removeMember`
  (`address`), `membershipOf` (`address`) and `addHousehold` (`at`, `by`; `at` by
  `instanceof Date`). Each goes through `refuse()`, so the code is `BAD_REQUEST`, the
  code `refuse()` already uses; no reason to change it was found. The messages name the
  field and carry no value. The email refusal keeps its sentence.
- 2026-10-16 — The brief was wrong in one place. Build step 1 says strings are checked
  with `typeof`, which read literally refuses `addMember({ household: null })` as
  `BAD_REQUEST`. That contradicts Done-when 2 and the Decision's "keeps its current
  `HOUSEHOLD_NOT_FOUND`". The build follows Done-when 2: a missing household (`null` or
  `undefined`) goes to the lookup and answers `HOUSEHOLD_NOT_FOUND`; any other
  non-string household (`{}`, `7`) is `BAD_REQUEST`. The two tests that pin it are in
  `directory.test.ts`.
- 2026-10-16 — Tests appended at the end of `directory.test.ts`, under "a directory
  method given a value that is not of its type": 14 refusal rows, and the null and
  undefined household. Each refusal asserts the code and that `members()`,
  `history("home")` and `households()` read the same before and after. Against
  `origin/main`'s `directory.ts` (checked out from 76ce7d52 for the check, then
  restored from 817d7527): `npx vitest run tools/ledger/api/test/directory.test.ts` gave
  `Tests 14 failed | 21 passed (35)`. On the branch it gives `Tests 35 passed (35)`.
- 2026-10-16 — Reproduction rerun on the branch, the script from the Reproduction
  section with `addHousehold({ by: 7 })` added. Every row is `AppError` with
  `BAD_REQUEST`, except `addMember({ household: null })` and
  `addMember({ household: undefined })` (`HOUSEHOLD_NOT_FOUND`) and the `history` and
  `household` rows, which are unchanged. `rows after:` is `[{"id":"home","name":"Home"}]`.
  One row is not covered: `addHousehold({ at: new Date("x") })` is still a `RangeError`
  (`Invalid time value`), because an invalid `Date` is an instance of `Date`. It is
  outside the typing check this ticket asks for, and it is not fixed here.
- 2026-10-16 — Found, not fixed, and outside the answered Decision. The Decision names
  `addHousehold`'s `at` and `by`, and the same shape is left in two other methods:
  `addMember({ at: null })` is a `TypeError` (`toISOString`), and
  `addMember({ by: null })`, `removeMember({ address, by: null })` and
  `removeMember({ address, at: null })` (with a member that stands) are a `TypeError`
  or a `SqliteError` `SQLITE_CONSTRAINT_NOTNULL`. Each rolls back, so nothing is stored.
  They were not added here, because the owner was asked about `addHousehold` only. That
  is an open decision for the orchestrator: widen this branch, or file a sibling ticket.
  `removeMember({ household: 7 })` returns `MEMBER_NOT_FOUND`, which is typed, so it was
  left.
