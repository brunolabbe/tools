/**
 * The downloader's redaction, on top of the shared logger (repo-66).
 *
 * The adapter, `createLogger`, and the two overridden pino defaults (string
 * levels and ISO timestamps for readability, stderr so stdout stays free for
 * data) now live in `@webtools/core/logger`, lifted there on the third tool
 * to carry a copy of this file. What is left here is what only this tool
 * has: a `RequestContext` concept core has never heard of, and dl-58's
 * whole-line URL walk that concept's redaction does not cover on its own.
 * Both are supplied to `createCoreLogger` through its `redactFields` hook,
 * so the mechanism is one implementation, not two — this file is the
 * downloader's *use* of it, not a second copy.
 *
 * The `AppLogger` interface is unchanged from the hand-rolled version this
 * replaces, before pino, and unchanged again by this move — that seam was the
 * whole point of writing it. It satisfies the engine's `Logger` interface
 * too, which is why the engine can log without depending on the API.
 *
 * Redaction happens twice, on purpose. `safeFields` recognises a
 * `RequestContext` structurally, so a caller that forgets to redact one still
 * cannot leak a session cookie; pino's own `redact` paths (passed through as
 * `redactPaths`) then catch header bags that arrive under some other shape.
 * Captured headers routinely carry live credentials and this is the layer
 * that finally writes bytes somewhere.
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

import { redactRequestContext } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import { redactUrlsInText } from "@downloader/engine";
import type { Logger } from "@downloader/engine";
import { createLogger as createCoreLogger } from "@webtools/core/logger";
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
 * **A genuine cycle's back edge is replaced with a placeholder, not walked
 * and not returned as-is** (dl-58's gate 3 — the previous version returned
 * the *original* object at the back edge, on the reasoning that pino's own
 * serialiser would turn it into `"[Circular]"` one level further out. It
 * does, but not before writing that original object's own fields verbatim
 * at the level where the cycle closes: `{ url: "…CYCLE", self: <itself> }`
 * logged `self: { self: "[Circular]", url: "…CYCLE" }` — the secret was in
 * the object pino circular-marks, not past it). Returning `"[Circular]"`
 * here, at the exact point a value would revisit its own ancestor, means
 * nothing unredacted ever reaches pino's serialiser at all; walking the
 * object again would only repeat content already redacted higher in the
 * same chain, so nothing is lost by not doing it a second time.
 */
function redactUrlsDeep(value: unknown, ancestors: Set<object> = new Set()): unknown {
  if (typeof value === "string") {
    const redacted = redactUrlsInText(value);
    return redacted === value ? value : redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (isError(value)) return redactError(value, ancestors);
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
 * An error by shape, not by `instanceof` alone: one built in another realm
 * (`node:vm`, a worker's structured clone) has a different `Error`, so
 * `instanceof` misses it and pino — which decides by shape — then writes its
 * `message` and `stack` raw (repo-85, gate 1 F2).
 */
function isError(value: object): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === "[object Error]";
}

/**
 * The copy `redactError` made of each error, per line, keyed by that line's
 * `ancestors` set (one per logged call, and held by every wrapper it made).
 * pino stops a loop of function causes by remembering the errors it has seen,
 * which it can only do if the same error comes back as the same copy (repo-85,
 * gate 4 H1).
 */
const copiesByLine = new WeakMap<Set<object>, Map<Error, Error>>();

/**
 * Copies an `Error` as an `Error`, with every property pino writes run through
 * the walk (repo-85).
 *
 * The generic object branch of `redactUrlsDeep` cannot take one: `message`,
 * `stack` and `cause` are own but **not enumerable**, so `Object.entries`
 * never visits them — pino's `err` serialiser then writes a signed URL in
 * `message` and `stack` verbatim — and the `{ ...value }` copy it makes when
 * an *enumerable* field did change is a plain object with no `message` and no
 * `stack`, which is safe and useless for the failure the line was written
 * for. The copy keeps the prototype, so pino still reads it as an error of the
 * same `type`, and keeps each property's enumerability, so a non-`err` key
 * serialises exactly as the original would have.
 *
 * **Every value is read through the error and written onto the copy as plain
 * data, accessors included, for the keys named below** (gate 1, F1). Evaluating a getter is what the
 * walk's `Object.entries` always did and what pino's serialiser does anyway,
 * so skipping one here, as the first cut did, only meant its URL reached the
 * line raw: Node's own `ERR_SYSTEM_ERROR` carries `errno` and `syscall` as own
 * enumerable accessors. Three properties cannot be copied as descriptors, so
 * none is, and the keys read are **exactly the ones pino reads**: every
 * enumerable one, own or inherited (its `for…in`), plus `message`, `stack`,
 * `name`, `cause` and `errors`. A non-enumerable own accessor is left alone
 * (gate 2, G1): pino never reads it, so reading it here could only turn a getter
 * that throws into `fieldsDropped` on a line that would have been written whole.
 * An *enumerable* getter that throws still throws, here as in pino and in the
 * walk before this function existed — that hazard is `emit`'s to catch.
 * A `cause` that is a *function* (VError style) is replaced by one that
 * redacts what the original returns, and does not call it here: pino calls
 * `err.cause()` only for an error it serialises, and the walk reaches errors
 * under any key.
 *
 *  - `stack` is an own accessor over V8's captured trace on the Node this repo
 *    runs, and a descriptor copied onto another object reads back `undefined`
 *    — measured: the first cut logged `"stack": ""`;
 *  - a `message` or `stack` that is an accessor would stay raw if copied;
 *  - a `DOMException`'s `message`, `name` and `code` are getters on the
 *    *prototype* that throw for any object that is not one, and pino reads
 *    them off the copy. So the copy owns each as data, which also means they
 *    are read, and redacted, though they are not own properties. Gate 1's F3 —
 *    without it that line fell back to `fieldsDropped` and lost the whole
 *    failure.
 *
 * Returns the same reference when nothing changed, like the rest of the walk.
 * A copy is made once per error per line: a function `cause` that returns an
 * error already copied gets the same copy back, so a loop ends where pino's own
 * guard ends it, instead of at a stack overflow.
 */
function redactError(error: Error, ancestors: Set<object>): Error {
  const copies = copiesByLine.get(ancestors) ?? new Map<Error, Error>();
  copiesByLine.set(ancestors, copies);
  const seen = copies.get(error);
  if (seen !== undefined) return seen;
  const enumerable = new Set<string>();
  for (const key in error) enumerable.add(key);
  const keys = new Set([...enumerable, "message", "stack", "name", "cause", "errors"]);
  const values = new Map<string, unknown>();
  let changed = false;
  for (const key of keys) {
    const original: unknown = (error as unknown as Record<string, unknown>)[key];
    if (key === "cause" && typeof original === "function") {
      // VError style: pino calls `err.cause()` and writes the result. Redact it
      // when pino asks, not now, so it is called as often as pino would call it
      // and not for an error pino never serialises (repo-85, gate 3).
      values.set(key, () => redactUrlsDeep((original as () => unknown).call(error), ancestors));
      changed = true;
      continue;
    }
    const redacted = redactUrlsDeep(original, ancestors);
    values.set(key, redacted);
    if (redacted !== original) changed = true;
  }
  if (!changed) return error;

  const copy: Error = Object.create(Object.getPrototypeOf(error));
  for (const [key, value] of values) {
    const own = Object.getOwnPropertyDescriptor(error, key);
    // A property the error never had and still has nothing to say about is not invented.
    if (own === undefined && value === undefined) continue;
    Object.defineProperty(copy, key, {
      value,
      enumerable: own?.enumerable ?? enumerable.has(key),
      writable: true,
      configurable: true,
    });
  }
  copies.set(error, copy);
  return copy;
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
 * Hands this tool's two extra passes to the shared adapter as its
 * `redactFields` hook (repo-66). The adapter itself, and the pino instance it
 * wraps, now live in `@webtools/core/logger`.
 *
 * Three routes to a line are not `fields` at all (repo-85), and each is closed
 * here or in the adapter: the message string, through `redactMessage` set to
 * the same `redactUrlsInText`; the `bindings` option, which the adapter now
 * passes through `safeFields` as a child's always were; and an `Error`, whose
 * `message` and `stack` the object walk never reached and which `redactError`
 * copies as an `Error` so the line keeps its failure.
 */
export function createLogger(options: LoggerOptions): AppLogger {
  return createCoreLogger({
    level: options.level,
    write: options.write,
    bindings: options.bindings,
    redactPaths: REDACT_PATHS,
    redactFields: safeFields,
    redactMessage: redactUrlsInText,
  });
}
