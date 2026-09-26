/**
 * One error code, one HTTP status, in one place.
 *
 * Mapping per-route is how a service ends up answering 500 for a typo in a
 * date and 404 for a model outage. Everything leaves through here instead, and
 * anything unmapped is a 500 — the honest default for "we did not think about
 * this yet".
 */

import { AppError, type ErrorCode, type ErrorResponse } from "@planner/contract";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  INVALID_DATES: 400,
  INVALID_ANSWER: 400,
  // The request is well formed; the document behind it is not ready. 400 rather
  // than 409 because `details` names the missing slots and the wizard's next
  // move is to go and ask them — it is the caller's to fix, now.
  BRIEF_INCOMPLETE: 400,
  BLOCKED_TARGET: 403,
  NOT_FOUND: 404,
  INTAKE_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  // Unraised until something addresses a revision, and mapped anyway: the table
  // falls back to 500, so the first caller to throw it would report a server
  // fault for a stale link.
  REVISION_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  // The request is well formed and conflicts with the document's current
  // state, which is not the caller's malformed input (pl-44). A stale base and
  // a plan another write holds; the ceiling, which pl-42 settled as 409; and a
  // day the user's own edit overfilled — until a synchronous move, that code
  // was only ever raised inside a run, and without this entry it reported a
  // server fault. `PLAN_BUSY`'s retryability is the catalog's, not this table's.
  REVISION_STALE: 409,
  PLAN_BUSY: 409,
  REVISION_LIMIT_REACHED: 409,
  PLAN_INFEASIBLE: 409,
  CONTEXT_LIMIT: 413,
  RATE_LIMITED: 429,
  JOB_CANCELED: 499,
  CANCELED: 499,
  // 503, not 500: the caller did nothing wrong and the condition is expected to
  // pass. `AGENT_UNCONFIGURED` is 503 too — it will not pass on its own, but it
  // is still an operator's problem rather than the caller's.
  AGENT_UNAVAILABLE: 503,
  AGENT_UNCONFIGURED: 503,
  UNREACHABLE: 502,
  AGENT_REFUSED: 422,
  AGENT_MALFORMED_REPLY: 502,
  TIMEOUT: 504,
};

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
  return {
    status: STATUS_BY_CODE[appError.code] ?? 500,
    body: { error: appError.toPayload() },
    appError,
  };
}
