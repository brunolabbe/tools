/**
 * A `fetch` that re-runs the SSRF guard on every redirect hop.
 *
 * Checking only the URL a client supplied is the most common way an SSRF guard
 * is defeated: `https://evil.example/go` passes the check and answers
 * `302 Location: http://169.254.169.254/latest/meta-data/`, and the platform
 * `fetch` follows it without asking anyone. The only fix is to stop following
 * redirects automatically and vet each hop, which is what this does.
 *
 * Injected into `DirectUrlResolver` (which fetches manifests) and into the
 * engine's `fetchImpl` (progressive downloads, segments, subtitles). ffmpeg
 * does its own fetching and cannot be wrapped this way, which is the reason the
 * guard also vets every URL a resolver returns before the engine is handed
 * anything. That hole is closed separately, by `egress-proxy.ts` — see
 * `tools/downloader/docs/work/dl-11-guarded-egress-proxy.md`.
 *
 * The per-hop check here and the dispatcher from `dispatcher.ts` are two halves
 * of one answer: this decides *whether* a URL may be fetched, the dispatcher
 * decides *which address* the socket is allowed to end up at. Neither replaces
 * the other — a redirect chain is invisible to the dispatcher, and a rebound
 * DNS answer is invisible to the check.
 */

import { AppError } from "@downloader/contract";
import type { FetchDispatcher } from "./dispatcher.ts";
import type { SsrfGuard } from "./ssrf.ts";

/** Matches the engine's `FetchLike` and the resolvers' `typeof fetch`. */
export type GuardedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Same ceiling the platform `fetch` uses, so behaviour is unsurprising. */
const MAX_REDIRECTS = 20;

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export interface GuardedFetchOptions {
  /**
   * Pins every connection to an address this process vetted, and applies the
   * egress proxy. Omitted in tests, which stub `underlying` and so never open a
   * socket for a dispatcher to govern.
   */
  dispatcher?: FetchDispatcher | undefined;
}

/**
 * OpenSSL's chain-verification failures, plus Node's own name check.
 *
 * **Why a list of strings and not a socket.** `tls-interception.ts` says of the
 * same problem that Node's error for a rejected chain carries `code` and
 * nothing else — the same *shape* an `ECONNREFUSED` has — and escapes it by
 * reading `TLSSocket.authorizationError` off a socket the egress proxy owns.
 * Nothing here owns a socket: undici does, and what reaches this file is an
 * object whose only own key is `code` (measured, not assumed). So the shape is
 * useless and the value is not: these codes are OpenSSL's, disjoint from the
 * errno set a connection failure produces.
 *
 * **Under-matching is the safe direction and the list is deliberately closed.**
 * A certificate failure this misses stays `UNREACHABLE` and retryable, which is
 * merely today's behaviour; a network blip wrongly matched here becomes
 * permanent and fails a job that would have succeeded on the next attempt.
 */
const TLS_VERIFY_CODES: ReadonlySet<string> = new Set([
  "CERT_CHAIN_TOO_LONG",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "PATH_LENGTH_EXCEEDED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * Node raises its own name-mismatch rather than an OpenSSL verify code, and it
 * is the one certificate error that arrives with the peer certificate attached.
 * `ERR_TLS_CERT_ALTNAME_INVALID` is the case; the prefix covers the family.
 */
function isCertificateVerificationFailure(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return TLS_VERIFY_CODES.has(code) || code.startsWith("ERR_TLS_CERT_");
}

/**
 * A connector failure reaches `fetch` as a bare `TypeError: fetch failed` with
 * the real reason hidden on `cause`. Our own address check is one of those, so
 * without this unwrap a blocked rebind would surface to the client as a generic
 * network error rather than as `BLOCKED_TARGET`.
 *
 * **A refused certificate is the second, and it was missed for six tickets.**
 * The `AppError` test below is a test for errors *this repo threw*, and a TLS
 * rejection is Node's, so it fell through to the caller as a bare `TypeError`
 * and every caller classified it as a transport failure. Core's taxonomy has
 * said in words the whole time that this is wrong — `UNREACHABLE`'s own
 * docstring names `TLS_VERIFICATION_FAILED` as the code for a certificate that
 * *did* arrive and did not verify, and says the retry answer differs. Every
 * existing raise of it was on ffmpeg's path (`ffmpeg/runner.ts` off stderr,
 * `egress-proxy.ts` off a socket), because ffmpeg's TLS is what dl-19, dl-21
 * and dl-27 were each about. undici verifies without being asked, so no ticket
 * ever looked at what happens when it refuses. dl-31 is that ticket.
 */
function unwrapCause(error: unknown): never {
  const cause: unknown = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof AppError) throw cause;
  if (isCertificateVerificationFailure(cause)) {
    throw new AppError("TLS_VERIFICATION_FAILED", undefined, {
      cause,
      // No URL: this is reached for a hop the caller may not have named, and a
      // signed URL carries its credential in the query string. The verify code
      // is the diagnostic and it is a fixed OpenSSL token.
      details: { reason: (cause as { code: string }).code },
    });
  }
  throw error;
}

export function createGuardedFetch(
  guard: SsrfGuard,
  underlying: GuardedFetch = globalThis.fetch,
  options: GuardedFetchOptions = {},
): GuardedFetch {
  const { dispatcher } = options;

  return async function guardedFetch(input, init) {
    let currentUrl = requestUrl(input);
    let currentInit: RequestInit = {
      ...init,
      redirect: "manual",
      ...(dispatcher === undefined ? {} : { dispatcher }),
    };

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Throws BLOCKED_TARGET / INVALID_URL before any socket is opened.
      // eslint-disable-next-line no-await-in-loop -- hops are inherently sequential
      // oxlint-disable-next-line no-await-in-loop
      await guard.assertAllowed(currentUrl);

      // oxlint-disable-next-line no-await-in-loop
      const response = await underlying(currentUrl, currentInit).catch(unwrapCause);
      const location = response.headers.get("location");
      if (!isRedirect(response.status) || location === null) return response;

      let next: string;
      try {
        next = new URL(location, currentUrl).href;
      } catch {
        throw new AppError("UNREACHABLE", "The site sent an unusable redirect.", {
          details: { status: response.status },
        });
      }

      // 303, and 301/302 on a POST, become a GET without a body — mirroring
      // what the platform fetch does, so swapping this in changes nothing but
      // the checking.
      currentInit = nextInit(currentInit, response.status);
      currentUrl = next;
    }

    throw new AppError("UNREACHABLE", "That address redirected too many times.", {
      details: { maxRedirects: MAX_REDIRECTS },
    });
  };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function nextInit(init: RequestInit, status: number): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const downgrades = status === 303 || ((status === 301 || status === 302) && method === "POST");
  if (!downgrades) return init;
  const { body: _dropped, ...rest } = init;
  return { ...rest, method: "GET" };
}
