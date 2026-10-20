/**
 * Builds the whole service: config in, a started-but-not-listening app out.
 *
 * `createApp()` deliberately does not call `listen()`. Tests drive it through
 * `app.inject()` with no socket at all, and `main.ts` owns the listening and
 * the signal handling. That split is what makes the service testable without
 * ports, timeouts or teardown races.
 */

import { AppError } from "@ledger/contract";
import { createModelReader } from "@ledger/receipts";
import type { ReceiptReader } from "@ledger/receipts";
import { RateLimiter } from "@webtools/core/rate-limit";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createIdentityVerifier } from "./access.ts";
import type { Fetch } from "./access.ts";
import { Books, checkDataDir } from "./books.ts";
import type { ApiConfig } from "./config.ts";
import { loadApiConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { Directory } from "./directory.ts";
import { toErrorResponse } from "./http-errors.ts";
import { registerIdentityCheck } from "./identity.ts";
import type { AppLogger } from "./logger.ts";
import { createLogger } from "./logger.ts";
import { registerBucketRoutes } from "./routes/buckets.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { registerHouseholdRoutes } from "./routes/households.ts";
import { registerInboxRoutes } from "./routes/inbox.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerPeriodRoutes } from "./routes/periods.ts";
import { filePhotoStore, memoryPhotoStore } from "./receipt-photos.ts";
import type { PhotoStore } from "./receipt-photos.ts";
import { registerReceiptRoutes } from "./routes/receipts.ts";
import { registerRuleRoutes } from "./routes/rules.ts";
import { registerMortgageRoutes } from "./routes/mortgage.ts";
import { registerSalaryRoutes } from "./routes/salaries.ts";
import { registerSpendingCategoryRoutes } from "./routes/spending-categories.ts";
import { registerStatsRoutes } from "./routes/stats.ts";
import { registerStatementRoutes } from "./routes/statements.ts";
import { registerWebRoutes, serveIndexForUnknownPath } from "./routes/web.ts";

export interface CreateAppOptions {
  config?: Partial<ApiConfig>;
  logger?: AppLogger;
  now?: () => Date;
  /**
   * What fetches Access's signing keys. Injected in tests, which serve their
   * own key set and never reach Cloudflare; the URL it is called with is still
   * the one built from configuration.
   */
  fetch?: Fetch;
  /**
   * The household directory, already open. Tests hand one in, built in memory
   * with the members they need; otherwise `config.directoryPath` is opened.
   * Either way the app closes it on shutdown.
   */
  directory?: Directory;
  /**
   * What reads a receipt photo (lg-8). Tests hand in a fake, and no test reaches
   * a model; `null` is none, as with no key. Left out, the model reader is built
   * from `config.receiptReader` when it has a key.
   */
  receiptReader?: ReceiptReader | null;
  /** Where receipt photos are kept; by default files in the data directory, or the process under `:memory:`. */
  photos?: PhotoStore;
}

export interface App {
  server: FastifyInstance;
  context: AppContext;
  config: ApiConfig;
  /**
   * Every household's books, for the tests to look inside. Not in the context:
   * a route reads its books from `booksOf(request)` (lg-21).
   */
  books: Books;
  /** Stops intake and closes every household's books and the directory. */
  shutdown(): Promise<void>;
}

/**
 * Body size cap, sized for a pasted statement (lg-2). A synthetic row is about
 * 140 bytes (500 rows measured 70 865), a real one longer with its description,
 * and the household's account makes roughly a hundred rows a year. The old 64
 * KiB would have held a few years at best, and the first paste into an empty
 * database may be the whole of them; 1 MiB leaves an order of magnitude over
 * that. A paste over the cap is refused whole, as a 400.
 */
const MAX_BODY_BYTES = 1024 * 1024;

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  const config = loadApiConfig(options.config ?? {});
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  const now = options.now ?? (() => new Date());

  checkDataDir(config.dataDir);
  const directory = options.directory ?? Directory.open(config.directoryPath);
  const devIdentity = config.access.devIdentity;
  if (devIdentity !== undefined && directory.membershipOf(devIdentity) === undefined) {
    directory.close();
    // `INTERNAL`, as every refusal to boot is: the operator reads it in the log.
    throw new AppError(
      "INTERNAL",
      "DEV_IDENTITY is not a member of any household in the directory, so every request would be refused. Add it with npm run household:ledger.",
    );
  }
  // A missing directory file is created empty, and then every request is
  // refused with nothing at boot to say why: an unmounted volume or a wrong
  // DIRECTORY_PATH would read as a service refusing everyone (lg-20's gate, F4).
  if (directory.members().length === 0) {
    logger.warn(
      "the household directory has no members, so every request will be refused; add them with the household command",
    );
  }
  // Every household's books, opened, migrated and enrolled before any route
  // can be asked for them (books.ts).
  const books = new Books({ dataDir: config.dataDir, directory, now, logger });
  try {
    books.openAll();
  } catch (error: unknown) {
    books.close();
    directory.close();
    throw error;
  }

  let shuttingDown = false;

  const context: AppContext = {
    config,
    logger,
    directory,
    booksOpen: () => books.check(),
    rateLimits: {
      reads: new RateLimiter({ perMinute: config.rateLimitReadsPerMinute }),
      writes: new RateLimiter({ perMinute: config.rateLimitWritesPerMinute }),
    },
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
  // Before any route, so every route registered after it is covered.
  registerIdentityCheck(
    server,
    createIdentityVerifier({
      config: config.access,
      directory,
      fetch: options.fetch ?? globalThis.fetch,
      now,
      logger,
    }),
    // The caller's household's books, and only theirs. A household added since
    // boot gets its file here, and a member added since the last request is
    // enrolled the first time anyone in their household is seen.
    { booksFor: (person) => books.forMember(person) },
  );
  registerHealthRoute(server, context);
  registerMeRoute(server, context);
  registerHouseholdRoutes(server, context);
  registerStatementRoutes(server, context);
  registerRuleRoutes(server, context);
  registerInboxRoutes(server, context);
  registerBucketRoutes(server, context);
  registerSalaryRoutes(server, context);
  registerMortgageRoutes(server, context);
  registerPeriodRoutes(server, context);
  registerSpendingCategoryRoutes(server, context);
  registerStatsRoutes(server, context);
  registerReceiptRoutes(server, context, {
    reader: receiptReaderFor(options.receiptReader, config, logger),
    photos:
      options.photos ??
      (config.dataDir === ":memory:" ? memoryPhotoStore() : filePhotoStore(config.dataDir)),
  });
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
    books,
    async shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info("shutting down");
      await server.close();
      books.close();
      directory.close();
      logger.info("shutdown complete");
    },
  };
}

/**
 * The reader handed in, or the model reader when a key is configured, or none.
 * The model is logged at boot so an operator can see what reads; the key never.
 */
function receiptReaderFor(
  given: ReceiptReader | null | undefined,
  config: ApiConfig,
  logger: AppLogger,
): ReceiptReader | undefined {
  if (given !== undefined) return given ?? undefined;
  const { apiKey, model } = config.receiptReader;
  if (apiKey === undefined) {
    logger.info("no receipt reader: ANTHROPIC_API_KEY is not set, so receipts are typed by hand");
    return undefined;
  }
  logger.info("receipts are read by a model when a person asks", { model });
  return createModelReader({ provider: "anthropic", apiKey, model, logger });
}

/**
 * Every failure leaves through one place, so the status mapping cannot be
 * forgotten per-route.
 */
function registerErrorHandling(server: FastifyInstance, context: AppContext): void {
  server.setErrorHandler((error, request, reply) => {
    const tooLargeMessage = request.routeOptions.config.tooLargeMessage;
    const { status, body, appError } = toErrorResponse(
      error,
      tooLargeMessage === undefined ? {} : { tooLargeMessage },
    );

    // 5xx is ours; 4xx is theirs. Logging the two at the same level makes the
    // log useless for spotting real problems.
    //
    // The details' *names*, never their values: a refused statement's details
    // carry the offending row's description, amount and balance (lg-1 left this
    // decision to lg-2), and a log outlives the request and is read by whoever
    // reads logs. The caller already has them in the response body.
    const fields = {
      method: request.method,
      url: request.url,
      code: appError.code,
      status,
      detailKeys: Object.keys(appError.details ?? {}),
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
