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
import type { ResolverAttempt } from "@downloader/resolvers";
import { clientKey } from "@webtools/core/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { withoutEgressProxy } from "../egress-proxy.ts";
import { probeForClient } from "../probe-out.ts";
import { recordProbeOutcome } from "../probe-outcomes.ts";
import { createRateLimitHook } from "../rate-limit.ts";
import { urlsInProbeResult } from "../ssrf.ts";
import { captureThumbnail, withThumbnailPath } from "../thumbnails.ts";

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
    const { url: rawUrl, refresh, probeId } = parsed.data;

    // Before the cache, so a blocked address is rejected even if a previous
    // request cached an answer for it under a different policy.
    const url = await context.guard.assertAllowed(rawUrl);
    const cacheKey = url.href;
    // Hostname only, from here to every outcome row this handler writes — never
    // the path or query string a signed URL carries its credential in. See
    // dl-57.
    const host = url.hostname;

    if (refresh !== true) {
      const cached = context.probeCache.get(cacheKey);
      if (cached !== null) {
        // `probeForClient` here as well as on the fresh path below, and this is
        // the call most easily forgotten: this branch returns before every
        // rewrite the fresh path does. The cache deliberately holds the
        // credentials — nothing else reads it today, but a stored object that is
        // already stripped is one nothing *could* ever drive a download from.
        recordProbeOutcome(context, {
          host,
          outcome: "ok",
          resolver: cached.resolver,
          attempts: [],
          durationMs: 0,
          cached: true,
          variants: cached.variants.length,
          drm: cached.drm.protected,
        });
        const body: ProbeResponse = { probe: probeForClient(cached), cached: true };
        return await reply.send(body);
      }
    }

    // A client that navigates away should not leave a browser probe running for
    // another 40 seconds holding a concurrency slot.
    const controller = new AbortController();
    request.raw.on("close", () => {
      if (request.raw.destroyed) controller.abort(new AppError("CANCELED"));
    });

    // dl-43. Opened only for the fresh path — a cache hit returned above never
    // reaches here, and a channel for a probe that will not run would leave the
    // client watching an empty stream until its own timeout.
    const narrating = probeId !== undefined && context.probeStages.open(probeId);

    const resolveOptions: ResolveOptions = {
      // The loopback proxy, never `config.proxyUrl`: the browser and yt-dlp
      // tiers fetch from their own processes, so this is the only place their
      // egress can be checked at all. It chains to the operator's proxy when
      // there is one. See `egress-proxy.ts` and dl-12.
      proxyUrl: context.egressProxyUrl,
      timeoutMs: context.config.probeTimeoutMs,
      signal: controller.signal,
      ...(narrating && probeId !== undefined
        ? {
            onStage: (event) => {
              context.probeStages.stage(probeId, event);
            },
          }
        : {}),
    };

    // dl-43: every exit from here on terminates the stream, including the ones
    // that throw. A `finally` on the resolve alone would leave the channel open
    // through the thumbnail capture — and a refusal below never gets that far
    // at all, so a client whose probe was refused outright would sit watching a
    // live stream that will never say anything again.
    const finishNarration = (): void => {
      if (narrating && probeId !== undefined) context.probeStages.done(probeId);
    };

    // Bounds one client's own share of the server-wide gate below — a client
    // inside its per-minute bucket but still holding a prior slow probe
    // otherwise gets to start another (dl-51). Same key `rateLimits.probe`
    // buckets on, so `TRUST_PROXY` means the same thing for both. Outside any
    // try/finally: `null` means nothing was acquired, so there is nothing to
    // release.
    const clientReleaseProbe = context.probeClientGate.tryAcquire(clientKey(request.ip));
    if (clientReleaseProbe === null) {
      finishNarration();
      context.logger.warn("probe refused: per-client cap reached", {
        limit: context.probeClientGate.limit,
      });
      // Per-client, not tool-wide capacity — the same reasoning dl-57 gives for
      // excluding the per-minute bucket below: this measures one client, not
      // the server, so it gets no probe_outcomes row either (dl-51/dl-57
      // agreement).
      reply.header("Retry-After", String(GATE_RETRY_AFTER_SEC));
      throw new AppError(
        "RATE_LIMITED",
        "You already have as many analyses running as this server allows per client. Try again shortly.",
        { details: { scope: "probe-client-cap", retryAfterSec: GATE_RETRY_AFTER_SEC } },
      );
    }

    try {
      // Filled by the registry as it tries each tier, win or lose, so it holds
      // the full timeline whether `resolve()` returns or throws — see
      // `ResolverRegistry.resolve()`.
      const attempts: ResolverAttempt[] = [];
      const startedAt = context.now().getTime();

      // The per-client cap above bounds one caller. This bounds the whole
      // server, which is the only thing that helps when the requests arrive
      // from a thousand addresses that have each spent nothing.
      const release = context.probeGate.tryAcquire();
      if (release === null) {
        finishNarration();
        context.logger.warn("probe refused: concurrency gate full", {
          limit: context.probeGate.limit,
        });
        // A capacity signal, not a per-client one — dl-52's input. Distinct
        // from the per-client rate-limit bucket above, which refuses in an
        // `onRequest` hook this handler never reaches, and from the per-client
        // probe cap above, which is excluded by the agreement noted there — no
        // row here is ever either of those.
        recordProbeOutcome(context, {
          host,
          outcome: "RATE_LIMITED",
          resolver: null,
          attempts: [],
          durationMs: 0,
          cached: false,
          variants: null,
          drm: false,
        });
        reply.header("Retry-After", String(GATE_RETRY_AFTER_SEC));
        throw new AppError(
          "RATE_LIMITED",
          "The server is analysing as many pages as it can at once. Try again shortly.",
          { details: { scope: "probe-gate", retryAfterSec: GATE_RETRY_AFTER_SEC } },
        );
      }

      try {
        let probe: ProbeResult;
        try {
          // The resolvers echo the proxy they were given; that is this process's own
          // loopback port and no client's business.
          probe = withoutEgressProxy(await context.registry.resolve(url, resolveOptions, attempts));
        } finally {
          release();
        }

        // Resolver output is attacker-influenced. Vetting it here means a client
        // never even learns that an internal address answered. `mustPass` only —
        // `bestEffort` is the preview image, whose refusal must not cost the user a
        // downloadable video, so it is vetted inside `captureThumbnail` where the
        // refusal is caught. See `urlsInProbeResult`.
        await context.guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);

        // Before the cache write and before the response, so both carry our path
        // and neither carries the origin URL. Eager rather than on demand because
        // `probe.requestContext.headers` is the only credential that will ever
        // fetch this image, and it exists here and nowhere later.
        const captured = await captureThumbnail({
          probe,
          guard: context.guard,
          fetchImpl: context.guardedFetch,
          store: context.thumbnails,
          logger: context.logger,
        });
        // A bare probe has no job and so no `out/` directory to keep a copy
        // beside; the in-memory store is the whole of its retention. Only the
        // job pipeline persists (dl-44).
        const thumbnailPath = captured?.path ?? null;
        const clientProbe = withThumbnailPath(probe, thumbnailPath);

        // The **rewritten** probe is what is cached, so the double-click that this
        // cache exists for gets the same token rather than a second fetch. That is
        // why `THUMBNAIL_TTL_MS` is required to exceed `PROBE_CACHE_TTL_CEILING_MS`.
        context.probeCache.set(cacheKey, clientProbe);
        context.logger.info("probe complete", {
          resolver: probe.resolver,
          variants: probe.variants.length,
          drm: probe.drm.protected,
          preview: thumbnailPath !== null,
          requestContext: probe.requestContext,
        });
        recordProbeOutcome(context, {
          host,
          outcome: "ok",
          resolver: probe.resolver,
          attempts,
          durationMs: context.now().getTime() - startedAt,
          cached: false,
          variants: probe.variants.length,
          drm: probe.drm.protected,
        });

        const body: ProbeResponse = { probe: probeForClient(clientProbe), cached: false };
        return await reply.send(body);
      } catch (error: unknown) {
        // Whatever stage failed — resolution, the SSRF vet on its output, the
        // thumbnail capture — `attempts` already holds every tier the registry
        // tried, so the row is as informative on a late failure as an early one.
        recordProbeOutcome(context, {
          host,
          outcome: AppError.from(error).code,
          resolver: null,
          attempts,
          durationMs: context.now().getTime() - startedAt,
          cached: false,
          variants: null,
          drm: false,
        });
        throw error;
      } finally {
        finishNarration();
      }
    } finally {
      clientReleaseProbe();
    }
  });
}
