/**
 * The household directory (lg-20): which household an address belongs to, and
 * under which person's name.
 *
 * It replaces `ACCESS_PEOPLE`. Membership lives in a database the app reads on
 * every request, so a change applies without a restart and can later be made
 * from the app (lg-22); which addresses are admins stays configuration
 * (`LEDGER_ADMINS`, in `config.ts`). It is written by the host command
 * (`household-command.ts`) and, from lg-22, by the app's admin and household
 * routes (`routes/households.ts`), each change signed by whoever made it.
 *
 * Every write is checked here first, so a refusal carries a sentence an
 * operator can act on. The schema checks less (`db/directory-schema.ts`): a
 * household id's shape, a household name's and a person's length and trim, that
 * an address is lower-cased, trimmed and has an `@` with something either side,
 * and the membership rules its triggers hold. It does not check an address's
 * character set, so a writer that skips this class is not refused for a control
 * character in one (lg-52).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { AppError } from "@ledger/contract";
import type { PersonStanding } from "@ledger/contract";
import Database from "better-sqlite3";
import { migrateDirectory } from "./db/directory-schema.ts";

/** A household id: a plain lowercase word, because lg-21 makes it a file name. */
const HOUSEHOLD_ID = /^[a-z]{1,32}$/u;
/** The names Windows keeps for devices, which no file may take whatever its extension. */
const RESERVED_IDS = new Set(["con", "prn", "aux", "nul"]);

/** One `@`, something either side, and nothing a list or a shell would split on. */
const ADDRESS_SHAPE = /^[^\s@,;]+@[^\s@,;]+$/u;
/**
 * What `\s` does not cover and no one can see: the C0 controls and DEL (lg-52),
 * the C1 controls and the zero-width characters (lg-57). An address carrying one
 * is stored and then no Access token can name it. The BOM is White_Space to `\s`
 * and was refused before; it is listed so the set reads whole.
 */
// oxlint-disable-next-line no-control-regex -- the controls are the point
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/u;
/** The sentence for an address that is not one, whichever method was given it. */
const NOT_AN_ADDRESS = "That is not an email address.";

/** How the host command signs the changes it makes; never an address. */
export const OPERATOR = "operator";

/** A lower-cased address, or `undefined` when the text is not one. */
export function readAddress(raw: string): string | undefined {
  const address = readStoredAddress(raw);
  return address !== undefined && !UNSEEN.test(address) ? address : undefined;
}

/**
 * `readAddress` without the refusal of unseen characters, for naming a row that
 * already stands: a directory made before lg-52 or lg-57 may hold an address
 * with a NUL, a C1 control or a zero-width character, and removal must still be
 * able to take it out. It refuses what removal refused before.
 */
function readStoredAddress(raw: string): string | undefined {
  const address = raw.trim().toLowerCase();
  return ADDRESS_SHAPE.test(address) ? address : undefined;
}

export function isHouseholdId(value: string): boolean {
  return HOUSEHOLD_ID.test(value) && !RESERVED_IDS.has(value);
}

export interface Household {
  id: string;
  name: string;
}

/** An address's membership as it stands. */
export interface Member {
  address: string;
  household: string;
  person: string;
}

/** The household and the name an address stands under, or nothing. */
export type Membership = Pick<Member, "household" | "person">;

/** One change to a household's membership, as the directory recorded it (lg-22). */
export interface MembershipChange {
  address: string;
  person: string;
  action: "add" | "remove";
  at: string;
  by: string;
}

/** A person given a shown name, as the directory recorded it (lg-33). */
export interface PersonRename {
  action: "rename";
  person: string;
  name: string;
  at: string;
  by: string;
}

/** A person's id and the name they are shown under. */
export interface ShownName {
  person: string;
  name: string;
}

/** An admin's request to retire a person from the books, or bring them back (lg-35). */
export interface RetirementRequest {
  id: number;
  person: string;
  action: "retire" | "return";
  /** ISO instant it was recorded. */
  at: string;
}

/** Where a person stands in the books, as the directory can tell it (lg-35). */
type Standing = PersonStanding;

/** How a person is shown: the name `Directory.names` gives them, or their id (lg-33). */
export function shownName(names: ReadonlyMap<string, string>, person: string): string {
  return names.get(person) ?? person;
}

interface Change {
  /** Who made it: an address, or `OPERATOR`. */
  by: string;
  at: Date;
}

function refuse(message: string): never {
  throw new AppError("BAD_REQUEST", message);
}

/**
 * A change's time and author, refused before any statement runs (lg-25). `at` must
 * be a valid Date: `new Date("x")` is an instance of Date and still throws a
 * RangeError in `toISOString`. `by` must be a string: a number was stored as text
 * (`7` became `"7.0"`), and `null` was refused only by the NOT NULL constraint.
 */
function refuseUnlessChange(change: { by: unknown; at: unknown }): void {
  if (!(change.at instanceof Date) || Number.isNaN(change.at.getTime())) {
    refuse("The change's time is not a date.");
  }
  if (typeof change.by !== "string") refuse("The change's author is not a string.");
}

export class Directory {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  /**
   * Opens the directory at `file`, creating it and its directory when there is
   * none, and migrates it. `:memory:` is a directory that lives as long as the
   * process, which is what the tests use.
   */
  static open(file: string): Directory {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    try {
      migrateDirectory(db);
    } catch (error: unknown) {
      db.close();
      throw error;
    }
    return new Directory(db);
  }

  /**
   * Opens an existing directory to read, and never writes it: no migration, and
   * no file created. For the commands that only resolve a name (the import).
   * `:memory:` is an empty directory.
   */
  static openReadOnly(file: string): Directory {
    if (file === ":memory:") return Directory.open(file);
    return new Directory(new Database(file, { readonly: true, fileMustExist: true }));
  }

  get open(): boolean {
    return this.#db.open;
  }

  close(): void {
    this.#db.close();
  }

  /** The address's household and name now, read from the file on every call. */
  membershipOf(address: string): Membership | undefined {
    // Typed as a string, but a caller past the schema can pass anything; refused
    // before `toLowerCase` throws a TypeError (lg-25).
    if (typeof address !== "string") refuse("The address is not a string.");
    const row = this.#db
      .prepare("SELECT household_id AS household, person FROM current_members WHERE address = ?")
      .get(address.toLowerCase()) as Membership | undefined;
    return row;
  }

  /**
   * Every change to one household's membership, oldest first: who was added or
   * removed, under which name, by whom and when. Filtered in the SQL, so no
   * other household's record is ever read for it.
   */
  history(household: string): (MembershipChange | PersonRename)[] {
    // Each table read in its own id order, as migration 1 orders memberships
    // rather than by a timestamp two writers could tie, and the two merged by
    // time without re-sorting either among itself: a clock that stepped back
    // between two memberships leaves them in the order they were written
    // (lg-33's gate 1, F2). At the same instant a membership reads first,
    // since a person is only renamed once a membership has named them.
    const memberships = this.#db
      .prepare(
        `SELECT address, person, action, changed_at AS at, changed_by AS by
         FROM memberships WHERE household_id = ? ORDER BY id`,
      )
      .all(household) as MembershipChange[];
    const renames = (
      this.#db
        .prepare(
          `SELECT person, name, named_at AS at, named_by AS by
           FROM person_names WHERE household_id = ? ORDER BY id`,
        )
        .all(household) as Omit<PersonRename, "action">[]
    ).map((rename): PersonRename => ({ action: "rename", ...rename }));
    const merged: (MembershipChange | PersonRename)[] = [];
    let m = 0;
    let r = 0;
    while (m < memberships.length || r < renames.length) {
      const membership = memberships[m];
      const rename = renames[r];
      if (membership !== undefined && (rename === undefined || membership.at <= rename.at)) {
        merged.push(membership);
        m++;
      } else if (rename !== undefined) {
        merged.push(rename);
        r++;
      }
    }
    return merged;
  }

  households(): Household[] {
    return this.#db.prepare("SELECT id, name FROM households ORDER BY id").all() as Household[];
  }

  household(id: string): Household | undefined {
    return this.#db.prepare("SELECT id, name FROM households WHERE id = ?").get(id) as
      | Household
      | undefined;
  }

  /**
   * Every membership that stands, or one household's, by household then address.
   * One household's is filtered in the SQL, not after reading everyone's: the
   * identity hook asks for it on every request (lg-20's gate, F6; folded into
   * lg-21, whose books path is that hook).
   */
  members(household?: string): Member[] {
    const select = `SELECT address, household_id AS household, person FROM current_members`;
    const order = `ORDER BY household_id, person, address`;
    return (
      household === undefined
        ? this.#db.prepare(`${select} ${order}`).all()
        : this.#db.prepare(`${select} WHERE household_id = ? ${order}`).all(household)
    ) as Member[];
  }

  /** The names a household's current members stand under, once each. */
  people(household?: string): string[] {
    return [...new Set(this.members(household).map((member) => member.person))].toSorted();
  }

  /**
   * Every person id a membership of the household has ever named, a member who
   * has left included (lg-33): who can be given a shown name. `people` is only
   * who stands now.
   */
  heldPeople(household: string): string[] {
    return (
      this.#db
        .prepare("SELECT DISTINCT person FROM memberships WHERE household_id = ? ORDER BY person")
        .all(household) as { person: string }[]
    ).map((row) => row.person);
  }

  /**
   * How each person the household has named is shown now, by id (lg-33). Only
   * a renamed person is a key: anyone else is shown under their id, which
   * `shownName` gives.
   */
  names(household: string): Map<string, string> {
    const rows = this.#db
      .prepare("SELECT person, name FROM current_person_names WHERE household_id = ?")
      .all(household) as ShownName[];
    return new Map(rows.map((row) => [row.person, row.name]));
  }

  /**
   * Gives a person a shown name, keeping their id (lg-33). Refused as
   * `PERSON_NOT_FOUND` for a person no membership of the household has named —
   * an id the books know only from an old rule included — and as
   * `PERSON_NAME_TAKEN` for a name another person is shown under or has as
   * their id. Renaming a person back to their own id is a rename like any other.
   */
  renamePerson(rename: { household: string; person: string; name: string } & Change): ShownName {
    refuseUnlessChange(rename);
    if (typeof rename.household !== "string") refuse("The household is not a string.");
    if (typeof rename.person !== "string") refuse("The person is not a string.");
    if (typeof rename.name !== "string") refuse("The name is not a string.");
    const person = rename.person.trim();
    const name = rename.name.trim();
    if (name === "" || name.length > 64) refuse("A person's name is 1 to 64 characters.");
    return this.#db
      .transaction(() => {
        if (this.household(rename.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${rename.household}".`);
        }
        const held = this.heldPeople(rename.household);
        if (!held.includes(person)) {
          throw new AppError(
            "PERSON_NOT_FOUND",
            `No member of this household has been added as "${person}". A person the books know only from an old rule or classification cannot be renamed.`,
          );
        }
        if (this.#nameTaken(rename.household, person, name, held)) {
          throw new AppError(
            "PERSON_NAME_TAKEN",
            `Another person in this household is shown as "${name}", or has it as their id.`,
          );
        }
        this.#db
          .prepare(
            `INSERT INTO person_names (household_id, person, name, named_at, named_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(rename.household, person, name, rename.at.toISOString(), rename.by);
        return { person, name };
      })
      .immediate();
  }

  /** Whether anyone but `person` is shown as `name` now or has it as their id. */
  #nameTaken(household: string, person: string, name: string, held: readonly string[]): boolean {
    if (held.some((other) => other !== person && other === name)) return true;
    for (const [other, shown] of this.names(household)) {
      if (other !== person && shown === name) return true;
    }
    return false;
  }

  /**
   * Every retirement and return recorded for the household, oldest first
   * (lg-35): what a close reads to apply the ones its books do not hold yet.
   */
  retirements(household: string): RetirementRequest[] {
    return this.#db
      .prepare(
        `SELECT id, person, action, recorded_at AS at FROM retirements
         WHERE household_id = ? ORDER BY id`,
      )
      .all(household) as RetirementRequest[];
  }

  /**
   * Where each person the household has named stands (lg-35), by id: in or
   * retired as the latest request a close has applied leaves them, and retiring
   * or returning when a later request no close has applied yet would change
   * that. A retirement and a return both waiting cancel out, as the close will
   * make of them. A person with no request is in.
   */
  standings(household: string): Map<string, Standing> {
    const rows = this.#db
      .prepare(
        `SELECT retirements.person, retirements.action,
                retirements_applied.retirement_id IS NOT NULL AS applied
         FROM retirements
         LEFT JOIN retirements_applied ON retirements_applied.retirement_id = retirements.id
         WHERE retirements.household_id = ?
         ORDER BY retirements.id`,
      )
      .all(household) as { person: string; action: "retire" | "return"; applied: number }[];
    const books = new Map<string, boolean>();
    const asked = new Map<string, boolean>();
    for (const row of rows) {
      const retired = row.action === "retire";
      asked.set(row.person, retired);
      if (row.applied === 1) books.set(row.person, retired);
    }
    return new Map(
      this.heldPeople(household).map((person): [string, Standing] => {
        const now = books.get(person) ?? false;
        const next = asked.get(person) ?? false;
        if (now === next) return [person, now ? "retired" : "in"];
        return [person, next ? "retiring" : "returning"];
      }),
    );
  }

  /**
   * Records an admin's request to retire a person from the books at the next
   * close, or to bring a retired one back at the next close after it (lg-35).
   * Refused as `PERSON_NOT_FOUND` for a person no membership of the household
   * has named, and as a bad request for a retirement while an address stands
   * under the person, or a request that would not change where they stand.
   * Returns where they stand after it.
   */
  retirePerson(
    request: { household: string; person: string; action: "retire" | "return" } & Change,
  ): { person: string; standing: Standing } {
    refuseUnlessChange(request);
    if (typeof request.household !== "string") refuse("The household is not a string.");
    if (typeof request.person !== "string") refuse("The person is not a string.");
    if (request.action !== "retire" && request.action !== "return") {
      refuse("A person is retired or returned.");
    }
    const person = request.person.trim();
    return this.#db
      .transaction(() => {
        if (this.household(request.household) === undefined) {
          throw new AppError(
            "HOUSEHOLD_NOT_FOUND",
            `There is no household "${request.household}".`,
          );
        }
        const standing = this.standings(request.household).get(person);
        if (standing === undefined) {
          throw new AppError(
            "PERSON_NOT_FOUND",
            `No member of this household has been added as "${person}".`,
          );
        }
        const shown = shownName(this.names(request.household), person);
        if (request.action === "retire") {
          if (standing === "retired" || standing === "retiring") {
            refuse(`${shown} is already retired, or retiring at the next close.`);
          }
          if (this.members(request.household).some((member) => member.person === person)) {
            refuse(`Remove every address under ${shown} first: nobody who can sign in is retired.`);
          }
        } else if (standing === "in" || standing === "returning") {
          refuse(`${shown} is not retired, so there is nothing to bring them back from.`);
        }
        this.#db
          .prepare(
            `INSERT INTO retirements (household_id, person, action, recorded_at, recorded_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(request.household, person, request.action, request.at.toISOString(), request.by);
        return { person, standing: this.standings(request.household).get(person) ?? "in" };
      })
      .immediate();
  }

  /**
   * Records that a close applied these requests to the household's books, and
   * from which day (lg-35); any already recorded are left as they are, so a
   * close can write the whole list its books hold and mend an echo an earlier
   * close failed to write.
   */
  markApplied(applied: readonly { id: number; fromDate: string }[], at: Date): number {
    refuseUnlessChange({ at, by: OPERATOR });
    const insert = this.#db.prepare(
      `INSERT INTO retirements_applied (retirement_id, from_date, applied_at)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM retirements_applied WHERE retirement_id = ?)
         AND EXISTS (SELECT 1 FROM retirements WHERE id = ?)`,
    );
    return this.#db
      .transaction(() =>
        applied.reduce(
          (count, { id, fromDate }) =>
            count + insert.run(id, fromDate, at.toISOString(), id, id).changes,
          0,
        ),
      )
      .immediate();
  }

  addHousehold(household: Household & Change): Household {
    const notAnId = (shown: string): never =>
      refuse(
        `A household id is one lowercase word of a to z, at most 32 letters, and not con, prn, aux or nul; ${shown} is not.`,
      );
    const notAName = (): never => refuse("A household's name is 1 to 80 characters.");
    // Typed strings, but a caller past the request schema can pass null, which
    // reached `.trim()` as a TypeError rather than these refusals (lg-24).
    // The type, not the value: String() throws on Object.create(null) and on an
    // object whose toString throws, and prints nothing useful for an array.
    if (typeof household.id !== "string") notAnId(typeof (household.id as unknown));
    if (typeof household.name !== "string") notAName();
    // lg-25: checked before the transaction opens, as the id and name are above.
    refuseUnlessChange(household);
    const id = household.id.trim();
    const name = household.name.trim();
    if (!isHouseholdId(id)) notAnId(`"${id}"`);
    if (name === "" || name.length > 80) notAName();
    return this.#db
      .transaction(() => {
        if (this.household(id) !== undefined) refuse(`There is already a household "${id}".`);
        this.#db
          .prepare("INSERT INTO households (id, name, created_at, created_by) VALUES (?, ?, ?, ?)")
          .run(id, name, household.at.toISOString(), household.by);
        return { id, name };
      })
      .immediate();
  }

  /**
   * Adds an address to a household under a person's name. Refused as
   * `ADDRESS_ALREADY_A_MEMBER` when the address is in a household already —
   * this one included — a sentence for an admin or the operator; a member is
   * not told it (`routes/households.ts`). A household holds any number of
   * people (lg-23), so a new name is never refused for being one more.
   */
  addMember(member: { household: string; address: string; person: string } & Change): Member {
    // lg-25: a caller past the request schema can pass anything, and each of these
    // reached a string method or a statement as an untyped error. A missing
    // household names none, which the lookup below answers as HOUSEHOLD_NOT_FOUND;
    // any other non-string is refused before any statement runs (`{}` reached the
    // driver and threw a RangeError).
    refuseUnlessChange(member);
    const household: unknown = member.household;
    if (household !== undefined && household !== null && typeof household !== "string") {
      refuse("The household is not a string.");
    }
    if (typeof member.address !== "string") refuse("The address is not a string.");
    if (typeof member.person !== "string") refuse("The person's name is not a string.");
    const address = readAddress(member.address);
    if (address === undefined) refuse(NOT_AN_ADDRESS);
    const person = member.person.trim();
    if (person === "" || person.length > 64) refuse("A person's name is 1 to 64 characters.");
    return this.#db
      .transaction(() => {
        if (this.household(member.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${member.household}".`);
        }
        const standing = this.membershipOf(address);
        if (standing !== undefined) {
          throw new AppError(
            "ADDRESS_ALREADY_A_MEMBER",
            `That address already belongs to the household "${standing.household}", as ${standing.person}. Remove it first.`,
          );
        }
        // A household holds any number of names (lg-23): nothing is counted. A
        // new one is not a name another person is shown under (lg-33).
        if (!this.heldPeople(member.household).includes(person)) {
          const shownAs = [...this.names(member.household).values()];
          if (shownAs.includes(person)) {
            throw new AppError(
              "PERSON_NAME_TAKEN",
              `Another person in this household is shown as "${person}". Pick them from the list to add an address for them.`,
            );
          }
        }
        this.#record({ address, household: member.household, person }, "add", member);
        return { address, household: member.household, person };
      })
      .immediate();
  }

  /**
   * Takes an address out of its household — out of `household`, when one is
   * named, and refused if it is not there, so a screen that has gone stale
   * cannot remove an address from a household it has since moved to. Returns
   * the membership it ended. The address is read without the control-character
   * refusal, so a row that already holds one can still be removed (lg-52).
   */
  removeMember(member: { address: string; household?: string } & Change): Member {
    refuseUnlessChange(member);
    if (typeof member.address !== "string") refuse("The address is not a string.");
    const address = readStoredAddress(member.address);
    if (address === undefined) refuse(NOT_AN_ADDRESS);
    return this.#db
      .transaction(() => {
        const standing = this.membershipOf(address);
        if (standing === undefined) {
          throw new AppError("MEMBER_NOT_FOUND", "That address belongs to no household.");
        }
        if (member.household !== undefined && standing.household !== member.household) {
          throw new AppError("MEMBER_NOT_FOUND");
        }
        const removed = { address, ...standing };
        this.#record(removed, "remove", member);
        return removed;
      })
      .immediate();
  }

  /**
   * Moves a person's sign-in from one address to another (lg-34): one
   * transaction that removes `from` and adds `to` under the same person, so
   * the person is never without an address between the two, and a refused add
   * rolls the remove back with it. The person id is unchanged, so nothing in the
   * household's books is touched. `from` must stand in `household`
   * (`MEMBER_NOT_FOUND` otherwise, a stale screen included); `to` must be in no
   * household at all, this one included (`ADDRESS_ALREADY_A_MEMBER`). Returns
   * the membership that now stands.
   */
  changeAddress(change: { household: string; from: string; to: string } & Change): Member {
    refuseUnlessChange(change);
    if (typeof change.household !== "string") refuse("The household is not a string.");
    if (typeof change.from !== "string") refuse("The address is not a string.");
    if (typeof change.to !== "string") refuse("The new address is not a string.");
    // `from` names a row that already stands, so it is read as removal reads it: a
    // directory made before lg-52 or lg-57 may hold an unseen character, and the
    // person must still be movable off it. `to` is new, so it gets the full check.
    const from = readStoredAddress(change.from);
    if (from === undefined) refuse(NOT_AN_ADDRESS);
    const to = readAddress(change.to);
    if (to === undefined) refuse(NOT_AN_ADDRESS);
    if (from === to) refuse("The new address is the one the person has already.");
    return this.#db
      .transaction(() => {
        if (this.household(change.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${change.household}".`);
        }
        const standing = this.membershipOf(from);
        if (standing === undefined || standing.household !== change.household) {
          throw new AppError("MEMBER_NOT_FOUND");
        }
        const taken = this.membershipOf(to);
        if (taken !== undefined) {
          throw new AppError(
            "ADDRESS_ALREADY_A_MEMBER",
            `That address already belongs to the household "${taken.household}", as ${taken.person}. Remove it first.`,
          );
        }
        this.#record({ address: from, ...standing }, "remove", change);
        const moved = { address: to, ...standing };
        this.#record(moved, "add", change);
        return moved;
      })
      .immediate();
  }

  #record(member: Member, action: "add" | "remove", change: Change): void {
    this.#db
      .prepare(
        `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        member.address,
        member.household,
        member.person,
        action,
        change.at.toISOString(),
        change.by,
      );
  }
}
