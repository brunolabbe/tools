/**
 * Minimal logger seam.
 *
 * No logger package exists yet (WP-7 introduces pino), and the engine must never
 * write to stdout on its own — a library that prints is unusable from a server
 * that structures its logs. So the engine accepts a logger and defaults to one
 * that discards everything.
 *
 * The `(message, fields?)` shape is deliberately narrower than pino's
 * `(obj, msg)`, because adapting pino to this is a three-line wrapper while the
 * reverse forces every call site in the engine to know pino's argument order.
 */

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function noop(): void {
  // Intentionally empty: the default logger discards.
}

export const NOOP_LOGGER: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
