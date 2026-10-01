/**
 * The ledger's redaction, on top of the shared logger (repo-66).
 *
 * This was the third copy of the pino adapter in the repo, after the
 * downloader's and the planner's — landed with the ledger's scaffold, with a
 * note that a third consumer was the argument for lifting the shared half
 * rather than guessing at it from two. That lift is repo-66: the adapter,
 * `createLogger`, and the two overridden pino defaults (string levels and ISO
 * timestamps for readability, stderr so stdout stays free for data) now live
 * in `@webtools/core/logger`. What is left here is what only this tool has:
 * which paths its own credentials travel under.
 *
 * Behind Cloudflare Access every request carries the visitor's identity as a
 * signed token, in a header and in a cookie, and either is a live session for
 * as long as it lasts. Path-based redaction is fragile by nature, which is why
 * call sites should not log headers at all — this is the backstop, not the
 * plan.
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
  "headers.cookie",
  "*.headers.cookie",
  "headers['cf-access-jwt-assertion']",
  "*.headers['cf-access-jwt-assertion']",
];

export function createLogger(options: LoggerOptions): AppLogger {
  return createCoreLogger({ ...options, redactPaths: REDACT_PATHS });
}
