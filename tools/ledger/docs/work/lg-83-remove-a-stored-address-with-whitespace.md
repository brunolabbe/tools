---
id: lg-83
tool: ledger
title: A stored address holding whitespace cannot be removed
kind: fix
status: needs-decision
milestone: null
depends_on: [lg-82]
difficulty: standard
---

# lg-83 — A stored address holding whitespace cannot be removed

## Why

`removeMember` reads the address it is given through `readStoredAddress`, and
`readStoredAddress` refuses an address that `ADDRESS_SHAPE` does not match.
`ADDRESS_SHAPE` is `/^[^\s@,;]+@[^\s@,;]+$/u`, and `\s` is every whitespace
character JavaScript knows, not six of them. So a stored address holding one
after its `@` is listed and then cannot be named for removal:
`household:ledger remove` answers `That is not an email address.` with exit 1,
and the row stays. The admin routes that reach the same code refuse it too:
`ROUTES.adminMemberRemove` calls `removeMember`, and `ROUTES.adminMemberAddress`
calls `changeAddress`, which reads its `from` through `readStoredAddress`, so a
person holding such an address cannot be moved off it either (code read, not run).

The refusal is the lg-20 shape, not the lg-52 control set. The `\s` exclusion
first appears in `b8a78192` (lg-20) under the name `ADDRESS`; lg-52 (`d84c8852`)
renamed it `ADDRESS_SHAPE` and split the control set `UNSEEN` out beside it. The
write paths all refuse `\s` today: `readAddress` is the only reader they use for
a new address, and the only `INSERT INTO memberships` under `tools/ledger/api/src`
is `#record`, which takes the address already checked. So a row holding whitespace
exists only if it predates lg-20, or was written outside the code (raw SQL, an
older build). Whether any does is not measured (Decision, question 2).

The six characters lg-82's gate named are the ones that `\s` and `UNSEEN` both
cover (TAB, LF, VT, FF, CR, U+FEFF). `\s` covers more, and the reproduction below
shows the ASCII space, NBSP, U+2028 and U+3000 refused the same way. Any fix
has to say which set it means.

## Reproduction

Run on `origin/main` at `d7cd223f`, in a worktree farmed and built with
`npm run build` (the ledger API reads `contract` and `engine` through `dist`).

A throwaway spec was written under `tools/ledger/api/test/`, run, and deleted; it
is not committed. Its essentials:

```ts
// the schema, then a row written by raw SQL, as lg-82's household-command.test.ts seeds its rows
Directory.open(directoryPath).close();
const db = new Database(directoryPath);
db.prepare(
  "INSERT OR IGNORE INTO households (id, name, created_at, created_by) VALUES (?, 'Home', 'x', 'operator')",
).run("00000000-0000-4000-8000-000000000001");
db.prepare(`INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
  VALUES (?, ?, ?, 'add', 'x', 'operator')`).run(
  `u@ex${character}z.test`,
  "00000000-0000-4000-8000-000000000001",
  "u",
);
db.close();
// then the command, with a captured io
runHouseholdCommand(["remove", address], {
  stdout,
  stderr,
  env: { DIRECTORY_PATH: directoryPath },
  cwd: dir,
  now: () => NOW,
});
```

The character is written with `String.fromCharCode`, after the `@`, since the
schema's `GLOB '?*@?*'` stops at a NUL before it. The spec asserted the refusal and
that the row still stands, and it passed on main:

```
$ npx vitest run tools/ledger/api/test/lg83-probe.test.ts --reporter=verbose
 ✓ ... > control: a clean stored address is removed 61ms
 ✓ ... > remove refuses a stored address holding TAB U+0009 after the @ 45ms
 ✓ ... > remove refuses a stored address holding LF U+000A after the @ 41ms
 ✓ ... > remove refuses a stored address holding VT U+000B after the @ 40ms
 ✓ ... > remove refuses a stored address holding FF U+000C after the @ 46ms
 ✓ ... > remove refuses a stored address holding CR U+000D after the @ 40ms
 ✓ ... > remove refuses a stored address holding BOM U+FEFF after the @ 43ms
 ✓ ... > remove refuses a stored address holding SPACE U+0020 after the @ 42ms
 ✓ ... > remove refuses a stored address holding NBSP U+00A0 after the @ 44ms
 ✓ ... > remove refuses a stored address holding LINE SEPARATOR U+2028 after the @ 47ms
 ✓ ... > remove refuses a stored address holding IDEOGRAPHIC SPACE U+3000 after the @ 37ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

What the command printed, from the results file written during that run
(`/tmp/claude-1000/-workspaces-tools/e40b98cb-4db1-487a-8b4c-ef819046cf02/scratchpad/lg-83/build/probe-results.json`):

| Stored character                           | Stored before | `remove` exit                             | stderr                          | Row still stands |
| ------------------------------------------ | ------------- | ----------------------------------------- | ------------------------------- | ---------------- |
| clean control `u@exz.test` (no whitespace) | yes           | 0, prints `Removed clean@exz.test from …` | empty                           | no (removed)     |
| TAB U+0009                                 | yes           | 1                                         | `That is not an email address.` | yes              |
| LF U+000A                                  | yes           | 1                                         | `That is not an email address.` | yes              |
| VT U+000B                                  | yes           | 1                                         | `That is not an email address.` | yes              |
| FF U+000C                                  | yes           | 1                                         | `That is not an email address.` | yes              |
| CR U+000D                                  | yes           | 1                                         | `That is not an email address.` | yes              |
| BOM U+FEFF                                 | yes           | 1                                         | `That is not an email address.` | yes              |
| SPACE U+0020                               | yes           | 1                                         | `That is not an email address.` | yes              |
| NBSP U+00A0                                | yes           | 1                                         | `That is not an email address.` | yes              |
| LINE SEPARATOR U+2028                      | yes           | 1                                         | `That is not an email address.` | yes              |
| IDEOGRAPHIC SPACE U+3000                   | yes           | 1                                         | `That is not an email address.` | yes              |

The lg-82 branch (`lg-82-unseen-characters-in-names`, head `c6c68679`) pins this
refusal in `tools/ledger/api/test/household-command.test.ts`, in the test that
calls `remove` on each of the 69 `UNSEEN_CHARACTERS`: a character that `\s` covers
must answer exit 1 and `That is not an email address.`, with the comment "a stored
address with a TAB or a BOM in it cannot be removed at all". That test changes with
whichever remedy is chosen.

The admin HTTP routes were not run; their refusal is read from the code, as above.

## Decision — open

**Question 1 — open: which remedy.** Nothing here is measured past the probe
above; the costs are read from the code. No recommendation is made.

- **(a) `remove` matches the stored row by exact string.** `removeMember` (and
  `changeAddress`'s `from`) trims and lower-cases the input, the form the schema's
  `CHECK` stores, and looks it up with `membershipOf`, with no shape check. Cost: a
  malformed `remove` answers `MEMBER_NOT_FOUND` ("belongs to no household") instead
  of `That is not an email address.`, and the admin routes answer that code too. The
  lookup splits nothing, so the shape rule's reason (nothing a list or a shell would
  split on) does not reach it. Needs lg-82's escape at `remove`'s sink before a
  whitespace address is printed. Changes the lg-82 test from pinning the refusal to
  pinning the removal.
- **(b) `remove` accepts a shape that tolerates whitespace.** A second pattern beside
  `ADDRESS_SHAPE`, used only for the stored read, which the write path does not use.
  Cost: two patterns that must agree about the stored form and can drift apart; the
  set has to be chosen (the six, or all of `\s`, which is wider than the six); and the
  shape rule's reason does not apply to a lookup key either, so the second pattern
  keeps a check that no longer protects anything. Also needs lg-82's escape before a
  whitespace address prints.
- **(c) Leave the refusal, and name the out-of-band remedy.** No code change; lg-82's
  test stays. Cost: no command or admin route can remove such a row or move its
  person. The triggers `memberships_never_updated` and `memberships_never_deleted`
  forbid an SQL `UPDATE` or `DELETE`, so the only remedy is dropping those triggers
  for one statement, under a backup, or restoring from a backup taken before the row.
  The row stays in `household:ledger list`. It blocks no add, because no command can
  type its exact string.
- **(d) `remove` by row id, not by address.** The `memberships.id` integer key; the
  operator would name the row, and `list` would print the ids. Cost: a new input and
  a new column on `list`, and for the admin route a change to `contract/src/api.ts`
  (`removeMemberRequestSchema`), which CLAUDE.md says to stop and report, not to edit
  alone. Nothing about the string is then parsed at all.

I found no fifth remedy that avoids both the shape question and the lookup
question.

**Question 2 — open: does any live directory hold such a row.** Not measured. It is
an operator step, as lg-82's question 2 framed it. The check is read-only: from the
worktree root, `node <scan>.mjs <directory.db>`, with `<scan>.mjs` reading
`SELECT address FROM memberships` through `better-sqlite3` opened `readonly`, and
printing each address where `/\s/u.test(address)`. The scan was checked on a
three-row stand-in table (one clean, two with whitespace); it flagged the two, and it
was not run on a real directory. A hit means a row predating lg-20 or written
outside the app, by the code reading above.

## Done when

1. The owner's answer to question 1 is recorded under a `## Decision — answered
   <date> by <who>` heading, with the options it was chosen from, and `status` moves
   to `ready` in the same commit.
2. Whichever remedy is chosen, a spec asserts for each of the ten `\s` characters
   listed in the Reproduction what `remove` now does with a stored address holding it
   (removed, with the row out of `current_members`, for (a), (b) and (d); refused with
   the stored row standing, for (c)), and lg-82's `remove` test is changed to match.
3. Question 2 is measured on the live directory by an operator, and the count is
   recorded in the Log.

## Log

### 2026-10-31 — filed on the owner's decision (maintenance dispatch, builder)

**Owner's decision, 2026-10-31.** The defect is filed as its own ticket, not folded
into lg-82 and not only recorded. Options the owner had: keep it in lg-82's pull
request; file it; record it in lg-82's gate. The remedy is an open question, so the
ticket is `needs-decision`.

**Reproduction on main `d7cd223f`.** Command and output are in the Reproduction
section: `npx vitest run tools/ledger/api/test/lg83-probe.test.ts --reporter=verbose`,
`Tests 12 passed (12)`, with the control removed (exit 0) and each of the ten
characters refused (exit 1, `That is not an email address.`, row standing). The
throwaway spec was deleted and is not committed. Build: `worktree-farm.sh`, then
`npm run build`, exit 0.

**What the brief had wrong.**

1. "One of the six `\s` characters" reads as the whole of `\s`. The six are the
   characters `\s` and `UNSEEN` both cover; `\s` also covers ASCII space, NBSP, U+2028
   and U+3000, and each of those is refused the same way (probe rows 7–10).
2. "`ADDRESS_SHAPE` first appears in `d84c8852` (lg-52)" is right about the name and
   wrong about the rule. `git log -S'[^\s@,;]+@[^\s@,;]+'` returns `b8a78192` (lg-20)
   as the first commit, where the regex is named `ADDRESS`. lg-52 renamed it and
   added `UNSEEN` beside it.
3. The gate named `household:ledger remove` as the only reach. The admin routes
   `ROUTES.adminMemberRemove` (`removeMember`) and `ROUTES.adminMemberAddress`
   (`changeAddress`'s `from`) refuse the same way. Read from the code, not run.

**Fold-in.** None. Nothing else small and already specified became free. lg-82's own
escape at `remove`'s sink is lg-82's work, and it is a precondition here, not a part.

**Not measured.** Question 2 (the live directory) and the admin routes' responses.
