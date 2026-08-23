/**
 * Everything a route needs, assembled once at boot and passed down.
 *
 * Routes take this rather than reaching for module-level singletons, which is
 * what lets a test build an app with an in-memory database and a scripted
 * provider and drive it through `inject()` with no socket at all.
 */

import type { ModelProvider } from "@planner/agent";
import type { RateLimiter } from "@webtools/core/rate-limit";
import type { Database } from "better-sqlite3";
import type { ApiConfig } from "./config.ts";
import type { RunGroundingSource } from "./grounding/cache.ts";
import type { AppLogger } from "./logger.ts";
import type { RunEventHub } from "./runs/events.ts";
import type { RunQueue } from "./runs/queue.ts";

export interface AppContext {
  config: ApiConfig;
  logger: AppLogger;
  db: Database;
  model: ModelProvider;
  /**
   * Everything that reaches outside, behind one seam. The default reaches
   * nothing.
   *
   * Typed as the cache's capability rather than as the bare seam, so that
   * `groundingForRun` can hand a run a view that spends its budget on misses
   * only. A decorator placed around the cache has to carry `forRun` through or
   * this stops compiling, which is the point — see `grounding/cache.ts`.
   */
  grounding: RunGroundingSource;
  /** Where a plan run waits for a slot, and where cancelling it reaches it. */
  runs: RunQueue;
  /** One run in, N SSE subscribers out. Also the only place a frame's clock is read. */
  events: RunEventHub;
  /** Per-client admission control on starting a run. */
  runLimiter: RateLimiter;
  startedAt: Date;
  /** Injected in tests so anything time-dependent is assertable. */
  now: () => Date;
  isShuttingDown: () => boolean;
}
