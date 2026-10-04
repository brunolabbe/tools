/**
 * DO NOT MERGE. repo-91 measurement probe: variant F.
 * Fastify, `consume(request.ip)` in a hook added with `app.addHook("onRequest")`
 * to a scoped instance, ahead of the same file-system route. `rate-limiter-flexible`
 * is not installed, exactly as in variants B to E.
 */

import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { AppContext } from "../context.ts";

const PROBE_FILE = "/etc/hostname";

const limiter = new RateLimiterMemory({ points: 10, duration: 1 });

async function consumeHook(request: FastifyRequest): Promise<void> {
  await limiter.consume(request.ip);
}

export function registerProbeRoutes(app: FastifyInstance, _context: AppContext): void {
  app.addHook("onRequest", consumeHook);
  app.get("/api/probe-f", async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
