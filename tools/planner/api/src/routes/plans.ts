/**
 * The plan's HTTP surface: start a run, read the document, revise it, stop a run.
 *
 * Thin, like the intake's: parse the path, parse the body with the contract's
 * own schema, hand it to `runs/orchestrator.ts`, send what comes back. Every
 * failure is an `AppError` and leaves through the one handler in `server.ts`.
 *
 * **`POST /api/plans` answers immediately with a `Run`, not with a plan.** The
 * fan-out takes tens of seconds to minutes, which is why a run is a job at all —
 * so the response is the handle: the run to watch on SSE and the plan it is
 * drafting, which already exists and already reads, with no revisions on it yet.
 */

import {
  createPlanRequestSchema,
  AppError,
  pinItemRequestSchema,
  reviseRequestSchema,
  ROUTES,
  type CreatePlanRequest,
  type PinItemRequest,
  type PlanListResponse,
  type ReviseRequest,
} from "@planner/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { createRateLimitHook, enforceRateLimit } from "../rate-limit.ts";
import { cancelRun, listPlans, pinItem, readPlanView, startRun } from "../runs/orchestrator.ts";
import { revisePlan } from "../runs/revise.ts";

interface IdParams {
  id: string;
}

interface PinParams extends IdParams {
  itemId: string;
}

function parseBody(body: unknown): CreatePlanRequest {
  const parsed = createPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_ANSWER", "A plan is started from an intake, named by its id.");
  }
  return parsed.data;
}

function parsePin(body: unknown): PinItemRequest {
  const parsed = pinItemRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_ANSWER", "Pinning an item is told whether it is pinned or not.");
  }
  return parsed.data;
}

function parseRevise(body: unknown): ReviseRequest {
  const parsed = reviseRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "INVALID_ANSWER",
      "A revision names what it does — re-plan, move, remove, restore or change the dates or budget — and the version it builds on.",
    );
  }
  return parsed.data;
}

export function registerPlanRoutes(app: FastifyInstance, context: AppContext): void {
  // A run is a roster of model calls. Without this, one open endpoint is a
  // stranger spending the deployment's budget — the architecture files it under
  // the security posture rather than under cost for that reason.
  const limit = createRateLimitHook({
    limiter: context.runLimiter,
    logger: context.logger,
    scope: "plans",
  });

  app.post(ROUTES.plans, { onRequest: limit }, async (request, reply) => {
    const { intakeId } = parseBody(request.body);
    return await reply.code(202).send(startRun(context, intakeId));
  });

  // Not rate limited: it reads rows, where `POST` spends a roster of model
  // calls. The limiter above is a cost control, and metering a read would only
  // stop someone looking at their own plan.
  app.get(ROUTES.plans, async (_request, reply) => {
    return await reply.send({ plans: listPlans(context) } satisfies PlanListResponse);
  });

  app.get<{ Params: IdParams }>(ROUTES.plan, async (request, reply) => {
    return await reply.send(readPlanView(context, request.params.id));
  });

  app.post<{ Params: PinParams }>(ROUTES.planItemPin, async (request, reply) => {
    const { pinned } = parsePin(request.body);
    return await reply.send(
      pinItem(context, { planId: request.params.id, itemId: request.params.itemId, pinned }),
    );
  });

  // pl-44. Rate limited after the body is parsed rather than in an `onRequest`
  // hook, because the body's kind picks the bucket: a re-plan holds a queue
  // slot and spends a draft's allowance, with or without specialists; an edit
  // takes no slot and spends the edits bucket. Before any database read either
  // way, so a refused request stays cheap.
  app.post<{ Params: IdParams }>(ROUTES.planRevisions, async (request, reply) => {
    const revise = parseRevise(request.body);
    enforceRateLimit(
      request,
      reply,
      // A brief edit is a run too (pl-47), and spends what a re-plan spends.
      revise.kind === "replan" || revise.kind === "brief"
        ? { limiter: context.runLimiter, logger: context.logger, scope: "plans" }
        : { limiter: context.editLimiter, logger: context.logger, scope: "edits" },
    );

    // An edit's lookup takes this signal, so a client that goes away before the
    // answer stops the lookup and the edit writes nothing.
    const controller = new AbortController();
    const abandon = (): void => {
      if (!reply.raw.writableFinished) controller.abort(new AppError("CANCELED"));
    };
    reply.raw.once("close", abandon);
    try {
      const response = await revisePlan(context, {
        planId: request.params.id,
        request: revise,
        signal: controller.signal,
      });
      return await reply.code(response.kind === "run" ? 202 : 200).send(response);
    } finally {
      reply.raw.off("close", abandon);
    }
  });

  app.post<{ Params: IdParams }>(ROUTES.runCancel, async (request, reply) => {
    return await reply.send(cancelRun(context, request.params.id));
  });
}
