---
id: lg-25
tool: ledger
title: A directory method given a non-string throws an untyped error
kind: fix
status: done
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

## Review

**Gate: PASS** — 2026-10-16 · `76ce7d52..a1c122f5` · Sonnet 5.5, depth narrow (the named attacks and the acceptance table; no full invariant sweep)

| Done when                                                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The 11 named calls throw `AppError` `BAD_REQUEST`; `members()`, `history()`, `households()` read the same before and after; the test is at the end of the suite and names the call | `api/test/directory.test.ts` › "a directory method given a value that is not of its type" › `test.each(REFUSALS)` "%s is refused as BAD_REQUEST, and changes nothing" ✓. 14 rows cover all 11 named calls plus `household: 7`, `at: "2026-10-12"` and `by: 7`. Two assertions carry it: `code(...)` equals `"BAD_REQUEST"`, and `stateOf(directory)` (members, `history("home")`, households) `toEqual` the snapshot taken first. The block is one pure-addition hunk after the old last line. Red at base: the head's spec against `76ce7d52`'s `directory.ts` gives `14 failed \| 21 passed (35)`, and all 14 failures are these rows. Green on the head: `35 passed (35)` |
| 2. `addMember({ household: null })` still throws `HOUSEHOLD_NOT_FOUND`; a test asserts it                                                                                             | `api/test/directory.test.ts` › "addMember({ household: null }) still names no household, as HOUSEHOLD_NOT_FOUND" ✓ (and its `undefined` twin). Able to fail: with the household guard changed to `typeof household !== "string"` both go red. It also passes at base, as a regression row should                                                                                                                                                                                                                                                                                                                                                                             |
| 3. The ticket's reproduction on the branch prints `BAD_REQUEST` for every row except `history`/`household` and `addMember({household: null})`; `rows after:` unchanged                | **verified**. The script was extracted from the ticket's own ```ts block by a script (not retyped) and run with `node --import tsx` on the head: `addMember` address null/undefined, person null/7, household `{}`; `removeMember` address null; `membershipOf` null/undefined; `addHousehold` at null, by null, by undefined → all `AppError code=BAD_REQUEST`. `addMember({household: null})` → `HOUSEHOLD_NOT_FOUND`; `history(null) / household(null)` → `returned [[],null]`; `rows after: [{"id":"home","name":"Home"}]`. The same script on the base reproduces the ticket's recorded output row for row                                                              |
| 4. `npm run check` exits 0 and `npm test -- --project ledger` passes                                                                                                                  | **proven by CI on this head**: `gh pr checks 495` at head `a1c122f5` — `check` pass, `test (ubuntu-latest)` pass, `CodeQL` pass, `codeql` pass, `docker` pass, `dependency-review` pass. `test (windows-latest, informational)` was still pending when read; it is not graded, and the diff is pure logic with no path or process code. I re-ran only the narrow spec: `npx vitest run tools/ledger/api/test/directory.test.ts` → `35 passed (35)`                                                                                                                                                                                                                           |

**The dispatch's six attacks, in order**

1. _Reproduction vs Done when 1–3._ Done above: 13 of 13 rows as required. I added 20 rows of my own beyond the ticket's script (other types, other fields, other methods); results are under F1–F3.
2. _Household null, undefined, 7, `{}`._ Head: `null` → `HOUSEHOLD_NOT_FOUND`; `undefined` → `HOUSEHOLD_NOT_FOUND` (same as base); `7` → `BAD_REQUEST` (base: `HOUSEHOLD_NOT_FOUND`); `{}` → `BAD_REQUEST` (base: `RangeError`); `[]` → `BAD_REQUEST` (base: `RangeError`). That meets Done when 1 (`{}`), Done when 2 (`null`) and the Decision. The carve-out departs from Build step 1's literal "checked with `typeof`" on purpose, and the Log says so. The only behaviour change nobody asked for is `7`: F2.
3. _Can "changes nothing" fail?_ Yes. Positive controls on the detached tree, each restored with `git checkout a1c122f5 -- tools/ledger/api/src/directory.ts` (`git status --porcelain` empty after each): a write to `households` before the refusal in `removeMember` → the `removeMember({ address: null })` row red on the state assertion (the diff shows the `leak` household); a membership record written before the guards in `addMember` → 4 refusal rows plus the 2 `HOUSEHOLD_NOT_FOUND` rows red (the mutant sits after the household guard, so `{}` and `7` stay green) and 6 older tests; a household write before the `by` guard in `addHousehold` → `by: null`, `by: undefined`, `by: 7` red; a household write at the top of `membershipOf` → `membershipOf(null)` and `membershipOf(undefined)` red; person guard deleted → the two `person` rows red; household guard dropped → `{}` and `7` red. One mutant stays green and should: the `by` guard moved inside the transaction after the INSERT is rolled back, so nothing observable differs (`by: 7` passed; `by: null` and `by: undefined` went red only because the NOT NULL constraint threw first, so the code assertion failed).
4. _Does a message carry the offending value?_ No. Every new message is a literal with no interpolation. Probe: 10 hostile values (array, object with a `toString`, `String` object, bigint, symbol, null-prototype object, throwing `toString`, function, boolean, NaN) into each of the 7 guarded arguments = 70 calls on the head: 70 `AppError` `BAD_REQUEST`, 0 containing the marker. Positive control: the same probe on the base finds 1 leak (an array household echoed by `HOUSEHOLD_NOT_FOUND`) and 67 non-`AppError` or no-throw results. The existing `There is no household "…"` echo now only ever receives a string, `null` or `undefined`.
5. _Existing tests moved?_ No. `git diff -U0 76ce7d52...HEAD -- tools/ledger/api/test/directory.test.ts` is one hunk, `@@ -532,0 +533,136 @@`, with no deleted line. `git diff --stat`: `directory.ts` 25 lines changed, `directory.test.ts` 136 insertions and 0 deletions. No file in `tools`, `docs`, `scripts` or `.claude` cites `directory.ts` or `directory.test.ts` by line number.
6. _Table methods or arguments left unguarded?_ None. `addMember` (`household`, `address`, `person`), `removeMember` (`address`), `membershipOf` (`address`) and `addHousehold` (`at`, `by`) are all guarded, and `history(null)` / `household(null)` are unchanged as the Decision says. What the table does not enumerate is F1.

**Findings**

- **low** · no `Done when` line depends on it · **F1, open decision** · `addMember` and `removeMember` have the same shape as `addHousehold`'s `at` and `by` and are left unguarded, outside the answered Decision. Measured on the head: `addMember({at: null})` `TypeError`; `addMember({by: null})` and `({by: undefined})` `SqliteError SQLITE_CONSTRAINT_NOTNULL`; `removeMember` of a standing member with `at: null` `TypeError` and with `by: null` `SqliteError`; each leaves the state unchanged. The Log lists these rows and says "each rolls back, so nothing is stored". **That does not hold for `addMember({ by: 7 })`, which the Log does not list: it returns normally and writes `"by":"7.0"` into `history("home")`**, the same silent mis-store that justified guarding `addHousehold`'s `by`. No live call site: the three route calls and the host command pass a string `by` and a `Date` `at`. Options: **(a)** widen this branch with an `instanceof Date` check and a `typeof` check in each of the two methods and about 5 refusal rows appended at the end of the suite; it is the owner's call, because the Decision named `addHousehold` only; **(b)** file a sibling ticket with the two scripts as its reproduction; **(c)** leave it. Recommendation: (a) if the owner confirms, since the owner took the wider option on the earlier question; otherwise (b). Not settled here. Reproduction: `node --import tsx unguarded.mts <tree>` and `by7.mts <tree>` in the gate's scratch directory.
- **low** · **F2** · `addMember({ household: 7 })` changes from `HOUSEHOLD_NOT_FOUND` at base to `BAD_REQUEST`. It is in neither the table nor Done when 2, and the Decision's reason for keeping `null` ("already typed, a regression row") applies to `7` equally. The Log declares it and a test pins it (the `addMember({ household: 7 })` row of `REFUSALS`); it agrees with Done when 1's `{}` row. It errs on the side of more refusals, the safe direction. No live call site (`addMemberRequestSchema` is `z.string()`). Recorded; no action asked.
- **low** · **F3** · Two comments in `directory.ts` say something false, both in the safe direction and about a detail nothing relies on. In `addMember`: "refused before SQLite binds it, as `{}` was". At base `{}` was not refused: it reached the driver and threw a `RangeError` ("Too few parameter values were provided"). In `addHousehold`: "A non-string `by` was stored as a number". The column is `TEXT`, so the stored value is the text `"7.0"` (`CREATE TABLE t(x TEXT NOT NULL)`, bind `7`, `typeof(x)` is `text`, `x` is `7.0`).
- **low** · **F4** · Build step 1 says the message "does not echo the value", and no test asserts it. The 70-call probe shows it holds on the head and each new message is a literal; the gap is that a later edit adding `${value}` would pass the suite. No `Done when` line covers it. A fix would be one assertion in the `REFUSALS` loop that passes a marker string as the offending value and checks the message neither contains it nor is empty (the companion that fails on empty output).
- **dropped** · `addHousehold({ at: new Date(NaN) })` is still a `RangeError` ("Invalid time value"), because an invalid `Date` is an `instanceof Date`. The Decision chose `instanceof`, the ticket's own Log names that as a small judgement, and the builder's Log records the row as not covered. Not a defect against the answered Decision, and no live call site (`context.now()`).
- **findings** · the hunt returned 5; 4 carried (F1–F4), 1 dropped.
- NFR: security ✓ (no value reaches a message; 70 of 70 refused) · performance n/a · reliability ✓ (a refusal runs before the transaction opens and changes no state; F1 is the residue) · maintainability — F3 and F4.

Skipped from the invariant walk, by the dispatch's scope: tool isolation, shell, redaction, SSRF, progress, contract edits (the diff does not touch `contract`, the request schemas or the routes), test registration (`directory.test.ts` is an existing spec file), Dockerfile (no new workspace dependency). Style checked on the diff: no `any`, no `console`, no new import.

### Gate 2

**Gate: PASS** — 2026-10-17 · `a1c122f5..c1074aa5` · Sonnet 5.5, depth narrow (the round's own commits: the code and tests, and the ticket Log; nothing earlier re-run beyond the probes named below). Nothing found is a `high`; a third gate is not needed.

Round read: `git log --first-parent --no-merges a1c122f5..c1074aa5` is two commits, the code and tests (`directory.ts`, `directory.test.ts`) and the ticket Log. `directory.ts` gains one helper, `refuseUnlessChange`, called first in `addHousehold`, `addMember` and `removeMember`; the test block is rewritten in place and extended; the ticket diff is Log only (the brief is unchanged).

**Verdicts on gate 1's findings**

| Finding                                                                                                                         | Verdict                                            | How it was verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** (low, open decision) `at` / `by` unguarded in `addMember` and `removeMember`; `addMember({ by: 7 })` stored `"by":"7.0"` | **fixed**; the owner chose to widen                | `unguarded.mts` and `by7.mts` from gate 1, re-run on this head. `addMember` with `at: null`, `by: null`, `by: undefined` or `at: new Date(NaN)`, and `removeMember` of a standing member with `at: null` or `by: null`, are now `AppError code=BAD_REQUEST`, each with "state unchanged: true". `by7.mts` now dies with an uncaught `AppError BAD_REQUEST: The change's author is not a string.` from `addMember`, which is the wanted outcome (at gate 1 it returned and wrote `"7.0"`). Gate 1's `repro.mts`, the ticket's script plus 20 rows of mine, 33 call rows: 28 are `BAD_REQUEST`; the other 5 are typed or unchanged (`addMember` household null, undefined and "ghost" → `HOUSEHOLD_NOT_FOUND`, `removeMember` with `household: 7` → `MEMBER_NOT_FOUND`, and the `history`/`household` row), and the first `rows after:` line is `[{"id":"home","name":"Home"}]`, unchanged |
| **F2** (low) `addMember({ household: 7 })` is now `BAD_REQUEST`                                                                 | **recorded, as asked**; the round did not touch it |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **F3** (low) two comments false in the safe direction                                                                           | **fixed**                                          | In `directory.ts` the `addMember` comment now says `{}` "reached the driver and threw a RangeError" (matches the base measurement); the `addHousehold` comment is replaced by "checked before the transaction opens", and the helper's doc comment says a number "was stored as text (`7` became `"7.0"`)", which matches the gate's measurement of the `TEXT` column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **F4** (low) the "message does not echo the value" step has no test                                                             | **fixed**                                          | Every row of `REFUSALS` now also runs with `["ECHO-MARKER-lg25"]` as the offending value (its `String` is the marker) and asserts the thrown value is an `AppError` whose message is not empty and does not contain the marker; the state is compared a second time. Able to fail, two mutants: `String(member.address)` appended to `addMember`'s address message → `2 failed \| 43 passed (45)` (the `addMember({ address: null })` and `({ address: undefined })` rows); `String(change.by)` appended to the helper's author message → `8 failed \| 37 passed (45)`, all eight `by` rows. In both the code assertion still passed, so the echo assertion is what went red. The 70-call probe (`echo.mts`: 10 hostile values into 7 arguments) on this head: 70 `BAD_REQUEST`, 0 leaks                                                                                                 |
| **dropped at gate 1, raised again by the builder as C**: `addHousehold({ at: new Date("x") })` a `RangeError`                   | **fixed** (the owner's widening answer covers it)  | `Number.isNaN(change.at.getTime())` in the helper. Removing that clause turns exactly three rows red: `addMember`, `removeMember` and `addHousehold` with `new Date("x")`. `unguarded.mts` prints `BAD_REQUEST` for `addHousehold` and `addMember` with `new Date(NaN)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Round checks the dispatch named**

- _Rows appended, no existing line moved._ `git diff -U0 76ce7d52...c1074aa5 -- tools/ledger/api/test/directory.test.ts` is one hunk, `@@ -532,0 +533,204 @@`, with no deleted line; `--stat` for the file is 204 insertions, 0 deletions. The block gate 1 read was rewritten inside that one hunk, and it is the branch's own addition, not a merged record. The 10 new rows sit among the block's other rows in `REFUSALS`, and the whole block is at the end of the suite: `addMember` at null / `new Date("x")` / by null / by undefined / by 7; `removeMember` at null / `new Date("x")` / by null / by 7; `addHousehold` `new Date("x")`.
- _Each asserts state unchanged._ All rows go through one `test.each(REFUSALS)` body, which asserts `code(...)` equals `"BAD_REQUEST"` and `stateOf(directory)` (members, `history("home")`, households) equals the snapshot, twice (after the value pass and after the marker pass). Positive controls on the detached tree, each restored (`git status --porcelain` empty after each): a household write before the helper call in `addMember` → 13 rows of the new block red (11 refusal rows and the 2 `HOUSEHOLD_NOT_FOUND` rows) and 5 older tests, 18 of 45; before the helper in `addHousehold` → all 6 `addHousehold` rows red (and 3 older tests); before the helper in `removeMember` → its `address`, `at`, `at: new Date("x")`, `by: null` and `by: 7` rows red (and 1 older test). Calls removed: the helper out of `removeMember` → exactly its four rows red (`at: null`, `at: new Date("x")`, `by: null`, `by: 7`); out of `addMember` → exactly its five (`at: null`, `at: new Date("x")`, `by: null`, `by: undefined`, `by: 7`); out of `addHousehold` → its six; the `by` check deleted from the helper → the 8 `by` rows red (`addMember` 3, `removeMember` 2, `addHousehold` 3).
- _Red against the gated source._ The new spec against `a1c122f5`'s `directory.ts`: `Tests 10 failed | 35 passed (45)`, and the ten failures are exactly the ten new rows. On the head: `45 passed (45)`. This matches the Log.
- _The Log's corrections._ Checked against measurements: the correction that `addMember({ by: 7 })` returned normally and stored `"by":"7.0"` (gate 1 measured it); the `10 failed | 35 passed (45)`, `45 passed (45)` and `2 failed | 43 passed (45)` counts (reproduced above); "`removeMember({ household: 7 })` returns `MEMBER_NOT_FOUND`" (still true on the head); the owner's answer is recorded with the question, the options, the answer, who and the date. One Log claim is incomplete: N1.
- _Done when 4._ `npm test -- --project ledger` on this head: `Test Files 60 passed (60)`, `Tests 1074 passed (1074)`, exit 0. CI at `c1074aa5`: `check` pass, `CodeQL` pass, `codeql` pass, `docker` pass, `dependency-review` pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still pending when read. The ubuntu leg runs the same command I ran locally, so the line is verified here and the leg is a confirmation, not the only proof; the lander reads the leg before its push.

**Findings in the round's lines**

- **low** · no `Done when` line depends on it · **N1, open decision (the builder's)** · The Log's last entry says `members({})` and `people({})` throw a driver `RangeError` and leaves them, "for the orchestrator to file or decide". The population is four reads, not two. Measured on the head with `reads.mts`: `members`, `people`, `history` and `household`, each given `{}` or `[]`, throw `RangeError` ("Too few parameter values were provided"); each given `null` or `7` returns `[]` or `undefined`. `history` and `household` are the two methods the owner's Decision, question 2, left "as they are", but that answer was put for `null`; `{}` was not put to the owner. No live call site: all 10 `src` callers pass a string (a path parameter, a membership row's `household`, an import argument) or nothing, enumerated with a grep of `tools/ledger` outside `test`. The Log's "Not changed" entry names two of the four, so a later reader would file two when four share the fault. Options: **(a)** leave all four reads as they are and correct the Log entry to name all four, consistent with the owner's Decision 2; **(b)** guard all four to refuse a non-string as `BAD_REQUEST` while `members` and `people` keep `undefined` as "every household": that turns `null` and `7` from an empty result into a refusal, so it reverses Decision 2 for `history(null)` and `household(null)` and needs the owner to say so; **(c)** file a sibling ticket, with `reads.mts` as its reproduction. Recommendation: (a), since no caller has ever given the reads a non-string and the owner has already chosen not to guard them; (c) if the owner wants the `{}` case guarded. Goes to the owner; not settled here.
- **dropped** · the echo pass does not run the invalid-`Date` rows' message path with a marker (their marker pass substitutes an array, which takes the "not a date" branch, the same literal). Not a defect: one literal message.
- **dropped** · `instanceof Date` is false for a `Date` from another realm. No such caller (`context.now()` and the host command's clock make a `Date` in the same realm), and the ledger project's 1074 tests pass on the head.
- **findings** · the hunt returned 3; 1 carried (N1), 2 dropped. Gate 1's F1 to F4 and the builder's C are each given a verdict in the table above: F1, F3, F4 and C fixed, F2 recorded.
- NFR: security ✓ (a refusal runs before any statement; no value reaches a message; the helper closes the one place a non-string was stored) · performance n/a · reliability ✓ (all three writes refuse a bad time or author before the transaction opens) · maintainability ✓ (one helper replaces the duplicated checks; N1 is the residue).

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
  outside the typing check this ticket asks for. Fixed in the fix round below.
- 2026-10-16 — Found in the build, and widened in the fix round below. The Decision
  named `addHousehold`'s `at` and `by` only, and the same shape was left in
  `addMember` and `removeMember`: `addMember({ at: null })` was a `TypeError`
  (`toISOString`); `addMember({ by: null })` and `addMember({ by: undefined })` were a
  `SqliteError` `SQLITE_CONSTRAINT_NOTNULL`; `removeMember` of a standing member with
  `at: null` was a `TypeError` and with `by: null` a `SqliteError`. **Correction:** the
  first draft of this entry said each of these "rolls back, so nothing is stored". That
  is true of the rows just named, but not of `addMember({ by: 7 })`, which returned
  normally and stored `"by":"7.0"` in `history("home")`. The gate measured it on
  `a1c122f5`. `removeMember({ by: 7 })` is refused by the same check now. The earlier
  line "`removeMember({ household: 7 })` returns `MEMBER_NOT_FOUND`" stands: it is typed.
- 2026-10-16 — Owner decision on the widening, recorded as asked. **Question** (the
  gate's F1, put by the coordinator): `addMember` and `removeMember` take an `at` and a
  `by` that are unguarded; `addMember({ by: 7 })` stores `"by":"7.0"`. The Decision
  scoped only `addHousehold`. **Options:** (a) widen this PR with an `instanceof Date`
  check and a `typeof` check in each of the two methods, about 5 refusal rows at the end
  of the suite, plus the invalid-Date check and the message-echo assertion; (b) file a
  sibling `lg-` ticket with the two gate scripts as its reproduction; (c) leave it.
  **Answer:** (a), widen this PR. The orchestrator recommended it, the gate recommended
  (a), and the owner chose it. **Date:** 2026-10-16. The same answer covers the invalid
  Date (`new Date("x")`) in `addHousehold` and both change methods, which the builder had
  raised as its open decision C.
- 2026-10-16 — Fix round, against the gate's findings on `a1c122f5`. A helper
  `refuseUnlessChange` checks `at` (a valid `Date`, by `instanceof` and
  `Number.isNaN(getTime())`) and `by` (a string). `addHousehold`, `addMember` and
  `removeMember` all call it before any statement runs. Ten new rows were appended at the
  end of the suite: `addMember({ at: null })`, `({ at: new Date("x") })`, `({ by: null })`,
  `({ by: undefined })`, `({ by: 7 })`; `removeMember({ at: null })`,
  `({ at: new Date("x") })`, `({ by: null })`, `({ by: 7 })`; and
  `addHousehold({ at: new Date("x") })`. Each asserts the code and that `members()`,
  `history("home")` and `households()` are unchanged. Against `a1c122f5`'s
  `directory.ts` the new rows are red: `npx vitest run tools/ledger/api/test/directory.test.ts`
  gave `Tests 10 failed | 35 passed (45)`, all ten the new rows. On the fix:
  `Tests 45 passed (45)`.
- 2026-10-16 — F4, the message-echo assertion. Every refusal row now also runs with an
  array `["ECHO-MARKER-lg25"]` as the offending value. Its `String` is the marker, so a
  message that interpolated the value would contain it. The row asserts the refusal is an
  `AppError` with a non-empty message that does not contain the marker. A mutant that
  adds the value to the address message (`String(member.address)`) turns two rows red:
  `npx vitest run tools/ledger/api/test/directory.test.ts` gave `Tests 2 failed | 43 passed (45)`.
- 2026-10-16 — F3, two comments corrected. The `addMember` comment said `{}` "was
  refused before SQLite binds it". At base `{}` reached the driver and threw a
  `RangeError`. The `addHousehold` comment said a non-string `by` "was stored as a
  number". The column is `TEXT`, so `7` became the text `"7.0"`.
- 2026-10-16 — The reproduction's `addHousehold({ at: new Date("x") })` row is now a
  `BAD_REQUEST`, not a `RangeError`. `addMember({ by: 7 })` is refused as
  `BAD_REQUEST` ("The change's author is not a string."). The `rows after:` line is
  unchanged.
- 2026-10-16 — Not changed, and outside the Decision. `members(household)` and
  `people(household)` take an optional `household`. `members({})` and `people({})`
  throw a `RangeError` at the driver, and nothing in the tree reaches them with a
  non-string. Found by the gate's `unguarded.mts` probe. The Decision names the write
  methods, so these are left for the orchestrator to file or decide.
- 2026-10-17 — Correction and answer, for the entry above, which names two of the four
  reads. The same fault is in four reads, not two: `members`, `people`, `history` and
  `household`. Each given `{}` or `[]` throws a `RangeError` ("Too few parameter
  values were provided") from the driver. Each given `null` returns `[]` or
  `undefined`, and each given `7` returns `[]` or `undefined`. Measured on the head
  `c1074aa5` with the gate's `reads.mts`
  (`node --import tsx reads.mts <tree>`, output: 16 lines, the four `{}`/`[]` rows
  `RangeError`, the other twelve returned). `history` and `household` are the two the
  owner's Decision 2 already left as they are. **Question** (gate 2's N1): what should
  happen to the four reads? **Options:** (a) leave all four and correct this Log;
  (b) guard all four here; (c) file a sibling `lg-` ticket with `reads.mts` as its
  reproduction. **Answer:** (a), leave all four, fix the Log. The owner chose it, against
  the builder's recommendation of (c); the gate recommended (a). **Date:** 2026-10-17.
  Nothing in the tree reaches the four reads with a non-string.
