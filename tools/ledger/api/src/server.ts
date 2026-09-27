/**
 * Builds the whole service: config in, a started-but-not-listening app out.
 *
 * `createApp()` deliberately does not call `listen()`. Tests drive it through
 * `app.inject()` with no socket at all, and `main.ts` owns the listening and
 * the signal handling. That split is what makes the service testable without
 * ports, timeouts or teardown races.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { AppError } from "@ledger/contract";
import Database from "better-sqlite3";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "./config.ts";
import { loadApiConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { migrate } from "./db/schema.ts";
import { toErrorResponse } from "./http-errors.ts";
import type { AppLogger } from "./logger.ts";
import { createLogger } from "./logger.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { registerWebRoutes, serveIndexForUnknownPath } from "./routes/web.ts";

export interface CreateAppOptions {
  config?: Partial<ApiConfig>;
  logger?: AppLogger;
  now?: () => Date;
}

export interface App {
  server: FastifyInstance;
  context: AppContext;
  config: ApiConfig;
  /** Stops intake and closes the database. */
  shutdown(): Promise<void>;
}

/**
 * Body size cap. Nothing here takes a body yet; the first route that does —
 * a pasted statement, most likely — decides whether this is enough.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const config = loadApiConfig(options.config ?? {});
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  const now = options.now ?? (() => new Date());

  if (config.databasePath !== ":memory:") {
    // better-sqlite3 will not create the directory, and failing at boot with
    // ENOENT on a path nobody chose explicitly is a poor first impression.
    mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  const db = new Database(config.databasePath);
  migrate(db);

  let shuttingDown = false;

  const context: AppContext = {
    config,
    logger,
    db,
    startedAt: now(),
    now,
    isShuttingDown: () => shuttingDown,
  };

  const server = Fastify({
    // The app's own logger writes structured lines; Fastify's would be a second
    // unrelated format on the same stream.
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
    // What makes `request.ip` mean the client rather than the proxy. See the
    // note on `ApiConfig.trustProxy`.
    trustProxy: config.trustProxy,
  });

  registerErrorHandling(server, context);
  registerCors(server, config);
  registerHealthRoute(server, context);
  // After the API routes, so a file in the bundle can never answer where a
  // route should have, and before the not-found handler, which needs the
  // static plugin's `reply.sendFile` to exist.
  const servingWeb = await registerWebRoutes(server, context);
  registerNotFoundHandler(server, servingWeb);

  await server.ready();

  return {
    server,
    context,
    config,
    async shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("shutting down");
      await server.close();
      db.close();
      logger.info("shutdown complete");
    },
  };
}

/**
 * Every failure leaves through one place, so the status mapping cannot be
 * forgotten per-route.
 */
function registerErrorHandling(server: FastifyInstance, context: AppContext): void {
  server.setErrorHandler((error, request, reply) => {
    const { status, body, appError } = toErrorResponse(error);

    // 5xx is ours; 4xx is theirs. Logging the two at the same level makes the
    // log useless for spotting real problems.
    const fields = {
      method: request.method,
      url: request.url,
      code: appError.code,
      status,
      details: appError.details,
    };
    if (status >= 500) context.logger.error("request failed", fields);
    else context.logger.info("request rejected", fields);

    void reply.code(status).send(body);
  });
}

/**
 * Split from `registerErrorHandling` because it has to be registered *after*
 * the static plugin: the SPA fallback needs `reply.sendFile`, which only exists
 * once that plugin has decorated the reply.
 *
 * `NOT_FOUND` is core's: a URL that matches no route is a fact about the
 * transport, not about anything in the books.
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
