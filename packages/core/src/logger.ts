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
 *  - **`redactFields`**, a hook run over a call's whole `fields` object — and
 *    over every set of bindings, `createLogger`'s option and each `child`'s —
 *    before any of them reaches pino. This is where the downloader's structural
 *    `RequestContext` pass and dl-58's whole-line URL walk live now: neither is
 *    expressible as a pino path, and neither the planner nor the ledger has a
 *    shape that needs one.
 *  - **`redactMessage`**, the same for the one thing `fields` does not carry:
 *    the message string (repo-85). A separate hook, not a widened
 *    `redactFields`, because a message is a string and the fields hook is
 *    typed over an object — widening it would break every hook already
 *    written, to save one optional property.
 */

import os from "node:os";
import process from "node:process";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import { REDACTED } from "./redact.ts";

/** What `redactMessage` leaves when it throws; see `safeMessage`. */
const MESSAGE_DROPPED = "[message dropped]";

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
  /**
   * Runs over every message before it reaches pino, so a tool can strip what
   * must not be logged from a string a caller built by concatenation
   * (`"fetching " + url`). Absent for a tool that needs nothing. If it throws,
   * the message is replaced rather than written raw.
   */
  redactMessage?: ((message: string) => string) | undefined;
}

/**
 * Wraps a pino instance in the `AppLogger` shape.
 *
 * The two interfaces differ in argument order — pino takes the merge object
 * first, ours takes the message — so this is a genuine adapter rather than a
 * pass-through, and it is the single place `redactFields` is applied.
 */
function adapt(
  logger: PinoLogger,
  redactFields?: LoggerOptions["redactFields"],
  redactMessage?: LoggerOptions["redactMessage"],
): AppLogger {
  const safe = redactFields ?? ((fields: Record<string, unknown> | undefined) => fields);

  /**
   * A hook that throws must not let the raw message through: the message is
   * the thing the hook was asked to clean, so the fallback is a placeholder,
   * never the input.
   */
  const safeMessage = (message: string): string => {
    if (redactMessage === undefined) return message;
    try {
      return redactMessage(message);
    } catch {
      return MESSAGE_DROPPED;
    }
  };

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
    const text = safeMessage(message);
    try {
      logger[level](safe(fields) ?? {}, text);
    } catch {
      logger[level]({ fieldsDropped: true }, text);
    }
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (extra) => adapt(logger.child(safe(extra) ?? {}), redactFields, redactMessage),
  };
}

export function createLogger(options: LoggerOptions): AppLogger {
  // `bindings` is a route to the line like a child's are, so it takes the same hook.
  // Only when there are bindings to redact: a call with no fields is the hook's
  // job to see, a logger with no bindings is not. And a hook that returns nothing
  // means nothing, as it does for a child — not the raw input.
  const bindings =
    options.redactFields === undefined || options.bindings === undefined
      ? options.bindings
      : options.redactFields(options.bindings);
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
      base: { pid: process.pid, hostname: os.hostname(), ...bindings },
    },
    destination,
  );

  return adapt(logger, options.redactFields, options.redactMessage);
}
