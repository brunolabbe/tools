/**
 * Recording how `POST /api/probe` ended, so dl-57's report can read it later.
 *
 * One row per way out: a success, an `AppError` failure, a cache hit, or a
 * refusal by the concurrency gate. **Not** a refusal by the per-client
 * rate-limit bucket — that bucket's `onRequest` hook runs and throws before the
 * route handler this module is called from is ever reached, so it is excluded
 * by construction rather than by a check here.
 *
 * Never a path, a query string or an address: `host` is a hostname, and
 * `ProbeAttempt` carries only a resolver name, a code and a duration.
 *
 * **Recording must never fail a probe.** The same stance `JobOrchestrator`
 * takes on persisting a preview image — wrap the write, log a warning, carry
 * on. A row lost to a full disk is a worse report; a probe lost to one is a
 * worse product.
 */

import type { ProbeAttempt } from "./db/job-store.ts";
import type { AppContext } from "./context.ts";

export interface ProbeOutcomeToRecord {
  host: string;
  /** `"ok"`, or the `AppError` code that ended the probe. */
  outcome: string;
  resolver: string | null;
  attempts: readonly ProbeAttempt[];
  durationMs: number;
  cached: boolean;
  variants: number | null;
  drm: boolean;
}

export function recordProbeOutcome(context: AppContext, outcome: ProbeOutcomeToRecord): void {
  try {
    context.store.recordProbeOutcome(outcome, context.now().toISOString());
  } catch (error: unknown) {
    context.logger.warn("could not record a probe outcome", {
      host: outcome.host,
      outcome: outcome.outcome,
      error: String(error),
    });
  }
}
