/**
 * One error code, one HTTP status, in one place.
 *
 * Mapping per-route is how a service ends up answering 500 for a typo in a
 * date and 404 for an outage. Everything leaves through here instead, and
 * anything unmapped is a 500 — the honest default for "we did not think about
 * this yet". Each ledger code gets its line here in the same change that adds it
 * to the contract.
 */

import { AppError, type ErrorCode, type ErrorResponse } from "@ledger/contract";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  // lg-3: no token, or one that did not verify — then a verified address the
  // configuration maps to nobody. Both 403, never 401, by the owner's decision:
  // a 401 must carry a `WWW-Authenticate` scheme, and Access has none a client
  // could answer. The codes still tell the two apart.
  UNAUTHENTICATED: 403,
  FORBIDDEN: 403,
  BLOCKED_TARGET: 403,
  NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  SIZE_LIMIT_EXCEEDED: 413,
  RATE_LIMITED: 429,
  JOB_CANCELED: 499,
  CANCELED: 499,
  UNREACHABLE: 502,
  TIMEOUT: 504,
  // A paste that is well-formed HTTP and wrong as a statement: 422, not the 400
  // of a request we could not read at all.
  STATEMENT_UNRECOGNIZED_LINE: 422,
  STATEMENT_CHAIN_BROKEN: 422,
  STATEMENT_TOTAL_MISMATCH: 422,
  STATEMENT_ECHO_MISMATCH: 422,
  // lg-2: the paste is fine on its own and does not fit what is stored.
  STATEMENT_ROW_CONFLICT: 422,
  STATEMENT_BEFORE_HISTORY: 422,
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

/**
 * Fastify's own refusal of a body over `bodyLimit`. Matched by its code, not by
 * the 413 alone, because `@fastify/static` and others raise 4xx statuses of
 * their own.
 */
function isBodyTooLarge(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "FST_ERR_CTP_BODY_TOO_LARGE";
}

/** What the mapper cannot know about the route a failure came from. */
export interface ErrorContext {
  /**
   * The route's own sentence for a body over the cap, declared on the route as
   * `config: { tooLargeMessage }`. Fastify refuses an oversize body before any
   * handler runs, so the mapper is the only place that can answer it, and it
   * knows nothing of what the route takes.
   */
  tooLargeMessage?: string;
}

declare module "fastify" {
  interface FastifyContextConfig {
    tooLargeMessage?: string;
  }
}

/** The one place that decides what `AppError` a failure *is*. */
function toAppError(error: unknown, context: ErrorContext): AppError {
  // Core's default for `SIZE_LIMIT_EXCEEDED` speaks of a *result*, not of
  // something sent, so the copy is replaced here: generically, for any route,
  // unless the route declared its own (the statements route does, lg-2).
  if (isBodyTooLarge(error)) {
    return new AppError(
      "SIZE_LIMIT_EXCEEDED",
      context.tooLargeMessage ?? "The request is too large.",
      { cause: error },
    );
  }
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
export function toErrorResponse(
  error: unknown,
  context: ErrorContext = {},
): {
  status: number;
  body: ErrorResponse;
  appError: AppError;
} {
  const appError = toAppError(error, context);
  return {
    status: STATUS_BY_CODE[appError.code] ?? 500,
    body: { error: appError.toPayload() },
    appError,
  };
}
