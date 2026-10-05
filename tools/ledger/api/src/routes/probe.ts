/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant G5: the plugin is
 * imported and never registered or used, and the route is as the tools write it
 * today. If this passes, the model is satisfied by the import alone.
 */

import { readFileSync } from "node:fs";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get("/api/probe-g5", { onRequest: read }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
