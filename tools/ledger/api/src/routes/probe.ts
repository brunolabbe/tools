/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant G2: no plugin
 * registered, and the route carries a bare `rateLimit` option next to core's
 * `onRequest` hook. This tests only what the model matches; `rateLimit` here is
 * not a Fastify route option.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get(
    "/api/probe-g2",
    { onRequest: read, rateLimit: { max: 10, timeWindow: "1 minute" } },
    async () => {
      return { text: readFileSync(PROBE_FILE, "utf8") };
    },
  );
}
