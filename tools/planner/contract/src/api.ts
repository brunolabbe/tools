/**
 * HTTP API contract.
 *
 * The API app validates requests with these schemas; the web app derives its
 * client types from the same file. Neither side hand-writes a duplicate shape.
 *
 * Every schema is written `satisfies z.ZodType<T>` against the interface it
 * mirrors, so a field added to a type without a matching field here is a
 * compile error rather than a silent validation hole.
 */

import { z } from "zod";
import type { TripBrief } from "./brief.ts";
import { ERROR_CODES } from "./errors.ts";
import type { AppErrorPayload } from "./errors.ts";
import type { Answers, QuestionId, QuestionNode } from "./tree.ts";

/** One prefix, named once, so the UI and the dev proxy cannot disagree about it. */
export const API_PREFIX = "/api";

/**
 * Every path this API answers on, as **Fastify patterns**: `:id` is a parameter
 * and not a literal.
 *
 * The server registers these strings directly and the client fills them in with
 * the helpers below, so a path exists once. A client that built its own URL from
 * a template literal is how a route moves and only one side finds out.
 */
export const ROUTES = {
  health: `${API_PREFIX}/health`,
  /** `POST` to start an intake, `GET` for the list. */
  intakes: `${API_PREFIX}/intakes`,
  intake: `${API_PREFIX}/intakes/:id`,
  /** `POST` one answer. The whole write, and the whole invalidation, is here. */
  intakeAnswer: `${API_PREFIX}/intakes/:id/answers/:questionId`,
  /** The same transaction as a dry run: what it would discard, written nowhere. */
  intakeAnswerPreview: `${API_PREFIX}/intakes/:id/answers/:questionId/preview`,
} as const;

export function intakeUrl(id: string): string {
  return ROUTES.intake.replace(":id", encodeURIComponent(id));
}

export function intakeAnswerUrl(
  id: string,
  questionId: QuestionId,
  options: { preview?: boolean } = {},
): string {
  const pattern = options.preview === true ? ROUTES.intakeAnswerPreview : ROUTES.intakeAnswer;
  return pattern
    .replace(":id", encodeURIComponent(id))
    .replace(":questionId", encodeURIComponent(questionId));
}

// ---------------------------------------------------------------------------
// The intake
// ---------------------------------------------------------------------------

/**
 * What a request body carries when it answers a question: nothing but the
 * answer, parsed with `answerSchema` from `tree.ts`.
 *
 * There is deliberately **no response schema** below to match the request ones
 * above. A response carries `QuestionNode`s, and a zod mirror of a node would be
 * a second definition of the tree's own types — the same argument that keeps
 * `conditionSchema` out of `tree.ts`. Questions are authored here and only ever
 * travel outward; nothing untrusted arrives in that shape, so the types below
 * are types, and the one thing that does arrive over a wire has a schema.
 */

/**
 * An answer that no longer answers anything, named the way a user can read it.
 *
 * `@planner/intake`'s `prune` returns the whole node; this is what survives the
 * wire, because the UI needs the prompt and nothing else. **Never render the
 * id** — "road-trip.drive-hours" is not a sentence anyone said.
 */
export interface DiscardedAnswer {
  question: QuestionId;
  /**
   * Null when the tree no longer has that question at all — a saved intake
   * meeting a newer tree. The UI has no prompt to name it by and should say
   * "some earlier answers no longer apply" rather than print an id.
   */
  prompt: string | null;
}

/** One row of the list: enough to recognise an intake and come back to it. */
export interface IntakeSummary {
  id: string;
  /**
   * Drawn from the answers — the destination once there is one, the shape and
   * the dates before that. Null until the first answer lands.
   */
  title: string | null;
  /** The tree this intake's answers were last reconciled against. */
  treeVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Where the wizard is. Mirrors `IntakeProgress` in `@planner/intake`. */
export interface IntakeProgressView {
  /** The next unanswered reachable question. Null means the tree is done. */
  question: QuestionNode | null;
  /**
   * True when nothing reachable and `core` is unanswered. True *with* a
   * `question` still to ask is the checkpoint: the essentials are done and
   * refining is open.
   */
  coreComplete: boolean;
}

/**
 * Everything the wizard renders, computed server-side on every write.
 *
 * The client mirrors this seam and evaluates no condition of its own: which
 * questions are open, what to ask next, whether the essentials are done and what
 * an edit discarded are all decided where the tree lives.
 */
export interface IntakeState {
  intake: IntakeSummary;
  /** Which questions these answers open, in asking order — answered ones included. */
  questions: readonly QuestionNode[];
  answers: Answers;
  progress: IntakeProgressView;
  /** The brief as it stands, so a user can see what the tool heard. */
  brief: TripBrief;
  /**
   * What **this** request discarded, already written off. Empty on a plain read
   * of an intake whose tree has not moved.
   */
  discarded: readonly DiscardedAnswer[];
}

export interface IntakeListResponse {
  intakes: readonly IntakeSummary[];
}

/**
 * What writing an answer *would* discard. Nothing is written.
 *
 * It comes from the same `prune` the write runs, so the warning and the write
 * cannot disagree — recomputing it in the browser is the second implementation
 * this route exists to prevent.
 */
export interface DiscardPreview {
  discarded: readonly DiscardedAnswer[];
}

export const errorPayloadSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<AppErrorPayload>;

/** What every failed request returns, whatever its status. */
export interface ErrorResponse {
  error: AppErrorPayload;
}
