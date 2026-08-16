/**
 * `@downloader/api` — the join point.
 *
 * Registry in (`@downloader/resolvers`), engine out (`@downloader/engine`),
 * jobs and SSE and files in between. This module exports the pieces so the
 * tests, and eventually dl-7's e2e harness, can assemble them without a socket.
 *
 * ```ts
 * const app = await createApp({ config: { databasePath: ":memory:" } });
 * const response = await app.server.inject({ method: "POST", url: ROUTES.probe, payload: { url } });
 * await app.shutdown();
 * ```
 */

export type { ApiConfig, LogLevel } from "./config.ts";
export { API_DEFAULTS, loadApiConfig, LOG_LEVELS, PROBE_CACHE_TTL_CEILING_MS } from "./config.ts";
export type { AppContext } from "./context.ts";
export type { CreateJobInput, FileToken, TransitionPatch } from "./db/job-store.ts";
export { initialProgress, JobStore } from "./db/job-store.ts";
export { migrate } from "./db/schema.ts";
export type {
  AddressResolver,
  EgressDispatcher,
  EgressDispatcherOptions,
  ResolvedAddress,
} from "./dispatcher.ts";
export { createEgressDispatcher, createPinningLookup } from "./dispatcher.ts";
export type { GuardedFetch, GuardedFetchOptions } from "./guarded-fetch.ts";
export { createGuardedFetch } from "./guarded-fetch.ts";
export { statusForCode, toErrorResponse, toPublicPayload } from "./http-errors.ts";
export type { JobEventListener, Unsubscribe } from "./jobs/events.ts";
export { JobEventHub } from "./jobs/events.ts";
export type { OrchestratorOptions } from "./jobs/orchestrator.ts";
export { JobOrchestrator } from "./jobs/orchestrator.ts";
export type { ProbeCacheOptions } from "./jobs/probe-cache.ts";
export { ProbeCache } from "./jobs/probe-cache.ts";
export type { InProcessQueueOptions, JobQueue, QueuedTask } from "./jobs/queue.ts";
export { InProcessJobQueue } from "./jobs/queue.ts";
export { createFileToken, isWellFormedToken, TOKEN_BYTES, tokensMatch } from "./jobs/tokens.ts";
export type { VariantChoice } from "./jobs/variant-selection.ts";
export { chooseVariant, compareQuality } from "./jobs/variant-selection.ts";
export type { AppLogger, LoggerOptions } from "./logger.ts";
export { createLogger } from "./logger.ts";
export type { RateLimitHookOptions } from "./rate-limit.ts";
export { createRateLimitHook } from "./rate-limit.ts";
export type { BuildRegistryOptions, RegistryBuild } from "./resolvers.ts";
export { buildRegistry } from "./resolvers.ts";
export { formatSseFrame, HEARTBEAT_INTERVAL_MS } from "./routes/events.ts";
export { contentDisposition, parseRange } from "./routes/files.ts";
export type { HealthResponse } from "./routes/health.ts";
export type { App, CreateAppOptions } from "./server.ts";
export { createApp } from "./server.ts";
export type { SsrfGuard, SsrfGuardOptions } from "./ssrf.ts";
export { createSsrfGuard, isBlockedAddress, urlsInProbeResult } from "./ssrf.ts";
