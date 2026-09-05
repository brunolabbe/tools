/**
 * Job CRUD: create, read, cancel.
 *
 * There is no list. `GET /api/jobs` was removed by
 * [dl-32](../../../docs/work/dl-32-the-job-list-has-no-caller.md): it answered
 * any caller who could reach the port with every job in the store, and this
 * service has no session, no user and no notion of a caller to scope it by.
 * Nothing in the UI ever called it, so the exposure is closed by deletion rather
 * than by an ownership model the tool does not have. Reading one job still works,
 * because reaching it costs an attacker a `randomUUID()` job id they do not have
 * — and that id already buys the download, so the history behind it is not a
 * further step. Restoring a list means deciding who may read one first.
 *
 * Creating a job does **not** resolve anything. It writes a `queued` row and
 * hands the id back immediately, because resolution takes 10–20 s and a client
 * blocked on an HTTP request for that long looks hung. All the work happens in
 * the queue, and the client watches it over SSE.
 */

import { randomUUID } from "node:crypto";
import { AppError, createJobRequestSchema, ROUTES } from "@downloader/contract";
import type { Job, JobResponse } from "@downloader/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { createRateLimitHook } from "../rate-limit.ts";

export function registerJobRoutes(app: FastifyInstance, context: AppContext): void {
  // Only on creation. Reading and cancelling are cheap, and rate limiting a
  // cancel would leave a client unable to stop the very work that spent its
  // allowance.
  const rateLimit = createRateLimitHook({
    limiter: context.rateLimits.jobs,
    logger: context.logger,
    scope: "jobs",
  });

  app.post(ROUTES.jobs, { onRequest: rateLimit }, async (request, reply) => {
    if (context.isShuttingDown()) {
      throw new AppError("INTERNAL", "The server is shutting down and is not accepting new jobs.");
    }

    const parsed = createJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError("INVALID_URL", undefined, {
        details: { issues: parsed.error.issues.slice(0, 3) },
      });
    }

    // Checked at intake so a blocked address is refused synchronously with a
    // clear error, rather than becoming a job that fails 20 seconds later. The
    // orchestrator checks again before probing, because DNS can change in
    // between and the row may sit in the queue for a while.
    await context.guard.assertAllowed(parsed.data.url);

    const options = parsed.data.options ?? {};
    const job = context.store.create({
      id: randomUUID(),
      sourceUrl: parsed.data.url,
      options,
      variantId: options.variantId ?? null,
      createdAt: context.now().toISOString(),
    });

    context.queue.enqueue({
      jobId: job.id,
      run: (signal) => context.orchestrator.run(job.id, signal, { requestId: request.id }),
    });

    request.logger.info("job accepted", { jobId: job.id, variantId: job.variantId });
    const body: JobResponse = { job };
    return await reply.code(201).send(body);
  });

  // No `app.get(ROUTES.jobs, …)`: see the note at the top of this file. A GET
  // here falls through to the not-found handler and answers `NOT_FOUND`, which
  // is the truth — the path matches no route.
  app.get<{ Params: { id: string } }>(ROUTES.job(":id"), async (request, reply) => {
    const body: JobResponse = { job: context.store.get(request.params.id) };
    return await reply.send(body);
  });

  app.post<{ Params: { id: string } }>(ROUTES.cancelJob(":id"), async (request, reply) => {
    const { id } = request.params;
    // `get` throws JOB_NOT_FOUND, which is the right answer for an unknown id.
    const job = context.store.get(id);

    if (isTerminal(job)) {
      // Idempotent: cancelling a finished job is not an error, it is a client
      // that raced the last event. Report the job as it stands.
      const body: JobResponse = { job };
      return await reply.send(body);
    }

    const stopped = context.queue.cancel(id);
    if (!stopped) {
      // In the store as non-terminal but not in the queue: the process
      // restarted while it was running, so nothing is actually working on it.
      // Mark it canceled here rather than leaving a permanent zombie.
      const reason = new AppError("JOB_CANCELED").toPayload();
      context.store.transition(id, "canceled", { error: reason }, context.now().toISOString());
      context.events.status(id, "canceled");
      context.events.canceled(id, reason);
      await context.engine.removeJob(id).catch(() => undefined);
    }

    // The orchestrator writes the terminal state when the abort unwinds, so the
    // job returned here may still show its previous status. That is honest:
    // the SSE stream carries the transition when it happens.
    const body: JobResponse = { job: context.store.get(id) };
    return await reply.send(body);
  });
}

function isTerminal(job: Job): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "canceled";
}
