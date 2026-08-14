/**
 * Error machinery.
 *
 * The *taxonomy* belongs to each tool: `DRM_PROTECTED` means nothing to a trip
 * planner and `NO_FLIGHTS_FOUND` means nothing to the downloader. Sharing one
 * flat `ERROR_CODES` list across tools was the original design, and it does not
 * survive a second tool — every tool would edit the same tuple for unrelated
 * reasons, and the rule that no layer invents a code locally becomes
 * unenforceable because every layer has a legitimate reason to append.
 *
 * What *is* shared is the shape: one code per failure, one default message per
 * code, a retryable set, and a serialisable payload. A tool declares a catalog
 * of its own codes and extends `AppErrorBase` with it — see
 * `tools/downloader/contract/src/errors.ts` for the worked example to copy.
 *
 * The codes below are the ones every tool genuinely has, because they describe
 * the transport and the job runner rather than any domain.
 */

export const CORE_ERROR_CODES = [
  // --- Input / reachability ---
  /** Not a URL, or a scheme we refuse (file:, data:, ftp:). */
  "INVALID_URL",
  /** Blocked by the SSRF guard: private IP, loopback, link-local, or denied host. */
  "BLOCKED_TARGET",
  /** DNS failure, connection refused, TLS failure, or non-2xx on the target itself. */
  "UNREACHABLE",

  // --- Artifacts ---
  /** Output would exceed the configured per-job or global size cap. */
  "SIZE_LIMIT_EXCEEDED",
  /** Storage volume has no room. */
  "DISK_FULL",
  /** Artifact was garbage-collected after its retention window. */
  "FILE_EXPIRED",

  // --- Lifecycle / infra ---
  "TIMEOUT",
  "RATE_LIMITED",
  "JOB_NOT_FOUND",
  "JOB_CANCELED",
  /**
   * A caller's `AbortSignal` fired during an operation that knows nothing about
   * jobs. Distinct from `JOB_CANCELED`, which is the orchestrator's vocabulary:
   * a library has no business naming a concept from a layer above it. Distinct
   * from `TIMEOUT` too, because "someone stopped this" and "this ran out of
   * time" call for different copy and a different retry answer.
   */
  "CANCELED",
  "INTERNAL",
] as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

/**
 * Deliberately domain-neutral wording. A tool that can say something more
 * useful — "this *video* is larger than the limit" — overrides the entry in its
 * own catalog rather than editing these.
 */
export const CORE_ERROR_MESSAGES: Readonly<Record<CoreErrorCode, string>> = {
  INVALID_URL: "That does not look like a valid web address.",
  BLOCKED_TARGET: "That address points somewhere this service is not allowed to reach.",
  UNREACHABLE: "The site could not be reached.",
  SIZE_LIMIT_EXCEEDED: "The result is larger than the configured size limit.",
  DISK_FULL: "The server has run out of storage.",
  FILE_EXPIRED: "That file has been removed. Results are kept for a limited time.",
  TIMEOUT: "The operation took too long and was stopped.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  JOB_NOT_FOUND: "That job could not be found.",
  JOB_CANCELED: "The job was canceled.",
  CANCELED: "The operation was canceled.",
  INTERNAL: "Something went wrong on our end.",
};

/**
 * Core codes worth an automatic retry. Everything else is terminal for the
 * attempt: either the caller must change something, or it will never work.
 *
 * `CANCELED` and `JOB_CANCELED` are deliberately absent: someone asked for the
 * work to stop, so retrying it automatically is the opposite of what they said.
 */
export const CORE_RETRYABLE_CODES: ReadonlySet<CoreErrorCode> = new Set<CoreErrorCode>([
  "UNREACHABLE",
  "TIMEOUT",
  "RATE_LIMITED",
]);

/** Serialisable error shape returned by an API and stored on failed jobs. */
export interface AppErrorPayload<Code extends string = string> {
  code: Code;
  /** Safe to show a user. Never contains internal paths, stack traces or tokens. */
  message: string;
  /** True when retrying the same request unchanged could plausibly succeed. */
  retryable: boolean;
  /**
   * Extra structured context for logs and debugging. Not rendered verbatim in
   * the UI. Written `| undefined` so a zod schema built with `.optional()` can
   * satisfy this type under `exactOptionalPropertyTypes`.
   */
  details?: Record<string, unknown> | undefined;
}

export interface AppErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
  /** Overrides the catalog's answer for this code. */
  retryable?: boolean;
}

/**
 * What a tool must declare to get a typed `AppError` of its own. Written as an
 * interface so the tool can `satisfies ErrorCatalog<ErrorCode>` and have a code
 * without a message be a compile error rather than an `undefined` reaching a
 * user as their entire error text.
 */
export interface ErrorCatalog<Code extends string> {
  readonly codes: readonly Code[];
  readonly messages: Readonly<Record<Code, string>>;
  readonly retryable: ReadonlySet<Code>;
}

/**
 * Base for every tool's `AppError`. Not thrown directly — a tool subclasses it
 * so that `code` is narrowed to that tool's union and an invented code is a
 * compile error. `message` is required here because supplying the default from
 * the catalog is precisely the subclass's job.
 */
export class AppErrorBase<Code extends string = string> extends Error {
  readonly code: Code;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: Code, message: string, options?: AppErrorOptions) {
    super(message, { cause: options?.cause });
    // The subclass's own name, so logs say `AppError` rather than the base.
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }

  toPayload(): AppErrorPayload<Code> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
