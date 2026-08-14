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
  BLOCKED_TARGET: 403,
  CONVERSATION_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
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
