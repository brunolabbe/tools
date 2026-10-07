/**
 * SQLite schema and migrations.
 *
 * Migrations are a numbered list applied in order inside a transaction, tracked
 * by `user_version`. Deliberately the smallest thing that works — the same
 * shape as the planner's.
 *
 * **The books arrive one ticket at a time.** The accounts, buckets, split and
 * receipts are designed in `docs/00-ANALYSIS.md` before a table exists for any
 * of them, because a table guessed at now is a migration to undo later, and here
 * "later" means a database holding years of a household's history. Migration 1 is
 * the first thing stored: the pasted statement rows (lg-2).
 *
 * **Nothing here is ever updated in place** (`docs/00-ANALYSIS.md` §9). A
 * correction is a later row that supersedes the earlier one, so every table is
 * written with `INSERT` and nothing in this tool issues an `UPDATE` or a
 * `DELETE` against one.
 */

import type { Database } from "better-sqlite3";

/**
 * Each entry is one irreversible step. Never edit a shipped migration — append
 * a new one, or an existing database and a fresh one end up different shapes.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — the pasted statement (lg-2).
  `
  CREATE TABLE statement_imports (
    id INTEGER PRIMARY KEY,
    -- ISO instant the paste was stored, from the app's clock.
    imported_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    imported_by TEXT NOT NULL
  );

  CREATE TABLE statement_rows (
    id INTEGER PRIMARY KEY,
    -- Position in the account's history, oldest lowest. It is a position, not
    -- a count: the first paste starts at 0 and each later row takes the highest
    -- stored position plus one, so older rows can later be numbered below the
    -- oldest, which is why it may be negative. Once written it is never changed.
    seq INTEGER NOT NULL UNIQUE,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL,
    import_id INTEGER NOT NULL REFERENCES statement_imports (id)
  );

  -- Not unique. A transfer, its reversal and the transfer again on one day give
  -- two rows with the same date, description, amount and balance, so a row's
  -- place is its position, and a paste is matched against the stored rows by
  -- position (statements.ts). This only finds a candidate quickly.
  CREATE INDEX statement_rows_identity
    ON statement_rows (date, description, amount_cents, balance_cents);
  `,

  // 2 — the rules, and the classification of each row (lg-4).
  `
  -- A rule version. Editing a rule inserts a new version that supersedes the
  -- old, and retiring one inserts a retirement that does, so a classification
  -- that cites a rule cites it as it read then. Nothing here is ever updated.
  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    -- The description as the bank writes it; * is any run of characters.
    description_pattern TEXT NOT NULL,
    -- NULL in either of the next two means "any".
    category TEXT,
    amount_cents INTEGER,
    -- A configured Person.id; NULL is joint.
    person_id TEXT,
    bucket TEXT NOT NULL CHECK (bucket IN ('mortgage', 'current-expenses')),
    -- The version this one replaces, if any.
    supersedes INTEGER REFERENCES rules (id),
    -- 1 on a retirement: a copy of what it retires, which is no longer in force.
    retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );

  -- A version is replaced at most once, so two people editing the same rule at
  -- once cannot both win: the second insert is refused by the database.
  CREATE UNIQUE INDEX rules_supersedes ON rules (supersedes) WHERE supersedes IS NOT NULL;

  -- The rules in force: not replaced by anything, and not a retirement.
  CREATE VIEW current_rules AS
    SELECT * FROM rules
    WHERE retired = 0
      AND NOT EXISTS (SELECT 1 FROM rules newer WHERE newer.supersedes = rules.id);

  -- A classification is a record about a row, never a column on it. Reclassifying
  -- appends another, with who did it and when; the latest one stands.
  CREATE TABLE classifications (
    id INTEGER PRIMARY KEY,
    row_id INTEGER NOT NULL REFERENCES statement_rows (id),
    bucket TEXT NOT NULL CHECK (bucket IN ('mortgage', 'current-expenses')),
    -- NULL is joint: a rebate, the sale of a shared thing, one half of an error pair.
    person_id TEXT,
    -- The rule version applied or accepted; NULL for a person's own answer.
    rule_id INTEGER REFERENCES rules (id),
    -- 'rule': the paste applied it. 'accepted': a person took a suggested rule.
    -- 'manual': a person's own answer, which is the only one with no rule.
    source TEXT NOT NULL CHECK (source IN ('rule', 'accepted', 'manual')),
    classified_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    classified_by TEXT NOT NULL,
    CHECK ((source = 'manual') = (rule_id IS NULL))
  );

  CREATE INDEX classifications_row ON classifications (row_id, id);

  -- The classification that stands for each row: the latest appended. Ordered by
  -- id, which only ever grows, rather than by a timestamp two writers could tie.
  CREATE VIEW current_classifications AS
    SELECT * FROM classifications
    WHERE id = (SELECT max(id) FROM classifications later WHERE later.row_id = classifications.row_id);
  `,

  // 3 — the people, their salaries and the ratio (lg-5).
  `
  -- The household. A person's id is the name the configuration maps their
  -- Access address to (Person.id), which is also what is shown, and what lg-4's
  -- rules and classifications already store as plain text: so the ids here must
  -- stay those names, or the rows stored before this table would name nobody.
  -- The addresses stay in configuration. A person is added at boot, when the
  -- configuration first names them, and is never removed: the rows they are
  -- named on outlive any change to who may sign in.
  CREATE TABLE people (
    id TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
  );

  -- The person ids lg-4 already stored on rules and classifications, configured
  -- now or not, and nothing else: added as of the first record naming them.
  -- Boot then adds the configured names this leaves out (people.ts). From here
  -- on a person id is checked against this table before it is stored.
  INSERT INTO people (id, added_at)
    SELECT person_id, min(at) FROM (
      SELECT person_id, created_at AS at FROM rules WHERE person_id IS NOT NULL
      UNION ALL
      SELECT person_id, classified_at FROM classifications WHERE person_id IS NOT NULL
    )
    GROUP BY person_id;

  -- A person's salary for a year. A correction is a later record that
  -- supersedes the earlier, which stays.
  CREATE TABLE salaries (
    id INTEGER PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people (id),
    year INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    supersedes INTEGER REFERENCES salaries (id),
    entered_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    entered_by TEXT NOT NULL
  );

  -- Each record is corrected at most once, and a person's year has one first
  -- record: together, one chain per person and year, so exactly one stands.
  CREATE UNIQUE INDEX salaries_supersedes ON salaries (supersedes) WHERE supersedes IS NOT NULL;
  CREATE UNIQUE INDEX salaries_first ON salaries (person_id, year) WHERE supersedes IS NULL;

  CREATE VIEW current_salaries AS
    SELECT * FROM salaries
    WHERE NOT EXISTS (SELECT 1 FROM salaries newer WHERE newer.supersedes = salaries.id);

  -- A ratio, confirmed, and the day it takes effect. Stored and not only derived,
  -- so a settlement can be recomputed with the ratio it used after a salary is
  -- corrected. Confirming another ratio for the same day supersedes this one.
  CREATE TABLE ratios (
    id INTEGER PRIMARY KEY,
    -- yyyy-mm-dd.
    effective_from TEXT NOT NULL,
    supersedes INTEGER REFERENCES ratios (id),
    entered_at TEXT NOT NULL,
    entered_by TEXT NOT NULL
  );

  CREATE UNIQUE INDEX ratios_supersedes ON ratios (supersedes) WHERE supersedes IS NOT NULL;
  CREATE UNIQUE INDEX ratios_first ON ratios (effective_from) WHERE supersedes IS NULL;

  CREATE VIEW current_ratios AS
    SELECT * FROM ratios
    WHERE NOT EXISTS (SELECT 1 FROM ratios newer WHERE newer.supersedes = ratios.id);

  -- Each person's part of a ratio, in parts per million, and the salary record
  -- it was derived from, if any. The parts of one ratio sum to 1 000 000; the
  -- API derives them, and a test holds it to that.
  CREATE TABLE ratio_shares (
    ratio_id INTEGER NOT NULL REFERENCES ratios (id),
    person_id TEXT NOT NULL REFERENCES people (id),
    parts_per_million INTEGER NOT NULL CHECK (parts_per_million BETWEEN 0 AND 1000000),
    salary_id INTEGER REFERENCES salaries (id),
    PRIMARY KEY (ratio_id, person_id)
  );
  `,

  // 4 — periods of personal-card spending, and the settlement closing one records (lg-6).
  `
  -- An amount paid on a person's own card toward the household. A period holds
  -- the lines dated inside it, so a line names no period. Correcting a line
  -- files one that supersedes it; removing one files a retirement that does.
  CREATE TABLE period_lines (
    id INTEGER PRIMARY KEY,
    -- Who paid.
    person_id TEXT NOT NULL REFERENCES people (id),
    -- yyyy-mm-dd.
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
    category TEXT,
    note TEXT,
    -- 'manual' (lg-6). No CHECK, because the import (lg-7) and receipts (lg-8)
    -- each add a source, and SQLite cannot change a CHECK without rebuilding
    -- the table; the API validates it against the contract instead.
    source TEXT NOT NULL,
    -- NULL is shared at the ratio. A person is a charge: the thing was entirely
    -- theirs, and they owe the whole of it to whoever paid.
    charged_to TEXT REFERENCES people (id),
    supersedes INTEGER REFERENCES period_lines (id),
    retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
    entered_at TEXT NOT NULL,
    entered_by TEXT NOT NULL,
    CHECK (charged_to IS NULL OR charged_to <> person_id)
  );

  CREATE UNIQUE INDEX period_lines_supersedes ON period_lines (supersedes) WHERE supersedes IS NOT NULL;
  CREATE INDEX period_lines_date ON period_lines (date);

  CREATE VIEW current_period_lines AS
    SELECT * FROM period_lines
    WHERE retired = 0
      AND NOT EXISTS (SELECT 1 FROM period_lines newer WHERE newer.supersedes = period_lines.id);

  -- A fixed monthly item. It is stored, and its monthly lines are generated
  -- from it on every read, never stored. Correcting or ending one files a
  -- version that supersedes it, with the end date set.
  CREATE TABLE recurring_items (
    id INTEGER PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people (id),
    monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0),
    start_date TEXT NOT NULL,
    -- NULL while it runs; the last day it can generate a line on.
    end_date TEXT,
    label TEXT NOT NULL,
    supersedes INTEGER REFERENCES recurring_items (id),
    entered_at TEXT NOT NULL,
    entered_by TEXT NOT NULL,
    CHECK (end_date IS NULL OR end_date >= start_date)
  );

  CREATE UNIQUE INDEX recurring_items_supersedes ON recurring_items (supersedes) WHERE supersedes IS NOT NULL;

  CREATE VIEW current_recurring_items AS
    SELECT * FROM recurring_items
    WHERE NOT EXISTS (SELECT 1 FROM recurring_items newer WHERE newer.supersedes = recurring_items.id);

  -- A closed period and the settlement it recorded. Only a closed period is a
  -- row: the open one starts the day after the last closed, so closing is one
  -- INSERT and nothing is updated. The first period's start is the point the two
  -- were last even; NULL is the beginning of the books.
  CREATE TABLE periods (
    id INTEGER PRIMARY KEY,
    start_date TEXT,
    end_date TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    closed_by TEXT NOT NULL,
    -- The settlement. 'v1' and 'v2' are the workbook's historical formulas
    -- (lg-7); 'v3' is the tool's (books/src/settlement.ts).
    formula TEXT NOT NULL CHECK (formula IN ('v1', 'v2', 'v3')),
    -- The ratio in effect on end_date, which the deposit was divided by.
    ratio_id INTEGER NOT NULL REFERENCES ratios (id),
    -- Both NULL when the two stood at the ratio, to within half a cent.
    payer_id TEXT REFERENCES people (id),
    recipient_id TEXT REFERENCES people (id),
    -- Into the buffer. NULL only when the recipient's share was zero, so that a
    -- direct transfer was the only way to settle.
    deposit_cents INTEGER CHECK (deposit_cents >= 0),
    -- The same debt, paid directly instead.
    net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
    CHECK (start_date IS NULL OR start_date <= end_date),
    CHECK ((payer_id IS NULL) = (recipient_id IS NULL))
  );

  -- One period per start, and one from the beginning: two people closing the
  -- same open period at once cannot both record a settlement.
  CREATE UNIQUE INDEX periods_start ON periods (coalesce(start_date, ''));
  `,

  // 5 — the workbook's history, imported once (lg-7).
  `
  -- Where a batch of rows came from: 'paste' is AccèsD (lg-2), and every batch
  -- stored before this migration was one; 'workbook' is the household's old
  -- spreadsheet, imported once, whose rows are numbered below the oldest pasted
  -- one. The rows themselves say nothing of it: a row is a row of the account.
  ALTER TABLE statement_imports
    ADD COLUMN source TEXT NOT NULL DEFAULT 'paste' CHECK (source IN ('paste', 'workbook'));

  -- What the workbook's own note said about a row, and what a correction made
  -- on import says about it. Written with the row, never after; NULL on a paste.
  ALTER TABLE statement_rows ADD COLUMN note TEXT;
  `,
];

/**
 * Brings `db` up to `target`, every migration by default. A test passes a lower
 * `target` to build a database as an earlier release left it, then migrates the
 * rest of the way, which is what an upgrade does.
 */
export function migrate(db: Database, target: number = MIGRATIONS.length): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Without this, a concurrent writer fails instantly with SQLITE_BUSY rather
  // than waiting.
  db.pragma("busy_timeout = 5000");

  const current = Number((db.pragma("user_version", { simple: true }) as number) ?? 0);
  for (let version = current; version < Math.min(target, MIGRATIONS.length); version++) {
    const statement = MIGRATIONS[version];
    if (statement === undefined) continue;
    db.exec("BEGIN");
    try {
      db.exec(statement);
      // Interpolated because PRAGMA does not accept a bound parameter. The
      // value is a loop counter, never user input.
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      db.exec("COMMIT");
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
