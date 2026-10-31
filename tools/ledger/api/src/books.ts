/**
 * Each household's books, a SQLite file of its own (lg-21).
 *
 * The owner chose a file per household over a household column
 * (`docs/00-ANALYSIS.md` §7): a column would reach every table, view and
 * statement, and one query that forgot it would show one household's bank rows
 * to another. A request that holds only its own household's file cannot. So the
 * handle a route works on is the one the identity hook attached for the
 * caller's household (`booksOf` in `identity.ts`), and nothing else hands one
 * out.
 *
 * A household's file is `<data>/households/<id>.db`, opened when it is first
 * needed — at boot for every household the directory holds, on the first request
 * for one added since — created if there is none, migrated, and its members'
 * names enrolled into its `people` table. It stays open until shutdown. Under
 * `:memory:` each household gets an in-memory database of its own: one shared
 * `:memory:` handle would be one connection pretending to be two.
 */

import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { AppError } from "@ledger/contract";
import type { Person } from "@ledger/contract";
import Database from "better-sqlite3";
import { API_DEFAULTS } from "./config.ts";
import { applyMigrations, configure } from "./db/schema.ts";
import { isHouseholdId } from "./directory.ts";
import type { Directory } from "./directory.ts";
import type { AppLogger } from "./logger.ts";
import { createEnroller } from "./people.ts";
import type { Enroller } from "./people.ts";

/**
 * The file a household's books are in. The id is the directory's, which lg-20
 * restricts to one lowercase word and lg-71 to that or a lowercase UUID; the
 * resolved path is checked to sit
 * directly inside `households/` all the same, so a check loosened in one place
 * cannot turn an id into a path somewhere else.
 */
export function householdBooksPath(dataDir: string, household: string): string {
  const households = path.resolve(dataDir, API_DEFAULTS.householdsDir);
  const file = path.resolve(households, `${household}.db`);
  if (!isHouseholdId(household) || path.dirname(file) !== households) {
    throw new AppError("INTERNAL", "A household id names no books file outside households/.");
  }
  return file;
}

/**
 * Refuses a data directory that is a file: `DATABASE_PATH` named the one books
 * file until lg-21, and a stale setting pointing at it would otherwise fail on
 * the first household with a bare `ENOTDIR`.
 */
export function checkDataDir(dataDir: string): void {
  if (dataDir === ":memory:") return;
  let isFile = false;
  try {
    isFile = !statSync(dataDir).isDirectory();
  } catch {
    // Not there yet: it is made with the first household's file.
  }
  if (isFile) {
    throw new AppError(
      "INTERNAL",
      "DATABASE_PATH names a file. Since lg-21 it is the directory the books are kept in, one file per household.",
    );
  }
}

interface Held {
  db: Database.Database;
  enroller: Enroller;
}

/** Whether a SQLite error is another connection holding the write lock. */
function isBusy(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "SQLITE_BUSY";
}

/**
 * The lock answered as a paste that meets it is (statements.ts): retryable, and
 * the same request goes through once the other writer is done.
 */
function busy(error: unknown): AppError {
  return new AppError("TIMEOUT", "The ledger's books were busy. Try again in a moment.", {
    cause: error,
    retryable: true,
  });
}

/**
 * `run` with the connection's `busy_timeout` at 0, so a write lock another
 * process holds refuses at once instead of being waited out on the event loop,
 * which would hold up every household's requests, not only this one's.
 */
function withoutWaiting<T>(db: Database.Database, run: () => T): T {
  const timeout = Number(db.pragma("busy_timeout", { simple: true }));
  db.pragma("busy_timeout = 0");
  try {
    return run();
  } finally {
    // Interpolated because PRAGMA takes no bound parameter; it is the
    // connection's own number, read just above.
    db.pragma(`busy_timeout = ${String(timeout)}`);
  }
}

/**
 * Whether opening a household's books may wait on another process's write lock.
 * Boot may: nothing is served yet. A request or a health probe may not (lg-20's
 * gate F5; lg-21's gate F3).
 */
interface OpenOptions {
  wait: boolean;
}

export class Books {
  readonly #dataDir: string;
  readonly #directory: Directory;
  readonly #now: () => Date;
  readonly #logger: AppLogger;
  readonly #held = new Map<string, Held>();
  readonly #template: Buffer | undefined;

  constructor(options: {
    dataDir: string;
    directory: Directory;
    now: () => Date;
    logger: AppLogger;
    /**
     * Test-only (lg-69, `CreateAppOptions.booksTemplate`): an already-migrated
     * database an in-memory household starts from. Not read for books in files.
     */
    template?: Buffer;
  }) {
    this.#template = options.template;
    this.#dataDir = options.dataDir;
    this.#directory = options.directory;
    this.#now = options.now;
    this.#logger = options.logger;
  }

  /** Opens every household the directory holds: what boot does, waiting on a lock. */
  openAll(options: OpenOptions = { wait: true }): void {
    for (const household of this.#directory.households()) this.#open(household.id, options);
  }

  /**
   * The household's books, opened if they are not. For the commands and the
   * tests; a route reads its books from `booksOf(request)`, never from here.
   */
  of(household: string): Database.Database {
    return this.#open(household, { wait: true }).db;
  }

  /**
   * The books of the member's household, with every name the household's
   * current members stand under enrolled into its `people` (lg-20, `people.ts`).
   *
   * A name the books cannot take — another process holds the write lock —
   * refuses only the person whose name it is (lg-20's gate, F5): the
   * household's other members are served, and the next request tries again.
   * Nothing here waits on the lock, the first open of a household included.
   */
  forMember(person: Person): Database.Database {
    const held = this.#open(person.household, { wait: false });
    try {
      held.enroller.enroll(this.#directory.people(person.household), { wait: false });
    } catch (error: unknown) {
      if (!held.enroller.knows(person.id)) throw isBusy(error) ? busy(error) : error;
      this.#logger.warn("a new member's name could not be enrolled yet; the next request retries", {
        household: person.household,
      });
    }
    return held.db;
  }

  /**
   * Whether every household's books are open: each one the directory holds is
   * opened if it is not yet, without waiting on a lock, and a household whose
   * file cannot be is reported as not open. Never says which, or where.
   */
  check(): boolean {
    if (this.#directory.open) {
      try {
        this.openAll({ wait: false });
      } catch (error: unknown) {
        this.#logger.error("a household's books could not be opened", {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
    return [...this.#held.values()].every((held) => held.db.open);
  }

  /** Closes every household's books. */
  close(): void {
    for (const held of this.#held.values()) {
      if (held.db.open) held.db.close();
    }
  }

  #open(household: string, { wait }: OpenOptions): Held {
    const held = this.#held.get(household);
    if (held !== undefined) return held;
    if (this.#directory.household(household) === undefined) {
      // A books file only for a household the directory holds.
      throw new AppError("INTERNAL", "There are no books for a household the directory lacks.");
    }

    const memory = this.#dataDir === ":memory:";
    const file = memory ? ":memory:" : householdBooksPath(this.#dataDir, household);
    if (!memory) mkdirSync(path.dirname(file), { recursive: true });
    // better-sqlite3 waits 5 s on a lock by default, which `configure` would
    // spend on switching the journal before it sets the timeout itself.
    // better-sqlite3 copies a buffer it is given, so households starting from
    // one template do not share a database.
    const db = new Database(memory && this.#template !== undefined ? this.#template : file, {
      timeout: wait ? 5000 : 0,
    });
    let enroller: Enroller;
    try {
      configure(db);
      // Unmigrated books are no use to anyone, so a migration the lock refuses
      // closes the file again, and the next request or probe opens it afresh.
      if (wait) applyMigrations(db);
      else withoutWaiting(db, () => applyMigrations(db));
      enroller = createEnroller(db, this.#now);
    } catch (error: unknown) {
      db.close();
      throw isBusy(error) ? busy(error) : error;
    }
    const opened = { db, enroller };
    try {
      enroller.enroll(this.#directory.people(household), { wait });
    } catch (error: unknown) {
      if (!isBusy(error)) {
        db.close();
        throw error;
      }
      // Migrated books whose names the lock kept out are kept, and
      // `forMember` enrols them on a later request, refusing meanwhile only a
      // person whose name is not in yet.
      this.#logger.warn("a household's names could not be enrolled yet; the next request retries", {
        household,
      });
    }
    this.#held.set(household, opened);
    return opened;
  }
}
