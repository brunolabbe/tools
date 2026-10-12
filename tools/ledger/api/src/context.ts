/**
 * Everything a route needs, assembled once at boot and passed down.
 *
 * Routes take this rather than reaching for module-level singletons, which is
 * what lets a test build an app with in-memory databases and drive it through
 * `inject()` with no socket at all.
 */

import type { RateLimiter } from "@webtools/core/rate-limit";
import type { ApiConfig } from "./config.ts";
import type { Directory } from "./directory.ts";
import type { AppLogger } from "./logger.ts";

export interface AppContext {
  config: ApiConfig;
  logger: AppLogger;
  /** Who belongs to which household (lg-20). A file of its own, beside the books. */
  directory: Directory;
  /**
   * Whether every household's books are open, for health (lg-21). There is no
   * handle here: a route reads its books from `booksOf(request)`, the caller's
   * household's, and nothing in the context could give it another's.
   */
  booksOpen: () => boolean;
  /**
   * One bucket per person, keyed on their household and name (lg-21), for the
   * routes that read and for the ones that write (lg-4).
   */
  rateLimits: { reads: RateLimiter; writes: RateLimiter };
  startedAt: Date;
  /** Injected in tests so anything time-dependent is assertable. */
  now: () => Date;
  isShuttingDown: () => boolean;
}
