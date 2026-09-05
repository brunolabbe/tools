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
 *
 * **Conditional on purpose, not asserted.** A gate on this ticket (2026-09-03)
 * found that an earlier draft stated flatly that the origin "fails here with
 * EGRESS_CA_FILE set and correct" — true for an untrusted issuer, false for a
 * certificate policy violation (weak signature, name constraints, an excess
 * validity window) that `chromiumCertificateError`'s prefix also matches and
 * that no trust anchor changes. `details.reason` carries the exact token for
 * whoever needs the distinction; this text does not have it and should not
 * claim to.
 *
 * **Conditional on a second thing since dl-37**, and it is the deployment
 * setting rather than the certificate. The flat claim "EGRESS_CA_FILE does not
 * reach this tier" was true of every configuration when dl-34 wrote it and is
 * now true of one: with `FFMPEG_TLS_INTERCEPT` on — the default — both tiers sit
 * behind a proxy that terminates their TLS, and that proxy is given the
 * operator's root, so the anchor reaches them after all. Reaching this code at
 * all in that configuration means the tier met an origin certificate directly,
 * which is the tunnelling arrangement. This library cannot see the setting, so
 * it names the condition instead of asserting either side of it — and `api`
 * raises `PROXY_REFUSED_ORIGIN_HINT` instead for the failure that belongs to the
 * other arrangement.
 */
export const TIER_TRUST_STORE_HINT =
  "This tier met the origin's own certificate, which means it is behind a tunnelling proxy: either FFMPEG_TLS_INTERCEPT is off, or the generated root it is normally given did not take. In that arrangement EGRESS_CA_FILE does not reach it — it configures this process's own fetches, ffmpeg, and the egress proxy that verifies on ffmpeg's behalf, while Chromium and yt-dlp verify against their own trust stores, which nothing here writes to. If this is an origin chaining to a private root, turning FFMPEG_TLS_INTERCEPT back on is what gives this tier that anchor (dl-37); setting EGRESS_CA_FILE alone will not fix it here. See details.reason for the exact cause, since some certificate failures are policy violations no trust setting changes. See tools/downloader/docs/work/dl-37-tiers-move-onto-the-terminating-proxy.md.";

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

/**
 * Excluded from the match above even though they contain it, because a gate on
 * this ticket (2026-09-03) found the phrase ambiguous in exactly the direction
 * `TIER_TRUST_STORE_HINT`'s docblock warns about: it is Python's `ssl` message
 * for an **incomplete chain** — the server sent the leaf and not the
 * intermediate — and it fires on both a private-root deployment and an
 * ordinary public-site misconfiguration that has nothing to do with one.
 *
 * The two are not equally likely to be told apart by falling through. Chrome
 * (and most modern browsers) does AIA chasing: given a leaf certificate whose
 * Authority Information Access extension names a CA-issuers URL — which is
 * near-universal for a publicly trusted certificate, required by the CA/Browser
 * Forum baseline requirements — Chromium fetches the missing intermediate
 * itself and completes the chain, where `urllib`'s default validation does not
 * and never will. So the *browser tier this failure would fall through to* is
 * disproportionately likely to succeed at exactly this one, in a way it is not
 * for a genuinely untrusted root. Measured, not merely reasoned, on both
 * sides of that claim: a two-level chain (root → intermediate → leaf) built
 * for this repro, served with only the leaf, reproduces the exact stderr
 * above with `unable to get local issuer certificate` in place of
 * `self-signed certificate` against the real binary; the same origin with no
 * AIA data available fails Chromium identically to the self-signed case
 * (`ERR_CERT_AUTHORITY_INVALID`) — which is expected, since chasing needs
 * something to chase, and is not evidence against the claim, which is about
 * a certificate a real CA issued rather than one this repo minted for the
 * test. Chromium completing the chase itself was not exercised: building a
 * correct AIA extension and serving the intermediate at its URL is next
 * week's fixture, not this afternoon's, and the regex fix does not need it —
 * under-matching this phrase is safe (it leaves the pre-dl-34 fallthrough
 * exactly as it was) whether or not AIA chasing is what saves the retry.
 *
 * A private-root deployment whose origins genuinely have an incomplete chain
 * is not told about it by this exclusion; it degrades to the browser tier and,
 * per the same argument, is not disproportionately likely to be saved by that
 * either — which is the case under-matching accepts.
 */
const YTDLP_AMBIGUOUS_CHAIN_MARKERS: readonly string[] = [
  "unable to get local issuer certificate",
  "unable to get issuer certificate",
];

/** The marker yt-dlp used, for `details.reason`. */
export function ytdlpCertificateMarker(lowercasedStderr: string): string | undefined {
  if (YTDLP_AMBIGUOUS_CHAIN_MARKERS.some((marker) => lowercasedStderr.includes(marker))) {
    return undefined;
  }
  for (const marker of YTDLP_CERTIFICATE_MARKERS) {
    if (lowercasedStderr.includes(marker)) return marker;
  }
  return undefined;
}
