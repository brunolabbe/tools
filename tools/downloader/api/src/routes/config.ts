/**
 * `GET /api/config` — what the page needs to know before its first request.
 *
 * Today that is one thing: whether this deployment asks for a human check, and
 * the Turnstile *site* key to render its widget with (dl-50). The key is read
 * at request time from the API's own configuration rather than baked into the
 * bundle, so one image serves every operator and a self-hoster turns the check
 * on with two environment variables and no rebuild. A bundle that carried the
 * key would also fail badly: built without it and run against an API with a
 * secret, every probe is refused behind a widget that never rendered.
 *
 * The site key is public by design — Cloudflare's own integration puts it in
 * the page's markup — so answering it to anyone is not a disclosure. The
 * secret key is not in `context.humanCheck` in any form a route could read.
 *
 * No rate limit, like `/api/health` and for a stronger reason: it answers a
 * constant computed once at boot, so it costs less than the bucket that would
 * guard it, and the page cannot work without it.
 */

import { ROUTES } from "@downloader/contract";
import type { ClientConfigResponse } from "@downloader/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export function registerClientConfigRoute(app: FastifyInstance, context: AppContext): void {
  const { siteKey } = context.humanCheck;
  const body: ClientConfigResponse = { humanCheck: siteKey === null ? null : { siteKey } };

  app.get(ROUTES.config, async (_request, reply) => await reply.send(body));
}
