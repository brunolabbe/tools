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
 *
 * A third pass gets the whole line (dl-58, widened past its first cut at
 * `details` alone once the gate found two more leaks the field-scoped version
 * missed — `egress-proxy.ts`'s `host`, and a `Referer` that is not inside
 * `details` at all): every string value anywhere in `fields`, however deeply
 * nested, is run through `redactUrlsInText` — the same substring matcher
 * `engine/src/ffmpeg/runner.ts` already uses for ffmpeg's own stderr, reused
 * here rather than written a second time. A resolver's own `AppError`
 * routinely sets `details.url` to the page or media URL it was working on,
 * unredacted; `egress-proxy.ts` logs the full request target as `host`;
 * yt-dlp echoes a URL mid-sentence in `details.stderr`; and a `Referer`
 * header — filled with the full page URL when a probe's capture had none, or
 * carrying it anyway because that is what a browser sends for a same-origin
 * fetch — reaches `probe complete` inside `requestContext`. One mechanism
 * applied to the whole object, run *after* the structural pass so it also
 * reaches into what `redactRequestContext` leaves alone, covers all four
 * without a fifth call site needing to remember anything. The accepted cost
 * is a walk of every field on every line, and every URL anywhere in a log
 * line loses its query string, including ones that carried nothing secret.
 */

import os from "node:os";
import process from "node:process";
import { redactRequestContext, REDACTED } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import pino from "pino";
import type { DestinationStream, Logger as PinoLogger } from "pino";
import { redactUrlsInText } from "@downloader/engine";
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
 *
 * **These paths are case-sensitive, and that is the limit of what they cover.**
 * pino matches a path segment exactly, so `headers.cookie` catches Node's own
 * `IncomingHttpHeaders`, which are always lower-cased, and does *not* catch a
 * `RequestContext`-shaped bag, whose keys carry real HTTP casing — `Cookie`,
 * `Authorization`. Measured, because the obvious guess is wrong: nesting is not
 * the constraint. `{ any: { headers: { cookie } } }` is redacted here by
 * `*.headers.cookie`, while `{ headers: { Cookie } }` is not redacted at any
 * depth. So this layer is a net under Node's headers, not under ours; the
 * structural pass below is the one that covers a `RequestContext`.
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
 * Redacts every URL substring anywhere in `value`, however deeply nested —
 * `host`, `details.url`, a URL embedded mid-sentence in `details.stderr`, a
 * `Referer` inside `requestContext.headers` after the structural pass below
 * has already run on it, an entry in an array. Text matching via
 * `redactUrlsInText`, not "is this string entirely a URL": a resolver's stderr
 * tail carries one as a substring of a longer sentence, and a whole-string
 * parse (dl-58's first cut, before the gate found two more leaks it missed)
 * left that case, and `host`, and `Referer`, all uncovered.
 *
 * Cycle-safe via `ancestors`, the set of objects on the path from the root to
 * here — not every object seen anywhere in the line. **That distinction is
 * load-bearing** (dl-58's gate 2): a `WeakSet` of everything visited, tried
 * first, returned the *original, unredacted* value for a second reference to
 * a shared but non-cyclic object — `{ a: shared, b: shared }` redacted `a`
 * and left `b` raw, since `b` looked like a repeat of something already
 * handled. Tracking only the current chain and removing an object once its
 * subtree is done (`finally`) tells the two cases apart: a true cycle
 * revisits an object that is still its own ancestor, a shared reference
 * revisits one whose subtree already finished and was removed.
 *
 * Returns the same reference when nothing changed, so a line with no URL in
 * it allocates nothing beyond the one `Set` passed down the call.
 *
 * **Known limitation: content reached only by re-entering a genuine cycle is
 * not redacted.** A true self-reference stops the walk at the point it
 * revisits its own ancestor, same as before — pino's own serialiser is what
 * turns that back edge into `"[Circular]"` rather than a stack overflow, and
 * this function never walks it a second time to redact what is past it. No
 * call site logs a self-referential structure with a URL inside it; this is
 * the same kind of net-for-a-call-site-nobody-has-written-yet as the
 * `requestContext` limitation below, not a live gap.
 */
function redactUrlsDeep(value: unknown, ancestors: Set<object> = new Set()): unknown {
  if (typeof value === "string") {
    const redacted = redactUrlsInText(value);
    return redacted === value ? value : redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((entry) => {
        const redacted = redactUrlsDeep(entry, ancestors);
        if (redacted !== entry) changed = true;
        return redacted;
      });
      return changed ? out : value;
    }

    let out: Record<string, unknown> | undefined;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const redacted = redactUrlsDeep(entry, ancestors);
      if (redacted !== entry) {
        out ??= { ...(value as Record<string, unknown>) };
        out[key] = redacted;
      }
    }
    return out ?? value;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Redacts on the way out rather than trusting call sites.
 *
 * Two passes. First, structural: a `requestContext` field is the one shape
 * that reliably holds credentials, so it is recognised by key and fully
 * wiped for `cookie`/`authorization`-class headers via `redactRequestContext`
 * — a caller that forgets to redact one still cannot leak a session cookie
 * through this logger. Second, textual: `redactUrlsDeep` runs over the
 * *result* of the first pass, so a `Referer` header `redactRequestContext`
 * deliberately leaves alone (see its own doc comment — it is needed for
 * replay) still loses its query string here, alongside every other URL
 * anywhere in the line.
 *
 * **Known limitation: the structural pass is top level only.** It walks
 * `fields` one level deep and matches the literal key `requestContext`. A
 * context nested under another key (`{ details: { requestContext } }`) or
 * inside an array (`{ items: [{ headers: { Cookie } }] }`) is *not*
 * credential-wiped, and neither is caught by `REDACT_PATHS` above, whose
 * case-sensitivity is described there. Both are pinned as known limitations
 * in `logging.test.ts`, so widening this function turns those tests red
 * rather than leaving the caveat quietly wrong. This limitation is about the
 * structural pass only — `redactUrlsDeep` walks the whole object regardless
 * of nesting, so a cookie *value* that happened to look like a URL would
 * still be caught there, but a cookie is not URL-shaped and this is not a
 * substitute for the structural pass.
 *
 * Every call site in the tool passes `requestContext` at the top level today
 * — all of them were enumerated when this note was written — so the gap is in
 * the safety net rather than in live behaviour. It is documented because a net
 * whose edges are unmarked is one a future call site falls through silently,
 * and this one is deliberately the thing call sites are told to rely on.
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
  return redactUrlsDeep(out ?? fields) as Record<string, unknown>;
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
