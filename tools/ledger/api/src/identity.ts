/**
 * The identity check, as a hook, and the identity it leaves on the request
 * (lg-3, lg-20).
 *
 * One `onRequest` hook for the whole app rather than a guard per route, so a
 * route added later is checked without anyone remembering to ask for it. What
 * it keys on is the **route the request matched**, never the URL it arrived
 * with: a path spelled another way — percent-encoded, doubled slashes — reaches
 * a handler only through a route, and the route's own pattern is what says
 * whether it is an API route.
 *
 * The hook lets through two kinds of identity: a member of a household, and an
 * admin, who may be a member of none (lg-20). A route reads the member through
 * `personOf`, which refuses the admin with no household, so every books route
 * refuses them; lg-22's `adminOf` is the one guard that reads the admin flag.
 */

import { API_PREFIX, AppError, ROUTES } from "@ledger/contract";
import type { Person } from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ACCESS_TOKEN_HEADER } from "./access.ts";
import type { Identity, IdentityVerifier } from "./access.ts";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Who sent the request, on every route the check covers; `null` on the
     * ones it does not. Read it through `personOf`, which refuses the `null`
     * and an identity with no household.
     */
    identity: Identity | null;
  }
}

/**
 * Whether the matched route needs an identity: every API route but health.
 *
 * Not the UI's files. The bundle is the built output of this repository, which
 * holds no data and is public anyway, and the page that loads it learns
 * nothing until it calls an API route — which is checked. A request that
 * matched no route at all reads nothing either: it is answered by the
 * not-found handler.
 */
function requiresIdentity(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (route === undefined) return false;
  return route.startsWith(`${API_PREFIX}/`) && route !== ROUTES.health;
}

export interface IdentityCheckOptions {
  /**
   * Called with each request's member, after the check: what keeps the books'
   * `people` in step with a directory that changed since boot (`people.ts`).
   */
  onMember?: (person: Person) => void;
}

export function registerIdentityCheck(
  server: FastifyInstance,
  verifier: IdentityVerifier,
  options: IdentityCheckOptions = {},
): void {
  server.decorateRequest("identity", null);
  server.addHook("onRequest", async (request) => {
    if (!requiresIdentity(request)) return;
    const identity = await verifier.identify(request.headers[ACCESS_TOKEN_HEADER]);
    request.identity = identity;
    if (identity.person !== null) options.onMember?.(identity.person);
  });
}

/**
 * The person a route is serving. Throws rather than returning `null`, so a
 * route that somehow ran without the check fails closed instead of recording
 * an action against nobody — and `FORBIDDEN` for an admin who is in no
 * household, who reads no books.
 */
export function personOf(request: FastifyRequest): Person {
  if (request.identity === null) throw new AppError("UNAUTHENTICATED");
  if (request.identity.person === null) throw new AppError("FORBIDDEN");
  return request.identity.person;
}

/** The identity the check left, or `UNAUTHENTICATED` on a route it did not cover. */
export function identityOf(request: FastifyRequest): Identity {
  if (request.identity === null) throw new AppError("UNAUTHENTICATED");
  return request.identity;
}
