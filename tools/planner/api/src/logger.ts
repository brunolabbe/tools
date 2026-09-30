/**
 * The planner's redaction, on top of the shared logger (repo-66).
 *
 * This file used to be a near-copy of the downloader's, with a note that the
 * shared half belonged in `@webtools/core` once a third consumer showed which
 * parts were general — the ledger's own copy, arriving with its scaffold, was
 * that third consumer. The adapter, `createLogger`, and the two overridden
 * pino defaults (string levels and ISO timestamps for readability, stderr so
 * stdout stays free for data) now live there. What is left here is what only
 * this tool has: which paths its own credentials travel under.
 *
 * A provider API key is the one secret this service holds, and the surest way
 * for it to reach a log is inside a config or header object someone logged
 * whole. Path-based redaction is fragile by nature, which is why call sites
 * should not log keys at all — this is the backstop, not the plan.
 */

import type { AppLogger } from "@webtools/core/logger";
import { createLogger as createCoreLogger } from "@webtools/core/logger";
import type { LogLevel } from "./config.ts";

export type { AppLogger } from "@webtools/core/logger";

export interface LoggerOptions {
  level: LogLevel;
  /** Injected in tests; defaults to stderr so stdout stays free for data. */
  write?: (line: string) => void;
  /** Merged into every line. Used to bind a request id to a child logger. */
  bindings?: Record<string, unknown>;
}

const REDACT_PATHS = [
  "apiKey",
  "*.apiKey",
  "headers.authorization",
  "*.headers.authorization",
  "*.authorization",
  "headers['x-api-key']",
  "*.headers['x-api-key']",
];

export function createLogger(options: LoggerOptions): AppLogger {
  return createCoreLogger({ ...options, redactPaths: REDACT_PATHS });
}
