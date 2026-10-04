/**
 * DO NOT MERGE. repo-91 measurement probe: variant B, the subject.
 * The same file-system route, limited only by `rate-limiter-flexible`'s
 * `consume()` called from an `onRequest` hook.
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
  app.get("/api/probe-b", { onRequest: consumeHook }, async () => {
    return { text: readFileSync(PROBE_FILE, "utf8") };
  });
}
