/**
 * `POST /api/probe` — analyse a page and return what can be downloaded.
 *
 * This is the expensive endpoint: a browser probe costs ~15 s and ~300 MB, so
 * it is the one worth caching (briefly) and the one a rate limiter will guard
 * first in WP-6.
 *
 * The cache is read here and **nowhere else**. Jobs re-probe unconditionally —
 * see the orchestrator.
 */

import { AppError, probeRequestSchema, ROUTES } from "@downloader/shared";
import type { ProbeResponse, ProbeResult, ResolveOptions } from "@downloader/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { urlsInProbeResult } from "../ssrf.ts";

export function registerProbeRoute(app: FastifyInstance, context: AppContext): void {
  app.post(ROUTES.probe, async (request, reply) => {
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

    const probe: ProbeResult = await context.registry.resolve(url, resolveOptions);

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
