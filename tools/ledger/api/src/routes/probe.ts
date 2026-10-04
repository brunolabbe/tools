/**
 * DO NOT MERGE. repo-91 measurement probe: variant A, the positive control.
 * A route doing file-system work, limited only by `@webtools/core/rate-limit`
 * the way every tool does it today.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  app.get("/api/probe-a", { onRequest: read }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
