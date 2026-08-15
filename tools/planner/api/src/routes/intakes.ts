/**
 * The intake's HTTP surface.
 *
 * Thin on purpose: parse the path, parse the body with the contract's own
 * schema, hand it to `intakes/state.ts`, send what comes back. Every failure —
 * an unknown intake, an answer that does not fit its question, a question this
 * intake never opened — is an `AppError` from the engine or the service, and it
 * leaves through the one error handler in `server.ts`. Nothing here catches and
 * re-words one: the engine's message is about *this* question, and a generic
 * replacement would be worse.
 */

import {
  answerSchema,
  ROUTES,
  type DiscardPreview,
  type IntakeListResponse,
} from "@planner/contract";
import { AppError } from "@planner/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import {
  createIntake,
  listIntakes,
  previewAnswer,
  readIntake,
  writeAnswer,
} from "../intakes/state.ts";

interface IntakeParams {
  id: string;
}

interface AnswerParams extends IntakeParams {
  questionId: string;
}

/**
 * The body of an answer request is the answer, and `answerSchema` is the
 * boundary where `unknown` becomes a typed one.
 *
 * A body that does not parse is `INVALID_ANSWER` rather than a bare 400: it is
 * the same failure as an answer that does not fit its question, one step
 * earlier, and the wizard handles it the same way.
 */
function parseAnswer(body: unknown, questionId: string): ReturnType<typeof answerSchema.parse> {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_ANSWER", "That answer is not the shape an answer takes.", {
      details: { question: questionId },
    });
  }
  return parsed.data;
}

export function registerIntakeRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(ROUTES.intakes, async (_request, reply) => {
    return await reply.code(201).send(createIntake(context));
  });

  app.get(ROUTES.intakes, async (_request, reply) => {
    const body: IntakeListResponse = { intakes: listIntakes(context) };
    return await reply.send(body);
  });

  app.get<{ Params: IntakeParams }>(ROUTES.intake, async (request, reply) => {
    return await reply.send(readIntake(context, request.params.id));
  });

  app.post<{ Params: AnswerParams }>(ROUTES.intakeAnswer, async (request, reply) => {
    const { id, questionId } = request.params;
    const answer = parseAnswer(request.body, questionId);
    return await reply.send(writeAnswer(context, id, questionId, answer));
  });

  app.post<{ Params: AnswerParams }>(ROUTES.intakeAnswerPreview, async (request, reply) => {
    const { id, questionId } = request.params;
    const answer = parseAnswer(request.body, questionId);
    const body: DiscardPreview = { discarded: previewAnswer(context, id, questionId, answer) };
    return await reply.send(body);
  });
}
