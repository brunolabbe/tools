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
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
 * Routes whose path after the prefix is a **credential rather than an identifier**.
 *
 * Two qualify: the file token and the thumbnail token (dl-75). It was one until
 * dl-75, which asked whether the thumbnail token counts and was answered yes on
 * 2026-10-04. `jobs/tokens.ts` states the rule this reads off: a file token
 * *is* the authorisation, there is no session and no owner check behind it, and
 * a job id deliberately is not a secret because it already appears in URLs the
 * client holds and in every orchestrator line. A thumbnail token meets the same
 * test, since it alone authorises the image, and what it buys is small (one
 * preview, up to `MAX_THUMBNAIL_BYTES`, for ten minutes) but not nothing. So a
 * job id stays legible in the log and neither token does.
 *
 * Taken from `ROUTES` rather than written out, so a route that moves takes its
 * redaction with it.
 */
const CAPABILITY_ROUTES: ReadonlyArray<{ prefix: string; segments: readonly string[] }> = [
  ROUTES.file(""),
  ROUTES.thumbnail(""),
].map((prefix) => ({ prefix, segments: prefix.split("/").filter((s) => s !== "") }));

/**
 * How many times a percent escape is undone before a path is read.
 *
 * Fastify decodes once, so a second layer is what a proxy that re-encodes would
 * add, and a third is margin. Each pass is a linear scan, and a request line is
 * capped by Node's header limit, so a larger bound would only be an amplifier
 * for whoever sends `%25%25%25…`. A spelling needing more passes than this is
 * one no router in front of this service would resolve to a route either.
 */
const MAX_DECODE_PASSES = 3;

/**
 * Undoes percent escapes without ever throwing, which `decodeURIComponent`
 * does on a malformed one — and a log line must not cost the request.
 * Byte-wise, because only ASCII (`/`, `\`, letters, `.`) decides a match.
 */
function decodeEscapes(path: string): string {
  let current = path;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = current.replace(/%([0-9a-f]{2})/giu, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * The canonical prefix of the capability route this path *could* be spelling,
 * or `undefined` when it is not one.
 *
 * Fastify's router matches after normalising, so the raw `request.url` of a
 * request that reached a handler need not start with the route: `/api/%74humbnail/<t>`
 * served the image, and `/api/%66iles/<t>` reached the file handler (dl-76).
 * Other spellings miss every route and 404 with the token still in the line.
 * So this reads the path the way a normaliser would, and **asks the question at
 * every step rather than at the end**: percent escapes undone, `\` as `/`, empty
 * and `.` segments dropped, `..` popping, case folded, and anything from a `;`
 * (a path parameter) or a decoded `?` / `#` on a segment ignored. The first time
 * the segments so far end in a capability prefix, that is the answer — checked as
 * it goes, because `/api/files/<t>/../..` resolves to `/api` and a check at the end
 * would find nothing while the token sat in the line.
 *
 * It looks for the prefix **anywhere**, not only at the root, because an
 * absolute-form request target (`http://host/api/files/<t>`) is logged whole
 * and is served. That over-redacts a path like `/x/api/files/y`. With the UI
 * served (`webDir` set) the SPA fallback answers that path with `index.html`
 * and a 200, so `GET /docs/api/files/readme` is logged as
 * `/api/files/[redacted]` 200 and cannot be told apart from a download; and
 * `GET /api/files` with nothing after the prefix is logged as redacted though no
 * token was presented. That conflation is accepted: no credential is at stake,
 * and the other direction costs one.
 */
function capabilityPrefixOf(path: string): string | undefined {
  const stack: string[] = [];
  for (const raw of decodeEscapes(path).split(/[/\\]/u)) {
    const name = (raw.split(/[;?#]/u, 1)[0] ?? "").toLowerCase();
    if (name === "" || name === ".") continue;
    if (name === "..") {
      stack.pop();
      continue;
    }
    stack.push(name);
    for (const route of CAPABILITY_ROUTES) {
      const start = stack.length - route.segments.length;
      if (start >= 0 && route.segments.every((segment, i) => stack[start + i] === segment)) {
        return route.prefix;
      }
    }
  }
  return undefined;
}

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
 * So: a path that is, however spelled, a capability route's is logged as that
 * route's canonical prefix plus `[redacted]`, **the whole of its path after the
 * prefix** (not one segment: `/api/files//<t>` holds the token in its second) —
 * and its query string, which is not the credential, as it arrived. Everything
 * else — job ids, the health path, any other URL — is left exactly as it
 * arrived, because that is the diagnostic value the request log exists for.
 *
 * What a non-canonical spelling costs the reader is the spelling itself: the
 * line says `/api/files/[redacted]` with a 404 beside it, not which odd shape
 * the caller chose. That is the price of not having to enumerate them.
 */
export function redactLoggedUrl(url: string): string {
  // Split on the raw delimiters, as the router does, so a `%3F` stays in the path.
  const boundary = url.search(/[?#]/u);
  const path = boundary === -1 ? url : url.slice(0, boundary);
  const prefix = capabilityPrefixOf(path);
  if (prefix === undefined) return url;
  return `${prefix}${REDACTED}${boundary === -1 ? "" : url.slice(boundary)}`;
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

/**
 * The form of a *refused* request's URL that is safe to log: `redactLoggedUrl`'s
 * answer when it finds a capability prefix, and otherwise the path **cut at the
 * first percent escape that does not decode**, with the query dropped. A refused
 * path with no such escape (every 414 off a capability route) is returned whole,
 * query included, as `redactLoggedUrl` leaves any non-capability URL.
 *
 * The cut is for a path like `/api/files%zz/<t>`, `/api/fi%les/<t>` or
 * `/api/%zz/files/<t>`: the malformed escape sits in or before the route, so
 * `redactLoggedUrl` cannot read the path as a capability route's and would log the
 * token whole. Before dl-84 such a request wrote no line, so logging it as it
 * arrived would have been a new leak (owner decision 2026-10-07; dl-76 names the
 * served-request analogue, a spelling no normaliser turns into the route, and
 * leaves it). Whatever follows the first bad escape is dropped because it is
 * exactly the part that cannot be read. Cutting at the *run* of escapes that
 * fails, not the single byte, errs towards logging less.
 *
 * Only the refusal path calls this: a served request's line is unchanged.
 */
function redactRefusedUrl(url: string): string {
  const redacted = redactLoggedUrl(url);
  if (redacted !== url) return redacted;
  const boundary = url.search(/[?#]/u);
  const path = boundary === -1 ? url : url.slice(0, boundary);
  // A `%` not followed by two hex digits, or a run of escapes that is not UTF-8.
  for (const match of path.matchAll(/%(?![0-9a-f]{2})|(?:%[0-9a-f]{2})+/giu)) {
    if (match[0] === "%" || !decodes(match[0])) {
      return `${path.slice(0, match.index)}[truncated]`;
    }
  }
  return url;
}

function decodes(escapes: string): boolean {
  try {
    decodeURIComponent(escapes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fastify's `frameworkErrors` handler: the line for a request its router refuses
 * **before any hook runs**, which `registerRequestLogging`'s hooks never see
 * (dl-84). A percent escape it cannot decode (`%zz`, a lone `%`, a truncated or
 * overlong sequence) is `FST_ERR_BAD_URL`, 400; a path parameter past
 * `maxParamLength` is `FST_ERR_MAX_PARAM_LENGTH`, 414 — but only with no UI served:
 * with `webDir` set (the image's configuration) the over-long parameter reaches the
 * not-found handler as a 404 through the normal path and was logged all along.
 * Without this the service answered the 400s and wrote nothing, so a scan or a
 * client building broken links was invisible.
 *
 * One `request` line, named and shaped like an ordinary request so the query that
 * finds requests finds these, **at `info`** like every other request that is not a
 * health check: a scanner already costs one `info` line per probe through the 404
 * path, so this adds no new volume class, and `code` is what tells the two apart.
 * It carries `url` through `redactRefusedUrl` and never the error's `message`,
 * which Fastify builds by quoting the raw path, token and all. It has **no
 * `durationMs`**: Fastify records no start time for a refused request (its
 * `elapsedTime` reads 0), and a constant would read as a measurement.
 *
 * **The response is rewritten byte for byte** from what Fastify writes itself
 * when this option is unset, because setting the option hands the whole answer to
 * this function. It goes out on `reply.raw`, as Fastify's default does, so no
 * hook runs for it and no second line is written by `onResponse`.
 */
export function createFrameworkErrorHandler(context: AppContext) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    // The refused request has had no `onRequest`, so no bound child logger yet.
    context.logger.child({ requestId: request.id }).info("request", {
      method: request.method,
      url: redactRefusedUrl(request.url),
      status: error.statusCode ?? 500,
      ip: request.ip,
      code: error.code,
    });

    const status = error.statusCode ?? 500;
    // Fastify's own text, including its "Bad Request" for the 414 as well, so
    // that nothing a client could read changes when this line began to be written.
    const body = JSON.stringify(
      status === 500
        ? {
            error: "Internal Server Error",
            message: "Unexpected error from async constraint",
            statusCode: 500,
          }
        : { error: "Bad Request", code: error.code, message: error.message, statusCode: status },
    );
    reply.raw.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    reply.raw.end(body);
  };
}
