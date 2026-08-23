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
 * A connector failure reaches `fetch` as a bare `TypeError: fetch failed` with
 * the real reason hidden on `cause`. Our own address check is one of those, so
 * without this unwrap a blocked rebind would surface to the client as a generic
 * network error rather than as `BLOCKED_TARGET`.
 */
function unwrapCause(error: unknown): never {
  const cause: unknown = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof AppError) throw cause;
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
