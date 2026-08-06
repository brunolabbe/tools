/**
 * Captured browser headers routinely carry live session credentials. Everything
 * that leaves this package for a log line or an `AppError.details` goes through
 * here first.
 */

import type { RequestContext } from "@downloader/shared";

export const REDACTED = "[redacted]";

const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

export function redactRequestContext(context: RequestContext): RequestContext {
  return { ...context, headers: redactHeaders(context.headers) };
}

/**
 * Origin + path only. Signed URLs carry HMACs and session tokens in the query
 * string, so the query never reaches diagnostics.
 */
export function describeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<unparsable url>";
  }
}
