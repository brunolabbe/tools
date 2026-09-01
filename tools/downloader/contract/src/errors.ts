/**
 * The downloader's error taxonomy.
 *
 * Every failure this tool can produce maps to exactly one `ErrorCode`. Layers
 * must not invent codes locally — add them to `DOWNLOADER_ERROR_CODES` below so
 * the UI can render one consistent message per cause, and so the retry policy
 * has a single place to decide what is worth retrying.
 *
 * The generic half — bad URL, unreachable, timed out, rate limited, canceled —
 * comes from `@webtools/core` and is shared with every other tool in the repo.
 * Only codes that are *about video* belong here. If a new code would make sense
 * to a tool that has never heard of a stream, it belongs in core instead.
 */

import {
  AppErrorBase,
  CORE_ERROR_CODES,
  CORE_ERROR_MESSAGES,
  CORE_RETRYABLE_CODES,
  type AppErrorOptions,
  type AppErrorPayload as CoreAppErrorPayload,
  type ErrorCatalog,
} from "@webtools/core";

export type { AppErrorOptions } from "@webtools/core";

export const DOWNLOADER_ERROR_CODES = [
  // --- Analysis ---
  /** Page loaded, no media stream could be identified. The common "we lost" case. */
  "NO_MEDIA_FOUND",
  /**
   * Widevine / PlayReady / FairPlay detected. Terminal by design — the pipeline
   * stops here and never attempts licence acquisition or key extraction.
   */
  "DRM_PROTECTED",
  /** Source requires a signed-in session we do not have. */
  "AUTH_REQUIRED",
  /** Source refused our region. */
  "GEO_BLOCKED",
  /** Cloudflare/DataDome/PerimeterX interstitial we could not clear. */
  "BOT_CHALLENGE",
  /** Live manifest with no fixed end; needs an explicit duration limit from the caller. */
  "LIVE_STREAM_UNSUPPORTED",

  // --- Download / transcode ---
  /** Variant URLs expired or 404'd between probe and download. Caller should re-probe. */
  "VARIANT_GONE",
  /** Segment fetching failed past the retry budget. */
  "DOWNLOAD_FAILED",
  /** ffmpeg exited non-zero while remuxing or concatenating. */
  "MUX_FAILED",

  // --- Serving ---
  /**
   * No preview image is held under that token — it expired out of the in-memory
   * store, or the token was never minted.
   *
   * A *document*, so it is ours and not core's: `NOT_FOUND` says of itself that
   * it is about the transport and that "a missing anything-else belongs to the
   * tool's own taxonomy", and `JOB_NOT_FOUND` names a job, which this is not.
   */
  "THUMBNAIL_NOT_FOUND",
] as const;

/** Core codes first, so the generic ones keep their familiar order. */
export const ERROR_CODES = [...CORE_ERROR_CODES, ...DOWNLOADER_ERROR_CODES] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Default user-facing copy. Layers may override with something more specific.
 *
 * Several core codes are re-worded here rather than inherited: core has to say
 * "the result", because it does not know what this tool produces, and "this
 * video is larger than the limit" is the better sentence when we do know.
 */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ...CORE_ERROR_MESSAGES,
  SIZE_LIMIT_EXCEEDED: "This video is larger than the configured size limit.",
  FILE_EXPIRED: "That file has been removed. Downloads are kept for a limited time.",
  JOB_NOT_FOUND: "That download could not be found.",
  JOB_CANCELED: "The download was canceled.",

  NO_MEDIA_FOUND: "No downloadable video stream was found on that page.",
  DRM_PROTECTED: "This video is DRM-protected and cannot be downloaded.",
  AUTH_REQUIRED: "This video requires a signed-in account.",
  GEO_BLOCKED: "This video is not available from this server’s region.",
  BOT_CHALLENGE: "The site blocked our automated browser.",
  LIVE_STREAM_UNSUPPORTED: "This is a live stream. Set a recording duration to capture it.",
  VARIANT_GONE: "The stream link expired. Analyse the page again.",
  DOWNLOAD_FAILED: "The download failed partway through.",
  MUX_FAILED: "The video could not be assembled into a playable file.",
  THUMBNAIL_NOT_FOUND: "That preview image is no longer available.",
};

/**
 * Codes worth an automatic retry, on top of the core ones. Everything else is
 * terminal for the attempt: either the caller must change something, or the
 * source will never work.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ...CORE_RETRYABLE_CODES,
  "DOWNLOAD_FAILED",
  "VARIANT_GONE",
]);

/**
 * The three lists above as one value. `satisfies` is what makes a code added
 * without a message a compile error, rather than `undefined` reaching a user as
 * their entire error text.
 */
export const ERROR_CATALOG = {
  codes: ERROR_CODES,
  messages: DEFAULT_ERROR_MESSAGES,
  retryable: RETRYABLE_CODES,
} satisfies ErrorCatalog<ErrorCode>;

export type AppErrorPayload = CoreAppErrorPayload<ErrorCode>;

/** Typed error carrying an `ErrorCode`. Throw this, never a bare `Error`. */
export class AppError extends AppErrorBase<ErrorCode> {
  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    super(code, message ?? ERROR_CATALOG.messages[code], {
      ...options,
      retryable: options?.retryable ?? ERROR_CATALOG.retryable.has(code),
    });
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    return new AppError("INTERNAL", undefined, { cause: error });
  }
}
