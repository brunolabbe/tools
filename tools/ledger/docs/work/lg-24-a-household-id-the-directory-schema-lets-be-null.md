---
id: lg-24
tool: ledger
title: A household id the directory schema lets be NULL
kind: fix
status: ready
milestone: P6
depends_on: []
difficulty: standard
---

# lg-24 — A household id the directory schema lets be NULL

## Why

`households.id` is `TEXT PRIMARY KEY` in the directory's migration 1
(`api/src/db/directory-schema.ts`), with no `NOT NULL`. SQLite lets a primary key
of a non-integer type hold NULL, and the column's CHECK passes when its
expression is NULL, so the schema stores a household with no id. Nothing else
refuses it: migration 2's `households_never_replaced` compares with `=`, which
never matches a NULL, so it does not fire either.

lg-22's gate 1 found this, dropped it as out of that ticket's scope, and left it
for the lander to file. The owner decided on 2026-10-13 that it is filed. The
finding, as lg-22's committed record words it:

> the household directory accepts `INSERT OR REPLACE INTO households (id,…) VALUES (NULL,…)` as a new row: `households.id` is `TEXT PRIMARY KEY` without `NOT NULL`, which SQLite allows to be NULL. It replaces nothing, was in lg-20's migration 1, and no route can produce a NULL id (the schema and `addHousehold` refuse it).

The reproduction below confirms the first two clauses. It also narrows the third:
no route can produce one, because `createHouseholdRequestSchema` (`contract/src/api.ts`)
requires a string id of 1 to 32 characters, and the host command takes its id from
argv. What the schema does not refuse is a write that skips the class: a direct
`INSERT`, a later migration, or a hand edit of the file. The defect is the schema's
refusal, not a reachable route.

### Reproduction

Run on `origin/main` at `4f756c40`, in a worktree with `worktree-farm.sh` and
`npm run build`. The script is the one run; `root` is that worktree's path. It
opens the directory the way `Directory.open` does (`new Database(file)`, then
`migrateDirectory`) and drives the class's own `addHousehold` for part (c).

```ts
import { createRequire } from "node:module";
import { rmSync } from "node:fs";

const root = "/workspaces/tools/.claude/worktrees/agent-a22737d0b51bf29c8";
const scratch =
  "/tmp/claude-1000/-workspaces-tools/d073943b-985e-4b8f-9d75-006f139393f0/scratchpad/lg-24/build";
const require = createRequire(`${root}/tools/ledger/api/package.json`);
const Database = require("better-sqlite3");
const { migrateDirectory } = await import(`${root}/tools/ledger/api/src/db/directory-schema.ts`);
const { Directory } = await import(`${root}/tools/ledger/api/src/directory.ts`);

const at = new Date("2026-10-13T00:00:00Z");
const file = `${scratch}/repro.db`;
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });

// Opened the way Directory.open does: new Database(file), then migrateDirectory.
const db = new Database(file);
migrateDirectory(db);
console.log("user_version after migrations:", db.pragma("user_version", { simple: true }));

console.log("\n(a) declared column");
const info = db.prepare("PRAGMA table_info(households)").all();
console.log(
  JSON.stringify(
    info.map((c: any) => ({ name: c.name, type: c.type, notnull: c.notnull, pk: c.pk })),
  ),
);
const ddl = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'households'")
  .get() as { sql: string };
console.log(ddl.sql.split("\n").slice(0, 4).join("\n"));

console.log("\n(b) inserts with a NULL id");
const count = () => db.prepare("SELECT count(*) AS n FROM households").get() as { n: number };
const plain = "INSERT INTO households (id, name, created_at, created_by) VALUES (NULL, ?, ?, ?)";
const replace =
  "INSERT OR REPLACE INTO households (id, name, created_at, created_by) VALUES (NULL, ?, ?, ?)";
const tryRun = (label: string, sql: string, name: string) => {
  try {
    db.prepare(sql).run(name, at.toISOString(), "operator");
    console.log(`${label}: ok, rows now ${count().n}`);
  } catch (error: any) {
    console.log(`${label}: refused, ${error.code} ${error.message}`);
  }
};
console.log(`rows before: ${count().n}`);
tryRun("(b1) plain INSERT, NULL id, first", plain, "Null one");
tryRun("(b2) plain INSERT, NULL id, second", plain, "Null two");
tryRun("(b3) INSERT OR REPLACE, NULL id", replace, "Null three");
console.log(
  "stored:",
  JSON.stringify(
    db.prepare("SELECT id, id IS NULL AS id_is_null, name FROM households ORDER BY name").all(),
  ),
);
tryRun("(b4) control: plain INSERT, empty-string id", plain.replace("NULL", "''"), "Empty");
console.log(
  "(b5) control: the id CHECK refuses '' —",
  (() => {
    try {
      db.prepare(
        "INSERT INTO households (id, name, created_at, created_by) VALUES ('', 'x', ?, 'operator')",
      ).run(at.toISOString());
      return "accepted";
    } catch (error: any) {
      return `refused, ${error.code}`;
    }
  })(),
);

console.log("\n(b6) what a reader of the directory sees after a NULL-id insert");
db.close();
const reopened = Directory.open(file);
console.log("Directory.households():", JSON.stringify(reopened.households()));
reopened.close();

console.log("\n(c) addHousehold with a null or empty id, in-memory directory");
const dir = Directory.open(":memory:");
for (const [label, id] of [
  ["empty string", ""],
  ["whitespace only", "   "],
  ["null", null],
] as const) {
  try {
    const household = dir.addHousehold({
      id: id as unknown as string,
      name: "x",
      at,
      by: "operator",
    });
    console.log(`${label}: accepted ${JSON.stringify(household)}`);
  } catch (error: any) {
    console.log(
      `${label}: ${error.constructor.name} code=${error.code ?? "none"} message=${error.message}`,
    );
  }
}
console.log("Directory.households() after (c):", JSON.stringify(dir.households()));
dir.close();
```

Command and output (`node repro.mts`, Node v22.23.3, better-sqlite3 from the
api's dependencies):

```
user_version after migrations: 2

(a) declared column
[{"name":"id","type":"TEXT","notnull":0,"pk":1},{"name":"name","type":"TEXT","notnull":1,"pk":0},{"name":"created_at","type":"TEXT","notnull":1,"pk":0},{"name":"created_by","type":"TEXT","notnull":1,"pk":0}]
CREATE TABLE households (
    id TEXT PRIMARY KEY CHECK (
      length(id) BETWEEN 1 AND 32
      AND id NOT GLOB '*[^a-z]*'

(b) inserts with a NULL id
rows before: 0
(b1) plain INSERT, NULL id, first: ok, rows now 1
(b2) plain INSERT, NULL id, second: ok, rows now 2
(b3) INSERT OR REPLACE, NULL id: ok, rows now 3
stored: [{"id":null,"id_is_null":1,"name":"Null one"},{"id":null,"id_is_null":1,"name":"Null three"},{"id":null,"id_is_null":1,"name":"Null two"}]
(b4) control: plain INSERT, empty-string id: refused, SQLITE_CONSTRAINT_CHECK CHECK constraint failed: length(id) BETWEEN 1 AND 32
      AND id NOT GLOB '*[^a-z]*'
      -- length() and GLOB stop at a NUL, so 'ho' || char(0) || 'me' reads as
      -- 'ho'; the byte count is the length of the whole value.
      AND length(CAST(id AS BLOB)) = length(id)
      AND id NOT IN ('con', 'prn', 'aux', 'nul')
(b5) control: the id CHECK refuses '' — refused, SQLITE_CONSTRAINT_CHECK

(b6) what a reader of the directory sees after a NULL-id insert
Directory.households(): [{"id":null,"name":"Null one"},{"id":null,"name":"Null two"},{"id":null,"name":"Null three"}]

(c) addHousehold with a null or empty id, in-memory directory
empty string: AppError code=BAD_REQUEST message=A household id is one lowercase word of a to z, at most 32 letters, and not con, prn, aux or nul; "" is not.
whitespace only: AppError code=BAD_REQUEST message=A household id is one lowercase word of a to z, at most 32 letters, and not con, prn, aux or nul; "" is not.
null: TypeError code=none message=Cannot read properties of null (reading 'trim')
Directory.households() after (c): []
exit 0
```

What this shows:

- **(a)** `notnull` is `0` for `id`. The CHECK does not refuse NULL, because a CHECK
  passes when its expression evaluates to NULL.
- **(b1–b3)** A NULL id is stored by a plain `INSERT`, a second one is stored beside
  it (NULLs do not collide in the key), and `INSERT OR REPLACE` adds a row and
  replaces nothing: the count goes 2 → 3. Migration 2's trigger does not refuse
  any of them.
- **(b4–b5)** The same column refuses `''` through its CHECK, so the gap is NULL
  specifically.
- **(b6)** `Directory.households()`, which the admin list route reads, returns the
  rows with `id: null`.
- **(c)** `addHousehold` refuses `""` and whitespace with `AppError BAD_REQUEST`. A
  `null` does not reach the refusal: `.trim()` throws a `TypeError`, which is not
  an `AppError`. The gate's phrase "`addHousehold` refuses it" is true for the
  empty string and not for NULL. No route reaches that line, since the zod schema
  refuses a non-string id first.

## Build

The fix goes in `tools/ledger/api/src/db/directory-schema.ts`, as a new entry
appended to `DIRECTORY_MIGRATIONS`. Migrations 1 and 2 are shipped and are not
edited. The new entry is the next free directory migration: 3 unless lg-23 lands
first. Migration 2 is lg-22's and is on `main`.

The ticket does not choose between these two options. The build chooses, and says
in its Log which it chose and why.

- **A. Rebuild the table with `id TEXT PRIMARY KEY NOT NULL`.** The declared column
  changes, which is what the gate's wording asks. The traps are these, and each
  must be checked against a directory that holds data, not assumed:
  - Each migration runs inside `BEGIN` (`applyMigrationList`), and `configure()`
    sets `foreign_keys = ON`. SQLite ignores `PRAGMA foreign_keys` inside a
    transaction, so the usual rebuild step of turning it off is not available to
    a migration. `memberships.household_id` references `households (id)`, so a
    `DROP TABLE households` on a directory with membership rows is expected to fail.
    Measure it before choosing this option.
  - `DROP TABLE` removes the four `households` triggers that migration 1 and 2
    created (`households_never_updated`, `households_never_deleted`,
    `households_never_replaced`), and the rebuilt table must have them again. A
    rebuild that forgets one loses an append-only guarantee without an error.
  - The copy and the rename must avoid the spellings `api/test/helpers/append-only.ts`
    scans for: `UPDATE … SET`, `DELETE … FROM`, `OR REPLACE`, `REPLACE INTO`. The
    scan reads `api/src`, so the migration text is in its reach. A plain
    `INSERT INTO new SELECT … FROM households` followed by `ALTER TABLE … RENAME`
    avoids all four.
  - The rows that exist must come through unchanged, in id order and with their
    `created_at` and `created_by`.

- **B. A `BEFORE INSERT` trigger refusing a NULL id**, written like migration 2's
  `memberships_never_replaced`: `WHEN NEW.id IS NULL`, `RAISE(ABORT, …)`. It is one
  statement, with no table rebuild, so none of A's traps apply. The declared column
  stays nullable, so `PRAGMA table_info` still reports `notnull: 0`; the refusal is
  the trigger's, not the column's. The Log should say so if this is the option.

Whichever is built, the same tests below pass on it, and the Log records which
option was taken.

## Done when

1. **A NULL id is refused at the schema.** A test in `api/test/directory.test.ts`,
   added at the end of the suite, opens a directory on the migrated schema and
   expects both `INSERT` and `INSERT OR REPLACE` with a NULL id to throw, and the
   `households` count to stay the same.
2. **A directory at the previous migration picks up the fix on open.** The same
   file builds a directory with `migrateDirectory(db, 2)` (the schema on `main`
   today), adds one household and one membership, closes it, and opens it with
   `Directory.open`. The test expects `PRAGMA user_version` to read the next free
   directory migration afterwards (3 unless lg-23 lands first),
   the household row and the membership history to be unchanged, and the refusal
   of line 1 to hold on the reopened directory.
3. **The append-only scan passes on the migration's text.** `npm test -- --project ledger`
   runs `api/test/helpers/append-only.ts` over `api/src`, and it stays green.
4. `npm run check` exits 0, and `npx vitest run scripts/test/status.test.ts` passes.

## Log

- 2026-10-13 — Filed from lg-22's gate 1, which dropped the finding as out of that
  ticket's scope and left it for the lander. The owner decided it is filed. The
  reproduction above was run on `origin/main` at `4f756c40` before filing, and
  confirms the finding's NULL-id claims. The gate's "addHousehold refuses it" holds
  for `""` and whitespace only; for `null` it throws a `TypeError` (part (c)).
- 2026-10-13 — `difficulty: hard`, not `standard`. The fix is one appended migration,
  but it changes an append-only store that the owner's live directory file holds,
  and each migration is one irreversible step. Option A carries the foreign-key and
  trigger traps above, which a builder could get wrong without an error. If the
  build takes option B, re-rate the ticket to `standard` in the commit that records
  that choice.
- 2026-10-13 — `milestone: P6`, from lg-20, lg-22 and lg-23, which is the work this
  defect sits in. `depends_on: []`: the fix needs only what is on `main`. Migration 2
  is already in place, so the next free directory migration (3 unless lg-23 lands
  first) does not wait for lg-23.
- 2026-10-13 — Collision noted: lg-23's Build 4 named "a directory migration 2" for
  the cap's trigger, and that number is lg-22's on `main`. Corrected in this
  branch's second commit, which changes lg-23's sentence to "the next free directory
  migration" and this ticket's claims to match, so whichever of the two lands second
  takes the next free number.
- 2026-10-15 — Built on `origin/main` at `8e49523c`. **Option B, a decision the
  owner can overrule at the gate**: directory migration 3 (the next free number;
  lg-23 is not on `main`) adds `households_id_not_null`, a `BEFORE INSERT` trigger
  on `households` with `WHEN NEW.id IS NULL` and `RAISE(ABORT, 'a household has
an id')`. The declared column is unchanged: `PRAGMA table_info(households)` still
  reads `notnull: 0` for `id`, and the refusal is the trigger's, not the column's.
  No contract, error code or route changes; the message is raw SQLite, as
  migration 2's are, since no route can write a NULL id.
  - **Why not A** (corrected in round 1, below; this paragraph first said A could
    not run under today's runner at all, which gate 1's F1 disproved). What was
    measured: `option-a.mts` (build scratch) migrates an in-memory directory to 2,
    adds a household and a membership, then runs a copy-to-new-table rebuild
    (`CREATE TABLE households_rebuilt … NOT NULL`, `INSERT … SELECT … ORDER BY id`,
    `DROP TABLE households`, `ALTER TABLE … RENAME`) inside `BEGIN`, as
    `applyMigrationList` does. `node option-a.mts`, Node v22.23.3:
    ```
    A1 plain rebuild inside BEGIN, foreign_keys ON: refused, SQLITE_CONSTRAINT_FOREIGNKEY FOREIGN KEY constraint failed
    A2 PRAGMA foreign_keys = OFF inside BEGIN, then rebuild: refused, SQLITE_CONSTRAINT_FOREIGNKEY FOREIGN KEY constraint failed
    A3 PRAGMA defer_foreign_keys = ON inside BEGIN, then rebuild: refused, SQLITE_CONSTRAINT_FOREIGNKEY FOREIGN KEY constraint failed
    ```
    That shape fails, but another applies through `applyMigrationList` unchanged:
    copy the rows aside, drop, recreate with `NOT NULL`, copy back, all under
    `PRAGMA defer_foreign_keys = ON` (gate 1's A7, reproduced in round 1 below).
    B stays for the two reasons measured there. The brief said "the four
    `households` triggers" and named three; three is the count on `main`
    (`households_never_updated`, `households_never_deleted`,
    `households_never_replaced`).
  - **Difficulty not re-rated** at build time, as ratings are the owner's;
    superseded in round 1, where the owner re-rated it.
  - **Tests**, at the end of `api/test/directory.test.ts`, `describe("a household
id is never NULL")`: a plain `INSERT` with `NULL`, an `INSERT` that omits `id`,
    `INSERT OR REPLACE` and `REPLACE INTO` with `NULL` are each refused and the
    count is unchanged (Done when 1); a file directory at `migrateDirectory(db, 2)`
    with one household and one membership, reopened through `Directory.open`,
    reads `user_version` 3, the same `households` and `memberships` rows, the same
    `history("home")`, and refuses the same four statements (Done when 2). The
    existing "a directory made before the trigger takes it on its next open" test
    asserted `user_version` 2 after a full migration; it now asserts 3.
  - **Red first**: with the trigger's `WHEN` mutated to `WHEN 0`,
    `npx vitest run tools/ledger/api/test/directory.test.ts` gave `2 failed | 16
passed (18)`, both new tests on `expected [Function] to throw an error` for the
    `NULL` insert; restored from `555e86f5`, `18 passed (18)`.
  - `npm test -- --project ledger`: `60 passed (60)` files, `1047 passed (1047)`
    tests, which includes the append-only scan "no source file that writes the
    directory issues an UPDATE or a DELETE" over `api/src` (Done when 3).
    `npm run check` exit 0.
  - **Not folded in** at build time: part (c)'s `addHousehold({ id: null })`
    throwing a `TypeError` instead of an `AppError`. Superseded in round 1, where
    the owner chose to fix it here.
- 2026-10-15 — Round 1, on gate 1's CONCERNS at `6f7e2727`. The owner's answers,
  given at the checkpoint on 2026-10-15:
  - **F1 and F2, "Keep B, re-rate standard"**, chosen from "Keep B, re-rate
    standard / Keep B, leave hard / Switch to A7". F1 reproduced before changing
    anything: gate 1's `optiona.mts` at this branch printed `A1_plain_rebuild:
REFUSED SQLITE_CONSTRAINT_FOREIGNKEY`, `A3_defer_then_plain_rebuild: REFUSED
SQLITE_CONSTRAINT_FOREIGNKEY`, `A4_legacy_alter_table: REFUSED
SQLITE_CONSTRAINT_FOREIGNKEY`, and for `A7_defer_copy_aside`: `migration
applied`, `user_version 3`, `id:notnull=1`, `households rows identical: true
memberships identical: true`, `fk violations: 0 integrity: ok`, and three NULL
    inserts refused with `NOT NULL constraint failed: households.id`. B stays
    for two measured reasons: `optiona2.mts` ran A7 over a v2 directory already
    holding a NULL-id household and got `REFUSED SQLITE_CONSTRAINT_NOTNULL … |
user_version 2`, so `Directory.open` would throw on such a file until it was
    mended by hand, where B opens it (`upgrade.mts`: `Directory.open: ok`,
    `user_version 3 records identical NULL-id rows remaining: 2`); and B rewrites
    no table on a live append-only file. The cost of B: the column stays declared
    nullable, and a later rebuild of the table or a `DROP TRIGGER` loses the
    refusal. The "Why not A" paragraph above and migration 3's header comment now
    say this. **`difficulty: standard`**, set by the owner in this round, as the
    2026-10-13 entry asked for option B.
  - **F3, "Fix here"**, chosen from "Fix here / File a ticket / Leave recorded".
    `addHousehold` now refuses an id that is not a string with the same
    `BAD_REQUEST` sentence (the ledger's `refuse`, which throws the core code)
    before `.trim()`. Reproduced first, `node --import tsx f3.mts` (build
    scratch): `null id: TypeError code=none Cannot read properties of null
(reading 'trim')`, the same for `undefined` and `7`; after: `null id: AppError
code=BAD_REQUEST … null is not.`. Test, at the end of `directory.test.ts`:
    "the class refuses an id or a name that is not a string as BAD_REQUEST,
    before the schema" (renamed from "an id" when the name case below joined
    it), for `null`, `undefined` and `7`. Red with the guard line deleted:
    `1 failed | 18 passed (19)`, `expected TypeError: Cannot read properties of
null… to be an instance of AppError`; restored from `f821a478`, `19 passed
(19)`.
  - **F4, folded in.** Migration 3's header says the refusal holds from that
    migration on: a trigger does not read the rows already there, so a household
    stored with no id before it stays (`upgrade.mts` above). Comment only, so no
    test pins it.
- 2026-10-15 — The null name, fixed here. Round 1 left `addHousehold({ id:
"home", name: null })` reaching `.trim()` as a `TypeError` (`f3.mts`: `null
name: TypeError code=none Cannot read properties of null (reading 'trim')`) and
  put it to the owner as an open decision. The owner chose "Fix in this branch",
  from "Fix in this branch / Leave recorded / File a ticket", on 2026-10-15.
  `addHousehold` now refuses a name that is not a string with the existing
  `BAD_REQUEST` sentence, "A household's name is 1 to 80 characters.", before
  `.trim()`; `f3.mts` after: `null name: AppError code=BAD_REQUEST A household's
name is 1 to 80 characters.`. One more case at the end of the same test. Red
  with the name guard deleted, `npx vitest run
tools/ledger/api/test/directory.test.ts`: `1 failed | 18 passed (19)`, `null
name: expected TypeError: Cannot read properties of null… to be an instance of
AppError`; restored from `ce65a6ab`, `19 passed (19)`. Nothing in this ticket's
  part (c) is left as a `TypeError` now.
- 2026-10-15 — Fixed at landing by owner choice: gate 2, N1 — "the id guard's own
  message can throw. `notAnId(String(household.id as unknown))` stringifies the
  value to echo it, and `String()` throws on two non-strings". The owner chose the
  first fix the gate named: `addHousehold` echoes `typeof` of a non-string id, never
  the value. `node --import tsx guards.mts <tree>` (gate 2's script, run on the
  landing tree) → every non-string id, 13 of 13, gives `AppError BAD_REQUEST` with
  no row stored, `Object.create(null)` and `{toString(){throw}}` included
  (`...nul; object is not.`). Test, `npx vitest run
tools/ledger/api/test/directory.test.ts`, the same case at the end of the suite:
  `Object.create(null)`, an object whose `toString` throws and `['home']` joined
  `null`, `undefined` and `7`, each asserted `AppError` `BAD_REQUEST` echoing its
  type, with no row stored. Red with `String(household.id as unknown)` restored:
  `1 failed | 18 passed (19)`, `null: expected AppError … to match object`
  (`"; object is not."`, the echo changed); red with `String()` kept only for a
  plain object: `Object.create(null): expected TypeError: Cannot convert object to
primi… to be an instance of AppError`; restored from the fix commit, `19 passed
(19)`.
- 2026-10-15 — Fixed at landing by owner choice: gate 2, N2 — "the name arm of
  the new test asserts `null` only, and its title says 'an id or a name that is not
  a string'". The name arm now asserts `null`, `undefined` and `7`, each `AppError`
  `BAD_REQUEST` with "A household's name is 1 to 80 characters.". Red with the name
  guard narrowed to `household.name == null`, `npx vitest run
tools/ledger/api/test/directory.test.ts`: `1 failed | 18 passed (19)`, `7 name:
expected TypeError: household.name.trim is not a f… to be an instance of
AppError`; restored from the fix commit, `19 passed (19)`.
- 2026-10-15 — Gate 2's N3, the `TypeError`s a caller past the request schema
  reaches in `addMember`, `removeMember` and `membershipOf`, was put to the owner on
  2026-10-15, who chose "File one ticket"; it is being filed separately and is not
  fixed here.
