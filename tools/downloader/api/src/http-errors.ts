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

export function toErrorResponse(error: unknown): { status: number; body: ErrorResponse } {
  const appError = AppError.from(error);
  // An INTERNAL is by definition something we did not anticipate, so its
  // message is whatever a library happened to throw. Never echo that.
  const payload = toPublicPayload(appError, { safeMessage: appError.code === "INTERNAL" });
  return { status: statusForCode(appError.code), body: { error: payload } };
}
