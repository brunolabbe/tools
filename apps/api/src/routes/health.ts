/**
 * `GET /api/health`.
 *
 * Reports what a deployment actually needs to know: whether ffmpeg is present
 * and runnable, which resolver tiers are live and whether their machinery
 * started, how loaded the queue is, and how much room is left on the volume.
 *
 * `ok` is deliberately narrow. It goes false only when the service genuinely
 * cannot do its job — no ffmpeg means no download can ever succeed — and on
 * the way down, so a load balancer stops sending traffic before the sockets
 * close. Two things are pointedly *not* in it:
 *
 *  - **A missing yt-dlp is not unhealthy.** The whole point of the tier
 *    ordering is that the sniffer covers everything without it.
 *  - **A full disk is not unhealthy either.** A container health check that
 *    fails restarts the container, and restarting does not free a byte; it
 *    just converts a degraded service into a crash loop. The numbers are
 *    reported so an operator or an alert can act on them, which is the thing
 *    that actually helps.
 */

import { readFileSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { freeDiskBytes } from "@downloader/engine";
import { ROUTES } from "@downloader/shared";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export interface HealthResponse {
  ok: boolean;
  shuttingDown: boolean;
  version: string;
  uptimeSec: number;
  resolvers: readonly string[];
  ffmpeg: { available: boolean; path: string };
  ytdlp: { enabled: boolean; available: boolean; path: string | null };
  browser: {
    enabled: boolean;
    /** Probes holding a browser slot right now. */
    active: number;
    maxConcurrent: number;
    /** False until the first probe launches Chromium — see `BrowserPool.stats`. */
    launched: boolean;
  };
  jobs: { running: number; waiting: number; maxConcurrent: number };
  storage: {
    dir: string;
    /** Null when the platform will not report it. */
    freeBytes: number | null;
    /** The configured cap, not the volume's size. Zero means no quota. */
    quotaBytes: number;
  };
  /** Kept from the pre-WP-7 shape so an existing client does not break. */
  storageDir: string;
}

/**
 * Read once, from the package manifest, so the reported version cannot drift
 * from the one that was released. Failure is not fatal: an unknown version is
 * a worse health response, not a dead service.
 */
function readVersion(): string {
  try {
    const manifest = fileURLToPath(new URL("../../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const VERSION = readVersion();

/**
 * Whether the configured ffmpeg is really there.
 *
 * A path is not a binary. `ffmpeg-static` resolves to a path inside
 * `node_modules` whether or not the postinstall download ran, and a container
 * built with `--omit=optional` or on a platform it has no build for gets a
 * confident path to a file that does not exist. Checking costs one `stat` per
 * call, which a health probe every few seconds will not notice, and turns a
 * class of "every job fails immediately" into a red health check at boot.
 */
async function ffmpegUsable(ffmpegPath: string): Promise<boolean> {
  if (ffmpegPath === "") return false;
  try {
    await access(ffmpegPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function registerHealthRoute(app: FastifyInstance, context: AppContext): void {
  app.get(ROUTES.health, async (_request, reply) => {
    const ffmpegPath = context.engine.config.ffmpegPath;
    const [ffmpegAvailable, freeBytes] = await Promise.all([
      ffmpegUsable(ffmpegPath),
      freeDiskBytes(context.config.storageDir),
    ]);

    const { ytdlp, browser } = context.tiers;
    const browserStats = browser?.stats;

    const body: HealthResponse = {
      ok: ffmpegAvailable && !context.isShuttingDown(),
      shuttingDown: context.isShuttingDown(),
      version: VERSION,
      uptimeSec: Math.round((context.now().getTime() - context.startedAt.getTime()) / 1000),
      // Read live from the registry rather than from a boot-time snapshot, so
      // health reports the chain that requests will actually go through.
      resolvers: context.registry.resolvers.map((resolver) => resolver.name),
      ffmpeg: { available: ffmpegAvailable, path: ffmpegPath },
      ytdlp: {
        enabled: ytdlp !== null,
        available: ytdlp?.available ?? false,
        path: ytdlp?.resolvedPath ?? null,
      },
      browser: {
        enabled: browser !== null,
        active: browserStats?.active ?? 0,
        maxConcurrent: browserStats?.maxConcurrent ?? 0,
        launched: browserStats?.launched ?? false,
      },
      jobs: {
        running: context.queue.running,
        waiting: context.queue.waiting,
        maxConcurrent: context.config.maxConcurrentJobs,
      },
      storage: {
        dir: context.config.storageDir,
        freeBytes,
        quotaBytes: context.config.maxTotalStorageBytes,
      },
      storageDir: context.config.storageDir,
    };
    // 503 while draining so a load balancer stops sending traffic before the
    // sockets actually close.
    return await reply.code(body.ok ? 200 : 503).send(body);
  });
}
