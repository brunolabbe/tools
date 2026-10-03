/**
 * Everything a route needs, assembled once at boot and passed down.
 *
 * Routes take this rather than reaching for module-level singletons, which is
 * what lets a test build an app with an in-memory database and drive it through
 * `inject()` with no socket at all.
 */

import type { RateLimiter } from "@webtools/core/rate-limit";
import type { Database } from "better-sqlite3";
import type { ApiConfig } from "./config.ts";
import type { AppLogger } from "./logger.ts";

export interface AppContext {
  config: ApiConfig;
  logger: AppLogger;
  db: Database;
  /** One bucket per person, for the routes that read and for the ones that write (lg-4). */
  rateLimits: { reads: RateLimiter; writes: RateLimiter };
  startedAt: Date;
  /** Injected in tests so anything time-dependent is assertable. */
  now: () => Date;
  isShuttingDown: () => boolean;
}
