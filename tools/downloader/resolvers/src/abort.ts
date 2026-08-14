/**
 * One place that decides what an aborted signal *means*.
 *
 * Three resolvers and the registry all had to answer this and two of them
 * answered differently, which is how the same user action surfaced as `TIMEOUT`
 * from the browser sniffer and `JOB_CANCELED` from the registry.
 */

import { AppError } from "@downloader/contract";

/**
 * `AbortSignal.timeout()` aborts with a `TimeoutError` `DOMException`, so the
 * deadline is distinguishable from a deliberate cancel even after
 * `AbortSignal.any()` has merged the two.
 */
function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "TimeoutError";
}

/**
 * Maps an aborted signal to the error that explains it.
 *
 * A typed reason is authoritative and passes straight through — that is how the
 * orchestrator injects job vocabulary from above. Otherwise the reason decides:
 * the time budget elapsed (`TIMEOUT`) or someone stopped the work (`CANCELED`).
 *
 * `timedOutMessage` lets each call site say what ran out of time; the cancel
 * copy is generic because there is nothing site-specific to add to "you stopped
 * it".
 */
export function toAbortError(signal: AbortSignal, timedOutMessage?: string): AppError {
  const reason: unknown = signal.reason;
  if (reason instanceof AppError) return reason;
  if (isTimeoutReason(reason)) return new AppError("TIMEOUT", timedOutMessage);
  return new AppError("CANCELED");
}
