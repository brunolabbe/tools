/**
 * A stand-in for Cloudflare Access: a signing key the test owns, the key set it
 * would publish, and tokens signed the way Access signs them.
 *
 * Nothing here reaches the network. `jwksFetch` is handed to `createApp` as its
 * `fetch`, records every URL it is asked for, and answers only the one URL the
 * configuration should have built — so a test can prove both that the key set
 * came from the right host and that it was fetched no more often than it should
 * have been.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { AccessConfig } from "../../src/config.ts";

export const TEAM = "household-test";
export const AUDIENCE = "aud-tag-for-the-ledger-test";
export const ISSUER = `https://${TEAM}.cloudflareaccess.com`;
export const JWKS_URL = `${ISSUER}/cdn-cgi/access/certs`;

/** Invented addresses, mapped to invented people. */
export const ALEX = "alex@example.test";
export const SAM = "sam@example.test";
export const STRANGER = "stranger@example.test";

export function accessConfig(overrides: Partial<AccessConfig> = {}): AccessConfig {
  return {
    team: TEAM,
    audience: AUDIENCE,
    people: new Map([
      [ALEX, "alex"],
      [SAM, "sam"],
    ]),
    devIdentity: undefined,
    ...overrides,
  };
}

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export function testKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export interface TokenOptions {
  key: TestKey;
  /** Signs with this key's private half while naming `key`'s id. */
  signWith?: TestKey;
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  /** Seconds since the epoch the token is issued at. */
  nowSec: number;
}

/** A token shaped like an Access application token, signed RS256. */
export function signToken({ key, signWith, header, claims, nowSec }: TokenOptions): string {
  const head = encode({ alg: "RS256", kid: key.kid, typ: "JWT", ...header });
  const body = encode({
    aud: [AUDIENCE],
    email: ALEX,
    iss: ISSUER,
    iat: nowSec,
    nbf: nowSec,
    exp: nowSec + 3600,
    sub: "an-invented-subject",
    type: "app",
    ...claims,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    (signWith ?? key).privateKey,
  ).toString("base64url");
  return `${head}.${body}.${signature}`;
}

/**
 * A `fetch` serving `keys()` at `JWKS_URL` and failing everything else. `keys`
 * is read on every call, so a test can rotate the set between requests.
 */
export function jwksFetch(keys: () => TestKey[]): {
  fetch: typeof globalThis.fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (url !== JWKS_URL) return new Response("not this host", { status: 404 });
    return Response.json({ keys: keys().map((key) => key.jwk) });
  };
  return { fetch, urls };
}
