/**
 * `GET /api/probe/:id/events` — Server-Sent Events for one analysis (dl-43).
 *
 * `routes/events.ts` is the model, and the three things it has to get right —
 * heartbeat, clean teardown, terminal frame ends the stream — hold here
 * unchanged. Two things differ, and both follow from a probe having no job:
 *
 *  - **No existence check.** A job id is a row in a store, so its stream can
 *    404. A probe id is minted by the client and the channel it names may not
 *    exist yet: this endpoint is opened *before* the POST that starts the
 *    probe, on purpose, so that the first stages are not emitted into an empty
 *    room. Subscribing is therefore what creates the channel. The refusal that
 *    remains is the hub's cap, which is a 503 rather than a 404.
 *  - **A hard lifetime.** Nothing else would ever reclaim this stream. The hub
 *    expires the channel on its own schedule; this closes the socket on the
 *    same one, so a client that never POSTs is not held forever.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { ProbeEvent } from "@downloader/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { CHANNEL_TTL_MS } from "../probe-stages.ts";

export const PROBE_HEARTBEAT_INTERVAL_MS = 15_000;

/** One SSE frame. The trailing blank line is what terminates an event. */
export function formatProbeSseFrame(event: ProbeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function registerProbeEventRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Params: { id: string } }>(ROUTES.probeEvents(":id"), async (request, reply) => {
    const { id } = request.params;

    let closed = false;
    let streaming = false;
    let unsubscribe: (() => void) | undefined;
    /**
     * Frames that arrived before the headers went out.
     *
     * `subscribe` replays the hub's buffer synchronously, from inside the call
     * below — and that call has to happen before `writeHead`, or a refusal
     * could not be a JSON error. Writing to `reply.raw` first would make Node
     * emit its own default headers, and the stream would be a `text/plain` 200
     * that no `EventSource` accepts.
     */
    const queued: ProbeEvent[] = [];

    const write = (event: ProbeEvent): void => {
      if (closed) return;
      if (!streaming) {
        queued.push(event);
        return;
      }
      try {
        reply.raw.write(formatProbeSseFrame(event));
      } catch {
        // The socket went away between our check and our write.
        cleanup();
      }
    };

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      unsubscribe?.();
    }

    const heartbeat = setInterval(() => {
      write({ type: "heartbeat", at: context.now().toISOString() });
    }, PROBE_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    const lifetime = setTimeout(() => {
      cleanup();
      reply.raw.end();
    }, CHANNEL_TTL_MS);
    lifetime.unref?.();

    let finished = false;
    // Before any streaming header is written, so a refusal is a normal JSON
    // error rather than an event stream that says nothing.
    const subscription = context.probeStages.subscribe(id, (event) => {
      write(event);
      if (event.type !== "done") return;
      finished = true;
      if (!streaming) return;
      cleanup();
      reply.raw.end();
    });
    if (subscription === null) {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      throw new AppError(
        "RATE_LIMITED",
        "The server is narrating as many analyses as it can at once.",
        { details: { scope: "probe-stages" } },
      );
    }
    unsubscribe = subscription;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which would hold every
      // frame until the probe finished — precisely defeating the point.
      "X-Accel-Buffering": "no",
    });

    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);

    streaming = true;
    const replay = queued.splice(0, queued.length);
    for (const event of replay) write(event);
    if (finished) {
      cleanup();
      reply.raw.end();
    }

    // Tells Fastify the reply is being managed by hand.
    return reply;
  });
}
