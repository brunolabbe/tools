/**
 * The intake, between the store and the routes.
 *
 * Two things live here and nowhere else. The first is **one transaction per
 * write**: the answer, the prune and the deletion of what the prune stranded go
 * in together, because a crash between them leaves an intake holding answers to
 * questions nobody would ask — the exact state `@planner/intake` exists to make
 * impossible. The second is **one reconciliation path**: a saved intake meeting a
 * newer tree is run through the same `prune`, and what falls out is reported
 * rather than quietly lost.
 *
 * Nothing here decides which questions exist. Reachability, invalidation, the
 * checkpoint and the brief are all `@planner/intake`'s, called from here.
 */

import { randomUUID } from "node:crypto";
import {
  AppError,
  type Answer,
  type Answers,
  type DiscardedAnswer,
  type IntakeState,
  type IntakeSummary,
  type QuestionId,
  type QuestionNode,
} from "@planner/contract";
import {
  nextQuestion,
  prune,
  QUESTION_TREE,
  reachable,
  toBrief,
  validateAnswer,
  type DroppedAnswer,
} from "@planner/intake";
import type { Database } from "better-sqlite3";
import type { AppContext } from "../context.ts";
import {
  deleteAnswers,
  insertIntake,
  selectAnswers,
  selectIntake,
  selectIntakes,
  updateIntake,
  upsertAnswer,
  type StoredAnswers,
  type StoredIntake,
} from "../db/intakes.ts";
import { intakeTitle } from "./title.ts";

/**
 * How many intakes the list returns. Nobody has more than a handful, and an
 * unbounded list is a table scan waiting for the day somebody does.
 */
export const MAX_INTAKES_LISTED = 50;

/** An intake, and what reading or writing it discarded on the way. */
interface LoadedIntake {
  intake: StoredIntake;
  answers: Answers;
  discarded: DiscardedAnswer[];
}

function notFound(id: string): AppError {
  return new AppError("INTAKE_NOT_FOUND", undefined, { details: { intake: id } });
}

/** `prune`'s output as the wire carries it: a prompt to show, never an id. */
function asDiscarded(dropped: readonly DroppedAnswer[]): DiscardedAnswer[] {
  return dropped.map((entry) => ({ question: entry.question, prompt: entry.node?.prompt ?? null }));
}

function nodesById(): Map<QuestionId, QuestionNode> {
  return new Map(QUESTION_TREE.nodes.map((node) => [node.id, node]));
}

// ---------------------------------------------------------------------------
// Reconciling a saved intake with the tree it comes back to
// ---------------------------------------------------------------------------

/**
 * Has the tree moved under this intake, or is a row unreadable?
 *
 * Checked before opening a transaction so the common read — an intake on the
 * current tree — stays a read.
 */
function needsReconcile(intake: StoredIntake, stored: StoredAnswers): boolean {
  return intake.treeVersion !== QUESTION_TREE.version || stored.unreadable.length > 0;
}

/**
 * Re-run the engine against the **current** tree and drop what no longer fits.
 *
 * The decision the ticket left open, recorded in its log and in the roadmap: a
 * tree version change re-runs the same machinery as any other invalidation,
 * rather than keeping every historical tree forever. Three things can fall out,
 * and all three are reported:
 *
 * - an answer whose question the tree no longer has — `prune` already returns it
 *   with a null node, and the UI has no prompt to name it by;
 * - an answer stranded because a branch above it closed;
 * - an answer that no longer *fits* its question, because a bound tightened or a
 *   choice was removed. Left in place it would throw `INTERNAL` out of `toBrief`
 *   on a plain read, which is the trap this half exists for.
 *
 * Re-validating is deliberately scoped to a version move. `validateAnswer` knows
 * what day it is, so running it on every read would drop a departure date for the
 * crime of the date arriving — and re-asking dates every time someone reloads is
 * worse than the problem. On a version move it is the right answer anyway: a trip
 * whose departure has passed does need re-answering.
 *
 * Pure, and separate from the writing below, so the dry run can reconcile
 * without reconciling: a preview that wrote would not be one.
 */
function reconcileAnswers(
  stored: StoredAnswers,
  treeMoved: boolean,
  now: Date,
): { kept: Answers; gone: QuestionId[]; discarded: DiscardedAnswer[] } {
  const byId = nodesById();

  const surviving: Record<QuestionId, Answer> = {};
  const invalid: QuestionId[] = [];

  for (const [question, answer] of Object.entries(stored.answers)) {
    const node = byId.get(question);
    // An answer whose question is gone stays in the set on purpose: `prune`
    // reports it with a null node, which is one list rather than two.
    if (node !== undefined && treeMoved) {
      try {
        validateAnswer(node, answer, now);
      } catch {
        invalid.push(question);
        continue;
      }
    }
    surviving[question] = answer;
  }

  const { kept, dropped } = prune(QUESTION_TREE, surviving);
  const removed = [...stored.unreadable, ...invalid];

  return {
    kept,
    gone: [...removed, ...dropped.map((entry) => entry.question)],
    discarded: [
      ...removed.map((question) => ({
        question,
        prompt: byId.get(question)?.prompt ?? null,
      })),
      ...asDiscarded(dropped),
    ],
  };
}

/** The reconciliation above, written down. **Caller must be inside a transaction.** */
function reconcileWithin(
  db: Database,
  intake: StoredIntake,
  stored: StoredAnswers,
  now: Date,
): LoadedIntake {
  const { kept, gone, discarded } = reconcileAnswers(
    stored,
    intake.treeVersion !== QUESTION_TREE.version,
    now,
  );

  deleteAnswers(db, intake.id, gone);

  const reconciled: StoredIntake = {
    ...intake,
    title: intakeTitle(toBrief(QUESTION_TREE, kept)),
    treeVersion: QUESTION_TREE.version,
  };
  // `updatedAt` deliberately stays put: the tree moved, nobody touched the
  // intake, and sending it to the top of the list would be a lie about that.
  updateIntake(db, reconciled);

  return { intake: reconciled, answers: kept, discarded };
}

/** Load an intake, reconciling it first if the tree has moved under it. */
function load(context: AppContext, id: string): LoadedIntake {
  const intake = selectIntake(context.db, id);
  if (intake === undefined) throw notFound(id);

  const stored = selectAnswers(context.db, id);
  if (!needsReconcile(intake, stored)) {
    return { intake, answers: stored.answers, discarded: [] };
  }

  const now = context.now();
  return context.db.transaction(() => reconcileWithin(context.db, intake, stored, now))();
}

// ---------------------------------------------------------------------------
// The state the wizard renders
// ---------------------------------------------------------------------------

function toSummary(intake: StoredIntake): IntakeSummary {
  return {
    id: intake.id,
    title: intake.title,
    treeVersion: intake.treeVersion,
    createdAt: intake.createdAt,
    updatedAt: intake.updatedAt,
  };
}

function toState(loaded: LoadedIntake): IntakeState {
  const { node, coreComplete } = nextQuestion(QUESTION_TREE, loaded.answers);
  return {
    intake: toSummary(loaded.intake),
    questions: reachable(QUESTION_TREE, loaded.answers),
    answers: loaded.answers,
    progress: { question: node, coreComplete },
    brief: toBrief(QUESTION_TREE, loaded.answers),
    discarded: loaded.discarded,
  };
}

// ---------------------------------------------------------------------------
// What the routes call
// ---------------------------------------------------------------------------

export function createIntake(context: AppContext): IntakeState {
  const now = context.now().toISOString();
  const intake = insertIntake(context.db, {
    id: randomUUID(),
    treeVersion: QUESTION_TREE.version,
    now,
  });
  return toState({ intake, answers: {}, discarded: [] });
}

export function readIntake(context: AppContext, id: string): IntakeState {
  return toState(load(context, id));
}

export function listIntakes(context: AppContext): IntakeSummary[] {
  return selectIntakes(context.db, MAX_INTAKES_LISTED).map(toSummary);
}

/**
 * The question this answer is for, refused unless this intake actually opened
 * it.
 *
 * Looked up in the **reachable** set rather than in `tree.nodes`: answering a
 * question these answers never opened is a request to refuse, not a row to
 * write. It is the caller's mistake either way, so it is `INVALID_ANSWER` with
 * the question in `details` — the wizard puts the user back on a question rather
 * than at the start.
 */
function findQuestion(answers: Answers, questionId: QuestionId): QuestionNode {
  const node = reachable(QUESTION_TREE, answers).find((each) => each.id === questionId);
  if (node === undefined) {
    throw new AppError("INVALID_ANSWER", "That question is not part of this intake.", {
      details: { question: questionId },
    });
  }
  return node;
}

/**
 * What this answer would leave behind, written nowhere.
 *
 * Deliberately the same `prune` call on the same answers the write would see —
 * including the reconciliation, computed and thrown away rather than skipped, so
 * a stale intake does not make the warning and the write disagree about what a
 * change costs. Nothing is written: a dry run that writes is not one.
 */
export function previewAnswer(
  context: AppContext,
  id: string,
  questionId: QuestionId,
  answer: Answer,
): DiscardedAnswer[] {
  const intake = selectIntake(context.db, id);
  if (intake === undefined) throw notFound(id);

  const now = context.now();
  const stored = selectAnswers(context.db, id);
  const answers = needsReconcile(intake, stored)
    ? reconcileAnswers(stored, intake.treeVersion !== QUESTION_TREE.version, now).kept
    : stored.answers;

  const node = findQuestion(answers, questionId);
  validateAnswer(node, answer, now);

  const { dropped } = prune(QUESTION_TREE, { ...answers, [node.id]: answer });
  return asDiscarded(dropped);
}

/**
 * Write one answer, and everything that follows from it, in one transaction.
 *
 * The order is the ticket's, and the transaction is the point: the answer lands,
 * `prune` says what that stranded, and the stranded rows go — all of it or none
 * of it.
 */
export function writeAnswer(
  context: AppContext,
  id: string,
  questionId: QuestionId,
  answer: Answer,
): IntakeState {
  const now = context.now();
  const timestamp = now.toISOString();
  const { db } = context;

  const written = db.transaction((): LoadedIntake => {
    const intake = selectIntake(db, id);
    if (intake === undefined) throw notFound(id);

    const stored = selectAnswers(db, id);
    const current = needsReconcile(intake, stored)
      ? reconcileWithin(db, intake, stored, now)
      : { intake, answers: stored.answers, discarded: [] };

    const node = findQuestion(current.answers, questionId);
    validateAnswer(node, answer, now);

    const { kept, dropped } = prune(QUESTION_TREE, {
      ...current.answers,
      [node.id]: answer,
    });

    upsertAnswer(db, { intakeId: id, questionId: node.id, answer, now: timestamp });
    deleteAnswers(
      db,
      id,
      dropped.map((entry) => entry.question),
    );

    const updated: StoredIntake = {
      ...current.intake,
      title: intakeTitle(toBrief(QUESTION_TREE, kept)),
      treeVersion: QUESTION_TREE.version,
      updatedAt: timestamp,
    };
    updateIntake(db, updated);

    return {
      intake: updated,
      answers: kept,
      discarded: [...current.discarded, ...asDiscarded(dropped)],
    };
  })();

  return toState(written);
}
