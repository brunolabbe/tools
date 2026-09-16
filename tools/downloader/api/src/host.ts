/**
 * How a hostname is stored in `probe_outcomes` and `jobs.host` — never a
 * client- or page-supplied address, and never a wire-format artefact a
 * hostname column should not carry.
 *
 * Two consumers as of dl-57's owner-decision round: `routes/probe.ts` (a
 * `probe_outcomes` row) and `db/job-store.ts` (`jobs.host`). Kept as its own
 * module, dependency-free beyond `node:net`, rather than folded into either
 * caller or into `ssrf.ts` — a security guard and a column-formatting rule
 * are different concerns that happen to look at the same string.
 */

import net from "node:net";

/**
 * Stored in place of any IP-literal host — v4, v6, and the numeric/octal/hex
 * forms the WHATWG URL parser itself canonicalises into dotted-decimal or
 * bracketed-colon form before `.hostname` ever returns them (`1572395278`
 * becomes `93.184.217.14` on parse, not on read here).
 *
 * One marker rather than `ip-literal-v4`/`ip-literal-v6`: the report groups
 * "not a real hostname" as one bucket, and a version split buys an operator
 * nothing `probe_outcomes.attempts_json` or the raw logs would not still
 * show if it ever mattered. See dl-57's Log for the owner decision this
 * closes.
 */
export const IP_LITERAL_HOST = "ip-literal";

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * `url.hostname`, normalised for storage: an IP literal (of any form
 * `net.isIP` recognises once bracket-stripped) becomes `IP_LITERAL_HOST`, and
 * a trailing FQDN dot (`site.example.`) is removed so it does not group apart
 * from the same host written without one.
 */
export function normalizeHost(hostname: string): string {
  const stripped = stripBrackets(hostname);
  if (net.isIP(stripped) !== 0) return IP_LITERAL_HOST;
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/**
 * `normalizeHost(new URL(rawUrl).hostname)`, or null when `rawUrl` will not
 * parse as a URL at all — the one case dl-57's owner decision says gets no
 * outcome row, because there is no hostname to attach one to.
 */
export function hostnameOrNull(rawUrl: string): string | null {
  try {
    return normalizeHost(new URL(rawUrl).hostname);
  } catch {
    return null;
  }
}
