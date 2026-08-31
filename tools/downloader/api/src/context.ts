/**
 * Everything the routes need, assembled once at boot.
 *
 * Passed explicitly rather than hung off the Fastify instance so that a route
 * module's dependencies are visible in its signature, and so tests can build a
 * context with fakes without standing up a server.
 */

import type { DownloadEngine } from "@downloader/engine";
import type { BrowserResolver, ResolverRegistry, YtDlpResolver } from "@downloader/resolvers";
import type { ApiConfig } from "./config.ts";
import type { JobStore } from "./db/job-store.ts";
import type { JobEventHub } from "./jobs/events.ts";
import type { ConcurrencyGate, RateLimiter } from "@webtools/core/rate-limit";
import type { JobOrchestrator } from "./jobs/orchestrator.ts";
import type { ProbeCache } from "./jobs/probe-cache.ts";
import type { JobQueue } from "./jobs/queue.ts";
import type { AppLogger } from "./logger.ts";
import type { SsrfGuard } from "./ssrf.ts";

export interface AppContext {
  config: ApiConfig;
  logger: AppLogger;
  store: JobStore;
  engine: DownloadEngine;
  registry: ResolverRegistry;
  resolverNames: readonly string[];
  /** The tiers with runtime state `/api/health` reports. Null when not registered. */
  tiers: { ytdlp: YtDlpResolver | null; browser: BrowserResolver | null };
  /** Process start, so health can report an uptime rather than a wall clock. */
  startedAt: Date;
  guard: SsrfGuard;
  /**
   * The loopback proxy every subprocess egress goes through — ffmpeg, Chromium
   * and yt-dlp alike. Runtime state rather than configuration: the port is
   * ephemeral and chosen at boot, which is also why it must never be reported
   * to a client. See `egress-proxy.ts` and dl-12.
   */
  egressProxyUrl: string;
  /**
   * The proxy **ffmpeg** is given, which is a different one since dl-27 — it
   * terminates TLS so the segment origins get verified at all.
   *
   * It is here so the two tunnelling causes can be told apart. Since
   * `FFMPEG_TLS_INTERCEPT=false` makes "ffmpeg is on the tiers' proxy" a
   * legitimate state, equality with `egressProxyUrl` no longer means the wiring
   * broke — it means the operator asked. Nothing outside a test should read it,
   * and like `egressProxyUrl` it must never reach a client.
   */
  ffmpegProxyUrl: string;
  queue: JobQueue;
  events: JobEventHub;
  probeCache: ProbeCache;
  orchestrator: JobOrchestrator;
  /**
   * Token buckets, one per expensive endpoint.
   *
   * `probe` and `jobs` are keyed per IP. `files` is not — it is keyed on the
   * file's capability token, because what it protects is one file rather than
   * the service. See `fileBucketKey` in `routes/files.ts`.
   */
  rateLimits: { probe: RateLimiter; jobs: RateLimiter; files: RateLimiter };
  /** Global cap on simultaneous probes, which no per-IP limit can provide. */
  probeGate: ConcurrencyGate;
  now: () => Date;
  /** Flips during shutdown so intake can be refused before the sockets close. */
  isShuttingDown: () => boolean;
}
