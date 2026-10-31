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
 * household id's shape (a word or a UUID's, lg-71), a household name's and a
 * person's length and trim, that
 * an address is lower-cased, trimmed and has an `@` with something either side,
 * and the membership rules its triggers hold. It does not check an address's
 * character set, so a writer that skips this class is not refused for a control
 * character in one (lg-52).
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { AppError, GENERATED_ID } from "@ledger/contract";
import type { PersonStanding } from "@ledger/contract";
import Database from "better-sqlite3";
import { migrateDirectory } from "./db/directory-schema.ts";

/**
 * A household id, which lg-21 makes a file name, a directory name and the
 * prefix of a rate-limit key: either a plain lowercase word, which every
 * household made before lg-71 has and keeps, or a lowercase UUID as
 * `crypto.randomUUID()` prints it, which every household made since is given.
 * Neither can hold a path separator, a dot, a `:` or an `@`.
 */
const LEGACY_HOUSEHOLD_ID = /^[a-z]{1,32}$/u;
/** The names Windows keeps for devices, which no file may take whatever its extension. */
const RESERVED_IDS = new Set(["con", "prn", "aux", "nul"]);

/** What every household made by adding its first person is called (lg-71). */
export const NEW_HOUSEHOLD_NAME = "Home";

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
  return GENERATED_ID.test(value) || (LEGACY_HOUSEHOLD_ID.test(value) && !RESERVED_IDS.has(value));
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

/**
 * A person added with no email (lg-74), as the directory recorded it: a person
 * the books count who never signs in, until an email is added under their id.
 */
export interface PersonAdded {
  action: "add-person";
  person: string;
  at: string;
  by: string;
}

/** A person the household holds, as `addPerson` leaves them: their id and their shown name. */
export interface HeldPerson {
  household: string;
  person: string;
  name: string;
}

/**
 * A person given a shown name, as the directory recorded it (lg-33): `rename`
 * by an admin, or `name`, the first name a person with a generated id is given
 * in the transaction that adds them (lg-76).
 */
export interface PersonRename {
  action: "name" | "rename";
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

/**
 * The order a person reads a list of people in (lg-76): by how each is shown,
 * then by id where two are shown alike. An id may be a generated UUID, whose
 * order means nothing to anyone reading.
 */
export function byShownName(
  names: ReadonlyMap<string, string>,
): (one: string, other: string) => number {
  return (one, other) =>
    shownName(names, one).localeCompare(shownName(names, other)) ||
    (one < other ? -1 : one > other ? 1 : 0);
}

interface Change {
  /** Who made it: an address, or `OPERATOR`. */
  by: string;
  at: Date;
}

/**
 * Where a new person's id comes from (lg-76): `randomUUID()`, unless a test
 * hands in one of its own, as it hands in `at`.
 */
interface NewId {
  newId?: (() => string) | undefined;
}

/**
 * The most a person's shown name holds, as `person_names` checks it: SQLite's
 * length() counts characters, not UTF-16 units, so a cut is by characters too.
 */
const NAME_LENGTH = 64;

/** The first `count` characters of `text`, never half of one that takes two UTF-16 units. */
function firstCharacters(text: string, count: number): string {
  return Array.from(text).slice(0, count).join("");
}

/**
 * The name a person added with no name is shown under (lg-76): the address's
 * part before the `@`, cut to what a name holds, with " 2", " 3" … the lowest
 * free, after it when `taken` says someone in the household is shown under it
 * or has it as their id.
 */
export function nameFromAddress(address: string, taken: (name: string) => boolean): string {
  const local = firstCharacters(address.slice(0, address.lastIndexOf("@")), NAME_LENGTH).trim();
  if (!taken(local)) return local;
  for (let n = 2; ; n++) {
    const suffix = ` ${String(n)}`;
    const name = `${firstCharacters(local, NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken(name)) return name;
  }
}

/**
 * Two lists each in the order it was written, merged by time without re-sorting
 * either among itself, `first`'s record ahead of `then`'s at the same instant.
 */
function mergeByTime<A extends { at: string }, B extends { at: string }>(
  first: readonly A[],
  then: readonly B[],
): (A | B)[] {
  const merged: (A | B)[] = [];
  let f = 0;
  let t = 0;
  while (f < first.length || t < then.length) {
    const one = first[f];
    const other = then[t];
    if (one !== undefined && (other === undefined || one.at <= other.at)) {
      merged.push(one);
      f++;
    } else if (other !== undefined) {
      merged.push(other);
      t++;
    }
  }
  return merged;
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
  history(household: string): (MembershipChange | PersonAdded | PersonRename)[] {
    // Each table read in its own id order, as migration 1 orders memberships
    // rather than by a timestamp two writers could tie, and the three merged by
    // time without re-sorting any among itself: a clock that stepped back
    // between two memberships leaves them in the order they were written
    // (lg-33's gate 1, F2). At the same instant a membership reads first, then
    // a person added without an email (lg-74), then a name, since a person is
    // only named once one of the other two has added them.
    const memberships = this.#db
      .prepare(
        `SELECT address, person, action, changed_at AS at, changed_by AS by
         FROM memberships WHERE household_id = ? ORDER BY id`,
      )
      .all(household) as MembershipChange[];
    const added = (
      this.#db
        .prepare(
          `SELECT person, added_at AS at, added_by AS by
           FROM people WHERE household_id = ? ORDER BY id`,
        )
        .all(household) as Omit<PersonAdded, "action">[]
    ).map((row): PersonAdded => ({ action: "add-person", ...row }));
    // lg-76: a person with a generated id is given their first shown name in
    // the transaction that adds them, so that record is a name and no rename.
    const named = new Set<string>();
    const renames = (
      this.#db
        .prepare(
          `SELECT person, name, named_at AS at, named_by AS by
           FROM person_names WHERE household_id = ? ORDER BY id`,
        )
        .all(household) as Omit<PersonRename, "action">[]
    ).map((rename): PersonRename => {
      const first = GENERATED_ID.test(rename.person) && !named.has(rename.person);
      named.add(rename.person);
      return { action: first ? "name" : "rename", ...rename };
    });
    return mergeByTime(mergeByTime(memberships, added), renames);
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

  /**
   * Who stands in the household now, once each: the people its current members
   * stand under, and the people it holds without an email who stand now
   * (`withoutEmail`, lg-74). What the books enrol, and who a receipt's "the
   * other's" can mean.
   */
  people(household: string): string[] {
    return [
      ...new Set([
        ...this.members(household).map((member) => member.person),
        ...this.withoutEmail(household),
      ]),
    ].toSorted();
  }

  /**
   * The people added without an email (lg-74) who stand now: no address stands
   * under them, and they are in the books, with no retirement waiting or
   * applied. A person with an email leaves `people` when the last address under
   * them is removed, which comes before anyone can retire them; one without
   * leaves it when their retirement is asked for, the step that stands in for
   * that removal. One given an email since is a member and is listed as one; if
   * every address under them is removed again, they are held without one again.
   */
  withoutEmail(household: string): string[] {
    const members = new Set(this.members(household).map((member) => member.person));
    const standings = this.standings(household);
    return (
      this.#db
        .prepare("SELECT person FROM people WHERE household_id = ? ORDER BY person")
        .all(household) as { person: string }[]
    )
      .map((row) => row.person)
      .filter((person) => !members.has(person) && standings.get(person) === "in");
  }

  /**
   * Every person id the household has ever held, a member who has left
   * included (lg-33): one a membership has named, or one added without an
   * email (lg-74). Who can be given a shown name, retired, or given an email
   * under the id they have. `people` is only who stands now.
   */
  heldPeople(household: string): string[] {
    return (
      this.#db
        .prepare(
          `SELECT person FROM memberships WHERE household_id = ?
           UNION SELECT person FROM people WHERE household_id = ?
           ORDER BY person`,
        )
        .all(household, household) as { person: string }[]
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
   * `PERSON_NOT_FOUND` for a person the household has never held —
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
   * Refused as `PERSON_NOT_FOUND` for a person the household has never held,
   * and as a bad request for a retirement while an address stands under the
   * person, or a request that would not change where they stand. A person
   * added without an email (lg-74) has no address to remove, so nothing is
   * asked of them first. Returns where they stand after it.
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
            refuse(`Remove every email under ${shown} first: nobody who can sign in is retired.`);
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
        `A household id is a lowercase UUID, or one lowercase word of a to z, at most 32 letters, and not con, prn, aux or nul; ${shown} is not.`,
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
    return this.#db.transaction(() => this.#insertHousehold({ id, name }, household)).immediate();
  }

  /**
   * Creates a household by adding its first person (lg-71): the household, named
   * `NEW_HOUSEHOLD_NAME`, and its first membership in one transaction, so an
   * address the directory refuses — in a household already, not an email, an
   * unseen character — leaves no household behind, and none is ever made empty.
   * The caller gives the id, which must be a UUID's shape: the route and the
   * host command a `randomUUID()`, a test a fixed one. `addHousehold` stays, for
   * the tests that make households under readable words.
   *
   * The first person is a new one, as `addMemberByName` makes one (lg-76): a
   * generated id, shown under `person`, or under the address's part before the
   * `@` when no person is given.
   */
  createHousehold(
    household: { id: string; address: string; person?: string | undefined } & Change & NewId,
  ): {
    household: Household;
    member: Member;
  } {
    if (typeof household.id !== "string" || !GENERATED_ID.test(household.id)) {
      refuse("A new household's id is a lowercase UUID.");
    }
    refuseUnlessChange(household);
    const draft = this.#readNamedMember(household);
    return this.#db
      .transaction(() => {
        const made = this.#insertHousehold(
          { id: household.id, name: NEW_HOUSEHOLD_NAME },
          household,
        );
        const member = this.#admitByName({ household: made.id, ...draft }, household);
        return { household: made, member };
      })
      .immediate();
  }

  #insertHousehold(household: Household, change: Change): Household {
    if (this.household(household.id) !== undefined) {
      refuse(`There is already a household "${household.id}".`);
    }
    this.#db
      .prepare("INSERT INTO households (id, name, created_at, created_by) VALUES (?, ?, ?, ?)")
      .run(household.id, household.name, change.at.toISOString(), change.by);
    return { id: household.id, name: household.name };
  }

  /**
   * Adds an address to a household under a person's id, as given: a new one
   * becomes a person whose id is that text, the shape every person made before
   * lg-76 has. Refused as
   * `ADDRESS_ALREADY_A_MEMBER` when the address is in a household already —
   * this one included — a sentence for an admin or the operator; a member is
   * not told it (`routes/households.ts`). A household holds any number of
   * people (lg-23), so a new name is never refused for being one more.
   *
   * Nothing a person reaches calls it since lg-76: the routes and the host
   * command call `addMemberByName`. It stays, as `addHousehold` stays for lg-71,
   * for the tests that make people under readable ids.
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
    const draft = this.#readMember(member);
    return this.#db
      .transaction(() => {
        if (this.household(member.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${member.household}".`);
        }
        return this.#admit({ household: member.household, ...draft }, member);
      })
      .immediate();
  }

  /**
   * Adds an address to a household as the person a name names (lg-76): the
   * person the household shows under `person`, or failing that the one whose id
   * it is, which is how a person added before lg-76 is named by the id they
   * were added under. The two cannot disagree: no shown name is another
   * person's id, and no new id is another person's shown name (lg-33's
   * `person_names_unique` and `memberships_person_not_shown_as_another`).
   *
   * A name that names nobody is a new person: an id from `newId`, a
   * `randomUUID()` by default, and `person` as their first shown name, written
   * in the same transaction as the membership, so no person with a generated
   * id is ever without a name. With no `person`, the new person is shown under
   * the address's part before the `@` (`nameFromAddress`).
   */
  addMemberByName(
    member: { household: string; address: string; person?: string | undefined } & Change & NewId,
  ): Member {
    refuseUnlessChange(member);
    const household: unknown = member.household;
    if (household !== undefined && household !== null && typeof household !== "string") {
      refuse("The household is not a string.");
    }
    const draft = this.#readNamedMember(member);
    return this.#db
      .transaction(() => {
        if (this.household(member.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${member.household}".`);
        }
        return this.#admitByName({ household: member.household, ...draft }, member);
      })
      .immediate();
  }

  /**
   * Adds a person who has no email and never signs in (lg-74): a person the
   * books count, under a new generated id from `newId` and shown under
   * `person`, as `addMemberByName` makes a new person (lg-76). The person and
   * their first shown name are written in one transaction. Refused as
   * `PERSON_NAME_TAKEN` when `person` names someone the household holds
   * already — the person shown under it, or the one whose id it is — since that
   * is not a new person. Giving this person an email later is
   * `addMemberByName` under the name they are shown by, or `addMember` under
   * their id.
   */
  addPerson(person: { household: string; person: string } & Change & NewId): HeldPerson {
    refuseUnlessChange(person);
    if (typeof person.household !== "string") refuse("The household is not a string.");
    if (typeof person.person !== "string") refuse("The person's name is not a string.");
    const name = person.person.trim();
    if (name === "" || name.length > NAME_LENGTH) refuse("A person's name is 1 to 64 characters.");
    return this.#db
      .transaction(() => {
        if (this.household(person.household) === undefined) {
          throw new AppError("HOUSEHOLD_NOT_FOUND", `There is no household "${person.household}".`);
        }
        const held = this.heldPeople(person.household);
        const names = this.names(person.household);
        if (held.some((one) => one === name || shownName(names, one) === name)) {
          throw new AppError(
            "PERSON_NAME_TAKEN",
            `Someone in this household is already shown as "${name}", or has it as their id. To give them an email, add it as them; a new person needs a name of their own.`,
          );
        }
        const id = (person.newId ?? randomUUID)();
        if (!GENERATED_ID.test(id) || held.includes(id)) {
          throw new AppError("INTERNAL", "A new person's id is not a fresh lowercase UUID.");
        }
        const at = person.at.toISOString();
        this.#db
          .prepare(
            "INSERT INTO people (household_id, person, added_at, added_by) VALUES (?, ?, ?, ?)",
          )
          .run(person.household, id, at, person.by);
        this.#db
          .prepare(
            `INSERT INTO person_names (household_id, person, name, named_at, named_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(person.household, id, name, at, person.by);
        return { household: person.household, person: id, name };
      })
      .immediate();
  }

  /** `#readMember`, with the person's name left out allowed (lg-76). */
  #readNamedMember(member: { address: unknown; person?: unknown }): {
    address: string;
    name: string | undefined;
  } {
    if (member.person === undefined) {
      if (typeof member.address !== "string") refuse("The address is not a string.");
      const address = readAddress(member.address);
      if (address === undefined) refuse(NOT_AN_ADDRESS);
      return { address, name: undefined };
    }
    const { address, person } = this.#readMember({
      address: member.address,
      person: member.person,
    });
    return { address, name: person };
  }

  /**
   * The person `name` names in the household, or a new one, inside the caller's
   * transaction; then `#admit`. A new person's first shown name is written after
   * their membership, since `person_names_held` refuses a name for a person no
   * membership has named.
   */
  #admitByName(
    member: { household: string; address: string; name: string | undefined },
    change: Change & NewId,
  ): Member {
    const { household, address } = member;
    const held = this.heldPeople(household);
    const names = this.names(household);
    if (member.name !== undefined) {
      const typed = member.name;
      const found =
        held.find((person) => shownName(names, person) === typed) ??
        held.find((person) => person === typed);
      if (found !== undefined) return this.#admit({ household, address, person: found }, change);
    }
    const shownAs = new Set(held.map((person) => shownName(names, person)));
    const name =
      member.name ??
      nameFromAddress(address, (candidate) => shownAs.has(candidate) || held.includes(candidate));
    const person = (change.newId ?? randomUUID)();
    if (!GENERATED_ID.test(person) || held.includes(person)) {
      throw new AppError("INTERNAL", "A new person's id is not a fresh lowercase UUID.");
    }
    const added = this.#admit({ household, address, person }, change);
    this.#db
      .prepare(
        `INSERT INTO person_names (household_id, person, name, named_at, named_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(household, person, name, change.at.toISOString(), change.by);
    return added;
  }

  /** An added member's address and person, read and refused before any statement runs. */
  #readMember(member: { address: unknown; person: unknown }): { address: string; person: string } {
    if (typeof member.address !== "string") refuse("The address is not a string.");
    if (typeof member.person !== "string") refuse("The person's name is not a string.");
    const address = readAddress(member.address);
    if (address === undefined) refuse(NOT_AN_ADDRESS);
    const person = member.person.trim();
    if (person === "" || person.length > 64) refuse("A person's name is 1 to 64 characters.");
    return { address, person };
  }

  /**
   * Records an add into a household that stands, inside the caller's
   * transaction: what `addMember` does, and what lg-71's `createHousehold` does
   * once it has inserted the household.
   */
  #admit(member: Member, change: Change): Member {
    const { address, household, person } = member;
    const standing = this.membershipOf(address);
    if (standing !== undefined) this.#refuseTaken(standing);
    // A household holds any number of names (lg-23): nothing is counted. A
    // new one is not a name another person is shown under (lg-33).
    if (!this.heldPeople(household).includes(person)) {
      const shownAs = [...this.names(household).values()];
      if (shownAs.includes(person)) {
        throw new AppError(
          "PERSON_NAME_TAKEN",
          `Another person in this household is shown as "${person}". Pick them from the list to add an email for them.`,
        );
      }
    }
    // lg-35's gate 1, F1: nobody signs in under a person whose retirement
    // waits or holds, until a close has applied their return.
    const retirement = this.standings(household).get(person) ?? "in";
    if (retirement !== "in") {
      const shown = shownName(this.names(household), person);
      refuse(
        retirement === "retiring"
          ? `${shown} is retiring at the next close. Keep them in first, then add the email.`
          : `${shown} is retired from the books. Bring them back, and add the email once the next close has applied the return.`,
      );
    }
    this.#record(member, "add", change);
    return { address, household, person };
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
          throw new AppError("MEMBER_NOT_FOUND", "That email belongs to no household.");
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
    if (from === to) refuse("The new email is the one the person has already.");
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
        if (taken !== undefined) this.#refuseTaken(taken);
        this.#record({ address: from, ...standing }, "remove", change);
        const moved = { address: to, ...standing };
        this.#record(moved, "add", change);
        return moved;
      })
      .immediate();
  }

  /**
   * `ADDRESS_ALREADY_A_MEMBER`, naming the person as they are shown, since an id
   * may be a UUID (lg-76). The household is still named by its id; lg-77 names
   * it by its name.
   */
  #refuseTaken(standing: Membership): never {
    const shown = shownName(this.names(standing.household), standing.person);
    throw new AppError(
      "ADDRESS_ALREADY_A_MEMBER",
      `That email already belongs to the household "${standing.household}", as ${shown}. Remove it first.`,
    );
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
