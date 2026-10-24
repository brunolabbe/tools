/**
 * A seeded population of pastes against workbook histories (lg-65), for checking
 * a change to the block search against the search it replaces: the same seed
 * gives the same history and the same pastes on any tree. Every amount, date and
 * description is invented.
 *
 * It is the population lg-58's gate drew from, as its Log describes it, rebuilt:
 * that generator was never committed. A seed draws one of four shapes:
 *
 * - **A stretch** (85 %): the bank's 3 to 7 movements over a few days, between a
 *   few whole days before and after, and the workbook's copy of them with rows
 *   re-dated (one day mostly, two or three now and then) and neighbours swapped.
 *   The paste is the history's tail with or without new rows, a slice inside it,
 *   new rows stored by a first paste and then met again by a second, or one of
 *   those with an amount changed so that it cannot fit.
 * - **Alternating dates** (10 %): lg-65's own shape, small: 12 to 40 rows whose
 *   dates alternate by a day within runs of 3 to 12, and a few rows pasted inside
 *   or at the tail, re-dated as the bank dates them.
 * - **A long day** (5 %): one day of 16 to 24 rows the workbook lists in its own
 *   order, and a few of them pasted from partway through, which crosses
 *   `LONGEST_SEARCHED_DAY`.
 */

import Database from "better-sqlite3";
import { AppError } from "@ledger/contract";
import { migrate } from "../../src/db/schema.ts";
import { importStatement } from "../../src/statements.ts";
import { renderPaste, withBalances } from "./paste.ts";

/** A row of the history or of a paste: a day number, an amount, a description. */
export interface Movement {
  readonly day: number;
  readonly amountCents: number;
  readonly description: string;
}

/** What one seed draws: the workbook's rows, oldest first, and the pastes in order. */
export interface Scenario {
  readonly seed: number;
  readonly shape: string;
  readonly opening: number;
  readonly workbook: readonly Movement[];
  readonly pastes: readonly { readonly rows: readonly Movement[]; readonly opening: number }[];
}

const BASE = Date.UTC(2026, 0, 10);
const OPENING = 1_000_000;
const AMOUNTS = [1000, -1000, 500, -500, 250, -250, 1500, -2000, 750, -300];

/** A `yyyy-mm-dd` date `day` days after the population's first. */
export function dateOf(day: number): string {
  return new Date(BASE + day * 86_400_000).toISOString().slice(0, 10);
}

/** mulberry32: a small seeded generator, so a seed is the same draw everywhere. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The balance before row `index` of `rows`, from `opening`. */
function openingAt(rows: readonly Movement[], index: number, opening: number): number {
  let balance = opening;
  for (let at = 0; at < index; at++) balance += (rows[at] as Movement).amountCents;
  return balance;
}

/** The scenario seed `seed` draws. */
export function scenario(seed: number): Scenario {
  const random = generator(seed);
  const int = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const fresh = (day: number, index: number): Movement => ({
    day,
    amountCents: pick(AMOUNTS),
    description: `New ${index}`,
  });
  const shapeDraw = random();

  if (shapeDraw < 0.1) {
    // lg-65's shape, small enough for the search it replaces.
    const width = int(12, 40);
    const run = int(3, 12);
    const kind = pick(["alt", "const", "mixed"] as const);
    const amountAt = (index: number): number =>
      kind === "alt" ? (index % 2 === 0 ? 1000 : -1000) : kind === "const" ? 1000 : pick(AMOUNTS);
    const bank: Movement[] = [];
    const workbook: Movement[] = [];
    for (let index = 0; index < width; index++) {
      const amountCents = amountAt(index);
      const day = Math.floor(index / run);
      bank.push({ day, amountCents, description: `Op ${index}` });
      workbook.push({ day: day + (index % 2), amountCents, description: `W${index}` });
    }
    const count = int(1, 4);
    const tail = random() < 0.3;
    const from = tail ? width - count : int(1, width - count - 1);
    const rows = bank.slice(from, from + count);
    if (tail && random() < 0.5) rows.push(fresh(Math.floor(width / run), 0));
    return {
      seed,
      shape: `alternating-${kind}`,
      opening: OPENING,
      workbook,
      pastes: [{ rows, opening: openingAt(bank, from, OPENING) }],
    };
  }

  if (shapeDraw < 0.15) {
    // One long day, listed by the workbook in its own order.
    const length = int(16, 24);
    const before = int(0, 2);
    const bank: Movement[] = [];
    for (let index = 0; index < before; index++) {
      bank.push({ day: index, amountCents: pick(AMOUNTS), description: `Before ${index}` });
    }
    for (let index = 0; index < length; index++) {
      bank.push({ day: before, amountCents: pick(AMOUNTS), description: `Long ${index}` });
    }
    const workbook = bank.map((row) => ({ ...row }));
    for (let swaps = int(1, 6); swaps > 0; swaps--) {
      const at = int(before, bank.length - 2);
      [workbook[at], workbook[at + 1]] = [workbook[at + 1] as Movement, workbook[at] as Movement];
    }
    const count = int(1, 4);
    const from = int(before + 1, bank.length - count - 1);
    return {
      seed,
      shape: "long-day",
      opening: OPENING,
      workbook,
      pastes: [{ rows: bank.slice(from, from + count), opening: openingAt(bank, from, OPENING) }],
    };
  }

  // A stretch: whole days, the bank's movements re-dated and swapped, whole days.
  const prefix = int(0, 4);
  const bank: Movement[] = [];
  for (let index = 0; index < prefix; index++) {
    bank.push({ day: index, amountCents: pick(AMOUNTS), description: `Before ${index}` });
  }
  const pool = [pick(AMOUNTS), pick(AMOUNTS), pick(AMOUNTS)];
  const movements = int(3, 7);
  let day = prefix + 1;
  const stretch: Movement[] = [];
  for (let index = 0; index < movements; index++) {
    if (index > 0) {
      const step = random();
      day += step < 0.5 ? 0 : step < 0.9 ? 1 : 2;
    }
    stretch.push({ day, amountCents: pick(pool), description: `Mv ${index}` });
  }
  const copied = stretch.map((row) => {
    if (random() >= 0.3) return { ...row };
    const size = random();
    const off = size < 0.7 ? 1 : size < 0.9 ? 2 : 3;
    return { ...row, day: row.day + (random() < 0.5 ? -off : off) };
  });
  for (let index = 0; index + 1 < copied.length; index++) {
    if (random() < 0.25) {
      [copied[index], copied[index + 1]] = [
        copied[index + 1] as Movement,
        copied[index] as Movement,
      ];
    }
  }
  const suffix = random() < 0.5 ? 0 : int(1, 3);
  const after: Movement[] = [];
  for (let index = 0; index < suffix; index++) {
    after.push({ day: day + 1 + index, amountCents: pick(AMOUNTS), description: `After ${index}` });
  }
  bank.push(...stretch, ...after);
  const workbook = [...bank.slice(0, prefix), ...copied, ...after];
  const lastDay = (bank.at(-1) as Movement).day;
  const total = bank.length;
  const mode = random();
  const paste = (rows: Movement[], history: readonly Movement[], from: number) => ({
    rows,
    opening: openingAt(history, from, OPENING),
  });

  if (mode < 0.4) {
    const from = int(Math.max(0, total - 8), total - 1);
    const rows = bank.slice(from);
    if (random() < 0.5) {
      for (let index = int(1, 2); index > 0; index--) rows.push(fresh(lastDay + int(0, 1), index));
    }
    return {
      seed,
      shape: "stretch-tail",
      opening: OPENING,
      workbook,
      pastes: [paste(rows, bank, from)],
    };
  }
  if (mode < 0.7) {
    const from = int(0, total - 1);
    const count = int(1, Math.min(5, total - from));
    return {
      seed,
      shape: "stretch-inside",
      opening: OPENING,
      workbook,
      pastes: [paste(bank.slice(from, from + count), bank, from)],
    };
  }
  if (mode < 0.85) {
    // New rows stored by a first paste, then a second paste across them.
    const added: Movement[] = [];
    for (let index = int(1, 3); index > 0; index--) added.push(fresh(lastDay + int(0, 1), index));
    added.sort((one, other) => one.day - other.day);
    const extended = [...bank, ...added];
    const first = int(Math.max(0, total - 6), total - 1);
    const second = int(Math.max(0, total - 4), extended.length - 1);
    const again = extended.slice(second);
    if (random() < 0.5) again.push(fresh((extended.at(-1) as Movement).day + 1, 9));
    return {
      seed,
      shape: "stretch-twice",
      opening: OPENING,
      workbook,
      pastes: [paste(extended.slice(first), extended, first), paste(again, extended, second)],
    };
  }
  // A paste that cannot fit: one amount changed.
  const from = int(0, total - 1);
  const rows = bank.slice(from, from + int(1, Math.min(5, total - from)));
  const changed = int(0, rows.length - 1);
  rows[changed] = {
    ...(rows[changed] as Movement),
    amountCents: (rows[changed] as Movement).amountCents + 100,
  };
  return {
    seed,
    shape: "stretch-wrong",
    opening: OPENING,
    workbook,
    pastes: [paste(rows, bank, from)],
  };
}

/** What a paste came to: its report, or the error's code, message and details. */
export type PasteOutcome =
  | { readonly report: unknown }
  | { readonly code: string; readonly message: string; readonly details: unknown };

/** Every paste's outcome in order, and every stored row after the last. */
export interface ScenarioOutcome {
  readonly pastes: readonly PasteOutcome[];
  readonly stored: readonly unknown[];
}

// A migrated empty database, copied for each scenario: migrating costs more than
// most scenarios' pastes.
let migrated: Buffer | undefined;

/** A fresh, migrated `:memory:` database. */
function freshDatabase(): Database.Database {
  if (migrated === undefined) {
    const template = new Database(":memory:");
    migrate(template);
    migrated = template.serialize();
    template.close();
  }
  return new Database(migrated);
}

/** The scenario run on a fresh database: the workbook stored, then each paste. */
export function runScenario(drawn: Scenario): ScenarioOutcome {
  const db = freshDatabase();
  try {
    const imported = db
      .prepare(
        "INSERT INTO statement_imports (imported_at, imported_by, source) VALUES (?, ?, 'workbook')",
      )
      .run("2026-10-01T00:00:00Z", "alex").lastInsertRowid;
    const insert = db.prepare(
      "INSERT INTO statement_rows (seq, date, category, description, amount_cents, balance_cents, import_id) VALUES (?, ?, '', ?, ?, ?, ?)",
    );
    let balance = drawn.opening;
    db.transaction(() => {
      for (const [seq, row] of drawn.workbook.entries()) {
        balance += row.amountCents;
        insert.run(seq, dateOf(row.day), `W${seq}`, row.amountCents, balance, imported);
      }
    })();
    const pastes = drawn.pastes.map((paste): PasteOutcome => {
      const text = renderPaste(
        withBalances(
          paste.rows.map((row) => ({
            date: dateOf(row.day),
            description: row.description,
            amountCents: row.amountCents,
          })),
          paste.opening,
        ),
      );
      try {
        return {
          report: importStatement(
            { db, personId: "alex", now: () => new Date("2026-10-18T00:00:00Z") },
            text,
          ),
        };
      } catch (error: unknown) {
        if (!(error instanceof AppError)) throw error;
        return { code: error.code, message: error.message, details: error.details ?? null };
      }
    });
    const stored = db
      .prepare(
        "SELECT seq, date, description, amount_cents, balance_cents, import_id FROM statement_rows ORDER BY seq",
      )
      .all();
    return { pastes, stored };
  } finally {
    db.close();
  }
}
