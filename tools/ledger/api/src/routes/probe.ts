/**
 * DO NOT MERGE. repo-91 measurement probe: variant C.
 * The same file-system route, with `rate-limiter-flexible`'s `consume()` called
 * inside the handler itself.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { AppContext } from "../context.ts";

const PROBE_FILE = "/etc/hostname";

const limiter = new RateLimiterMemory({ points: 10, duration: 1 });

export function registerProbeRoutes(app: FastifyInstance, _context: AppContext): void {
  app.get("/api/probe-c", async (request) => {
    await limiter.consume(request.ip);
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
