/**
 * `GET /api/me`: the caller, as the identity check found them (lg-3).
 *
 * The first route behind the check, and the one the UI asks to say whose
 * session this is. It answers with what the household directory holds for the
 * address, and whether the address is an admin (lg-20). An admin in no household
 * is refused here as on every books route, which the UI reads as "no household".
 */

import { ROUTES } from "@ledger/contract";
import type { MeResponse } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { identityOf, personOf } from "../identity.ts";
import { rateLimitsFor } from "../rate-limit.ts";

export function registerMeRoute(app: FastifyInstance, context: AppContext): void {
  app.get(ROUTES.me, { onRequest: rateLimitsFor(context).read }, async (request) => {
    const body: MeResponse = { person: personOf(request), admin: identityOf(request).admin };
    return body;
  });
}
