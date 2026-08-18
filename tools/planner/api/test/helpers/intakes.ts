/**
 * Driving the intake the way the wizard does: one reachable question at a time.
 *
 * Not a test file — vitest collects `*.test.ts` only. Everything here exists
 * because a suite that hand-builds a set of answers is asserting against its own
 * idea of the tree rather than against the tree.
 *
 * `saveIntake` at the bottom is the one thing here that does not drive the
 * wizard, and it says why.
 */

import type { Answer, Answers, AnswerValue, IntakeState, QuestionNode } from "@planner/contract";
import { intakeAnswerUrl, intakeUrl, ROUTES } from "@planner/contract";
import type { FastifyInstance } from "fastify";
import type { App } from "../../src/index.ts";

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

/**
 * An intake written straight to the store, under whatever tree version it
 * claims.
 *
 * Deliberately not `db/intakes.ts`. The rows these fixtures need are rows the
 * current code would refuse to write — an intake at an older `tree_version`, an
 * answer to a question the tree has since dropped, an answer outside the bound
 * its question carries today — and they are the only way to test what happens
 * when a saved intake is read back under a newer tree. Routing this through the
 * real writer would not tidy the fixtures; it would delete the test cases.
 *
 * What it will not let you write is a malformed one. `answers` is typed against
 * the contract, so a change to `Answer` fails at `npm run check` rather than
 * quietly writing a subtly wrong row for an assertion to agree with later.
 */
export function saveIntake(
  app: App,
  intake: { id: string; treeVersion: number; answers: Answers },
): string {
  const { db } = app.context;
  const at = NOW.toISOString();

  db.prepare(
    "INSERT INTO intakes (id, title, tree_version, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)",
  ).run(intake.id, intake.treeVersion, at, at);

  const write = db.prepare(
    "INSERT INTO answers (intake_id, question_id, value, answered_at) VALUES (?, ?, ?, ?)",
  );
  for (const [question, answer] of Object.entries(intake.answers)) {
    write.run(intake.id, question, JSON.stringify(answer), at);
  }

  return intake.id;
}
