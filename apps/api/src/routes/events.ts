/**
 * `GET /api/jobs/:id/events` — Server-Sent Events.
 *
 * Emits the `JobEvent` union verbatim: one JSON object per `data:` line, no
 * envelope, no renaming. The client validates each frame with the shared
 * `jobEventSchema`, so any deviation here is a bug the client will (correctly)
 * discard.
 *
 * Three things this has to get right:
 *
 *  - **Heartbeat every 15 s.** Proxies and load balancers close idle
 *    connections, and a download can legitimately produce no progress frames
 *    for minutes while ffmpeg buffers.
 *  - **Clean teardown on disconnect.** The unsubscribe *and* the heartbeat
 *    timer must both go, or a browser tab closed mid-download leaks a timer and
 *    a listener for the lifetime of the process.
 *  - **Terminal states end the stream.** A client should not have to decide
 *    when to stop listening to a job that finished.
 */

import { ROUTES } from "@downloader/shared";
import type { JobEvent } from "@downloader/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export const HEARTBEAT_INTERVAL_MS = 15_000;

/** One SSE frame. The trailing blank line is what terminates an event. */
export function formatSseFrame(event: JobEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function registerEventRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { id: string } }>(ROUTES.jobEvents(":id"), async (request, reply) => {
    const { id } = request.params;
    // Throws JOB_NOT_FOUND before any streaming headers are written, so the
    // client gets a normal JSON error rather than an empty event stream.
    const job = context.store.get(id);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which would hold every
      // frame until the download finished — precisely defeating the point.
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const write = (event: JobEvent): void => {
      if (closed) return;
      try {
        reply.raw.write(formatSseFrame(event));
      } catch {
        // The socket went away between our check and the write.
        cleanup();
      }
    };

    const heartbeat = setInterval(() => {
      write({ type: "heartbeat", at: context.now().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);
    // Do not hold the event loop open on a heartbeat; the process should be
    // able to exit while an idle client is still attached.
    heartbeat.unref?.();

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    }

    const unsubscribe = context.events.subscribe(id, (event) => {
      write(event);
      if (isTerminalEvent(event)) {
        // Flush the terminal frame, then close: there is nothing more to say.
        cleanup();
        reply.raw.end();
      }
    });

    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);

    // Sent immediately so a client that connected after the job already moved
    // on is not left staring at `queued` until the next real event.
    write({ type: "status", jobId: id, status: job.status, at: context.now().toISOString() });
    if (job.status === "completed" && job.result !== null) {
      write({ type: "completed", jobId: id, result: job.result, at: context.now().toISOString() });
      cleanup();
      reply.raw.end();
    } else if (job.status === "failed" && job.error !== null) {
      write({ type: "failed", jobId: id, error: job.error, at: context.now().toISOString() });
      cleanup();
      reply.raw.end();
    } else if (job.status === "canceled") {
      write({
        type: "canceled",
        jobId: id,
        error: job.error ?? {
          code: "JOB_CANCELED",
          message: "The download was canceled.",
          retryable: false,
        },
        at: context.now().toISOString(),
      });
      cleanup();
      reply.raw.end();
    }

    // Tells Fastify the reply is being managed by hand.
    return reply;
  });
}

function isTerminalEvent(event: JobEvent): boolean {
  return event.type === "completed" || event.type === "failed" || event.type === "canceled";
}
