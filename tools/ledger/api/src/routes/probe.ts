/**
 * DO NOT MERGE. repo-91 measurement probe, round 2, variant H: four routes,
 * every one limited only by core's limiter in `{ onRequest }`, differing in the
 * handler's parameter list and in what the expensive operation is. H1 is the
 * positive control (variant A of round 1). The lg-5 gate's data point: handlers
 * with no parameter flagged, those taking `request` not.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rateLimitsFor } from "../rate-limit.ts";

const PROBE_FILE = "/etc/hostname";

export function registerProbeRoutes(app: FastifyInstance, context: AppContext): void {
  const { read } = rateLimitsFor(context);

  // H1: file system, no parameter.
  app.get("/api/probe-h1", { onRequest: read }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });

  // H2: file system, takes and reads `request`.
  app.get("/api/probe-h2", { onRequest: read }, async (request) => {
    return { who: request.headers["x-probe"], text: readFileSync(PROBE_FILE, "utf8") };
  });

  // H3: database, no parameter.
  app.get("/api/probe-h3", { onRequest: read }, async () => {
    return { rows: context.db.prepare("select 1 as one").all() };
  });

  // H4: database, takes and reads `request`.
  app.get("/api/probe-h4", { onRequest: read }, async (request) => {
    return { who: request.headers["x-probe"], rows: context.db.prepare("select 1 as one").all() };
  });
}
