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
  // 2 — a record is never replaced (lg-20's gate, F2; lg-22).
  `
  -- SQLite's REPLACE conflict resolution deletes the row in the way without
  -- firing a DELETE trigger (recursive_triggers is off), so the triggers above
  -- let an add become a removal and a household be renamed. A record whose id
  -- is taken is refused before any conflict is resolved, which is also what an
  -- upsert meets first.
  CREATE TRIGGER memberships_never_replaced BEFORE INSERT ON memberships
    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM memberships WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a membership record is appended, never replaced'); END;
  CREATE TRIGGER households_never_replaced BEFORE INSERT ON households
    WHEN EXISTS (SELECT 1 FROM households WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never replaced'); END;
  `,
  // 3 — a household is never added without an id (lg-24).
  `
  -- households.id is a TEXT PRIMARY KEY, which SQLite lets hold NULL, and its
  -- CHECK passes when the expression is NULL, so migration 1 stores a household
  -- with no id, and as many as are written, since NULLs never collide in a key.
  -- households_never_replaced compares with =, which no NULL matches.
  --
  -- The refusal holds from this migration on. A trigger does not read the rows
  -- already there, so a household stored with no id before it stays.
  --
  -- A trigger rather than NOT NULL on the column, so PRAGMA table_info still
  -- reads notnull 0 for the id and the refusal is this trigger's. Declaring the
  -- column means rebuilding the table. Rebuilding by copying to a new table and
  -- dropping the old fails on a directory that holds a membership, with or
  -- without defer_foreign_keys; copying the rows aside, dropping, recreating and
  -- copying back under defer_foreign_keys does apply (both measured in lg-24).
  -- Not taken: that rebuild refuses a directory that already holds a NULL id,
  -- so it would not open until the file was mended by hand, and it rewrites the
  -- table in place on a live file this trigger leaves alone.
  CREATE TRIGGER households_id_not_null BEFORE INSERT ON households
    WHEN NEW.id IS NULL
    BEGIN SELECT RAISE(ABORT, 'a household has an id'); END;
  `,
  // 4 — a household holds any number of people (lg-23).
  `
  -- Migration 1's cap of two person names a household has ever held goes: the
  -- books now settle between any number of people. A name is still permanent
  -- in the books (00-ANALYSIS.md §7); what changes is that a third is not one
  -- too many.
  DROP TRIGGER memberships_two_people;
  `,
  // 5 — a person's shown name (lg-33).
  `
  -- A person's id is the name a membership first gave them, and the books store
  -- it on every rule, classification, salary and share, so it never changes
  -- (00-ANALYSIS.md §7). What changes is how they are shown: a record here, set
  -- by an admin, and the latest one stands. A person with none is shown under
  -- their id. It lives in the directory, not the books, because an admin who
  -- renames reads no books and may be in no household.
  CREATE TABLE person_names (
    id INTEGER PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id),
    -- The person's id, as memberships.person names them.
    person TEXT NOT NULL CHECK (length(person) BETWEEN 1 AND 64 AND person = trim(person)),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64 AND name = trim(name)),
    named_at TEXT NOT NULL,
    -- Who named them: an admin's address.
    named_by TEXT NOT NULL
  );

  CREATE INDEX person_names_person ON person_names (household_id, person, id);

  -- How each named person is shown now: their latest record, by id, which only
  -- ever grows, as current_members is ordered.
  CREATE VIEW current_person_names AS
    SELECT household_id, person, name, named_at, named_by
    FROM person_names
    WHERE id = (
      SELECT max(id) FROM person_names later
      WHERE later.household_id = person_names.household_id AND later.person = person_names.person
    );

  -- Only a person a membership of the household has named has a shown name: an
  -- id the books hold only from an old rule is not in the directory at all.
  CREATE TRIGGER person_names_held BEFORE INSERT ON person_names
    WHEN NOT EXISTS (
      SELECT 1 FROM memberships WHERE household_id = NEW.household_id AND person = NEW.person
    )
    BEGIN SELECT RAISE(ABORT, 'a shown name is for a person the household has held'); END;

  -- A shown name is unique in its household: no other person is shown under it
  -- now, and no other person has it as their id, which is what a person with no
  -- record is shown under and what the books store.
  CREATE TRIGGER person_names_unique BEFORE INSERT ON person_names
    WHEN EXISTS (
        SELECT 1 FROM current_person_names
        WHERE household_id = NEW.household_id AND person <> NEW.person AND name = NEW.name
      )
      OR EXISTS (
        SELECT 1 FROM memberships
        WHERE household_id = NEW.household_id AND person <> NEW.person AND person = NEW.name
      )
    BEGIN SELECT RAISE(ABORT, 'a shown name is unique in its household'); END;

  -- The same rule from the other side: a new person's id is not a name another
  -- person of the household is shown under, or two people would be shown alike.
  CREATE TRIGGER memberships_person_not_shown_as_another BEFORE INSERT ON memberships
    WHEN NEW.action = 'add'
      AND NEW.person NOT IN (SELECT person FROM memberships WHERE household_id = NEW.household_id)
      AND EXISTS (
        SELECT 1 FROM current_person_names
        WHERE household_id = NEW.household_id AND name = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'a shown name is unique in its household'); END;

  CREATE TRIGGER person_names_never_updated BEFORE UPDATE ON person_names
    BEGIN SELECT RAISE(ABORT, 'a shown name record is appended, never edited'); END;
  CREATE TRIGGER person_names_never_deleted BEFORE DELETE ON person_names
    BEGIN SELECT RAISE(ABORT, 'a shown name record is appended, never deleted'); END;
  CREATE TRIGGER person_names_never_replaced BEFORE INSERT ON person_names
    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM person_names WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a shown name record is appended, never replaced'); END;
  `,
  // 6 — a person retired from the books, or brought back, at the next close (lg-35).
  `
  -- An admin's request: retire a person from the books at the next close, or
  -- bring a retired one back at the next close after it. The request lives here
  -- because an admin reads no books and may be in no household; the close that
  -- applies it copies it into the household's books (people_retirements), which
  -- then say who was in each period without this file.
  CREATE TABLE retirements (
    id INTEGER PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id),
    -- The person's id, as memberships.person names them.
    person TEXT NOT NULL CHECK (length(person) BETWEEN 1 AND 64 AND person = trim(person)),
    action TEXT NOT NULL CHECK (action IN ('retire', 'return')),
    recorded_at TEXT NOT NULL,
    -- Who asked: an admin's address.
    recorded_by TEXT NOT NULL
  );

  CREATE INDEX retirements_person ON retirements (household_id, person, id);

  -- Only a person a membership of the household has named is retired or returned.
  CREATE TRIGGER retirements_held BEFORE INSERT ON retirements
    WHEN NOT EXISTS (
      SELECT 1 FROM memberships WHERE household_id = NEW.household_id AND person = NEW.person
    )
    BEGIN SELECT RAISE(ABORT, 'a retirement is for a person the household has held'); END;

  -- Nobody who can still sign in is retired: every address under the person goes
  -- first, and memberships_not_under_retired below keeps a new one from coming
  -- back while the retirement waits or holds. The one gap is a close whose echo
  -- (retirements_applied) failed to be written: until the next close writes it,
  -- a return can read as cancelling a retirement the books have applied.
  CREATE TRIGGER retirements_no_address BEFORE INSERT ON retirements
    WHEN NEW.action = 'retire'
      AND EXISTS (
        SELECT 1 FROM current_members
        WHERE household_id = NEW.household_id AND person = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'a person is retired only once no address stands under them'); END;

  -- A record changes the person's latest state: a retire for someone in, a
  -- return for someone retired. A person with no record is in. By id, which
  -- only ever grows, as current_members is ordered.
  CREATE TRIGGER retirements_change_state BEFORE INSERT ON retirements
    WHEN coalesce((
        SELECT action FROM retirements
        WHERE household_id = NEW.household_id AND person = NEW.person
        ORDER BY id DESC LIMIT 1
      ), 'return') = NEW.action
    BEGIN SELECT RAISE(ABORT, 'a retirement record changes the person''s state'); END;

  CREATE TRIGGER retirements_never_updated BEFORE UPDATE ON retirements
    BEGIN SELECT RAISE(ABORT, 'a retirement record is appended, never edited'); END;
  CREATE TRIGGER retirements_never_deleted BEFORE DELETE ON retirements
    BEGIN SELECT RAISE(ABORT, 'a retirement record is appended, never deleted'); END;
  CREATE TRIGGER retirements_never_replaced BEFORE INSERT ON retirements
    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM retirements WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a retirement record is appended, never replaced'); END;

  -- That a close has applied a request to the household's books, and from which
  -- day, written by the close after its books commit. It is what lets the admin
  -- screen tell "retiring at the next close" from "retired" without reading any
  -- books. The books are the record of who was in; this is only the echo of it,
  -- and a close writes any echo an earlier one failed to.
  CREATE TABLE retirements_applied (
    retirement_id INTEGER PRIMARY KEY REFERENCES retirements (id),
    -- yyyy-mm-dd: the day after the period the close ended.
    from_date TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TRIGGER retirements_applied_never_updated BEFORE UPDATE ON retirements_applied
    BEGIN SELECT RAISE(ABORT, 'an applied retirement is appended, never edited'); END;
  CREATE TRIGGER retirements_applied_never_deleted BEFORE DELETE ON retirements_applied
    BEGIN SELECT RAISE(ABORT, 'an applied retirement is appended, never deleted'); END;
  CREATE TRIGGER retirements_applied_never_replaced BEFORE INSERT ON retirements_applied
    WHEN EXISTS (SELECT 1 FROM retirements_applied WHERE retirement_id = NEW.retirement_id)
    BEGIN SELECT RAISE(ABORT, 'an applied retirement is appended, never replaced'); END;

  -- No address is added under a person whose retirement waits for a close or
  -- has been applied, until a return is applied (lg-35's gate 1, F1; the
  -- owner, 2026-10-20): their latest request is a retire (retiring, retired),
  -- or the latest a close applied is (returning). A retire and a return both
  -- waiting for one close leave neither, and the person is in.
  CREATE TRIGGER memberships_not_under_retired BEFORE INSERT ON memberships
    WHEN NEW.action = 'add'
      AND (
        (SELECT action FROM retirements
          WHERE household_id = NEW.household_id AND person = NEW.person
          ORDER BY id DESC LIMIT 1) = 'retire'
        OR (SELECT retirements.action FROM retirements
          JOIN retirements_applied ON retirements_applied.retirement_id = retirements.id
          WHERE retirements.household_id = NEW.household_id AND retirements.person = NEW.person
          ORDER BY retirements.id DESC LIMIT 1) = 'retire'
      )
    BEGIN SELECT RAISE(ABORT, 'an address is added under a retired person only once their return is applied'); END;
  `,
  // 7 — a household's id may be a UUID (lg-71).
  `
  -- A household made since lg-71 is given a lowercase UUID as its id, which
  -- migration 1's CHECK refuses: it has digits and hyphens. A CHECK cannot be
  -- altered, so the table is rebuilt with one that takes either shape. Every
  -- word id it held stays valid and stays: nothing is migrated to a UUID.
  --
  -- The rebuild is the one lg-24 measured to apply (migration 3's comment):
  -- the rows are copied aside, the table dropped, made again and the rows
  -- copied back, with the foreign keys of memberships, person_names and
  -- retirements deferred to the commit, where every one finds its household
  -- again. Renaming the old table instead would carry those references with it.
  -- DROP TABLE fires no trigger, so households_never_deleted does not refuse
  -- it, and the rows go back before the triggers are made again, so a row a
  -- directory made before migration 3 holds with a NULL id goes back too.
  PRAGMA defer_foreign_keys = ON;

  CREATE TEMP TABLE households_aside AS
    SELECT rowid AS position, id, name, created_at, created_by FROM households;
  DROP TABLE households;

  -- A household. Its id is a file name, a directory name and the prefix of a
  -- rate-limit key (lg-21): either a plain lowercase word, never one of the four
  -- Windows keeps for a device, as every household before lg-71 has; or a
  -- lowercase UUID, 8-4-4-4-12 hex digits, as every household since is given.
  -- Neither shape holds a separator, a dot, a ':' or an '@'.
  CREATE TABLE households (
    id TEXT PRIMARY KEY CHECK (
      -- length() and GLOB stop at a NUL, so 'ho' || char(0) || 'me' reads as
      -- 'ho'; the byte count is the length of the whole value.
      length(CAST(id AS BLOB)) = length(id)
      AND (
        (
          length(id) BETWEEN 1 AND 32
          AND id NOT GLOB '*[^a-z]*'
          AND id NOT IN ('con', 'prn', 'aux', 'nul')
        )
        OR (
          length(id) = 36
          AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
          AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
          AND length(replace(id, '-', '')) = 32
          AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
        )
      )
    ),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND name = trim(name)),
    created_at TEXT NOT NULL,
    -- Who created it: an address, or 'operator' for the host command.
    created_by TEXT NOT NULL
  );

  INSERT INTO households (id, name, created_at, created_by)
    SELECT id, name, created_at, created_by FROM households_aside ORDER BY position;
  DROP TABLE temp.households_aside;

  -- Migrations 1 to 3's triggers on the table, as they were: dropped with it.
  CREATE TRIGGER households_never_updated BEFORE UPDATE ON households
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never edited'); END;
  CREATE TRIGGER households_never_deleted BEFORE DELETE ON households
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never deleted'); END;
  CREATE TRIGGER households_never_replaced BEFORE INSERT ON households
    WHEN EXISTS (SELECT 1 FROM households WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a household is appended, never replaced'); END;
  CREATE TRIGGER households_id_not_null BEFORE INSERT ON households
    WHEN NEW.id IS NULL
    BEGIN SELECT RAISE(ABORT, 'a household has an id'); END;
  `,
  // 8 — a person without an email (lg-74).
  `
  -- A person the household holds who has no email and never signs in: the
  -- partner whose salary sets a split while someone else keeps the ledger. A
  -- person added with an email is a membership and has no row here; a person
  -- added without one has a row here and no membership, until one is added
  -- under their id. Appended, never edited, as memberships are.
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id),
    -- The person's id, as memberships.person names them: since lg-76 a
    -- generated UUID, shown under the person_names record written with it.
    person TEXT NOT NULL CHECK (length(person) BETWEEN 1 AND 64 AND person = trim(person)),
    added_at TEXT NOT NULL,
    -- Who added them: an address, or 'operator' for the host command.
    added_by TEXT NOT NULL
  );

  CREATE INDEX people_household ON people (household_id, person);

  -- A person is added once: not one this table holds for the household, and not
  -- one a membership of it has named, who is held already.
  CREATE TRIGGER people_new BEFORE INSERT ON people
    WHEN EXISTS (SELECT 1 FROM people WHERE household_id = NEW.household_id AND person = NEW.person)
      OR EXISTS (SELECT 1 FROM memberships WHERE household_id = NEW.household_id AND person = NEW.person)
    BEGIN SELECT RAISE(ABORT, 'the household holds this person already'); END;

  -- migration 5's memberships_person_not_shown_as_another, for this table.
  CREATE TRIGGER people_not_shown_as_another BEFORE INSERT ON people
    WHEN EXISTS (
      SELECT 1 FROM current_person_names
      WHERE household_id = NEW.household_id AND name = NEW.person
    )
    BEGIN SELECT RAISE(ABORT, 'a shown name is unique in its household'); END;

  CREATE TRIGGER people_never_updated BEFORE UPDATE ON people
    BEGIN SELECT RAISE(ABORT, 'a person record is appended, never edited'); END;
  CREATE TRIGGER people_never_deleted BEFORE DELETE ON people
    BEGIN SELECT RAISE(ABORT, 'a person record is appended, never deleted'); END;
  CREATE TRIGGER people_never_replaced BEFORE INSERT ON people
    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM people WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a person record is appended, never replaced'); END;

  -- Migrations 5 and 6 read "a person the household holds" as "a person a
  -- membership of it has named". From here it is either that or a person this
  -- table holds, so each trigger that asks is made again asking both. The
  -- sentences they raise are the ones they raised.
  DROP TRIGGER person_names_held;
  CREATE TRIGGER person_names_held BEFORE INSERT ON person_names
    WHEN NOT EXISTS (
        SELECT 1 FROM memberships WHERE household_id = NEW.household_id AND person = NEW.person
      )
      AND NOT EXISTS (
        SELECT 1 FROM people WHERE household_id = NEW.household_id AND person = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'a shown name is for a person the household has held'); END;

  DROP TRIGGER person_names_unique;
  CREATE TRIGGER person_names_unique BEFORE INSERT ON person_names
    WHEN EXISTS (
        SELECT 1 FROM current_person_names
        WHERE household_id = NEW.household_id AND person <> NEW.person AND name = NEW.name
      )
      OR EXISTS (
        SELECT 1 FROM memberships
        WHERE household_id = NEW.household_id AND person <> NEW.person AND person = NEW.name
      )
      OR EXISTS (
        SELECT 1 FROM people
        WHERE household_id = NEW.household_id AND person <> NEW.person AND person = NEW.name
      )
    BEGIN SELECT RAISE(ABORT, 'a shown name is unique in its household'); END;

  DROP TRIGGER memberships_person_not_shown_as_another;
  CREATE TRIGGER memberships_person_not_shown_as_another BEFORE INSERT ON memberships
    WHEN NEW.action = 'add'
      AND NEW.person NOT IN (SELECT person FROM memberships WHERE household_id = NEW.household_id)
      AND NEW.person NOT IN (SELECT person FROM people WHERE household_id = NEW.household_id)
      AND EXISTS (
        SELECT 1 FROM current_person_names
        WHERE household_id = NEW.household_id AND name = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'a shown name is unique in its household'); END;

  DROP TRIGGER retirements_held;
  CREATE TRIGGER retirements_held BEFORE INSERT ON retirements
    WHEN NOT EXISTS (
        SELECT 1 FROM memberships WHERE household_id = NEW.household_id AND person = NEW.person
      )
      AND NOT EXISTS (
        SELECT 1 FROM people WHERE household_id = NEW.household_id AND person = NEW.person
      )
    BEGIN SELECT RAISE(ABORT, 'a retirement is for a person the household has held'); END;
  `,
  // 9 — a household renamed (lg-77).
  `
  -- A household's name, as its members or an admin change it. The households
  -- row stays as it was made, and households_never_updated still refuses any
  -- change to it: its name is the one the household was created with. A rename
  -- is a record here, the latest one stands, and a household with none is
  -- called by the name it was created with. Built the way person_names is.
  CREATE TABLE household_names (
    id INTEGER PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND name = trim(name)),
    named_at TEXT NOT NULL,
    -- Who renamed it: a member's or an admin's address, or 'operator'.
    named_by TEXT NOT NULL
  );

  CREATE INDEX household_names_household ON household_names (household_id, id);

  -- What each renamed household is called now: its latest record, by id, which
  -- only ever grows, as current_person_names is ordered.
  CREATE VIEW current_household_names AS
    SELECT household_id, name, named_at, named_by
    FROM household_names
    WHERE id = (
      SELECT max(id) FROM household_names later
      WHERE later.household_id = household_names.household_id
    );

  CREATE TRIGGER household_names_never_updated BEFORE UPDATE ON household_names
    BEGIN SELECT RAISE(ABORT, 'a household name record is appended, never edited'); END;
  CREATE TRIGGER household_names_never_deleted BEFORE DELETE ON household_names
    BEGIN SELECT RAISE(ABORT, 'a household name record is appended, never deleted'); END;
  CREATE TRIGGER household_names_never_replaced BEFORE INSERT ON household_names
    WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM household_names WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'a household name record is appended, never replaced'); END;
  `,
  // 10 — the first time an address signed in (lg-75).
  `
  -- One row per address, with the instant a request from it was first seen as a
  -- member's, so the admin's screen can mark an email that has never been used:
  -- a mistyped one is never refused, since Access vouches for whoever signs in
  -- and a typo cannot. Only the first is kept; this is not an activity log, and
  -- a request after the first writes nothing. The address is not a foreign key:
  -- it is kept when the membership goes, and a changed address (lg-34) starts a
  -- row of its own.
  CREATE TABLE first_sign_ins (
    address TEXT PRIMARY KEY CHECK (address = lower(trim(address)) AND address GLOB '?*@?*'),
    first_seen_at TEXT NOT NULL
  );

  CREATE TRIGGER first_sign_ins_never_updated BEFORE UPDATE ON first_sign_ins
    BEGIN SELECT RAISE(ABORT, 'a first sign-in is recorded once, never edited'); END;
  CREATE TRIGGER first_sign_ins_never_deleted BEFORE DELETE ON first_sign_ins
    BEGIN SELECT RAISE(ABORT, 'a first sign-in is recorded once, never deleted'); END;
  -- A second write for an address is skipped, not refused, so the writer's
  -- INSERT OR IGNORE and a plain insert alike leave the first row standing, and
  -- so does the REPLACE spelling, which would otherwise delete it without
  -- firing the trigger above.
  CREATE TRIGGER first_sign_ins_kept BEFORE INSERT ON first_sign_ins
    WHEN EXISTS (SELECT 1 FROM first_sign_ins WHERE address = NEW.address)
    BEGIN SELECT RAISE(IGNORE); END;
  `,
];

/** Brings a directory up to `target`, every migration by default. */
export function migrateDirectory(db: Database, target: number = DIRECTORY_MIGRATIONS.length): void {
  configure(db);
  applyMigrationList(db, DIRECTORY_MIGRATIONS, target);
}
