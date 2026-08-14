/**
 * Credential redaction.
 *
 * A captured request context routinely carries a live session cookie or bearer
 * token, and a signed URL carries its credential in the query string. Neither
 * may reach a log line or an `AppErrorPayload.details` — both are persisted,
 * and `details` is shipped to the UI.
 *
 * This lives in core rather than in each consumer because it was previously
 * implemented three times, and a redactor that one layer forgets is a redactor
 * that does not exist.
 */

export const REDACTED = "[redacted]";

/**
 * Lower-cased header names whose values are replaced wholesale.
 *
 * Deliberately a denylist of names rather than a value heuristic: a header
 * called `Cookie` is a credential whatever its value looks like, and guessing
 * from values would both miss and over-redact.
 */
const SECRET_HEADERS: ReadonlySet<string> = new Set([
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
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Origin + path only. Signed URLs carry HMACs and session tokens in the query
 * string, so a bare URL in a log line is as sensitive as a cookie.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.search
      ? `${parsed.origin}${parsed.pathname}?${REDACTED}`
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[unparsable-url]";
  }
}
