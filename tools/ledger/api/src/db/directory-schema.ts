/**
 * The household directory's schema (lg-20): who belongs to which household.
 *
 * A SQLite file of its own, beside the books and apart from them, with its own
 * migrations numbered from 1 in its own `user_version`. The books' migrations
 * (`schema.ts`) never run here and these never run there: from lg-21 on there is
 * one books file per household and one directory for all of them.
 *
 * **Appended, never edited**, like every record in this tool. A membership is a
 * record that adds an address to a household under a person's name, or removes
 * it; the current membership is a view over them, as `current_rules` is over
 * `rules`. Here the database refuses an `UPDATE` or a `DELETE` itself, with a
 * trigger, on top of the source scan that holds the books to the same rule.
 */

import type { Database } from "better-sqlite3";
import { applyMigrationList, configure } from "./schema.ts";

/**
 * Each entry is one irreversible step. Never edit a shipped migration — append
 * a new one.
 */
const DIRECTORY_MIGRATIONS: readonly string[] = [
  // 1 — households and who belongs to them (lg-20).
  `
  -- A household. Its id becomes a file name in lg-21, so it is a plain
  -- lowercase word, and never one of the four Windows keeps for a device.
  -- Nothing here renames or removes one.
  CREATE TABLE households (
    id TEXT PRIMARY KEY CHECK (
      length(id) BETWEEN 1 AND 32
      AND id NOT GLOB '*[^a-z]*'
      -- length() and GLOB stop at a NUL, so 'ho' || char(0) || 'me' reads as
      -- 'ho'; the byte count is the length of the whole value.
      AND length(CAST(id AS BLOB)) = length(id)
      AND id NOT IN ('con', 'prn', 'aux', 'nul')
    ),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND name = trim(name)),
    created_at TEXT NOT NULL,
    -- Who created it: an address, or 'operator' for the host command.
    created_by TEXT NOT NULL
  );

  -- One change to who belongs where. 'add' puts an address in a household under
  -- a person's name; 'remove' takes it out, and copies the household and the
  -- name it removes, so a household's history reads whole from its own records.
  CREATE TABLE memberships (
    id INTEGER PRIMARY KEY,
    -- Lower-cased: Access's address, as the identity check compares it.
    address TEXT NOT NULL CHECK (address = lower(trim(address)) AND address GLOB '?*@?*'),
    household_id TEXT NOT NULL REFERENCES households (id),
    -- The person's name in the household, which the books store as Person.id.
    person TEXT NOT NULL CHECK (length(person) BETWEEN 1 AND 64 AND person = trim(person)),
    action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
    changed_at TEXT NOT NULL,
    -- Who made the change: an address, or 'operator' for the host command.
    changed_by TEXT NOT NULL
  );

  CREATE INDEX memberships_address ON memberships (address, id);
  CREATE INDEX memberships_household ON memberships (household_id, person);

  -- Who belongs where now: each address's latest record, when it is an add.
  -- Ordered by id, which only ever grows, rather than by a timestamp two writers
  -- could tie.
  CREATE VIEW current_members AS
    SELECT address, household_id, person, changed_at AS added_at, changed_by AS added_by
    FROM memberships
    WHERE action = 'add'
      AND id = (SELECT max(id) FROM memberships later WHERE later.address = memberships.address);

  -- An address belongs to at most one household: an add is only for an address
  -- that is in none now.
  CREATE TRIGGER memberships_one_household BEFORE INSERT ON memberships
    WHEN NEW.action = 'add'
      AND EXISTS (SELECT 1 FROM current_members WHERE address = NEW.address)
    BEGIN SELECT RAISE(ABORT, 'the address already belongs to a household'); END;

  -- A removal copies the membership that stands, and nothing else.
  CREATE TRIGGER memberships_remove_what_stands BEFORE INSERT ON memberships
    WHEN NEW.action = 'remove'
      AND NOT EXISTS (
        SELECT 1 FROM current_members
        WHERE address = NEW.address AND household_id = NEW.household_id AND person = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'the removal does not name a membership that stands'); END;

  -- At most two person names a household has ever held. Ever, not now: a name
  -- stays in the household's books once it is there (00-ANALYSIS.md §7, a name
  -- is permanent), and the books settle between two people and nobody else.
  -- A further address for a name already held is not a third person.
  CREATE TRIGGER memberships_two_people BEFORE INSERT ON memberships
    WHEN NEW.action = 'add'
      AND NEW.person NOT IN (SELECT person FROM memberships WHERE household_id = NEW.household_id)
      AND (SELECT count(DISTINCT person) FROM memberships WHERE household_id = NEW.household_id) >= 2
    BEGIN SELECT RAISE(ABORT, 'HOUSEHOLD_FULL'); END;

  CREATE TRIGGER memberships_never_updated BEFORE UPDATE ON memberships
    BEGIN SELECT RAISE(ABORT, 'a membership record is appended, never edited'); END;
  CREATE TRIGGER memberships_never_deleted BEFORE DELETE ON memberships
    BEGIN SELECT RAISE(ABORT, 'a membership record is appended, never deleted'); END;
  CREATE TRIGGER households_never_updated BEFORE UPDATE ON households
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never edited'); END;
  CREATE TRIGGER households_never_deleted BEFORE DELETE ON households
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never deleted'); END;
  `,
];

/** Brings a directory up to `target`, every migration by default. */
export function migrateDirectory(db: Database, target: number = DIRECTORY_MIGRATIONS.length): void {
  configure(db);
  applyMigrationList(db, DIRECTORY_MIGRATIONS, target);
}
