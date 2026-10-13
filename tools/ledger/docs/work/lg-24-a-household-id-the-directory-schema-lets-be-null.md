---
id: lg-24
tool: ledger
title: A household id the directory schema lets be NULL
kind: fix
status: ready
milestone: P6
depends_on: []
difficulty: hard
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
edited. **The next number is 3.** Migration 2 is lg-22's and is on `main`.
lg-23's Build 4 says "a directory migration 2 drops the cap's trigger"; that
number is already taken. Whichever of lg-23 and this ticket lands second takes the
next free number, and the other's brief is corrected in the commit that lands it.

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
   `Directory.open`. The test expects `PRAGMA user_version` to read 3 afterwards,
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
  is already in place, so a migration 3 does not wait for lg-23.
- 2026-10-13 — Collision noted, not fixed here: lg-23's Build 4 names "a directory
  migration 2" for the cap's trigger. That number is lg-22's on `main`. lg-23's
  brief is not edited by this ticket.
