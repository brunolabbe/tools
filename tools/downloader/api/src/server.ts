/**
 * Builds the whole service: config in, a started-but-not-listening app out.
 *
 * `createApp()` deliberately does not call `listen()`. Tests drive it through
 * `app.inject()` with no socket at all, and `main.ts` owns the listening and
 * the signal handling. That split is what makes the pipeline testable without
 * ports, timeouts or teardown races.
 */

import Database from "better-sqlite3";
import { createEngine } from "@downloader/engine";
import type { DownloadEngine } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "./config.ts";
import { loadApiConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { JobStore } from "./db/job-store.ts";
import { migrate } from "./db/schema.ts";
import { createEgressDispatcher } from "./dispatcher.ts";
import { startEgressProxy } from "./egress-proxy.ts";
import type { EgressProxy } from "./egress-proxy.ts";
import { createGuardedFetch } from "./guarded-fetch.ts";
import { toErrorResponse } from "./http-errors.ts";
import { JobEventHub } from "./jobs/events.ts";
import { JobOrchestrator } from "./jobs/orchestrator.ts";
import { ProbeCache } from "./jobs/probe-cache.ts";
import { ConcurrencyGate, RateLimiter } from "@webtools/core/rate-limit";
import { InProcessJobQueue } from "./jobs/queue.ts";
import type { AppLogger } from "./logger.ts";
import { createLogger } from "./logger.ts";
import { registerRequestLogging, requestIdFrom } from "./request-log.ts";
import { buildRegistry } from "./resolvers.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { registerProbeRoute } from "./routes/probe.ts";
import { registerWebRoutes, serveIndexForUnknownPath } from "./routes/web.ts";
import { createSsrfGuard } from "./ssrf.ts";
import { createTlsInterception } from "./tls-interception.ts";
import { ROUTES } from "@downloader/contract";

export interface CreateAppOptions {
  config?: Partial<ApiConfig>;
  /** Injected in tests. Overrides anything the config would have built. */
  engine?: DownloadEngine;
  logger?: AppLogger;
  now?: () => Date;
  /** Skips the retention timer. Tests do not want a background sweep running. */
  startGc?: boolean;
}

export interface App {
  server: FastifyInstance;
  context: AppContext;
  config: ApiConfig;
  /** Stops intake, cancels in-flight work, disposes resolvers, closes the db. */
  shutdown(): Promise<void>;
}

/** Body size cap. Requests here carry a URL and a few options, nothing more. */
const MAX_BODY_BYTES = 64 * 1024;

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const config = loadApiConfig(options.config ?? {});
  const logger = options.logger ?? createLogger({ level: config.logLevel });

  const guard = createSsrfGuard({
    allowHosts: config.ssrfAllowHosts,
    allowPrivateAddresses: config.ssrfAllowPrivateAddresses,
  });
  // Pins each connection to an address the guard vetted — the half of the SSRF
  // answer a pre-flight check cannot give — and carries the egress proxy, which
  // Node's global fetch would otherwise ignore. See `dispatcher.ts`.
  const egress = createEgressDispatcher({
    guard,
    ...(config.proxyUrl === undefined ? {} : { proxyUrl: config.proxyUrl }),
  });
  const guardedFetch = createGuardedFetch(guard, globalThis.fetch, {
    dispatcher: egress.dispatcher,
  });
  // The other half of the same answer, for the egress no dispatcher can reach.
  // ffmpeg fetches through libavformat and the resolver tiers fetch from their
  // own subprocesses, so all three get a proxy that runs this guard on every
  // request. See `egress-proxy.ts`.
  const tierProxy = await startEgressProxy({
    guard,
    logger,
    ...(config.proxyUrl === undefined ? {} : { upstreamProxyUrl: config.proxyUrl }),
  });

  // **Two proxies, and which one a subprocess gets is the whole of dl-27.**
  //
  // Chromium and yt-dlp verify their own connections without being asked, so
  // they keep the one above: a `CONNECT` is tunnelled, the origin's own
  // certificate reaches them, and nothing needs a trust-store change. ffmpeg
  // cannot — libavformat propagates a fixed seven-name option list onto the
  // connections its HLS and DASH demuxers open for segments and the TLS
  // settings are not in it, so `-tls_verify 1` reaches the manifest and nothing
  // else (dl-21 measured sixteen ways round it). The one option that *is*
  // propagated is `http_proxy`, so this proxy is already on every segment
  // connection; making it terminate them is what puts a verification there at
  // all. Pointing the tiers at this one instead would break every HTTPS page
  // Chromium loads, for no gain it does not already have.
  //
  // `FFMPEG_TLS_INTERCEPT=false` is the way out for an operator the interception
  // breaks for some reason of their own. It is a separate knob from
  // `FFMPEG_ALLOW_UNVERIFIED_TLS` on purpose: without it, the only escape an
  // operator can find in the environment table is the one that stops verifying
  // anything at all, and giving up the manifest check to fix a proxy problem is
  // the worst of the three states this service can be in.
  const ffmpegInterception = config.ffmpegTlsIntercept
    ? await createTlsInterception({
        // The two CA settings swap sides here and getting it backwards fails
        // closed on every public origin. `-ca_file` *replaces* ffmpeg's store,
        // so ffmpeg's becomes the generated root and nothing else; the proxy is
        // the side that meets real origins, so the operator's root goes here,
        // merged with the system store.
        ...(config.ffmpegCaFile === undefined ? {} : { caFile: config.ffmpegCaFile }),
        verifyOrigins: !config.ffmpegAllowUnverifiedTls,
      }).catch((error: unknown) => {
        // dl-19 recorded that a typo'd `FFMPEG_CA_FILE` was discovered one
        // download at a time. It cannot be now: the file is a trust anchor this
        // proxy needs before it can verify anything, and quietly carrying on
        // with the system store would refuse the operator's own origins in a way
        // that reads like their CDN is compromised.
        throw new AppError("INTERNAL", "FFMPEG_CA_FILE could not be read.", {
          cause: error,
          details: { path: config.ffmpegCaFile },
        });
      })
    : null;

  // **The proxy ffmpeg gets and the trust store it is given are one decision,
  // written once, and that is not tidiness.** They are only ever correct as a
  // pair: a terminating proxy with the operator's root leaves ffmpeg unable to
  // verify the one certificate it is shown, and a tunnel with the generated root
  // leaves it unable to verify the origin's. Both mismatches fail every download
  // at the manifest, which looks nothing like the setting that caused them.
  // Choosing them in two places is how they drift.
  //
  // With interception off there is no second proxy at all. A tunnelling proxy is
  // what `tierProxy` already is, so a second one would be an identical listener
  // and two RSA keygens to no end.
  let ffmpegProxy: EgressProxy | null = null;
  let ffmpegEgress: {
    proxyUrl: string;
    tlsCaFile: string | undefined;
    tls: "tunnel" | "terminate";
  };
  if (ffmpegInterception === null) {
    ffmpegEgress = {
      proxyUrl: tierProxy.url,
      // Back to ffmpeg, because ffmpeg is meeting the origin again. This is
      // dl-19's arrangement, unchanged.
      tlsCaFile: config.ffmpegCaFile,
      tls: tierProxy.tls,
    };
  } else {
    ffmpegProxy = await startEgressProxy({
      guard,
      logger,
      ...(config.proxyUrl === undefined ? {} : { upstreamProxyUrl: config.proxyUrl }),
      interceptTls: ffmpegInterception,
    });
    ffmpegEgress = {
      proxyUrl: ffmpegProxy.url,
      tlsCaFile: ffmpegInterception.rootCaPath,
      tls: ffmpegProxy.tls,
    };
  }

  logger.info("egress configured", {
    mode: egress.mode,
    subprocessProxyMode: tierProxy.mode,
    ffmpegProxyTls: ffmpegEgress.tls,
    // Whether a proxy is set, never which: the URL routinely carries
    // credentials, and this line is not worth a leak.
    proxied: config.proxyUrl !== undefined,
  });

  // Loud on purpose, and at boot rather than at the first download: this is the
  // one setting that puts the tool back where dl-14 found it, fetching video
  // over a connection encrypted to a certificate nobody checked. An operator who
  // set it for an afternoon and forgot has a line in every startup log saying so.
  if (config.ffmpegAllowUnverifiedTls) {
    logger.warn(
      "FFMPEG_ALLOW_UNVERIFIED_TLS is on: nothing checks the certificates this service downloads video over",
      {
        hint: "Since dl-27 it is the egress proxy that verifies, so this turns off the check for manifests and segments alike. Prefer FFMPEG_CA_FILE with your proxy's root certificate; anything on the path to a CDN can substitute the video while this is set.",
      },
    );
  } else if (ffmpegInterception === null) {
    // The third state, and the one this line exists to make impossible to be in
    // by accident. `FFMPEG_TLS_INTERCEPT=false` is a narrower escape than
    // `FFMPEG_ALLOW_UNVERIFIED_TLS` and it is not a free one: it puts this
    // service back exactly where dl-21 found it. An escape hatch that undersells
    // its cost is worse than no escape hatch, because the operator who used it
    // believes they kept something they did not.
    logger.warn(
      "FFMPEG_TLS_INTERCEPT is off: HLS and DASH segment certificates are not checked at all",
      {
        hint: "This is dl-21's hole, reopened deliberately. ffmpeg verifies the manifest connection only — libavformat does not propagate the TLS options onto a demuxer's segment connections and no argument changes that — so the manifest is kilobytes and the segments are the whole video. An attacker on the path to the segment origin can substitute it and the job will report success. Prefer FFMPEG_CA_FILE, and turn this back on. See tools/downloader/docs/work/dl-27-verify-segment-origins.md.",
      },
    );
  } else {
    // The other half of the same honesty, and still a warning rather than an
    // info line — for the opposite reason it was one until dl-27.
    //
    // Until dl-27 this said the segments were **not** covered, because they
    // were not and an operator reasonably believed otherwise. They are now, and
    // what an operator reasonably believes otherwise is the *shape* of it:
    // dl-14 chose a `CONNECT` tunnel precisely so the certificate reaching
    // ffmpeg is the origin's own, and this reverses that. Every media byte now
    // crosses this process in plaintext, and the certificate ffmpeg checks is
    // one this process minted. That is a deployment fact worth one line per
    // boot, not a fact for a documentation page.
    logger.warn(
      "ffmpeg's egress proxy terminates TLS: this process verifies every manifest and segment origin, and ffmpeg sees a certificate issued here",
      {
        hint: "It is the only way segment origins get verified at all — libavformat does not propagate the TLS options to a demuxer's segment connections. The cost is that media passes through this process in plaintext. See tools/downloader/docs/work/dl-27-verify-segment-origins.md.",
      },
    );
  }

  const engine =
    options.engine ??
    createEngine({
      storageDir: config.storageDir,
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxTotalStorageBytes: config.maxTotalStorageBytes,
      fileRetentionHours: config.fileRetentionHours,
      stageTimeoutMs: config.stageTimeoutMs,
      logger,
      // Every direct fetch the engine makes — progressive downloads, segments,
      // subtitles — goes through the redirect-checking guard.
      fetchImpl: guardedFetch,
      ...(config.ffmpegPath === undefined ? {} : { ffmpegPath: config.ffmpegPath }),
      tlsVerify: !config.ffmpegAllowUnverifiedTls,
      // **Both halves come from `ffmpegEgress` and neither is read from
      // `config` here.** Interception on, that is the terminating proxy and the
      // generated root; off, it is the tunnel and the operator's own
      // `FFMPEG_CA_FILE`. Reaching past it for either one is how the pair gets
      // split.
      ...(ffmpegEgress.tlsCaFile === undefined ? {} : { tlsCaFile: ffmpegEgress.tlsCaFile }),
      proxyUrl: ffmpegEgress.proxyUrl,
    });
  await engine.init();

  const db = new Database(config.databasePath);
  migrate(db);
  const store = new JobStore(db);

  const { registry, resolverNames, ytdlp, browser } = buildRegistry({
    config,
    logger,
    fetchImpl: guardedFetch,
  });
  const events = new JobEventHub(options.now);
  const probeCache = new ProbeCache({ ttlMs: config.probeCacheTtlMs });

  let shuttingDown = false;
  const queue = new InProcessJobQueue({
    concurrency: config.maxConcurrentJobs,
    onTaskError: (jobId, error) => {
      // The orchestrator records its own failures, so reaching here means a bug
      // in the orchestrator itself rather than a failed download.
      logger.error("a job task rejected outside the orchestrator's own handling", {
        jobId,
        error: String(error),
      });
    },
  });

  const now = options.now ?? (() => new Date());
  const orchestrator = new JobOrchestrator({
    store,
    engine,
    registry,
    guard,
    events,
    logger,
    probeTimeoutMs: config.probeTimeoutMs,
    fileRetentionHours: config.fileRetentionHours,
    // Not `config.proxyUrl`, for the same reason the engine does not get it:
    // the browser and yt-dlp tiers fetch from their own subprocesses, so the
    // only check that can reach them is the one at this proxy. See dl-12.
    proxyUrl: tierProxy.url,
    fileUrl: (token) => ROUTES.file(token),
    now,
  });

  const context: AppContext = {
    config,
    logger,
    store,
    engine,
    registry,
    resolverNames,
    tiers: { ytdlp, browser },
    startedAt: now(),
    guard,
    egressProxyUrl: tierProxy.url,
    ffmpegProxyUrl: ffmpegEgress.proxyUrl,
    queue,
    events,
    probeCache,
    orchestrator,
    rateLimits: {
      probe: new RateLimiter({
        perMinute: config.rateLimitProbePerMinute,
        now: () => now().getTime(),
      }),
      jobs: new RateLimiter({
        perMinute: config.rateLimitJobsPerMinute,
        now: () => now().getTime(),
      }),
    },
    probeGate: new ConcurrencyGate(config.maxConcurrentProbes),
    now,
    isShuttingDown: () => shuttingDown,
  };

  const server = Fastify({
    // The app's own logger writes structured lines; Fastify's would be a second
    // unrelated format on the same stream.
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
    // What makes `request.ip` mean the client rather than the proxy — and, off,
    // what stops a client naming its own rate-limit bucket. See the note on
    // `ApiConfig.trustProxy`.
    trustProxy: config.trustProxy,
    // Fastify's own ids are a per-process counter, which collide across
    // restarts and across replicas — useless for correlating anything.
    genReqId: (request) => requestIdFrom(request as { headers: Record<string, unknown> }),
  });

  registerRequestLogging(server, context);
  registerErrorHandling(server, context);
  registerCors(server, config);

  registerHealthRoute(server, context);
  registerProbeRoute(server, context);
  registerJobRoutes(server, context);
  registerEventRoutes(server, context);
  registerFileRoutes(server, context);
  // After the API routes, so a `/api/…` path can never be shadowed by a file
  // that happens to sit at the same name in the bundle.
  const servingWeb = await registerWebRoutes(server, context);
  registerNotFoundHandler(server, servingWeb);

  reconcileInterruptedJobs(context);

  const gcTimer =
    options.startGc === false ? null : startRetentionSweep(context, config.gcIntervalMs);

  await server.ready();

  return {
    server,
    context,
    config,
    async shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("shutting down");

      // Order matters. Stop accepting, then stop working, then release the
      // things the work was using.
      if (gcTimer !== null) clearInterval(gcTimer);
      await server.close();
      await queue.close();
      await registry.dispose().catch((error: unknown) => {
        logger.warn("some resolvers did not shut down cleanly", { error: String(error) });
      });
      // After the queue and the resolvers: closing the dispatcher tears down
      // keep-alive sockets, and doing it while a download still holds one turns
      // an orderly shutdown into a failed job.
      await egress.close().catch((error: unknown) => {
        logger.warn("the egress dispatcher did not close cleanly", { error: String(error) });
      });
      // Same ordering rule: an open tunnel here belongs to an ffmpeg the queue
      // has already stopped.
      await tierProxy.close().catch((error: unknown) => {
        logger.warn("the tiers' egress proxy did not close cleanly", { error: String(error) });
      });
      // Both are null when `FFMPEG_TLS_INTERCEPT` is off — there is no second
      // proxy and no generated root to take down.
      await ffmpegProxy?.close().catch((error: unknown) => {
        logger.warn("the ffmpeg egress proxy did not close cleanly", { error: String(error) });
      });
      // The generated root's temp directory. Its private key was never on disk.
      await ffmpegInterception?.close().catch((error: unknown) => {
        logger.warn("the generated egress CA did not clean up", { error: String(error) });
      });
      db.close();
      logger.info("shutdown complete");
    },
  };
}

/**
 * Every failure leaves through one place, so the status mapping and the
 * redaction cannot be forgotten per-route.
 */
function registerErrorHandling(server: FastifyInstance, context: AppContext): void {
  server.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorResponse(error);
    const appError = AppError.from(error);

    // 5xx is ours; 4xx is theirs. Logging the two at the same level makes the
    // log useless for spotting real problems.
    const fields = {
      method: request.method,
      url: request.url,
      code: appError.code,
      status,
      details: appError.details,
    };
    // `request.logger` is missing only when the failure happened before the
    // onRequest hook ran — a malformed request line, say. The declared type
    // says it is always there because after that hook it is; the cast is what
    // makes the one window where it is not visible rather than a crash.
    const log = (request.logger as AppLogger | undefined) ?? context.logger;
    if (status >= 500) log.error("request failed", fields);
    else log.info("request rejected", fields);

    void reply.code(status).send(body);
  });
}

/**
 * Split from `registerErrorHandling` because it has to be registered *after*
 * the static plugin: the SPA fallback needs `reply.sendFile`, which only
 * exists once that plugin has decorated the reply.
 */
function registerNotFoundHandler(server: FastifyInstance, servingWeb: boolean): void {
  server.setNotFoundHandler((request, reply) => {
    if (servingWeb && serveIndexForUnknownPath(request, reply)) return;

    const { status, body } = toErrorResponse(
      new AppError("NOT_FOUND", undefined, {
        details: { path: request.url.slice(0, 200) },
      }),
    );
    void reply.code(status).send(body);
  });
}

/**
 * CORS, hand-rolled rather than pulled in as a plugin.
 *
 * The policy is one line — an explicit origin allowlist, credentials off — and
 * `CORS_ORIGINS` is empty by default because the intended deployment serves the
 * UI from the same origin and needs no CORS at all.
 */
function registerCors(server: FastifyInstance, config: ApiConfig): void {
  if (config.corsOrigins.length === 0) return;
  const allowed = new Set(config.corsOrigins);

  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && allowed.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      // Tells caches the response varies by origin; without it a shared cache
      // can serve one origin's CORS headers to another.
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
    }
    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });
}

/**
 * Jobs that were running when the process died.
 *
 * They cannot be resumed — the engine's tmp state is gone and the probe is
 * stale — so they are failed honestly rather than left in `downloading`
 * forever, where the UI would show a progress bar that never moves.
 */
function reconcileInterruptedJobs(context: AppContext): void {
  const stranded = context.store.unfinished();
  if (stranded.length === 0) return;

  const error = new AppError("INTERNAL", "The server restarted while this download was running.", {
    retryable: true,
  }).toPayload();

  for (const job of stranded) {
    try {
      context.store.transition(job.id, "failed", { error }, context.now().toISOString());
    } catch {
      // A status the FSM will not move to `failed` cannot be repaired here.
      // Leaving it is better than crashing at boot over one stale row.
    }
  }
  context.logger.warn("failed jobs interrupted by a restart", { count: stranded.length });
}

/**
 * How long a token row outlives the file it addressed.
 *
 * The file goes at `expiresAt`; the row stays a further 30 days so the route
 * can answer `410 Gone` — "this existed and is now deleted" — instead of a 404
 * that reads as "you mistyped the link". After that the row is pruned, because
 * an unbounded table is a worse problem than a slightly less precise error on
 * a month-old link.
 */
export const TOKEN_ROW_GRACE_MS = 30 * 24 * 3_600_000;

/** Retention sweep: expired output dirs, orphaned tmp dirs, and stale token rows. */
function startRetentionSweep(context: AppContext, intervalMs: number): NodeJS.Timeout {
  const sweep = async (): Promise<void> => {
    try {
      const nowMs = context.now().getTime();
      const nowIso = context.now().toISOString();

      // Delete the file, keep the row: see TOKEN_ROW_GRACE_MS.
      for (const token of context.store.expiredTokens(nowIso)) {
        await context.engine.removeJob(token.jobId);
        context.store.markSwept(token.token, nowIso);
      }

      for (const token of context.store.prunableTokens(
        new Date(nowMs - TOKEN_ROW_GRACE_MS).toISOString(),
      )) {
        context.store.deleteToken(token);
      }

      const report = await context.engine.collectGarbage(nowMs);
      context.logger.debug("retention sweep complete", { ...report });
    } catch (error: unknown) {
      context.logger.warn("retention sweep failed", { error: String(error) });
    }
  };

  const timer = setInterval(() => void sweep(), intervalMs);
  // The sweep must never be the reason the process stays alive.
  timer.unref?.();
  return timer;
}
