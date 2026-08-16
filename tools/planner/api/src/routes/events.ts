/**
 * `GET /api/runs/:id/events` — Server-Sent Events.
 *
 * Emits the `RunEvent` union verbatim: one JSON object per `data:` line, no
 * second envelope, no renaming. The client validates each frame with the shared
 * `runEventSchema`, so any deviation here is a bug the client will correctly
 * discard.
 *
 * The downloader's `routes/events.ts` is the working implementation and the
 * three things it gets right are the three copied here:
 *
 *  - **Heartbeat every 15 s.** Proxies close idle connections, and a fan-out can
 *    legitimately produce no frames for a minute while the slowest specialist
 *    thinks.
 *  - **Clean teardown on disconnect.** The unsubscribe *and* the timer must both
 *    go, or a tab closed mid-run leaks a listener and a timer for the lifetime
 *    of the process.
 *  - **Terminal states end the stream.** A client should not have to decide when
 *    to stop listening to a run that finished.
 *
 * The fourth thing is this tool's: the current state goes out **immediately**,
 * as a `snapshot` carrying the whole `Run`. A client that connected after the
 * roster was decided must not be left staring at `queued`, and there is no
 * honest progress frame to replay for it — every `RunProgress` variant but
 * `roster` names a specialist, and naming one to carry a count would be a frame
 * this server made up.
 */

import {
  isTerminalRunEvent,
  latestRevision,
  ROUTES,
  TERMINAL_RUN_STATUSES,
} from "@planner/contract";
import type { AppErrorPayload, RunEvent } from "@planner/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { readPlan, readRun } from "../runs/orchestrator.ts";

export const HEARTBEAT_INTERVAL_MS = 15_000;

/** One SSE frame. The trailing blank line is what terminates an event. */
export function formatSseFrame(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const CANCELED: AppErrorPayload = {
  code: "JOB_CANCELED",
  message: "The planning session was canceled.",
  retryable: false,
};

const FAILED: AppErrorPayload = {
  code: "INTERNAL",
  message: "The run did not finish.",
  retryable: false,
};

export function registerRunEventRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { id: string } }>(ROUTES.runEvents, async (request, reply) => {
    const { id } = request.params;
    // Throws JOB_NOT_FOUND before any streaming headers are written, so the
    // client gets a normal JSON error rather than an empty event stream.
    const run = readRun(context, id);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which would hold every
      // frame until the run finished — precisely defeating the point.
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    const write = (event: RunEvent): void => {
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
    // Do not hold the event loop open on a heartbeat; the process should be able
    // to exit while an idle client is still attached.
    heartbeat.unref?.();

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    }

    const unsubscribe = context.events.subscribe(id, (event) => {
      write(event);
      if (isTerminalRunEvent(event)) {
        // Flush the terminal frame, then close: there is nothing more to say.
        cleanup();
        reply.raw.end();
      }
    });

    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);

    const at = context.now().toISOString();
    write({ type: "snapshot", runId: id, run, at });

    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      write(terminalFrame(context, id, run.planId, run.status, run.error, at));
      cleanup();
      reply.raw.end();
    }

    // Tells Fastify the reply is being managed by hand.
    return reply;
  });
}

/**
 * The frame that explains an already-finished run.
 *
 * The revision id is read back off the plan rather than re-derived from the run
 * id: "the latest one" is `latestRevision`'s to answer, and a second
 * implementation of it here would be right until the day a plan has two
 * revisions.
 */
function terminalFrame(
  context: AppContext,
  runId: string,
  planId: string,
  status: string,
  error: AppErrorPayload | null,
  at: string,
): RunEvent {
  if (status === "canceled") {
    return { type: "canceled", runId, error: error ?? CANCELED, at };
  }
  if (status === "failed") {
    return { type: "failed", runId, error: error ?? FAILED, at };
  }

  const revision = latestRevision(readPlan(context, planId));
  if (revision === null) {
    // `done` with no revision is not a state the orchestrator can produce — it
    // moves to `done` only after the revision is written. Reported as a failure
    // rather than papered over with an id nothing points at.
    return { type: "failed", runId, error: FAILED, at };
  }
  return { type: "done", runId, planId, revisionId: revision.id, at };
}
