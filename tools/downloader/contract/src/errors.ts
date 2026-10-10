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
  /**
   * The page puts a self-confirmation that the viewer is an adult where the
   * player should be, and the server did not confirm it for them. That press is
   * an attestation made on the user's behalf, so it happens only when the
   * operator sets `ENABLE_AGE_CONFIRMATION` (dl-48). Two causes reach this code:
   * the setting is off, or it is on and the press declined because the page left
   * no single control to press (dl-83). The wording says what the server did and
   * claims nothing about its setting, so it is true of both (dl-94). Not
   * retryable: the setting being off needs an operator to turn it on, and a
   * declined press needs the page or the press rules to change, so a retry
   * alone changes nothing in either case.
   */
  "AGE_CONFIRMATION_REQUIRED",
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
  /**
   * The container the visitor chose cannot hold this source as it is, and
   * nothing known about the source says a conversion would fit (dl-99): today
   * WebM for a source whose codecs are undeclared and whose container is not
   * WebM. Raised before any byte is fetched, and not retryable — the same
   * source and the same choice fail the same way; picking MP4 or MKV works.
   * Not `DOWNLOAD_FAILED`: that code's copy tells the visitor to try again.
   */
  "CONTAINER_UNSUPPORTED",
  /**
   * A progressive MP4 whose index (`moov`) is at the end of the file, from an
   * origin that ignores `Range` and answers every request with the whole body
   * (dl-102). ffmpeg has to seek to that index before it can write a frame,
   * and from such an origin it cannot: it used to finish a clean response of
   * which no frame decodes. Raised before the first byte, from a probe of the
   * origin itself; and where the probe did not catch it, from ffmpeg's own
   * words (dl-103): a `partial file` followed by an early end at the same
   * offset, which such an origin produces when it declares where its body
   * ends (a `Content-Length`, or closing the connection) and a source that is
   * merely short does not. Such an origin that sends its body chunked, with
   * no length, logs no early end, cannot be told from a short source, and is
   * `DOWNLOAD_FAILED` instead. Before the first byte when that verdict comes
   * first, and otherwise by cutting the stream and rejecting its `done`. Not
   * retryable — the same origin answers the same way.
   * Not `DOWNLOAD_FAILED`: that code's copy tells the visitor to try again.
   */
  "SOURCE_NOT_SEEKABLE",

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

/**
 * Retired codes that nothing raises but old records may carry.
 *
 * `MUX_FAILED` — was raised when the separate mux pass joined downloaded video
 * and audio into a file. dl-53 removed that pass: every stream is one ffmpeg
 * that fetches its own inputs and writes straight to the visitor, and any
 * failure it has is `DOWNLOAD_FAILED`. Job rows and browser `downloader:jobs:v1`
 * records from before dl-53 that carry `error.code: "MUX_FAILED"` are accepted
 * by the read-side schema (so old data still loads) but nothing can raise it
 * (dl-74).
 */
const RETIRED_ERROR_CODES = ["MUX_FAILED"] as const;

/** Core codes first, so the generic ones keep their familiar order. */
export const ERROR_CODES = [...CORE_ERROR_CODES, ...DOWNLOADER_ERROR_CODES] as const;

/** All valid codes, including retired ones that old records may carry. */
export const ALL_ERROR_CODES = [...ERROR_CODES, ...RETIRED_ERROR_CODES] as const;

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
  // dl-53: no file is kept, so what "expires" is the link that starts one.
  FILE_EXPIRED: "This download link has expired or was already used. Start the download again.",
  JOB_NOT_FOUND: "That download could not be found.",
  JOB_CANCELED: "The download was canceled.",

  NO_MEDIA_FOUND: "No downloadable video stream was found on that page.",
  DRM_PROTECTED: "This video is DRM-protected and cannot be downloaded.",
  AUTH_REQUIRED: "This video requires a signed-in account.",
  AGE_CONFIRMATION_REQUIRED:
    "This video asks the viewer to confirm their age, and the server did not confirm it.",
  GEO_BLOCKED: "This video is not available from this server’s region.",
  BOT_CHALLENGE: "The site blocked our automated browser.",
  LIVE_STREAM_UNSUPPORTED: "This is a live stream. Set a recording duration to capture it.",
  VARIANT_GONE: "The stream link expired. Analyse the page again.",
  DOWNLOAD_FAILED: "The download failed partway through.",
  CONTAINER_UNSUPPORTED:
    "This file can't be saved as WebM, because what it holds is not known to fit. Choose MP4 or MKV.",
  SOURCE_NOT_SEEKABLE:
    "This video can't be streamed from its source: the file keeps its index at the end, and the source won't let us skip ahead to read it.",
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
