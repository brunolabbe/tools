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
import { personOf } from "../identity.ts";

export function registerMeRoute(app: FastifyInstance): void {
  app.get(ROUTES.me, async (request) => {
    const body: MeResponse = { person: personOf(request) };
    return body;
  });
}
