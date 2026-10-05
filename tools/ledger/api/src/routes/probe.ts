/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant G6: the plugin is
 * registered once in `server.ts`, on the root instance before any route, and this
 * file, which never mentions it, holds a route as the tools write it today.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get("/api/probe-g6", { onRequest: read }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
