/**
 * Structured logging, on pino — shared by all three tools' APIs.
 *
 * Lifted here on the third copy of the same file (repo-66). The downloader
 * wrote the first; the planner's was a near-copy with a note that the shared
 * half belonged in `@webtools/core` once a third consumer showed which parts
 * were general; the ledger's, arriving with its own scaffold, was that third
 * consumer. The owner's decision on repo-66 (2026-09-28) settled what
 * "shared" means: the adapter and `createLogger` move for all three,
 * including the downloader — its `RequestContext` redaction and dl-58's
 * whole-line URL walk move with it, supplied through `redactFields` rather
 * than kept as a second copy of the adapter. The planner and the ledger pass
 * no hook and pay nothing for it. There is one implementation, not two.
 *
 * Two pino defaults are overridden deliberately:
 *
 *  - **String levels, ISO timestamps.** pino's numeric `level` and epoch `time`
 *    are cheaper and what its own tooling expects, but these services' logs
 *    are read raw far more often than they are piped through anything, and a
 *    line nobody can read without a decoder ring does not get read.
 *  - **stderr, not stdout.** stdout stays free for data. Docker captures both
 *    streams, so nothing is lost in a container.
 *
 * A subpath, `@webtools/core/logger`, rather than the barrel — the same
 * reason `./rate-limit` is one: it imports `pino`, and the barrel is in
 * `web`'s bundle graph by way of every tool's contract.
 *
 * Redaction is layered, and each layer is optional so a tool that needs
 * nothing past the first pays nothing for the rest:
 *
 *  - **`redactPaths`**, pino's own path-based redaction, censored with
 *    `REDACTED` from `./redact.ts`. Cheap, but fragile by nature: it matches a
 *    path segment exactly, so it is a net under a plain header bag and not a
 *    substitute for a tool's own structural pass.
 *  - **`redactFields`**, a hook run over a call's whole `fields` object — and,
 *    on `child`, over its bindings — before either reaches pino. This is
 *    where the downloader's structural `RequestContext` pass and dl-58's
 *    whole-line URL walk live now: neither is expressible as a pino path, and
 *    neither the planner nor the ledger has a shape that needs one.
 */

import os from "node:os";
import process from "node:process";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import { REDACTED } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface AppLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** A logger that stamps every line with extra fields. */
  child(bindings: Record<string, unknown>): AppLogger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Injected in tests; defaults to stderr so stdout stays free for data. */
  write?: ((line: string) => void) | undefined;
  /** Merged into every line. Used to bind a request or job id to a child logger. */
  bindings?: Record<string, unknown> | undefined;
  /** pino's own path-based redaction, censored with `REDACTED`. Empty by default. */
  redactPaths?: string[] | undefined;
  /**
   * Runs over a call's `fields`, and over a `child`'s bindings, before either
   * reaches pino — the seam a tool's own structural or whole-line redaction
   * hangs off. Absent for a tool that needs nothing past `redactPaths`.
   */
  redactFields?:
    | ((fields: Record<string, unknown> | undefined) => Record<string, unknown> | undefined)
    | undefined;
}

/**
 * Wraps a pino instance in the `AppLogger` shape.
 *
 * The two interfaces differ in argument order — pino takes the merge object
 * first, ours takes the message — so this is a genuine adapter rather than a
 * pass-through, and it is the single place `redactFields` is applied.
 */
function adapt(logger: PinoLogger, redactFields?: LoggerOptions["redactFields"]): AppLogger {
  const safe = redactFields ?? ((fields: Record<string, unknown> | undefined) => fields);

  /**
   * Logging must never be the reason a request dies.
   *
   * pino's own serialiser is safe — cycles and BigInts become placeholders
   * rather than throws — but a `redactFields` hook is not: it walks the
   * object, and walking evaluates getters. One that throws would otherwise
   * propagate into whatever was merely trying to report something. The
   * message is the part worth keeping, so it goes out alone and says the
   * fields were dropped.
   */
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields: Record<string, unknown> | undefined,
  ): void => {
    try {
      logger[level](safe(fields) ?? {}, message);
    } catch {
      logger[level]({ fieldsDropped: true }, message);
    }
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) => adapt(logger.child(safe(extra) ?? {}), redactFields),
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
      // See the file header: readable beats cheap for these services' volume.
      formatters: { level: (label: string) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "msg",
      redact: { paths: options.redactPaths ?? [], censor: REDACTED },
      // `hostname` is the container id under compose, which is the only way to
      // tell two replicas' lines apart once they are interleaved.
      base: { pid: process.pid, hostname: os.hostname(), ...options.bindings },
    },
    destination,
  );

  return adapt(logger, options.redactFields);
}
