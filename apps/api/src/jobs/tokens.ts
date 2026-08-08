/**
 * Capability tokens for downloaded files.
 *
 * The token *is* the authorisation. There is no session, no ACL and no owner
 * check on `/api/files/:token`, so the only thing standing between an
 * unauthorised client and someone else's video is that the token cannot be
 * guessed.
 *
 * Two rules follow, and the brief states both:
 *  - **32 random bytes from a CSPRNG.** Not a uuid, not a hash, not a counter.
 *  - **Never derived from the job id.** Job ids appear in URLs the client
 *    already holds and in logs; deriving the token from one would make every
 *    file readable by anyone who has ever seen its job.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_BYTES = 32;

/** base64url: URL-safe, no padding, and shorter than hex for the same entropy. */
export function createFileToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Length of a well-formed token, used to reject junk before touching the database. */
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 8) / 6);

export function isWellFormedToken(value: string): boolean {
  return value.length === TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/u.test(value);
}

/**
 * Constant-time comparison.
 *
 * The database lookup is by primary key, so the timing signal here is small —
 * but a capability token is exactly the kind of secret where "small" is not an
 * argument worth having, and this costs nothing.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
