/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant G4: the plugin
 * registered once on the instance, and the route left exactly as the tools write
 * it today, `{ onRequest: read }` with core's hook and no `rateLimit` option.
 * `@fastify/rate-limit` is not installed.
 */

import { readFileSync } from "node:fs";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.register(rateLimit, { max: 10, timeWindow: "1 minute" });

  app.get("/api/probe-g4", { onRequest: read }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
