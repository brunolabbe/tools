/**
 * Driving the intake the way the wizard does: one reachable question at a time.
 *
 * Not a test file — vitest collects `*.test.ts` only. Everything here exists
 * because a suite that hand-builds a set of answers is asserting against its own
 * idea of the tree rather than against the tree.
 */

import type { Answer, AnswerValue, IntakeState, QuestionNode } from "@planner/contract";
import { intakeAnswerUrl, intakeUrl, ROUTES } from "@planner/contract";
import type { FastifyInstance } from "fastify";

/** Fixed, so anything the engine decides from the calendar is assertable. */
export const NOW = new Date("2026-08-15T12:00:00.000Z");

export function answered(value: AnswerValue): Answer {
  return { state: "answered", value };
}

/**
 * An answer this question would accept — the first choice, the smallest number,
 * a word of text. Deliberately boring: these suites assert about which questions
 * get asked and which answers survive, not about what was said.
 */
export function answerFor(node: QuestionNode): Answer {
  switch (node.kind) {
    case "single-choice":
      return answered({ kind: "single-choice", value: node.choices[0]?.value ?? "" });
    case "multi-choice":
      return answered({ kind: "multi-choice", values: [node.choices[0]?.value ?? ""] });
    case "text":
      return answered({ kind: "text", value: "somewhere" });
    case "text-list":
      return answered({ kind: "text-list", values: ["somewhere"] });
    case "number":
      return answered({ kind: "number", value: node.min });
    case "number-list":
      return answered({ kind: "number-list", values: [node.min] });
    case "dates":
      return answered({ kind: "dates", value: { kind: "open", nights: 5 } });
    case "budget":
      return answered({ kind: "budget", value: { kind: "band", band: "moderate" } });
  }
}

export async function startIntake(server: FastifyInstance): Promise<IntakeState> {
  const response = await server.inject({ method: "POST", url: ROUTES.intakes });
  return response.json<IntakeState>();
}

export async function readIntake(server: FastifyInstance, id: string): Promise<IntakeState> {
  const response = await server.inject({ method: "GET", url: intakeUrl(id) });
  return response.json<IntakeState>();
}

export async function postAnswer(
  server: FastifyInstance,
  id: string,
  questionId: string,
  answer: Answer,
  options: { preview?: boolean } = {},
): Promise<{ statusCode: number; body: unknown }> {
  const response = await server.inject({
    method: "POST",
    url: intakeAnswerUrl(id, questionId, options),
    payload: answer,
  });
  return { statusCode: response.statusCode, body: response.json<unknown>() };
}

/**
 * Answer until the wizard says the essentials are done, taking whichever
 * question the server offers next.
 *
 * `preset` replaces the generated answer for a question by id — how a suite says
 * "a backcountry trip" without knowing where in the tree that question sits.
 */
export async function answerThroughCore(
  server: FastifyInstance,
  id: string,
  preset: Record<string, Answer> = {},
): Promise<IntakeState> {
  let state = await readIntake(server, id);

  // One question per turn, and the reachable set is finite: the bound is the
  // number of questions this intake could possibly open.
  for (let turn = 0; turn < 64 && !state.progress.coreComplete; turn += 1) {
    const question = state.progress.question;
    if (question === null) break;
    const result = await postAnswer(
      server,
      id,
      question.id,
      preset[question.id] ?? answerFor(question),
    );
    state = result.body as IntakeState;
  }

  return state;
}
