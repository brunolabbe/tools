/**
 * The human check in front of probe and job creation (dl-50).
 *
 * A probe launches a real Chromium on a URL the caller names — ~15 s and
 * ~300 MB — and the per-minute buckets in front of it are keyed on the client
 * address, so they slow one address and do nothing against a script spread
 * across many. A login was the defence against that, and the owner ruled one
 * out. This is what replaces it: Cloudflare Turnstile, whose widget hands the
 * page a single-use token that this file redeems against `siteverify` before
 * any work starts.
 *
 * **It fails closed.** A timeout, a network error, a non-2xx answer or a body
 * this file cannot read are all refusals, never a pass. The site is itself
 * served through Cloudflare, so an outage that stops verification usually
 * takes the page down too; failing open would let a script past the check by
 * waiting for one. All of them surface as the one `HUMAN_CHECK_FAILED`, with
 * nothing in the response saying which — the reason is in the log line.
 *
 * **The token is a credential.** It is passed in and posted out, and nothing
 * here writes it anywhere else: not the log, not an error's details, not a
 * cause. `human-check.test.ts` asserts that over captured logger output.
 *
 * **Not a user-influenced URL, so not `guardedFetch`.** The endpoint is a
 * constant, which is the case the SSRF rule does not cover — and routing it
 * through the egress dispatcher would also route it through `PROXY_URL`,
 * which exists to pin *source* egress to the address a signed media URL was
 * issued to. This is the service's own call. An operator whose host can reach
 * nothing directly finds out from the refusal's log line, which names it.
 *
 * `remoteip` is deliberately not sent. Cloudflare treats it as optional, and
 * sending it would hand every visitor's address to a third party from a
 * deployment that is not otherwise behind Cloudflare — a self-hoster's choice
 * this file should not make for them.
 */

import { AppError } from "@downloader/contract";
import type { ApiConfig } from "./config.ts";
import type { AppLogger } from "./logger.ts";

/** Cloudflare's verification endpoint. A constant, never a setting. */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * How long a refusal can take when Cloudflare does not answer. A healthy call
 * measured 150 ms from the devcontainer on 2026-09-22; five seconds is long
 * enough to ride out a slow edge and short enough that a hung verifier does
 * not hold a request — which holds no slot yet, but does hold a socket.
 */
export const SITEVERIFY_TIMEOUT_MS = 5_000;

interface SiteverifyVerdict {
  success: boolean;
  errorCodes: string[];
}

/**
 * Only the one field a decision reads, plus the one a log line wants. Anything
 * else Cloudflare adds is ignored rather than rejected: a vendor that grows its
 * response must not turn every request into a refusal. By hand rather than
 * zod, which this package does not otherwise depend on, for two fields.
 */
function readVerdict(body: unknown): SiteverifyVerdict | null {
  if (typeof body !== "object" || body === null) return null;
  const { success, "error-codes": codes } = body as Record<string, unknown>;
  if (typeof success !== "boolean") return null;
  const errorCodes = Array.isArray(codes)
    ? codes.filter((code): code is string => typeof code === "string")
    : [];
  return { success, errorCodes };
}

/** Why a check was refused, for the log line. Never sent to the client. */
export type HumanCheckRefusal =
  | "missing-token"
  | "rejected"
  | "timeout"
  | "unreachable"
  | "verifier-error"
  | "unreadable-response";

export interface HumanCheck {
  /** The public half, for `GET /api/config`. `null` when no check is configured. */
  readonly siteKey: string | null;
  /**
   * Resolves when the request may proceed and throws `HUMAN_CHECK_FAILED` when
   * it may not. Resolves immediately, with no network call, when no check is
   * configured — the setting's documented "unset keeps today's behaviour".
   */
  require(token: string | undefined, logger: AppLogger): Promise<void>;
}

export interface HumanCheckOptions {
  turnstile: ApiConfig["turnstile"];
  /** Injected in tests, to stand in for Cloudflare without a network. */
  fetchImpl?: typeof fetch;
  /** Injected in tests, so the timeout path runs in milliseconds. */
  timeoutMs?: number;
}

/**
 * Logs why, and throws the one code that does not say why. `fields` must
 * never carry the token; every call site passes a reason, a status, a
 * duration or Cloudflare's own error codes.
 */
function refuse(
  logger: AppLogger,
  reason: HumanCheckRefusal,
  fields: Record<string, unknown> = {},
): never {
  // `warn`, not `info`: on a public deployment a burst of these is the attack
  // this check exists for, and it should be visible at the default level.
  logger.warn("human check refused", { reason, ...fields });
  throw new AppError("HUMAN_CHECK_FAILED");
}

export function createHumanCheck(options: HumanCheckOptions): HumanCheck {
  const { turnstile } = options;
  if (turnstile === undefined) {
    return {
      siteKey: null,
      require: async () => {},
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SITEVERIFY_TIMEOUT_MS;

  return {
    siteKey: turnstile.siteKey,
    async require(token, logger) {
      if (token === undefined) refuse(logger, "missing-token");

      const body = new URLSearchParams({ secret: turnstile.secretKey, response: token });
      let response: Response;
      try {
        response = await fetchImpl(SITEVERIFY_URL, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error: unknown) {
        // `AbortSignal.timeout` rejects with a `TimeoutError` DOMException, and
        // it is the only abort this call can see — there is no client signal
        // wired in, on purpose: a client that hangs up mid-check has spent its
        // token either way.
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        // The error's name only. A fetch error's message and cause can carry
        // the request it was making, and the request carries the token.
        refuse(logger, timedOut ? "timeout" : "unreachable", {
          error: error instanceof Error ? error.name : typeof error,
          ...(timedOut ? { timeoutMs } : {}),
        });
      }

      if (!response.ok) refuse(logger, "verifier-error", { status: response.status });

      const verdict = readVerdict(await response.json().catch(() => null));
      if (verdict === null) refuse(logger, "unreadable-response", { status: response.status });

      if (!verdict.success) {
        // Cloudflare's own vocabulary — `invalid-input-response`,
        // `timeout-or-duplicate` and the like — which says whether the token was
        // forged, stale or replayed. Safe to log: it describes the token and
        // never contains it.
        refuse(logger, "rejected", { errorCodes: verdict.errorCodes });
      }
    },
  };
}
