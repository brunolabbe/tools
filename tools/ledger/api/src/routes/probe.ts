/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant G1: no plugin
 * registered, and the route carries `config: { rateLimit: ... }` next to core's
 * `onRequest` hook. This tests only what the model matches.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get(
    "/api/probe-g1",
    { onRequest: read, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async () => {
      return { text: readFileSync(PROBE_FILE, "utf8") };
    },
  );
}
