/**
 * Single-use links (dl-53).
 *
 * `POST /api/jobs` does no download work: it hands back a link, and opening the
 * link is what starts the job — re-probe, ffmpeg, and the file streamed on that
 * same response. The numbers below are the owner's decisions of 2026-09-27, and
 * neither is a setting.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { AppErrorPayload } from "@downloader/contract";
import type { JobStore } from "../db/job-store.ts";
import type { JobEventHub } from "./events.ts";
import { MAX_REPROBE_RETRIES } from "./orchestrator.ts";
import { createFileToken } from "./tokens.ts";

/**
 * How long an unopened link lives: fifteen minutes, fixed (owner decision 7).
 * Long enough to read the card and click; short enough that a link sitting in
 * a chat history is dead by the time anyone else finds it.
 */
export const LINK_TTL_MS = 15 * 60_000;

/**
 * The time a streamed response may spend before its first byte, with margin.
 *
 * Cloudflare answers `524` when an origin sends nothing for 125 s (its Error 524
 * documentation, read 2026-09-14). Waiting for a slot and re-probing both happen
 * before the first byte, so together they must fit under this; the 25 s left is
 * ffmpeg's first byte — measured at under 0.1 s on fixtures — and slack.
 */
export const TUNNEL_BUDGET_MS = 100_000;

/**
 * How long a `GET` may wait in line for a job slot (owner decision 6): what the
 * budget leaves once **every** probe the job may run has had its full timeout.
 * Zero when the probes alone use it all, which means "a slot now, or 429".
 *
 * Every probe, not one: a retryable failure before the first byte re-probes
 * (`MAX_REPROBE_RETRIES`), and that second probe happens after the wait, on
 * the same response. Sized for one probe, the cap let a full wait and two slow
 * probes reach 145 s at the defaults, past Cloudflare's 125 s — dl-53's first
 * gate found it, and the owner chose this sizing on 2026-09-27. With the 45 s
 * default the wait is 10 s.
 */
export function maxLinkWaitMs(probeTimeoutMs: number): number {
  return Math.max(0, TUNNEL_BUDGET_MS - probeTimeoutMs * (MAX_REPROBE_RETRIES + 1));
}

/**
 * How long a job's row, and with it the page URL it was made for, is kept
 * (dl-54, the owner's decision of 2026-09-13). A constant and not a setting,
 * because the terms page states it: a setting could make that page false.
 * `web/public/terms.html` says the same number, and `terms-page.test.ts` fails
 * when the two disagree.
 */
export const JOB_RETENTION_DAYS = 14;

export const JOB_RETENTION_MS = JOB_RETENTION_DAYS * 24 * 3_600_000;

/**
 * How long a link's row outlives its expiry, so a late `GET` still reads `410`
 * ("this existed") rather than `404` ("you mistyped it"). The same reasoning as
 * the file-token rows this table replaced, but no longer their thirty days: the
 * row cascades away with its job, and a job goes at `JOB_RETENTION_DAYS` (dl-54),
 * so a longer grace could never take effect.
 */
export const LINK_ROW_GRACE_MS = JOB_RETENTION_MS;

export function createJobLink(now: Date): { token: string; url: string; expiresAt: string } {
  const token = createFileToken();
  return {
    token,
    url: ROUTES.file(token),
    expiresAt: new Date(now.getTime() + LINK_TTL_MS).toISOString(),
  };
}

/** Why a job was canceled, on `error.details.reason` (see `JOB_STATUSES`). */
export type CancelReason = "requested" | "disconnected" | "link-expired";

export function cancelError(reason: CancelReason): AppError {
  return new AppError("JOB_CANCELED", undefined, { details: { reason } });
}

/**
 * Writes `canceled` for a job nothing is running — waiting in line, never
 * started, or whose link expired. A running job is the orchestrator's to
 * record; this is for every path that never reaches it.
 */
export function recordCanceled(
  store: JobStore,
  events: JobEventHub,
  jobId: string,
  payload: AppErrorPayload,
  now: string,
): void {
  store.transition(jobId, "canceled", { error: payload, link: null }, now);
  events.status(jobId, "canceled");
  events.canceled(jobId, payload);
}
