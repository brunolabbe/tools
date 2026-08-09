/**
 * Structured logging, on pino.
 *
 * The `AppLogger` interface is unchanged from the hand-rolled version this
 * replaces — that seam was the whole point of writing it — so nothing outside
 * this file moved when pino landed. It satisfies the engine's `Logger`
 * interface too, which is why the engine can log without depending on the API.
 *
 * Two pino defaults are overridden deliberately:
 *
 *  - **String levels, ISO timestamps.** pino's numeric `level` and epoch `time`
 *    are cheaper and what its own tooling expects, but this service's logs are
 *    read raw far more often than they are piped through anything, and a line
 *    nobody can read without a decoder ring does not get read.
 *  - **stderr, not stdout.** Unchanged from before pino: stdout stays free for
 *    data. Docker captures both streams, so nothing is lost in a container.
 *
 * Redaction happens twice, on purpose. `safeFields` recognises a
 * `RequestContext` structurally, so a caller that forgets to redact one still
 * cannot leak a session cookie; pino's own `redact` paths then catch header
 * bags that arrive under some other shape. Captured headers routinely carry
 * live credentials and this is the layer that finally writes bytes somewhere.
 */

import os from "node:os";
import process from "node:process";
import { redactRequestContext, REDACTED } from "@downloader/shared";
import type { RequestContext } from "@downloader/shared";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import type { Logger } from "@downloader/engine";
import type { LogLevel } from "./config.ts";

export interface LoggerOptions {
  level: LogLevel;
  /** Injected in tests; defaults to stderr so stdout stays free for data. */
  write?: (line: string) => void;
  /** Merged into every line. Used to bind a request or job id to a child logger. */
  bindings?: Record<string, unknown>;
}

export interface AppLogger extends Logger {
  /** A logger that stamps every line with extra fields. */
  child(bindings: Record<string, unknown>): AppLogger;
}

/**
 * Header bags that did not arrive as a `RequestContext`.
 *
 * Path-based and therefore fragile by nature — which is why it is the second
 * line of defence and not the first. `censor` matches `REDACTED` so a reader
 * cannot tell which of the two mechanisms fired, and neither can be mistaken
 * for a real value.
 */
const REDACT_PATHS = [
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
  "*.cookie",
  "*.authorization",
];

function isRequestContext(value: unknown): value is RequestContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "headers" in value &&
    typeof (value as { headers: unknown }).headers === "object"
  );
}

/**
 * Redacts on the way out rather than trusting call sites.
 *
 * A `requestContext` field is the one shape that reliably holds credentials, so
 * it is recognised structurally: a caller that forgets to redact still cannot
 * leak one through this logger.
 */
function safeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (fields === undefined) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "requestContext" && isRequestContext(value)) {
      out ??= { ...fields };
      out[key] = redactRequestContext(value);
    }
  }
  return out ?? fields;
}

/**
 * Wraps a pino instance in the `AppLogger` shape.
 *
 * The two interfaces differ in argument order — pino takes the merge object
 * first, ours takes the message — so this is a genuine adapter rather than a
 * pass-through, and it is the single place `safeFields` is applied.
 */
function adapt(logger: PinoLogger): AppLogger {
  /**
   * Logging must never be the reason a request dies.
   *
   * pino's own serialiser is safe — cycles and BigInts become placeholders
   * rather than throws — but the two passes *around* it are not: `safeFields`
   * and pino's redact traversal both walk the object, and walking evaluates
   * getters. One that throws would otherwise propagate into whatever was
   * merely trying to report something. The message is the part worth keeping,
   * so it goes out alone and says the fields were dropped.
   */
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields: Record<string, unknown> | undefined,
  ): void => {
    try {
      logger[level](safeFields(fields) ?? {}, message);
    } catch {
      logger[level]({ fieldsDropped: true }, message);
    }
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) => adapt(logger.child(safeFields(extra) ?? {})),
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
      // See the file header: readable beats cheap for this service's volume.
      formatters: { level: (label: string) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "msg",
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      // `hostname` is the container id under compose, which is the only way to
      // tell two replicas' lines apart once they are interleaved.
      base: { pid: process.pid, hostname: os.hostname(), ...options.bindings },
    },
    destination,
  );

  return adapt(logger);
}
