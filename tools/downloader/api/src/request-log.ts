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
import { REDACTED, ROUTES } from "@downloader/contract";
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
 * Path prefixes whose next segment is a **credential rather than an identifier**.
 *
 * Exactly one qualifies. `jobs/tokens.ts` states the rule this reads off: the
 * file token *is* the authorisation, there is no session and no owner check
 * behind it, and a job id deliberately is not a secret because it already
 * appears in URLs the client holds and in every orchestrator line. So a job id
 * stays legible in the log and a file token does not.
 *
 * Taken from `ROUTES` rather than written out, so a route that moves takes its
 * redaction with it.
 */
const CAPABILITY_PREFIXES: readonly string[] = [ROUTES.file("")];

/**
 * The form of a request URL that is safe to log.
 *
 * **Not `redactUrl`**, though that is the repo-wide instrument and the obvious
 * reach. `redactUrl` answers a different question: it parses an *absolute* URL
 * and drops its *query string*, because the credential it was written for is a
 * signed URL's HMAC. Both halves are wrong here. A Fastify `request.url` is
 * origin-relative, so `new URL` throws and every line would read
 * `[unparsable-url]`; and this credential lives in the path, which `redactUrl`
 * preserves verbatim. Reaching for it would have replaced a leak with a blind
 * request log and still leaked.
 *
 * So: one segment, named by the contract, replaced. Everything else — query
 * strings, job ids, the health path — is left exactly as it arrived, because
 * that is the diagnostic value the request log exists for.
 */
export function redactLoggedUrl(url: string): string {
  for (const prefix of CAPABILITY_PREFIXES) {
    if (!url.startsWith(prefix)) continue;
    const rest = url.slice(prefix.length);
    const boundary = rest.search(/[/?#]/u);
    return `${prefix}${REDACTED}${boundary === -1 ? "" : rest.slice(boundary)}`;
  }
  return url;
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
      url: redactLoggedUrl(request.url),
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ip: request.ip,
    };
    if (isNoisy(request)) request.logger.debug("request", fields);
    else request.logger.info("request", fields);
  });
}
