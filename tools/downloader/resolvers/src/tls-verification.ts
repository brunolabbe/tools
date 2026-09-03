/**
 * What a refused certificate looks like when the client is a subprocess we do
 * not own.
 *
 * `api/src/guarded-fetch.ts` already does this for undici (dl-31), and it can
 * read a structured `code` off the cause because Node threw it. Neither tier
 * here gives us that: Chromium hands Playwright a message string and yt-dlp
 * writes English to stderr. So this file is string matching, and it is string
 * matching on purpose rather than for want of a better shape — the alternative
 * is what both classifiers did before dl-34, which was to discard the one part
 * of the failure that named its cause.
 *
 * **Under-matching is the safe direction**, exactly as in `guarded-fetch.ts`,
 * and for a slightly different reason worth stating. Nothing here rescues a
 * request: by the time either function runs, the tier has already failed. What
 * a wrong match costs is a *verdict* — pointing an operator at a trust setting
 * for a failure that had nothing to do with trust, and, for yt-dlp, stopping a
 * resolver chain that would otherwise have degraded to the browser tier. So a
 * certificate failure this misses stays whatever it is today, which is merely
 * the bug; a network blip matched here is a new one.
 */

/**
 * The operator-facing half of the verdict.
 *
 * It goes in `AppError.details`, never in `message`. `http-errors.ts` logs
 * `details` at `error` for a 502 and its `CLIENT_SAFE_DETAIL_KEYS` allowlist
 * does not carry `hint`, so this reaches the person who can act on it — someone
 * reading the service's log — and not the page, where the name of an
 * environment variable is noise. The web UI's finished copy for
 * `TLS_VERIFICATION_FAILED` already says the user-facing half.
 */
export const TIER_TRUST_STORE_HINT =
  "EGRESS_CA_FILE does not reach this tier. It configures this process's own fetches, ffmpeg, and the egress proxy that verifies on ffmpeg's behalf — but Chromium and yt-dlp are handed a tunnelling proxy (dl-27) and verify against their own trust stores, so an origin chaining to a private root fails here with EGRESS_CA_FILE set and correct. Naming the failure is all this tier can do about it; see tools/downloader/docs/work/dl-34-resolver-tiers-and-the-operator-ca.md.";

/**
 * Chromium names the cause in the message Playwright re-throws, and the whole
 * `net::ERR_CERT_*` family is by construction "the certificate did not verify"
 * — `net_error_list.h` reserves −200…−217 for it. So this is a prefix rather
 * than a closed set: the set is Chromium's to change and every member of it has
 * the same answer.
 *
 * **`ERR_CERTIFICATE_TRANSPARENCY_REQUIRED` is deliberately outside it.** The
 * trailing underscore excludes it, it is the one certificate verdict in that
 * range that a private root cannot cause — Chrome does not enforce CT for
 * locally-installed roots — and `TIER_TRUST_STORE_HINT` would be wrong advice
 * for it. Under-matching, on purpose.
 *
 * Measured 2026-09-03 against a self-signed fixture origin, with the Chromium
 * this repo pins: `page.goto: net::ERR_CERT_AUTHORITY_INVALID at
 * https://127.0.0.1:40799/page.html\nCall log:\n  - navigating to …`. Only that
 * one member was produced — an untrusted issuer is decided before expiry or a
 * name mismatch, so a fixture that is *also* expired still reports
 * `ERR_CERT_AUTHORITY_INVALID`, which was checked rather than assumed.
 */
const CHROMIUM_CERTIFICATE_ERROR = /net::(ERR_CERT_[A-Z0-9_]+)/;

/** The `net::` token when the message names one, for `details.reason`. */
export function chromiumCertificateError(message: string): string | undefined {
  return CHROMIUM_CERTIFICATE_ERROR.exec(message)?.[1];
}

/**
 * yt-dlp's stderr, lowercased by the caller.
 *
 * The first three were produced here on 2026-09-03 by running the real binary
 * (2025.09.26) against a self-signed fixture origin; it emits all three in one
 * line, from its default `urllib` backend:
 *
 * > `ERROR: [generic] Unable to download webpage: [SSL:
 * > CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed
 * > certificate (_ssl.c:1032) (caused by CertificateVerifyError(…))`
 *
 * The fourth is libcurl's wording, which yt-dlp surfaces when it is running on
 * the `curl_cffi` backend. **It is not measured** — neither `curl_cffi` nor
 * `requests` is installed in this container, so only the `urllib` path could be
 * provoked. It is here because the alternative is a classifier that silently
 * stops working on a deployment that installed the impersonation extra, and
 * because the string is specific enough that a false match is hard to construct.
 */
const YTDLP_CERTIFICATE_MARKERS: readonly string[] = [
  "certificate_verify_failed",
  "certificate verify failed",
  "certificateverifyerror",
  "ssl certificate problem",
];

/** The marker yt-dlp used, for `details.reason`. */
export function ytdlpCertificateMarker(lowercasedStderr: string): string | undefined {
  for (const marker of YTDLP_CERTIFICATE_MARKERS) {
    if (lowercasedStderr.includes(marker)) return marker;
  }
  return undefined;
}
