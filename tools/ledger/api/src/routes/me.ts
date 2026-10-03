/**
 * `GET /api/me`: the caller, as the identity check found them (lg-3).
 *
 * The first route behind the check, and the one the UI will ask to say whose
 * session this is. It answers with what the configuration maps the address
 * to, which is all this tool knows about anyone.
 */

import { ROUTES } from "@ledger/contract";
import type { MeResponse } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { personOf } from "../identity.ts";
import { rateLimitsFor } from "../rate-limit.ts";

export function registerMeRoute(app: FastifyInstance, context: AppContext): void {
  app.get(ROUTES.me, { onRequest: rateLimitsFor(context).read }, async (request) => {
    const body: MeResponse = { person: personOf(request) };
    return body;
  });
}
