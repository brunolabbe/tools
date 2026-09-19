/**
 * `ErrorCode` → HTTP status, in one table.
 *
 * Every route funnels failures through here so a client sees one consistent
 * mapping. The rule of thumb: 4xx when the client or the source they named is
 * the problem, 5xx only when this service is. A DRM-protected video is not a
 * server error, and a client that retried it forever because we said 500 would
 * be right to.
 */

import { AppError, DEFAULT_ERROR_MESSAGES } from "@downloader/contract";
import type { AppErrorPayload, ErrorCode, ErrorResponse } from "@downloader/contract";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  BLOCKED_TARGET: 403,
  // The *source* was unreachable, not us. 502 says "the upstream failed",
  // which is exactly what happened.
  UNREACHABLE: 502,
  // Also the upstream's problem, and also not ours — but distinct from a dead
  // link on purpose, because the answer to it is "do not trust this", not
  // "try again".
  TLS_VERIFICATION_FAILED: 502,

  NO_MEDIA_FOUND: 422,
  // 451 is the one status that means precisely this.
  DRM_PROTECTED: 451,
  AUTH_REQUIRED: 422,
  AGE_CONFIRMATION_REQUIRED: 422,
  GEO_BLOCKED: 451,
  BOT_CHALLENGE: 422,
  LIVE_STREAM_UNSUPPORTED: 422,

  VARIANT_GONE: 410,
  DOWNLOAD_FAILED: 502,
  MUX_FAILED: 500,
  SIZE_LIMIT_EXCEEDED: 413,
  DISK_FULL: 507,

  TIMEOUT: 504,
  RATE_LIMITED: 429,
  JOB_NOT_FOUND: 404,
  // A document that expired out of an in-memory store, which is an ordinary
  // outcome rather than a fault — 404, never a 500.
  THUMBNAIL_NOT_FOUND: 404,
  // The route, not the document. Raised by `registerNotFoundHandler` for any
  // URL that matches no route.
  NOT_FOUND: 404,
  JOB_CANCELED: 409,
  CANCELED: 409,
  FILE_EXPIRED: 410,
  INTERNAL: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * Strips anything that should not cross the wire.
 *
 * `AppError.details` is for logs. It legitimately holds internal paths, stderr
 * tails and resolver diagnostics, and `AppErrorPayload.details` is documented
 * as "not rendered verbatim in the UI" — so only an allowlist of scalar fields
 * a client can act on survives.
 */
const CLIENT_SAFE_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "status",
  "retryAfterSec",
  "variantId",
  "resolver",
  "systems",
  "limitBytes",
  "estimatedBytes",
  "expiresAt",
]);

function publicDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!CLIENT_SAFE_DETAIL_KEYS.has(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The wire form of a failure.
 *
 * `message` falls back to the taxonomy's default copy rather than an internal
 * one: an `AppError` raised deep in ffmpeg may carry a message that names a
 * path, and the default is always safe to show.
 */
export function toPublicPayload(error: AppError, { safeMessage = false } = {}): AppErrorPayload {
  const details = publicDetails(error.details);
  return {
    code: error.code,
    message: safeMessage ? DEFAULT_ERROR_MESSAGES[error.code] : error.message,
    retryable: error.retryable,
    ...(details === undefined ? {} : { details }),
  };
}

/**
 * Any error that is not one of ours but still carries a 4xx `statusCode` —
 * Fastify's own content-type parser (empty JSON, malformed JSON, an
 * unsupported media type, a body over the configured cap) never reaches a
 * route handler, so it can never be an `AppError`, and it is not the only
 * source: `@fastify/static` raises its own 412 (precondition failed) and 416
 * (range not satisfiable) the same way. **Measured, not assumed** (dl-66):
 * every one of those cases, plus a bad `content-length` and a `__proto__`
 * payload, was confirmed to reach here rather than a route. The rule is
 * deliberately this wide rather than enumerating `FST_ERR_CTP_*` codes one by
 * one — decision recorded in this ticket's `## The width decision` — because
 * the diagnosis "the request itself could not be understood, and it is not
 * this service's fault" holds for all of them, even where a more specific
 * status (413, 415, 412, 416) is thrown away in favour of the generic 400.
 */
function isClientRequestStatusError(error: unknown): boolean {
  if (error instanceof AppError) return false;
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

/**
 * The one place that decides what `AppError` a failure *is*. `toErrorResponse`
 * below hands its answer back to the caller precisely so nothing needs to call
 * this a second time — `server.ts`'s `registerErrorHandling` used to call
 * `AppError.from` on its own for its log line, which put the widened
 * `BAD_REQUEST` in the response but left the log reporting `INTERNAL` for the
 * same request (dl-66) — exactly the "log reads as a server fault" failure
 * this ticket exists to fix, just moved from the response to the line an
 * operator actually reads.
 */
function toAppError(error: unknown): AppError {
  return isClientRequestStatusError(error)
    ? new AppError("BAD_REQUEST", undefined, { cause: error })
    : AppError.from(error);
}

/**
 * `appError` rides along on the return value precisely so a caller that also
 * needs to log the failure — `registerErrorHandling` in `server.ts` is the
 * one — reads it from here rather than computing its own with a second
 * `AppError.from`/`toAppError` call. Two independent computations of "what
 * `AppError` is this" is exactly how the response and the log line disagreed
 * about a `BAD_REQUEST`'s code (dl-66).
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ErrorResponse;
  appError: AppError;
} {
  const appError = toAppError(error);
  // An INTERNAL is by definition something we did not anticipate, so its
  // message is whatever a library happened to throw. Never echo that.
  const payload = toPublicPayload(appError, { safeMessage: appError.code === "INTERNAL" });
  return { status: statusForCode(appError.code), body: { error: payload }, appError };
}
