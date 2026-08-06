/**
 * Runtime shape checks for the parts of the contract that arrive as untrusted
 * bytes: SSE frames and rehydrated `localStorage`.
 *
 * `@downloader/shared` ships zod schemas for *requests* only — `Job`,
 * `JobEvent`, `JobResult` and `AppErrorPayload` are plain interfaces with no
 * runtime counterpart. These guards are deliberately structural and shallow:
 * they exist to stop malformed data from corrupting UI state, not to re-declare
 * the contract. Every status/code list below is derived from a shared export
 * rather than restated.
 */

import { ERROR_CODES, JOB_TRANSITIONS } from "@downloader/shared";
import type {
  AppErrorPayload,
  ErrorCode,
  Job,
  JobEvent,
  JobProgress,
  JobResult,
  JobStatus,
} from "@downloader/shared";

const JOB_STATUSES = new Set<string>(Object.keys(JOB_TRANSITIONS));
const ERROR_CODE_SET = new Set<string>(ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && JOB_STATUSES.has(value);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

export function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!isRecord(value)) return false;
  if (!isErrorCode(value["code"])) return false;
  if (typeof value["message"] !== "string") return false;
  if (typeof value["retryable"] !== "boolean") return false;
  return value["details"] === undefined || isRecord(value["details"]);
}

const NULLABLE_PROGRESS_FIELDS = [
  "percent",
  "totalBytes",
  "segmentsDone",
  "segmentsTotal",
  "speedBps",
  "etaSec",
  "processedSec",
] as const;

export function isJobProgress(value: unknown): value is JobProgress {
  if (!isRecord(value)) return false;
  if (!isJobStatus(value["stage"])) return false;
  if (typeof value["downloadedBytes"] !== "number") return false;
  return NULLABLE_PROGRESS_FIELDS.every((field) => isNullableNumber(value[field]));
}

export function isJobResult(value: unknown): value is JobResult {
  if (!isRecord(value)) return false;
  return (
    typeof value["filename"] === "string" &&
    typeof value["sizeBytes"] === "number" &&
    typeof value["container"] === "string" &&
    isNullableNumber(value["durationSec"]) &&
    typeof value["downloadUrl"] === "string" &&
    typeof value["expiresAt"] === "string"
  );
}

export function isJob(value: unknown): value is Job {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || value["id"] === "") return false;
  if (typeof value["sourceUrl"] !== "string") return false;
  if (!isJobStatus(value["status"])) return false;
  if (!isJobProgress(value["progress"])) return false;
  if (value["variantId"] !== null && typeof value["variantId"] !== "string") return false;
  if (value["result"] !== null && !isJobResult(value["result"])) return false;
  if (value["error"] !== null && !isAppErrorPayload(value["error"])) return false;
  if (typeof value["attempts"] !== "number") return false;
  if (typeof value["createdAt"] !== "string" || typeof value["updatedAt"] !== "string") {
    return false;
  }
  return value["finishedAt"] === null || typeof value["finishedAt"] === "string";
}

export function isJobEvent(value: unknown): value is JobEvent {
  if (!isRecord(value)) return false;
  if (typeof value["at"] !== "string") return false;
  const type = value["type"];
  if (type === "heartbeat") return true;
  if (typeof value["jobId"] !== "string" || value["jobId"] === "") return false;
  switch (type) {
    case "status":
      return isJobStatus(value["status"]);
    case "progress":
      return isJobProgress(value["progress"]);
    case "probed":
      return isRecord(value["probe"]) && Array.isArray(value["probe"]["variants"]);
    case "completed":
      return isJobResult(value["result"]);
    case "failed":
      return isAppErrorPayload(value["error"]);
    default:
      return false;
  }
}

/** Parses an SSE `data:` payload. Returns null for anything unrecognised. */
export function parseJobEvent(raw: string): JobEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isJobEvent(parsed) ? parsed : null;
}
