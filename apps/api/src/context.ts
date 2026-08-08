/**
 * Everything the routes need, assembled once at boot.
 *
 * Passed explicitly rather than hung off the Fastify instance so that a route
 * module's dependencies are visible in its signature, and so tests can build a
 * context with fakes without standing up a server.
 */

import type { DownloadEngine } from "@downloader/engine";
import type { ResolverRegistry } from "@downloader/resolvers";
import type { ApiConfig } from "./config.ts";
import type { JobStore } from "./db/job-store.ts";
import type { JobEventHub } from "./jobs/events.ts";
import type { JobOrchestrator } from "./jobs/orchestrator.ts";
import type { ProbeCache } from "./jobs/probe-cache.ts";
import type { JobQueue } from "./jobs/queue.ts";
import type { AppLogger } from "./logger.ts";
import type { ConcurrencyGate, RateLimiter } from "./rate-limit.ts";
import type { SsrfGuard } from "./ssrf.ts";

export interface AppContext {
  config: ApiConfig;
  logger: AppLogger;
  store: JobStore;
  engine: DownloadEngine;
  registry: ResolverRegistry;
  resolverNames: readonly string[];
  guard: SsrfGuard;
  queue: JobQueue;
  events: JobEventHub;
  probeCache: ProbeCache;
  orchestrator: JobOrchestrator;
  /** Per-IP token buckets, one per expensive endpoint. */
  rateLimits: { probe: RateLimiter; jobs: RateLimiter };
  /** Global cap on simultaneous probes, which no per-IP limit can provide. */
  probeGate: ConcurrencyGate;
  now: () => Date;
  /** Flips during shutdown so intake can be refused before the sockets close. */
  isShuttingDown: () => boolean;
}
