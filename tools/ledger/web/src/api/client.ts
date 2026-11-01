/**
 * One request, one error vocabulary.
 *
 * The half that matters is the failure path: the server sends its own taxonomy
 * on every failed request, and parsing it back into an `AppError` is what lets
 * the UI say what went wrong in the taxonomy's own words instead of "request
 * failed". The codes come from `@ledger/contract`, so both sides are reading
 * the same list.
 */

import { AppError, errorPayloadSchema, type AppErrorOptions } from "@ledger/contract";

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /**
   * Explicitly `| undefined` so a caller with an optional signal can pass it
   * straight through — `exactOptionalPropertyTypes` is on, and the alternative
   * is every call site spreading a conditional object.
   */
  signal?: AbortSignal | undefined;
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  // A photo goes as its own bytes (lg-8); anything else as JSON.
  const raw = body instanceof Blob;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined
          ? {}
          : { "content-type": raw ? body.type || "application/octet-stream" : "application/json" }),
      },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
      // `null`, not `undefined`: `RequestInit.signal` is nullable rather than
      // optional, and `exactOptionalPropertyTypes` holds us to the difference.
      signal: signal ?? null,
    });
  } catch (cause: unknown) {
    // A failed `fetch` is indistinguishable from the server being down, so say
    // that rather than guessing at something more specific.
    throw new AppError("UNREACHABLE", "The ledger API is not answering.", { cause });
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorPayloadSchema.safeParse((payload as { error?: unknown } | null)?.error);
    if (parsed.success) {
      const { code, message, details } = parsed.data;
      // `details` travel with the code, so a caller can point at what the
      // server named rather than only repeat its sentence. A refusal for
      // asking too often carries the header's wait as `retryAfterSec` (lg-92):
      // the header is what every client is told to obey, and the body's copy is
      // only the same number.
      const wait = Number(response.headers.get("retry-after"));
      const carried: AppErrorOptions =
        code === "RATE_LIMITED" && Number.isFinite(wait) && wait > 0
          ? { details: { ...details, retryAfterSec: wait } }
          : details === undefined
            ? {}
            : { details };
      throw new AppError(code, message, carried);
    }
    throw new AppError("INTERNAL", `The API answered ${String(response.status)}.`);
  }

  return payload as T;
}
