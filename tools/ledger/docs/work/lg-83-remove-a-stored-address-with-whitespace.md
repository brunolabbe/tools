---
id: lg-83
tool: ledger
title: A stored address holding whitespace cannot be removed
kind: fix
status: done
milestone: null
depends_on: [lg-82]
difficulty: standard
---

# lg-83 — A stored address holding whitespace cannot be removed

## Why

`removeMember` reads the address it is given through `readStoredAddress`. That
trims and lower-cases it with JavaScript's `trim()` and `toLowerCase()`, then
refuses the result unless `ADDRESS_SHAPE` matches. `ADDRESS_SHAPE` is
`/^[^\s@,;]+@[^\s@,;]+$/u`, and `\s` is every whitespace character JavaScript
knows, 25 code points, not six. So a stored address holding one after its `@` is
listed and then cannot be named for removal: `household:ledger remove` answers
`That is not an email address.` with exit 1, and the row stays. The admin routes
that reach the same code refuse it too: `ROUTES.adminMemberRemove` calls
`removeMember`, and `ROUTES.adminMemberAddress` calls `changeAddress`, which reads
its `from` through `readStoredAddress`. Gate 1 measured both routes answering 400
`BAD_REQUEST` with that sentence, for each of the ten characters; that run is not
repeated here.

The refusal is the lg-20 shape, not the lg-52 control set. The table `memberships`
and the `\s` exclusion first appear together in `b8a78192` (lg-20), the exclusion
under the name `ADDRESS`. lg-52 (`d84c8852`) renamed it `ADDRESS_SHAPE` and split
the control set out beside it, as `CONTROL`; `UNSEEN` arrives in lg-57 (`59629aec`). Every write path checks its address before
`#record` writes it, and `#record` is the only `INSERT INTO memberships` under
`tools/ledger/api/src`. So a row holding whitespace can come only from raw SQL or a
hand-edited file. Whether any live directory holds one is answered by the owner
(Decision, question 2).

The ten characters below are 10 of the 25 code points `\s` matches. The other 15
are U+1680, U+2000 to U+200A, U+2029, U+202F and U+205F. They share the same
refusal and were not run. The six that `\s` and `UNSEEN` both cover (TAB, LF, VT,
FF, CR, U+FEFF) are the ones lg-82's gate first named.

## Reproduction

Run on `origin/main` at `d7cd223f`, in a worktree built with `npm run build`. The
branch changes no source, so the code is the same. The block below runs as printed:
copy it to `tools/ledger/api/test/lg83-reproduction.test.ts` from the worktree root,
run `npx vitest run tools/ledger/api/test/lg83-reproduction.test.ts --reporter=verbose`,
then delete the copy. It is not committed.

```ts
// lg-83's reproduction, as the ticket gives it. A throwaway: copy it to
// tools/ledger/api/test/lg83-reproduction.test.ts, run it, delete it.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Directory } from "../src/directory.ts";
import { runHouseholdCommand } from "../src/household-command.ts";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const ch = (code: number): string => String.fromCharCode(code);

// The six `\s` characters that UNSEEN also covers, then four more `\s` characters.
const TEN: [string, string][] = [
  ["TAB U+0009", ch(0x09)],
  ["LF U+000A", ch(0x0a)],
  ["VT U+000B", ch(0x0b)],
  ["FF U+000C", ch(0x0c)],
  ["CR U+000D", ch(0x0d)],
  ["BOM U+FEFF", ch(0xfeff)],
  ["SPACE U+0020", ch(0x20)],
  ["NBSP U+00A0", ch(0xa0)],
  ["LINE SEPARATOR U+2028", ch(0x2028)],
  ["IDEOGRAPHIC SPACE U+3000", ch(0x3000)],
];

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "lg83-repro-"));
  file = path.join(dir, "data", "directory.db");
  Directory.open(file).close();
  const db = new Database(file);
  db.prepare(
    "INSERT INTO households (id, name, created_at, created_by) VALUES (?, 'Home', 'x', 'operator')",
  ).run(HOUSEHOLD);
  db.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A row written by raw SQL, as lg-82's household-command.test.ts seeds its rows.
function seed(address: string, person: string): void {
  const db = new Database(file);
  try {
    db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, ?, ?, 'add', 'x', 'operator')`,
    ).run(address, HOUSEHOLD, person);
  } finally {
    db.close();
  }
}

function remove(address: string): { code: number; err: string } {
  let err = "";
  const code = runHouseholdCommand(["remove", address], {
    stdout: () => undefined,
    stderr: (text) => {
      err += text;
    },
    env: { DIRECTORY_PATH: file },
    cwd: dir,
    now: () => NOW,
  });
  return { code, err };
}

// By the exact stored text: membershipOf lower-cases with JavaScript's toLowerCase,
// which would miss a stored address whose domain holds a capital E-acute.
function stands(address: string): boolean {
  const db = new Database(file);
  try {
    return db.prepare("SELECT 1 FROM current_members WHERE address = ?").get(address) !== undefined;
  } finally {
    db.close();
  }
}

test("control: a clean stored address is removed", () => {
  seed("clean@exz.test", "c");
  const ran = remove("clean@exz.test");
  expect(ran.code, ran.err).toBe(0);
  expect(stands("clean@exz.test")).toBe(false);
});

test.each(TEN)("remove refuses a stored address with %s after the @", (_label, character) => {
  const address = `u@ex${character}z.test`;
  seed(address, "u");
  const ran = remove(address);
  expect(ran.code).toBe(1);
  expect(ran.err).toContain("That is not an email address.");
  expect(stands(address)).toBe(true);
});

test.each([
  ["TAB at the end", `u@ex.test${ch(0x09)}`],
  ["TAB at the start", `${ch(0x09)}u@ex.test`],
  ["NBSP at the end", `u@ex.test${ch(0xa0)}`],
  ["LINE SEPARATOR at the start", `${ch(0x2028)}u@ex.test`],
  ["E-acute in the domain", `u@${ch(0xc9)}x.test`],
])(
  "remove refuses a stored address with %s, which trim or lower-case misses",
  (_label, address) => {
    seed(address, "u");
    const ran = remove(address);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("That email belongs to no household.");
    expect(stands(address)).toBe(true);
  },
);

test("one raw remove record takes an interior TAB row off current_members, triggers in place", () => {
  const address = `u@ex${ch(0x09)}z.test`;
  seed(address, "u");
  const db = new Database(file);
  try {
    db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, ?, 'u', 'remove', 'x', 'operator')`,
    ).run(address, HOUSEHOLD);
    const triggers = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memberships_never%' ORDER BY name",
      )
      .all() as { name: string }[];
    expect(triggers.map((row) => row.name)).toEqual([
      "memberships_never_deleted",
      "memberships_never_replaced",
      "memberships_never_updated",
    ]);
  } finally {
    db.close();
  }
  expect(stands(address)).toBe(false);
});
```

Its output on `origin/main` at `d7cd223f`, the base, which this branch matches in source:

```
$ npx vitest run tools/ledger/api/test/lg83-reproduction.test.ts --reporter=verbose
 ✓ control: a clean stored address is removed 105ms
 ✓ remove refuses a stored address with TAB U+0009 after the @ 71ms
 ✓ remove refuses a stored address with LF U+000A after the @ 125ms
 ✓ remove refuses a stored address with VT U+000B after the @ 82ms
 ✓ remove refuses a stored address with FF U+000C after the @ 62ms
 ✓ remove refuses a stored address with CR U+000D after the @ 60ms
 ✓ remove refuses a stored address with BOM U+FEFF after the @ 70ms
 ✓ remove refuses a stored address with SPACE U+0020 after the @ 63ms
 ✓ remove refuses a stored address with NBSP U+00A0 after the @ 58ms
 ✓ remove refuses a stored address with LINE SEPARATOR U+2028 after the @ 63ms
 ✓ remove refuses a stored address with IDEOGRAPHIC SPACE U+3000 after the @ 66ms
 ✓ remove refuses a stored address with TAB at the end, which trim or lower-case misses 56ms
 ✓ remove refuses a stored address with TAB at the start, which trim or lower-case misses 97ms
 ✓ remove refuses a stored address with NBSP at the end, which trim or lower-case misses 68ms
 ✓ remove refuses a stored address with LINE SEPARATOR at the start, which trim or lower-case misses 90ms
 ✓ remove refuses a stored address with E-acute in the domain, which trim or lower-case misses 117ms
 ✓ one raw remove record takes an interior TAB row off current_members, triggers in place 111ms
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

The first test is the control: its `remove` prints `Removed clean@exz.test from …`
and exits 0. Each of the next ten is refused with exit 1 and
`That is not an email address.`, with the row still standing. Each of the last five
is refused with exit 1 and `That email belongs to no household.`, with the row
still standing. The last test shows one raw `remove` record takes the interior TAB
row off `current_members` and leaves the three `memberships_never_*` triggers
in place.

This branch's source is the base's, so the run above is the base's behaviour at
this branch's head.

## Decision — answered

Each question carries its own marker, `open` or `answered <date> by <who>`.

**Question 1 — answered 2026-11-01 by the owner: which remedy.** The owner chose
**(c), leave the refusal and remove a stuck row by hand**, from four options: (a),
(c), (d), or close as won't fix; (b) was not offered, being (a)'s limit with a second
pattern. The ticket itself made no recommendation; the question carried one for (c),
because the owner reports prod holds no row (question 2). Option (c)'s record
was run, in the Reproduction; the other costs are read from the code.

- **(a) `remove` looks the address up without the shape check.** `removeMember`,
  and `changeAddress`'s `from`, keep the trim and the lower-case, drop the
  `ADDRESS_SHAPE` test, and look the result up with `membershipOf`. An address that
  matches no row answers `MEMBER_NOT_FOUND`, `That email belongs to no household.`,
  where it answers `That is not an email address.` now.
  **Limit:** the lookup uses JavaScript's `trim()` and `toLowerCase()`, and the
  stored text was checked by SQLite's, which disagree. The schema's `CHECK` is
  `address = lower(trim(address))`. Measured with `better-sqlite3`: SQLite's
  `trim(TAB || 'a')` keeps the TAB, `trim(SPACE || 'a')` gives `a`, and its
  `lower('É')` is unchanged. So the schema stores a TAB, NBSP or U+2028 at an end,
  and refuses an ASCII space there. JavaScript's `trim()` strips all of them, so
  the lookup misses such a row. The same goes for `u@Éx.test`, which JavaScript
  lower-cases to `u@éx.test`. The Reproduction's second `test.each` has four
  end-position cases and `u@Éx.test`; each answers `That email belongs to no
  household.`, exit 1, row standing. So (a) reaches an interior whitespace character,
  and not one at either end. This round ran TAB at both ends, NBSP at the
  end and U+2028 at the start. Gate 1 measured the nine characters the schema
  stores at an end, at either end, with the same answer. Cost: a malformed `remove`
  reads as "belongs to no household"; the admin routes answer `MEMBER_NOT_FOUND`;
  lg-82's `remove` test (PR #691) changes from pinning the refusal to pinning the removal; and
  lg-82's escape at `remove`'s sink is needed before the interior address prints.
- **(b) `remove` accepts a shape that tolerates whitespace.** A second pattern beside
  `ADDRESS_SHAPE`, used only for the stored read. `readStoredAddress` still trims
  first, so (b) has (a)'s end-position limit for the same reason; read from the
  code, not run. Cost: two patterns that must agree about the stored form and can
  drift apart. The set must be chosen: the ten, or all 25 `\s` code points. The
  shape check exists so a list or a shell cannot split an address, and a lookup key
  is not split, so the second pattern guards nothing new. lg-82's escape is needed
  first.
- **(c) Leave the refusal, and remove the row by hand.** No code change; lg-82's
  test stays. The remedy is one `INSERT` into `memberships` of an `action = 'remove'`
  record that names the stored address, household and person exactly, with
  `changed_by` `operator`, as `removeMember` writes one. The triggers stay in
  place. `memberships_remove_what_stands` accepts the record when the three fields
  match the standing row and refuses it otherwise, and the two `memberships_never_*`
  triggers for `UPDATE` and `DELETE` are not touched. Measured by the Reproduction's
  raw-record block on a stored `u@ex<TAB>z.test`: the trigger list is unchanged and
  the row leaves `current_members`. Gate 1 also measured that `list` stops printing
  it. Costs: a hand-written append to a live file outside any command, recorded
  under `operator` with no reason attached; a mismatched household or person, which
  the trigger refuses; and the stuck address blocks retiring its person until the
  record is in. `POST` retire answers 400 `Remove every email under u first: nobody
  who can sign in is retired.` (the sentence is in `directory.ts`'s retire check),
  and 200 `retiring` once the record is in. Gate 1 measured both answers; this
  round did not re-run them. The stuck address blocks no add, because no command can
  type its exact string.
- **(d) `remove` by row id, not by address.** The `memberships.id` integer key. The
  operator names the row, and `list` prints the ids. Cost: a new input, and a new
  column on `list`. For the admin routes, a contract change to
  `removeMemberRequestSchema` (`contract/src/api.ts`, `z.strictObject({ address })`)
  and to `changeAddressRequestSchema`, whose `from` is an address too and would take
  a row id. CLAUDE.md says to stop and report a contract change, not to edit one
  alone, and `docs/01-TICKETS.md` rates a contract change `hard`. Nothing about the
  string is parsed, so (d) reaches every position.

I found no fifth remedy that avoids both the shape question and the lookup question.

**Question 1a — answered 2026-10-31 by the owner: how (a) is worded.** The owner
chose **state the limit**, from two options: state the limit, and have Done when 2
name the position it covers; or add a variant that also looks up the untrimmed
string. The limit is the one under (a) above.

**Question 2 — answered 2026-11-01 by the owner: does any live directory hold such a
row.** No: the owner reports the prod directory holds no addresses at all, so the
count is 0. Prod is the only live directory this ticket knows of. It is
an operator step, as lg-82's question 2 framed it. The scan in the next section
reads and writes no stored data; it can create sidecar files, see its note on them.
A hit means a row written by raw SQL or a hand-edited file, by the code reading
above.

**Question 2a — answered 2026-10-31 by the owner: the scan's predicate.** The owner
chose **the mismatch with the stored read**, over `current_members`, from two
options: that predicate, or a narrow `\s` scan over `current_members`. The narrow
scan answers the question as worded; the mismatch also flags the rows a whitespace
remedy would not reach, which is what the remedies above are for.

## The scan (question 2)

Save this as a file in your scratch directory, or anywhere outside the worktree,
and run it from the worktree root with `node <file> <directory.db>`. It opens the
file read-only with `better-sqlite3`, and it reads `current_members`, not
`memberships`, so a removed address and a history row are not counted. `ADDRESS_SHAPE`
and `readStoredAddress` are copied from `tools/ledger/api/src/directory.ts`; if that
file changes, this copy changes with it.

```js
// Lists the current members whose address remove cannot name by its stored text.
// Usage, from the worktree root: node <this file> <directory.db>
// The predicate: readStoredAddress, as directory.ts defines it, does not return the
// stored text. That is a refusal (undefined) or a different string. Both copies below
// are from directory.ts; if that file changes, this file changes with it.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const Database = require("better-sqlite3");

const ADDRESS_SHAPE = /^[^\s@,;]+@[^\s@,;]+$/u;

function readStoredAddress(raw) {
  const address = raw.trim().toLowerCase();
  return ADDRESS_SHAPE.test(address) ? address : undefined;
}

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write("Usage: node scan-mismatch.mjs <directory.db>\n");
  process.exit(2);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
try {
  const rows = db.prepare("SELECT address FROM current_members ORDER BY address").all();
  const flagged = rows.filter((row) => readStoredAddress(row.address) !== row.address);
  process.stdout.write(`current_members rows: ${String(rows.length)}\n`);
  process.stdout.write(`rows remove cannot name by their stored text: ${String(flagged.length)}\n`);
  for (const row of flagged) {
    process.stdout.write(`  ${JSON.stringify(row.address)}\n`);
  }
} finally {
  db.close();
}
```

**The stand-in.** A directory built with the real schema, as `Directory.open(file)`
creates it, then filled by raw `INSERT`s into `memberships` the way the Reproduction
seeds its rows, and closed. It holds a clean row, a row with a TAB after `ex`
(`stuck@ex<TAB>z.test`), a row with a space that was added and then removed
(`gone@ex<SPACE>z.test`: an `add` record, then a `remove` record for the same
person), and `comma@ex,z.test`. The count must be 2: the stuck TAB row and the comma
row, and not the removed address.

```
$ ls standin-lg83/
directory.db
$ node scan-mismatch.mjs standin-lg83/directory.db
current_members rows: 3
rows remove cannot name by their stored text: 2
  "comma@ex,z.test"
  "stuck@ex\tz.test"
$ ls standin-lg83/
directory.db  directory.db-shm  directory.db-wal
```

The count is 2 and the removed address is not in it. The superseded scan, which read
`memberships` and printed where `/\s/u` matches, gave `holding a \s character: 3` on
the same file. It listed `gone@ex z.test` twice (its add and its remove) and missed
`comma@ex,z.test`.

**The sidecar files.** The first `ls` is the stand-in as it was closed. The read
created `directory.db-shm` and `directory.db-wal` beside it, because a read-only
open of a closed WAL-mode directory creates them. Beside a live directory they
already exist, since the running server holds the file open. `immutable=1`, which
would avoid them, was tried on a closed WAL file, in the `file://<path>?immutable=1`
and `file:<path>?immutable=1` forms, opened with
`new Database(url, { readonly: true, fileMustExist: true })`. This `better-sqlite3`
refused both:

```
fail file:///…/imm/d.db?immutable=1 SQLITE_CANTOPEN unable to open database file
fail file:/…/imm/d.db?immutable=1 SQLITE_CANTOPEN unable to open database file
```

`…` stands for the scratch directory the test file sat in. So the script cannot
avoid them. On a closed copy, delete the copy's sidecars after
the read; on a live directory, leave them alone.

## Done when

1. The owner's answer to question 1 is recorded on its line in this Decision
   section, with the options it was chosen from, and `status` moves to `ready` in
   the same commit. _Amended 2026-11-01: `done` instead, since the same commit
   carries Done when 2's spec._
2. Whichever remedy is chosen, a spec asserts what `remove` does with a stored address
   holding each of the ten `\s` characters in the Reproduction, after the `@`, an
   interior position, which (a) and (b) cover. The result is removed, with the row out of
   `current_members`, for (a), (b) and (d), and refused with the row standing for (c).
   For (a) and (b), a second assertion pins the limit: the four end-position cases of
   the Reproduction, and `u@Éx.test`, stay refused with `That email belongs to no
   household.`. If (b)
   takes all 25 `\s` code points, the spec also covers the other 15. lg-82's `remove`
   test (PR #691) is changed to match.
3. Question 2 is measured on the live directory by an operator, with the mismatch
   scan above, read-only, and the count and the sidecar state before and after are
   recorded in the Log. _Amended 2026-11-01: the owner reports the prod directory
   empty, which answers the count without a scan; there is no sidecar state to
   record. The scan stays the measurement if it gains members._

## Log

### 2026-10-31 — filed on the owner's decision (maintenance dispatch, builder)

**Owner's decision, 2026-10-31.** The defect is filed as its own ticket, not folded
into lg-82 and not only recorded. The remedy is an open question, so the ticket is
`needs-decision`.

**Reproduction on main `d7cd223f`.** The control is removed (exit 0), and each of
the ten characters after the `@` is refused (exit 1, `That is not an email address.`,
row standing). The throwaway spec was deleted and is not committed.

**What the brief had wrong.** The `\s` set is 25 code points, not six; the six are
the ones `UNSEEN` also covers. The exclusion is from `b8a78192` (lg-20), not lg-52.
The admin routes refuse the same way; this was read, not run. Fold-in: none.

### 2026-10-31 — round 1, after gate 1 at `63c18424` (maintenance dispatch, builder)

**Owner's answers, 2026-10-31.** F2: state the limit, rather than add an untrimmed-
lookup variant (Decision, question 1a). F3: the scan flags the mismatch with
`readStoredAddress` over `current_members`, rather than a narrow `\s` scan over it
(Decision, question 2a). Both are recorded under the Decision with their options.

**Gate 1 findings, each,** at `63c18424`. The findings are answered here one by one.

- **F1 (med, Done when 1), option (c).** Reproduced. The raw `action = 'remove'`
  record on a stored `u@ex<TAB>z.test` is accepted, the trigger list is unchanged,
  and the row leaves `current_members`. (c) now names that as the remedy, and adds
  the retire block as a cost, measured by the gate and not re-run here.
- **F2 (med, Done when 1 and 2), option (a).** Reproduced on this branch: a leading
  or trailing TAB, a trailing NBSP, a leading U+2028 and `u@Éx.test` each answer
  `That email belongs to no household.`, exit 1, row standing. SQLite's functions,
  measured with `better-sqlite3`: `trim(TAB || 'a')` keeps the TAB; `trim(SPACE || 'a')`
  gives `a`; `lower('É')` is unchanged; JavaScript's `"É".toLowerCase()` gives `é`.
  (a) is reworded and its limit stated. Done when 2 names the position.
- **F3 (med, Done when 3), the scan.** Reproduced: the superseded scan, on the
  stand-in, gave 3 (the removed address twice, the comma row missed). The scan is
  replaced by the mismatch over `current_members`, which gives 2. Its text is in the
  ticket.
- **F4 (low), "predates lg-20".** Agreed, and dropped in the Why and in Question 2.
  `git show b8a78192` contains `CREATE TABLE memberships` once and the `ADDRESS`
  regex in the same commit.
- **F5 (low), read-only.** Agreed, and measured: the read created `-shm` and `-wal`
  beside the closed stand-in. `immutable=1` was refused (`SQLITE_CANTOPEN`), so the
  note in the scan section says what to do instead.
- **F6 (low), `difficulty`.** The value stays `standard` and is a proposal, for the
  owner to confirm. It rates option (a), the one that changes least. The ticket
  makes no recommendation, and `docs/01-TICKETS.md` rates "its recommended option",
  so the page's rule has no option to apply here (see the report). If the owner
  chooses (d), the rating becomes `hard`, as dl-102 was re-rated.
- **F7 (low), (d)'s cost.** Agreed: `changeAddressRequestSchema` is added.
- **F8 (low), nits.** The control row now reads `clean@exz.test` and
  `Removed clean@exz.test`, which is what the round-1 probe ran. The verbose output
  in the Reproduction lists all 17 tests of its run. The code block was extracted
  from this file and run as printed. The scratch path is gone. lg-82's PR is #691,
  head `94b984cc`.
- **F9 (low), 25 code points.** Agreed: counted with `node`, the set is 25; the ten
  and the other 15 are named in the Why.

**Pushback.** None of the nine was wrong on its facts. One figure needs stating
exactly: F2 says the end positions leave "9 of 10" rows. At each end the schema
stores nine of the ten, because its `CHECK` refuses an ASCII space there, so the
end positions are 18 rows in all, not 10.

**Fold-in.** None, as before.

**Not measured.** Options (a), (b) and (d) as built: none exists. The other 15
`\s` code points through `remove`. The retire 400 and 200 in (c), gate-measured and
not re-run here. Question 2, on the live directory.

### 2026-10-31 — gate 2 lows fixed at landing (maintenance dispatch, fixer)

Gate 2 passed at `5cdd8a14`. Its full report and gate 1's are on the pull request
thread. The filing is left `needs-decision`, with no `--land`.

- 2026-10-31 — Fixed at landing by owner choice: gate 2, L1 — "Say interior, not after the @". `git diff HEAD -- <this file> | grep -c '^-.*and not one at either end'` gave 1.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, L2 — "Drop the stale Log clause, and give lg-82's remove test a pointer to PR #691". `git diff HEAD -- <this file> | grep -c '^-.*quoted comment is the same at both heads'` gave 1; the pointer is added where the Decision and Done when 2 name the test.
- 2026-10-31 — Fixed at landing by owner choice: gate 2, L3 — "at d84c8852 the set is named CONTROL; UNSEEN arrives in lg-57". `git show d84c8852 -- tools/ledger/api/src/directory.ts | grep -n 'CONTROL\|UNSEEN'` shows only CONTROL, and 59629aec renames it to UNSEEN; `git diff HEAD -- <this file> | grep -c '^-.*set .UNSEEN. out beside it'` gave 1.

### 2026-11-01 — remedy (c) recorded and its spec added (orchestrator session)

**Owner's answers, 2026-11-01.** Question 2: the prod directory is empty, so no row is
stuck and the count is 0. Question 1: (c), from (a), (c), (d) and won't fix. Both are on
their lines under the Decision.

**Done when 2.** `household-command.test.ts` ends with `a stored address holding
whitespace (lg-83)`: each of the ten characters after the `@` is refused, exit 1,
`That is not an email address.`, with the row still in `current_members`; and one raw
`remove` record clears the TAB row and `list` stops printing it, which is the hand
remedy. lg-82's `remove` test is unchanged, as (c) says; it covers six of the ten and
does not check the row stays, which is why the new block is not a duplicate.
`npx vitest run tools/ledger/api/test/household-command.test.ts -t "lg-83"` gave 11
passed.

**Done when 3, not as worded.** The scan was not run: the owner reports the directory
empty, which answers the count without it. The sidecar state before and after was
therefore not recorded. If the directory gains members, the scan in this ticket is
still the measurement.

**Fold-in.** None.
