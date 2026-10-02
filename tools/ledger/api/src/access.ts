/**
 * Who is asking: the Cloudflare Access identity, verified (lg-3).
 *
 * Access puts a signed token on every request it lets through, in
 * `Cf-Access-Jwt-Assertion`. The plain email header beside it is not read at
 * all: anything that reaches the origin without passing through Access — the
 * loopback port, to start with — can write that header, and nothing can write a
 * token the team's keys verify.
 *
 * The verification is done here with `node:crypto` rather than a JWT library.
 * Access signs with RS256 and nothing else, so what a library would add is
 * algorithm negotiation — the part of JWT verification with the history of
 * bypasses (`alg: none`, an RSA public key used as an HMAC secret). This module
 * accepts exactly one algorithm and refuses anything else before it looks for a
 * key. The cryptography itself is Node's.
 *
 * Every failure that is the token's fault is one `UNAUTHENTICATED`, with no
 * details on the payload: which check failed is logged for the operator and
 * never told to the caller, because that would tell a forger which part to fix.
 */

import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { JsonWebKeyInput, KeyObject } from "node:crypto";
import { AppError } from "@ledger/contract";
import type { Person } from "@ledger/contract";
import type { AccessConfig } from "./config.ts";
import type { AppLogger } from "./logger.ts";

/** The one header this module reads. Node lower-cases header names. */
export const ACCESS_TOKEN_HEADER = "cf-access-jwt-assertion";

/** The only algorithm Access signs with, and so the only one accepted. */
const ALGORITHM = "RS256";

/**
 * How long a fetched key set is trusted before it is fetched again on the next
 * request. Access rotates its signing keys every six weeks and keeps the old
 * one valid for a week after; an hour bounds how long a key Cloudflare revoked
 * stays trusted here while the key endpoint answers, at the cost of one fetch
 * an hour. While it does not, `JWKS_STALE_LIMIT_MS` is the bound.
 */
const JWKS_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * The least time between two fetches, whatever asks for them. A token naming a
 * key id nobody has heard of triggers a refresh — that is how a rotation is
 * picked up without a restart — and anyone can send such a token, so without a
 * floor every one of them would be a request to Cloudflare made on a
 * stranger's behalf.
 */
const JWKS_MIN_REFETCH_MS = 30 * 1000;

/** A key-set fetch that has not answered by now is treated as a failure. */
const JWKS_TIMEOUT_MS = 5000;

/**
 * How long a key set may go unrefreshed and still be trusted while the key
 * endpoint is failing (gate 1, F4; the owner's decision). Up to this, an outage
 * at Cloudflare does not lock the household out; past it, a key Cloudflare may
 * have revoked meanwhile is no longer taken on faith, and every request is
 * refused as `UNREACHABLE` until a refresh succeeds.
 */
const JWKS_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * Clock leeway on `nbf` only (gate 1, F6). Access stamps `nbf` at the moment it
 * signs, so an origin clock a moment behind Cloudflare's would otherwise refuse
 * a sign-in that is seconds old. `exp` gets none: an hour-long token loses
 * nothing by expiring on time.
 */
const NBF_LEEWAY_SEC = 10;

/**
 * A base64url segment, strictly. Node's decoder skips characters outside the
 * alphabet and accepts padding and `+/`, so without this a token could be
 * written several ways and still verify (gate 1, F8) — harmless to the
 * signature, but not to anything that one day keys on the token's string.
 */
const SEGMENT = /^[A-Za-z0-9_-]+$/u;

export type Fetch = typeof globalThis.fetch;

/** The fixed host the keys come from. Built from configuration only. */
export function accessIssuer(teamName: string): string {
  return `https://${teamName}.cloudflareaccess.com`;
}

export function accessJwksUrl(teamName: string): string {
  return `${accessIssuer(teamName)}/cdn-cgi/access/certs`;
}

/** Why a token was refused. Logged, never sent. */
type Refusal =
  | "missing"
  | "malformed"
  | "algorithm"
  | "unknown-key"
  | "signature"
  | "audience"
  | "issuer"
  | "expired"
  | "not-yet-valid"
  | "no-email"
  | "not-configured";

/** Internal to this module: always turned into `UNAUTHENTICATED` before it leaves. */
class TokenRefused extends Error {
  readonly reason: Refusal;

  constructor(reason: Refusal) {
    super(reason);
    this.reason = reason;
  }
}

function decodeJson(segment: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new TokenRefused("malformed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TokenRefused("malformed");
  }
  return value as Record<string, unknown>;
}

/**
 * The team's signing keys, fetched once and kept.
 *
 * At most one fetch is in flight at a time — concurrent callers share it — and
 * a new one starts only when the set is older than `JWKS_MAX_AGE_MS` or a token
 * names a key the set lacks, and in either case never sooner than
 * `JWKS_MIN_REFETCH_MS` after the last attempt. So no request makes more than
 * one fetch, and no number of requests makes more than one fetch per window.
 *
 * When a refresh succeeds, the new set is the whole answer: a key it no longer
 * holds is gone, whatever was cached before (gate 1, F1). Only when no refresh
 * succeeded does the held set stand in, and only for `JWKS_STALE_LIMIT_MS`.
 */
export class JwksCache {
  readonly #url: string;
  readonly #fetch: Fetch;
  readonly #now: () => Date;
  readonly #logger: AppLogger;
  #keys = new Map<string, KeyObject>();
  #fetchedAt = Number.NEGATIVE_INFINITY;
  #attemptedAt = Number.NEGATIVE_INFINITY;
  /** Whether the most recent fetch failed — what a key never seen is judged by. */
  #lastAttemptFailed = false;
  #inFlight: Promise<void> | undefined;

  constructor(options: { url: string; fetch: Fetch; now: () => Date; logger: AppLogger }) {
    this.#url = options.url;
    this.#fetch = options.fetch;
    this.#now = options.now;
    this.#logger = options.logger;
  }

  /**
   * The key for `kid`, or `undefined` when the team has none by that id.
   * Throws `UNREACHABLE` when the answer cannot be known: the key endpoint is
   * failing and the set held is either missing the key or too old to trust.
   */
  async key(kid: string): Promise<KeyObject | undefined> {
    const now = this.#now().getTime();
    const cached = this.#keys.get(kid);
    if (cached !== undefined && now - this.#fetchedAt < JWKS_MAX_AGE_MS) return cached;

    if (this.#inFlight === undefined && now - this.#attemptedAt >= JWKS_MIN_REFETCH_MS) {
      this.#attemptedAt = now;
      this.#inFlight = this.#refresh().finally(() => {
        this.#inFlight = undefined;
      });
    }
    if (this.#inFlight !== undefined) {
      try {
        await this.#inFlight;
        // A fresh set is the whole answer: never the key held before it (F1).
        return this.#keys.get(kid);
      } catch {
        // Judged below, the same as a caller held back by the floor.
      }
    }
    return this.#withoutAFreshSet(kid, now);
  }

  /** No refresh succeeded for this caller: it failed, or the floor held it back. */
  #withoutAFreshSet(kid: string, now: number): KeyObject | undefined {
    const held = this.#keys.get(kid);
    if (held !== undefined) {
      // Through an outage of the key endpoint, a key already held stays usable
      // — for a day, and no longer (F4).
      if (now - this.#fetchedAt < JWKS_STALE_LIMIT_MS) return held;
      throw new AppError("UNREACHABLE");
    }
    // A key never seen, while the endpoint that would say whether it exists is
    // failing, cannot be checked. That is not the token's fault and is not
    // answered as if it were — for every caller in the window, not only the one
    // whose request made the fetch (F4).
    if (this.#lastAttemptFailed) throw new AppError("UNREACHABLE");
    return undefined;
  }

  async #refresh(): Promise<void> {
    try {
      this.#keys = await this.#fetchKeys();
      this.#fetchedAt = this.#now().getTime();
      this.#lastAttemptFailed = false;
    } catch (error) {
      this.#lastAttemptFailed = true;
      throw error;
    }
  }

  /**
   * One fetch of the key set. A failure is logged here, with what went wrong,
   * and leaves as a bare `UNREACHABLE`: the caller proved nothing, and the
   * upstream's status or the shape of its answer is not theirs to read (F4).
   */
  async #fetchKeys(): Promise<Map<string, KeyObject>> {
    const fail = (reason: string, fields: Record<string, unknown> = {}): never => {
      this.#logger.warn("access keys could not be fetched", { reason, ...fields });
      throw new AppError("UNREACHABLE");
    };

    let body: unknown;
    try {
      const response = await this.#fetch(this.#url, {
        // The host is fixed; a redirect would be the one way to leave it.
        redirect: "error",
        signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
      });
      if (!response.ok) fail("status", { status: response.status });
      body = await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail("fetch", { error: error instanceof Error ? error.name : String(error) });
    }

    const keys = new Map<string, KeyObject>();
    const entries = (body as { keys?: unknown } | null)?.keys;
    for (const jwk of Array.isArray(entries) ? entries : []) {
      const { kid, kty } = (jwk ?? {}) as { kid?: unknown; kty?: unknown };
      if (typeof kid !== "string" || kty !== "RSA") continue;
      try {
        keys.set(kid, createPublicKey({ key: jwk as JsonWebKeyInput["key"], format: "jwk" }));
      } catch {
        // One unreadable key does not cost the others.
      }
    }
    if (keys.size === 0) fail("no-usable-key");
    return keys;
  }
}

export interface IdentityVerifier {
  /** The person the request is from, or throws `UNAUTHENTICATED` / `FORBIDDEN`. */
  identify(token: string | string[] | undefined): Promise<Person>;
}

/**
 * Builds the verifier the configuration asks for: a fixed development identity,
 * the real check against Access, or — when neither is configured — a door that
 * refuses everyone, so a deployment missing its settings fails closed.
 */
export function createIdentityVerifier(options: {
  config: AccessConfig;
  fetch: Fetch;
  now: () => Date;
  logger: AppLogger;
}): IdentityVerifier {
  const { config, logger, now } = options;

  const personFor = (email: string): Person => {
    const id = config.people.get(email.toLowerCase());
    if (id === undefined) {
      // The address is the operator's to see, so the mapping can be fixed; it
      // is not echoed back to the caller.
      logger.info("access identity has no person", { email });
      throw new AppError("FORBIDDEN");
    }
    return { id, email };
  };

  if (config.devIdentity !== undefined) {
    const person = personFor(config.devIdentity);
    logger.warn("DEV_IDENTITY is set; every request is this person and no token is read", {
      person: person.id,
    });
    return { identify: async () => person };
  }

  const { team, audience } = config;
  if (team === undefined || audience === undefined) {
    logger.warn("ACCESS_TEAM and ACCESS_AUD are not set; every API route but health is refused");
    return {
      async identify() {
        logger.info("access token refused", { reason: "not-configured" satisfies Refusal });
        throw new AppError("UNAUTHENTICATED");
      },
    };
  }

  const issuer = accessIssuer(team);
  const jwks = new JwksCache({ url: accessJwksUrl(team), fetch: options.fetch, now, logger });

  async function verifiedEmail(header: string | string[] | undefined): Promise<string> {
    // A repeated header is not a token, it is two claims; refuse rather than pick.
    if (typeof header !== "string" || header === "") throw new TokenRefused("missing");
    const parts = header.split(".");
    if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) {
      throw new TokenRefused("malformed");
    }
    const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = parts;

    const head = decodeJson(encodedHeader);
    // Before any key is looked up: the algorithm is ours to choose, never the
    // token's.
    if (head["alg"] !== ALGORITHM) throw new TokenRefused("algorithm");
    const kid = head["kid"];
    if (typeof kid !== "string" || kid === "") throw new TokenRefused("malformed");

    const key = await jwks.key(kid);
    if (key === undefined) throw new TokenRefused("unknown-key");
    const signed = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      key,
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!signed) throw new TokenRefused("signature");

    const claims = decodeJson(encodedPayload);
    const aud = claims["aud"];
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(audience)) throw new TokenRefused("audience");
    if (claims["iss"] !== issuer) throw new TokenRefused("issuer");

    const nowSec = now().getTime() / 1000;
    const exp = claims["exp"];
    if (typeof exp !== "number" || nowSec >= exp) throw new TokenRefused("expired");
    const nbf = claims["nbf"];
    if (nbf !== undefined && (typeof nbf !== "number" || nowSec + NBF_LEEWAY_SEC < nbf)) {
      throw new TokenRefused("not-yet-valid");
    }

    const email = claims["email"];
    if (typeof email !== "string" || email === "") throw new TokenRefused("no-email");
    return email;
  }

  return {
    async identify(header) {
      let email: string;
      try {
        email = await verifiedEmail(header);
      } catch (error) {
        if (!(error instanceof TokenRefused)) throw error;
        // The reason only. Never the token, never the header.
        logger.info("access token refused", { reason: error.reason });
        throw new AppError("UNAUTHENTICATED");
      }
      return personFor(email);
    },
  };
}
