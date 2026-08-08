/**
 * A logger, pending pino in WP-7.
 *
 * `no-console` is in force repo-wide and there is no logging package yet, so
 * this writes structured JSON lines to stderr through `process.stderr.write`.
 * It satisfies the engine's `Logger` interface, which is the seam WP-7 will
 * repoint at pino without touching a single call site.
 *
 * Everything written here goes through `redactHeaders` for any field that could
 * be a header bag, because a captured `RequestContext` routinely carries a live
 * session cookie and this is the layer that finally writes bytes somewhere.
 */

import process from "node:process";
import { redactRequestContext } from "@downloader/shared";
import type { RequestContext } from "@downloader/shared";
import type { Logger } from "@downloader/engine";
import type { LogLevel } from "./config.ts";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

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

export function createLogger(options: LoggerOptions): AppLogger {
  const threshold = LEVEL_RANK[options.level];
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const bindings = options.bindings ?? {};

  function emit(
    level: Exclude<LogLevel, "silent">,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_RANK[level] < threshold) return;
    const line = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...bindings,
      ...safeFields(fields),
    };
    try {
      write(JSON.stringify(line));
    } catch {
      // A field that cannot be serialised (a cycle, a BigInt) must not take the
      // server down on the way to reporting something else.
      write(JSON.stringify({ level, time: line.time, msg: message, ...bindings }));
    }
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child(extra) {
      return createLogger({
        ...options,
        bindings: { ...bindings, ...extra },
      });
    },
  };
}
