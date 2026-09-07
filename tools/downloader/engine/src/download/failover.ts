/**
 * Deciding whether a failure is worth trying the next mirror (dl-45).
 *
 * `MediaVariant.alternateUrls` carries the other hosts an HLS master declared
 * for the same rendition. They exist for one condition and one only: **this
 * host would not serve the bytes at all.** Everything else must propagate, and
 * the important half of that is the expiry case — a signed URL that has run out
 * is out at every mirror, so spending the alternates on it would burn them and
 * then hand the orchestrator the same failure it would have re-probed on
 * anyway. `REPROBE_WORTHY` in `api/src/jobs/orchestrator.ts` is the mechanism a
 * mirror attempt must not displace.
 *
 * ## Why this reads stderr
 *
 * On the engine's own fetch paths the taxonomy already separates the two:
 * `UNREACHABLE` is a transport failure and `VARIANT_GONE` is 403/404/410 — see
 * `http.ts`. The manifest path does not have that luxury. ffmpeg is the one
 * fetching, so every non-zero exit arrives as `DOWNLOAD_FAILED` whatever
 * happened, and the text is the only signal. That is the same bind
 * `isTlsVerificationFailure` is in, for the same reason, and this sits beside it
 * rather than pretending there is a cleaner channel.
 *
 * The patterns below are **measured against the bundled ffmpeg**, not guessed.
 * On 2026-09-07, at `-loglevel warning` (what `GLOBAL_ARGS` asks for), against
 * local fixture origins:
 *
 * | condition | what ffmpeg wrote | mirror? |
 * | --- | --- | --- |
 * | closed port | `[tcp @ …] Connection to tcp://127.0.0.1:1 failed: Connection refused` | yes |
 * | unresolvable host | `[tcp @ …] Failed to resolve hostname …: Name or service not known` | yes |
 * | `500` | `Error opening input: Server returned 5XX Server Error reply` | yes |
 * | `403` | `Error opening input: Server returned 403 Forbidden (access denied)` | **no** |
 * | `404` | `Error opening input: Server returned 404 Not Found` | **no** |
 * | socket destroyed mid-response | `Error opening input: End of file` | **no** |
 *
 * The last row is a deliberate exclusion rather than an oversight. "End of file"
 * is what a truncated response from a *healthy* host looks like as well, and it
 * is what a stream that simply ended looks like; treating it as a dead host
 * would spend a mirror on a condition the mirror cannot fix, which is exactly
 * the mistake the expiry case is here to prevent. A CDN that tears down
 * connections without ever completing one is not covered, and is not claimed to
 * be.
 *
 * ## `TLS_VERIFICATION_FAILED` is included, over a recorded objection
 *
 * A rejected certificate **does** buy a mirror. This is not the obvious call and
 * it is not the builder's: it was raised as an objection, put to the owner as an
 * open decision, and decided against the recommendation on 2026-09-07. The
 * objection stands and is recorded on dl-45 — a rejected certificate is a signal
 * dl-11, dl-19 and dl-27 all worked to surface, and a silent success from
 * another host replaces a possible-MITM warning with a download nobody was
 * warned about. The grounds for including it are the ticket's own Why, which
 * names a failed TLS handshake as one of the two conditions that lose a
 * download while another host is serving the same bytes.
 *
 * **What makes it safe enough to be a decision rather than a defect**, checked
 * rather than assumed: every attempt is a fresh `runFfmpeg` with the same
 * `tlsVerify` and `tlsCaFile` on each input, built by `tlsOptions` in
 * `manifest.ts` from the engine config — so a mirror's certificate is verified
 * on its own terms and a second bad certificate raises the same code again. The
 * failover **cannot** downgrade verification; the worst case is that a bad
 * certificate on host A is not reported when host B is healthy. And it cannot
 * loop forever: `TLS_VERIFICATION_FAILED` at the last candidate propagates
 * unchanged, so a wholly MITM'd path still surfaces the certificate error rather
 * than a generic failure.
 *
 * The one thing this does lose is the *warning* in the mixed case, and no code
 * here can give it back — the engine has one error channel and a successful
 * download does not use it. The `logger.warn` on each failover is where that
 * evidence lives, and it names the code.
 */

import { AppError } from "@downloader/contract";

/**
 * Codes that mean *this host* could not deliver, whoever raised them.
 *
 * `UNREACHABLE` is `classifyFetchError`'s verdict on a DNS or TCP failure and
 * is unambiguous. `TLS_VERIFICATION_FAILED` is here by the owner's decision of
 * 2026-09-07, over the objection recorded above and on dl-45.
 *
 * Nothing else belongs here: `RATE_LIMITED` and `AUTH_REQUIRED` are the origin
 * talking, and an origin that is talking about *the request* is not the
 * condition a mirror addresses.
 */
const HOST_FAILURE_CODES: ReadonlySet<string> = new Set(["UNREACHABLE", "TLS_VERIFICATION_FAILED"]);

/**
 * ffmpeg's own words for "I never got the bytes from this host".
 *
 * Matched as separate alternatives rather than as whole sentences: the tcp
 * layer's prefix line carries the errno text, and on a playlist of any length
 * that prefix can scroll out of the 4 KB stderr tail while a later repetition
 * of the errno alone survives.
 */
const FFMPEG_HOST_FAILURE =
  /Connection to \S+ failed|Failed to resolve hostname|Connection refused|Connection timed out|Connection reset by peer|No route to host|Network is unreachable|Server returned 5XX/iu;

/**
 * True when the failure says *this host*, and false when it says *this URL* or
 * *this request*.
 *
 * Anything unrecognised is false. The cost of the two mistakes is not
 * symmetrical: refusing a mirror we could have used loses a download that
 * already failed, while spending mirrors on a repeatable refusal loses the
 * re-probe that would have fixed it.
 */
export function isHostFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (HOST_FAILURE_CODES.has(error.code)) return true;
  if (error.code !== "DOWNLOAD_FAILED") return false;

  // The engine's own fetches classify by status; 5xx is the host failing to
  // serve what it has, which the next host may well have.
  const status = error.details?.["status"];
  if (typeof status === "number") return status >= 500;

  const stderr = error.details?.["stderr"];
  return typeof stderr === "string" && FFMPEG_HOST_FAILURE.test(stderr);
}

/**
 * Every address for one rendition, primary first, in the order the source
 * declared them — deduplicated, because the same address twice is one host and
 * retrying it is the failure this exists to avoid.
 */
export function downloadCandidates(variant: {
  url: string;
  alternateUrls?: readonly string[] | undefined;
}): string[] {
  const seen = new Set<string>([variant.url]);
  const candidates = [variant.url];
  for (const alternate of variant.alternateUrls ?? []) {
    if (alternate === "" || seen.has(alternate)) continue;
    seen.add(alternate);
    candidates.push(alternate);
  }
  return candidates;
}
