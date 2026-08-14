/**
 * `POST /api/probe` — analyse a page and return what can be downloaded.
 *
 * This is the expensive endpoint: a browser probe costs ~15 s and ~300 MB, so
 * it is the one worth caching (briefly) and the one guarded hardest — a per-IP
 * bucket in front, and a global concurrency gate behind it for the distributed
 * case that no per-IP limit can see.
 *
 * The cache is read here and **nowhere else**. Jobs re-probe unconditionally —
 * see the orchestrator.
 *
 * The bucket is spent before the cache is consulted, so a cache hit costs a
 * token. That is deliberate: the limit protects the endpoint, and refunding
 * cheap answers would let a client hold a URL warm and poll it without limit.
 */

import { AppError, probeRequestSchema, ROUTES } from "@downloader/contract";
import type { ProbeResponse, ProbeResult, ResolveOptions } from "@downloader/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { createRateLimitHook } from "../rate-limit.ts";
import { urlsInProbeResult } from "../ssrf.ts";

/** What we tell a client to wait when the gate, rather than a bucket, refused. */
const GATE_RETRY_AFTER_SEC = 10;

export function registerProbeRoute(app: FastifyInstance, context: AppContext): void {
  const rateLimit = createRateLimitHook({
    limiter: context.rateLimits.probe,
    logger: context.logger,
    scope: "probe",
  });

  app.post(ROUTES.probe, { onRequest: rateLimit }, async (request, reply) => {
    const parsed = probeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError("INVALID_URL", undefined, {
        details: { issues: parsed.error.issues.slice(0, 3) },
      });
    }
    const { url: rawUrl, refresh } = parsed.data;

    // Before the cache, so a blocked address is rejected even if a previous
    // request cached an answer for it under a different policy.
    const url = await context.guard.assertAllowed(rawUrl);
    const cacheKey = url.href;

    if (refresh !== true) {
      const cached = context.probeCache.get(cacheKey);
      if (cached !== null) {
        const body: ProbeResponse = { probe: cached, cached: true };
        return await reply.send(body);
      }
    }

    // A client that navigates away should not leave a browser probe running for
    // another 40 seconds holding a concurrency slot.
    const controller = new AbortController();
    request.raw.on("close", () => {
      if (request.raw.destroyed) controller.abort(new AppError("CANCELED"));
    });

    const resolveOptions: ResolveOptions = {
      timeoutMs: context.config.probeTimeoutMs,
      signal: controller.signal,
      ...(context.config.proxyUrl === undefined ? {} : { proxyUrl: context.config.proxyUrl }),
    };

    // The per-IP bucket above bounds one caller. This bounds the whole server,
    // which is the only thing that helps when the requests arrive from a
    // thousand addresses that have each spent nothing.
    const release = context.probeGate.tryAcquire();
    if (release === null) {
      context.logger.warn("probe refused: concurrency gate full", {
        limit: context.probeGate.limit,
      });
      reply.header("Retry-After", String(GATE_RETRY_AFTER_SEC));
      throw new AppError(
        "RATE_LIMITED",
        "The server is analysing as many pages as it can at once. Try again shortly.",
        { details: { scope: "probe-gate", retryAfterSec: GATE_RETRY_AFTER_SEC } },
      );
    }

    let probe: ProbeResult;
    try {
      probe = await context.registry.resolve(url, resolveOptions);
    } finally {
      release();
    }

    // Resolver output is attacker-influenced. Vetting it here means a client
    // never even learns that an internal address answered.
    await context.guard.assertAllAllowed(urlsInProbeResult(probe));

    context.probeCache.set(cacheKey, probe);
    context.logger.info("probe complete", {
      resolver: probe.resolver,
      variants: probe.variants.length,
      drm: probe.drm.protected,
      requestContext: probe.requestContext,
    });

    const body: ProbeResponse = { probe, cached: false };
    return await reply.send(body);
  });
}
