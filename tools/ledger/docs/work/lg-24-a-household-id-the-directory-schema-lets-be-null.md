---
id: lg-24
tool: ledger
title: A household id the directory schema lets be NULL
kind: fix
status: done
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

## Review

**Gate: CONCERNS** — 2026-10-15 · `8e49523c8e7d6fc8fada32736212c6b1e3146316..6f7e27278b0a5373408fd4c8bfe5dc6a31a141b4` · Sonnet 5.5, depth hard (full gate)

| Done when                                                                                       | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A NULL id is refused at the schema (`INSERT` and `INSERT OR REPLACE` throw, count unchanged) | `api/test/directory.test.ts` › "a household id is never NULL" › "the schema refuses an INSERT and an INSERT OR REPLACE with a NULL id" ✓ — `refusesNullIds` asserts the `/a household has an id/` message for four statements and `count()` equal to `before`. Red with the trigger's `WHEN` made `WHEN 0` (below).                                                                                                                                                                                                               |
| 2. A directory at the previous migration picks up the fix on open                               | same describe › "a directory at the previous migration takes the refusal on its next open, its records unchanged" ✓ — builds with `migrateDirectory(db, 2)`, one household and one membership, closes, `Directory.open`; asserts `households()`, `history("home")`, `user_version` 3, `SELECT *` of both tables equal to the pre-open rows, and `refusesNullIds` on the reopened file. The refusal is checked on a second handle to the file `Directory.open` migrated, since `Directory` hides its handle; the file is the same. |
| 3. The append-only scan passes on the migration's text                                          | `api/test/directory.test.ts` › "no source file that writes the directory issues an UPDATE or a DELETE" ✓ — its `arrayContaining` includes `db/directory-schema.ts`. `npm test -- --project ledger`: 60 of 60 files, 1047 of 1047 tests, exit 0. Positive control: an `UPDATE households SET name = name;` planted after the new trigger turned this test red (`offenders` = `["db/directory-schema.ts"]`).                                                                                                                        |
| 4. `npm run check` exits 0; `status.test.ts` passes                                             | **verified** — `npm run check` exit 0 here; `npx vitest run scripts/test/status.test.ts` 135 of 135. The PR's `check` jobs are green at this head.                                                                                                                                                                                                                                                                                                                                                                                |

**CI at `6f7e2727`:** `check` ×2, `docker`, `codeql`, `CodeQL`, `changes`, `dependency-review` pass; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still pending when read. The local `--project ledger` run above stands in for the ubuntu leg until it finishes; the Windows leg is unread.

**What I ran before reading the build's account.** `shapes.mts` opens a directory through `Directory.open`, adds a household and a membership, then runs 24 statement shapes on a second connection to the same file: plain `INSERT` with NULL, an `INSERT` omitting `id`, `INSERT OR REPLACE`, `REPLACE INTO`, `OR IGNORE`, `OR ABORT`, `OR FAIL`, `OR ROLLBACK`, an upsert `DO UPDATE` and `DO NOTHING` on a NULL id, an upsert on an existing id setting `id = NULL`, four `INSERT … SELECT` forms (literal NULL, a NULL column, omitted id, a `NULLIF(id, id)` copy of every household), `DEFAULT VALUES`, `CAST(NULL AS TEXT)`, two multi-row `VALUES` with a NULL in either position, and four `UPDATE … SET id = NULL` forms (plain, `OR REPLACE`, `OR IGNORE`, `FROM`), plus a valid-id control. **24 of 24 left the table unchanged with no NULL id** (the control inserted); every NULL-id insert hit `a household has an id`, the existing-id upsert hit `never replaced`, the four `UPDATE`s hit `never edited`. A multi-row insert with a valid row before the NULL left neither row (statement atomic). `UPDATE`/`DELETE`/`REPLACE` of an existing id still give the three old messages. A second engine (Python's SQLite 3.45.1, the Node build is 3.53.2) refused four NULL inserts on the same file with `IntegrityError: a household has an id`. **Positive control:** with `WHEN NEW.id IS NULL` replaced by `WHEN 0` in a disposable detached tree, the same script ACCEPTED 16 of the 24 shapes and the branch's spec went `2 failed | 16 passed (18)`, both new tests on `expected [Function] to throw an error`; restored from the gated sha, 18 of 18.

**Upgrade (`upgrade.mts`).** A file made with `migrateDirectory(db, 1)` and another with `migrateDirectory(db, 2)`, each holding 3 households and 4 memberships (an add, an add, a remove, an add): after `Directory.open` the records hash identical, `user_version` 3, `integrity_check` ok, `foreign_key_check` empty, five NULL statements refused with the records unchanged. Two further `Directory.open` calls changed nothing (same `user_version`, same schema hash, no "trigger already exists"). `Directory.open` with a second connection holding a read transaction open succeeded. `PRAGMA table_info(households)` still reads `notnull: 0` for `id`, as the Build says option B leaves it.

- **med** · no `Done when` line depends on it · **F1, the Log's account of why option A is unworkable is false, and the owner is told to decide on it.** The Log says "measured, A cannot be written as a migration under today's runner … So A's cost is a change to `applyMigrationList` in `db/schema.ts`", and the migration's own header comment says declaring the column "means rebuilding the table, and the old table's DROP fails on a directory that holds a membership". The plain rebuild does fail (their A1, which I reproduced: `SQLITE_CONSTRAINT_FOREIGNKEY`, `user_version` stays 2), and so does their A3, which I also reproduced: it sets `defer_foreign_keys` and then drops the parent before the new table's rows exist. A rebuild that **copies the rows aside, drops, recreates, and copies back** under `defer_foreign_keys = ON` applies through `applyMigrationList` unchanged. Reproduction (`optiona.mts <tree> <outdir>`, a directory at migration 2 with 3 households and 4 memberships, run through `applyMigrationList(db, ["", "", sql], 3)`):

  ```sql
  PRAGMA defer_foreign_keys = ON;
  CREATE TABLE households_aside AS SELECT * FROM households;
  DROP TABLE households;
  CREATE TABLE households ( id TEXT PRIMARY KEY NOT NULL CHECK (…migration 1's id CHECK…), name …, created_at …, created_by … );
  INSERT INTO households SELECT * FROM households_aside ORDER BY id;
  DROP TABLE households_aside;
  -- then the three households_never_* triggers, as migration 1 and 2 made them
  ```

  Output: `migration applied`, `user_version 3`, `table_info: id:notnull=1`, households rows and memberships rows identical (hash, ordered by id), `foreign_key_check` empty, `integrity_check` ok, the three old triggers present and each still refusing `REPLACE`/`UPDATE`/`DELETE`, `memberships.household_id` still enforced, and `INSERT … VALUES (NULL …)`, `INSERT OR REPLACE … NULL`, and the omitted-id insert each refused with `NOT NULL constraint failed: households.id`. The text matches none of `WRITES_IN_PLACE` (`false`), so Done when 3 would hold for it. No change to `applyMigrationList`. The claim is a measurement the build ran on three shapes and generalised from; a fourth works. The ticket asked the Log to say which option was taken _and why_, and the build marks the choice as one "the owner can overrule at the gate", so the reason is what the owner will read. Direction of the falsehood: it closes an option that is open. **Open decision, for the owner:**
  1. **Keep B and correct the words** (recommended): the Log's "Why not A" paragraph and the migration header comment say what was measured, namely that a plain rebuild fails on a directory with memberships and a deferred-check copy-aside rebuild works. Reasons to stay on B, both measured: the same A migration run over a v2 directory that already holds a NULL-id household **refuses** (`SQLITE_CONSTRAINT_NOTNULL`, `user_version` stays 2), so `Directory.open` would throw on that file until it is hand-repaired, where B opens it (`upgrade.mts`, the "already holds NULL-id rows" case: opens, records identical, two NULL rows remain); and B writes no table on a live append-only file. The cost of B: the column is still declared nullable (`notnull: 0`) and the refusal lives in a trigger that a rebuilt table or a `DROP TRIGGER` loses.
  2. **Move to the A shape above**: the declared column carries the rule and no trigger is needed. Cost: it rewrites `households` on the owner's live file in one irreversible step, it fails to open a file that holds a NULL id, `refusesNullIds` must match `NOT NULL constraint failed` instead of the trigger's message (the ticket's "the same tests pass on whichever is built" is not true of the branch's tests, which pin B's message), and `difficulty: hard` stays.

- **low** · no `Done when` line depends on it · **F2, the ticket's own instruction on `difficulty` was not followed.** The ticket's 2026-10-13 Log says: "If the build takes option B, re-rate the ticket to `standard` in the commit that records that choice." The branch takes B and leaves `difficulty: hard`, saying ratings are the owner's. The instruction is the owner's, written in the ticket. It is conditional on F1: if the owner chooses A, `hard` is right. Apply it at landing once F1 is decided, or leave it, as the owner prefers.
- **low** · no live call site · **F3, a defect with a reproduction in this ticket is left as prose.** Part (c) of the ticket's reproduction shows `addHousehold({ id: null })` throwing a `TypeError` from `.trim()`, not an `AppError`; the Log records it as "not folded in … an observation". `CLAUDE.md` says a defect that could be fixed here or filed is a question with options, and "an open decision written as prose goes stale". No route reaches it (`createHouseholdRequestSchema` refuses a non-string id first). **Open decision:** (1) fix here, with a `typeof household.id !== "string"` refusal as `BAD_REQUEST` and one test (recommended, it is the same invariant at the class); (2) file it as a ticket; (3) leave it recorded. I did not run option 1.
- **low** · no live call site · **F4, "a household always has an id" is true of inserts from this migration on, not of a file that already has one.** `CREATE TRIGGER` does not look at existing rows: a v2 file holding a NULL-id household opens, reaches `user_version` 3, keeps the row, and `Directory.households()` still returns `{"id":null,…}` (`upgrade.mts`). No route can write one and I could not read the owner's live directory file, so whether one exists is unmeasured. The migration header could say "from here on".
- **dropped** · the shared runner reads `user_version` before `BEGIN`, so two processes opening one v2 file at once could both try to create the trigger. Pre-existing shape of `applyMigrationList`, shared by both migration lists, not in this diff; I did not reproduce it.
- **dropped** · 20 of the 24 shapes are not asserted by the branch's spec (only the four in `NULL_ID_INSERTS` are). All 24 go through the one `BEFORE INSERT` trigger and all 24 were refused here; the `WHEN 0` mutation is caught. Not a defect.
- **dropped** · `toBe(3)` hard-coded in two tests will break when lg-23 adds a migration. The ticket words the number as "3 unless lg-23 lands first"; recorded under maintainability.
- **findings** · the hunt returned 7; 4 carried (F1 med, F2 low, F3 low, F4 low), 3 dropped.
- NFR: security ✓ (the refusal is the database's, the message is raw SQLite and no route reaches it; nothing logged) · performance n/a (one `WHEN` on insert) · reliability — F1, F4; the upgrade and idempotence checks above are clean · maintainability — F1, F3; the new migration and tests are at the end of their lists and `directory.test.ts`.
- Repo invariants walked: no cross-tool import, no new error code, no contract edit, no new workspace or dependency (so no `Dockerfile` edit), no `any`, `console` or shell. New tests are in an existing registered spec. Skipped as not touched: SSRF, redaction, progress, process kill, routes.
- Not run: the owner's live directory file; the Windows leg; the ubuntu `test` leg (pending at this head); a concurrent open of one file.

### Gate 2

**Gate: PASS** — 2026-10-15 · `6f7e27278b0a5373408fd4c8bfe5dc6a31a141b4..823f7768564d2e27ef91c965af0371935c732cd8` · Sonnet 5.5, depth hard (full gate), the round's four commits only

Nothing in this round is a `high`, and no `Done when` line depends on any finding below. Done when 1 to 4 are unchanged by the round and still hold: `npm test -- --project ledger` is 60 of 60 files and 1048 of 1048 tests (one more than gate 1's 1047: the new guard test), exit 0; `npm run check` exit 0; `npx vitest run scripts/test/status.test.ts` 135 of 135; `npm run status -- --show lg-24` reads `difficulty standard`. The PR's `check`, `docker`, `codeql`, `CodeQL`, `changes` and `dependency-review` pass at this head; `test (ubuntu-latest)` and `test (windows-latest, informational)` were still pending when read, so the local ledger run stands in for the ubuntu leg and the Windows leg is unread.

**Verdicts on gate 1**

- **F1 (med), fixed.** The corrected "Why not A" paragraph, the round-1 entry and migration 3's header comment now say what `optiona.mts` and `optiona2.mts` measured, and I checked each sentence against my output:
  - "copying to a new table and dropping the old fails on a directory that holds a membership, with or without `defer_foreign_keys`": my A1 (without) and A3 (with) both `REFUSED SQLITE_CONSTRAINT_FOREIGNKEY`. ✓
  - "copying the rows aside, dropping, recreating and copying back under `defer_foreign_keys` does apply": my A7, `migration applied`, `id:notnull=1`, both tables identical, `fk violations: 0 integrity: ok`, three NULL inserts refused with `NOT NULL constraint failed: households.id`. ✓
  - "that rebuild refuses a directory that already holds a NULL id": `optiona2.mts`, `REFUSED SQLITE_CONSTRAINT_NOTNULL … | user_version 2`. ✓ "so it would not open until the file was mended by hand" is read from `Directory.open` (it rethrows the migration's error after closing), not run: I ran A7 through `applyMigrationList`, not through a `Directory.open` carrying it.
  - "a trigger does not read the rows already there": `upgrade.mts`, a v2 file with two NULL-id households opens, reaches `user_version` 3 and keeps both. ✓
  - The Log's reproduced block (A1, A3, A4 refused; A7 applied; `Directory.open: ok`, `user_version 3 records identical NULL-id rows remaining: 2`) is my output line for line.
  - Left as the build's original and not reproduced by the gate: A2 (`PRAGMA foreign_keys = OFF` inside `BEGIN`, refused). The new text no longer rests on it.
  - Nothing is claimed that I did not measure, and nothing I measured is left out. The migration's header text is a comment before `CREATE TRIGGER`, so it does not enter `sqlite_master`.
- **F2 (low), fixed.** The frontmatter reads `difficulty: standard` and the round-1 entry records it as the owner's answer, "Keep B, re-rate standard", with the three options it was chosen from. I cannot see the owner's answer; the dispatch relayed it and it matches the Log.
- **F3 (low), fixed** for both fields, below.
- **F4 (low), fixed.** The header now says "The refusal holds from this migration on" and the migration is titled "never added without an id".

**The guards, run (`guards.mts`, the base's `directory.ts` loaded beside the head's)**

- **String paths unchanged:** 136 `(id, name)` pairs (17 ids including `""`, whitespace, `home`, `Home`, `home2`, `con`, `nul`, 32 and 33 letters, a NUL byte; 8 names including `""`, whitespace, 80 and 81 characters, a NUL byte), each added twice to a fresh directory at the base and at the head. 0 differ in outcome, in the duplicate's outcome, or in the rows stored.
- **Non-string `id`**, name valid: `null`, `undefined`, `7`, `NaN`, `true`, `{}`, `[]`, `['home']`, a function, `1n`, a `Symbol` all give `AppError BAD_REQUEST` with the id sentence, no row stored (the base threw `TypeError` for each). Two do not, see N1.
- **Non-string `name`**, id valid: the same 13 values all give `AppError BAD_REQUEST`, "A household's name is 1 to 80 characters.", no row stored, `Object.create(null)` and a throwing `toString` included, since this arm echoes nothing.
- Both fields bad: an invalid string id with `name: null` reports the name; `id: null` reports the id first. Formerly a `TypeError`, so nothing relies on the order.
- **Positive control, each guard deleted in turn in the detached tree** (restored from the gated sha each time, `git diff` empty after): the id guard line deleted gave `1 failed | 18 passed (19)`, `AssertionError: null: expected TypeError: Cannot read properties of null… to be an instance of AppError`; the name guard line deleted gave `1 failed | 18 passed (19)`, `null name: expected TypeError: Cannot read properties of null… to be an instance of AppError`. Restored, 19 of 19.

**The same shape elsewhere in `directory.ts`** (the dispatch asked to report it, not to assume it is in scope). `guards.mts` section 4 passed a non-string to each method on a directory holding one household:

| call                                                                 | result                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `addMember({ address: null })` or `undefined`                        | `TypeError`, `.trim` (inside `readAddress`)                             |
| `addMember({ person: null })`, `7`                                   | `TypeError`, `.trim`                                                    |
| `addMember({ household: {} })`                                       | `RangeError: Too few parameter values were provided` (the driver)       |
| `removeMember({ address: null })`                                    | `TypeError`, `.trim`                                                    |
| `membershipOf(null)` or `undefined`                                  | `TypeError`, `.toLowerCase`                                             |
| `addHousehold({ at: null })`                                         | `TypeError`, `.toISOString`, inside the transaction, nothing stored     |
| `addHousehold({ by: null })` or `undefined`                          | `SqliteError SQLITE_CONSTRAINT_NOTNULL` on `created_by`, nothing stored |
| `addMember({ household: null })`, `history(null)`, `household(null)` | `HOUSEHOLD_NOT_FOUND`, `[]`, `undefined`: no string method reached      |

No live call site reaches any of them: the routes parse the body with `addMemberRequestSchema`, `removeMemberRequestSchema` and `createHouseholdRequestSchema` (all `z.string()`), the host command defaults each argument to `""`, and the Access identity is a JWT claim checked `typeof email === "string"`.

- **low** · no `Done when` line depends on it · **N1, the id guard's own message can throw.** `notAnId(String(household.id as unknown))` stringifies the value to echo it, and `String()` throws on two non-strings: `addHousehold({ id: Object.create(null), … })` gives `TypeError: Cannot convert object to primitive value`, and an id whose `toString` throws gives that `Error`, neither an `AppError`, with no row stored. Reproduction: `guards.mts`, the "non-string id" block, rows `Object.create(null)` and `{toString(){throw}}`. No live call site (zod hands the class a string). The brief for this round, "every non-string gives `AppError BAD_REQUEST`", is therefore true of 11 of 13 id values and 13 of 13 name values. Fix, if wanted: echo `typeof` for an object instead of the value, or catch around the stringify. The echo is also uninformative for an array (`['home']` prints `home is not.`, `[]` prints an empty value).
- **low** · no `Done when` line depends on it · **N2, the name arm of the new test asserts `null` only, and its title says "an id or a name that is not a string".** With the name guard narrowed from `typeof household.name !== "string"` to `household.name == null`, the spec stays `19 passed (19)`. `undefined` and `7` as a name are measured correct above and unasserted. The id arm covers `null`, `undefined` and `7`. Title wider than the assertion, direction safe: the guard works.
- **low** · no live call site · **N3, open decision: the table above.** The owner chose "Fix here" twice for `addHousehold`'s two fields, both reached by this ticket's own reproduction (part (c)). The other rows share the shape and are not in that reproduction. Options: (1) **file one ticket** for the typed-string guards on `addMember`, `removeMember` and `membershipOf` (and `at`/`by` if wanted), with `guards.mts` section 4 as its reproduction (recommended: it keeps this PR at what the owner approved, and no caller can reach them today); (2) fold them in here, about three more guards and a test, at the cost of a third change to a branch already re-rated `standard`; (3) leave them recorded in the Log. I did not run option 2.
- **dropped** · the round-1 entry cites branch commits by short sha ("restored from …") in prose. They are plain text, not `@sha` citations that a squash would break.
- **findings** · the hunt returned 4 on the round's lines; 3 carried (N1, N2, N3), 1 dropped.
- NFR: security ✓ (the new refusals are `AppError BAD_REQUEST` raised before any SQL; N1 is the only path that escapes as another error) · performance n/a · reliability — N1, N3 · maintainability — N2; the guard reads clearly and its comment says why.
- Not run: `Directory.open` over a file whose migration list carries A7; A2; the Windows leg; the ubuntu `test` leg at this head (pending).

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
