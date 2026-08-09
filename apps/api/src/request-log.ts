/**
 * Request ids, and the one log line per request that uses them.
 *
 * The id is what ties a user's complaint to the work it caused. A probe or a
 * job creation logs it alongside the job id it produced, and the orchestrator
 * carries both on every line it writes afterwards — so `requestId=…` finds the
 * HTTP call, and the `jobId` on that line finds everything the job did minutes
 * later on a different stack.
 *
 * An inbound `X-Request-Id` is honoured so a reverse proxy or a caller that
 * already has a trace id keeps it across the hop. It is echoed back on the
 * response either way, which is what makes "quote the id from the failed
 * request" a usable support instruction.
 */

import { randomUUID } from "node:crypto";
import { ROUTES } from "@downloader/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "./context.ts";
import type { AppLogger } from "./logger.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The app logger, bound to this request's id. Set by `registerRequestLogging`. */
    logger: AppLogger;
  }
}

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Caps length and character set before an inbound id reaches a log line.
 *
 * An id is echoed in a response header and written to logs, so an unbounded
 * client-controlled string is both a header-injection vector and a way to make
 * every log line arbitrarily large.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/u;

export function requestIdFrom(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate === "string" && SAFE_REQUEST_ID.test(candidate)) return candidate;
  return randomUUID();
}

/**
 * Endpoints logged at `debug` rather than `info`.
 *
 * A container health check runs every few seconds forever. At `info` it is the
 * majority of the log by volume within a day, which buries everything that
 * matters; it is still there at `debug` when someone is actually debugging a
 * probe that flaps.
 */
function isNoisy(request: FastifyRequest): boolean {
  return request.method === "GET" && request.url.startsWith(ROUTES.health);
}

export function registerRequestLogging(app: FastifyInstance, context: AppContext): void {
  // Declared up front so the hidden class is stable; Fastify warns otherwise.
  // The single-argument form is the only one that types cleanly for a
  // reference value, and the hook below fills it in before any route runs.
  app.decorateRequest("logger");

  app.addHook("onRequest", async (request, reply) => {
    request.logger = context.logger.child({ requestId: request.id });
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    // `elapsedTime` is measured from the moment Fastify saw the socket, so it
    // includes body parsing — which is the number a client actually waited.
    const fields = {
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ip: request.ip,
    };
    if (isNoisy(request)) request.logger.debug("request", fields);
    else request.logger.info("request", fields);
  });
}
