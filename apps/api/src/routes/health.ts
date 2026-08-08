/**
 * `GET /api/health`.
 *
 * Reports what a deployment actually needs to know: whether ffmpeg is present,
 * which resolver tiers are live, and how loaded the queue is. WP-7 extends this
 * with disk-free and browser-pool detail; the shape is additive so doing that
 * later does not break a client.
 *
 * `ok` is deliberately narrow. It goes false only when the service genuinely
 * cannot do its job — no ffmpeg means no download can ever succeed. A missing
 * yt-dlp is *not* unhealthy: the whole point of the tier ordering is that the
 * sniffer covers everything without it.
 */

import { ROUTES } from "@downloader/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export interface HealthResponse {
  ok: boolean;
  shuttingDown: boolean;
  resolvers: readonly string[];
  ffmpeg: { available: boolean; path: string };
  jobs: { running: number; waiting: number; maxConcurrent: number };
  storageDir: string;
}

export function registerHealthRoute(app: FastifyInstance, context: AppContext): void {
  app.get(ROUTES.health, async (_request, reply) => {
    const ffmpegPath = context.engine.config.ffmpegPath;
    const ffmpegAvailable = ffmpegPath !== "";

    const body: HealthResponse = {
      ok: ffmpegAvailable && !context.isShuttingDown(),
      shuttingDown: context.isShuttingDown(),
      // Read live from the registry rather than from a boot-time snapshot, so
      // health reports the chain that requests will actually go through.
      resolvers: context.registry.resolvers.map((resolver) => resolver.name),
      ffmpeg: { available: ffmpegAvailable, path: ffmpegPath },
      jobs: {
        running: context.queue.running,
        waiting: context.queue.waiting,
        maxConcurrent: context.config.maxConcurrentJobs,
      },
      storageDir: context.config.storageDir,
    };
    // 503 while draining so a load balancer stops sending traffic before the
    // sockets actually close.
    return await reply.code(body.ok ? 200 : 503).send(body);
  });
}
