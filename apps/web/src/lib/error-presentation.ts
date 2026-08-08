/**
 * `ErrorCode` → what the user sees.
 *
 * The table is a `Record<ErrorCode, …>`, so adding a code to the taxonomy is a
 * compile error here until it has copy. The default sentence comes from
 * `DEFAULT_ERROR_MESSAGES`; `detail` adds the "what now" the taxonomy
 * deliberately leaves to the UI.
 */

import { DEFAULT_ERROR_MESSAGES, RETRYABLE_CODES } from "@downloader/shared";
import type { AppErrorPayload, ErrorCode } from "@downloader/shared";

export type ErrorTone =
  /** The user typed something we cannot use. */
  | "input"
  /** The source refuses us, and will keep refusing. */
  | "blocked"
  /** Nothing to download, or not in this form. */
  | "unavailable"
  /** Might work on another attempt. */
  | "transient"
  /** Our fault. */
  | "internal";

export interface ErrorPresentationEntry {
  title: string;
  detail: string;
  tone: ErrorTone;
  /**
   * Client-side veto on the retry affordance. `AppErrorPayload.retryable` is
   * server-supplied data; on its own it must never be able to put a "Try again"
   * button in front of a refusal that is final by design.
   */
  allowRetry: boolean;
  /**
   * Present this as an answer rather than a setback: no retry, no "start over"
   * nudge, no alarm styling.
   */
  final?: boolean;
}

export const ERROR_PRESENTATION: Record<ErrorCode, ErrorPresentationEntry> = {
  INVALID_URL: {
    title: "That address will not work",
    detail: "Paste the full page address, starting with http:// or https://.",
    tone: "input",
    allowRetry: false,
  },
  BLOCKED_TARGET: {
    title: "Address not allowed",
    detail:
      "This service refuses private, loopback and link-local addresses. Use a publicly reachable page address.",
    tone: "input",
    allowRetry: false,
  },
  UNREACHABLE: {
    title: "Could not reach the site",
    detail: "The site did not answer. It may be down, or the address may be wrong.",
    tone: "transient",
    allowRetry: true,
  },
  NO_MEDIA_FOUND: {
    title: "No video found",
    detail:
      "The page loaded but no video stream was requested by it. If the video only starts after signing in or interacting, we cannot see it.",
    tone: "unavailable",
    allowRetry: false,
  },
  DRM_PROTECTED: {
    title: "Protected by DRM",
    detail:
      "This video is delivered under a digital rights management licence (Widevine, PlayReady or FairPlay). Downloading it would require breaking that protection, which this service does not do. There is nothing to retry — the answer will not change.",
    tone: "blocked",
    allowRetry: false,
    final: true,
  },
  AUTH_REQUIRED: {
    title: "Sign-in required",
    detail:
      "The source only serves this video to a signed-in session, which this server does not have.",
    tone: "blocked",
    allowRetry: false,
  },
  GEO_BLOCKED: {
    title: "Not available in this region",
    detail: "The source refused the request based on the server's location.",
    tone: "blocked",
    allowRetry: false,
  },
  BOT_CHALLENGE: {
    title: "Blocked by a bot check",
    detail: "The site served an anti-bot interstitial that our browser could not clear.",
    tone: "blocked",
    allowRetry: false,
  },
  LIVE_STREAM_UNSUPPORTED: {
    title: "Live stream needs a duration",
    detail:
      "A live stream has no end, so we cannot download all of it. Set a recording duration and start again.",
    tone: "unavailable",
    allowRetry: false,
  },
  VARIANT_GONE: {
    title: "The stream link expired",
    detail:
      "Signed media links are usually valid for under five minutes. Analyse the page again to get a fresh one.",
    tone: "transient",
    allowRetry: true,
  },
  DOWNLOAD_FAILED: {
    title: "Download failed",
    detail:
      "Fetching the video data failed repeatedly. This is often a flaky CDN and worth another attempt.",
    tone: "transient",
    allowRetry: true,
  },
  MUX_FAILED: {
    title: "Could not assemble the file",
    detail:
      "The pieces downloaded but could not be joined into a playable file. Another quality may work better.",
    tone: "internal",
    allowRetry: false,
  },
  SIZE_LIMIT_EXCEEDED: {
    title: "Too large",
    detail: "This video is bigger than the configured size limit. Pick a lower quality.",
    tone: "unavailable",
    allowRetry: false,
  },
  DISK_FULL: {
    title: "No storage left",
    detail:
      "The server has run out of disk space. Try again once existing downloads have been cleaned up.",
    tone: "internal",
    allowRetry: false,
  },
  TIMEOUT: {
    title: "Took too long",
    detail: "The step ran past its time budget and was stopped.",
    tone: "transient",
    allowRetry: true,
  },
  RATE_LIMITED: {
    title: "Too many requests",
    detail: "Slow down for a moment, then try again.",
    tone: "transient",
    allowRetry: true,
  },
  JOB_NOT_FOUND: {
    title: "Download no longer known",
    detail:
      "The server has no record of this download. It may have been restarted since you started it.",
    tone: "unavailable",
    allowRetry: false,
  },
  JOB_CANCELED: {
    title: "Canceled",
    detail: "You stopped this download. Partial files were removed.",
    tone: "unavailable",
    allowRetry: false,
    final: true,
  },
  // Distinct from JOB_CANCELED: this one is raised below the job layer, so it
  // reaches the UI when analysis was stopped before a job existed — a server
  // shutting down mid-probe, most often. The copy therefore promises nothing
  // about partial files, and offers analysing again rather than a job retry.
  CANCELED: {
    title: "Analysis canceled",
    detail: "Analysing this page was stopped before it finished. Try analysing it again.",
    tone: "unavailable",
    allowRetry: false,
    final: true,
  },
  FILE_EXPIRED: {
    title: "File removed",
    detail: "Finished files are kept for a limited time and this one is past its retention window.",
    tone: "unavailable",
    allowRetry: false,
  },
  INTERNAL: {
    title: "Something went wrong",
    detail: "This one is on us. Nothing about the page you gave us is wrong.",
    tone: "internal",
    allowRetry: true,
  },
};

export interface ErrorView {
  code: ErrorCode;
  title: string;
  /** One-sentence summary; the payload's message wins over the default copy. */
  message: string;
  detail: string;
  tone: ErrorTone;
  /** True only when a retry affordance should be rendered. */
  retryable: boolean;
  final: boolean;
}

export function presentError(payload: AppErrorPayload): ErrorView {
  const entry = ERROR_PRESENTATION[payload.code];
  const message = payload.message.trim() || DEFAULT_ERROR_MESSAGES[payload.code];
  return {
    code: payload.code,
    title: entry.title,
    message,
    detail: entry.detail,
    tone: entry.tone,
    retryable: entry.allowRetry && payload.retryable === true,
    final: entry.final === true,
  };
}

/** Payload for an error the client itself raised, e.g. failed URL validation. */
export function localErrorPayload(code: ErrorCode, message?: string): AppErrorPayload {
  return {
    code,
    message: message ?? DEFAULT_ERROR_MESSAGES[code],
    retryable: RETRYABLE_CODES.has(code),
  };
}
