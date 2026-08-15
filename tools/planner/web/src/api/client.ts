/**
 * One request, one error vocabulary.
 *
 * The half that matters is the failure path: the server sends its own taxonomy
 * on every failed request, and parsing it back into an `AppError` is what lets
 * the UI say "that answer does not fit the question" instead of "request
 * failed". The codes come from `@planner/contract`, so both sides are reading
 * the same list.
 */

import { AppError, errorPayloadSchema, type AppErrorOptions } from "@planner/contract";

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

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // `null`, not `undefined`: `RequestInit.signal` is nullable rather than
      // optional, and `exactOptionalPropertyTypes` holds us to the difference.
      signal: signal ?? null,
    });
  } catch (cause: unknown) {
    // A failed `fetch` is indistinguishable from the server being down, so say
    // that rather than guessing at something more specific.
    throw new AppError("UNREACHABLE", "The planner API is not answering.", { cause });
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = errorPayloadSchema.safeParse((payload as { error?: unknown } | null)?.error);
    if (parsed.success) {
      const { code, message, details } = parsed.data;
      // `details` carries the question id on an `INVALID_ANSWER`, which is how
      // the wizard can put someone back on a question rather than at the start.
      const carried: AppErrorOptions = details === undefined ? {} : { details };
      throw new AppError(code, message, carried);
    }
    throw new AppError("INTERNAL", `The API answered ${String(response.status)}.`);
  }

  return payload as T;
}
