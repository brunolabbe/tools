/**
 * Error taxonomy.
 *
 * Every failure the system can produce maps to exactly one `ErrorCode`. Agents
 * building separate layers must not invent new codes locally — add them here so
 * the UI can render one consistent message per cause, and so the retry policy
 * has a single place to decide what is worth retrying.
 */

export const ERROR_CODES = [
  // --- Input / reachability ---
  /** Not a URL, or a scheme we refuse (file:, data:, ftp:). */
  "INVALID_URL",
  /** Blocked by the SSRF guard: private IP, loopback, link-local, or denied host. */
  "BLOCKED_TARGET",
  /** DNS failure, connection refused, TLS failure, or non-2xx on the page itself. */
  "UNREACHABLE",

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
  /** Output would exceed the configured per-job or global size cap. */
  "SIZE_LIMIT_EXCEEDED",
  /** Storage volume has no room. */
  "DISK_FULL",

  // --- Lifecycle / infra ---
  "TIMEOUT",
  "RATE_LIMITED",
  "JOB_NOT_FOUND",
  "JOB_CANCELED",
  /** File was garbage-collected after its retention window. */
  "FILE_EXPIRED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Serialisable error shape returned by the API and stored on failed jobs. */
export interface AppErrorPayload {
  code: ErrorCode;
  /** Safe to show a user. Never contains internal paths, stack traces or tokens. */
  message: string;
  /** True when retrying the same request unchanged could plausibly succeed. */
  retryable: boolean;
  /** Extra structured context for logs and debugging. Not rendered verbatim in the UI. */
  details?: Record<string, unknown>;
}

/**
 * Codes worth an automatic retry. Everything else is terminal for the attempt:
 * either the caller must change something, or the source will never work.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "UNREACHABLE",
  "DOWNLOAD_FAILED",
  "TIMEOUT",
  "RATE_LIMITED",
  "VARIANT_GONE",
]);

/** Default user-facing copy. Layers may override with something more specific. */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: "That does not look like a valid web address.",
  BLOCKED_TARGET: "That address points somewhere this service is not allowed to reach.",
  UNREACHABLE: "The site could not be reached.",
  NO_MEDIA_FOUND: "No downloadable video stream was found on that page.",
  DRM_PROTECTED: "This video is DRM-protected and cannot be downloaded.",
  AUTH_REQUIRED: "This video requires a signed-in account.",
  GEO_BLOCKED: "This video is not available from this server’s region.",
  BOT_CHALLENGE: "The site blocked our automated browser.",
  LIVE_STREAM_UNSUPPORTED: "This is a live stream. Set a recording duration to capture it.",
  VARIANT_GONE: "The stream link expired. Analyse the page again.",
  DOWNLOAD_FAILED: "The download failed partway through.",
  MUX_FAILED: "The video could not be assembled into a playable file.",
  SIZE_LIMIT_EXCEEDED: "This video is larger than the configured size limit.",
  DISK_FULL: "The server has run out of storage.",
  TIMEOUT: "The operation took too long and was stopped.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  JOB_NOT_FOUND: "That download could not be found.",
  JOB_CANCELED: "The download was canceled.",
  FILE_EXPIRED: "That file has been removed. Downloads are kept for a limited time.",
  INTERNAL: "Something went wrong on our end.",
};

/** Typed error carrying an `ErrorCode`. Throw this, never a bare `Error`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { cause?: unknown; details?: Record<string, unknown>; retryable?: boolean },
  ) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE_CODES.has(code);
    this.details = options?.details;
  }

  toPayload(): AppErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    return new AppError("INTERNAL", undefined, { cause: error });
  }
}
