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

  // 6 — spending categories: the list, the map from Desjardins' own categories to
  // it, a row's own override, and the column a rule and a period line gain (lg-15).
  // "Category" alone is still Desjardins' text on a row; every name here says
  // "spending" so the two are never read for each other.
  `
  -- The one list. A version is a name; a rename supersedes it and a retirement
  -- is a version that supersedes it, so nothing is updated. Everything that
  -- picks a category stores the id of its FIRST version (root_id, or id where
  -- that is NULL), which a rename therefore never changes.
  CREATE TABLE spending_categories (
    id INTEGER PRIMARY KEY,
    -- NULL on a category's first version, whose own id names the category.
    root_id INTEGER REFERENCES spending_categories (id),
    name TEXT NOT NULL,
    supersedes INTEGER REFERENCES spending_categories (id),
    -- 1 on a retirement: a copy of what it retires, no longer offered.
    retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    CHECK ((supersedes IS NULL) = (root_id IS NULL))
  );

  CREATE UNIQUE INDEX spending_categories_supersedes
    ON spending_categories (supersedes) WHERE supersedes IS NOT NULL;

  -- Generic words, so unlike rules they may be seeded from the repository.
  INSERT INTO spending_categories (name, created_at, created_by) VALUES
    ('Groceries', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'),
    ('Alcohol', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'),
    ('Household', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'),
    ('Pharmacy', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'),
    ('Restaurant', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration'),
    ('Other', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration');

  -- Each category as it now stands, retired or not: category_id is what the rest
  -- of the database stores, version_id the row it is read from.
  CREATE VIEW current_spending_categories AS
    SELECT coalesce(root_id, id) AS category_id, id AS version_id, name, retired, created_at, created_by
    FROM spending_categories
    WHERE NOT EXISTS (SELECT 1 FROM spending_categories newer WHERE newer.supersedes = spending_categories.id);

  -- Desjardins' category text to a spending category. Nothing is seeded: the
  -- texts are not all known. A version for a text supersedes the earlier ones by
  -- being later; NULL is the entry cleared. desjardins_key is the text folded the
  -- way the rules fold a category (books/src/classify.ts), desjardins_category
  -- the text as the person saw it.
  CREATE TABLE spending_category_map (
    id INTEGER PRIMARY KEY,
    desjardins_key TEXT NOT NULL,
    desjardins_category TEXT NOT NULL,
    spending_category_id INTEGER REFERENCES spending_categories (id),
    entered_at TEXT NOT NULL,
    entered_by TEXT NOT NULL
  );

  CREATE INDEX spending_category_map_key ON spending_category_map (desjardins_key, id);

  CREATE VIEW current_spending_category_map AS
    SELECT * FROM spending_category_map
    WHERE id = (SELECT max(id) FROM spending_category_map later WHERE later.desjardins_key = spending_category_map.desjardins_key);

  -- A row's own spending category, a record about the row and never a column on
  -- it (like a classification). The latest stands; NULL withdraws the override.
  CREATE TABLE spending_category_overrides (
    id INTEGER PRIMARY KEY,
    row_id INTEGER NOT NULL REFERENCES statement_rows (id),
    spending_category_id INTEGER REFERENCES spending_categories (id),
    set_at TEXT NOT NULL,
    set_by TEXT NOT NULL
  );

  CREATE INDEX spending_category_overrides_row ON spending_category_overrides (row_id, id);

  CREATE VIEW current_spending_category_overrides AS
    SELECT * FROM spending_category_overrides
    WHERE id = (SELECT max(id) FROM spending_category_overrides later WHERE later.row_id = spending_category_overrides.row_id);

  -- A rule version may name a spending category, which then overrides the map for
  -- every row it classifies. Rules stored before this name none.
  ALTER TABLE rules ADD COLUMN spending_category_id INTEGER REFERENCES spending_categories (id);

  -- A period line picks from the list. The free-text category column stays, and
  -- lines already stored keep their text and name no spending category.
  ALTER TABLE period_lines ADD COLUMN spending_category_id INTEGER REFERENCES spending_categories (id);

  -- current_rules and current_period_lines are SELECT * views and are left as they
  -- are: SQLite stores a view as text and expands the star on every use, so both
  -- already show the two columns above (api/test/spending-categories.test.ts
  -- reads them through the views on a database migration 5 left).
  `,

  // 7 — a classification history files with nobody tapping (lg-17). SQLite cannot
  // change a CHECK in place, so the table is rebuilt: every record is copied with
  // its id, the copy is proved before the old table goes, and the index and the
  // view are made again exactly as migration 2 made them. Why a rebuild and not a
  // sibling record is in lg-17's Log: ten read sites stand on this one table.
  `
  CREATE TABLE classifications_v7 (
    id INTEGER PRIMARY KEY,
    row_id INTEGER NOT NULL REFERENCES statement_rows (id),
    bucket TEXT NOT NULL CHECK (bucket IN ('mortgage', 'current-expenses')),
    -- NULL is joint: a rebate, the sale of a shared thing, one half of an error pair.
    person_id TEXT,
    -- The rule version applied or accepted; NULL for a person's own answer and
    -- for history's, which no rule gave.
    rule_id INTEGER REFERENCES rules (id),
    -- 'rule': the paste applied it. 'accepted': a person took a suggested rule.
    -- 'manual': a person's own answer. 'auto': the paste filed it on the three
    -- person-given answers below, with nobody tapping; it is never itself an
    -- answer, so history cannot feed on its own filings.
    source TEXT NOT NULL CHECK (source IN ('rule', 'accepted', 'manual', 'auto')),
    classified_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address; NULL
    -- only on 'auto', which no person made.
    classified_by TEXT,
    -- On 'auto' only: the three classifications it rests on, latest first. They
    -- name the new table, which the rename below makes this one: naming the old
    -- table would have the drop check every old record against these columns.
    rests_on_1 INTEGER REFERENCES classifications_v7 (id),
    rests_on_2 INTEGER REFERENCES classifications_v7 (id),
    rests_on_3 INTEGER REFERENCES classifications_v7 (id),
    CHECK ((source IN ('manual', 'auto')) = (rule_id IS NULL)),
    CHECK ((source = 'auto') = (classified_by IS NULL)),
    CHECK (CASE WHEN source = 'auto'
      THEN rests_on_1 IS NOT NULL AND rests_on_2 IS NOT NULL AND rests_on_3 IS NOT NULL
        AND rests_on_1 <> rests_on_2 AND rests_on_1 <> rests_on_3 AND rests_on_2 <> rests_on_3
      ELSE rests_on_1 IS NULL AND rests_on_2 IS NULL AND rests_on_3 IS NULL END)
  );

  INSERT INTO classifications_v7 (id, row_id, bucket, person_id, rule_id, source, classified_at, classified_by)
    SELECT id, row_id, bucket, person_id, rule_id, source, classified_at, classified_by
    FROM classifications;

  -- The proof: as many records, and none that differs in any column. A failed
  -- CHECK aborts the migration, which rolls back with the old table untouched.
  CREATE TEMP TABLE migration_7_copy (
    kept INTEGER NOT NULL,
    copied INTEGER NOT NULL,
    differing INTEGER NOT NULL,
    CHECK (copied = kept AND differing = 0)
  );
  INSERT INTO migration_7_copy SELECT
    (SELECT count(*) FROM classifications),
    (SELECT count(*) FROM classifications_v7),
    (SELECT count(*) FROM (
      SELECT id, row_id, bucket, person_id, rule_id, source, classified_at, classified_by FROM classifications
      EXCEPT
      SELECT id, row_id, bucket, person_id, rule_id, source, classified_at, classified_by FROM classifications_v7
    ));
  DROP TABLE migration_7_copy;

  DROP VIEW current_classifications;
  DROP TABLE classifications;
  ALTER TABLE classifications_v7 RENAME TO classifications;

  CREATE INDEX classifications_row ON classifications (row_id, id);

  CREATE VIEW current_classifications AS
    SELECT * FROM classifications
    WHERE id = (SELECT max(id) FROM classifications later WHERE later.row_id = classifications.row_id);
  `,

  // 8 — receipts: a photo uploaded, and what it was filed as on a person's
  // confirmation (lg-8).
  `
  -- A photo, stored on the data volume under photo, a name this service made
  -- (receipts/<household>/<photo>), never one a request gave. Uploading reads
  -- nothing and files nothing.
  CREATE TABLE receipts (
    id INTEGER PRIMARY KEY,
    photo TEXT NOT NULL UNIQUE,
    -- The type its first bytes say it is, never its name or a header.
    media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
    bytes INTEGER NOT NULL CHECK (bytes > 0),
    uploaded_at TEXT NOT NULL,
    -- Who took the photo, and so who paid for a line filed from it.
    uploaded_by TEXT NOT NULL REFERENCES people (id)
  );

  -- A receipt filed: the proposal as the person confirmed it, and either the
  -- period line it became or the joint-account row it documents. Never a column
  -- on the row or the line, which are not edited. A photo can hold more than one
  -- receipt, and each is filed once, as its part.
  CREATE TABLE receipt_filings (
    id INTEGER PRIMARY KEY,
    receipt_id INTEGER NOT NULL REFERENCES receipts (id),
    -- Which receipt in the photo, from 1.
    part INTEGER NOT NULL CHECK (part BETWEEN 1 AND 10),
    merchant TEXT,
    date TEXT,
    subtotal_cents INTEGER,
    gst_cents INTEGER,
    qst_cents INTEGER,
    total_cents INTEGER,
    period_line_id INTEGER REFERENCES period_lines (id),
    row_id INTEGER REFERENCES statement_rows (id),
    filed_at TEXT NOT NULL,
    filed_by TEXT NOT NULL,
    CHECK ((period_line_id IS NULL) <> (row_id IS NULL)),
    UNIQUE (receipt_id, part)
  );

  -- A row is documented by one receipt: two members photographing the same
  -- purchase must not both attach to it (gate 1, F3).
  CREATE UNIQUE INDEX receipt_filings_row ON receipt_filings (row_id) WHERE row_id IS NOT NULL;
  `,

  // 9 — a receipt's items, each shared, not shared or the other's, with its
  // spending category, and the charge the other's items became (lg-10).
  `
  -- The items as the person confirmed them, written with the filing and never
  -- after. What they took off the shared amount is not stored: it is on the
  -- lines the filing names, as the amounts filed.
  CREATE TABLE receipt_items (
    id INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES receipt_filings (id),
    -- In the order printed, from 1.
    position INTEGER NOT NULL CHECK (position >= 1),
    text TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    taxable INTEGER NOT NULL CHECK (taxable IN (0, 1)),
    -- The consigne printed for it; it carries no tax.
    deposit_cents INTEGER,
    spending_category_id INTEGER REFERENCES spending_categories (id),
    share TEXT NOT NULL CHECK (share IN ('shared', 'not-shared', 'theirs')),
    UNIQUE (filing_id, position)
  );

  -- The charge the other person's items became, when the receipt also left a
  -- shared line in period_line_id. When nothing on it was shared, the charge is
  -- period_line_id itself and this is NULL; every filing stored before this
  -- migration has none.
  ALTER TABLE receipt_filings ADD COLUMN charge_line_id INTEGER REFERENCES period_lines (id);
  `,

  // 10 — a settlement between more than two people (lg-23): its deposits and
  // transfers, one row each, written with the period and never after.
  `
  -- A close whose settlement is between two people still records it in the
  -- periods row itself, exactly as before. One between more leaves payer_id and
  -- recipient_id NULL and net_cents 0 there, deposit_cents NULL when only the
  -- transfers can settle it and 0 otherwise, and writes its figures here. A
  -- period with no row in either table settled as its periods row says.
  CREATE TABLE settlement_deposits (
    period_id INTEGER NOT NULL REFERENCES periods (id),
    person_id TEXT NOT NULL REFERENCES people (id),
    deposit_cents INTEGER NOT NULL CHECK (deposit_cents > 0),
    PRIMARY KEY (period_id, person_id)
  );

  CREATE TABLE settlement_transfers (
    id INTEGER PRIMARY KEY,
    period_id INTEGER NOT NULL REFERENCES periods (id),
    from_id TEXT NOT NULL REFERENCES people (id),
    to_id TEXT NOT NULL REFERENCES people (id),
    cents INTEGER NOT NULL CHECK (cents > 0),
    CHECK (from_id <> to_id)
  );

  CREATE INDEX settlement_transfers_period ON settlement_transfers (period_id, id);
  `,

  // 11 — whose a receipt item is, so a receipt can charge several people (lg-30).
  // The table is rebuilt as migration 7 rebuilt one: each item is copied with its
  // id, the two new columns filled from what lg-10 filed, the copy proved, and
  // only then the old table dropped. A rebuild rather than two added columns
  // because an added column can carry no CHECK, and these two have one each;
  // nothing else names this table, so nothing else is made again.
  `
  CREATE TABLE receipt_items_v11 (
    id INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES receipt_filings (id),
    -- In the order printed, from 1.
    position INTEGER NOT NULL CHECK (position >= 1),
    text TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    taxable INTEGER NOT NULL CHECK (taxable IN (0, 1)),
    -- The consigne printed for it; it carries no tax.
    deposit_cents INTEGER,
    spending_category_id INTEGER REFERENCES spending_categories (id),
    share TEXT NOT NULL CHECK (share IN ('shared', 'not-shared', 'theirs')),
    -- On a 'theirs' item, whose it is; NULL on every other. The API names every
    -- 'theirs' item it files (receipts.ts); one filed before this migration whose
    -- charge came to nothing filed no line to read a name from, and has none.
    charged_to TEXT REFERENCES people (id),
    -- The charge line the item's person's items became; NULL when that charge
    -- came to nothing and filed no line.
    charge_line_id INTEGER REFERENCES period_lines (id),
    UNIQUE (filing_id, position),
    CHECK (charged_to IS NULL OR share = 'theirs'),
    CHECK (charge_line_id IS NULL OR charged_to IS NOT NULL)
  );

  -- A filing before lg-30 made one charge, of every 'theirs' item. It is its
  -- charge_line_id when the receipt also left a shared line; else its one line,
  -- but only when that line is charged to someone: a shared line, which lg-10
  -- filed alone when the 'theirs' items came to nothing, is charged to nobody.
  -- The name is the line's own, as the filing named it, not a later version's.
  INSERT INTO receipt_items_v11 (id, filing_id, position, text, price_cents, taxable, deposit_cents, spending_category_id, share, charged_to, charge_line_id)
    SELECT items.id, items.filing_id, items.position, items.text, items.price_cents,
      items.taxable, items.deposit_cents, items.spending_category_id, items.share,
      CASE WHEN items.share = 'theirs' THEN charge.charged_to END,
      CASE WHEN items.share = 'theirs' THEN charge.id END
    FROM receipt_items items
    JOIN receipt_filings filings ON filings.id = items.filing_id
    LEFT JOIN period_lines charge
      ON charge.id = coalesce(filings.charge_line_id, filings.period_line_id)
      AND charge.charged_to IS NOT NULL;

  -- The proof: as many items, and none that differs in a column it had.
  CREATE TEMP TABLE migration_11_copy (
    kept INTEGER NOT NULL,
    copied INTEGER NOT NULL,
    differing INTEGER NOT NULL,
    CHECK (copied = kept AND differing = 0)
  );
  INSERT INTO migration_11_copy SELECT
    (SELECT count(*) FROM receipt_items),
    (SELECT count(*) FROM receipt_items_v11),
    (SELECT count(*) FROM (
      SELECT id, filing_id, position, text, price_cents, taxable, deposit_cents, spending_category_id, share FROM receipt_items
      EXCEPT
      SELECT id, filing_id, position, text, price_cents, taxable, deposit_cents, spending_category_id, share FROM receipt_items_v11
    ));
  DROP TABLE migration_11_copy;

  DROP TABLE receipt_items;
  ALTER TABLE receipt_items_v11 RENAME TO receipt_items;
  `,

  // 12 — the service categories (lg-53): what the workbook's words and the bank's
  // name that the first six did not. A household that already made one of these
  // names keeps its own and gets no second, which is the two-of-one-name the API
  // refuses (requireFreeName). The names are ASCII, so lower() is enough to fold.
  `
  WITH wanted (position, name) AS (VALUES
    (1, 'Property taxes'),
    (2, 'Electricity'),
    (3, 'Internet & phone'),
    (4, 'Subscriptions'),
    (5, 'Insurance'),
    (6, 'Home maintenance'),
    (7, 'Travel'),
    (8, 'Transport'),
    (9, 'Bank fees'),
    (10, 'Cash'))
  INSERT INTO spending_categories (name, created_at, created_by)
    SELECT name, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'migration' FROM wanted
    WHERE NOT EXISTS (
      SELECT 1 FROM current_spending_categories held
      WHERE held.retired = 0 AND lower(held.name) = lower(wanted.name))
    ORDER BY position;
  `,

  // 13 — what the household says about its mortgage (lg-55): live, ended on a
  // day, or none. No row means live, so a household that never says anything
  // reads exactly as before. A later record supersedes the earlier; none is edited.
  `
  CREATE TABLE mortgage_records (
    id INTEGER PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('live', 'ended', 'none')),
    -- yyyy-mm-dd, and only for 'ended'.
    ended_on TEXT,
    supersedes INTEGER REFERENCES mortgage_records (id),
    entered_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    entered_by TEXT NOT NULL,
    CHECK ((state = 'ended') = (ended_on IS NOT NULL))
  );

  -- Each record is corrected at most once, and there is one first record: one
  -- chain, so exactly one record stands.
  CREATE UNIQUE INDEX mortgage_records_supersedes ON mortgage_records (supersedes) WHERE supersedes IS NOT NULL;
  CREATE UNIQUE INDEX mortgage_records_first ON mortgage_records ((1)) WHERE supersedes IS NULL;

  CREATE VIEW current_mortgage_record AS
    SELECT * FROM mortgage_records
    WHERE NOT EXISTS (SELECT 1 FROM mortgage_records newer WHERE newer.supersedes = mortgage_records.id);
  `,

  // 14 — a person retired from the books at a close, or back (lg-35).
  `
  -- Who is in each period: an admin's request, recorded in the household
  -- directory, copied here by the close that applies it, so the books say who
  -- was in each period without the directory — a backup of the data directory
  -- restores it whole. A person is in until a retire takes effect and again from
  -- a return; the latest record from on or before a date stands, by id.
  CREATE TABLE people_retirements (
    id INTEGER PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people (id),
    action TEXT NOT NULL CHECK (action IN ('retire', 'return')),
    -- yyyy-mm-dd: the day after the closed period's end_date, the first day it holds.
    from_date TEXT NOT NULL,
    -- The close that applied it.
    period_id INTEGER NOT NULL REFERENCES periods (id),
    -- The directory's record it copies (retirements.id), so each is applied once.
    -- Not an address: the admin who asked is in the directory's record only.
    directory_id INTEGER NOT NULL UNIQUE
  );
  `,

  // 15 — how the mortgage's joint rows split, from a date (lg-63): by shares,
  // equally, or at the ratio. No row means equal from the first row, so a
  // household whose people never changed reads exactly as before. Filing another
  // for the same day supersedes it, as a ratio does; none is edited.
  `
  CREATE TABLE mortgage_splits (
    id INTEGER PRIMARY KEY,
    -- yyyy-mm-dd: the first day it holds.
    effective_from TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('shares', 'equal', 'ratio')),
    supersedes INTEGER REFERENCES mortgage_splits (id),
    entered_at TEXT NOT NULL,
    -- The Access identity's configured name (Person.id), never an address.
    entered_by TEXT NOT NULL
  );

  -- Each record is superseded at most once, and a day has one first record:
  -- one chain per day, so exactly one record stands for it.
  CREATE UNIQUE INDEX mortgage_splits_supersedes ON mortgage_splits (supersedes) WHERE supersedes IS NOT NULL;
  CREATE UNIQUE INDEX mortgage_splits_first ON mortgage_splits (effective_from) WHERE supersedes IS NULL;

  CREATE VIEW current_mortgage_splits AS
    SELECT * FROM mortgage_splits
    WHERE NOT EXISTS (SELECT 1 FROM mortgage_splits newer WHERE newer.supersedes = mortgage_splits.id);

  -- Each person's part of a split by shares, in parts per million; none for the
  -- other modes. The parts of one split sum to 1 000 000: nothing derives them,
  -- so the API refuses a set that does not, and a test holds it to that.
  CREATE TABLE mortgage_split_shares (
    split_id INTEGER NOT NULL REFERENCES mortgage_splits (id),
    person_id TEXT NOT NULL REFERENCES people (id),
    parts_per_million INTEGER NOT NULL CHECK (parts_per_million BETWEEN 0 AND 1000000),
    PRIMARY KEY (split_id, person_id)
  );
  `,
];

/**
 * Brings `db` up to `target`, every migration by default. A test passes a lower
 * `target` to build a database as an earlier release left it, then migrates the
 * rest of the way, which is what an upgrade does.
 */
export function migrate(db: Database, target: number = MIGRATIONS.length): void {
  configure(db);
  applyMigrations(db, target);
}

/** The connection's settings. None of them can change inside a transaction. */
export function configure(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Without this, a concurrent writer fails instantly with SQLITE_BUSY rather
  // than waiting.
  db.pragma("busy_timeout = 5000");
}

/**
 * The migrations `db` lacks, each in its own transaction — or, when a
 * transaction is already open, each in a savepoint inside it, so that rolling
 * that transaction back leaves the database at the version it had (the
 * workbook import, lg-7, migrates inside the transaction it may refuse).
 */
export function applyMigrations(db: Database, target: number = MIGRATIONS.length): void {
  applyMigrationList(db, MIGRATIONS, target);
}

/**
 * The loop itself, over any list: the household directory (lg-20) is a file of
 * its own with migrations of its own, numbered from 1 in its own
 * `user_version`, and applied the same way.
 */
export function applyMigrationList(
  db: Database,
  migrations: readonly string[],
  target: number = migrations.length,
): void {
  const current = Number((db.pragma("user_version", { simple: true }) as number) ?? 0);
  const nested = db.inTransaction;
  for (let version = current; version < Math.min(target, migrations.length); version++) {
    const statement = migrations[version];
    if (statement === undefined) continue;
    db.exec(nested ? "SAVEPOINT migration" : "BEGIN");
    try {
      db.exec(statement);
      // Interpolated because PRAGMA does not accept a bound parameter. The
      // value is a loop counter, never user input.
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      db.exec(nested ? "RELEASE migration" : "COMMIT");
    } catch (error: unknown) {
      db.exec(nested ? "ROLLBACK TO migration; RELEASE migration" : "ROLLBACK");
      throw error;
    }
  }
}
