/**
 * The household's people, as the books name them (lg-5).
 *
 * Who may sign in, and under which name, is the household directory (lg-20).
 * Who the books may name is this table, and a person's id in it **is that
 * name** — the same text lg-4 already stores on rules and classifications — so
 * every row stored before the table existed still names someone in it.
 *
 * Two writers, both of names the household already uses. Migration 3 enrols
 * every person id lg-4 had stored on a rule or a classification; then each name
 * the household's current members stand under that the table does not hold is
 * added — at boot, and whenever a request shows one the table lacks, which is how
 * a member added since boot arrives. Nothing is ever removed, because a person a
 * stored row names stays named after they stop being able to sign in (a name is
 * permanent: `docs/00-ANALYSIS.md` §7). No name is seeded from the repository: a
 * fresh database with an empty directory has no people.
 *
 * A person can be **retired** from the books at a close (lg-35): they stay in
 * this table, every stored row still names them, and `people_retirements` says
 * from which day they are not in — and from which day they are again, after a
 * return. The history reads everyone here; what concerns the open period or
 * after reads `peopleInOpenPeriod`.
 */

import { dayAfter, peopleOn } from "@ledger/books";
import type { RetirementInput } from "@ledger/books";
import type { Database } from "better-sqlite3";

/** Adds every name the table does not hold yet. Returns how many were added. */
export function enrollPeople(db: Database, ids: readonly string[], now: Date): number {
  const insert = db.prepare("INSERT OR IGNORE INTO people (id, added_at) VALUES (?, ?)");
  const at = now.toISOString();
  return db
    .transaction(() => ids.reduce((added, id) => added + insert.run(id, at).changes, 0))
    .immediate();
}

/** Every person the books may name, in id order. */
export function knownPeople(db: Database): string[] {
  return (db.prepare("SELECT id FROM people ORDER BY id").all() as { id: string }[]).map(
    (row) => row.id,
  );
}

/**
 * Every retirement and return the books hold, oldest first (lg-35): what
 * `peopleOn` in `books` reads to say who is in on a date. Who is in is that
 * function, over `knownPeople` and these; nothing here decides it again.
 */
export function retirementsOf(db: Database): RetirementInput[] {
  return (
    db.prepare("SELECT person_id, action, from_date FROM people_retirements ORDER BY id").all() as {
      person_id: string;
      action: RetirementInput["action"];
      from_date: string;
    }[]
  ).map((row) => ({ personId: row.person_id, action: row.action, fromDate: row.from_date }));
}

/** The open period's first day: the day after the last close, or `null` before any. */
export function openPeriodStart(db: Database): string | null {
  const { end } = db.prepare("SELECT max(end_date) AS end FROM periods").get() as {
    end: string | null;
  };
  return end === null ? null : dayAfter(end);
}

/**
 * Who is in from the open period on, and who the books hold that is not
 * (lg-35): what a screen offers, and what the history still names. Before any
 * close nobody can have been retired, so everyone is in.
 */
export function peopleInOpenPeriod(db: Database): { people: string[]; retired: string[] } {
  return db.transaction(() => {
    const everyone = knownPeople(db);
    const start = openPeriodStart(db);
    const people = start === null ? everyone : peopleOn(everyone, retirementsOf(db), start);
    const isIn = new Set(people);
    return { people, retired: everyone.filter((person) => !isIn.has(person)) };
  })();
}

export interface Enroller {
  /**
   * Adds the names the table lacks, and returns how many it added. With
   * `wait: false` a books file another process holds the write lock on — the
   * import command, mid-import — refuses at once rather than after the
   * connection's `busy_timeout`, which would be spent on the event loop.
   */
  enroll(ids: readonly string[], options?: { wait?: boolean }): number;
  /** Whether the table is known to hold this name. */
  knows(id: string): boolean;
}

/**
 * `enrollPeople`, remembering what the table already holds so that the request
 * that finds nothing new — every request but the first after a member is added
 * — writes nothing. The memory only ever lags the table: nothing removes a
 * person, so a name it lacks costs one `INSERT OR IGNORE`, never a wrong answer.
 */
export function createEnroller(db: Database, now: () => Date): Enroller {
  const known = new Set(knownPeople(db));
  return {
    enroll(ids, { wait = true } = {}) {
      const missing = ids.filter((id) => !known.has(id));
      if (missing.length === 0) return 0;
      const timeout = Number(db.pragma("busy_timeout", { simple: true }));
      if (!wait) db.pragma("busy_timeout = 0");
      try {
        const added = enrollPeople(db, missing, now());
        for (const id of missing) known.add(id);
        return added;
      } finally {
        // Interpolated because PRAGMA takes no bound parameter; it is the
        // connection's own number, read just above.
        if (!wait) db.pragma(`busy_timeout = ${String(timeout)}`);
      }
    },
    knows: (id) => known.has(id),
  };
}
