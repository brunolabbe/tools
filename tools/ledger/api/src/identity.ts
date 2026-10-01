/**
 * The identity check, as a hook, and the person it leaves on the request
 * (lg-3).
 *
 * One `onRequest` hook for the whole app rather than a guard per route, so a
 * route added later is checked without anyone remembering to ask for it. What
 * it keys on is the **route the request matched**, never the URL it arrived
 * with: a path spelled another way — percent-encoded, doubled slashes — reaches
 * a handler only through a route, and the route's own pattern is what says
 * whether it is an API route.
 */

import { API_PREFIX, AppError, ROUTES } from "@ledger/contract";
import type { Person } from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ACCESS_TOKEN_HEADER } from "./access.ts";
import type { IdentityVerifier } from "./access.ts";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Who sent the request, on every route the check covers; `null` on the
     * ones it does not. Read it through `personOf`, which refuses the `null`.
     */
    person: Person | null;
  }
}

/**
 * Whether the matched route needs a person: every API route but health.
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

export function registerIdentityCheck(server: FastifyInstance, verifier: IdentityVerifier): void {
  server.decorateRequest("person", null);
  server.addHook("onRequest", async (request) => {
    if (!requiresIdentity(request)) return;
    request.person = await verifier.identify(request.headers[ACCESS_TOKEN_HEADER]);
  });
}

/**
 * The person a route is serving. Throws rather than returning `null`, so a
 * route that somehow ran without the check fails closed instead of recording
 * an action against nobody.
 */
export function personOf(request: FastifyRequest): Person {
  if (request.person === null) throw new AppError("UNAUTHENTICATED");
  return request.person;
}
