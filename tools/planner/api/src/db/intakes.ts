/**
 * The intake store: rows in, rows out, and nothing else.
 *
 * Every decision about which questions exist, which ones these answers open and
 * which ones an edit strands belongs to `@planner/intake`. A store that starts
 * evaluating a condition is a second copy of the engine, and it will drift — so
 * nothing here imports the tree, and nothing here knows what a question is
 * beyond a string that keys a row.
 *
 * The one judgement it does make is at the parse boundary: a stored `value` that
 * no longer fits `answerSchema` is reported as unreadable rather than thrown
 * over, because a single corrupt row must not brick an intake. What to *do*
 * about it is the caller's, and it does the same thing it does with an answer
 * whose question the tree has dropped.
 */

import { answerSchema, type Answer, type Answers, type QuestionId } from "@planner/contract";
import type { Database, Statement } from "better-sqlite3";

/** An intake as it sits on disk. Column names, not the contract's field names. */
interface IntakeRow {
  id: string;
  title: string | null;
  tree_version: number;
  created_at: string;
  updated_at: string;
}

/** An intake as everything above this file reads it. */
export interface StoredIntake {
  id: string;
  title: string | null;
  treeVersion: number;
  createdAt: string;
  updatedAt: string;
}

function toStored(row: IntakeRow): StoredIntake {
  return {
    id: row.id,
    title: row.title,
    treeVersion: row.tree_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every answer an intake holds, and the ones that could not be read back.
 *
 * `unreadable` is all but always empty. It goes non-empty when a row was written
 * by a build whose contract disagreed with this one — the same situation as an
 * answer to a question the tree no longer has, and it wants the same treatment.
 */
export interface StoredAnswers {
  answers: Answers;
  unreadable: QuestionId[];
}

export function insertIntake(
  db: Database,
  intake: { id: string; treeVersion: number; now: string },
): StoredIntake {
  db.prepare(
    `INSERT INTO intakes (id, title, tree_version, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?)`,
  ).run(intake.id, intake.treeVersion, intake.now, intake.now);

  return {
    id: intake.id,
    title: null,
    treeVersion: intake.treeVersion,
    createdAt: intake.now,
    updatedAt: intake.now,
  };
}

export function selectIntake(db: Database, id: string): StoredIntake | undefined {
  const row = db.prepare("SELECT * FROM intakes WHERE id = ?").get(id) as IntakeRow | undefined;
  return row === undefined ? undefined : toStored(row);
}

/**
 * Most recently touched first — what the index on `updated_at` is for, and the
 * order someone coming back to a half-finished intake wants.
 */
export function selectIntakes(db: Database, limit: number): StoredIntake[] {
  const rows = db
    .prepare("SELECT * FROM intakes ORDER BY updated_at DESC, id LIMIT ?")
    .all(limit) as IntakeRow[];
  return rows.map(toStored);
}

export function selectAnswers(db: Database, intakeId: string): StoredAnswers {
  const rows = db
    .prepare("SELECT question_id, value FROM answers WHERE intake_id = ?")
    .all(intakeId) as { question_id: string; value: string }[];

  const answers: Record<QuestionId, Answer> = {};
  const unreadable: QuestionId[] = [];

  for (const row of rows) {
    const parsed = answerSchema.safeParse(readJson(row.value));
    if (parsed.success) answers[row.question_id] = parsed.data;
    else unreadable.push(row.question_id);
  }

  return { answers, unreadable };
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Indistinguishable from a row that parses into the wrong shape, and the
    // caller treats both the same way.
    return null;
  }
}

/** Idempotent by primary key: re-answering replaces the row rather than adding one. */
export function upsertAnswer(
  db: Database,
  answer: { intakeId: string; questionId: QuestionId; answer: Answer; now: string },
): void {
  db.prepare(
    `INSERT INTO answers (intake_id, question_id, value, answered_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (intake_id, question_id)
     DO UPDATE SET value = excluded.value, answered_at = excluded.answered_at`,
  ).run(answer.intakeId, answer.questionId, JSON.stringify(answer.answer), answer.now);
}

export function deleteAnswers(
  db: Database,
  intakeId: string,
  questions: readonly QuestionId[],
): void {
  if (questions.length === 0) return;
  const statement: Statement = db.prepare(
    "DELETE FROM answers WHERE intake_id = ? AND question_id = ?",
  );
  for (const question of questions) statement.run(intakeId, question);
}

/**
 * Update the derived columns.
 *
 * `updatedAt` is optional because the two callers differ: a write moves it, and
 * reconciling a saved intake against a newer tree does not — nobody touched the
 * intake, the tree moved underneath it, and sending it to the top of the list
 * for that would be a lie about when it was last worked on.
 */
export function updateIntake(
  db: Database,
  intake: { id: string; title: string | null; treeVersion: number; updatedAt?: string },
): void {
  db.prepare(
    `UPDATE intakes
        SET title = ?, tree_version = ?, updated_at = COALESCE(?, updated_at)
      WHERE id = ?`,
  ).run(intake.title, intake.treeVersion, intake.updatedAt ?? null, intake.id);
}
