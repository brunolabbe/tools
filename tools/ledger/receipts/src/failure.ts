/**
 * An SDK failure as this tool's error, for both calls this package makes: the
 * receipt reader's (lg-8) and the layout describer's (lg-66). The SDK has
 * already retried a dropped connection, a timeout, a 429 and a 5xx by the time
 * one arrives here.
 *
 * - The caller hung up: `CANCELED`.
 * - No answer in time: `TIMEOUT`; no connection, or the service busy or failing:
 *   `UNREACHABLE`. All three are worth the person trying again.
 * - Anything else — a key refused, a request the API would not take — is this
 *   service's fault, not the person's: `INTERNAL`, with the status and the
 *   API's error type logged for the operator. Never its message, which can
 *   quote the request.
 *
 * **Errors are mapped by class, never by message.**
 */

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { AppError } from "@ledger/contract";

/** The part of `api`'s logger this needs. The package owns no logger. */
export interface ReaderLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

/** What each call says to the person, and to the operator, for each failure. */
export interface FailureWords {
  timeout: string;
  unreachable: string;
  busy: string;
  /** The log line for a request the API refused. */
  refused: string;
}

export function failure(
  error: unknown,
  logger: ReaderLogger | undefined,
  words: FailureWords,
): AppError {
  if (error instanceof APIUserAbortError)
    return new AppError("CANCELED", undefined, { cause: error });
  if (error instanceof APIConnectionTimeoutError) {
    return new AppError("TIMEOUT", words.timeout, { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new AppError("UNREACHABLE", words.unreachable, { cause: error });
  }
  if (error instanceof RateLimitError || error instanceof InternalServerError) {
    return new AppError("UNREACHABLE", words.busy, { cause: error, retryable: true });
  }
  if (error instanceof APIError) {
    logger?.error(words.refused, {
      status: error.status,
      type: (error.error as { error?: { type?: unknown } } | undefined)?.error?.type,
    });
  }
  return new AppError("INTERNAL", undefined, { cause: error });
}
