/**
 * Parses `TRUST_PROXY`: `false` (the default), `true`, or a proxy address /
 * CIDR / comma-separated list, which Fastify's `trustProxy` option accepts
 * verbatim and is the form worth preferring.
 *
 * Lifted here from `tools/downloader/api/src/config.ts` when the planner
 * became its second real consumer — pl-38 duplicated the function
 * byte-for-byte rather than lift it, deliberately, and repo-40 is the ticket
 * that closes the gap it left open.
 *
 * It lives in its own file rather than beside `clientKey` in `rate-limit.ts`.
 * The two are related but not the same thing: this decides which of Fastify's
 * `request.ip` and `request.hostname` come from, and `clientKey` in
 * `rate-limit.ts` is one of several things downstream that then keys off
 * `request.ip` — rate limiting is a consumer of this value, not what it is
 * about. And unlike `rate-limit.ts`, this file imports nothing from
 * `node:*`, so nothing forces it behind that file's server-only subpath
 * export; it is exported from this package's main entry point instead,
 * alongside `errors.ts` and `redact.ts`, as the first thing here shaped like
 * environment parsing rather than mechanism.
 */

/**
 * `false` (the default), `true`, or a proxy address / CIDR / comma-separated
 * list, which Fastify accepts verbatim and is the form worth preferring.
 */
export function trustProxy(raw: string | undefined): boolean | string {
  const value = raw?.trim() ?? "";
  if (value === "") return false;
  const lower = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(lower)) return true;
  if (["0", "false", "no", "off"].includes(lower)) return false;
  return value;
}
