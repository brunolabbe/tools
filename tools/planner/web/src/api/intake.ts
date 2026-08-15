/**
 * The intake, over HTTP.
 *
 * Every function here returns what the server computed and nothing this file
 * worked out for itself. No condition is evaluated in the browser: which
 * questions are open, what to ask next, whether the essentials are done and what
 * an edit discards all come back in the response, because the tree lives on the
 * other side and a second implementation of it here would drift from the first.
 */

import {
  intakeAnswerUrl,
  intakeUrl,
  ROUTES,
  type Answer,
  type DiscardedAnswer,
  type DiscardPreview,
  type IntakeListResponse,
  type IntakeState,
  type IntakeSummary,
  type QuestionId,
} from "@planner/contract";
import { requestJson } from "./client.ts";

export async function startIntake(): Promise<IntakeState> {
  return await requestJson<IntakeState>(ROUTES.intakes, { method: "POST" });
}

export async function fetchIntake(id: string, signal?: AbortSignal): Promise<IntakeState> {
  return await requestJson<IntakeState>(intakeUrl(id), { signal });
}

export async function fetchIntakes(signal?: AbortSignal): Promise<readonly IntakeSummary[]> {
  const body = await requestJson<IntakeListResponse>(ROUTES.intakes, { signal });
  return body.intakes;
}

export async function submitAnswer(
  id: string,
  question: QuestionId,
  answer: Answer,
): Promise<IntakeState> {
  return await requestJson<IntakeState>(intakeAnswerUrl(id, question), {
    method: "POST",
    body: answer,
  });
}

/**
 * What this answer would discard, before anything is written.
 *
 * The list comes from the same `prune` the write runs. Working it out here
 * instead is the one thing this client must never do — the warning and the write
 * would then be two implementations, and the day they disagree is the day
 * someone loses eight answers they were told they would keep.
 */
export async function previewAnswer(
  id: string,
  question: QuestionId,
  answer: Answer,
): Promise<readonly DiscardedAnswer[]> {
  const body = await requestJson<DiscardPreview>(intakeAnswerUrl(id, question, { preview: true }), {
    method: "POST",
    body: answer,
  });
  return body.discarded;
}
