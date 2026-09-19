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

export function toErrorResponse(error: unknown): { status: number; body: ErrorResponse } {
  const appError = AppError.from(error);
  return {
    status: STATUS_BY_CODE[appError.code] ?? 500,
    body: { error: appError.toPayload() },
  };
}
