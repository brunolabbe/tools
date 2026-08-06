/**
 * Header redaction.
 *
 * A captured `RequestContext` routinely carries a live session cookie or bearer
 * token. Those must never reach a log line or an `AppError.details` payload,
 * both of which are persisted and shipped to the UI.
 */

import type { RequestContext } from "@downloader/shared";

/** Lower-cased header names whose values are replaced wholesale. */
const SECRET_HEADERS: ReadonlySet<string> = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

const PLACEHOLDER = "[redacted]";

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? PLACEHOLDER : value;
  }
  return out;
}

/**
 * Signed URLs carry their credential in the query string, so a bare URL in a log
 * line is as sensitive as a cookie. Keep origin + path, drop the query.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.search
      ? `${parsed.origin}${parsed.pathname}?[redacted]`
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[unparsable-url]";
  }
}

export function redactRequestContext(context: RequestContext): Record<string, unknown> {
  return {
    headers: redactHeaders(context.headers),
    ...(context.expiresAt === undefined ? {} : { expiresAt: context.expiresAt }),
    ...(context.proxyUrl === undefined ? {} : { proxyUrl: redactUrl(context.proxyUrl) }),
  };
}
