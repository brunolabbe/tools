/**
 * One error code, one HTTP status, in one place.
 *
 * Mapping per-route is how a service ends up answering 500 for a typo in a
 * date and 404 for an outage. Everything leaves through here instead, and
 * anything unmapped is a 500 — the honest default for "we did not think about
 * this yet". Only core codes are mapped, because the ledger has none of its own
 * yet; each one it grows gets its line here in the same change.
 */

import { AppError, type ErrorCode, type ErrorResponse } from "@ledger/contract";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  BLOCKED_TARGET: 403,
  NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  SIZE_LIMIT_EXCEEDED: 413,
  RATE_LIMITED: 429,
  JOB_CANCELED: 499,
  CANCELED: 499,
  UNREACHABLE: 502,
  TIMEOUT: 504,
};

/**
 * Any error that is not one of ours but still carries a 4xx `statusCode`.
 * Fastify's own content-type parser — empty JSON, malformed JSON, an
 * unsupported media type, a body over the cap — never reaches a route handler,
 * so it can never be an `AppError`, and `@fastify/static` raises 412 and 416 the
 * same way. The planner measured every one of those reaching its error handler
 * (pl-51) and the downloader did the same width analysis first (dl-66); the
 * rule is copied here rather than rediscovered. "The request itself could not
 * be understood, and it is not this service's fault" holds for all of them,
 * even where a more specific status is thrown away for the generic 400.
 */
function isClientRequestStatusError(error: unknown): boolean {
  if (error instanceof AppError) return false;
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

/** The one place that decides what `AppError` a failure *is*. */
function toAppError(error: unknown): AppError {
  return isClientRequestStatusError(error)
    ? new AppError("BAD_REQUEST", undefined, { cause: error })
    : AppError.from(error);
}

/**
 * `appError` rides along on the return value so a caller that also logs the
 * failure reads it from here rather than computing its own. Two independent
 * computations of "what `AppError` is this" is how a response and its log line
 * once disagreed about a `BAD_REQUEST`'s code (dl-66).
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ErrorResponse;
  appError: AppError;
} {
  const appError = toAppError(error);
  return {
    status: STATUS_BY_CODE[appError.code] ?? 500,
    body: { error: appError.toPayload() },
    appError,
  };
}
