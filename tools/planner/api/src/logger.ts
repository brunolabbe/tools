/**
 * Structured logging, on pino.
 *
 * Near-identical to the downloader's, and knowingly so: that one carries
 * redaction for a `RequestContext`, a downloader concept this tool has never
 * heard of, so importing it would mean one tool depending on another. The
 * shared version belongs in `@webtools/core` — lift it there once this tool's
 * own logging needs are known, rather than guessing which half is general.
 *
 * Two pino defaults are overridden deliberately:
 *
 *  - **String levels, ISO timestamps.** pino's numeric `level` and epoch `time`
 *    are cheaper, but these logs are read raw far more often than they are
 *    piped through anything, and a line nobody can read does not get read.
 *  - **stderr, not stdout.** stdout stays free for data. Docker captures both.
 */

import os from "node:os";
import process from "node:process";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import type { LogLevel } from "./config.ts";

export interface LoggerOptions {
  level: LogLevel;
  /** Injected in tests; defaults to stderr so stdout stays free for data. */
  write?: (line: string) => void;
  /** Merged into every line. Used to bind a request id to a child logger. */
  bindings?: Record<string, unknown>;
}

export interface AppLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** A logger that stamps every line with extra fields. */
  child(bindings: Record<string, unknown>): AppLogger;
}

/**
 * Credential-bearing paths, censored on the way out.
 *
 * A provider API key is the one secret this service holds, and the surest way
 * for it to reach a log is inside a config or header object someone logged
 * whole. Path-based redaction is fragile by nature, which is why call sites
 * should not log keys at all — this is the backstop, not the plan.
 */
const REDACT_PATHS = [
  "apiKey",
  "*.apiKey",
  "headers.authorization",
  "*.headers.authorization",
  "*.authorization",
  "headers['x-api-key']",
  "*.headers['x-api-key']",
];

const REDACTED = "[redacted]";

/**
 * Wraps a pino instance in the `AppLogger` shape. The two interfaces differ in
 * argument order — pino takes the merge object first, ours takes the message —
 * so this is a genuine adapter rather than a pass-through.
 */
function adapt(logger: PinoLogger): AppLogger {
  /**
   * Logging must never be the reason a request dies. pino's serialiser is safe,
   * but its redact traversal walks the object, and walking evaluates getters.
   * The message is the part worth keeping, so it goes out alone.
   */
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields: Record<string, unknown> | undefined,
  ): void => {
    try {
      logger[level](fields ?? {}, message);
    } catch {
      logger[level]({ fieldsDropped: true }, message);
    }
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) => adapt(logger.child(extra)),
  };
}

export function createLogger(options: LoggerOptions): AppLogger {
  const destination: DestinationStream =
    options.write === undefined
      ? // Synchronous: an async destination buffers, and the lines worth having
        // most are the ones written just before the process dies.
        pino.destination({ dest: 2, sync: true })
      : { write: (chunk: string) => options.write?.(chunk.replace(/\n$/u, "")) };

  const logger = pino(
    {
      level: options.level,
      formatters: { level: (label: string) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "msg",
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      base: { pid: process.pid, hostname: os.hostname(), ...options.bindings },
    },
    destination,
  );

  return adapt(logger);
}
