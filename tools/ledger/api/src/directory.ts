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
 * operator can act on, and again by the schema's triggers
 * (`db/directory-schema.ts`), so a writer that skips this class is refused all
 * the same.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import { migrateDirectory } from "./db/directory-schema.ts";

/** A household id: a plain lowercase word, because lg-21 makes it a file name. */
const HOUSEHOLD_ID = /^[a-z]{1,32}$/u;
/** The names Windows keeps for devices, which no file may take whatever its extension. */
const RESERVED_IDS = new Set(["con", "prn", "aux", "nul"]);

/** One `@`, something either side, and nothing a list or a shell would split on. */
const ADDRESS = /^[^\s@,;]+@[^\s@,;]+$/u;
/** The sentence for an address that is not one, whichever method was given it. */
const NOT_AN_ADDRESS = "That is not an email address.";

/** How the host command signs the changes it makes; never an address. */
export const OPERATOR = "operator";

/** A lower-cased address, or `undefined` when the text is not one. */
export function readAddress(raw: string): string | undefined {
  const address = raw.trim().toLowerCase();
  return ADDRESS.test(address) ? address : undefined;
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

interface Change {
  /** Who made it: an address, or `OPERATOR`. */
  by: string;
  at: Date;
}

function refuse(message: string): never {
  throw new AppError("BAD_REQUEST", message);
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
  history(household: string): MembershipChange[] {
    return this.#db
      .prepare(
        `SELECT address, person, action, changed_at AS at, changed_by AS by
         FROM memberships WHERE household_id = ? ORDER BY id`,
      )
      .all(household) as MembershipChange[];
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
    // lg-25: the time and the author are checked the same way, before the
    // transaction opens. A non-string `by` was stored as a number, or refused by
    // the NOT NULL constraint, and a `null` `at` was a TypeError.
    if (!(household.at instanceof Date)) refuse("The change's time is not a date.");
    if (typeof household.by !== "string") refuse("The change's author is not a string.");
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
   * this one included — and as `HOUSEHOLD_FULL` when the name would be the
   * household's third. Both sentences are for an admin or the operator; a
   * member is told neither (`routes/households.ts`).
   */
  addMember(member: { household: string; address: string; person: string } & Change): Member {
    // lg-25: a caller past the request schema can pass anything, and each of these
    // reached a string method or a statement as an untyped error. A missing
    // household names none, which the lookup below answers as HOUSEHOLD_NOT_FOUND;
    // any other non-string is refused before SQLite binds it, as `{}` was.
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
        // Every name the household has ever held, current or not (the schema's
        // `memberships_two_people` says why).
        const named = (
          this.#db
            .prepare("SELECT DISTINCT person FROM memberships WHERE household_id = ?")
            .all(member.household) as { person: string }[]
        ).map((row) => row.person);
        if (!named.includes(person) && named.length >= 2) throw new AppError("HOUSEHOLD_FULL");
        this.#record({ address, household: member.household, person }, "add", member);
        return { address, household: member.household, person };
      })
      .immediate();
  }

  /**
   * Takes an address out of its household — out of `household`, when one is
   * named, and refused if it is not there, so a screen that has gone stale
   * cannot remove an address from a household it has since moved to. Returns
   * the membership it ended.
   */
  removeMember(member: { address: string; household?: string } & Change): Member {
    if (typeof member.address !== "string") refuse("The address is not a string.");
    const address = readAddress(member.address);
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
