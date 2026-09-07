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
import type { GuardedFetch } from "./guarded-fetch.ts";
import type { JobEventHub } from "./jobs/events.ts";
import type { ConcurrencyGate, RateLimiter } from "@webtools/core/rate-limit";
import type { JobOrchestrator } from "./jobs/orchestrator.ts";
import type { ProbeCache } from "./jobs/probe-cache.ts";
import type { ProbeStageHub } from "./probe-stages.ts";
import type { JobQueue } from "./jobs/queue.ts";
import type { AppLogger } from "./logger.ts";
import type { SsrfGuard } from "./ssrf.ts";
import type { ThumbnailStore } from "./thumbnails.ts";

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
   * The loopback proxy the **resolver tiers** go through — Chromium and yt-dlp,
   * and ffmpeg too when `FFMPEG_TLS_INTERCEPT` is off. Runtime state rather than
   * configuration: the port is ephemeral and chosen at boot, which is also why
   * it must never be reported to a client. See `egress-proxy.ts` and dl-12.
   *
   * Since dl-37 it terminates TLS as well, whenever a tier is registered to be
   * given the root it mints from — so "the tiers' proxy" and "the tunnelling
   * one" stopped being the same phrase.
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
  /**
   * Stage narration for a running analysis, held by the client-minted probe id.
   * Separate from `events` because a probe has no job. See `probe-stages.ts`.
   */
  probeStages: ProbeStageHub;
  /** Preview images fetched at probe time, held by token. See `thumbnails.ts`. */
  thumbnails: ThumbnailStore;
  /**
   * The redirect-re-checking `fetch`, so a route can make an outbound request
   * without reaching for the platform one. Only the preview-image capture uses
   * it today; anything else that fetches on a client's behalf must use this and
   * not `globalThis.fetch`.
   */
  guardedFetch: GuardedFetch;
  orchestrator: JobOrchestrator;
  /**
   * Token buckets, one per client-facing endpoint. Since dl-46 that is every
   * one of them: an endpoint without a bucket is one whose cost anybody may
   * spend, and the SSE channel was the last of those.
   *
   * `probe`, `probeEvents` and `jobs` are keyed per IP, because what they
   * protect is the service. `files` and `thumbnail` are not — they are keyed on
   * the capability token in the path, because what each protects is the one
   * artefact that token names. See `capabilityBucketKey` in `rate-limit.ts`.
   */
  rateLimits: {
    probe: RateLimiter;
    probeEvents: RateLimiter;
    jobs: RateLimiter;
    files: RateLimiter;
    thumbnail: RateLimiter;
  };
  /** Global cap on simultaneous probes, which no per-IP limit can provide. */
  probeGate: ConcurrencyGate;
  now: () => Date;
  /** Flips during shutdown so intake can be refused before the sockets close. */
  isShuttingDown: () => boolean;
}
